const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const { setupNewDatabaseSandbox } = require("./helpers/newDatabaseSandbox");
setupNewDatabaseSandbox("evejs-structure-inv-broker-");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));
const {
  ITEM_FLAGS,
  buildInventoryItem,
  grantItemToCharacterLocation,
  grantItemToOwnerLocation,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  STRUCTURE_DEED_FLAG,
  STRUCTURE_FUEL_FLAG,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureInventoryFlags",
));

const CONTAINER_HANGAR_ID = 10004;
const CONTAINER_STRUCTURE_ID = 10014;
const ASTRAHUS_CORE_TYPE_ID = 56201;

const originalGetStructureByID = structureState.getStructureByID;

function buildSession() {
  return {
    clientID: 65450,
    characterID: 140000002,
    charid: 140000002,
    userid: 1,
    structureID: 1030000000000,
    structureid: 1030000000000,
    locationid: 1030000000000,
    solarsystemid: 30002187,
    solarsystemid2: 30002187,
    currentBoundObjectID: null,
    socket: { destroyed: false },
    sendNotification() {},
  };
}

function buildNpcStationSession() {
  return {
    clientID: 65450,
    characterID: 140000002,
    charid: 140000002,
    userid: 1,
    stationID: 60003760,
    stationid: 60003760,
    locationid: 60003760,
    solarsystemid: 30002187,
    solarsystemid2: 30002187,
    currentBoundObjectID: null,
    socket: { destroyed: false },
    sendNotification() {},
  };
}

function buildStructure() {
  return {
    structureID: 1030000000000,
    typeID: 35832,
    ownerCorpID: 1000044,
    ownerID: 1000044,
    itemName: "Test Astrahus",
    solarSystemID: 30002187,
  };
}

function extractBoundID(boundValue) {
  return (
    boundValue &&
    boundValue.type === "substruct" &&
    boundValue.value &&
    boundValue.value.type === "substream" &&
    Array.isArray(boundValue.value.value)
      ? boundValue.value.value[0]
      : null
  );
}

function getBoundContext(service, boundValue) {
  const boundID = extractBoundID(boundValue);
  assert.ok(boundID, "Expected bound inventory ID");
  return service._boundContexts.get(boundID);
}

function toEntryMap(keyVal) {
  assert.equal(keyVal && keyVal.name, "util.KeyVal");
  return new Map((keyVal.args && keyVal.args.entries) || []);
}

function getPackedRowFields(rowset) {
  return (rowset && rowset.type === "list" && Array.isArray(rowset.items)
    ? rowset.items
    : [])
    .map((row) => row && row.fields)
    .filter(Boolean);
}

function getOnItemChangeNotifications(notifications) {
  return notifications.filter(
    (notification) => notification.eventName === "OnItemChange",
  );
}

function getOnItemChangeFields(notification) {
  return notification &&
    Array.isArray(notification.payload) &&
    notification.payload[0] &&
    notification.payload[0].fields
    ? notification.payload[0].fields
    : {};
}

function getOnItemChangeEntries(notification) {
  const changeDict = notification &&
    Array.isArray(notification.payload)
    ? notification.payload[1]
    : null;
  return new Map(
    changeDict && changeDict.type === "dict" && Array.isArray(changeDict.entries)
      ? changeDict.entries
      : [],
  );
}

function bindStructureInventory(service, session, structureID) {
  const bound = service.Handle_GetInventoryFromId([structureID], session, {
    locationID: structureID,
  });
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected structure inventory bind");
  session.currentBoundObjectID = boundID;
  return service._boundContexts.get(boundID);
}

function seedStaleSelfParentedStructureInventoryRow(structure) {
  const readResult = database.read("items", "/");
  const items = readResult.success && readResult.data ? readResult.data : {};
  items[String(structure.structureID)] = buildInventoryItem({
    itemID: structure.structureID,
    typeID: structure.typeID,
    ownerID: structure.ownerCorpID,
    locationID: structure.structureID,
    flagID: 0,
    itemName: structure.itemName,
    quantity: 1,
    singleton: 1,
    stacksize: 1,
  });
  database.write("items", "/", items);
  database.flushAllSync();
  resetInventoryStoreForTests();
}

function walkCachedParents(cachedItems, startLocationID) {
  const seen = new Set();
  let parent = cachedItems.get(Number(startLocationID));
  while (parent) {
    const parentItemID = Number(parent.itemID) || 0;
    const parentLocationID = Number(parent.locationID) || 0;
    if (seen.has(parentItemID) || parentItemID === parentLocationID) {
      return {
        loop: true,
        parent,
      };
    }
    seen.add(parentItemID);
    parent = cachedItems.get(parentLocationID);
  }
  return {
    loop: false,
    seen,
  };
}

test.afterEach(() => {
  structureState.getStructureByID = originalGetStructureByID;
  database.write("items", "/", {});
  database.flushAllSync();
  resetInventoryStoreForTests();
});

test("structure-docked inventory bindings expose the real structure item parented to the solar system", () => {
  const session = buildSession();
  const structure = buildStructure();
  const structureType = resolveItemByTypeID(structure.typeID);
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  for (const containerID of [CONTAINER_HANGAR_ID, CONTAINER_STRUCTURE_ID]) {
    const bound = service.Handle_GetInventory([containerID], session);
    const boundID = extractBoundID(bound);
    assert.ok(boundID, `Expected bound inventory ID for container ${containerID}`);
    session.currentBoundObjectID = boundID;
    const boundContext = service._boundContexts.get(boundID);
    assert.equal(boundContext.kind, "structureInventory");
    assert.equal(boundContext.inventoryID, structure.structureID);
    assert.equal(boundContext.locationID, structure.structureID);
    assert.equal(boundContext.flagID, null);

    const selfItem = toEntryMap(service.Handle_GetSelfInvItem([], session));

    assert.equal(selfItem.get("itemID"), structure.structureID);
    assert.equal(selfItem.get("typeID"), structure.typeID);
    assert.equal(selfItem.get("ownerID"), structure.ownerCorpID);
    assert.equal(selfItem.get("locationID"), structure.solarSystemID);
    assert.notEqual(selfItem.get("locationID"), structure.structureID);
    assert.equal(selfItem.get("groupID"), structureType.groupID);
    assert.equal(selfItem.get("categoryID"), structureType.categoryID);
    assert.equal(selfItem.get("singleton"), 1);
    assert.equal(selfItem.get("stacksize"), 1);
  }
});

test("GetInventoryFromId binds docked structures as structure inventory, not station hangars", () => {
  const session = buildSession();
  const structure = buildStructure();
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  const bound = service.Handle_GetInventoryFromId([structure.structureID], session);
  const boundContext = getBoundContext(service, bound);

  assert.equal(boundContext.kind, "structureInventory");
  assert.equal(boundContext.inventoryID, structure.structureID);
  assert.equal(boundContext.locationID, structure.structureID);
  assert.equal(boundContext.flagID, null);
});

test("known structure IDs never bind as generic containers from an NPC station context", () => {
  const session = buildNpcStationSession();
  const structure = buildStructure();
  const structureType = resolveItemByTypeID(structure.typeID);
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID) =>
    Number(structureID) === structure.structureID ? structure : null;

  const fuel = grantItemToOwnerLocation(
    structure.ownerCorpID,
    structure.structureID,
    STRUCTURE_FUEL_FLAG,
    4247,
    500,
    { singleton: 0 },
  ).data.items[0];
  resetInventoryStoreForTests();

  const bound = service.Handle_GetInventoryFromId(
    [structure.structureID, 0],
    session,
  );
  const boundContext = getBoundContext(service, bound);
  assert.equal(boundContext.kind, "structureInventory");
  assert.equal(boundContext.inventoryID, structure.structureID);
  assert.equal(boundContext.locationID, structure.structureID);
  assert.equal(boundContext.flagID, null);

  session.currentBoundObjectID = extractBoundID(bound);
  const selfItem = toEntryMap(service.Handle_GetSelfInvItem([], session));
  assert.equal(selfItem.get("itemID"), structure.structureID);
  assert.equal(selfItem.get("typeID"), structure.typeID);
  assert.equal(selfItem.get("ownerID"), structure.ownerCorpID);
  assert.equal(selfItem.get("locationID"), structure.solarSystemID);
  assert.notEqual(selfItem.get("locationID"), structure.structureID);
  assert.equal(selfItem.get("groupID"), structureType.groupID);
  assert.equal(selfItem.get("categoryID"), structureType.categoryID);

  const getItemRow = new Map(
    service.Handle_GetItem([structure.structureID], session).args.entries,
  ).get("line");
  assert.equal(getItemRow[0], structure.structureID);
  assert.equal(getItemRow[1], structure.typeID);
  assert.equal(getItemRow[2], structure.ownerCorpID);
  assert.equal(getItemRow[3], structure.solarSystemID);
  assert.notEqual(getItemRow[3], session.stationID);

  const fuelRows = getPackedRowFields(
    service.Handle_List([STRUCTURE_FUEL_FLAG], session, {}),
  );
  assert.deepEqual(
    fuelRows.map((row) => Number(row.itemID)),
    [fuel.itemID],
    "Expected fuel bay listing to use the structure-owner inventory, not the NPC station container shim",
  );
});

test("GetItem on the docked structure ID returns a structure-shaped inventory row instead of a station shim", () => {
  const session = buildSession();
  const structure = buildStructure();
  const structureType = resolveItemByTypeID(structure.typeID);
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  const result = service.Handle_GetItem([structure.structureID], session);
  const entries = new Map(result.args.entries);
  const row = entries.get("line");

  assert.equal(row[0], structure.structureID);
  assert.equal(row[1], structure.typeID);
  assert.equal(row[2], structure.ownerCorpID);
  assert.equal(row[3], structure.solarSystemID);
  assert.notEqual(row[3], structure.structureID);
  assert.equal(row[6], structureType.groupID);
  assert.equal(row[7], structureType.categoryID);
});

test("structure inventory packed rows marshal when the docked locationID exceeds int32", () => {
  const session = buildSession();
  const structure = buildStructure();
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  const packedRows = service._buildInventoryRemoteList([
    service._buildStructureItemOverrides(session),
    service._buildInventoryItemOverrides(session, {
      itemID: 990112614,
      typeID: 621,
      ownerID: session.characterID,
      locationID: structure.structureID,
      flagID: 4,
      quantity: -1,
      groupID: 25,
      categoryID: 6,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    }),
  ]);

  assert.doesNotThrow(
    () => marshalEncode(packedRows),
    "Expected structure-docked inventory packed rows to marshal large locationIDs safely",
  );
});

test("structure inventory bootstrap cannot cache a self-parented structure row during core drag", () => {
  const session = buildSession();
  const structure = buildStructure();
  const service = new InvBrokerService();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  seedStaleSelfParentedStructureInventoryRow(structure);
  const personalCore = grantItemToCharacterLocation(
    session.characterID,
    structure.structureID,
    ITEM_FLAGS.HANGAR,
    ASTRAHUS_CORE_TYPE_ID,
    1,
    { singleton: 0 },
  ).data.items[0];
  const installedCore = grantItemToOwnerLocation(
    structure.ownerCorpID,
    structure.structureID,
    STRUCTURE_DEED_FLAG,
    ASTRAHUS_CORE_TYPE_ID,
    1,
    { singleton: 0 },
  ).data.items[0];
  resetInventoryStoreForTests();

  bindStructureInventory(service, session, structure.structureID);
  const selfItem = toEntryMap(service.Handle_GetSelfInvItem([], session));
  assert.equal(selfItem.get("itemID"), structure.structureID);
  assert.equal(selfItem.get("locationID"), structure.solarSystemID);
  assert.notEqual(selfItem.get("locationID"), structure.structureID);

  const getItemRow = new Map(
    service.Handle_GetItem([structure.structureID], session).args.entries,
  ).get("line");
  assert.equal(getItemRow[0], structure.structureID);
  assert.equal(getItemRow[3], structure.solarSystemID);
  assert.notEqual(getItemRow[3], structure.structureID);

  const hangarBootstrapRows = getPackedRowFields(
    service.Handle_List([ITEM_FLAGS.HANGAR], session, {}),
  );
  const deedRows = getPackedRowFields(
    service.Handle_List([STRUCTURE_DEED_FLAG], session, {}),
  );
  const cachedRows = [...hangarBootstrapRows, ...deedRows];

  assert.equal(
    cachedRows.some(
      (row) =>
        Number(row.itemID) === structure.structureID &&
        Number(row.locationID) === structure.structureID,
    ),
    false,
    "Expected no List response to cache a self-parented structure row",
  );
  assert.equal(
    hangarBootstrapRows.some((row) => Number(row.itemID) === personalCore.itemID),
    true,
    "Expected flag 4 bootstrap to include the personal core source item",
  );
  assert.equal(
    hangarBootstrapRows.some((row) => Number(row.itemID) === installedCore.itemID),
    true,
    "Expected flag 4 bootstrap to preload structure bay rows for the client cache",
  );
  assert.deepEqual(
    deedRows.map((row) => Number(row.itemID)),
    [installedCore.itemID],
    "Expected explicit Core Room listing to stay deed-bay filtered",
  );
  assert.deepEqual(
    hangarBootstrapRows
      .filter(
        (row) =>
          Number(row.flagID) === ITEM_FLAGS.HANGAR &&
          Number(row.ownerID) === session.characterID,
      )
      .map((row) => Number(row.itemID)),
    [personalCore.itemID],
    "Expected client-side Structure Item Hangar filtering to keep showing personal rows",
  );

  const cachedItems = new Map(cachedRows.map((row) => [Number(row.itemID), row]));
  const parentWalk = walkCachedParents(cachedItems, personalCore.locationID);
  assert.equal(parentWalk.loop, false, "Expected cached parent walk to terminate");
});

test("structure special bay listing emits a self-cache repair before client move preflight", () => {
  const notifications = [];
  const session = buildSession();
  const structure = buildStructure();
  const service = new InvBrokerService();
  session.sendNotification = (eventName, target, payload) => {
    notifications.push({ eventName, target, payload });
  };

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  bindStructureInventory(service, session, structure.structureID);
  notifications.length = 0;

  const fuelRows = getPackedRowFields(
    service.Handle_List([STRUCTURE_FUEL_FLAG], session, {}),
  );
  assert.deepEqual(fuelRows, []);

  const itemChanges = getOnItemChangeNotifications(notifications);
  assert.equal(itemChanges.length, 1);
  const fields = getOnItemChangeFields(itemChanges[0]);
  const changes = getOnItemChangeEntries(itemChanges[0]);

  assert.equal(fields.itemID, structure.structureID);
  assert.equal(fields.locationID, structure.solarSystemID);
  assert.notEqual(fields.locationID, structure.structureID);
  assert.equal(fields.flagID, 0);
  assert.equal(changes.get(3), structure.structureID);
});
