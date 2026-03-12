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
const DEFAULT_SHIP_CONDITION_STATE = Object.freeze({
  damage: 0.0,
  charge: 1.0,
  armorDamage: 0.0,
  shieldCharge: 1.0,
  incapacitated: false,
});

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

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSpaceVector(rawValue, fallback = { x: 0, y: 0, z: 0 }) {
  if (!rawValue || typeof rawValue !== "object") {
    return {
      x: fallback.x,
      y: fallback.y,
      z: fallback.z,
    };
  }

  return {
    x: toFiniteNumber(rawValue.x, fallback.x),
    y: toFiniteNumber(rawValue.y, fallback.y),
    z: toFiniteNumber(rawValue.z, fallback.z),
  };
}

function normalizeSpaceState(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalizedMode = ["GOTO", "FOLLOW", "WARP", "ORBIT"].includes(rawValue.mode)
    ? rawValue.mode
    : "STOP";

  return {
    systemID: toNumber(rawValue.systemID, 0),
    position: normalizeSpaceVector(rawValue.position),
    velocity: normalizeSpaceVector(rawValue.velocity),
    direction: normalizeSpaceVector(rawValue.direction, { x: 1, y: 0, z: 0 }),
    targetPoint: rawValue.targetPoint
      ? normalizeSpaceVector(rawValue.targetPoint)
      : null,
    speedFraction: toFiniteNumber(rawValue.speedFraction, 0),
    mode: normalizedMode,
    targetEntityID: rawValue.targetEntityID
      ? toNumber(rawValue.targetEntityID, 0)
      : null,
    followRange: toFiniteNumber(rawValue.followRange, 0),
    orbitDistance: toFiniteNumber(rawValue.orbitDistance, 0),
    orbitNormal: rawValue.orbitNormal
      ? normalizeSpaceVector(rawValue.orbitNormal, { x: 0, y: 1, z: 0 })
      : null,
    orbitSign: toFiniteNumber(rawValue.orbitSign, 1) < 0 ? -1 : 1,
    warpState:
      rawValue.warpState && typeof rawValue.warpState === "object"
        ? {
            startTimeMs: toFiniteNumber(rawValue.warpState.startTimeMs, Date.now()),
            durationMs: toFiniteNumber(rawValue.warpState.durationMs, 0),
            accelTimeMs: toFiniteNumber(rawValue.warpState.accelTimeMs, 0),
            cruiseTimeMs: toFiniteNumber(rawValue.warpState.cruiseTimeMs, 0),
            decelTimeMs: toFiniteNumber(rawValue.warpState.decelTimeMs, 0),
            totalDistance: toFiniteNumber(rawValue.warpState.totalDistance, 0),
            stopDistance: toFiniteNumber(rawValue.warpState.stopDistance, 0),
            maxWarpSpeedMs: toFiniteNumber(rawValue.warpState.maxWarpSpeedMs, 0),
            warpSpeed: toNumber(rawValue.warpState.warpSpeed, 0),
            effectStamp: toNumber(rawValue.warpState.effectStamp, 0),
            targetEntityID: rawValue.warpState.targetEntityID
              ? toNumber(rawValue.warpState.targetEntityID, 0)
              : null,
            followID: rawValue.warpState.followID
              ? toNumber(rawValue.warpState.followID, 0)
              : null,
            followRangeMarker: toFiniteNumber(
              rawValue.warpState.followRangeMarker,
              rawValue.warpState.stopDistance,
            ),
            origin: rawValue.warpState.origin
              ? normalizeSpaceVector(rawValue.warpState.origin)
              : null,
            rawDestination: rawValue.warpState.rawDestination
              ? normalizeSpaceVector(rawValue.warpState.rawDestination)
              : null,
            targetPoint: rawValue.warpState.targetPoint
              ? normalizeSpaceVector(rawValue.warpState.targetPoint)
              : null,
          }
        : null,
  };
}

function normalizeShipConditionState(rawValue) {
  const source =
    rawValue && typeof rawValue === "object" ? rawValue : DEFAULT_SHIP_CONDITION_STATE;

  return {
    damage: toFiniteNumber(source.damage, DEFAULT_SHIP_CONDITION_STATE.damage),
    charge: toFiniteNumber(source.charge, DEFAULT_SHIP_CONDITION_STATE.charge),
    armorDamage: toFiniteNumber(
      source.armorDamage,
      DEFAULT_SHIP_CONDITION_STATE.armorDamage,
    ),
    shieldCharge: toFiniteNumber(
      source.shieldCharge,
      DEFAULT_SHIP_CONDITION_STATE.shieldCharge,
    ),
    incapacitated: Boolean(
      source.incapacitated ?? DEFAULT_SHIP_CONDITION_STATE.incapacitated,
    ),
  };
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
  spaceState = null,
  conditionState = null,
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
    mass: toFiniteNumber(metadata.mass, 0),
    capacity: toFiniteNumber(metadata.capacity, 0),
    spaceState: normalizeSpaceState(spaceState),
    conditionState: normalizeShipConditionState(conditionState),
  };

  if (item.flagID !== 0) {
    item.spaceState = null;
  }

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
    spaceState: Object.prototype.hasOwnProperty.call(rawItem, "spaceState")
      ? rawItem.spaceState
      : defaults.spaceState ?? null,
    conditionState: Object.prototype.hasOwnProperty.call(rawItem, "conditionState")
      ? rawItem.conditionState
      : defaults.conditionState ?? null,
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

    if (item.itemID > maxItemID) {
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

function ensureCharacterActiveShipItem(charId, existingRecord = null) {
  ensureMigrated();

  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0) {
    return null;
  }

  const characters = readCharacters();
  const record = existingRecord || characters[String(numericCharId)];
  if (!record) {
    return null;
  }

  const activeShip = findCharacterShipItem(numericCharId, record.shipID);
  if (activeShip) {
    return activeShip;
  }

  const ownedShips = listCharacterShipItems(numericCharId);
  if (ownedShips.length > 0) {
    const repairedShip = ownedShips[0];
    const syncResult = syncCharacterActiveShip(numericCharId, repairedShip);
    if (!syncResult.success) {
      log.warn(
        `[ItemStore] Failed to repair active ship for char=${numericCharId} from owned ship=${repairedShip.itemID}`,
      );
    } else {
      log.info(
        `[ItemStore] Repaired active ship for char=${numericCharId} -> ship=${repairedShip.itemID}`,
      );
    }
    return repairedShip;
  }

  const stationID = toNumber(record.stationID, 60003760);
  const items = readItems();
  const starterShip = buildShipItem({
    itemID: nextItemID(numericCharId, items, record),
    typeID: record.shipTypeID || DEFAULT_SHIP_TYPE_ID,
    ownerID: numericCharId,
    locationID: stationID,
    flagID: ITEM_FLAGS.HANGAR,
    itemName: record.shipName || null,
  });

  items[String(starterShip.itemID)] = starterShip;
  if (!writeItems(items)) {
    log.warn(
      `[ItemStore] Failed to provision starter ship for char=${numericCharId}`,
    );
    return null;
  }

  const syncResult = syncCharacterActiveShip(numericCharId, starterShip);
  if (!syncResult.success) {
    log.warn(
      `[ItemStore] Provisioned starter ship=${starterShip.itemID} for char=${numericCharId} but failed to sync character record`,
    );
  } else {
    log.info(
      `[ItemStore] Provisioned starter ship for char=${numericCharId} -> ship=${starterShip.itemID}`,
    );
  }

  return cloneValue(starterShip);
}

function getActiveShipItem(charId) {
  return ensureCharacterActiveShipItem(charId);
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

function moveShipToSpace(shipId, solarSystemId, spaceState) {
  return updateShipItem(shipId, (currentItem) => ({
    ...currentItem,
    locationID: toNumber(solarSystemId, currentItem.locationID),
    flagID: 0,
    spaceState: normalizeSpaceState({
      ...(spaceState || {}),
      systemID: toNumber(solarSystemId, currentItem.locationID),
    }),
    conditionState: normalizeShipConditionState(currentItem.conditionState),
  }));
}

function dockShipToStation(shipId, stationId) {
  return updateShipItem(shipId, (currentItem) => ({
    ...currentItem,
    locationID: toNumber(stationId, currentItem.locationID),
    flagID: ITEM_FLAGS.HANGAR,
    spaceState: null,
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

function getShipConditionState(shipItem) {
  return normalizeShipConditionState(shipItem && shipItem.conditionState);
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
  ensureCharacterActiveShipItem,
  getActiveShipItem,
  spawnShipInStationHangar,
  updateShipItem,
  setShipPackagingState,
  moveShipToSpace,
  dockShipToStation,
  setActiveShipForCharacter,
  ensureCapsuleForCharacter,
  listContainerItems,
  buildShipItem,
  normalizeShipItem,
  getShipConditionState,
  normalizeShipConditionState,
};

