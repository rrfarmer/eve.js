const path = require("path");

const {
  buildDict,
  buildKeyVal,
  buildList,
  buildRowset,
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));

const BALL_MODE = Object.freeze({
  GOTO: 0,
  FOLLOW: 1,
  STOP: 2,
  WARP: 3,
  ORBIT: 4,
  RIGID: 11,
});

const BALL_FLAG = Object.freeze({
  IS_FREE: 0x01,
  IS_GLOBAL: 0x02,
  IS_MASSIVE: 0x04,
  IS_INTERACTIVE: 0x08,
});

const SOL_ITEM_COLUMNS = [
  ["itemID", 0x14],
  ["typeID", 0x03],
  ["ownerID", 0x03],
  ["locationID", 0x14],
  ["flagID", 0x02],
  ["contraband", 0x0b],
  ["singleton", 0x02],
  ["quantity", 0x03],
  ["groupID", 0x03],
  ["categoryID", 0x03],
  ["customInfo", 0x81],
];

const DRONE_STATE_HEADERS = [
  "droneID",
  "ownerID",
  "controllerID",
  "activityState",
  "typeID",
  "controllerOwnerID",
  "targetID",
];
const STARGATE_JUMP_HEADERS = ["toCelestialID", "locationID"];
const CLIENT_ROWSET_NAME = "eve.common.script.sys.rowset.Rowset";

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt32(value, fallback = 0) {
  return Math.trunc(toFiniteNumber(value, fallback));
}

function buildVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function buildMarshalReal(value, fallback = 0) {
  return { type: "real", value: toFiniteNumber(value, fallback) };
}

function buildMarshalRealVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  const vector = buildVector(source, fallback);
  return {
    x: buildMarshalReal(vector.x, fallback.x),
    y: buildMarshalReal(vector.y, fallback.y),
    z: buildMarshalReal(vector.z, fallback.z),
  };
}

function normalizeVector(source = null, fallback = { x: 1, y: 0, z: 0 }) {
  const vector = buildVector(source, fallback);
  const length = Math.sqrt(
    (vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2),
  );
  if (!Number.isFinite(length) || length <= 0) {
    return buildVector(fallback);
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function buildRowDescriptor(columns) {
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "blue.DBRowDescriptor" },
      [columns],
    ],
    list: [],
    dict: [],
  };
}

function buildPackedRow(columns, fields) {
  return {
    type: "packedrow",
    header: buildRowDescriptor(columns),
    columns,
    fields,
  };
}

function pushBigInt64(chunks, value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(
    typeof value === "bigint" ? value : BigInt(Math.trunc(toFiniteNumber(value, 0))),
    0,
  );
  chunks.push(buffer);
}

function pushInt32(chunks, value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(toInt32(value, 0), 0);
  chunks.push(buffer);
}

function pushUInt8(chunks, value) {
  chunks.push(Buffer.from([toInt32(value, 0) & 0xff]));
}

function pushFloat(chunks, value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(toFiniteNumber(value, 0), 0);
  chunks.push(buffer);
}

function pushDouble(chunks, value) {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(toFiniteNumber(value, 0), 0);
  chunks.push(buffer);
}

function encodeHeader(packetType, stamp) {
  const buffer = Buffer.alloc(5);
  buffer.writeUInt8(packetType, 0);
  buffer.writeUInt32LE(toInt32(stamp, 0) >>> 0, 1);
  return buffer;
}

function encodeRigidBall(entity) {
  const position = buildVector(entity.position);
  const flags =
    (entity.kind === "station" || entity.kind === "stargate"
      ? BALL_FLAG.IS_GLOBAL | BALL_FLAG.IS_MASSIVE
      : BALL_FLAG.IS_GLOBAL);
  const chunks = [];
  pushBigInt64(chunks, entity.itemID);
  pushUInt8(chunks, BALL_MODE.RIGID);
  pushFloat(chunks, toFiniteNumber(entity.radius, 1));
  pushDouble(chunks, position.x);
  pushDouble(chunks, position.y);
  pushDouble(chunks, position.z);
  pushUInt8(chunks, flags);
  pushUInt8(chunks, 0xff);
  return Buffer.concat(chunks);
}

function getShipMode(entity) {
  switch (entity && entity.mode) {
    case "GOTO":
      return BALL_MODE.GOTO;
    case "FOLLOW":
      return BALL_MODE.FOLLOW;
    case "WARP":
      return BALL_MODE.WARP;
    case "ORBIT":
      return BALL_MODE.ORBIT;
    default:
      return BALL_MODE.STOP;
  }
}

function getShipTargetPoint(entity) {
  if (entity && entity.targetPoint) {
    return buildVector(entity.targetPoint);
  }

  const direction = normalizeVector(entity && entity.direction, { x: 1, y: 0, z: 0 });
  const position = buildVector(entity && entity.position);
  return {
    x: position.x + (direction.x * 1.0e16),
    y: position.y + (direction.y * 1.0e16),
    z: position.z + (direction.z * 1.0e16),
  };
}

function getShipDirection(entity) {
  if (entity && entity.direction) {
    return normalizeVector(entity.direction, { x: 1, y: 0, z: 0 });
  }

  if (entity && entity.targetPoint && entity.position) {
    return normalizeVector({
      x: entity.targetPoint.x - entity.position.x,
      y: entity.targetPoint.y - entity.position.y,
      z: entity.targetPoint.z - entity.position.z,
    }, { x: 1, y: 0, z: 0 });
  }

  return { x: 1, y: 0, z: 0 };
}

function getShipWarpFactor(entity) {
  const warpState = entity && entity.warpState;
  return toInt32(
    (warpState && warpState.warpSpeed) ||
      (toFiniteNumber(entity && entity.warpSpeedAU, 0) > 0
        ? Math.round(entity.warpSpeedAU * 10)
        : 30),
    30,
  );
}

function encodeShipBall(entity) {
  const position = buildVector(entity.position);
  const velocity = buildVector(entity.velocity);
  const mode = getShipMode(entity);
  const chunks = [];
  pushBigInt64(chunks, entity.itemID);
  pushUInt8(chunks, mode);
  pushFloat(chunks, toFiniteNumber(entity.radius, 1));
  pushDouble(chunks, position.x);
  pushDouble(chunks, position.y);
  pushDouble(chunks, position.z);
  pushUInt8(chunks, BALL_FLAG.IS_FREE | BALL_FLAG.IS_INTERACTIVE);

  pushDouble(chunks, toFiniteNumber(entity.mass, 1_000_000));
  pushUInt8(chunks, 0);
  pushBigInt64(chunks, entity.allianceID || -1);
  pushInt32(chunks, entity.corporationID || 0);
  pushInt32(chunks, 0);

  pushFloat(chunks, toFiniteNumber(entity.maxVelocity, 0));
  pushDouble(chunks, velocity.x);
  pushDouble(chunks, velocity.y);
  pushDouble(chunks, velocity.z);
  pushFloat(chunks, toFiniteNumber(entity.inertia, 1));
  pushFloat(chunks, toFiniteNumber(entity.speedFraction, 0));

  pushUInt8(chunks, 0xff);
  switch (mode) {
    case BALL_MODE.GOTO: {
      const targetPoint = getShipTargetPoint(entity);
      pushDouble(chunks, targetPoint.x);
      pushDouble(chunks, targetPoint.y);
      pushDouble(chunks, targetPoint.z);
      break;
    }
    case BALL_MODE.FOLLOW:
      pushBigInt64(chunks, entity.targetEntityID || 0);
      pushFloat(chunks, toFiniteNumber(entity.followRange, 0));
      break;
    case BALL_MODE.WARP: {
      const targetPoint = getShipTargetPoint(entity);
      const warpState = entity && entity.warpState;
      pushDouble(chunks, targetPoint.x);
      pushDouble(chunks, targetPoint.y);
      pushDouble(chunks, targetPoint.z);
      // Raw mode-3 state in the bootstrap/state buffers follows the later
      // DLL-backed SetState decode we mapped for V23.02:
      // goto + effectStamp + totalDistance + stopDistance + warpFactor.
      pushInt32(chunks, toInt32(warpState && warpState.effectStamp, 0));
      pushDouble(chunks, toFiniteNumber(warpState && warpState.totalDistance, 0));
      pushDouble(chunks, toFiniteNumber(warpState && warpState.stopDistance, 0));
      pushInt32(chunks, getShipWarpFactor(entity));
      break;
    }
    case BALL_MODE.ORBIT:
      pushInt32(chunks, toInt32(entity.targetEntityID, 0));
      pushDouble(chunks, toFiniteNumber(entity.orbitDistance, 0));
      break;
    default:
      break;
  }
  return Buffer.concat(chunks);
}

function encodeEntityBall(entity) {
  if (entity.kind === "ship") {
    return encodeShipBall(entity);
  }

  return encodeRigidBall(entity);
}

function describeBallMode(mode) {
  switch (mode) {
    case BALL_MODE.GOTO:
      return "GOTO";
    case BALL_MODE.FOLLOW:
      return "FOLLOW";
    case BALL_MODE.STOP:
      return "STOP";
    case BALL_MODE.WARP:
      return "WARP";
    case BALL_MODE.ORBIT:
      return "ORBIT";
    case BALL_MODE.RIGID:
      return "RIGID";
    default:
      return `UNKNOWN_${mode}`;
  }
}

function describeBallFlags(flags) {
  return {
    byte: flags,
    isFree: (flags & BALL_FLAG.IS_FREE) !== 0,
    isGlobal: (flags & BALL_FLAG.IS_GLOBAL) !== 0,
    isMassive: (flags & BALL_FLAG.IS_MASSIVE) !== 0,
    isInteractive: (flags & BALL_FLAG.IS_INTERACTIVE) !== 0,
  };
}

function debugDescribeEntityBall(entity) {
  const encoded = encodeEntityBall(entity);
  if (entity.kind === "ship") {
    const mode = getShipMode(entity);
    const flags = BALL_FLAG.IS_FREE | BALL_FLAG.IS_INTERACTIVE;
    const summary = {
      kind: entity.kind,
      itemID: entity.itemID,
      mode: describeBallMode(mode),
      modeCode: mode,
      flags: describeBallFlags(flags),
      radius: toFiniteNumber(entity.radius, 1),
      position: buildVector(entity.position),
      mass: toFiniteNumber(entity.mass, 1_000_000),
      allianceID: entity.allianceID || -1,
      corporationID: entity.corporationID || 0,
      maxVelocity: toFiniteNumber(entity.maxVelocity, 0),
      velocity: buildVector(entity.velocity),
      inertia: toFiniteNumber(entity.inertia, 1),
      speedFraction: toFiniteNumber(entity.speedFraction, 0),
      modeData: null,
    };
    if (mode === BALL_MODE.GOTO) {
      summary.modeData = {
        targetPoint: getShipTargetPoint(entity),
      };
    } else if (mode === BALL_MODE.FOLLOW) {
      summary.modeData = {
        targetEntityID: entity.targetEntityID || 0,
        followRange: toFiniteNumber(entity.followRange, 0),
      };
    } else if (mode === BALL_MODE.WARP) {
      const warpState = entity && entity.warpState;
      summary.modeData = {
        targetPoint: getShipTargetPoint(entity),
        effectStamp: toInt32(warpState && warpState.effectStamp, 0),
        totalDistance: toFiniteNumber(warpState && warpState.totalDistance, 0),
        stopDistance: toFiniteNumber(warpState && warpState.stopDistance, 0),
        warpFactor: getShipWarpFactor(entity),
      };
    } else if (mode === BALL_MODE.ORBIT) {
      summary.modeData = {
        targetEntityID: entity.targetEntityID || 0,
        orbitDistance: toFiniteNumber(entity.orbitDistance, 0),
      };
    }
    return {
      encodedLength: encoded.length,
      encodedHex: encoded.toString("hex"),
      summary,
    };
  }

  const flags =
    entity.kind === "station" || entity.kind === "stargate"
      ? BALL_FLAG.IS_GLOBAL | BALL_FLAG.IS_MASSIVE
      : BALL_FLAG.IS_GLOBAL;
  return {
    encodedLength: encoded.length,
    encodedHex: encoded.toString("hex"),
    summary: {
      kind: entity.kind,
      itemID: entity.itemID,
      mode: "RIGID",
      modeCode: BALL_MODE.RIGID,
      flags: describeBallFlags(flags),
      radius: toFiniteNumber(entity.radius, 1),
      position: buildVector(entity.position),
    },
  };
}

function buildDamageState(entity) {
  return [
    [1.0, 110000.0, { type: "long", value: currentFileTime() }],
    1.0,
    1.0,
  ];
}

function buildSlimItemDict(entity) {
  const entries = [
    ["itemID", entity.itemID],
    ["typeID", entity.typeID],
    ["ownerID", entity.ownerID || 0],
  ];

  if (entity.itemName) {
    entries.push(["name", entity.itemName]);
  }
  if (entity.groupID !== undefined && entity.groupID !== null) {
    entries.push(["groupID", entity.groupID]);
  }
  if (entity.categoryID !== undefined && entity.categoryID !== null) {
    entries.push(["categoryID", entity.categoryID]);
  }

  if (entity.kind === "ship") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["charID", entity.characterID || 0]);
    entries.push(["skinMaterialSetID", entity.skinMaterialSetID ?? null]);
    entries.push(["modules", buildList([])]);
    entries.push(["securityStatus", 0.0]);
    entries.push(["bounty", 0.0]);
  } else if (entity.kind === "station") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["online", 1]);
    entries.push(["incapacitated", 0]);
    entries.push(["activityLevel", entity.activityLevel ?? null]);
    entries.push(["skinMaterialSetID", entity.skinMaterialSetID ?? null]);
    if (entity.celestialEffect !== undefined && entity.celestialEffect !== null) {
      entries.push(["celestialEffect", entity.celestialEffect]);
    }
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
  } else if (entity.kind === "stargate") {
    entries.push(["nameID", null]);
    entries.push(["activationState", entity.activationState ?? 2]);
    entries.push(["poseID", entity.poseID ?? 0]);
    entries.push([
      "localCorruptionStageAndMaximum",
      buildList(entity.localCorruptionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "destinationCorruptionStageAndMaximum",
      buildList(entity.destinationCorruptionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "localSuppressionStageAndMaximum",
      buildList(entity.localSuppressionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "destinationSuppressionStageAndMaximum",
      buildList(entity.destinationSuppressionStageAndMaximum || [0, 1]),
    ]);
    entries.push([
      "hasVolumetricDrifterCloud",
      entity.hasVolumetricDrifterCloud ? 1 : 0,
    ]);
    entries.push(["originSystemOwnerID", entity.originSystemOwnerID ?? null]);
    entries.push([
      "destinationSystemOwnerID",
      entity.destinationSystemOwnerID ?? null,
    ]);
    entries.push([
      "destinationSystemStatusIcons",
      buildList(entity.destinationSystemStatusIcons || []),
    ]);
    entries.push([
      "destinationSystemWarning",
      entity.destinationSystemWarning ?? null,
    ]);
    entries.push([
      "destinationSystemWarningIcon",
      entity.destinationSystemWarningIcon ?? null,
    ]);
    if (Array.isArray(entity.dunRotation) && entity.dunRotation.length === 3) {
      entries.push(["dunRotation", entity.dunRotation]);
    }
    entries.push(["jumps", buildStargateJumps(entity)]);
  }

  return buildDict(entries);
}

function buildSlimItemObject(entity) {
  return {
    type: "object",
    name: "foo.SlimItem",
    args: buildSlimItemDict(entity),
  };
}

function buildDroneState() {
  // V23.02 rejects util.Rowset here during remote SetState unmarshal.
  return buildRowset(DRONE_STATE_HEADERS, [], CLIENT_ROWSET_NAME);
}

function buildStargateJumps(entity) {
  const rows =
    entity && entity.destinationID && entity.destinationSolarSystemID
      ? [[entity.destinationID, entity.destinationSolarSystemID]]
      : [];

  return buildRowset(STARGATE_JUMP_HEADERS, rows, CLIENT_ROWSET_NAME);
}

function buildSolItem(system) {
  return buildPackedRow(SOL_ITEM_COLUMNS, {
    itemID: system.solarSystemID,
    typeID: 5,
    ownerID: 1,
    locationID: system.constellationID,
    flagID: 0,
    contraband: false,
    singleton: 1,
    quantity: -1,
    groupID: 5,
    categoryID: 2,
    customInfo: "",
  });
}

function buildAddBallsStateBuffer(stamp, entities) {
  const chunks = [encodeHeader(1, stamp)];
  for (const entity of entities) {
    chunks.push(encodeEntityBall(entity));
  }
  return Buffer.concat(chunks);
}

function buildSetStateBuffer(stamp, entities) {
  const chunks = [encodeHeader(0, stamp)];
  for (const entity of entities) {
    chunks.push(encodeEntityBall(entity));
  }
  return Buffer.concat(chunks);
}

function buildAddBalls2Payload(stateStamp, entities) {
  const extraBallData = entities.map((entity) => {
    if (entity.kind === "ship" || entity.kind === "station") {
      return [buildSlimItemDict(entity), buildDamageState(entity)];
    }
    return buildSlimItemDict(entity);
  });

  return [
    "AddBalls2",
    [
      [
        buildAddBallsStateBuffer(stateStamp, entities),
        buildList(extraBallData),
      ],
    ],
  ];
}

function buildSetStatePayload(stateStamp, system, egoEntityID, entities) {
  const damageEntries = entities
    .filter((entity) => entity.kind === "ship" || entity.kind === "station")
    .map((entity) => [entity.itemID, buildDamageState(entity)]);

  const state = buildKeyVal([
    ["stamp", stateStamp],
    ["state", buildSetStateBuffer(stateStamp, entities)],
    ["ego", egoEntityID],
    ["industryLevel", 0],
    ["researchLevel", 0],
    ["damageState", buildDict(damageEntries)],
    ["dbuffState", buildDict([])],
    ["aggressors", buildDict([])],
    ["droneState", buildDroneState()],
    ["slims", buildList(entities.map((entity) => buildSlimItemObject(entity)))],
    ["solItem", buildSolItem(system)],
    ["effectStates", buildList([])],
    ["allianceBridges", buildList([])],
  ]);

  return ["SetState", [state]];
}

function buildDestinyUpdatePayload(updates, waitForBubble = false) {
  return [buildList(updates.map((update) => [update.stamp, update.payload])), waitForBubble];
}

function buildGotoDirectionPayload(entityID, direction) {
  const vector = buildMarshalRealVector(direction);
  return ["GotoDirection", [entityID, vector.x, vector.y, vector.z]];
}

function buildGotoPointPayload(entityID, point) {
  const vector = buildMarshalRealVector(point);
  return ["GotoPoint", [entityID, vector.x, vector.y, vector.z]];
}

function buildFollowBallPayload(entityID, targetID, range) {
  return ["FollowBall", [entityID, targetID, toInt32(range, 0)]];
}

function buildWarpToPayload(entityID, destination, distance, warpSpeed) {
  const vector = buildMarshalRealVector(destination);
  return [
    "WarpTo",
    [
      entityID,
      vector.x,
      vector.y,
      vector.z,
      buildMarshalReal(distance, 0),
      toInt32(warpSpeed, 30),
    ],
  ];
}

function buildAddBallPayload(
  entityID,
  {
    mass = 0,
    radius = 0,
    maxSpeed = 0,
    isFree = true,
    isGlobal = false,
    isMassive = false,
    isInteractive = true,
    isMoribund = false,
    position = null,
    velocity = null,
    inertia = 1,
    speedFraction = 0,
  } = {},
) {
  const positionVector = buildMarshalRealVector(position);
  const velocityVector = buildMarshalRealVector(velocity);
  return [
    "AddBall",
    [
      entityID,
      buildMarshalReal(mass, 0),
      buildMarshalReal(radius, 0),
      buildMarshalReal(maxSpeed, 0),
      isFree ? 1 : 0,
      isGlobal ? 1 : 0,
      isMassive ? 1 : 0,
      isInteractive ? 1 : 0,
      isMoribund ? 1 : 0,
      positionVector.x,
      positionVector.y,
      positionVector.z,
      velocityVector.x,
      velocityVector.y,
      velocityVector.z,
      buildMarshalReal(inertia, 1),
      buildMarshalReal(speedFraction, 0),
    ],
  ];
}

function buildEntityWarpInPayload(entityID, destination, warpFactor) {
  const vector = buildMarshalRealVector(destination);
  return [
    "EntityWarpIn",
    [
      entityID,
      vector.x,
      vector.y,
      vector.z,
      toInt32(warpFactor, 0),
    ],
  ];
}

function buildOrbitPayload(entityID, orbitEntityID, distance) {
  return ["Orbit", [entityID, orbitEntityID, toInt32(distance, 0)]];
}

function buildSetSpeedFractionPayload(entityID, fraction) {
  return ["SetSpeedFraction", [entityID, buildMarshalReal(fraction, 0)]];
}

function buildStopPayload(entityID) {
  return ["Stop", [entityID]];
}

function buildSetBallVelocityPayload(entityID, velocity) {
  const vector = buildMarshalRealVector(velocity);
  return ["SetBallVelocity", [entityID, vector.x, vector.y, vector.z]];
}

function buildSetBallPositionPayload(entityID, position) {
  const vector = buildMarshalRealVector(position);
  return ["SetBallPosition", [entityID, vector.x, vector.y, vector.z]];
}

function buildOnDockingAcceptedPayload(shipPosition, stationPosition, stationID) {
  return [toInt32(stationID, 0)];
}

function buildSetBallAgilityPayload(entityID, agility) {
  return ["SetBallAgility", [entityID, buildMarshalReal(agility, 0)]];
}

function buildSetBallMassPayload(entityID, mass) {
  return ["SetBallMass", [entityID, buildMarshalReal(mass, 0)]];
}

function buildSetMaxSpeedPayload(entityID, speed) {
  return [
    "SetMaxSpeed",
    [entityID, buildMarshalReal(speed, 0)],
  ];
}

function buildSetBallMassivePayload(entityID, isMassive) {
  return ["SetBallMassive", [entityID, isMassive ? 1 : 0]];
}

function normalizeGraphicInfo(graphicInfo) {
  if (graphicInfo === undefined) {
    return undefined;
  }
  if (
    graphicInfo === null ||
    (graphicInfo && typeof graphicInfo === "object" && graphicInfo.type)
  ) {
    return graphicInfo;
  }
  if (graphicInfo && typeof graphicInfo === "object" && !Array.isArray(graphicInfo)) {
    return buildDict(Object.entries(graphicInfo));
  }
  return graphicInfo;
}

function buildOnSpecialFXPayload(
  entityID,
  guid,
  {
    moduleID = null,
    moduleTypeID = null,
    targetID = null,
    chargeTypeID = null,
    isOffensive = false,
    start = true,
    active = true,
    duration,
    repeat,
    startTime,
    timeFromStart,
    graphicInfo,
  } = {},
) {
  const args = [
    entityID,
    moduleID,
    moduleTypeID,
    targetID,
    chargeTypeID,
    String(guid || ""),
    isOffensive ? 1 : 0,
    start ? 1 : 0,
    active ? 1 : 0,
  ];
  // Michelle's live signature always reserves the full optional tail:
  // duration, repeat, startTime, timeFromStart, graphicInfo.
  args.push(
    duration === undefined ? -1 : toFiniteNumber(duration, -1),
    repeat === undefined ? null : repeat,
    startTime === undefined ? null : startTime,
    timeFromStart === undefined ? 0 : toFiniteNumber(timeFromStart, 0),
    graphicInfo === undefined ? null : normalizeGraphicInfo(graphicInfo),
  );
  return ["OnSpecialFX", args];
}

function buildOnSlimItemChangePayload(entityID, slimItem = null) {
  return [
    "OnSlimItemChange",
    [
      toInt32(entityID, 0),
      slimItem || null,
    ],
  ];
}

function buildRemoveBallPayload(entityID) {
  return ["RemoveBall", [entityID]];
}

function buildRemoveBallsPayload(entityIDs) {
  return ["RemoveBalls", [{ type: "list", items: entityIDs }]];
}

module.exports = {
  buildDamageState,
  buildSlimItemDict,
  buildSlimItemObject,
  buildAddBalls2Payload,
  buildSetStatePayload,
  buildDestinyUpdatePayload,
  buildGotoDirectionPayload,
  buildGotoPointPayload,
  buildFollowBallPayload,
  buildAddBallPayload,
  buildWarpToPayload,
  buildEntityWarpInPayload,
  buildOrbitPayload,
  buildSetSpeedFractionPayload,
  buildStopPayload,
  buildSetBallVelocityPayload,
  buildSetBallPositionPayload,
  buildOnDockingAcceptedPayload,
  buildSetBallAgilityPayload,
  buildSetBallMassPayload,
  buildSetMaxSpeedPayload,
  buildSetBallMassivePayload,
  buildOnSpecialFXPayload,
  buildOnSlimItemChangePayload,
  buildRemoveBallPayload,
  buildRemoveBallsPayload,
  debugDescribeEntityBall,
};
