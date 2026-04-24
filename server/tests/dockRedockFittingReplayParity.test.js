const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const transitions = require(path.join(
  repoRoot,
  "server/src/space/transitions",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
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

const ATTRIBUTE_MASS = getAttributeIDByNames("mass") || 4;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    accounts: cloneValue(database.read("accounts", "/").data || {}),
    characters: cloneValue(database.read("characters", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
    skills: cloneValue(database.read("skills", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("accounts", "/", cloneValue(snapshot.accounts), { force: true });
  database.write("characters", "/", cloneValue(snapshot.characters), { force: true });
  database.write("identityState", "/", cloneValue(snapshot.identityState), { force: true });
  database.write("items", "/", cloneValue(snapshot.items), { force: true });
  database.write("skills", "/", cloneValue(snapshot.skills), { force: true });
  database.flushAllSync();
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();
  if (spaceRuntime && spaceRuntime._testing) {
    spaceRuntime._testing.clearScenes();
  }
}

function buildSession(characterID) {
  return {
    clientID: characterID + 620000,
    userid: characterID + 630000,
    characterID,
    charid: characterID,
    socket: { destroyed: false },
    notifications: [],
    _notifications: [],
    sessionChanges: [],
    sendNotification(name, idType, payload) {
      const entry = { name, idType, payload };
      this.notifications.push(entry);
      this._notifications.push(entry);
    },
    sendSessionChange(changes) {
      this.sessionChanges.push(changes);
    },
  };
}

function getModuleAttributeChangeItems(session) {
  const changes = [];
  for (const notification of session.notifications || []) {
    if (!notification || notification.name !== "OnModuleAttributeChanges") {
      continue;
    }
    const payload = Array.isArray(notification.payload)
      ? notification.payload[0]
      : null;
    if (payload && payload.type === "list" && Array.isArray(payload.items)) {
      changes.push(...payload.items);
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

async function waitFor(predicate, attempts = 90, delayMs = 25) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

test("undock then redock restates full ship fitting attributes after the deferred dock replay", async (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();
  resetFittingRuntimeForTests();

  const service = new CharService();
  const characterID = service.Handle_CreateCharacterWithDoll(
    ["DockRedockReplay", 5, 1, 1, null, null, 11],
    { userid: 972001 },
  );
  const characterRecord = getCharacterRecord(characterID);
  assert.ok(characterRecord, "Expected test character");

  const stationID = Number(characterRecord.stationID || characterRecord.stationid || 0);
  const session = buildSession(characterID);
  const applyResult = applyCharacterToSession(session, characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  assert.equal(applyResult.success, true);

  const undockResult = transitions.undockSession(session);
  assert.equal(undockResult.success, true, "Expected undock to succeed");

  const activeShip = getActiveShipRecord(characterID);
  assert.ok(activeShip, "Expected active ship after undock");

  const warmedSnapshot = getShipFittingSnapshot(characterID, activeShip.itemID, {
    shipItem: activeShip,
    reason: "test.redock-prewarm",
  });
  assert.ok(warmedSnapshot, "Expected warm ship fitting snapshot before redock");

  session.notifications = [];
  session._notifications = [];
  const dockResult = transitions.dockSession(session, stationID);
  assert.equal(dockResult.success, true, "Expected redock to succeed");

  const replayFlushed = await waitFor(
    () => session._deferredDockedFittingReplay === null,
    90,
    25,
  );
  assert.equal(
    replayFlushed,
    true,
    "Expected deferred docked fitting replay to flush after redock",
  );

  const dockedShip = getActiveShipRecord(characterID);
  assert.ok(dockedShip, "Expected active ship after redock");
  assert.ok(
    findAttributeChange(
      session,
      dockedShip.itemID,
      ATTRIBUTE_MASS,
      Number(warmedSnapshot.shipAttributes[ATTRIBUTE_MASS]) || 0,
      0,
    ),
    "Expected redock fitting replay to restate ship mass from a zero baseline",
  );
});
