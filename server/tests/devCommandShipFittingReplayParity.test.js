const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const {
  getActiveShipRecord,
  getCharacterRecord,
  flushDeferredDockedFittingReplay,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getAttributeIDByNames,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  getShipFittingSnapshot,
  resetFittingRuntimeForTests,
} = require(path.join(
  repoRoot,
  "server/src/_secondary/fitting/fittingRuntime",
));
const {
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  handleCburstCommand,
} = require(path.join(
  repoRoot,
  "server/src/services/ship/devCommandShipRuntime",
));

const ATTRIBUTE_MAX_TARGET_RANGE = getAttributeIDByNames("maxTargetRange") || 76;
const ATTRIBUTE_SCAN_RESOLUTION = getAttributeIDByNames("scanResolution") || 564;

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
  resetFittingRuntimeForTests();
}

function buildDockedSession(characterID, stationID, shipID) {
  return {
    clientID: characterID + 810000,
    userid: characterID + 820000,
    characterID,
    charid: characterID,
    stationid: stationID,
    stationID: stationID,
    locationid: stationID,
    shipID,
    shipid: shipID,
    activeShipID: shipID,
    socket: { destroyed: false },
    notifications: [],
    sessionChanges: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      this.sessionChanges.push(change);
    },
  };
}

function getModuleAttributeChangeItems(session) {
  const changes = [];
  for (const notification of session.notifications || []) {
    if (!notification || notification.name !== "OnModuleAttributeChanges") {
      continue;
    }
    for (const payloadEntry of notification.payload || []) {
      if (
        payloadEntry &&
        payloadEntry.type === "list" &&
        Array.isArray(payloadEntry.items)
      ) {
        changes.push(...payloadEntry.items);
      }
    }
  }
  return changes;
}

function findAttributeChange(session, itemID, attributeID, nextValue, previousValue) {
  return getModuleAttributeChangeItems(session).find((change) => (
    Array.isArray(change) &&
    Number(change[2]) === Number(itemID) &&
    Number(change[3]) === Number(attributeID) &&
    Math.abs((Number(change[5]) || 0) - Number(nextValue)) <= 1e-6 &&
    Math.abs((Number(change[6]) || 0) - Number(previousValue)) <= 1e-6
  ));
}

test("docked /cburst replay restates active command burst ship stats even with a warm cache", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const service = new CharService();
  const characterID = service.Handle_CreateCharacterWithDoll(
    ["CburstReplayParity", 5, 1, 1, null, null, 11],
    { userid: 971001 },
  );
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, "Expected test character");

  const initialShipID = Number(characterRecord.shipID || characterRecord.shipid || 0);
  const stationID = Number(characterRecord.stationID || characterRecord.stationid || 0);
  const session = buildDockedSession(characterID, stationID, initialShipID);

  const commandResult = handleCburstCommand(session);
  assert.equal(commandResult.success, true, "Expected /cburst to succeed");
  assert.ok(
    session._deferredDockedFittingReplay,
    "Expected /cburst boarding to queue a deferred docked fitting replay",
  );

  const activeShip = getActiveShipRecord(characterID);
  assert.ok(activeShip, "Expected active Claymore after /cburst");

  const warmedSnapshot = getShipFittingSnapshot(characterID, activeShip.itemID, {
    shipItem: activeShip,
    reason: "test.warm-cache-before-replay",
  });
  assert.ok(warmedSnapshot, "Expected warmed fitting snapshot");

  session.notifications = [];
  const flushResult = flushDeferredDockedFittingReplay(session, {
    trigger: "test",
  });
  assert.equal(flushResult, true, "Expected deferred fitting replay flush to succeed");

  assert.ok(
    findAttributeChange(
      session,
      activeShip.itemID,
      ATTRIBUTE_MAX_TARGET_RANGE,
      Number(warmedSnapshot.shipAttributes[ATTRIBUTE_MAX_TARGET_RANGE]) || 0,
      0,
    ),
    "Expected /cburst replay to restate active command burst target range from a zero baseline",
  );
  assert.ok(
    findAttributeChange(
      session,
      activeShip.itemID,
      ATTRIBUTE_SCAN_RESOLUTION,
      Number(warmedSnapshot.shipAttributes[ATTRIBUTE_SCAN_RESOLUTION]) || 0,
      0,
    ),
    "Expected /cburst replay to restate active command burst scan resolution from a zero baseline",
  );
});
