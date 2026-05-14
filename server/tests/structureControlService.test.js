const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const StructureControlService = require(path.join(
  repoRoot,
  "server/src/services/structure/structureControlService",
));
const {
  ATTRIBUTE_CPU_LOAD,
  ATTRIBUTE_CPU_OUTPUT,
  ATTRIBUTE_POWER_LOAD,
  ATTRIBUTE_POWER_OUTPUT,
  ATTRIBUTE_UPGRADE_CAPACITY,
  ATTRIBUTE_UPGRADE_LOAD,
  ATTRIBUTE_UPGRADE_SLOTS_LEFT,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDogmaPrime",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));

const originalGetStructureByID = structureState.getStructureByID;

function buildStructure() {
  return {
    structureID: 1030000000000,
    typeID: 35832,
    ownerCorpID: 1000044,
    ownerID: 1000044,
    allianceID: null,
  };
}

function buildSession(overrides = {}) {
  const sentChanges = [];
  const events = [];
  const session = {
    characterID: 140000002,
    charid: 140000002,
    corporationID: 1000044,
    corpid: 1000044,
    allianceID: 0,
    allianceid: 0,
    activeShipID: 990112614,
    shipID: 990112614,
    shipid: 990112614,
    structureID: 1030000000000,
    structureid: 1030000000000,
    _structureControlFittingRefreshDelayMs: 0,
    socket: {
      destroyed: false,
    },
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
      events.push({ kind: "notification", name });
    },
    sendSessionChange(changes) {
      sentChanges.push(changes);
      events.push({ kind: "sessionChange", changes });
    },
    ...overrides,
  };
  session._sentChanges = sentChanges;
  session._events = events;
  return session;
}

test.afterEach(() => {
  structureState.getStructureByID = originalGetStructureByID;
});

test.afterEach(() => {
  for (const session of sessionRegistry.getSessions()) {
    sessionRegistry.unregister(session);
  }
});

test("structureControl TakeControl switches shipid to structureid and advertises the pilot", async () => {
  const service = new StructureControlService();
  const session = buildSession({
    _deferredDockedShipSessionChange: {
      shipID: 990112614,
      selfFlushTimer: setTimeout(() => {}, 60_000),
    },
    _deferredDockedFittingReplay: {
      shipID: 990112614,
      selfFlushTimer: setTimeout(() => {}, 60_000),
    },
    _pendingCommandShipFittingReplay: {
      shipID: 990112614,
    },
  });
  const structure = buildStructure();

  structureState.getStructureByID = (structureID, options) => {
    assert.equal(Number(structureID), structure.structureID);
    assert.deepEqual(options, { refresh: false });
    return structure;
  };

  sessionRegistry.register(session);

  const result = await service.Handle_TakeControl([structure.structureID], session);

  assert.equal(result, null);
  assert.equal(session.shipID, structure.structureID);
  assert.equal(session.shipid, structure.structureID);
  assert.equal(session.activeShipID, structure.structureID);
  assert.equal(session.activeShipId, structure.structureID);
  assert.equal(session._structureControlPreviousShipID, 990112614);
  assert.deepEqual(session._sentChanges, [
    {
      shipid: [990112614, structure.structureID],
    },
  ]);
  assert.equal(session._deferredDockedShipSessionChange, null);
  assert.equal(session._deferredDockedFittingReplay, null);
  assert.equal(session._pendingCommandShipFittingReplay, null);
  const structurePrimes = session.notifications.filter(
    (notification) => notification.name === "OnGodmaPrimeItem",
  );
  const structurePrime = structurePrimes[0];
  assert.ok(structurePrime, "Expected TakeControl to prime controlled structure dogma");
  const primePayload = structurePrime.payload || [];
  assert.equal(primePayload[0], structure.structureID);
  const primeFields = new Map(primePayload[1].args.entries);
  const primeAttributes = new Map(primeFields.get("attributes").entries);
  assert.equal(primeAttributes.has(2216), true);
  assert.equal(primeAttributes.get(1175), 0);
  assert.equal(primeAttributes.get(1176), 0);
  assert.equal(primeAttributes.get(1177), 0);
  assert.equal(primeAttributes.get(1224), 1);
  assert.equal(primeAttributes.get(3101), 56201);
  assert.equal(primeAttributes.get(2056), 3);
  assert.equal(primeAttributes.has(ATTRIBUTE_UPGRADE_SLOTS_LEFT), true);
  assert.equal(structurePrimes.length, 2);
  const statsRefresh = session.notifications.find(
    (notification) => notification.name === "OnDogmaAttributeChanged",
  );
  assert.ok(statsRefresh, "Expected TakeControl to signal fitting stats refresh");
  assert.deepEqual(statsRefresh.payload, [
    structure.structureID,
    structure.structureID,
    ATTRIBUTE_UPGRADE_SLOTS_LEFT,
    3,
  ]);
  const gaugeRefresh = session.notifications.find(
    (notification) => notification.name === "OnModuleAttributeChanges",
  );
  assert.ok(gaugeRefresh, "Expected settled TakeControl to refresh fitting gauge attrs");
  const gaugeChanges = gaugeRefresh.payload[0].items;
  assert.deepEqual(
    gaugeChanges.map((change) => change[3]).sort((left, right) => left - right),
    [
      ATTRIBUTE_POWER_OUTPUT,
      ATTRIBUTE_POWER_LOAD,
      ATTRIBUTE_CPU_OUTPUT,
      ATTRIBUTE_CPU_LOAD,
      ATTRIBUTE_UPGRADE_CAPACITY,
      ATTRIBUTE_UPGRADE_LOAD,
    ].sort((left, right) => left - right),
  );
  for (const change of gaugeChanges) {
    assert.equal(change[1], session.characterID);
    assert.equal(change[2], structure.structureID);
    assert.equal(Number.isFinite(change[5]), true);
  }
  assert.equal(session._events[0].kind, "sessionChange");
  assert.equal(session._events[1].kind, "notification");
  assert.equal(session._events[1].name, "OnGodmaPrimeItem");
  assert.equal(session._events.at(-1).name, "OnDogmaAttributeChanged");
  assert.equal(
    service.Handle_GetStructurePilot([structure.structureID], session),
    session.characterID,
  );
});

test("structureControl TakeControl overrides an existing controller and restores their previous ship", async () => {
  const service = new StructureControlService();
  const structure = buildStructure();
  const previousController = buildSession({
    characterID: 140000010,
    charid: 140000010,
    activeShipID: 990112610,
    shipID: structure.structureID,
    shipid: structure.structureID,
    _structureControlPreviousShipID: 990112610,
  });
  const session = buildSession({
    characterID: 140000011,
    charid: 140000011,
    activeShipID: 990112611,
    shipID: 990112611,
    shipid: 990112611,
  });

  structureState.getStructureByID = () => structure;

  sessionRegistry.register(previousController);
  sessionRegistry.register(session);

  await service.Handle_TakeControl([structure.structureID], session);

  assert.equal(previousController.shipID, 990112610);
  assert.equal(previousController.shipid, 990112610);
  assert.equal(previousController.activeShipID, 990112610);
  assert.equal(previousController.activeShipId, 990112610);
  assert.deepEqual(previousController._sentChanges, [
    {
      shipid: [structure.structureID, 990112610],
    },
  ]);
  assert.equal(session.shipID, structure.structureID);
  assert.equal(session.activeShipID, structure.structureID);
  assert.equal(session.activeShipId, structure.structureID);
  assert.equal(
    service.Handle_GetStructurePilot([structure.structureID], session),
    session.characterID,
  );
});

test("structureControl ReleaseControl restores the previously boarded ship", () => {
  const service = new StructureControlService();
  const session = buildSession({
    shipID: 1030000000000,
    shipid: 1030000000000,
    _structureControlPreviousShipID: 990112614,
    _deferredDockedShipSessionChange: {
      shipID: 990112614,
      selfFlushTimer: setTimeout(() => {}, 60_000),
    },
    _deferredDockedFittingReplay: {
      shipID: 990112614,
      selfFlushTimer: setTimeout(() => {}, 60_000),
    },
    _pendingCommandShipFittingReplay: {
      shipID: 990112614,
    },
    _structureViewSpace: {
      initialStateSent: true,
      shipID: 1030000000000,
    },
  });

  const result = service.Handle_ReleaseControl([], session);

  assert.equal(result, null);
  assert.equal(session.shipID, 990112614);
  assert.equal(session.shipid, 990112614);
  assert.equal(session.activeShipID, 990112614);
  assert.equal(session.activeShipId, 990112614);
  assert.equal(session._structureControlPreviousShipID, undefined);
  assert.deepEqual(session._sentChanges, [
    {
      shipid: [1030000000000, 990112614],
    },
  ]);
  assert.equal(session._structureViewSpace, null);
  assert.equal(session._deferredDockedShipSessionChange, null);
  assert.equal(session._deferredDockedFittingReplay, null);
  assert.equal(session._pendingCommandShipFittingReplay, null);
});

test("structureControl denies TakeControl when the pilot is not docked in the requested structure", async () => {
  const service = new StructureControlService();
  const structure = buildStructure();
  const session = buildSession({
    structureID: 1030000000001,
    structureid: 1030000000001,
  });

  structureState.getStructureByID = () => structure;

  await assert.rejects(
    service.Handle_TakeControl([structure.structureID], session),
    (error) => {
      const payload = error && error.machoErrorResponse && error.machoErrorResponse.payload;
      const header = payload && Array.isArray(payload.header) ? payload.header : [];
      assert.equal(header[1] && header[1][0], "CustomNotify");
      return true;
    },
  );
});

test("machoNet service info advertises structureControl for client routing", () => {
  const service = new MachoNetService();
  const infoDict = service.getServiceInfoDict();
  const serviceInfo = new Map(infoDict.entries);

  assert.equal(serviceInfo.has("structureControl"), true);
  assert.equal(serviceInfo.get("structureControl"), null);
});
