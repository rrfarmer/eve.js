const path = require("path");

const database = require(path.join(__dirname, "../../database"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));

const CHARACTERS_TABLE = "characters";
const ITEMS_TABLE = "items";
const SHIP_CATEGORY_ID = 6;
const DEFAULT_SHIP_TYPE_ID = 606;
const CAPSULE_TYPE_ID = 670;
const ITEM_FLAGS = {
  HANGAR: 4,
  CARGO_HOLD: 5,
  DRONE_BAY: 87,
  SHIP_HANGAR: 90,
};

let migrationComplete = false;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeCharacters(data) {
  const writeResult = database.write(CHARACTERS_TABLE, "/", data);
  return Boolean(writeResult && writeResult.success);
}

function readItems() {
  const result = database.read(ITEMS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeItems(data) {
  const writeResult = database.write(ITEMS_TABLE, "/", data);
  return Boolean(writeResult && writeResult.success);
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getShipMetadata(typeID, name = null) {
  const resolvedTypeID = toNumber(typeID, DEFAULT_SHIP_TYPE_ID);
  return (
    resolveShipByTypeID(resolvedTypeID) || {
      typeID: resolvedTypeID,
      name: name || "Ship",
      groupID: 25,
      categoryID: SHIP_CATEGORY_ID,
    }
  );
}

function buildShipItem({
  itemID,
  typeID,
  ownerID,
  locationID,
  flagID = ITEM_FLAGS.HANGAR,
  itemName = null,
  quantity = null,
  stacksize = 1,
  singleton = null,
  customInfo = "",
}) {
  const metadata = getShipMetadata(typeID, itemName);
  const normalizedSingleton =
    singleton === null || singleton === undefined ? 1 : toNumber(singleton, 1);
  const normalizedQuantity =
    quantity === null || quantity === undefined
      ? normalizedSingleton === 1
        ? -1
        : 1
      : toNumber(quantity, normalizedSingleton === 1 ? -1 : 1);

  const item = {
    itemID: toNumber(itemID),
    typeID: metadata.typeID,
    ownerID: toNumber(ownerID),
    locationID: toNumber(locationID),
    flagID: toNumber(flagID, ITEM_FLAGS.HANGAR),
    quantity: normalizedQuantity,
    stacksize: toNumber(stacksize, 1),
    singleton: normalizedSingleton,
    groupID: toNumber(metadata.groupID, 25),
    categoryID: toNumber(metadata.categoryID, SHIP_CATEGORY_ID),
    customInfo: String(customInfo || ""),
    itemName: metadata.name || itemName || "Ship",
  };

  return {
    ...item,
    shipID: item.itemID,
    shipTypeID: item.typeID,
    shipName: item.itemName,
  };
}

function normalizeShipItem(rawItem, defaults = {}) {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }

  const itemID = toNumber(rawItem.itemID ?? rawItem.shipID, 0);
  const typeID = toNumber(rawItem.typeID ?? rawItem.shipTypeID, 0);
  if (itemID <= 0 || typeID <= 0) {
    return null;
  }

  return buildShipItem({
    itemID,
    typeID,
    ownerID: rawItem.ownerID ?? defaults.ownerID ?? 0,
    locationID: rawItem.locationID ?? defaults.locationID ?? 0,
    flagID: rawItem.flagID ?? defaults.flagID ?? ITEM_FLAGS.HANGAR,
    itemName: rawItem.itemName ?? rawItem.shipName ?? defaults.itemName ?? null,
    quantity: rawItem.quantity ?? defaults.quantity ?? null,
    stacksize: rawItem.stacksize ?? defaults.stacksize ?? 1,
    singleton: rawItem.singleton ?? defaults.singleton ?? null,
    customInfo: rawItem.customInfo ?? defaults.customInfo ?? "",
  });
}

function collectLegacyShips(charId, record) {
  const collected = [];
  const seen = new Set();

  const addShip = (candidate) => {
    const normalized = normalizeShipItem(candidate, {
      ownerID: charId,
      locationID: record.stationID || 60003760,
      flagID: ITEM_FLAGS.HANGAR,
    });
    if (!normalized || seen.has(normalized.itemID)) {
      return;
    }

    seen.add(normalized.itemID);
    collected.push(normalized);
  };

  if (Array.isArray(record.storedShips)) {
    for (const ship of record.storedShips) {
      addShip(ship);
    }
  }

  addShip({
    itemID: record.shipID || charId + 100,
    typeID: record.shipTypeID || DEFAULT_SHIP_TYPE_ID,
    itemName: record.shipName || null,
  });

  return collected;
}

function nextItemID(charId, items, characterRecord = null) {
  let maxItemID = toNumber(charId, 0) + 100;
  const record = characterRecord || null;

  if (record && record.shipID && toNumber(record.shipID, 0) > maxItemID) {
    maxItemID = toNumber(record.shipID, maxItemID);
  }

  for (const rawItem of Object.values(items)) {
    const item = normalizeShipItem(rawItem);
    if (!item) {
      continue;
    }

    if (item.ownerID === toNumber(charId, 0) && item.itemID > maxItemID) {
      maxItemID = item.itemID;
    }
  }

  return maxItemID + 1;
}

function ensureMigrated() {
  if (migrationComplete) {
    return;
  }

  const characters = readCharacters();
  const items = readItems();
  let itemsDirty = false;
  let charactersDirty = false;

  for (const [charIdKey, rawRecord] of Object.entries(characters)) {
    const charId = toNumber(charIdKey, 0);
    const stationID = toNumber(rawRecord.stationID, 60003760);
    const legacyShips = collectLegacyShips(charId, rawRecord);

    for (const legacyShip of legacyShips) {
      if (!items[String(legacyShip.itemID)]) {
        items[String(legacyShip.itemID)] = normalizeShipItem(legacyShip, {
          ownerID: charId,
          locationID: stationID,
          flagID: ITEM_FLAGS.HANGAR,
        });
        itemsDirty = true;
      }
    }

    let characterShipItems = Object.values(items)
      .map((entry) => normalizeShipItem(entry))
      .filter(
        (entry) =>
          entry &&
          entry.ownerID === charId &&
          entry.categoryID === SHIP_CATEGORY_ID,
      )
      .sort((left, right) => left.itemID - right.itemID);

    if (characterShipItems.length === 0) {
      const starterShip = buildShipItem({
        itemID: nextItemID(charId, items, rawRecord),
        typeID: rawRecord.shipTypeID || DEFAULT_SHIP_TYPE_ID,
        ownerID: charId,
        locationID: stationID,
        flagID: ITEM_FLAGS.HANGAR,
        itemName: rawRecord.shipName || null,
      });
      items[String(starterShip.itemID)] = starterShip;
      itemsDirty = true;
      characterShipItems = [starterShip];
    }

    const activeShip =
      characterShipItems.find(
        (entry) => entry.itemID === toNumber(rawRecord.shipID, 0),
      ) || characterShipItems[0];

    const nextRecord = {
      ...rawRecord,
      shipID: activeShip.itemID,
      shipTypeID: activeShip.typeID,
      shipName: activeShip.itemName,
    };

    if (Object.prototype.hasOwnProperty.call(nextRecord, "storedShips")) {
      delete nextRecord.storedShips;
    }

    if (JSON.stringify(rawRecord) !== JSON.stringify(nextRecord)) {
      characters[charIdKey] = nextRecord;
      charactersDirty = true;
    }
  }

  if (itemsDirty && !writeItems(items)) {
    log.warn("[ItemStore] Failed to persist migrated items table");
  }

  if (charactersDirty && !writeCharacters(characters)) {
    log.warn("[ItemStore] Failed to persist migrated characters table");
  }

  migrationComplete = true;
}

function getAllItems() {
  ensureMigrated();
  return cloneValue(readItems());
}

function listCharacterShipItems(charId, options = {}) {
  ensureMigrated();
  const numericCharId = toNumber(charId, 0);
  const locationID =
    options.locationID === undefined || options.locationID === null
      ? null
      : toNumber(options.locationID, 0);
  const flagID =
    options.flagID === undefined || options.flagID === null
      ? null
      : toNumber(options.flagID, ITEM_FLAGS.HANGAR);

  return Object.values(readItems())
    .map((entry) => normalizeShipItem(entry))
    .filter(
      (entry) =>
        entry &&
        entry.ownerID === numericCharId &&
        entry.categoryID === SHIP_CATEGORY_ID &&
        (locationID === null || entry.locationID === locationID) &&
        (flagID === null || entry.flagID === flagID),
    )
    .sort((left, right) => left.itemID - right.itemID)
    .map((entry) => cloneValue(entry));
}

function getCharacterShipItems(charId) {
  return listCharacterShipItems(charId);
}

function getCharacterHangarShipItems(charId, stationId) {
  return listCharacterShipItems(charId, {
    locationID: stationId,
    flagID: ITEM_FLAGS.HANGAR,
  });
}

function findCharacterShipItem(charId, shipId) {
  const numericShipId = toNumber(shipId, 0);
  if (numericShipId <= 0) {
    return null;
  }

  return (
    listCharacterShipItems(charId).find((entry) => entry.itemID === numericShipId) ||
    null
  );
}

function findShipItemById(shipId) {
  ensureMigrated();
  const numericShipId = toNumber(shipId, 0);
  if (numericShipId <= 0) {
    return null;
  }

  const entry = normalizeShipItem(readItems()[String(numericShipId)]);
  return entry ? cloneValue(entry) : null;
}

function findCharacterShipByType(charId, typeId, stationId = null) {
  const numericTypeId = toNumber(typeId, 0);
  if (numericTypeId <= 0) {
    return null;
  }

  const ships =
    stationId === null || stationId === undefined
      ? listCharacterShipItems(charId)
      : getCharacterHangarShipItems(charId, stationId);

  return ships.find((entry) => entry.typeID === numericTypeId) || null;
}

function getActiveShipItem(charId) {
  ensureMigrated();
  const characters = readCharacters();
  const record = characters[String(charId)];
  if (!record) {
    return null;
  }

  return (
    findCharacterShipItem(charId, record.shipID) ||
    listCharacterShipItems(charId)[0] ||
    null
  );
}

function syncCharacterActiveShip(charId, shipItem) {
  ensureMigrated();
  const characters = readCharacters();
  const record = characters[String(charId)];
  if (!record || !shipItem) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const nextRecord = {
    ...record,
    shipID: shipItem.itemID,
    shipTypeID: shipItem.typeID,
    shipName: shipItem.itemName,
  };

  if (Object.prototype.hasOwnProperty.call(nextRecord, "storedShips")) {
    delete nextRecord.storedShips;
  }

  characters[String(charId)] = nextRecord;
  if (!writeCharacters(characters)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: nextRecord,
  };
}

function createShipItemForCharacter(charId, stationId, shipType) {
  ensureMigrated();
  const characters = readCharacters();
  const items = readItems();
  const record = characters[String(charId)];
  if (!record) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const shipItem = buildShipItem({
    itemID: nextItemID(charId, items, record),
    typeID: shipType.typeID,
    ownerID: charId,
    locationID: stationId,
    flagID: ITEM_FLAGS.HANGAR,
    itemName: shipType.name,
  });

  items[String(shipItem.itemID)] = shipItem;
  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: cloneValue(shipItem),
  };
}

function updateShipItem(shipId, updater) {
  ensureMigrated();
  const numericShipId = toNumber(shipId, 0);
  if (numericShipId <= 0) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const items = readItems();
  const currentItem = normalizeShipItem(items[String(numericShipId)]);
  if (!currentItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const updatedValue =
    typeof updater === "function" ? updater(cloneValue(currentItem)) : updater;
  const normalizedItem = normalizeShipItem(updatedValue, currentItem);
  if (!normalizedItem) {
    return {
      success: false,
      errorMsg: "INVALID_SHIP_STATE",
    };
  }

  items[String(numericShipId)] = normalizedItem;
  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    previousData: cloneValue(currentItem),
    data: cloneValue(normalizedItem),
  };
}

function setShipPackagingState(shipId, packaged) {
  return updateShipItem(shipId, (currentItem) => ({
    ...currentItem,
    singleton: packaged ? 0 : 1,
    quantity: packaged ? 1 : -1,
    stacksize: 1,
  }));
}

function spawnShipInStationHangar(charId, stationId, shipType) {
  ensureMigrated();
  const createResult = createShipItemForCharacter(charId, stationId, shipType);
  if (!createResult.success) {
    return createResult;
  }

  return {
    success: true,
    created: true,
    data: createResult.data,
  };
}

function setActiveShipForCharacter(charId, shipId) {
  const shipItem = findCharacterShipItem(charId, shipId);
  if (!shipItem) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const syncResult = syncCharacterActiveShip(charId, shipItem);
  if (!syncResult.success) {
    return syncResult;
  }

  return {
    success: true,
    data: shipItem,
  };
}

function ensureCapsuleForCharacter(charId, stationId) {
  const existingCapsule = findCharacterShipByType(charId, CAPSULE_TYPE_ID, stationId);
  if (existingCapsule) {
    return {
      success: true,
      created: false,
      data: existingCapsule,
    };
  }

  return createShipItemForCharacter(charId, stationId, {
    typeID: CAPSULE_TYPE_ID,
    name: "Capsule",
  });
}

function listContainerItems(ownerId, locationId, flagId = null) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId =
    flagId === null || flagId === undefined ? null : toNumber(flagId, 0);

  return Object.values(readItems())
    .map((entry) => normalizeShipItem(entry))
    .filter(
      (entry) =>
        entry &&
        entry.ownerID === numericOwnerId &&
        entry.locationID === numericLocationId &&
        (numericFlagId === null || entry.flagID === numericFlagId),
    )
    .sort((left, right) => left.itemID - right.itemID)
    .map((entry) => cloneValue(entry));
}

module.exports = {
  ITEMS_TABLE,
  ITEM_FLAGS,
  SHIP_CATEGORY_ID,
  CAPSULE_TYPE_ID,
  ensureMigrated,
  getAllItems,
  getCharacterShipItems,
  getCharacterHangarShipItems,
  findCharacterShipItem,
  findShipItemById,
  findCharacterShipByType,
  getActiveShipItem,
  spawnShipInStationHangar,
  updateShipItem,
  setShipPackagingState,
  setActiveShipForCharacter,
  ensureCapsuleForCharacter,
  listContainerItems,
  buildShipItem,
  normalizeShipItem,
};
