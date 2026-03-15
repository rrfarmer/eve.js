const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));
const worldData = require(path.join(__dirname, "../../server/src/space/worldData"));

function getDictValue(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return undefined;
  }

  const match = dict.entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

function getListItems(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }

  return [];
}

function getRowsetLines(rowset) {
  if (
    !rowset ||
    rowset.type !== "object" ||
    !rowset.args ||
    rowset.args.type !== "dict"
  ) {
    return [];
  }

  return getListItems(getDictValue(rowset.args, "lines"));
}

function getPseudoSecurity(system) {
  const security = Math.max(0, Math.min(1, Number(system && system.security) || 0));
  if (security > 0 && security < 0.05) {
    return 0.05;
  }

  return security;
}

function getSecurityClass(system) {
  const security = getPseudoSecurity(system);
  if (security <= 0) {
    return 0;
  }
  if (security < 0.45) {
    return 1;
  }
  return 2;
}

function isHazardousSecurityTransition(sourceSystem, destinationSystem) {
  const sourceSecurityClass = getSecurityClass(sourceSystem);
  const destinationSecurityClass = getSecurityClass(destinationSystem);
  return (
    (sourceSecurityClass === 2 && destinationSecurityClass !== 2) ||
    (sourceSecurityClass === 1 && destinationSecurityClass === 0)
  );
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function magnitude(vector) {
  return Math.sqrt(
    (toFiniteNumber(vector && vector.x, 0) ** 2) +
    (toFiniteNumber(vector && vector.y, 0) ** 2) +
    (toFiniteNumber(vector && vector.z, 0) ** 2),
  );
}

function normalizeVector(vector) {
  const length = magnitude(vector);
  assert(length > 0, "Expected non-zero vector");
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function quatFromYawPitchRollDegrees(rotation) {
  const yaw = (Number(rotation[0]) || 0) * (Math.PI / 180);
  const pitch = (Number(rotation[1]) || 0) * (Math.PI / 180);
  const roll = (Number(rotation[2]) || 0) * (Math.PI / 180);
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const sp = Math.sin(pitch / 2);
  const cp = Math.cos(pitch / 2);
  const sr = Math.sin(roll / 2);
  const cr = Math.cos(roll / 2);
  return {
    x: (cy * sp * cr) + (sy * cp * sr),
    y: (sy * cp * cr) - (cy * sp * sr),
    z: (cy * cp * sr) - (sy * sp * cr),
    w: (cy * cp * cr) + (sy * sp * sr),
  };
}

function rotateVectorByQuaternion(vector, quaternion) {
  const x = toFiniteNumber(vector && vector.x, 0);
  const y = toFiniteNumber(vector && vector.y, 0);
  const z = toFiniteNumber(vector && vector.z, 0);
  const qx = toFiniteNumber(quaternion && quaternion.x, 0);
  const qy = toFiniteNumber(quaternion && quaternion.y, 0);
  const qz = toFiniteNumber(quaternion && quaternion.z, 0);
  const qw = toFiniteNumber(quaternion && quaternion.w, 1);
  const ix = (qw * x) + (qy * z) - (qz * y);
  const iy = (qw * y) + (qz * x) - (qx * z);
  const iz = (qw * z) + (qx * y) - (qy * x);
  const iw = (-qx * x) - (qy * y) - (qz * z);
  return {
    x: (ix * qw) + (iw * -qx) + (iy * -qz) - (iz * -qy),
    y: (iy * qw) + (iw * -qy) + (iz * -qx) - (ix * -qz),
    z: (iz * qw) + (iw * -qz) + (ix * -qy) - (iy * -qx),
  };
}

function buildSharedWorldPosition(systemPosition, localPosition) {
  return {
    x: toFiniteNumber(systemPosition && systemPosition.x, 0) - toFiniteNumber(localPosition && localPosition.x, 0),
    y: toFiniteNumber(systemPosition && systemPosition.y, 0) + toFiniteNumber(localPosition && localPosition.y, 0),
    z: toFiniteNumber(systemPosition && systemPosition.z, 0) + toFiniteNumber(localPosition && localPosition.z, 0),
  };
}

function assertVectorsClose(actual, expected, tolerance, message) {
  const delta = subtractVectors(actual, expected);
  assert(
    magnitude(delta) <= tolerance,
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function main() {
  const systemID = 30000142;
  const stargates = worldData.getStargatesForSystem(systemID);
  assert(stargates.length > 0, `No stargates exported for system ${systemID}`);

  const sourceGate = worldData.getStargateByID(50001248) || stargates[0];
  const sourceSystem = worldData.getSolarSystemByID(sourceGate.solarSystemID);
  const destinationSystem = worldData.getSolarSystemByID(
    sourceGate.destinationSolarSystemID,
  );
  const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
  assert(sourceSystem, "Source solar system not found");
  assert(destinationSystem, "Destination solar system not found");
  assert(destinationGate, "Destination gate not found");

  const expectedForward = normalizeVector(
    subtractVectors(
      buildSharedWorldPosition(destinationSystem.position, destinationGate.position),
      buildSharedWorldPosition(sourceSystem.position, sourceGate.position),
    ),
  );

  const scene = runtime.ensureScene(systemID);
  const gateEntity = scene.getEntityByID(sourceGate.itemID);
  assert(gateEntity, `Scene missing stargate ${sourceGate.itemID}`);
  assert.strictEqual(gateEntity.kind, "stargate", "Entity kind should be stargate");
  assert.strictEqual(gateEntity.groupID, 10, "Stargate groupID should come from canonical type metadata");
  assert.strictEqual(gateEntity.categoryID, 2, "Stargate categoryID should come from canonical type metadata");
  assert(gateEntity.graphicID, "Stargate should expose canonical graphicID metadata");
  assert(
    Array.isArray(gateEntity.dunRotation) && gateEntity.dunRotation.length === 3,
    "Stargate should expose a shared-world derived dunRotation fallback",
  );
  assert(
    scene.getAllVisibleEntities().some((entity) => entity.itemID === sourceGate.itemID),
    "Stargate should be part of the live visible scene set",
  );

  const expectedOriginOwnerID = Number(sourceSystem.factionID || 0) || null;
  const expectedDestinationOwnerID = Number(destinationSystem.factionID || 0) || null;
  const expectedStatusIcons = [
    runtime._testing.getSecurityStatusIconKey(destinationSystem),
  ];
  const expectedWarningIcon = isHazardousSecurityTransition(
    sourceSystem,
    destinationSystem,
  )
    ? "stargate_travelwarning3.dds"
    : null;
  const expectedActivationState = runtime.resolveStargateActivationState(sourceGate);

  assert.strictEqual(
    gateEntity.activationState,
    expectedActivationState,
    "Stargate activationState should follow live destination-system availability",
  );
  assert.strictEqual(gateEntity.poseID, 0, "Default stargate poseID should be 0");
  assert.deepStrictEqual(
    gateEntity.destinationSystemStatusIcons,
    expectedStatusIcons,
    "Stargate should expose destination security status icons",
  );
  assert.strictEqual(
    gateEntity.originSystemOwnerID,
    expectedOriginOwnerID,
    "Stargate origin owner should match source system faction",
  );
  assert.strictEqual(
    gateEntity.destinationSystemOwnerID,
    expectedDestinationOwnerID,
    "Stargate destination owner should match destination system faction",
  );
  assert.strictEqual(
    gateEntity.destinationSystemWarningIcon,
    expectedWarningIcon,
    "Stargate warning icon should follow security-transition risk",
  );
  assertVectorsClose(
    rotateVectorByQuaternion(
      { x: 0, y: 0, z: 1 },
      quatFromYawPitchRollDegrees(gateEntity.dunRotation),
    ),
    expectedForward,
    0.000001,
    "Derived dunRotation should face the destination gate in shared-world space",
  );

  const slim = destiny.buildSlimItemDict(gateEntity);
  const slimKeys = slim.entries.map(([key]) => key);
  assert(slimKeys.includes("activationState"), "Stargate slim should include activationState");
  assert(slimKeys.includes("poseID"), "Stargate slim should include poseID");
  assert(
    slimKeys.includes("destinationSystemStatusIcons"),
    "Stargate slim should include destinationSystemStatusIcons",
  );
  assert(slimKeys.includes("jumps"), "Stargate slim should include jumps");
  assert.strictEqual(
    getDictValue(slim, "activationState"),
    expectedActivationState,
    "Slim activationState should match entity",
  );
  assert.strictEqual(
    getDictValue(slim, "poseID"),
    0,
    "Slim poseID should match entity",
  );
  assert.strictEqual(
    getDictValue(slim, "originSystemOwnerID"),
    expectedOriginOwnerID,
    "Slim origin owner should match source system faction",
  );
  assert.strictEqual(
    getDictValue(slim, "destinationSystemOwnerID"),
    expectedDestinationOwnerID,
    "Slim destination owner should match destination system faction",
  );
  assert.deepStrictEqual(
    getListItems(getDictValue(slim, "destinationSystemStatusIcons")),
    expectedStatusIcons,
    "Slim destinationSystemStatusIcons should expose the derived security icon",
  );
  assert.strictEqual(
    getDictValue(slim, "destinationSystemWarningIcon"),
    expectedWarningIcon,
    "Slim warning icon should match entity",
  );
  assert.deepStrictEqual(
    getDictValue(slim, "dunRotation"),
    gateEntity.dunRotation,
    "Slim dunRotation should match the derived entity rotation",
  );
  assert.deepStrictEqual(
    getRowsetLines(getDictValue(slim, "jumps")),
    [[sourceGate.destinationID, sourceGate.destinationSolarSystemID]],
    "Slim jumps rowset should expose destination gate and destination system",
  );

  console.log(JSON.stringify({
    ok: true,
    gateID: sourceGate.itemID,
    activationState: gateEntity.activationState,
    expectedActivationState,
    poseID: gateEntity.poseID,
    originSystemOwnerID: gateEntity.originSystemOwnerID,
    destinationSystemOwnerID: gateEntity.destinationSystemOwnerID,
    destinationSystemStatusIcons: gateEntity.destinationSystemStatusIcons,
    destinationSystemWarningIcon: gateEntity.destinationSystemWarningIcon,
    dunRotation: gateEntity.dunRotation,
    expectedForward,
    slimKeys,
  }, null, 2));
}

main();
