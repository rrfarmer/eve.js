// Space attach hydration profiles are behavior buckets, not one profile per
// entrypoint. Current callers in `server/src/space/transitions.js` map to them
// like this:
// - `login`: direct login/restore into space (`restoreSpaceSession`)
// - `stargate`: normal gate jump attach (`completeStargateJump`)
// - `solar`: direct solar-system jump/teleport attach
//   (`jumpSessionToSolarSystem`)
// - `transition`: same-scene / legacy in-space handoffs such as boarding
// - `undock`: station/structure undock attach
// - `capsule`: eject/capsule attach where ship module and charge hydration
//   should stay disabled
//
// If one entry path later needs different sequencing, split out a new profile
// here instead of reintroducing ad-hoc caller conditionals.
const CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR = "prime-and-repair";
const CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR = "quantity-and-repair";
const CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY =
  "repair-then-quantity";
const CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY =
  "prime-repair-then-quantity";
const CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY = "refresh-only";

const SPACE_ATTACH_HYDRATION_PROFILES = Object.freeze({
  login: Object.freeze({
    profileID: "login",
    // Direct login already carries tuple charge state through the packaged
    // client's stock path:
    // `GetAllInfo -> MakeShipActive -> LoadItemsInLocation(shipID)`.
    //
    // The remaining live failure is on the HUD side, not the dogma side:
    // module buttons keep binding to tuple charge rows that never become a
    // stable loaded `svc.godma` item. Fix login by replaying the real loaded
    // charge inventory rows once the HUD exists, not by adding more tuple
    // godma-prime churn.
    useRealChargeInventoryHudRows: true,
    enableChargeDogmaReplay: false,
    emitOnlineEffects: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    implicitHudBootstrapDelayMs: 0,
    queueModuleReplay: true,
    awaitShipInventoryPrimeBeforeReplay: true,
    awaitPostLoginHudTurretBootstrap: true,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  stargate: Object.freeze({
    profileID: "stargate",
    // Stargate jumps land in the same cold-space HUD family as login/solar/
    // undock: keep tuple charge state available for dogma/ammo logic, but let
    // the rack bind to the real loaded charge inventory rows after the HUD
    // exists instead of reopening the older tuple-only HUD lane.
    useRealChargeInventoryHudRows: true,
    enableChargeDogmaReplay: false,
    emitOnlineEffects: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    implicitHudBootstrapDelayMs: 1750,
    queueModuleReplay: true,
    awaitShipInventoryPrimeBeforeReplay: true,
    awaitPostLoginHudTurretBootstrap: true,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  solar: Object.freeze({
    profileID: "solar",
    // Direct /solar jumps are now in the same family as the fixed login lane:
    // keep the stock tuple-backed charge state for dogma/ammo logic, but
    // restate the real loaded charge inventory rows once the HUD exists so the
    // module buttons bind to a stable integer charge item instead of the tuple
    // sublocation key.
    useRealChargeInventoryHudRows: true,
    enableChargeDogmaReplay: false,
    emitOnlineEffects: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    implicitHudBootstrapDelayMs: 1750,
    queueModuleReplay: true,
    awaitShipInventoryPrimeBeforeReplay: true,
    awaitPostLoginHudTurretBootstrap: true,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  solarWarm: Object.freeze({
    profileID: "solarWarm",
    // When the destination scene is already resident we can stay on the
    // real-charge HUD repair lane without making the client wait for the
    // slower cold-scene inventory/HUD bootstrap gates.
    useRealChargeInventoryHudRows: true,
    enableChargeDogmaReplay: false,
    emitOnlineEffects: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    implicitHudBootstrapDelayMs: 0,
    queueModuleReplay: true,
    awaitShipInventoryPrimeBeforeReplay: false,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  transition: Object.freeze({
    profileID: "transition",
    useRealChargeInventoryHudRows: false,
    emitOnlineEffects: true,
    // Same-scene boarding already keeps the live ballpark and active ship
    // inventory on-grid. Waiting for a later ship-inventory prime here can
    // strand probe launchers without their tuple-backed loaded charge until
    // some unrelated inventory call happens.
    enableChargeDogmaReplay: true,
    // Probe launchers are especially sensitive here: the client wants the
    // tuple charge row repaired before the follow-up quantity lands, otherwise
    // `scanSvc` can fail to see a stable loaded charge on the freshly boarded
    // ship even though the launcher is fitted and online.
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    implicitHudBootstrapDelayMs: 0,
    queueModuleReplay: true,
    awaitShipInventoryPrimeBeforeReplay: false,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  undock: Object.freeze({
    profileID: "undock",
    // Undock is also on the real-HUD charge-row lane now. The stock tuple
    // charge state remains available for dogma/ammo logic, but the first HUD
    // bootstrap must replay the real loaded charge rows instead of reopening
    // tuple godma-prime churn.
    useRealChargeInventoryHudRows: true,
    enableChargeDogmaReplay: false,
    emitOnlineEffects: true,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    implicitHudBootstrapDelayMs: 1750,
    queueModuleReplay: true,
    awaitShipInventoryPrimeBeforeReplay: true,
    awaitPostLoginHudTurretBootstrap: true,
    rememberBlockedChargeHudBootstrap: true,
    syntheticFitTransition: true,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
  capsule: Object.freeze({
    profileID: "capsule",
    useRealChargeInventoryHudRows: false,
    enableChargeDogmaReplay: false,
    emitOnlineEffects: false,
    chargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
    lateChargeDogmaReplayMode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    lateChargeFinalizeReplayBudget: 0,
    implicitHudBootstrapDelayMs: 0,
    queueModuleReplay: false,
    awaitShipInventoryPrimeBeforeReplay: false,
    awaitPostLoginHudTurretBootstrap: false,
    rememberBlockedChargeHudBootstrap: false,
    syntheticFitTransition: false,
    allowLateFittingReplay: false,
    allowLateChargeRefresh: false,
    allowMichelleGuardChargeRefresh: false,
  }),
});

function normalizeOptionalBoolean(value, defaultValue) {
  return value === undefined ? defaultValue : value === true;
}

function normalizeOptionalNonNegativeInteger(value, defaultValue) {
  if (value === undefined || value === null) {
    return Math.max(0, Number(defaultValue) || 0);
  }
  return Math.max(0, Number(value) || 0);
}

function buildSpaceAttachHydrationPlan(profileName = "transition", overrides = {}) {
  const baseProfile =
    SPACE_ATTACH_HYDRATION_PROFILES[profileName] ||
    SPACE_ATTACH_HYDRATION_PROFILES.transition;
  const enableChargeDogmaReplay = normalizeOptionalBoolean(
    overrides.enableChargeDogmaReplay,
    baseProfile.enableChargeDogmaReplay,
  );
  const queueModuleReplay = normalizeOptionalBoolean(
    overrides.queueModuleReplay,
    baseProfile.queueModuleReplay,
  );
  const useRealChargeInventoryHudRows = normalizeOptionalBoolean(
    overrides.useRealChargeInventoryHudRows,
    baseProfile.useRealChargeInventoryHudRows,
  );
  const emitOnlineEffects = normalizeOptionalBoolean(
    overrides.emitOnlineEffects,
    baseProfile.emitOnlineEffects,
  );

  return {
    profileID: baseProfile.profileID,
    useRealChargeInventoryHudRows,
    enableChargeDogmaReplay,
    emitOnlineEffects,
    chargeDogmaReplayMode:
      overrides.chargeDogmaReplayMode ||
      baseProfile.chargeDogmaReplayMode,
    lateChargeDogmaReplayMode:
      overrides.lateChargeDogmaReplayMode ||
      baseProfile.lateChargeDogmaReplayMode ||
      CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
    implicitHudBootstrapDelayMs: normalizeOptionalNonNegativeInteger(
      overrides.implicitHudBootstrapDelayMs,
      baseProfile.implicitHudBootstrapDelayMs,
    ),
    queueModuleReplay,
    awaitShipInventoryPrimeBeforeReplay: normalizeOptionalBoolean(
      overrides.awaitShipInventoryPrimeBeforeReplay,
      baseProfile.awaitShipInventoryPrimeBeforeReplay,
    ),
    awaitPostLoginHudTurretBootstrap: normalizeOptionalBoolean(
      overrides.awaitPostLoginHudTurretBootstrap,
      baseProfile.awaitPostLoginHudTurretBootstrap,
    ),
    rememberBlockedChargeHudBootstrap: normalizeOptionalBoolean(
      overrides.rememberBlockedChargeHudBootstrap,
      baseProfile.rememberBlockedChargeHudBootstrap,
    ),
    syntheticFitTransition: normalizeOptionalBoolean(
      overrides.syntheticFitTransition,
      baseProfile.syntheticFitTransition,
    ),
    allowLateFittingReplay:
      queueModuleReplay &&
      normalizeOptionalBoolean(
        overrides.allowLateFittingReplay,
        baseProfile.allowLateFittingReplay,
      ),
    allowLateChargeRefresh:
      enableChargeDogmaReplay &&
      normalizeOptionalBoolean(
        overrides.allowLateChargeRefresh,
        baseProfile.allowLateChargeRefresh,
      ),
    lateChargeFinalizeReplayBudget:
      enableChargeDogmaReplay &&
      normalizeOptionalBoolean(
        overrides.allowLateChargeRefresh,
        baseProfile.allowLateChargeRefresh,
      )
        ? normalizeOptionalNonNegativeInteger(
            overrides.lateChargeFinalizeReplayBudget,
            baseProfile.lateChargeFinalizeReplayBudget,
          )
        : 0,
    allowMichelleGuardChargeRefresh:
      enableChargeDogmaReplay &&
      normalizeOptionalBoolean(
        overrides.allowMichelleGuardChargeRefresh,
        baseProfile.allowMichelleGuardChargeRefresh,
      ),
  };
}

module.exports = {
  CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
  SPACE_ATTACH_HYDRATION_PROFILES,
  buildSpaceAttachHydrationPlan,
};
