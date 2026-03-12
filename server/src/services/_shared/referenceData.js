const path = require("path");

const database = require(path.join(__dirname, "../../database"));
const log = require(path.join(__dirname, "../../utils/logger"));

const TABLE = Object.freeze({
  SHIP_TYPES: "shipTypes",
  SHIP_DOGMA_ATTRIBUTES: "shipDogmaAttributes",
  SKILL_TYPES: "skillTypes",
  SOLAR_SYSTEMS: "solarSystems",
  STATIONS: "stations",
  CELESTIALS: "celestials",
  STARGATES: "stargates",
  MOVEMENT_ATTRIBUTES: "movementAttributes",
});

const ROW_KEY = Object.freeze({
  [TABLE.SHIP_TYPES]: "ships",
  [TABLE.SKILL_TYPES]: "skills",
  [TABLE.SOLAR_SYSTEMS]: "solarSystems",
  [TABLE.STATIONS]: "stations",
  [TABLE.CELESTIALS]: "celestials",
  [TABLE.STARGATES]: "stargates",
  [TABLE.MOVEMENT_ATTRIBUTES]: "attributes",
});

const cache = new Map();

function normalizePayload(tableName, payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return payload;
}

function readStaticTable(tableName) {
  if (cache.has(tableName)) {
    return cache.get(tableName);
  }

  const result = database.read(tableName, "/");
  if (!result.success) {
    log.warn(
      `[ReferenceData] Failed to load table ${tableName}: ${result.errorMsg || "READ_ERROR"}`,
    );
    const fallback = {};
    cache.set(tableName, fallback);
    return fallback;
  }

  const payload = normalizePayload(tableName, result.data);
  cache.set(tableName, payload);
  return payload;
}

function readStaticRows(tableName) {
  const payload = readStaticTable(tableName);
  const rowKey = ROW_KEY[tableName];
  if (!rowKey) {
    return [];
  }

  const rows = payload[rowKey];
  return Array.isArray(rows) ? rows : [];
}

function clearReferenceCache() {
  cache.clear();
}

module.exports = {
  TABLE,
  readStaticTable,
  readStaticRows,
  clearReferenceCache,
};

