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

function doubleToInt64Bits(value) {
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeDoubleLE(toFiniteNumber(value, 0), 0);
  return buffer.readBigInt64LE(0);
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
      const warpState = entity.warpState || {};
      pushDouble(chunks, targetPoint.x);
      pushDouble(chunks, targetPoint.y);
      pushDouble(chunks, targetPoint.z);
      pushInt32(chunks, toInt32(warpState.effectStamp, 0));
      pushBigInt64(
        chunks,
        doubleToInt64Bits(
          toFiniteNumber(warpState.followRangeMarker, -1),
        ),
      );
      pushBigInt64(
        chunks,
        doubleToInt64Bits(
          toFiniteNumber(warpState.followID, 15000),
        ),
      );
      pushInt32(
        chunks,
        toInt32(
          warpState.warpSpeed ||
            (toFiniteNumber(entity.warpSpeedAU, 0) > 0
              ? Math.round(entity.warpSpeedAU * 10)
              : 30),
          30,
        ),
      );
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
    entries.push(["modules", buildList([])]);
    entries.push(["securityStatus", 0.0]);
    entries.push(["bounty", 0.0]);
  } else if (entity.kind === "station") {
    entries.push(["corpID", entity.corporationID || 0]);
    entries.push(["allianceID", entity.allianceID || 0]);
    entries.push(["warFactionID", entity.warFactionID || 0]);
    entries.push(["online", 1]);
    entries.push(["incapacitated", 0]);
  } else if (entity.kind === "stargate") {
    entries.push(["nameID", null]);
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
  const vector = buildVector(direction);
  return ["GotoDirection", [entityID, vector.x, vector.y, vector.z]];
}

function buildAlignToPayload(entityID) {
  return ["AlignTo", [entityID]];
}

function buildFollowBallPayload(entityID, targetID, range) {
  return ["FollowBall", [entityID, targetID, toInt32(range, 0)]];
}

function buildWarpToPayload(entityID, destination, distance, warpSpeed) {
  const vector = buildVector(destination);
  return [
    "WarpTo",
    [
      entityID,
      vector.x,
      vector.y,
      vector.z,
      toInt32(distance, 0),
      toInt32(warpSpeed, 30),
    ],
  ];
}

function buildOrbitPayload(entityID, orbitEntityID, distance) {
  return ["Orbit", [entityID, orbitEntityID, toInt32(distance, 0)]];
}

function buildSetSpeedFractionPayload(entityID, fraction) {
  return ["SetSpeedFraction", [entityID, toFiniteNumber(fraction, 0)]];
}

function buildStopPayload(entityID) {
  return ["Stop", [entityID]];
}

function buildSetBallVelocityPayload(entityID, velocity) {
  const vector = buildVector(velocity);
  return ["SetBallVelocity", [entityID, vector.x, vector.y, vector.z]];
}

function buildSetBallPositionPayload(entityID, position) {
  const vector = buildVector(position);
  return ["SetBallPosition", [entityID, vector.x, vector.y, vector.z]];
}

function buildOnDockingAcceptedPayload(shipPosition, stationPosition, stationID) {
  const ship = buildVector(shipPosition);
  const station = buildVector(stationPosition);
  return [
    [ship.x, ship.y, ship.z],
    [station.x, station.y, station.z],
    toInt32(stationID, 0),
  ];
}

function buildSetBallAgilityPayload(entityID, agility) {
  return ["SetBallAgility", [entityID, toFiniteNumber(agility, 0)]];
}

function buildSetBallMassPayload(entityID, mass) {
  return ["SetBallMass", [entityID, toFiniteNumber(mass, 0)]];
}

function buildSetMaxSpeedPayload(entityID, speed) {
  return ["SetMaxSpeed", [entityID, toFiniteNumber(speed, 0)]];
}

function buildSetBallMassivePayload(entityID, isMassive) {
  return ["SetBallMassive", [entityID, isMassive ? 1 : 0]];
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
  if (
    duration !== undefined ||
    repeat !== undefined ||
    startTime !== undefined ||
    graphicInfo !== undefined
  ) {
    args.push(
      duration === undefined ? -1 : toFiniteNumber(duration, -1),
      repeat === undefined ? null : repeat,
      startTime === undefined ? null : startTime,
      graphicInfo === undefined ? null : graphicInfo,
    );
  }
  return ["OnSpecialFX", args];
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
  buildAlignToPayload,
  buildFollowBallPayload,
  buildWarpToPayload,
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
  buildRemoveBallPayload,
  buildRemoveBallsPayload,
};
