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
    });
  }

  return rows;
}

function loadShipTypes(filePath, groupsById) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const shipsByTypeID = new Map();

  for (const line of lines) {
    const columns = parseCsvLine(line);
    const typeID = toNullableNumber(columns[0]);
    const groupID = toNullableNumber(columns[1]);
    const typeName = columns[2] || "";
    const published = toNullableNumber(columns[9]) === 1;
    const group = groupsById.get(groupID);

    if (
      !Number.isInteger(typeID) ||
      !Number.isInteger(groupID) ||
      !group ||
      group.categoryID !== 6 ||
      !typeName ||
      !published
    ) {
      continue;
    }

    shipsByTypeID.set(typeID, {
      typeID,
      typeName,
      groupID,
      categoryID: group.categoryID,
    });
  }

  return shipsByTypeID;
}

function loadAttributeTypes(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Attribute type CSV appears empty: ${filePath}`);
  }

  const attributeTypesByID = new Map();
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const attributeID = toNullableNumber(columns[0]);
    if (!Number.isInteger(attributeID)) {
      continue;
    }

    attributeTypesByID.set(attributeID, {
      attributeID,
      attributeName: columns[1] || "",
      description: columns[2] || "",
      iconID: toNullableNumber(columns[3]),
      defaultValue: toNullableNumber(columns[4]),
      published: toNullableNumber(columns[5]) === 1,
      displayName: columns[6] || "",
      unitID: toNullableNumber(columns[7]),
      stackable: toNullableNumber(columns[8]) === 1,
      highIsGood: toNullableNumber(columns[9]) === 1,
      categoryID: toNullableNumber(columns[10]),
    });
  }

  return attributeTypesByID;
}

function loadShipDogmaAttributes(filePath, shipsByTypeID) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`dgmTypeAttributes CSV appears empty: ${filePath}`);
  }

  const entriesByTypeID = new Map();
  for (const ship of shipsByTypeID.values()) {
    entriesByTypeID.set(ship.typeID, {
      typeID: ship.typeID,
      typeName: ship.typeName,
      attributeCount: 0,
      attributes: {},
    });
  }

  let totalAttributes = 0;
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const typeID = toNullableNumber(columns[0]);
    const attributeID = toNullableNumber(columns[1]);
    if (!Number.isInteger(typeID) || !Number.isInteger(attributeID)) {
      continue;
    }

    const entry = entriesByTypeID.get(typeID);
    if (!entry) {
      continue;
    }

    const numericValue =
      toNullableNumber(columns[3]) ?? toNullableNumber(columns[2]);
    if (numericValue === null) {
      continue;
    }

    const attributeKey = String(attributeID);
    if (!(attributeKey in entry.attributes)) {
      totalAttributes += 1;
    }
    entry.attributes[attributeKey] = numericValue;
  }

  const shipAttributesByTypeID = {};
  for (const [typeID, entry] of Array.from(entriesByTypeID.entries()).sort(
    (left, right) => left[0] - right[0],
  )) {
    const sortedAttributes = Object.fromEntries(
      Object.entries(entry.attributes).sort(
        (left, right) => Number(left[0]) - Number(right[0]),
      ),
    );
    shipAttributesByTypeID[String(typeID)] = {
      ...entry,
      attributeCount: Object.keys(sortedAttributes).length,
      attributes: sortedAttributes,
    };
  }

  return {
    shipAttributesByTypeID,
    totalAttributes,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const invTypesPath = args.invTypes;
  const invGroupsPath = args.invGroups;
  const dgmTypeAttributesPath = args.dgmTypeAttributes;
  const dgmAttributeTypesPath = args.dgmAttributeTypes;
  const outputPath = args.output;
  const dumpDate = args["dump-date"] || "unknown";

  if (
    !invTypesPath ||
    !invGroupsPath ||
    !dgmTypeAttributesPath ||
    !dgmAttributeTypesPath ||
    !outputPath
  ) {
    throw new Error(
      "Usage: node scripts/dev/build-ship-dogma-data.js --invTypes <path> --invGroups <path> --dgmTypeAttributes <path> --dgmAttributeTypes <path> --output <path> [--dump-date <YYYY-MM-DD>]",
    );
  }

  const groupsById = loadGroupRows(invGroupsPath);
  const shipsByTypeID = loadShipTypes(invTypesPath, groupsById);
  const attributeTypesByID = loadAttributeTypes(dgmAttributeTypesPath);
  const { shipAttributesByTypeID, totalAttributes } = loadShipDogmaAttributes(
    dgmTypeAttributesPath,
    shipsByTypeID,
  );

  const sortedAttributeTypesByID = Object.fromEntries(
    Array.from(attributeTypesByID.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([attributeID, value]) => [String(attributeID), value]),
  );

  const payload = {
    source: {
      provider: "Fuzzwork",
      dumpDate,
      generatedAt: new Date().toISOString(),
    },
    counts: {
      shipTypes: shipsByTypeID.size,
      attributeTypes: attributeTypesByID.size,
      totalAttributes,
    },
    attributeTypesByID: sortedAttributeTypesByID,
    shipAttributesByTypeID,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `[build-ship-dogma-data] wrote ${shipsByTypeID.size} ship types and ${totalAttributes} dogma attributes to ${outputPath}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
