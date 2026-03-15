const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));

function getDictValue(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return undefined;
  }

  const match = dict.entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

function getDestinyUpdates(notifications) {
  return (notifications || []).flatMap((entry) => {
    if (entry.notifyType !== "DoDestinyUpdate") {
      return [];
    }
    const updateList = entry.payloadTuple && entry.payloadTuple[0];
    if (!updateList || updateList.type !== "list" || !Array.isArray(updateList.items)) {
      return [];
    }
    return updateList.items.map((item) => ({
      stamp: item[0],
      payload: item[1],
    }));
  });
}

function makeReadySession(systemID, shipID = 140009999) {
  const notifications = [];
  return {
    clientID: shipID,
    socket: { destroyed: false },
    _space: {
      systemID,
      shipID,
      initialStateSent: true,
    },
    notifications,
    sendNotification(notifyType, idType, payloadTuple = []) {
      notifications.push({
        notifyType,
        idType,
        payloadTuple,
      });
    },
  };
}

function main() {
  const JITA_SYSTEM_ID = 30000142;
  const NEW_CALDARI_SYSTEM_ID = 30000145;
  const PERIMETER_SYSTEM_ID = 30000144;
  const JITA_TO_NEW_CALDARI_GATE_ID = 50001250;
  const JITA_TO_PERIMETER_GATE_ID = 50001249;
  const {
    CLOSED,
    OPEN,
    ACTIVATING,
  } = runtime._testing.STARGATE_ACTIVATION_STATE;
  const { STARGATE_ACTIVATION_TRANSITION_MS } = runtime._testing;

  runtime._testing.clearScenes();
  runtime._testing.resetStargateActivationOverrides();

  try {
    const jitaScene = runtime.ensureScene(JITA_SYSTEM_ID);
    const jitaToNewCaldariGate = jitaScene.getEntityByID(
      JITA_TO_NEW_CALDARI_GATE_ID,
    );
    const jitaToPerimeterGate = jitaScene.getEntityByID(
      JITA_TO_PERIMETER_GATE_ID,
    );

    assert(jitaToNewCaldariGate, "Expected Jita -> New Caldari stargate in Jita scene");
    assert(jitaToPerimeterGate, "Expected Jita -> Perimeter stargate in Jita scene");
    assert.strictEqual(
      jitaToNewCaldariGate.activationState,
      CLOSED,
      "Unloaded destination systems should start closed",
    );
    assert.strictEqual(
      jitaToPerimeterGate.activationState,
      CLOSED,
      "Another unloaded destination should also start closed",
    );

    const readySession = makeReadySession(JITA_SYSTEM_ID);
    jitaScene.sessions.set(readySession.clientID, readySession);

    runtime.ensureScene(NEW_CALDARI_SYSTEM_ID);
    assert.strictEqual(
      jitaToNewCaldariGate.activationState,
      ACTIVATING,
      "Loading the destination scene should push inbound gates into the transient activating state",
    );
    assert.strictEqual(
      jitaToPerimeterGate.activationState,
      CLOSED,
      "Unloaded systems should remain closed after unrelated scene loads",
    );

    const destinyUpdates = getDestinyUpdates(readySession.notifications);
    const jitaToNewCaldariNotices = destinyUpdates.filter(
      (entry) =>
        Array.isArray(entry.payload) &&
        entry.payload[0] === "OnSlimItemChange" &&
        entry.payload[1][0] === JITA_TO_NEW_CALDARI_GATE_ID,
    );
    assert(
      jitaToNewCaldariNotices.length > 0,
      "Opening a destination system should push michelle.OnSlimItemChange for affected gates",
    );
    const latestNewCaldariNotice =
      jitaToNewCaldariNotices[jitaToNewCaldariNotices.length - 1];
    assert.strictEqual(
      getDictValue(latestNewCaldariNotice.payload[1][1].args, "activationState"),
      ACTIVATING,
      "Live slim update should carry the transient activating state first",
    );

    jitaScene.tick(Date.now() + STARGATE_ACTIVATION_TRANSITION_MS + 1);
    assert.strictEqual(
      jitaToNewCaldariGate.activationState,
      OPEN,
      "Activated gates should settle into the steady open state after the transition window",
    );
    const settledNewCaldariNotice =
      getDestinyUpdates(readySession.notifications)
        .filter(
          (entry) =>
            Array.isArray(entry.payload) &&
            entry.payload[0] === "OnSlimItemChange" &&
            entry.payload[1][0] === JITA_TO_NEW_CALDARI_GATE_ID,
        )
        .slice(-1)[0];
    assert.strictEqual(
      getDictValue(settledNewCaldariNotice.payload[1][1].args, "activationState"),
      OPEN,
      "The settled slim update should carry the steady open state",
    );

    runtime.setSolarSystemStargateActivationState(PERIMETER_SYSTEM_ID, OPEN);
    assert.strictEqual(
      jitaToPerimeterGate.activationState,
      ACTIVATING,
      "Solar-system override should use the same transient activating state",
    );
    jitaScene.tick(Date.now() + STARGATE_ACTIVATION_TRANSITION_MS + 1);
    assert.strictEqual(
      jitaToPerimeterGate.activationState,
      OPEN,
      "Solar-system override should settle into steady open state after the transition window",
    );

    runtime.setStargateActivationState(JITA_TO_PERIMETER_GATE_ID, CLOSED);
    assert.strictEqual(
      jitaToPerimeterGate.activationState,
      CLOSED,
      "Per-gate override should win over the solar-system activation state",
    );

    const jitaToPerimeterNotices = getDestinyUpdates(readySession.notifications).filter(
      (entry) =>
        Array.isArray(entry.payload) &&
        entry.payload[0] === "OnSlimItemChange" &&
        entry.payload[1][0] === JITA_TO_PERIMETER_GATE_ID,
    );
    assert(
      jitaToPerimeterNotices.length >= 2,
      "Solar-system and stargate overrides should both emit live michelle.OnSlimItemChange updates",
    );
    const latestPerimeterNotice =
      jitaToPerimeterNotices[jitaToPerimeterNotices.length - 1];
    assert.strictEqual(
      getDictValue(latestPerimeterNotice.payload[1][1].args, "activationState"),
      CLOSED,
      "Latest slim update should reflect the per-gate closed override",
    );
    assert(
      readySession.notifications.some((entry) => entry.notifyType === "DoDestinyUpdate"),
      "Slim item changes should travel through DoDestinyUpdate",
    );

    runtime._testing.clearScenes();
    runtime._testing.resetStargateActivationOverrides();
    runtime.preloadStartupSolarSystems({ broadcast: false });
    const preloadedJitaScene = runtime.ensureScene(JITA_SYSTEM_ID);
    const preloadedJitaToNewCaldariGate = preloadedJitaScene.getEntityByID(
      JITA_TO_NEW_CALDARI_GATE_ID,
    );
    assert(preloadedJitaToNewCaldariGate, "Expected preloaded Jita -> New Caldari gate");
    assert.strictEqual(
      preloadedJitaToNewCaldariGate.activationState,
      OPEN,
      "Startup preload should leave Jita -> New Caldari open immediately",
    );

    console.log(JSON.stringify({
      ok: true,
      startupClosedGateID: JITA_TO_NEW_CALDARI_GATE_ID,
      startupClosedState: CLOSED,
      openedBySceneLoadGateID: JITA_TO_NEW_CALDARI_GATE_ID,
      openingState: ACTIVATING,
      openedBySceneLoadState: OPEN,
      startupPreloadGateState: preloadedJitaToNewCaldariGate.activationState,
      solarSystemOverrideGateID: JITA_TO_PERIMETER_GATE_ID,
      finalPerimeterGateState: jitaToPerimeterGate.activationState,
      jitaToNewCaldariNoticeCount: jitaToNewCaldariNotices.length,
      jitaToPerimeterNoticeCount: jitaToPerimeterNotices.length,
      doDestinyUpdateCount: readySession.notifications.filter(
        (entry) => entry.notifyType === "DoDestinyUpdate",
      ).length,
    }, null, 2));
  } finally {
    runtime._testing.clearScenes();
    runtime._testing.resetStargateActivationOverrides();
  }
}

main();
