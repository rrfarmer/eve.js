const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getTypeAttributeValue,
  isModuleOnline,
  typeHasEffectName,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  findItemById,
  listContainerItems,
  consumeInventoryItemQuantity,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const structureState = require(path.join(__dirname, "./structureState"));
const {
  STRUCTURE_SERVICE_ID,
  STRUCTURE_SERVICE_STATE,
  STRUCTURE_UPKEEP_STATE,
  getAllowedServicesForStructureType,
} = require(path.join(__dirname, "./structureConstants"));

const STRUCTURE_SERVICE_SLOT_FLAGS = Object.freeze([164, 165, 166, 167, 168, 169, 170, 171]);
const STRUCTURE_FUEL_FLAG = 172;
const FUEL_BLOCK_GROUP_ID = 1136;
const MS_PER_HOUR = 60 * 60 * 1000;

const ONLINE_BY_DEFAULT = new Set([
  STRUCTURE_SERVICE_ID.DOCKING,
  STRUCTURE_SERVICE_ID.FITTING,
  STRUCTURE_SERVICE_ID.OFFICES,
  STRUCTURE_SERVICE_ID.REPAIR,
  STRUCTURE_SERVICE_ID.INSURANCE,
]);

const MANUFACTURING_SERVICES = new Set([
  STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC,
  STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL,
  STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL,
]);

const LABORATORY_SERVICES = new Set([
  STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
  STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
  STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
  STRUCTURE_SERVICE_ID.LABORATORY_INVENTION,
]);

const REACTION_SERVICES = new Set([
  STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE,
  STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL,
  STRUCTURE_SERVICE_ID.REACTIONS_HYBRID,
]);

const SERVICE_MODULE_TYPE_SERVICES = Object.freeze({
  35892: Object.freeze([STRUCTURE_SERVICE_ID.MARKET]),
  35894: Object.freeze([STRUCTURE_SERVICE_ID.MEDICAL]),
  35899: Object.freeze([STRUCTURE_SERVICE_ID.REPROCESSING]),
  35891: Object.freeze([
    STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
  ]),
  35886: Object.freeze([STRUCTURE_SERVICE_ID.LABORATORY_INVENTION]),
  35878: Object.freeze([STRUCTURE_SERVICE_ID.MANUFACTURING_BASIC]),
  35881: Object.freeze([STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL]),
  35877: Object.freeze([
    STRUCTURE_SERVICE_ID.MANUFACTURING_SUPERCAPITAL,
    STRUCTURE_SERVICE_ID.MANUFACTURING_CAPITAL,
  ]),
  45550: Object.freeze([
    STRUCTURE_SERVICE_ID.LABORATORY_COPYING,
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_MATERIAL,
    STRUCTURE_SERVICE_ID.LABORATORY_RESEARCH_TIME,
  ]),
  45538: Object.freeze([STRUCTURE_SERVICE_ID.REACTIONS_HYBRID]),
  45537: Object.freeze([STRUCTURE_SERVICE_ID.REACTIONS_COMPOSITE]),
  45539: Object.freeze([STRUCTURE_SERVICE_ID.REACTIONS_BIOCHEMICAL]),
  45009: Object.freeze([STRUCTURE_SERVICE_ID.MOON_MINING]),
  35913: Object.freeze([STRUCTURE_SERVICE_ID.JUMP_BRIDGE]),
  35912: Object.freeze([STRUCTURE_SERVICE_ID.CYNO_BEACON]),
  35914: Object.freeze([STRUCTURE_SERVICE_ID.CYNO_JAMMER]),
  78330: Object.freeze([STRUCTURE_SERVICE_ID.LOYALTY_STORE]),
  82941: Object.freeze([STRUCTURE_SERVICE_ID.AUTOMOONMINING]),
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = toInt(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function isStructureServiceFlag(flagID) {
  return STRUCTURE_SERVICE_SLOT_FLAGS.includes(toInt(flagID, 0));
}

function isStructureFuelFlag(flagID) {
  return toInt(flagID, 0) === STRUCTURE_FUEL_FLAG;
}

function getServiceIDsForModuleType(typeID) {
  const numericTypeID = toPositiveInt(typeID, 0);
  return [...(SERVICE_MODULE_TYPE_SERVICES[numericTypeID] || [])];
}

function isStructureServiceModuleType(typeID) {
  const numericTypeID = toPositiveInt(typeID, 0);
  if (getServiceIDsForModuleType(numericTypeID).length > 0) {
    return true;
  }
  return typeHasEffectName(numericTypeID, "serviceSlot");
}

function getStructureServiceSlotCapacity(structureOrTypeID) {
  const typeID =
    structureOrTypeID && typeof structureOrTypeID === "object"
      ? structureOrTypeID.typeID
      : structureOrTypeID;
  return Math.max(0, toInt(getTypeAttributeValue(typeID, "serviceSlots"), 0));
}

function getServiceModuleFuelRequirement(typeID) {
  const numericTypeID = toPositiveInt(typeID, 0);
  const fuelGroupID = toPositiveInt(
    getTypeAttributeValue(numericTypeID, "serviceModuleFuelConsumptionGroup"),
    FUEL_BLOCK_GROUP_ID,
  );
  return {
    fuelGroupID,
    hourlyAmount: Math.max(0, toInt(getTypeAttributeValue(numericTypeID, "serviceModuleFuelAmount"), 0)),
    onlineAmount: Math.max(0, toInt(getTypeAttributeValue(numericTypeID, "serviceModuleFuelOnlineAmount"), 0)),
  };
}

function expandMetaServiceIDs(serviceIDs = []) {
  const expanded = new Set(
    (Array.isArray(serviceIDs) ? serviceIDs : [])
      .map((serviceID) => toPositiveInt(serviceID, 0))
      .filter(Boolean),
  );

  if ([...expanded].some((serviceID) => MANUFACTURING_SERVICES.has(serviceID))) {
    expanded.add(STRUCTURE_SERVICE_ID.MANUFACTURING);
    expanded.add(STRUCTURE_SERVICE_ID.INDUSTRY);
  }
  if ([...expanded].some((serviceID) => LABORATORY_SERVICES.has(serviceID))) {
    expanded.add(STRUCTURE_SERVICE_ID.LABORATORY);
    expanded.add(STRUCTURE_SERVICE_ID.INDUSTRY);
  }
  if ([...expanded].some((serviceID) => REACTION_SERVICES.has(serviceID))) {
    expanded.add(STRUCTURE_SERVICE_ID.REACTIONS);
    expanded.add(STRUCTURE_SERVICE_ID.INDUSTRY);
  }

  return [...expanded].sort((left, right) => left - right);
}

function listStructureServiceModules(structureID, options = {}) {
  const targetID = toPositiveInt(structureID, 0);
  if (!targetID) {
    return [];
  }
  const includeOffline = options.includeOffline !== false;
  return listContainerItems(null, targetID, null)
    .filter((item) => item && isStructureServiceFlag(item.flagID))
    .filter((item) => includeOffline || isModuleOnline(item))
    .sort((left, right) => (toInt(left.flagID, 0) - toInt(right.flagID, 0)) || (toInt(left.itemID, 0) - toInt(right.itemID, 0)));
}

function getAllowedServiceSet(structure) {
  return new Set(
    getAllowedServicesForStructureType(
      structure && structure.typeID,
      structure && structure.structureFamily,
    ).map((serviceID) => toPositiveInt(serviceID, 0)),
  );
}

function validateServiceModuleFit({
  structure,
  item,
  targetFlagID,
  fittedItems = null,
} = {}) {
  const numericTargetFlagID = toPositiveInt(targetFlagID, 0);
  if (!structure || toPositiveInt(structure.structureID, 0) <= 0) {
    return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
  }
  if (!item || toPositiveInt(item.typeID, 0) <= 0) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }
  if (!isStructureServiceFlag(numericTargetFlagID)) {
    return { success: false, errorMsg: "INVALID_STRUCTURE_SERVICE_SLOT" };
  }
  if (!isStructureServiceModuleType(item.typeID)) {
    return { success: false, errorMsg: "TYPE_NOT_STRUCTURE_SERVICE_MODULE" };
  }

  const serviceIDs = getServiceIDsForModuleType(item.typeID);
  if (serviceIDs.length <= 0) {
    return { success: false, errorMsg: "STRUCTURE_SERVICE_NOT_MAPPED" };
  }

  const slotCapacity = getStructureServiceSlotCapacity(structure);
  const slotIndex = numericTargetFlagID - STRUCTURE_SERVICE_SLOT_FLAGS[0];
  if (slotCapacity <= 0 || slotIndex < 0 || slotIndex >= slotCapacity) {
    return {
      success: false,
      errorMsg: "STRUCTURE_SERVICE_SLOT_UNAVAILABLE",
      data: { slotCapacity },
    };
  }

  const currentFittedItems = Array.isArray(fittedItems)
    ? fittedItems
    : listStructureServiceModules(structure.structureID);
  const conflictingItem = currentFittedItems.find(
    (fittedItem) =>
      fittedItem &&
      toInt(fittedItem.flagID, 0) === numericTargetFlagID &&
      toInt(fittedItem.itemID, 0) !== toInt(item.itemID, 0) &&
      toInt(fittedItem.stacksize ?? 1, 1) > 0,
  );
  if (conflictingItem) {
    return { success: false, errorMsg: "SLOT_OCCUPIED" };
  }

  const allowedServices = getAllowedServiceSet(structure);
  const disallowedServices = expandMetaServiceIDs(serviceIDs)
    .filter((serviceID) => !allowedServices.has(serviceID));
  if (disallowedServices.length > 0) {
    return {
      success: false,
      errorMsg: "STRUCTURE_SERVICE_NOT_ALLOWED",
      data: { disallowedServices },
    };
  }

  return {
    success: true,
    data: {
      family: "service",
      targetFlagID: numericTargetFlagID,
      serviceIDs,
      expandedServiceIDs: expandMetaServiceIDs(serviceIDs),
    },
  };
}

function isFuelCompatibleItem(itemOrTypeID, fuelGroupID = FUEL_BLOCK_GROUP_ID) {
  const item =
    itemOrTypeID && typeof itemOrTypeID === "object"
      ? itemOrTypeID
      : resolveItemByTypeID(toPositiveInt(itemOrTypeID, 0));
  if (!item) {
    return false;
  }
  return toPositiveInt(item.groupID, 0) === toPositiveInt(fuelGroupID, FUEL_BLOCK_GROUP_ID);
}

function listStructureFuelItems(structureID, fuelGroupID = FUEL_BLOCK_GROUP_ID) {
  const targetID = toPositiveInt(structureID, 0);
  if (!targetID) {
    return [];
  }
  return listContainerItems(null, targetID, STRUCTURE_FUEL_FLAG)
    .filter((item) => item && isFuelCompatibleItem(item, fuelGroupID))
    .sort((left, right) => toInt(left.itemID, 0) - toInt(right.itemID, 0));
}

function getStructureFuelQuantity(structureID, fuelGroupID = FUEL_BLOCK_GROUP_ID) {
  return listStructureFuelItems(structureID, fuelGroupID).reduce(
    (sum, item) => sum + Math.max(0, toInt(item.stacksize ?? item.quantity, 0)),
    0,
  );
}

function consumeStructureFuel(structureID, fuelGroupID, quantity) {
  const requiredQuantity = Math.max(0, toInt(quantity, 0));
  if (requiredQuantity <= 0) {
    return { success: true, data: { quantity: 0, changes: [] } };
  }

  const fuelItems = listStructureFuelItems(structureID, fuelGroupID);
  const availableQuantity = fuelItems.reduce(
    (sum, item) => sum + Math.max(0, toInt(item.stacksize ?? item.quantity, 0)),
    0,
  );
  if (availableQuantity < requiredQuantity) {
    return {
      success: false,
      errorMsg: "NOT_ENOUGH_STRUCTURE_FUEL",
      data: { availableQuantity, requiredQuantity },
    };
  }

  let remaining = requiredQuantity;
  const changes = [];
  for (const item of fuelItems) {
    if (remaining <= 0) {
      break;
    }
    const available = Math.max(0, toInt(item.stacksize ?? item.quantity, 0));
    const takeQuantity = Math.min(available, remaining);
    const consumeResult = consumeInventoryItemQuantity(item.itemID, takeQuantity);
    if (!consumeResult.success) {
      return consumeResult;
    }
    changes.push(...((consumeResult.data && consumeResult.data.changes) || []));
    remaining -= takeQuantity;
  }

  return {
    success: true,
    data: { quantity: requiredQuantity, changes },
  };
}

function consumeServiceModuleOnlineFuel(structureID, moduleItem) {
  const requirement = getServiceModuleFuelRequirement(moduleItem && moduleItem.typeID);
  return consumeStructureFuel(structureID, requirement.fuelGroupID, requirement.onlineAmount);
}

function calculateOnlineFuelBurnByGroup(structureID) {
  const burnByGroup = new Map();
  for (const moduleItem of listStructureServiceModules(structureID, { includeOffline: false })) {
    const requirement = getServiceModuleFuelRequirement(moduleItem.typeID);
    if (requirement.hourlyAmount <= 0) {
      continue;
    }
    burnByGroup.set(
      requirement.fuelGroupID,
      (burnByGroup.get(requirement.fuelGroupID) || 0) + requirement.hourlyAmount,
    );
  }
  return burnByGroup;
}

function projectFuelExpiresAt(structureID, nowMs = Date.now()) {
  const burnByGroup = calculateOnlineFuelBurnByGroup(structureID);
  if (burnByGroup.size <= 0) {
    return null;
  }

  let expiresAt = null;
  for (const [fuelGroupID, hourlyBurn] of burnByGroup.entries()) {
    if (hourlyBurn <= 0) {
      continue;
    }
    const available = getStructureFuelQuantity(structureID, fuelGroupID);
    const hoursRemaining = Math.floor(available / hourlyBurn);
    const groupExpiresAt = toInt(nowMs, Date.now()) + (hoursRemaining * MS_PER_HOUR);
    expiresAt = expiresAt === null ? groupExpiresAt : Math.min(expiresAt, groupExpiresAt);
  }
  return expiresAt;
}

function buildReconciledServiceStates(structureID, structure) {
  const allowedServices = getAllowedServiceSet(structure);
  const serviceStates = {};
  for (const serviceID of allowedServices) {
    serviceStates[String(serviceID)] = ONLINE_BY_DEFAULT.has(serviceID)
      ? STRUCTURE_SERVICE_STATE.ONLINE
      : STRUCTURE_SERVICE_STATE.OFFLINE;
  }

  for (const moduleItem of listStructureServiceModules(structureID, { includeOffline: false })) {
    for (const serviceID of expandMetaServiceIDs(getServiceIDsForModuleType(moduleItem.typeID))) {
      if (allowedServices.has(serviceID)) {
        serviceStates[String(serviceID)] = STRUCTURE_SERVICE_STATE.ONLINE;
      }
    }
  }

  return serviceStates;
}

function reconcileStructureServices(structureID, options = {}) {
  const targetID = toPositiveInt(structureID, 0);
  const nowMs = toInt(options.nowMs, Date.now());
  const structure = structureState.getStructureByID(targetID, {
    refresh: false,
  });
  if (!structure) {
    return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
  }

  const onlineServiceModules = listStructureServiceModules(targetID, {
    includeOffline: false,
  });
  const nextServiceStates = buildReconciledServiceStates(targetID, structure);
  const hasOnlineServiceModule = onlineServiceModules.length > 0;
  const nextFuelExpiresAt = projectFuelExpiresAt(targetID, nowMs);
  const nextUpkeepState = hasOnlineServiceModule
    ? STRUCTURE_UPKEEP_STATE.FULL_POWER
    : STRUCTURE_UPKEEP_STATE.LOW_POWER;

  return structureState.updateStructureRecord(targetID, (current) => ({
    ...current,
    serviceStates: nextServiceStates,
    fuelExpiresAt: nextFuelExpiresAt,
    serviceFuelLastTickAt: hasOnlineServiceModule
      ? (current.serviceFuelLastTickAt || nowMs)
      : null,
    upkeepState: nextUpkeepState,
  }));
}

function offlineStructureServiceModule(moduleItem) {
  if (!moduleItem || !isStructureServiceFlag(moduleItem.flagID)) {
    return { success: true, data: moduleItem || null };
  }
  return require(path.join(__dirname, "../inventory/itemStore")).updateInventoryItem(
    moduleItem.itemID,
    (currentItem) => ({
      ...currentItem,
      moduleState: {
        ...(currentItem.moduleState || {}),
        online: false,
      },
    }),
  );
}

function tickStructureServiceFuel(structureID, nowMs = Date.now()) {
  const targetID = toPositiveInt(structureID, 0);
  const structure = structureState.getStructureByID(targetID, { refresh: false });
  if (!structure) {
    return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
  }

  const onlineModules = listStructureServiceModules(targetID, {
    includeOffline: false,
  });
  if (onlineModules.length <= 0) {
    return reconcileStructureServices(targetID, { nowMs });
  }

  const lastTickAt = toInt(structure.serviceFuelLastTickAt, nowMs);
  const elapsedHours = Math.floor(Math.max(0, toInt(nowMs, Date.now()) - lastTickAt) / MS_PER_HOUR);
  if (elapsedHours <= 0) {
    return reconcileStructureServices(targetID, { nowMs });
  }

  const burnByGroup = calculateOnlineFuelBurnByGroup(targetID);
  const insufficientGroups = [];
  const changes = [];
  for (const [fuelGroupID, hourlyBurn] of burnByGroup.entries()) {
    const requiredQuantity = hourlyBurn * elapsedHours;
    const consumeResult = consumeStructureFuel(targetID, fuelGroupID, requiredQuantity);
    if (!consumeResult.success) {
      insufficientGroups.push(fuelGroupID);
      continue;
    }
    changes.push(...((consumeResult.data && consumeResult.data.changes) || []));
  }

  if (insufficientGroups.length > 0) {
    const insufficientSet = new Set(insufficientGroups);
    for (const moduleItem of onlineModules) {
      const requirement = getServiceModuleFuelRequirement(moduleItem.typeID);
      if (insufficientSet.has(requirement.fuelGroupID)) {
        const offlineResult = offlineStructureServiceModule(moduleItem);
        if (!offlineResult.success) {
          log.warn(
            `[StructureServiceModules] Failed to offline unfueled module ${moduleItem.itemID}: ${offlineResult.errorMsg || "WRITE_ERROR"}`,
          );
        }
      }
    }
  }

  const reconcileResult = reconcileStructureServices(targetID, { nowMs });
  if (!reconcileResult.success) {
    return reconcileResult;
  }
  const stillHasOnlineServiceModules =
    listStructureServiceModules(targetID, { includeOffline: false }).length > 0;
  const tickResult = structureState.updateStructureRecord(targetID, (current) => ({
    ...current,
    serviceFuelLastTickAt: stillHasOnlineServiceModules ? nowMs : null,
  }));
  if (!tickResult.success) {
    return tickResult;
  }
  return {
    success: true,
    data: {
      structure: tickResult.data,
      consumedHours: elapsedHours,
      fuelChanges: changes,
      offlinedForFuel: insufficientGroups.length > 0,
    },
  };
}

function checkCanDisableServiceModule(moduleItemOrID, session = null) {
  const moduleItem =
    moduleItemOrID && typeof moduleItemOrID === "object"
      ? moduleItemOrID
      : findItemById(toPositiveInt(moduleItemOrID, 0));
  if (!moduleItem) {
    return { success: false, errorMsg: "MODULE_NOT_FOUND" };
  }
  if (!isStructureServiceFlag(moduleItem.flagID)) {
    return { success: true };
  }

  const structureID = toPositiveInt(moduleItem.locationID, 0);
  const structure = structureState.getStructureByID(structureID, { refresh: false });
  if (!structure) {
    return { success: false, errorMsg: "STRUCTURE_NOT_FOUND" };
  }
  const sessionStructureID = toPositiveInt(
    session && (session.structureID || session.structureid),
    0,
  );
  if (session && sessionStructureID > 0 && sessionStructureID !== structureID) {
    return { success: false, errorMsg: "NOT_DOCKED_IN_STRUCTURE" };
  }
  const serviceIDs = getServiceIDsForModuleType(moduleItem.typeID);
  if (serviceIDs.length <= 0) {
    return { success: false, errorMsg: "STRUCTURE_SERVICE_NOT_MAPPED" };
  }
  return { success: true, data: { structure, serviceIDs } };
}

module.exports = {
  STRUCTURE_SERVICE_SLOT_FLAGS,
  STRUCTURE_FUEL_FLAG,
  FUEL_BLOCK_GROUP_ID,
  SERVICE_MODULE_TYPE_SERVICES,
  isStructureServiceFlag,
  isStructureFuelFlag,
  isStructureServiceModuleType,
  isFuelCompatibleItem,
  getServiceIDsForModuleType,
  expandMetaServiceIDs,
  getStructureServiceSlotCapacity,
  getServiceModuleFuelRequirement,
  listStructureServiceModules,
  listStructureFuelItems,
  getStructureFuelQuantity,
  validateServiceModuleFit,
  consumeStructureFuel,
  consumeServiceModuleOnlineFuel,
  projectFuelExpiresAt,
  reconcileStructureServices,
  tickStructureServiceFuel,
  checkCanDisableServiceModule,
};
