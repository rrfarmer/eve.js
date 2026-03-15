const fs = require("fs");
const path = require("path");
const readline = require("readline");

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

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function englishText(value) {
  if (!value) {
    return "";
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
    return firstText || "";
  }

  return "";
}

function uniqueSortedNumbers(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => toNumber(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
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

function buildOptionalVector(vector) {
  if (!vector || typeof vector !== "object") {
    return null;
  }

  return buildVector(vector);
}

function getGroupRow(groupsById, groupID) {
  return Number.isInteger(groupID) ? groupsById.get(groupID) || null : null;
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

function buildSkillRecord(typeRow, groupRow) {
  return {
    typeID: toNumber(typeRow._key),
    groupID: toNumber(typeRow.groupID),
    categoryID: toNumber(groupRow && groupRow.categoryID) || 16,
    groupName: englishText(groupRow && groupRow.name),
    name: englishText(typeRow.name),
    published: Boolean(typeRow.published),
    raceID: toNumber(typeRow.raceID),
    basePrice: toNumber(typeRow.basePrice),
    marketGroupID: toNumber(typeRow.marketGroupID),
    iconID: toNumber(typeRow.iconID),
    soundID: toNumber(typeRow.soundID),
    graphicID: toNumber(typeRow.graphicID),
  };
}

function buildSolarSystemRecord(systemRow, starsById) {
  const starRow = Number.isInteger(toNumber(systemRow.starID))
    ? starsById.get(toNumber(systemRow.starID)) || null
    : null;

  return {
    regionID: toNumber(systemRow.regionID) || 0,
    constellationID: toNumber(systemRow.constellationID) || 0,
    solarSystemID: toNumber(systemRow._key),
    solarSystemName: englishText(systemRow.name),
    position: buildVector(systemRow.position),
    security: Number(toNumber(systemRow.securityStatus) || 0),
    factionID: toNumber(systemRow.factionID),
    radius: toNumber(systemRow.radius),
    sunTypeID: toNumber(starRow && starRow.typeID),
    securityClass: typeof systemRow.securityClass === "string" ? systemRow.securityClass : "",
  };
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

function buildStarRecord(starRow, systemRow, typeRow, groupRow) {
  const systemName = englishText(systemRow && systemRow.name);
  return {
    itemID: toNumber(starRow._key),
    typeID: toNumber(starRow.typeID),
    groupID: toNumber(typeRow && typeRow.groupID) || 6,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Sun",
    solarSystemID: toNumber(starRow.solarSystemID) || 0,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    orbitID: null,
    position: { x: 0, y: 0, z: 0 },
    radius: toNumber(starRow.radius),
    itemName: systemName ? `${systemName} - Star` : "Star",
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    celestialIndex: null,
    orbitIndex: null,
    kind: "sun",
  };
}

function buildPlanetRecord(planetRow, systemRow, typeRow, groupRow) {
  const systemName = englishText(systemRow && systemRow.name);
  const celestialIndex = toNumber(planetRow.celestialIndex);
  return {
    itemID: toNumber(planetRow._key),
    typeID: toNumber(planetRow.typeID),
    groupID: toNumber(typeRow && typeRow.groupID) || 7,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 2,
    groupName: englishText(groupRow && groupRow.name) || "Planet",
    solarSystemID: toNumber(planetRow.solarSystemID) || 0,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    orbitID: toNumber(planetRow.orbitID),
    position: buildVector(planetRow.position),
    radius: toNumber(planetRow.radius),
    itemName: systemName ? `${systemName} ${romanNumeral(celestialIndex)}` : "Planet",
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    celestialIndex,
    orbitIndex: null,
    kind: "planet",
  };
}

function buildStargateRecord(stargateRow, mapSolarSystemsById) {
  const sourceSystem = mapSolarSystemsById.get(toNumber(stargateRow.solarSystemID)) || null;
  const destinationSystem = mapSolarSystemsById.get(
    toNumber(stargateRow.destination && stargateRow.destination.solarSystemID),
  ) || null;
  const sourceSystemName = englishText(sourceSystem && sourceSystem.name);
  const destinationSystemName = englishText(destinationSystem && destinationSystem.name);

  return {
    itemID: toNumber(stargateRow._key),
    typeID: toNumber(stargateRow.typeID),
    solarSystemID: toNumber(stargateRow.solarSystemID) || 0,
    itemName: destinationSystemName ? `Stargate (${destinationSystemName})` : "Stargate",
    position: buildVector(stargateRow.position),
    radius: toNumber(stargateRow.radius) || 15000,
    destinationID: toNumber(stargateRow.destination && stargateRow.destination.stargateID),
    destinationSolarSystemID: toNumber(
      stargateRow.destination && stargateRow.destination.solarSystemID,
    ),
    destinationName: sourceSystemName ? `Stargate (${sourceSystemName})` : "Stargate",
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

function buildStationTypeRecord(typeRow, groupRow, existingEntry = null) {
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
    dockEntry: buildOptionalVector(existingEntry && existingEntry.dockEntry),
    dockOrientation: buildOptionalVector(existingEntry && existingEntry.dockOrientation),
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

function buildStationRecord({
  stationRow,
  systemRow,
  constellationRow,
  regionRow,
  typeRow,
  groupRow,
  typesById,
  groupsById,
  corporationRow,
  operationRow,
  orbitDescriptor,
  existingEntry = null,
  mapSolarSystemsById,
  orbitLookups,
}) {
  const orbitRow = orbitDescriptor && orbitDescriptor.row ? orbitDescriptor.row : null;
  const orbitTypeID = toNumber(orbitRow && orbitRow.typeID);
  const orbitTypeRow =
    Number.isInteger(orbitTypeID) ? typesById.get(orbitTypeID) || null : null;
  const orbitGroupRow = getGroupRow(groupsById, toNumber(orbitTypeRow && orbitTypeRow.groupID));
  const orbitName =
    buildOrbitName(orbitDescriptor, mapSolarSystemsById, orbitLookups) ||
    (existingEntry && existingEntry.orbitName) ||
    null;
  const corporationName =
    englishText(corporationRow && corporationRow.name) ||
    (existingEntry && existingEntry.corporationName) ||
    null;
  const operationName =
    englishText(operationRow && operationRow.operationName) ||
    (existingEntry && existingEntry.operationName) ||
    null;
  const stationName =
    (existingEntry && existingEntry.stationName) ||
    (orbitName && corporationName && operationName
      ? `${orbitName} - ${corporationName} ${operationName}`
      : orbitName || `Station ${toNumber(stationRow._key)}`);
  const radius = toNumber(typeRow.radius);

  return {
    stationID: toNumber(stationRow._key),
    security: Number(toNumber(systemRow && systemRow.securityStatus) || 0),
    dockingCostPerVolume:
      toNumber(existingEntry && existingEntry.dockingCostPerVolume) ?? 0,
    maxShipVolumeDockable:
      toNumber(existingEntry && existingEntry.maxShipVolumeDockable) ?? 50000000,
    officeRentalCost:
      toNumber(existingEntry && existingEntry.officeRentalCost) ?? 10000,
    operationID: toNumber(stationRow.operationID),
    stationTypeID: toNumber(stationRow.typeID),
    corporationID: toNumber(stationRow.ownerID),
    solarSystemID: toNumber(stationRow.solarSystemID) || 0,
    solarSystemName: englishText(systemRow && systemRow.name) || null,
    constellationID: toNumber(systemRow && systemRow.constellationID) || 0,
    constellationName: englishText(constellationRow && constellationRow.name) || null,
    regionID: toNumber(systemRow && systemRow.regionID) || 0,
    regionName: englishText(regionRow && regionRow.name) || null,
    stationName,
    position: buildVector(stationRow.position),
    reprocessingEfficiency: toNumber(stationRow.reprocessingEfficiency),
    reprocessingStationsTake: toNumber(stationRow.reprocessingStationsTake),
    reprocessingHangarFlag: toNumber(stationRow.reprocessingHangarFlag),
    itemName: stationName,
    itemID: toNumber(stationRow._key),
    groupID: toNumber(typeRow.groupID) || 15,
    categoryID: toNumber(groupRow && groupRow.categoryID) || 3,
    orbitID: toNumber(stationRow.orbitID),
    orbitName,
    orbitGroupID: toNumber(orbitTypeRow && orbitTypeRow.groupID),
    orbitTypeID,
    orbitKind: orbitDescriptor ? orbitDescriptor.kind : null,
    stationTypeName: englishText(typeRow.name),
    stationRaceID: toNumber(typeRow.raceID),
    stationGraphicID: toNumber(typeRow.graphicID),
    radius,
    interactionRadius:
      toNumber(existingEntry && existingEntry.interactionRadius) ?? radius,
    useOperationName: Boolean(stationRow.useOperationName),
    dockEntry: buildOptionalVector(existingEntry && existingEntry.dockEntry),
    dockPosition: buildOptionalVector(existingEntry && existingEntry.dockPosition),
    dockOrientation: buildOptionalVector(existingEntry && existingEntry.dockOrientation),
    undockDirection: buildOptionalVector(existingEntry && existingEntry.undockDirection),
    undockPosition: buildOptionalVector(existingEntry && existingEntry.undockPosition),
  };
}

function buildMovementRecord(typeRow, dogmaRow, groupsById) {
  const attributes = new Map(
    (Array.isArray(dogmaRow && dogmaRow.dogmaAttributes) ? dogmaRow.dogmaAttributes : [])
      .map((entry) => [toNumber(entry.attributeID), toNumber(entry.value)]),
  );
  const groupRow = getGroupRow(groupsById, toNumber(typeRow.groupID));
  const categoryID = toNumber(groupRow && groupRow.categoryID);
  const radius =
    attributes.get(MOVEMENT_ATTRIBUTE_IDS.radius) ??
    toNumber(typeRow.radius) ??
    attributes.get(MOVEMENT_ATTRIBUTE_IDS.signatureRadius) ??
    (categoryID === 6 ? 50 : null);
  const mass = toNumber(typeRow.mass);
  const inertia = attributes.get(MOVEMENT_ATTRIBUTE_IDS.inertia) ?? null;

  return {
    typeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    mass,
    maxVelocity: attributes.get(MOVEMENT_ATTRIBUTE_IDS.maxVelocity) ?? null,
    inertia,
    radius,
    signatureRadius: attributes.get(MOVEMENT_ATTRIBUTE_IDS.signatureRadius) ?? null,
    warpSpeedMultiplier: attributes.get(MOVEMENT_ATTRIBUTE_IDS.warpSpeedMultiplier) ?? null,
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

function buildDogmaAttributeTypeRecord(attributeRow) {
  const displayName = englishText(attributeRow.displayName);
  return {
    attributeID: toNumber(attributeRow._key),
    attributeName: displayName || attributeRow.name || "",
    description: attributeRow.description || "",
    iconID: toNumber(attributeRow.iconID),
    defaultValue: toNumber(attributeRow.defaultValue),
    published: Boolean(attributeRow.published),
    displayName: displayName || "",
    unitID: toNumber(attributeRow.unitID),
    stackable: Boolean(attributeRow.stackable),
    highIsGood: Boolean(attributeRow.highIsGood),
    categoryID: toNumber(attributeRow.attributeCategoryID),
    name: attributeRow.name || "",
    dataType: toNumber(attributeRow.dataType),
    displayWhenZero: Boolean(attributeRow.displayWhenZero),
  };
}

function buildShipDogmaRecord(typeRow, dogmaRow) {
  const attributes = Object.fromEntries(
    (Array.isArray(dogmaRow && dogmaRow.dogmaAttributes) ? dogmaRow.dogmaAttributes : [])
      .map((entry) => [String(toNumber(entry.attributeID)), toNumber(entry.value)])
      .filter(([attributeID, value]) => Number.isInteger(toNumber(attributeID)) && value !== null)
      .sort((left, right) => Number(left[0]) - Number(right[0])),
  );

  return {
    typeID: toNumber(typeRow._key),
    typeName: englishText(typeRow.name),
    attributeCount: Object.keys(attributes).length,
    attributes,
  };
}

function ensureJsonlSync(target) {
  const source = target.source && typeof target.source === "object"
    ? target.source
    : {};
  if (!source.jsonlSync || typeof source.jsonlSync !== "object") {
    source.jsonlSync = {};
  }
  target.source = source;
  return source.jsonlSync;
}

function markJsonlAuthority(target, jsonlDir, sdeRow) {
  if (!target || typeof target !== "object") {
    return;
  }

  const source = target.source && typeof target.source === "object"
    ? target.source
    : {};
  source.provider = "EVE Static Data JSONL";
  source.authority = "eve-online-static-data-3253748-jsonl";
  source.sourceDir = jsonlDir;
  source.generatedAt = new Date().toISOString();
  source.buildNumber = sdeRow ? sdeRow.buildNumber || null : null;
  source.releaseDate = sdeRow ? sdeRow.releaseDate || null : null;
  delete source.dumpDate;
  delete source.sourceUrl;
  delete source.generatedFrom;
  target.source = source;
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

  const [
    sdeMeta,
    groupsById,
    typesById,
    mapConstellationsById,
    mapRegionsById,
    mapSolarSystemsById,
    mapStarsById,
    mapPlanetsById,
    mapMoonsById,
    mapAsteroidBeltsById,
    mapStargatesById,
    npcStationsById,
    npcCorporationsById,
    stationOperationsById,
    dogmaAttributesById,
    shipTypesRoot,
    skillTypesRoot,
    solarSystemsRoot,
    stationsRoot,
    stationTypesRoot,
    stargateTypesRoot,
    stargatesRoot,
    celestialsRoot,
    movementRoot,
    shipDogmaRoot,
  ] = await Promise.all([
    loadJsonlMap(path.join(jsonlDir, "_sde.jsonl"), (row) => row._key === "sde" ? 1 : null),
    loadJsonlMap(path.join(jsonlDir, "groups.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "types.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapConstellations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapRegions.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapSolarSystems.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStars.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapPlanets.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapMoons.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapAsteroidBelts.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "mapStargates.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "npcStations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "npcCorporations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "stationOperations.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "dogmaAttributes.jsonl"), (row) => row._key),
    readJson(path.join(localDbRoot, "shipTypes", "data.json")),
    readJson(path.join(localDbRoot, "skillTypes", "data.json")),
    readJson(path.join(localDbRoot, "solarSystems", "data.json")),
    readJson(path.join(localDbRoot, "stations", "data.json")),
    readJson(path.join(localDbRoot, "stationTypes", "data.json")),
    readJson(path.join(localDbRoot, "stargateTypes", "data.json")),
    readJson(path.join(localDbRoot, "stargates", "data.json")),
    readJson(path.join(localDbRoot, "celestials", "data.json")),
    readJson(path.join(localDbRoot, "movementAttributes", "data.json")),
    readJson(path.join(localDbRoot, "shipDogmaAttributes", "data.json")),
  ]);

  const publishedShipTypeIDs = [];
  const publishedSkillTypeIDs = [];
  for (const [typeID, typeRow] of typesById.entries()) {
    const groupRow = getGroupRow(groupsById, toNumber(typeRow.groupID));
    const categoryID = toNumber(groupRow && groupRow.categoryID);
    const groupPublished = groupRow ? Boolean(groupRow.published) : false;
    if (categoryID === 6 && Boolean(typeRow.published)) {
      publishedShipTypeIDs.push(typeID);
    }
    if (categoryID === 16 && groupPublished && Boolean(typeRow.published)) {
      publishedSkillTypeIDs.push(typeID);
    }
  }

  const localShipTypeIDs = new Set((shipTypesRoot.ships || []).map((row) => Number(row.typeID)));
  const localSkillTypeIDs = new Set((skillTypesRoot.skills || []).map((row) => Number(row.typeID)));
  const localSolarSystemIDs = new Set((solarSystemsRoot.solarSystems || []).map((row) => Number(row.solarSystemID)));
  const localStationIDs = new Set((stationsRoot.stations || []).map((row) => Number(row.stationID)));
  const localStationTypeIDs = new Set((stationTypesRoot.stationTypes || []).map((row) => Number(row.stationTypeID)));
  const localStargateTypeIDs = new Set((stargateTypesRoot.stargateTypes || []).map((row) => Number(row.typeID)));
  const localStargateIDs = new Set((stargatesRoot.stargates || []).map((row) => Number(row.itemID)));
  const localCelestialIDs = new Set((celestialsRoot.celestials || []).map((row) => Number(row.itemID)));
  const localMovementTypeIDs = new Set((movementRoot.attributes || []).map((row) => Number(row.typeID)));
  const localDogmaAttributeIDs = new Set(Object.keys(shipDogmaRoot.attributeTypesByID || {}).map(Number));
  const localDogmaShipTypeIDs = new Set(Object.keys(shipDogmaRoot.shipAttributesByTypeID || {}).map(Number));
  const stationTypeIDs = uniqueSortedNumbers(
    [...npcStationsById.values()].map((row) => row.typeID),
  );
  const stargateTypeIDs = uniqueSortedNumbers(
    [...mapStargatesById.values()].map((row) => row.typeID),
  );
  const relevantMovementTypeIDs = new Set([
    ...publishedShipTypeIDs,
    ...stationTypeIDs,
    ...[...mapStarsById.values()].map((row) => row.typeID),
    ...[...mapPlanetsById.values()].map((row) => row.typeID),
    ...[...mapMoonsById.values()].map((row) => row.typeID),
    ...[...mapAsteroidBeltsById.values()].map((row) => row.typeID),
    ...[...mapStargatesById.values()].map((row) => row.typeID),
  ].map((value) => toNumber(value)).filter((value) => Number.isInteger(value) && value > 0));

  const missingShipTypeIDs = publishedShipTypeIDs.filter((id) => !localShipTypeIDs.has(id));
  const missingSkillTypeIDs = publishedSkillTypeIDs.filter((id) => !localSkillTypeIDs.has(id));
  const missingSolarSystemIDs = [...mapSolarSystemsById.keys()].filter((id) => !localSolarSystemIDs.has(id));
  const missingStationIDs = [...npcStationsById.keys()].filter((id) => !localStationIDs.has(id));
  const missingStationTypeIDs = stationTypeIDs.filter((id) => !localStationTypeIDs.has(id));
  const missingStargateTypeIDs = stargateTypeIDs.filter((id) => !localStargateTypeIDs.has(id));
  const missingStargateIDs = [...mapStargatesById.keys()].filter((id) => !localStargateIDs.has(id));
  const missingStarIDs = [...mapStarsById.keys()].filter((id) => !localCelestialIDs.has(id));
  const missingPlanetIDs = [...mapPlanetsById.keys()].filter((id) => !localCelestialIDs.has(id));
  const missingMovementTypeIDs = [...relevantMovementTypeIDs].filter((id) => !localMovementTypeIDs.has(id));
  const missingDogmaAttributeIDs = [...dogmaAttributesById.keys()].filter((id) => !localDogmaAttributeIDs.has(id));
  const missingDogmaShipTypeIDs = publishedShipTypeIDs.filter((id) => !localDogmaShipTypeIDs.has(id));

  const allDogmaTypeIds = new Set(publishedShipTypeIDs);
  const missingDogmaTypeIds = new Set([
    ...publishedShipTypeIDs,
    ...relevantMovementTypeIDs,
  ]);
  const typeDogmaById = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(jsonlDir, "typeDogma.jsonl")),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    const typeID = toNumber(row._key);
    if (Number.isInteger(typeID) && missingDogmaTypeIds.has(typeID)) {
      typeDogmaById.set(typeID, row);
    }
  }

  for (const typeID of missingShipTypeIDs) {
    const typeRow = typesById.get(typeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    if (!typeRow || !groupRow) {
      continue;
    }
    shipTypesRoot.ships.push(buildTypeRecord(typeRow, groupRow));
  }
  shipTypesRoot.ships.sort(
    (left, right) => left.name.localeCompare(right.name) || left.typeID - right.typeID,
  );
  shipTypesRoot.count = shipTypesRoot.ships.length;
  ensureJsonlSync(shipTypesRoot).updatedTypeIDs = uniqueSortedNumbers(missingShipTypeIDs);

  for (const typeID of missingSkillTypeIDs) {
    const typeRow = typesById.get(typeID);
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    if (!typeRow || !groupRow) {
      continue;
    }
    skillTypesRoot.skills.push(buildSkillRecord(typeRow, groupRow));
  }
  skillTypesRoot.skills.sort(
    (left, right) => left.name.localeCompare(right.name) || left.typeID - right.typeID,
  );
  skillTypesRoot.count = skillTypesRoot.skills.length;
  ensureJsonlSync(skillTypesRoot).updatedTypeIDs = uniqueSortedNumbers(missingSkillTypeIDs);

  for (const systemID of missingSolarSystemIDs) {
    const row = mapSolarSystemsById.get(systemID);
    if (!row) {
      continue;
    }
    solarSystemsRoot.solarSystems.push(buildSolarSystemRecord(row, mapStarsById));
  }
  solarSystemsRoot.solarSystems.sort((left, right) => left.solarSystemID - right.solarSystemID);
  solarSystemsRoot.count = solarSystemsRoot.solarSystems.length;
  ensureJsonlSync(solarSystemsRoot).updatedSolarSystemIDs = uniqueSortedNumbers(missingSolarSystemIDs);

  const existingStationsById = new Map(
    (Array.isArray(stationsRoot.stations) ? stationsRoot.stations : [])
      .map((entry) => [toNumber(entry && entry.stationID), entry]),
  );
  const existingStationTypesById = new Map(
    (Array.isArray(stationTypesRoot.stationTypes) ? stationTypesRoot.stationTypes : [])
      .map((entry) => [toNumber(entry && entry.stationTypeID), entry]),
  );
  const orbitLookups = new Map([
    ["star", mapStarsById],
    ["planet", mapPlanetsById],
    ["moon", mapMoonsById],
    ["asteroidBelt", mapAsteroidBeltsById],
  ]);

  stationTypesRoot.stationTypes = stationTypeIDs
    .map((stationTypeID) => {
      const typeRow = typesById.get(stationTypeID);
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      if (!typeRow || !groupRow) {
        return null;
      }

      return buildStationTypeRecord(
        typeRow,
        groupRow,
        existingStationTypesById.get(stationTypeID) || null,
      );
    })
    .filter(Boolean)
    .sort((left, right) => left.stationTypeID - right.stationTypeID);
  stationTypesRoot.count = stationTypesRoot.stationTypes.length;
  ensureJsonlSync(stationTypesRoot).updatedStationTypeIDs = uniqueSortedNumbers(
    stationTypeIDs,
  );

  stargateTypesRoot.stargateTypes = stargateTypeIDs
    .map((typeID) => {
      const typeRow = typesById.get(typeID);
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      if (!typeRow || !groupRow) {
        return null;
      }

      return buildStargateTypeRecord(typeRow, groupRow);
    })
    .filter(Boolean)
    .sort((left, right) => left.typeID - right.typeID);
  stargateTypesRoot.count = stargateTypesRoot.stargateTypes.length;
  ensureJsonlSync(stargateTypesRoot).updatedStargateTypeIDs = uniqueSortedNumbers(
    stargateTypeIDs,
  );

  stationsRoot.stations = [...npcStationsById.keys()]
    .sort((left, right) => left - right)
    .map((stationID) => {
      const stationRow = npcStationsById.get(stationID);
      const systemRow =
        mapSolarSystemsById.get(toNumber(stationRow && stationRow.solarSystemID)) || null;
      const typeRow = typesById.get(toNumber(stationRow && stationRow.typeID)) || null;
      const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
      const corporationRow =
        npcCorporationsById.get(toNumber(stationRow && stationRow.ownerID)) || null;
      const operationRow =
        stationOperationsById.get(toNumber(stationRow && stationRow.operationID)) || null;
      const constellationRow =
        mapConstellationsById.get(toNumber(systemRow && systemRow.constellationID)) || null;
      const regionRow =
        mapRegionsById.get(toNumber(systemRow && systemRow.regionID)) || null;
      const orbitDescriptor = getOrbitDescriptor(stationRow && stationRow.orbitID, orbitLookups);
      if (!stationRow || !systemRow || !typeRow || !groupRow) {
        return null;
      }

      return buildStationRecord({
        stationRow,
        systemRow,
        constellationRow,
        regionRow,
        typeRow,
        groupRow,
        typesById,
        groupsById,
        corporationRow,
        operationRow,
        orbitDescriptor,
        existingEntry: existingStationsById.get(stationID) || null,
        mapSolarSystemsById,
        orbitLookups,
      });
    })
    .filter(Boolean);
  stationsRoot.count = stationsRoot.stations.length;
  ensureJsonlSync(stationsRoot).updatedStationIDs = uniqueSortedNumbers(
    [...npcStationsById.keys()],
  );

  for (const gateID of missingStargateIDs) {
    const row = mapStargatesById.get(gateID);
    if (!row) {
      continue;
    }
    stargatesRoot.stargates.push(buildStargateRecord(row, mapSolarSystemsById));
  }
  stargatesRoot.stargates.sort((left, right) => left.itemID - right.itemID);
  stargatesRoot.count = stargatesRoot.stargates.length;
  ensureJsonlSync(stargatesRoot).updatedStargateIDs = uniqueSortedNumbers(missingStargateIDs);

  for (const starID of missingStarIDs) {
    const row = mapStarsById.get(starID);
    const systemRow = mapSolarSystemsById.get(toNumber(row && row.solarSystemID)) || null;
    const typeRow = typesById.get(toNumber(row && row.typeID)) || null;
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    if (!row || !systemRow) {
      continue;
    }
    celestialsRoot.celestials.push(buildStarRecord(row, systemRow, typeRow, groupRow));
  }
  for (const planetID of missingPlanetIDs) {
    const row = mapPlanetsById.get(planetID);
    const systemRow = mapSolarSystemsById.get(toNumber(row && row.solarSystemID)) || null;
    const typeRow = typesById.get(toNumber(row && row.typeID)) || null;
    const groupRow = getGroupRow(groupsById, toNumber(typeRow && typeRow.groupID));
    if (!row || !systemRow) {
      continue;
    }
    celestialsRoot.celestials.push(buildPlanetRecord(row, systemRow, typeRow, groupRow));
  }
  celestialsRoot.celestials.sort((left, right) => left.itemID - right.itemID);
  celestialsRoot.count = celestialsRoot.celestials.length;
  ensureJsonlSync(celestialsRoot).updatedCelestialIDs = uniqueSortedNumbers([
    ...missingStarIDs,
    ...missingPlanetIDs,
  ]);

  const movementTypeIDs = uniqueSortedNumbers([...relevantMovementTypeIDs]);
  const movementRecords = [];
  for (const typeID of movementTypeIDs) {
    const typeRow = typesById.get(typeID);
    const dogmaRow = typeDogmaById.get(typeID) || null;
    if (!typeRow) {
      continue;
    }
    movementRecords.push(buildMovementRecord(typeRow, dogmaRow, groupsById));
  }
  movementRoot.attributes = movementRecords;
  movementRoot.attributes.sort((left, right) => left.typeID - right.typeID);
  movementRoot.count = movementRoot.attributes.length;
  ensureJsonlSync(movementRoot).updatedTypeIDs = movementTypeIDs;

  shipDogmaRoot.attributeTypesByID = Object.fromEntries(
    [...dogmaAttributesById.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([attributeID, attributeRow]) => [
        String(attributeID),
        buildDogmaAttributeTypeRecord(attributeRow),
      ]),
  );
  shipDogmaRoot.shipAttributesByTypeID = Object.fromEntries(
    publishedShipTypeIDs
      .filter((typeID) => allDogmaTypeIds.has(typeID) && typeDogmaById.has(typeID))
      .sort((left, right) => left - right)
      .map((typeID) => [
        String(typeID),
        buildShipDogmaRecord(typesById.get(typeID), typeDogmaById.get(typeID)),
      ]),
  );
  shipDogmaRoot.counts = {
    shipTypes: Object.keys(shipDogmaRoot.shipAttributesByTypeID || {}).length,
    attributeTypes: Object.keys(shipDogmaRoot.attributeTypesByID || {}).length,
    totalAttributes: Object.values(shipDogmaRoot.shipAttributesByTypeID || {}).reduce(
      (sum, entry) => sum + (toNumber(entry && entry.attributeCount) || 0),
      0,
    ),
  };
  ensureJsonlSync(shipDogmaRoot).updatedAttributeIDs = uniqueSortedNumbers(missingDogmaAttributeIDs);
  ensureJsonlSync(shipDogmaRoot).updatedShipTypeIDs = uniqueSortedNumbers(missingDogmaShipTypeIDs);

  const sdeRow = sdeMeta.get(1) || null;
  for (const root of [
    shipTypesRoot,
    skillTypesRoot,
    solarSystemsRoot,
    stationsRoot,
    stationTypesRoot,
    stargatesRoot,
    stargateTypesRoot,
    celestialsRoot,
    movementRoot,
    shipDogmaRoot,
  ]) {
    markJsonlAuthority(root, jsonlDir, sdeRow);
    const sync = ensureJsonlSync(root);
    sync.sourceDir = jsonlDir;
    sync.syncedAt = new Date().toISOString();
    sync.buildNumber = sdeRow ? sdeRow.buildNumber || null : null;
    sync.releaseDate = sdeRow ? sdeRow.releaseDate || null : null;
  }
  stationsRoot.source.localExtensions = {
    preservedFields: [
      "dockingCostPerVolume",
      "maxShipVolumeDockable",
      "officeRentalCost",
      "dockEntry",
      "dockPosition",
      "dockOrientation",
      "undockDirection",
      "undockPosition",
    ],
    note: "These fields are preserved from local station geometry data because the JSONL SDE does not include dock/undock transforms.",
  };
  stationTypesRoot.source.localExtensions = {
    preservedFields: [
      "dockEntry",
      "dockOrientation",
    ],
    note: "These fields are preserved from local station geometry data because the JSONL SDE does not include dock transforms.",
  };

  writeJson(path.join(localDbRoot, "shipTypes", "data.json"), shipTypesRoot);
  writeJson(path.join(localDbRoot, "skillTypes", "data.json"), skillTypesRoot);
  writeJson(path.join(localDbRoot, "solarSystems", "data.json"), solarSystemsRoot);
  writeJson(path.join(localDbRoot, "stations", "data.json"), stationsRoot);
  writeJson(path.join(localDbRoot, "stationTypes", "data.json"), stationTypesRoot);
  writeJson(path.join(localDbRoot, "stargateTypes", "data.json"), stargateTypesRoot);
  writeJson(path.join(localDbRoot, "stargates", "data.json"), stargatesRoot);
  writeJson(path.join(localDbRoot, "celestials", "data.json"), celestialsRoot);
  writeJson(path.join(localDbRoot, "movementAttributes", "data.json"), movementRoot);
  writeJson(path.join(localDbRoot, "shipDogmaAttributes", "data.json"), shipDogmaRoot);

  console.log(JSON.stringify({
    shipTypesAdded: missingShipTypeIDs.length,
    skillTypesAdded: missingSkillTypeIDs.length,
    solarSystemsAdded: missingSolarSystemIDs.length,
    stationsAdded: missingStationIDs.length,
    stationTypesAdded: missingStationTypeIDs.length,
    stargatesAdded: missingStargateIDs.length,
    celestialsAdded: missingStarIDs.length + missingPlanetIDs.length,
    movementAttributesAdded: missingMovementTypeIDs.length,
    shipDogmaShipTypesAdded: missingDogmaShipTypeIDs.length,
    shipDogmaAttributeTypesAdded: missingDogmaAttributeIDs.length,
    shipDogmaTotalAttributes: shipDogmaRoot.counts.totalAttributes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
