"use strict";

const path = require("path");

const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));
const log = require(path.join(__dirname, "../../utils/logger"));

const DEBUG_LOG_PATH = path.join(
  __dirname,
  "../../../logs/structure-core-freeze-debug.log",
);

const STRUCTURE_CATEGORY_ID = 65;
const STRUCTURE_DEED_FLAG = 180;
const QUANTUM_CORE_GROUP_ID = 4086;
const STRUCTURE_SERVICE_SLOT_MIN = 164;
const STRUCTURE_SERVICE_SLOT_MAX = 171;
const STRUCTURE_FUEL_FLAG = 172;
const STRUCTURE_AMMO_FLAG = 5;
const STRUCTURE_FIGHTER_FLAG = 158;
const STRUCTURE_MOON_MATERIAL_FLAG = 186;
const STRUCTURE_BAY_FLAGS = new Set([
  STRUCTURE_AMMO_FLAG,
  STRUCTURE_FIGHTER_FLAG,
  STRUCTURE_FUEL_FLAG,
  STRUCTURE_DEED_FLAG,
  STRUCTURE_MOON_MATERIAL_FLAG,
]);

for (
  let flagID = STRUCTURE_SERVICE_SLOT_MIN;
  flagID <= STRUCTURE_SERVICE_SLOT_MAX;
  flagID += 1
) {
  STRUCTURE_BAY_FLAGS.add(flagID);
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getSessionStructureID(session) {
  return toNumber(session && (session.structureID || session.structureid), 0);
}

function getSessionCharacterID(session) {
  return toNumber(session && (session.characterID || session.charid || session.userid), 0);
}

function getSessionCorporationID(session) {
  return toNumber(session && (session.corporationID || session.corpid), 0);
}

function getSessionSolarSystemID(session) {
  return toNumber(session && (session.solarsystemid2 || session.solarsystemid), 0);
}

function normalizeRow(rowOrItem) {
  if (!rowOrItem) {
    return null;
  }
  if (Array.isArray(rowOrItem)) {
    return {
      itemID: toNumber(rowOrItem[0], 0),
      typeID: toNumber(rowOrItem[1], 0),
      ownerID: toNumber(rowOrItem[2], 0),
      locationID: toNumber(rowOrItem[3], 0),
      flagID: toNumber(rowOrItem[4], 0),
      quantity: toNumber(rowOrItem[5], 0),
      groupID: toNumber(rowOrItem[6], 0),
      categoryID: toNumber(rowOrItem[7], 0),
      customInfo: rowOrItem[8] == null ? "" : String(rowOrItem[8]),
      stacksize: toNumber(rowOrItem[9], 0),
      singleton: toNumber(rowOrItem[10], 0),
    };
  }
  if (typeof rowOrItem === "object") {
    return {
      itemID: toNumber(rowOrItem.itemID, 0),
      typeID: toNumber(rowOrItem.typeID, 0),
      ownerID: toNumber(rowOrItem.ownerID, 0),
      locationID: toNumber(rowOrItem.locationID, 0),
      flagID: toNumber(rowOrItem.flagID, 0),
      quantity: toNumber(rowOrItem.quantity, 0),
      groupID: toNumber(rowOrItem.groupID, 0),
      categoryID: toNumber(rowOrItem.categoryID, 0),
      customInfo: rowOrItem.customInfo == null ? "" : String(rowOrItem.customInfo),
      stacksize: toNumber(rowOrItem.stacksize, 0),
      singleton: toNumber(rowOrItem.singleton, 0),
    };
  }
  return null;
}

function shouldTraceRow(session, rowOrItem, extra = {}) {
  const structureID = getSessionStructureID(session);
  const row = normalizeRow(rowOrItem);
  if (!row || structureID <= 0) {
    return false;
  }
  if (extra.force === true || extra.reason === "OnItemChange") {
    return true;
  }
  return (
    row.itemID === structureID ||
    row.locationID === structureID ||
    row.categoryID === STRUCTURE_CATEGORY_ID ||
    row.groupID === QUANTUM_CORE_GROUP_ID ||
    row.flagID === STRUCTURE_DEED_FLAG ||
    STRUCTURE_BAY_FLAGS.has(row.flagID)
  );
}

function append(entry) {
  try {
    rotatingLog.append(
      DEBUG_LOG_PATH,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  } catch (_) {}
}

function traceRow(event, session, rowOrItem, extra = {}) {
  if (!shouldTraceRow(session, rowOrItem, extra)) {
    return;
  }
  const row = normalizeRow(rowOrItem);
  const structureID = getSessionStructureID(session);
  const selfLocatedStructure =
    row.itemID === structureID && row.locationID === structureID;
  if (selfLocatedStructure) {
    log.warn(
      `[StructureCoreFreezeDiagnostics] Self-parented structure inventory row ` +
      `event=${event} structureID=${structureID} typeID=${row.typeID} flagID=${row.flagID}`,
    );
  }
  append({
    event,
    session: {
      charID: getSessionCharacterID(session),
      corpID: getSessionCorporationID(session),
      structureID,
      shipID: toNumber(session && (session.shipID || session.shipid), 0),
      activeShipID: toNumber(session && session.activeShipID, 0),
      locationID: toNumber(session && session.locationid, 0),
      solarSystemID: getSessionSolarSystemID(session),
      boundObjectID: session && session.currentBoundObjectID
        ? String(session.currentBoundObjectID)
        : null,
    },
    row,
    diagnostics: {
      itemIsStructure: row.itemID === structureID,
      locationIsStructure: row.locationID === structureID,
      selfLocatedStructure,
      structureBayFlag: STRUCTURE_BAY_FLAGS.has(row.flagID),
      quantumCoreGroup: row.groupID === QUANTUM_CORE_GROUP_ID,
    },
    ...extra,
  });
}

function traceRows(event, session, rows = [], extra = {}) {
  if (!Array.isArray(rows)) {
    return;
  }
  rows.forEach((row, index) => {
    traceRow(event, session, row, { ...extra, index });
  });
}

function traceEvent(event, session, extra = {}) {
  const structureID = getSessionStructureID(session);
  if (structureID <= 0 && extra.force !== true) {
    return;
  }
  append({
    event,
    session: {
      charID: getSessionCharacterID(session),
      corpID: getSessionCorporationID(session),
      structureID,
      shipID: toNumber(session && (session.shipID || session.shipid), 0),
      activeShipID: toNumber(session && session.activeShipID, 0),
      locationID: toNumber(session && session.locationid, 0),
      solarSystemID: getSessionSolarSystemID(session),
      boundObjectID: session && session.currentBoundObjectID
        ? String(session.currentBoundObjectID)
        : null,
    },
    ...extra,
  });
}

module.exports = {
  DEBUG_LOG_PATH,
  normalizeRow,
  shouldTraceRow,
  traceEvent,
  traceRow,
  traceRows,
};
