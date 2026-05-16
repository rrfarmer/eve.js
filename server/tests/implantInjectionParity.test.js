const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  grantCharacterSkillLevels,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));

const CYBERNETICS_TYPE_ID = 3411;
const MEMORY_AUGMENTATION_BASIC_TYPE_ID = 9941;
const MEMORY_AUGMENTATION_STANDARD_TYPE_ID = 10208;
const ATTRIBUTE_MEMORY = 166;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    characters: cloneValue(database.read("characters", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    skills: cloneValue(database.read("skills", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("characters", "/", cloneValue(snapshot.characters));
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.write("skills", "/", cloneValue(snapshot.skills));
  database.flushAllSync();
  resetInventoryStoreForTests();
}

function createCharacter(userID, name) {
  const service = new CharService();
  const characterID = service.Handle_CreateCharacterWithDoll(
    [name, 5, 1, 1, null, null, 11],
    { userid: userID },
  );
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, "Expected created character record");
  return {
    characterID,
    stationID: Number(characterRecord.stationID || characterRecord.stationid || 0),
  };
}

function buildDockedSession(characterID, stationID, shipID) {
  return {
    userid: characterID + 710000,
    clientID: characterID + 720000,
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID: stationID,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    socket: { destroyed: false },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function grantCybernetics(characterID, level = 5) {
  const changed = grantCharacterSkillLevels(characterID, [{
    typeID: CYBERNETICS_TYPE_ID,
    level,
  }]);
  assert.ok(changed.length > 0, "Expected Cybernetics skill grant");
}

function grantImplant(characterID, stationID, typeID, quantity = 1) {
  const result = grantItemToCharacterLocation(
    characterID,
    stationID,
    ITEM_FLAGS.HANGAR,
    resolveItemByTypeID(typeID),
    quantity,
    { singleton: 0 },
  );
  assert.equal(result.success, true, "Expected implant grant to succeed");
  assert.ok(result.data.items.length > 0, "Expected implant item row");
  return result.data.items[0];
}

function getAttributeValue(attributeDict, attributeID) {
  const entry = attributeDict.entries.find(([key]) => Number(key) === Number(attributeID));
  return entry ? Number(entry[1]) : null;
}

test("dogma InjectImplant consumes one implant and persists it on the character", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970201, "Implant Injection Test");
  grantCybernetics(characterID);
  const implantItem = grantImplant(
    characterID,
    stationID,
    MEMORY_AUGMENTATION_BASIC_TYPE_ID,
    1,
  );
  const ship = getActiveShipRecord(characterID);
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  assert.equal(
    applyCharacterToSession(session, characterID, {
      emitNotifications: false,
      logSelection: false,
    }).success,
    true,
  );

  const dogma = new DogmaService();
  const result = dogma.Handle_InjectImplant([implantItem.itemID], session);

  assert.deepEqual(result, [MEMORY_AUGMENTATION_BASIC_TYPE_ID]);
  assert.equal(findItemById(implantItem.itemID), null, "Expected consumed implant item");
  const characterRecord = getCharacterRecord(characterID);
  assert.deepEqual(
    characterRecord.implants.map((implant) => ({
      typeID: implant.typeID,
      slot: implant.slot,
    })),
    [{ typeID: MEMORY_AUGMENTATION_BASIC_TYPE_ID, slot: 2 }],
  );
  assert.ok(
    session.notifications.some(
      (notification) =>
        notification.name === "OnDogmaAttributeChanged" &&
        notification.payload[2] === ATTRIBUTE_MEMORY &&
        notification.payload[3] === 23,
    ),
    "Expected memory attribute refresh notification",
  );
});

function getCustomNotifyText(error) {
  const payload = error && error.machoErrorResponse && error.machoErrorResponse.payload;
  const args = payload && Array.isArray(payload.header) ? payload.header[1] : null;
  const valuesDict = Array.isArray(args) ? args[1] : null;
  const notifyEntry =
    valuesDict &&
    valuesDict.type === "dict" &&
    Array.isArray(valuesDict.entries)
      ? valuesDict.entries.find(([key]) => key === "notify")
      : null;
  return notifyEntry ? String(notifyEntry[1] || "") : "";
}

test("dogma InjectImplant rejects an occupied implant slot before consuming inventory", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970202, "Implant Replace Test");
  grantCybernetics(characterID);
  const basicImplant = grantImplant(
    characterID,
    stationID,
    MEMORY_AUGMENTATION_BASIC_TYPE_ID,
    1,
  );
  const standardImplant = grantImplant(
    characterID,
    stationID,
    MEMORY_AUGMENTATION_STANDARD_TYPE_ID,
    1,
  );
  const ship = getActiveShipRecord(characterID);
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  assert.equal(
    applyCharacterToSession(session, characterID, {
      emitNotifications: false,
      logSelection: false,
    }).success,
    true,
  );

  const dogma = new DogmaService();
  dogma.Handle_InjectImplant([basicImplant.itemID], session);
  let thrown = null;
  assert.throws(
    () => dogma.Handle_InjectImplant([standardImplant.itemID], session),
    (error) => {
      thrown = error;
      return error && error.name === "MachoWrappedException";
    },
  );

  const implants = getCharacterRecord(characterID).implants;
  assert.equal(implants.length, 1, "Expected one implant in slot 2");
  assert.equal(implants[0].typeID, MEMORY_AUGMENTATION_BASIC_TYPE_ID);
  assert.equal(implants[0].slot, 2);
  assert.equal(findItemById(basicImplant.itemID), null);
  assert.ok(findItemById(standardImplant.itemID), "Expected rejected implant to remain in inventory");
  assert.match(getCustomNotifyText(thrown), /slot is already occupied/i);
});

test("character attributes include active implant primary-attribute bonuses", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const { characterID, stationID } = createCharacter(970203, "Implant Attribute Test");
  grantCybernetics(characterID);
  const implantItem = grantImplant(
    characterID,
    stationID,
    MEMORY_AUGMENTATION_BASIC_TYPE_ID,
    1,
  );
  const ship = getActiveShipRecord(characterID);
  const session = buildDockedSession(characterID, stationID, ship.itemID);
  assert.equal(
    applyCharacterToSession(session, characterID, {
      emitNotifications: false,
      logSelection: false,
    }).success,
    true,
  );

  const dogma = new DogmaService();
  assert.equal(
    getAttributeValue(dogma.Handle_GetCharacterAttributes([], session), ATTRIBUTE_MEMORY),
    20,
  );
  dogma.Handle_InjectImplant([implantItem.itemID], session);
  assert.equal(
    getAttributeValue(dogma.Handle_GetCharacterAttributes([], session), ATTRIBUTE_MEMORY),
    23,
  );
});
