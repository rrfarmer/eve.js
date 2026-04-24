const path = require("path");

const {
  getFittedModuleItems,
  getLoadedChargeItems,
  typeHasEffectName,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  resolveWeaponFamily,
} = require(path.join(__dirname, "../combat/weaponDogma"));

const GROUP_SCAN_PROBE_LAUNCHER = 481;

const MODULE_CLIENT_PARITY_FAMILIES = Object.freeze({
  generic: Object.freeze({
    familyID: "generic",
    hardpointBound: false,
    requiresOnlineEffectReplay: false,
    requiresLateFittedModuleReplayAfterHudBootstrap: false,
    preferRealChargeInventoryHudRows: false,
  }),
  turretWeapon: Object.freeze({
    familyID: "turretWeapon",
    hardpointBound: true,
    requiresOnlineEffectReplay: true,
    requiresLateFittedModuleReplayAfterHudBootstrap: true,
    preferRealChargeInventoryHudRows: false,
  }),
  missileLauncher: Object.freeze({
    familyID: "missileLauncher",
    hardpointBound: true,
    requiresOnlineEffectReplay: true,
    requiresLateFittedModuleReplayAfterHudBootstrap: true,
    preferRealChargeInventoryHudRows: true,
  }),
  probeLauncher: Object.freeze({
    familyID: "probeLauncher",
    hardpointBound: true,
    requiresOnlineEffectReplay: true,
    requiresLateFittedModuleReplayAfterHudBootstrap: true,
    preferRealChargeInventoryHudRows: true,
  }),
  precursorTurret: Object.freeze({
    familyID: "precursorTurret",
    hardpointBound: true,
    requiresOnlineEffectReplay: true,
    requiresLateFittedModuleReplayAfterHudBootstrap: true,
    preferRealChargeInventoryHudRows: true,
  }),
});

const SPACE_ATTACH_MODULE_PARITY_POLICIES = Object.freeze({
  login: Object.freeze({
    profileID: "login",
    allowAutoLateHardpointReplay: true,
  }),
  stargate: Object.freeze({
    profileID: "stargate",
    allowAutoLateHardpointReplay: true,
  }),
  solar: Object.freeze({
    profileID: "solar",
    allowAutoLateHardpointReplay: true,
  }),
  solarWarm: Object.freeze({
    profileID: "solarWarm",
    allowAutoLateHardpointReplay: true,
  }),
  transition: Object.freeze({
    profileID: "transition",
    allowAutoLateHardpointReplay: true,
  }),
  undock: Object.freeze({
    profileID: "undock",
    allowAutoLateHardpointReplay: true,
  }),
  capsule: Object.freeze({
    profileID: "capsule",
    allowAutoLateHardpointReplay: true,
  }),
});

const moduleFamilyCache = new Map();
const moduleFamilyByID = new Map(
  Object.values(MODULE_CLIENT_PARITY_FAMILIES).map((family) => [
    family.familyID,
    family,
  ]),
);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function buildModuleFamilyCacheKey(moduleItem) {
  return [
    toInt(moduleItem && moduleItem.typeID, 0),
    toInt(moduleItem && moduleItem.groupID, 0),
  ].join(":");
}

function resolveModuleParityFamily(moduleItem, chargeItem = null) {
  const moduleTypeID = toInt(moduleItem && moduleItem.typeID, 0);
  if (moduleTypeID <= 0) {
    return MODULE_CLIENT_PARITY_FAMILIES.generic;
  }

  const chargeTypeID = toInt(chargeItem && chargeItem.typeID, 0);
  const cacheKey = `${buildModuleFamilyCacheKey(moduleItem)}:${chargeTypeID}`;
  if (moduleFamilyCache.has(cacheKey)) {
    return moduleFamilyCache.get(cacheKey);
  }

  let family = MODULE_CLIENT_PARITY_FAMILIES.generic;
  const moduleGroupID = toInt(moduleItem && moduleItem.groupID, 0);
  if (moduleGroupID === GROUP_SCAN_PROBE_LAUNCHER) {
    family = MODULE_CLIENT_PARITY_FAMILIES.probeLauncher;
  } else {
    const weaponFamily = resolveWeaponFamily(moduleItem, chargeItem);
    if (weaponFamily === "precursorTurret") {
      family = MODULE_CLIENT_PARITY_FAMILIES.precursorTurret;
    } else if (weaponFamily === "missileLauncher") {
      family = MODULE_CLIENT_PARITY_FAMILIES.missileLauncher;
    } else if (
      weaponFamily === "laserTurret" ||
      weaponFamily === "hybridTurret" ||
      weaponFamily === "projectileTurret"
    ) {
      family = MODULE_CLIENT_PARITY_FAMILIES.turretWeapon;
    } else if (
      typeHasEffectName(moduleTypeID, "turretFitted") ||
      typeHasEffectName(moduleTypeID, "launcherFitted")
    ) {
      family = MODULE_CLIENT_PARITY_FAMILIES.turretWeapon;
    }
  }

  moduleFamilyCache.set(cacheKey, family);
  return family;
}

function getSpaceAttachModuleParityPolicy(profileID = "transition") {
  return (
    SPACE_ATTACH_MODULE_PARITY_POLICIES[String(profileID || "transition")] ||
    SPACE_ATTACH_MODULE_PARITY_POLICIES.transition
  );
}

function buildShipModuleParityManifest(characterID, shipID, options = {}) {
  const fittedModules = getFittedModuleItems(characterID, shipID);
  const loadedCharges = getLoadedChargeItems(characterID, shipID);
  const chargeByFlag = new Map(
    loadedCharges.map((chargeItem) => [toInt(chargeItem && chargeItem.flagID, 0), chargeItem]),
  );

  const familyCounts = new Map();
  const familyIDsByModuleID = {};
  const lateFittedModuleReplayItemIDs = [];
  let requiresOnlineEffectReplay = false;
  let requiresLateFittedModuleReplay = false;
  let prefersRealChargeInventoryHudRows = false;

  for (const moduleItem of fittedModules) {
    const family = resolveModuleParityFamily(
      moduleItem,
      chargeByFlag.get(toInt(moduleItem && moduleItem.flagID, 0)) || null,
    );
    familyIDsByModuleID[String(toInt(moduleItem && moduleItem.itemID, 0))] =
      family.familyID;
    familyCounts.set(
      family.familyID,
      (familyCounts.get(family.familyID) || 0) + 1,
    );
    if (family.requiresOnlineEffectReplay === true) {
      requiresOnlineEffectReplay = true;
    }
    if (family.preferRealChargeInventoryHudRows === true) {
      prefersRealChargeInventoryHudRows = true;
    }
    if (family.requiresLateFittedModuleReplayAfterHudBootstrap === true) {
      requiresLateFittedModuleReplay = true;
      lateFittedModuleReplayItemIDs.push(toInt(moduleItem && moduleItem.itemID, 0));
    }
  }

  return Object.freeze({
    characterID: toInt(characterID, 0),
    shipID: toInt(shipID, 0),
    moduleCount: fittedModules.length,
    loadedChargeCount: loadedCharges.length,
    requiresOnlineEffectReplay,
    requiresLateFittedModuleReplay,
    prefersRealChargeInventoryHudRows,
    lateFittedModuleReplayItemIDs: Object.freeze(
      lateFittedModuleReplayItemIDs.filter((itemID) => itemID > 0),
    ),
    familyCounts: Object.freeze(Object.fromEntries(familyCounts)),
    familyIDsByModuleID: Object.freeze(familyIDsByModuleID),
    profileHints: Object.freeze({
      attachProfileID: String(options.attachProfileID || ""),
    }),
  });
}

function shouldEnableLateFittedReplayForManifest(profileID, manifest) {
  const policy = getSpaceAttachModuleParityPolicy(profileID);
  return Boolean(
    policy &&
      policy.allowAutoLateHardpointReplay === true &&
      manifest &&
      manifest.requiresLateFittedModuleReplay === true &&
      Array.isArray(manifest.lateFittedModuleReplayItemIDs) &&
      manifest.lateFittedModuleReplayItemIDs.length > 0,
  );
}

function manifestRequiresRealChargeInventoryHudRowsForItemIDs(
  manifest,
  itemIDs = [],
) {
  if (
    !manifest ||
    manifest.prefersRealChargeInventoryHudRows !== true ||
    !Array.isArray(itemIDs) ||
    itemIDs.length === 0
  ) {
    return false;
  }

  const familyIDsByModuleID =
    manifest && typeof manifest.familyIDsByModuleID === "object"
      ? manifest.familyIDsByModuleID
      : null;
  if (!familyIDsByModuleID) {
    return false;
  }

  return itemIDs.some((itemID) => {
    const familyID =
      familyIDsByModuleID[String(toInt(itemID, 0))] || "";
    const family = moduleFamilyByID.get(familyID) || null;
    return Boolean(
      family && family.preferRealChargeInventoryHudRows === true,
    );
  });
}

module.exports = {
  GROUP_SCAN_PROBE_LAUNCHER,
  MODULE_CLIENT_PARITY_FAMILIES,
  SPACE_ATTACH_MODULE_PARITY_POLICIES,
  buildShipModuleParityManifest,
  getSpaceAttachModuleParityPolicy,
  manifestRequiresRealChargeInventoryHudRowsForItemIDs,
  resolveModuleParityFamily,
  shouldEnableLateFittedReplayForManifest,
};
