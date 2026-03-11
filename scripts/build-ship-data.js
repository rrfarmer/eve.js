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
  if (value === undefined || value === null || value === "" || value === "\\N" || value === "None") {
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
      groupName: columns[2] || "",
      published: toNullableNumber(columns[8]) === 1,
    });
  }

  return rows;
}

function loadShipRows(typesPath, groupsById) {
  const shipGroupIDs = new Set(
    Array.from(groupsById.values())
      .filter((group) => group.categoryID === 6)
      .map((group) => group.groupID),
  );
  const lines = fs.readFileSync(typesPath, "utf8").split(/\r?\n/).filter(Boolean);
  const ships = [];

  for (const line of lines) {
    const columns = parseCsvLine(line);
    const typeID = toNullableNumber(columns[0]);
    const groupID = toNullableNumber(columns[1]);
    const name = columns[2] || "";
    const published = toNullableNumber(columns[9]) === 1;

    if (
      !Number.isInteger(typeID) ||
      !Number.isInteger(groupID) ||
      !shipGroupIDs.has(groupID) ||
      !name ||
      !published
    ) {
      continue;
    }

    const group = groupsById.get(groupID);
    ships.push({
      typeID,
      groupID,
      categoryID: group ? group.categoryID : 6,
      groupName: group ? group.groupName : "",
      name,
      mass: toNullableNumber(columns[3]),
      volume: toNullableNumber(columns[4]),
      capacity: toNullableNumber(columns[5]),
      portionSize: toNullableNumber(columns[6]),
      raceID: toNullableNumber(columns[7]),
      basePrice: toNullableNumber(columns[8]),
      marketGroupID: toNullableNumber(columns[10]),
      iconID: toNullableNumber(columns[11]),
      soundID: toNullableNumber(columns[12]),
      graphicID: toNullableNumber(columns[13]),
    });
  }

  ships.sort((left, right) => left.name.localeCompare(right.name) || left.typeID - right.typeID);
  return ships;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const invTypesPath = args.invTypes;
  const invGroupsPath = args.invGroups;
  const outputPath = args.output;
  const dumpDate = args["dump-date"] || "unknown";

  if (!invTypesPath || !invGroupsPath || !outputPath) {
    throw new Error(
      "Usage: node scripts/build-ship-data.js --invTypes <path> --invGroups <path> --output <path> [--dump-date <YYYY-MM-DD>]",
    );
  }

  const groupsById = loadGroupRows(invGroupsPath);
  const ships = loadShipRows(invTypesPath, groupsById);
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const payload = {
    source: {
      provider: "Fuzzwork",
      dumpDate,
      generatedAt: new Date().toISOString(),
    },
    count: ships.length,
    ships,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${ships.length} ship rows to ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
