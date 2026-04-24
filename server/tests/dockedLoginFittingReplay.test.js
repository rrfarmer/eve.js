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
const {
  marshalDecode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
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
  getFittedModuleItems,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

function getDockedCandidateWithFit() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const candidates = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const characterRecord = getCharacterRecord(characterID);
      const ship = getActiveShipRecord(characterID);
      const stationID = Number(
        characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
      ) || 0;
      if (!characterRecord || !ship || stationID <= 0) {
        return null;
      }
      const fittedModules = getFittedModuleItems(characterID, ship.itemID);
      if (fittedModules.length <= 0) {
        return null;
      }
      return {
        characterID,
        stationID,
        ship,
        fittedModules,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.fittedModules.length - left.fittedModules.length);

  assert.ok(
    candidates.length > 0,
    "Expected at least one docked character with fitted modules",
  );
  return candidates[0];
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 99000,
    userid: candidate.characterID,
    characterID: null,
    charid: null,
    corporationID: 0,
    allianceID: null,
    stationid: null,
    stationID: null,
    stationid2: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    locationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    socket: { destroyed: false },
    currentBoundObjectID: null,
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

function extractBoundID(bound) {
  return bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
    ? bound.value.value[0]
    : null;
}

test("docked login keeps the deferred fitting replay parked until active ship inventory bootstrap", () => {
  const candidate = getDockedCandidateWithFit();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  const invBroker = new InvBrokerService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    logSelection: false,
  });
  assert.equal(applyResult.success, true);
  assert.equal(Number(session.stationid || 0), candidate.stationID);
  assert.ok(
    session._deferredDockedFittingReplay,
    "Expected docked login to queue a deferred fitting replay",
  );
  assert.equal(
    session._deferredDockedFittingReplay.loginSelection,
    true,
    "Expected the initial docked selection to be marked as a login selection",
  );
  assert.equal(
    session._deferredDockedFittingReplay.selfFlushTimer,
    null,
    "Expected docked login to avoid arming the deferred fitting replay timer before the active ship inventory bind",
  );

  session.notifications.length = 0;
  dogma.afterCallResponse("GetAllInfo", session);
  assert.ok(
    session._deferredDockedFittingReplay,
    "Expected dogma GetAllInfo to leave the docked login fitting replay parked until inventory bootstrap",
  );
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnItemChange"),
    false,
    "Expected docked login to avoid replaying fitted modules during dogma bootstrap",
  );
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnServerBrainUpdated"),
    true,
    "Expected docked login bootstrap to publish a real character brain update for industry modifiers",
  );
  const brainNotificationsAfterDogma = session.notifications.filter(
    (notification) => notification.name === "OnServerBrainUpdated",
  );
  assert.equal(
    brainNotificationsAfterDogma.length,
    1,
    "Expected docked login bootstrap to emit exactly one character brain update before active-ship inventory activation",
  );

  const bound = invBroker.Handle_GetInventoryFromId([candidate.ship.itemID, 0], session, {});
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected active ship inventory bind to succeed");
  session.currentBoundObjectID = boundID;
  invBroker.afterCallResponse("GetInventoryFromId", session);

  assert.equal(
    session._deferredDockedFittingReplay,
    null,
    "Expected the deferred docked fitting replay to flush once the active ship inventory bind completed",
  );
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnItemChange"),
    true,
    "Expected the active ship inventory bootstrap to flush the queued fitting replay",
  );
  assert.equal(
    session.notifications.some((notification) => notification.name === "OnModuleAttributeChanges"),
    true,
    "Expected the active ship inventory bootstrap to refresh live character industry modifiers",
  );
  const brainNotifications = session.notifications.filter(
    (notification) => notification.name === "OnServerBrainUpdated",
  );
  assert.equal(
    brainNotifications.length,
    1,
    "Expected active ship inventory bootstrap to avoid emitting a second OnServerBrainUpdated while the client is already inside _MakeShipActive",
  );

  const brainNotification = brainNotifications[0];
  assert.ok(brainNotification, "Expected an OnServerBrainUpdated notification");
  const brainPayload = Array.isArray(brainNotification.payload)
    ? brainNotification.payload[0]
    : null;
  assert.ok(Array.isArray(brainPayload), "Expected OnServerBrainUpdated to carry [version, grayMatter]");
  assert.ok(Buffer.isBuffer(brainPayload[1]), "Expected OnServerBrainUpdated grayMatter to stay marshaled");
  const decodedBrain = marshalDecode(brainPayload[1]);
  assert.equal(Array.isArray(decodedBrain), true);
  assert.equal(decodedBrain.length, 3);
  assert.equal(decodedBrain[0] && decodedBrain[0].type, "list");
  assert.ok(
    Array.isArray(decodedBrain[0].items) && decodedBrain[0].items.length > 0,
    "Expected the real industry brain payload to include character BrainEffects",
  );
});

test("uncached docked ItemGetInfo only builds inventory attributes once per item", () => {
  const candidate = getDockedCandidateWithFit();
  const session = buildSession(candidate);
  const dogma = new DogmaService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  const targetModule = candidate.fittedModules[0];
  let attributeBuildCount = 0;
  const originalBuildInventoryItemAttributes =
    dogma._buildInventoryItemAttributes.bind(dogma);
  dogma._buildInventoryItemAttributes = function (...args) {
    attributeBuildCount += 1;
    return originalBuildInventoryItemAttributes(...args);
  };

  dogma.Handle_ItemGetInfo([targetModule.itemID], session);

  assert.equal(
    attributeBuildCount,
    1,
    "Expected uncached docked ItemGetInfo to build runtime item attributes once instead of repeating the same work",
  );
});

test("docked GetAllInfo seeds immediate ItemGetInfo requests from cache", () => {
  const candidate = getDockedCandidateWithFit();
  const session = buildSession(candidate);
  const dogma = new DogmaService();

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    logSelection: false,
  });
  assert.equal(applyResult.success, true);

  dogma.Handle_GetAllInfo([false, true, null], session);

  const targetModule = candidate.fittedModules[0];
  let attributeDictBuildCount = 0;
  const originalBuildInventoryItemAttributeDict =
    dogma._buildInventoryItemAttributeDict.bind(dogma);
  dogma._buildInventoryItemAttributeDict = function (...args) {
    attributeDictBuildCount += 1;
    return originalBuildInventoryItemAttributeDict(...args);
  };

  const moduleInfo = dogma.Handle_ItemGetInfo([targetModule.itemID], session);

  assert.ok(moduleInfo, "Expected docked ItemGetInfo to return the requested module");
  assert.equal(
    attributeDictBuildCount,
    0,
    "Expected docked GetAllInfo to seed the immediate fitting-window ItemGetInfo from cache without rebuilding the same attribute payload",
  );
});
