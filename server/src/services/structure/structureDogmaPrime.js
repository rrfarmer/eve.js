const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildInventoryDogmaPrimeEntry,
} = require(path.join(__dirname, "../character/characterState"));
const {
  getAttributeIDByNames,
  getTypeAttributeMap,
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
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

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : fallback;
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

  const requiredCoreTypeID =
    structureQuantumCore.getRequiredQuantumCoreTypeID(structure);
  attributes[ATTRIBUTE_STRUCTURE_REQUIRES_DEED_TYPE] =
    requiredCoreTypeID > 0 ? requiredCoreTypeID : 0;

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

  session.sendNotification("OnGodmaPrimeItem", "clientID", [
    structureID,
    buildInventoryDogmaPrimeEntry(structureItem, {
      description: "structure",
      attributes: buildStructureDogmaPrimeAttributes(structure),
    }),
  ]);
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
    `reason=${String(options.reason || "structure")}`,
  );
  return true;
}

module.exports = {
  ATTRIBUTE_FIGHTER_TUBES,
  ATTRIBUTE_STRUCTURE_REQUIRES_DEED_TYPE,
  STRUCTURE_ACTIVE_SHIP_DOGMA_DEFAULTS,
  buildStructureDogmaPrimeAttributes,
  buildStructureInventoryDogmaItem,
  getStructureParentLocationID,
  primeStructureDogmaItemForSession,
};
