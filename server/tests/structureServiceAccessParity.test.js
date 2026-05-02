const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const MarketProxyService = require(path.join(
  repoRoot,
  "server/src/services/market/marketProxyService",
));
const {
  getStationConstellationID,
  getStationRegionID,
  getStationSolarSystemID,
} = require(path.join(repoRoot, "server/src/services/market/marketTopology"));
const {
  buildStationServiceMask,
  getStationServiceStates,
} = require(path.join(repoRoot, "server/src/services/_shared/stationStaticData"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  hasStructureServiceAtLocation,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureServiceAccess",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const { isMachoWrappedException } = require(path.join(
  repoRoot,
  "server/src/common/machoErrors",
));

const STATION_SERVICE_MARKET = 16384;
const STATION_SERVICE_FITTING = 65536;
const TEST_CHARACTER_ID = 140000001;
const TEST_CORPORATION_ID = 1000009;
const TEST_SOLAR_SYSTEM_ID = 30000142;
const TEST_CONSTELLATION_ID = 20000020;
const TEST_REGION_ID = 10000002;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    structures: cloneValue(database.read("structures", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("structures", "/", cloneValue(snapshot.structures));
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.flushAllSync();
  structureState.clearStructureCaches();
}

function createAstrahus() {
  structureState.clearStructureCaches();
  const createResult = structureState.createStructure({
    typeID: 35832,
    name: `Structure Service Access Test ${Date.now()}`,
    itemName: "Structure Service Access Test",
    ownerCorpID: TEST_CORPORATION_ID,
    solarSystemID: TEST_SOLAR_SYSTEM_ID,
    constellationID: TEST_CONSTELLATION_ID,
    regionID: TEST_REGION_ID,
    state: 110,
    upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
    hasQuantumCore: true,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
  });
  assert.equal(createResult.success, true);
  return createResult.data;
}

function buildStructureSession(structureID) {
  return {
    characterID: TEST_CHARACTER_ID,
    charid: TEST_CHARACTER_ID,
    corporationID: TEST_CORPORATION_ID,
    corpid: TEST_CORPORATION_ID,
    stationID: structureID,
    stationid: structureID,
    structureID,
    structureid: structureID,
    locationid: structureID,
  };
}

function readStationServiceState(rows, stationServiceID) {
  return rows.find((row) => Number(row && row.serviceID) === stationServiceID) || null;
}

function getUserErrorText(error) {
  return (
    error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1]) &&
    error.machoErrorResponse.payload.header[1][1] &&
    error.machoErrorResponse.payload.header[1][1].entries &&
    error.machoErrorResponse.payload.header[1][1].entries.find((entry) => entry[0] === "notify") &&
    error.machoErrorResponse.payload.header[1][1].entries.find((entry) => entry[0] === "notify")[1]
  ) || "";
}

test("station service rows and masks reflect reconciled structure services", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));

  const structure = createAstrahus();
  const session = buildStructureSession(structure.structureID);
  const initialRows = getStationServiceStates(session, structure.structureID);
  assert.equal(
    readStationServiceState(initialRows, STATION_SERVICE_MARKET).isEnabled,
    0,
    "Market should stay disabled until the structure Market service is online",
  );
  assert.equal(
    readStationServiceState(initialRows, STATION_SERVICE_FITTING).isEnabled,
    1,
    "Core fitting service should remain enabled",
  );
  assert.equal(
    (buildStationServiceMask(session, structure.structureID) & STATION_SERVICE_MARKET) !== 0,
    false,
    "Station service bitmask should not expose an offline structure Market service",
  );

  const updateResult = structureState.updateStructureRecord(structure.structureID, (current) => ({
    ...current,
    serviceStates: {
      ...(current.serviceStates || {}),
      [String(STRUCTURE_SERVICE_ID.MARKET)]: STRUCTURE_SERVICE_STATE.ONLINE,
    },
  }));
  assert.equal(updateResult.success, true);

  const onlineRows = getStationServiceStates(session, structure.structureID);
  assert.equal(readStationServiceState(onlineRows, STATION_SERVICE_MARKET).isEnabled, 1);
  assert.equal(
    (buildStationServiceMask(session, structure.structureID) & STATION_SERVICE_MARKET) !== 0,
    true,
    "Station service bitmask should use the legacy Market bit for structure payloads",
  );
});

test("market topology and access helpers resolve player structure locations", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));

  const structure = createAstrahus();
  const session = buildStructureSession(structure.structureID);

  assert.equal(getStationSolarSystemID(structure.structureID), TEST_SOLAR_SYSTEM_ID);
  assert.equal(getStationConstellationID(structure.structureID), TEST_CONSTELLATION_ID);
  assert.equal(getStationRegionID(structure.structureID), TEST_REGION_ID);
  assert.equal(
    hasStructureServiceAtLocation(
      session,
      structure.structureID,
      STRUCTURE_SERVICE_ID.MARKET,
    ),
    false,
  );
});

test("station market calls stop before daemon access when a structure Market service is offline", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));

  const structure = createAstrahus();
  const session = buildStructureSession(structure.structureID);

  assert.throws(
    () => MarketProxyService.__testHooks.ensureMarketServiceAvailable(
      session,
      structure.structureID,
    ),
    (error) => {
      assert.equal(isMachoWrappedException(error), true);
      assert.equal(
        getUserErrorText(error),
        "The Market service is not available at this structure.",
      );
      return true;
    },
  );
});
