const fs = require("fs");
const path = require("path");

const STATIC_GROUP_IDS = new Set([6, 7, 8, 9, 10, 15]);
const MOVEMENT_ATTRIBUTE_IDS = Object.freeze({
  maxVelocity: 37,
  inertia: 70,
  radius: 162,
  signatureRadius: 552,
  warpSpeedMultiplier: 600,
});

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

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function toNullableNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "\\N" ||
    value === "None"
  ) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNumber(value, fallback = 0) {
  const numeric = toNullableNumber(value);
  return numeric === null ? fallback : numeric;
}

function normalizeVector(x, y, z) {
  const length = Math.sqrt((x ** 2) + (y ** 2) + (z ** 2));
  if (!Number.isFinite(length) || length <= 0) {
    return { x: 1, y: 0, z: 0 };
  }

  return {
    x: x / length,
    y: y / length,
    z: z / length,
  };
}

function roundCoordinate(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(3));
}

function buildVector(x, y, z) {
  return {
    x: roundCoordinate(x),
    y: roundCoordinate(y),
    z: roundCoordinate(z),
  };
}

function vectorLength(vector) {
  if (!vector) {
    return 0;
  }

  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeDatabaseTable(databaseRoot, tableName, payload) {
  writeJson(path.join(databaseRoot, tableName, "data.json"), payload);
}

function loadGroupRows(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Group CSV appears empty: ${filePath}`);
  }

  const rows = new Map();
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const groupID = toNullableNumber(columns[0]);
    const categoryID = toNullableNumber(columns[1]);
    if (!Number.isInteger(groupID) || !Number.isInteger(categoryID)) {
      continue;
    }

    rows.set(groupID, {
      groupID,
      categoryID,
      groupName: columns[2] || "",
      published: toNullableNumber(columns[8]) === 1,
    });
  }

  return rows;
}

function loadInvTypeRows(filePath, groupsById) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const rows = new Map();

  for (const line of lines) {
    const columns = parseCsvLine(line);
    const typeID = toNullableNumber(columns[0]);
    const groupID = toNullableNumber(columns[1]);
    if (!Number.isInteger(typeID) || !Number.isInteger(groupID)) {
      continue;
    }

    const group = groupsById.get(groupID) || null;
    rows.set(typeID, {
      typeID,
      groupID,
      categoryID: group ? group.categoryID : null,
      groupName: group ? group.groupName : "",
      name: columns[2] || "",
      mass: toNullableNumber(columns[3]),
      volume: toNullableNumber(columns[4]),
      capacity: toNullableNumber(columns[5]),
      portionSize: toNullableNumber(columns[6]),
      raceID: toNullableNumber(columns[7]),
      basePrice: toNullableNumber(columns[8]),
      published: toNullableNumber(columns[9]) === 1,
      marketGroupID: toNullableNumber(columns[10]),
      iconID: toNullableNumber(columns[11]),
      soundID: toNullableNumber(columns[12]),
      graphicID: toNullableNumber(columns[13]),
    });
  }

  return rows;
}

function loadSolarSystems(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Solar systems CSV appears empty: ${filePath}`);
  }

  const systems = [];
  const byId = new Map();
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const solarSystemID = toNullableNumber(columns[2]);
    if (!Number.isInteger(solarSystemID)) {
      continue;
    }

    const record = {
      regionID: toNumber(columns[0]),
      constellationID: toNumber(columns[1]),
      solarSystemID,
      solarSystemName: columns[3] || "",
      position: buildVector(
        toNumber(columns[4]),
        toNumber(columns[5]),
        toNumber(columns[6]),
      ),
      security: Number(toNullableNumber(columns[21]) || 0),
      factionID: toNullableNumber(columns[22]),
      radius: toNullableNumber(columns[23]),
      sunTypeID: toNullableNumber(columns[24]),
      securityClass: columns[25] || "",
    };

    systems.push(record);
    byId.set(solarSystemID, record);
  }

  systems.sort((left, right) => left.solarSystemID - right.solarSystemID);
  return { systems, byId };
}

function loadStaticDenormalizeRows(filePath, groupsById) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Map denormalize CSV appears empty: ${filePath}`);
  }

  const rows = [];
  const byItemId = new Map();

  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const itemID = toNullableNumber(columns[0]);
    const typeID = toNullableNumber(columns[1]);
    const groupID = toNullableNumber(columns[2]);
    const solarSystemID = toNullableNumber(columns[3]);
    if (
      !Number.isInteger(itemID) ||
      !Number.isInteger(typeID) ||
      !Number.isInteger(groupID) ||
      !Number.isInteger(solarSystemID) ||
      !STATIC_GROUP_IDS.has(groupID)
    ) {
      continue;
    }

    const group = groupsById.get(groupID) || null;
    const record = {
      itemID,
      typeID,
      groupID,
      groupName: group ? group.groupName : "",
      categoryID: group ? group.categoryID : null,
      solarSystemID,
      constellationID: toNullableNumber(columns[4]),
      regionID: toNullableNumber(columns[5]),
      orbitID: toNullableNumber(columns[6]),
      position: buildVector(
        toNumber(columns[7]),
        toNumber(columns[8]),
        toNumber(columns[9]),
      ),
      radius: toNullableNumber(columns[10]),
      itemName: columns[11] || "",
      security: toNullableNumber(columns[12]),
      celestialIndex: toNullableNumber(columns[13]),
      orbitIndex: toNullableNumber(columns[14]),
    };

    rows.push(record);
    byItemId.set(itemID, record);
  }

  rows.sort((left, right) => left.itemID - right.itemID);
  return { rows, byItemId };
}

function loadStationRows(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Stations CSV appears empty: ${filePath}`);
  }

  const stations = [];
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const stationID = toNullableNumber(columns[0]);
    if (!Number.isInteger(stationID)) {
      continue;
    }

    stations.push({
      stationID,
      security: toNumber(columns[1]),
      dockingCostPerVolume: toNumber(columns[2]),
      maxShipVolumeDockable: toNumber(columns[3]),
      officeRentalCost: toNumber(columns[4]),
      operationID: toNumber(columns[5]),
      stationTypeID: toNumber(columns[6]),
      corporationID: toNumber(columns[7]),
      solarSystemID: toNumber(columns[8]),
      constellationID: toNumber(columns[9]),
      regionID: toNumber(columns[10]),
      stationName: columns[11] || "",
      position: buildVector(
        toNumber(columns[12]),
        toNumber(columns[13]),
        toNumber(columns[14]),
      ),
      reprocessingEfficiency: toNumber(columns[15]),
      reprocessingStationsTake: toNumber(columns[16]),
      reprocessingHangarFlag: toNumber(columns[17]),
    });
  }

  stations.sort((left, right) => left.stationID - right.stationID);
  return stations;
}

function loadStationTypeRows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return new Map();
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return new Map();
  }

  const stationTypes = new Map();
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const stationTypeID = toNullableNumber(columns[0]);
    if (!Number.isInteger(stationTypeID)) {
      continue;
    }

    stationTypes.set(stationTypeID, {
      stationTypeID,
      dockEntry: buildVector(
        toNumber(columns[1]),
        toNumber(columns[2]),
        toNumber(columns[3]),
      ),
      dockOrientation: buildVector(
        toNumber(columns[4]),
        toNumber(columns[5]),
        toNumber(columns[6]),
      ),
    });
  }

  return stationTypes;
}

function loadGateJumps(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Map jumps CSV appears empty: ${filePath}`);
  }

  const jumps = [];
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const stargateID = toNullableNumber(columns[0]);
    const destinationID = toNullableNumber(columns[1]);
    if (!Number.isInteger(stargateID) || !Number.isInteger(destinationID)) {
      continue;
    }

    jumps.push({
      stargateID,
      destinationID,
    });
  }

  return jumps;
}

function loadMovementAttributes(filePath, invTypesById, relevantTypeIds) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`dgmTypeAttributes CSV appears empty: ${filePath}`);
  }

  const rows = new Map();
  for (const typeID of relevantTypeIds) {
    const invType = invTypesById.get(typeID) || null;
    rows.set(typeID, {
      typeID,
      typeName: invType ? invType.name : "",
      mass: invType ? invType.mass : null,
      maxVelocity: null,
      inertia: null,
      radius: null,
      signatureRadius: null,
      warpSpeedMultiplier: null,
    });
  }

  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const typeID = toNullableNumber(columns[0]);
    const attributeID = toNullableNumber(columns[1]);
    if (
      !Number.isInteger(typeID) ||
      !Number.isInteger(attributeID) ||
      !rows.has(typeID)
    ) {
      continue;
    }

    const numericValue =
      toNullableNumber(columns[2]) ?? toNullableNumber(columns[3]);
    if (numericValue === null) {
      continue;
    }

    const entry = rows.get(typeID);
    switch (attributeID) {
      case MOVEMENT_ATTRIBUTE_IDS.maxVelocity:
        entry.maxVelocity = numericValue;
        break;
      case MOVEMENT_ATTRIBUTE_IDS.inertia:
        entry.inertia = numericValue;
        break;
      case MOVEMENT_ATTRIBUTE_IDS.radius:
        entry.radius = numericValue;
        break;
      case MOVEMENT_ATTRIBUTE_IDS.signatureRadius:
        entry.signatureRadius = numericValue;
        break;
      case MOVEMENT_ATTRIBUTE_IDS.warpSpeedMultiplier:
        entry.warpSpeedMultiplier = numericValue;
        break;
      default:
        break;
    }
  }

  const output = [];
  for (const entry of rows.values()) {
    const effectiveRadius =
      entry.radius ??
      entry.signatureRadius ??
      (invTypesById.get(entry.typeID) && invTypesById.get(entry.typeID).categoryID === 6
        ? 50
        : null);
    output.push({
      ...entry,
      radius: effectiveRadius,
      alignTime:
        entry.mass && entry.inertia
          ? Number(((-Math.log(0.25) * ((entry.mass / 1_000_000) * entry.inertia))).toFixed(6))
          : null,
      maxAccelerationTime:
        entry.mass && entry.inertia
          ? Number(((-Math.log(0.0001) * ((entry.mass / 1_000_000) * entry.inertia))).toFixed(6))
          : null,
    });
  }

  output.sort((left, right) => left.typeID - right.typeID);
  return output;
}

function buildStationRecord(
  station,
  stationItem,
  orbitItem,
  system,
  movementByTypeId,
  stationTypesById,
) {
  const movement = movementByTypeId.get(station.stationTypeID) || null;
  const stationType = stationTypesById.get(station.stationTypeID) || null;
  const stationRadius = Number(
    movement && Number.isFinite(movement.radius) && movement.radius > 0
      ? movement.radius
      : 30000,
  );
  const stationInteractionRadius = stationRadius;

  let direction = null;
  let dockEntry = null;
  let dockPosition = null;
  if (
    stationType &&
    stationType.dockOrientation &&
    vectorLength(stationType.dockOrientation) > 0.001
  ) {
    direction = normalizeVector(
      stationType.dockOrientation.x,
      stationType.dockOrientation.y,
      stationType.dockOrientation.z,
    );
  }

  if (
    stationType &&
    stationType.dockEntry &&
    vectorLength(stationType.dockEntry) > 1
  ) {
    dockEntry = buildVector(
      stationType.dockEntry.x,
      stationType.dockEntry.y,
      stationType.dockEntry.z,
    );
    dockPosition = buildVector(
      station.position.x + stationType.dockEntry.x,
      station.position.y + stationType.dockEntry.y,
      station.position.z + stationType.dockEntry.z,
    );
  }

  if (!direction && orbitItem) {
    direction = normalizeVector(
      station.position.x - orbitItem.position.x,
      station.position.y - orbitItem.position.y,
      station.position.z - orbitItem.position.z,
    );
  } else if (!direction && system) {
    direction = normalizeVector(
      station.position.x - system.position.x,
      station.position.y - system.position.y,
      station.position.z - system.position.z,
    );
  }

  const undockPosition = dockPosition || buildVector(
    station.position.x + (direction.x * Math.max(stationInteractionRadius + 2500, 8000)),
    station.position.y + (direction.y * Math.max(stationInteractionRadius + 2500, 8000)),
    station.position.z + (direction.z * Math.max(stationInteractionRadius + 2500, 8000)),
  );

  return {
    ...station,
    itemName: station.stationName,
    itemID: station.stationID,
    groupID: stationItem ? stationItem.groupID : 15,
    categoryID: stationItem ? stationItem.categoryID : 3,
    orbitID: stationItem ? stationItem.orbitID : null,
    orbitName: orbitItem ? orbitItem.itemName : null,
    radius: stationRadius,
    interactionRadius: stationInteractionRadius,
    dockEntry,
    dockPosition,
    dockOrientation: buildVector(direction.x, direction.y, direction.z),
    undockDirection: buildVector(direction.x, direction.y, direction.z),
    undockPosition,
  };
}

function buildCelestialRecord(row) {
  let kind = "celestial";
  if (row.groupID === 10) {
    kind = "stargate";
  } else if (row.groupID === 6) {
    kind = "sun";
  } else if (row.groupID === 7) {
    kind = "planet";
  } else if (row.groupID === 8) {
    kind = "moon";
  } else if (row.groupID === 9) {
    kind = "asteroidBelt";
  }

  return {
    itemID: row.itemID,
    typeID: row.typeID,
    groupID: row.groupID,
    categoryID: row.categoryID,
    groupName: row.groupName,
    solarSystemID: row.solarSystemID,
    constellationID: row.constellationID,
    regionID: row.regionID,
    orbitID: row.orbitID,
    position: row.position,
    radius: row.radius,
    itemName: row.itemName,
    security: row.security,
    celestialIndex: row.celestialIndex,
    orbitIndex: row.orbitIndex,
    kind,
  };
}

function buildStargates(rowsByItemId, jumps) {
  const gates = [];
  for (const jump of jumps) {
    const source = rowsByItemId.get(jump.stargateID);
    const destination = rowsByItemId.get(jump.destinationID);
    if (!source || !destination) {
      continue;
    }

    gates.push({
      itemID: source.itemID,
      typeID: source.typeID,
      solarSystemID: source.solarSystemID,
      itemName: source.itemName,
      position: source.position,
      radius: source.radius || 15000,
      destinationID: destination.itemID,
      destinationSolarSystemID: destination.solarSystemID,
      destinationName: destination.itemName,
    });
  }

  gates.sort((left, right) => left.itemID - right.itemID);
  return gates;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const invTypesPath = args.invTypes;
  const invGroupsPath = args.invGroups;
  const mapSolarSystemsPath = args.mapSolarSystems;
  const mapDenormalizePath = args.mapDenormalize;
  const staStationsPath = args.staStations;
  const staStationTypesPath = args.staStationTypes;
  const mapJumpsPath = args.mapJumps;
  const dgmTypeAttributesPath = args.dgmTypeAttributes;
  const outputDir = args.outputDir;
  const databaseRoot = args.databaseRoot;
  const dumpDate = args["dump-date"] || "unknown";

  if (
    !invTypesPath ||
    !invGroupsPath ||
    !mapSolarSystemsPath ||
    !mapDenormalizePath ||
    !staStationsPath ||
    !mapJumpsPath ||
    !dgmTypeAttributesPath ||
    (!outputDir && !databaseRoot)
  ) {
    throw new Error(
      "Usage: node scripts/build-space-data.js --invTypes <path> --invGroups <path> --mapSolarSystems <path> --mapDenormalize <path> --staStations <path> [--staStationTypes <path>] --mapJumps <path> --dgmTypeAttributes <path> (--outputDir <path> | --databaseRoot <path>) [--dump-date <YYYY-MM-DD>]",
    );
  }

  const groupsById = loadGroupRows(invGroupsPath);
  const invTypesById = loadInvTypeRows(invTypesPath, groupsById);
  const { systems, byId: systemsById } = loadSolarSystems(mapSolarSystemsPath);
  const { rows: denormalizeRows, byItemId: denormalizeByItemId } =
    loadStaticDenormalizeRows(mapDenormalizePath, groupsById);
  const stations = loadStationRows(staStationsPath);
  const stationTypesById = loadStationTypeRows(staStationTypesPath);
  const jumps = loadGateJumps(mapJumpsPath);

  const relevantTypeIds = new Set();
  for (const type of invTypesById.values()) {
    if (type.categoryID === 6 && type.published) {
      relevantTypeIds.add(type.typeID);
    }
  }
  for (const station of stations) {
    relevantTypeIds.add(station.stationTypeID);
  }
  for (const row of denormalizeRows) {
    relevantTypeIds.add(row.typeID);
  }

  const movementAttributes = loadMovementAttributes(
    dgmTypeAttributesPath,
    invTypesById,
    relevantTypeIds,
  );
  const movementByTypeId = new Map(
    movementAttributes.map((entry) => [entry.typeID, entry]),
  );

  const stationRecords = stations.map((station) =>
    buildStationRecord(
      station,
      denormalizeByItemId.get(station.stationID) || null,
      denormalizeByItemId.get(
        (denormalizeByItemId.get(station.stationID) || {}).orbitID || null,
      ) || null,
      systemsById.get(station.solarSystemID) || null,
      movementByTypeId,
      stationTypesById,
    ),
  );

  const celestialRecords = denormalizeRows
    .filter((row) => row.groupID === 6 || row.groupID === 7)
    .map((row) => buildCelestialRecord(row));

  const stargateRecords = buildStargates(denormalizeByItemId, jumps);

  const source = {
    provider: "Fuzzwork",
    dumpDate,
    generatedAt: new Date().toISOString(),
  };
  const solarSystemsPayload = {
    source,
    count: systems.length,
    solarSystems: systems,
  };
  const stationsPayload = {
    source,
    count: stationRecords.length,
    stations: stationRecords,
  };
  const celestialsPayload = {
    source,
    count: celestialRecords.length,
    celestials: celestialRecords,
  };
  const stargatesPayload = {
    source,
    count: stargateRecords.length,
    stargates: stargateRecords,
  };
  const movementPayload = {
    source,
    count: movementAttributes.length,
    attributes: movementAttributes,
  };

  if (outputDir) {
    writeJson(path.join(outputDir, "solarSystems.json"), solarSystemsPayload);
    writeJson(path.join(outputDir, "stations.json"), stationsPayload);
    writeJson(path.join(outputDir, "celestials.json"), celestialsPayload);
    writeJson(path.join(outputDir, "stargates.json"), stargatesPayload);
    writeJson(path.join(outputDir, "movementAttributes.json"), movementPayload);
    console.log(`Wrote space data to ${outputDir}`);
  }

  if (databaseRoot) {
    writeDatabaseTable(databaseRoot, "solarSystems", solarSystemsPayload);
    writeDatabaseTable(databaseRoot, "stations", stationsPayload);
    writeDatabaseTable(databaseRoot, "celestials", celestialsPayload);
    writeDatabaseTable(databaseRoot, "stargates", stargatesPayload);
    writeDatabaseTable(databaseRoot, "movementAttributes", movementPayload);
    console.log(`Wrote space data to database root ${databaseRoot}`);
  }

  console.log(`  solarSystems: ${systems.length}`);
  console.log(`  stations: ${stationRecords.length}`);
  console.log(`  celestials: ${celestialRecords.length}`);
  console.log(`  stargates: ${stargateRecords.length}`);
  console.log(`  movementAttributes: ${movementAttributes.length}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
