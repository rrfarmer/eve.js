const fs = require("fs");
const path = require("path");
const readline = require("readline");

const MOVEMENT_ATTRIBUTE_IDS = new Set([37, 70, 162, 552, 600]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function englishText(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (typeof value.en === "string" && value.en) {
      return value.en;
    }
    const firstText = Object.values(value).find(
      (entry) => typeof entry === "string" && entry,
    );
    return firstText || null;
  }

  return null;
}

function roundCoordinate(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(3));
}

function buildVector(vector = {}) {
  return {
    x: roundCoordinate(toNumber(vector.x) || 0),
    y: roundCoordinate(toNumber(vector.y) || 0),
    z: roundCoordinate(toNumber(vector.z) || 0),
  };
}

function sameNumber(left, right) {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true;
  }

  const numericLeft = Number(left);
  const numericRight = Number(right);
  if (!Number.isFinite(numericLeft) || !Number.isFinite(numericRight)) {
    return false;
  }

  return Math.abs(numericLeft - numericRight) < 1e-9;
}

function sameValue(left, right) {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true;
  }

  if (typeof left === "number" || typeof right === "number") {
    return sameNumber(left, right);
  }

  return left === right;
}

function sameVector(left, right) {
  if ((left === null || left === undefined) && (right === null || right === undefined)) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const normalizedLeft = buildVector(left);
  const normalizedRight = buildVector(right);
  return (
    sameNumber(normalizedLeft.x, normalizedRight.x) &&
    sameNumber(normalizedLeft.y, normalizedRight.y) &&
    sameNumber(normalizedLeft.z, normalizedRight.z)
  );
}

function pushMismatch(bucket, id, field, localValue, upstreamValue, sampleLimit = 15) {
  if (bucket.samples.length >= sampleLimit) {
    return;
  }

  bucket.samples.push({
    id,
    field,
    local: localValue,
    upstream: upstreamValue,
  });
}

function createMismatchBucket() {
  return {
    mismatchCount: 0,
    samples: [],
  };
}

function compareRecordFields(bucket, id, localRecord, upstreamRecord, fields) {
  for (const field of fields) {
    if (!sameValue(localRecord && localRecord[field], upstreamRecord && upstreamRecord[field])) {
      bucket.mismatchCount += 1;
      pushMismatch(
        bucket,
        id,
        field,
        localRecord && localRecord[field],
        upstreamRecord && upstreamRecord[field],
      );
    }
  }
}

function compareVectorField(bucket, id, field, localRecord, upstreamRecord) {
  if (!sameVector(localRecord && localRecord[field], upstreamRecord && upstreamRecord[field])) {
    bucket.mismatchCount += 1;
    pushMismatch(
      bucket,
      id,
      field,
      localRecord && localRecord[field],
      upstreamRecord && upstreamRecord[field],
    );
  }
}

function romanNumeral(value) {
  const number = toNumber(value);
  if (!Number.isInteger(number) || number <= 0) {
    return String(value || "");
  }

  const numerals = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];

  let remainder = number;
  let output = "";
  for (const [numeric, symbol] of numerals) {
    while (remainder >= numeric) {
      output += symbol;
      remainder -= numeric;
    }
  }

  return output;
}

function buildTypeRecord(typeRow, groupRow) {
  return {
    typeID: toNumber(typeRow._key),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || null,
    groupName: englishText(groupRow && groupRow.name),
    name: englishText(typeRow.name),
    mass: toNumber(typeRow.mass),
    volume: toNumber(typeRow.volume),
    capacity: toNumber(typeRow.capacity),
    portionSize: toNumber(typeRow.portionSize),
    raceID: toNumber(typeRow.raceID),
    basePrice: toNumber(typeRow.basePrice),
    marketGroupID: toNumber(typeRow.marketGroupID),
    iconID: toNumber(typeRow.iconID),
    soundID: toNumber(typeRow.soundID),
    graphicID: toNumber(typeRow.graphicID),
    radius: toNumber(typeRow.radius),
  };
}

function getGroupRow(groupsById, groupID) {
  return Number.isInteger(groupID) ? groupsById.get(groupID) || null : null;
}

function buildMovementRecord(typeRow, dogmaRow, groupsById) {
  const attributes = new Map(
    (Array.isArray(dogmaRow && dogmaRow.dogmaAttributes) ? dogmaRow.dogmaAttributes : [])
      .map((entry) => [toNumber(entry.attributeID), toNumber(entry.value)]),
  );
  const groupRow = getGroupRow(groupsById, toNumber(typeRow.groupID));
  const categoryID = toNumber(groupRow && groupRow.categoryID);
  const radius =
    attributes.get(162) ??
    toNumber(typeRow.radius) ??
    attributes.get(552) ??
    (categoryID === 6 ? 50 : null);
  const mass = toNumber(typeRow.mass);
  const inertia = attributes.get(70) ?? null;

  return {
    typeID: toNumber(typeRow._key),
    mass,
    maxVelocity: attributes.get(37) ?? null,
    inertia,
    radius,
    signatureRadius: attributes.get(552) ?? null,
    warpSpeedMultiplier: attributes.get(600) ?? null,
    alignTime:
      mass && inertia
        ? Number(((-Math.log(0.25) * ((mass / 1_000_000) * inertia))).toFixed(6))
        : null,
    maxAccelerationTime:
      mass && inertia
        ? Number(((-Math.log(0.0001) * ((mass / 1_000_000) * inertia))).toFixed(6))
        : null,
  };
}

function getOrbitDescriptor(orbitID, orbitLookups) {
  const numericOrbitID = toNumber(orbitID);
  if (!Number.isInteger(numericOrbitID) || numericOrbitID <= 0) {
    return null;
  }

  for (const [kind, rowsById] of orbitLookups) {
    if (rowsById.has(numericOrbitID)) {
      return {
        kind,
        row: rowsById.get(numericOrbitID),
      };
    }
  }

  return null;
}

function buildOrbitName(orbitDescriptor, mapSolarSystemsById, orbitLookups) {
  if (!orbitDescriptor || !orbitDescriptor.row) {
    return null;
  }

  const orbitRow = orbitDescriptor.row;
  const systemRow = mapSolarSystemsById.get(toNumber(orbitRow.solarSystemID)) || null;
  const systemName = englishText(systemRow && systemRow.name) || "System";

  if (orbitDescriptor.kind === "star") {
    return `${systemName} - Star`;
  }
  if (orbitDescriptor.kind === "planet") {
    return (
      englishText(orbitRow.uniqueName) ||
      englishText(orbitRow.name) ||
      `${systemName} ${romanNumeral(orbitRow.celestialIndex)}`
    );
  }
  if (orbitDescriptor.kind === "moon") {
    const parentOrbit = getOrbitDescriptor(orbitRow.orbitID, orbitLookups);
    const parentName =
      buildOrbitName(parentOrbit, mapSolarSystemsById, orbitLookups) ||
      `${systemName} ${romanNumeral(orbitRow.celestialIndex)}`;
    return `${parentName} - Moon ${toNumber(orbitRow.orbitIndex) || 0}`;
  }
  if (orbitDescriptor.kind === "asteroidBelt") {
    const parentOrbit = getOrbitDescriptor(orbitRow.orbitID, orbitLookups);
    const parentName = buildOrbitName(parentOrbit, mapSolarSystemsById, orbitLookups) || systemName;
    return `${parentName} - Asteroid Belt ${toNumber(orbitRow.orbitIndex) || 0}`;
  }

  return null;
}

function buildStationTypeRecord(typeRow, groupRow) {
  return {
    stationTypeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || 3,
    groupName: englishText(groupRow && groupRow.name) || "Station",
    raceID: toNumber(typeRow.raceID),
    graphicID: toNumber(typeRow.graphicID),
    radius: toNumber(typeRow.radius),
    basePrice: toNumber(typeRow.basePrice),
    volume: toNumber(typeRow.volume),
    portionSize: toNumber(typeRow.portionSize),
    published: Boolean(typeRow.published),
  };
}

function buildStargateTypeRecord(typeRow, groupRow) {
  return {
    typeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Stargate",
    raceID: toNumber(typeRow.raceID),
    graphicID: toNumber(typeRow.graphicID),
    published: Boolean(typeRow.published),
  };
}

function buildStationCoreRecord({
  stationRow,
  systemRow,
  constellationRow,
  regionRow,
  typeRow,
  groupRow,
  typesById,
  groupsById,
  orbitDescriptor,
  mapSolarSystemsById,
  orbitLookups,
}) {
  const orbitRow = orbitDescriptor && orbitDescriptor.row ? orbitDescriptor.row : null;
  const orbitTypeID = toNumber(orbitRow && orbitRow.typeID);
  const orbitTypeRow =
    Number.isInteger(orbitTypeID) ? typesById.get(orbitTypeID) || null : null;

  return {
    stationID: toNumber(stationRow._key),
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    operationID: toNumber(stationRow.operationID),
    stationTypeID: toNumber(stationRow.typeID),
    corporationID: toNumber(stationRow.ownerID),
    solarSystemID: toNumber(stationRow.solarSystemID) || 0,
    solarSystemName: englishText(systemRow && systemRow.name) || null,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    constellationName: englishText(constellationRow && constellationRow.name) || null,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    regionName: englishText(regionRow && regionRow.name) || null,
    position: buildVector(stationRow.position),
    reprocessingEfficiency: toNumber(stationRow.reprocessingEfficiency),
    reprocessingStationsTake: toNumber(stationRow.reprocessingStationsTake),
    reprocessingHangarFlag: toNumber(stationRow.reprocessingHangarFlag),
    itemID: toNumber(stationRow._key),
    groupID: toNumber(typeRow.groupID) || 15,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 3,
    orbitID: toNumber(stationRow.orbitID),
    orbitName: buildOrbitName(orbitDescriptor, mapSolarSystemsById, orbitLookups),
    orbitGroupID: toNumber(orbitTypeRow && orbitTypeRow.groupID),
    orbitTypeID,
    orbitKind: orbitDescriptor ? orbitDescriptor.kind : null,
    stationTypeName: englishText(typeRow.name),
    stationRaceID: toNumber(typeRow.raceID),
    stationGraphicID: toNumber(typeRow.graphicID),
    radius: toNumber(typeRow.radius),
    useOperationName: Boolean(stationRow.useOperationName),
  };
}

function integerArray(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => toNumber(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
}

function compareIdSets(localIds, upstreamIds, sampleLimit = 15) {
  const localSet = new Set(integerArray(localIds));
  const upstreamSet = new Set(integerArray(upstreamIds));
  const missingLocally = [...upstreamSet]
    .filter((id) => !localSet.has(id))
    .sort((left, right) => left - right);
  const extraLocally = [...localSet]
    .filter((id) => !upstreamSet.has(id))
    .sort((left, right) => left - right);

  return {
    localCount: localSet.size,
    upstreamCount: upstreamSet.size,
    missingLocallyCount: missingLocally.length,
    extraLocallyCount: extraLocally.length,
    missingLocallySample: missingLocally.slice(0, sampleLimit),
    extraLocallySample: extraLocally.slice(0, sampleLimit),
  };
}

async function loadJsonlMap(filePath, idSelector) {
  const rows = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    const id = toNumber(idSelector(row));
    if (!Number.isInteger(id) || id <= 0) {
      continue;
    }

    rows.set(id, row);
  }

  return rows;
}

async function collectJsonlSet(filePath, valueSelector) {
  const values = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    for (const value of valueSelector(row) || []) {
      const numeric = toNumber(value);
      if (Number.isInteger(numeric) && numeric > 0) {
        values.add(numeric);
      }
    }
  }

  return values;
}

function getLocalTableArray(localRoot, key) {
  return Array.isArray(localRoot && localRoot[key]) ? localRoot[key] : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const jsonlDir = path.resolve(
    args.jsonlDir ||
      path.join(repoRoot, "data", "eve-online-static-data-3253748-jsonl"),
  );
  const localDbRoot = path.resolve(
    args.localDbRoot ||
      path.join(repoRoot, "server", "src", "database", "data"),
  );
  const outputPath = path.resolve(
    args.output ||
      path.join(repoRoot, "_local", "reports", "jsonl-local-static-data-report.json"),
  );

  const [
    groupsById,
    typesById,
    dogmaAttributesById,
    mapConstellationsById,
    mapRegionsById,
    mapSolarSystemsById,
    npcStationsById,
    mapStargatesById,
    mapStarsById,
    mapPlanetsById,
    mapMoonsById,
    mapAsteroidBeltsById,
  ] = await Promise.all([
    loadJsonlMap(path.join(jsonlDir, "groups.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "types.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "dogmaAttributes.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapConstellations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapRegions.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapSolarSystems.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "npcStations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStargates.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStars.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapPlanets.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapMoons.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapAsteroidBelts.jsonl"), (row) => row._key),
  ]);

  const publishedShipTypeIDs = [];
  const publishedSkillTypeIDs = [];
  for (const [typeID, typeRow] of typesById.entries()) {
    const groupID = toNumber(typeRow.groupID);
    const groupRow = groupID ? groupsById.get(groupID) || null : null;
    const categoryID = toNumber(groupRow && groupRow.categoryID);
    const groupPublished =
      groupRow && Object.prototype.hasOwnProperty.call(groupRow, "published")
        ? Boolean(groupRow.published)
        : false;
    const typePublished =
      typeRow && Object.prototype.hasOwnProperty.call(typeRow, "published")
        ? Boolean(typeRow.published)
        : false;

    if (categoryID === 6 && typePublished) {
      publishedShipTypeIDs.push(typeID);
    }
    if (categoryID === 16 && groupPublished && typePublished) {
      publishedSkillTypeIDs.push(typeID);
    }
  }

  const stationTypeIDs = integerArray(
    [...npcStationsById.values()].map((row) => row.typeID),
  );
  const stargateTypeIDs = integerArray(
    [...mapStargatesById.values()].map((row) => row.typeID),
  );
  const stationOrbitIDs = integerArray(
    [...npcStationsById.values()].map((row) => row.orbitID),
  );
  const orbitLookup = new Map([
    ...mapStarsById.entries(),
    ...mapPlanetsById.entries(),
    ...mapMoonsById.entries(),
    ...mapAsteroidBeltsById.entries(),
  ]);
  const derivedCelestialIDs = new Set([
    ...mapStarsById.keys(),
    ...mapPlanetsById.keys(),
  ]);
  for (const orbitID of stationOrbitIDs) {
    if (orbitLookup.has(orbitID)) {
      derivedCelestialIDs.add(orbitID);
    }
  }

  const relevantMovementTypeIDs = new Set([
    ...publishedShipTypeIDs,
    ...stationTypeIDs,
    ...[...mapStarsById.values()].map((row) => row.typeID),
    ...[...mapPlanetsById.values()].map((row) => row.typeID),
    ...[...mapMoonsById.values()].map((row) => row.typeID),
    ...[...mapAsteroidBeltsById.values()].map((row) => row.typeID),
    ...[...mapStargatesById.values()].map((row) => row.typeID),
  ].map((value) => toNumber(value)).filter((value) => Number.isInteger(value) && value > 0));

  const publishedShipTypeIdSet = new Set(publishedShipTypeIDs);
  const upstreamShipDogmaTypes = new Set();
  let upstreamShipDogmaAttributeRows = 0;
  let upstreamMovementTypeIDsWithRows = 0;
  const seenMovementTypes = new Set();
  const typeDogmaById = new Map();
  const typeDogmaPath = path.join(jsonlDir, "typeDogma.jsonl");
  const typeDogmaRl = readline.createInterface({
    input: fs.createReadStream(typeDogmaPath),
    crlfDelay: Infinity,
  });
  for await (const line of typeDogmaRl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    const typeID = toNumber(row._key);
    if (!Number.isInteger(typeID) || typeID <= 0) {
      continue;
    }

    const attributes = Array.isArray(row.dogmaAttributes) ? row.dogmaAttributes : [];
    if (publishedShipTypeIdSet.has(typeID)) {
      upstreamShipDogmaTypes.add(typeID);
      upstreamShipDogmaAttributeRows += attributes.filter((entry) => (
        Number.isInteger(toNumber(entry && entry.attributeID))
      )).length;
      typeDogmaById.set(typeID, row);
    }

    if (relevantMovementTypeIDs.has(typeID)) {
      seenMovementTypes.add(typeID);
      typeDogmaById.set(typeID, row);
      if (attributes.some((entry) => MOVEMENT_ATTRIBUTE_IDS.has(toNumber(entry && entry.attributeID)))) {
        upstreamMovementTypeIDsWithRows += 1;
      }
    }
  }

  const localCatalog = readJson(path.join(localDbRoot, "shipCosmeticsCatalog", "data.json"));
  const localShipTypes = readJson(path.join(localDbRoot, "shipTypes", "data.json"));
  const localSkillTypes = readJson(path.join(localDbRoot, "skillTypes", "data.json"));
  const localSolarSystems = readJson(path.join(localDbRoot, "solarSystems", "data.json"));
  const localStations = readJson(path.join(localDbRoot, "stations", "data.json"));
  const localStationTypes = readJson(path.join(localDbRoot, "stationTypes", "data.json"));
  const localStargateTypes = readJson(path.join(localDbRoot, "stargateTypes", "data.json"));
  const localStargates = readJson(path.join(localDbRoot, "stargates", "data.json"));
  const localCelestials = readJson(path.join(localDbRoot, "celestials", "data.json"));
  const localMovementAttributes = readJson(path.join(localDbRoot, "movementAttributes", "data.json"));
  const localShipDogma = readJson(path.join(localDbRoot, "shipDogmaAttributes", "data.json"));
  const orbitLookups = new Map([
    ["star", mapStarsById],
    ["planet", mapPlanetsById],
    ["moon", mapMoonsById],
    ["asteroidBelt", mapAsteroidBeltsById],
  ]);

  const shipTypeValueCheck = createMismatchBucket();
  const localShipRowsById = new Map(
    getLocalTableArray(localShipTypes, "ships").map((row) => [Number(row.typeID), row]),
  );
  for (const typeID of publishedShipTypeIDs) {
    const typeRow = typesById.get(typeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildTypeRecord(typeRow, groupRow);
    const localRecord = localShipRowsById.get(typeID) || null;
    compareRecordFields(
      shipTypeValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      [
        "groupID",
        "categoryID",
        "groupName",
        "name",
        "mass",
        "volume",
        "capacity",
        "portionSize",
        "raceID",
        "basePrice",
        "marketGroupID",
        "iconID",
        "soundID",
        "graphicID",
        "radius",
      ],
    );
  }

  const stationTypeValueCheck = createMismatchBucket();
  const localStationTypeRowsById = new Map(
    getLocalTableArray(localStationTypes, "stationTypes")
      .map((row) => [Number(row.stationTypeID), row]),
  );
  for (const stationTypeID of stationTypeIDs) {
    const typeRow = typesById.get(stationTypeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildStationTypeRecord(typeRow, groupRow);
    const localRecord = localStationTypeRowsById.get(stationTypeID) || null;
    compareRecordFields(
      stationTypeValueCheck,
      stationTypeID,
      localRecord,
      upstreamRecord,
      [
        "typeName",
        "groupID",
        "categoryID",
        "groupName",
        "raceID",
        "graphicID",
        "radius",
        "basePrice",
        "volume",
        "portionSize",
        "published",
      ],
    );
  }

  const stargateTypeValueCheck = createMismatchBucket();
  const localStargateTypeRowsById = new Map(
    getLocalTableArray(localStargateTypes, "stargateTypes")
      .map((row) => [Number(row.typeID), row]),
  );
  for (const typeID of stargateTypeIDs) {
    const typeRow = typesById.get(typeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const upstreamRecord = buildStargateTypeRecord(typeRow, groupRow);
    const localRecord = localStargateTypeRowsById.get(typeID) || null;
    compareRecordFields(
      stargateTypeValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      [
        "typeName",
        "groupID",
        "categoryID",
        "groupName",
        "raceID",
        "graphicID",
        "published",
      ],
    );
  }

  const stationValueCheck = createMismatchBucket();
  const localStationRowsById = new Map(
    getLocalTableArray(localStations, "stations").map((row) => [Number(row.stationID), row]),
  );
  for (const [stationID, stationRow] of npcStationsById.entries()) {
    const systemRow = mapSolarSystemsById.get(toNumber(stationRow.solarSystemID)) || null;
    const constellationRow =
      mapConstellationsById.get(toNumber(systemRow && systemRow.constellationID)) || null;
    const regionRow =
      mapRegionsById.get(toNumber(systemRow && systemRow.regionID)) || null;
    const typeRow = typesById.get(toNumber(stationRow.typeID)) || null;
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    const orbitDescriptor = getOrbitDescriptor(stationRow.orbitID, orbitLookups);
    const upstreamRecord = buildStationCoreRecord({
      stationRow,
      systemRow,
      constellationRow,
      regionRow,
      typeRow,
      groupRow,
      typesById,
      groupsById,
      orbitDescriptor,
      mapSolarSystemsById,
      orbitLookups,
    });
    const localRecord = localStationRowsById.get(stationID) || null;
    compareRecordFields(
      stationValueCheck,
      stationID,
      localRecord,
      upstreamRecord,
      [
        "security",
        "operationID",
        "stationTypeID",
        "corporationID",
        "solarSystemID",
        "solarSystemName",
        "constellationID",
        "constellationName",
        "regionID",
        "regionName",
        "reprocessingEfficiency",
        "reprocessingStationsTake",
        "reprocessingHangarFlag",
        "itemID",
        "groupID",
        "categoryID",
        "orbitID",
        "orbitName",
        "orbitGroupID",
        "orbitTypeID",
        "orbitKind",
        "stationTypeName",
        "stationRaceID",
        "stationGraphicID",
        "radius",
        "useOperationName",
      ],
    );
    compareVectorField(stationValueCheck, stationID, "position", localRecord, upstreamRecord);
  }

  const movementValueCheck = createMismatchBucket();
  const localMovementRowsById = new Map(
    getLocalTableArray(localMovementAttributes, "attributes")
      .map((row) => [Number(row.typeID), row]),
  );
  for (const typeID of relevantMovementTypeIDs) {
    const typeRow = typesById.get(typeID);
    if (!typeRow) {
      continue;
    }
    const localRecord = localMovementRowsById.get(typeID) || null;
    const upstreamRecord = buildMovementRecord(
      typeRow,
      typeDogmaById.get(typeID) || null,
      groupsById,
    );
    compareRecordFields(
      movementValueCheck,
      typeID,
      localRecord,
      upstreamRecord,
      [
        "mass",
        "maxVelocity",
        "inertia",
        "radius",
        "signatureRadius",
        "warpSpeedMultiplier",
        "alignTime",
        "maxAccelerationTime",
      ],
    );
  }

  const shipDogmaValueCheck = {
    missingLocallyCount: 0,
    extraLocallyCount: 0,
    valueMismatchCount: 0,
    samples: [],
  };
  for (const typeID of publishedShipTypeIDs) {
    const upstreamRow = typeDogmaById.get(typeID) || null;
    const upstreamAttributes = Object.fromEntries(
      (Array.isArray(upstreamRow && upstreamRow.dogmaAttributes)
        ? upstreamRow.dogmaAttributes
        : [])
        .map((entry) => [String(toNumber(entry.attributeID)), toNumber(entry.value)])
        .filter(([attributeID, value]) => Number.isInteger(toNumber(attributeID)) && value !== null),
    );
    const localEntry = localShipDogma.shipAttributesByTypeID
      ? localShipDogma.shipAttributesByTypeID[String(typeID)] || null
      : null;
    const localAttributes =
      localEntry && localEntry.attributes && typeof localEntry.attributes === "object"
        ? localEntry.attributes
        : {};
    const upstreamKeys = new Set(Object.keys(upstreamAttributes));
    const localKeys = new Set(Object.keys(localAttributes));

    for (const attributeID of upstreamKeys) {
      if (!localKeys.has(attributeID)) {
        shipDogmaValueCheck.missingLocallyCount += 1;
        pushMismatch(
          shipDogmaValueCheck,
          typeID,
          `missing:${attributeID}`,
          null,
          upstreamAttributes[attributeID],
        );
        continue;
      }

      if (!sameValue(localAttributes[attributeID], upstreamAttributes[attributeID])) {
        shipDogmaValueCheck.valueMismatchCount += 1;
        pushMismatch(
          shipDogmaValueCheck,
          typeID,
          `attribute:${attributeID}`,
          localAttributes[attributeID],
          upstreamAttributes[attributeID],
        );
      }
    }

    for (const attributeID of localKeys) {
      if (!upstreamKeys.has(attributeID)) {
        shipDogmaValueCheck.extraLocallyCount += 1;
        pushMismatch(
          shipDogmaValueCheck,
          typeID,
          `extra:${attributeID}`,
          localAttributes[attributeID],
          null,
        );
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    jsonlDir,
    localDbRoot,
    tables: {
      "shipCosmeticsCatalog.skins": compareIdSets(
        Object.keys(localCatalog.skinsBySkinID || {}).map(Number),
        [...await collectJsonlSet(path.join(jsonlDir, "skins.jsonl"), (row) => [row._key])],
      ),
      "shipCosmeticsCatalog.licenseTypes": compareIdSets(
        Object.keys(localCatalog.licenseTypesByTypeID || {}).map(Number),
        [...await collectJsonlSet(path.join(jsonlDir, "skinLicenses.jsonl"), (row) => [row.licenseTypeID || row._key])],
      ),
      "shipCosmeticsCatalog.materials": compareIdSets(
        Object.keys(localCatalog.materialsByMaterialID || {}).map(Number),
        [...await collectJsonlSet(path.join(jsonlDir, "skinMaterials.jsonl"), (row) => [row._key])],
      ),
      shipTypes: compareIdSets(
        getLocalTableArray(localShipTypes, "ships").map((row) => row.typeID),
        publishedShipTypeIDs,
      ),
      "shipTypes.values": shipTypeValueCheck,
      skillTypes: compareIdSets(
        getLocalTableArray(localSkillTypes, "skills").map((row) => row.typeID),
        publishedSkillTypeIDs,
      ),
      solarSystems: compareIdSets(
        getLocalTableArray(localSolarSystems, "solarSystems").map((row) => row.solarSystemID),
        [...mapSolarSystemsById.keys()],
      ),
      stations: compareIdSets(
        getLocalTableArray(localStations, "stations").map((row) => row.stationID),
        [...npcStationsById.keys()],
      ),
      "stations.values": stationValueCheck,
      stationTypes: compareIdSets(
        getLocalTableArray(localStationTypes, "stationTypes").map((row) => row.stationTypeID),
        stationTypeIDs,
      ),
      "stationTypes.values": stationTypeValueCheck,
      stargateTypes: compareIdSets(
        getLocalTableArray(localStargateTypes, "stargateTypes").map((row) => row.typeID),
        stargateTypeIDs,
      ),
      "stargateTypes.values": stargateTypeValueCheck,
      stargates: compareIdSets(
        getLocalTableArray(localStargates, "stargates").map((row) => row.itemID),
        [...mapStargatesById.keys()],
      ),
      celestials: compareIdSets(
        getLocalTableArray(localCelestials, "celestials").map((row) => row.itemID),
        [...derivedCelestialIDs],
      ),
      movementAttributes: compareIdSets(
        getLocalTableArray(localMovementAttributes, "attributes").map((row) => row.typeID),
        [...relevantMovementTypeIDs],
      ),
      "movementAttributes.values": movementValueCheck,
      "shipDogmaAttributes.shipTypes": compareIdSets(
        Object.keys(localShipDogma.shipAttributesByTypeID || {}).map(Number),
        [...upstreamShipDogmaTypes],
      ),
      "shipDogmaAttributes.attributeTypes": compareIdSets(
        Object.keys(localShipDogma.attributeTypesByID || {}).map(Number),
        [...dogmaAttributesById.keys()],
      ),
      "shipDogmaAttributes.attributeRows": {
        localCount: toNumber(localShipDogma.counts && localShipDogma.counts.totalAttributes) || 0,
        upstreamCount: upstreamShipDogmaAttributeRows,
        missingLocallyCount: Math.max(
          upstreamShipDogmaAttributeRows -
            (toNumber(localShipDogma.counts && localShipDogma.counts.totalAttributes) || 0),
          0,
        ),
        extraLocallyCount: Math.max(
          (toNumber(localShipDogma.counts && localShipDogma.counts.totalAttributes) || 0) -
            upstreamShipDogmaAttributeRows,
          0,
        ),
      },
      "shipDogmaAttributes.values": shipDogmaValueCheck,
    },
    notes: {
      accounts: "Runtime table, no static JSONL equivalent.",
      characters: "Runtime table, no static JSONL equivalent.",
      items: "Runtime table, no static JSONL equivalent.",
      skills: "Per-character runtime state, no direct static JSONL equivalent.",
      shipCosmetics: "Runtime ownership/applied-skin state, no static JSONL equivalent.",
      celestials:
        "Compared against a derived JSONL set: all stars, all planets, and station orbit objects referenced by npcStations.orbitID.",
      movementAttributes:
        `Compared against derived relevant type IDs (${relevantMovementTypeIDs.size}) from published ships plus station, star, planet, moon, asteroid belt, and stargate types.`,
      stations:
        "Value checks cover authoritative JSONL core fields only. Dock/undock geometry remains a preserved local extension because the JSONL SDE does not ship those transforms.",
      stationTypes:
        "Value checks cover authoritative JSONL type fields. Dock geometry is preserved locally because the JSONL SDE does not include it.",
      stargateTypes:
        "Derived from authoritative JSONL type/group rows referenced by mapStargates.typeID.",
      shipDogmaAttributes:
        "Compared against published ship type IDs from types/groups, dogmaAttributes IDs, and total ship attribute rows from typeDogma.",
      movementTypesWithAnyDogmaAttributeRow: upstreamMovementTypeIDsWithRows,
      movementRelevantTypesSeenInTypeDogma: seenMovementTypes.size,
    },
  };

  writeJson(outputPath, report);
  console.log(JSON.stringify({ outputPath, report }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
