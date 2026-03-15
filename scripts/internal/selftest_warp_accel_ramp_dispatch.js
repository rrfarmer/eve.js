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

function unwrapMarshalReal(value) {
  if (value && typeof value === "object" && value.type === "real") {
    return Number(value.value);
  }
  return Number(value);
}

function approxEqual(left, right, epsilon = 1) {
  return Math.abs(Number(left) - Number(right)) <= epsilon;
}

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

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function magnitude(vector) {
  const source = vector || { x: 0, y: 0, z: 0 };
  return Math.sqrt((source.x ** 2) + (source.y ** 2) + (source.z ** 2));
}

function main() {
  const systemID = 30000142;
  const sourceShip = getActiveShipRecord(140000001);
  assert(sourceShip, "No active ship available for self-test character 140000001");

  const ship = {
    ...sourceShip,
    itemID: 990000000201,
    itemName: "Warp Ramp Audit Probe",
    spaceState: {
      position: {
        x: -3_487_431_105_674.6523,
        y: 4_569_656_643_034.636,
        z: 2_555_351_895_703.373,
      },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      targetPoint: {
        x: -3_487_431_105_674.6523,
        y: 4_569_656_643_034.636,
        z: 2_555_351_795_703.373,
      },
      speedFraction: 0,
      mode: "STOP",
    },
  };

  const session = {
    clientID: 990000000201,
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

    const capturedUpdates = [];
    scene.sendDestinyUpdates = (_session, updates) => {
      capturedUpdates.push(...updates.map((update) => ({
        stamp: update.stamp,
        name: update.payload[0],
        args: update.payload[1],
      })));
    };
    scene.broadcastMovementUpdates = () => {};

    const warpTarget = {
      x: ship.spaceState.position.x,
      y: ship.spaceState.position.y,
      z: ship.spaceState.position.z - (40 * ONE_AU_IN_METERS),
    };
    const warpResult = runtime.warpToPoint(session, warpTarget, {
      minimumRange: 0,
      stopDistance: 1500,
      warpSpeedAU: 4,
    });
    assert.strictEqual(warpResult.success, true, "Warp request should succeed");

    const prepareSetMaxSpeed = capturedUpdates.find((update) => update.name === "SetMaxSpeed");
    assert(prepareSetMaxSpeed, "Prepare phase should emit a pilot SetMaxSpeed seed");
    const prepareSeedSpeed = unwrapMarshalReal(prepareSetMaxSpeed.args[1]);
    assert(prepareSeedSpeed > 0, "Prepare seed speed should be positive");

    const entity = runtime.getEntity(session, ship.itemID);
    assert(entity, "Warping ship entity not found");
    assert(entity.pendingWarp, "Pending warp should be armed after warp request");

    const alignDirection = normalizeVector({
      x: entity.pendingWarp.targetPoint.x - entity.position.x,
      y: entity.pendingWarp.targetPoint.y - entity.position.y,
      z: entity.pendingWarp.targetPoint.z - entity.position.z,
    });
    entity.direction = alignDirection;
    entity.velocity = scaleVector(alignDirection, entity.maxVelocity);

    capturedUpdates.length = 0;
    scene.tick(Date.now());

    assert(entity.warpState, "Warp state should exist after activation");
    const activationServerVelocityMs = Math.sqrt(
      (entity.velocity.x ** 2) +
        (entity.velocity.y ** 2) +
        (entity.velocity.z ** 2),
    );
    assert(
      approxEqual(
        activationServerVelocityMs,
        entity.maxVelocity,
      ),
      "Activation velocity should now be seeded from the real pre-warp carryover speed",
    );
    assert.deepStrictEqual(
      entity.warpState.pilotMaxSpeedRamp,
      [],
      "Activated warp should not schedule pilot-only in-warp SetMaxSpeed ramp updates",
    );
    assert.strictEqual(
      entity.warpState.cruiseBumpStamp,
      0,
      "Activated warp should not schedule a pilot cruise-speed handoff",
    );
    assert.strictEqual(
      entity.warpState.cruiseBumpAtMs,
      0,
      "Activated warp should not schedule a pilot cruise-speed timestamp",
    );
    const activationSetMaxSpeeds = capturedUpdates.filter(
      (update) => update.name === "SetMaxSpeed",
    );
    assert.strictEqual(
      activationSetMaxSpeeds.length,
      1,
      "Activation should emit exactly one post-WarpTo pilot SetMaxSpeed kickoff",
    );
    const activationVelocityUpdate = capturedUpdates.find(
      (update) => update.name === "SetBallVelocity",
    );
    assert(
      activationVelocityUpdate,
      "Activation should emit a one-shot velocity floor update",
    );
    const activationVelocity = {
      x: unwrapMarshalReal(activationVelocityUpdate.args[1]),
      y: unwrapMarshalReal(activationVelocityUpdate.args[2]),
      z: unwrapMarshalReal(activationVelocityUpdate.args[3]),
    };
    const activationVelocityMs = magnitude(activationVelocity);
    assert(
      activationVelocityMs > (entity.maxVelocity * 0.75),
      "Activation velocity floor should clear the native 0.75 * subwarp max gate",
    );
    const warpToIndex = capturedUpdates.findIndex((update) => update.name === "WarpTo");
    const velocityIndex = capturedUpdates.findIndex((update) => update.name === "SetBallVelocity");
    const setMaxSpeedIndex = capturedUpdates.findIndex(
      (update) => update.name === "SetMaxSpeed",
    );
    const fxIndex = capturedUpdates.findIndex((update) => update.name === "OnSpecialFX");
    assert(
      velocityIndex >= 0 && velocityIndex < warpToIndex,
      "Activation velocity floor should arrive before WarpTo on the same tick",
    );
    assert(
      warpToIndex >= 0 && warpToIndex < setMaxSpeedIndex,
      "Activation WarpTo should evaluate before the one-shot kickoff SetMaxSpeed",
    );
    assert(
      setMaxSpeedIndex >= 0 && setMaxSpeedIndex < fxIndex,
      "Activation kickoff SetMaxSpeed should restore the local warp-speed ceiling before FX starts",
    );
    const activationUpdateNames = capturedUpdates.map((update) => update.name);

    capturedUpdates.length = 0;
    scene.tick(entity.warpState.startTimeMs + entity.warpState.accelTimeMs + 500);

    const inWarpSetMaxSpeed = capturedUpdates.find((update) => update.name === "SetMaxSpeed");
    assert.strictEqual(
      inWarpSetMaxSpeed,
      undefined,
      "Pilot should not receive later in-warp SetMaxSpeed guidance after activation",
    );

    console.log(JSON.stringify({
      ok: true,
      prepareSeedSpeed,
      activationVelocityMs,
      pilotMaxSpeedRamp: entity.warpState.pilotMaxSpeedRamp,
      cruiseBumpAtMs: entity.warpState.cruiseBumpAtMs,
      cruiseBumpStamp: entity.warpState.cruiseBumpStamp,
      activationUpdates: activationUpdateNames,
    }, null, 2));
  } finally {
    if (scene && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
  }
}

main();
