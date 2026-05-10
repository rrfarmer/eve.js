const path = require("path");

const {
  findItemById,
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_DEED_FLAG,
  GROUP_STRUCTURE_DEED,
  isStructureDeedFlag,
} = require(path.join(__dirname, "./structureInventoryFlags"));

const ATTRIBUTE_STRUCTURE_REQUIRES_DEED_TYPE = "structureRequiresDeedType";

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function getRequiredQuantumCoreTypeID(structureOrTypeID) {
  const typeID =
    structureOrTypeID && typeof structureOrTypeID === "object"
      ? toPositiveInt(structureOrTypeID.typeID, 0)
      : toPositiveInt(structureOrTypeID, 0);
  if (!typeID) {
    return 0;
  }

  const dogmaRequiredTypeID = toPositiveInt(
    getTypeAttributeValue(typeID, ATTRIBUTE_STRUCTURE_REQUIRES_DEED_TYPE),
    0,
  );
  if (dogmaRequiredTypeID > 0) {
    return dogmaRequiredTypeID;
  }

  const typeRecord = structureState.getStructureTypeByID(typeID);
  return toPositiveInt(typeRecord && typeRecord.defaultQuantumCoreTypeID, 0);
}

function getMoveQuantity(item, requestedQuantity = null) {
  const availableQuantity =
    toInt(item && item.singleton, 0) === 1
      ? 1
      : Math.max(1, toInt(item && (item.stacksize ?? item.quantity), 1));
  if (requestedQuantity === null || requestedQuantity === undefined) {
    return availableQuantity;
  }
  return Math.max(1, toInt(requestedQuantity, 1));
}

function isQuantumCoreItem(item) {
  return (
    item &&
    toPositiveInt(item.typeID, 0) > 0 &&
    toPositiveInt(item.groupID, 0) === GROUP_STRUCTURE_DEED
  );
}

function listQuantumCoreBayItems(structureID, ownerID = null) {
  return listContainerItems(
    ownerID,
    toPositiveInt(structureID, 0),
    STRUCTURE_DEED_FLAG,
  )
    .filter((item) => isQuantumCoreItem(item))
    .sort((left, right) => toPositiveInt(left.itemID, 0) - toPositiveInt(right.itemID, 0));
}

function validateQuantumCoreInstall({
  structure,
  item,
  targetFlagID,
  quantity = null,
} = {}) {
  if (!structure || toPositiveInt(structure.structureID, 0) <= 0) {
    return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
  }
  if (!isStructureDeedFlag(targetFlagID)) {
    return { success: false, errorMsg: "INVALID_STRUCTURE_DEED_BAY" };
  }
  if (!item || toPositiveInt(item.itemID, 0) <= 0) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }
  if (!isQuantumCoreItem(item)) {
    return { success: false, errorMsg: "TYPE_NOT_QUANTUM_CORE" };
  }

  const requiredTypeID = getRequiredQuantumCoreTypeID(structure);
  if (!requiredTypeID) {
    return { success: false, errorMsg: "STRUCTURE_DOES_NOT_REQUIRE_QUANTUM_CORE" };
  }
  if (toPositiveInt(item.typeID, 0) !== requiredTypeID) {
    return {
      success: false,
      errorMsg: "WRONG_QUANTUM_CORE_TYPE",
      data: {
        requiredTypeID,
        providedTypeID: toPositiveInt(item.typeID, 0),
      },
    };
  }

  if (getMoveQuantity(item, quantity) !== 1) {
    return { success: false, errorMsg: "STRUCTURE_DEED_BAY_CAPACITY_EXCEEDED" };
  }

  const existingCore = listQuantumCoreBayItems(structure.structureID)
    .find((coreItem) => toPositiveInt(coreItem.itemID, 0) !== toPositiveInt(item.itemID, 0));
  if (existingCore) {
    return { success: false, errorMsg: "STRUCTURE_ALREADY_HAS_QUANTUM_CORE" };
  }

  return {
    success: true,
    data: {
      requiredTypeID,
    },
  };
}

function installQuantumCoreFromItem(structureID, itemOrID, options = {}) {
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  if (!structure) {
    return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
  }

  const item =
    itemOrID && typeof itemOrID === "object"
      ? itemOrID
      : findItemById(toPositiveInt(itemOrID, 0));
  const validation = validateQuantumCoreInstall({
    structure,
    item,
    targetFlagID: STRUCTURE_DEED_FLAG,
    quantity: 1,
  });
  if (!validation.success) {
    return validation;
  }

  return structureState.setStructureQuantumCoreInstalled(
    structure.structureID,
    true,
    {
      nowMs: options.nowMs,
      quantumCoreItemID: toPositiveInt(item.itemID, 0),
      quantumCoreItemTypeID: toPositiveInt(item.typeID, validation.data.requiredTypeID),
    },
  );
}

function syncInstalledQuantumCoreFromBay(structureID, options = {}) {
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  if (!structure) {
    return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
  }
  const ownerID = toPositiveInt(structure.ownerCorpID || structure.ownerID, 0);
  const coreItem = listQuantumCoreBayItems(structure.structureID, ownerID)[0] || null;
  if (!coreItem) {
    return {
      success: true,
      data: structure,
      installed: false,
    };
  }
  const installResult = installQuantumCoreFromItem(structure.structureID, coreItem, options);
  if (!installResult.success) {
    return installResult;
  }
  return {
    ...installResult,
    installed: true,
  };
}

function checkCanRemoveQuantumCoreItem(itemOrID, session = null) {
  const item =
    itemOrID && typeof itemOrID === "object"
      ? itemOrID
      : findItemById(toPositiveInt(itemOrID, 0));
  if (!item || !isStructureDeedFlag(item.flagID)) {
    return { success: true };
  }

  const structure = structureState.getStructureByID(item.locationID, {
    refresh: false,
  });
  if (!structure) {
    return { success: true };
  }
  if (structureState.hasStructureGmBypass(session)) {
    return { success: true, data: { gmBypass: true } };
  }
  return { success: false, errorMsg: "STRUCTURE_QUANTUM_CORE_REMOVE_DENIED" };
}

module.exports = {
  ATTRIBUTE_STRUCTURE_REQUIRES_DEED_TYPE,
  getRequiredQuantumCoreTypeID,
  isQuantumCoreItem,
  listQuantumCoreBayItems,
  validateQuantumCoreInstall,
  installQuantumCoreFromItem,
  syncInstalledQuantumCoreFromBay,
  checkCanRemoveQuantumCoreItem,
};
