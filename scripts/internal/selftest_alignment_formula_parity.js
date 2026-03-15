const assert = require("assert");
const path = require("path");

const runtime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));
const worldData = require(path.join(
  __dirname,
  "../../server/src/space/worldData",
));

function approxEqual(left, right, epsilon = 0.01) {
  return Math.abs(Number(left) - Number(right)) <= epsilon;
}

function magnitude(vector) {
  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

const fakeSession = {
  characterID: 140000001,
  corporationID: 1000169,
  allianceID: 0,
  warFactionID: 0,
  shipName: "Alignment Probe",
};

function buildEntity(typeID, overrides = {}) {
  return runtime._testing.buildShipEntityForTesting(
    fakeSession,
    {
      itemID: 980000000000 + typeID,
      typeID,
      ownerID: fakeSession.characterID,
      groupID: 25,
      categoryID: 6,
      itemName: `Probe ${typeID}`,
      radius: 50,
      spaceState: {
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        direction: { x: -1, y: 0, z: 0 },
        targetPoint: { x: 1_000_000, y: 0, z: 0 },
        speedFraction: 0,
        mode: "STOP",
        ...overrides.spaceState,
      },
      ...overrides.shipItem,
    },
    30000142,
  );
}

function simulateToTime(entity, seconds, desiredDirection, desiredSpeed, stepSeconds = 0.05) {
  let elapsed = 0;
  while (elapsed < seconds) {
    const delta = Math.min(stepSeconds, seconds - elapsed);
    runtime._testing.applyDesiredVelocityForTesting(
      entity,
      desiredDirection,
      desiredSpeed,
      delta,
    );
    elapsed += delta;
  }
}

function main() {
  const omenMovement = worldData.getMovementAttributesForType(2006);
  assert(omenMovement, "Omen movement profile is required for alignment parity self-test");

  const derivedTau = runtime._testing.deriveAgilitySecondsForTesting(
    omenMovement.alignTime,
    omenMovement.maxAccelerationTime,
    omenMovement.mass,
    omenMovement.inertia,
  );
  const officialTau = (omenMovement.mass * omenMovement.inertia) / 1_000_000;
  assert(
    approxEqual(derivedTau, officialTau, 1e-9),
    `Derived tau mismatch: expected ${officialTau}, got ${derivedTau}`,
  );

  const expectedAlignTime = officialTau * Math.log(4);
  assert(
    approxEqual(expectedAlignTime, omenMovement.alignTime, 1e-6),
    `Official align-time mismatch: expected ${omenMovement.alignTime}, got ${expectedAlignTime}`,
  );

  const fromRest = buildEntity(2006);
  simulateToTime(
    fromRest,
    omenMovement.alignTime,
    { x: 1, y: 0, z: 0 },
    fromRest.maxVelocity,
  );
  const fromRestSpeedFraction = magnitude(fromRest.velocity) / fromRest.maxVelocity;
  assert(
    approxEqual(fromRestSpeedFraction, 0.75, 0.01),
    `From-rest align fraction mismatch: expected 0.75, got ${fromRestSpeedFraction}`,
  );

  const warpGateEntity = buildEntity(2006, {
    spaceState: {
      direction: { x: 1, y: 0, z: 0 },
      velocity: { x: -195, y: 0, z: 0 },
      mode: "WARP",
      speedFraction: 0.75,
    },
  });
  warpGateEntity.pendingWarp = {
    requestedAtMs: Date.now() - 1000,
    targetPoint: { x: 1_000_000, y: 0, z: 0 },
    stopDistance: 0,
    totalDistance: 1_000_000,
  };
  const blockedWarp = runtime._testing.evaluatePendingWarpForTesting(
    warpGateEntity,
    warpGateEntity.pendingWarp,
    Date.now(),
  );
  assert.strictEqual(
    blockedWarp.ready,
    false,
    "Warp should not be ready when the real movement vector is still opposite the target",
  );

  warpGateEntity.velocity = scaleVector({ x: 1, y: 0, z: 0 }, warpGateEntity.maxVelocity * 0.75);
  const readyWarp = runtime._testing.evaluatePendingWarpForTesting(
    warpGateEntity,
    warpGateEntity.pendingWarp,
    Date.now(),
  );
  assert.strictEqual(
    readyWarp.ready,
    true,
    "Warp should be ready once the real movement vector reaches the 75% aligned threshold",
  );

  console.log(JSON.stringify({
    ok: true,
    officialTau,
    expectedAlignTime,
    storedAlignTime: omenMovement.alignTime,
    fromRestSpeedFraction,
    blockedWarp,
    readyWarp,
  }, null, 2));
}

main();
