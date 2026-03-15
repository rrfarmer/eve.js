const path = require("path");

const log = require("../../utils/logger");
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const SHIP_CATEGORY_ID = 6;
const FALLBACK_SHIPS = [
  { typeID: 606, name: "Velator", groupID: 237, categoryID: SHIP_CATEGORY_ID },
  { typeID: 11567, name: "Avatar", groupID: 30, categoryID: SHIP_CATEGORY_ID },
  { typeID: 3514, name: "Revenant", groupID: 659, categoryID: SHIP_CATEGORY_ID },
  { typeID: 23913, name: "Nyx", groupID: 659, categoryID: SHIP_CATEGORY_ID },
  { typeID: 23919, name: "Aeon", groupID: 659, categoryID: SHIP_CATEGORY_ID },
  { typeID: 23917, name: "Wyvern", groupID: 659, categoryID: SHIP_CATEGORY_ID },
  { typeID: 22852, name: "Hel", groupID: 659, categoryID: SHIP_CATEGORY_ID },
];

let cachedRegistry = null;

function normalizeShipName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createRegistry() {
  return {
    byName: new Map(),
    byTypeID: new Map(),
  };
}

function normalizeEntry(entry) {
  return {
    ...entry,
    typeID: Number(entry.typeID),
    name: String(entry.name || "").trim(),
    groupID: Number(entry.groupID),
    categoryID: Number(entry.categoryID || SHIP_CATEGORY_ID),
    mass: Number.isFinite(Number(entry.mass)) ? Number(entry.mass) : null,
    volume: Number.isFinite(Number(entry.volume)) ? Number(entry.volume) : null,
    capacity: Number.isFinite(Number(entry.capacity)) ? Number(entry.capacity) : null,
    radius: Number.isFinite(Number(entry.radius)) ? Number(entry.radius) : null,
  };
}

function addEntry(registry, entry) {
  const normalizedEntry = normalizeEntry(entry);
  if (
    !Number.isInteger(normalizedEntry.typeID) ||
    normalizedEntry.typeID <= 0 ||
    !normalizedEntry.name
  ) {
    return;
  }

  const normalizedName = normalizeShipName(normalizedEntry.name);
  if (!normalizedName) {
    return;
  }

  registry.byTypeID.set(normalizedEntry.typeID, normalizedEntry);

  if (!registry.byName.has(normalizedName)) {
    registry.byName.set(normalizedName, []);
  }

  const entries = registry.byName.get(normalizedName);
  if (!entries.some((candidate) => candidate.typeID === normalizedEntry.typeID)) {
    entries.push(normalizedEntry);
  }
}

function buildFallbackRegistry() {
  const registry = createRegistry();
  for (const ship of FALLBACK_SHIPS) {
    addEntry(registry, ship);
  }
  return registry;
}

function loadDbRegistry() {
  try {
    const ships = readStaticRows(TABLE.SHIP_TYPES);
    if (!Array.isArray(ships) || ships.length === 0) {
      return null;
    }

    const registry = createRegistry();
    for (const ship of ships) {
      addEntry(registry, ship);
    }

    return registry.byTypeID.size > 0 ? registry : null;
  } catch (error) {
    log.warn(
      `[ShipRegistry] Failed to load ship reference data from database: ${error.message}`,
    );
    return null;
  }
}

function loadRegistry() {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const dbRegistry = loadDbRegistry();
  if (dbRegistry) {
    cachedRegistry = dbRegistry;
    return cachedRegistry;
  }

  cachedRegistry = buildFallbackRegistry();
  return cachedRegistry;
}

function dedupeEntries(entries) {
  const deduped = [];
  const seen = new Set();

  for (const entry of entries) {
    const key = `${entry.typeID}:${entry.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }

  return deduped;
}

function resolveShipByTypeID(typeID) {
  const numericTypeID = Number(typeID);
  if (!Number.isInteger(numericTypeID) || numericTypeID <= 0) {
    return null;
  }

  const registry = loadRegistry();
  return registry.byTypeID.get(numericTypeID) || null;
}

function resolveShipByName(query) {
  const normalizedQuery = normalizeShipName(query);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "SHIP_NAME_REQUIRED",
      suggestions: [],
    };
  }

  const registry = loadRegistry();
  const exactMatches = dedupeEntries(registry.byName.get(normalizedQuery) || []);
  if (exactMatches.length === 1) {
    return { success: true, match: exactMatches[0], suggestions: [] };
  }
  if (exactMatches.length > 1) {
    return {
      success: false,
      errorMsg: "AMBIGUOUS_SHIP_NAME",
      suggestions: exactMatches.slice(0, 5).map((entry) => entry.name),
    };
  }

  const partialMatches = [];
  for (const entry of registry.byTypeID.values()) {
    if (normalizeShipName(entry.name).includes(normalizedQuery)) {
      partialMatches.push(entry);
    }
  }

  const deduped = dedupeEntries(partialMatches);

  if (deduped.length === 1) {
    return { success: true, match: deduped[0], suggestions: [] };
  }

  return {
    success: false,
    errorMsg: deduped.length > 1 ? "AMBIGUOUS_SHIP_NAME" : "SHIP_NOT_FOUND",
    suggestions: deduped.slice(0, 5).map((entry) => entry.name),
  };
}

module.exports = {
  resolveShipByName,
  resolveShipByTypeID,
};
