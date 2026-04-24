const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const config = require(path.join(repoRoot, "server/src/config"));
const runtime = require(path.join(repoRoot, "server/src/space/runtime"));
const miningRuntime = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntime",
));
const {
  clearPersistedSystemState,
  getMineableState,
} = require(path.join(
  repoRoot,
  "server/src/services/mining/miningRuntimeState",
));
const {
  resolveItemByName,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));
const {
  getTypeEffectRecords,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));

function disableGeneratedMiningSites(t) {
  const originalIceEnabled = config.miningGeneratedIceSitesEnabled;
  const originalGasEnabled = config.miningGeneratedGasSitesEnabled;
  config.miningGeneratedIceSitesEnabled = false;
  config.miningGeneratedGasSitesEnabled = false;
  t.after(() => {
    config.miningGeneratedIceSitesEnabled = originalIceEnabled;
    config.miningGeneratedGasSitesEnabled = originalGasEnabled;
  });
}

function resetScene(systemID) {
  clearPersistedSystemState(systemID);
  runtime._testing.clearScenes();
}

function buildModuleItem(typeRecord, itemID, locationID, flagID = 11) {
  return {
    itemID,
    ownerID: 0,
    locationID,
    flagID,
    typeID: Number(typeRecord.typeID),
    groupID: Number(typeRecord.groupID || 0),
    categoryID: Number(typeRecord.categoryID || 0),
    itemName: String(typeRecord.name || ""),
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    moduleState: {
      online: true,
    },
  };
}

function buildChargeItem(typeRecord, itemID, locationID, moduleID) {
  return {
    itemID,
    ownerID: 0,
    locationID,
    moduleID,
    typeID: Number(typeRecord.typeID),
    groupID: Number(typeRecord.groupID || 0),
    categoryID: Number(typeRecord.categoryID || 0),
    itemName: String(typeRecord.name || ""),
    singleton: 0,
    quantity: 1,
    stacksize: 1,
    volume: Number(typeRecord.volume || 0),
  };
}

function attachSessionToShip(scene, shipEntity, clientID) {
  const notifications = [];
  const session = {
    clientID,
    characterID: 0,
    _space: {
      systemID: scene.systemID,
      shipID: shipEntity.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([shipEntity.itemID]),
      visibleBubbleScopedStaticEntityIDs: new Set(),
      timeDilation: scene.getTimeDilation(),
      simTimeMs: scene.getCurrentSimTimeMs(),
      simFileTime: scene.getCurrentFileTime(),
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  shipEntity.session = session;
  scene.spawnDynamicEntity(shipEntity, { broadcast: false });
  scene.sessions.set(clientID, session);
  return {
    session,
    notifications,
  };
}

function flattenDestinyUpdates(notifications = []) {
  const updates = [];
  for (const notification of notifications) {
    if (
      !notification ||
      notification.name !== "DoDestinyUpdate" ||
      !Array.isArray(notification.payload)
    ) {
      continue;
    }
    const payloadList = notification.payload[0];
    const items =
      payloadList &&
      payloadList.type === "list" &&
      Array.isArray(payloadList.items)
        ? payloadList.items
        : [];
    for (const entry of items) {
      const payload = Array.isArray(entry) ? entry[1] : null;
      if (!Array.isArray(payload) || typeof payload[0] !== "string") {
        continue;
      }
      updates.push({
        stamp: Array.isArray(entry) ? entry[0] : 0,
        name: payload[0],
        args: Array.isArray(payload[1]) ? payload[1] : [],
      });
    }
  }
  return updates;
}

function flushDirectDestinyNotifications(scene) {
  if (scene && typeof scene.flushDirectDestinyNotificationBatch === "function") {
    scene.flushDirectDestinyNotificationBatch();
  }
}

function getRemoveBallsEntityIDs(update) {
  if (!update || update.name !== "RemoveBalls" || !Array.isArray(update.args)) {
    return [];
  }
  const listArg = update.args[0];
  return listArg && listArg.type === "list" && Array.isArray(listArg.items)
    ? listArg.items.map((value) => Number(value))
    : [];
}

function getSlimDictEntry(dict, key) {
  const entries = Array.isArray(dict && dict.entries) ? dict.entries : [];
  const match = entries.find((entry) => Array.isArray(entry) && entry[0] === key);
  return match ? match[1] : undefined;
}

function getAddBallsSlimEntries(update) {
  if (!update || update.name !== "AddBalls2" || !Array.isArray(update.args)) {
    return [];
  }
  const ballEntries = Array.isArray(update.args[0]) ? update.args[0] : [];
  const slimList = ballEntries[1];
  return slimList && slimList.type === "list" && Array.isArray(slimList.items)
    ? slimList.items.map((entry) => Array.isArray(entry) ? entry[0] : entry)
    : [];
}

function getAddBallsSlimItemIDs(update) {
  return getAddBallsSlimEntries(update)
    .map((slim) => Number(getSlimDictEntry(slim, "itemID")))
    .filter((itemID) => Number.isFinite(itemID) && itemID > 0);
}

function addMineableEntity(scene, itemTypeName, itemID, kind, position, resourceQuantity) {
  const lookup = resolveItemByName(itemTypeName);
  assert.ok(lookup && lookup.success && lookup.match, `expected type ${itemTypeName}`);
  const typeRecord = lookup.match;
  const entity = {
    kind,
    itemID,
    typeID: Number(typeRecord.typeID),
    groupID: Number(typeRecord.groupID || 0),
    categoryID: Number(typeRecord.categoryID || 0),
    ownerID: 1,
    itemName: String(typeRecord.name || itemTypeName),
    slimName: String(typeRecord.name || itemTypeName),
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    radius: 150,
    resourceQuantity,
    staticVisibilityScope: "bubble",
  };
  assert.equal(scene.addStaticEntity(entity), true, `expected ${itemTypeName} to be added`);
  return entity;
}

function getMiningEffect(typeRecord, effectName) {
  const effectRecord = getTypeEffectRecords(Number(typeRecord.typeID)).find(
    (entry) => String(entry && entry.name || "").trim().toLowerCase() === String(effectName || "").trim().toLowerCase(),
  );
  assert.ok(effectRecord, `expected ${typeRecord.name} to expose ${effectName}`);
  return effectRecord;
}

test("survey scan returns CCP tuple payloads for ore, ice, and gas sorted by distance", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_001;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800001001,
    typeID: 32880,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  const { session } = attachSessionToShip(scene, shipEntity, 401);

  const oreEntity = addMineableEntity(
    scene,
    "Veldspar",
    510000001,
    "asteroid",
    { x: 10_000, y: 0, z: 0 },
    250,
  );
  const gasEntity = addMineableEntity(
    scene,
    "Fullerite-C50",
    520000001,
    "gasCloud",
    { x: 20_000, y: 0, z: 0 },
    500,
  );
  const iceEntity = addMineableEntity(
    scene,
    "Blue Ice",
    530000001,
    "iceChunk",
    { x: 30_000, y: 0, z: 0 },
    2,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;

  const scanResults = miningRuntime.buildScanResultsForSession(session);
  assert.deepEqual(scanResults, [
    [oreEntity.itemID, oreEntity.typeID, 250],
    [gasEntity.itemID, gasEntity.typeID, 500],
    [iceEntity.itemID, iceEntity.typeID, 2],
  ]);
});

test("moving into an asteroid belt bubble streams bubble-scoped asteroid balls to the client", () => {
  const systemID = 30000145;
  resetScene(systemID);

  const scene = runtime.ensureScene(systemID);
  const belt = scene.getEntityByID(40009258);
  assert.ok(belt, "expected New Caldari asteroid belt anchor");

  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800001501,
    typeID: 32880,
    position: {
      x: belt.position.x + 2_000_000,
      y: belt.position.y,
      z: belt.position.z + 2_000_000,
    },
  }, systemID);
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 405);
  session._space.initialBallparkVisualsSent = true;
  session._space.initialBallparkClockSynced = true;
  notifications.length = 0;

  const teleportResult = scene.teleportDynamicEntityToPoint(
    shipEntity,
    {
      x: belt.position.x + 1_000,
      y: belt.position.y,
      z: belt.position.z + 1_000,
    },
    {
      direction: { x: 1, y: 0, z: 0 },
      refreshOwnerSession: false,
    },
  );
  assert.equal(teleportResult.success, true, "expected ship teleport into belt bubble to succeed");
  flushDirectDestinyNotifications(scene);

  const expectedAsteroidIDs = scene
    .getVisibleBubbleScopedStaticEntitiesForSession(session)
    .filter((entity) => entity.kind === "asteroid")
    .map((entity) => Number(entity.itemID));
  assert.ok(expectedAsteroidIDs.length > 0, "expected asteroid entities in the destination bubble");

  const addBallsAsteroidIDs = flattenDestinyUpdates(notifications)
    .flatMap((update) => getAddBallsSlimItemIDs(update));
  assert.ok(
    expectedAsteroidIDs.some((itemID) => addBallsAsteroidIDs.includes(itemID)),
    "expected entering the belt bubble to emit AddBalls2 for asteroid entities",
  );

  const asteroidYieldTypes = new Map(
    expectedAsteroidIDs.map((itemID) => {
      const state = getMineableState(scene, itemID);
      return [itemID, Number(state && state.yieldTypeID)];
    }),
  );
  const asteroidSlims = flattenDestinyUpdates(notifications)
    .flatMap((update) => getAddBallsSlimEntries(update))
    .filter((slim) => expectedAsteroidIDs.includes(Number(getSlimDictEntry(slim, "itemID"))));
  assert.ok(
    asteroidSlims.length > 0,
    "expected asteroid slim entries to be present in AddBalls2 payloads",
  );
  for (const slim of asteroidSlims) {
    const itemID = Number(getSlimDictEntry(slim, "itemID"));
    assert.equal(
      Number(getSlimDictEntry(slim, "typeID")),
      asteroidYieldTypes.get(itemID),
      "expected asteroid slim typeID to match the mineable ore type",
    );
  }
});

test("same-scene teleport into an asteroid belt bubble streams visibility without an owner SetState rebuild", () => {
  const systemID = 30000145;
  resetScene(systemID);

  const scene = runtime.ensureScene(systemID);
  const belt = scene.getEntityByID(40009258);
  assert.ok(belt, "expected New Caldari asteroid belt anchor");

  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800001503,
    typeID: 32880,
    position: {
      x: belt.position.x + 2_000_000,
      y: belt.position.y,
      z: belt.position.z + 2_000_000,
    },
  }, systemID);
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 407);
  session._space.initialBallparkVisualsSent = true;
  session._space.initialBallparkClockSynced = true;
  notifications.length = 0;

  const teleportResult = scene.teleportDynamicEntityToPoint(
    shipEntity,
    {
      x: belt.position.x + 1_000,
      y: belt.position.y,
      z: belt.position.z + 1_000,
    },
    {
      direction: { x: 1, y: 0, z: 0 },
      refreshOwnerSession: true,
    },
  );
  assert.equal(
    teleportResult.success,
    true,
    "expected same-scene teleport into belt bubble to succeed",
  );
  flushDirectDestinyNotifications(scene);

  const flattened = flattenDestinyUpdates(notifications);
  const expectedAsteroidIDs = scene
    .getVisibleBubbleScopedStaticEntitiesForSession(session)
    .filter((entity) => entity.kind === "asteroid")
    .map((entity) => Number(entity.itemID));
  assert.ok(expectedAsteroidIDs.length > 0, "expected asteroid entities in the destination bubble");

  const addBallsAsteroidIDs = flattened
    .flatMap((update) => getAddBallsSlimItemIDs(update));
  assert.ok(
    expectedAsteroidIDs.some((itemID) => addBallsAsteroidIDs.includes(itemID)),
    "expected same-scene teleport to stream asteroid AddBalls2 into the owner session",
  );
  assert.equal(
    flattened.some((update) => update.name === "SetState"),
    false,
    "expected same-scene teleport visibility refresh not to rebuild the owner ballpark",
  );
  assert.ok(
    flattened.some((update) => (
      update.name === "SetBallPosition" &&
      Number(update.args[0]) === Number(shipEntity.itemID)
    )),
    "expected same-scene teleport to still emit authoritative owner position correction",
  );
});

test("pilot warp handoff preacquires destination belt asteroids before landing reconciliation", () => {
  const systemID = 30000145;
  resetScene(systemID);

  const scene = runtime.ensureScene(systemID);
  const belt = scene.getEntityByID(40009258);
  assert.ok(belt, "expected New Caldari asteroid belt anchor");

  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800001502,
    typeID: 32880,
    position: {
      x: belt.position.x + 1_000,
      y: belt.position.y,
      z: belt.position.z + 1_000,
    },
  }, systemID);
  const { session } = attachSessionToShip(scene, shipEntity, 406);
  session._space.initialBallparkVisualsSent = true;
  session._space.initialBallparkClockSynced = true;
  session._space.visibleBubbleScopedStaticEntityIDs = new Set();

  shipEntity.mode = "WARP";
  shipEntity.warpState = {
    targetPoint: { ...belt.position },
    rawDestination: { ...belt.position },
    startTimeMs: scene.getCurrentSimTimeMs() - 4_000,
  };
  scene.beginPilotWarpVisibilityHandoff(shipEntity, shipEntity.warpState);

  const sessionOnlyUpdates = [];
  scene.advancePilotWarpVisibilityHandoff(
    shipEntity,
    scene.getCurrentSimTimeMs(),
    sessionOnlyUpdates,
  );

  const expectedAsteroidIDs = scene
    .getBubbleScopedStaticEntitiesForPosition(belt.position, session)
    .filter((entity) => entity.kind === "asteroid")
    .map((entity) => Number(entity.itemID));
  assert.ok(expectedAsteroidIDs.length > 0, "expected belt bubble asteroids to exist");
  assert.ok(
    expectedAsteroidIDs.some((itemID) => session._space.visibleBubbleScopedStaticEntityIDs.has(itemID)),
    "expected warp handoff to stage destination bubble asteroid visibility",
  );

  const stagedAsteroidIDs = sessionOnlyUpdates
    .flatMap((entry) => Array.isArray(entry && entry.updates) ? entry.updates : [])
    .map((update) => ({
      name: Array.isArray(update && update.payload) ? update.payload[0] : null,
      args: Array.isArray(update && update.payload) ? update.payload[1] : [],
    }))
    .flatMap((update) => getAddBallsSlimItemIDs(update));
  assert.ok(
    expectedAsteroidIDs.some((itemID) => stagedAsteroidIDs.includes(itemID)),
    "expected warp handoff to stage AddBalls2 for destination belt asteroids",
  );
});

test("asteroid belt warp stop distance ignores the authored belt radius", () => {
  const stopDistance = runtime._testing.getWarpStopDistanceForTargetForTesting(
    { radius: 120 },
    {
      kind: "asteroidBelt",
      radius: 104_297,
    },
  );
  assert.ok(
    stopDistance < 10_000,
    `expected belt warp stop distance to stay close to the warp-in point, got ${stopDistance}`,
  );
});

test("gas cloud mining emits targeted FX and RemoveBalls when the cloud depletes", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_002;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const gasHarvester = resolveItemByName("Gas Cloud Harvester II").match;
  const gasEffect = getMiningEffect(gasHarvester, "miningClouds");
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800002001,
    typeID: 32880,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.nativeNpc = true;
  shipEntity.corporationID = 1000129;
  shipEntity.factionID = 500014;
  shipEntity.ownerID = 1000129;
  shipEntity.fittedItems = [
    buildModuleItem(gasHarvester, 9800002101, shipEntity.itemID, 11),
  ];
  shipEntity.nativeCargoItems = [];
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 402);

  const gasCloud = addMineableEntity(
    scene,
    "Fullerite-C50",
    520000002,
    "gasCloud",
    { x: 500, y: 0, z: 0 },
    1,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  scene.finalizeTargetLock(shipEntity, gasCloud, {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const activationResult = scene.activateGenericModule(
    session,
    shipEntity.fittedItems[0],
    gasEffect.name,
    { targetID: gasCloud.itemID },
  );
  assert.equal(activationResult.success, true, "expected gas harvester activation to succeed");
  flushDirectDestinyNotifications(scene);

  const startFx = flattenDestinyUpdates(notifications).find((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.CloudMining" &&
    Number(update.args[1]) === Number(shipEntity.fittedItems[0].itemID) &&
    Number(update.args[3]) === Number(gasCloud.itemID) &&
    Number(update.args[7]) === 1 &&
    Number(update.args[8]) === 1
  ));
  assert.ok(startFx, "expected gas harvester start FX to match the client-targeted payload");

  const godmaStart = notifications.find((notification) => (
    notification &&
    notification.name === "OnGodmaShipEffect" &&
    Array.isArray(notification.payload) &&
    Number(notification.payload[0]) === Number(shipEntity.fittedItems[0].itemID) &&
    Number(notification.payload[3]) === 1
  ));
  assert.ok(godmaStart, "expected gas harvester activation to emit OnGodmaShipEffect");

  const cycleBoundaryMs =
    scene.getCurrentSimTimeMs() +
    Number(activationResult.data.effectState.durationMs || 1000);
  const cycleResult = miningRuntime.executeMiningCycle(
    scene,
    shipEntity,
    activationResult.data.effectState,
    cycleBoundaryMs,
  );
  assert.equal(cycleResult.success, true, "expected gas harvester cycle to complete");
  assert.equal(cycleResult.data.depleted, true, "expected single-unit gas cloud to deplete");
  flushDirectDestinyNotifications(scene);

  const updates = flattenDestinyUpdates(notifications);
  const removeUpdate = updates.find((update) =>
    getRemoveBallsEntityIDs(update).includes(gasCloud.itemID),
  );
  assert.ok(removeUpdate, "expected depleted gas cloud to emit RemoveBalls");

  const stopFx = updates.find((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.CloudMining" &&
    Number(update.args[1]) === Number(shipEntity.fittedItems[0].itemID) &&
    Number(update.args[3]) === Number(gasCloud.itemID) &&
    Number(update.args[7]) === 0 &&
    Number(update.args[8]) === 0
  ));
  assert.ok(stopFx, "expected gas harvester stop FX to preserve the target context");

  const godmaStop = notifications.find((notification) => (
    notification &&
    notification.name === "OnGodmaShipEffect" &&
    Array.isArray(notification.payload) &&
    Number(notification.payload[0]) === Number(shipEntity.fittedItems[0].itemID) &&
    Number(notification.payload[3]) === 0
  ));
  assert.ok(godmaStop, "expected gas harvester stop to emit OnGodmaShipEffect");
});

test("mining beam FX ignores repeat=1 so observer beams do not expire after one cycle", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_004;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const stripMiner = resolveItemByName("Modulated Strip Miner II").match;
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800004001,
    typeID: 22544,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.fittedItems = [
    buildModuleItem(stripMiner, 9800004101, shipEntity.itemID, 11),
  ];
  shipEntity.nativeCargoItems = [];
  const { session, notifications } = attachSessionToShip(scene, shipEntity, 404);

  const veldspar = addMineableEntity(
    scene,
    "Veldspar",
    550000004,
    "asteroid",
    { x: 500, y: 0, z: 0 },
    500,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  scene.finalizeTargetLock(shipEntity, veldspar, {
    nowMs: scene.getCurrentSimTimeMs(),
  });

  const stripEffect = getMiningEffect(stripMiner, "miningLaser");
  const activationResult = scene.activateGenericModule(
    session,
    shipEntity.fittedItems[0],
    stripEffect.name,
    {
      targetID: veldspar.itemID,
      repeat: 1,
    },
  );
  assert.equal(activationResult.success, true, "expected strip miner activation to succeed");
  flushDirectDestinyNotifications(scene);

  const startFx = flattenDestinyUpdates(notifications).find((update) => (
    update.name === "OnSpecialFX" &&
    String(update.args[5]) === "effects.Laser" &&
    Number(update.args[1]) === Number(shipEntity.fittedItems[0].itemID) &&
    Number(update.args[3]) === Number(veldspar.itemID) &&
    Number(update.args[7]) === 1 &&
    Number(update.args[8]) === 1
  ));
  assert.ok(startFx, "expected strip miner activation to emit OnSpecialFX");
  assert.ok(
    Number(startFx.args[10]) > 1,
    "expected mining beam FX repeat to ignore the client repeat=1 override",
  );
});

test("mining modules reject incompatible targets and mismatched crystals", (t) => {
  disableGeneratedMiningSites(t);
  const systemID = 39_990_003;
  resetScene(systemID);
  t.after(() => resetScene(systemID));

  const stripMiner = resolveItemByName("Modulated Strip Miner II").match;
  const iceHarvester = resolveItemByName("Ice Harvester II").match;
  const gasHarvester = resolveItemByName("Gas Cloud Harvester II").match;
  const veldsparCrystal = resolveItemByName("Veldspar Mining Crystal II").match;
  const scene = runtime.ensureScene(systemID);
  const shipEntity = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 9800003001,
    typeID: 22544,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  }, systemID);
  shipEntity.nativeNpc = true;
  shipEntity.fittedItems = [
    buildModuleItem(stripMiner, 9800003101, shipEntity.itemID, 11),
    buildModuleItem(iceHarvester, 9800003102, shipEntity.itemID, 12),
    buildModuleItem(gasHarvester, 9800003103, shipEntity.itemID, 13),
  ];
  shipEntity.nativeCargoItems = [
    buildChargeItem(
      veldsparCrystal,
      9800003201,
      shipEntity.itemID,
      shipEntity.fittedItems[0].itemID,
    ),
  ];
  const { session } = attachSessionToShip(scene, shipEntity, 403);
  void session;

  const gasCloud = addMineableEntity(
    scene,
    "Fullerite-C50",
    520000003,
    "gasCloud",
    { x: 1_500, y: 0, z: 0 },
    500,
  );
  const iceChunk = addMineableEntity(
    scene,
    "Blue Ice",
    530000003,
    "iceChunk",
    { x: 2_000, y: 0, z: 0 },
    10,
  );
  const scordite = addMineableEntity(
    scene,
    "Scordite",
    540000003,
    "asteroid",
    { x: 2_500, y: 0, z: 0 },
    500,
  );
  const veldspar = addMineableEntity(
    scene,
    "Veldspar",
    550000003,
    "asteroid",
    { x: 3_000, y: 0, z: 0 },
    500,
  );
  clearPersistedSystemState(systemID);
  scene._miningRuntimeState = null;
  for (const targetEntity of [gasCloud, iceChunk, scordite, veldspar]) {
    scene.finalizeTargetLock(shipEntity, targetEntity, {
      nowMs: scene.getCurrentSimTimeMs(),
    });
  }

  const stripEffect = getMiningEffect(stripMiner, "miningLaser");
  const iceEffect = getMiningEffect(iceHarvester, "miningLaser");
  const gasEffect = getMiningEffect(gasHarvester, "miningClouds");

  const stripToGas = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[0],
    stripEffect,
    { targetID: gasCloud.itemID },
  );
  assert.equal(stripToGas.success, false);
  assert.equal(stripToGas.errorMsg, "TARGET_INVALID_FOR_MODULE");

  const gasToIce = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[2],
    gasEffect,
    { targetID: iceChunk.itemID },
  );
  assert.equal(gasToIce.success, false);
  assert.equal(gasToIce.errorMsg, "TARGET_INVALID_FOR_MODULE");

  const iceToGas = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[1],
    iceEffect,
    { targetID: gasCloud.itemID },
  );
  assert.equal(iceToGas.success, false);
  assert.equal(iceToGas.errorMsg, "TARGET_INVALID_FOR_MODULE");

  const stripToScordite = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[0],
    stripEffect,
    { targetID: scordite.itemID },
  );
  assert.equal(stripToScordite.success, false);
  assert.equal(stripToScordite.errorMsg, "CHARGE_NOT_COMPATIBLE");

  const stripToVeldspar = miningRuntime.resolveMiningActivation(
    scene,
    shipEntity,
    shipEntity.fittedItems[0],
    stripEffect,
    { targetID: veldspar.itemID },
  );
  assert.equal(stripToVeldspar.success, true, "expected matching crystal and ore to activate");
});
