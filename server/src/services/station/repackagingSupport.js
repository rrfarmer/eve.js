const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  extractDictEntries,
  extractList,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  ITEM_FLAGS,
  findCharacterShipItem,
  getActiveShipItem,
  listContainerItems,
  setShipPackagingState,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));

function extractTupleValues(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && value.type === "tuple" && Array.isArray(value.items)) {
    return value.items;
  }

  if (value && value.type === "list" && Array.isArray(value.items)) {
    return value.items;
  }

  return [];
}

function extractRepackageRequests(rawValue) {
  const requests = [];
  for (const [stationKey, shipList] of extractDictEntries(rawValue)) {
    const stationID = normalizeNumber(stationKey, 0);
    for (const tupleValue of extractList(shipList)) {
      const tupleItems = extractTupleValues(tupleValue);
      const itemID = normalizeNumber(tupleItems[0], 0);
      const itemStationID = normalizeNumber(tupleItems[1], stationID);
      if (itemID > 0 && itemStationID > 0) {
        requests.push({
          itemID,
          stationID: itemStationID,
        });
      }
    }
  }

  return requests;
}

function repackageShipItemsForSession(session, requests, sourceLabel = "RepackagingSvc") {
  const stationID = normalizeNumber(
    session && (session.stationid || session.stationID),
    0,
  );
  const charID = normalizeNumber(session && session.characterID, 0);
  const activeShip = charID > 0 ? getActiveShipItem(charID) : null;

  log.info(
    `[${sourceLabel}] RepackageItems station=${stationID} requests=${JSON.stringify(requests)}`,
  );

  for (const request of requests) {
    if (request.stationID !== stationID || charID <= 0) {
      continue;
    }

    const shipItem = findCharacterShipItem(charID, request.itemID);
    if (!shipItem) {
      continue;
    }

    if (
      activeShip &&
      normalizeNumber(activeShip.itemID, 0) === normalizeNumber(shipItem.itemID, 0)
    ) {
      log.warn(
        `[${sourceLabel}] Refusing to repackage active ship ${shipItem.itemID}`,
      );
      continue;
    }

    if (
      normalizeNumber(shipItem.locationID, 0) !== stationID ||
      normalizeNumber(shipItem.flagID, 0) !== ITEM_FLAGS.HANGAR
    ) {
      log.warn(
        `[${sourceLabel}] Refusing to repackage ship ${shipItem.itemID} outside station hangar`,
      );
      continue;
    }

    const nestedItems = listContainerItems(charID, shipItem.itemID, null);
    if (nestedItems.length > 0) {
      log.warn(
        `[${sourceLabel}] Refusing to repackage ship ${shipItem.itemID} with ${nestedItems.length} contained items`,
      );
      continue;
    }

    const updateResult = setShipPackagingState(shipItem.itemID, true);
    if (!updateResult.success) {
      log.warn(
        `[${sourceLabel}] Failed to repackage ship ${shipItem.itemID}: ${normalizeText(updateResult.errorMsg, "WRITE_ERROR")}`,
      );
      continue;
    }

    syncInventoryItemForSession(
      session,
      updateResult.data,
      {
        locationID: updateResult.previousData.locationID,
        flagID: updateResult.previousData.flagID,
        quantity: updateResult.previousData.quantity,
        singleton: updateResult.previousData.singleton,
        stacksize: updateResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );
  }
}

module.exports = {
  extractRepackageRequests,
  repackageShipItemsForSession,
};
