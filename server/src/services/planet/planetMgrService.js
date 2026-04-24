const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));

let planetMetaCache = null;

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function getCharacterColonies(characterRecord = {}) {
  const candidates = [
    characterRecord.colonies,
    characterRecord.planets,
    characterRecord.planetColonies,
  ];
  const source = candidates.find((entry) => Array.isArray(entry));
  return Array.isArray(source) ? source.filter(Boolean) : [];
}

function getPlanetMetaByID() {
  if (planetMetaCache) {
    return planetMetaCache;
  }

  planetMetaCache = new Map();
  for (const row of readStaticRows(TABLE.CELESTIALS)) {
    if (!row || (row.kind !== "planet" && row.groupName !== "Planet")) {
      continue;
    }
    const itemID = toInt(row.itemID, 0);
    if (itemID <= 0) {
      continue;
    }
    planetMetaCache.set(itemID, {
      solarSystemID: toInt(row.solarSystemID, 0),
      typeID: toInt(row.typeID, 0),
      celestialIndex: toInt(row.celestialIndex, 0),
    });
  }

  return planetMetaCache;
}

function buildPlanetEntry(entry = {}) {
  const planetID = toInt(entry.planetID ?? entry.itemID ?? entry.id, 0);
  if (planetID <= 0) {
    return null;
  }

  const staticMeta = getPlanetMetaByID().get(planetID) || {};
  const pins = Array.isArray(entry.pins) ? entry.pins : [];

  return buildKeyVal([
    ["planetID", planetID],
    [
      "solarSystemID",
      toInt(entry.solarSystemID ?? entry.systemID, staticMeta.solarSystemID || 0),
    ],
    ["typeID", toInt(entry.typeID ?? entry.planetTypeID, staticMeta.typeID || 0)],
    [
      "numberOfPins",
      toInt(entry.numberOfPins ?? entry.pinCount, pins.length),
    ],
    [
      "celestialIndex",
      toInt(entry.celestialIndex, staticMeta.celestialIndex || 0),
    ],
    [
      "commandCenterLevel",
      toInt(
        entry.commandCenterLevel ??
          entry.colonyLevel ??
          entry.commandCenterUpgradeLevel,
        0,
      ),
    ],
  ]);
}

function buildPlanetListForCharacter(characterRecord = {}) {
  return buildList(
    getCharacterColonies(characterRecord)
      .map((entry) => buildPlanetEntry(entry))
      .filter(Boolean),
  );
}

class PlanetMgrService extends BaseService {
  constructor() {
    super("planetMgr");
  }

  Handle_GetPlanetsForChar(args, session) {
    log.debug("[PlanetMgr] GetPlanetsForChar");
    const characterRecord = getCharacterRecord(session && session.characterID);
    return buildPlanetListForCharacter(characterRecord || {});
  }
}

PlanetMgrService._testing = {
  buildPlanetEntry,
  buildPlanetListForCharacter,
  getCharacterColonies,
};

module.exports = PlanetMgrService;
