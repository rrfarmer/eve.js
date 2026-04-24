const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const asteroidData = require(path.join(__dirname, "./asteroidData"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  getSolarSystemOreTypeRecords,
  resolveMiningVisualPresentation,
} = require(path.join(__dirname, "../../services/mining/miningVisuals"));
const {
  classifyMiningMaterialType,
} = require(path.join(__dirname, "../../services/mining/miningInventory"));
const {
  recordAsteroidBootstrap,
  resetMiningStartupSummary,
} = require(path.join(__dirname, "../../services/mining/miningStartupSummary"));
const {
  getSolarSystemByID,
} = require(path.join(__dirname, "../../space/worldData"));

const STATIC_ASTEROID_ITEM_ID_BASE = 5_000_000_000_000;
const STATIC_ASTEROID_ITEM_ID_STRIDE = 128;

// Canonical ore family typeIDs keyed by base family name.
// This avoids fragile name-to-item resolution during security-band enrichment.
const ORE_FAMILY_TYPE_IDS = {
  "Veldspar": [1230, 17470, 17471],
  "Scordite": [1228, 17463, 17464],
  "Pyroxeres": [1224, 17459, 17460],
  "Plagioclase": [18, 17455, 17456],
  "Omber": [1227, 17867, 17868],
  "Kernite": [20, 17452, 17453],
  "Jaspet": [1226],
  "Hemorphite": [1231],
  "Hedbergite": [21],
  "Dark Ochre": [1223],
  "Gneiss": [1229],
  "Crokite": [1225, 17432, 17433],
  "Bistot": [],
  "Arkonor": [22, 17425, 17426],
  "Mercoxit": [11396, 17869, 17870],
};

const SECURITY_CLASS_FAMILIES = {
  A: ["Veldspar", "Scordite"],
  B: ["Veldspar", "Scordite", "Pyroxeres"],
  C: ["Veldspar", "Scordite", "Pyroxeres", "Plagioclase", "Omber"],
  C1: ["Veldspar", "Scordite", "Pyroxeres", "Plagioclase", "Omber"],
  C2: ["Pyroxeres", "Plagioclase", "Omber", "Kernite", "Jaspet"],
  D: ["Pyroxeres", "Plagioclase", "Omber", "Kernite", "Jaspet"],
  D1: ["Pyroxeres", "Plagioclase", "Omber", "Kernite", "Jaspet"],
  E: ["Kernite", "Jaspet", "Hemorphite", "Hedbergite"],
  E1: ["Kernite", "Jaspet", "Hemorphite", "Hedbergite"],
  F: ["Hemorphite", "Hedbergite", "Dark Ochre", "Gneiss"],
  F1: ["Hemorphite", "Hedbergite", "Dark Ochre", "Gneiss"],
  G: ["Dark Ochre", "Gneiss", "Crokite", "Bistot"],
  G1: ["Dark Ochre", "Gneiss", "Crokite", "Bistot"],
  H: ["Crokite", "Bistot", "Arkonor", "Mercoxit"],
  H1: ["Crokite", "Bistot", "Arkonor", "Mercoxit"],
};

const BELT_BUCKETS = {
  common: { targetMin: 2, targetMax: 4, weight: 6 },
  uncommon: { targetMin: 1, targetMax: 3, weight: 5 },
  rare: { targetMin: 1, targetMax: 2, weight: 2.5 },
};

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(vector && vector.x, fallback.x),
    y: toFiniteNumber(vector && vector.y, fallback.y),
    z: toFiniteNumber(vector && vector.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function createRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let output = state;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAsteroidItemID(beltID, asteroidIndex) {
  return (
    STATIC_ASTEROID_ITEM_ID_BASE +
    (toPositiveInt(beltID, 0) * STATIC_ASTEROID_ITEM_ID_STRIDE) +
    asteroidIndex
  );
}

function pickWeightedEntry(entries, rng) {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      ...entry,
      weight: Math.max(0, toFiniteNumber(entry && entry.weight, 0)),
    }))
    .filter((entry) => entry.weight > 0);
  if (normalizedEntries.length <= 0) {
    return null;
  }

  const totalWeight = normalizedEntries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * totalWeight;
  for (const entry of normalizedEntries) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry;
    }
  }
  return normalizedEntries[normalizedEntries.length - 1];
}

function pickIntegerInRange(minimum, maximum, rng) {
  const min = Math.trunc(Math.min(minimum, maximum));
  const max = Math.trunc(Math.max(minimum, maximum));
  if (max <= min) {
    return min;
  }
  return min + Math.floor(rng() * ((max - min) + 1));
}

function buildClusterOffsets(belt, rng) {
  const clusterCount = Math.max(1, toPositiveInt(belt.clusterCount, 1));
  const fieldRadiusMeters = Math.max(4_000, toFiniteNumber(belt.fieldRadiusMeters, 32_000));
  const verticalSpreadMeters = Math.max(1_000, toFiniteNumber(belt.verticalSpreadMeters, 4_500));
  const offsets = [];

  for (let index = 0; index < clusterCount; index += 1) {
    const theta = rng() * Math.PI * 2;
    const distanceRatio = Math.sqrt(rng());
    const radialDistance = fieldRadiusMeters * 0.2 + (distanceRatio * fieldRadiusMeters * 0.65);
    offsets.push({
      x: Math.cos(theta) * radialDistance,
      y: ((rng() * 2) - 1) * verticalSpreadMeters,
      z: Math.sin(theta) * radialDistance,
    });
  }

  return offsets;
}

function buildAsteroidOffset(belt, clusterOffset, rng) {
  const clusterRadiusMeters = Math.max(1_500, toFiniteNumber(belt.clusterRadiusMeters, 6_000));
  const verticalSpreadMeters = Math.max(800, toFiniteNumber(belt.verticalSpreadMeters, 4_500));
  const theta = rng() * Math.PI * 2;
  const distanceRatio = Math.sqrt(rng());
  const radialDistance = distanceRatio * clusterRadiusMeters;
  const localOffset = {
    x: Math.cos(theta) * radialDistance,
    y: ((rng() * 2) - 1) * verticalSpreadMeters,
    z: Math.sin(theta) * radialDistance,
  };

  return addVectors(clusterOffset, localOffset);
}

function resolveRecordWeight(record) {
  if (!record || typeof record !== "object") {
    return 1;
  }
  const candidates = [
    "weight",
    "spawnWeight",
    "chance",
    "probability",
    "frequency",
    "abundance",
    "rarityWeight",
    "quantity",
    "count",
  ];
  for (const key of candidates) {
    const value = toFiniteNumber(record[key], NaN);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 1;
}

function buildSystemOrePool(systemID) {
  const records = getSolarSystemOreTypeRecords(systemID);
  const mergedByTypeID = new Map();
  for (const record of records) {
    if (!record) {
      continue;
    }
    const typeID = toPositiveInt(record.typeID, 0);
    if (typeID <= 0) {
      continue;
    }
    const classification = classifyMiningMaterialType(record);
    if (!classification || classification.kind !== "ore") {
      continue;
    }
    const existing = mergedByTypeID.get(typeID);
    const nextWeight = resolveRecordWeight(record);
    if (!existing) {
      mergedByTypeID.set(typeID, {
        ...record,
        weight: nextWeight,
        spawnWeight: nextWeight,
      });
      continue;
    }
    existing.weight = Math.max(0.000001, toFiniteNumber(existing.weight, 1)) + nextWeight;
    existing.spawnWeight = existing.weight;
  }
  return Array.from(mergedByTypeID.values());
}

function getSecurityMetadata(systemID) {
  const row = getSolarSystemByID(toPositiveInt(systemID, 0)) || {};
  const securityStatus = toFiniteNumber(
    row.securityStatus ?? row.security ?? row.trueSec,
    0,
  );
  let securityClass = String(row.securityClass || "").trim().toUpperCase();

  if (!securityClass) {
    if (securityStatus >= 0.85) {
      securityClass = "A";
    } else if (securityStatus >= 0.65) {
      securityClass = "B";
    } else if (securityStatus >= 0.45) {
      securityClass = "C";
    } else if (securityStatus >= 0.25) {
      securityClass = "D";
    } else if (securityStatus >= 0.05) {
      securityClass = "E";
    } else {
      securityClass = "F";
    }
  }

  return { securityClass, securityStatus };
}

function inferFamilyName(record) {
  const name = String(record && record.name || "").trim();
  if (!name) {
    return "";
  }
  const knownFamilies = Object.keys(ORE_FAMILY_TYPE_IDS).sort((a, b) => b.length - a.length);
  for (const family of knownFamilies) {
    if (
      name === family ||
      name.startsWith(`${family} `) ||
      name.includes(`${family} II-Grade`) ||
      name.includes(`${family} III-Grade`)
    ) {
      return family;
    }
  }
  return name.replace(/\s+(II|III)-Grade$/i, "").trim();
}

function classifyFamilyBucket(familyName, securityClass) {
  const families =
    SECURITY_CLASS_FAMILIES[securityClass] ||
    SECURITY_CLASS_FAMILIES[String(securityClass || "").replace(/[0-9]+$/, "")] ||
    [];
  const index = families.indexOf(familyName);
  if (index < 0) {
    return "rare";
  }
  if (index <= 1) {
    return "common";
  }
  if (index <= 3) {
    return "uncommon";
  }
  return "rare";
}

function buildSecurityBandOreCandidates(securityClass) {
  const normalized = String(securityClass || "").toUpperCase();
  const fallback = normalized.replace(/[0-9]+$/, "");
  const familyNames = SECURITY_CLASS_FAMILIES[normalized] || SECURITY_CLASS_FAMILIES[fallback] || [];
  const rows = [];
  const seenTypeIDs = new Set();

  for (const familyName of familyNames) {
    const typeIDs = ORE_FAMILY_TYPE_IDS[familyName] || [];
    for (const typeID of typeIDs) {
      const safeTypeID = toPositiveInt(typeID, 0);
      if (safeTypeID <= 0 || seenTypeIDs.has(safeTypeID)) {
        continue;
      }

      const row = resolveItemByTypeID(safeTypeID);
      if (!row) {
        continue;
      }

      const classification = classifyMiningMaterialType(row);
      if (!classification || classification.kind !== "ore") {
        continue;
      }

      seenTypeIDs.add(safeTypeID);
      rows.push({
        ...row,
        typeID: toPositiveInt(row.typeID, safeTypeID),
        familyName,
        weight: 1,
        spawnWeight: 1,
      });
    }
  }

  return rows;
}

function buildEnrichedSystemOrePool(systemID) {
  const rawPool = buildSystemOrePool(systemID);
  const { securityClass, securityStatus } = getSecurityMetadata(systemID);
  const mergedByTypeID = new Map();

  for (const row of rawPool) {
    const typeID = toPositiveInt(row.typeID, 0);
    if (typeID > 0) {
      mergedByTypeID.set(typeID, {
        ...row,
        familyName: inferFamilyName(row),
        spawnWeight: Math.max(0.000001, toFiniteNumber(row.spawnWeight ?? row.weight, 1)),
      });
    }
  }

  const rawFamilyCount = new Set(rawPool.map((row) => inferFamilyName(row)).filter(Boolean)).size;
  const shouldEnrich = rawPool.length < 10 || rawFamilyCount < 4;

  if (shouldEnrich) {
    const extraCandidates = buildSecurityBandOreCandidates(securityClass);
    for (const candidate of extraCandidates) {
      const typeID = toPositiveInt(candidate.typeID, 0);
      if (typeID <= 0 || mergedByTypeID.has(typeID)) {
        continue;
      }
      const familyName = inferFamilyName(candidate);
      const bucket = classifyFamilyBucket(familyName, securityClass);
      const weight = bucket === "common" ? 1.5 : bucket === "uncommon" ? 1.15 : 0.8;
      mergedByTypeID.set(typeID, {
        ...candidate,
        familyName,
        weight,
        spawnWeight: weight,
        enriched: true,
      });
    }
  }

  const orePool = Array.from(mergedByTypeID.values())
    .filter((row) => {
      const classification = classifyMiningMaterialType(row);
      return classification && classification.kind === "ore";
    })
    .sort((left, right) => {
      const nameDelta = String(left.familyName || left.name || "").localeCompare(
        String(right.familyName || right.name || ""),
      );
      if (nameDelta !== 0) {
        return nameDelta;
      }
      return toPositiveInt(left.typeID, 0) - toPositiveInt(right.typeID, 0);
    });

  return {
    orePool,
    securityClass,
    securityStatus,
  };
}

function groupEntriesByFamily(entries) {
  const grouped = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const familyName = String(entry && entry.familyName || inferFamilyName(entry)).trim();
    if (!familyName) {
      continue;
    }
    if (!grouped.has(familyName)) {
      grouped.set(familyName, []);
    }
    grouped.get(familyName).push({
      ...entry,
      familyName,
    });
  }
  return grouped;
}

function resolveGradeVariantWeight(entry) {
  const name = String(entry && entry.name || "").trim();
  if (/\bIII-Grade\b/i.test(name)) {
    return 0.7;
  }
  if (/\bII-Grade\b/i.test(name)) {
    return 1.0;
  }
  return 1.35;
}

function buildBeltOreSubset(orePool, securityClass, rng) {
  const bucketed = {
    common: [],
    uncommon: [],
    rare: [],
  };

  for (const entry of orePool) {
    const familyName = String(entry && entry.familyName || inferFamilyName(entry)).trim();
    if (!familyName) {
      continue;
    }
    const bucket = classifyFamilyBucket(familyName, securityClass);
    bucketed[bucket].push({
      ...entry,
      familyName,
      spawnBucket: bucket,
      spawnWeight: bucket === "common" ? 6 : bucket === "uncommon" ? 5 : 2.5,
    });
  }

  const subset = [];
  for (const [bucketName, rules] of Object.entries(BELT_BUCKETS)) {
    const groupedCandidates = groupEntriesByFamily(bucketed[bucketName]);
    const familyNames = Array.from(groupedCandidates.keys()).sort((a, b) => String(a).localeCompare(String(b)));
    if (familyNames.length <= 0) {
      continue;
    }

    const target = Math.min(
      familyNames.length,
      pickIntegerInRange(rules.targetMin, rules.targetMax, rng),
    );

    const shuffledFamilies = [...familyNames];
    for (let index = shuffledFamilies.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1));
      [shuffledFamilies[index], shuffledFamilies[swapIndex]] =
        [shuffledFamilies[swapIndex], shuffledFamilies[index]];
    }

    for (let index = 0; index < target; index += 1) {
      const familyName = shuffledFamilies[index];
      const familyEntries = (groupedCandidates.get(familyName) || [])
        .sort((left, right) => toPositiveInt(left && left.typeID, 0) - toPositiveInt(right && right.typeID, 0));

      for (const familyEntry of familyEntries) {
        const variantWeight = resolveGradeVariantWeight(familyEntry);
        subset.push({
          ...familyEntry,
          spawnBucket: bucketName,
          spawnWeight: Math.max(0.000001, toFiniteNumber(rules.weight, 1) * variantWeight),
        });
      }
    }
  }

  return subset.length > 0
    ? subset
    : orePool.slice(0, Math.min(orePool.length, 6)).map((entry) => ({
      ...entry,
      familyName: String(entry && entry.familyName || inferFamilyName(entry)).trim(),
      spawnBucket: "common",
      spawnWeight: resolveGradeVariantWeight(entry),
    }));
}

function selectSystemOreType(pool, rng) {
  const entries = Array.isArray(pool) ? pool : [];
  if (entries.length <= 0) {
    return null;
  }

  const weightedEntries = entries
    .map((entry) => ({
      ...entry,
      weight: Math.max(0.000001, toFiniteNumber(entry && entry.spawnWeight, 1)),
    }))
    .filter((entry) => entry.weight > 0);

  return pickWeightedEntry(weightedEntries, rng) ||
    weightedEntries[0] ||
    null;
}

function buildSystemOreAsteroidEntity(scene, belt, asteroidIndex, totalCount, clusterOffsets, rng, pool) {
  const typeRow = selectSystemOreType(pool, rng);
  if (!typeRow) {
    return null;
  }

  const itemID = buildAsteroidItemID(belt.itemID, asteroidIndex + 1);
  const clusterOffset = clusterOffsets[asteroidIndex % clusterOffsets.length] || { x: 0, y: 0, z: 0 };
  const asteroidOffset = buildAsteroidOffset(belt, clusterOffset, rng);
  const position = addVectors(cloneVector(belt.position), asteroidOffset);
  const visualPresentation = resolveMiningVisualPresentation(typeRow, {
    entityID: itemID,
    radius: typeRow.radius,
  });

  const name = typeRow.name || `${belt.itemName} Asteroid ${asteroidIndex + 1}`;
  return {
    kind: "asteroid",
    generatedAsteroid: true,
    generatedFromSystemIDTable: true,
    resourceFieldSource: "systemID",
    itemID,
    typeID: typeRow.typeID,
    groupID: typeRow.groupID,
    categoryID: typeRow.categoryID,
    slimTypeID: typeRow.typeID,
    slimGroupID: typeRow.groupID,
    slimCategoryID: typeRow.categoryID,
    miningYieldTypeID: typeRow.typeID,
    miningYieldKind: "ore",
    itemName: name,
    slimName: name,
    ownerID: 1,
    radius: Math.max(500, toFiniteNumber(typeRow.radius, 1_800)),
    graphicID: toPositiveInt(
      visualPresentation.graphicID,
      toPositiveInt(typeRow.graphicID, 0),
    ),
    slimGraphicID: toPositiveInt(
      visualPresentation.graphicID,
      toPositiveInt(typeRow.graphicID, 0),
    ),
    visualTypeID: typeRow.typeID,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    beltID: belt.itemID,
    fieldStyleID: belt.fieldStyleID,
    staticVisibilityScope: "bubble",
  };
}

function buildDecorativeFallbackAsteroidEntity(_belt, _style, _asteroidIndex, _clusterOffsets, _rng) {
  return null;
}

function populateBeltField(scene, belt) {
  const style = asteroidData.getFieldStyleByID(belt.fieldStyleID);
  if (!scene || !belt) {
    return [];
  }

  const totalCount = Math.max(0, toPositiveInt(belt.asteroidCount, 0));
  if (totalCount <= 0) {
    return [];
  }

  const rng = createRng(toPositiveInt(belt.fieldSeed, belt.itemID));
  const clusterOffsets = buildClusterOffsets(belt, rng);
  const enriched = buildEnrichedSystemOrePool(scene.systemID);
  const systemOrePool = enriched.orePool;
  const beltSubset = buildBeltOreSubset(systemOrePool, enriched.securityClass, rng);

  const spawned = [];
  for (let asteroidIndex = 0; asteroidIndex < totalCount; asteroidIndex += 1) {
    const entity = beltSubset.length > 0
      ? buildSystemOreAsteroidEntity(scene, belt, asteroidIndex, totalCount, clusterOffsets, rng, beltSubset)
      : buildDecorativeFallbackAsteroidEntity(belt, style, asteroidIndex, clusterOffsets, rng);
    if (!entity) {
      continue;
    }
    if (scene.addStaticEntity(entity)) {
      spawned.push(entity);
    }
  }

  recordAsteroidBootstrap(scene, {
    beltID: toPositiveInt(belt && belt.itemID, 0),
    spawnedCount: spawned.length,
    orePool: systemOrePool,
    beltSubset,
    securityClass: enriched.securityClass,
    securityStatus: enriched.securityStatus,
  });

  return spawned;
}

function listGeneratedAsteroidEntities(scene) {
  if (!scene || !Array.isArray(scene.staticEntities)) {
    return [];
  }
  return scene.staticEntities.filter((entity) => (
    entity &&
    String(entity.kind || "").toLowerCase() === "asteroid" &&
    toPositiveInt(entity.beltID, 0) > 0
  ));
}

function handleSceneCreated(scene) {
  if (!scene || scene._asteroidFieldsInitialized === true) {
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  if (config.asteroidFieldsEnabled !== true) {
    scene._asteroidFieldsInitialized = true;
    return {
      success: true,
      data: {
        spawned: [],
      },
    };
  }

  scene._asteroidFieldsInitialized = true;
  const belts = asteroidData.getBeltsForSystem(scene.systemID);
  const spawned = [];
  for (const belt of belts) {
    spawned.push(...populateBeltField(scene, belt));
  }

  return {
    success: true,
    data: {
      spawned,
    },
  };
}

function resetSceneAsteroidFields(scene, options = {}) {
  if (!scene) {
    return {
      success: false,
      errorMsg: "SCENE_NOT_FOUND",
    };
  }

  resetMiningStartupSummary(scene);
  const removedEntityIDs = [];
  for (const entity of listGeneratedAsteroidEntities(scene)) {
    if (
      scene.removeStaticEntity(entity.itemID, {
        broadcast: options.broadcast === true,
        nowMs: options.nowMs,
      })
    ) {
      removedEntityIDs.push(entity.itemID);
    }
  }

  scene._asteroidFieldsInitialized = false;
  const spawnResult = handleSceneCreated(scene);
  if (!spawnResult.success) {
    return spawnResult;
  }

  return {
    success: true,
    data: {
      removedEntityIDs,
      removedCount: removedEntityIDs.length,
      spawned: Array.isArray(spawnResult.data && spawnResult.data.spawned)
        ? spawnResult.data.spawned
        : [],
    },
  };
}

module.exports = {
  handleSceneCreated,
  resetSceneAsteroidFields,
  _testing: {
    buildAsteroidItemID,
    populateBeltField,
    listGeneratedAsteroidEntities,
    buildSystemOrePool,
    buildEnrichedSystemOrePool,
    buildBeltOreSubset,
  },
};
