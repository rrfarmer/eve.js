const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR,
  CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY,
  CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
} = require(path.join(__dirname, "../../space/modules/moduleLoadParity"));
const {
  manifestRequiresRealChargeInventoryHudRowsForItemIDs,
} = require(path.join(
  __dirname,
  "../../space/modules/moduleClientParityAuthority",
));
const {
  syncShipFittingStateForSession,
  syncLoadedChargeDogmaBootstrapForSession,
} = require(path.join(
  __dirname,
  "../character/characterState",
));

// Debounce the first tuple-backed charge bootstrap slightly after the HUD turret
// slot request so the primary charge repair lands after the rack exists.
const HUD_CHARGE_REPLAY_DEBOUNCE_MS = 350;
// Optional late module replay window. Login parity uses one finalize replay.
const HUD_FITTING_FINALIZE_DEBOUNCE_MS = 450;
const HUD_FITTING_FINALIZE_REARM_WINDOW_MS = 5000;
// Optional late charge refresh window. Login uses one late finalize replay,
// and that budget needs to survive the slower post-login HUD rebuild.
const HUD_CHARGE_FINALIZE_DEBOUNCE_MS = 450;
const HUD_CHARGE_FINALIZE_REARM_WINDOW_MS = 5000;
// Optional Michelle guard window. Current parity profiles opt out.
const HUD_CHARGE_MICHELLE_GUARD_TARGET_DELAYS_MS = Object.freeze([
  10250,
  11250,
]);

function summarizePendingShipFittingReplay(pending) {
  if (!pending || typeof pending !== "object") {
    return "none";
  }

  return [
    `shipID=${Number(pending.shipID) || 0}`,
    `probeOnly=${pending.onlyScannerProbeLaunchers === true}`,
    `awaitBeyonce=${pending.awaitBeyonceBound === true}`,
    `awaitInitial=${pending.awaitInitialBallpark === true}`,
    `awaitInvPrime=${pending.awaitPostLoginShipInventoryList === true}`,
    `awaitHud=${pending.awaitPostLoginHudTurretBootstrap === true}`,
    `hudSeen=${pending.hudBootstrapSeen === true}`,
    `syntheticFit=${pending.syntheticFitTransition === true}`,
    `emitOnlineEffects=${pending.emitOnlineEffects === true}`,
  ].join(" ");
}

function describeSessionHydrationState(session, shipID = null) {
  if (!session || typeof session !== "object") {
    return "session=none";
  }

  const space = session._space || null;
  const resolvedShipID =
    Number(shipID) ||
    Number(
      space &&
      (space.shipID ||
        session.activeShipID ||
        session.shipID ||
        session.shipid ||
        0),
    ) ||
    0;
  const finalizeWindowRemainingMs = Math.max(
    0,
    (Number(space && space.loginChargeHudFinalizeWindowEndsAtMs) || 0) - Date.now(),
  );

  return [
    `clientID=${Number(session.clientID) || 0}`,
    `charID=${Number(session.characterID || session.charid) || 0}`,
    `shipID=${resolvedShipID}`,
    `profile=${
      space && typeof space.loginChargeHydrationProfile === "string"
        ? space.loginChargeHydrationProfile
        : "unknown"
    }`,
    `beyonce=${Boolean(space && space.beyonceBound)}`,
    `initial=${Boolean(space && space.initialStateSent)}`,
    `invPrimed=${Boolean(space && space.loginShipInventoryPrimed)}`,
    `chargePending=${Boolean(space && space.loginChargeDogmaReplayPending)}`,
    `chargeMode=${
      space && space.loginChargeDogmaReplayMode
        ? space.loginChargeDogmaReplayMode
        : CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR
    }`,
    `chargeFlushed=${Boolean(space && space.loginChargeDogmaReplayFlushed)}`,
    `chargeHudSeen=${Boolean(space && space.loginChargeDogmaReplayHudBootstrapSeen)}`,
    `rememberBlockedChargeHud=${Boolean(
      space && space.loginRememberBlockedChargeHudBootstrap,
    )}`,
    `chargeTimer=${Boolean(space && space.loginChargeDogmaReplayTimer)}`,
    `hudFinalizePending=${Boolean(space && space.loginChargeHudFinalizePending)}`,
    `hudFinalizeTimer=${Boolean(space && space.loginChargeHudFinalizeTimer)}`,
    `hudFinalizeWindowMs=${finalizeWindowRemainingMs}`,
    `lateFit=${Boolean(space && space.loginAllowLateFittingReplay)}`,
    `lateCharge=${Boolean(space && space.loginAllowLateChargeRefresh)}`,
    `lateChargeMode=${
      space && typeof space.loginLateChargeDogmaReplayMode === "string"
        ? space.loginLateChargeDogmaReplayMode
        : "inherit"
    }`,
    `lateChargeBudget=${Math.max(
      0,
      Number(space && space.loginChargeHudFinalizeReplayBudget) || 0,
    )}`,
    `lateChargeRemaining=${Math.max(
      0,
      Number(space && space.loginChargeHudFinalizeRemainingReplays) || 0,
    )}`,
    `lateMichelle=${Boolean(
      space && space.loginAllowMichelleGuardChargeRefresh,
    )}`,
    `michelleGuardPending=${Boolean(space && space.loginChargeMichelleGuardPending)}`,
    `michelleGuardTimers=${Array.isArray(space && space.loginChargeMichelleGuardTimers) ? space.loginChargeMichelleGuardTimers.length : 0}`,
    `fittingReplay=${summarizePendingShipFittingReplay(session._pendingCommandShipFittingReplay)}`,
    `bound=${session.currentBoundObjectID || "none"}`,
  ].join(" ");
}

function getPendingShipChargeDogmaReplayMode(session) {
  const replayMode =
    session &&
    session._space &&
    typeof session._space.loginChargeDogmaReplayMode === "string"
      ? session._space.loginChargeDogmaReplayMode
      : "";
  if (
    replayMode === CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY ||
    replayMode === CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR ||
    replayMode === CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY ||
    replayMode === CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY
  ) {
    return replayMode;
  }
  return CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR;
}

function allowsLateFittingReplay(session) {
  return Boolean(
    session &&
      session._space &&
      session._space.loginAllowLateFittingReplay === true,
  );
}

function allowsLateChargeRefresh(session) {
  return Boolean(
    session &&
      session._space &&
      session._space.loginAllowLateChargeRefresh === true,
  );
}

function getImplicitHudBootstrapDelayMs(session) {
  return Math.max(
    0,
    Number(
      session &&
        session._space &&
        session._space.loginImplicitHudBootstrapDelayMs,
    ) || 0,
  );
}

function rememberBlockedChargeHudBootstrap(session) {
  return Boolean(
    session &&
      session._space &&
      session._space.loginRememberBlockedChargeHudBootstrap === true,
  );
}

function getLateChargeRefreshMode(session) {
  const explicitLateMode =
    session &&
    session._space &&
    typeof session._space.loginLateChargeDogmaReplayMode === "string"
      ? session._space.loginLateChargeDogmaReplayMode
      : "";
  if (
    explicitLateMode === CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR ||
    explicitLateMode === CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR ||
    explicitLateMode === CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY ||
    explicitLateMode === CHARGE_DOGMA_REPLAY_MODE_PRIME_REPAIR_THEN_QUANTITY ||
    explicitLateMode === CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY
  ) {
    return explicitLateMode;
  }
  const baseMode = getPendingShipChargeDogmaReplayMode(session);
  return (
    baseMode === CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR ||
    baseMode === CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY
  )
    ? baseMode
    : CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY;
}

function getLateChargeRefreshReplayBudget(session) {
  return Math.max(
    0,
    Number(
      session &&
        session._space &&
        session._space.loginChargeHudFinalizeReplayBudget,
    ) || 0,
  );
}

function allowsMichelleGuardChargeRefresh(session) {
  return Boolean(
    session &&
      session._space &&
      session._space.loginAllowMichelleGuardChargeRefresh === true,
  );
}

function flushPendingInitialBallpark(session, pending, attempt = 0) {
  if (!session || !pending) {
    return;
  }

  if (!session.socket || session.socket.destroyed) {
    return;
  }

  if (!session._space || session._space.initialStateSent) {
    return;
  }

  if (
    pending.awaitBeyonceBound === true &&
    !session._space.beyonceBound
  ) {
    if (attempt === 0 || attempt % 40 === 0) {
      log.debug(
        `[initial-ballpark] blocked reason=await-beyonce attempt=${attempt} ` +
        `force=${pending.force === true} ${describeSessionHydrationState(session)}`,
      );
    }
    if (attempt >= 480) {
      return;
    }

    setTimeout(() => {
      flushPendingInitialBallpark(session, pending, attempt + 1);
    }, 25);
    return;
  }

  if (attempt === 0) {
    log.debug(
      `[initial-ballpark] flushing attempt=${attempt} ` +
      `force=${pending.force === true} ${describeSessionHydrationState(session)}`,
    );
  }
  const completed = spaceRuntime.ensureInitialBallpark(session, {
    allowDeferredJumpBootstrapVisuals: true,
    force: pending.force === true,
  });

  if (completed) {
    log.debug(
      `[initial-ballpark] flushed attempt=${attempt} ` +
      `force=${pending.force === true} ${describeSessionHydrationState(session)}`,
    );
  }

  if (completed || attempt >= 480) {
    return;
  }

  setTimeout(() => {
    flushPendingInitialBallpark(session, pending, attempt + 1);
  }, 25);
}

function tryFlushPendingShipFittingReplay(session) {
  if (!session) {
    return;
  }

  const pending = session._pendingCommandShipFittingReplay || null;
  if (!pending) {
    return false;
  }

  if (!session.socket || session.socket.destroyed) {
    clearPendingShipFittingReplayTimer(session);
    log.debug(
      `[fitting-replay] clearing-destroyed-socket ${describeSessionHydrationState(
        session,
      )}`,
    );
    session._pendingCommandShipFittingReplay = null;
    return false;
  }

  if (
    pending.awaitBeyonceBound === true &&
    (!session._space || !session._space.beyonceBound)
  ) {
    log.debug(
      `[fitting-replay] blocked reason=await-beyonce ` +
      `${describeSessionHydrationState(session, pending.shipID)}`,
    );
    return false;
  }

  if (
    pending.awaitInitialBallpark === true &&
    (!session._space || !session._space.initialStateSent)
  ) {
    log.debug(
      `[fitting-replay] blocked reason=await-initial-ballpark ` +
      `${describeSessionHydrationState(session, pending.shipID)}`,
    );
    return false;
  }

  if (
    pending.awaitPostLoginShipInventoryList === true &&
    (!session._space || session._space.loginShipInventoryPrimed !== true)
  ) {
    log.debug(
      `[fitting-replay] blocked reason=await-login-ship-inventory ` +
      `${describeSessionHydrationState(session, pending.shipID)}`,
    );
    return false;
  }

  if (
    pending.awaitPostLoginHudTurretBootstrap === true &&
    (!session._space || session._space.loginFittingReplayHudBootstrapSeen !== true)
  ) {
    log.debug(
      `[fitting-replay] blocked reason=await-login-hud-turret-bootstrap ` +
      `${describeSessionHydrationState(session, pending.shipID)}`,
    );
    return false;
  }

  clearPendingShipFittingReplayTimer(session);
  session._pendingCommandShipFittingReplay = null;
  syncShipFittingStateForSession(session, pending.shipID, {
    includeOfflineModules: pending.includeOfflineModules === true,
    includeCharges: pending.includeCharges === true,
    onlyCharges: pending.onlyCharges === true,
    onlyScannerProbeLaunchers: pending.onlyScannerProbeLaunchers === true,
    emitChargeInventoryRows: pending.emitChargeInventoryRows !== false,
    allowInSpaceChargeInventoryRows:
      pending.allowInSpaceChargeInventoryRows === true,
    emitOnlineEffects: pending.emitOnlineEffects === true,
    syntheticFitTransition: pending.syntheticFitTransition === true,
  });
  log.debug(
    `[fitting-replay] flushed shipID=${Number(pending.shipID) || 0} ` +
    `chargeReplayPending=${
      session &&
      session._space &&
      session._space.loginChargeDogmaReplayPending === true
    } ` +
    `mode=${getPendingShipChargeDogmaReplayMode(session)} ` +
    `hudSeen=${
      session &&
      session._space &&
      session._space.loginChargeDogmaReplayHudBootstrapSeen === true
    } ${describeSessionHydrationState(session, pending.shipID)}`,
  );
  if (
    session &&
    session._space &&
    session._space.loginChargeDogmaReplayPending === true &&
    session._space.loginChargeDogmaReplayHudBootstrapSeen === true
  ) {
    requestPendingShipChargeDogmaReplayFromHud(session, pending.shipID, {
      delayMs: HUD_CHARGE_REPLAY_DEBOUNCE_MS,
      reason: "post-fitting-replay",
    });
  }
  if (session && session._space) {
    // Some attach paths flush their first fitted-module replay before the HUD
    // finishes registering buttons. Login parity keeps one later module replay
    // armed so a post-HUD GetAvailableTurretSlots can restate the live module
    // rows after those buttons exist.
    const allowLateFinalizeReplay = allowsLateFittingReplay(session);

    if (!allowLateFinalizeReplay) {
      clearPendingHudFittingFinalizeTimer(session);
    }

    session._space.loginFittingHudFinalizePending = allowLateFinalizeReplay;
    session._space.loginFittingHudFinalizeWindowEndsAtMs =
      allowLateFinalizeReplay
        ? Date.now() + HUD_FITTING_FINALIZE_REARM_WINDOW_MS
        : 0;
    session._space.loginFittingHudFinalizeRemainingReplays =
      allowLateFinalizeReplay ? 1 : 0;
    session._space.loginFittingFinalizeReplay = allowLateFinalizeReplay
      ? {
          shipID: pending.shipID,
          includeOfflineModules: pending.includeOfflineModules === true,
          includeCharges: pending.includeCharges === true,
          emitChargeInventoryRows: pending.emitChargeInventoryRows !== false,
          allowInSpaceChargeInventoryRows:
            pending.allowInSpaceChargeInventoryRows === true,
          emitOnlineEffects: pending.emitOnlineEffects === true,
          syntheticFitTransition: pending.syntheticFitTransition === true,
        }
      : null;
    if (
      allowLateFinalizeReplay &&
      session._space.loginFittingReplayHudBootstrapSeen === true
    ) {
      requestPostHudFittingReplay(session, pending.shipID, {
        reason: "post-fitting-replay-hud-seen",
      });
    }
  }
  return true;
}

function clearPendingShipFittingReplayTimer(session) {
  if (
    !session ||
    !session._space ||
    !session._space.loginFittingReplayTimer
  ) {
    return;
  }

  clearTimeout(session._space.loginFittingReplayTimer);
  session._space.loginFittingReplayTimer = null;

  const pending = session._pendingCommandShipFittingReplay || null;
  if (pending) {
    pending.hudBootstrapReplayTimer = null;
  }
}

function clearPendingHudFittingFinalizeTimer(session) {
  if (
    !session ||
    !session._space ||
    !session._space.loginFittingHudFinalizeTimer
  ) {
    return;
  }

  clearTimeout(session._space.loginFittingHudFinalizeTimer);
  session._space.loginFittingHudFinalizeTimer = null;
}

function requestPendingShipFittingReplayFromHud(
  session,
  shipID = null,
  options = {},
) {
  if (
    !session ||
    !session._space ||
    !session._pendingCommandShipFittingReplay
  ) {
    return false;
  }

  const pending = session._pendingCommandShipFittingReplay;
  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : delayMs > 0
        ? "implicit-hud-bootstrap"
        : "hud-bootstrap";

  if (delayMs > 0) {
    clearPendingShipFittingReplayTimer(session);
    log.debug(
      `[fitting-replay] scheduling hud-bootstrap shipID=${
        Number(shipID) ||
        Number(pending.shipID) ||
        0
      } delayMs=${delayMs} reason=${reason} ` +
      `${describeSessionHydrationState(session, pending.shipID)}`,
    );
    session._space.loginFittingReplayTimer = setTimeout(() => {
      if (!session || !session._space || !session._pendingCommandShipFittingReplay) {
        return;
      }
      session._space.loginFittingReplayTimer = null;
      const activePending = session._pendingCommandShipFittingReplay;
      if (activePending) {
        activePending.hudBootstrapReplayTimer = null;
        activePending.hudBootstrapSeen = true;
      }
      session._space.loginFittingReplayHudBootstrapSeen = true;
      log.debug(
        `[fitting-replay] delayed hud-bootstrap shipID=${
          Number(shipID) ||
          Number(activePending && activePending.shipID) ||
          0
        } reason=${reason} ${describeSessionHydrationState(
          session,
          activePending && activePending.shipID,
        )}`,
      );
      tryFlushPendingShipFittingReplay(session);
    }, delayMs);
    if (typeof session._space.loginFittingReplayTimer.unref === "function") {
      session._space.loginFittingReplayTimer.unref();
    }
    pending.hudBootstrapReplayTimer = session._space.loginFittingReplayTimer;
    return true;
  }

  clearPendingShipFittingReplayTimer(session);
  pending.hudBootstrapSeen = true;
  session._space.loginFittingReplayHudBootstrapSeen = true;

  return tryFlushPendingShipFittingReplay(session);
}

function requestPostHudFittingReplay(session, shipID = null, options = {}) {
  if (!allowsLateFittingReplay(session)) {
    clearPendingHudFittingFinalizeTimer(session);
    if (session && session._space) {
      session._space.loginFittingHudFinalizePending = false;
      session._space.loginFittingHudFinalizeWindowEndsAtMs = 0;
      session._space.loginFittingHudFinalizeRemainingReplays = 0;
      session._space.loginFittingFinalizeReplay = null;
    }
    return false;
  }

  const finalizeWindowEndsAtMs =
    Number(
      session &&
        session._space &&
        session._space.loginFittingHudFinalizeWindowEndsAtMs,
    ) || 0;
  const finalizeWindowRemainingMs = Math.max(
    0,
    finalizeWindowEndsAtMs - Date.now(),
  );
  const rearmWindowOpen = finalizeWindowRemainingMs > 0;

  if (
    !session ||
    !session._space ||
    !session._space.loginFittingFinalizeReplay ||
    Number(session._space.loginFittingHudFinalizeRemainingReplays) <= 0 ||
    (
      session._space.loginFittingHudFinalizePending !== true &&
      rearmWindowOpen !== true
    )
  ) {
    return false;
  }

  const restrictToItemIDs = Array.isArray(
    session._space.loginLateFittedReplayItemIDs,
  )
    ? session._space.loginLateFittedReplayItemIDs.filter(
        (itemID) => Number(itemID) > 0,
      )
    : [];
  if (restrictToItemIDs.length === 0) {
    return false;
  }

  if (!session.socket || session.socket.destroyed) {
    clearPendingHudFittingFinalizeTimer(session);
    session._space.loginFittingHudFinalizePending = false;
    session._space.loginFittingHudFinalizeWindowEndsAtMs = 0;
    return false;
  }

  if (
    session._space.loginFittingHudFinalizePending !== true &&
    rearmWindowOpen === true
  ) {
    session._space.loginFittingHudFinalizePending = true;
  }

  clearPendingHudFittingFinalizeTimer(session);
  const replay = session._space.loginFittingFinalizeReplay;
  const resolvedShipID =
    Number(shipID) ||
    Number(replay.shipID) ||
    Number(session.shipID || session.shipid || session.activeShipID || 0) ||
    0;
  const delayMs = Math.max(
    0,
    Number(options.delayMs) || HUD_FITTING_FINALIZE_DEBOUNCE_MS,
  );
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : "post-hud-finalize";
  const forceRealChargeInventoryHudRows =
    manifestRequiresRealChargeInventoryHudRowsForItemIDs(
      session._space.loginModuleParityManifest,
      restrictToItemIDs,
    );

  log.debug(
    `[fitting-hud-finalize] scheduling shipID=${resolvedShipID} ` +
    `delayMs=${delayMs} reason=${reason} ` +
    `realChargeRows=${forceRealChargeInventoryHudRows} ` +
    `windowRemainingMs=${Math.max(
      0,
      (Number(session._space.loginFittingHudFinalizeWindowEndsAtMs) || 0) -
        Date.now(),
    )} ${describeSessionHydrationState(session, resolvedShipID)}`,
  );
  session._space.loginFittingHudFinalizeTimer = setTimeout(() => {
    if (
      !session ||
      !session._space ||
      session._space.loginFittingHudFinalizePending !== true
    ) {
      return;
    }

    session._space.loginFittingHudFinalizeTimer = null;
    session._space.loginFittingHudFinalizePending = false;
    if (
      (Number(session._space.loginFittingHudFinalizeWindowEndsAtMs) || 0) <=
      Date.now()
    ) {
      session._space.loginFittingHudFinalizeWindowEndsAtMs = 0;
    }

    if (!session.socket || session.socket.destroyed) {
      return;
    }

    log.debug(
      `[fitting-hud-finalize] timer-fired shipID=${resolvedShipID} ` +
      `reason=${reason} realChargeRows=${forceRealChargeInventoryHudRows} ` +
      `${describeSessionHydrationState(session, resolvedShipID)}`,
    );
    session._space.loginFittingHudFinalizeRemainingReplays = Math.max(
      0,
      (Number(session._space.loginFittingHudFinalizeRemainingReplays) || 0) - 1,
    );
    if (
      Number(session._space.loginFittingHudFinalizeRemainingReplays) <= 0
    ) {
      session._space.loginFittingHudFinalizeWindowEndsAtMs = 0;
      session._space.loginFittingFinalizeReplay = null;
    }
    syncShipFittingStateForSession(session, replay.shipID, {
      includeOfflineModules: replay.includeOfflineModules === true,
      includeCharges:
        forceRealChargeInventoryHudRows || replay.includeCharges === true,
      onlyCharges: replay.onlyCharges === true,
      emitChargeInventoryRows:
        forceRealChargeInventoryHudRows || replay.emitChargeInventoryRows !== false,
      allowInSpaceChargeInventoryRows:
        forceRealChargeInventoryHudRows ||
        replay.allowInSpaceChargeInventoryRows === true,
      emitOnlineEffects: replay.emitOnlineEffects === true,
      syntheticFitTransition: replay.syntheticFitTransition === true,
      restrictToItemIDs,
    });
    if (
      allowsLateChargeRefresh(session) &&
      session._space.loginChargeDogmaReplayFlushed === true
    ) {
      const replayBudget = getLateChargeRefreshReplayBudget(session);
      if (replayBudget > 0) {
        session._space.loginChargeHudFinalizeRemainingReplays = Math.max(
          Number(session._space.loginChargeHudFinalizeRemainingReplays) || 0,
          replayBudget,
        );
        session._space.loginChargeHudFinalizeWindowEndsAtMs = Math.max(
          Number(session._space.loginChargeHudFinalizeWindowEndsAtMs) || 0,
          Date.now() + HUD_CHARGE_FINALIZE_REARM_WINDOW_MS,
        );
        log.debug(
          `[charge-hud-finalize] rearm-from-fitting shipID=${resolvedShipID} ` +
          `budget=${replayBudget} windowRemainingMs=${Math.max(
            0,
            (Number(session._space.loginChargeHudFinalizeWindowEndsAtMs) || 0) -
              Date.now(),
          )} ${describeSessionHydrationState(session, resolvedShipID)}`,
        );
      }
    }
  }, delayMs);
  return true;
}

function clearPendingShipChargeDogmaReplayTimer(session) {
  if (
    !session ||
    !session._space ||
    !session._space.loginChargeDogmaReplayTimer
  ) {
    return;
  }

  clearTimeout(session._space.loginChargeDogmaReplayTimer);
  session._space.loginChargeDogmaReplayTimer = null;
}

function clearPendingHudChargeFinalizeTimer(session) {
  if (
    !session ||
    !session._space ||
    !session._space.loginChargeHudFinalizeTimer
  ) {
    return;
  }

  clearTimeout(session._space.loginChargeHudFinalizeTimer);
  session._space.loginChargeHudFinalizeTimer = null;
}

function clearPendingHudChargeMichelleGuardTimers(session) {
  if (
    !session ||
    !session._space ||
    !Array.isArray(session._space.loginChargeMichelleGuardTimers)
  ) {
    return;
  }

  for (const timer of session._space.loginChargeMichelleGuardTimers) {
    clearTimeout(timer);
  }
  session._space.loginChargeMichelleGuardTimers = [];
}

function resolvePendingShipChargeDogmaReplayShipID(session, shipID = null) {
  return (
    Number(shipID) ||
    Number(
      session &&
        session._space &&
        (session._space.shipID ||
          session.activeShipID ||
          session.shipID ||
          session.shipid ||
          0),
    ) ||
    0
  );
}

function canFlushPendingShipChargeDogmaReplay(session, shipID = null) {
  if (
    !session ||
    !session._space ||
    session._space.loginChargeDogmaReplayPending !== true
  ) {
    return {
      ready: false,
      resolvedShipID: 0,
      blockers: ["replay-not-pending"],
    };
  }

  if (!session.socket || session.socket.destroyed) {
    clearPendingShipChargeDogmaReplayTimer(session);
    session._space.loginChargeDogmaReplayPending = false;
    return {
      ready: false,
      resolvedShipID: 0,
      blockers: ["destroyed-socket"],
    };
  }

  const blockers = [];
  if (
    session._space.beyonceBound !== true
  ) {
    blockers.push("await-beyonce");
  }
  if (session._space.initialStateSent !== true) {
    blockers.push("await-initial-ballpark");
  }
  if (session._space.loginShipInventoryPrimed !== true) {
    blockers.push("await-login-ship-inventory");
  }
  if (session._pendingCommandShipFittingReplay) {
    blockers.push("await-fitting-replay");
  }
  if (blockers.length > 0) {
    return {
      ready: false,
      resolvedShipID: 0,
      blockers,
    };
  }

  const resolvedShipID = resolvePendingShipChargeDogmaReplayShipID(
    session,
    shipID,
  );
  if (resolvedShipID <= 0) {
    clearPendingShipChargeDogmaReplayTimer(session);
    session._space.loginChargeDogmaReplayPending = false;
    return {
      ready: false,
      resolvedShipID: 0,
      blockers: ["invalid-ship"],
    };
  }

  return {
    ready: true,
    resolvedShipID,
    blockers: [],
  };
}

function tryFlushPendingShipChargeDogmaReplay(session, shipID = null) {
  const state = canFlushPendingShipChargeDogmaReplay(session, shipID);
  if (!state.ready) {
    return false;
  }

  const replayMode = getPendingShipChargeDogmaReplayMode(session);
  clearPendingShipChargeDogmaReplayTimer(session);
  session._space.loginChargeDogmaReplayPending = false;
  session._space.loginChargeDogmaReplayFlushed = true;
  if (allowsLateChargeRefresh(session)) {
    const replayBudget = getLateChargeRefreshReplayBudget(session);
    clearPendingHudChargeFinalizeTimer(session);
    session._space.loginChargeHudFinalizePending = replayBudget > 0;
    session._space.loginChargeHudFinalizeWindowEndsAtMs =
      replayBudget > 0
        ? Date.now() + HUD_CHARGE_FINALIZE_REARM_WINDOW_MS
        : 0;
    session._space.loginChargeHudFinalizeRemainingReplays = replayBudget;
  } else {
    clearPendingHudChargeFinalizeTimer(session);
    session._space.loginChargeHudFinalizePending = false;
    session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
    session._space.loginChargeHudFinalizeRemainingReplays = 0;
  }
  log.debug(
    `[charge-replay] flushing shipID=${state.resolvedShipID} ` +
    `mode=${replayMode} ${describeSessionHydrationState(session, state.resolvedShipID)}`,
  );
  syncLoadedChargeDogmaBootstrapForSession(session, state.resolvedShipID, {
    mode: replayMode,
  });
  if (
    allowsLateChargeRefresh(session) &&
    Number(session._space.loginChargeHudFinalizeRemainingReplays) > 0
  ) {
    requestPostHudChargeRefresh(session, state.resolvedShipID, {
      delayMs: HUD_CHARGE_FINALIZE_DEBOUNCE_MS,
      reason: "post-charge-replay",
    });
  }
  if (
    replayMode === CHARGE_DOGMA_REPLAY_MODE_PRIME_AND_REPAIR &&
    allowsMichelleGuardChargeRefresh(session)
  ) {
    if (!requestPostMichelleHudChargeRefreshGuards(session, state.resolvedShipID)) {
      log.debug(
        `[charge-michelle-guard] not-armed shipID=${state.resolvedShipID} ` +
        `${describeSessionHydrationState(session, state.resolvedShipID)}`,
      );
    }
  }
  return true;
}

function requestPendingShipChargeDogmaReplayFromHud(
  session,
  shipID = null,
  options = {},
) {
  if (
    !session ||
    !session._space ||
    session._space.loginChargeDogmaReplayPending !== true
  ) {
    return false;
  }

  const state = canFlushPendingShipChargeDogmaReplay(session, shipID);
  if (!state.ready) {
    session._space.loginChargeDogmaReplayHudBootstrapSeen =
      session._space.loginChargeDogmaReplayPending === true &&
      rememberBlockedChargeHudBootstrap(session);
    log.debug(
      `[charge-replay] blocked source=hud blockers=${
        Array.isArray(state.blockers) ? state.blockers.join(",") : "unknown"
      } rememberBlockedHud=${
        session._space.loginChargeDogmaReplayHudBootstrapSeen === true
      } ${describeSessionHydrationState(session, shipID)}`,
    );
    return false;
  }

  session._space.loginChargeDogmaReplayHudBootstrapSeen = true;
  clearPendingShipChargeDogmaReplayTimer(session);
  const delayMs = Math.max(
    0,
    Number(options.delayMs) || HUD_CHARGE_REPLAY_DEBOUNCE_MS,
  );
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : "hud";
  log.debug(
    `[charge-replay] scheduling shipID=${state.resolvedShipID} ` +
    `delayMs=${delayMs} reason=${reason} ` +
    `${describeSessionHydrationState(session, state.resolvedShipID)}`,
  );
  session._space.loginChargeDogmaReplayTimer = setTimeout(() => {
    if (
      !session ||
      !session._space ||
      session._space.loginChargeDogmaReplayPending !== true
    ) {
      return;
    }

    session._space.loginChargeDogmaReplayTimer = null;
    log.debug(
      `[charge-replay] timer-fired shipID=${state.resolvedShipID} ` +
      `reason=${reason} ${describeSessionHydrationState(session, state.resolvedShipID)}`,
    );
    tryFlushPendingShipChargeDogmaReplay(session, state.resolvedShipID);
  }, delayMs);
  return true;
}

function requestPostHudChargeRefresh(session, shipID = null, options = {}) {
  if (!allowsLateChargeRefresh(session)) {
    clearPendingHudChargeFinalizeTimer(session);
    if (session && session._space) {
      session._space.loginChargeHudFinalizePending = false;
      session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
      session._space.loginChargeHudFinalizeRemainingReplays = 0;
    }
    return false;
  }

  const finalizeWindowEndsAtMs =
    Number(
      session &&
        session._space &&
        session._space.loginChargeHudFinalizeWindowEndsAtMs,
    ) || 0;
  const finalizeWindowRemainingMs = Math.max(
    0,
    finalizeWindowEndsAtMs - Date.now(),
  );
  const rearmWindowOpen = finalizeWindowRemainingMs > 0;

  if (
    !session ||
    !session._space ||
    Number(session._space.loginChargeHudFinalizeRemainingReplays) <= 0 ||
    (
      session._space.loginChargeHudFinalizePending !== true &&
      rearmWindowOpen !== true
    ) ||
    session._space.loginChargeDogmaReplayFlushed !== true
  ) {
    return false;
  }

  if (!session.socket || session.socket.destroyed) {
    clearPendingHudChargeFinalizeTimer(session);
    session._space.loginChargeHudFinalizePending = false;
    session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
    session._space.loginChargeHudFinalizeRemainingReplays = 0;
    return false;
  }

  const resolvedShipID = resolvePendingShipChargeDogmaReplayShipID(
    session,
    shipID,
  );
  if (resolvedShipID <= 0) {
    clearPendingHudChargeFinalizeTimer(session);
    session._space.loginChargeHudFinalizePending = false;
    session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
    session._space.loginChargeHudFinalizeRemainingReplays = 0;
    return false;
  }

  if (
    session._space.loginChargeHudFinalizePending !== true &&
    rearmWindowOpen === true
  ) {
    session._space.loginChargeHudFinalizePending = true;
    log.debug(
      `[charge-hud-finalize] rearming shipID=${resolvedShipID} ` +
      `windowRemainingMs=${finalizeWindowRemainingMs} ` +
      `${describeSessionHydrationState(session, resolvedShipID)}`,
    );
  }

  clearPendingHudChargeFinalizeTimer(session);
  const delayMs = Math.max(
    0,
    Number(options.delayMs) || HUD_CHARGE_FINALIZE_DEBOUNCE_MS,
  );
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : "post-hud-finalize";
  log.debug(
    `[charge-hud-finalize] scheduling shipID=${resolvedShipID} ` +
    `delayMs=${delayMs} reason=${reason} ` +
    `windowRemainingMs=${Math.max(
      0,
      (Number(session._space.loginChargeHudFinalizeWindowEndsAtMs) || 0) -
        Date.now(),
    )} ${describeSessionHydrationState(session, resolvedShipID)}`,
  );
  session._space.loginChargeHudFinalizeTimer = setTimeout(() => {
    if (
      !session ||
      !session._space ||
      session._space.loginChargeHudFinalizePending !== true
    ) {
      return;
    }

    session._space.loginChargeHudFinalizeTimer = null;
    session._space.loginChargeHudFinalizePending = false;
    session._space.loginChargeHudFinalizeRemainingReplays = Math.max(
      0,
      (Number(session._space.loginChargeHudFinalizeRemainingReplays) || 0) - 1,
    );
    if (
      (Number(session._space.loginChargeHudFinalizeWindowEndsAtMs) || 0) <=
      Date.now() ||
      Number(session._space.loginChargeHudFinalizeRemainingReplays) <= 0
    ) {
      session._space.loginChargeHudFinalizeWindowEndsAtMs = 0;
    }

    if (
      !session.socket ||
      session.socket.destroyed
    ) {
      return;
    }

    const refreshMode = getLateChargeRefreshMode(session);
    log.debug(
      `[charge-hud-finalize] timer-fired shipID=${resolvedShipID} ` +
      `reason=${reason} mode=${refreshMode} ` +
      `${describeSessionHydrationState(session, resolvedShipID)}`,
    );
    syncLoadedChargeDogmaBootstrapForSession(session, resolvedShipID, {
      mode: refreshMode,
    });
  }, delayMs);
  return true;
}

function requestPostMichelleHudChargeRefreshGuards(
  session,
  shipID = null,
  options = {},
) {
  if (!allowsMichelleGuardChargeRefresh(session)) {
    clearPendingHudChargeMichelleGuardTimers(session);
    if (session && session._space) {
      session._space.loginChargeMichelleGuardPending = false;
    }
    return false;
  }

  if (
    !session ||
    !session._space ||
    session._space.loginChargeMichelleGuardPending !== true ||
    session._space.loginChargeDogmaReplayFlushed !== true
  ) {
    return false;
  }

  if (!session.socket || session.socket.destroyed) {
    clearPendingHudChargeMichelleGuardTimers(session);
    session._space.loginChargeMichelleGuardPending = false;
    return false;
  }

  const resolvedShipID = resolvePendingShipChargeDogmaReplayShipID(
    session,
    shipID,
  );
  if (resolvedShipID <= 0) {
    clearPendingHudChargeMichelleGuardTimers(session);
    session._space.loginChargeMichelleGuardPending = false;
    return false;
  }

  const attachStartedAtMs =
    Number(session._space.loginChargeAttachStartedAtMs) || Date.now();
  const targetDelaysMs = Array.isArray(options.targetDelaysMs) &&
    options.targetDelaysMs.length > 0
    ? options.targetDelaysMs
    : HUD_CHARGE_MICHELLE_GUARD_TARGET_DELAYS_MS;

  clearPendingHudChargeMichelleGuardTimers(session);
  session._space.loginChargeMichelleGuardTimers = [];

  targetDelaysMs.forEach((targetDelayMs, index) => {
    const numericTargetDelayMs = Math.max(0, Number(targetDelayMs) || 0);
    const delayMs = Math.max(
      0,
      (attachStartedAtMs + numericTargetDelayMs) - Date.now(),
    );
    log.debug(
      `[charge-michelle-guard] scheduling shipID=${resolvedShipID} ` +
      `delayMs=${delayMs} targetDelayMs=${numericTargetDelayMs} index=${index + 1}/${
        targetDelaysMs.length
      }`,
    );
    const timer = setTimeout(() => {
      if (
        !session ||
        !session._space ||
        session._space.loginChargeMichelleGuardPending !== true
      ) {
        return;
      }

      if (
        !session.socket ||
        session.socket.destroyed
      ) {
        session._space.loginChargeMichelleGuardPending = false;
        clearPendingHudChargeMichelleGuardTimers(session);
        return;
      }

      if (
        Array.isArray(session._space.loginChargeMichelleGuardTimers)
      ) {
        session._space.loginChargeMichelleGuardTimers =
          session._space.loginChargeMichelleGuardTimers.filter(
            (candidate) => candidate !== timer,
          );
      }

      log.debug(
        `[charge-michelle-guard] timer-fired shipID=${resolvedShipID} ` +
        `targetDelayMs=${numericTargetDelayMs} index=${index + 1}/${
          targetDelaysMs.length
        }`,
      );
      syncLoadedChargeDogmaBootstrapForSession(session, resolvedShipID, {
        mode: CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY,
      });

      if (index >= targetDelaysMs.length - 1 && session._space) {
        session._space.loginChargeMichelleGuardPending = false;
      }
    }, delayMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    session._space.loginChargeMichelleGuardTimers.push(timer);
  });

  return true;
}

function requestPendingShipChargeDogmaReplayFromInventory(
  session,
  shipID = null,
  options = {},
) {
  if (
    !session ||
    !session._space ||
    session._space.loginChargeDogmaReplayPending !== true
  ) {
    return false;
  }

  const replayMode = getPendingShipChargeDogmaReplayMode(session);
  if (
    replayMode !== CHARGE_DOGMA_REPLAY_MODE_REFRESH_ONLY &&
    replayMode !== CHARGE_DOGMA_REPLAY_MODE_QUANTITY_AND_REPAIR &&
    replayMode !== CHARGE_DOGMA_REPLAY_MODE_REPAIR_THEN_QUANTITY
  ) {
    return false;
  }

  const state = canFlushPendingShipChargeDogmaReplay(session, shipID);
  if (!state.ready) {
    log.debug(
      `[charge-replay] blocked source=inventory blockers=${
        Array.isArray(state.blockers) ? state.blockers.join(",") : "unknown"
      } ${describeSessionHydrationState(session, shipID)}`,
    );
    return false;
  }

  clearPendingShipChargeDogmaReplayTimer(session);
  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  const reason =
    typeof options.reason === "string" && options.reason.trim().length > 0
      ? options.reason.trim()
      : "inventory";
  log.debug(
    `[charge-replay] scheduling shipID=${state.resolvedShipID} ` +
    `delayMs=${delayMs} reason=${reason} ` +
    `${describeSessionHydrationState(session, state.resolvedShipID)}`,
  );
  session._space.loginChargeDogmaReplayTimer = setTimeout(() => {
    if (
      !session ||
      !session._space ||
      session._space.loginChargeDogmaReplayPending !== true
    ) {
      return;
    }

    session._space.loginChargeDogmaReplayTimer = null;
    log.debug(
      `[charge-replay] timer-fired shipID=${state.resolvedShipID} ` +
      `reason=${reason} ${describeSessionHydrationState(session, state.resolvedShipID)}`,
    );
    tryFlushPendingShipChargeDogmaReplay(session, state.resolvedShipID);
  }, delayMs);
  return true;
}

function flushPendingCommandSessionEffects(session) {
  if (!session || typeof session !== "object") {
    return;
  }

  const pendingLocalChannelSync = session._pendingLocalChannelSync || null;
  const pendingInitialBallpark = session._pendingCommandInitialBallpark || null;
  session._pendingLocalChannelSync = null;
  session._pendingCommandInitialBallpark = null;

  if (pendingLocalChannelSync) {
    const chatHub = require(path.join(__dirname, "./chatHub"));
    if (typeof chatHub.moveLocalSession === "function") {
      chatHub.moveLocalSession(session, pendingLocalChannelSync.previousChannelID);
    }
  }

  if (pendingInitialBallpark) {
    setTimeout(() => {
      flushPendingInitialBallpark(session, pendingInitialBallpark);
    }, 0);
  }

  if (session._pendingCommandShipFittingReplay) {
    setTimeout(() => {
      tryFlushPendingShipFittingReplay(session);
    }, 0);
  }
}

module.exports = {
  describeSessionHydrationState,
  flushPendingCommandSessionEffects,
  requestPostHudFittingReplay,
  requestPendingShipFittingReplayFromHud,
  requestPostHudChargeRefresh,
  requestPendingShipChargeDogmaReplayFromHud,
  requestPendingShipChargeDogmaReplayFromInventory,
  tryFlushPendingShipFittingReplay,
  tryFlushPendingShipChargeDogmaReplay,
};
