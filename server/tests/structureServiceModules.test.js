const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const StructureControlService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureControlService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const structureServiceModules = require(path.join(
  repoRoot,
  "server/src/services/structure/structureServiceModules",
));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  listContainerItems,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  STRUCTURE_FUEL_FLAG,
  isShipFittingFlag,
  isStructureServiceFlag,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    structures: cloneValue(database.read("structures", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("structures", "/", cloneValue(snapshot.structures));
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.flushAllSync();
  structureState.clearStructureCaches();
  resetInventoryStoreForTests();
}

function buildStructureSession(characterID, corporationID, structureID) {
  return {
    clientID: characterID + 810000,
    userid: characterID,
    characterID,
    charid: characterID,
    corporationID,
    corpid: corporationID,
    stationID: structureID,
    stationid: structureID,
    structureID,
    structureid: structureID,
    shipID: structureID,
    shipid: structureID,
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function extractBoundID(value) {
  return (
    value &&
    value.type === "substruct" &&
    value.value &&
    value.value.type === "substream" &&
    Array.isArray(value.value.value)
      ? value.value.value[0]
      : null
  );
}

function bindStructureInventory(service, session, structureID) {
  const bound = service.Handle_GetInventoryFromId(
    [structureID],
    session,
    { locationID: structureID },
  );
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected structure inventory bind to succeed");
  session.currentBoundObjectID = boundID;
}

function createAstrahus(characterID = 140000001, corporationID = 1000009) {
  structureState.clearStructureCaches();
  const createResult = structureState.createStructure({
    typeID: 35832,
    name: `Service Module Test Astrahus ${Date.now()}`,
    itemName: "Service Module Test Astrahus",
    ownerCorpID: corporationID,
    solarSystemID: 30000142,
    state: 110,
    upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
    hasQuantumCore: true,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
  });
  assert.equal(createResult.success, true, "Expected structure creation");
  return {
    characterID,
    corporationID,
    structure: createResult.data,
    session: buildStructureSession(characterID, corporationID, createResult.data.structureID),
  };
}

function grantStructureItem(characterID, structureID, flagID, typeID, quantity = 1) {
  const grantResult = grantItemToCharacterLocation(
    characterID,
    structureID,
    flagID,
    typeID,
    quantity,
  );
  assert.equal(grantResult.success, true, `Expected grant of ${typeID}`);
  const items = grantResult.data && grantResult.data.items;
  assert.ok(Array.isArray(items) && items.length > 0, "Expected granted item row");
  return items[0];
}

function getServiceState(structureID, serviceID) {
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  return Number(structure && structure.serviceStates && structure.serviceStates[String(serviceID)]) || 0;
}

test("structure service slots are distinct from ship fitting flags", () => {
  assert.equal(isShipFittingFlag(164), false);
  assert.equal(isStructureServiceFlag(164), true);
  assert.equal(STRUCTURE_FUEL_FLAG, 172);
  assert.deepEqual(
    structureServiceModules.getServiceIDsForModuleType(35892),
    [STRUCTURE_SERVICE_ID.MARKET],
  );
});

test("service module fit, online fuel, service reconciliation, offline, and unfit", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, corporationID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);
  grantStructureItem(characterID, structureID, STRUCTURE_FUEL_FLAG, 4246, 3000);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);

  const movedModuleID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const fittedModule = findItemById(Number(movedModuleID) || marketModule.itemID);
  assert.equal(Number(fittedModule && fittedModule.flagID), 164);
  assert.equal(Boolean(fittedModule && fittedModule.moduleState && fittedModule.moduleState.online), false);
  assert.equal(
    getServiceState(structureID, STRUCTURE_SERVICE_ID.MARKET),
    STRUCTURE_SERVICE_STATE.OFFLINE,
    "Fitted service modules should stay offline until dogma onlines them",
  );

  const dogma = new DogmaService();
  dogma.Handle_SetModuleOnline([structureID, fittedModule.itemID], session);
  const onlineModule = findItemById(fittedModule.itemID);
  assert.equal(Boolean(onlineModule && onlineModule.moduleState && onlineModule.moduleState.online), true);
  assert.equal(
    getServiceState(structureID, STRUCTURE_SERVICE_ID.MARKET),
    STRUCTURE_SERVICE_STATE.ONLINE,
  );
  assert.equal(
    Number(structureState.getStructureByID(structureID, { refresh: false }).upkeepState),
    STRUCTURE_UPKEEP_STATE.FULL_POWER,
  );
  assert.equal(
    listContainerItems(null, structureID, STRUCTURE_FUEL_FLAG)
      .reduce((sum, item) => sum + Number(item.stacksize ?? item.quantity ?? 0), 0),
    120,
    "Onlining a market hub should consume 2880 fuel blocks",
  );

  const control = new StructureControlService();
  assert.equal(control.Handle_CheckCanDisableServiceModule([onlineModule], session), true);
  dogma.Handle_TakeModuleOffline([structureID, onlineModule.itemID], session);
  assert.equal(
    getServiceState(structureID, STRUCTURE_SERVICE_ID.MARKET),
    STRUCTURE_SERVICE_STATE.OFFLINE,
  );
  assert.equal(
    getServiceState(structureID, STRUCTURE_SERVICE_ID.DOCKING),
    STRUCTURE_SERVICE_STATE.ONLINE,
    "Core structure services should remain online",
  );

  invbroker.Handle_Add([onlineModule.itemID, structureID], session, { flag: ITEM_FLAGS.HANGAR });
  const unfittedModule = findItemById(onlineModule.itemID);
  assert.equal(Number(unfittedModule && unfittedModule.flagID), ITEM_FLAGS.HANGAR);
});

test("structure fuel bay rejects non-fuel items", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const tritanium = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 34, 1);
  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);

  const moveResult = invbroker.Handle_Add(
    [tritanium.itemID, structureID],
    session,
    { flag: STRUCTURE_FUEL_FLAG },
  );
  assert.equal(moveResult, null);
  const item = findItemById(tritanium.itemID);
  assert.equal(Number(item && item.flagID), ITEM_FLAGS.HANGAR);
});

test("structure fuel tick offlines service modules when fuel runs out", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);
  grantStructureItem(characterID, structureID, STRUCTURE_FUEL_FLAG, 4246, 3000);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);
  const movedModuleID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const moduleID = Number(movedModuleID) || marketModule.itemID;
  new DogmaService().Handle_SetModuleOnline([structureID, moduleID], session);

  const startedAt = Date.now();
  const primeResult = structureState.updateStructureRecord(structureID, (current) => ({
    ...current,
    serviceFuelLastTickAt: startedAt,
  }));
  assert.equal(primeResult.success, true);

  const tickResult = structureServiceModules.tickStructureServiceFuel(
    structureID,
    startedAt + (4 * 60 * 60 * 1000),
  );
  assert.equal(tickResult.success, true);
  const moduleAfterTick = findItemById(moduleID);
  assert.equal(Boolean(moduleAfterTick && moduleAfterTick.moduleState && moduleAfterTick.moduleState.online), false);
  assert.equal(
    getServiceState(structureID, STRUCTURE_SERVICE_ID.MARKET),
    STRUCTURE_SERVICE_STATE.OFFLINE,
  );
  assert.equal(
    Number(structureState.getStructureByID(structureID, { refresh: false }).upkeepState),
    STRUCTURE_UPKEEP_STATE.LOW_POWER,
  );
});
