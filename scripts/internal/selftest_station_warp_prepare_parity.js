const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));
const {
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));

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

function approxEqual(left, right, epsilon = 0.001) {
  return Math.abs(Number(left) - Number(right)) <= epsilon;
}

function assertVectorClose(actual, expected, label) {
  assert(approxEqual(actual.x, expected.x), `${label}.x mismatch`);
  assert(approxEqual(actual.y, expected.y), `${label}.y mismatch`);
  assert(approxEqual(actual.z, expected.z), `${label}.z mismatch`);
}

function main() {
  const systemID = 30000142;
  const stationID = 60003760;
  const sourceShip = getActiveShipRecord(140000001);
  assert(sourceShip, "No active ship available for self-test character 140000001");

  const ship = {
    ...sourceShip,
    itemID: 990000000101,
    itemName: "Warp Prepare Audit Probe",
    spaceState: {
      position: {
        x: -107303362560,
        y: -18744975360,
        z: 436789052160,
      },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      targetPoint: {
        x: -107303362560,
        y: -18744975360,
        z: 436689052160,
      },
      speedFraction: 0,
      mode: "STOP",
    },
  };

  const session = {
    clientID: 990000000101,
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

    const station = scene.getEntityByID(stationID);
    assert(station, `Station ${stationID} not found`);

    const stationSlim = destiny.buildSlimItemDict(station);
    const slimKeys = stationSlim.entries.map(([key]) => key);
    assert.strictEqual(station.dunRotation, null, "Station should not emit synthesized dunRotation");
    assert(slimKeys.includes("activityLevel"), "Station slim should include activityLevel");
    assert(!slimKeys.includes("dunRotation"), "Station slim should not include fabricated dunRotation");

    const requestUpdateBuffer = [];
    scene.broadcastMovementUpdates = (updates) => {
      requestUpdateBuffer.push(...updates.map((update) => update.payload[0]));
    };

    const warpResult = runtime.warpToEntity(session, stationID, { minimumRange: 0 });
    assert.strictEqual(warpResult.success, true, "Warp request should succeed");

    const entity = runtime.getEntity(session, ship.itemID);
    assert(entity, "Warping ship entity not found");
    assert.strictEqual(entity.mode, "WARP", "Pre-warp ship mode should be WARP");
    assert(entity.warpState, "Pre-warp state should exist");
    assert.strictEqual(entity.warpState.effectStamp, -1, "Pre-warp effectStamp should be -1");
    assert(entity.pendingWarp, "Pending warp should remain armed during prepare phase");
    assertVectorClose(
      entity.pendingWarp.rawDestination,
      station.dockPosition,
      "station warp rawDestination",
    );
    const requestUpdates = [...requestUpdateBuffer];
    const preWarpEffectStamp = entity.warpState.effectStamp;
    assert.deepStrictEqual(
      requestUpdates,
      ["WarpTo", "SetSpeedFraction"],
      "Warp prepare request should emit WarpTo plus SetSpeedFraction",
    );

    session._space.initialStateSent = true;
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

    const activationUpdates = [];
    scene.sendDestinyUpdates = (_session, updates) => {
      activationUpdates.push(...updates.map((update) => update.payload[0]));
    };
    scene.sendDestinyUpdatesIndividually = (_session, updates) => {
      activationUpdates.push(...updates.map((update) => update.payload[0]));
    };
    scene.tick(Date.now() + 1000);

    assert(
      activationUpdates.includes("AddBalls2"),
      "Pilot activation should refresh the ego raw ball state with AddBalls2",
    );
    assert(
      !activationUpdates.includes("SetState"),
      "Pilot activation should not replay ego SetState during active warp handoff",
    );
    assert(
      activationUpdates.includes("SetMaxSpeed"),
      "Pilot activation should restore one same-tick post-WarpTo maxVelocity kickoff",
    );
    assert(
      activationUpdates.includes("WarpTo"),
      "Pilot activation should explicitly replay WarpTo for the existing ego ball",
    );
    assert(
      activationUpdates.includes("OnSpecialFX"),
      "Activation should emit OnSpecialFX",
    );
    assert(
      activationUpdates.includes("SetBallVelocity"),
      "Pilot activation should emit a one-shot native activation velocity floor",
    );
    assert(
      activationUpdates.includes("SetBallMassive"),
      "Pilot activation should emit SetBallMassive",
    );
    assert(
      activationUpdates.indexOf("WarpTo") < activationUpdates.indexOf("SetMaxSpeed"),
      "Activation should evaluate WarpTo before restoring the local warp-speed ceiling",
    );
    console.log(JSON.stringify({
      ok: true,
      stationSlimKeys: slimKeys,
      requestUpdates,
      activationUpdates,
      stationDockPosition: station.dockPosition,
      preWarpEffectStamp,
    }, null, 2));
  } finally {
    if (scene && session._space) {
      runtime.detachSession(session, { broadcast: false });
    }
  }
}

main();
