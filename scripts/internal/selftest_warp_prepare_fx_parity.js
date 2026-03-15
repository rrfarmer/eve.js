const assert = require("assert");
const path = require("path");

const destiny = require(path.join(
  __dirname,
  "../../server/src/space/destiny",
));
const runtime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));

function unwrapMarshalReal(value) {
  if (value && typeof value === "object" && value.type === "real") {
    return Number(value.value);
  }
  return Number(value);
}

const fakeSession = {
  characterID: 140000001,
  corporationID: 1000169,
  allianceID: 0,
  warFactionID: 0,
  shipName: "Parity Probe",
};

const shipItem = {
  itemID: 940000001,
  typeID: 606,
  ownerID: 140000001,
  groupID: 25,
  categoryID: 6,
  itemName: "Velator",
  radius: 40,
  spaceState: {
    systemID: 30000142,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 210, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x: 1000000, y: 0, z: 0 },
    speedFraction: 0.75,
    mode: "GOTO",
  },
};

const entity = runtime._testing.buildShipEntityForTesting(
  fakeSession,
  shipItem,
  30000142,
);

const warpState = {
  rawDestination: { x: 5_000_000, y: 1000, z: 2500 },
  targetPoint: { x: 4_998_500, y: 1000, z: 2500 },
  stopDistance: 1500,
  warpSpeed: Math.round(entity.warpSpeedAU * 10),
  effectStamp: 123456,
  totalDistance: 4_998_500,
};

const prepareDispatch = runtime._testing.buildWarpPrepareDispatchForTesting(
  entity,
  123456,
  warpState,
);
const pilotPrepareNames = prepareDispatch.pilotUpdates.map((update) => update.payload[0]);
const sharedPrepareNames = prepareDispatch.sharedUpdates.map((update) => update.payload[0]);

assert.deepStrictEqual(sharedPrepareNames, ["WarpTo", "SetSpeedFraction"]);
assert.deepStrictEqual(
  pilotPrepareNames,
  ["SetMaxSpeed", "WarpTo", "SetSpeedFraction"],
);

const pilotActivationUpdates =
  runtime._testing.buildPilotWarpActivationStateRefreshUpdatesForTesting(
    entity,
    123456,
  );
const pilotActivationRefreshNames = pilotActivationUpdates.map(
  (update) => update.payload[0],
);
assert.deepStrictEqual(pilotActivationRefreshNames, ["AddBalls2"]);

const pilotActivationHandoffUpdates =
  runtime._testing.buildPilotWarpActivationUpdatesForTesting(
    entity,
    123456,
    warpState,
  );
const pilotActivationNames = pilotActivationHandoffUpdates.map(
  (update) => update.payload[0],
);
assert.deepStrictEqual(
  pilotActivationNames,
  ["SetBallVelocity", "WarpTo", "SetMaxSpeed", "OnSpecialFX", "SetBallMassive"],
);
const activationVelocityArgs = pilotActivationHandoffUpdates[0].payload[1];
const activationVelocityMagnitude = Math.sqrt(
  (unwrapMarshalReal(activationVelocityArgs[1]) ** 2) +
    (unwrapMarshalReal(activationVelocityArgs[2]) ** 2) +
    (unwrapMarshalReal(activationVelocityArgs[3]) ** 2),
);
assert(
  activationVelocityMagnitude > (entity.maxVelocity * 0.75),
  "Activation velocity should sit above the native 0.75 * subwarp max gate",
);
const activationSetMaxSpeedArgs = pilotActivationHandoffUpdates[2].payload[1];
assert(
  unwrapMarshalReal(activationSetMaxSpeedArgs[1]) > activationVelocityMagnitude,
  "Activation kickoff SetMaxSpeed should restore a higher local warp-speed ceiling after WarpTo",
);

entity.mode = "WARP";
entity.targetPoint = { ...warpState.targetPoint };
entity.warpState = {
  ...warpState,
};
const warpBallSummary = destiny.debugDescribeEntityBall(entity).summary.modeData;
assert.deepStrictEqual(
  warpBallSummary.targetPoint,
  warpState.targetPoint,
  "Raw mode-3 goto should stay on the stop-adjusted warp target",
);
assert.notDeepStrictEqual(
  warpBallSummary.targetPoint,
  warpState.rawDestination,
  "Raw mode-3 goto should not silently switch to rawDestination",
);

const warpFxPayload =
  runtime._testing.buildWarpStartEffectUpdateForTesting(entity, 123456).payload;
assert.strictEqual(warpFxPayload[0], "OnSpecialFX");
assert.strictEqual(warpFxPayload[1].length, 14);
assert.strictEqual(warpFxPayload[1][5], "effects.Warping");
assert.strictEqual(warpFxPayload[1][8], 0);
assert.strictEqual(warpFxPayload[1][12], 0);

const sparseFxPayload = destiny.buildOnSpecialFXPayload(9001, "effects.Test", {
  startTime: 77,
});
assert.strictEqual(sparseFxPayload[1].length, 14);
assert.strictEqual(sparseFxPayload[1][9], -1);
assert.strictEqual(sparseFxPayload[1][10], null);
assert.strictEqual(sparseFxPayload[1][11], 77);
assert.strictEqual(sparseFxPayload[1][12], 0);
assert.strictEqual(sparseFxPayload[1][13], null);

console.log(
  JSON.stringify(
    {
      pilotPrepareNames,
      sharedPrepareNames,
      pilotActivationRefreshNames,
      pilotActivationNames,
      activationVelocityMagnitude,
      warpBallTargetPoint: warpBallSummary.targetPoint,
      warpFxArgs: warpFxPayload[1],
      sparseFxArgs: sparseFxPayload[1],
    },
    null,
    2,
  ),
);
