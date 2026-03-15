const path = require("path");
const assert = require("assert");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));

const testing = runtime._testing;

function buildFakeEntity(mode) {
  return {
    itemID: 900000001,
    mode,
    pendingDock: null,
    lastObserverPositionBroadcastStamp: -1,
    position: { x: 1000, y: 2000, z: 3000 },
    velocity: { x: 25, y: 5, z: -40 },
  };
}

function countScheduledDispatches(intervalMs, totalMs) {
  let lastDispatchAt = 0;
  let count = 0;
  for (let now = 0; now <= totalMs; now += 50) {
    if ((now - lastDispatchAt) >= intervalMs) {
      count += 1;
      lastDispatchAt = now;
    }
  }
  return count;
}

function createFakeSession(clientID, characterID, systemID) {
  const notifications = [];
  return {
    clientID,
    characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: systemID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function flattenDestinyPayloadNames(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => entry[1][0],
    ),
  );
}

function collectDestinyPayloads(notifications) {
  return notifications.flatMap((notification) =>
    ((((notification || {}).payload || [])[0] || {}).items || []).map(
      (entry) => ({
        stamp: entry[0],
        name: entry[1][0],
        args: entry[1].slice(1),
      }),
    ),
  );
}

function runDeferredAnchorIntegrationCheck() {
  const systemID = 39999999;
  const pilotSession = createFakeSession(910001, 920001, systemID);
  const observerSession = createFakeSession(910002, 920002, systemID);
  const pilotShip = {
    itemID: 930001,
    typeID: 1,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };
  const observerShip = {
    itemID: 930002,
    typeID: 1,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: 1000, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };

  runtime.attachSession(pilotSession, pilotShip, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });
  runtime.attachSession(observerSession, observerShip, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });

  pilotSession._space.initialStateSent = true;
  observerSession._space.initialStateSent = true;
  pilotSession.notifications.length = 0;
  observerSession.notifications.length = 0;

  try {
    const commandNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    const pilotScene = runtime.getSceneForSession(pilotSession);
    assert(pilotScene, "Pilot scene should exist");
    pilotScene.lastTickAt = commandNow - 50;
    const pilotEntity = pilotScene.getShipEntityForSession(pilotSession);
    assert(pilotEntity, "Pilot entity should exist");
    // Model the real regression case: the remote proxy is already established,
    // then the pilot changes direction. We want fast velocity correction after
    // the command, without another forced position rebase on the next tick.
    const firstTickStamp = Math.floor((commandNow + 300) / 1000);
    pilotEntity.lastObserverPositionBroadcastAt = commandNow - 100;
    pilotEntity.lastObserverPositionBroadcastStamp = firstTickStamp;
    pilotEntity.lastObserverCorrectionBroadcastAt = commandNow - 100;
    const success = runtime.gotoDirection(pilotSession, { x: 0, y: 1, z: 0 });
    assert.strictEqual(success, true);
    const immediateObserverPayloadNames = flattenDestinyPayloadNames(
      observerSession.notifications,
    );
    assert(immediateObserverPayloadNames.includes("GotoDirection"));
    assert(immediateObserverPayloadNames.includes("SetSpeedFraction"));
    assert(!immediateObserverPayloadNames.includes("SetBallPosition"));
    assert(!immediateObserverPayloadNames.includes("SetBallVelocity"));

    observerSession.notifications.length = 0;
    const scene = runtime.scenes.get(systemID);
    assert(scene);
    scene.tick(commandNow + 300);

    const firstTickObserverPayloadNames = flattenDestinyPayloadNames(
      observerSession.notifications,
    );
    assert(!firstTickObserverPayloadNames.includes("SetBallPosition"));
    assert(firstTickObserverPayloadNames.includes("SetBallVelocity"));

    observerSession.notifications.length = 0;
    scene.tick(commandNow + 1100);
    const laterObserverPayloadNames = flattenDestinyPayloadNames(
      observerSession.notifications,
    );
    assert(laterObserverPayloadNames.includes("SetBallPosition"));
    assert(laterObserverPayloadNames.includes("SetBallVelocity"));

    return {
      success,
      immediateObserverPayloadNames,
      firstTickObserverPayloadNames,
      laterObserverPayloadNames,
      pilotNotificationCount: pilotSession.notifications.length,
      deferredObserverNotificationCount: observerSession.notifications.length,
    };
  } finally {
    runtime.detachSession(pilotSession, { broadcast: false });
    runtime.detachSession(observerSession, { broadcast: false });
    runtime.scenes.delete(systemID);
  }
}

function runWarpObserverCadenceCheck() {
  const systemID = 39999998;
  const pilotSession = createFakeSession(911001, 921001, systemID);
  const observerSession = createFakeSession(911002, 921002, systemID);
  const pilotShip = {
    itemID: 931001,
    typeID: 1,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };
  const observerShip = {
    itemID: 931002,
    typeID: 1,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: 1000, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };

  runtime.attachSession(pilotSession, pilotShip, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });
  runtime.attachSession(observerSession, observerShip, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });

  try {
    pilotSession._space.initialStateSent = true;
    observerSession._space.initialStateSent = true;
    pilotSession._space.visibleDynamicEntityIDs = new Set([observerShip.itemID]);
    observerSession._space.visibleDynamicEntityIDs = new Set([pilotShip.itemID]);
    pilotSession.notifications.length = 0;
    observerSession.notifications.length = 0;

    const baseNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    const scene = runtime.getSceneForSession(pilotSession);
    assert(scene, "Pilot scene should exist");
    scene.lastTickAt = baseNow - 50;
    const pilotEntity = scene.getShipEntityForSession(pilotSession);
    assert(pilotEntity, "Pilot warp entity should exist");
    pilotEntity.direction = { x: 1, y: 0, z: 0 };
    pilotEntity.targetPoint = { x: 1.0e16, y: 0, z: 0 };
    pilotEntity.speedFraction = 1;
    pilotEntity.velocity = { x: pilotEntity.maxVelocity, y: 0, z: 0 };
    pilotEntity.mode = "GOTO";

    const warpTarget = { x: 3.0e12, y: 0, z: 0 };
    const warpResult = runtime.warpToPoint(pilotSession, warpTarget, {
      targetEntityID: 40009116,
      stopDistance: 0,
      warpSpeedAU: 3,
    });
    assert.strictEqual(warpResult.success, true);
    assert(pilotEntity.pendingWarp, "Pending warp should exist");
    pilotEntity.pendingWarp.requestedAtMs = baseNow - 30000;

    observerSession.notifications.length = 0;
    scene.tick(baseNow);
    assert.strictEqual(pilotEntity.mode, "WARP");
    assert(pilotEntity.warpState, "Warp state should be active");
    const activationPayloadNames = flattenDestinyPayloadNames(
      observerSession.notifications,
    );
    assert(activationPayloadNames.includes("WarpTo"));
    assert(activationPayloadNames.includes("OnSpecialFX"));

    observerSession.notifications.length = 0;
    scene.tick(baseNow + 250);
    scene.tick(baseNow + 500);
    scene.tick(baseNow + 750);

    const sameStampPayloads = collectDestinyPayloads(observerSession.notifications);
    const sameStampSetBallPositionCount = sameStampPayloads.filter(
      (entry) => entry.name === "SetBallPosition",
    ).length;
    const sameStampSetBallVelocityCount = sameStampPayloads.filter(
      (entry) => entry.name === "SetBallVelocity",
    ).length;
    assert.strictEqual(sameStampSetBallPositionCount, 0);
    assert.strictEqual(sameStampSetBallVelocityCount, 0);

    observerSession.notifications.length = 0;
    let removalNames = [];
    for (let index = 1; index <= 20; index += 1) {
      scene.tick(baseNow + (index * 1000));
      removalNames = flattenDestinyPayloadNames(observerSession.notifications);
      if (removalNames.includes("RemoveBalls")) {
        break;
      }
    }
    assert(removalNames.includes("RemoveBalls"));

    observerSession.notifications.length = 0;
    const completionNow = Math.ceil(
      pilotEntity.warpState.startTimeMs + pilotEntity.warpState.durationMs + 50,
    );
    scene.tick(completionNow);
    const completionPayloads = collectDestinyPayloads(observerSession.notifications);
    const completionNames = completionPayloads.map((entry) => entry.name);
    assert(!completionNames.includes("SetBallPosition"));
    assert(!completionNames.includes("SetBallVelocity"));
    assert(!completionNames.includes("Stop"));

    observerSession.notifications.length = 0;
    scene.tick(completionNow + 100);
    const postCompletionNames = flattenDestinyPayloadNames(observerSession.notifications);
    assert(!postCompletionNames.includes("SetBallPosition"));
    assert(!postCompletionNames.includes("SetBallVelocity"));

    return {
      warpActivated: true,
      activationPayloadNames,
      sameStampPayloads: sameStampPayloads.map((entry) => entry.name),
      removalNames,
      completionNames,
      postCompletionNames,
    };
  } finally {
    runtime.detachSession(pilotSession, { broadcast: false });
    runtime.detachSession(observerSession, { broadcast: false });
    runtime.scenes.delete(systemID);
  }
}

function runDynamicVisibilityCheck() {
  const systemID = 30000142;
  const leftSession = createFakeSession(912001, 922001, systemID);
  const rightSession = createFakeSession(912002, 922002, systemID);
  const farDistance = testing.BUBBLE_RADIUS_METERS * 4;
  const leftShip = {
    itemID: 932001,
    typeID: 1,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };
  const rightShip = {
    itemID: 932002,
    typeID: 1,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: farDistance, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };

  runtime.attachSession(leftSession, leftShip, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });
  runtime.attachSession(rightSession, rightShip, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });

  try {
    assert.strictEqual(runtime.ensureInitialBallpark(leftSession), true);
    assert.strictEqual(runtime.ensureInitialBallpark(rightSession), true);
    assert.deepStrictEqual([...leftSession._space.visibleDynamicEntityIDs], []);
    assert.deepStrictEqual([...rightSession._space.visibleDynamicEntityIDs], []);

    leftSession.notifications.length = 0;
    rightSession.notifications.length = 0;
    const scene = runtime.getSceneForSession(leftSession);
    assert(scene, "Visibility scene should exist");
    const leftEntity = scene.getShipEntityForSession(leftSession);
    assert(leftEntity, "Left entity should exist");
    const rightEntity = scene.getShipEntityForSession(rightSession);
    assert(rightEntity, "Right entity should exist");
    rightEntity.position = { x: 1000, y: 0, z: 0 };

    scene.tick(Date.now());

    const leftAddNames = flattenDestinyPayloadNames(leftSession.notifications);
    const rightAddNames = flattenDestinyPayloadNames(rightSession.notifications);
    assert(leftAddNames.includes("AddBalls2"));
    assert(rightAddNames.includes("AddBalls2"));
    assert(leftSession._space.visibleDynamicEntityIDs.has(932002));
    assert(rightSession._space.visibleDynamicEntityIDs.has(932001));
    assert.strictEqual(leftEntity.bubbleID, rightEntity.bubbleID);

    leftSession.notifications.length = 0;
    rightSession.notifications.length = 0;
    rightEntity.position = { x: farDistance, y: 0, z: 0 };

    scene.tick(Date.now() + 100);

    const leftRemoveNames = flattenDestinyPayloadNames(leftSession.notifications);
    const rightRemoveNames = flattenDestinyPayloadNames(rightSession.notifications);
    assert(leftRemoveNames.includes("RemoveBalls"));
    assert(rightRemoveNames.includes("RemoveBalls"));
    assert(!leftSession._space.visibleDynamicEntityIDs.has(932002));
    assert(!rightSession._space.visibleDynamicEntityIDs.has(932001));
    assert.notStrictEqual(leftEntity.bubbleID, rightEntity.bubbleID);

    return {
      farDistance,
      bubbleRadius: testing.BUBBLE_RADIUS_METERS,
      bubbleHysteresis: testing.BUBBLE_HYSTERESIS_METERS,
      initialVisibleLeft: 0,
      initialVisibleRight: 0,
      nearAddNames: leftAddNames,
      farRemoveNames: leftRemoveNames,
    };
  } finally {
    runtime.detachSession(leftSession, { broadcast: false });
    runtime.detachSession(rightSession, { broadcast: false });
    runtime.scenes.delete(systemID);
  }
}

function runWarpMidflightVisibilityCheck() {
  const systemID = 30000142;
  const pilotSession = createFakeSession(913001, 923001, systemID);
  const destinationObserverSession = createFakeSession(913002, 923002, systemID);
  const warpTarget = { x: 3.0e12, y: 0, z: 0 };
  const pilotShip = {
    itemID: 933001,
    typeID: 1,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };
  const destinationObserverShip = {
    itemID: 933002,
    typeID: 1,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position: { x: warpTarget.x + 1000, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: -1, y: 0, z: 0 },
      mode: "STOP",
      speedFraction: 0,
    },
  };

  runtime.attachSession(pilotSession, pilotShip, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });
  runtime.attachSession(destinationObserverSession, destinationObserverShip, {
    systemID,
    broadcast: false,
    spawnStopped: true,
  });

  try {
    assert.strictEqual(runtime.ensureInitialBallpark(pilotSession), true);
    assert.strictEqual(runtime.ensureInitialBallpark(destinationObserverSession), true);
    assert.deepStrictEqual(
      [...destinationObserverSession._space.visibleDynamicEntityIDs],
      [],
    );

    const baseNow = Math.floor(Date.now() / 1000) * 1000 + 50;
    const scene = runtime.getSceneForSession(pilotSession);
    assert(scene, "Pilot scene should exist");
    scene.lastTickAt = baseNow - 50;
    const pilotEntity = scene.getShipEntityForSession(pilotSession);
    assert(pilotEntity, "Pilot entity should exist");
    pilotEntity.direction = { x: 1, y: 0, z: 0 };
    pilotEntity.targetPoint = { x: 1.0e16, y: 0, z: 0 };
    pilotEntity.speedFraction = 1;
    pilotEntity.velocity = { x: pilotEntity.maxVelocity, y: 0, z: 0 };
    pilotEntity.mode = "GOTO";

    const warpResult = runtime.warpToPoint(pilotSession, warpTarget, {
      targetEntityID: 40009116,
      stopDistance: 0,
      warpSpeedAU: 3,
    });
    assert.strictEqual(warpResult.success, true);
    assert(pilotEntity.pendingWarp, "Pending warp should exist");
    pilotEntity.pendingWarp.requestedAtMs = baseNow - 30000;

    destinationObserverSession.notifications.length = 0;
    scene.tick(baseNow);
    assert.strictEqual(pilotEntity.mode, "WARP");
    assert(pilotEntity.warpState, "Warp state should be active");
    assert.deepStrictEqual(
      flattenDestinyPayloadNames(destinationObserverSession.notifications),
      [],
    );

    destinationObserverSession.notifications.length = 0;
    const midWarpNow =
      pilotEntity.warpState.startTimeMs +
      Math.floor(pilotEntity.warpState.durationMs / 2);
    scene.tick(midWarpNow);
    const midWarpNames = flattenDestinyPayloadNames(
      destinationObserverSession.notifications,
    );
    assert(!midWarpNames.includes("AddBalls2"));
    assert(!midWarpNames.includes("WarpTo"));

    destinationObserverSession.notifications.length = 0;
    const completionNow = Math.ceil(
      pilotEntity.warpState.startTimeMs + pilotEntity.warpState.durationMs + 50,
    );
    scene.tick(completionNow);
    const completionNames = flattenDestinyPayloadNames(
      destinationObserverSession.notifications,
    );
    assert(completionNames.includes("AddBalls2"));
    assert(!completionNames.includes("WarpTo"));
    assert(completionNames.includes("SetBallPosition"));
    assert(completionNames.includes("Stop"));

    return {
      midWarpNames,
      completionNames,
    };
  } finally {
    runtime.detachSession(pilotSession, { broadcast: false });
    runtime.detachSession(destinationObserverSession, { broadcast: false });
    runtime.scenes.delete(systemID);
  }
}

function main() {
  const activeEntity = buildFakeEntity("GOTO");
  const idleEntity = buildFakeEntity("STOP");

  const before = {
    correctionMs: testing.WATCHER_CORRECTION_INTERVAL_MS,
    positionMs: testing.WATCHER_POSITION_CORRECTION_INTERVAL_MS,
    positionAnchorsInFirstSecond: countScheduledDispatches(
      testing.WATCHER_POSITION_CORRECTION_INTERVAL_MS,
      1000,
    ),
    velocityCorrectionsInFirstSecond: countScheduledDispatches(
      testing.WATCHER_CORRECTION_INTERVAL_MS,
      1000,
    ),
    commandAnchorPayloads: [],
  };

  const after = {
    correctionMs: testing.getWatcherCorrectionIntervalMs(activeEntity),
    positionMs: testing.getWatcherPositionCorrectionIntervalMs(activeEntity),
    positionAnchorsInFirstSecond: countScheduledDispatches(
      testing.getWatcherPositionCorrectionIntervalMs(activeEntity),
      1000,
    ),
    velocityCorrectionsInFirstSecond: countScheduledDispatches(
      testing.getWatcherCorrectionIntervalMs(activeEntity),
      1000,
    ),
    correctionPayloads: testing
      .buildPositionVelocityCorrectionUpdates(activeEntity, {
        stamp: 123,
        includePosition: true,
      })
      .map((update) => update.payload[0]),
  };

  const idle = {
    correctionMs: testing.getWatcherCorrectionIntervalMs(idleEntity),
    positionMs: testing.getWatcherPositionCorrectionIntervalMs(idleEntity),
  };
  const integration = runDeferredAnchorIntegrationCheck();
  const warpObserver = runWarpObserverCadenceCheck();
  const dynamicVisibility = runDynamicVisibilityCheck();
  const warpMidflightVisibility = runWarpMidflightVisibilityCheck();

  assert.strictEqual(after.correctionMs, 250);
  assert.strictEqual(after.positionMs, 1000);
  assert.deepStrictEqual(after.correctionPayloads, [
    "SetBallPosition",
    "SetBallVelocity",
  ]);
  assert.strictEqual(idle.correctionMs, before.correctionMs);
  assert.strictEqual(idle.positionMs, before.positionMs);
  assert.strictEqual(after.positionAnchorsInFirstSecond, before.positionAnchorsInFirstSecond);
  assert(after.velocityCorrectionsInFirstSecond > before.velocityCorrectionsInFirstSecond);

  console.log(JSON.stringify({
    status: "ok",
    before,
    after,
    idle,
    integration,
    warpObserver,
    dynamicVisibility,
    warpMidflightVisibility,
  }, null, 2));
}

main();
