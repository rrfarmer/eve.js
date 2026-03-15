const fs = require("fs");
const path = require("path");
const readline = require("readline");

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

function uniqueSortedNumbers(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => toNumber(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
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
    const rowId = toNumber(idSelector(row));
    if (!Number.isInteger(rowId) || rowId <= 0) {
      continue;
    }

    rows.set(rowId, row);
  }

  return rows;
}

async function loadJsonlGroups(filePath, keySelector) {
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
    const key = toNumber(keySelector(row));
    if (!Number.isInteger(key) || key <= 0) {
      continue;
    }

    if (!rows.has(key)) {
      rows.set(key, []);
    }

    rows.get(key).push(row);
  }

  return rows;
}

function buildMaterialEntry(existingEntry, upstreamRow) {
  const numericMaterialID = toNumber(
    upstreamRow && (upstreamRow.skinMaterialID || upstreamRow._key),
  ) || toNumber(existingEntry && existingEntry.skinMaterialID);

  return {
    ...(existingEntry && typeof existingEntry === "object" ? existingEntry : {}),
    skinMaterialID: numericMaterialID,
    displayNameID:
      existingEntry && Object.prototype.hasOwnProperty.call(existingEntry, "displayNameID")
        ? existingEntry.displayNameID
        : null,
    materialSetID:
      existingEntry && Object.prototype.hasOwnProperty.call(existingEntry, "materialSetID")
        ? existingEntry.materialSetID
        : toNumber(upstreamRow && upstreamRow.materialSetID),
    displayName:
      existingEntry && Object.prototype.hasOwnProperty.call(existingEntry, "displayName")
        ? existingEntry.displayName
        : (upstreamRow && upstreamRow.displayName) || null,
    skinIDs: [],
    shipTypeIDs: [],
    licenseTypeIDs: [],
  };
}

function buildSkinEntry(existingEntry, upstreamRow, materialEntry) {
  const numericSkinID = toNumber(
    upstreamRow && (upstreamRow.skinID || upstreamRow._key),
  ) || toNumber(existingEntry && existingEntry.skinID);
  const numericMaterialID =
    toNumber(upstreamRow && upstreamRow.skinMaterialID) ||
    toNumber(existingEntry && existingEntry.skinMaterialID);

  return {
    ...(existingEntry && typeof existingEntry === "object" ? existingEntry : {}),
    skinID: numericSkinID,
    internalName:
      (existingEntry && existingEntry.internalName) ||
      (upstreamRow && upstreamRow.internalName) ||
      "",
    skinMaterialID: numericMaterialID || null,
    material: {
      ...(existingEntry && existingEntry.material && typeof existingEntry.material === "object"
        ? existingEntry.material
        : {}),
      skinMaterialID: numericMaterialID || null,
      displayNameID:
        existingEntry &&
        existingEntry.material &&
        Object.prototype.hasOwnProperty.call(existingEntry.material, "displayNameID")
          ? existingEntry.material.displayNameID
          : (materialEntry ? materialEntry.displayNameID : null),
      materialSetID:
        existingEntry &&
        existingEntry.material &&
        Object.prototype.hasOwnProperty.call(existingEntry.material, "materialSetID")
          ? existingEntry.material.materialSetID
          : (materialEntry ? materialEntry.materialSetID : null),
      displayName:
        existingEntry &&
        existingEntry.material &&
        Object.prototype.hasOwnProperty.call(existingEntry.material, "displayName")
          ? existingEntry.material.displayName
          : (materialEntry ? materialEntry.displayName : null),
    },
    shipTypeIDs: uniqueSortedNumbers([
      ...((existingEntry && existingEntry.shipTypeIDs) || []),
      ...(((upstreamRow && upstreamRow.types) || []).map((value) => toNumber(value))),
    ]),
    licenseTypeIDs: [],
    licenseTypes: [],
    allowCCPDevs:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "allowCCPDevs")
        ? Boolean(upstreamRow.allowCCPDevs)
        : Boolean(existingEntry && existingEntry.allowCCPDevs),
    skinDescription:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "skinDescription")
        ? upstreamRow.skinDescription
        : (existingEntry && existingEntry.skinDescription) || null,
    visibleSerenity:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "visibleSerenity")
        ? Boolean(upstreamRow.visibleSerenity)
        : Boolean(existingEntry && existingEntry.visibleSerenity),
    visibleTranquility:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "visibleTranquility")
        ? Boolean(upstreamRow.visibleTranquility)
        : Boolean(existingEntry && existingEntry.visibleTranquility),
  };
}

function buildLicenseMetadata(typesById, groupsById, licenseTypeID) {
  const typeRow = typesById.get(licenseTypeID) || null;
  const groupID = toNumber(typeRow && typeRow.groupID);
  const groupRow = groupID ? groupsById.get(groupID) || null : null;

  return {
    typeName: englishText(typeRow && typeRow.name),
    published:
      typeRow && Object.prototype.hasOwnProperty.call(typeRow, "published")
        ? Boolean(typeRow.published)
        : false,
    groupID,
    groupName: englishText(groupRow && groupRow.name),
    groupPublished:
      groupRow && Object.prototype.hasOwnProperty.call(groupRow, "published")
        ? Boolean(groupRow.published)
        : false,
  };
}

function buildLicenseEntry(existingEntry, upstreamRow, skinEntry, typesById, groupsById) {
  const numericLicenseTypeID = toNumber(
    upstreamRow && (upstreamRow.licenseTypeID || upstreamRow._key),
  ) || toNumber(existingEntry && existingEntry.licenseTypeID);
  const numericSkinID =
    toNumber(upstreamRow && upstreamRow.skinID) ||
    toNumber(existingEntry && existingEntry.skinID);
  const metadata = buildLicenseMetadata(typesById, groupsById, numericLicenseTypeID);
  const shipTypeIDs = uniqueSortedNumbers([
    ...((existingEntry && existingEntry.shipTypeIDs) || []),
    ...((skinEntry && skinEntry.shipTypeIDs) || []),
  ]);

  return {
    ...(existingEntry && typeof existingEntry === "object" ? existingEntry : {}),
    licenseTypeID: numericLicenseTypeID,
    skinID: numericSkinID || null,
    skinMaterialID:
      (skinEntry && skinEntry.skinMaterialID) ||
      (existingEntry && existingEntry.skinMaterialID) ||
      null,
    internalName:
      (skinEntry && skinEntry.internalName) ||
      (existingEntry && existingEntry.internalName) ||
      "",
    shipTypeIDs,
    duration:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "duration")
        ? toNumber(upstreamRow.duration)
        : toNumber(existingEntry && existingEntry.duration),
    isSingleUse:
      upstreamRow && Object.prototype.hasOwnProperty.call(upstreamRow, "isSingleUse")
        ? Boolean(upstreamRow.isSingleUse)
        : Boolean(existingEntry && existingEntry.isSingleUse),
    typeName: metadata.typeName || (existingEntry && existingEntry.typeName) || null,
    published:
      metadata.typeName !== null || metadata.groupID !== null
        ? metadata.published
        : Boolean(existingEntry && existingEntry.published),
    groupID:
      metadata.groupID !== null
        ? metadata.groupID
        : toNumber(existingEntry && existingEntry.groupID),
    groupName: metadata.groupName || (existingEntry && existingEntry.groupName) || null,
    groupPublished:
      metadata.groupID !== null
        ? metadata.groupPublished
        : Boolean(existingEntry && existingEntry.groupPublished),
    missingSkinDefinition:
      !skinEntry ||
      !Number.isInteger(toNumber(skinEntry.skinID)) ||
      toNumber(skinEntry.skinID) <= 0,
  };
}

function reindexCatalog(catalog) {
  const materialEntries = {};
  for (const [materialID, materialEntry] of Object.entries(catalog.materialsByMaterialID || {})) {
    materialEntries[materialID] = buildMaterialEntry(materialEntry, null);
  }

  const shipTypeEntries = {};
  const licenseRowsBySkinID = new Map();
  for (const licenseEntry of Object.values(catalog.licenseTypesByTypeID || {})) {
    const skinID = toNumber(licenseEntry && licenseEntry.skinID);
    if (!Number.isInteger(skinID) || skinID <= 0) {
      continue;
    }

    if (!licenseRowsBySkinID.has(skinID)) {
      licenseRowsBySkinID.set(skinID, []);
    }

    licenseRowsBySkinID.get(skinID).push(licenseEntry);
  }

  for (const [skinID, skinEntry] of Object.entries(catalog.skinsBySkinID || {})) {
    const numericSkinID = toNumber(skinID);
    if (!Number.isInteger(numericSkinID) || numericSkinID <= 0) {
      continue;
    }

    const skinMaterialID = toNumber(skinEntry.skinMaterialID);
    const shipTypeIDs = uniqueSortedNumbers(skinEntry.shipTypeIDs);
    const licenseEntries = (licenseRowsBySkinID.get(numericSkinID) || [])
      .slice()
      .sort((left, right) => left.licenseTypeID - right.licenseTypeID);
    const licenseTypeIDs = licenseEntries.map((entry) => entry.licenseTypeID);

    catalog.skinsBySkinID[skinID] = {
      ...skinEntry,
      shipTypeIDs,
      licenseTypeIDs,
      licenseTypes: licenseEntries.map((entry) => ({
        licenseTypeID: entry.licenseTypeID,
        duration: entry.duration,
        isSingleUse: Boolean(entry.isSingleUse),
        typeName: entry.typeName || null,
        published: Boolean(entry.published),
        groupID: toNumber(entry.groupID),
        groupName: entry.groupName || null,
        groupPublished: Boolean(entry.groupPublished),
      })),
    };

    if (Number.isInteger(skinMaterialID) && skinMaterialID > 0) {
      const materialKey = String(skinMaterialID);
      if (!materialEntries[materialKey]) {
        materialEntries[materialKey] = buildMaterialEntry(null, { _key: skinMaterialID });
      }
      materialEntries[materialKey].skinIDs.push(numericSkinID);
      materialEntries[materialKey].shipTypeIDs.push(...shipTypeIDs);
      materialEntries[materialKey].licenseTypeIDs.push(...licenseTypeIDs);
    }

    for (const typeID of shipTypeIDs) {
      const typeKey = String(typeID);
      if (!shipTypeEntries[typeKey]) {
        shipTypeEntries[typeKey] = {
          typeID,
          skinIDs: [],
          materialIDs: [],
          licenseTypeIDs: [],
        };
      }

      shipTypeEntries[typeKey].skinIDs.push(numericSkinID);
      if (Number.isInteger(skinMaterialID) && skinMaterialID > 0) {
        shipTypeEntries[typeKey].materialIDs.push(skinMaterialID);
      }
      shipTypeEntries[typeKey].licenseTypeIDs.push(...licenseTypeIDs);
    }
  }

  for (const materialEntry of Object.values(materialEntries)) {
    materialEntry.skinIDs = uniqueSortedNumbers(materialEntry.skinIDs);
    materialEntry.shipTypeIDs = uniqueSortedNumbers(materialEntry.shipTypeIDs);
    materialEntry.licenseTypeIDs = uniqueSortedNumbers(materialEntry.licenseTypeIDs);
  }

  for (const shipTypeEntry of Object.values(shipTypeEntries)) {
    shipTypeEntry.skinIDs = uniqueSortedNumbers(shipTypeEntry.skinIDs);
    shipTypeEntry.materialIDs = uniqueSortedNumbers(shipTypeEntry.materialIDs);
    shipTypeEntry.licenseTypeIDs = uniqueSortedNumbers(shipTypeEntry.licenseTypeIDs);
  }

  catalog.materialsByMaterialID = Object.fromEntries(
    Object.entries(materialEntries).sort((left, right) => Number(left[0]) - Number(right[0])),
  );
  catalog.shipTypesByTypeID = Object.fromEntries(
    Object.entries(shipTypeEntries).sort((left, right) => Number(left[0]) - Number(right[0])),
  );
  catalog.licenseTypesByTypeID = Object.fromEntries(
    Object.entries(catalog.licenseTypesByTypeID || {}).sort(
      (left, right) => Number(left[0]) - Number(right[0]),
    ),
  );
  catalog.skinsBySkinID = Object.fromEntries(
    Object.entries(catalog.skinsBySkinID || {}).sort(
      (left, right) => Number(left[0]) - Number(right[0]),
    ),
  );

  catalog.counts = {
    skins: Object.keys(catalog.skinsBySkinID || {}).length,
    shipTypes: Object.keys(catalog.shipTypesByTypeID || {}).length,
    materials: Object.keys(catalog.materialsByMaterialID || {}).length,
    licenseTypes: Object.keys(catalog.licenseTypesByTypeID || {}).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const jsonlDir = path.resolve(
    args.jsonlDir ||
      path.join(repoRoot, "data", "eve-online-static-data-3253748-jsonl"),
  );
  const localCatalogPath = path.resolve(
    args.localCatalog ||
      path.join(
        repoRoot,
        "server",
        "src",
        "database",
        "data",
        "shipCosmeticsCatalog",
        "data.json",
      ),
  );

  if (!fs.existsSync(jsonlDir)) {
    throw new Error(`JSONL directory not found: ${jsonlDir}`);
  }
  if (!fs.existsSync(localCatalogPath)) {
    throw new Error(`Local catalog not found: ${localCatalogPath}`);
  }

  const localCatalog = readJson(localCatalogPath);
  localCatalog.skinsBySkinID =
    localCatalog.skinsBySkinID && typeof localCatalog.skinsBySkinID === "object"
      ? localCatalog.skinsBySkinID
      : {};
  localCatalog.materialsByMaterialID =
    localCatalog.materialsByMaterialID && typeof localCatalog.materialsByMaterialID === "object"
      ? localCatalog.materialsByMaterialID
      : {};
  localCatalog.licenseTypesByTypeID =
    localCatalog.licenseTypesByTypeID &&
    typeof localCatalog.licenseTypesByTypeID === "object"
      ? localCatalog.licenseTypesByTypeID
      : {};
  localCatalog.shipTypesByTypeID =
    localCatalog.shipTypesByTypeID && typeof localCatalog.shipTypesByTypeID === "object"
      ? localCatalog.shipTypesByTypeID
      : {};

  const [
    sdeMeta,
    typesById,
    groupsById,
    materialsById,
    skinsById,
    licenseRowsBySkinID,
  ] = await Promise.all([
    loadJsonlMap(path.join(jsonlDir, "_sde.jsonl"), (row) => row._key === "sde" ? 1 : null),
    loadJsonlMap(path.join(jsonlDir, "types.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "groups.jsonl"), (row) => row._key),
    loadJsonlMap(path.join(jsonlDir, "skinMaterials.jsonl"), (row) => row.skinMaterialID || row._key),
    loadJsonlMap(path.join(jsonlDir, "skins.jsonl"), (row) => row.skinID || row._key),
    loadJsonlGroups(path.join(jsonlDir, "skinLicenses.jsonl"), (row) => row.skinID),
  ]);

  const licenseRowsByLicenseTypeID = new Map();
  for (const licenseRows of licenseRowsBySkinID.values()) {
    for (const row of licenseRows) {
      const licenseTypeID = toNumber(row.licenseTypeID || row._key);
      if (Number.isInteger(licenseTypeID) && licenseTypeID > 0) {
        licenseRowsByLicenseTypeID.set(licenseTypeID, row);
      }
    }
  }

  const summary = {
    addedSkins: 0,
    addedMaterials: 0,
    addedLicenses: 0,
    orphanLicenseTypeIDs: [],
  };

  for (const [materialID, upstreamMaterial] of materialsById.entries()) {
    const materialKey = String(materialID);
    const existed = Boolean(localCatalog.materialsByMaterialID[materialKey]);
    localCatalog.materialsByMaterialID[materialKey] = buildMaterialEntry(
      localCatalog.materialsByMaterialID[materialKey],
      upstreamMaterial,
    );
    if (!existed) {
      summary.addedMaterials += 1;
    }
  }

  for (const [skinID, upstreamSkin] of skinsById.entries()) {
    const skinKey = String(skinID);
    const materialKey = String(toNumber(upstreamSkin.skinMaterialID) || 0);
    const materialEntry =
      localCatalog.materialsByMaterialID[materialKey] ||
      buildMaterialEntry(null, materialsById.get(toNumber(materialKey)));
    const existed = Boolean(localCatalog.skinsBySkinID[skinKey]);
    localCatalog.skinsBySkinID[skinKey] = buildSkinEntry(
      localCatalog.skinsBySkinID[skinKey],
      upstreamSkin,
      materialEntry,
    );
    if (!existed) {
      summary.addedSkins += 1;
    }
  }

  for (const [licenseTypeID, upstreamLicense] of licenseRowsByLicenseTypeID.entries()) {
    const licenseKey = String(licenseTypeID);
    const skinID = toNumber(upstreamLicense.skinID);
    const skinEntry =
      Number.isInteger(skinID) && skinID > 0
        ? localCatalog.skinsBySkinID[String(skinID)] || null
        : null;
    const existed = Boolean(localCatalog.licenseTypesByTypeID[licenseKey]);
    localCatalog.licenseTypesByTypeID[licenseKey] = buildLicenseEntry(
      localCatalog.licenseTypesByTypeID[licenseKey],
      upstreamLicense,
      skinEntry,
      typesById,
      groupsById,
    );
    if (!existed) {
      summary.addedLicenses += 1;
    }
    if (!skinEntry) {
      summary.orphanLicenseTypeIDs.push(licenseTypeID);
    }
  }

  reindexCatalog(localCatalog);

  const sdeRow = sdeMeta.get(1) || null;
  const nextMeta = {
    ...(localCatalog.meta && typeof localCatalog.meta === "object" ? localCatalog.meta : {}),
    provider: "EVE Static Data JSONL",
    authority: "eve-online-static-data-3253748-jsonl",
    sourceDir: jsonlDir,
    generatedAt: new Date().toISOString(),
    buildNumber: sdeRow ? sdeRow.buildNumber || null : null,
    releaseDate: sdeRow ? sdeRow.releaseDate || null : null,
    description: "Ship cosmetics catalog synchronized from the local EVE Static Data JSONL snapshot.",
    jsonlSync: {
      sourceDir: jsonlDir,
      syncedAt: new Date().toISOString(),
      buildNumber: sdeRow ? sdeRow.buildNumber || null : null,
      releaseDate: sdeRow ? sdeRow.releaseDate || null : null,
      addedSkins: summary.addedSkins,
      addedMaterials: summary.addedMaterials,
      addedLicenses: summary.addedLicenses,
      orphanLicenseTypeIDs: uniqueSortedNumbers(summary.orphanLicenseTypeIDs),
    },
  };
  delete nextMeta.sourceUrl;
  delete nextMeta.generatedFrom;
  delete nextMeta.dumpDate;
  localCatalog.meta = nextMeta;

  writeJson(localCatalogPath, localCatalog);

  console.log(
    JSON.stringify(
      {
        localCatalogPath,
        counts: localCatalog.counts,
        addedSkins: summary.addedSkins,
        addedMaterials: summary.addedMaterials,
        addedLicenses: summary.addedLicenses,
        orphanLicenseTypeIDs: uniqueSortedNumbers(summary.orphanLicenseTypeIDs),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
