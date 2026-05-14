const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { setupNewDatabaseSandbox } = require("./helpers/newDatabaseSandbox");
setupNewDatabaseSandbox("evejs-structure-services-db-");

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
  getAttributeIDByNames,
  isShipFittingFlag,
  isStructureServiceFlag,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  ATTRIBUTE_UPGRADE_SLOTS_LEFT,
  primeStructureDogmaItemForSession,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDogmaPrime",
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

function getKeyValEntry(keyVal, key) {
  return keyVal &&
    keyVal.args &&
    keyVal.args.type === "dict" &&
    Array.isArray(keyVal.args.entries)
    ? new Map(keyVal.args.entries).get(key)
    : undefined;
}

function getDogmaInfoAttributes(entry) {
  const fields = getKeyValEntry(entry, "attributes");
  return fields && fields.type === "dict" && Array.isArray(fields.entries)
    ? new Map(fields.entries)
    : new Map();
}

function getPackedRowFields(rowset) {
  return (rowset && rowset.type === "list" && Array.isArray(rowset.items)
    ? rowset.items
    : [])
    .map((row) => row && row.fields)
    .filter(Boolean);
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

function getWrappedUserErrorDict(error) {
  const dictHeader = error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
      ? error.machoErrorResponse.payload.header[1][1]
      : null;
  return dictHeader && Array.isArray(dictHeader.entries)
    ? Object.fromEntries(dictHeader.entries)
    : {};
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

test("controlled-structure auto-fit places service modules into service slots", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, corporationID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);

  const movedModuleID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 0 },
  );

  const fittedModule = findItemById(Number(movedModuleID) || marketModule.itemID);
  assert.equal(Number(fittedModule && fittedModule.ownerID), corporationID);
  assert.equal(Number(fittedModule && fittedModule.locationID), structureID);
  assert.equal(Number(fittedModule && fittedModule.flagID), 164);
  assert.equal(
    listContainerItems(characterID, structureID, ITEM_FLAGS.HANGAR)
      .some((item) => Number(item.itemID) === Number(fittedModule.itemID)),
    false,
    "Auto-fitted service module should leave the personal hangar",
  );
});

test("controlled-structure fitting rejects duplicate concrete service modules", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const firstMarketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);
  const secondMarketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);
  const firstModuleID = invbroker.Handle_Add(
    [firstMarketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  assert.ok(Number(firstModuleID) > 0, "Expected first market service module to fit");

  const duplicateModuleID = invbroker.Handle_Add(
    [secondMarketModule.itemID, structureID],
    session,
    { flag: 165 },
  );
  assert.equal(duplicateModuleID, null);

  const duplicateModule = findItemById(secondMarketModule.itemID);
  assert.equal(Number(duplicateModule && duplicateModule.flagID), ITEM_FLAGS.HANGAR);
});

test("service module online fuel failures report required and available quantities", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);
  grantStructureItem(characterID, structureID, STRUCTURE_FUEL_FLAG, 4246, 500);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);
  const movedModuleID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const fittedModule = findItemById(Number(movedModuleID) || marketModule.itemID);
  const dogma = new DogmaService();

  let thrown = null;
  try {
    dogma.Handle_SetModuleOnline([structureID, fittedModule.itemID], session);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "Expected insufficient structure fuel to throw");
  const wrappedDict = getWrappedUserErrorDict(thrown);
  assert.match(String(wrappedDict.notify || ""), /Required: 2880; available: 500/);
  const stillOfflineModule = findItemById(fittedModule.itemID);
  assert.equal(Boolean(stillOfflineModule && stillOfflineModule.moduleState && stillOfflineModule.moduleState.online), false);
});

test("controlled-structure base service slot request uses next free service slot", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, corporationID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);
  const cloneModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35894, 1);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);

  const fittedMarketID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const fittedCloneID = invbroker.Handle_Add(
    [cloneModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const fittedMarket = findItemById(Number(fittedMarketID) || marketModule.itemID);
  const fittedClone = findItemById(Number(fittedCloneID) || cloneModule.itemID);

  assert.equal(Number(fittedMarket && fittedMarket.ownerID), corporationID);
  assert.equal(Number(fittedMarket && fittedMarket.flagID), 164);
  assert.equal(Number(fittedClone && fittedClone.ownerID), corporationID);
  assert.equal(Number(fittedClone && fittedClone.flagID), 165);
  assert.deepEqual(
    structureServiceModules
      .listStructureServiceModules(structureID)
      .map((item) => Number(item.flagID)),
    [164, 165],
  );
});

test("controlled-structure GetAllInfo advertises slot attributes and fitted service modules", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);
  const movedModuleID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const fittedModuleID = Number(movedModuleID) || marketModule.itemID;

  const dogma = new DogmaService();
  const allInfo = dogma.Handle_GetAllInfo([false, true, true], session);
  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  assert.ok(
    shipInfo && shipInfo.type === "dict" && Array.isArray(shipInfo.entries),
    "Expected controlled structure shipInfo dogma bootstrap",
  );

  const structureEntry = shipInfo.entries.find(
    ([itemID]) => Number(itemID) === Number(structureID),
  );
  assert.ok(structureEntry, "Expected structure self row in shipInfo");
  const structureAttributes = getDogmaInfoAttributes(structureEntry[1]);
  assert.equal(structureAttributes.get(2056), 3, "Expected Astrahus service slot count");
  assert.equal(structureAttributes.get(14), 4, "Expected structure high slots");
  assert.equal(structureAttributes.get(13), 4, "Expected structure medium slots");
  assert.equal(structureAttributes.get(12), 3, "Expected structure low slots");
  assert.equal(structureAttributes.get(1137), 3, "Expected structure rig slots");
  assert.equal(getAttributeIDByNames("upgradeLoad"), 1152);
  for (const attributeID of [11, 15, 48, 49, 1132, 1152]) {
    assert.equal(
      typeof structureAttributes.get(attributeID),
      "number",
      `Expected numeric controlled-structure fitting resource attribute ${attributeID}`,
    );
  }
  assert.equal(structureAttributes.get(15), 0, "Offline service module should not consume powergrid");
  assert.equal(structureAttributes.get(49), 0, "Offline service module should not consume CPU");
  assert.equal(structureAttributes.get(1152), 0, "Service module should not consume calibration");

  const moduleEntry = shipInfo.entries.find(
    ([itemID]) => Number(itemID) === Number(fittedModuleID),
  );
  assert.ok(moduleEntry, "Expected fitted service module row in shipInfo");
  const moduleInvItem = getKeyValEntry(moduleEntry[1], "invItem");
  const moduleLine = getKeyValEntry(moduleInvItem, "line");
  assert.equal(Number(moduleLine && moduleLine[3]), Number(structureID));
  assert.equal(Number(moduleLine && moduleLine[4]), 164);

  const shipState = getKeyValEntry(allInfo, "shipState");
  const shipStateEntries =
    Array.isArray(shipState) &&
    shipState[0] &&
    shipState[0].type === "dict" &&
    Array.isArray(shipState[0].entries)
      ? shipState[0].entries
      : [];
  assert.ok(
    shipStateEntries.some(([itemID]) => Number(itemID) === Number(fittedModuleID)),
    "Expected structure service module status row in shipState",
  );
});

test("controlled-structure dogma resource loads include online service modules", (t) => {
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
  const fittedModuleID = Number(movedModuleID) || marketModule.itemID;

  const dogma = new DogmaService();
  dogma.Handle_SetModuleOnline([structureID, fittedModuleID], session);

  assert.ok(
    session.notifications.some(
      (notification) => notification && notification.name === "OnGodmaPrimeItem",
    ),
    "Expected service module online changes to re-prime structure dogma",
  );

  const allInfo = dogma.Handle_GetAllInfo([false, true, true], session);
  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const structureEntry = shipInfo.entries.find(
    ([itemID]) => Number(itemID) === Number(structureID),
  );
  assert.ok(structureEntry, "Expected structure self row in shipInfo");

  const structureAttributes = getDogmaInfoAttributes(structureEntry[1]);
  assert.equal(structureAttributes.get(15), 100000, "Expected online market hub powergrid load");
  assert.equal(structureAttributes.get(49), 1200, "Expected online market hub CPU load");
  assert.equal(structureAttributes.get(1152), 0, "Expected upgradeLoad to use client dogma attribute 1152");
});

test("controlled-structure inventory list exposes fitted service modules for client dogma loading", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, corporationID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);
  const movedModuleID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const fittedModuleID = Number(movedModuleID) || marketModule.itemID;

  session.notifications = [];
  session._structureInventoryFittingRefreshDelaysMs = [0];
  const listRows = getPackedRowFields(invbroker.Handle_List([], session, {}));
  const moduleRow = listRows.find(
    (row) => Number(row && row.itemID) === Number(fittedModuleID),
  );

  assert.ok(moduleRow, "Expected structure inventory List to include the fitted service module");
  assert.equal(Number(moduleRow.ownerID), corporationID);
  assert.equal(Number(moduleRow.locationID), structureID);
  assert.equal(Number(moduleRow.flagID), 164);
  assert.equal(Number(moduleRow.categoryID), 66);
  assert.equal(Number(moduleRow.singleton), 1);
  assert.ok(
    session.notifications.some(
      (notification) => notification && notification.name === "OnModuleAttributeChanges",
    ),
    "Expected structure inventory List to refresh fitting gauges after the fitting window opens",
  );
  assert.ok(
    session.notifications.some(
      (notification) => notification && notification.name === "OnDogmaAttributeChanged",
    ),
    "Expected structure inventory List to trigger fitting stats refresh",
  );
});

test("controlled-structure dogma prime includes fitted service modules", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, corporationID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);
  const movedModuleID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const fittedModuleID = Number(movedModuleID) || marketModule.itemID;

  session.notifications = [];
  assert.equal(
    primeStructureDogmaItemForSession(session, structure, { reason: "test" }),
    true,
  );

  const primeNotifications = session.notifications.filter(
    (notification) => notification && notification.name === "OnGodmaPrimeItem",
  );
  assert.equal(primeNotifications.length, 2);
  const statsRefresh = session.notifications.find(
    (notification) => notification && notification.name === "OnDogmaAttributeChanged",
  );
  assert.ok(statsRefresh, "Expected structure dogma prime to trigger fitting stats refresh");
  assert.deepEqual(statsRefresh.payload, [
    structureID,
    structureID,
    ATTRIBUTE_UPGRADE_SLOTS_LEFT,
    3,
  ]);
  const modulePrime = primeNotifications.find((notification) => {
    const fields = new Map(notification.payload[1].args.entries);
    return Number(fields.get("itemID")) === Number(fittedModuleID);
  });
  assert.ok(modulePrime, "Expected fitted service module to be dogma-primed");
  assert.equal(Number(modulePrime.payload[0]), Number(structureID));

  const moduleFields = new Map(modulePrime.payload[1].args.entries);
  const moduleInvItem = moduleFields.get("invItem");
  const moduleLine = getKeyValEntry(moduleInvItem, "line");
  assert.equal(Number(moduleLine && moduleLine[2]), corporationID);
  assert.equal(Number(moduleLine && moduleLine[3]), structureID);
  assert.equal(Number(moduleLine && moduleLine[4]), 164);
  assert.equal(Number(moduleLine && moduleLine[7]), 66);

  const moduleAttributes = getDogmaInfoAttributes(modulePrime.payload[1]);
  assert.equal(moduleAttributes.get(30), 100000);
  assert.equal(moduleAttributes.get(50), 1200);
});

test("controlled-structure ItemGetInfo resolves corp-owned fitted service modules", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, corporationID, structure, session } = createAstrahus();
  const structureID = structure.structureID;
  const marketModule = grantStructureItem(characterID, structureID, ITEM_FLAGS.HANGAR, 35892, 1);

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structureID);
  const movedModuleID = invbroker.Handle_Add(
    [marketModule.itemID, structureID],
    session,
    { flag: 164 },
  );
  const fittedModuleID = Number(movedModuleID) || marketModule.itemID;

  const dogma = new DogmaService();
  const itemInfo = dogma.Handle_ItemGetInfo([fittedModuleID], session);
  const itemInfoFields = new Map(itemInfo.args.entries);
  const invItem = itemInfoFields.get("invItem");
  const line = getKeyValEntry(invItem, "line");

  assert.equal(Number(itemInfoFields.get("itemID")), Number(fittedModuleID));
  assert.equal(Number(line && line[0]), Number(fittedModuleID));
  assert.equal(Number(line && line[2]), corporationID);
  assert.equal(Number(line && line[3]), structureID);
  assert.equal(Number(line && line[4]), 164);
  assert.equal(Number(line && line[7]), 66);
  assert.equal(Number(line && line[10]), 1);
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
