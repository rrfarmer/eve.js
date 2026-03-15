const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const {
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));

const ONE_AU_IN_METERS = 149597870700;

function normalizeVector(vector, fallback = { x: 0, y: 0, z: -1 }) {
  const source = vector || fallback;
  const length = Math.sqrt((source.x ** 2) + (source.y ** 2) + (source.z ** 2));
  if (!Number.isFinite(length) || length <= 0) {
    return { ...fallback };
  }
  return {
    x: source.x / length,
    y: source.y / length,
    z: source.z / length,
  };
}

function main() {
  const systemID = 30000142;
  const sourceShip = getActiveShipRecord(140000001);
  assert(sourceShip, "No active ship available for self-test character 140000001");

  const ship = {
    ...sourceShip,
    itemID: 990000000202,
    itemName: "Warp Completion Batch Probe",
    spaceState: {
      position: {
        x: -2_277_970_206_187.1675,
        y: -397_938_916_253.78687,
        z: 3_227_279_292_548.3564,
      },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      targetPoint: {
        x: -2_277_970_206_187.1675,
        y: -397_938_916_253.78687,
        z: 3_227_279_192_548.3564,
      },
      speedFraction: 0,
      mode: "STOP",
    },
  };

  const session = {
    clientID: 990000000202,
    characterID: 140000001,
    characterName: "Audit",
    shipName: ship.itemName,
    corporationID: 0,
    allianceID: 0,
    warFactionID: 0,
    socket: { destroyed: false },
    sendNotification() {},
  };

  let scene = null;
  try {
    scene = runtime.ensureScene(systemID);
    runtime.attachSession(session, ship, {
      systemID,
      spawnStopped: true,
      skipLegacyStationNormalization: true,
    });
    session._space.initialStateSent = true;

    const capturedPilotBatches = [];
    scene.sendDestinyUpdates = (_session, updates) => {
      capturedPilotBatches.push(
        updates.map((update) => ({
          stamp: update.stamp,
          name: update.payload[0],
        })),
      );
    };
    scene.broadcastMovementUpdates = () => {};

    const warpTarget = {
      x: ship.spaceState.position.x,
      y: ship.spaceState.position.y,
      z: ship.spaceState.position.z - (0.00003 * ONE_AU_IN_METERS),
    };
    const warpResult = runtime.warpToPoint(session, warpTarget, {
      minimumRange: 0,
      stopDistance: 1500,
      warpSpeedAU: 3,
    });
    assert.strictEqual(warpResult.success, true, "Short warp request should succeed");

    const entity = runtime.getEntity(session, ship.itemID);
    assert(entity && entity.pendingWarp, "Pending short warp should exist");

    const alignDirection = normalizeVector({
      x: entity.pendingWarp.targetPoint.x - entity.position.x,
      y: entity.pendingWarp.targetPoint.y - entity.position.y,
      z: entity.pendingWarp.targetPoint.z - entity.position.z,
    });
    entity.direction = alignDirection;
    entity.velocity = {
      x: alignDirection.x * entity.maxVelocity,
      y: alignDirection.y * entity.maxVelocity,
      z: alignDirection.z * entity.maxVelocity,
    };

    scene.tick(Date.now() + 1000);
    assert(entity.warpState, "Activated short warp should have a warpState");

    capturedPilotBatches.length = 0;
    const completionNow = Math.ceil(
      entity.warpState.startTimeMs + entity.warpState.durationMs + 100,
    );
    scene.tick(completionNow);

    const completionBatches = capturedPilotBatches.filter((batch) =>
      batch.some((entry) => entry.name === "Stop"),
    );
    assert.strictEqual(
      completionBatches.length,
      1,
      "Pilot completion handoff should arrive as one same-stamp Destiny batch",
    );

    const completionNames = completionBatches[0].map((entry) => entry.name);
    assert.deepStrictEqual(
      completionNames,
      [
        "SetSpeedFraction",
        "SetBallPosition",
        "SetBallVelocity",
        "Stop",
        "SetMaxSpeed",
      ],
      "Pilot completion batch should keep the stop/reset payloads and max-speed reset together",
    );

    console.log(JSON.stringify({
      ok: true,
      completionStamp: completionBatches[0][0].stamp,
      completionNames,
    }, null, 2));
  } finally {
    if (scene && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
  }
}

main();
