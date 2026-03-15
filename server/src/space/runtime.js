const fs = require("fs");
const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const {
  updateShipItem,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  getAppliedSkinMaterialSetID,
} = require(path.join(__dirname, "../services/ship/shipCosmeticsState"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const worldData = require(path.join(__dirname, "./worldData"));
const destiny = require(path.join(__dirname, "./destiny"));

const ONE_AU_IN_METERS = 149597870700;
const MIN_WARP_DISTANCE_METERS = 150000;
const DEFAULT_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
const VALID_MODES = new Set(["STOP", "GOTO", "FOLLOW", "WARP", "ORBIT"]);
const INCLUDE_STARGATES_IN_SCENE = true;
const STARGATE_ACTIVATION_STATE = Object.freeze({
  CLOSED: 0,
  OPEN: 1,
  ACTIVATING: 2,
});
const STARGATE_ACTIVATION_TRANSITION_MS = 3000;
const STARTUP_PRELOADED_SYSTEM_IDS = Object.freeze([30000142, 30000145]);
const DEFAULT_STATION_INTERACTION_RADIUS = 1000;
const DEFAULT_STATION_UNDOCK_DISTANCE = 8000;
const DEFAULT_STATION_DOCKING_RADIUS = 2500;
const DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS = 250_000;
const STATION_DOCK_ACCEPT_DELAY_MS = 4000;
const LEGACY_STATION_NORMALIZATION_RADIUS = 100000;
const MOVEMENT_DEBUG_PATH = path.join(__dirname, "../../logs/space-movement-debug.log");
const DESTINY_DEBUG_PATH = path.join(__dirname, "../../logs/space-destiny-debug.log");
const WARP_DEBUG_PATH = path.join(__dirname, "../../logs/space-warp-debug.log");
const BALL_DEBUG_PATH = path.join(__dirname, "../../logs/space-ball-debug.log");
const BUBBLE_DEBUG_PATH = path.join(__dirname, "../../logs/space-bubble-debug.log");
const WATCHER_CORRECTION_INTERVAL_MS = 500;
const WATCHER_POSITION_CORRECTION_INTERVAL_MS = 1000;
const ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS = 250;
// Keep active subwarp watcher velocity corrections tight, but do not spam
// position anchors faster than the 1-second Destiny stamp cadence. Repeated
// same-stamp SetBallPosition rebases are what made remote ships jolt and drift.
const ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS = 1000;
const WARP_POSITION_CORRECTION_INTERVAL_MS = 250;
// Local CCP code consistently treats scene membership as bubble ownership
// (`ball.newBubbleId`, `current_bubble_members`) rather than one global
// visibility radius. Crucible EVEmu uses 300km bubbles but also documents
// retail as 250km, so use 250km as the default server-side bubble radius and
// keep hysteresis explicit to avoid churn at the edge.
const BUBBLE_RADIUS_METERS = 250_000;
const BUBBLE_HYSTERESIS_METERS = 5_000;
const BUBBLE_RADIUS_SQUARED = BUBBLE_RADIUS_METERS * BUBBLE_RADIUS_METERS;
const BUBBLE_RETENTION_RADIUS_METERS =
  BUBBLE_RADIUS_METERS + BUBBLE_HYSTERESIS_METERS;
const BUBBLE_RETENTION_RADIUS_SQUARED =
  BUBBLE_RETENTION_RADIUS_METERS * BUBBLE_RETENTION_RADIUS_METERS;
// Remote observers should keep a departing warp ship only long enough for the
// local warp-out effect to own the departure transition. After that, the ship
// should leave the departure scene entirely instead of lingering until pure
// range culling removes it.
const OBSERVER_WARP_DEPARTURE_VISIBLE_MS = 2000;
const MOVEMENT_TRACE_WINDOW_MS = 5000;
const MAX_SUBWARP_SPEED_FRACTION = 1.0;
const DESTINY_STAMP_INTERVAL_MS = 1000;
const DESTINY_STAMP_MAX_LEAD = 1;
const DESTINY_ACCEL_LOG_DENOMINATOR = Math.log(10000);
const DESTINY_ALIGN_LOG_DENOMINATOR = Math.log(4);
const TURN_ALIGNMENT_RADIANS = 4 * (Math.PI / 180);
const WARP_ALIGNMENT_RADIANS = 6 * (Math.PI / 180);
const WARP_ENTRY_SPEED_FRACTION = 0.749;
const WARP_NATIVE_ACTIVATION_SPEED_FRACTION = 0.75;
const WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS = 1;
const WARP_DECEL_RATE_MAX = 2;
const WARP_DROPOUT_SPEED_MAX_MS = 100;
const WARP_ACCEL_EXPONENT = 5;
const WARP_DECEL_EXPONENT = 5;
const WARP_MEDIUM_DISTANCE_AU = 12;
const WARP_LONG_DISTANCE_AU = 24;
const WARP_COMPLETION_DISTANCE_RATIO = 0.005;
const WARP_COMPLETION_DISTANCE_MIN_METERS = 100000;
const WARP_COMPLETION_DISTANCE_MAX_METERS = 2500000;
// Keep the prepare-phase pilot seed only slightly above subwarp max. The
// activation AddBalls2 refresh still resets the ego ball's raw maxVelocity back
// to its subwarp ceiling, so the only activation nudge that matches the client
// gate cleanly is a tiny pre-WarpTo velocity floor just above
// `0.75 * subwarpMaxVelocity`.
const WARP_START_ACTIVATION_SEED_SCALE = 1.1;
// Option A is closed after a clean no-hook run: the pilot really received the
// bumped warpFactor, but the client still stayed on the same wrapper-only path.
const ENABLE_PILOT_WARP_FACTOR_OPTION_A = false;
const PILOT_WARP_FACTOR_OPTION_A_SCALE = 1.15;
// Option B: keep the live branch honest and isolated by sending one late
// pilot-only SetMaxSpeed assist at the predicted start of exit / deceleration.
const ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B = false;
const PILOT_WARP_SOLVER_ASSIST_SCALE = 1.5;
const PILOT_WARP_SOLVER_ASSIST_LEAD_MS = DESTINY_STAMP_INTERVAL_MS;
const ENABLE_PILOT_PRE_WARP_ADDBALL_REBASE = false;
// `auditwarp7.txt` and `overshoot1.txt` both showed the pilot still receiving
// a same-stamp AddBalls2 -> SetState replay on the already-existing ego ball at
// activation. Michelle applies both full-state reads, so keep the live warp
// handoff on WarpTo / SetBallVelocity / FX instead of rebootstraping the ego
// ball mid-warp.
const ENABLE_PILOT_WARP_EGO_STATE_REFRESH = false;
// `auditwarp12.txt` showed that later in-warp pilot `SetMaxSpeed` bumps freeze
// the client exactly when it enters the later warp phase.
// `auditwarp14.txt` then narrowed the remaining long-warp failure down further:
// the current one-shot activation `SetMaxSpeed` keeps the pilot on the slow
// forced-warp fallback, because it raises the native `0.75 * maxVelocity` gate
// far above the carried align speed. Leave the later in-warp ramp disabled and
// keep activation help on the velocity floor instead.
const ENABLE_PILOT_WARP_MAX_SPEED_RAMP = false;
// Active-warp pilot SetBallPosition / SetBallVelocity pushes are currently
// worse than the original freeze: the client visibly fights them, snaps nose,
// and then stalls its own active-warp traversal. Keep the handoff on the
// activation bundle and let the local warp solver own the flight.
const ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS = false;
const PILOT_WARP_SPEED_RAMP_FRACTIONS = Object.freeze([0.2, 0.45, 0.7, 1.0]);
const PILOT_WARP_SPEED_RAMP_SCALES = Object.freeze([0.6, 0.75, 0.9, 0.95]);

let nextStamp = 0;
let nextMovementTraceID = 1;

function getCurrentDestinyStamp(now = Date.now()) {
  const numericNow = Number(now);
  const stampSource = Number.isFinite(numericNow)
    ? Math.floor(numericNow / DESTINY_STAMP_INTERVAL_MS)
    : Math.floor(Date.now() / DESTINY_STAMP_INTERVAL_MS);
  return (stampSource & 0x7fffffff) >>> 0;
}

function getMovementStamp(now = Date.now()) {
  return getCurrentDestinyStamp(now);
}

function getNextStamp(now = Date.now()) {
  const currentStamp = getCurrentDestinyStamp(now);
  const maxAllowedStamp = (currentStamp + DESTINY_STAMP_MAX_LEAD) >>> 0;
  if (nextStamp < currentStamp) {
    nextStamp = currentStamp;
    return nextStamp;
  }
  if (nextStamp >= maxAllowedStamp) {
    nextStamp = maxAllowedStamp;
    return nextStamp;
  }
  nextStamp = (nextStamp + 1) >>> 0;
  return nextStamp;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toFiniteNumber(value, fallback));
}

function roundNumber(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(toFiniteNumber(value, 0) * factor) / factor;
}

function unwrapMarshalNumber(value, fallback = 0) {
  if (value && typeof value === "object" && value.type === "real") {
    return toFiniteNumber(value.value, fallback);
  }
  return toFiniteNumber(value, fallback);
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function clonePilotWarpMaxSpeedRamp(rawRamp, fallback = []) {
  const source = Array.isArray(rawRamp) ? rawRamp : fallback;
  return source
    .map((entry) => ({
      atMs: toFiniteNumber(entry && entry.atMs, 0),
      stamp: toInt(entry && entry.stamp, 0),
      speed: Math.max(toFiniteNumber(entry && entry.speed, 0), 0),
      label: String((entry && entry.label) || ""),
    }))
    .filter((entry) => entry.atMs > 0 && entry.speed > 0);
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

function dotProduct(left, right) {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function crossProduct(left, right) {
  return {
    x: (left.y * right.z) - (left.z * right.y),
    y: (left.z * right.x) - (left.x * right.z),
    z: (left.x * right.y) - (left.y * right.x),
  };
}

function magnitude(vector) {
  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(vector, 1 / length);
}

function distance(left, right) {
  return magnitude(subtractVectors(left, right));
}

function distanceSquared(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return (dx ** 2) + (dy ** 2) + (dz ** 2);
}

// Debug/test-only helper for slash-command FX previews. This is intentionally
// not gameplay target acquisition logic and should not be reused for modules.
function resolveDebugTestNearestStationTarget(
  scene,
  sourceEntity,
  maxRangeMeters = DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
) {
  if (!scene || !sourceEntity) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_CONTEXT_MISSING",
    };
  }

  const numericMaxRangeMeters = Math.max(0, toFiniteNumber(
    maxRangeMeters,
    DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
  ));
  let nearestStation = null;
  let nearestDistanceMeters = Number.POSITIVE_INFINITY;
  for (const entity of scene.staticEntities) {
    if (!entity || entity.kind !== "station") {
      continue;
    }

    const entityDistanceMeters = distance(sourceEntity.position, entity.position);
    if (entityDistanceMeters < nearestDistanceMeters) {
      nearestStation = entity;
      nearestDistanceMeters = entityDistanceMeters;
    }
  }

  if (!nearestStation) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_NO_STATION",
      data: {
        maxRangeMeters: numericMaxRangeMeters,
      },
    };
  }

  if (nearestDistanceMeters > numericMaxRangeMeters) {
    return {
      success: false,
      errorMsg: "DEBUG_TEST_TARGET_OUT_OF_RANGE",
      data: {
        maxRangeMeters: numericMaxRangeMeters,
        nearestDistanceMeters,
        targetID: nearestStation.itemID,
        targetName: nearestStation.itemName || `station ${nearestStation.itemID}`,
      },
    };
  }

  return {
    success: true,
    data: {
      maxRangeMeters: numericMaxRangeMeters,
      nearestDistanceMeters,
      target: nearestStation,
    },
  };
}

function getTurnMetrics(currentDirection, targetDirection) {
  const current = normalizeVector(currentDirection, targetDirection);
  const target = normalizeVector(targetDirection, current);
  const alignment = clamp(dotProduct(current, target), -1, 1);
  const radians = Math.acos(alignment);
  const turnFraction = Math.sqrt(Math.max(0, (alignment + 1) * 0.5));
  return {
    alignment,
    radians: Number.isFinite(radians) ? radians : 0,
    turnFraction: Number.isFinite(turnFraction) ? turnFraction : 1,
  };
}

function summarizeVector(vector) {
  return {
    x: roundNumber(vector && vector.x),
    y: roundNumber(vector && vector.y),
    z: roundNumber(vector && vector.z),
  };
}

function isMovementTraceActive(entity, now = Date.now()) {
  return Boolean(
    entity &&
      entity.movementTrace &&
      Number(entity.movementTrace.untilMs || 0) > Number(now || Date.now()),
  );
}

function getMovementTraceSnapshot(entity, now = Date.now()) {
  if (!isMovementTraceActive(entity, now)) {
    return null;
  }

  return {
    id: toInt(entity.movementTrace.id, 0),
    reason: entity.movementTrace.reason || "unknown",
    stamp: toInt(entity.movementTrace.stamp, 0),
    ageMs: Math.max(0, toInt(now, Date.now()) - toInt(entity.movementTrace.startedAtMs, 0)),
    remainingMs: Math.max(0, toInt(entity.movementTrace.untilMs, 0) - toInt(now, Date.now())),
    context: entity.movementTrace.context || null,
  };
}

function summarizePendingWarp(pendingWarp) {
  if (!pendingWarp) {
    return null;
  }

  return {
    requestedAtMs: toInt(pendingWarp.requestedAtMs, 0),
    preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
    stopDistance: roundNumber(pendingWarp.stopDistance),
    totalDistance: roundNumber(pendingWarp.totalDistance),
    warpSpeedAU: roundNumber(pendingWarp.warpSpeedAU, 3),
    targetEntityID: toInt(pendingWarp.targetEntityID, 0),
    targetPoint: summarizeVector(pendingWarp.targetPoint),
    rawDestination: summarizeVector(pendingWarp.rawDestination),
  };
}

function armMovementTrace(entity, reason, context = {}, now = Date.now()) {
  if (!entity) {
    return null;
  }

  entity.movementTrace = {
    id: nextMovementTraceID++,
    reason,
    startedAtMs: now,
    untilMs: now + MOVEMENT_TRACE_WINDOW_MS,
    stamp: getCurrentDestinyStamp(now),
    context,
  };
  return entity.movementTrace;
}

function appendMovementDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(MOVEMENT_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      MOVEMENT_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write movement debug log: ${error.message}`);
  }
}

function appendDestinyDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(DESTINY_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      DESTINY_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write destiny debug log: ${error.message}`);
  }
}

function appendWarpDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(WARP_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      WARP_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write warp debug log: ${error.message}`);
  }
}

function appendBallDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(BALL_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      BALL_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write ball debug log: ${error.message}`);
  }
}

function appendBubbleDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(BUBBLE_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      BUBBLE_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to append bubble debug log: ${error.message}`);
  }
}

function logBubbleDebug(event, details = {}) {
  appendBubbleDebug(JSON.stringify({
    event,
    atMs: Date.now(),
    destinyStamp: getCurrentDestinyStamp(),
    ...details,
  }));
}

function summarizeBubbleEntity(entity) {
  if (!entity) {
    return null;
  }

  return {
    itemID: toInt(entity.itemID, 0),
    name: String(entity.itemName || entity.name || ""),
    mode: String(entity.mode || ""),
    bubbleID: toInt(entity.bubbleID, 0),
    departureBubbleID: toInt(entity.departureBubbleID, 0),
    position: summarizeVector(entity.position),
    velocityMs: roundNumber(magnitude(entity.velocity || { x: 0, y: 0, z: 0 }), 3),
  };
}

function summarizeBubbleState(bubble) {
  if (!bubble) {
    return null;
  }

  return {
    id: toInt(bubble.id, 0),
    center: summarizeVector(bubble.center),
    entityCount: bubble.entityIDs instanceof Set ? bubble.entityIDs.size : 0,
    entityIDs:
      bubble.entityIDs instanceof Set
        ? [...bubble.entityIDs].map((itemID) => toInt(itemID, 0))
        : [],
  };
}

function buildPerpendicular(vector) {
  const direction = normalizeVector(vector, DEFAULT_RIGHT);
  const firstPass = crossProduct(direction, DEFAULT_UP);
  if (magnitude(firstPass) > 0) {
    return normalizeVector(firstPass, DEFAULT_RIGHT);
  }

  return normalizeVector(crossProduct(direction, DEFAULT_RIGHT), DEFAULT_UP);
}

function normalizeMode(value, fallback = "STOP") {
  return VALID_MODES.has(value) ? value : fallback;
}

function deriveAgilitySeconds(alignTime, maxAccelerationTime, mass = 0, inertia = 0) {
  const numericMass = toFiniteNumber(mass, 0);
  const numericInertia = toFiniteNumber(inertia, 0);
  const officialTauSeconds = (numericMass * numericInertia) / 1_000_000;
  if (officialTauSeconds > 0) {
    return Math.max(officialTauSeconds, 0.05);
  }

  const accelSeconds =
    toFiniteNumber(maxAccelerationTime, 0) / DESTINY_ACCEL_LOG_DENOMINATOR;
  if (accelSeconds > 0) {
    return Math.max(accelSeconds, 0.05);
  }

  const alignSeconds =
    toFiniteNumber(alignTime, 0) / DESTINY_ALIGN_LOG_DENOMINATOR;
  if (alignSeconds > 0) {
    return Math.max(alignSeconds, 0.05);
  }

  return 1;
}

function getCurrentAlignmentDirection(entity, fallbackDirection = DEFAULT_RIGHT) {
  const resolvedFallback = normalizeVector(
    fallbackDirection,
    normalizeVector(entity && entity.direction, DEFAULT_RIGHT),
  );
  const currentVelocity = cloneVector(entity && entity.velocity);
  const currentSpeed = magnitude(currentVelocity);
  const maxVelocity = Math.max(toFiniteNumber(entity && entity.maxVelocity, 0), 0);
  const minimumAlignmentSpeed = Math.max(0.5, maxVelocity * 0.01);
  if (currentSpeed > minimumAlignmentSpeed) {
    return normalizeVector(currentVelocity, resolvedFallback);
  }
  return normalizeVector(entity && entity.direction, resolvedFallback);
}

function integrateVelocityTowardTarget(
  currentVelocity,
  desiredVelocity,
  responseSeconds,
  deltaSeconds,
) {
  const tau = Math.max(toFiniteNumber(responseSeconds, 0.05), 0.05);
  const delta = Math.max(toFiniteNumber(deltaSeconds, 0), 0);
  const decay = Math.exp(-(delta / tau));
  const velocityOffset = subtractVectors(currentVelocity, desiredVelocity);
  const nextVelocity = addVectors(
    desiredVelocity,
    scaleVector(velocityOffset, decay),
  );
  const positionDelta = addVectors(
    scaleVector(desiredVelocity, delta),
    scaleVector(velocityOffset, tau * (1 - decay)),
  );
  return {
    nextVelocity,
    positionDelta,
    decay,
    tau,
  };
}

function deriveTurnDegreesPerTick(agilitySeconds) {
  const normalizedAgility = Math.max(toFiniteNumber(agilitySeconds, 0.05), 0.05);
  // The old linear falloff effectively stalled capital-class turns once
  // agility drifted past ~60s. Use a bounded inverse curve instead so large
  // hulls still converge in a finite, client-like amount of time while small
  // hulls retain noticeably sharper turns.
  return clamp(75 / normalizedAgility, 0.75, 12);
}

function slerpDirection(current, target, fraction, radians) {
  const clampedFraction = clamp(fraction, 0, 1);
  if (clampedFraction <= 0) {
    return current;
  }
  if (clampedFraction >= 1) {
    return target;
  }

  const totalRadians = Math.max(toFiniteNumber(radians, 0), 0);
  const sinTotal = Math.sin(totalRadians);
  if (!Number.isFinite(sinTotal) || Math.abs(sinTotal) < 0.000001) {
    return normalizeVector(
      addVectors(
        scaleVector(current, 1 - clampedFraction),
        scaleVector(target, clampedFraction),
      ),
      target,
    );
  }

  const leftWeight =
    Math.sin((1 - clampedFraction) * totalRadians) / sinTotal;
  const rightWeight =
    Math.sin(clampedFraction * totalRadians) / sinTotal;

  return normalizeVector(
    addVectors(
      scaleVector(current, leftWeight),
      scaleVector(target, rightWeight),
    ),
    target,
  );
}

function getStationConfiguredUndockDistance(station) {
  const undockPosition = station && station.undockPosition;
  if (!station || !station.position || !undockPosition) {
    return 0;
  }

  return distance(
    cloneVector(station.position),
    cloneVector(undockPosition),
  );
}

function hasRealStationDockData(station) {
  return Boolean(
    station &&
      station.dockPosition &&
      station.dockOrientation &&
      magnitude(cloneVector(station.dockOrientation)) > 0,
  );
}

function getStationDockPosition(station) {
  if (station && station.dockPosition) {
    return cloneVector(station.dockPosition, station.position);
  }

  return cloneVector(station && station.position);
}

function getStationApproachPosition(station) {
  return cloneVector(station && station.position);
}

function getStationWarpTargetPosition(station) {
  if (station && station.dockPosition) {
    return cloneVector(station.dockPosition, station.position);
  }

  return cloneVector(station && station.position);
}

function getTargetMotionPosition(target, options = {}) {
  if (target && target.kind === "station") {
    return getStationApproachPosition(target);
  }

  return cloneVector(target && target.position);
}

function getFollowMotionProfile(entity, target) {
  return {
    targetPoint: getTargetMotionPosition(target),
    rangeRadius: Math.max(0, toFiniteNumber(target && target.radius, 0)),
  };
}

function getStationDockDirection(station) {
  if (station && station.dockOrientation) {
    return normalizeVector(station.dockOrientation, DEFAULT_RIGHT);
  }

  return normalizeVector(
    station && station.undockDirection,
    DEFAULT_RIGHT,
  );
}

function coerceDunRotationTuple(source) {
  if (!Array.isArray(source) || source.length !== 3) {
    return null;
  }

  const tuple = source.map((value) => roundNumber(value, 6));
  return tuple.every((value) => Number.isFinite(value)) ? tuple : null;
}

function getStationRenderMetadata(station, fieldName) {
  if (!station || !fieldName) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(station, fieldName)) {
    return station[fieldName];
  }

  const stationType = worldData.getStationTypeByID(station.stationTypeID);
  if (
    stationType &&
    Object.prototype.hasOwnProperty.call(stationType, fieldName)
  ) {
    return stationType[fieldName];
  }

  return undefined;
}

function getStationAuthoredDunRotation(station) {
  return coerceDunRotationTuple(
    getStationRenderMetadata(station, "dunRotation"),
  );
}

function coerceStageTuple(source) {
  if (!Array.isArray(source) || source.length !== 2) {
    return [0, 1];
  }

  const stage = roundNumber(source[0], 6);
  const maximum = Math.max(roundNumber(source[1], 6), 1);
  return Number.isFinite(stage) && Number.isFinite(maximum)
    ? [stage, maximum]
    : [0, 1];
}

function coerceActivationState(value, fallback = STARGATE_ACTIVATION_STATE.CLOSED) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function coerceStableActivationState(
  value,
  fallback = STARGATE_ACTIVATION_STATE.CLOSED,
) {
  const state = coerceActivationState(value, fallback);
  if (state <= STARGATE_ACTIVATION_STATE.CLOSED) {
    return STARGATE_ACTIVATION_STATE.CLOSED;
  }
  if (state === STARGATE_ACTIVATION_STATE.ACTIVATING) {
    return STARGATE_ACTIVATION_STATE.OPEN;
  }
  return state;
}

function getSolarSystemPseudoSecurity(system) {
  const security = clamp(toFiniteNumber(system && system.security, 0), 0, 1);
  if (security > 0 && security < 0.05) {
    return 0.05;
  }

  return security;
}

function getSystemSecurityClass(system) {
  const security = getSolarSystemPseudoSecurity(system);
  if (security <= 0) {
    return 0;
  }
  if (security < 0.45) {
    return 1;
  }
  return 2;
}

function getSystemOwnerID(system) {
  const factionID = toInt(system && system.factionID, 0);
  return factionID > 0 ? factionID : null;
}

function getSecurityStatusIconKey(system) {
  const securityTenths = clamp(
    Math.round(getSolarSystemPseudoSecurity(system) * 10),
    0,
    10,
  );
  const whole = Math.floor(securityTenths / 10);
  const tenths = securityTenths % 10;
  return `SEC_${whole}_${tenths}`;
}

function isHazardousSecurityTransition(sourceSystem, destinationSystem) {
  const sourceSecurityClass = getSystemSecurityClass(sourceSystem);
  const destinationSecurityClass = getSystemSecurityClass(destinationSystem);
  return (
    (sourceSecurityClass === 2 && destinationSecurityClass !== 2) ||
    (sourceSecurityClass === 1 && destinationSecurityClass === 0)
  );
}

function getStargateAuthoredDunRotation(stargate) {
  return coerceDunRotationTuple(stargate && stargate.dunRotation);
}

function getSharedWorldPosition(systemPosition, localPosition) {
  if (!systemPosition || !localPosition) {
    return null;
  }

  return {
    x: toFiniteNumber(systemPosition.x, 0) - toFiniteNumber(localPosition.x, 0),
    y: toFiniteNumber(systemPosition.y, 0) + toFiniteNumber(localPosition.y, 0),
    z: toFiniteNumber(systemPosition.z, 0) + toFiniteNumber(localPosition.z, 0),
  };
}

function buildDunRotationFromDirection(direction) {
  if (!direction || magnitude(direction) <= 0) {
    return null;
  }

  const forward = scaleVector(direction, 1 / magnitude(direction));
  const yawDegrees = Math.atan2(forward.x, forward.z) * (180 / Math.PI);
  const pitchDegrees = -Math.asin(clamp(forward.y, -1, 1)) * (180 / Math.PI);
  return coerceDunRotationTuple([yawDegrees, pitchDegrees, 0]);
}

function getStargateDerivedDunRotation(stargate) {
  if (!stargate) {
    return null;
  }

  const sourceSystem = worldData.getSolarSystemByID(stargate.solarSystemID);
  const destinationGate = worldData.getStargateByID(stargate.destinationID);
  if (!sourceSystem || !destinationGate) {
    return null;
  }

  const destinationSystem = worldData.getSolarSystemByID(
    destinationGate.solarSystemID,
  );
  if (!destinationSystem) {
    return null;
  }

  const originGateWorldPosition = getSharedWorldPosition(
    sourceSystem.position,
    stargate.position,
  );
  const destinationGateWorldPosition = getSharedWorldPosition(
    destinationSystem.position,
    destinationGate.position,
  );
  if (!originGateWorldPosition || !destinationGateWorldPosition) {
    return null;
  }

  const forward = subtractVectors(
    destinationGateWorldPosition,
    originGateWorldPosition,
  );
  if (magnitude(forward) <= 0) {
    return null;
  }

  return buildDunRotationFromDirection(forward);
}

function getResolvedStargateDunRotation(stargate) {
  return (
    getStargateAuthoredDunRotation(stargate) ||
    getStargateDerivedDunRotation(stargate)
  );
}

function getStargateTypeMetadata(stargate, fieldName) {
  if (!stargate || !fieldName) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(stargate, fieldName)) {
    return stargate[fieldName];
  }

  const stargateType = worldData.getStargateTypeByID(stargate.typeID);
  if (
    stargateType &&
    Object.prototype.hasOwnProperty.call(stargateType, fieldName)
  ) {
    return stargateType[fieldName];
  }

  return undefined;
}

function getStargateStatusIcons(stargate, destinationSystem) {
  const configuredIcons = Array.isArray(stargate && stargate.destinationSystemStatusIcons)
    ? stargate.destinationSystemStatusIcons
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  if (configuredIcons.length > 0) {
    return configuredIcons;
  }

  if (!destinationSystem) {
    return [];
  }

  return [getSecurityStatusIconKey(destinationSystem)];
}

function getStargateWarningIcon(stargate, sourceSystem, destinationSystem) {
  if (stargate && stargate.destinationSystemWarningIcon) {
    return String(stargate.destinationSystemWarningIcon);
  }

  return isHazardousSecurityTransition(sourceSystem, destinationSystem)
    ? "stargate_travelwarning3.dds"
    : null;
}

function resolveShipSkinMaterialSetID(shipItem) {
  if (!shipItem) {
    return null;
  }

  return getAppliedSkinMaterialSetID(shipItem.itemID);
}

function getStationInteractionRadius(station) {
  const configuredVisualRadius = toFiniteNumber(station && station.radius, 0);
  if (configuredVisualRadius > 0) {
    return configuredVisualRadius;
  }

  const configuredRadius = toFiniteNumber(
    station && station.interactionRadius,
    0,
  );
  if (configuredRadius > 0) {
    return configuredRadius;
  }

  return DEFAULT_STATION_INTERACTION_RADIUS;
}

function getStationUndockSpawnState(station) {
  const dockDirection = normalizeVector(
    cloneVector(
      station &&
        (station.dockOrientation || station.undockDirection),
      DEFAULT_RIGHT,
    ),
    DEFAULT_RIGHT,
  );
  const storedUndockOffset = station
    ? subtractVectors(
        cloneVector(station.undockPosition, station.position),
        cloneVector(station.position),
      )
    : null;
  const direction = normalizeVector(
    magnitude(storedUndockOffset) > 0
      ? storedUndockOffset
      : dockDirection,
    DEFAULT_RIGHT,
  );
  const spawnDistance = Math.max(
    DEFAULT_STATION_UNDOCK_DISTANCE,
    getStationConfiguredUndockDistance(station),
    getStationInteractionRadius(station) + 2500,
  );

  return {
    direction,
    position: addVectors(
      cloneVector(station && station.position),
      scaleVector(direction, spawnDistance),
    ),
  };
}

function getCommandDirection(entity, fallback = DEFAULT_RIGHT) {
  if (entity && entity.targetPoint && entity.position) {
    return normalizeVector(
      subtractVectors(entity.targetPoint, entity.position),
      entity.direction || fallback,
    );
  }

  return normalizeVector(entity && entity.direction, fallback);
}

function getShipDockingDistanceToStation(entity, station) {
  if (!entity || !station) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    distance(entity.position, station.position) -
      entity.radius -
      getStationInteractionRadius(station),
  );
}

function canShipDockAtStation(entity, station, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
  return getShipDockingDistanceToStation(entity, station) <= Math.max(0, toFiniteNumber(maxDistance, DEFAULT_STATION_DOCKING_RADIUS));
}

function buildDockingDebugState(entity, station, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
  if (!entity || !station) {
    return null;
  }

  const dockPosition = getStationDockPosition(station);
  const approachPosition = getStationApproachPosition(station);

  return {
    canDock: canShipDockAtStation(entity, station, maxDistance),
    dockingDistance: roundNumber(
      getShipDockingDistanceToStation(entity, station),
    ),
    distanceToStationCenter: roundNumber(distance(entity.position, station.position)),
    distanceToDockPoint: roundNumber(distance(entity.position, dockPosition)),
    distanceToApproachPoint: roundNumber(distance(entity.position, approachPosition)),
    dockingThreshold: roundNumber(maxDistance),
    shipRadius: roundNumber(entity.radius),
    stationRadius: roundNumber(getStationInteractionRadius(station)),
    shipPosition: summarizeVector(entity.position),
    shipVelocity: summarizeVector(entity.velocity),
    stationPosition: summarizeVector(station.position),
    approachPosition: summarizeVector(approachPosition),
    dockPosition: summarizeVector(dockPosition),
    targetEntityID: entity.targetEntityID || 0,
    dockingTargetID: entity.dockingTargetID || 0,
    mode: entity.mode,
    speedFraction: roundNumber(entity.speedFraction, 3),
  };
}

function snapShipToStationPerimeter(entity, station) {
  const desiredDistance = Math.max(
    DEFAULT_STATION_UNDOCK_DISTANCE,
    getStationConfiguredUndockDistance(station),
    getStationInteractionRadius(station) + entity.radius + 500,
  );
  const approachDirection = normalizeVector(
    subtractVectors(entity.position, station.position),
    cloneVector(station.undockDirection, DEFAULT_RIGHT),
  );

  entity.position = addVectors(
    cloneVector(station.position),
    scaleVector(approachDirection, desiredDistance),
  );
  entity.targetPoint = cloneVector(station.position);
}

function getLegacyStationNormalizationTarget(entity) {
  if (!entity || entity.kind !== "ship") {
    return null;
  }

  if (
    entity.targetEntityID &&
    (entity.mode === "FOLLOW" || entity.mode === "GOTO")
  ) {
    const trackedStation = worldData.getStationByID(entity.targetEntityID);
    if (trackedStation && canShipDockAtStation(entity, trackedStation)) {
      return trackedStation;
    }
  }

  if (
    entity.mode !== "STOP" ||
    toFiniteNumber(entity.speedFraction, 0) > 0 ||
    magnitude(entity.velocity) > 1
  ) {
    return null;
  }

  let closestStation = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const station of worldData.getStationsForSystem(entity.systemID)) {
    const stationDistance = getShipDockingDistanceToStation(entity, station);
    if (stationDistance < closestDistance) {
      closestDistance = stationDistance;
      closestStation = station;
    }
  }

  return closestDistance <= LEGACY_STATION_NORMALIZATION_RADIUS ? closestStation : null;
}

function normalizeLegacyStationState(entity) {
  if (
    !entity ||
    entity.kind !== "ship"
  ) {
    return false;
  }

  const station = getLegacyStationNormalizationTarget(entity);
  if (!station) {
    return false;
  }

  snapShipToStationPerimeter(entity, station);
  return true;
}

function serializeWarpState(entity) {
  if (!entity.warpState) {
    return null;
  }

  return {
    startTimeMs: toFiniteNumber(entity.warpState.startTimeMs, Date.now()),
    durationMs: toFiniteNumber(entity.warpState.durationMs, 0),
    accelTimeMs: toFiniteNumber(entity.warpState.accelTimeMs, 0),
    cruiseTimeMs: toFiniteNumber(entity.warpState.cruiseTimeMs, 0),
    decelTimeMs: toFiniteNumber(entity.warpState.decelTimeMs, 0),
    totalDistance: toFiniteNumber(entity.warpState.totalDistance, 0),
    stopDistance: toFiniteNumber(entity.warpState.stopDistance, 0),
    maxWarpSpeedMs: toFiniteNumber(entity.warpState.maxWarpSpeedMs, 0),
    cruiseWarpSpeedMs: toFiniteNumber(entity.warpState.cruiseWarpSpeedMs, 0),
    warpFloorSpeedMs: toFiniteNumber(entity.warpState.warpFloorSpeedMs, 0),
    warpDropoutSpeedMs: toFiniteNumber(
      entity.warpState.warpDropoutSpeedMs,
      toFiniteNumber(entity.warpState.warpFloorSpeedMs, 0),
    ),
    accelDistance: toFiniteNumber(entity.warpState.accelDistance, 0),
    cruiseDistance: toFiniteNumber(entity.warpState.cruiseDistance, 0),
    decelDistance: toFiniteNumber(entity.warpState.decelDistance, 0),
    accelExponent: toFiniteNumber(entity.warpState.accelExponent, WARP_ACCEL_EXPONENT),
    decelExponent: toFiniteNumber(entity.warpState.decelExponent, WARP_DECEL_EXPONENT),
    accelRate: toFiniteNumber(
      entity.warpState.accelRate,
      toFiniteNumber(entity.warpState.accelExponent, WARP_ACCEL_EXPONENT),
    ),
    decelRate: toFiniteNumber(
      entity.warpState.decelRate,
      toFiniteNumber(entity.warpState.decelExponent, WARP_DECEL_EXPONENT),
    ),
    warpSpeed: toInt(entity.warpState.warpSpeed, 30),
    commandStamp: toInt(entity.warpState.commandStamp, 0),
    startupGuidanceAtMs: toFiniteNumber(entity.warpState.startupGuidanceAtMs, 0),
    startupGuidanceStamp: toInt(entity.warpState.startupGuidanceStamp, 0),
    startupGuidanceVelocity: cloneVector(
      entity.warpState.startupGuidanceVelocity,
      { x: 0, y: 0, z: 0 },
    ),
    cruiseBumpAtMs: toFiniteNumber(entity.warpState.cruiseBumpAtMs, 0),
    cruiseBumpStamp: toInt(entity.warpState.cruiseBumpStamp, 0),
    effectAtMs: toFiniteNumber(entity.warpState.effectAtMs, 0),
    effectStamp: toInt(entity.warpState.effectStamp, 0),
    targetEntityID: toInt(entity.warpState.targetEntityID, 0),
    followID: toInt(entity.warpState.followID, 0),
    followRangeMarker: toFiniteNumber(
      entity.warpState.followRangeMarker,
      entity.warpState.stopDistance,
    ),
    profileType: String(entity.warpState.profileType || "legacy"),
    origin: cloneVector(entity.warpState.origin, entity.position),
    rawDestination: cloneVector(entity.warpState.rawDestination, entity.position),
    targetPoint: cloneVector(entity.warpState.targetPoint, entity.position),
    pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(
      entity.warpState.pilotMaxSpeedRamp,
    ),
  };
}

function serializePendingWarp(pendingWarp) {
  if (!pendingWarp) {
    return null;
  }

  return {
    requestedAtMs: toInt(pendingWarp.requestedAtMs, 0),
    preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
    stopDistance: toFiniteNumber(pendingWarp.stopDistance, 0),
    totalDistance: toFiniteNumber(pendingWarp.totalDistance, 0),
    warpSpeedAU: toFiniteNumber(pendingWarp.warpSpeedAU, 0),
    rawDestination: cloneVector(pendingWarp.rawDestination),
    targetPoint: cloneVector(pendingWarp.targetPoint),
    targetEntityID: toInt(pendingWarp.targetEntityID, 0),
  };
}

function buildOfficialWarpReferenceProfile(
  warpDistanceMeters,
  warpSpeedAU,
  maxSubwarpSpeedMs,
) {
  const totalDistance = Math.max(toFiniteNumber(warpDistanceMeters, 0), 0);
  const resolvedWarpSpeedAU = Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
  const resolvedSubwarpSpeedMs = Math.max(
    Math.min(toFiniteNumber(maxSubwarpSpeedMs, 0) / 2, WARP_DROPOUT_SPEED_MAX_MS),
    1,
  );
  const kAccel = resolvedWarpSpeedAU;
  const kDecel = Math.min(resolvedWarpSpeedAU / 3, 2);

  let maxWarpSpeedMs = resolvedWarpSpeedAU * ONE_AU_IN_METERS;
  let accelDistance = maxWarpSpeedMs / kAccel;
  let decelDistance = maxWarpSpeedMs / kDecel;
  const minimumDistance = accelDistance + decelDistance;
  const cruiseDistance = Math.max(totalDistance - minimumDistance, 0);
  let cruiseTimeSeconds = 0;
  let profileType = "long";

  if (minimumDistance > totalDistance) {
    profileType = "short";
    maxWarpSpeedMs =
      (totalDistance * kAccel * kDecel) /
      Math.max(kAccel + kDecel, 0.001);
    accelDistance = maxWarpSpeedMs / kAccel;
    decelDistance = maxWarpSpeedMs / kDecel;
  } else {
    cruiseTimeSeconds = cruiseDistance / maxWarpSpeedMs;
  }

  const accelTimeSeconds =
    Math.log(Math.max(maxWarpSpeedMs / kAccel, 1)) / kAccel;
  const decelTimeSeconds =
    Math.log(Math.max(maxWarpSpeedMs / resolvedSubwarpSpeedMs, 1)) / kDecel;
  const totalTimeSeconds =
    accelTimeSeconds + cruiseTimeSeconds + decelTimeSeconds;

  return {
    profileType,
    warpDistanceMeters: roundNumber(totalDistance, 3),
    warpDistanceAU: roundNumber(totalDistance / ONE_AU_IN_METERS, 6),
    warpSpeedAU: roundNumber(resolvedWarpSpeedAU, 3),
    kAccel: roundNumber(kAccel, 6),
    kDecel: roundNumber(kDecel, 6),
    warpDropoutSpeedMs: roundNumber(resolvedSubwarpSpeedMs, 3),
    maxWarpSpeedMs: roundNumber(maxWarpSpeedMs, 3),
    maxWarpSpeedAU: roundNumber(maxWarpSpeedMs / ONE_AU_IN_METERS, 6),
    accelDistance: roundNumber(accelDistance, 3),
    accelDistanceAU: roundNumber(accelDistance / ONE_AU_IN_METERS, 6),
    cruiseDistance: roundNumber(
      Math.max(totalDistance - accelDistance - decelDistance, 0),
      3,
    ),
    cruiseDistanceAU: roundNumber(
      Math.max(totalDistance - accelDistance - decelDistance, 0) /
        ONE_AU_IN_METERS,
      6,
    ),
    decelDistance: roundNumber(decelDistance, 3),
    decelDistanceAU: roundNumber(decelDistance / ONE_AU_IN_METERS, 6),
    minimumDistance: roundNumber(
      Math.min(minimumDistance, totalDistance),
      3,
    ),
    minimumDistanceAU: roundNumber(
      Math.min(minimumDistance, totalDistance) / ONE_AU_IN_METERS,
      6,
    ),
    accelTimeMs: roundNumber(accelTimeSeconds * 1000, 3),
    cruiseTimeMs: roundNumber(cruiseTimeSeconds * 1000, 3),
    decelTimeMs: roundNumber(decelTimeSeconds * 1000, 3),
    totalTimeMs: roundNumber(totalTimeSeconds * 1000, 3),
    ceilTotalSeconds: Math.ceil(totalTimeSeconds),
  };
}

function buildWarpProfileDelta(warpState, officialProfile) {
  if (!warpState || !officialProfile) {
    return null;
  }

  return {
    durationMs: roundNumber(
      toFiniteNumber(warpState.durationMs, 0) -
        toFiniteNumber(officialProfile.totalTimeMs, 0),
      3,
    ),
    accelTimeMs: roundNumber(
      toFiniteNumber(warpState.accelTimeMs, 0) -
        toFiniteNumber(officialProfile.accelTimeMs, 0),
      3,
    ),
    cruiseTimeMs: roundNumber(
      toFiniteNumber(warpState.cruiseTimeMs, 0) -
        toFiniteNumber(officialProfile.cruiseTimeMs, 0),
      3,
    ),
    decelTimeMs: roundNumber(
      toFiniteNumber(warpState.decelTimeMs, 0) -
        toFiniteNumber(officialProfile.decelTimeMs, 0),
      3,
    ),
    maxWarpSpeedMs: roundNumber(
      toFiniteNumber(warpState.maxWarpSpeedMs, 0) -
        toFiniteNumber(officialProfile.maxWarpSpeedMs, 0),
      3,
    ),
    accelDistance: roundNumber(
      toFiniteNumber(warpState.accelDistance, 0) -
        toFiniteNumber(officialProfile.accelDistance, 0),
      3,
    ),
    cruiseDistance: roundNumber(
      toFiniteNumber(warpState.cruiseDistance, 0) -
        toFiniteNumber(officialProfile.cruiseDistance, 0),
      3,
    ),
    decelDistance: roundNumber(
      toFiniteNumber(warpState.decelDistance, 0) -
        toFiniteNumber(officialProfile.decelDistance, 0),
      3,
    ),
  };
}

function getWarpPhaseName(warpState, elapsedMs) {
  const elapsed = Math.max(toFiniteNumber(elapsedMs, 0), 0);
  const accelTimeMs = Math.max(toFiniteNumber(warpState && warpState.accelTimeMs, 0), 0);
  const cruiseTimeMs = Math.max(toFiniteNumber(warpState && warpState.cruiseTimeMs, 0), 0);
  const durationMs = Math.max(toFiniteNumber(warpState && warpState.durationMs, 0), 0);

  if (elapsed < accelTimeMs) {
    return "accel";
  }
  if (elapsed < accelTimeMs + cruiseTimeMs) {
    return "cruise";
  }
  if (elapsed < durationMs) {
    return "decel";
  }
  return "complete";
}

function buildWarpRuntimeDiagnostics(entity, now = Date.now()) {
  if (!entity || !entity.warpState) {
    return null;
  }

  const warpState = entity.warpState;
  const elapsedMs = Math.max(
    0,
    toFiniteNumber(now, Date.now()) - toFiniteNumber(warpState.startTimeMs, now),
  );
  const progress = getWarpProgress(warpState, now);
  const positionRemainingDistance = Math.max(
    distance(entity.position, warpState.targetPoint),
    0,
  );
  const profileRemainingDistance = Math.max(
    toFiniteNumber(warpState.totalDistance, 0) - toFiniteNumber(progress.traveled, 0),
    0,
  );
  const velocityMagnitude = magnitude(entity.velocity);

  return {
    stamp: getCurrentDestinyStamp(now),
    phase: getWarpPhaseName(warpState, elapsedMs),
    elapsedMs: roundNumber(elapsedMs, 3),
    remainingMs: roundNumber(
      Math.max(toFiniteNumber(warpState.durationMs, 0) - elapsedMs, 0),
      3,
    ),
    progressComplete: Boolean(progress.complete),
    progressDistance: roundNumber(toFiniteNumber(progress.traveled, 0), 3),
    progressDistanceAU: roundNumber(
      toFiniteNumber(progress.traveled, 0) / ONE_AU_IN_METERS,
      6,
    ),
    progressRemainingDistance: roundNumber(profileRemainingDistance, 3),
    progressRemainingDistanceAU: roundNumber(
      profileRemainingDistance / ONE_AU_IN_METERS,
      6,
    ),
    progressSpeedMs: roundNumber(toFiniteNumber(progress.speed, 0), 3),
    progressSpeedAU: roundNumber(
      toFiniteNumber(progress.speed, 0) / ONE_AU_IN_METERS,
      6,
    ),
    entitySpeedMs: roundNumber(velocityMagnitude, 3),
    entitySpeedAU: roundNumber(velocityMagnitude / ONE_AU_IN_METERS, 6),
    positionRemainingDistance: roundNumber(positionRemainingDistance, 3),
    positionRemainingDistanceAU: roundNumber(
      positionRemainingDistance / ONE_AU_IN_METERS,
      6,
    ),
    remainingDistanceDelta: roundNumber(
      positionRemainingDistance - profileRemainingDistance,
      3,
    ),
  };
}

function logWarpDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  const now = Date.now();
  appendWarpDebug(JSON.stringify({
    event,
    atMs: now,
    destinyStamp: getCurrentDestinyStamp(now),
    charID: entity.characterID || 0,
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    maxVelocity: roundNumber(entity.maxVelocity, 3),
    speedFraction: roundNumber(entity.speedFraction, 3),
    pendingWarp: summarizePendingWarp(entity.pendingWarp),
    warpState: serializeWarpState(entity),
    warpRuntime: buildWarpRuntimeDiagnostics(entity, now),
    ...extra,
  }));
}

function logBallDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  appendBallDebug(JSON.stringify({
    event,
    atMs: Date.now(),
    destinyStamp: getCurrentDestinyStamp(),
    charID: entity.characterID || 0,
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    ...destiny.debugDescribeEntityBall(entity),
    ...extra,
  }));
}

function serializeSpaceState(entity) {
  return {
    systemID: entity.systemID,
    position: cloneVector(entity.position),
    velocity: cloneVector(entity.velocity),
    direction: cloneVector(entity.direction),
    targetPoint: cloneVector(entity.targetPoint, entity.position),
    speedFraction: entity.speedFraction,
    mode: normalizeMode(entity.mode),
    targetEntityID: entity.targetEntityID || null,
    followRange: entity.followRange || 0,
    orbitDistance: entity.orbitDistance || 0,
    orbitNormal: cloneVector(entity.orbitNormal, buildPerpendicular(entity.direction)),
    orbitSign: entity.orbitSign < 0 ? -1 : 1,
    pendingWarp: serializePendingWarp(entity.pendingWarp),
    warpState: serializeWarpState(entity),
  };
}

function getActualSpeedFraction(entity) {
  if (!entity) {
    return 0;
  }

  const maxVelocity = Math.max(toFiniteNumber(entity.maxVelocity, 0), 0.001);
  return clamp(magnitude(entity.velocity) / maxVelocity, 0, 1);
}

function isReadyForDestiny(session) {
  return Boolean(
    session &&
      session._space &&
      session._space.initialStateSent &&
      session.socket &&
      !session.socket.destroyed,
  );
}

function buildShipPrimeUpdates(entity, stampOverride = null) {
  if (!entity || entity.kind !== "ship") {
    return [];
  }

  const stamp = stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
  return [
    {
      stamp,
      payload: destiny.buildSetBallAgilityPayload(entity.itemID, entity.inertia),
    },
    {
      stamp,
      payload: destiny.buildSetBallMassPayload(entity.itemID, entity.mass),
    },
    {
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(entity.itemID, entity.maxVelocity),
    },
    {
      stamp,
      payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
    },
  ];
}

function buildShipPrimeUpdatesForEntities(entities, stampOverride = null) {
  const updates = [];
  for (const entity of entities) {
    updates.push(...buildShipPrimeUpdates(entity, stampOverride));
  }
  return updates;
}

function buildPositionVelocityCorrectionUpdates(entity, options = {}) {
  const stamp = toInt(options.stamp, getMovementStamp());
  const updates = [];
  if (options.includePosition === true) {
    updates.push({
      stamp,
      payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
    });
  }
  updates.push({
    stamp,
    payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
  });
  return updates;
}

function buildPilotWarpCorrectionUpdates(entity, stamp) {
  return buildPositionVelocityCorrectionUpdates(entity, {
    stamp,
    includePosition: true,
  });
}

function usesActiveSubwarpWatcherCorrections(entity) {
  return Boolean(
    entity &&
      entity.mode !== "WARP" &&
      entity.pendingDock == null &&
      (entity.mode === "GOTO" ||
        entity.mode === "FOLLOW" ||
        entity.mode === "ORBIT"),
  );
}

function getWatcherCorrectionIntervalMs(entity) {
  return usesActiveSubwarpWatcherCorrections(entity)
    ? ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS
    : WATCHER_CORRECTION_INTERVAL_MS;
}

function getWatcherPositionCorrectionIntervalMs(entity) {
  return usesActiveSubwarpWatcherCorrections(entity)
    ? ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS
    : WATCHER_POSITION_CORRECTION_INTERVAL_MS;
}

function buildPilotPreWarpAddBallUpdate(entity, stamp) {
  return {
    stamp,
    payload: destiny.buildAddBallPayload(entity.itemID, {
      mass: entity.mass,
      radius: entity.radius,
      maxSpeed: entity.maxVelocity,
      isFree: true,
      isGlobal: false,
      isMassive: false,
      isInteractive: true,
      isMoribund: false,
      position: entity.position,
      velocity: entity.velocity,
      inertia: entity.inertia,
      speedFraction: clamp(
        toFiniteNumber(entity.speedFraction, 1),
        0,
        MAX_SUBWARP_SPEED_FRACTION,
      ),
    }),
  };
}

function buildPilotPreWarpRebaselineUpdates(entity, pendingWarp, stamp) {
  return [
    {
      stamp,
      payload: destiny.buildSetBallPositionPayload(
        entity.itemID,
        entity.position,
      ),
    },
    {
      stamp,
      payload: destiny.buildSetBallVelocityPayload(
        entity.itemID,
        entity.velocity,
      ),
    },
  ];
}

function buildPilotWarpEgoStateRefreshUpdates(system, entity, stamp) {
  const egoEntities = [entity];
  return [
    {
      stamp,
      payload: destiny.buildAddBalls2Payload(stamp, egoEntities),
    },
    {
      stamp,
      payload: destiny.buildSetStatePayload(stamp, system, entity.itemID, egoEntities),
    },
  ];
}

function buildPilotWarpActivationStateRefreshUpdates(entity, stamp) {
  return [
    {
      stamp,
      payload: destiny.buildAddBalls2Payload(stamp, [entity]),
    },
  ];
}

function getNominalWarpFactor(entity, warpState) {
  return Math.max(
    1,
    toInt(
      warpState && warpState.warpSpeed,
      Math.round(toFiniteNumber(entity && entity.warpSpeedAU, 0) * 10),
    ),
  );
}

function getPilotWarpFactorOptionA(entity, warpState) {
  const nominalWarpFactor = getNominalWarpFactor(entity, warpState);
  if (!ENABLE_PILOT_WARP_FACTOR_OPTION_A) {
    return nominalWarpFactor;
  }
  return Math.max(
    nominalWarpFactor + 1,
    Math.round(nominalWarpFactor * PILOT_WARP_FACTOR_OPTION_A_SCALE),
  );
}

function buildWarpStartCommandUpdate(entity, stamp, warpState, options = {}) {
  const warpFactor = Math.max(
    1,
    toInt(options.warpFactor, getNominalWarpFactor(entity, warpState)),
  );
  return {
    stamp,
    payload: destiny.buildWarpToPayload(
      entity.itemID,
      // WarpTo expects the raw destination plus a separate stop distance.
      // Feeding the already stop-adjusted target point here leaves the
      // piloting client stuck in a half-initialized local warp.
      warpState.rawDestination,
      warpState.stopDistance,
      warpFactor,
    ),
  };
}

function buildWarpPrepareCommandUpdate(entity, stamp, warpState) {
  return buildWarpStartCommandUpdate(entity, stamp, warpState);
}

function getPilotWarpPeakSpeed(entity, warpState) {
  if (!warpState) {
    return Math.max(toFiniteNumber(entity && entity.maxVelocity, 0), 0);
  }

  const peakWarpSpeedMs =
    warpState.profileType === "short"
      ? toFiniteNumber(warpState.maxWarpSpeedMs, 0)
      : toFiniteNumber(warpState.cruiseWarpSpeedMs, 0);
  return Math.max(
    peakWarpSpeedMs,
    toFiniteNumber(warpState.maxWarpSpeedMs, 0),
    toFiniteNumber(entity && entity.maxVelocity, 0),
  );
}

function buildPilotWarpMaxSpeedRamp(entity, warpState, warpStartStamp) {
  if (!warpState) {
    return [];
  }

  const startTimeMs = toFiniteNumber(warpState.startTimeMs, 0);
  if (startTimeMs <= 0) {
    return [];
  }

  const ramp = [];
  let previousStamp = toInt(warpStartStamp, 0);
  const cruiseBumpStamp = shouldSchedulePilotWarpCruiseBump(warpState)
    ? getPilotWarpCruiseBumpStamp(warpStartStamp, warpState)
    : 0;
  if (ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B) {
    const accelTimeMs = Math.max(toFiniteNumber(warpState.accelTimeMs, 0), 0);
    const cruiseTimeMs = Math.max(toFiniteNumber(warpState.cruiseTimeMs, 0), 0);
    const decelAssistAtMs = Math.max(
      startTimeMs,
      (startTimeMs + accelTimeMs + cruiseTimeMs) - PILOT_WARP_SOLVER_ASSIST_LEAD_MS,
    );
    const resolvedStamp = Math.max(
      previousStamp + 1,
      getCurrentDestinyStamp(decelAssistAtMs),
    );
    const assistSpeed = Math.max(
      getPilotWarpActivationSeedSpeed(entity) * PILOT_WARP_SOLVER_ASSIST_SCALE,
      toFiniteNumber(entity && entity.maxVelocity, 0) + 1,
    );
    if (assistSpeed > 0) {
      ramp.push({
        atMs: decelAssistAtMs,
        stamp: resolvedStamp >>> 0,
        speed: assistSpeed,
        label: "decel_assist",
      });
      previousStamp = resolvedStamp >>> 0;
    }
  }

  if (!ENABLE_PILOT_WARP_MAX_SPEED_RAMP) {
    return ramp;
  }

  const accelTimeMs = Math.max(toFiniteNumber(warpState.accelTimeMs, 0), 0);
  const peakWarpSpeedMs = Math.max(getPilotWarpPeakSpeed(entity, warpState), 0);
  if (accelTimeMs <= 0 || peakWarpSpeedMs <= 0) {
    return ramp;
  }

  for (let index = 0; index < PILOT_WARP_SPEED_RAMP_FRACTIONS.length; index += 1) {
    const phaseFraction = clamp(PILOT_WARP_SPEED_RAMP_FRACTIONS[index], 0, 1);
    const speedScale = clamp(PILOT_WARP_SPEED_RAMP_SCALES[index], 0, 0.95);
    const atMs = startTimeMs + (accelTimeMs * phaseFraction);
    const resolvedStamp = Math.max(
      previousStamp + 1,
      getCurrentDestinyStamp(atMs),
    );
    const speed = peakWarpSpeedMs * speedScale;
    if (speed <= 0) {
      continue;
    }
    // Long warps already get an explicit cruise-speed SetMaxSpeed handoff.
    // Avoid stacking a second accel-ramp SetMaxSpeed onto that exact same
    // stamp, because the live client logs show that long-warp-only duplicate
    // tick is one of the remaining native-solver mismatches.
    if (cruiseBumpStamp > 0 && resolvedStamp === cruiseBumpStamp) {
      continue;
    }
    ramp.push({
      atMs,
      stamp: resolvedStamp >>> 0,
      speed,
      label: `accel_${index + 1}`,
    });
    previousStamp = resolvedStamp >>> 0;
  }

  return ramp;
}

function getPilotWarpActivationSeedSpeed(entity) {
  return Math.max(
    toFiniteNumber(entity && entity.maxVelocity, 0) * WARP_START_ACTIVATION_SEED_SCALE,
    0,
  );
}

function buildPilotWarpSeedUpdate(entity, stamp) {
  return {
    stamp,
    payload: destiny.buildSetMaxSpeedPayload(
      entity.itemID,
      getPilotWarpActivationSeedSpeed(entity),
    ),
  };
}

function getPilotWarpActivationKickoffSpeed(entity, warpState) {
  const peakWarpSpeedMs = Math.max(getPilotWarpPeakSpeed(entity, warpState), 0);
  const firstRampScale = clamp(
    PILOT_WARP_SPEED_RAMP_SCALES[0],
    0,
    0.95,
  );
  return Math.max(
    peakWarpSpeedMs * firstRampScale,
    getPilotWarpActivationSeedSpeed(entity),
    toFiniteNumber(entity && entity.maxVelocity, 0) + 1,
  );
}

function buildPilotWarpActivationKickoffUpdate(entity, stamp, warpState) {
  return {
    stamp,
    payload: destiny.buildSetMaxSpeedPayload(
      entity.itemID,
      getPilotWarpActivationKickoffSpeed(entity, warpState),
    ),
  };
}

function getPilotWarpNativeActivationSpeedFloor(entity) {
  return Math.max(
    (toFiniteNumber(entity && entity.maxVelocity, 0) *
      WARP_NATIVE_ACTIVATION_SPEED_FRACTION) +
      WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS,
    WARP_NATIVE_ACTIVATION_SPEED_MARGIN_MS,
  );
}

function buildWarpActivationVelocityUpdate(entity, stamp, warpState) {
  const currentVelocity = cloneVector(entity && entity.velocity);
  const currentSpeed = magnitude(currentVelocity);
  const activationSpeedFloor = getPilotWarpNativeActivationSpeedFloor(entity);
  let resolvedVelocity = currentVelocity;

  if (currentSpeed + 0.0001 < activationSpeedFloor) {
    const targetPoint = cloneVector(
      warpState && warpState.targetPoint,
      entity && entity.targetPoint,
    );
    const direction = normalizeVector(
      subtractVectors(targetPoint, cloneVector(entity && entity.position)),
      cloneVector(entity && entity.direction, DEFAULT_RIGHT),
    );
    resolvedVelocity = scaleVector(direction, activationSpeedFloor);
  }

  if (magnitude(resolvedVelocity) <= 0.5) {
    return null;
  }
  return {
    stamp,
    payload: destiny.buildSetBallVelocityPayload(entity.itemID, resolvedVelocity),
  };
}

function buildWarpStartVelocityCarryoverUpdate(entity, stamp, warpState) {
  const startupGuidanceVelocity = cloneVector(
    warpState && warpState.startupGuidanceVelocity,
    { x: 0, y: 0, z: 0 },
  );
  if (magnitude(startupGuidanceVelocity) <= 0.5) {
    return null;
  }
  return {
    stamp,
    payload: destiny.buildSetBallVelocityPayload(
      entity.itemID,
      startupGuidanceVelocity,
    ),
  };
}

function shouldSchedulePilotWarpCruiseBump(warpState) {
  return (
    ENABLE_PILOT_WARP_MAX_SPEED_RAMP &&
    toFiniteNumber(warpState && warpState.cruiseDistance, 0) > 0 &&
    toFiniteNumber(warpState && warpState.cruiseWarpSpeedMs, 0) > 0
  );
}

function getPilotWarpStartupGuidanceAtMs(warpState) {
  if (!warpState) {
    return 0;
  }
  const startTimeMs = toFiniteNumber(warpState.startTimeMs, 0);
  if (startTimeMs <= 0) {
    return 0;
  }
  return startTimeMs + DESTINY_STAMP_INTERVAL_MS;
}

function getPilotWarpStartupGuidanceStamp(warpStartStamp, warpState) {
  const scheduledStamp = getCurrentDestinyStamp(
    getPilotWarpStartupGuidanceAtMs(warpState),
  );
  return (Math.max(toInt(warpStartStamp, 0) + 1, scheduledStamp) & 0x7fffffff) >>> 0;
}

function getPilotWarpCruiseBumpAtMs(warpState) {
  const startTimeMs = toFiniteNumber(warpState && warpState.startTimeMs, Date.now());
  const accelTimeMs = Math.max(
    toFiniteNumber(warpState && warpState.accelTimeMs, 0),
    0,
  );
  const accelEndAtMs = startTimeMs + accelTimeMs;
  const startupGuidanceAtMs = getPilotWarpStartupGuidanceAtMs(warpState);
  return Math.max(
    accelEndAtMs,
    startupGuidanceAtMs + DESTINY_STAMP_INTERVAL_MS,
  );
}

function getPilotWarpEffectAtMs(warpState) {
  // The client's active warp loop is keyed off ball.effectStamp > 0. Delaying
  // the pilot effect until the end of accel leaves the ego ball entering
  // "active warp" late and consistently stalling far behind the server curve.
  return toFiniteNumber(warpState && warpState.startTimeMs, Date.now());
}

function getPilotWarpCruiseBumpStamp(warpStartStamp, warpState) {
  return getCurrentDestinyStamp(getPilotWarpCruiseBumpAtMs(warpState));
}

function getPilotWarpEffectStamp(warpStartStamp, warpState) {
  return warpStartStamp;
}

function buildWarpCruiseMaxSpeedUpdate(entity, stamp, warpState) {
  const cruiseWarpSpeedMs = Math.max(
    toFiniteNumber(warpState && warpState.cruiseWarpSpeedMs, 0),
    toFiniteNumber(entity && entity.maxVelocity, 0),
  );
  return {
    stamp,
    payload: destiny.buildSetMaxSpeedPayload(entity.itemID, cruiseWarpSpeedMs),
  };
}

function getWarpAccelRate(warpSpeedAU) {
  return Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
}

function getWarpDecelRate(warpSpeedAU) {
  return clamp(getWarpAccelRate(warpSpeedAU) / 3, 0.001, WARP_DECEL_RATE_MAX);
}

function getWarpDropoutSpeedMs(entity) {
  return Math.max(
    Math.min(
      toFiniteNumber(entity && entity.maxVelocity, 0) / 2,
      WARP_DROPOUT_SPEED_MAX_MS,
    ),
    1,
  );
}

function getWarpCompletionDistance(warpState) {
  const stopDistance = Math.max(
    toFiniteNumber(warpState && warpState.stopDistance, 0),
    0,
  );
  return clamp(
    stopDistance * WARP_COMPLETION_DISTANCE_RATIO,
    WARP_COMPLETION_DISTANCE_MIN_METERS,
    WARP_COMPLETION_DISTANCE_MAX_METERS,
  );
}

function buildWarpStartEffectUpdate(entity, stamp) {
  return {
    stamp,
    payload: destiny.buildOnSpecialFXPayload(entity.itemID, "effects.Warping", {
      active: false,
    }),
  };
}

function buildWarpPrepareDispatch(entity, stamp, warpState) {
  const sharedUpdates = [
    buildWarpPrepareCommandUpdate(entity, stamp, warpState),
    {
      stamp,
      payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 1),
    },
  ];

  return {
    sharedUpdates,
    pilotUpdates: [
      buildPilotWarpSeedUpdate(entity, stamp),
      ...sharedUpdates,
    ],
  };
}

function buildPilotWarpActivationUpdates(entity, stamp, warpState) {
  const updates = [];
  const activationVelocityUpdate = buildWarpActivationVelocityUpdate(
    entity,
    stamp,
    warpState,
  );
  if (activationVelocityUpdate) {
    updates.push(activationVelocityUpdate);
  }
  updates.push(buildWarpStartCommandUpdate(entity, stamp, warpState));
  updates.push(buildPilotWarpActivationKickoffUpdate(entity, stamp, warpState));
  if (toInt(warpState && warpState.effectStamp, 0) <= stamp) {
    updates.push(
      buildWarpStartEffectUpdate(
        entity,
        toInt(warpState && warpState.effectStamp, stamp),
      ),
    );
  }
  updates.push({
    stamp,
    payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
  });
  return updates;
}

function buildWarpCompletionUpdates(entity, stamp) {
  return [
    {
      stamp,
      payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
    },
    {
      stamp,
      payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
    },
    {
      stamp,
      payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
    },
    {
      stamp,
      payload: destiny.buildStopPayload(entity.itemID),
    },
  ];
}

function buildPilotWarpCompletionUpdates(entity, stamp) {
  return [
    ...buildWarpCompletionUpdates(entity, stamp),
    {
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(entity.itemID, entity.maxVelocity),
    },
  ];
}

function buildWarpStartUpdates(entity, warpState, stampOverride = null) {
  const stamp =
    stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
  const updates = [
    buildWarpStartCommandUpdate(entity, stamp, warpState),
    buildWarpStartEffectUpdate(entity, stamp),
    {
      stamp,
      payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
    },
  ];
  if (magnitude(entity.velocity) > 0.5) {
    updates.push({
      stamp,
      payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
    });
  }
  return updates;
}

function summarizeDestinyArgs(name, args) {
  switch (name) {
    case "GotoDirection":
    case "GotoPoint":
    case "SetBallVelocity":
    case "SetBallPosition":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
      ];
    case "SetSpeedFraction":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1]), 3),
      ];
    case "FollowBall":
    case "Orbit":
      return [
        toInt(args && args[0], 0),
        toInt(args && args[1], 0),
        roundNumber(args && args[2]),
      ];
    case "Stop":
      return [toInt(args && args[0], 0)];
    case "WarpTo":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
        roundNumber(unwrapMarshalNumber(args && args[4])),
        toInt(args && args[5], 0),
      ];
    case "AddBall":
      return [
        toInt(args && args[0], 0),
        roundNumber(unwrapMarshalNumber(args && args[1])),
        roundNumber(unwrapMarshalNumber(args && args[2])),
        roundNumber(unwrapMarshalNumber(args && args[3])),
        toInt(args && args[4], 0),
        toInt(args && args[5], 0),
        toInt(args && args[6], 0),
        toInt(args && args[7], 0),
        toInt(args && args[8], 0),
        roundNumber(unwrapMarshalNumber(args && args[9])),
        roundNumber(unwrapMarshalNumber(args && args[10])),
        roundNumber(unwrapMarshalNumber(args && args[11])),
        roundNumber(unwrapMarshalNumber(args && args[12])),
        roundNumber(unwrapMarshalNumber(args && args[13])),
        roundNumber(unwrapMarshalNumber(args && args[14])),
        roundNumber(unwrapMarshalNumber(args && args[15]), 3),
        roundNumber(unwrapMarshalNumber(args && args[16]), 3),
      ];
    case "AddBalls2":
      return ["omitted"];
    case "SetState":
      return ["omitted"];
    default:
      return args;
  }
}

function getPayloadPrimaryEntityID(payload) {
  if (!Array.isArray(payload) || payload.length < 2) {
    return 0;
  }
  const [name, args] = payload;
  switch (name) {
    case "GotoDirection":
    case "GotoPoint":
    case "SetBallVelocity":
    case "SetBallPosition":
    case "SetSpeedFraction":
    case "FollowBall":
    case "Orbit":
    case "Stop":
    case "WarpTo":
    case "OnSpecialFX":
    case "SetBallMassive":
    case "SetMaxSpeed":
    case "SetBallMass":
    case "SetBallAgility":
      return toInt(args && args[0], 0);
    default:
      return 0;
  }
}

function logDestinyDispatch(session, payloads, waitForBubble) {
  if (!session || payloads.length === 0) {
    return;
  }

  const dispatchDestinyStamp = getCurrentDestinyStamp();
  const stampLeads = payloads.map((update) => (
    toInt(update && update.stamp, 0) - dispatchDestinyStamp
  ));
  appendDestinyDebug(JSON.stringify({
    event: "destiny.send",
    charID: session.characterID || 0,
    shipID: session._space ? session._space.shipID || 0 : 0,
    systemID: session._space ? session._space.systemID || 0 : 0,
    waitForBubble: Boolean(waitForBubble),
    dispatchDestinyStamp,
    maxLeadFromDispatch: stampLeads.length > 0 ? Math.max(...stampLeads) : 0,
    updates: payloads.map((update) => ({
      stamp: toInt(update && update.stamp, 0),
      leadFromDispatch: toInt(update && update.stamp, 0) - dispatchDestinyStamp,
      name: update && update.payload ? update.payload[0] : null,
      args: summarizeDestinyArgs(
        update && update.payload ? update.payload[0] : null,
        update && update.payload ? update.payload[1] : null,
      ),
    })),
  }, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function clearPendingDock(entity) {
  if (entity) {
    entity.pendingDock = null;
  }
}

function logMovementDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  const now = Date.now();
  appendMovementDebug(JSON.stringify({
    event,
    atMs: now,
    destinyStamp: getCurrentDestinyStamp(now),
    charID: entity.characterID || 0,
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    speedFraction: roundNumber(entity.speedFraction, 3),
    position: summarizeVector(entity.position),
    velocity: summarizeVector(entity.velocity),
    direction: summarizeVector(entity.direction),
    targetPoint: summarizeVector(entity.targetPoint),
    targetEntityID: entity.targetEntityID || 0,
    dockingTargetID: entity.dockingTargetID || 0,
    pendingWarp: summarizePendingWarp(entity.pendingWarp),
    speed: roundNumber(magnitude(entity.velocity), 3),
    turn: entity.lastTurnMetrics || null,
    motion: entity.lastMotionDebug || null,
    trace: getMovementTraceSnapshot(entity, now),
    ...extra,
  }));
}

function buildStaticStationEntity(station) {
  const dunRotation = getStationAuthoredDunRotation(station);
  return {
    kind: "station",
    itemID: station.stationID,
    typeID: station.stationTypeID,
    groupID: station.groupID,
    categoryID: station.categoryID,
    itemName: station.stationName,
    ownerID: station.corporationID || 1,
    corporationID: station.corporationID || 0,
    allianceID: 0,
    warFactionID: 0,
    radius: getStationInteractionRadius(station),
    position: cloneVector(station.position),
    dockPosition: station.dockPosition
      ? cloneVector(station.dockPosition)
      : null,
    dockOrientation: station.dockOrientation
      ? normalizeVector(station.dockOrientation, station.undockDirection || DEFAULT_RIGHT)
      : normalizeVector(station.undockDirection, DEFAULT_RIGHT),
    dunRotation,
    activityLevel: getStationRenderMetadata(station, "activityLevel") ?? null,
    skinMaterialSetID: getStationRenderMetadata(station, "skinMaterialSetID") ?? null,
    celestialEffect: getStationRenderMetadata(station, "celestialEffect") ?? null,
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticCelestialEntity(celestial) {
  return {
    kind: celestial.kind || "celestial",
    itemID: celestial.itemID,
    typeID: celestial.typeID,
    groupID: celestial.groupID,
    categoryID: celestial.categoryID,
    itemName: celestial.itemName,
    ownerID: 1,
    radius: celestial.radius || (celestial.groupID === 10 ? 15000 : 1000),
    position: cloneVector(celestial.position),
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticStargateEntity(stargate) {
  const sourceSystem = worldData.getSolarSystemByID(stargate && stargate.solarSystemID);
  const destinationSystem = worldData.getSolarSystemByID(
    stargate && stargate.destinationSolarSystemID,
  );
  const originSystemOwnerID = getSystemOwnerID(sourceSystem);
  const destinationSystemOwnerID = getSystemOwnerID(destinationSystem);
  const destinationSystemStatusIcons = getStargateStatusIcons(
    stargate,
    destinationSystem,
  );
  const destinationSystemWarningIcon = getStargateWarningIcon(
    stargate,
    sourceSystem,
    destinationSystem,
  );
  const dunRotation = getResolvedStargateDunRotation(stargate);
  const groupID = toInt(getStargateTypeMetadata(stargate, "groupID"), 10);
  const categoryID = toInt(getStargateTypeMetadata(stargate, "categoryID"), 2);

  return {
    kind: "stargate",
    itemID: stargate.itemID,
    typeID: stargate.typeID,
    groupID,
    categoryID,
    itemName: stargate.itemName,
    ownerID: originSystemOwnerID || 1,
    radius: stargate.radius || 15000,
    position: cloneVector(stargate.position),
    velocity: { x: 0, y: 0, z: 0 },
    typeName: getStargateTypeMetadata(stargate, "typeName") || null,
    groupName: getStargateTypeMetadata(stargate, "groupName") || null,
    graphicID: toInt(getStargateTypeMetadata(stargate, "graphicID"), 0) || null,
    raceID: toInt(getStargateTypeMetadata(stargate, "raceID"), 0) || null,
    destinationID: stargate.destinationID,
    destinationSolarSystemID: stargate.destinationSolarSystemID,
    activationState: coerceStableActivationState(
      stargate.activationState,
      STARGATE_ACTIVATION_STATE.OPEN,
    ),
    activationTransitionAtMs: 0,
    poseID: toInt(stargate.poseID, 0),
    localCorruptionStageAndMaximum: coerceStageTuple(
      stargate.localCorruptionStageAndMaximum,
    ),
    destinationCorruptionStageAndMaximum: coerceStageTuple(
      stargate.destinationCorruptionStageAndMaximum,
    ),
    localSuppressionStageAndMaximum: coerceStageTuple(
      stargate.localSuppressionStageAndMaximum,
    ),
    destinationSuppressionStageAndMaximum: coerceStageTuple(
      stargate.destinationSuppressionStageAndMaximum,
    ),
    hasVolumetricDrifterCloud: Boolean(stargate.hasVolumetricDrifterCloud),
    originSystemOwnerID,
    destinationSystemOwnerID,
    destinationSystemWarning: destinationSystemWarningIcon,
    destinationSystemWarningIcon,
    destinationSystemStatusIcons,
    dunRotation,
  };
}

function buildWarpState(rawWarpState, position, warpSpeedAU) {
  if (!rawWarpState || typeof rawWarpState !== "object") {
    return null;
  }
  const resolvedWarpSpeedAU = Math.max(toFiniteNumber(warpSpeedAU, 0), 0.001);
  const startTimeMs = toFiniteNumber(rawWarpState.startTimeMs, Date.now());
  const accelTimeMs = toFiniteNumber(rawWarpState.accelTimeMs, 0);
  const startupGuidanceAtMs = toFiniteNumber(
    rawWarpState.startupGuidanceAtMs,
    0,
  );
  const cruiseBumpAtMs = toFiniteNumber(
    rawWarpState.cruiseBumpAtMs,
    startTimeMs + Math.max(accelTimeMs, 0),
  );
  const effectAtMs = toFiniteNumber(
    rawWarpState.effectAtMs,
    startTimeMs,
  );

  return {
    startTimeMs,
    durationMs: toFiniteNumber(rawWarpState.durationMs, 0),
    accelTimeMs,
    cruiseTimeMs: toFiniteNumber(rawWarpState.cruiseTimeMs, 0),
    decelTimeMs: toFiniteNumber(rawWarpState.decelTimeMs, 0),
    totalDistance: toFiniteNumber(rawWarpState.totalDistance, 0),
    stopDistance: toFiniteNumber(rawWarpState.stopDistance, 0),
    maxWarpSpeedMs: toFiniteNumber(rawWarpState.maxWarpSpeedMs, 0),
    cruiseWarpSpeedMs: toFiniteNumber(rawWarpState.cruiseWarpSpeedMs, 0),
    warpFloorSpeedMs: toFiniteNumber(rawWarpState.warpFloorSpeedMs, 0),
    warpDropoutSpeedMs: toFiniteNumber(
      rawWarpState.warpDropoutSpeedMs,
      toFiniteNumber(rawWarpState.warpFloorSpeedMs, WARP_DROPOUT_SPEED_MAX_MS),
    ),
    accelDistance: toFiniteNumber(rawWarpState.accelDistance, 0),
    cruiseDistance: toFiniteNumber(rawWarpState.cruiseDistance, 0),
    decelDistance: toFiniteNumber(rawWarpState.decelDistance, 0),
    accelExponent: toFiniteNumber(rawWarpState.accelExponent, WARP_ACCEL_EXPONENT),
    decelExponent: toFiniteNumber(rawWarpState.decelExponent, WARP_DECEL_EXPONENT),
    accelRate: Math.max(
      toFiniteNumber(rawWarpState.accelRate, 0) ||
        toFiniteNumber(rawWarpState.accelExponent, 0) ||
        getWarpAccelRate(resolvedWarpSpeedAU),
      0.001,
    ),
    decelRate: Math.max(
      toFiniteNumber(rawWarpState.decelRate, 0) ||
        toFiniteNumber(rawWarpState.decelExponent, 0) ||
        getWarpDecelRate(resolvedWarpSpeedAU),
      0.001,
    ),
    warpSpeed: toInt(rawWarpState.warpSpeed, Math.round(warpSpeedAU * 10)),
    commandStamp: toInt(rawWarpState.commandStamp, 0),
    startupGuidanceAtMs,
    startupGuidanceStamp: toInt(rawWarpState.startupGuidanceStamp, 0),
    startupGuidanceVelocity: cloneVector(
      rawWarpState.startupGuidanceVelocity,
      { x: 0, y: 0, z: 0 },
    ),
    cruiseBumpAtMs,
    cruiseBumpStamp: toInt(rawWarpState.cruiseBumpStamp, 0),
    effectAtMs,
    effectStamp: toInt(rawWarpState.effectStamp, 0),
    targetEntityID: toInt(rawWarpState.targetEntityID, 0),
    followID: toInt(rawWarpState.followID, 0),
    followRangeMarker: toFiniteNumber(
      rawWarpState.followRangeMarker,
      rawWarpState.stopDistance,
    ),
    profileType: String(rawWarpState.profileType || "legacy"),
    origin: cloneVector(rawWarpState.origin, position),
    rawDestination: cloneVector(rawWarpState.rawDestination, position),
    targetPoint: cloneVector(rawWarpState.targetPoint, position),
    pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(rawWarpState.pilotMaxSpeedRamp),
  };
}

function buildShipEntity(session, shipItem, systemID) {
  const movement =
    worldData.getMovementAttributesForType(shipItem.typeID) || null;
  const spaceState = shipItem.spaceState || {};
  const position = cloneVector(spaceState.position);
  const direction = normalizeVector(
    cloneVector(spaceState.direction, DEFAULT_RIGHT),
    DEFAULT_RIGHT,
  );
  const velocity = cloneVector(spaceState.velocity);
  const targetPoint = cloneVector(
    spaceState.targetPoint,
    addVectors(position, scaleVector(direction, 1.0e16)),
  );
  const maxVelocity =
    toFiniteNumber(movement && movement.maxVelocity, 0) > 0
      ? toFiniteNumber(movement.maxVelocity, 0)
      : 200;
  const warpSpeedAU =
    toFiniteNumber(movement && movement.warpSpeedMultiplier, 0) > 0
      ? toFiniteNumber(movement.warpSpeedMultiplier, 0)
      : 3;
  const alignTime =
    toFiniteNumber(movement && movement.alignTime, 0) > 0
      ? toFiniteNumber(movement.alignTime, 0)
      : 3;
  const maxAccelerationTime =
    toFiniteNumber(movement && movement.maxAccelerationTime, 0) > 0
      ? toFiniteNumber(movement.maxAccelerationTime, 0)
      : 6;
  const speedFraction = clamp(
    toFiniteNumber(spaceState.speedFraction, magnitude(velocity) > 0 ? 1 : 0),
    0,
    MAX_SUBWARP_SPEED_FRACTION,
  );
  const mode = normalizeMode(
    spaceState.mode,
    magnitude(velocity) > 0 ? "GOTO" : "STOP",
  );
  const orbitNormal = normalizeVector(
    cloneVector(spaceState.orbitNormal, buildPerpendicular(direction)),
    buildPerpendicular(direction),
  );
  const pendingWarp = buildPendingWarp(spaceState.pendingWarp, position);

  const entity = {
    kind: "ship",
    systemID,
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName || session.shipName || "Ship",
    ownerID: shipItem.ownerID || session.characterID,
    characterID: session.characterID || 0,
    corporationID: session.corporationID || 0,
    allianceID: session.allianceID || 0,
    warFactionID: session.warFactionID || 0,
    skinMaterialSetID: resolveShipSkinMaterialSetID(shipItem),
    position,
    velocity,
    direction,
    targetPoint,
    mode,
    speedFraction,
    mass:
      toFiniteNumber(movement && movement.mass, 0) > 0
        ? toFiniteNumber(movement.mass, 0)
        : 1_000_000,
    inertia:
      toFiniteNumber(movement && movement.inertia, 0) > 0
        ? toFiniteNumber(movement.inertia, 0)
        : 1,
    radius:
      toFiniteNumber(shipItem && shipItem.radius, 0) > 0
        ? toFiniteNumber(shipItem.radius, 0)
        : toFiniteNumber(movement && movement.radius, 0) > 0
          ? toFiniteNumber(movement.radius, 0)
        : 50,
    maxVelocity,
    alignTime,
    maxAccelerationTime,
    agilitySeconds: deriveAgilitySeconds(
      alignTime,
      maxAccelerationTime,
      toFiniteNumber(movement && movement.mass, 0),
      toFiniteNumber(movement && movement.inertia, 0),
    ),
    warpSpeedAU,
    targetEntityID: toInt(spaceState.targetEntityID, 0) || null,
    followRange: toFiniteNumber(spaceState.followRange, 0),
    orbitDistance: toFiniteNumber(spaceState.orbitDistance, 0),
    orbitNormal,
    orbitSign: toFiniteNumber(spaceState.orbitSign, 1) < 0 ? -1 : 1,
    bubbleID: null,
    departureBubbleID: null,
    departureBubbleVisibleUntilMs: 0,
    warpState: null,
    pendingWarp,
    dockingTargetID: null,
    pendingDock: null,
    session,
    lastPersistAt: 0,
    lastObserverCorrectionBroadcastAt: 0,
    lastObserverPositionBroadcastAt: 0,
    lastObserverPositionBroadcastStamp: -1,
    lastWarpCorrectionBroadcastAt: 0,
    lastWarpPositionBroadcastStamp: -1,
    lastPilotWarpStartupGuidanceStamp: 0,
    lastPilotWarpVelocityStamp: 0,
    lastPilotWarpEffectStamp: 0,
    lastPilotWarpCruiseBumpStamp: 0,
    lastPilotWarpMaxSpeedRampIndex: -1,
    lastWarpDiagnosticStamp: 0,
    lastMovementDebugAt: 0,
    lastMotionDebug: null,
    movementTrace: null,
  };

  if (mode === "WARP") {
    entity.warpState =
      buildWarpState(spaceState.warpState, position, warpSpeedAU) ||
      buildPreparingWarpState(entity, pendingWarp);
  }

  return entity;
}

function persistShipEntity(entity) {
  const result = updateShipItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: entity.systemID,
    flagID: 0,
    spaceState: serializeSpaceState(entity),
  }));

  if (!result.success) {
    log.warn(
      `[SpaceRuntime] Failed to persist ship ${entity.itemID}: ${result.errorMsg}`,
    );
  }

  entity.lastPersistAt = Date.now();
}

function clearTrackingState(entity) {
  entity.targetEntityID = null;
  entity.followRange = 0;
  entity.orbitDistance = 0;
  entity.warpState = null;
  entity.pendingWarp = null;
  entity.dockingTargetID = null;
  entity.lastPilotWarpStartupGuidanceStamp = 0;
  entity.lastPilotWarpVelocityStamp = 0;
  entity.lastPilotWarpEffectStamp = 0;
  entity.lastPilotWarpCruiseBumpStamp = 0;
  entity.lastPilotWarpMaxSpeedRampIndex = -1;
  entity.lastWarpDiagnosticStamp = 0;
}

function resetEntityMotion(entity) {
  clearTrackingState(entity);
  entity.mode = "STOP";
  entity.speedFraction = 0;
  entity.velocity = { x: 0, y: 0, z: 0 };
  entity.targetPoint = cloneVector(entity.position);
}

function buildUndockMovement(entity, direction, speedFraction = 1) {
  clearTrackingState(entity);
  entity.direction = normalizeVector(direction, entity.direction);
  entity.targetPoint = addVectors(
    cloneVector(entity.position),
    scaleVector(entity.direction, 1.0e16),
  );
  entity.speedFraction = clamp(speedFraction, 0, MAX_SUBWARP_SPEED_FRACTION);
  entity.mode = "GOTO";
  entity.velocity = { x: 0, y: 0, z: 0 };
}

function rotateDirectionToward(
  currentDirection,
  targetDirection,
  deltaSeconds,
  agilitySeconds,
  currentSpeedFraction = 0,
) {
  const current = normalizeVector(currentDirection, targetDirection);
  const target = normalizeVector(targetDirection, current);
  const turnMetrics = getTurnMetrics(current, target);
  const degrees = (turnMetrics.radians * 180) / Math.PI;

  if (!Number.isFinite(turnMetrics.radians) || turnMetrics.radians <= TURN_ALIGNMENT_RADIANS) {
    return {
      direction: target,
      degrees,
      turnFraction: turnMetrics.turnFraction,
      turnPercent: 1,
      degPerTick: 0,
      maxStepDegrees: 0,
      turnSeconds: 0,
      snapped: true,
    };
  }

  // Destiny turns much faster than it changes speed, and from near-rest the
  // client effectively snaps to the requested heading before accelerating.
  if (currentSpeedFraction <= 0.1) {
    return {
      direction: target,
      degrees,
      turnFraction: turnMetrics.turnFraction,
      turnPercent: 1,
      degPerTick: 0,
      maxStepDegrees: 0,
      turnSeconds: 0,
      snapped: true,
    };
  }

  // Match the classic destiny turn shape more closely than a slow exponential
  // blend: heading changes in noticeable per-tick steps and large turns begin
  // by shedding speed while the nose swings through the arc.
  const degPerTick = deriveTurnDegreesPerTick(agilitySeconds);
  const tickScale = Math.max(deltaSeconds / 0.1, 0.05);
  const maxStepDegrees = degPerTick * tickScale;
  const turnPercent = clamp(maxStepDegrees / Math.max(degrees, 0.001), 0.001, 1);
  const turnSeconds = Math.max(agilitySeconds / 2.2, 0.05);
  return {
    direction: slerpDirection(current, target, turnPercent, turnMetrics.radians),
    degrees,
    turnFraction: turnMetrics.turnFraction,
    turnPercent,
    degPerTick,
    maxStepDegrees,
    turnSeconds,
    snapped: false,
  };
}

function deriveTurnSpeedCap(turnMetrics) {
  const baseCap = clamp(toFiniteNumber(turnMetrics && turnMetrics.turnFraction, 1), 0.1, 1);
  const radians = Math.max(0, toFiniteNumber(turnMetrics && turnMetrics.radians, 0));

  if (radians >= (2 * Math.PI) / 3) {
    return Math.max(0.12, baseCap ** 3);
  }
  if (radians >= Math.PI / 4) {
    return Math.max(0.15, baseCap ** 2);
  }

  return baseCap;
}

function applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds) {
  const previousPosition = cloneVector(entity.position);
  const previousVelocity = cloneVector(entity.velocity);
  const headingSource = normalizeVector(entity.direction, desiredDirection);
  const targetDirection = normalizeVector(desiredDirection, headingSource);
  const agilitySeconds = Math.max(
    toFiniteNumber(entity.agilitySeconds, 0) ||
      deriveAgilitySeconds(
        entity.alignTime,
        entity.maxAccelerationTime,
        entity.mass,
        entity.inertia,
      ),
    0.05,
  );
  const currentSpeedFraction =
    entity.maxVelocity > 0
      ? Math.max(0, magnitude(entity.velocity) / entity.maxVelocity)
      : 0;
  const targetSpeedFraction =
    entity.maxVelocity > 0
      ? Math.max(0, desiredSpeed / entity.maxVelocity)
      : 0;
  const currentAlignmentDirection = getCurrentAlignmentDirection(
    entity,
    targetDirection,
  );
  const turnMetrics = getTurnMetrics(currentAlignmentDirection, targetDirection);
  const desiredVelocity = scaleVector(targetDirection, Math.max(0, desiredSpeed));
  const integration = integrateVelocityTowardTarget(
    previousVelocity,
    desiredVelocity,
    agilitySeconds,
    deltaSeconds,
  );
  const nextSpeed = magnitude(integration.nextVelocity);
  const nextSpeedFraction =
    entity.maxVelocity > 0 ? Math.max(0, nextSpeed / entity.maxVelocity) : 0;

  const turnStep = rotateDirectionToward(
    headingSource,
    targetDirection,
    deltaSeconds,
    agilitySeconds,
    currentSpeedFraction,
  );
  entity.direction =
    nextSpeed > 0.05
      ? normalizeVector(integration.nextVelocity, turnStep.direction)
      : turnStep.direction;
  entity.velocity =
    nextSpeed <= 0.05
      ? { x: 0, y: 0, z: 0 }
      : integration.nextVelocity;
  if (desiredSpeed <= 0.001 && magnitude(entity.velocity) < 0.1) {
    entity.velocity = { x: 0, y: 0, z: 0 };
  }

  entity.position = addVectors(entity.position, integration.positionDelta);
  const positionDelta = subtractVectors(entity.position, previousPosition);
  const velocityDelta = subtractVectors(entity.velocity, previousVelocity);
  const appliedTurnMetrics = getTurnMetrics(currentAlignmentDirection, entity.direction);
  entity.lastTurnMetrics = {
    degrees: roundNumber(turnStep.degrees, 2),
    appliedDegrees: roundNumber((appliedTurnMetrics.radians * 180) / Math.PI, 2),
    turnFraction: roundNumber(turnMetrics.turnFraction, 3),
    currentSpeedFraction: roundNumber(currentSpeedFraction, 3),
    targetSpeedFraction: roundNumber(targetSpeedFraction, 3),
    effectiveTargetSpeedFraction: roundNumber(targetSpeedFraction, 3),
    turnSpeedCap: roundNumber(targetSpeedFraction, 3),
    speedDeltaFraction: roundNumber(
      Math.abs(currentSpeedFraction - targetSpeedFraction),
      3,
    ),
    speedResponseSeconds: roundNumber(agilitySeconds, 3),
    agilitySeconds: roundNumber(agilitySeconds, 3),
    exponentialDecay: roundNumber(integration.decay, 6),
    degPerTick: roundNumber(turnStep.degPerTick, 3),
    maxStepDegrees: roundNumber(turnStep.maxStepDegrees, 3),
    turnPercent: roundNumber(turnStep.turnPercent, 3),
    turnSeconds: roundNumber(turnStep.turnSeconds, 3),
    snapped: Boolean(turnStep.snapped),
  };
  entity.lastMotionDebug = {
    deltaSeconds: roundNumber(deltaSeconds, 4),
    previousPosition: summarizeVector(previousPosition),
    positionDelta: summarizeVector(positionDelta),
    previousVelocity: summarizeVector(previousVelocity),
    velocityDelta: summarizeVector(velocityDelta),
    headingSource: summarizeVector(currentAlignmentDirection),
    desiredDirection: summarizeVector(targetDirection),
    currentSpeed: roundNumber(magnitude(previousVelocity), 3),
    desiredSpeed: roundNumber(desiredSpeed, 3),
    nextSpeed: roundNumber(magnitude(entity.velocity), 3),
    turnAngleDegrees: roundNumber((turnMetrics.radians * 180) / Math.PI, 2),
    remainingTurnDegrees: roundNumber(turnStep.degrees, 2),
  };

  return {
    changed:
      distance(previousPosition, entity.position) > 1 ||
      distance(previousVelocity, entity.velocity) > 0.5,
  };
}

function advanceGotoMovement(entity, deltaSeconds) {
  const desiredDirection = getCommandDirection(entity, entity.direction);
  const desiredSpeed =
    entity.maxVelocity * clamp(entity.speedFraction, 0, MAX_SUBWARP_SPEED_FRACTION);
  return applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds);
}

function advanceFollowMovement(entity, target, deltaSeconds) {
  if (!target) {
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    entity.dockingTargetID = null;
    return { changed: true };
  }

  const motionProfile = getFollowMotionProfile(entity, target);
  const targetPoint = motionProfile.targetPoint;
  const separation = subtractVectors(targetPoint, entity.position);
  const currentDistance = magnitude(separation);
  const desiredRange = Math.max(
    0,
    toFiniteNumber(entity.followRange, 0) +
      entity.radius +
      motionProfile.rangeRadius,
  );
  const gap = currentDistance - desiredRange;
  const targetSpeed = magnitude(target.velocity || { x: 0, y: 0, z: 0 });
  const desiredDirection =
    gap > 50
      ? normalizeVector(separation, entity.direction)
      : normalizeVector(target.velocity, normalizeVector(separation, entity.direction));
  const desiredSpeed =
    gap > 50
      ? Math.min(
          entity.maxVelocity,
          Math.max(targetSpeed, Math.max(gap * 0.5, entity.maxVelocity * 0.25)),
        )
      : Math.min(entity.maxVelocity, targetSpeed);

  entity.targetPoint = targetPoint;
  const movementResult = applyDesiredVelocity(
    entity,
    desiredDirection,
    desiredSpeed,
    deltaSeconds,
  );

  return movementResult;
}

function advanceOrbitMovement(entity, target, deltaSeconds) {
  if (!target) {
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    return { changed: true };
  }

  const radialVector = subtractVectors(entity.position, target.position);
  const radialDirection = normalizeVector(radialVector, buildPerpendicular(entity.direction));
  let orbitNormal = normalizeVector(entity.orbitNormal, buildPerpendicular(radialDirection));
  if (Math.abs(dotProduct(orbitNormal, radialDirection)) > 0.95) {
    orbitNormal = buildPerpendicular(radialDirection);
  }

  const tangentDirection = normalizeVector(
    scaleVector(crossProduct(orbitNormal, radialDirection), entity.orbitSign || 1),
    entity.direction,
  );
  const currentDistance = magnitude(radialVector);
  const desiredDistance = Math.max(
    toFiniteNumber(entity.orbitDistance, 0) + entity.radius + (target.radius || 0),
    entity.radius + (target.radius || 0) + 500,
  );
  const radialError = currentDistance - desiredDistance;
  const correction = scaleVector(
    radialDirection,
    clamp(-radialError / Math.max(desiredDistance, 1), -0.75, 0.75),
  );
  const desiredDirection = normalizeVector(
    addVectors(tangentDirection, correction),
    tangentDirection,
  );
  const desiredSpeed = clamp(
    Math.max(entity.maxVelocity * 0.35, Math.abs(radialError) * 0.5),
    0,
    entity.maxVelocity,
  );

  entity.orbitNormal = orbitNormal;
  entity.targetPoint = addVectors(
    target.position,
    scaleVector(radialDirection, desiredDistance),
  );
  return applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds);
}

function buildWarpProfile(entity, destination, options = {}) {
  const rawDestination = cloneVector(destination, entity.position);
  const stopDistance = Math.max(0, toFiniteNumber(options.stopDistance, 0));
  const travelVector = subtractVectors(rawDestination, entity.position);
  const direction = normalizeVector(travelVector, entity.direction);
  const targetPoint = subtractVectors(rawDestination, scaleVector(direction, stopDistance));
  const totalDistance = distance(entity.position, targetPoint);
  if (totalDistance < MIN_WARP_DISTANCE_METERS) {
    return null;
  }

  const warpSpeedAU =
    toFiniteNumber(options.warpSpeedAU, 0) > 0
      ? toFiniteNumber(options.warpSpeedAU, 0)
      : entity.warpSpeedAU;
  const cruiseWarpSpeedMs = Math.max(warpSpeedAU * ONE_AU_IN_METERS, 10000);
  const accelRate = getWarpAccelRate(warpSpeedAU);
  const decelRate = getWarpDecelRate(warpSpeedAU);
  const warpDropoutSpeedMs = getWarpDropoutSpeedMs(entity);

  let profileType = "long";
  let accelDistance = 0;
  let cruiseDistance = 0;
  let decelDistance = 0;
  let accelTimeMs = 0;
  let cruiseTimeMs = 0;
  let decelTimeMs = 0;
  let maxWarpSpeedMs = cruiseWarpSpeedMs;
  const accelDistanceAtCruise = Math.max(cruiseWarpSpeedMs / accelRate, 0);
  const decelDistanceAtCruise = Math.max(cruiseWarpSpeedMs / decelRate, 0);
  const shortWarpDistanceThreshold = accelDistanceAtCruise + decelDistanceAtCruise;

  if (totalDistance < shortWarpDistanceThreshold) {
    profileType = "short";
    maxWarpSpeedMs =
      (totalDistance * accelRate * decelRate) /
      Math.max(accelRate + decelRate, 0.001);
    accelDistance = Math.max(maxWarpSpeedMs / accelRate, 0);
    decelDistance = Math.max(maxWarpSpeedMs / decelRate, 0);
    accelTimeMs =
      (Math.log(Math.max(maxWarpSpeedMs / accelRate, 1)) /
        accelRate) *
      1000;
    decelTimeMs =
      (Math.log(Math.max(maxWarpSpeedMs / warpDropoutSpeedMs, 1)) /
        decelRate) *
      1000;
  } else {
    accelDistance = accelDistanceAtCruise;
    decelDistance = decelDistanceAtCruise;
    accelTimeMs =
      (Math.log(Math.max(cruiseWarpSpeedMs / accelRate, 1)) /
        accelRate) *
      1000;
    decelTimeMs =
      (Math.log(Math.max(cruiseWarpSpeedMs / warpDropoutSpeedMs, 1)) /
        decelRate) *
      1000;
    cruiseDistance = Math.max(
      totalDistance - accelDistance - decelDistance,
      0,
    );
    cruiseTimeMs = (cruiseDistance / cruiseWarpSpeedMs) * 1000;
  }

  return {
    startTimeMs: Date.now(),
    durationMs: accelTimeMs + cruiseTimeMs + decelTimeMs,
    accelTimeMs,
    cruiseTimeMs,
    decelTimeMs,
    totalDistance,
    stopDistance,
    maxWarpSpeedMs,
    cruiseWarpSpeedMs,
    warpFloorSpeedMs: warpDropoutSpeedMs,
    warpDropoutSpeedMs,
    accelDistance,
    cruiseDistance,
    decelDistance,
    accelExponent: accelRate,
    decelExponent: decelRate,
    accelRate,
    decelRate,
    warpSpeed: Math.max(1, Math.round(warpSpeedAU * 10)),
    commandStamp: toInt(options.commandStamp, 0),
    startupGuidanceStamp: toInt(options.startupGuidanceStamp, 0),
    startupGuidanceVelocity: cloneVector(
      options.startupGuidanceVelocity,
      entity.velocity,
    ),
    cruiseBumpStamp: toInt(options.cruiseBumpStamp, 0),
    effectStamp: toInt(options.effectStamp, getNextStamp()),
    targetEntityID: toInt(options.targetEntityID, 0),
    // The live client expects opaque warp markers here, not echoed target ids
    // or stop distances.
    followID: toFiniteNumber(options.followID, 15000),
    followRangeMarker: toFiniteNumber(options.followRangeMarker, -1),
    profileType,
    origin: cloneVector(entity.position),
    rawDestination,
    targetPoint,
    pilotMaxSpeedRamp: clonePilotWarpMaxSpeedRamp(options.pilotMaxSpeedRamp),
  };
}

function buildPendingWarp(rawPendingWarp, position = { x: 0, y: 0, z: 0 }) {
  if (!rawPendingWarp || typeof rawPendingWarp !== "object") {
    return null;
  }

  return {
    requestedAtMs: toInt(rawPendingWarp.requestedAtMs, 0),
    preWarpSyncStamp: toInt(rawPendingWarp.preWarpSyncStamp, 0),
    stopDistance: Math.max(0, toFiniteNumber(rawPendingWarp.stopDistance, 0)),
    totalDistance: Math.max(0, toFiniteNumber(rawPendingWarp.totalDistance, 0)),
    warpSpeedAU: Math.max(0, toFiniteNumber(rawPendingWarp.warpSpeedAU, 0)),
    rawDestination: cloneVector(rawPendingWarp.rawDestination, position),
    targetPoint: cloneVector(rawPendingWarp.targetPoint, position),
    targetEntityID: toInt(rawPendingWarp.targetEntityID, 0) || null,
  };
}

function buildPendingWarpRequest(entity, destination, options = {}) {
  const rawDestination = cloneVector(destination, entity.position);
  const stopDistance = Math.max(0, toFiniteNumber(options.stopDistance, 0));
  const travelVector = subtractVectors(rawDestination, entity.position);
  const direction = normalizeVector(travelVector, entity.direction);
  const targetPoint = subtractVectors(
    rawDestination,
    scaleVector(direction, stopDistance),
  );
  const totalDistance = distance(entity.position, targetPoint);
  if (totalDistance < MIN_WARP_DISTANCE_METERS) {
    return null;
  }

  const warpSpeedAU =
    toFiniteNumber(options.warpSpeedAU, 0) > 0
      ? toFiniteNumber(options.warpSpeedAU, 0)
      : entity.warpSpeedAU;

  return {
    requestedAtMs: Date.now(),
    preWarpSyncStamp: 0,
    stopDistance,
    totalDistance,
    warpSpeedAU,
    rawDestination,
    targetPoint,
    targetEntityID: toInt(options.targetEntityID, 0) || null,
  };
}

function buildDirectedMovementUpdates(
  entity,
  commandDirection,
  speedFractionChanged,
  movementStamp,
) {
  const updates = [
    {
      stamp: movementStamp,
      payload: destiny.buildGotoDirectionPayload(entity.itemID, commandDirection),
    },
  ];
  if (speedFractionChanged) {
    updates.push({
      stamp: updates[0].stamp,
      payload: destiny.buildSetSpeedFractionPayload(
        entity.itemID,
        entity.speedFraction,
      ),
    });
  }
  return updates;
}

function buildPreparingWarpState(entity, pendingWarp) {
  const warpState = buildWarpProfile(entity, pendingWarp && pendingWarp.rawDestination, {
    stopDistance: pendingWarp && pendingWarp.stopDistance,
    targetEntityID: pendingWarp && pendingWarp.targetEntityID,
    warpSpeedAU: pendingWarp && pendingWarp.warpSpeedAU,
    commandStamp: 0,
    startupGuidanceStamp: 0,
    startupGuidanceVelocity: entity && entity.velocity,
    cruiseBumpStamp: 0,
    effectStamp: -1,
  });
  if (!warpState) {
    return null;
  }

  warpState.commandStamp = 0;
  warpState.startupGuidanceAtMs = 0;
  warpState.startupGuidanceStamp = 0;
  warpState.startupGuidanceVelocity = cloneVector(
    entity && entity.velocity,
    { x: 0, y: 0, z: 0 },
  );
  warpState.cruiseBumpAtMs = 0;
  warpState.cruiseBumpStamp = 0;
  warpState.effectAtMs = 0;
  warpState.effectStamp = -1;
  warpState.pilotMaxSpeedRamp = [];
  return warpState;
}

function refreshPreparingWarpState(entity) {
  if (!entity || !entity.pendingWarp) {
    return null;
  }

  const refreshed = buildPreparingWarpState(entity, entity.pendingWarp);
  if (refreshed) {
    entity.warpState = refreshed;
  }
  return refreshed;
}

function evaluatePendingWarp(entity, pendingWarp, now = Date.now()) {
  const desiredDirection = normalizeVector(
    subtractVectors(pendingWarp.targetPoint, entity.position),
    entity.direction,
  );
  const alignmentDirection = getCurrentAlignmentDirection(
    entity,
    desiredDirection,
  );
  const turnMetrics = getTurnMetrics(alignmentDirection, desiredDirection);
  const degrees = (turnMetrics.radians * 180) / Math.PI;
  const actualSpeedFraction = getActualSpeedFraction(entity);
  const alignTimeMs = Math.max(
    1000,
    toFiniteNumber(entity.alignTime, 0) * 1000,
  );
  const elapsedMs = Math.max(
    0,
    toInt(now, Date.now()) - toInt(pendingWarp.requestedAtMs, 0),
  );
  const forced = elapsedMs >= (alignTimeMs + 300);
  return {
    ready:
      (Number.isFinite(degrees) &&
        degrees <= (WARP_ALIGNMENT_RADIANS * 180) / Math.PI &&
        actualSpeedFraction >= WARP_ENTRY_SPEED_FRACTION) ||
      forced,
    forced,
    degrees: roundNumber(degrees, 3),
    actualSpeedFraction: roundNumber(actualSpeedFraction, 3),
    elapsedMs,
    desiredDirection,
    alignmentDirection,
  };
}

function getPilotWarpActivationVelocity(entity, warpState) {
  if (!warpState) {
    return { x: 0, y: 0, z: 0 };
  }

  const direction = normalizeVector(
    subtractVectors(warpState.targetPoint, entity.position),
    entity.direction,
  );
  const startupGuidanceVelocity = cloneVector(
    warpState && warpState.startupGuidanceVelocity,
    entity && entity.velocity,
  );
  const activationSpeed = magnitude(startupGuidanceVelocity);
  if (activationSpeed <= 0.5) {
    return { x: 0, y: 0, z: 0 };
  }
  return scaleVector(direction, activationSpeed);
}

function activatePendingWarp(entity, pendingWarp) {
  const startupGuidanceVelocity = cloneVector(entity.velocity);
  const warpState = buildWarpProfile(entity, pendingWarp.rawDestination, {
    stopDistance: pendingWarp.stopDistance,
    targetEntityID: pendingWarp.targetEntityID,
    warpSpeedAU: pendingWarp.warpSpeedAU,
    commandStamp: 0,
    startupGuidanceStamp: 0,
    startupGuidanceVelocity,
    cruiseBumpStamp: 0,
    effectStamp: 0,
  });
  if (!warpState) {
    return null;
  }

  entity.mode = "WARP";
  entity.speedFraction = 1;
  entity.direction = normalizeVector(
    subtractVectors(warpState.targetPoint, entity.position),
    entity.direction,
  );
  entity.targetPoint = cloneVector(warpState.targetPoint);
  entity.targetEntityID = warpState.targetEntityID || null;
  entity.warpState = warpState;
  entity.pendingWarp = null;
  entity.velocity = getPilotWarpActivationVelocity(entity, warpState);
  entity.lastWarpCorrectionBroadcastAt = 0;
  entity.lastWarpPositionBroadcastStamp = -1;
  entity.lastPilotWarpStartupGuidanceStamp = 0;
  entity.lastPilotWarpVelocityStamp = 0;
  entity.lastPilotWarpEffectStamp = 0;
  entity.lastPilotWarpCruiseBumpStamp = 0;
  entity.lastPilotWarpMaxSpeedRampIndex = -1;
  entity.lastWarpDiagnosticStamp = 0;
  return warpState;
}

function getWarpProgress(warpState, now) {
  const elapsedMs = Math.max(0, toFiniteNumber(now, Date.now()) - warpState.startTimeMs);
  const accelMs = warpState.accelTimeMs;
  const cruiseMs = warpState.cruiseTimeMs;
  const decelMs = warpState.decelTimeMs;
  const resolvedWarpSpeedAU = Math.max(
    toFiniteNumber(warpState.warpSpeed, 0) / 10,
    toFiniteNumber(warpState.cruiseWarpSpeedMs, 0) / ONE_AU_IN_METERS,
    0.001,
  );
  const accelRate = Math.max(
    toFiniteNumber(warpState.accelRate, 0) ||
      toFiniteNumber(warpState.accelExponent, 0) ||
      getWarpAccelRate(resolvedWarpSpeedAU),
    0.001,
  );
  const decelRate = Math.max(
    toFiniteNumber(warpState.decelRate, 0) ||
      toFiniteNumber(warpState.decelExponent, 0) ||
      getWarpDecelRate(resolvedWarpSpeedAU),
    0.001,
  );
  const maxWarpSpeedMs = Math.max(toFiniteNumber(warpState.maxWarpSpeedMs, 0), 0);
  const warpDropoutSpeedMs = Math.max(
    Math.min(
      toFiniteNumber(
        warpState.warpDropoutSpeedMs,
        toFiniteNumber(warpState.warpFloorSpeedMs, WARP_DROPOUT_SPEED_MAX_MS),
      ),
      maxWarpSpeedMs || 1,
    ),
    1,
  );
  const accelDistance = Math.max(toFiniteNumber(warpState.accelDistance, 0), 0);
  const cruiseDistance = Math.max(toFiniteNumber(warpState.cruiseDistance, 0), 0);
  const decelDistance = Math.max(toFiniteNumber(warpState.decelDistance, 0), 0);
  const cruiseWarpSpeedMs = Math.max(
    toFiniteNumber(warpState.cruiseWarpSpeedMs, maxWarpSpeedMs),
    0,
  );
  const decelSeconds = Math.max(decelMs / 1000, 0);
  const decelStartMs = accelMs + cruiseMs;

  if (elapsedMs >= warpState.durationMs) {
    return { complete: true, traveled: warpState.totalDistance, speed: 0 };
  }

  if (elapsedMs < accelMs) {
    const seconds = elapsedMs / 1000;
    const speed = Math.min(
      maxWarpSpeedMs,
      accelRate * Math.exp(accelRate * seconds),
    );
    return {
      complete: false,
      traveled: Math.min(
        accelDistance,
        Math.max(speed / accelRate, 0),
      ),
      speed,
    };
  }

  if (elapsedMs < accelMs + cruiseMs) {
    const seconds = (elapsedMs - accelMs) / 1000;
    return {
      complete: false,
      traveled: accelDistance + (cruiseWarpSpeedMs * seconds),
      speed: cruiseWarpSpeedMs,
    };
  }

  const seconds = Math.min(
    (elapsedMs - decelStartMs) / 1000,
    decelSeconds,
  );
  const speed = Math.max(
    warpDropoutSpeedMs,
    maxWarpSpeedMs * Math.exp(-decelRate * seconds),
  );
  const progress = {
    complete: false,
    traveled:
      accelDistance +
      cruiseDistance +
      Math.min(
        decelDistance,
        Math.max((maxWarpSpeedMs - speed) / decelRate, 0),
      ),
    speed,
  };
  const remainingDistance = Math.max(
    toFiniteNumber(warpState.totalDistance, 0) - progress.traveled,
    0,
  );
  if (remainingDistance <= getWarpCompletionDistance(warpState)) {
    return {
      complete: true,
      traveled: warpState.totalDistance,
      speed: 0,
    };
  }
  return progress;
}

function getWarpStopDistanceForTarget(shipEntity, targetEntity, minimumRange = 0) {
  const targetRadius = Math.max(0, toFiniteNumber(targetEntity && targetEntity.radius, 0));
  const desiredRange = Math.max(0, toFiniteNumber(minimumRange, 0));

  switch (targetEntity && targetEntity.kind) {
    case "planet":
    case "moon":
      return Math.max(targetRadius + 1000000, desiredRange) + (shipEntity.radius * 2);
    case "sun":
      return Math.max(targetRadius + 5000000, desiredRange) + (shipEntity.radius * 2);
    case "station":
      return targetRadius + desiredRange + (shipEntity.radius * 2);
    case "stargate":
      return Math.max(Math.max(2500, targetRadius * 0.3), desiredRange) + (shipEntity.radius * 2);
    default:
      return Math.max(Math.max(1000, targetRadius), desiredRange) + (shipEntity.radius * 2);
  }
}

function advanceMovement(entity, scene, deltaSeconds, now) {
  switch (entity.mode) {
    case "STOP":
      return applyDesiredVelocity(entity, entity.direction, 0, deltaSeconds);
    case "GOTO":
      return advanceGotoMovement(entity, deltaSeconds);
    case "FOLLOW":
      return advanceFollowMovement(
        entity,
        scene.getEntityByID(entity.targetEntityID),
        deltaSeconds,
      );
    case "ORBIT":
      return advanceOrbitMovement(
        entity,
        scene.getEntityByID(entity.targetEntityID),
        deltaSeconds,
      );
    case "WARP": {
      if (entity.pendingWarp) {
        const result = advanceGotoMovement(entity, deltaSeconds);
        refreshPreparingWarpState(entity);
        return result;
      }
      if (!entity.warpState) {
        entity.mode = "STOP";
        entity.speedFraction = 0;
        entity.velocity = { x: 0, y: 0, z: 0 };
        entity.targetPoint = cloneVector(entity.position);
        return { changed: false };
      }

      const previousPosition = cloneVector(entity.position);
      const previousVelocity = cloneVector(entity.velocity);
      const progress = getWarpProgress(entity.warpState, now);
      const direction = normalizeVector(
        subtractVectors(entity.warpState.targetPoint, entity.warpState.origin),
        entity.direction,
      );
      entity.direction = direction;
      entity.position = progress.complete
        ? cloneVector(entity.warpState.targetPoint)
        : addVectors(
            entity.warpState.origin,
            scaleVector(direction, progress.traveled),
          );
      entity.velocity = progress.complete
        ? { x: 0, y: 0, z: 0 }
        : scaleVector(direction, progress.speed);

      if (progress.complete) {
        const completedWarpState = serializeWarpState({
          warpState: entity.warpState,
          position: entity.position,
        });
        entity.mode = "STOP";
        entity.speedFraction = 0;
        entity.targetPoint = cloneVector(entity.position);
        entity.warpState = null;
        return {
          changed:
            distance(previousPosition, entity.position) > 1 ||
            distance(previousVelocity, entity.velocity) > 0.5,
          warpCompleted: true,
          completedWarpState,
        };
      }

      return {
        changed:
          distance(previousPosition, entity.position) > 1 ||
          distance(previousVelocity, entity.velocity) > 0.5,
      };
    }
    default:
      return { changed: false };
  }
}

class SolarSystemScene {
  constructor(systemID) {
    this.systemID = Number(systemID);
    this.system = worldData.getSolarSystemByID(this.systemID);
    this.sessions = new Map();
    this.dynamicEntities = new Map();
    this.bubbles = new Map();
    this.nextBubbleID = 1;
    this.lastTickAt = Date.now();
    this.staticEntities = [];
    this.staticEntitiesByID = new Map();

    for (const station of worldData.getStationsForSystem(this.systemID)) {
      const entity = buildStaticStationEntity(station);
      this.staticEntities.push(entity);
      this.staticEntitiesByID.set(entity.itemID, entity);
    }
    for (const celestial of worldData.getCelestialsForSystem(this.systemID)) {
      const entity = buildStaticCelestialEntity(celestial);
      this.staticEntities.push(entity);
      this.staticEntitiesByID.set(entity.itemID, entity);
    }
    if (INCLUDE_STARGATES_IN_SCENE) {
      for (const stargate of worldData.getStargatesForSystem(this.systemID)) {
        const entity = buildStaticStargateEntity(stargate);
        this.staticEntities.push(entity);
        this.staticEntitiesByID.set(entity.itemID, entity);
      }
    }
  }

  getAllVisibleEntities() {
    return [...this.staticEntities, ...this.dynamicEntities.values()];
  }

  createBubble(center) {
    const bubble = {
      id: this.nextBubbleID,
      center: cloneVector(center),
      entityIDs: new Set(),
    };
    this.nextBubbleID += 1;
    this.bubbles.set(bubble.id, bubble);
    logBubbleDebug("bubble.created", {
      systemID: this.systemID,
      bubble: summarizeBubbleState(bubble),
      radiusMeters: BUBBLE_RADIUS_METERS,
      hysteresisMeters: BUBBLE_HYSTERESIS_METERS,
    });
    return bubble;
  }

  getBubbleByID(bubbleID) {
    const numericBubbleID = toInt(bubbleID, 0);
    if (!numericBubbleID) {
      return null;
    }
    return this.bubbles.get(numericBubbleID) || null;
  }

  removeBubbleIfEmpty(bubbleID) {
    const bubble = this.getBubbleByID(bubbleID);
    if (!bubble || bubble.entityIDs.size > 0) {
      return;
    }
    logBubbleDebug("bubble.removed", {
      systemID: this.systemID,
      bubble: summarizeBubbleState(bubble),
    });
    this.bubbles.delete(bubble.id);
  }

  buildBubbleCenterForEntity(entity, position = entity && entity.position) {
    const numericPosition = cloneVector(position, { x: 0, y: 0, z: 0 });
    const motionDirection = normalizeVector(
      magnitude(entity && entity.velocity) > 1 ? entity.velocity : entity && entity.direction,
      DEFAULT_RIGHT,
    );
    return addVectors(
      numericPosition,
      scaleVector(motionDirection, BUBBLE_RADIUS_METERS / 2),
    );
  }

  findBestBubbleForPosition(position, radiusSquared = BUBBLE_RADIUS_SQUARED) {
    let bestBubble = null;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const bubble of this.bubbles.values()) {
      const currentDistanceSquared = distanceSquared(position, bubble.center);
      if (
        currentDistanceSquared <= radiusSquared &&
        currentDistanceSquared < bestDistanceSquared
      ) {
        bestBubble = bubble;
        bestDistanceSquared = currentDistanceSquared;
      }
    }
    return bestBubble;
  }

  selectBubbleForEntity(entity, position = entity && entity.position) {
    if (!entity) {
      return null;
    }
    const numericPosition = cloneVector(position, entity.position);
    const currentBubble = this.getBubbleByID(entity.bubbleID);
    if (
      currentBubble &&
      distanceSquared(numericPosition, currentBubble.center) <=
        BUBBLE_RETENTION_RADIUS_SQUARED
    ) {
      return currentBubble;
    }
    const existingBubble = this.findBestBubbleForPosition(
      numericPosition,
      BUBBLE_RADIUS_SQUARED,
    );
    if (existingBubble) {
      return existingBubble;
    }
    return this.createBubble(this.buildBubbleCenterForEntity(entity, numericPosition));
  }

  moveEntityToBubble(entity, bubble) {
    if (!entity || !bubble) {
      return null;
    }
    const previousBubbleID = toInt(entity.bubbleID, 0);
    if (previousBubbleID && previousBubbleID === bubble.id) {
      bubble.entityIDs.add(entity.itemID);
      return bubble;
    }
    if (previousBubbleID) {
      const previousBubble = this.getBubbleByID(previousBubbleID);
      if (previousBubble) {
        previousBubble.entityIDs.delete(entity.itemID);
      }
      this.removeBubbleIfEmpty(previousBubbleID);
    }
    bubble.entityIDs.add(entity.itemID);
    entity.bubbleID = bubble.id;
    logBubbleDebug("bubble.entity_entered", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      previousBubbleID,
      bubble: summarizeBubbleState(bubble),
    });
    return bubble;
  }

  removeEntityFromBubble(entity) {
    if (!entity) {
      return 0;
    }
    const previousBubbleID = toInt(entity.bubbleID, 0);
    if (!previousBubbleID) {
      entity.bubbleID = null;
      return 0;
    }
    const previousBubble = this.getBubbleByID(previousBubbleID);
    if (previousBubble) {
      previousBubble.entityIDs.delete(entity.itemID);
    }
    entity.bubbleID = null;
    logBubbleDebug("bubble.entity_removed", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      previousBubbleID,
      bubble: summarizeBubbleState(previousBubble),
    });
    this.removeBubbleIfEmpty(previousBubbleID);
    return previousBubbleID;
  }

  reconcileEntityBubble(entity) {
    if (!entity || entity.mode === "WARP") {
      return null;
    }
    const bubble = this.selectBubbleForEntity(entity);
    this.moveEntityToBubble(entity, bubble);
    if (entity.departureBubbleID) {
      entity.departureBubbleID = null;
      entity.departureBubbleVisibleUntilMs = 0;
    }
    return bubble;
  }

  reconcileAllDynamicEntityBubbles() {
    for (const entity of this.dynamicEntities.values()) {
      if (entity.mode === "WARP") {
        continue;
      }
      this.reconcileEntityBubble(entity);
    }
  }

  beginWarpDepartureOwnership(entity, now = Date.now()) {
    if (!entity) {
      return;
    }
    entity.departureBubbleID = this.removeEntityFromBubble(entity);
    entity.departureBubbleVisibleUntilMs =
      toFiniteNumber(now, Date.now()) + OBSERVER_WARP_DEPARTURE_VISIBLE_MS;
    logBubbleDebug("bubble.warp_departure_ownership_started", {
      systemID: this.systemID,
      entity: summarizeBubbleEntity(entity),
      departureBubbleVisibleUntilMs: toFiniteNumber(
        entity.departureBubbleVisibleUntilMs,
        0,
      ),
    });
  }

  canSessionSeeWarpingDynamicEntity(session, entity, now = Date.now()) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (entity.itemID === session._space.shipID) {
      return true;
    }
    if (entity.mode !== "WARP" || !entity.warpState) {
      return false;
    }
    const currentIDs =
      session._space.visibleDynamicEntityIDs instanceof Set
        ? session._space.visibleDynamicEntityIDs
        : new Set();
    if (!currentIDs.has(entity.itemID)) {
      // Do not acquire new visibility for ships that are already mid-warp.
      // Late AddBalls2 plus a fresh WarpTo from the origin creates the
      // observed "appears absurdly far away, then lands again" observer bug.
      return false;
    }
    const egoEntity = this.getShipEntityForSession(session);
    const departureBubbleID = toInt(entity.departureBubbleID, 0);
    if (
      !egoEntity ||
      !departureBubbleID ||
      departureBubbleID !== toInt(egoEntity.bubbleID, 0)
    ) {
      return false;
    }
    // Observer-side departure ownership starts when the authoritative warp
    // begins, not when the pilot-local active-warp effectStamp/effectAtMs
    // kicks in. Using effectAtMs here keeps the ship owned on the departure
    // scene for too long and produces the "frozen ship, then vanish" bug.
    const warpStartAtMs = toFiniteNumber(entity.warpState.startTimeMs, 0);
    if (warpStartAtMs <= 0) {
      return false;
    }
    const departureVisibleUntilMs = Math.max(
      toFiniteNumber(entity.departureBubbleVisibleUntilMs, 0),
      warpStartAtMs + OBSERVER_WARP_DEPARTURE_VISIBLE_MS,
    );
    return toFiniteNumber(now, Date.now()) <= departureVisibleUntilMs;
  }

  canSessionSeeDynamicEntity(session, entity, now = Date.now()) {
    if (!session || !session._space || !entity) {
      return false;
    }
    if (entity.itemID === session._space.shipID) {
      return true;
    }
    if (entity.mode === "WARP" && entity.warpState) {
      return this.canSessionSeeWarpingDynamicEntity(session, entity, now);
    }
    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }
    const egoBubbleID = toInt(egoEntity.bubbleID, 0);
    const entityBubbleID = toInt(entity.bubbleID, 0);
    if (!egoBubbleID || !entityBubbleID) {
      return false;
    }
    return egoBubbleID === entityBubbleID;
  }

  getVisibleDynamicEntitiesForSession(session, now = Date.now()) {
    const visible = [];
    for (const entity of this.dynamicEntities.values()) {
      if (this.canSessionSeeDynamicEntity(session, entity, now)) {
        visible.push(entity);
      }
    }
    return visible;
  }

  getVisibleEntitiesForSession(session, now = Date.now()) {
    return [
      ...this.staticEntities,
      ...this.getVisibleDynamicEntitiesForSession(session, now),
    ];
  }

  getDynamicEntities() {
    return [...this.dynamicEntities.values()];
  }

  getEntityByID(entityID) {
    const numericID = Number(entityID);
    if (!numericID) {
      return null;
    }

    return (
      this.dynamicEntities.get(numericID) ||
      this.staticEntitiesByID.get(numericID) ||
      null
    );
  }

  getShipEntityForSession(session) {
    if (!session || !session._space) {
      return null;
    }

    return this.dynamicEntities.get(session._space.shipID) || null;
  }

  sendSlimItemChangesToSession(session, entities) {
    if (
      !session ||
      !isReadyForDestiny(session) ||
      !Array.isArray(entities) ||
      entities.length === 0
    ) {
      return;
    }

    const stamp = getNextStamp();
    const updates = entities
      .filter(Boolean)
      .map((entity) => ({
        stamp,
        payload: destiny.buildOnSlimItemChangePayload(
          entity.itemID,
          destiny.buildSlimItemObject(entity),
        ),
      }));
    if (updates.length === 0) {
      return;
    }

    this.sendDestinyUpdates(session, updates);
  }

  broadcastSlimItemChanges(entities, excludedSession = null) {
    if (!Array.isArray(entities) || entities.length === 0) {
      return;
    }

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      this.sendSlimItemChangesToSession(session, entities);
    }
  }

  sendAddBallsToSession(session, entities) {
    if (!session || !isReadyForDestiny(session) || entities.length === 0) {
      return;
    }

    const stamp = getNextStamp();
    this.sendDestinyUpdates(session, [
      {
        stamp,
        payload: destiny.buildAddBalls2Payload(stamp, entities),
      },
    ]);
    const primeUpdates = buildShipPrimeUpdatesForEntities(entities);
    if (primeUpdates.length > 0) {
      this.sendDestinyUpdates(session, primeUpdates);
    }
    const modeUpdates = [];
    for (const entity of entities) {
      modeUpdates.push(...this.buildModeUpdates(entity));
    }
    if (modeUpdates.length > 0) {
      this.sendDestinyUpdates(session, modeUpdates);
    }
  }

  sendRemoveBallsToSession(session, entityIDs) {
    if (!session || !isReadyForDestiny(session) || entityIDs.length === 0) {
      return;
    }

    this.sendDestinyUpdates(session, [
      {
        stamp: getNextStamp(),
        payload: destiny.buildRemoveBallsPayload(entityIDs),
      },
    ]);
  }

  syncDynamicVisibilityForSession(session, now = Date.now()) {
    if (!session || !session._space || session._space.initialStateSent !== true) {
      return;
    }

    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return;
    }

    const desiredEntities = this.getVisibleDynamicEntitiesForSession(session, now).filter(
      (entity) => entity.itemID !== egoEntity.itemID,
    );
    const desiredIDs = new Set(desiredEntities.map((entity) => entity.itemID));
    const currentIDs =
      session._space.visibleDynamicEntityIDs instanceof Set
        ? session._space.visibleDynamicEntityIDs
        : new Set();

    const addedEntities = desiredEntities.filter(
      (entity) => !currentIDs.has(entity.itemID),
    );
    const removedIDs = [...currentIDs].filter((entityID) => !desiredIDs.has(entityID));

    if (removedIDs.length > 0) {
      this.sendRemoveBallsToSession(session, removedIDs);
    }
    if (addedEntities.length > 0) {
      this.sendAddBallsToSession(session, addedEntities);
    }

    if (removedIDs.length > 0 || addedEntities.length > 0) {
      logBubbleDebug("bubble.visibility_sync", {
        systemID: this.systemID,
        sessionCharacterID: toInt(session.charID, 0),
        sessionShipID: toInt(session._space.shipID, 0),
        egoBubbleID: toInt(egoEntity.bubbleID, 0),
        addedEntityIDs: addedEntities.map((entity) => toInt(entity.itemID, 0)),
        removedEntityIDs: removedIDs.map((entityID) => toInt(entityID, 0)),
        desiredVisibleEntityIDs: [...desiredIDs].map((entityID) => toInt(entityID, 0)),
      });
    }

    session._space.visibleDynamicEntityIDs = desiredIDs;
  }

  syncDynamicVisibilityForAllSessions(now = Date.now()) {
    for (const session of this.sessions.values()) {
      this.syncDynamicVisibilityForSession(session, now);
    }
  }

  buildModeUpdates(entity, stampOverride = null) {
    const updates = [];
    const modeStamp = stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());

    switch (entity.mode) {
      case "GOTO":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildGotoDirectionPayload(
            entity.itemID,
            getCommandDirection(entity, entity.direction),
          ),
        });
        break;
      case "FOLLOW":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildFollowBallPayload(
            entity.itemID,
            entity.targetEntityID,
            entity.followRange,
          ),
        });
        break;
      case "ORBIT":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildOrbitPayload(
            entity.itemID,
            entity.targetEntityID,
            entity.orbitDistance,
          ),
        });
        break;
      case "WARP":
        if (entity.warpState) {
          if (entity.pendingWarp && toInt(entity.warpState.effectStamp, 0) < 0) {
            updates.push(
              buildWarpPrepareCommandUpdate(
                entity,
                modeStamp,
                entity.warpState,
              ),
            );
          } else {
            updates.push(...buildWarpStartUpdates(entity, entity.warpState, modeStamp));
          }
        }
        break;
      default:
        break;
    }

    if (entity.mode !== "WARP" && entity.speedFraction > 0) {
      updates.push({
        stamp: modeStamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }
    if (entity.mode !== "WARP" && magnitude(entity.velocity) > 0) {
      updates.push({
        stamp: modeStamp,
        payload: destiny.buildSetBallVelocityPayload(
          entity.itemID,
          entity.velocity,
        ),
      });
    }

    return updates;
  }

  attachSession(session, shipItem, options = {}) {
    if (!session || !shipItem) {
      return null;
    }

    const shipEntity = buildShipEntity(session, shipItem, this.systemID);
    if (
      shipEntity.mode === "WARP" &&
      shipEntity.warpState &&
      !shipEntity.pendingWarp
    ) {
      log.warn(
        `[SpaceRuntime] Restoring persisted warp state for ship=${shipEntity.itemID} on login is unsupported; spawning stopped at current position instead.`,
      );
      resetEntityMotion(shipEntity);
      shipEntity.warpState = null;
      shipEntity.pendingWarp = null;
      shipEntity.targetEntityID = null;
    }
    if (options.skipLegacyStationNormalization !== true) {
      normalizeLegacyStationState(shipEntity);
    }
    if (options.spawnStopped) {
      resetEntityMotion(shipEntity);
    } else if (options.undockDirection) {
      buildUndockMovement(
        shipEntity,
        options.undockDirection,
        options.speedFraction ?? 1,
      );
    }

    session._space = {
      systemID: this.systemID,
      shipID: shipEntity.itemID,
      beyonceBound: Boolean(options.beyonceBound),
      initialStateSent: false,
      pendingUndockMovement: Boolean(options.pendingUndockMovement),
      visibleDynamicEntityIDs: new Set(),
    };

    this.sessions.set(session.clientID, session);
    this.dynamicEntities.set(shipEntity.itemID, shipEntity);
    this.reconcileEntityBubble(shipEntity);
    persistShipEntity(shipEntity);

    log.info(
      `[SpaceRuntime] Attached ${session.characterName || session.characterID} ship=${shipEntity.itemID} to system ${this.systemID}`,
    );

    if (options.broadcast !== false) {
      this.syncDynamicVisibilityForAllSessions();
    }

    return shipEntity;
  }

  detachSession(session, options = {}) {
    if (!session || !session._space) {
      return;
    }

    const entity = this.dynamicEntities.get(session._space.shipID) || null;
    this.sessions.delete(session.clientID);
    if (entity) {
      persistShipEntity(entity);
      this.removeEntityFromBubble(entity);
      entity.departureBubbleID = null;
      entity.departureBubbleVisibleUntilMs = 0;
      this.dynamicEntities.delete(entity.itemID);
      for (const otherSession of this.sessions.values()) {
        if (
          otherSession &&
          otherSession._space &&
          otherSession._space.visibleDynamicEntityIDs instanceof Set
        ) {
          otherSession._space.visibleDynamicEntityIDs.delete(entity.itemID);
        }
      }
      if (options.broadcast !== false) {
        this.broadcastRemoveBall(entity.itemID, session);
      }
    }

    session._space = null;
  }

  markBeyonceBound(session) {
    if (session && session._space) {
      session._space.beyonceBound = true;
    }
  }

  sendDestinyUpdates(session, payloads, waitForBubble = false) {
    if (!session || payloads.length === 0) {
      return;
    }

    let groupedUpdates = [];
    let currentStamp = null;
    let firstGroup = true;
    const flushGroup = () => {
      if (groupedUpdates.length === 0) {
        return;
      }

      logDestinyDispatch(session, groupedUpdates, waitForBubble && firstGroup);
      session.sendNotification(
        "DoDestinyUpdate",
        "clientID",
        destiny.buildDestinyUpdatePayload(
          groupedUpdates,
          waitForBubble && firstGroup,
        ),
      );
      groupedUpdates = [];
      currentStamp = null;
      firstGroup = false;
    };

    for (const payload of payloads) {
      const stamp = Number(payload && payload.stamp);
      if (groupedUpdates.length === 0) {
        groupedUpdates.push(payload);
        currentStamp = stamp;
        continue;
      }

      if (stamp === currentStamp) {
        groupedUpdates.push(payload);
        continue;
      }

      flushGroup();
      groupedUpdates.push(payload);
      currentStamp = stamp;
    }

    flushGroup();
  }

  sendDestinyBatch(session, payloads, waitForBubble = false) {
    if (!session || payloads.length === 0) {
      return;
    }

    logDestinyDispatch(session, payloads, waitForBubble);
    session.sendNotification(
      "DoDestinyUpdate",
      "clientID",
      destiny.buildDestinyUpdatePayload(payloads, waitForBubble),
    );
  }

  sendDestinyUpdatesIndividually(session, payloads, waitForBubble = false) {
    if (!session || payloads.length === 0) {
      return;
    }

    for (let index = 0; index < payloads.length; index += 1) {
      this.sendDestinyUpdates(session, [payloads[index]], waitForBubble && index === 0);
    }
  }

  sendMovementUpdatesToSession(session, updates) {
    if (!session || !isReadyForDestiny(session) || updates.length === 0) {
      return;
    }

    this.sendDestinyUpdates(session, updates);
  }

  sendStateRefresh(session, egoEntity, stampOverride = null) {
    if (!session || !egoEntity || !isReadyForDestiny(session)) {
      return;
    }

    const stamp =
      stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
    this.sendDestinyUpdates(session, [
      {
        stamp,
        payload: destiny.buildSetStatePayload(
          stamp,
          this.system,
          egoEntity.itemID,
          this.getVisibleEntitiesForSession(session),
        ),
      },
    ]);
  }

  ensureInitialBallpark(session, options = {}) {
    if (!session || !session._space) {
      return false;
    }

    if (session._space.initialStateSent && options.force !== true) {
      return true;
    }

    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }

    const dynamicEntities = this.getVisibleDynamicEntitiesForSession(session);
    const visibleEntities = this.getVisibleEntitiesForSession(session);
    // V23.02 expects the initial bootstrap as a split AddBalls2 -> SetState ->
    // prime/mode sequence. Collapsing everything into one waitForBubble batch
    // leaves Michelle stuck in "state waiting: yes" on login.
    const bootstrapBaseStamp = getCurrentDestinyStamp();
    const addBallsStamp = bootstrapBaseStamp;
    const setStateStamp = (bootstrapBaseStamp + 1) >>> 0;
    const primeStamp = setStateStamp;
    const modeStamp = setStateStamp;
    nextStamp = Math.max(nextStamp, modeStamp);

    const bootstrapUpdates = [
      {
        stamp: addBallsStamp,
        payload: destiny.buildAddBalls2Payload(addBallsStamp, dynamicEntities),
      },
      {
        stamp: setStateStamp,
        payload: destiny.buildSetStatePayload(
          setStateStamp,
          this.system,
          egoEntity.itemID,
          visibleEntities,
        ),
      },
    ];

    const primeUpdates = buildShipPrimeUpdatesForEntities(dynamicEntities, primeStamp);
    if (primeUpdates.length > 0) {
      bootstrapUpdates.push(...primeUpdates);
    }

    const followUp = this.buildModeUpdates(egoEntity, modeStamp);
    logBallDebug("bootstrap.ego", egoEntity, {
      addBallsStamp,
      setStateStamp,
      primeStamp,
      modeStamp,
      dynamicEntityCount: dynamicEntities.length,
      visibleEntityCount: visibleEntities.length,
    });
    if (followUp.length > 0) {
      bootstrapUpdates.push(...followUp);
    }

    this.sendDestinyUpdates(session, [bootstrapUpdates[0]], true);
    this.sendDestinyUpdates(session, [bootstrapUpdates[1]]);
    if (primeUpdates.length > 0) {
      this.sendDestinyUpdates(session, primeUpdates);
    }
    if (followUp.length > 0) {
      this.sendDestinyUpdates(session, followUp);
    }

    session._space.initialStateSent = true;
    session._space.pendingUndockMovement = false;
    session._space.visibleDynamicEntityIDs = new Set(
      dynamicEntities
        .filter((entity) => entity.itemID !== egoEntity.itemID)
        .map((entity) => entity.itemID),
    );
    return true;
  }

  broadcastAddBalls(entities, excludedSession = null) {
    if (entities.length === 0) {
      return;
    }

    const stamp = getNextStamp();
    const payload = {
      stamp,
      payload: destiny.buildAddBalls2Payload(stamp, entities),
    };

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      const visibleEntities = entities.filter((entity) =>
        this.canSessionSeeDynamicEntity(session, entity),
      );
      if (visibleEntities.length === 0) {
        continue;
      }
      this.sendDestinyUpdates(session, [
        {
          ...payload,
          payload: destiny.buildAddBalls2Payload(stamp, visibleEntities),
        },
      ]);
      const primeUpdates = buildShipPrimeUpdatesForEntities(visibleEntities);
      if (primeUpdates.length > 0) {
        this.sendDestinyUpdates(session, primeUpdates);
      }
      const modeUpdates = [];
      for (const entity of visibleEntities) {
        modeUpdates.push(...this.buildModeUpdates(entity));
      }
      if (modeUpdates.length > 0) {
        this.sendDestinyUpdates(session, modeUpdates);
      }
      if (session._space) {
        const currentIDs =
          session._space.visibleDynamicEntityIDs instanceof Set
            ? session._space.visibleDynamicEntityIDs
            : new Set();
        for (const entity of visibleEntities) {
          if (entity.itemID !== session._space.shipID) {
            currentIDs.add(entity.itemID);
          }
        }
        session._space.visibleDynamicEntityIDs = currentIDs;
      }
    }
  }

  broadcastRemoveBall(entityID, excludedSession = null) {
    const update = {
      stamp: getNextStamp(),
      payload: destiny.buildRemoveBallsPayload([entityID]),
    };

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      this.sendDestinyUpdates(session, [update]);
      if (session._space && session._space.visibleDynamicEntityIDs instanceof Set) {
        session._space.visibleDynamicEntityIDs.delete(entityID);
      }
    }
  }

  broadcastMovementUpdates(updates, excludedSession = null) {
    if (updates.length === 0) {
      return;
    }

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      const filteredUpdates = updates.filter((update) => {
        const entityID = getPayloadPrimaryEntityID(update && update.payload);
        if (!entityID) {
          return true;
        }
        if (session._space && entityID === session._space.shipID) {
          return true;
        }
        const entity = this.dynamicEntities.get(entityID);
        if (!entity) {
          return true;
        }
        return this.canSessionSeeDynamicEntity(session, entity);
      });
      if (filteredUpdates.length > 0) {
        this.sendDestinyUpdates(session, filteredUpdates);
      }
    }
  }

  scheduleWatcherMovementAnchor(entity, now = Date.now(), reason = "movement") {
    if (!entity) {
      return false;
    }

    // Force a fast watcher velocity correction after command changes, but do
    // not also force an immediate position anchor. Position rebases during
    // heading changes were still landing on the same 1-second Destiny stamp
    // and caused the visible remote jolts. Let the periodic position anchor
    // handle reconciliation instead.
    entity.lastObserverCorrectionBroadcastAt = 0;
    logMovementDebug("observer.anchor.scheduled", entity, {
      reason,
    });
    return true;
  }

  gotoDirection(session, direction) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = Date.now();
    const commandDirection = normalizeVector(direction, entity.direction);
    clearTrackingState(entity);
    entity.targetPoint = addVectors(
      cloneVector(entity.position),
      scaleVector(commandDirection, 1.0e16),
    );
    const speedFractionChanged = entity.speedFraction <= 0;
    if (speedFractionChanged) {
      entity.speedFraction = 1.0;
    }
    entity.mode = "GOTO";
    persistShipEntity(entity);
    armMovementTrace(entity, "goto", {
      commandDirection: summarizeVector(commandDirection),
    }, now);
    logMovementDebug("cmd.goto", entity, {
      commandDirection: summarizeVector(commandDirection),
    });

    const movementStamp = getMovementStamp(now);
    const updates = buildDirectedMovementUpdates(
      entity,
      commandDirection,
      speedFractionChanged,
      movementStamp,
    );

    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "gotoDirection");

    return true;
  }

  alignTo(session, targetEntityID) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (!entity || !target || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = Date.now();
    const alignTargetPosition = getTargetMotionPosition(target);
    const commandDirection = normalizeVector(
      subtractVectors(alignTargetPosition, entity.position),
      entity.direction,
    );
    clearTrackingState(entity);
    entity.targetPoint = addVectors(
      cloneVector(entity.position),
      scaleVector(commandDirection, 1.0e16),
    );
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 0.75;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    entity.mode = "GOTO";
    persistShipEntity(entity);
    armMovementTrace(entity, "align", {
      commandDirection: summarizeVector(commandDirection),
      alignTargetID: target.itemID,
      alignTargetPosition: summarizeVector(alignTargetPosition),
    }, now);
    logMovementDebug("cmd.align", entity, {
      commandDirection: summarizeVector(commandDirection),
      alignTargetID: target.itemID,
      alignTargetPosition: summarizeVector(alignTargetPosition),
    });

    const movementStamp = getMovementStamp(now);
    const updates = buildDirectedMovementUpdates(
      entity,
      commandDirection,
      speedFractionChanged,
      movementStamp,
    );

    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "alignTo");

    return true;
  }

  followBall(session, targetEntityID, range = 0, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (
      !entity ||
      !target ||
      entity.itemID === target.itemID ||
      entity.mode === "WARP" ||
      entity.pendingDock
    ) {
      return false;
    }

    const now = Date.now();
    const explicitDockingTargetID =
      target.kind === "station" &&
      Number(options.dockingTargetID || 0) === target.itemID
        ? target.itemID
        : null;
    const preservedDockingTargetID =
      explicitDockingTargetID === null &&
      target.kind === "station" &&
      Number(entity.targetEntityID || 0) === target.itemID &&
      Number(entity.dockingTargetID || 0) === target.itemID
        ? target.itemID
        : null;
    const dockingTargetID = explicitDockingTargetID || preservedDockingTargetID;
    const normalizedRange = Math.max(0, toFiniteNumber(range, 0));
    if (
      entity.mode === "FOLLOW" &&
      entity.targetEntityID === target.itemID &&
      entity.dockingTargetID === dockingTargetID &&
      Math.abs(toFiniteNumber(entity.followRange, 0) - normalizedRange) < 1
    ) {
      logMovementDebug("cmd.follow.duplicate", entity, {
        followTargetID: target.itemID,
        followRange: roundNumber(normalizedRange),
        dockingTargetID: dockingTargetID || 0,
      });
      return true;
    }

    const followTargetPosition = getTargetMotionPosition(target, {
      useDockPosition: dockingTargetID === target.itemID,
    });
    clearTrackingState(entity);
    entity.mode = "FOLLOW";
    entity.targetEntityID = target.itemID;
    entity.dockingTargetID = dockingTargetID;
    entity.followRange = normalizedRange;
    entity.targetPoint = followTargetPosition;
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 1;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    persistShipEntity(entity);
    armMovementTrace(entity, "follow", {
      followTargetID: target.itemID,
      followRange: roundNumber(entity.followRange),
      followTargetPosition: summarizeVector(followTargetPosition),
      dockingTargetID: dockingTargetID || 0,
      preservedDockingTargetID: preservedDockingTargetID || 0,
    }, now);
    logMovementDebug("cmd.follow", entity, {
      followTargetID: target.itemID,
      followRange: roundNumber(entity.followRange),
      followTargetKind: target.kind,
      followTargetPosition: summarizeVector(followTargetPosition),
      explicitDockingTargetID: explicitDockingTargetID || 0,
      preservedDockingTargetID: preservedDockingTargetID || 0,
      dockPosition:
        target.kind === "station" && target.dockPosition
          ? summarizeVector(target.dockPosition)
          : null,
      dockingDistance:
        target.kind === "station"
          ? roundNumber(getShipDockingDistanceToStation(entity, target))
          : null,
    });

    const movementStamp = getMovementStamp(now);
    const updates = [
      {
        stamp: movementStamp,
        payload: destiny.buildFollowBallPayload(
          entity.itemID,
          target.itemID,
          entity.followRange,
        ),
      },
    ];
    if (speedFractionChanged) {
      updates.push({
        stamp: updates[0].stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }

    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "followBall");

    return true;
  }

  orbit(session, targetEntityID, distanceValue = 0) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (
      !entity ||
      !target ||
      entity.itemID === target.itemID ||
      entity.mode === "WARP" ||
      entity.pendingDock
    ) {
      return false;
    }

    const now = Date.now();
    const radial = normalizeVector(
      subtractVectors(entity.position, target.position),
      buildPerpendicular(entity.direction),
    );

    clearTrackingState(entity);
    entity.mode = "ORBIT";
    entity.targetEntityID = target.itemID;
    entity.orbitDistance = Math.max(0, toFiniteNumber(distanceValue, 0));
    entity.orbitNormal = normalizeVector(
      crossProduct(radial, DEFAULT_UP),
      buildPerpendicular(radial),
    );
    entity.orbitSign = 1;
    entity.targetPoint = cloneVector(target.position);
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 1;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    persistShipEntity(entity);
    armMovementTrace(entity, "orbit", {
      orbitTargetID: target.itemID,
      orbitDistance: roundNumber(entity.orbitDistance),
      orbitTargetPosition: summarizeVector(target.position),
    }, now);
    logMovementDebug("cmd.orbit", entity, {
      orbitTargetID: target.itemID,
      orbitDistance: roundNumber(entity.orbitDistance),
      orbitTargetPosition: summarizeVector(target.position),
    });

    const movementStamp = getMovementStamp(now);
    const updates = [
      {
        stamp: movementStamp,
        payload: destiny.buildOrbitPayload(
          entity.itemID,
          target.itemID,
          entity.orbitDistance,
        ),
      },
    ];
    if (speedFractionChanged) {
      updates.push({
        stamp: updates[0].stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }

    this.broadcastMovementUpdates(updates);
    this.scheduleWatcherMovementAnchor(entity, now, "orbit");

    return true;
  }

  warpToEntity(session, targetEntityID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (!entity || !target) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }

    const stopDistance = getWarpStopDistanceForTarget(
      entity,
      target,
      toFiniteNumber(options.minimumRange, 0),
    );
    const warpTargetPoint =
      target && target.kind === "station"
        ? getStationWarpTargetPosition(target)
        : getTargetMotionPosition(target);
    return this.warpToPoint(session, warpTargetPoint, {
      ...options,
      stopDistance,
      targetEntityID: target.itemID,
    });
  }

  warpToPoint(session, point, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.pendingDock) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const pendingWarp = buildPendingWarpRequest(entity, point, {
      ...options,
      warpSpeedAU: options.warpSpeedAU || entity.warpSpeedAU,
    });
    if (!pendingWarp) {
      return {
        success: false,
        errorMsg: "WARP_DISTANCE_TOO_CLOSE",
      };
    }

    const now = Date.now();
    const movementStamp = getMovementStamp(now);
    clearTrackingState(entity);
    entity.pendingWarp = pendingWarp;
    entity.mode = "WARP";
    entity.speedFraction = 1;
    entity.direction = normalizeVector(
      subtractVectors(pendingWarp.targetPoint, entity.position),
      entity.direction,
    );
    entity.targetPoint = cloneVector(pendingWarp.targetPoint);
    entity.targetEntityID = pendingWarp.targetEntityID || null;
    entity.warpState = buildPreparingWarpState(entity, pendingWarp);
    persistShipEntity(entity);
    armMovementTrace(entity, "warp", {
      pendingWarp: summarizePendingWarp(pendingWarp),
    }, now);
    logMovementDebug("warp.requested", entity);
    logWarpDebug("warp.requested", entity, {
      officialProfile: buildOfficialWarpReferenceProfile(
        pendingWarp.totalDistance,
        pendingWarp.warpSpeedAU,
        entity.maxVelocity,
      ),
    });

    const prepareDispatch = buildWarpPrepareDispatch(
      entity,
      movementStamp,
      entity.warpState,
    );
    if (session && isReadyForDestiny(session)) {
      this.sendDestinyUpdates(session, prepareDispatch.pilotUpdates);
      this.broadcastMovementUpdates(prepareDispatch.sharedUpdates, session);
    } else {
      this.broadcastMovementUpdates(prepareDispatch.sharedUpdates);
    }
    return {
      success: true,
      data: pendingWarp,
    };
  }

  setSpeedFraction(session, fraction) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = Date.now();
    const normalizedFraction = clamp(fraction, 0, MAX_SUBWARP_SPEED_FRACTION);
    if (normalizedFraction <= 0) {
      return this.stop(session);
    }

    entity.speedFraction = normalizedFraction;
    if (entity.speedFraction > 0 && entity.mode === "STOP") {
      entity.mode = "GOTO";
      entity.targetPoint = addVectors(
        cloneVector(entity.position),
        scaleVector(entity.direction, 1.0e16),
      );
    }
    persistShipEntity(entity);
    armMovementTrace(entity, "speed", {
      requestedSpeedFraction: roundNumber(normalizedFraction, 3),
    }, now);
    logMovementDebug("cmd.speed", entity);

    const stamp = getMovementStamp(now);
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      },
    ]);
    this.scheduleWatcherMovementAnchor(entity, now, "setSpeedFraction");

    return true;
  }

  stop(session) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.pendingDock) {
      return false;
    }

    const now = Date.now();
    const wasAlreadyStopped =
      entity.mode === "STOP" &&
      entity.speedFraction <= 0 &&
      magnitude(entity.velocity) < 0.1;
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.targetPoint = cloneVector(entity.position);
    clearTrackingState(entity);
    persistShipEntity(entity);
    armMovementTrace(entity, "stop", {}, now);
    logMovementDebug("cmd.stop", entity);

    if (wasAlreadyStopped) {
      return true;
    }

    const stamp = getMovementStamp(now);
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
    ]);
    this.scheduleWatcherMovementAnchor(entity, now, "stop");

    return true;
  }

  acceptDocking(session, stationID) {
    const entity = this.getShipEntityForSession(session);
    const station = this.getEntityByID(stationID);
    if (!entity || !station || station.kind !== "station") {
      return {
        success: false,
        errorMsg: "STATION_NOT_FOUND",
      };
    }

    if (
      entity.pendingDock &&
      Number(entity.pendingDock.stationID || 0) === station.itemID
    ) {
      return {
        success: true,
        data: {
          acceptedAtFileTime: entity.pendingDock.acceptedAtFileTime,
          pending: true,
        },
      };
    }

    if (!canShipDockAtStation(entity, station)) {
      return {
        success: false,
        errorMsg: "DOCKING_APPROACH_REQUIRED",
      };
    }

    clearTrackingState(entity);
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    entity.pendingDock = {
      stationID: station.itemID,
      acceptedAtMs: Date.now(),
      completeAtMs: Date.now() + STATION_DOCK_ACCEPT_DELAY_MS,
      acceptedAtFileTime: currentFileTime(),
    };
    persistShipEntity(entity);
    logMovementDebug("dock.accepted", entity, {
      stationID: station.itemID,
      dockingState: buildDockingDebugState(entity, station),
    });

    const stamp = getNextStamp();
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
      },
      {
        stamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
      {
        stamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
      },
    ]);

    if (session && typeof session.sendNotification === "function") {
      const dockingAcceptedPayload = destiny.buildOnDockingAcceptedPayload(
        entity.position,
        station.position,
        station.itemID,
      );
      session.sendNotification(
        "OnDockingAccepted",
        "charid",
        dockingAcceptedPayload,
      );
    }

    return {
      success: true,
      data: {
        acceptedAtFileTime: entity.pendingDock.acceptedAtFileTime,
      },
    };
  }

  tick(now) {
    const deltaSeconds = Math.max((now - this.lastTickAt) / 1000, 0.05);
    this.lastTickAt = now;

    const settledStargates = this.settleTransientStargateActivationStates(now);
    if (settledStargates.length > 0) {
      this.broadcastSlimItemChanges(settledStargates);
    }

    const sharedUpdates = [];
    const sessionOnlyPreEffectUpdates = [];
    const sessionOnlyUpdates = [];
    const watcherOnlyUpdates = [];
    const dockRequests = new Map();
    for (const entity of this.dynamicEntities.values()) {
      const traceActive = isMovementTraceActive(entity, now);
      if (entity.pendingDock) {
        if (
          entity.session &&
          entity.session._space &&
          now >= Number(entity.pendingDock.completeAtMs || 0)
        ) {
          dockRequests.set(entity.session.clientID, {
            session: entity.session,
            stationID: entity.pendingDock.stationID,
          });
        }
        continue;
      }

      const result = advanceMovement(entity, this, deltaSeconds, now);
      if (entity.pendingWarp) {
        const pendingWarp = entity.pendingWarp;
        const pendingWarpState = evaluatePendingWarp(entity, pendingWarp, now);
        if (pendingWarpState.ready) {
          const currentStamp = getCurrentDestinyStamp(now);
          const pilotCanReceiveWarpEgoStateRefresh =
            ENABLE_PILOT_WARP_EGO_STATE_REFRESH &&
            entity.session &&
            isReadyForDestiny(entity.session);
          const pilotCanReceivePreWarpRebaseline =
            ENABLE_PILOT_PRE_WARP_ADDBALL_REBASE &&
            entity.session &&
            isReadyForDestiny(entity.session);
          if (pilotCanReceivePreWarpRebaseline) {
            const preWarpSyncStamp = toInt(pendingWarp.preWarpSyncStamp, 0);
            if (preWarpSyncStamp <= 0) {
              pendingWarp.preWarpSyncStamp = currentStamp;
              sessionOnlyPreEffectUpdates.push({
                session: entity.session,
                updates: buildPilotPreWarpRebaselineUpdates(
                  entity,
                  pendingWarp,
                  currentStamp,
                ),
              });
              persistShipEntity(entity);
              logMovementDebug("warp.pre_sync", entity, {
                pendingWarpState,
                preWarpSyncStamp: currentStamp,
                pendingWarp: summarizePendingWarp(pendingWarp),
              });
              logWarpDebug("warp.pre_sync", entity, {
                pendingWarpState,
                pilotPlan: {
                  preWarpAddBall: true,
                  preWarpSyncStamp: currentStamp,
                  subwarpMaxSpeedMs: roundNumber(entity.maxVelocity, 3),
                  subwarpMaxSpeedAU: roundNumber(
                    entity.maxVelocity / ONE_AU_IN_METERS,
                    9,
                  ),
                  velocityMs: roundNumber(magnitude(entity.velocity), 3),
                  speedFraction: roundNumber(entity.speedFraction, 3),
                  actualSpeedFraction: roundNumber(
                    getActualSpeedFraction(entity),
                    3,
                  ),
                },
              });
              continue;
            }
            if (currentStamp <= preWarpSyncStamp) {
              continue;
            }
          }
          logBallDebug("warp.pre_start.ego", entity, {
            pendingWarp: summarizePendingWarp(pendingWarp),
            pendingWarpState,
            preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
          });
          const warpState = activatePendingWarp(entity, pendingWarp);
          if (warpState) {
            this.beginWarpDepartureOwnership(entity, now);
            const warpStartStamp =
              entity.session && isReadyForDestiny(entity.session)
                ? currentStamp
                : getNextStamp(now);
            warpState.commandStamp = warpStartStamp;
            warpState.startupGuidanceAtMs = 0;
            warpState.startupGuidanceStamp = 0;
            warpState.cruiseBumpAtMs = shouldSchedulePilotWarpCruiseBump(warpState)
              ? getPilotWarpCruiseBumpAtMs(warpState)
              : 0;
            warpState.cruiseBumpStamp = shouldSchedulePilotWarpCruiseBump(warpState)
              ? getPilotWarpCruiseBumpStamp(warpStartStamp, warpState)
              : 0;
            warpState.effectAtMs = getPilotWarpEffectAtMs(warpState);
            warpState.effectStamp = getPilotWarpEffectStamp(warpStartStamp, warpState);
            warpState.pilotMaxSpeedRamp = buildPilotWarpMaxSpeedRamp(
              entity,
              warpState,
              warpStartStamp,
            );
            const pilotWarpFactor = getPilotWarpFactorOptionA(entity, warpState);
            const warpStartUpdates = [
              buildWarpStartEffectUpdate(entity, warpStartStamp),
            ];
            const pilotWarpStartUpdates = buildPilotWarpActivationUpdates(
              entity,
              warpStartStamp,
              warpState,
            );
            if (entity.session && isReadyForDestiny(entity.session)) {
              if (pilotCanReceiveWarpEgoStateRefresh) {
                sessionOnlyPreEffectUpdates.push({
                  session: entity.session,
                  updates: buildPilotWarpEgoStateRefreshUpdates(
                    this.system,
                    entity,
                    warpStartStamp,
                  ),
                  splitUpdates: true,
                });
              }
              sessionOnlyPreEffectUpdates.push({
                session: entity.session,
                updates: buildPilotWarpActivationStateRefreshUpdates(
                  entity,
                  warpStartStamp,
                ),
                splitUpdates: true,
              });
              sessionOnlyPreEffectUpdates.push({
                session: entity.session,
                updates: pilotWarpStartUpdates,
              });
              watcherOnlyUpdates.push({
                excludedSession: entity.session,
                updates: warpStartUpdates,
              });
            } else {
              sharedUpdates.push(...warpStartUpdates);
            }
            persistShipEntity(entity);
            logBallDebug("warp.started.ego", entity, {
              pendingWarpState,
              warpCommandStamp: warpStartStamp,
              warpEffectStamp: warpState.effectStamp,
            });
            logMovementDebug("warp.started", entity, {
              pendingWarpState,
              warpState: serializeWarpState(entity),
              warpCommandStamp: warpStartStamp,
              warpEffectStamp: warpState.effectStamp,
            });
            const officialProfile = buildOfficialWarpReferenceProfile(
              warpState.totalDistance,
              Math.max(
                toFiniteNumber(warpState.warpSpeed, 0) / 10,
                toFiniteNumber(warpState.cruiseWarpSpeedMs, 0) / ONE_AU_IN_METERS,
              ),
              entity.maxVelocity,
            );
            logWarpDebug("warp.started", entity, {
              pendingWarpState,
              officialProfile,
              profileDelta: buildWarpProfileDelta(warpState, officialProfile),
              pilotPlan: {
                bootstrapLiteRefresh: pilotCanReceiveWarpEgoStateRefresh,
                dualWarpCommand: false,
                preWarpAddBall: pilotCanReceivePreWarpRebaseline,
                preWarpSyncStamp: toInt(pendingWarp.preWarpSyncStamp, 0),
                watcherWarpFactor: getNominalWarpFactor(entity, warpState),
                pilotWarpFactor,
                pilotWarpFactorScale: ENABLE_PILOT_WARP_FACTOR_OPTION_A
                  ? PILOT_WARP_FACTOR_OPTION_A_SCALE
                  : 1,
                optionBDecelAssistScale: ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B
                  ? PILOT_WARP_SOLVER_ASSIST_SCALE
                  : 1,
                optionBDecelAssistLeadMs: ENABLE_PILOT_WARP_SOLVER_ASSIST_OPTION_B
                  ? PILOT_WARP_SOLVER_ASSIST_LEAD_MS
                  : 0,
                seedSpeedMs: roundNumber(getPilotWarpActivationSeedSpeed(entity), 3),
                seedSpeedAU: roundNumber(
                  getPilotWarpActivationSeedSpeed(entity) / ONE_AU_IN_METERS,
                  9,
                ),
                startupGuidanceVelocityMs: roundNumber(
                  magnitude(warpState.startupGuidanceVelocity),
                  3,
                ),
                activationVelocityFloorMs: roundNumber(
                  getPilotWarpNativeActivationSpeedFloor(entity),
                  3,
                ),
                activationVelocityFloorAU: roundNumber(
                  getPilotWarpNativeActivationSpeedFloor(entity) /
                    ONE_AU_IN_METERS,
                  9,
                ),
                maxSpeedRamp: warpState.pilotMaxSpeedRamp.map((entry) => ({
                  atMs: roundNumber(entry.atMs, 3),
                  stamp: entry.stamp,
                  speedMs: roundNumber(entry.speed, 3),
                  speedAU: roundNumber(entry.speed / ONE_AU_IN_METERS, 6),
                  label: entry.label,
                })),
                commandStamp: warpStartStamp,
                cruiseBumpAtMs: roundNumber(
                  toFiniteNumber(warpState.cruiseBumpAtMs, 0),
                  3,
                ),
                cruiseBumpStamp: warpState.cruiseBumpStamp,
                effectAtMs: roundNumber(
                  toFiniteNumber(warpState.effectAtMs, 0),
                  3,
                ),
                effectStamp: warpState.effectStamp,
              },
            });
            continue;
          }

          entity.pendingWarp = null;
          logMovementDebug("warp.aborted", entity, {
            reason: "WARP_DISTANCE_TOO_CLOSE_AFTER_ALIGN",
            pendingWarpState,
          });
        }
      }

      if (!result.changed) {
        if (traceActive) {
          logMovementDebug("trace.tick.idle", entity, {
            deltaSeconds: roundNumber(deltaSeconds, 4),
            correction: null,
          });
        }
        continue;
      }

      let correctionDebug = null;
      if (entity.mode === "WARP") {
        const warpState = entity.warpState || null;
        const warpCommandStamp = toInt(
          warpState && warpState.commandStamp,
          0,
        );
        const warpEffectStamp = toInt(
          warpState && warpState.effectStamp,
          warpCommandStamp,
        );
        const warpCruiseBumpStamp = toInt(warpState && warpState.cruiseBumpStamp, 0);
        const warpCruiseBumpAtMs = toFiniteNumber(
          warpState && warpState.cruiseBumpAtMs,
          shouldSchedulePilotWarpCruiseBump(warpState)
            ? getPilotWarpCruiseBumpAtMs(warpState)
            : 0,
        );
        const warpEffectAtMs = toFiniteNumber(
          warpState && warpState.effectAtMs,
          getPilotWarpEffectAtMs(warpState),
        );
        const warpElapsedMs = Math.max(
          0,
          toFiniteNumber(now, Date.now()) -
            toFiniteNumber(warpState && warpState.startTimeMs, now),
        );
        const warpCorrectionStamp = Math.max(
          getMovementStamp(now),
          warpCommandStamp,
        );
        const hasMeaningfulWarpVelocity = magnitude(entity.velocity) > 0.5;
        if (
          !result.warpCompleted &&
          entity.session &&
          isReadyForDestiny(entity.session)
        ) {
          const pilotWarpPhaseStamp = warpCorrectionStamp;
          const pilotMaxSpeedRamp = clonePilotWarpMaxSpeedRamp(
            warpState && warpState.pilotMaxSpeedRamp,
          );
          let duePilotWarpRampIndex = entity.lastPilotWarpMaxSpeedRampIndex;
          for (
            let index = entity.lastPilotWarpMaxSpeedRampIndex + 1;
            index < pilotMaxSpeedRamp.length;
            index += 1
          ) {
            if (now >= toFiniteNumber(pilotMaxSpeedRamp[index].atMs, 0)) {
              duePilotWarpRampIndex = index;
            } else {
              break;
            }
          }
          const shouldSendPilotWarpCruiseBump =
            warpCruiseBumpStamp > warpCommandStamp &&
            now >= warpCruiseBumpAtMs &&
            entity.lastPilotWarpCruiseBumpStamp !== warpCruiseBumpStamp;
          const shouldSendPilotWarpEffect =
            warpEffectStamp > warpCommandStamp &&
            now >= warpEffectAtMs &&
            entity.lastPilotWarpEffectStamp !== warpEffectStamp;
          const pilotWarpPhaseUpdates = [];
          let rampDebug = null;
          const shouldFoldDueRampIntoCruiseBump =
            shouldSendPilotWarpCruiseBump &&
            duePilotWarpRampIndex > entity.lastPilotWarpMaxSpeedRampIndex;
          if (shouldFoldDueRampIntoCruiseBump) {
            entity.lastPilotWarpMaxSpeedRampIndex = duePilotWarpRampIndex;
          } else if (duePilotWarpRampIndex > entity.lastPilotWarpMaxSpeedRampIndex) {
            const rampEntry = pilotMaxSpeedRamp[duePilotWarpRampIndex];
            pilotWarpPhaseUpdates.push({
              stamp: pilotWarpPhaseStamp,
              payload: destiny.buildSetMaxSpeedPayload(
                entity.itemID,
                rampEntry.speed,
              ),
            });
            entity.lastPilotWarpMaxSpeedRampIndex = duePilotWarpRampIndex;
            rampDebug = {
              index: duePilotWarpRampIndex,
              label: rampEntry.label,
              speedMs: roundNumber(rampEntry.speed, 3),
              speedAU: roundNumber(
                rampEntry.speed / ONE_AU_IN_METERS,
                6,
              ),
            };
          }
          if (shouldSendPilotWarpCruiseBump) {
            pilotWarpPhaseUpdates.push(
              buildWarpCruiseMaxSpeedUpdate(
                entity,
                pilotWarpPhaseStamp,
                warpState,
              ),
            );
            entity.lastPilotWarpCruiseBumpStamp = warpCruiseBumpStamp;
          }
          if (shouldSendPilotWarpEffect) {
            pilotWarpPhaseUpdates.push(
              buildWarpStartEffectUpdate(entity, pilotWarpPhaseStamp),
            );
            entity.lastPilotWarpEffectStamp = warpEffectStamp;
          }
          if (pilotWarpPhaseUpdates.length > 0) {
            sessionOnlyUpdates.push({
              session: entity.session,
              updates: pilotWarpPhaseUpdates,
            });
            logWarpDebug("warp.pilot.phase", entity, {
              stamp: pilotWarpPhaseStamp,
              ramp: rampDebug,
              cruiseBump: shouldSendPilotWarpCruiseBump,
              effect: shouldSendPilotWarpEffect,
            });
          }
          const inActivePilotWarpPhase =
            !entity.pendingWarp &&
            warpCommandStamp > 0;
          const shouldSendPilotWarpCorrection =
            ENABLE_PILOT_WARP_ACTIVE_CORRECTIONS &&
            inActivePilotWarpPhase &&
            warpCorrectionStamp > warpCommandStamp &&
            warpCorrectionStamp !==
              toInt(entity.lastWarpPositionBroadcastStamp, -1);
          if (shouldSendPilotWarpCorrection) {
            const pilotWarpCorrectionUpdates = buildPilotWarpCorrectionUpdates(
              entity,
              warpCorrectionStamp,
            );
            if (pilotWarpCorrectionUpdates.length > 0) {
              sessionOnlyUpdates.push({
                session: entity.session,
                updates: pilotWarpCorrectionUpdates,
              });
            }
            entity.lastWarpCorrectionBroadcastAt = now;
            entity.lastWarpPositionBroadcastStamp = warpCorrectionStamp;
            correctionDebug = {
              stamp: warpCorrectionStamp,
              includePosition: true,
              includeVelocity: true,
              target: "pilot-active-warp-hops+watchers-local-warpto",
              dispatched: pilotWarpCorrectionUpdates.length > 0,
            };
          } else {
            correctionDebug = {
              stamp: warpCorrectionStamp,
              includePosition: false,
              includeVelocity: false,
              target: inActivePilotWarpPhase
                ? "pilot-warp-edges+watchers-local-warpto"
                : "pilot-prep-no-hops+watchers-local-warpto",
              dispatched: false,
            };
          }
        }
        if (!correctionDebug) {
          correctionDebug = {
            stamp: warpCorrectionStamp,
            includePosition: false,
            includeVelocity: false,
            target: "pilot-warp-edges+watchers-local-warpto",
            dispatched: false,
          };
        }
        // Remote watchers should stay on their own WarpTo simulation once they
        // have received the warp-start contract. Mid-warp SetBallPosition /
        // SetBallVelocity corrections fight that local simulation and produce
        // the observed "jolt in place, then teleport" behavior on observers.
        // Keep only the normal warp-start and warp-completion updates for
        // watchers; the pilot still gets authoritative mid-warp hop updates.
        if (entity.lastWarpDiagnosticStamp !== warpCorrectionStamp) {
          logWarpDebug("warp.progress", entity, {
            stamp: warpCorrectionStamp,
          });
          entity.lastWarpDiagnosticStamp = warpCorrectionStamp;
        }
      } else {
        const correctionStamp = getMovementStamp(now);
        const usesActiveWatcherCadence = usesActiveSubwarpWatcherCorrections(entity);
        const observerNeedsPositionAnchor = usesActiveWatcherCadence
          ? correctionStamp !== toInt(entity.lastObserverPositionBroadcastStamp, -1)
          : (now - entity.lastObserverPositionBroadcastAt) >=
              getWatcherPositionCorrectionIntervalMs(entity);
        const correctionUpdates = buildPositionVelocityCorrectionUpdates(entity, {
          stamp: correctionStamp,
          includePosition: observerNeedsPositionAnchor,
        });
        correctionDebug = {
          stamp: correctionStamp,
          includePosition: observerNeedsPositionAnchor,
          includeVelocity: true,
          target: "watchers-only",
          dispatched: false,
        };
        if (
          !result.warpCompleted &&
          now - entity.lastObserverCorrectionBroadcastAt >=
          getWatcherCorrectionIntervalMs(entity)
        ) {
          watcherOnlyUpdates.push({
            excludedSession: entity.session || null,
            updates: correctionUpdates,
          });
          entity.lastObserverCorrectionBroadcastAt = now;
          correctionDebug.dispatched = correctionUpdates.length > 0;
          if (observerNeedsPositionAnchor) {
            entity.lastObserverPositionBroadcastAt = now;
            entity.lastObserverPositionBroadcastStamp = correctionStamp;
          }
        }
      }

      if (traceActive) {
        logMovementDebug("trace.tick", entity, {
          deltaSeconds: roundNumber(deltaSeconds, 4),
          correction: correctionDebug,
          dockingState:
            entity.dockingTargetID && this.getEntityByID(entity.dockingTargetID)
              ? buildDockingDebugState(
                  entity,
                  this.getEntityByID(entity.dockingTargetID),
                )
              : null,
        });
      }

      if (
        entity.session &&
        entity.mode !== "STOP" &&
        (now - entity.lastMovementDebugAt) >= 2000
      ) {
        logMovementDebug("tick", entity, {
          deltaSeconds: roundNumber(deltaSeconds, 4),
          correction: correctionDebug,
          dockingState:
            entity.dockingTargetID && this.getEntityByID(entity.dockingTargetID)
              ? buildDockingDebugState(
                  entity,
                  this.getEntityByID(entity.dockingTargetID),
                )
              : null,
        });
        entity.lastMovementDebugAt = now;
      }

      if (result.warpCompleted) {
        const warpCompletionStamp = getNextStamp();
        entity.lastWarpCorrectionBroadcastAt = now;
        entity.lastWarpPositionBroadcastStamp = warpCompletionStamp;
        entity.lastObserverCorrectionBroadcastAt = now;
        entity.lastObserverPositionBroadcastAt = now;
        entity.lastObserverPositionBroadcastStamp = warpCompletionStamp;
        const warpCompletionUpdates = buildWarpCompletionUpdates(
          entity,
          warpCompletionStamp,
        );
        if (entity.session && isReadyForDestiny(entity.session)) {
          sessionOnlyUpdates.push({
            session: entity.session,
            updates: buildPilotWarpCompletionUpdates(entity, warpCompletionStamp),
          });
          watcherOnlyUpdates.push({
            excludedSession: entity.session,
            updates: warpCompletionUpdates,
          });
        } else {
          sharedUpdates.push(...warpCompletionUpdates);
        }
        logMovementDebug("warp.completed", entity, {
          completionStamp: warpCompletionStamp,
        });
        logWarpDebug("warp.completed", entity, {
          completionStamp: warpCompletionStamp,
          completedWarpState: result.completedWarpState,
          officialProfile: buildOfficialWarpReferenceProfile(
            result.completedWarpState.totalDistance,
            Math.max(
              toFiniteNumber(result.completedWarpState.warpSpeed, 0) / 10,
              toFiniteNumber(result.completedWarpState.cruiseWarpSpeedMs, 0) /
                ONE_AU_IN_METERS,
            ),
            entity.maxVelocity,
          ),
          profileDelta: buildWarpProfileDelta(
            result.completedWarpState,
            buildOfficialWarpReferenceProfile(
              result.completedWarpState.totalDistance,
              Math.max(
                toFiniteNumber(result.completedWarpState.warpSpeed, 0) / 10,
                toFiniteNumber(result.completedWarpState.cruiseWarpSpeedMs, 0) /
                  ONE_AU_IN_METERS,
              ),
              entity.maxVelocity,
            ),
          ),
        });
      }

      if (now - entity.lastPersistAt >= 2000 || result.warpCompleted) {
        persistShipEntity(entity);
      }
    }

    if (dockRequests.size > 0) {
      const { dockSession } = require(path.join(__dirname, "./transitions"));
      for (const request of dockRequests.values()) {
        const result = dockSession(request.session, request.stationID);
        if (!result.success) {
          const entity = this.getShipEntityForSession(request.session);
          clearPendingDock(entity);
          log.warn(
            `[SpaceRuntime] Delayed dock failed for char=${request.session && request.session.characterID} station=${request.stationID}: ${result.errorMsg}`,
          );
        }
      }
    }

    this.reconcileAllDynamicEntityBubbles();
    this.syncDynamicVisibilityForAllSessions(now);

    for (const batch of sessionOnlyPreEffectUpdates) {
      if (batch.splitUpdates) {
        this.sendDestinyUpdatesIndividually(batch.session, batch.updates);
      } else {
        this.sendDestinyUpdates(batch.session, batch.updates);
      }
    }
    this.broadcastMovementUpdates(sharedUpdates);
    for (const batch of sessionOnlyUpdates) {
      this.sendDestinyUpdates(batch.session, batch.updates);
    }
    for (const batch of watcherOnlyUpdates) {
      this.broadcastMovementUpdates(batch.updates, batch.excludedSession);
    }
  }

  settleTransientStargateActivationStates(now) {
    const changed = [];
    for (const entity of this.staticEntities) {
      if (entity.kind !== "stargate") {
        continue;
      }
      if (entity.activationState !== STARGATE_ACTIVATION_STATE.ACTIVATING) {
        continue;
      }
      if (toFiniteNumber(entity.activationTransitionAtMs, 0) > now) {
        continue;
      }
      entity.activationState = STARGATE_ACTIVATION_STATE.OPEN;
      entity.activationTransitionAtMs = 0;
      changed.push(entity);
    }
    return changed;
  }
}

class SpaceRuntime {
  constructor() {
    this.scenes = new Map();
    this.solarSystemGateActivationOverrides = new Map();
    this.stargateActivationOverrides = new Map();
    this._tickHandle = setInterval(() => this.tick(), 100);
    if (this._tickHandle && typeof this._tickHandle.unref === "function") {
      this._tickHandle.unref();
    }
  }

  isSolarSystemSceneLoaded(systemID) {
    const numericSystemID = toInt(systemID, 0);
    return numericSystemID > 0 && this.scenes.has(numericSystemID);
  }

  getSolarSystemStargateActivationState(systemID) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return STARGATE_ACTIVATION_STATE.CLOSED;
    }
    if (this.solarSystemGateActivationOverrides.has(numericSystemID)) {
      return this.solarSystemGateActivationOverrides.get(numericSystemID);
    }
    return this.isSolarSystemSceneLoaded(numericSystemID)
      ? STARGATE_ACTIVATION_STATE.OPEN
      : STARGATE_ACTIVATION_STATE.CLOSED;
  }

  resolveStargateActivationState(stargate) {
    const numericGateID = toInt(stargate && stargate.itemID, 0);
    if (numericGateID && this.stargateActivationOverrides.has(numericGateID)) {
      return this.stargateActivationOverrides.get(numericGateID);
    }

    const destinationSystemID = toInt(
      stargate && stargate.destinationSolarSystemID,
      0,
    );
    if (destinationSystemID) {
      return this.getSolarSystemStargateActivationState(destinationSystemID);
    }

    return coerceStableActivationState(
      stargate && stargate.activationState,
      STARGATE_ACTIVATION_STATE.CLOSED,
    );
  }

  refreshStargateActivationStates(options = {}) {
    const targetGateID = toInt(options.targetGateID, 0);
    const targetSystemID = toInt(options.targetSystemID, 0);
    const now = Date.now();
    const animateOpenTransitions =
      options.animateOpenTransitions !== false && options.broadcast !== false;
    const changedByScene = new Map();

    for (const scene of this.scenes.values()) {
      for (const entity of scene.staticEntities) {
        if (entity.kind !== "stargate") {
          continue;
        }
        if (targetGateID && toInt(entity.itemID, 0) !== targetGateID) {
          continue;
        }
        if (
          targetSystemID &&
          toInt(entity.destinationSolarSystemID, 0) !== targetSystemID
        ) {
          continue;
        }

        const nextActivationState = this.resolveStargateActivationState(entity);
        const currentStableActivationState = coerceStableActivationState(
          entity.activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        );
        if (currentStableActivationState === nextActivationState) {
          continue;
        }

        if (
          animateOpenTransitions &&
          currentStableActivationState === STARGATE_ACTIVATION_STATE.CLOSED &&
          nextActivationState === STARGATE_ACTIVATION_STATE.OPEN
        ) {
          entity.activationState = STARGATE_ACTIVATION_STATE.ACTIVATING;
          entity.activationTransitionAtMs =
            now + STARGATE_ACTIVATION_TRANSITION_MS;
        } else {
          entity.activationState = nextActivationState;
          entity.activationTransitionAtMs = 0;
        }
        if (!changedByScene.has(scene)) {
          changedByScene.set(scene, []);
        }
        changedByScene.get(scene).push(entity);
      }
    }

    if (options.broadcast !== false) {
      for (const [scene, entities] of changedByScene.entries()) {
        scene.broadcastSlimItemChanges(entities);
      }
    }

    return [...changedByScene.entries()].flatMap(([scene, entities]) =>
      entities.map((entity) => ({
        systemID: scene.systemID,
        itemID: entity.itemID,
        activationState: entity.activationState,
      })),
    );
  }

  setSolarSystemStargateActivationState(systemID, activationState, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return [];
    }

    if (activationState === undefined || activationState === null) {
      this.solarSystemGateActivationOverrides.delete(numericSystemID);
    } else {
      this.solarSystemGateActivationOverrides.set(
        numericSystemID,
        coerceStableActivationState(
          activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        ),
      );
    }

    return this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
      targetSystemID: numericSystemID,
    });
  }

  setStargateActivationState(stargateID, activationState, options = {}) {
    const numericStargateID = toInt(stargateID, 0);
    if (!numericStargateID) {
      return [];
    }

    if (activationState === undefined || activationState === null) {
      this.stargateActivationOverrides.delete(numericStargateID);
    } else {
      this.stargateActivationOverrides.set(
        numericStargateID,
        coerceStableActivationState(
          activationState,
          STARGATE_ACTIVATION_STATE.CLOSED,
        ),
      );
    }

    return this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
      targetGateID: numericStargateID,
    });
  }

  preloadSolarSystems(systemIDs, options = {}) {
    const preloadList = Array.isArray(systemIDs) ? systemIDs : [systemIDs];
    for (const systemID of preloadList) {
      const numericSystemID = toInt(systemID, 0);
      if (!numericSystemID) {
        continue;
      }
      this.ensureScene(numericSystemID, { refreshStargates: false });
    }

    return this.refreshStargateActivationStates({
      broadcast: options.broadcast !== false,
    });
  }

  preloadStartupSolarSystems(options = {}) {
    return this.preloadSolarSystems(STARTUP_PRELOADED_SYSTEM_IDS, options);
  }

  ensureScene(systemID, options = {}) {
    const numericSystemID = toInt(systemID, 0);
    if (!numericSystemID) {
      return null;
    }

    let created = false;
    if (!this.scenes.has(numericSystemID)) {
      this.scenes.set(numericSystemID, new SolarSystemScene(numericSystemID));
      created = true;
    }
    const scene = this.scenes.get(numericSystemID);
    if (created && options.refreshStargates !== false) {
      this.refreshStargateActivationStates({
        broadcast: options.broadcastStargateChanges !== false,
      });
    }
    return scene;
  }

  getSceneForSession(session) {
    if (!session || !session._space) {
      return null;
    }

    return this.scenes.get(Number(session._space.systemID)) || null;
  }

  getEntity(session, entityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getEntityByID(entityID) : null;
  }

  attachSession(session, shipItem, options = {}) {
    if (session && session._space) {
      this.detachSession(session, { broadcast: false });
    }

    const numericSystemID =
      Number(options.systemID || session.solarsystemid || session.solarsystemid2 || 0);
    if (!numericSystemID) {
      return null;
    }

    const scene = this.ensureScene(numericSystemID);
    return scene.attachSession(session, shipItem, options);
  }

  detachSession(session, options = {}) {
    if (!session || !session._space) {
      return;
    }

    const scene = this.scenes.get(Number(session._space.systemID));
    if (scene) {
      scene.detachSession(session, options);
    } else {
      session._space = null;
    }
  }

  markBeyonceBound(session) {
    const scene = this.getSceneForSession(session);
    if (scene) {
      scene.markBeyonceBound(session);
    }
  }

  ensureInitialBallpark(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.ensureInitialBallpark(session, options) : false;
  }

  gotoDirection(session, direction) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.gotoDirection(session, direction) : false;
  }

  alignTo(session, targetEntityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.alignTo(session, targetEntityID) : false;
  }

  followBall(session, targetEntityID, range, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.followBall(session, targetEntityID, range, options) : false;
  }

  orbit(session, targetEntityID, distanceValue) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.orbit(session, targetEntityID, distanceValue) : false;
  }

  warpToEntity(session, targetEntityID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.warpToEntity(session, targetEntityID, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  warpToPoint(session, point, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.warpToPoint(session, point, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  setSpeedFraction(session, fraction) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.setSpeedFraction(session, fraction) : false;
  }

  stop(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.stop(session) : false;
  }

  playSpecialFx(session, guid, options = {}) {
    if (!session || !session._space) {
      return {
        success: false,
        errorMsg: "NOT_IN_SPACE",
      };
    }

    if (!isReadyForDestiny(session)) {
      return {
        success: false,
        errorMsg: "DESTINY_NOT_READY",
      };
    }

    const scene = this.getSceneForSession(session);
    if (!scene) {
      return {
        success: false,
        errorMsg: "SCENE_NOT_FOUND",
      };
    }

    const {
      shipID: requestedShipID = null,
      debugAutoTarget = null,
      debugAutoTargetRangeMeters = DEBUG_TEST_AUTO_TARGET_DEFAULT_RANGE_METERS,
      debugOnly = false,
      ...fxOptions
    } = options || {};
    const shipID = Number(requestedShipID || session._space.shipID || 0) || 0;
    if (!shipID) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const entity = scene.getEntityByID(shipID);
    if (!entity) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const resolvedFxOptions = { ...fxOptions };
    let debugAutoTargetResult = null;
    const hasExplicitTargetID = Number(resolvedFxOptions.targetID || 0) > 0;
    if (!hasExplicitTargetID && debugAutoTarget === "nearest_station") {
      debugAutoTargetResult = resolveDebugTestNearestStationTarget(
        scene,
        entity,
        debugAutoTargetRangeMeters,
      );
      if (debugAutoTargetResult.success) {
        resolvedFxOptions.targetID = debugAutoTargetResult.data.target.itemID;
      } else {
        const stopLikeRequest =
          resolvedFxOptions.start === false || resolvedFxOptions.active === false;
        if (!stopLikeRequest) {
          return {
            success: false,
            errorMsg: debugAutoTargetResult.errorMsg,
            data: {
              ...(debugAutoTargetResult.data || {}),
              debugAutoTarget,
              debugOnly,
            },
          };
        }
      }
    }

    const stamp = getNextStamp();
    scene.sendDestinyUpdates(session, [
      {
        stamp,
        payload: destiny.buildOnSpecialFXPayload(shipID, guid, resolvedFxOptions),
      },
    ]);
    return {
      success: true,
      data: {
        autoTarget:
          debugAutoTargetResult && debugAutoTargetResult.success
            ? {
                mode: debugAutoTarget,
                maxRangeMeters: debugAutoTargetResult.data.maxRangeMeters,
                distanceMeters: debugAutoTargetResult.data.nearestDistanceMeters,
                targetID: debugAutoTargetResult.data.target.itemID,
                targetName:
                  debugAutoTargetResult.data.target.itemName ||
                  `station ${debugAutoTargetResult.data.target.itemID}`,
              }
            : null,
        debugOnly,
        guid: String(guid || ""),
        shipID,
        stamp,
      },
    };
  }

  getStationInteractionRadius(station) {
    return getStationInteractionRadius(station);
  }

  getStationUndockSpawnState(station) {
    return getStationUndockSpawnState(station);
  }

  canDockAtStation(session, stationID, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
    const entity = this.getEntity(session, session && session._space ? session._space.shipID : null);
    const station = worldData.getStationByID(stationID);
    if (!entity || !station) {
      return false;
    }

    return canShipDockAtStation(entity, station, maxDistance);
  }

  getDockingDebugState(session, stationID, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
    const entity = this.getEntity(
      session,
      session && session._space ? session._space.shipID : null,
    );
    const station = worldData.getStationByID(stationID);
    return buildDockingDebugState(entity, station, maxDistance);
  }

  acceptDocking(session, stationID) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.acceptDocking(session, stationID)
      : {
          success: false,
          errorMsg: "SCENE_NOT_FOUND",
        };
  }

  tick() {
    const now = Date.now();
    for (const scene of this.scenes.values()) {
      scene.tick(now);
    }
  }
}

module.exports = new SpaceRuntime();
module.exports._testing = {
  BUBBLE_RADIUS_METERS,
  BUBBLE_HYSTERESIS_METERS,
  STARGATE_ACTIVATION_STATE,
  STARGATE_ACTIVATION_TRANSITION_MS,
  STARTUP_PRELOADED_SYSTEM_IDS,
  ACTIVE_SUBWARP_WATCHER_CORRECTION_INTERVAL_MS,
  ACTIVE_SUBWARP_WATCHER_POSITION_CORRECTION_INTERVAL_MS,
  WATCHER_CORRECTION_INTERVAL_MS,
  WATCHER_POSITION_CORRECTION_INTERVAL_MS,
  buildPositionVelocityCorrectionUpdates,
  getWatcherCorrectionIntervalMs,
  getWatcherPositionCorrectionIntervalMs,
  usesActiveSubwarpWatcherCorrections,
  buildShipEntityForTesting: buildShipEntity,
  applyDesiredVelocityForTesting: applyDesiredVelocity,
  deriveAgilitySecondsForTesting: deriveAgilitySeconds,
  evaluatePendingWarpForTesting: evaluatePendingWarp,
  buildWarpPrepareDispatchForTesting: buildWarpPrepareDispatch,
  buildPilotWarpActivationStateRefreshUpdatesForTesting:
    buildPilotWarpActivationStateRefreshUpdates,
  buildPilotWarpActivationUpdatesForTesting: buildPilotWarpActivationUpdates,
  buildWarpStartEffectUpdateForTesting: buildWarpStartEffectUpdate,
  buildDirectedMovementUpdatesForTesting: buildDirectedMovementUpdates,
  buildStaticStargateEntityForTesting: buildStaticStargateEntity,
  getSharedWorldPosition,
  getStargateDerivedDunRotation,
  resetStargateActivationOverrides() {
    module.exports.solarSystemGateActivationOverrides.clear();
    module.exports.stargateActivationOverrides.clear();
  },
  clearScenes() {
    module.exports.scenes.clear();
  },
  getSecurityStatusIconKey,
  resolveShipSkinMaterialSetID,
};
