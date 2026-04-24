const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
  buildSpaceAttachHydrationPlan,
} = require(path.join(__dirname, "../src/space/modules/moduleLoadParity"));

test("space attach hydration profiles keep login/stargate/solar/undock on a delayed HUD-gated real-charge replay while transition retains the shared tuple replay contract", () => {
  const loginPlan = buildSpaceAttachHydrationPlan("login");
  const stargatePlan = buildSpaceAttachHydrationPlan("stargate");
  const solarPlan = buildSpaceAttachHydrationPlan("solar");
  const transitionPlan = buildSpaceAttachHydrationPlan("transition");
  const undockPlan = buildSpaceAttachHydrationPlan("undock");

  assert.equal(loginPlan.profileID, "login");
  assert.equal(loginPlan.useRealChargeInventoryHudRows, true);
  assert.equal(loginPlan.enableChargeDogmaReplay, false);
  assert.equal(loginPlan.emitOnlineEffects, true);
  assert.equal(
    loginPlan.chargeDogmaReplayMode,
    CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
  );
  assert.equal(
    loginPlan.lateChargeDogmaReplayMode,
    CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
  );
  assert.equal(loginPlan.queueModuleReplay, true);
  assert.equal(loginPlan.implicitHudBootstrapDelayMs, 0);
  assert.equal(loginPlan.awaitShipInventoryPrimeBeforeReplay, true);
  assert.equal(loginPlan.awaitPostLoginHudTurretBootstrap, true);
  assert.equal(loginPlan.rememberBlockedChargeHudBootstrap, true);
  assert.equal(loginPlan.syntheticFitTransition, true);
  assert.equal(loginPlan.allowLateFittingReplay, false);
  assert.equal(loginPlan.allowLateChargeRefresh, false);
  assert.equal(loginPlan.lateChargeFinalizeReplayBudget, 0);
  assert.equal(loginPlan.allowMichelleGuardChargeRefresh, false);

  assert.equal(stargatePlan.profileID, "stargate");
  assert.equal(stargatePlan.useRealChargeInventoryHudRows, true);
  assert.equal(stargatePlan.enableChargeDogmaReplay, false);
  assert.equal(stargatePlan.emitOnlineEffects, true);
  assert.equal(stargatePlan.chargeDogmaReplayMode, CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR);
  assert.equal(stargatePlan.lateChargeDogmaReplayMode, CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY);
  assert.equal(stargatePlan.lateChargeFinalizeReplayBudget, 0);
  assert.equal(stargatePlan.implicitHudBootstrapDelayMs, 1750);
  assert.equal(stargatePlan.queueModuleReplay, true);
  assert.equal(stargatePlan.awaitShipInventoryPrimeBeforeReplay, true);
  assert.equal(stargatePlan.awaitPostLoginHudTurretBootstrap, true);
  assert.equal(stargatePlan.rememberBlockedChargeHudBootstrap, true);
  assert.equal(stargatePlan.allowLateFittingReplay, false);
  assert.equal(stargatePlan.allowLateChargeRefresh, false);
  assert.equal(stargatePlan.allowMichelleGuardChargeRefresh, false);

  assert.equal(solarPlan.profileID, "solar");
  assert.equal(solarPlan.useRealChargeInventoryHudRows, true);
  assert.equal(solarPlan.enableChargeDogmaReplay, false);
  assert.equal(solarPlan.emitOnlineEffects, true);
  assert.equal(solarPlan.chargeDogmaReplayMode, CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR);
  assert.equal(solarPlan.lateChargeDogmaReplayMode, CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY);
  assert.equal(solarPlan.lateChargeFinalizeReplayBudget, 0);
  assert.equal(solarPlan.implicitHudBootstrapDelayMs, 1750);
  assert.equal(solarPlan.queueModuleReplay, true);
  assert.equal(solarPlan.awaitShipInventoryPrimeBeforeReplay, true);
  assert.equal(solarPlan.awaitPostLoginHudTurretBootstrap, true);
  assert.equal(solarPlan.rememberBlockedChargeHudBootstrap, true);
  assert.equal(solarPlan.allowLateFittingReplay, false);
  assert.equal(solarPlan.allowLateChargeRefresh, false);
  assert.equal(solarPlan.allowMichelleGuardChargeRefresh, false);

  assert.equal(transitionPlan.profileID, "transition");
  assert.equal(transitionPlan.useRealChargeInventoryHudRows, false);
  assert.equal(transitionPlan.enableChargeDogmaReplay, true);
  assert.equal(transitionPlan.emitOnlineEffects, true);
  assert.equal(
    transitionPlan.chargeDogmaReplayMode,
    CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY,
  );
  assert.equal(transitionPlan.lateChargeDogmaReplayMode, CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY);
  assert.equal(transitionPlan.lateChargeFinalizeReplayBudget, 0);
  assert.equal(transitionPlan.implicitHudBootstrapDelayMs, 0);
  assert.equal(transitionPlan.queueModuleReplay, true);
  assert.equal(transitionPlan.awaitShipInventoryPrimeBeforeReplay, false);
  assert.equal(transitionPlan.awaitPostLoginHudTurretBootstrap, false);
  assert.equal(transitionPlan.rememberBlockedChargeHudBootstrap, true);
  assert.equal(transitionPlan.allowLateFittingReplay, false);
  assert.equal(transitionPlan.allowLateChargeRefresh, false);
  assert.equal(transitionPlan.allowMichelleGuardChargeRefresh, false);

  assert.equal(undockPlan.profileID, "undock");
  assert.equal(undockPlan.useRealChargeInventoryHudRows, true);
  assert.equal(undockPlan.enableChargeDogmaReplay, false);
  assert.equal(undockPlan.emitOnlineEffects, true);
  assert.equal(
    undockPlan.chargeDogmaReplayMode,
    CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
  );
  assert.equal(undockPlan.lateChargeDogmaReplayMode, CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY);
  assert.equal(undockPlan.lateChargeFinalizeReplayBudget, 0);
  assert.equal(undockPlan.implicitHudBootstrapDelayMs, 1750);
  assert.equal(undockPlan.queueModuleReplay, true);
  assert.equal(undockPlan.awaitShipInventoryPrimeBeforeReplay, true);
  assert.equal(undockPlan.awaitPostLoginHudTurretBootstrap, true);
  assert.equal(undockPlan.rememberBlockedChargeHudBootstrap, true);
  assert.equal(undockPlan.allowLateFittingReplay, false);
  assert.equal(undockPlan.allowLateChargeRefresh, false);
  assert.equal(undockPlan.allowMichelleGuardChargeRefresh, false);
});

test("capsule hydration profile keeps module and charge parity bootstrap disabled", () => {
  const capsulePlan = buildSpaceAttachHydrationPlan("capsule");

  assert.equal(capsulePlan.profileID, "capsule");
  assert.equal(capsulePlan.useRealChargeInventoryHudRows, false);
  assert.equal(capsulePlan.enableChargeDogmaReplay, false);
  assert.equal(capsulePlan.emitOnlineEffects, false);
  assert.equal(capsulePlan.queueModuleReplay, false);
  assert.equal(capsulePlan.awaitShipInventoryPrimeBeforeReplay, false);
  assert.equal(capsulePlan.syntheticFitTransition, false);
  assert.equal(capsulePlan.lateChargeDogmaReplayMode, CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY);
  assert.equal(capsulePlan.lateChargeFinalizeReplayBudget, 0);
  assert.equal(capsulePlan.implicitHudBootstrapDelayMs, 0);
  assert.equal(capsulePlan.rememberBlockedChargeHudBootstrap, false);
  assert.equal(capsulePlan.allowLateFittingReplay, false);
  assert.equal(capsulePlan.allowLateChargeRefresh, false);
  assert.equal(capsulePlan.allowMichelleGuardChargeRefresh, false);
});
