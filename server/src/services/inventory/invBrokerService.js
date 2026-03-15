/**
 * Inventory Broker Service (invbroker)
 *
 * Handles inventory/item queries from the client.
 * Called after character selection to load inventory data.
 */

const fs = require("fs");
const path = require("path");
const config = require(path.join(__dirname, "../../config"));
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { resolveShipByTypeID } = require(
  path.join(__dirname, "../chat/shipTypeRegistry"),
);
const {
  getCharacterShips,
  findCharacterShip,
  getActiveShipRecord,
  shouldFlushDeferredDockedShipSessionChange,
  flushDeferredDockedShipSessionChange,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ITEM_FLAGS,
  listContainerItems,
  findContainerItem,
  getOccupiedContainerFlags,
  findItemById,
  findShipItemById,
  stackAllInventoryItemsInContainer,
  moveInventoryItem,
} = require(path.join(__dirname, "./itemStore"));
const { resolveModuleType } = require(
  path.join(__dirname, "./moduleTypeRegistry"),
);
const { setModuleOnline } = require(
  path.join(__dirname, "../dogma/moduleOnlineState"),
);
const { setShipDirtTimestamp } = require(
  path.join(__dirname, "../ship/shipDirtState"),
);
const { DEFAULT_STATION, getStationRecord } = require(
  path.join(__dirname, "../_shared/stationStaticData"),
);
const { getCharacterSkills, SKILL_FLAG_ID } = require(
  path.join(__dirname, "../skills/skillState"),
);

const inventoryDebugPath = path.join(
  __dirname,
  "../../../logs/inventory-debug.log",
);
const CHARACTER_TYPE_ID = 1373;
const CHARACTER_GROUP_ID = 1;
const CHARACTER_CATEGORY_ID = 3;
const STATION_TYPE_ID = DEFAULT_STATION.stationTypeID;
const STATION_GROUP_ID = 15;
const STATION_CATEGORY_ID = 3;
const STATION_OWNER_ID = DEFAULT_STATION.ownerID;
const STATION_ITEM_HANGAR_FLAG = 36;
const FITTING_SLOT_GROUPS = Object.freeze({
  low: Object.freeze([11, 12, 13, 14, 15, 16, 17, 18]),
  medium: Object.freeze([19, 20, 21, 22, 23, 24, 25, 26]),
  high: Object.freeze([27, 28, 29, 30, 31, 32, 33, 34]),
  rig: Object.freeze([92, 93, 94]),
});
const FITTING_SLOT_FLAGS = Object.freeze(
  Object.values(FITTING_SLOT_GROUPS).flat(),
);
const INVENTORY_ROW_HEADER = {
  type: "list",
  items: [
    "itemID",
    "typeID",
    "ownerID",
    "locationID",
    "flagID",
    "quantity",
    "groupID",
    "categoryID",
    "customInfo",
    "singleton",
    "stacksize",
  ],
};
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 3],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["singleton", 2],
  ["stacksize", 3],
];

function appendInventoryDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(inventoryDebugPath), { recursive: true });
    fs.appendFileSync(
      inventoryDebugPath,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(
      `[InvBroker] Failed to write inventory debug log: ${error.message}`,
    );
  }
}

class InvBrokerService extends BaseService {
  constructor() {
    super("invbroker");
    this._boundContexts = new Map();
  }

  _getStationId(session) {
    return (
      (session &&
        (session.stationid || session.stationID || session.locationid)) ||
      60003760
    );
  }

  _getCharacterId(session) {
    return (
      (session && (session.characterID || session.charid || session.userid)) ||
      140000001
    );
  }

  _getShipId(session) {
    const charId = this._getCharacterId(session);
    const activeShip = getActiveShipRecord(charId);
    return (
      (activeShip && activeShip.shipID) ||
      (session && (session.activeShipID || session.shipID || session.shipid)) ||
      140000101
    );
  }

  _getShipTypeId(session) {
    const charId = this._getCharacterId(session);
    const activeShip = getActiveShipRecord(charId);
    const shipTypeID = activeShip
      ? activeShip.shipTypeID
      : session && Number.isInteger(session.shipTypeID)
        ? session.shipTypeID
        : null;
    return shipTypeID && shipTypeID > 0 ? shipTypeID : 606;
  }

  _getStoredShips(session) {
    const charId = this._getCharacterId(session);
    return getCharacterShips(charId);
  }

  _describeValue(value, depth = 0) {
    if (depth > 4) {
      return "<max-depth>";
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Buffer.isBuffer(value)) {
      return `<Buffer:${value.toString("utf8")}>`;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this._describeValue(entry, depth + 1));
    }

    if (typeof value === "object") {
      const summary = {};
      for (const [key, entryValue] of Object.entries(value)) {
        summary[key] = this._describeValue(entryValue, depth + 1);
      }
      return summary;
    }

    return String(value);
  }

  _traceInventory(method, session, payload = {}) {
    if (!config.enableInventoryDebugTrace) {
      return;
    }
    const entry = {
      method,
      charId: this._getCharacterId(session),
      stationId: this._getStationId(session),
      activeShipId: this._getShipId(session),
      boundContext: this._getBoundContext(session),
      ...payload,
    };
    appendInventoryDebug(JSON.stringify(this._describeValue(entry)));
  }

  _rememberBoundContext(oidString, context) {
    if (!oidString) {
      return;
    }

    this._boundContexts.set(oidString, {
      inventoryID: context.inventoryID ?? null,
      locationID: context.locationID ?? null,
      flagID: context.flagID ?? null,
      kind: context.kind || "inventory",
    });
  }

  _getBoundContext(session) {
    if (!session || !session.currentBoundObjectID) {
      return null;
    }

    return this._boundContexts.get(session.currentBoundObjectID) || null;
  }

  _makeBoundSubstruct(context) {
    const config = require(path.join(__dirname, "../../config"));
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    this._rememberBoundContext(idString, context);

    return {
      type: "substruct",
      value: {
        type: "substream",
        value: [idString, now],
      },
    };
  }

  _getShipMetadata(session, shipTypeID = null, shipName = null) {
    const resolvedShipTypeID = shipTypeID || this._getShipTypeId(session);
    return (
      resolveShipByTypeID(resolvedShipTypeID) || {
        typeID: resolvedShipTypeID,
        name: shipName || (session && session.shipName) || "Ship",
        groupID: 25,
        categoryID: 6,
      }
    );
  }

  _extractKwarg(kwargs, key) {
    if (!kwargs || typeof kwargs !== "object") return undefined;

    if (Object.prototype.hasOwnProperty.call(kwargs, key)) {
      return kwargs[key];
    }

    if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
      for (const [k, v] of kwargs.entries) {
        const dictKey = Buffer.isBuffer(k) ? k.toString("utf8") : k;
        if (dictKey === key) {
          return v;
        }
      }
    }

    return undefined;
  }

  _normalizeInventoryId(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
  }

  _normalizeFlagList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    if (value && value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    return [];
  }

  _normalizeItemIdList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    if (value && value.type === "list" && Array.isArray(value.items)) {
      return value.items
        .map((entry) => this._normalizeInventoryId(entry, NaN))
        .filter(Number.isFinite);
    }

    const singleItemId = this._normalizeInventoryId(value, NaN);
    return Number.isFinite(singleItemId) ? [singleItemId] : [];
  }

  _isFittingFlag(flagID) {
    return FITTING_SLOT_FLAGS.includes(this._normalizeInventoryId(flagID, 0));
  }

  _findFirstFreeShipFlag(session, shipID, candidateFlags = []) {
    const charId = this._getCharacterId(session);
    const normalizedCandidateFlags = candidateFlags
      .map((entry) => this._normalizeInventoryId(entry, 0))
      .filter((entry) => entry > 0);
    if (normalizedCandidateFlags.length === 0) {
      return 0;
    }

    const occupiedFlags = getOccupiedContainerFlags(
      charId,
      shipID,
      normalizedCandidateFlags,
    );
    for (const candidateFlag of candidateFlags) {
      const numericFlag = this._normalizeInventoryId(candidateFlag, 0);
      if (numericFlag > 0 && !occupiedFlags.has(numericFlag)) {
        return numericFlag;
      }
    }

    return 0;
  }

  _resolveModuleSlotFamily(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const moduleType = resolveModuleType(item.typeID, item.itemName);
    return moduleType && moduleType.slotFamily ? moduleType.slotFamily : null;
  }

  _resolveDestinationFlagForBoundMove(
    session,
    boundContext,
    item,
    requestedFlag,
  ) {
    const hasExplicitRequestedFlag =
      requestedFlag !== undefined && requestedFlag !== null;
    const normalizedRequestedFlag = hasExplicitRequestedFlag
      ? this._normalizeInventoryId(requestedFlag, 0)
      : 0;
    if (!boundContext) {
      return 0;
    }

    if (boundContext.kind !== "shipInventory") {
      if (normalizedRequestedFlag === STATION_ITEM_HANGAR_FLAG) {
        return ITEM_FLAGS.HANGAR;
      }

      return (
        normalizedRequestedFlag ||
        this._normalizeInventoryId(boundContext.flagID, 0)
      );
    }

    if (!hasExplicitRequestedFlag) {
      return this._normalizeInventoryId(boundContext.flagID, 0);
    }

    if (
      normalizedRequestedFlag > 0 &&
      this._isFittingFlag(normalizedRequestedFlag)
    ) {
      const boundShipID = this._normalizeInventoryId(
        boundContext.inventoryID,
        0,
      );
      const itemLocationID = this._normalizeInventoryId(
        item && item.locationID,
        0,
      );
      const itemFlagID = this._normalizeInventoryId(item && item.flagID, 0);
      const canSwapWithinShip =
        boundShipID > 0 &&
        itemLocationID === boundShipID &&
        this._isFittingFlag(itemFlagID) &&
        itemFlagID !== normalizedRequestedFlag;

      // Permit explicit slot targeting for fitted->fitted moves even when the
      // destination slot is occupied; _applyBoundInventoryMove performs swap.
      if (canSwapWithinShip) {
        return normalizedRequestedFlag;
      }

      return this._findFirstFreeShipFlag(session, boundShipID, [
        normalizedRequestedFlag,
      ]);
    }

    if (normalizedRequestedFlag > 0) {
      return normalizedRequestedFlag;
    }

    const slotFamily = this._resolveModuleSlotFamily(item);
    if (!slotFamily || !FITTING_SLOT_GROUPS[slotFamily]) {
      return 0;
    }

    return this._findFirstFreeShipFlag(
      session,
      this._normalizeInventoryId(boundContext.inventoryID, 0),
      FITTING_SLOT_GROUPS[slotFamily],
    );
  }

  _resolveExplicitDestinationLocation(args) {
    if (!Array.isArray(args) || args.length < 2) {
      return 0;
    }

    return this._normalizeInventoryId(args[1], 0);
  }

  _extractDestinationHintFromArgs(args = []) {
    const defaultHint = {
      locationID: this._resolveExplicitDestinationLocation(args),
      flagID: 0,
    };

    if (!Array.isArray(args) || args.length < 2) {
      return defaultHint;
    }

    const destinationArg = args[1];
    const fallbackFlagArg = args.length > 2 ? args[2] : null;

    if (Array.isArray(destinationArg)) {
      return {
        locationID: this._normalizeInventoryId(
          destinationArg[0],
          defaultHint.locationID,
        ),
        flagID: this._normalizeInventoryId(
          destinationArg.length > 1 ? destinationArg[1] : fallbackFlagArg,
          0,
        ),
      };
    }

    if (
      destinationArg &&
      destinationArg.type === "list" &&
      Array.isArray(destinationArg.items)
    ) {
      return {
        locationID: this._normalizeInventoryId(
          destinationArg.items[0],
          defaultHint.locationID,
        ),
        flagID: this._normalizeInventoryId(
          destinationArg.items.length > 1
            ? destinationArg.items[1]
            : fallbackFlagArg,
          0,
        ),
      };
    }

    if (
      destinationArg &&
      destinationArg.type === "dict" &&
      Array.isArray(destinationArg.entries)
    ) {
      const entryMap = new Map();
      for (const [rawKey, value] of destinationArg.entries) {
        const key = Buffer.isBuffer(rawKey)
          ? rawKey.toString("utf8")
          : String(rawKey);
        entryMap.set(key, value);
      }

      return {
        locationID: this._normalizeInventoryId(
          entryMap.get("locationID") ??
            entryMap.get("locationid") ??
            defaultHint.locationID,
          defaultHint.locationID,
        ),
        flagID: this._normalizeInventoryId(
          entryMap.get("flag") ??
            entryMap.get("flagID") ??
            entryMap.get("flagid") ??
            fallbackFlagArg,
          0,
        ),
      };
    }

    return {
      locationID: defaultHint.locationID,
      flagID: this._normalizeInventoryId(fallbackFlagArg, 0),
    };
  }

  _getFittedItemsForShip(session, shipID) {
    const numericShipID = this._normalizeInventoryId(shipID, 0);
    const charId = this._getCharacterId(session);

    if (numericShipID <= 0) {
      return [];
    }

    return listContainerItems(charId, numericShipID, null)
      .filter((item) => item && this._isFittingFlag(item.flagID))
      .sort((left, right) => {
        if ((left.flagID || 0) !== (right.flagID || 0)) {
          return (left.flagID || 0) - (right.flagID || 0);
        }

        return (left.itemID || 0) - (right.itemID || 0);
      });
  }

  _touchShipDirtForFittingChange(previousItem = null, nextItem = null) {
    const previousFlagID = this._normalizeInventoryId(
      previousItem && previousItem.flagID,
      0,
    );
    const previousLocationID = this._normalizeInventoryId(
      previousItem && previousItem.locationID,
      0,
    );
    const nextFlagID = this._normalizeInventoryId(
      nextItem && nextItem.flagID,
      0,
    );
    const nextLocationID = this._normalizeInventoryId(
      nextItem && nextItem.locationID,
      0,
    );

    if (this._isFittingFlag(previousFlagID) && previousLocationID > 0) {
      setShipDirtTimestamp(previousLocationID);
    }

    if (this._isFittingFlag(nextFlagID) && nextLocationID > 0) {
      setShipDirtTimestamp(nextLocationID);
    }
  }

  _stripFitting(boundContext, session) {
    if (!boundContext || boundContext.kind !== "shipInventory") {
      return null;
    }

    const stationID = this._getStationId(session);
    if (stationID <= 0) {
      log.warn("[InvBroker] StripFitting skipped: DOCK_REQUIRED");
      return null;
    }

    const shipID = this._normalizeInventoryId(boundContext.inventoryID, 0);
    if (shipID <= 0) {
      log.warn("[InvBroker] StripFitting skipped: SHIP_NOT_FOUND");
      return null;
    }

    const fittedItems = this._getFittedItemsForShip(session, shipID);
    this._traceInventory("StripFitting", session, {
      shipID,
      count: fittedItems.length,
      itemIDs: fittedItems.map((item) => item.itemID),
    });
    log.debug(
      `[InvBroker] StripFitting(shipID=${shipID}, count=${fittedItems.length})`,
    );

    for (const item of fittedItems) {
      const moveResult = moveInventoryItem(item.itemID, {
        locationID: stationID,
        flagID: ITEM_FLAGS.HANGAR,
        singleton: item.singleton,
      });
      if (!moveResult.success) {
        log.warn(
          `[InvBroker] StripFitting failed itemID=${item.itemID} shipID=${shipID}: ${moveResult.errorMsg}`,
        );
        continue;
      }

      setModuleOnline(moveResult.data.itemID, false);
      this._touchShipDirtForFittingChange(
        moveResult.previousData || null,
        moveResult.data || null,
      );
      syncInventoryItemForSession(
        session,
        moveResult.data,
        moveResult.previousData || {},
        {
          emitCfgLocation: true,
        },
      );
    }

    return null;
  }

  _swapFittedItemsIfNeeded(
    session,
    sourceItem,
    destinationLocationID,
    destinationFlagID,
  ) {
    if (!sourceItem || !session) {
      return { success: true };
    }

    if (!this._isFittingFlag(destinationFlagID)) {
      return { success: true };
    }

    const sourceLocationID = this._normalizeInventoryId(
      sourceItem.locationID,
      0,
    );
    const sourceFlagID = this._normalizeInventoryId(sourceItem.flagID, 0);
    if (
      sourceLocationID <= 0 ||
      sourceLocationID !==
        this._normalizeInventoryId(destinationLocationID, 0) ||
      !this._isFittingFlag(sourceFlagID) ||
      sourceFlagID === destinationFlagID
    ) {
      return { success: true };
    }

    const targetItem = findContainerItem(
      this._getCharacterId(session),
      destinationLocationID,
      destinationFlagID,
      sourceItem.itemID,
    );
    if (!targetItem) {
      return { success: true };
    }

    const swapResult = moveInventoryItem(targetItem.itemID, {
      locationID: destinationLocationID,
      flagID: sourceFlagID,
      singleton: 1,
    });
    if (!swapResult.success) {
      return {
        success: false,
        errorMsg: swapResult.errorMsg || "SWAP_MOVE_FAILED",
      };
    }

    setModuleOnline(
      swapResult.data.itemID,
      this._isFittingFlag(swapResult.data.flagID),
    );
    this._touchShipDirtForFittingChange(
      swapResult.previousData || null,
      swapResult.data || null,
    );
    syncInventoryItemForSession(
      session,
      swapResult.data,
      swapResult.previousData || {},
      {
        emitCfgLocation: true,
      },
    );

    return { success: true };
  }

  _applyBoundInventoryMove(itemIds, session, kwargs, args = []) {
    const boundContext = this._getBoundContext(session);
    if (!boundContext) {
      return null;
    }

    const destinationHint = this._extractDestinationHintFromArgs(args);
    const requestedFlag =
      this._extractKwarg(kwargs, "flag") ??
      this._extractKwarg(kwargs, "flagID") ??
      this._extractKwarg(kwargs, "flagid") ??
      this._extractKwarg(kwargs, "toFlag") ??
      this._extractKwarg(kwargs, "destFlag") ??
      (destinationHint.flagID > 0 ? destinationHint.flagID : null);
    const explicitDestinationLocationID = destinationHint.locationID;
    const stationID = this._getStationId(session);
    const boundInventoryID = this._normalizeInventoryId(
      boundContext.inventoryID,
      0,
    );
    const normalizedRequestedFlag =
      requestedFlag === undefined || requestedFlag === null
        ? 0
        : this._normalizeInventoryId(requestedFlag, 0);
    const requestsStationHangar =
      normalizedRequestedFlag === ITEM_FLAGS.HANGAR ||
      normalizedRequestedFlag === STATION_ITEM_HANGAR_FLAG;
    for (const itemID of itemIds) {
      const item = findItemById(itemID);
      if (!item) {
        log.warn(`[InvBroker] Move skipped itemID=${itemID}: ITEM_NOT_FOUND`);
        continue;
      }

      const itemLocationID = this._normalizeInventoryId(item.locationID, 0);
      const itemFlagID = this._normalizeInventoryId(item.flagID, 0);
      const isShipToStationMove =
        boundContext.kind === "shipInventory" &&
        explicitDestinationLocationID === stationID &&
        itemLocationID === boundInventoryID &&
        normalizedRequestedFlag <= 0;

      let destinationLocationID = boundInventoryID;
      let destinationFlagID = isShipToStationMove
        ? ITEM_FLAGS.HANGAR
        : this._resolveDestinationFlagForBoundMove(
            session,
            boundContext,
            item,
            requestedFlag,
          );
      if (boundContext.kind === "stationHangar") {
        destinationLocationID = this._getStationId(session);
      }
      if (isShipToStationMove) {
        destinationLocationID = stationID;
      }
      if (
        explicitDestinationLocationID > 0 &&
        explicitDestinationLocationID !== destinationLocationID &&
        requestsStationHangar &&
        explicitDestinationLocationID === stationID
      ) {
        destinationLocationID = stationID;
        destinationFlagID = ITEM_FLAGS.HANGAR;
      }

      // Client fitting drags can originate from a station-hangar bound object
      // while still targeting a ship slot flag. In that case, route the move
      // into the active ship container instead of leaving the item in station.
      if (this._isFittingFlag(destinationFlagID)) {
        const fittingShipID =
          boundContext.kind === "shipInventory" && boundInventoryID > 0
            ? boundInventoryID
            : this._normalizeInventoryId(this._getShipId(session), 0);
        if (fittingShipID > 0) {
          destinationLocationID = fittingShipID;
        }
      }

      if (boundContext.kind === "shipInventory" && destinationFlagID <= 0) {
        log.warn(
          `[InvBroker] Move skipped itemID=${itemID} typeID=${item.typeID}: NO_FITTING_SLOT_RESOLVED`,
        );
        continue;
      }

      if (destinationLocationID <= 0 || destinationFlagID <= 0) {
        log.warn(
          `[InvBroker] Move skipped itemID=${itemID}: INVALID_DESTINATION locationID=${destinationLocationID} flagID=${destinationFlagID}`,
        );
        continue;
      }

      const swapResult = this._swapFittedItemsIfNeeded(
        session,
        item,
        destinationLocationID,
        destinationFlagID,
      );
      if (!swapResult.success) {
        log.warn(
          `[InvBroker] Move skipped itemID=${itemID}: SLOT_SWAP_FAILED destinationFlag=${destinationFlagID} reason=${swapResult.errorMsg}`,
        );
        continue;
      }

      const moveResult = moveInventoryItem(itemID, {
        locationID: destinationLocationID,
        flagID: destinationFlagID,
        singleton: this._isFittingFlag(destinationFlagID) ? 1 : item.singleton,
      });
      if (!moveResult.success) {
        log.warn(
          `[InvBroker] Move failed itemID=${itemID} locationID=${destinationLocationID} flagID=${destinationFlagID}: ${moveResult.errorMsg}`,
        );
        continue;
      }

      if (moveResult.split && moveResult.sourceItem) {
        setModuleOnline(
          moveResult.data.itemID,
          this._isFittingFlag(moveResult.data.flagID),
        );
        this._touchShipDirtForFittingChange(
          moveResult.sourcePreviousData || null,
          moveResult.sourceItem || null,
        );
        this._touchShipDirtForFittingChange(
          moveResult.previousData || null,
          moveResult.data || null,
        );
        syncInventoryItemForSession(
          session,
          moveResult.sourceItem,
          moveResult.sourcePreviousData || {},
          {
            emitCfgLocation: true,
          },
        );
        syncInventoryItemForSession(
          session,
          moveResult.data,
          {},
          {
            emitCfgLocation: true,
          },
        );
        continue;
      }

      setModuleOnline(
        moveResult.data.itemID,
        this._isFittingFlag(moveResult.data.flagID),
      );
      this._touchShipDirtForFittingChange(
        moveResult.previousData || null,
        moveResult.data || null,
      );

      syncInventoryItemForSession(
        session,
        moveResult.data,
        moveResult.previousData || {},
        {
          emitCfgLocation: true,
        },
      );
    }

    return null;
  }

  _buildCharacterItemOverrides(session) {
    const charId = this._getCharacterId(session);
    return {
      itemID: charId,
      typeID: CHARACTER_TYPE_ID,
      ownerID: charId,
      locationID: this._getShipId(session) || this._getStationId(session),
      flagID: 0,
      quantity: -1,
      groupID: CHARACTER_GROUP_ID,
      categoryID: CHARACTER_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _findCharacterSkillRecord(session, itemID) {
    const charId = this._getCharacterId(session);
    const numericItemId = this._normalizeInventoryId(itemID, 0);
    if (numericItemId <= 0) {
      return null;
    }

    return (
      getCharacterSkills(charId).find(
        (skill) => skill.itemID === numericItemId,
      ) || null
    );
  }

  _buildSkillItemOverrides(skillRecord) {
    if (!skillRecord) {
      return null;
    }

    return {
      itemID: skillRecord.itemID,
      typeID: skillRecord.typeID,
      ownerID: skillRecord.ownerID,
      locationID: skillRecord.locationID,
      flagID: skillRecord.flagID ?? SKILL_FLAG_ID,
      quantity: 1,
      groupID: skillRecord.groupID,
      categoryID: skillRecord.categoryID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _buildStationItemOverrides(session, overrideStationID = null) {
    const station = getStationRecord(session, overrideStationID);
    const stationID = this._normalizeInventoryId(
      station.stationID,
      this._getStationId(session),
    );
    return {
      itemID: stationID,
      typeID: this._normalizeInventoryId(
        station.stationTypeID,
        STATION_TYPE_ID,
      ),
      ownerID: this._normalizeInventoryId(
        station.ownerID || station.corporationID,
        STATION_OWNER_ID,
      ),
      locationID: stationID,
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _getCharacterContainerItems(session, requestedFlag = null) {
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);

    return getCharacterSkills(this._getCharacterId(session)).filter((skill) => {
      if (numericFlag === null || numericFlag === 0) {
        return true;
      }

      return this._normalizeInventoryId(skill.flagID, 0) === numericFlag;
    });
  }

  _buildContainerItemOverrides(session, inventoryID) {
    const numericInventoryID = this._normalizeInventoryId(inventoryID);
    const charId = this._getCharacterId(session);
    const stationId = this._getStationId(session);
    const shipRecord =
      findCharacterShip(charId, numericInventoryID) ||
      findItemById(numericInventoryID) ||
      findShipItemById(numericInventoryID);

    if (shipRecord) {
      return this._itemOverridesFromId(session, shipRecord.itemID);
    }

    if (numericInventoryID === charId) {
      return this._buildCharacterItemOverrides(session);
    }

    if (numericInventoryID === stationId || numericInventoryID === 0) {
      return this._buildStationItemOverrides(session, stationId);
    }

    const stationItem = this._buildStationItemOverrides(session, stationId);
    return {
      itemID: numericInventoryID,
      typeID: stationItem.typeID,
      ownerID: this._getCharacterId(session),
      locationID: stationId,
      flagID: 0,
      quantity: 1,
      groupID: STATION_GROUP_ID,
      categoryID: STATION_CATEGORY_ID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  _resolveContainerItems(session, requestedFlag, boundContext) {
    const stationId = this._getStationId(session);
    const charId = this._getCharacterId(session);
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? null
        : this._normalizeInventoryId(requestedFlag, 0);
    const containerID =
      boundContext && Number(boundContext.inventoryID)
        ? Number(boundContext.inventoryID)
        : stationId;

    if (containerID === charId) {
      return this._getCharacterContainerItems(session, numericFlag);
    }

    if (containerID === stationId) {
      return listContainerItems(
        charId,
        stationId,
        numericFlag === null || numericFlag === 0
          ? ITEM_FLAGS.HANGAR
          : numericFlag,
      );
    }

    return listContainerItems(
      this._getCharacterId(session),
      containerID,
      numericFlag,
    );
  }

  _buildCapacityInfo(capacity, used) {
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["capacity", Number(capacity)],
          ["used", Number(used)],
        ],
      },
    };
  }

  _buildInventoryRowDescriptor() {
    return {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [INVENTORY_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    };
  }

  _calculateCapacity(session, boundContext, requestedFlag = null) {
    const items = this._resolveContainerItems(
      session,
      requestedFlag,
      boundContext,
    );
    const used = items.length * 2500.0;
    const numericFlag =
      requestedFlag === null || requestedFlag === undefined
        ? boundContext &&
          boundContext.flagID !== null &&
          boundContext.flagID !== undefined
          ? Number(boundContext.flagID)
          : null
        : Number(requestedFlag);

    let capacity = 1000000.0;
    if (numericFlag === ITEM_FLAGS.CARGO_HOLD) {
      capacity = 5000.0;
    } else if (numericFlag === ITEM_FLAGS.DRONE_BAY) {
      capacity = 0.0;
    } else if (numericFlag === ITEM_FLAGS.SHIP_HANGAR) {
      capacity = 1000000.0;
    }

    return this._buildCapacityInfo(capacity, used);
  }

  _buildInvRow(session, overrides = {}) {
    const shipMetadata = this._getShipMetadata(
      session,
      overrides.typeID ?? null,
      overrides.shipName ?? null,
    );
    const itemID = overrides.itemID ?? this._getShipId(session);
    const typeID = overrides.typeID ?? shipMetadata.typeID;
    const ownerID = overrides.ownerID ?? this._getCharacterId(session);
    const locationID = overrides.locationID ?? this._getStationId(session);
    const flagID = overrides.flagID ?? 4; // station hangar
    const singleton = overrides.singleton ?? 1;
    const quantity = overrides.quantity ?? (singleton === 1 ? -1 : 1);
    const stacksize = overrides.stacksize ?? (singleton === 1 ? 1 : quantity);
    const groupID = overrides.groupID ?? shipMetadata.groupID;
    const categoryID = overrides.categoryID ?? shipMetadata.categoryID;
    const customInfo = overrides.customInfo ?? "";

    // Keep DBRowDescriptor-compatible order first, then convenience attrs.
    return [
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      quantity,
      groupID,
      categoryID,
      customInfo,
      singleton,
      stacksize,
    ];
  }

  _buildInvItem(session, overrides = {}) {
    const row = this._buildInvRow(session, overrides);
    const header = [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "singleton",
      "stacksize",
    ];

    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", header],
          ["line", row],
        ],
      },
    };
  }

  _itemOverridesFromId(session, itemID) {
    const id = Number.isInteger(itemID) ? itemID : Number(itemID);
    const charId = this._getCharacterId(session);
    const skillRecord = this._findCharacterSkillRecord(session, id);
    if (skillRecord) {
      return this._buildSkillItemOverrides(skillRecord);
    }

    const shipRecord = findCharacterShip(charId, id) || findShipItemById(id);
    if (shipRecord) {
      return {
        itemID: shipRecord.itemID,
        typeID: shipRecord.typeID,
        shipName: shipRecord.itemName,
        ownerID: shipRecord.ownerID,
        locationID: shipRecord.locationID,
        flagID: shipRecord.flagID,
        quantity: shipRecord.quantity,
        groupID: shipRecord.groupID,
        categoryID: shipRecord.categoryID,
        customInfo: shipRecord.customInfo || "",
        singleton: shipRecord.singleton,
        stacksize: shipRecord.stacksize,
      };
    }

    const shipID = this._getShipId(session);
    const shipMetadata = this._getShipMetadata(session);
    return {
      itemID: Number.isInteger(id) ? id : shipID,
      typeID: shipMetadata.typeID,
      ownerID: this._getCharacterId(session),
      locationID: this._getStationId(session),
      flagID: 4,
      quantity: -1,
      groupID: shipMetadata.groupID,
      categoryID: shipMetadata.categoryID,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  Handle_GetInventory(args, session) {
    const containerID = args && args.length > 0 ? args[0] : null;
    const numericContainerID =
      containerID === null || containerID === undefined
        ? this._getStationId(session)
        : this._normalizeInventoryId(containerID);
    const stationId = this._getStationId(session);
    const isStationHangar =
      numericContainerID === stationId ||
      numericContainerID === 10004 ||
      numericContainerID === ITEM_FLAGS.HANGAR;
    this._traceInventory("GetInventory", session, { args });
    log.debug("[InvBroker] GetInventory");
    return this._makeBoundSubstruct({
      inventoryID: isStationHangar ? stationId : numericContainerID,
      locationID: isStationHangar ? stationId : numericContainerID,
      flagID: isStationHangar ? ITEM_FLAGS.HANGAR : null,
      kind: isStationHangar ? "stationHangar" : "inventory",
    });
  }

  _buildInventoryRowset(lines) {
    return {
      type: "object",
      name: "eve.common.script.sys.rowset.Rowset",
      args: {
        type: "dict",
        entries: [
          ["header", INVENTORY_ROW_HEADER],
          ["RowClass", { type: "token", value: "util.Row" }],
          [
            "lines",
            {
              type: "list",
              items: lines,
            },
          ],
        ],
      },
    };
  }

  _buildInvKeyVal(session, overrides = {}) {
    const row = this._buildInvRow(session, overrides);
    const [
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      quantity,
      groupID,
      categoryID,
      customInfo,
      singleton,
      stacksize,
    ] = row;

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["itemID", itemID],
          ["typeID", typeID],
          ["ownerID", ownerID],
          ["locationID", locationID],
          ["flagID", flagID],
          ["quantity", quantity],
          ["groupID", groupID],
          ["categoryID", categoryID],
          ["customInfo", customInfo],
          ["singleton", singleton],
          ["stacksize", stacksize],
        ],
      },
    };
  }

  Handle_GetInventoryFromId(args, session, kwargs) {
    const itemid = args && args.length > 0 ? args[0] : 0;
    const numericItemId = this._normalizeInventoryId(itemid);
    const charId = this._getCharacterId(session);
    const stationId = this._getStationId(session);
    const boundContext = this._getBoundContext(session);
    const boundShip =
      findCharacterShip(charId, numericItemId) ||
      findShipItemById(numericItemId);
    const explicitLocationID =
      this._extractKwarg(kwargs, "locationID") ??
      (args && args.length > 2 ? args[2] : undefined);
    const normalizedExplicitLocationID =
      explicitLocationID === undefined || explicitLocationID === null
        ? 0
        : this._normalizeInventoryId(explicitLocationID);
    const inheritedLocationID =
      boundContext &&
      boundContext.locationID !== null &&
      boundContext.locationID !== undefined
        ? this._normalizeInventoryId(boundContext.locationID)
        : 0;
    const shipLocationID = boundShip
      ? this._normalizeInventoryId(boundShip.locationID)
      : 0;
    const resolvedLocationID =
      normalizedExplicitLocationID > 0
        ? normalizedExplicitLocationID
        : boundShip && inheritedLocationID > 0
          ? inheritedLocationID
          : shipLocationID > 0
            ? shipLocationID
            : numericItemId === stationId
              ? stationId
              : itemid;
    this._traceInventory("GetInventoryFromId", session, { args });
    log.debug(
      `[InvBroker] GetInventoryFromId(itemid=${itemid}, locationID=${resolvedLocationID})`,
    );
    return this._makeBoundSubstruct({
      inventoryID: itemid,
      locationID: resolvedLocationID,
      flagID:
        numericItemId === charId
          ? null
          : numericItemId === stationId
            ? ITEM_FLAGS.HANGAR
            : boundShip
              ? ITEM_FLAGS.CARGO_HOLD
              : null,
      kind:
        numericItemId === charId
          ? "characterInventory"
          : numericItemId === stationId
            ? "stationHangar"
            : boundShip
              ? "shipInventory"
              : "container",
    });
  }

  Handle_SetLabel(args, session) {
    this._traceInventory("SetLabel", session, { args });
    log.debug("[InvBroker] SetLabel");
    return null;
  }

  Handle_List(args, session, kwargs) {
    const argFlag = args && args.length > 0 ? args[0] : null;
    const kwFlag = this._extractKwarg(kwargs, "flag");
    const boundContext = this._getBoundContext(session);
    const requestedFlag = kwFlag ?? argFlag ?? boundContext?.flagID ?? null;
    this._traceInventory("List", session, {
      args,
      kwargs,
      requestedFlag,
    });
    log.debug(
      `[InvBroker] List (inventory contents) flag=${requestedFlag} bound=${JSON.stringify(boundContext)}`,
    );

    const itemsForContainer = this._resolveContainerItems(
      session,
      requestedFlag,
      boundContext,
    );
    const lines = itemsForContainer.map((ship) =>
      this._buildInvRow(
        session,
        this._itemOverridesFromId(session, ship.itemID || ship.shipID),
      ),
    );

    log.debug(`[InvBroker] List ships=${lines.length}`);
    this._traceInventory("ListResult", session, {
      requestedFlag,
      count: lines.length,
      firstLine: lines[0] || null,
    });
    return this._buildInventoryRowset(lines);
  }

  Handle_ListByFlags(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    const rawFlags =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flags") ??
      [];
    const requestedFlags = this._normalizeFlagList(rawFlags);
    const seenItemIds = new Set();
    const lines = [];

    this._traceInventory("ListByFlags", session, {
      args,
      kwargs,
      requestedFlags,
    });
    log.debug(
      `[InvBroker] ListByFlags(flags=${requestedFlags.join(",")}) bound=${JSON.stringify(boundContext)}`,
    );

    for (const requestedFlag of requestedFlags) {
      const itemsForFlag = this._resolveContainerItems(
        session,
        requestedFlag,
        boundContext,
      );
      for (const item of itemsForFlag) {
        const itemID = item.itemID || item.shipID;
        if (seenItemIds.has(itemID)) {
          continue;
        }

        seenItemIds.add(itemID);
        lines.push(
          this._buildInvRow(
            session,
            this._itemOverridesFromId(session, itemID),
          ),
        );
      }
    }

    this._traceInventory("ListByFlagsResult", session, {
      requestedFlags,
      count: lines.length,
      firstLine: lines[0] || null,
    });
    return this._buildInventoryRowset(lines);
  }

  Handle_GetItem(args, session) {
    const boundContext = this._getBoundContext(session);
    const itemID =
      args && args.length > 0
        ? args[0]
        : boundContext && boundContext.inventoryID
          ? boundContext.inventoryID
          : this._getShipId(session);
    this._traceInventory("GetItem", session, {
      args,
      resolvedItemID: itemID,
    });
    log.debug(`[InvBroker] GetItem(itemID=${itemID})`);

    const numericItemID = this._normalizeInventoryId(itemID);
    const isCharacterItem = numericItemID === this._getCharacterId(session);
    const skillRecord = this._findCharacterSkillRecord(session, numericItemID);
    const shipRecord =
      findCharacterShip(this._getCharacterId(session), numericItemID) ||
      findItemById(numericItemID);
    const overrides = isCharacterItem
      ? this._buildCharacterItemOverrides(session)
      : shipRecord || skillRecord
        ? this._itemOverridesFromId(session, numericItemID)
        : this._buildContainerItemOverrides(session, numericItemID);

    return this._buildInvItem(session, overrides);
  }

  Handle_GetItemByID(args, session) {
    return this.Handle_GetItem(args, session);
  }

  Handle_GetItems(args, session) {
    const ids =
      args && args.length > 0 && Array.isArray(args[0]) ? args[0] : [];
    this._traceInventory("GetItems", session, { args });
    log.debug(`[InvBroker] GetItems(count=${ids.length})`);

    const items = ids.map((id) =>
      this._buildInvItem(session, this._itemOverridesFromId(session, id)),
    );
    return { type: "list", items };
  }

  Handle_GetSelfInvItem(args, session) {
    const boundContext = this._getBoundContext(session);
    const inventoryID =
      boundContext &&
      boundContext.inventoryID !== null &&
      boundContext.inventoryID !== undefined
        ? boundContext.inventoryID
        : this._getShipId(session);
    const overrides = this._buildContainerItemOverrides(session, inventoryID);
    this._traceInventory("GetSelfInvItem", session, { args });
    log.debug("[InvBroker] GetSelfInvItem");
    this._traceInventory("GetSelfInvItemResult", session, {
      inventoryID,
      overrides,
    });
    return this._buildInvKeyVal(session, overrides);
  }

  Handle_TrashItems(args, session) {
    this._traceInventory("TrashItems", session, { args });
    log.debug("[InvBroker] TrashItems");
    return null;
  }

  Handle_GetContainerContents(args, session) {
    const containerID =
      args && args.length > 0 ? args[0] : this._getStationId(session);
    const locationID = args && args.length > 1 ? args[1] : containerID;
    const numericContainerID = this._normalizeInventoryId(containerID);
    const stationId = this._getStationId(session);
    this._traceInventory("GetContainerContents", session, { args });
    log.debug(
      `[InvBroker] GetContainerContents(containerID=${numericContainerID}, locationID=${locationID})`,
    );

    const items =
      numericContainerID === this._getCharacterId(session)
        ? this._getCharacterContainerItems(session, null)
        : numericContainerID === stationId
          ? listContainerItems(
              this._getCharacterId(session),
              stationId,
              ITEM_FLAGS.HANGAR,
            )
          : listContainerItems(
              this._getCharacterId(session),
              numericContainerID,
              null,
            );

    this._traceInventory("GetContainerContentsResult", session, {
      containerID: numericContainerID,
      count: items.length,
      firstItem: items[0] || null,
    });
    return this._buildInventoryRowset(
      items.map((item) =>
        this._buildInvRow(
          session,
          this._itemOverridesFromId(session, item.itemID || item.shipID),
        ),
      ),
    );
  }

  Handle_GetCapacity(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    const requestedFlag =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flag") ??
      (boundContext ? boundContext.flagID : null);
    this._traceInventory("GetCapacity", session, {
      args,
      kwargs,
      requestedFlag,
    });
    log.debug(
      `[InvBroker] GetCapacity(flag=${String(requestedFlag)}) bound=${JSON.stringify(boundContext)}`,
    );
    return this._calculateCapacity(session, boundContext, requestedFlag);
  }

  Handle_StackAll(args, session, kwargs) {
    this._traceInventory("StackAll", session, { args, kwargs });
    const boundContext = this._getBoundContext(session);
    const requestedFlag =
      (args && args.length > 0 ? args[0] : null) ??
      this._extractKwarg(kwargs, "flag") ??
      (boundContext ? boundContext.flagID : ITEM_FLAGS.HANGAR);
    const containerLocationID =
      boundContext &&
      boundContext.locationID !== null &&
      boundContext.locationID !== undefined
        ? this._normalizeInventoryId(boundContext.locationID, 0)
        : this._getStationId(session);
    const containerFlagID = this._normalizeInventoryId(
      requestedFlag === STATION_ITEM_HANGAR_FLAG
        ? ITEM_FLAGS.HANGAR
        : requestedFlag,
      ITEM_FLAGS.HANGAR,
    );

    log.debug(
      `[InvBroker] StackAll(locationID=${containerLocationID}, flagID=${containerFlagID})`,
    );

    const stackResult = stackAllInventoryItemsInContainer(
      this._getCharacterId(session),
      containerLocationID,
      containerFlagID,
    );
    if (!stackResult.success) {
      log.warn(
        `[InvBroker] StackAll failed locationID=${containerLocationID} flagID=${containerFlagID}: ${stackResult.errorMsg}`,
      );
      return null;
    }

    for (const change of stackResult.data) {
      if (!change || !change.updatedItem) {
        continue;
      }

      syncInventoryItemForSession(
        session,
        change.updatedItem,
        change.previousData || {},
        {
          emitCfgLocation: true,
        },
      );

      for (const removedItem of change.removedItems || []) {
        syncInventoryItemForSession(
          session,
          {
            ...removedItem,
            locationID: 0,
            flagID: 0,
            quantity: 0,
            stacksize: 0,
          },
          {
            locationID: removedItem.locationID,
            flagID: removedItem.flagID,
            quantity: removedItem.quantity,
            singleton: removedItem.singleton,
            stacksize: removedItem.stacksize,
          },
          {
            emitCfgLocation: true,
          },
        );
      }
    }

    return null;
  }

  Handle_Add(args, session, kwargs) {
    this._traceInventory("Add", session, { args, kwargs });
    log.debug("[InvBroker] Add");
    const itemIds = this._normalizeItemIdList(
      args && args.length > 0 ? args[0] : null,
    );
    return this._applyBoundInventoryMove(itemIds, session, kwargs, args);
  }

  Handle_MultiAdd(args, session, kwargs) {
    this._traceInventory("MultiAdd", session, { args, kwargs });
    log.debug("[InvBroker] MultiAdd");
    const itemIds = this._normalizeItemIdList(
      args && args.length > 0 ? args[0] : null,
    );
    return this._applyBoundInventoryMove(itemIds, session, kwargs, args);
  }

  Handle_Remove(args, session, kwargs) {
    this._traceInventory("Remove", session, { args, kwargs });
    log.debug("[InvBroker] Remove");
    const itemIds = this._normalizeItemIdList(
      args && args.length > 0 ? args[0] : null,
    );
    return this._applyBoundInventoryMove(itemIds, session, kwargs, args);
  }

  Handle_MultiRemove(args, session, kwargs) {
    this._traceInventory("MultiRemove", session, { args, kwargs });
    log.debug("[InvBroker] MultiRemove");
    const itemIds = this._normalizeItemIdList(
      args && args.length > 0 ? args[0] : null,
    );
    return this._applyBoundInventoryMove(itemIds, session, kwargs, args);
  }

  Handle_Move(args, session, kwargs) {
    this._traceInventory("Move", session, { args, kwargs });
    log.debug("[InvBroker] Move");
    const itemIds = this._normalizeItemIdList(
      args && args.length > 0 ? args[0] : null,
    );
    return this._applyBoundInventoryMove(itemIds, session, kwargs, args);
  }

  Handle_MultiMove(args, session, kwargs) {
    this._traceInventory("MultiMove", session, { args, kwargs });
    log.debug("[InvBroker] MultiMove");
    const itemIds = this._normalizeItemIdList(
      args && args.length > 0 ? args[0] : null,
    );
    return this._applyBoundInventoryMove(itemIds, session, kwargs, args);
  }

  Handle_StripFitting(args, session, kwargs) {
    const boundContext = this._getBoundContext(session);
    return this._stripFitting(boundContext, session);
  }

  Handle_ListDroneBay(args, session, kwargs) {
    this._traceInventory("ListDroneBay", session, { args, kwargs });
    log.debug("[InvBroker] ListDroneBay");
    return this._buildInventoryRowset([]);
  }

  Handle_TakeOutTrash(args, session, kwargs) {
    this._traceInventory("TakeOutTrash", session, { args, kwargs });
    log.debug("[InvBroker] TakeOutTrash");
    return null;
  }

  Handle_AssembleCargoContainer(args, session, kwargs) {
    this._traceInventory("AssembleCargoContainer", session, { args, kwargs });
    log.debug("[InvBroker] AssembleCargoContainer");
    return null;
  }

  Handle_BreakPlasticWrap(args, session, kwargs) {
    this._traceInventory("BreakPlasticWrap", session, { args, kwargs });
    log.debug("[InvBroker] BreakPlasticWrap");
    return null;
  }

  Handle_DeliverToCorpHangar(args, session, kwargs) {
    this._traceInventory("DeliverToCorpHangar", session, { args, kwargs });
    log.debug("[InvBroker] DeliverToCorpHangar");
    return null;
  }

  Handle_DeliverToCorpMember(args, session, kwargs) {
    this._traceInventory("DeliverToCorpMember", session, { args, kwargs });
    log.debug("[InvBroker] DeliverToCorpMember");
    return null;
  }

  Handle_GetItemDescriptor(args, session) {
    this._traceInventory("GetItemDescriptor", session, { args });
    log.debug("[InvBroker] GetItemDescriptor");
    return this._buildInventoryRowDescriptor();
  }

  Handle_GetAvailableTurretSlots(args, session) {
    this._traceInventory("GetAvailableTurretSlots", session, { args });
    return [];
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    this._traceInventory("MachoResolveObject", session, { args, kwargs });
    log.debug("[InvBroker] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[InvBroker] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))} kwargs=${JSON.stringify(kwargs, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );
    this._traceInventory("MachoBindObject", session, {
      args,
      kwargs,
      bindParams,
      nestedCall,
    });

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    this._rememberBoundContext(idString, {
      inventoryID:
        Array.isArray(bindParams) && bindParams.length > 0
          ? bindParams[0]
          : bindParams,
      locationID:
        Array.isArray(bindParams) && bindParams.length > 0
          ? bindParams[0]
          : bindParams,
      flagID: null,
      kind: "boundInventory",
    });

    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[InvBroker] MachoBindObject nested call: ${methodName}`);
      const previousBoundObjectID = session
        ? session.currentBoundObjectID
        : null;
      try {
        if (session) {
          session.currentBoundObjectID = idString;
        }
        callResult = this.callMethod(
          methodName,
          Array.isArray(callArgs) ? callArgs : [callArgs],
          session,
          callKwargs,
        );
      } finally {
        if (session) {
          session.currentBoundObjectID = previousBoundObjectID || null;
        }
      }
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  afterCallResponse(method, session) {
    if (!session) {
      return;
    }

    if (method !== "List" && method !== "GetSelfInvItem") {
      return;
    }

    const boundContext = this._getBoundContext(session);
    if (!boundContext || boundContext.kind !== "stationHangar") {
      return;
    }

    if (!shouldFlushDeferredDockedShipSessionChange(session, method)) {
      return;
    }

    flushDeferredDockedShipSessionChange(session, {
      trigger: `invbroker.${method}`,
    });
  }
}

module.exports = InvBrokerService;
