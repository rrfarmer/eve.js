const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildSpaceAttachHydrationPlan,
} = require(path.join(__dirname, "./moduleLoadParity"));
const {
  buildShipModuleParityManifest,
  shouldEnableLateFittedReplayForManifest,
} = require(path.join(__dirname, "./moduleClientParityAuthority"));

function queuePostSpaceAttachFittingHydration(
  session,
  shipID,
  options = {},
) {
  const {
    describeSessionHydrationState,
    requestPendingShipFittingReplayFromHud,
    tryFlushPendingShipFittingReplay,
    tryFlushPendingShipChargeDogmaReplay,
  } = require(path.join(__dirname, "../../services/chat/commandSessionEffects"));
  const {
    clearDeferredDockedShipSessionChange,
    clearDeferredDockedFittingReplay,
  } = require(path.join(__dirname, "../../services/character/characterState"));

  if (!session || !session._space) {
    return false;
  }

  // Once we are attaching a live in-space session, any leftover docked-only
  // ship/fitting replay state is stale. Keeping it around lets later dogma or
  // inventory callbacks flush a hangar repair back into space.
  clearDeferredDockedShipSessionChange(session);
  clearDeferredDockedFittingReplay(session);

  const resolvedShipID =
    Number(shipID) ||
    Number(
      session._space.shipID ||
      session.activeShipID ||
      session.shipID ||
      session.shipid ||
      0,
    ) ||
    0;
  if (resolvedShipID <= 0) {
    return false;
  }

  const resolvedCharacterID =
    Number(
      session.characterID ||
      session.charid ||
      session.userid ||
      0,
    ) || 0;
  const moduleParityManifest = buildShipModuleParityManifest(
    resolvedCharacterID,
    resolvedShipID,
    {
      attachProfileID: options.hydrationProfile,
    },
  );

  const inventoryBootstrapPending = options.inventoryBootstrapPending === true;
  let hydrationPlan = buildSpaceAttachHydrationPlan(
    options.hydrationProfile ||
      (options.enableChargeDogmaReplay === false ? "capsule" : "transition"),
    {
      enableChargeDogmaReplay: options.enableChargeDogmaReplay,
      useRealChargeInventoryHudRows: options.useRealChargeInventoryHudRows,
      chargeDogmaReplayMode: options.chargeDogmaReplayMode,
      queueModuleReplay: options.queueModuleReplay,
      awaitShipInventoryPrimeBeforeReplay:
        options.awaitShipInventoryPrimeBeforeReplay,
      awaitPostLoginHudTurretBootstrap:
        options.awaitPostLoginHudTurretBootstrap,
      rememberBlockedChargeHudBootstrap:
        options.rememberBlockedChargeHudBootstrap,
      syntheticFitTransition: options.syntheticFitTransition,
      emitOnlineEffects: options.emitOnlineEffects,
      allowLateFittingReplay: options.allowLateFittingReplay,
      allowLateChargeRefresh: options.allowLateChargeRefresh,
      lateChargeDogmaReplayMode: options.lateChargeDogmaReplayMode,
      lateChargeFinalizeReplayBudget:
        options.lateChargeFinalizeReplayBudget,
      implicitHudBootstrapDelayMs:
        options.implicitHudBootstrapDelayMs,
      allowMichelleGuardChargeRefresh:
        options.allowMichelleGuardChargeRefresh,
    },
  );
  const hasSharedHydrationWork =
    hydrationPlan.enableChargeDogmaReplay === true ||
    hydrationPlan.queueModuleReplay === true;
  const effectiveInventoryBootstrapPending =
    inventoryBootstrapPending &&
    hasSharedHydrationWork &&
    hydrationPlan.awaitShipInventoryPrimeBeforeReplay === true;
  const shipInventoryPrimedByDefault =
    hasSharedHydrationWork !== true ||
    hydrationPlan.awaitShipInventoryPrimeBeforeReplay !== true;

  // Keep the bootstrap explicit per attach type:
  // - login, stargate, /solar, and undock keep the stock tuple-backed charge state for
  //   dogma/ammo logic, but their post-HUD repair replays real loaded charge
  //   inventory rows so the rack buttons bind to a stable loaded integer item
  // - stargate and other legacy transition attach paths still use the shared
  //   in-space replay path only when they stay on the `transition` profile
  //   rather than one of the real-HUD charge-row profiles above
  // - loaded charges stay tuple-backed whenever a profile enables shared charge
  //   bootstrap instead of the real-HUD row lane
  //
  // Late self-rearming fitting/charge replays are profile-gated and disabled by
  // default; the live parity path should stabilize from the first bootstrap
  // instead of layering extra repair passes on top.
  session._space.loginInventoryBootstrapPending =
    effectiveInventoryBootstrapPending;
  session._space.loginShipInventoryPrimed = shipInventoryPrimedByDefault;
  session._space.loginShipInventoryListed = shipInventoryPrimedByDefault;
  session._space.loginChargeDogmaReplayPending =
    hydrationPlan.enableChargeDogmaReplay;
  // Login now deliberately splits the two clients:
  // - stock tuple-backed charge state for clientDogmaLocation / ammo logic
  // - real loaded charge inventory rows for the module HUD after bootstrap
  session._space.useRealChargeInventoryHudRows =
    hydrationPlan.useRealChargeInventoryHudRows === true;
  session._space.loginChargeDogmaReplayMode =
    hydrationPlan.chargeDogmaReplayMode;
  session._space.loginChargeDogmaReplayFlushed =
    hydrationPlan.enableChargeDogmaReplay !== true;
  session._space.loginChargeDogmaReplayHudBootstrapSeen = false;
  session._space.loginRememberBlockedChargeHudBootstrap =
    hydrationPlan.rememberBlockedChargeHudBootstrap === true;
  session._space.loginChargeHydrationProfile = hydrationPlan.profileID;
  session._space.loginModuleParityManifest = moduleParityManifest;
  session._space.loginLateFittedReplayItemIDs =
    moduleParityManifest.lateFittedModuleReplayItemIDs;
  session._space.pendingHardpointActivationBootstrapModuleIDs = new Set(
    moduleParityManifest.lateFittedModuleReplayItemIDs,
  );
  session._space.loginAllowLateFittingReplay =
    hydrationPlan.allowLateFittingReplay === true ||
    shouldEnableLateFittedReplayForManifest(
      hydrationPlan.profileID,
      moduleParityManifest,
    );
  session._space.loginAllowLateChargeRefresh =
    hydrationPlan.allowLateChargeRefresh === true;
  session._space.loginLateChargeDogmaReplayMode =
    hydrationPlan.lateChargeDogmaReplayMode;
  session._space.loginChargeHudFinalizeReplayBudget = Math.max(
    0,
    Number(hydrationPlan.lateChargeFinalizeReplayBudget) || 0,
  );
  session._space.loginChargeHudFinalizeRemainingReplays = 0;
  session._space.loginAllowMichelleGuardChargeRefresh =
    hydrationPlan.allowMichelleGuardChargeRefresh === true;
  session._space.loginFittingReplayHudBootstrapSeen = false;
  session._space.loginImplicitHudBootstrapDelayMs = Math.max(
    0,
    Number(hydrationPlan.implicitHudBootstrapDelayMs) || 0,
  );
  session._space.loginFittingHudFinalizePending = false;
  session._space.loginFittingHudFinalizeWindowEndsAtMs = 0;
  session._space.loginFittingHudFinalizeRemainingReplays = 0;
  session._space.loginFittingFinalizeReplay = null;
  session._space.loginChargeHudFinalizePending = false;
  session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
  session._space.loginChargeAttachStartedAtMs = Date.now();
  session._space.loginChargeMichelleGuardPending =
    hydrationPlan.allowMichelleGuardChargeRefresh === true;
  if (session._space.loginChargeDogmaReplayTimer) {
    clearTimeout(session._space.loginChargeDogmaReplayTimer);
  }
  if (session._space.loginChargeHudFinalizeTimer) {
    clearTimeout(session._space.loginChargeHudFinalizeTimer);
  }
  if (session._space.loginFittingReplayTimer) {
    clearTimeout(session._space.loginFittingReplayTimer);
  }
  if (session._space.loginFittingHudFinalizeTimer) {
    clearTimeout(session._space.loginFittingHudFinalizeTimer);
  }
  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
  }
  if (Array.isArray(session._space.loginChargeMichelleGuardTimers)) {
    for (const timer of session._space.loginChargeMichelleGuardTimers) {
      clearTimeout(timer);
    }
  }
  session._space.loginChargeHudFinalizeTimer = null;
  session._space.loginChargeDogmaReplayTimer = null;
  session._space.loginFittingReplayTimer = null;
  session._space.loginFittingHudFinalizeTimer = null;
  session._space._chargeBootstrapRepairTimer = null;
  session._space.loginChargeMichelleGuardTimers = [];

  session._pendingCommandShipFittingReplay =
    hydrationPlan.queueModuleReplay === true
      ? {
          shipID: resolvedShipID,
          includeOfflineModules: true,
          includeCharges: hydrationPlan.useRealChargeInventoryHudRows === true,
          onlyCharges: hydrationPlan.useRealChargeInventoryHudRows === true,
          onlyScannerProbeLaunchers: false,
          emitChargeInventoryRows:
            hydrationPlan.useRealChargeInventoryHudRows === true,
          allowInSpaceChargeInventoryRows:
            hydrationPlan.useRealChargeInventoryHudRows === true,
          emitOnlineEffects: hydrationPlan.emitOnlineEffects === true,
          syntheticFitTransition: hydrationPlan.syntheticFitTransition === true,
          awaitBeyonceBound: options.awaitBeyonceBound !== false,
          awaitInitialBallpark: options.awaitInitialBallpark !== false,
          awaitPostLoginShipInventoryList:
            hydrationPlan.awaitShipInventoryPrimeBeforeReplay === true,
          awaitPostLoginHudTurretBootstrap:
            hydrationPlan.awaitPostLoginHudTurretBootstrap === true,
        }
      : null;

  log.debug(
    `[space-hydration] queued shipID=${resolvedShipID} ` +
    `profile=${hydrationPlan.profileID} ` +
    `inventoryBootstrapPending=${effectiveInventoryBootstrapPending} ` +
    `enableChargeDogmaReplay=${hydrationPlan.enableChargeDogmaReplay} ` +
    `chargeMode=${session._space.loginChargeDogmaReplayMode} ` +
    `queueModuleReplay=${hydrationPlan.queueModuleReplay === true} ` +
    `rememberBlockedChargeHud=${hydrationPlan.rememberBlockedChargeHudBootstrap === true} ` +
    `lateFittingReplay=${session._space.loginAllowLateFittingReplay === true} ` +
    `lateFittingReplayItems=${JSON.stringify(
      session._space.loginLateFittedReplayItemIDs,
    )} ` +
    `lateChargeRefresh=${hydrationPlan.allowLateChargeRefresh === true} ` +
    `lateChargeMode=${hydrationPlan.lateChargeDogmaReplayMode} ` +
    `lateChargeBudget=${Math.max(
      0,
      Number(hydrationPlan.lateChargeFinalizeReplayBudget) || 0,
    )} ` +
    `moduleParityFamilies=${JSON.stringify(
      moduleParityManifest.familyCounts,
    )} ` +
    `implicitHudDelayMs=${Math.max(
      0,
      Number(hydrationPlan.implicitHudBootstrapDelayMs) || 0,
    )} ` +
    `${describeSessionHydrationState(session, resolvedShipID)}`,
  );

  if (session._pendingCommandShipFittingReplay) {
    tryFlushPendingShipFittingReplay(session);
    if (
      session._pendingCommandShipFittingReplay &&
      hydrationPlan.awaitPostLoginHudTurretBootstrap === true &&
      hydrationPlan.useRealChargeInventoryHudRows === true &&
      hydrationPlan.implicitHudBootstrapDelayMs > 0
    ) {
      requestPendingShipFittingReplayFromHud(session, resolvedShipID, {
        delayMs: hydrationPlan.implicitHudBootstrapDelayMs,
        reason: `spaceAttach.${hydrationPlan.profileID}.implicitHudBootstrap`,
      });
    }
  }
  if (
    hydrationPlan.enableChargeDogmaReplay === true &&
    session._space.loginShipInventoryPrimed === true &&
    !session._pendingCommandShipFittingReplay &&
    hydrationPlan.awaitPostLoginHudTurretBootstrap !== true
  ) {
    setTimeout(() => {
      if (
        !session ||
        !session._space ||
        session._space.loginChargeDogmaReplayPending !== true
      ) {
        return;
      }
      tryFlushPendingShipChargeDogmaReplay(session, resolvedShipID);
    }, 0);
  }
  return true;
}

module.exports = {
  queuePostSpaceAttachFittingHydration,
};
