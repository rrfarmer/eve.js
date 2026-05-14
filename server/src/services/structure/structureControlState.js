const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));

function normalizePositiveInt(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function getSessionStructureID(session) {
  return normalizePositiveInt(
    session && (session.structureID || session.structureid),
    0,
  );
}

function getSessionShipID(session) {
  return normalizePositiveInt(
    session && (session.shipID || session.shipid),
    0,
  );
}

function getSessionActiveShipID(session) {
  return normalizePositiveInt(session && session.activeShipID, 0);
}

function isControllingStructureSession(session, structureID = null) {
  const dockedStructureID = getSessionStructureID(session);
  const targetStructureID = normalizePositiveInt(structureID, dockedStructureID);
  if (!targetStructureID || dockedStructureID !== targetStructureID) {
    return false;
  }
  return getSessionShipID(session) === targetStructureID;
}

function getStructurePilotSession(structureID, options = {}) {
  const targetStructureID = normalizePositiveInt(structureID, 0);
  if (!targetStructureID) {
    return null;
  }

  const excludedSession = options.excludeSession || null;
  return sessionRegistry
    .getSessions()
    .find((session) => (
      session !== excludedSession &&
      isControllingStructureSession(session, targetStructureID)
    )) || null;
}

function getStructurePilotCharacterID(structureID, options = {}) {
  const controllerSession = getStructurePilotSession(structureID, options);
  return normalizePositiveInt(
    controllerSession && (controllerSession.characterID || controllerSession.charid),
    0,
  ) || null;
}

function getRestorableShipID(session) {
  const storedShipID = normalizePositiveInt(
    session && session._structureControlPreviousShipID,
    0,
  );
  if (storedShipID) {
    return storedShipID;
  }

  const activeShipID = getSessionActiveShipID(session);
  if (activeShipID) {
    return activeShipID;
  }

  const shipID = getSessionShipID(session);
  const structureID = getSessionStructureID(session);
  if (shipID && shipID !== structureID) {
    return shipID;
  }

  return null;
}

function applySessionShipID(session, shipID) {
  const normalizedShipID = normalizePositiveInt(shipID, 0) || null;
  session.shipID = normalizedShipID;
  session.shipid = normalizedShipID;
  session.activeShipID = normalizedShipID;
  session.activeShipId = normalizedShipID;
}

function sendShipSessionChange(session, oldShipID, newShipID) {
  if (
    !session ||
    typeof session.sendSessionChange !== "function" ||
    oldShipID === newShipID
  ) {
    return;
  }

  session.sendSessionChange({
    shipid: [oldShipID || null, newShipID || null],
  });
}

function relinquishStructureControl(session, options = {}) {
  const structureID = getSessionStructureID(session);
  if (!structureID || !isControllingStructureSession(session, structureID)) {
    return {
      success: true,
      data: {
        changed: false,
        structureID,
        restoredShipID: getSessionShipID(session) || null,
      },
    };
  }

  const restoredShipID =
    normalizePositiveInt(options.restoreShipID, 0) ||
    getRestorableShipID(session) ||
    null;
  const oldShipID = structureID;

  applySessionShipID(session, restoredShipID);
  delete session._structureControlPreviousShipID;
  sendShipSessionChange(session, oldShipID, restoredShipID);

  return {
    success: true,
    data: {
      changed: true,
      structureID,
      restoredShipID,
    },
  };
}

function assumeStructureControl(session, structureID, options = {}) {
  const targetStructureID = normalizePositiveInt(structureID, 0);
  if (!targetStructureID) {
    return {
      success: false,
      errorMsg: "STRUCTURE_NOT_FOUND",
    };
  }

  if (getSessionStructureID(session) !== targetStructureID) {
    return {
      success: false,
      errorMsg: "NOT_DOCKED_IN_STRUCTURE",
    };
  }

  if (isControllingStructureSession(session, targetStructureID)) {
    return {
      success: true,
      data: {
        changed: false,
        structureID: targetStructureID,
        previousControllerCharacterID: getStructurePilotCharacterID(
          targetStructureID,
          { excludeSession: session },
        ),
      },
    };
  }

  const currentShipID = getSessionShipID(session);
  const previousShipID =
    currentShipID && currentShipID !== targetStructureID
      ? currentShipID
      : getRestorableShipID(session);

  if (previousShipID) {
    session._structureControlPreviousShipID = previousShipID;
  }

  const previousController = getStructurePilotSession(targetStructureID, {
    excludeSession: session,
  });
  const previousControllerCharacterID = normalizePositiveInt(
    previousController && (
      previousController.characterID ||
      previousController.charid
    ),
    0,
  ) || null;

  if (previousController) {
    relinquishStructureControl(previousController, {
      reason: options.reason || "override",
    });
  }

  applySessionShipID(session, targetStructureID);
  sendShipSessionChange(session, currentShipID || null, targetStructureID);

  return {
    success: true,
    data: {
      changed: true,
      structureID: targetStructureID,
      previousShipID: previousShipID || null,
      previousControllerCharacterID,
    },
  };
}

module.exports = {
  normalizePositiveInt,
  getSessionStructureID,
  getSessionShipID,
  getSessionActiveShipID,
  isControllingStructureSession,
  getStructurePilotSession,
  getStructurePilotCharacterID,
  relinquishStructureControl,
  assumeStructureControl,
};
