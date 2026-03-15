const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const sessionRegistry = require(
  path.join(__dirname, "../services/chat/sessionRegistry"),
);
const {
  applyCharacterToSession,
  getCharacterRecord,
  getActiveShipRecord,
  updateCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../services/character/characterState"));
const { moveShipToSpace, dockShipToStation } = require(
  path.join(__dirname, "../services/inventory/itemStore"),
);
const { currentFileTime } = require(
  path.join(__dirname, "../services/_shared/serviceHelpers"),
);
const worldData = require(path.join(__dirname, "./worldData"));
const spaceRuntime = require(path.join(__dirname, "./runtime"));
const TRANSITION_GUARD_WINDOW_MS = 5000;

function buildBoundResult(session) {
  if (!session) {
    return null;
  }

  const preferredBoundId =
    session.currentBoundObjectID ||
    (session._boundObjectIDs &&
      (session._boundObjectIDs.ship || session._boundObjectIDs.beyonce)) ||
    session.lastBoundObjectID ||
    null;
  if (!preferredBoundId) {
    return null;
  }

  return [preferredBoundId, currentFileTime()];
}

function buildLocationIdentityPatch(record, solarSystemID, extra = {}) {
  const targetSolarSystemID =
    Number(solarSystemID || 0) ||
    Number(record.solarSystemID || 30000142) ||
    30000142;
  const system = worldData.getSolarSystemByID(targetSolarSystemID);

  return {
    ...record,
    ...extra,
    solarSystemID: targetSolarSystemID,
    constellationID:
      Number(
        (system && system.constellationID) || record.constellationID || 0,
      ) || 20000020,
    regionID:
      Number((system && system.regionID) || record.regionID || 0) || 10000002,
    worldSpaceID: 0,
  };
}

function beginTransition(session, kind, targetID = 0) {
  if (!session) {
    return false;
  }

  const now = Date.now();
  const activeTransition = session._transitionState || null;
  if (
    activeTransition &&
    activeTransition.kind === kind &&
    now - Number(activeTransition.startedAt || 0) < TRANSITION_GUARD_WINDOW_MS
  ) {
    return false;
  }

  session._transitionState = {
    kind,
    targetID: Number(targetID || 0) || 0,
    startedAt: now,
  };
  return true;
}

function endTransition(session, kind) {
  if (
    session &&
    session._transitionState &&
    session._transitionState.kind === kind
  ) {
    session._transitionState = null;
  }
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  const vectorSource = source && typeof source === "object" ? source : null;
  return {
    x: toFiniteNumber(vectorSource ? vectorSource.x : undefined, fallback.x),
    y: toFiniteNumber(vectorSource ? vectorSource.y : undefined, fallback.y),
    z: toFiniteNumber(vectorSource ? vectorSource.z : undefined, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(vector, 1 / length);
}

function distance(left, right) {
  const delta = subtractVectors(left, right);
  return Math.sqrt(delta.x ** 2 + delta.y ** 2 + delta.z ** 2);
}

function magnitude(vector) {
  return Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
}

function buildGateSpawnState(stargate) {
  const system = worldData.getSolarSystemByID(stargate.solarSystemID);
  const direction = normalizeVector(
    subtractVectors(
      cloneVector(stargate.position),
      cloneVector(system && system.position),
    ),
  );
  const offset = Math.max((stargate.radius || 15000) * 0.4, 5000);

  return {
    direction,
    position: addVectors(
      cloneVector(stargate.position),
      scaleVector(direction, offset),
    ),
  };
}

function buildOffsetSpawnState(anchor, options = {}) {
  const fallbackDirection = cloneVector(options.fallbackDirection, {
    x: 1,
    y: 0,
    z: 0,
  });
  const anchorPosition = cloneVector(anchor && anchor.position);
  const direction = normalizeVector(
    magnitude(anchorPosition) > 0 ? anchorPosition : fallbackDirection,
    fallbackDirection,
  );
  const minOffset = Math.max(toFiniteNumber(options.minOffset, 0), 0);
  const clearance = Math.max(toFiniteNumber(options.clearance, 0), 0);
  const offset = Math.max(
    toFiniteNumber(anchor && anchor.radius, 0) + clearance,
    minOffset,
  );
  const position = addVectors(anchorPosition, scaleVector(direction, offset));

  return {
    direction,
    position,
  };
}

function buildSolarSystemSpawnState(solarSystemID) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  if (!system) {
    return null;
  }

  const stargates = worldData.getStargatesForSystem(solarSystemID);
  if (stargates.length > 0) {
    const stargate = stargates[0];
    return {
      anchorType: "stargate",
      anchorID: stargate.itemID,
      anchorName: stargate.itemName || `Stargate ${stargate.itemID}`,
      ...buildOffsetSpawnState(stargate, {
        minOffset: Math.max((stargate.radius || 15000) * 0.4, 5000),
      }),
    };
  }

  const stations = worldData.getStationsForSystem(solarSystemID);
  if (stations.length > 0) {
    const station = stations[0];
    return {
      anchorType: "station",
      anchorID: station.stationID,
      anchorName: station.stationName || `Station ${station.stationID}`,
      ...buildOffsetSpawnState(station, {
        minOffset: Math.max((station.radius || 15000) * 0.4, 5000),
        clearance: 5000,
      }),
    };
  }

  const celestials = worldData.getCelestialsForSystem(solarSystemID);
  const celestial =
    celestials.find((entry) => entry.kind !== "sun" && entry.groupID !== 6) ||
    celestials.find((entry) => entry.kind === "sun" || entry.groupID === 6) ||
    celestials[0] ||
    null;
  if (celestial) {
    return {
      anchorType: celestial.kind || "celestial",
      anchorID: celestial.itemID,
      anchorName: celestial.itemName || `Celestial ${celestial.itemID}`,
      ...buildOffsetSpawnState(celestial, {
        minOffset: 100000,
        clearance:
          celestial.kind === "sun" || celestial.groupID === 6 ? 250000 : 25000,
      }),
    };
  }

  return {
    anchorType: "fallback",
    anchorID: system.solarSystemID,
    anchorName: system.solarSystemName || `System ${system.solarSystemID}`,
    direction: { x: 1, y: 0, z: 0 },
    position: { x: 1000000, y: 0, z: 0 },
  };
}

function broadcastOnCharNoLongerInStation(session, stationID) {
  if (!session || !stationID) {
    return;
  }

  const payload = [
    [
      session.characterID || 0,
      session.corporationID || 0,
      session.allianceID || 0,
      session.warFactionID || 0,
    ],
  ];

  for (const guest of sessionRegistry.getSessions()) {
    if (guest === session) {
      continue;
    }

    const guestStationID = guest.stationid || guest.stationID || 0;
    if (guestStationID !== stationID) {
      continue;
    }

    guest.sendNotification("OnCharNoLongerInStation", "stationid", payload);
  }
}

function queuePendingSessionEffects(session, options = {}) {
  if (!session || typeof session !== "object") {
    return;
  }

  if (options.forceInitialBallpark || options.awaitBeyonceBoundBallpark) {
    session._pendingCommandInitialBallpark = {
      force: options.forceInitialBallpark === true,
      awaitBeyonceBound: options.awaitBeyonceBoundBallpark === true,
    };
  }

  if (Object.prototype.hasOwnProperty.call(options, "previousLocalChannelID")) {
    session._pendingLocalChannelSync = {
      previousChannelID: Number(options.previousLocalChannelID || 0) || 0,
    };
  }
}

function syncDockedShipTransitionForSession(session, dockResult, options = {}) {
  if (!session || !dockResult || !dockResult.success || !dockResult.data) {
    return;
  }

  const dockedShip = dockResult.data;
  const previousData = dockResult.previousData || {};

  // Docking moves the active hull into the station hangar. The client needs
  // the location/flag delta for the move itself, then a second cache refresh
  // so the hangar scene can resolve the active hull immediately.
  syncInventoryItemForSession(
    session,
    dockedShip,
    {
      locationID: previousData.locationID,
      flagID: previousData.flagID,
      quantity: previousData.quantity,
      singleton: previousData.singleton,
      stacksize: previousData.stacksize,
    },
    {
      emitCfgLocation: true,
    },
  );

  if (options.refreshActiveShip !== false) {
    syncInventoryItemForSession(
      session,
      dockedShip,
      {
        locationID: dockedShip.locationID,
        flagID: dockedShip.flagID,
        quantity: dockedShip.quantity,
        singleton: dockedShip.singleton,
        stacksize: dockedShip.stacksize,
      },
      {
        emitCfgLocation: true,
      },
    );
  }
}

function undockSession(session) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const stationID = Number(session.stationid || session.stationID || 0);
  if (!stationID) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const station = worldData.getStationByID(stationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "undock", stationID)) {
    return {
      success: false,
      errorMsg: "UNDOCK_IN_PROGRESS",
    };
  }

  try {
    const undockState = spaceRuntime.getStationUndockSpawnState(station);

    const moveResult = moveShipToSpace(
      activeShip.itemID,
      station.solarSystemID,
      {
        position: undockState.position,
        direction: undockState.direction,
        velocity: { x: 0, y: 0, z: 0 },
        speedFraction: 0,
        mode: "STOP",
        targetPoint: undockState.position,
      },
    );
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    broadcastOnCharNoLongerInStation(session, stationID);

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, station.solarSystemID, {
        homeStationID:
          Number(
            record.homeStationID || record.cloneStationID || station.stationID,
          ) || station.stationID,
        cloneStationID:
          Number(
            record.cloneStationID || record.homeStationID || station.stationID,
          ) || station.stationID,
        stationID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: station.solarSystemID,
      undockDirection: undockState.direction,
      speedFraction: 1,
      pendingUndockMovement: false,
      skipLegacyStationNormalization: true,
      broadcast: true,
    });

    log.info(
      `[SpaceTransition] Undocked ${session.characterName || session.characterID} ship=${moveResult.data.itemID} station=${stationID} system=${station.solarSystemID}`,
    );

    return {
      success: true,
      data: {
        station,
        ship: moveResult.data,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "undock");
  }
}

function dockSession(session, stationID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  if (session.stationid || session.stationID) {
    return {
      success: false,
      errorMsg: "ALREADY_DOCKED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const station = worldData.getStationByID(targetStationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "dock", targetStationID)) {
    return {
      success: false,
      errorMsg: "DOCK_IN_PROGRESS",
    };
  }

  try {
    spaceRuntime.detachSession(session, { broadcast: true });

    const dockResult = dockShipToStation(activeShip.itemID, station.stationID);
    if (!dockResult.success) {
      return dockResult;
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, station.solarSystemID, {
        homeStationID:
          Number(
            record.homeStationID || record.cloneStationID || station.stationID,
          ) || station.stationID,
        cloneStationID:
          Number(
            record.cloneStationID || record.homeStationID || station.stationID,
          ) || station.stationID,
        stationID: station.stationID,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    syncDockedShipTransitionForSession(session, dockResult);

    log.info(
      `[SpaceTransition] Docked ${session.characterName || session.characterID} ship=${activeShip.itemID} station=${station.stationID}`,
    );

    return {
      success: true,
      data: {
        station,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "dock");
  }
}

function restoreSpaceSession(session) {
  if (
    !session ||
    !session.characterID ||
    session.stationid ||
    session.stationID
  ) {
    return false;
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || !activeShip.spaceState) {
    return false;
  }

  spaceRuntime.attachSession(session, activeShip, {
    systemID:
      activeShip.spaceState.systemID ||
      session.solarsystemid ||
      session.solarsystemid2,
    pendingUndockMovement: false,
    broadcast: true,
  });

  return true;
}

function jumpSessionViaStargate(session, fromStargateID, toStargateID) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const sourceGate = worldData.getStargateByID(fromStargateID);
  const destinationGate =
    worldData.getStargateByID(toStargateID) ||
    worldData.getStargateByID(sourceGate && sourceGate.destinationID);
  if (!sourceGate || !destinationGate) {
    return {
      success: false,
      errorMsg: "STARGATE_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const shipEntity = spaceRuntime.getEntity(session, activeShip.itemID);
  const sourceEntity = spaceRuntime.getEntity(session, sourceGate.itemID);
  if (shipEntity && sourceEntity) {
    const jumpDistance = distance(shipEntity.position, sourceEntity.position);
    if (jumpDistance > Math.max((sourceEntity.radius || 15000) * 2, 60000)) {
      return {
        success: false,
        errorMsg: "TOO_FAR_FROM_STARGATE",
      };
    }
  }

  const spawnState = buildGateSpawnState(destinationGate);
  spaceRuntime.detachSession(session, { broadcast: true });

  const moveResult = moveShipToSpace(
    activeShip.itemID,
    destinationGate.solarSystemID,
    {
      position: spawnState.position,
      direction: spawnState.direction,
      velocity: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
      targetPoint: spawnState.position,
    },
  );
  if (!moveResult.success) {
    return moveResult;
  }

  syncInventoryItemForSession(
    session,
    moveResult.data,
    {
      locationID: moveResult.previousData.locationID,
      flagID: moveResult.previousData.flagID,
      quantity: moveResult.previousData.quantity,
      singleton: moveResult.previousData.singleton,
      stacksize: moveResult.previousData.stacksize,
    },
    {
      emitCfgLocation: false,
    },
  );

  const updateResult = updateCharacterRecord(session.characterID, (record) =>
    buildLocationIdentityPatch(record, destinationGate.solarSystemID, {
      stationID: null,
    }),
  );
  if (!updateResult.success) {
    return updateResult;
  }

  const applyResult = applyCharacterToSession(session, session.characterID, {
    emitNotifications: true,
    logSelection: true,
    selectionEvent: false,
  });
  if (!applyResult.success) {
    return applyResult;
  }

  spaceRuntime.attachSession(session, moveResult.data, {
    systemID: destinationGate.solarSystemID,
    beyonceBound: false,
    pendingUndockMovement: false,
    broadcast: true,
  });
  queuePendingSessionEffects(session, {
    awaitBeyonceBoundBallpark: true,
    previousLocalChannelID:
      Number(
        session.solarsystemid2 ||
          session.solarsystemid ||
          session.stationid ||
          session.stationID ||
          0,
      ) || 0,
  });

  log.info(
    `[SpaceTransition] Stargate jump ${session.characterName || session.characterID} ship=${activeShip.itemID} from=${sourceGate.itemID} to=${destinationGate.itemID}`,
  );

  return {
    success: true,
    data: {
      stargate: destinationGate,
      boundResult: buildBoundResult(session),
    },
  };
}

function jumpSessionToStation(session, stationID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const station = worldData.getStationByID(targetStationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "station-jump", targetStationID)) {
    return {
      success: false,
      errorMsg: "STATION_JUMP_IN_PROGRESS",
    };
  }

  try {
    const previousLocalChannelID =
      Number(
        session.solarsystemid2 ||
          session.solarsystemid ||
          session.stationid ||
          session.stationID ||
          0,
      ) || 0;

    if (session._space) {
      spaceRuntime.detachSession(session, { broadcast: true });
    }

    const dockResult = dockShipToStation(activeShip.itemID, station.stationID);
    if (!dockResult.success) {
      return dockResult;
    }

    const currentRecord = getCharacterRecord(session.characterID);
    const authoritativeHomeStationID =
      Number(
        (currentRecord &&
          (currentRecord.homeStationID || currentRecord.cloneStationID)) ||
          session.homeStationID ||
          session.homestationid ||
          session.cloneStationID ||
          session.clonestationid ||
          0,
      ) || 0;

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, station.solarSystemID, {
        homeStationID: authoritativeHomeStationID || station.stationID,
        cloneStationID:
          Number(
            record.cloneStationID ||
              authoritativeHomeStationID ||
              station.stationID,
          ) || station.stationID,
        stationID: station.stationID,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    syncDockedShipTransitionForSession(session, dockResult);

    queuePendingSessionEffects(session, {
      previousLocalChannelID,
    });

    log.info(
      `[SpaceTransition] Station jump ${session.characterName || session.characterID} ship=${activeShip.itemID} station=${station.stationID} system=${station.solarSystemID}`,
    );

    return {
      success: true,
      data: {
        station,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "station-jump");
  }
}

function jumpSessionToSolarSystem(session, solarSystemID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const targetSolarSystemID = Number(solarSystemID || 0);
  const system = worldData.getSolarSystemByID(targetSolarSystemID);
  if (!system) {
    return {
      success: false,
      errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "solar-jump", targetSolarSystemID)) {
    return {
      success: false,
      errorMsg: "SOLAR_JUMP_IN_PROGRESS",
    };
  }

  try {
    const sourceStationID = Number(session.stationid || session.stationID || 0);
    const wasInSpace = Boolean(session._space);
    const previousLocalChannelID =
      Number(
        session.solarsystemid2 ||
          session.solarsystemid ||
          session.stationid ||
          session.stationID ||
          0,
      ) || 0;
    const spawnState = buildSolarSystemSpawnState(targetSolarSystemID);
    if (!spawnState) {
      return {
        success: false,
        errorMsg: "SOLAR_SYSTEM_NOT_FOUND",
      };
    }

    if (wasInSpace) {
      spaceRuntime.detachSession(session, { broadcast: true });
    }

    const moveResult = moveShipToSpace(activeShip.itemID, targetSolarSystemID, {
      position: spawnState.position,
      direction: spawnState.direction,
      velocity: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
      targetPoint: spawnState.position,
    });
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    if (sourceStationID) {
      broadcastOnCharNoLongerInStation(session, sourceStationID);
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) =>
      buildLocationIdentityPatch(record, targetSolarSystemID, {
        ...(sourceStationID
          ? {
              homeStationID:
                Number(
                  record.homeStationID ||
                    record.cloneStationID ||
                    sourceStationID,
                ) || sourceStationID,
              cloneStationID:
                Number(
                  record.cloneStationID ||
                    record.homeStationID ||
                    sourceStationID,
                ) || sourceStationID,
            }
          : {}),
        stationID: null,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: targetSolarSystemID,
      beyonceBound: false,
      pendingUndockMovement: false,
      spawnStopped: true,
      broadcast: true,
    });
    queuePendingSessionEffects(session, {
      awaitBeyonceBoundBallpark: true,
      previousLocalChannelID,
    });

    log.info(
      `[SpaceTransition] Solar jump ${session.characterName || session.characterID} ship=${activeShip.itemID} system=${targetSolarSystemID} anchor=${spawnState.anchorType}:${spawnState.anchorID}`,
    );

    return {
      success: true,
      data: {
        solarSystem: system,
        ship: moveResult.data,
        spawnState,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "solar-jump");
  }
}

function captureSpaceBootstrapState(session) {
  if (!session || !session._space) {
    return {
      beyonceBound: false,
      initialStateSent: false,
    };
  }

  return {
    beyonceBound: Boolean(session._space.beyonceBound),
    initialStateSent: Boolean(session._space.initialStateSent),
  };
}

function teleportSession(session, destinationID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const numericDestinationID = Number(destinationID || 0);
  if (!Number.isInteger(numericDestinationID) || numericDestinationID <= 0) {
    return {
      success: false,
      errorMsg: "DESTINATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }
  const previousSpaceState = captureSpaceBootstrapState(session);

  const station = worldData.getStationByID(numericDestinationID);
  if (station) {
    if (session._space) {
      spaceRuntime.detachSession(session, { broadcast: true });
    }

    const dockResult = dockShipToStation(activeShip.itemID, station.stationID);
    if (!dockResult.success) {
      return dockResult;
    }

    syncInventoryItemForSession(
      session,
      dockResult.data,
      {
        locationID: dockResult.previousData.locationID,
        flagID: dockResult.previousData.flagID,
        quantity: dockResult.previousData.quantity,
        singleton: dockResult.previousData.singleton,
        stacksize: dockResult.previousData.stacksize,
      },
      {
        emitCfgLocation: true,
      },
    );

    const updateResult = updateCharacterRecord(
      session.characterID,
      (record) => ({
        ...record,
        homeStationID:
          Number(
            record.homeStationID || record.cloneStationID || station.stationID,
          ) || station.stationID,
        cloneStationID:
          Number(
            record.cloneStationID || record.homeStationID || station.stationID,
          ) || station.stationID,
        stationID: station.stationID,
        solarSystemID: station.solarSystemID,
        worldSpaceID: 0,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
      deferDockedShipSessionChange: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    return {
      success: true,
      data: {
        stationID: station.stationID,
        solarSystemID: station.solarSystemID,
        summary: `station ${station.stationName || station.itemName || station.stationID}`,
      },
    };
  }

  const solarSystem = worldData.getSolarSystemByID(numericDestinationID);
  if (solarSystem) {
    const relocateInCurrentScene = shouldRelocateWithinCurrentScene(
      session,
      solarSystem.solarSystemID,
    );
    if (session._space && !relocateInCurrentScene) {
      spaceRuntime.detachSession(session, { broadcast: true });
    }

    const spawnState = buildSystemSpawnState(solarSystem.solarSystemID);
    const moveResult = moveShipToSpace(
      activeShip.itemID,
      solarSystem.solarSystemID,
      {
        position: spawnState.position,
        direction: spawnState.direction,
        velocity: { x: 0, y: 0, z: 0 },
        speedFraction: 0,
        mode: "STOP",
        targetPoint: spawnState.position,
      },
    );
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    const updateResult = updateCharacterRecord(
      session.characterID,
      (record) => ({
        ...record,
        stationID: null,
        solarSystemID: solarSystem.solarSystemID,
        worldSpaceID: 0,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    if (relocateInCurrentScene) {
      spaceRuntime.relocateShip(session, moveResult.data.spaceState || {});
    } else {
      attachTeleportedSpaceSession(
        session,
        moveResult.data,
        solarSystem.solarSystemID,
        previousSpaceState,
      );
    }

    return {
      success: true,
      data: {
        solarSystemID: solarSystem.solarSystemID,
        summary: `solar system ${solarSystem.solarSystemName || solarSystem.solarSystemID}`,
      },
    };
  }

  const celestial = worldData.getCelestialByID(numericDestinationID);
  if (celestial) {
    const relocateInCurrentScene = shouldRelocateWithinCurrentScene(
      session,
      celestial.solarSystemID,
    );
    if (session._space && !relocateInCurrentScene) {
      spaceRuntime.detachSession(session, { broadcast: true });
    }

    const spawnState = buildTargetSpawnState(
      celestial,
      celestial.solarSystemID,
    );
    const moveResult = moveShipToSpace(
      activeShip.itemID,
      celestial.solarSystemID,
      {
        position: spawnState.position,
        direction: spawnState.direction,
        velocity: { x: 0, y: 0, z: 0 },
        speedFraction: 0,
        mode: "STOP",
        targetPoint: spawnState.targetPoint,
      },
    );
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    const updateResult = updateCharacterRecord(
      session.characterID,
      (record) => ({
        ...record,
        stationID: null,
        solarSystemID: celestial.solarSystemID,
        worldSpaceID: 0,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    if (relocateInCurrentScene) {
      spaceRuntime.relocateShip(session, moveResult.data.spaceState || {});
    } else {
      attachTeleportedSpaceSession(
        session,
        moveResult.data,
        celestial.solarSystemID,
        previousSpaceState,
      );
    }

    return {
      success: true,
      data: {
        solarSystemID: celestial.solarSystemID,
        summary: `${celestial.itemName || celestial.kind || "celestial"} (${celestial.itemID})`,
      },
    };
  }

  const stargate = worldData.getStargateByID(numericDestinationID);
  if (stargate) {
    const relocateInCurrentScene = shouldRelocateWithinCurrentScene(
      session,
      stargate.solarSystemID,
    );
    if (session._space && !relocateInCurrentScene) {
      spaceRuntime.detachSession(session, { broadcast: true });
    }

    const spawnState = buildTargetSpawnState(stargate, stargate.solarSystemID, {
      offset: Math.max(Number(stargate.radius || 0) * 1.5, 7500),
    });
    const moveResult = moveShipToSpace(
      activeShip.itemID,
      stargate.solarSystemID,
      {
        position: spawnState.position,
        direction: spawnState.direction,
        velocity: { x: 0, y: 0, z: 0 },
        speedFraction: 0,
        mode: "STOP",
        targetPoint: spawnState.targetPoint,
      },
    );
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    const updateResult = updateCharacterRecord(
      session.characterID,
      (record) => ({
        ...record,
        stationID: null,
        solarSystemID: stargate.solarSystemID,
        worldSpaceID: 0,
      }),
    );
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    if (relocateInCurrentScene) {
      spaceRuntime.relocateShip(session, moveResult.data.spaceState || {});
    } else {
      attachTeleportedSpaceSession(
        session,
        moveResult.data,
        stargate.solarSystemID,
        previousSpaceState,
      );
    }

    return {
      success: true,
      data: {
        solarSystemID: stargate.solarSystemID,
        summary: `${stargate.itemName || "stargate"} (${stargate.itemID})`,
      },
    };
  }

  return {
    success: false,
    errorMsg: "DESTINATION_NOT_FOUND",
  };
}

module.exports = {
  buildBoundResult,
  buildSolarSystemSpawnState,
  undockSession,
  dockSession,
  restoreSpaceSession,
  jumpSessionViaStargate,
  jumpSessionToStation,
  jumpSessionToSolarSystem,
  teleportSession,
};
