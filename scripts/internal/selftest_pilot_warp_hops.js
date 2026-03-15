const path = require("path");
const assert = require("assert");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));

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

function main() {
  const systemID = 30000142;
  const pilotSession = createFakeSession(914001, 924001, systemID);
  const observerSession = createFakeSession(914002, 924002, systemID);
  const warpTarget = { x: 3.0e12, y: 0, z: 0 };
  const pilotShip = {
    itemID: 934001,
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
    itemID: 934002,
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
    assert(pilotEntity, "Pilot entity should exist");
    pilotEntity.direction = { x: 1, y: 0, z: 0 };
    pilotEntity.targetPoint = { x: 1.0e16, y: 0, z: 0 };
    pilotEntity.speedFraction = 1;
    pilotEntity.velocity = { x: 0, y: 0, z: 0 };
    pilotEntity.mode = "STOP";

    const warpResult = runtime.warpToPoint(pilotSession, warpTarget, {
      targetEntityID: 40009116,
      stopDistance: 0,
      warpSpeedAU: 3,
    });
    assert.strictEqual(warpResult.success, true);
    assert(pilotEntity.pendingWarp, "Pending warp should exist");
    pilotEntity.pendingWarp.requestedAtMs = baseNow;

    scene.tick(baseNow);
    assert(pilotEntity.pendingWarp, "Pending warp should still be preparing");
    assert.strictEqual(pilotEntity.mode, "WARP");
    const pilotPreWarpNames = flattenDestinyPayloadNames(pilotSession.notifications);
    assert(
      !pilotPreWarpNames.includes("SetBallPosition"),
      "Pilot should not receive authoritative warp hops during prepare alignment",
    );
    assert(
      !pilotPreWarpNames.includes("SetBallVelocity"),
      "Pilot should not receive authoritative warp hop velocity during prepare alignment",
    );

    pilotEntity.pendingWarp.requestedAtMs = baseNow - 30000;
    pilotSession.notifications.length = 0;
    observerSession.notifications.length = 0;
    scene.tick(baseNow + 1000);
    assert.strictEqual(pilotEntity.mode, "WARP");
    assert(pilotEntity.warpState, "Warp state should be active");

    pilotSession.notifications.length = 0;
    observerSession.notifications.length = 0;
    scene.tick(baseNow + 2000);

    const pilotMidWarpNames = flattenDestinyPayloadNames(pilotSession.notifications);
    const observerMidWarpNames = flattenDestinyPayloadNames(observerSession.notifications);
    assert(
      !pilotMidWarpNames.includes("SetBallPosition"),
      "Pilot should not receive authoritative mid-warp SetBallPosition hops",
    );
    assert(
      !pilotMidWarpNames.includes("SetBallVelocity"),
      "Pilot should not receive authoritative mid-warp SetBallVelocity hops",
    );
    assert(
      !observerMidWarpNames.includes("SetBallPosition"),
      "Observers should not receive mid-warp SetBallPosition hops",
    );
    assert(
      !observerMidWarpNames.includes("SetBallVelocity"),
      "Observers should not receive mid-warp SetBallVelocity hops",
    );

    console.log(JSON.stringify({
      status: "ok",
      pilotPreWarpNames,
      pilotMidWarpNames,
      observerMidWarpNames,
    }, null, 2));
  } finally {
    runtime.detachSession(pilotSession, { broadcast: false });
    runtime.detachSession(observerSession, { broadcast: false });
    runtime.scenes.delete(systemID);
  }
}

main();
