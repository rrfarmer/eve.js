const fs = require("fs");
const path = require("path");

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
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function ensureFileExists(filePath, label) {
  if (!filePath) {
    throw new Error(`Missing required argument: ${label}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.map((value) => Number(value) || 0).filter(Boolean))].sort(
    (left, right) => left - right,
  );
}

function buildCatalog(catalogRows, options = {}) {
  const skinsBySkinID = {};
  const shipTypesByTypeID = {};
  const materialsByMaterialID = {};
  const licenseTypesByTypeID = {};

  for (const row of catalogRows) {
    const skinID = Number(row.skinID || 0);
    const skinMaterialID = Number(row.skinMaterialID || 0);
    if (!skinID || !skinMaterialID) {
      continue;
    }

    const shipTypeIDs = uniqueSortedNumbers(row.shipTypeIDs || []);
    const licenseTypes = Array.isArray(row.licenseTypes) ? row.licenseTypes : [];
    const material = row.material && typeof row.material === "object" ? row.material : {};

    skinsBySkinID[String(skinID)] = {
      skinID,
      internalName: row.internalName || "",
      skinMaterialID,
      material: {
        skinMaterialID,
        displayNameID: Number(material.displayNameID || 0) || null,
        materialSetID: Number(material.materialSetID || 0) || null,
      },
      shipTypeIDs,
      licenseTypeIDs: uniqueSortedNumbers(
        licenseTypes.map((entry) => entry.licenseTypeID),
      ),
      licenseTypes: licenseTypes
        .map((entry) => ({
          licenseTypeID: Number(entry.licenseTypeID || 0) || null,
          duration: Number(entry.duration || 0),
          typeName: entry.typeName || null,
          published: Boolean(entry.published),
          groupID: Number(entry.groupID || 0) || null,
          groupName: entry.groupName || null,
          groupPublished: Boolean(entry.groupPublished),
        }))
        .filter((entry) => entry.licenseTypeID),
    };

    if (!materialsByMaterialID[String(skinMaterialID)]) {
      materialsByMaterialID[String(skinMaterialID)] = {
        skinMaterialID,
        displayNameID: Number(material.displayNameID || 0) || null,
        materialSetID: Number(material.materialSetID || 0) || null,
        skinIDs: [],
        shipTypeIDs: [],
        licenseTypeIDs: [],
      };
    }

    const materialEntry = materialsByMaterialID[String(skinMaterialID)];
    materialEntry.skinIDs.push(skinID);
    materialEntry.shipTypeIDs.push(...shipTypeIDs);

    for (const shipTypeID of shipTypeIDs) {
      const shipKey = String(shipTypeID);
      if (!shipTypesByTypeID[shipKey]) {
        shipTypesByTypeID[shipKey] = {
          typeID: shipTypeID,
          skinIDs: [],
          materialIDs: [],
          licenseTypeIDs: [],
        };
      }

      shipTypesByTypeID[shipKey].skinIDs.push(skinID);
      shipTypesByTypeID[shipKey].materialIDs.push(skinMaterialID);
    }

    for (const license of skinsBySkinID[String(skinID)].licenseTypes) {
      const licenseTypeID = Number(license.licenseTypeID || 0);
      if (!licenseTypeID) {
        continue;
      }

      licenseTypesByTypeID[String(licenseTypeID)] = {
        licenseTypeID,
        skinID,
        skinMaterialID,
        internalName: row.internalName || "",
        shipTypeIDs,
        duration: license.duration,
        typeName: license.typeName,
        published: license.published,
        groupID: license.groupID,
        groupName: license.groupName,
        groupPublished: license.groupPublished,
      };

      materialEntry.licenseTypeIDs.push(licenseTypeID);
      for (const shipTypeID of shipTypeIDs) {
        shipTypesByTypeID[String(shipTypeID)].licenseTypeIDs.push(licenseTypeID);
      }
    }
  }

  for (const entry of Object.values(shipTypesByTypeID)) {
    entry.skinIDs = uniqueSortedNumbers(entry.skinIDs);
    entry.materialIDs = uniqueSortedNumbers(entry.materialIDs);
    entry.licenseTypeIDs = uniqueSortedNumbers(entry.licenseTypeIDs);
  }

  for (const entry of Object.values(materialsByMaterialID)) {
    entry.skinIDs = uniqueSortedNumbers(entry.skinIDs);
    entry.shipTypeIDs = uniqueSortedNumbers(entry.shipTypeIDs);
    entry.licenseTypeIDs = uniqueSortedNumbers(entry.licenseTypeIDs);
  }

  return {
    meta: {
      provider: "Fuzzwork",
      sourceUrl: options.sourceUrl || "https://www.fuzzwork.co.uk/dump/latest/",
      dumpDate: options.dumpDate || null,
      generatedAt: new Date().toISOString(),
      generatedFrom: options.catalogPath || null,
      description:
        "Joined ship cosmetics catalog used locally by the emulator. This avoids runtime dependence on external Fuzzwork data.",
    },
    counts: {
      skins: Object.keys(skinsBySkinID).length,
      shipTypes: Object.keys(shipTypesByTypeID).length,
      materials: Object.keys(materialsByMaterialID).length,
      licenseTypes: Object.keys(licenseTypesByTypeID).length,
    },
    skinsBySkinID,
    shipTypesByTypeID,
    materialsByMaterialID,
    licenseTypesByTypeID,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureFileExists(args.catalog, "--catalog");
  ensureFileExists(path.dirname(args.output || ""), "output directory parent");

  const catalogRows = readJson(args.catalog);
  if (!Array.isArray(catalogRows)) {
    throw new Error(`Expected array catalog in ${args.catalog}`);
  }

  const payload = buildCatalog(catalogRows, {
    catalogPath: path.resolve(args.catalog),
    dumpDate: args["dump-date"] || null,
    sourceUrl: args["source-url"] || "https://www.fuzzwork.co.uk/dump/latest/",
  });

  writeJson(args.output, payload);
  console.log(
    `[build-ship-cosmetics-data] wrote ${payload.counts.skins} skins to ${args.output}`,
  );
}

main();
