const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  listContainerItems,
  grantItemToCharacterLocation,
  removeInventoryItem,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

function getDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      ) || 0;
      if (!characterRecord || stationID <= 0) {
        return null;
      }
      return { characterID, characterRecord, stationID };
    })
    .filter(Boolean);

  assert.ok(candidates.length > 0, "Expected at least one docked character");
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 83000,
    userid: candidate.characterID,
    socket: { destroyed: false },
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function bindStationHangar(service, session) {
  const bound = service.Handle_GetInventory([10004], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventory to return a bound station hangar");
  session.currentBoundObjectID = boundID;
}

test.afterEach(() => {
  resetInventoryStoreForTests();
});

test("TrashItems removes a single item from the station hangar", () => {
  resetInventoryStoreForTests();
  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    tritanium.match,
    10,
    { transient: true },
  );
  assert.equal(grantResult.success, true, "Expected temporary item grant to succeed");
  const sourceItem = grantResult.data.items[0];
  assert.ok(sourceItem && sourceItem.itemID, "Expected a granted item with an itemID");

  bindStationHangar(service, session);

  try {
    // Client passes: TrashItems(itemsToTrash, locationID)
    const result = service.Handle_TrashItems(
      [{ type: "list", items: [sourceItem.itemID] }, candidate.stationID],
      session,
    );

    assert.equal(result, null, "Expected TrashItems to return null (no errors)");

    const hangarItems = listContainerItems(
      candidate.characterID,
      candidate.stationID,
      ITEM_FLAGS.HANGAR,
    );
    assert.equal(
      hangarItems.some((item) => Number(item.itemID) === Number(sourceItem.itemID)),
      false,
      "Expected the trashed item to be removed from the station hangar",
    );
  } finally {
    removeInventoryItem(sourceItem.itemID, { removeContents: true });
    resetInventoryStoreForTests();
  }
});

test("TrashItems removes multiple items from the station hangar in a single call", () => {
  resetInventoryStoreForTests();
  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const tritanium = resolveItemByName("Tritanium");
  const pyerite = resolveItemByName("Pyerite");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");
  assert.equal(pyerite && pyerite.success, true, "Expected Pyerite metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const grantResult1 = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    tritanium.match,
    10,
    { transient: true },
  );
  const grantResult2 = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    pyerite.match,
    20,
    { transient: true },
  );
  assert.equal(grantResult1.success, true, "Expected first item grant to succeed");
  assert.equal(grantResult2.success, true, "Expected second item grant to succeed");
  const item1 = grantResult1.data.items[0];
  const item2 = grantResult2.data.items[0];
  assert.ok(item1 && item1.itemID, "Expected first granted item to have an itemID");
  assert.ok(item2 && item2.itemID, "Expected second granted item to have an itemID");

  bindStationHangar(service, session);

  try {
    const result = service.Handle_TrashItems(
      [
        { type: "list", items: [item1.itemID, item2.itemID] },
        candidate.stationID,
      ],
      session,
    );

    assert.equal(result, null, "Expected TrashItems to return null (no errors)");

    const hangarItems = listContainerItems(
      candidate.characterID,
      candidate.stationID,
      ITEM_FLAGS.HANGAR,
    );
    assert.equal(
      hangarItems.some((item) => Number(item.itemID) === Number(item1.itemID)),
      false,
      "Expected first trashed item to be removed from the station hangar",
    );
    assert.equal(
      hangarItems.some((item) => Number(item.itemID) === Number(item2.itemID)),
      false,
      "Expected second trashed item to be removed from the station hangar",
    );
  } finally {
    removeInventoryItem(item1.itemID, { removeContents: true });
    removeInventoryItem(item2.itemID, { removeContents: true });
    resetInventoryStoreForTests();
  }
});

test("TrashItems emits inventory change notifications for removed items", () => {
  resetInventoryStoreForTests();
  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();
  const tritanium = resolveItemByName("Tritanium");
  assert.equal(tritanium && tritanium.success, true, "Expected Tritanium metadata");

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const grantResult = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    tritanium.match,
    5,
    { transient: true },
  );
  assert.equal(grantResult.success, true);
  const sourceItem = grantResult.data.items[0];

  bindStationHangar(service, session);

  try {
    const notificationsBefore = session.notifications.length;

    service.Handle_TrashItems(
      [{ type: "list", items: [sourceItem.itemID] }, candidate.stationID],
      session,
    );

    assert.ok(
      session.notifications.length > notificationsBefore,
      "Expected TrashItems to emit at least one inventory change notification",
    );
  } finally {
    removeInventoryItem(sourceItem.itemID, { removeContents: true });
    resetInventoryStoreForTests();
  }
});

test("TrashItems with an unknown item ID returns null without throwing", () => {
  resetInventoryStoreForTests();
  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  bindStationHangar(service, session);

  const result = service.Handle_TrashItems(
    [{ type: "list", items: [9999999999] }, candidate.stationID],
    session,
  );

  assert.equal(result, null, "Expected TrashItems to return null for unknown item IDs");
});

test("TrashItems with an empty item list returns null without throwing", () => {
  resetInventoryStoreForTests();
  const candidate = getDockedCandidate();
  const session = buildSession(candidate);
  const service = new InvBrokerService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  bindStationHangar(service, session);

  const result = service.Handle_TrashItems(
    [{ type: "list", items: [] }, candidate.stationID],
    session,
  );

  assert.equal(result, null, "Expected TrashItems with empty list to return null");
});
