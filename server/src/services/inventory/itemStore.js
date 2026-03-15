const path = require("path");

const database = require(path.join(__dirname, "../../database"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { resolveShipByTypeID } = require(path.join(
  __dirname,
  "../chat/shipTypeRegistry",
));

const { resolveModuleType } = require(path.join(
  __dirname,
  "./moduleTypeRegistry",
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

const FITTED_SLOT_FLAGS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18,
  19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34,
  92, 93, 94,
]);
const MODULE_CATEGORY_ID = 7;
const GENERIC_MODULE_GROUP_ID = 46;
const DEFAULT_SHIP_CONDITION_STATE = Object.freeze({
  damage: 0.0,
  charge: 1.0,
  armorDamage: 0.0,
  shieldCharge: 1.0,
  incapacitated: false,
});

let migrationComplete = false;
let migrationSignature = "";

function getTableRevisionSafe(tableName) {
  return typeof database.getTableRevision === "function"
    ? database.getTableRevision(tableName)
    : 0;
}

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
      mass: null,
      volume: null,
      capacity: null,
      radius: null,
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
    volume: toFiniteNumber(metadata.volume, 0),
    capacity: toFiniteNumber(metadata.capacity, 0),
    radius: toFiniteNumber(metadata.radius, 0),
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

function isShipLikeItem(rawItem, defaults = {}) {
  if (!rawItem || typeof rawItem !== "object") {
    return false;
  }

  const typeID = toNumber(
    rawItem.typeID ?? rawItem.shipTypeID ?? defaults.typeID ?? defaults.shipTypeID,
    0,
  );
  const categoryID = toNumber(rawItem.categoryID ?? defaults.categoryID, 0);
  if (categoryID === SHIP_CATEGORY_ID) {
    return true;
  }

  if (
    Object.prototype.hasOwnProperty.call(rawItem, "shipID") ||
    Object.prototype.hasOwnProperty.call(rawItem, "shipTypeID") ||
    Object.prototype.hasOwnProperty.call(rawItem, "shipName")
  ) {
    return true;
  }

  return Boolean(resolveShipByTypeID(typeID));
}

function normalizeShipItem(rawItem, defaults = {}) {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }

    if (!isShipLikeItem(rawItem, defaults)) {
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
function isMeaningfulItemName(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue !== "" && !/^Type\s+\d+$/i.test(normalizedValue);
}

function findItemTypeReference(typeID, skipItemID = 0) {
  const normalizedTypeID = toNumber(typeID, 0);
  const normalizedSkipItemID = toNumber(skipItemID, 0);
  if (normalizedTypeID <= 0) {
    return null;
  }

  for (const rawEntry of Object.values(readItems())) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const entryItemID = toNumber(rawEntry.itemID ?? rawEntry.shipID, 0);
    if (entryItemID > 0 && entryItemID === normalizedSkipItemID) {
      continue;
    }

    const entryTypeID = toNumber(rawEntry.typeID ?? rawEntry.shipTypeID, 0);
    if (entryTypeID !== normalizedTypeID) {
      continue;
    }

    const entryCategoryID = toNumber(rawEntry.categoryID, 0);
    if (entryCategoryID === SHIP_CATEGORY_ID) {
      continue;
    }

    const entryName = String(rawEntry.itemName || "").trim();
    const entryGroupID = toNumber(rawEntry.groupID, 0);
    if (
      entryGroupID > 0 ||
      entryCategoryID > 0 ||
      isMeaningfulItemName(entryName)
    ) {
      return {
        groupID: entryGroupID,
        categoryID: entryCategoryID,
        itemName: isMeaningfulItemName(entryName) ? entryName : "",
      };
    }
  }

  return null;
}

function resolveInventoryItemMetadata({
  itemID,
  typeID,
  flagID,
  itemName,
  groupID,
  categoryID,
}) {
  const normalizedTypeID = toNumber(typeID, 0);
  const normalizedFlagID = toNumber(flagID, 0);
  const normalizedGroupID = toNumber(groupID, 0);
  const normalizedCategoryID = toNumber(categoryID, 0);
  const normalizedItemName = String(itemName || "").trim();
  const moduleMetadata = resolveModuleType(normalizedTypeID, normalizedItemName);
  const referenceMetadata =
    normalizedTypeID > 0 &&
    (
      !moduleMetadata ||
      normalizedGroupID <= 0 ||
      normalizedCategoryID <= 0 ||
      !isMeaningfulItemName(normalizedItemName)
    )
      ? findItemTypeReference(normalizedTypeID, itemID)
      : null;
  const looksLikeModule = Boolean(
    moduleMetadata ||
      (referenceMetadata && (
        referenceMetadata.categoryID === MODULE_CATEGORY_ID ||
        referenceMetadata.groupID > 0 ||
        referenceMetadata.itemName
      )) ||
      normalizedCategoryID === MODULE_CATEGORY_ID ||
      FITTED_SLOT_FLAGS.has(normalizedFlagID),
  );

  return {
    groupID:
      normalizedGroupID > 0
        ? normalizedGroupID
        : toNumber(moduleMetadata && moduleMetadata.groupID, 0) ||
          toNumber(referenceMetadata && referenceMetadata.groupID, 0) ||
          (looksLikeModule ? GENERIC_MODULE_GROUP_ID : 0),
    categoryID:
      normalizedCategoryID > 0
        ? normalizedCategoryID
        : toNumber(moduleMetadata && moduleMetadata.categoryID, 0) ||
          toNumber(referenceMetadata && referenceMetadata.categoryID, 0) ||
          (looksLikeModule ? MODULE_CATEGORY_ID : 0),
    itemName:
      (isMeaningfulItemName(normalizedItemName) ? normalizedItemName : "") ||
      String(
        (moduleMetadata && moduleMetadata.name) ||
          (referenceMetadata && referenceMetadata.itemName) ||
          (looksLikeModule
            ? `Module ${normalizedTypeID}`
            : `Type ${normalizedTypeID}`),
      ),
  };
}

function buildInventoryItem({
  itemID,
  typeID,
  ownerID,
  locationID,
  flagID = ITEM_FLAGS.HANGAR,
  itemName = null,
  quantity = 1,
  stacksize = null,
  singleton = 0,
  groupID = 0,
  categoryID = 0,
  customInfo = "",
}) {
  const normalizedTypeID = toNumber(typeID);
  const normalizedSingleton = toNumber(singleton, 0);
  const normalizedQuantity =
    quantity === null || quantity === undefined
      ? normalizedSingleton === 1
        ? -1
        : 1
      : toNumber(quantity, normalizedSingleton === 1 ? -1 : 1);
  const normalizedStacksize =
    stacksize === null || stacksize === undefined
      ? normalizedSingleton === 1
        ? 1
        : Math.max(1, normalizedQuantity)
      : toNumber(stacksize, normalizedSingleton === 1 ? 1 : normalizedQuantity);
  const normalizedFlagID = toNumber(flagID, ITEM_FLAGS.HANGAR);
  const resolvedMetadata = resolveInventoryItemMetadata({
    itemID,
    typeID: normalizedTypeID,
    flagID: normalizedFlagID,
    itemName,
    groupID,
    categoryID,
  });

  return {
    itemID: toNumber(itemID),
    typeID: normalizedTypeID,
    ownerID: toNumber(ownerID),
    locationID: toNumber(locationID),
    flagID: normalizedFlagID,
    quantity: normalizedQuantity,
    stacksize: normalizedStacksize,
    singleton: normalizedSingleton,
    groupID: resolvedMetadata.groupID,
    categoryID: resolvedMetadata.categoryID,
    customInfo: String(customInfo || ""),
    itemName: resolvedMetadata.itemName,
  };
}

function normalizeInventoryItem(rawItem, defaults = {}) {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }

  if (isShipLikeItem(rawItem, defaults)) {
    return normalizeShipItem(rawItem, defaults);
  }

  const itemID = toNumber(rawItem.itemID ?? defaults.itemID, 0);
  const typeID = toNumber(rawItem.typeID ?? defaults.typeID, 0);
  if (itemID <= 0 || typeID <= 0) {
    return null;
  }

  return buildInventoryItem({
    itemID,
    typeID,
    ownerID: rawItem.ownerID ?? defaults.ownerID ?? 0,
    locationID: rawItem.locationID ?? defaults.locationID ?? 0,
    flagID: rawItem.flagID ?? defaults.flagID ?? ITEM_FLAGS.HANGAR,
    itemName: rawItem.itemName ?? defaults.itemName ?? null,
    quantity: rawItem.quantity ?? defaults.quantity ?? 1,
    stacksize: rawItem.stacksize ?? defaults.stacksize ?? null,
    singleton: rawItem.singleton ?? defaults.singleton ?? 0,
    groupID: rawItem.groupID ?? defaults.groupID ?? 0,
    categoryID: rawItem.categoryID ?? defaults.categoryID ?? 0,
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

    if (item.itemID > maxItemID) {
      maxItemID = item.itemID;
    }
  }

  return maxItemID + 1;
}
function getMigrationSignature() {
  return [
    `characters:${getTableRevisionSafe(CHARACTERS_TABLE)}`,
    `items:${getTableRevisionSafe(ITEMS_TABLE)}`,
  ].join("|");
}

function reconcileCharacterCapsules(charId, characterRecord, items) {
  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0 || !characterRecord || !items) {
    return false;
  }

  const normalizedItems = Object.entries(items)
    .map(([key, value]) => [key, normalizeShipItem(value)])
    .filter(([, value]) => value && value.ownerID === numericCharId);
  const activeShipID = toNumber(characterRecord.shipID, 0);
  const activeShip = normalizedItems.find(([, value]) => value.itemID === activeShipID)?.[1] || null;
  const stationID = toNumber(characterRecord.stationID, 0);
  let keepCapsuleID =
    activeShip && activeShip.typeID === CAPSULE_TYPE_ID ? activeShip.itemID : 0;

  if (!keepCapsuleID) {
    const dockedCapsule = normalizedItems
      .map(([, value]) => value)
      .filter((value) => value.typeID === CAPSULE_TYPE_ID)
      .sort((left, right) => {
        const leftPriority =
          left.locationID === stationID && left.flagID === ITEM_FLAGS.HANGAR ? 0 : 1;
        const rightPriority =
          right.locationID === stationID && right.flagID === ITEM_FLAGS.HANGAR ? 0 : 1;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        return left.itemID - right.itemID;
      })[0] || null;

    if (dockedCapsule) {
      keepCapsuleID = dockedCapsule.itemID;
    }
  }

  let changed = false;
  for (const [itemKey, item] of normalizedItems) {
    if (item.typeID !== CAPSULE_TYPE_ID) {
      continue;
    }

    if (item.itemID === keepCapsuleID) {
      continue;
    }

    delete items[itemKey];
    changed = true;
  }

  return changed;
}

function ensureMigrated() {
  const nextSignature = getMigrationSignature();
  if (migrationComplete && migrationSignature === nextSignature) {
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

        if (reconcileCharacterCapsules(charId, nextRecord, items)) {
      itemsDirty = true;
    }
  }

  if (itemsDirty && !writeItems(items)) {
    log.warn("[ItemStore] Failed to persist migrated items table");
  }

  if (charactersDirty && !writeCharacters(characters)) {
    log.warn("[ItemStore] Failed to persist migrated characters table");
  }

  migrationComplete = true;
  migrationSignature = getMigrationSignature();
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

function createInventoryItemForCharacter(
  charId,
  locationId,
  itemType,
  options = {},
) {
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

  const normalizedOwnerID = toNumber(charId, 0);
  const normalizedLocationID = toNumber(locationId, 0);
  const normalizedFlagID = toNumber(options.flagID ?? ITEM_FLAGS.HANGAR, ITEM_FLAGS.HANGAR);
  const normalizedSingleton = toNumber(options.singleton ?? 0, 0);
  const normalizedQuantity = toNumber(options.quantity ?? 1, normalizedSingleton === 1 ? -1 : 1);
  const normalizedCustomInfo = String(options.customInfo ?? "");
  const normalizedTypeID = toNumber(itemType && itemType.typeID, 0);

  if (normalizedSingleton === 0) {
    const existingStack = Object.values(items)
      .map((entry) => normalizeInventoryItem(entry))
      .find(
        (entry) =>
          entry &&
          entry.categoryID !== SHIP_CATEGORY_ID &&
          entry.ownerID === normalizedOwnerID &&
          entry.locationID === normalizedLocationID &&
          entry.flagID === normalizedFlagID &&
          entry.typeID === normalizedTypeID &&
          entry.singleton === 0 &&
          String(entry.customInfo || "") === normalizedCustomInfo,
      );

    if (existingStack) {
      const previousData = cloneValue(existingStack);
      const existingUnits = Math.max(
        1,
        toNumber(existingStack.stacksize, existingStack.quantity),
      );
      const addedUnits = Math.max(
        1,
        toNumber(options.stacksize ?? normalizedQuantity, normalizedQuantity),
      );
      const mergedItem = buildInventoryItem({
        ...existingStack,
        itemName: itemType && itemType.name ? itemType.name : existingStack.itemName,
        groupID:
          itemType && itemType.groupID !== undefined
            ? itemType.groupID
            : existingStack.groupID,
        categoryID:
          itemType && itemType.categoryID !== undefined
            ? itemType.categoryID
            : existingStack.categoryID,
        quantity: existingUnits + addedUnits,
        stacksize: existingUnits + addedUnits,
        customInfo: normalizedCustomInfo,
      });

      items[String(existingStack.itemID)] = mergedItem;
      if (!writeItems(items)) {
        return {
          success: false,
          errorMsg: "WRITE_ERROR",
        };
      }

      return {
        success: true,
        created: false,
        merged: true,
        previousData,
        data: cloneValue(mergedItem),
      };
    }
  }

  const item = buildInventoryItem({
    itemID: nextItemID(charId, items, record),
    typeID: itemType && itemType.typeID,
    ownerID: charId,
    locationID: locationId,
    flagID: options.flagID ?? ITEM_FLAGS.HANGAR,
    itemName: itemType && itemType.name,
    quantity: options.quantity ?? 1,
    stacksize: options.stacksize,
    singleton: options.singleton ?? 0,
    groupID: itemType && itemType.groupID,
    categoryID: itemType && itemType.categoryID,
    customInfo: options.customInfo ?? "",
  });

  items[String(item.itemID)] = item;
  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    created: true,
    merged: false,
    previousData: null,
    data: cloneValue(item),
  };
}

function stackAllInventoryItemsInContainer(ownerId, locationId, flagId) {
  ensureMigrated();

  const numericOwnerId = toNumber(ownerId, 0);
  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId = toNumber(flagId, 0);
  if (numericOwnerId <= 0 || numericLocationId <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_CONTAINER",
      data: [],
    };
  }

  const items = readItems();
  const containerItems = Object.values(items)
    .map((entry) => normalizeInventoryItem(entry))
    .filter(
      (entry) =>
        entry &&
        entry.categoryID !== SHIP_CATEGORY_ID &&
        entry.ownerID === numericOwnerId &&
        entry.locationID === numericLocationId &&
        entry.flagID === numericFlagId &&
        entry.singleton === 0,
    )
    .sort((left, right) => left.itemID - right.itemID);

  const groupedItems = new Map();
  for (const item of containerItems) {
    const groupKey = [
      item.typeID,
      item.ownerID,
      item.locationID,
      item.flagID,
      item.customInfo || "",
    ].join(":");
    if (!groupedItems.has(groupKey)) {
      groupedItems.set(groupKey, []);
    }
    groupedItems.get(groupKey).push(item);
  }

  const changes = [];
  let mutated = false;
  for (const groupItems of groupedItems.values()) {
    if (!Array.isArray(groupItems) || groupItems.length < 2) {
      continue;
    }

    const [targetItem, ...mergedItems] = groupItems;
    const previousTarget = cloneValue(targetItem);
    const totalUnits = groupItems.reduce(
      (sum, item) =>
        sum + Math.max(1, toNumber(item.stacksize, item.quantity)),
      0,
    );
    const updatedTarget = buildInventoryItem({
      ...targetItem,
      quantity: totalUnits,
      stacksize: totalUnits,
    });

    items[String(targetItem.itemID)] = updatedTarget;
    for (const mergedItem of mergedItems) {
      delete items[String(mergedItem.itemID)];
    }

    changes.push({
      updatedItem: cloneValue(updatedTarget),
      previousData: previousTarget,
      removedItems: mergedItems.map((item) => cloneValue(item)),
    });
    mutated = true;
  }

  if (mutated && !writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
      data: [],
    };
  }

  return {
    success: true,
    data: changes,
  };
}

function updateInventoryItem(itemId, updater) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem || currentItem.categoryID === SHIP_CATEGORY_ID) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const updatedValue =
    typeof updater === "function" ? updater(cloneValue(currentItem)) : updater;
  const normalizedItem = normalizeInventoryItem(updatedValue, currentItem);
  if (!normalizedItem || normalizedItem.categoryID === SHIP_CATEGORY_ID) {
    return {
      success: false,
      errorMsg: "INVALID_ITEM_STATE",
    };
  }

  items[String(numericItemId)] = normalizedItem;
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

function moveInventoryItem(itemId, destination = {}) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const items = readItems();
  const currentItem = normalizeInventoryItem(items[String(numericItemId)]);
  if (!currentItem || currentItem.categoryID === SHIP_CATEGORY_ID) {
    return {
      success: false,
      errorMsg: "ITEM_NOT_FOUND",
    };
  }

  const nextLocationID = toNumber(
    destination.locationID,
    currentItem.locationID,
  );
  const nextFlagID = toNumber(destination.flagID, currentItem.flagID);
  const nextSingleton = toNumber(
    destination.singleton,
    currentItem.singleton,
  );
  const currentUnits = Math.max(
    1,
    toNumber(currentItem.stacksize, currentItem.quantity),
  );

  if (nextSingleton === 1 && currentItem.singleton === 0 && currentUnits > 1) {
    const characters = readCharacters();
    const ownerRecord = characters[String(currentItem.ownerID)] || null;
    const updatedSourceItem = buildInventoryItem({
      ...currentItem,
      quantity: currentUnits - 1,
      stacksize: currentUnits - 1,
    });
    const movedItem = buildInventoryItem({
      ...currentItem,
      itemID: nextItemID(currentItem.ownerID, items, ownerRecord),
      locationID: nextLocationID,
      flagID: nextFlagID,
      quantity: toNumber(destination.quantity, -1),
      stacksize: toNumber(destination.stacksize, 1),
      singleton: 1,
    });

    items[String(currentItem.itemID)] = updatedSourceItem;
    items[String(movedItem.itemID)] = movedItem;
    if (!writeItems(items)) {
      return {
        success: false,
        errorMsg: "WRITE_ERROR",
      };
    }

    return {
      success: true,
      split: true,
      previousData: cloneValue(currentItem),
      data: cloneValue(movedItem),
      sourcePreviousData: cloneValue(currentItem),
      sourceItem: cloneValue(updatedSourceItem),
    };
  }

  return updateInventoryItem(numericItemId, (item) => ({
    ...item,
    locationID: nextLocationID,
    flagID: nextFlagID,
    quantity: toNumber(
      destination.quantity,
      nextSingleton === 1 ? -1 : item.quantity,
    ),
    stacksize: toNumber(
      destination.stacksize,
      nextSingleton === 1
        ? 1
        : Math.max(1, toNumber(item.stacksize, item.quantity)),
    ),
    singleton: nextSingleton,
  }));
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

function deleteShipItem(shipId) {
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

  delete items[String(numericShipId)];
  if (!writeItems(items)) {
    return {
      success: false,
      errorMsg: "WRITE_ERROR",
    };
  }

  return {
    success: true,
    previousData: cloneValue(currentItem),
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

    const characters = readCharacters();
  const items = readItems();
  const currentRecord = characters[String(toNumber(charId, 0))];
  if (currentRecord && reconcileCharacterCapsules(charId, currentRecord, items)) {
    if (!writeItems(items)) {
      return {
        success: false,
        errorMsg: "WRITE_ERROR",
      };
    }
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

  const matchedItems = [];
  for (const rawEntry of Object.values(readItems())) {
    const entry = normalizeInventoryItem(rawEntry);
    if (
      !entry ||
      entry.ownerID !== numericOwnerId ||
      entry.locationID !== numericLocationId ||
      (numericFlagId !== null && entry.flagID !== numericFlagId)
    ) {
      continue;
    }

    matchedItems.push(entry);
  }

  if (matchedItems.length > 1) {
    matchedItems.sort((left, right) => left.itemID - right.itemID);
  }

  return matchedItems.map((entry) => cloneValue(entry));
}

function findContainerItem(ownerId, locationId, flagId, excludeItemId = 0) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  const numericLocationId = toNumber(locationId, 0);
  const numericFlagId = toNumber(flagId, 0);
  const numericExcludeItemId = toNumber(excludeItemId, 0);
  if (numericOwnerId <= 0 || numericLocationId <= 0 || numericFlagId <= 0) {
    return null;
  }

  for (const rawEntry of Object.values(readItems())) {
    const entry = normalizeInventoryItem(rawEntry);
    if (
      !entry ||
      entry.ownerID !== numericOwnerId ||
      entry.locationID !== numericLocationId ||
      entry.flagID !== numericFlagId ||
      entry.itemID === numericExcludeItemId
    ) {
      continue;
    }

    return cloneValue(entry);
  }

  return null;
}

function getOccupiedContainerFlags(ownerId, locationId, candidateFlags = null) {
  ensureMigrated();
  const numericOwnerId = toNumber(ownerId, 0);
  const numericLocationId = toNumber(locationId, 0);
  if (numericOwnerId <= 0 || numericLocationId <= 0) {
    return new Set();
  }

  const candidateFlagSet =
    Array.isArray(candidateFlags) && candidateFlags.length > 0
      ? new Set(
          candidateFlags
            .map((entry) => toNumber(entry, 0))
            .filter((entry) => entry > 0),
        )
      : null;
  const occupiedFlags = new Set();
  if (candidateFlagSet && candidateFlagSet.size === 0) {
    return occupiedFlags;
  }

  for (const rawEntry of Object.values(readItems())) {
    const entry = normalizeInventoryItem(rawEntry);
    if (
      !entry ||
      entry.ownerID !== numericOwnerId ||
      entry.locationID !== numericLocationId
    ) {
      continue;
    }

    if (candidateFlagSet && !candidateFlagSet.has(entry.flagID)) {
      continue;
    }

    occupiedFlags.add(entry.flagID);
    if (candidateFlagSet && occupiedFlags.size >= candidateFlagSet.size) {
      break;
    }
  }

  return occupiedFlags;
}

function findItemById(itemId) {
  ensureMigrated();
  const numericItemId = toNumber(itemId, 0);
  if (numericItemId <= 0) {
    return null;
  }

  const entry = normalizeInventoryItem(readItems()[String(numericItemId)]);
  return entry ? cloneValue(entry) : null;
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
  createInventoryItemForCharacter,
  stackAllInventoryItemsInContainer,
  updateInventoryItem,
  moveInventoryItem,
  updateShipItem,
  deleteShipItem,
  setShipPackagingState,
  moveShipToSpace,
  dockShipToStation,
  setActiveShipForCharacter,
  ensureCapsuleForCharacter,
  listContainerItems,
  findContainerItem,
  getOccupiedContainerFlags,
  findItemById,
  buildShipItem,
  buildInventoryItem,
  normalizeShipItem,
  normalizeInventoryItem,
  getShipConditionState,
  normalizeShipConditionState,
};