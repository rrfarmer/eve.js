const path = require("path");

const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  getCharacterRecord,
  updateCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  consumeInventoryItemQuantity,
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  getCharacterBaseSkillMap,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  getRequiredSkillRequirements,
  getTypeDogmaAttributes,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  syncCharacterDogmaState,
} = require(path.join(__dirname, "./brain/characterBrainRuntime"));

const IMPLANT_CATEGORY_ID = 20;
const ATTRIBUTE_IMPLANT_SLOT = 331;
const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;
const IMPLANT_ATTRIBUTE_MODIFIER_MAP = Object.freeze({
  175: ATTRIBUTE_CHARISMA,
  176: ATTRIBUTE_INTELLIGENCE,
  177: ATTRIBUTE_MEMORY,
  178: ATTRIBUTE_PERCEPTION,
  179: ATTRIBUTE_WILLPOWER,
});
const PRIMARY_CHARACTER_ATTRIBUTE_IDS = Object.freeze([
  ATTRIBUTE_CHARISMA,
  ATTRIBUTE_INTELLIGENCE,
  ATTRIBUTE_MEMORY,
  ATTRIBUTE_PERCEPTION,
  ATTRIBUTE_WILLPOWER,
]);

function toInt(value, fallback = 0) {
  if (Buffer.isBuffer(value)) {
    return toInt(value.toString("utf8"), fallback);
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return toInt(value.value, fallback);
    }
    if (value.type === "int" || value.type === "long") {
      return toInt(value.value, fallback);
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function unwrapValue(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapValue(value.value);
    }
    if (value.type === "int" || value.type === "long") {
      return unwrapValue(value.value);
    }
    if (value.type === "list" && Array.isArray(value.items)) {
      return value.items.map((item) => unwrapValue(item));
    }
  }
  return value;
}

function normalizeIDList(rawValue) {
  const unwrapped = unwrapValue(rawValue);
  if (unwrapped === null || unwrapped === undefined) {
    return [];
  }
  const rawList = Array.isArray(unwrapped) ? unwrapped : [unwrapped];
  return rawList
    .map((value) => toInt(unwrapValue(value), 0))
    .filter((value) => value > 0);
}

function throwImplantUserError(message) {
  throwWrappedUserError("CustomNotify", {
    notify: message,
  });
}

function getImplantSlotForType(typeID) {
  const attributes = getTypeDogmaAttributes(typeID);
  return toInt(attributes[ATTRIBUTE_IMPLANT_SLOT], 0);
}

function isImplantItem(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  const typeID = toInt(item.typeID, 0);
  return (
    toInt(item.categoryID, 0) === IMPLANT_CATEGORY_ID &&
    getImplantSlotForType(typeID) > 0
  );
}

function validateRequiredSkills(characterID, typeID) {
  const skillMap = getCharacterBaseSkillMap(characterID);
  const missing = [];
  for (const requirement of getRequiredSkillRequirements(typeID)) {
    const skillTypeID = toInt(requirement && requirement.skillTypeID, 0);
    const requiredLevel = toInt(requirement && requirement.level, 1);
    const skillRecord = skillMap.get(skillTypeID);
    const currentLevel = toInt(
      skillRecord &&
        (skillRecord.effectiveSkillLevel ??
          skillRecord.trainedSkillLevel ??
          skillRecord.skillLevel),
      0,
    );
    if (skillTypeID > 0 && currentLevel < requiredLevel) {
      missing.push({
        skillTypeID,
        requiredLevel,
        currentLevel,
      });
    }
  }
  if (missing.length > 0) {
    throwImplantUserError("You do not have the required skills for this implant.");
  }
}

function buildImplantRecord(item) {
  const typeID = toInt(item && item.typeID, 0);
  const typeRecord = resolveItemByTypeID(typeID) || {};
  return {
    itemID: toInt(item && item.itemID, 0),
    typeID,
    slot: getImplantSlotForType(typeID),
    name: item.itemName || typeRecord.name || "",
    injectedAtMs: Date.now(),
  };
}

function validateImplantItem(characterID, itemID) {
  const item = findItemById(itemID);
  if (!item || toInt(item.ownerID, 0) !== toInt(characterID, 0)) {
    throwImplantUserError("That implant is no longer available.");
  }
  if (!isImplantItem(item)) {
    throwImplantUserError("That item is not an implant.");
  }
  const stackQuantity = Math.max(
    0,
    toInt(item.stacksize ?? item.quantity, item.singleton === 1 ? 1 : 0),
  );
  if (stackQuantity <= 0) {
    throwImplantUserError("That implant is no longer available.");
  }
  validateRequiredSkills(characterID, toInt(item.typeID, 0));
  return {
    item,
    implant: buildImplantRecord(item),
  };
}

function syncInventoryChangesToSession(session, changes = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change) {
      continue;
    }
    if (change.item) {
      syncInventoryItemForSession(
        session,
        change.item,
        change.previousState || change.previousData || {},
      );
    } else if (change.removed === true && change.previousData) {
      syncInventoryItemForSession(
        session,
        {
          ...change.previousData,
          locationID: 6,
        },
        change.previousData,
      );
    }
  }
}

function applyImplantAttributeModifiers(attributes = {}, implants = []) {
  const nextAttributes = { ...attributes };
  for (const implant of Array.isArray(implants) ? implants : []) {
    const typeID = toInt(implant && (implant.typeID ?? implant.itemID), 0);
    if (typeID <= 0) {
      continue;
    }
    const typeAttributes = getTypeDogmaAttributes(typeID);
    for (const [modifierAttributeID, targetAttributeID] of Object.entries(
      IMPLANT_ATTRIBUTE_MODIFIER_MAP,
    )) {
      const bonus = toFiniteNumber(typeAttributes[modifierAttributeID], 0);
      if (bonus === 0) {
        continue;
      }
      nextAttributes[targetAttributeID] =
        toFiniteNumber(nextAttributes[targetAttributeID], 0) + bonus;
    }
  }
  return nextAttributes;
}

function buildEffectivePrimaryAttributes(characterRecord = {}) {
  const source =
    characterRecord && typeof characterRecord.characterAttributes === "object"
      ? characterRecord.characterAttributes
      : {};
  return applyImplantAttributeModifiers(
    {
      [ATTRIBUTE_CHARISMA]: toFiniteNumber(
        source[ATTRIBUTE_CHARISMA] ?? source.charisma,
        20,
      ),
      [ATTRIBUTE_INTELLIGENCE]: toFiniteNumber(
        source[ATTRIBUTE_INTELLIGENCE] ?? source.intelligence,
        20,
      ),
      [ATTRIBUTE_MEMORY]: toFiniteNumber(
        source[ATTRIBUTE_MEMORY] ?? source.memory,
        20,
      ),
      [ATTRIBUTE_PERCEPTION]: toFiniteNumber(
        source[ATTRIBUTE_PERCEPTION] ?? source.perception,
        20,
      ),
      [ATTRIBUTE_WILLPOWER]: toFiniteNumber(
        source[ATTRIBUTE_WILLPOWER] ?? source.willpower,
        20,
      ),
    },
    characterRecord.implants,
  );
}

function notifyPrimaryAttributeChanges(session, characterID, previousRecord, nextRecord) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }
  const previousAttributes = buildEffectivePrimaryAttributes(previousRecord || {});
  const nextAttributes = buildEffectivePrimaryAttributes(nextRecord || {});
  for (const attributeID of PRIMARY_CHARACTER_ATTRIBUTE_IDS) {
    const previousValue = toFiniteNumber(previousAttributes[attributeID], 0);
    const nextValue = toFiniteNumber(nextAttributes[attributeID], 0);
    if (previousValue === nextValue) {
      continue;
    }
    session.sendNotification("OnDogmaAttributeChanged", "clientID", [
      characterID,
      characterID,
      attributeID,
      nextValue,
    ]);
  }
}

function injectImplantItems(characterID, rawItemIDs, session = null) {
  const itemIDs = normalizeIDList(rawItemIDs);
  if (itemIDs.length === 0) {
    return [];
  }
  if (new Set(itemIDs).size !== itemIDs.length) {
    throwImplantUserError("Duplicate implant request.");
  }

  const previousRecord = getCharacterRecord(characterID);
  if (!previousRecord) {
    throwImplantUserError("Character not found.");
  }
  const entries = itemIDs.map((itemID) => validateImplantItem(characterID, itemID));
  const requestedSlots = entries
    .map((entry) => toInt(entry && entry.implant && entry.implant.slot, 0))
    .filter((slot) => slot > 0);
  if (new Set(requestedSlots).size !== requestedSlots.length) {
    throwImplantUserError("Only one implant can be injected into each implant slot.");
  }
  const occupiedSlots = new Set(
    (Array.isArray(previousRecord.implants) ? previousRecord.implants : [])
      .map((implant) => toInt(implant && implant.slot, 0))
      .filter((slot) => slot > 0),
  );
  if (requestedSlots.some((slot) => occupiedSlots.has(slot))) {
    throwImplantUserError("That implant slot is already occupied.");
  }
  const changes = [];
  for (const entry of entries) {
    const consumeResult = consumeInventoryItemQuantity(entry.item.itemID, 1, {
      removeContents: false,
    });
    if (!consumeResult.success) {
      throwImplantUserError("That implant is no longer available.");
    }
    changes.push(...((consumeResult.data && consumeResult.data.changes) || []));
  }

  const implantsToInject = entries.map((entry) => entry.implant);
  const writeResult = updateCharacterRecord(characterID, (record) => {
    const existingImplants = Array.isArray(record.implants)
      ? record.implants.map((implant) => cloneValue(implant))
      : [];
    return {
      ...record,
      implants: [...existingImplants, ...implantsToInject].sort(
        (left, right) => toInt(left && left.slot, 0) - toInt(right && right.slot, 0),
      ),
    };
  });
  if (!writeResult.success) {
    throwImplantUserError("Failed to inject implant.");
  }

  syncInventoryChangesToSession(session, changes);
  notifyPrimaryAttributeChanges(
    session,
    characterID,
    previousRecord,
    writeResult.data,
  );
  syncCharacterDogmaState(session, characterID);
  return implantsToInject.map((implant) => implant.typeID);
}

module.exports = {
  ATTRIBUTE_CHARISMA,
  ATTRIBUTE_INTELLIGENCE,
  ATTRIBUTE_MEMORY,
  ATTRIBUTE_PERCEPTION,
  ATTRIBUTE_WILLPOWER,
  ATTRIBUTE_IMPLANT_SLOT,
  IMPLANT_CATEGORY_ID,
  applyImplantAttributeModifiers,
  buildEffectivePrimaryAttributes,
  getImplantSlotForType,
  injectImplantItems,
  isImplantItem,
  normalizeIDList,
};
