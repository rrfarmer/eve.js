const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const transitions = require(path.join(repoRoot, "server/src/space/transitions"));
const worldData = require(path.join(repoRoot, "server/src/space/worldData"));
const BeyonceService = require(path.join(
  repoRoot,
  "server/src/services/ship/beyonceService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
  getActiveShipRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  dockShipToStation,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  getFittedModuleItems,
  getLoadedChargeItems,
  isModuleOnline,
  hasLoadedScanProbeLauncherCharge,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const ATTRIBUTE_QUANTITY = 805;

function buildSession(characterID) {
  const notifications = [];
  const sessionChanges = [];
  return {
    clientID: characterID + 9200,
    userid: characterID,
    characterID: 0,
    charid: 0,
    corporationID: 0,
    allianceID: null,
    warFactionID: null,
    stationid: null,
    stationID: null,
    stationid2: null,
    locationid: null,
    solarsystemid: null,
    solarsystemid2: null,
    shipID: null,
    shipid: null,
    activeShipID: null,
    socket: { destroyed: false },
    _notifications: notifications,
    _sessionChanges: sessionChanges,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      sessionChanges.push(change);
    },
  };
}

function findSpaceCombatCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  let probeFallbackCandidate = null;
  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship || !ship.spaceState) {
      continue;
    }
    if (Number(characterRecord.stationID || characterRecord.stationid || 0) > 0) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    if (fittedModules.length === 0) {
      continue;
    }

    const onlineModules = fittedModules.filter((item) => isModuleOnline(item));
    if (onlineModules.length === 0) {
      continue;
    }

    const loadedCharges = getLoadedChargeItems(characterID, ship.itemID);
    if (loadedCharges.length === 0) {
      continue;
    }

    const candidate = {
      characterID,
      ship,
      fittedModules,
      loadedCharges,
    };
    if (!hasLoadedScanProbeLauncherCharge(characterID, ship.itemID)) {
      return candidate;
    }
    if (!probeFallbackCandidate) {
      probeFallbackCandidate = candidate;
    }
  }

  if (probeFallbackCandidate) {
    return probeFallbackCandidate;
  }

  assert.fail("Expected an in-space character with online fitted modules and loaded charges");
}

function findDockedCombatCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  let probeFallbackCandidate = null;
  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship) {
      continue;
    }
    if (!(Number(characterRecord.stationID || characterRecord.stationid || 0) > 0)) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    if (fittedModules.length === 0) {
      continue;
    }

    const onlineModules = fittedModules.filter((item) => isModuleOnline(item));
    if (onlineModules.length === 0) {
      continue;
    }

    const loadedCharges = getLoadedChargeItems(characterID, ship.itemID);
    if (loadedCharges.length === 0) {
      continue;
    }

    const candidate = {
      characterID,
      ship,
      fittedModules,
      loadedCharges,
      stationID: Number(characterRecord.stationID || characterRecord.stationid || 0),
    };
    if (!hasLoadedScanProbeLauncherCharge(characterID, ship.itemID)) {
      return candidate;
    }
    if (!probeFallbackCandidate) {
      probeFallbackCandidate = candidate;
    }
  }

  if (probeFallbackCandidate) {
    return probeFallbackCandidate;
  }

  const fallback = findSpaceCombatCandidate();
  const fallbackRecord = getCharacterRecord(fallback.characterID);
  const fallbackStationID =
    Number(
      fallbackRecord &&
        (fallbackRecord.homeStationID ||
          fallbackRecord.cloneStationID ||
          fallbackRecord.stationID ||
          fallbackRecord.stationid ||
          60003760),
    ) || 60003760;
  const fallbackStation = worldData.getStationByID(fallbackStationID);
  assert.ok(
    fallbackStation,
    `Expected a valid fallback station for docked combat candidate ${fallbackStationID}`,
  );
  const dockResult = dockShipToStation(fallback.ship.itemID, fallbackStationID);
  assert.equal(
    dockResult && dockResult.success,
    true,
    "Expected fallback combat ship to dock successfully for undock hydration coverage",
  );
  const updateResult = updateCharacterRecord(fallback.characterID, (record) => ({
    ...record,
    stationID: fallbackStationID,
    structureID: null,
    worldSpaceID: 0,
    solarSystemID: Number(fallbackStation.solarSystemID) || Number(record.solarSystemID || 0) || 30000142,
  }));
  assert.equal(
    updateResult && updateResult.success,
    true,
    "Expected fallback combat character to update into a docked station state",
  );

  return {
    characterID: fallback.characterID,
    ship: getActiveShipRecord(fallback.characterID),
    fittedModules: getFittedModuleItems(fallback.characterID, fallback.ship.itemID),
    loadedCharges: getLoadedChargeItems(fallback.characterID, fallback.ship.itemID),
    stationID: fallbackStationID,
  };
}

function extractOnItemChangeRawItemIDs(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnItemChange")
    .map((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[0] : null;
      const itemRow =
        payload &&
        payload.type === "packedrow" &&
        payload.fields &&
        typeof payload.fields === "object"
          ? payload.fields
          : null;
      return itemRow ? itemRow.itemID : null;
    })
    .filter((itemID) => itemID !== null && itemID !== undefined);
}

function extractModuleAttributeChanges(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification.name === "OnModuleAttributeChanges")
    .flatMap((notification) => {
      const payload = Array.isArray(notification.payload)
        ? notification.payload[0]
        : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

function countRawOnItemChangesByItemID(notifications, expectedItemID) {
  const numericExpectedItemID = Number(expectedItemID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) => Number(itemID) === numericExpectedItemID,
  ).length;
}

function countRawOnItemChangesByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return extractOnItemChangeRawItemIDs(notifications).filter(
    (itemID) =>
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID,
  ).length;
}

function countChargeQuantityChangesByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return extractModuleAttributeChanges(notifications).filter((change) => {
    const itemID = Array.isArray(change) ? change[2] : null;
    return (
      Array.isArray(itemID) &&
      Number(itemID[0]) === numericShipID &&
      Number(itemID[1]) === numericFlagID &&
      Number(itemID[2]) === numericTypeID &&
      Number(Array.isArray(change) ? change[3] : 0) === ATTRIBUTE_QUANTITY
    );
  }).length;
}

function countOnGodmaPrimeItemsByTupleKey(
  notifications,
  shipID,
  flagID,
  typeID,
) {
  const numericShipID = Number(shipID) || 0;
  const numericFlagID = Number(flagID) || 0;
  const numericTypeID = Number(typeID) || 0;
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnGodmaPrimeItem")
    .filter((notification) => {
      const payload = Array.isArray(notification.payload) ? notification.payload[1] : null;
      const itemIDEntry =
        payload &&
        payload.name === "util.KeyVal" &&
        payload.args &&
        payload.args.type === "dict" &&
        Array.isArray(payload.args.entries)
          ? payload.args.entries.find(
              (entry) => Array.isArray(entry) && entry[0] === "itemID",
            )
          : null;
      const itemID = itemIDEntry ? itemIDEntry[1] : null;
      return (
        Array.isArray(itemID) &&
        Number(itemID[0]) === numericShipID &&
        Number(itemID[1]) === numericFlagID &&
        Number(itemID[2]) === numericTypeID
      );
    }).length;
}

function extractOnItemChangeKeysByItemID(notifications) {
  const byItemID = new Map();
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (notification.name !== "OnItemChange") {
      continue;
    }
    const payload = Array.isArray(notification.payload) ? notification.payload : [];
    const itemRow =
      payload[0] &&
      payload[0].type === "packedrow" &&
      payload[0].fields &&
      typeof payload[0].fields === "object"
        ? payload[0].fields
        : null;
    const itemID = Number(itemRow && itemRow.itemID) || 0;
    if (!itemID) {
      continue;
    }
    const changeEntries =
      payload[1] && payload[1].type === "dict" && Array.isArray(payload[1].entries)
        ? payload[1].entries
        : [];
    byItemID.set(
      itemID,
      changeEntries
        .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
        .filter((key) => key > 0)
        .sort((left, right) => left - right),
    );
  }
  return byItemID;
}

function bindShipInventory(service, session, shipID) {
  const bound = service.Handle_GetInventoryFromId([shipID], session);
  const boundID =
    bound &&
    bound.type === "substruct" &&
    bound.value &&
    bound.value.type === "substream" &&
    Array.isArray(bound.value.value)
      ? bound.value.value[0]
      : null;
  assert.ok(boundID, "Expected GetInventoryFromId to return a bound inventory substruct");
  session.currentBoundObjectID = boundID;
}

async function waitFor(predicate, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function prepareOpenGate(scene) {
  const stargate = scene.staticEntities.find((entity) => entity.kind === "stargate");
  assert.ok(stargate, "expected at least one stargate in the source scene");
  spaceRuntime.ensureScene(stargate.destinationSolarSystemID);
  spaceRuntime.refreshStargateActivationStates({
    broadcast: false,
    animateOpenTransitions: false,
  });
  scene.settleTransientStargateActivationStates(
    Date.now() + spaceRuntime._testing.STARGATE_ACTIVATION_TRANSITION_MS + 1,
  );
  const openGate = scene.getEntityByID(stargate.itemID);
  assert.ok(openGate, "expected refreshed stargate entity");
  assert.equal(
    openGate.activationState,
    spaceRuntime._testing.STARGATE_ACTIVATION_STATE.OPEN,
  );
  return openGate;
}

test.afterEach(() => {
  spaceRuntime._testing.clearScenes();
});

test("stargate jump keeps loaded charges on the delayed real-HUD replay lane after ship inventory prime", async () => {
  const candidate = findSpaceCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true);

  const sourceScene = spaceRuntime.ensureScene(candidate.ship.spaceState.systemID);
  const shipEntity = sourceScene.attachSession(session, candidate.ship, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  const openGate = prepareOpenGate(sourceScene);
  const sourceGate = worldData.getStargateByID(openGate.itemID);
  const destinationGate = worldData.getStargateByID(sourceGate && sourceGate.destinationID);
  assert.ok(sourceGate, "expected a source stargate record");
  assert.ok(destinationGate, "expected a destination stargate record");

  shipEntity.position = { ...openGate.position };
  shipEntity.velocity = { x: 0, y: 0, z: 0 };
  shipEntity.mode = "STOP";
  shipEntity.speedFraction = 0;

  const jumpOutResult = spaceRuntime.startStargateJump(session, sourceGate.itemID);
  assert.equal(jumpOutResult.success, true);

  session._notifications.length = 0;
  session._transitionState = {
    kind: "stargate-jump",
    targetID: sourceGate.itemID,
    startedAt: Date.now(),
  };

  const activeShip = getActiveShipRecord(session.characterID);
  const completionResult = transitions._testing.completeStargateJumpForTesting(
    session,
    sourceGate,
    destinationGate,
    activeShip,
  );
  assert.equal(completionResult.success, true);
  assert.equal(
    Number(
      session._pendingCommandShipFittingReplay &&
        session._pendingCommandShipFittingReplay.shipID,
    ),
    Number(candidate.ship.itemID),
    "expected stargate jump to queue a delayed HUD replay for the active ship",
  );
  assert.equal(
    session._space && session._space.loginChargeHydrationProfile,
    "stargate",
    "expected stargate jump attach to keep the dedicated stargate hydration profile",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.awaitPostLoginShipInventoryList,
    true,
    "expected stargate jump to hold the delayed HUD replay until ship inventory prime completes",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.awaitPostLoginHudTurretBootstrap,
    true,
    "expected stargate jump to keep the delayed HUD replay armed until the first rack bootstrap asks for turret slots",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.onlyCharges,
    true,
    "expected stargate jump to use the charge-only HUD repair lane instead of the older module+tuple bootstrap path",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.emitChargeInventoryRows,
    true,
    "expected stargate jump to replay real loaded charge rows for the HUD after bootstrap",
  );
  assert.equal(session._space.loginShipInventoryPrimed, false);
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
  assert.equal(session._space.useRealChargeInventoryHudRows, true);
  assert.ok(
    session._space.loginFittingReplayTimer,
    "expected stargate jump attach to arm the implicit delayed HUD replay timer immediately",
  );

  const destinationScene = spaceRuntime.getSceneForSession(session);
  assert.ok(destinationScene, "expected stargate jump to attach the session to the destination scene");
  destinationScene.tick(destinationScene.getCurrentWallclockMs() + 2500);

  const beyonce = new BeyonceService();
  const bindResult = beyonce.Handle_MachoBindObject(
    [destinationGate.solarSystemID, null],
    session,
    null,
  );
  assert.ok(Array.isArray(bindResult));
  beyonce.afterCallResponse("MachoBindObject", session);

  const hydrated = await waitFor(
    () => session._space && session._space.beyonceBound === true,
  );
  assert.equal(
    hydrated,
    true,
    "expected stargate jump bind to complete while keeping the delayed HUD replay pending for ship inventory prime",
  );
  const prePrimeOnItemChangeItemIDs = extractOnItemChangeRawItemIDs(
    session._notifications,
  ).filter((itemID) => Number(itemID) !== Number(candidate.ship.itemID));
  assert.deepEqual(
    prePrimeOnItemChangeItemIDs,
    [],
    "expected stargate jump bind to avoid a synthetic fitted-module OnItemChange replay before ship inventory prime",
  );

  const invBroker = new InvBrokerService();
  bindShipInventory(invBroker, session, candidate.ship.itemID);
  invBroker.Handle_List([null], session, {});

  const primed = await waitFor(
    () => session._space && session._space.loginShipInventoryPrimed === true,
  );
  assert.equal(
    primed,
    true,
    "expected the first post-gate ship inventory List(flag=None) to complete ship inventory prime before the delayed HUD charge replay",
  );
  for (const fittedModule of candidate.fittedModules) {
    assert.equal(
      countRawOnItemChangesByItemID(session._notifications, fittedModule.itemID),
      0,
      `expected stargate jump inventory prime to avoid synthetic fitted-module replay churn for module ${fittedModule.itemID}`,
    );
  }
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session._notifications, loadedCharge.itemID),
      0,
      `expected stargate jump inventory prime to defer real loaded charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected stargate jump inventory prime to avoid tuple-backed charge slot transitions before the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected stargate jump inventory prime to avoid tuple-backed quantity churn for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected stargate jump inventory prime to avoid tuple godma-prime for loaded charge slot ${loadedCharge.flagID}`,
    );
  }
  assert.equal(session._space.loginShipInventoryPrimed, true);
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
  assert.equal(
    Boolean(session._pendingCommandShipFittingReplay),
    true,
    "expected stargate jump to keep the delayed HUD replay armed until the first turret-slot bootstrap",
  );

  const hudHydrated = await waitFor(
    () =>
      candidate.loadedCharges.every(
        (loadedCharge) =>
          countRawOnItemChangesByItemID(
            session._notifications,
            loadedCharge.itemID,
          ) >= 1,
      ) &&
      !session._pendingCommandShipFittingReplay,
    140,
  );
  assert.equal(
    hudHydrated,
    true,
    "expected stargate jump to auto-flush the delayed real loaded charge rows after ship inventory prime even if no turret-slot bootstrap arrives",
  );
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
  for (const loadedCharge of candidate.loadedCharges) {
    assert.ok(
      countRawOnItemChangesByItemID(
        session._notifications,
        loadedCharge.itemID,
      ) >= 1,
      `expected stargate jump HUD bootstrap to replay real loaded charge row ${loadedCharge.itemID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected stargate jump HUD bootstrap to avoid tuple-backed charge slot replay for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected stargate jump HUD bootstrap to avoid tuple quantity bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected stargate jump HUD bootstrap to avoid tuple godma-prime for loaded charge slot ${loadedCharge.flagID}`,
    );
  }
  const stabilizedRealChargeReplayCounts = new Map(
    candidate.loadedCharges.map((loadedCharge) => [
      String(loadedCharge.itemID),
      countRawOnItemChangesByItemID(
        session._notifications,
        loadedCharge.itemID,
      ),
    ]),
  );
  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  await new Promise((resolve) => setTimeout(resolve, 600));
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(
        session._notifications,
        loadedCharge.itemID,
      ) <=
        stabilizedRealChargeReplayCounts.get(String(loadedCharge.itemID)) + 1,
      true,
      `expected later stargate HUD polls to avoid more than one stabilizing loaded charge row restate for ${loadedCharge.itemID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later stargate HUD polls to avoid replaying tuple quantity bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later stargate HUD polls to avoid reopening tuple godma-prime for loaded charge slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later stargate HUD polls to avoid replaying tuple-backed charge slot ${loadedCharge.flagID}`,
    );
  }
  assert.equal(session._space.loginChargeHudFinalizePending, false);
  assert.equal(session._space.loginChargeHudFinalizeWindowEndsAtMs, 0);
});

test("solar jump keeps loaded charges on the delayed real-HUD replay lane after ship inventory prime", async () => {
  const candidate = findSpaceCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true);

  const sourceScene = spaceRuntime.ensureScene(candidate.ship.spaceState.systemID);
  const shipEntity = sourceScene.attachSession(session, candidate.ship, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  const targetSolarSystemID =
    Number(candidate.ship.spaceState.systemID) === 30000140 ? 30000142 : 30000140;

  session._notifications.length = 0;
  const jumpResult = transitions.jumpSessionToSolarSystem(session, targetSolarSystemID);
  assert.equal(jumpResult.success, true);
  assert.equal(
    Number(
      session._pendingCommandShipFittingReplay &&
        session._pendingCommandShipFittingReplay.shipID,
    ),
    Number(candidate.ship.itemID),
    "expected solar jump to queue a delayed HUD replay for the active ship",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.awaitPostLoginShipInventoryList,
    true,
    "expected solar jump to hold the delayed HUD replay until ship inventory prime completes",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.awaitPostLoginHudTurretBootstrap,
    true,
    "expected solar jump to keep the delayed HUD replay armed until the first rack bootstrap asks for turret slots",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.onlyCharges,
    true,
    "expected solar jump to use the charge-only HUD repair lane instead of the older module+tuple bootstrap path",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.emitChargeInventoryRows,
    true,
    "expected solar jump to replay real loaded charge rows for the HUD after bootstrap",
  );
  assert.equal(session._space.loginShipInventoryPrimed, false);
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
  assert.equal(session._space.useRealChargeInventoryHudRows, true);
  assert.ok(
    session._space.loginFittingReplayTimer,
    "expected solar jump attach to arm the implicit delayed HUD replay timer immediately",
  );

  const destinationScene = spaceRuntime.getSceneForSession(session);
  assert.ok(destinationScene, "expected jump to attach the session to the destination scene");
  destinationScene.tick(destinationScene.getCurrentWallclockMs() + 2500);

  const beyonce = new BeyonceService();
  const bindResult = beyonce.Handle_MachoBindObject([targetSolarSystemID, null], session, null);
  assert.ok(Array.isArray(bindResult));
  beyonce.afterCallResponse("MachoBindObject", session);

  const hydrated = await waitFor(
    () => session._space && session._space.beyonceBound === true,
  );
  assert.equal(
    hydrated,
    true,
    "expected solar jump bind to complete while keeping the delayed HUD replay pending for ship inventory prime",
  );
  const prePrimeOnItemChangeItemIDs = extractOnItemChangeRawItemIDs(
    session._notifications,
  ).filter((itemID) => Number(itemID) !== Number(candidate.ship.itemID));
  assert.deepEqual(
    prePrimeOnItemChangeItemIDs,
    [],
    "expected solar jump bind to avoid a synthetic fitted-module OnItemChange replay before ship inventory prime",
  );

  const invBroker = new InvBrokerService();
  bindShipInventory(invBroker, session, candidate.ship.itemID);
  invBroker.Handle_List([null], session, {});

  const primed = await waitFor(
    () => session._space && session._space.loginShipInventoryPrimed === true,
  );
  assert.equal(
    primed,
    true,
    "expected the first post-jump ship inventory List(flag=None) to complete ship inventory prime before the delayed HUD charge replay",
  );
  for (const fittedModule of candidate.fittedModules) {
    assert.equal(
      countRawOnItemChangesByItemID(session._notifications, fittedModule.itemID),
      0,
      `expected solar jump inventory prime to avoid synthetic fitted-module replay churn for module ${fittedModule.itemID}`,
    );
  }
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(session._notifications, loadedCharge.itemID),
      0,
      `expected solar jump inventory prime to defer real loaded charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected solar jump inventory prime to avoid tuple-backed charge slot transitions before the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected solar jump inventory prime to avoid tuple-backed quantity churn for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected solar jump inventory prime to avoid tuple godma-prime for loaded charge slot ${loadedCharge.flagID}`,
    );
  }
  assert.equal(session._space.loginShipInventoryPrimed, true);
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
  assert.equal(
    Boolean(session._pendingCommandShipFittingReplay),
    true,
    "expected solar jump to keep the delayed HUD replay armed until the first turret-slot bootstrap",
  );

  const hudHydrated = await waitFor(
    () =>
      candidate.loadedCharges.every(
        (loadedCharge) =>
          countRawOnItemChangesByItemID(
            session._notifications,
            loadedCharge.itemID,
          ) >= 1,
      ) &&
      !session._pendingCommandShipFittingReplay,
    140,
  );
  assert.equal(
    hudHydrated,
    true,
    "expected solar jump to auto-flush the delayed real loaded charge rows after ship inventory prime even if no turret-slot bootstrap arrives",
  );
  assert.equal(session._space.loginChargeDogmaReplayPending, false);
  assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
  for (const loadedCharge of candidate.loadedCharges) {
    assert.ok(
      countRawOnItemChangesByItemID(
        session._notifications,
        loadedCharge.itemID,
      ) >= 1,
      `expected solar jump HUD bootstrap to replay real loaded charge row ${loadedCharge.itemID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected solar jump HUD bootstrap to avoid tuple-backed charge slot replay for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected solar jump HUD bootstrap to avoid tuple quantity bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected solar jump HUD bootstrap to avoid tuple godma-prime for loaded charge slot ${loadedCharge.flagID}`,
    );
  }
  const stabilizedRealChargeReplayCounts = new Map(
    candidate.loadedCharges.map((loadedCharge) => [
      String(loadedCharge.itemID),
      countRawOnItemChangesByItemID(
        session._notifications,
        loadedCharge.itemID,
      ),
    ]),
  );
  invBroker.Handle_GetAvailableTurretSlots([], session);
  invBroker.afterCallResponse("GetAvailableTurretSlots", session);
  await new Promise((resolve) => setTimeout(resolve, 600));
  for (const loadedCharge of candidate.loadedCharges) {
    assert.equal(
      countRawOnItemChangesByItemID(
        session._notifications,
        loadedCharge.itemID,
      ) <=
        stabilizedRealChargeReplayCounts.get(String(loadedCharge.itemID)) + 1,
      true,
      `expected later solar HUD polls to avoid more than one stabilizing loaded charge row restate for ${loadedCharge.itemID}`,
    );
    assert.equal(
      countChargeQuantityChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later solar HUD polls to avoid replaying tuple quantity bootstrap for slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countOnGodmaPrimeItemsByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later solar HUD polls to avoid reopening tuple godma-prime for loaded charge slot ${loadedCharge.flagID}`,
    );
    assert.equal(
      countRawOnItemChangesByTupleKey(
        session._notifications,
        candidate.ship.itemID,
        loadedCharge.flagID,
        loadedCharge.typeID,
      ),
      0,
      `expected later solar HUD polls to avoid replaying tuple-backed charge slot ${loadedCharge.flagID}`,
    );
  }
  assert.equal(session._space.loginChargeHudFinalizePending, false);
  assert.equal(session._space.loginChargeHudFinalizeWindowEndsAtMs, 0);
});

test("solar jump into an already loaded destination uses the lighter warm hydration profile", () => {
  const candidate = findSpaceCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
  });
  assert.equal(applyResult.success, true);

  const sourceScene = spaceRuntime.ensureScene(candidate.ship.spaceState.systemID);
  const shipEntity = sourceScene.attachSession(session, candidate.ship, {
    broadcast: false,
    emitSimClockRebase: false,
    spawnStopped: true,
  });
  assert.ok(shipEntity);

  const targetSolarSystemID =
    Number(candidate.ship.spaceState.systemID) === 30000140 ? 30000142 : 30000140;

  const warmDestinationScene = spaceRuntime.ensureScene(targetSolarSystemID);
  assert.ok(warmDestinationScene);

  const jumpResult = transitions.jumpSessionToSolarSystem(session, targetSolarSystemID);
  assert.equal(jumpResult.success, true);
  assert.equal(
    session._space && session._space.loginChargeHydrationProfile,
    "solarWarm",
    "expected warm solar jumps to use the lighter hydration profile",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.awaitPostLoginShipInventoryList,
    false,
    "expected warm solar jumps to avoid waiting on ship inventory prime before replay",
  );
  assert.equal(
    session._pendingCommandShipFittingReplay.awaitPostLoginHudTurretBootstrap,
    false,
    "expected warm solar jumps to avoid the delayed HUD turret bootstrap wait",
  );
  assert.equal(
    Boolean(session._space && session._space.loginFittingReplayTimer),
    false,
    "expected warm solar jumps to skip the implicit delayed HUD bootstrap timer",
  );
});

test("undock leaves the first ballpark bootstrap free to emit the initial sim-clock rebase", () => {
  const candidate = findDockedCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  assert.equal(applyResult.success, true);

  try {
    session._notifications.length = 0;
    const undockResult = transitions.undockSession(session);
    assert.equal(undockResult.success, true);

    const scene = spaceRuntime.getSceneForSession(session);
    assert.ok(scene, "expected undock to attach the session to a space scene");
    assert.equal(
      session._notifications.filter((entry) => entry.name === "DoSimClockRebase").length,
      0,
      "expected undock attach itself to stay quiet and let the initial ballpark bootstrap own the authoritative rebase",
    );
    assert.equal(
      session._skipNextInitialBallparkRebase === true,
      false,
      "expected undock not to suppress the first bootstrap rebase the CCP/reference path still emits",
    );

    const bootstrapSent = scene.ensureInitialBallpark(session, { force: true });
    assert.equal(bootstrapSent, true);

    const rebaseNotifications = session._notifications.filter(
      (entry) => entry.name === "DoSimClockRebase",
    );
    assert.equal(
      rebaseNotifications.length,
      1,
      "expected the first undock ballpark bootstrap to emit one authoritative sim-clock rebase",
    );
    const firstRebaseIndex = session._notifications.findIndex(
      (entry) => entry.name === "DoSimClockRebase",
    );
    const firstDestinyUpdateIndex = session._notifications.findIndex(
      (entry) => entry.name === "DoDestinyUpdate",
    );
    assert.ok(firstRebaseIndex >= 0, "expected an undock bootstrap rebase notification");
    assert.ok(firstDestinyUpdateIndex >= 0, "expected undock bootstrap destiny updates");
    assert.equal(
      firstRebaseIndex < firstDestinyUpdateIndex,
      true,
      "expected the undock bootstrap rebase to flush before the first AddBalls2/SetState updates",
    );
  } finally {
    if (!session.stationid && !session.stationID) {
      transitions.dockSession(session, candidate.stationID);
    }
  }
});

test("undock keeps loaded charges on the delayed real-HUD replay lane after ship inventory prime", async () => {
  const candidate = findDockedCombatCandidate();
  const session = buildSession(candidate.characterID);

  const applyResult = applyCharacterToSession(session, candidate.characterID, {
    emitNotifications: false,
    logSelection: false,
    selectionEvent: false,
    deferDockedShipSessionChange: false,
  });
  assert.equal(applyResult.success, true);

  try {
    session._notifications.length = 0;
    const undockResult = transitions.undockSession(session);
    assert.equal(undockResult.success, true);
    assert.equal(
      session._space.loginChargeDogmaReplayPending,
      false,
      "expected undock to keep tuple charge bootstrap disabled while the delayed HUD replay is armed",
    );
    assert.equal(
      session._space.loginChargeHudFinalizePending,
      false,
      "expected undock parity attach to keep the late HUD tuple repair window disabled until an explicit profile opts in",
    );
    assert.equal(
      session._space.useRealChargeInventoryHudRows,
      true,
      "expected undock to use the real loaded charge row lane for the module HUD",
    );

    const scene = spaceRuntime.getSceneForSession(session);
    assert.ok(scene, "expected undock to attach the session to a space scene");
    scene.tick(scene.getCurrentWallclockMs() + 2500);

    const beyonce = new BeyonceService();
    const bindResult = beyonce.Handle_MachoBindObject(
      [Number(session._space && session._space.systemID) || 0, null],
      session,
      null,
    );
    assert.ok(Array.isArray(bindResult));
    beyonce.afterCallResponse("MachoBindObject", session);

    const beyonceBound = await waitFor(
      () => session._space && session._space.beyonceBound === true,
    );
    assert.equal(
      beyonceBound,
      true,
      "expected undock beyonce bind to complete before the shared fitting hydration runs",
    );

    const invBroker = new InvBrokerService();
    bindShipInventory(invBroker, session, candidate.ship.itemID);
    invBroker.Handle_GetSelfInvItem([], session);
    for (const loadedCharge of candidate.loadedCharges) {
      assert.equal(
        countRawOnItemChangesByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected undock GetSelfInvItem to avoid replaying tuple-backed charge rows before the HUD bootstrap for slot ${loadedCharge.flagID}`,
      );
      assert.equal(
        countOnGodmaPrimeItemsByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected undock GetSelfInvItem to avoid tuple godma-prime before the HUD bootstrap for loaded charge slot ${loadedCharge.flagID}`,
      );
    }
    invBroker.Handle_List([null], session, {});

    const primed = await waitFor(
      () =>
        session._space &&
        session._space.loginShipInventoryPrimed === true,
    );
    assert.equal(
      primed,
      true,
      "expected undock ship inventory prime to complete before the delayed HUD charge replay",
    );
    for (const loadedCharge of candidate.loadedCharges) {
      assert.equal(
        countRawOnItemChangesByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected undock inventory prime to defer tuple-backed charge replay until the HUD rack bootstrap for slot ${loadedCharge.flagID}`,
      );
      assert.equal(
        countOnGodmaPrimeItemsByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected undock inventory prime to avoid tuple godma-prime until the HUD rack bootstrap for loaded charge slot ${loadedCharge.flagID}`,
      );
      assert.equal(
        countRawOnItemChangesByItemID(session._notifications, loadedCharge.itemID),
        0,
        `expected undock inventory prime to avoid replaying real loaded-charge inventory row ${loadedCharge.itemID}`,
      );
      assert.equal(
        countChargeQuantityChangesByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected undock inventory prime to avoid tuple quantity bootstrap for loaded charge slot ${loadedCharge.flagID}`,
      );
    }
    assert.equal(
      Boolean(session._pendingCommandShipFittingReplay),
      true,
      "expected undock to keep the delayed HUD replay armed until the first rack bootstrap",
    );

    const hudHydrated = await waitFor(
      () =>
        candidate.loadedCharges.every(
          (loadedCharge) =>
            countRawOnItemChangesByItemID(
              session._notifications,
              loadedCharge.itemID,
            ) >= 1,
        ) &&
      !session._pendingCommandShipFittingReplay,
      140,
    );
    assert.equal(
      hudHydrated,
      true,
      "expected undock to auto-flush the delayed real loaded charge rows after ship inventory prime even if no turret-slot bootstrap arrives",
    );
    assert.equal(session._space.loginChargeDogmaReplayPending, false);
    assert.equal(session._space.loginChargeDogmaReplayFlushed, true);
    for (const loadedCharge of candidate.loadedCharges) {
      assert.ok(
        countRawOnItemChangesByItemID(
          session._notifications,
          loadedCharge.itemID,
        ) >= 1,
        `expected undock HUD bootstrap to replay real loaded charge row ${loadedCharge.itemID}`,
      );
      assert.equal(
        countRawOnItemChangesByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected undock HUD bootstrap to avoid tuple-backed charge repair for loaded charge slot ${loadedCharge.flagID}`,
      );
      assert.equal(
        countOnGodmaPrimeItemsByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected undock HUD bootstrap to avoid tuple godma-prime for loaded charge slot ${loadedCharge.flagID}`,
      );
      assert.equal(
        countChargeQuantityChangesByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected undock HUD bootstrap to avoid tuple quantity hydrate for loaded charge slot ${loadedCharge.flagID}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    const stabilizedRealChargeReplayCounts = new Map(
      candidate.loadedCharges.map((loadedCharge) => [
        String(loadedCharge.itemID),
        countRawOnItemChangesByItemID(
          session._notifications,
          loadedCharge.itemID,
        ),
      ]),
    );
    invBroker.Handle_GetAvailableTurretSlots([], session);
    invBroker.afterCallResponse("GetAvailableTurretSlots", session);
    await new Promise((resolve) => setTimeout(resolve, 600));
    for (const loadedCharge of candidate.loadedCharges) {
      const laterRealChargeReplayCount = countRawOnItemChangesByItemID(
        session._notifications,
        loadedCharge.itemID,
      );
      assert.equal(
        laterRealChargeReplayCount <=
          stabilizedRealChargeReplayCounts.get(String(loadedCharge.itemID)) + 1,
        true,
        `expected later undock HUD polls to avoid more than one stabilizing loaded charge row restate for ${loadedCharge.itemID}`,
      );
      assert.equal(
        countOnGodmaPrimeItemsByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected later undock HUD polls to avoid reopening tuple godma-prime for loaded charge slot ${loadedCharge.flagID}`,
      );
      assert.equal(
        countChargeQuantityChangesByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected later undock HUD polls to avoid replaying extra tuple quantity bootstrap for loaded charge slot ${loadedCharge.flagID}`,
      );
      assert.equal(
        countRawOnItemChangesByTupleKey(
          session._notifications,
          candidate.ship.itemID,
          loadedCharge.flagID,
          loadedCharge.typeID,
        ),
        0,
        `expected later undock HUD polls to avoid replaying tuple-backed charge slot ${loadedCharge.flagID}`,
      );
    }
    assert.equal(session._space.loginChargeHudFinalizePending, false);
    assert.equal(session._space.loginChargeHudFinalizeWindowEndsAtMs, 0);
  } finally {
    if (!session.stationid && !session.stationID) {
      transitions.dockSession(session, candidate.stationID);
    }
  }
});
