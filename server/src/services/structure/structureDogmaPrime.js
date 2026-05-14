const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildInventoryDogmaPrimeEntry,
} = require(path.join(__dirname, "../character/characterState"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAttributeIDByNames,
  getTypeAttributeValue,
  getTypeAttributeMap,
  isModuleOnline,
  isStructureFittingFlag,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const structureQuantumCore = require(path.join(__dirname, "./structureQuantumCore"));
const structureCoreFreezeDiagnostics = require(path.join(
  __dirname,
  "./structureCoreFreezeDiagnostics",
));

const ATTRIBUTE_STRUCTURE_REQUIRES_DEED_TYPE =
  getAttributeIDByNames("structureRequiresDeedType") || 3101;
const ATTRIBUTE_FIGHTER_TUBES =
  getAttributeIDByNames("fighterTubes") || 2216;
const ATTRIBUTE_POWER_OUTPUT = getAttributeIDByNames("powerOutput") || 11;
const ATTRIBUTE_POWER_LOAD = getAttributeIDByNames("powerLoad") || 15;
const ATTRIBUTE_CPU_OUTPUT = getAttributeIDByNames("cpuOutput") || 48;
const ATTRIBUTE_CPU_LOAD = getAttributeIDByNames("cpuLoad") || 49;
const ATTRIBUTE_UPGRADE_CAPACITY =
  getAttributeIDByNames("upgradeCapacity") || 1132;
const ATTRIBUTE_UPGRADE_LOAD = getAttributeIDByNames("upgradeLoad") || 1152;
const ATTRIBUTE_UPGRADE_SLOTS_LEFT =
  getAttributeIDByNames("upgradeSlotsLeft") || 1154;
const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || null;
const ATTRIBUTE_IS_ONLINE = getAttributeIDByNames("isOnline") || null;
const ATTRIBUTE_ITEM_DAMAGE = getAttributeIDByNames("damage") || null;
const ATTRIBUTE_ARMOR_DAMAGE = getAttributeIDByNames("armorDamage") || null;
const ATTRIBUTE_SHIELD_CHARGE = getAttributeIDByNames("shieldCharge") || null;
const STRUCTURE_ACTIVE_SHIP_DOGMA_DEFAULTS = Object.freeze({
  [getAttributeIDByNames("heatHi") || 1175]: 0,
  [getAttributeIDByNames("heatMed") || 1176]: 0,
  [getAttributeIDByNames("heatLow") || 1177]: 0,
  [getAttributeIDByNames("heatCapacityHi") || 1178]: 0,
  [getAttributeIDByNames("heatDissipationRateHi") || 1179]: 0,
  [getAttributeIDByNames("heatAbsorbtionRateModifier") || 1180]: 0,
  [getAttributeIDByNames("heatAbsorbtionRateHi") || 1182]: 0,
  [getAttributeIDByNames("heatAbsorbtionRateMed") || 1183]: 0,
  [getAttributeIDByNames("heatAbsorbtionRateLow") || 1184]: 0,
  [getAttributeIDByNames("heatDissipationRateMed") || 1196]: 0,
  [getAttributeIDByNames("heatDissipationRateLow") || 1198]: 0,
  [getAttributeIDByNames("heatCapacityMed") || 1199]: 0,
  [getAttributeIDByNames("heatCapacityLow") || 1200]: 0,
  [getAttributeIDByNames("heatGenerationMultiplier") || 1224]: 1,
  [getAttributeIDByNames("heatAttenuationHi") || 1259]: 1,
  [getAttributeIDByNames("heatAttenuationMed") || 1261]: 1,
  [getAttributeIDByNames("heatAttenuationLow") || 1262]: 1,
});
const STRUCTURE_FITTING_GAUGE_ATTRIBUTE_IDS = Object.freeze([
  ATTRIBUTE_POWER_OUTPUT,
  ATTRIBUTE_POWER_LOAD,
  ATTRIBUTE_CPU_OUTPUT,
  ATTRIBUTE_CPU_LOAD,
  ATTRIBUTE_UPGRADE_CAPACITY,
  ATTRIBUTE_UPGRADE_LOAD,
]);

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function ensureNumericAttribute(attributes, attributeID, fallbackValue = 0) {
  const numericAttributeID = toPositiveInt(attributeID, 0);
  if (numericAttributeID <= 0) {
    return;
  }

  const currentValue = Number(attributes[numericAttributeID]);
  attributes[numericAttributeID] = Number.isFinite(currentValue)
    ? currentValue
    : round6(fallbackValue);
}

function getStructureID(structure) {
  return toPositiveInt(
    structure && (structure.structureID || structure.itemID),
    0,
  );
}

function buildStructureFittingResourceUsage(structureID) {
  const targetStructureID = toPositiveInt(structureID, 0);
  if (targetStructureID <= 0) {
    return {
      powerLoad: 0,
      cpuLoad: 0,
      upgradeLoad: 0,
    };
  }

  let powerLoad = 0;
  let cpuLoad = 0;
  let upgradeLoad = 0;

  for (const item of listContainerItems(null, targetStructureID)) {
    if (!item || Number(item.categoryID) === 8 || !isStructureFittingFlag(item.flagID)) {
      continue;
    }

    if (isModuleOnline(item)) {
      powerLoad += toFiniteNumber(
        getTypeAttributeValue(item.typeID, "powerLoad", "power"),
        0,
      );
      cpuLoad += toFiniteNumber(
        getTypeAttributeValue(item.typeID, "cpuLoad", "cpu"),
        0,
      );
    }

    upgradeLoad += toFiniteNumber(
      getTypeAttributeValue(item.typeID, "upgradeCost"),
      0,
    );
  }

  return {
    powerLoad: round6(powerLoad),
    cpuLoad: round6(cpuLoad),
    upgradeLoad: round6(upgradeLoad),
  };
}

function getStructureParentLocationID(structure, fallback = 0) {
  const structureID = toPositiveInt(structure && structure.structureID, 0);
  for (const candidate of [
    structure && structure.solarSystemID,
    structure && structure.solarsystemID,
    structure && structure.solarSystemId,
    structure && structure.locationID,
    structure && structure.locationid,
  ]) {
    const locationID = toPositiveInt(candidate, 0);
    if (locationID > 0 && locationID !== structureID) {
      return locationID;
    }
  }
  return toPositiveInt(fallback, 0);
}

function buildStructureInventoryDogmaItem(structure) {
  if (!structure) {
    return null;
  }
  const structureID = toPositiveInt(structure.structureID, 0);
  const typeID = toPositiveInt(structure.typeID, 0);
  if (structureID <= 0 || typeID <= 0) {
    return null;
  }

  const itemType = resolveItemByTypeID(typeID) || {};
  const parentLocationID = getStructureParentLocationID(structure, 0);
  return {
    itemID: structureID,
    typeID,
    ownerID: toPositiveInt(
      structure.ownerCorpID || structure.ownerID,
      0,
    ),
    locationID: parentLocationID,
    flagID: 0,
    quantity: 1,
    singleton: 1,
    stacksize: 1,
    groupID: toPositiveInt(itemType.groupID, 0),
    categoryID: toPositiveInt(itemType.categoryID, 0),
    customInfo: String(structure.itemName || structure.name || ""),
  };
}

function buildStructureDogmaPrimeAttributes(structure) {
  const typeID = toPositiveInt(structure && structure.typeID, 0);
  const structureID = getStructureID(structure);
  const attributes = typeID > 0 ? getTypeAttributeMap(typeID) : {};

  // Structure control reuses the active-ship HUD, which reads rack heat attributes.
  for (const [attributeID, value] of Object.entries(
    STRUCTURE_ACTIVE_SHIP_DOGMA_DEFAULTS,
  )) {
    if (!Object.prototype.hasOwnProperty.call(attributes, attributeID)) {
      attributes[Number(attributeID)] = value;
    }
  }

  if (!Object.prototype.hasOwnProperty.call(attributes, ATTRIBUTE_FIGHTER_TUBES)) {
    attributes[ATTRIBUTE_FIGHTER_TUBES] = Number(
      getTypeAttributeValue(typeID, "fighterTubes"),
    ) || 0;
  }

  ensureNumericAttribute(
    attributes,
    ATTRIBUTE_POWER_OUTPUT,
    getTypeAttributeValue(typeID, "powerOutput"),
  );
  ensureNumericAttribute(
    attributes,
    ATTRIBUTE_CPU_OUTPUT,
    getTypeAttributeValue(typeID, "cpuOutput"),
  );
  ensureNumericAttribute(
    attributes,
    ATTRIBUTE_UPGRADE_CAPACITY,
    getTypeAttributeValue(typeID, "upgradeCapacity"),
  );
  ensureNumericAttribute(
    attributes,
    ATTRIBUTE_UPGRADE_SLOTS_LEFT,
    getTypeAttributeValue(typeID, "upgradeSlotsLeft"),
  );

  const resourceUsage = buildStructureFittingResourceUsage(structureID);
  attributes[ATTRIBUTE_POWER_LOAD] = resourceUsage.powerLoad;
  attributes[ATTRIBUTE_CPU_LOAD] = resourceUsage.cpuLoad;
  attributes[ATTRIBUTE_UPGRADE_LOAD] = resourceUsage.upgradeLoad;

  const requiredCoreTypeID =
    structureQuantumCore.getRequiredQuantumCoreTypeID(structure);
  attributes[ATTRIBUTE_STRUCTURE_REQUIRES_DEED_TYPE] =
    requiredCoreTypeID > 0 ? requiredCoreTypeID : 0;

  return attributes;
}

function listStructureFittingDogmaPrimeItems(structureID) {
  const targetStructureID = toPositiveInt(structureID, 0);
  if (targetStructureID <= 0) {
    return [];
  }

  return listContainerItems(null, targetStructureID, null)
    .filter((item) => item && isStructureFittingFlag(item.flagID))
    .sort((left, right) => {
      const leftFlag = toPositiveInt(left && left.flagID, 0);
      const rightFlag = toPositiveInt(right && right.flagID, 0);
      if (leftFlag !== rightFlag) {
        return leftFlag - rightFlag;
      }
      return toPositiveInt(left && left.itemID, 0) - toPositiveInt(right && right.itemID, 0);
    });
}

function buildStructureFittingDogmaPrimeAttributes(item) {
  const typeID = toPositiveInt(item && item.typeID, 0);
  const attributes = typeID > 0 ? getTypeAttributeMap(typeID) : {};

  if (ATTRIBUTE_QUANTITY) {
    attributes[ATTRIBUTE_QUANTITY] = Math.max(
      0,
      toFiniteNumber(item && (item.stacksize ?? item.quantity), 1),
    );
  }
  if (ATTRIBUTE_IS_ONLINE && item && item.moduleState) {
    attributes[ATTRIBUTE_IS_ONLINE] = isModuleOnline(item) ? 1 : 0;
  }
  if (ATTRIBUTE_ITEM_DAMAGE && Number.isFinite(Number(item && item.moduleState && item.moduleState.damage))) {
    attributes[ATTRIBUTE_ITEM_DAMAGE] = Number(item.moduleState.damage);
  }
  if (ATTRIBUTE_ARMOR_DAMAGE && Number.isFinite(Number(item && item.moduleState && item.moduleState.armorDamage))) {
    attributes[ATTRIBUTE_ARMOR_DAMAGE] = Number(item.moduleState.armorDamage);
  }
  if (ATTRIBUTE_SHIELD_CHARGE && Number.isFinite(Number(item && item.moduleState && item.moduleState.shieldCharge))) {
    attributes[ATTRIBUTE_SHIELD_CHARGE] = Number(item.moduleState.shieldCharge);
  }

  return attributes;
}

function primeStructureDogmaItemForSession(session, structure, options = {}) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !structure
  ) {
    return false;
  }

  const structureID = toPositiveInt(structure.structureID, 0);
  const structureItem = buildStructureInventoryDogmaItem(structure);
  if (structureID <= 0 || !structureItem) {
    return false;
  }

  const now = currentFileTime();
  session.sendNotification("OnGodmaPrimeItem", "clientID", [
    structureID,
    buildInventoryDogmaPrimeEntry(structureItem, {
      description: "structure",
      attributes: buildStructureDogmaPrimeAttributes(structure),
      now,
    }),
  ]);

  const fittedItems = listStructureFittingDogmaPrimeItems(structureID);
  for (const item of fittedItems) {
    session.sendNotification("OnGodmaPrimeItem", "clientID", [
      structureID,
      buildInventoryDogmaPrimeEntry(item, {
        description: item.itemName || "structure module",
        attributes: buildStructureFittingDogmaPrimeAttributes(item),
        now,
      }),
    ]);
  }

  structureCoreFreezeDiagnostics.traceRow(
    "StructureDogmaPrime.OnGodmaPrimeItem",
    session,
    structureItem,
    {
      reason: String(options.reason || "structure"),
    },
  );
  log.debug(
    `[StructureDogmaPrime] Primed structure dogma item structureID=${structureID} ` +
    `fittedItems=${fittedItems.length} reason=${String(options.reason || "structure")}`,
  );
  if (options.notifyStatsChanged !== false) {
    notifyStructureFittingStatsChangedForSession(session, structure, {
      reason: options.reason || "structure",
    });
  }
  return true;
}

function notifyStructureFittingStatsChangedForSession(
  session,
  structure,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !structure
  ) {
    return false;
  }

  const structureID = getStructureID(structure);
  if (structureID <= 0) {
    return false;
  }

  const attributes = buildStructureDogmaPrimeAttributes(structure);
  const upgradeSlotsLeft = round6(attributes[ATTRIBUTE_UPGRADE_SLOTS_LEFT]);
  session.sendNotification("OnDogmaAttributeChanged", "clientID", [
    structureID,
    structureID,
    ATTRIBUTE_UPGRADE_SLOTS_LEFT,
    upgradeSlotsLeft,
  ]);
  log.debug(
    `[StructureDogmaPrime] Signalled fitting stats refresh structureID=${structureID} ` +
    `reason=${String(options.reason || "structureFittingStatsRefresh")}`,
  );
  return true;
}

function getSessionCharID(session) {
  return toPositiveInt(
    session && (session.charid || session.characterID || session.characterId),
    0,
  );
}

function buildStructureFittingGaugeAttributeChanges(session, structure) {
  const structureID = getStructureID(structure);
  const charID = getSessionCharID(session);
  if (structureID <= 0 || charID <= 0) {
    return [];
  }

  const attributes = buildStructureDogmaPrimeAttributes(structure);
  const timestamp = currentFileTime();
  return STRUCTURE_FITTING_GAUGE_ATTRIBUTE_IDS.map((attributeID) => {
    const value = round6(attributes[attributeID]);
    return [
      "OnModuleAttributeChanges",
      charID,
      structureID,
      attributeID,
      timestamp,
      value,
      value,
      null,
    ];
  });
}

function refreshStructureFittingGaugeAttributesForSession(
  session,
  structure,
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !structure
  ) {
    return false;
  }

  const changes = buildStructureFittingGaugeAttributeChanges(session, structure);
  if (changes.length === 0) {
    return false;
  }

  if (options.prime !== false) {
    primeStructureDogmaItemForSession(session, structure, {
      reason: options.reason || "structureFittingGaugeRefresh",
      notifyStatsChanged: false,
    });
  }

  session.sendNotification("OnModuleAttributeChanges", "clientID", [{
    type: "list",
    items: changes,
  }]);
  notifyStructureFittingStatsChangedForSession(session, structure, {
    reason: options.reason || "structureFittingGaugeRefresh",
  });

  log.debug(
    `[StructureDogmaPrime] Refreshed fitting gauge attrs structureID=${getStructureID(structure)} ` +
    `reason=${String(options.reason || "structureFittingGaugeRefresh")}`,
  );
  return true;
}

module.exports = {
  ATTRIBUTE_CPU_LOAD,
  ATTRIBUTE_CPU_OUTPUT,
  ATTRIBUTE_FIGHTER_TUBES,
  ATTRIBUTE_POWER_LOAD,
  ATTRIBUTE_POWER_OUTPUT,
  ATTRIBUTE_STRUCTURE_REQUIRES_DEED_TYPE,
  ATTRIBUTE_UPGRADE_CAPACITY,
  ATTRIBUTE_UPGRADE_LOAD,
  ATTRIBUTE_UPGRADE_SLOTS_LEFT,
  STRUCTURE_ACTIVE_SHIP_DOGMA_DEFAULTS,
  STRUCTURE_FITTING_GAUGE_ATTRIBUTE_IDS,
  buildStructureFittingResourceUsage,
  buildStructureDogmaPrimeAttributes,
  buildStructureFittingGaugeAttributeChanges,
  buildStructureInventoryDogmaItem,
  getStructureParentLocationID,
  notifyStructureFittingStatsChangedForSession,
  primeStructureDogmaItemForSession,
  refreshStructureFittingGaugeAttributesForSession,
};
