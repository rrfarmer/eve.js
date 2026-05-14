const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  clearDeferredDockedShipSessionChange,
  clearDeferredDockedFittingReplay,
} = require(path.join(__dirname, "../character/characterState"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const structureServiceModules = require(path.join(__dirname, "./structureServiceModules"));
const {
  primeStructureDogmaItemForSession,
  refreshStructureFittingGaugeAttributesForSession,
} = require(path.join(__dirname, "./structureDogmaPrime"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_SETTING_ID,
  characterHasStructureSetting,
} = require(path.join(__dirname, "./structurePayloads"));
const {
  normalizePositiveInt,
  getSessionStructureID,
  getStructurePilotCharacterID,
  relinquishStructureControl,
  assumeStructureControl,
} = require(path.join(__dirname, "./structureControlState"));

const STRUCTURE_CONTROL_ACTIVATION_SETTLE_MS = 500;
const STRUCTURE_CONTROL_FITTING_REFRESH_DELAY_MS = 2000;

function waitForStructureControlActivationSettle() {
  return new Promise((resolve) => {
    setTimeout(resolve, STRUCTURE_CONTROL_ACTIVATION_SETTLE_MS);
  });
}

function clearStructureControlFittingRefreshTimer(session) {
  if (!session || !session._structureControlFittingRefreshTimer) {
    return;
  }

  clearTimeout(session._structureControlFittingRefreshTimer);
  session._structureControlFittingRefreshTimer = null;
}

function getStructureControlFittingRefreshDelay(session) {
  if (
    session &&
    Object.prototype.hasOwnProperty.call(
      session,
      "_structureControlFittingRefreshDelayMs",
    )
  ) {
    const explicitDelay = Number(session._structureControlFittingRefreshDelayMs);
    return Number.isFinite(explicitDelay) && explicitDelay >= 0
      ? Math.trunc(explicitDelay)
      : STRUCTURE_CONTROL_FITTING_REFRESH_DELAY_MS;
  }

  return STRUCTURE_CONTROL_FITTING_REFRESH_DELAY_MS;
}

function sessionStillControlsStructure(session, structureID) {
  return (
    session &&
    getSessionStructureID(session) === structureID &&
    normalizePositiveInt(session.shipid || session.shipID, 0) === structureID
  );
}

function scheduleStructureFittingGaugeRefresh(session, structure) {
  const structureID = normalizePositiveInt(
    structure && structure.structureID,
    0,
  );
  if (structureID <= 0 || !session) {
    return;
  }

  clearStructureControlFittingRefreshTimer(session);

  const sendRefresh = () => {
    session._structureControlFittingRefreshTimer = null;
    if (!sessionStillControlsStructure(session, structureID)) {
      return;
    }
    refreshStructureFittingGaugeAttributesForSession(session, structure, {
      reason: "structureControl.TakeControl.settled",
    });
  };

  const delayMs = getStructureControlFittingRefreshDelay(session);
  if (delayMs <= 0) {
    sendRefresh();
    return;
  }

  session._structureControlFittingRefreshTimer = setTimeout(sendRefresh, delayMs);
  if (typeof session._structureControlFittingRefreshTimer.unref === "function") {
    session._structureControlFittingRefreshTimer.unref();
  }
}

function throwControlDenied(errorMsg = "") {
  switch (String(errorMsg || "").trim()) {
    case "NOT_DOCKED_IN_STRUCTURE":
      throwWrappedUserError("CustomNotify", {
        notify: "You must be docked in this structure to take control.",
      });
      break;
    case "STRUCTURE_CONTROL_DENIED":
      throwWrappedUserError("StructureDefenseDenied");
      break;
    case "STRUCTURE_NOT_FOUND":
      throwWrappedUserError("TargetingAttemptCancelled");
      break;
    default:
      throwWrappedUserError("CustomNotify", {
        notify: "Unable to assume structure control.",
      });
      break;
  }
}

function clearStructureControlDockedReplayState(session) {
  if (!session) {
    return;
  }

  clearStructureControlFittingRefreshTimer(session);
  clearDeferredDockedShipSessionChange(session);
  clearDeferredDockedFittingReplay(session);
  session._pendingCommandShipFittingReplay = null;
}

function extractModuleItemID(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return Number(value) || 0;
  }
  if (typeof value === "string") {
    return Number(value) || 0;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const itemID = extractModuleItemID(entry);
      if (itemID > 0) {
        return itemID;
      }
    }
    return 0;
  }
  if (value && typeof value === "object") {
    if (value.type === "packedrow" && value.fields) {
      return extractModuleItemID(value.fields);
    }
    if (
      value.name === "util.KeyVal" &&
      value.args &&
      value.args.type === "dict" &&
      Array.isArray(value.args.entries)
    ) {
      const itemIDEntry = value.args.entries.find(
        ([key]) => String(key) === "itemID",
      );
      return extractModuleItemID(itemIDEntry && itemIDEntry[1]);
    }
    return Number(value.itemID ?? value.moduleID ?? value.id) || 0;
  }
  return 0;
}

function throwDisableServiceModuleDenied(errorMsg = "") {
  switch (String(errorMsg || "").trim()) {
    case "MODULE_NOT_FOUND":
      throwWrappedUserError("CustomNotify", {
        notify: "Unable to find that structure service module.",
      });
      break;
    case "NOT_DOCKED_IN_STRUCTURE":
      throwWrappedUserError("CustomNotify", {
        notify: "You must be docked in this structure to disable that service module.",
      });
      break;
    case "STRUCTURE_NOT_FOUND":
      throwWrappedUserError("CustomNotify", {
        notify: "Unable to find the structure for that service module.",
      });
      break;
    default:
      throwWrappedUserError("CustomNotify", {
        notify: "Unable to disable that structure service module.",
      });
      break;
  }
}

class StructureControlService extends BaseService {
  constructor() {
    super("structureControl");
  }

  Handle_GetStructurePilot(args, session) {
    const structureID = normalizePositiveInt(args && args[0], 0);
    return getStructurePilotCharacterID(structureID) || null;
  }

  async Handle_TakeControl(args, session) {
    const structureID = normalizePositiveInt(
      args && args[0],
      getSessionStructureID(session),
    );
    const structure = structureState.getStructureByID(structureID, {
      refresh: false,
    });
    if (!structure) {
      throwControlDenied("STRUCTURE_NOT_FOUND");
    }

    if (getSessionStructureID(session) !== structureID) {
      throwControlDenied("NOT_DOCKED_IN_STRUCTURE");
    }

    if (!characterHasStructureSetting(
      session,
      structure,
      STRUCTURE_SETTING_ID.DEFENSE_CAN_CONTROL_STRUCTURE,
    )) {
      throwControlDenied("STRUCTURE_CONTROL_DENIED");
    }

    clearStructureControlDockedReplayState(session);
    const result = assumeStructureControl(session, structureID);
    if (!result.success) {
      throwControlDenied(result.errorMsg);
    }

    primeStructureDogmaItemForSession(session, structure, {
      reason: "structureControl.TakeControl",
    });
    // The retail client calls TakeControl directly, then can open fitting before
    // its async MakeShipActive task populates clientDogmaLocation.shipsByPilotID.
    await waitForStructureControlActivationSettle();
    scheduleStructureFittingGaugeRefresh(session, structure);

    return null;
  }

  Handle_ReleaseControl(args, session) {
    relinquishStructureControl(session, {
      reason: "release",
    });
    clearStructureControlDockedReplayState(session);
    spaceRuntime.clearDockedStructureView(session);
    return null;
  }

  Handle_CheckCanDisableServiceModule(args, session) {
    const moduleItemID = extractModuleItemID(args && args.length > 0 ? args[0] : args);
    const moduleItem = findItemById(moduleItemID);
    const result = structureServiceModules.checkCanDisableServiceModule(
      moduleItem || moduleItemID,
      session,
    );
    if (!result.success) {
      throwDisableServiceModuleDenied(result.errorMsg);
    }
    return true;
  }
}

module.exports = StructureControlService;
