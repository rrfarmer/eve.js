/**
 * Dogma IM Service (dogmaIM)
 *
 * Handles dogma (attributes/effects) related calls.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { TABLE, readStaticTable } = require(
  path.join(__dirname, "../_shared/referenceData"),
);
const { resolveShipByTypeID } = require(
  path.join(__dirname, "../chat/shipTypeRegistry"),
);
const { getCharacterRecord, getActiveShipRecord, findCharacterShip } = require(
  path.join(__dirname, "../character/characterState"),
);
const {
  getShipConditionState,
  findItemById,
  listContainerItems,
  moveInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const { syncInventoryItemForSession } = require(
  path.join(__dirname, "../character/characterState"),
);
const { resolveModuleType } = require(
  path.join(__dirname, "../inventory/moduleTypeRegistry"),
);
const { isModuleOnline, setModuleOnline } = require(
  path.join(__dirname, "./moduleOnlineState"),
);
const { setShipDirtTimestamp } = require(
  path.join(__dirname, "../ship/shipDirtState"),
);
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  getCharacterSkills,
  getCharacterSkillPointTotal,
  SKILL_FLAG_ID,
} = require(path.join(__dirname, "../skills/skillState"));

const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;
const ATTRIBUTE_PILOT_SECURITY_STATUS = 2610;
const ATTRIBUTE_ITEM_DAMAGE = 3;
const ATTRIBUTE_MASS = 4;
const ATTRIBUTE_CAPACITY = 38;
const ATTRIBUTE_VOLUME = 161;
const ATTRIBUTE_RADIUS = 162;
const ATTRIBUTE_POWER_LOAD = 15;
const ATTRIBUTE_POWERGRID_USAGE = 30;
const ATTRIBUTE_MAX_VELOCITY_BONUS = 20;
const ATTRIBUTE_SHIELD_CAPACITY = 263;
const ATTRIBUTE_SHIELD_CHARGE_HELPER = 264;
const ATTRIBUTE_ARMOR_HP = 265;
const ATTRIBUTE_ARMOR_DAMAGE = 266;
const ATTRIBUTE_CPU_LOAD = 49;
const ATTRIBUTE_CPU_USAGE = 50;
const ATTRIBUTE_ACTIVATION_TIME_DURATION = 73;
const CHARACTER_TYPE_ID = 1373;
const CHARACTER_GROUP_ID = 1;
const CHARACTER_CATEGORY_ID = 3;
const FLAG_PILOT = 57;
const DBTYPE_I4 = 0x03;
const DBTYPE_R8 = 0x05;
const DBTYPE_BOOL = 0x0b;
const DBTYPE_I8 = 0x14;
const INSTANCE_ROW_DESCRIPTOR_COLUMNS = [
  ["instanceID", DBTYPE_I8],
  ["online", DBTYPE_BOOL],
  ["damage", DBTYPE_R8],
  ["charge", DBTYPE_R8],
  ["skillPoints", DBTYPE_I4],
  ["armorDamage", DBTYPE_R8],
  ["shieldCharge", DBTYPE_R8],
  ["incapacitated", DBTYPE_BOOL],
];
const FITTED_SLOT_FLAGS = Object.freeze([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  30, 31, 32, 33, 34, 92, 93, 94,
]);
const EFFECT_ID_ONLINE = 16;
const EFFECT_ID_MODULE_BONUS_MICROWARPDRIVE = 6730;
const ACTIVE_EFFECT_ID_BY_NAME = Object.freeze({
  modulebonusmicrowarpdrive: EFFECT_ID_MODULE_BONUS_MICROWARPDRIVE,
});
const ACTIVE_EFFECT_DEFAULT_DURATION = -1;
const ACTIVE_EFFECT_DEFAULT_REPEAT = 0;
const ACTIVE_EFFECT_DEFAULT_PROPULSION_DURATION_MS = 10000;
const ACTIVE_EFFECT_DEFAULT_MWD_SPEED_MULTIPLIER = 6;

class DogmaService extends BaseService {
  constructor() {
    super("dogmaIM");
    this._activeModuleEffects = new Map();
  }

  _coalesce(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }

  _getCharID(session) {
    return (
      (session && (session.characterID || session.charid || session.userid)) ||
      140000001
    );
  }

  _getShipID(session) {
    return (
      (session && (session.activeShipID || session.shipID || session.shipid)) ||
      140000101
    );
  }

  _getShipTypeID(session) {
    return session &&
      Number.isInteger(session.shipTypeID) &&
      session.shipTypeID > 0
      ? session.shipTypeID
      : 606;
  }

  _getShipMetadata(session) {
    const shipTypeID = this._getShipTypeID(session);
    return (
      resolveShipByTypeID(shipTypeID) || {
        typeID: shipTypeID,
        name: (session && session.shipName) || "Ship",
        groupID: 25,
        categoryID: 6,
      }
    );
  }

  _getCharacterRecord(session) {
    return getCharacterRecord(this._getCharID(session));
  }

  _getActiveShipRecord(session) {
    return getActiveShipRecord(this._getCharID(session));
  }

  _getLocationID(session) {
    return (
      (session &&
        (session.stationid ||
          session.stationID ||
          session.locationid ||
          session.solarsystemid2 ||
          session.solarsystemid)) ||
      60003760
    );
  }

  _normalizeItemID(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.trunc(numericValue) : 0;
  }

  _collectNumericCandidates(value, out, seen = new Set()) {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === "number" || typeof value === "bigint") {
      const numericValue = this._normalizeItemID(value);
      if (numericValue > 0) {
        out.push(numericValue);
      }
      return;
    }

    if (typeof value === "string" || Buffer.isBuffer(value)) {
      const numericValue = this._normalizeItemID(value);
      if (numericValue > 0) {
        out.push(numericValue);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const entry of value) {
        this._collectNumericCandidates(entry, out, seen);
      }
      return;
    }

    if (value.type === "list" && Array.isArray(value.items)) {
      for (const entry of value.items) {
        this._collectNumericCandidates(entry, out, seen);
      }
      return;
    }

    if (value.type === "dict" && Array.isArray(value.entries)) {
      for (const [key, entryValue] of value.entries) {
        this._collectNumericCandidates(key, out, seen);
        this._collectNumericCandidates(entryValue, out, seen);
      }
      return;
    }

    for (const entryValue of Object.values(value)) {
      this._collectNumericCandidates(entryValue, out, seen);
    }
  }

  _extractModuleItemID(args, session) {
    if (Array.isArray(args) && args.length > 0) {
      const directCandidate = this._normalizeItemID(args[0]);
      if (directCandidate > 0) {
        const directItem = findItemById(directCandidate);
        if (directItem && Number(directItem.categoryID || 0) === 7) {
          return directCandidate;
        }
      }
    }

    const candidates = [];
    this._collectNumericCandidates(args, candidates);

    if (candidates.length === 0) {
      return 0;
    }

    const activeShipID = this._normalizeItemID(this._getShipID(session));

    // Fast path: the module itemID is usually passed directly in args.
    // Resolve directly from item store and short-circuit without scanning
    // all fitted modules every activation/deactivation call.
    for (const candidate of candidates) {
      const itemRecord = findItemById(candidate);
      if (!itemRecord || Number(itemRecord.categoryID || 0) !== 7) {
        continue;
      }

      const isFittedFlag = FITTED_SLOT_FLAGS.includes(
        Number(itemRecord.flagID || 0),
      );
      const isOnActiveShip =
        activeShipID > 0
          ? Number(itemRecord.locationID || 0) === activeShipID
          : true;
      if (isFittedFlag && isOnActiveShip) {
        return candidate;
      }
    }

    const fittedItemIDs = new Set(
      this._getFittedItemsForShip(session).map((item) =>
        this._normalizeItemID(item.itemID),
      ),
    );
    for (const candidate of candidates) {
      if (fittedItemIDs.has(candidate)) {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      const itemRecord = findItemById(candidate);
      if (itemRecord && Number(itemRecord.categoryID) === 7) {
        return candidate;
      }
    }

    return candidates[0];
  }

  _normalizeEffectName(rawValue) {
    if (rawValue === null || rawValue === undefined) {
      return "";
    }

    if (Buffer.isBuffer(rawValue)) {
      return rawValue.toString("utf8").trim().toLowerCase();
    }

    return String(rawValue).trim().toLowerCase();
  }

  _extractEffectName(args) {
    if (!Array.isArray(args) || args.length < 2) {
      return "";
    }

    return this._normalizeEffectName(args[1]);
  }

  _extractActivationTargetID(args) {
    if (!Array.isArray(args) || args.length < 3) {
      return null;
    }

    const targetID = this._normalizeItemID(args[2]);
    return targetID > 0 ? targetID : null;
  }

  _extractActivationRepeat(args) {
    if (!Array.isArray(args) || args.length < 4) {
      return ACTIVE_EFFECT_DEFAULT_REPEAT;
    }

    const rawRepeat = args[3];
    if (typeof rawRepeat === "boolean") {
      return rawRepeat ? 1 : 0;
    }
    if (typeof rawRepeat === "number" && Number.isFinite(rawRepeat)) {
      return Math.trunc(rawRepeat);
    }
    if (rawRepeat && typeof rawRepeat === "object") {
      if (rawRepeat.type === "bool") {
        return rawRepeat.value ? 1 : 0;
      }
      if (
        (rawRepeat.type === "int" ||
          rawRepeat.type === "long" ||
          rawRepeat.type === "float" ||
          rawRepeat.type === "double") &&
        Number.isFinite(Number(rawRepeat.value))
      ) {
        return Math.trunc(Number(rawRepeat.value));
      }
    }

    return ACTIVE_EFFECT_DEFAULT_REPEAT;
  }

  _resolveActiveEffectID(effectName) {
    if (!effectName) {
      return 0;
    }

    return Number(ACTIVE_EFFECT_ID_BY_NAME[effectName] || 0);
  }

  _isMicrowarpdriveModule(itemRecord = null, moduleType = null) {
    const resolvedModuleType =
      moduleType ||
      resolveModuleType(
        itemRecord && itemRecord.typeID,
        itemRecord && itemRecord.itemName,
      );

    const primaryEffect = this._normalizeEffectName(
      resolvedModuleType && resolvedModuleType.primaryEffectName,
    );
    if (primaryEffect === "modulebonusmicrowarpdrive") {
      return true;
    }

    const moduleName = String(
      (resolvedModuleType && resolvedModuleType.name) ||
        (itemRecord && itemRecord.itemName) ||
        "",
    ).toLowerCase();
    return moduleName.includes("microwarpdrive");
  }

  _resolveModuleDurationMs(itemRecord = null, effectID = 0, moduleType = null) {
    const resolvedModuleType =
      moduleType ||
      resolveModuleType(
        itemRecord && itemRecord.typeID,
        itemRecord && itemRecord.itemName,
      );
    const durationCandidates = [
      resolvedModuleType && resolvedModuleType.activationDurationMs,
      resolvedModuleType && resolvedModuleType.durationMs,
      resolvedModuleType && resolvedModuleType.duration,
    ];

    for (const candidate of durationCandidates) {
      const durationMs = Number(candidate);
      if (Number.isFinite(durationMs) && durationMs > 0) {
        return Math.trunc(durationMs);
      }
    }

    if (
      Number(effectID) === EFFECT_ID_MODULE_BONUS_MICROWARPDRIVE ||
      this._isMicrowarpdriveModule(itemRecord, resolvedModuleType)
    ) {
      return ACTIVE_EFFECT_DEFAULT_PROPULSION_DURATION_MS;
    }

    return ACTIVE_EFFECT_DEFAULT_DURATION;
  }

  _resolveModuleSpeedMultiplier(
    itemRecord = null,
    effectID = 0,
    moduleType = null,
  ) {
    const resolvedModuleType =
      moduleType ||
      resolveModuleType(
        itemRecord && itemRecord.typeID,
        itemRecord && itemRecord.itemName,
      );
    const bonusCandidates = [
      resolvedModuleType && resolvedModuleType.maxVelocityBonusPercent,
      resolvedModuleType && resolvedModuleType.maxVelocityBonus,
      resolvedModuleType && resolvedModuleType.speedBonusPercent,
      resolvedModuleType && resolvedModuleType.speedBonus,
    ];

    for (const candidate of bonusCandidates) {
      const bonus = Number(candidate);
      if (Number.isFinite(bonus)) {
        return Math.max(0.1, Math.min(20, 1 + bonus / 100));
      }
    }

    if (
      Number(effectID) === EFFECT_ID_MODULE_BONUS_MICROWARPDRIVE ||
      this._isMicrowarpdriveModule(itemRecord, resolvedModuleType)
    ) {
      return ACTIVE_EFFECT_DEFAULT_MWD_SPEED_MULTIPLIER;
    }

    return 1;
  }

  _resolveModuleActivationProfile(itemRecord = null, effectID = 0) {
    const moduleType = resolveModuleType(
      itemRecord && itemRecord.typeID,
      itemRecord && itemRecord.itemName,
    );
    const maxVelocityBonusPercent = Number(
      moduleType && moduleType.maxVelocityBonusPercent,
    );

    return {
      moduleType,
      isMicrowarpdrive: this._isMicrowarpdriveModule(itemRecord, moduleType),
      durationMs: this._resolveModuleDurationMs(
        itemRecord,
        effectID,
        moduleType,
      ),
      speedMultiplier: this._resolveModuleSpeedMultiplier(
        itemRecord,
        effectID,
        moduleType,
      ),
      maxVelocityBonusPercent: Number.isFinite(maxVelocityBonusPercent)
        ? maxVelocityBonusPercent
        : null,
    };
  }

  _resolveEffectDuration(itemRecord = null, effectID = 0, duration = null) {
    const numericDuration = Number(duration);
    if (Number.isFinite(numericDuration) && numericDuration > 0) {
      return numericDuration;
    }

    const activationProfile = this._resolveModuleActivationProfile(
      itemRecord,
      effectID,
    );
    const profileDuration = Number(
      activationProfile && activationProfile.durationMs,
    );
    if (Number.isFinite(profileDuration) && profileDuration > 0) {
      return profileDuration;
    }

    return ACTIVE_EFFECT_DEFAULT_DURATION;
  }

  _isModuleEffectActive(itemID, effectID) {
    const numericItemID = this._normalizeItemID(itemID);
    const numericEffectID = Number(effectID || 0);
    if (numericItemID <= 0 || numericEffectID <= 0) {
      return false;
    }

    const existingEffects = this._activeModuleEffects.get(numericItemID);
    return Boolean(existingEffects && existingEffects.has(numericEffectID));
  }

  _applyMovementEffect(session, itemRecord, effectID, active) {
    if (!session || !itemRecord || Number(effectID || 0) <= 0) {
      return;
    }

    if (Number(effectID) === EFFECT_ID_MODULE_BONUS_MICROWARPDRIVE) {
      const shipID = Number(itemRecord.locationID || 0);
      const activationProfile = this._resolveModuleActivationProfile(
        itemRecord,
        effectID,
      );
      spaceRuntime.setShipSpeedMultiplier(
        session,
        shipID,
        active ? activationProfile.speedMultiplier : 1,
      );
    }
  }

  _clearSessionModuleActiveEffects(session, shipRecord = null) {
    if (!session) {
      return;
    }

    const activeShip = shipRecord || this._getActiveShipRecord(session);
    if (!activeShip) {
      return;
    }

    const fittedItems = this._getFittedItemsForShip(session, activeShip);
    for (const fittedItem of fittedItems) {
      this._clearModuleActiveEffects(fittedItem.itemID);
    }
  }

  _setModuleActiveEffectState(itemID, effectName, active, options = {}) {
    const numericItemID = this._normalizeItemID(itemID);
    if (numericItemID <= 0) {
      return 0;
    }

    const effectID = this._resolveActiveEffectID(effectName);
    if (effectID <= 0) {
      if (effectName) {
        log.debug(
          `[DogmaIM] Active effect mapping missing for itemID=${numericItemID} effect=${effectName}`,
        );
      }
      return 0;
    }

    if (!active) {
      const existingEffects = this._activeModuleEffects.get(numericItemID);
      if (!existingEffects) {
        return effectID;
      }

      existingEffects.delete(effectID);
      if (existingEffects.size === 0) {
        this._activeModuleEffects.delete(numericItemID);
      }
      log.debug(
        `[DogmaIM] Cleared active effect itemID=${numericItemID} effectID=${effectID}`,
      );
      return effectID;
    }

    let existingEffects = this._activeModuleEffects.get(numericItemID);
    if (!existingEffects) {
      existingEffects = new Map();
      this._activeModuleEffects.set(numericItemID, existingEffects);
    }

    const duration = this._resolveEffectDuration(
      options.itemRecord || null,
      effectID,
      options.duration,
    );
    const repeat = Number.isFinite(Number(options.repeat))
      ? Number(options.repeat)
      : ACTIVE_EFFECT_DEFAULT_REPEAT;
    const targetID =
      Number.isFinite(Number(options.targetID)) && Number(options.targetID) > 0
        ? Number(options.targetID)
        : null;

    existingEffects.set(effectID, {
      startedAt: this._nowFileTime(),
      duration,
      repeat,
      targetID,
    });
    log.debug(
      `[DogmaIM] Set active effect itemID=${numericItemID} effectID=${effectID}`,
    );
    return effectID;
  }

  _getStoredModuleEffectState(itemID, effectID) {
    const numericItemID = this._normalizeItemID(itemID);
    const numericEffectID = Number(effectID || 0);
    if (numericItemID <= 0 || numericEffectID <= 0) {
      return null;
    }

    const itemEffects = this._activeModuleEffects.get(numericItemID);
    if (!itemEffects || !itemEffects.has(numericEffectID)) {
      return null;
    }

    return itemEffects.get(numericEffectID) || null;
  }

  _emitGodmaShipEffect(session, itemRecord, effectID, options = {}) {
    if (
      !session ||
      typeof session.sendNotification !== "function" ||
      !itemRecord ||
      Number(effectID || 0) <= 0
    ) {
      return;
    }

    const now = this._nowFileTime();
    const start = options.start === true;
    const active = options.active === true;
    const hasExplicitStartTime = Object.prototype.hasOwnProperty.call(
      options,
      "startTime",
    );
    const startTime = hasExplicitStartTime ? options.startTime : now;
    const duration = this._resolveEffectDuration(
      itemRecord,
      effectID,
      options.duration,
    );
    const repeat = Number.isFinite(Number(options.repeat))
      ? Number(options.repeat)
      : ACTIVE_EFFECT_DEFAULT_REPEAT;
    const targetID =
      Number.isFinite(Number(options.targetID)) && Number(options.targetID) > 0
        ? Number(options.targetID)
        : null;

    const environment = [
      Number(itemRecord.itemID || 0),
      Number(itemRecord.ownerID || 0),
      Number(itemRecord.locationID || 0),
      targetID,
      null,
      null,
      Number(effectID),
    ];

    log.debug(
      `[DogmaIM] Emit OnGodmaShipEffect itemID=${Number(itemRecord.itemID || 0)} effectID=${Number(effectID)} start=${start} active=${active} duration=${duration} repeat=${repeat}`,
    );

    session.sendNotification("OnGodmaShipEffect", "charid", [
      Number(itemRecord.itemID || 0),
      Number(effectID),
      now,
      start,
      active,
      environment,
      startTime,
      duration,
      repeat,
      null,
    ]);
  }

  _clearModuleActiveEffects(itemID) {
    const numericItemID = this._normalizeItemID(itemID);
    if (numericItemID <= 0) {
      return;
    }

    this._activeModuleEffects.delete(numericItemID);
  }

  _nowFileTime() {
    return BigInt(Date.now()) * 10000n + 116444736000000000n;
  }

  _toBoolArg(value, fallback = true) {
    if (value === undefined) {
      return fallback;
    }

    if (value === null) {
      return fallback;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    if (typeof value === "object") {
      if (value.type === "bool") {
        return Boolean(value.value);
      }

      if (value.type === "none") {
        return fallback;
      }
    }

    return fallback;
  }

  _buildInvRow({
    itemID,
    typeID,
    ownerID,
    locationID,
    flagID,
    groupID,
    categoryID,
    quantity = -1,
    singleton = 1,
    stacksize = 1,
    customInfo = "",
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          [
            "header",
            [
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
          ],
          [
            "line",
            [
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
            ],
          ],
        ],
      },
    };
  }

  _buildCommonGetInfoEntry({
    itemID,
    typeID,
    ownerID,
    locationID,
    flagID,
    groupID,
    categoryID,
    quantity = -1,
    singleton = 1,
    stacksize = 1,
    customInfo = "",
    description,
    attributes = null,
    activeEffects = null,
  }) {
    const invItem = this._buildInvRow({
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      groupID,
      categoryID,
      quantity,
      singleton,
      stacksize,
      customInfo,
    });
    const now = this._nowFileTime();

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
          ["groupID", groupID],
          ["categoryID", categoryID],
          ["quantity", quantity],
          ["singleton", singleton],
          ["stacksize", stacksize],
          ["customInfo", customInfo],
          ["invItem", invItem],
          ["activeEffects", activeEffects || { type: "dict", entries: [] }],
          ["attributes", attributes || { type: "dict", entries: [] }],
          ["description", description || ""],
          ["time", now],
          ["wallclockTime", now],
        ],
      },
    };
  }

  _buildStatusRow({
    itemID,
    online = false,
    damage = 0.0,
    charge = 0.0,
    skillPoints = 0,
    armorDamage = 0.0,
    shieldCharge = 0.0,
    incapacitated = false,
  }) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          [
            "header",
            [
              "instanceID",
              "online",
              "damage",
              "charge",
              "skillPoints",
              "armorDamage",
              "shieldCharge",
              "incapacitated",
            ],
          ],
          [
            "line",
            [
              itemID,
              online,
              damage,
              charge,
              skillPoints,
              armorDamage,
              shieldCharge,
              incapacitated,
            ],
          ],
        ],
      },
    };
  }

  _buildInstanceRowDescriptor() {
    return {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [INSTANCE_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    };
  }

  _buildPackedInstanceRow({
    itemID,
    online = false,
    damage = 0.0,
    charge = 0.0,
    skillPoints = 0,
    armorDamage = 0.0,
    shieldCharge = 0.0,
    incapacitated = false,
  }) {
    return {
      type: "packedrow",
      header: this._buildInstanceRowDescriptor(),
      columns: INSTANCE_ROW_DESCRIPTOR_COLUMNS,
      fields: {
        instanceID: itemID,
        online,
        damage,
        charge,
        skillPoints,
        armorDamage,
        shieldCharge,
        incapacitated,
      },
    };
  }

  _buildCharacterAttributes(charData = {}) {
    const source = charData.characterAttributes || {};
    const securityStatus = Number(
      charData.securityStatus ??
        charData.securityRating ??
        source.securityStatus ??
        0,
    );
    return {
      [ATTRIBUTE_CHARISMA]: Number(
        source[ATTRIBUTE_CHARISMA] ?? source.charisma ?? 20,
      ),
      [ATTRIBUTE_INTELLIGENCE]: Number(
        source[ATTRIBUTE_INTELLIGENCE] ?? source.intelligence ?? 20,
      ),
      [ATTRIBUTE_MEMORY]: Number(
        source[ATTRIBUTE_MEMORY] ?? source.memory ?? 20,
      ),
      [ATTRIBUTE_PERCEPTION]: Number(
        source[ATTRIBUTE_PERCEPTION] ?? source.perception ?? 20,
      ),
      [ATTRIBUTE_WILLPOWER]: Number(
        source[ATTRIBUTE_WILLPOWER] ?? source.willpower ?? 20,
      ),
      [ATTRIBUTE_PILOT_SECURITY_STATUS]: Number.isFinite(securityStatus)
        ? securityStatus
        : 0,
    };
  }

  _buildCharacterAttributeDict(charData = {}) {
    const attributes = this._buildCharacterAttributes(charData);
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        value,
      ]),
    };
  }

  _buildShipAttributes(charData = {}, shipData = {}) {
    const securityStatus = Number(
      charData.securityStatus ??
        charData.securityRating ??
        shipData.securityStatus ??
        shipData.securityRating ??
        0,
    );

    const payload = readStaticTable(TABLE.SHIP_DOGMA_ATTRIBUTES);
    const shipTypeID = Number(shipData.typeID);
    const staticEntry =
      Number.isInteger(shipTypeID) &&
      payload &&
      payload.shipAttributesByTypeID &&
      typeof payload.shipAttributesByTypeID === "object"
        ? payload.shipAttributesByTypeID[String(shipTypeID)] || null
        : null;
    const staticAttributes =
      staticEntry &&
      staticEntry.attributes &&
      typeof staticEntry.attributes === "object"
        ? staticEntry.attributes
        : null;
    const shipCondition = getShipConditionState(shipData);
    const shipMetadata =
      Number.isInteger(shipTypeID) && shipTypeID > 0
        ? resolveShipByTypeID(shipTypeID)
        : null;

    const attributes = staticAttributes
      ? Object.fromEntries(
          Object.entries(staticAttributes)
            .map(([attributeID, value]) => [Number(attributeID), Number(value)])
            .filter(
              ([attributeID, value]) =>
                Number.isInteger(attributeID) && Number.isFinite(value),
            ),
        )
      : {};

    const resolvedMass = Number(
      shipData.mass ?? (shipMetadata && shipMetadata.mass),
    );
    if (!(ATTRIBUTE_MASS in attributes) && Number.isFinite(resolvedMass)) {
      attributes[ATTRIBUTE_MASS] = resolvedMass;
    }

    const resolvedCapacity = Number(
      shipData.capacity ?? (shipMetadata && shipMetadata.capacity),
    );
    if (
      !(ATTRIBUTE_CAPACITY in attributes) &&
      Number.isFinite(resolvedCapacity)
    ) {
      attributes[ATTRIBUTE_CAPACITY] = resolvedCapacity;
    }

    let cpuLoad = 0;
    let powerLoad = 0;
    const fittedItems = shipData.fittedItems || [];
    for (const fittedItem of fittedItems) {
      if (!this._isModuleOnline(fittedItem.itemID, fittedItem)) {
        continue;
      }

      const moduleType = resolveModuleType(
        fittedItem.typeID,
        fittedItem.itemName,
      );
      if (!moduleType) {
        continue;
      }

      const cpuUsage = Number(moduleType.cpuUsage);
      if (Number.isFinite(cpuUsage) && cpuUsage > 0) {
        cpuLoad += cpuUsage;
      }

      const powerUsage = Number(moduleType.powerUsage);
      if (Number.isFinite(powerUsage) && powerUsage > 0) {
        powerLoad += powerUsage;
      }
    }
    attributes[ATTRIBUTE_CPU_LOAD] = cpuLoad;
    attributes[ATTRIBUTE_POWER_LOAD] = powerLoad;

    const resolvedVolume = Number(
      shipData.volume ?? (shipMetadata && shipMetadata.volume),
    );
    if (!(ATTRIBUTE_VOLUME in attributes) && Number.isFinite(resolvedVolume)) {
      attributes[ATTRIBUTE_VOLUME] = resolvedVolume;
    }

    const resolvedRadius = Number(
      shipData.radius ?? (shipMetadata && shipMetadata.radius),
    );
    if (!(ATTRIBUTE_RADIUS in attributes) && Number.isFinite(resolvedRadius)) {
      attributes[ATTRIBUTE_RADIUS] = resolvedRadius;
    }

    const shieldCapacity = Number(attributes[ATTRIBUTE_SHIELD_CAPACITY]);
    if (
      Number.isFinite(shieldCapacity) &&
      shieldCapacity >= 0 &&
      Number.isFinite(shipCondition.shieldCharge)
    ) {
      attributes[ATTRIBUTE_SHIELD_CHARGE_HELPER] = Number(
        (shieldCapacity * shipCondition.shieldCharge).toFixed(6),
      );
    }

    const armorHP = Number(attributes[ATTRIBUTE_ARMOR_HP]);
    if (
      Number.isFinite(armorHP) &&
      armorHP >= 0 &&
      Number.isFinite(shipCondition.armorDamage)
    ) {
      attributes[ATTRIBUTE_ARMOR_DAMAGE] = Number(
        (armorHP * shipCondition.armorDamage).toFixed(6),
      );
    }

    if (Number.isFinite(shipCondition.damage)) {
      attributes[ATTRIBUTE_ITEM_DAMAGE] = shipCondition.damage;
    }

    attributes[ATTRIBUTE_PILOT_SECURITY_STATUS] = Number.isFinite(
      securityStatus,
    )
      ? securityStatus
      : 0;

    return {
      ...attributes,
      [ATTRIBUTE_PILOT_SECURITY_STATUS]: Number.isFinite(securityStatus)
        ? securityStatus
        : 0,
    };
  }

  _buildShipAttributeDict(charData = {}, shipData = {}) {
    const attributes = this._buildShipAttributes(charData, shipData);
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        value,
      ]),
    };
  }

  _buildGenericItemAttributeDict(itemRecord = {}) {
    const entries = [];
    const itemDamage = Number(itemRecord.itemDamage ?? itemRecord.damage);
    if (Number.isFinite(itemDamage)) {
      entries.push([ATTRIBUTE_ITEM_DAMAGE, itemDamage]);
    }

    const moduleType = resolveModuleType(
      itemRecord.typeID,
      itemRecord.itemName,
    );
    if (moduleType) {
      const cpuUsage = Number(moduleType.cpuUsage);
      if (Number.isFinite(cpuUsage) && cpuUsage > 0) {
        entries.push([ATTRIBUTE_CPU_USAGE, cpuUsage]);
      }

      const powerUsage = Number(moduleType.powerUsage);
      if (Number.isFinite(powerUsage) && powerUsage > 0) {
        entries.push([ATTRIBUTE_POWERGRID_USAGE, powerUsage]);
      }

      const activationProfile =
        this._resolveModuleActivationProfile(itemRecord);
      if (
        activationProfile.isMicrowarpdrive &&
        Number.isFinite(Number(activationProfile.durationMs)) &&
        Number(activationProfile.durationMs) > 0
      ) {
        entries.push([
          ATTRIBUTE_ACTIVATION_TIME_DURATION,
          Number(activationProfile.durationMs),
        ]);
      }

      if (
        activationProfile.isMicrowarpdrive &&
        Number.isFinite(Number(activationProfile.maxVelocityBonusPercent))
      ) {
        entries.push([
          ATTRIBUTE_MAX_VELOCITY_BONUS,
          Number(activationProfile.maxVelocityBonusPercent),
        ]);
      }
    }

    return {
      type: "dict",
      entries,
    };
  }

  _buildModuleActiveEffects(itemRecord = null) {
    if (!itemRecord || !this._isModuleOnline(itemRecord.itemID, itemRecord)) {
      return {
        type: "dict",
        entries: [],
      };
    }

    const numericItemID = this._normalizeItemID(itemRecord.itemID);
    const entries = [[EFFECT_ID_ONLINE, this._nowFileTime()]];
    const activeEffects = this._activeModuleEffects.get(numericItemID);
    if (activeEffects) {
      for (const [effectID, effectState] of activeEffects.entries()) {
        if (Number(effectID) === EFFECT_ID_ONLINE) {
          continue;
        }

        const startedAt =
          effectState &&
          typeof effectState === "object" &&
          Object.prototype.hasOwnProperty.call(effectState, "startedAt")
            ? effectState.startedAt
            : effectState;
        const duration = this._resolveEffectDuration(
          itemRecord,
          Number(effectID),
          effectState && typeof effectState === "object"
            ? effectState.duration
            : null,
        );
        const repeat =
          effectState &&
          typeof effectState === "object" &&
          Number.isFinite(Number(effectState.repeat))
            ? Number(effectState.repeat)
            : ACTIVE_EFFECT_DEFAULT_REPEAT;
        const targetID =
          effectState &&
          typeof effectState === "object" &&
          Number.isFinite(Number(effectState.targetID))
            ? Number(effectState.targetID)
            : null;

        // V23.02 godma.RefreshItemEffects indexes d[7..9] from activeEffects
        // values, expecting a 10-slot payload:
        // [self,char,ship,target,other,area,effect,start,duration,repeat]
        entries.push([
          Number(effectID),
          [
            Number(itemRecord.itemID || 0),
            Number(itemRecord.ownerID || 0),
            Number(itemRecord.locationID || 0),
            targetID,
            null,
            null,
            Number(effectID),
            duration > 0 ? null : startedAt || this._nowFileTime(),
            duration,
            repeat,
          ],
        ]);
      }
    }

    return {
      type: "dict",
      entries,
    };
  }

  _buildFittedItemInfoEntry(itemRecord, session) {
    if (!itemRecord) {
      return null;
    }

    const charID = this._getCharID(session);
    return this._buildCommonGetInfoEntry({
      itemID: itemRecord.itemID,
      typeID: itemRecord.typeID,
      ownerID: itemRecord.ownerID || charID,
      locationID: this._coalesce(
        itemRecord.locationID,
        this._getLocationID(session),
      ),
      flagID: this._coalesce(itemRecord.flagID, 0),
      groupID: itemRecord.groupID,
      categoryID: itemRecord.categoryID,
      quantity:
        itemRecord.quantity === undefined || itemRecord.quantity === null
          ? itemRecord.singleton
            ? -1
            : 1
          : itemRecord.quantity,
      singleton:
        itemRecord.singleton === undefined || itemRecord.singleton === null
          ? 0
          : itemRecord.singleton,
      stacksize:
        itemRecord.stacksize === undefined || itemRecord.stacksize === null
          ? 1
          : itemRecord.stacksize,
      customInfo: itemRecord.customInfo || "",
      description: itemRecord.itemName || "item",
      attributes: this._buildGenericItemAttributeDict(itemRecord),
      activeEffects: this._buildModuleActiveEffects(itemRecord),
    });
  }

  _buildShipInfoEntries(session, shipID, shipInfoEntry, fittedItems = []) {
    const entries = [];
    if (shipInfoEntry) {
      entries.push([shipID, shipInfoEntry]);
    }

    for (const fittedItem of fittedItems) {
      const fittedEntry = this._buildFittedItemInfoEntry(fittedItem, session);
      if (!fittedEntry) {
        continue;
      }

      entries.push([fittedItem.itemID, fittedEntry]);
    }

    return entries;
  }

  _buildAttributeValueDict(attributes = {}) {
    return {
      type: "dict",
      entries: Object.entries(attributes).map(([attributeID, value]) => [
        Number(attributeID),
        value,
      ]),
    };
  }

  _buildShipBaseAttributes(shipData = {}) {
    const payload = readStaticTable(TABLE.SHIP_DOGMA_ATTRIBUTES);
    const shipTypeID = Number(shipData.typeID);
    const staticEntry =
      Number.isInteger(shipTypeID) &&
      payload &&
      payload.shipAttributesByTypeID &&
      typeof payload.shipAttributesByTypeID === "object"
        ? payload.shipAttributesByTypeID[String(shipTypeID)] || null
        : null;
    const staticAttributes =
      staticEntry &&
      staticEntry.attributes &&
      typeof staticEntry.attributes === "object"
        ? staticEntry.attributes
        : null;

    const attributes = staticAttributes
      ? Object.fromEntries(
          Object.entries(staticAttributes)
            .map(([attributeID, value]) => [Number(attributeID), Number(value)])
            .filter(
              ([attributeID, value]) =>
                Number.isInteger(attributeID) && Number.isFinite(value),
            ),
        )
      : {};

    const shipMetadata =
      Number.isInteger(shipTypeID) && shipTypeID > 0
        ? resolveShipByTypeID(shipTypeID)
        : null;

    const resolvedMass = Number(
      shipData.mass ?? (shipMetadata && shipMetadata.mass),
    );
    if (!(ATTRIBUTE_MASS in attributes) && Number.isFinite(resolvedMass)) {
      attributes[ATTRIBUTE_MASS] = resolvedMass;
    }

    const resolvedCapacity = Number(
      shipData.capacity ?? (shipMetadata && shipMetadata.capacity),
    );
    if (
      !(ATTRIBUTE_CAPACITY in attributes) &&
      Number.isFinite(resolvedCapacity)
    ) {
      attributes[ATTRIBUTE_CAPACITY] = resolvedCapacity;
    }

    const resolvedVolume = Number(
      shipData.volume ?? (shipMetadata && shipMetadata.volume),
    );
    if (!(ATTRIBUTE_VOLUME in attributes) && Number.isFinite(resolvedVolume)) {
      attributes[ATTRIBUTE_VOLUME] = resolvedVolume;
    }

    const resolvedRadius = Number(
      shipData.radius ?? (shipMetadata && shipMetadata.radius),
    );
    if (!(ATTRIBUTE_RADIUS in attributes) && Number.isFinite(resolvedRadius)) {
      attributes[ATTRIBUTE_RADIUS] = resolvedRadius;
    }

    return attributes;
  }

  _resolveItemAttributeContext(requestedItemID, session) {
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const tupleItemID = Array.isArray(requestedItemID)
      ? requestedItemID[0]
      : requestedItemID;
    const numericItemID =
      Number.parseInt(String(tupleItemID), 10) || this._getShipID(session);
    const skillRecord =
      getCharacterSkills(charID).find(
        (skill) =>
          skill.itemID === numericItemID ||
          skill.itemID === Number.parseInt(String(requestedItemID), 10),
      ) || null;

    if (numericItemID === charID) {
      const attributes = this._buildCharacterAttributes(charData);
      return {
        itemID: charID,
        typeID: Number(charData.typeID || CHARACTER_TYPE_ID),
        attributes,
        baseAttributes: { ...attributes },
      };
    }

    if (skillRecord) {
      return {
        itemID: skillRecord.itemID,
        typeID: Number(skillRecord.typeID),
        attributes: {},
        baseAttributes: {},
      };
    }

    const shipRecord =
      findCharacterShip(charID, numericItemID) ||
      this._getActiveShipRecord(session) ||
      this._getShipMetadata(session);
    const attributes = this._buildShipAttributes(charData, shipRecord || {});
    return {
      itemID:
        shipRecord && shipRecord.itemID ? shipRecord.itemID : numericItemID,
      typeID: Number(shipRecord && shipRecord.typeID),
      attributes,
      baseAttributes: this._buildShipBaseAttributes(shipRecord || {}),
    };
  }

  _formatDebugValue(value, fallback = "[n/a]") {
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return fallback;
      }
      return String(value);
    }
    if (typeof value === "boolean") {
      return value ? "True" : "False";
    }
    return String(value);
  }

  _buildEmptyDict() {
    return { type: "dict", entries: [] };
  }

  _buildEmptyList() {
    return { type: "list", items: [] };
  }

  _buildModuleChargeCache(fittedItems = []) {
    // Keep a charge slot entry for each fitted module. The client's HUD slot
    // setup distinguishes "no charge loaded" from "no cache entry".
    return {
      type: "dict",
      entries: fittedItems.map((item) => [item.itemID, null]),
    };
  }

  _buildWeaponBankCache(fittedItems = []) {
    return {
      type: "dict",
      entries: fittedItems
        .filter(
          (item) =>
            Number(item.flagID || 0) >= 27 && Number(item.flagID || 0) <= 34,
        )
        .map((item) => [item.itemID, null]),
    };
  }

  _buildActivationState(charID, shipID, shipRecord = null, fittedItems = []) {
    // The live 23.02 client build in use here still expects a 4-slot
    // shipState tuple during MakeShipActive on station boarding/login paths.
    // Keep the fourth slot as an empty reserved payload for compatibility.
    return [
      this._buildShipState(charID, shipID, shipRecord, fittedItems),
      this._buildModuleChargeCache(fittedItems),
      this._buildWeaponBankCache(fittedItems),
      this._buildEmptyDict(),
    ];
  }

  _getFittedItemsForShip(session, shipRecord = null) {
    const activeShip = shipRecord || this._getActiveShipRecord(session);
    const shipID =
      activeShip && (activeShip.itemID || activeShip.shipID)
        ? Number(activeShip.itemID || activeShip.shipID)
        : this._getShipID(session);
    const charID = this._getCharID(session);
    const seen = new Set();
    const fittedItems = [];

    for (const slotFlag of FITTED_SLOT_FLAGS) {
      const slotItems = listContainerItems(charID, shipID, slotFlag);
      for (const item of slotItems) {
        if (!item || seen.has(item.itemID)) {
          continue;
        }

        seen.add(item.itemID);
        fittedItems.push(item);
      }
    }

    return fittedItems.sort((left, right) => {
      if ((left.flagID || 0) !== (right.flagID || 0)) {
        return (left.flagID || 0) - (right.flagID || 0);
      }

      return (left.itemID || 0) - (right.itemID || 0);
    });
  }

  _isModuleOnline(itemID, fallbackItem = null) {
    const numericItemID = this._normalizeItemID(itemID);
    if (numericItemID <= 0) {
      return false;
    }

    const itemRecord = fallbackItem || findItemById(numericItemID);
    if (!itemRecord) {
      return false;
    }

    return (
      isModuleOnline(
        numericItemID,
        FITTED_SLOT_FLAGS.includes(Number(itemRecord.flagID || 0)),
      ) && FITTED_SLOT_FLAGS.includes(Number(itemRecord.flagID || 0))
    );
  }

  _repairFittedModuleLocation(session, itemRecord) {
    if (!itemRecord) {
      return null;
    }

    const numericFlagID = Number(itemRecord.flagID || 0);
    if (!FITTED_SLOT_FLAGS.includes(numericFlagID)) {
      return itemRecord;
    }

    const activeShipID = this._normalizeItemID(this._getShipID(session));
    const itemLocationID = this._normalizeItemID(itemRecord.locationID);
    if (activeShipID <= 0 || itemLocationID === activeShipID) {
      return itemRecord;
    }

    const moveResult = moveInventoryItem(itemRecord.itemID, {
      locationID: activeShipID,
      flagID: numericFlagID,
      singleton: 1,
    });
    if (!moveResult.success) {
      log.warn(
        `[DogmaIM] Failed to repair fitted module location itemID=${itemRecord.itemID} from=${itemLocationID} to=${activeShipID}: ${moveResult.errorMsg}`,
      );
      return itemRecord;
    }

    return moveResult.data;
  }

  _setModuleOnlineState(itemID, online, session) {
    const numericItemID = this._normalizeItemID(itemID);
    if (numericItemID <= 0) {
      return null;
    }

    const storedItem = findItemById(numericItemID);
    if (!storedItem) {
      return null;
    }

    const itemRecord = this._repairFittedModuleLocation(session, storedItem);
    if (!itemRecord) {
      return null;
    }

    const isFitted = FITTED_SLOT_FLAGS.includes(Number(itemRecord.flagID || 0));
    if (!isFitted) {
      log.debug(
        `[DogmaIM] Ignoring module ${online ? "online" : "offline"} request for non-fitted item itemID=${numericItemID} flagID=${String(itemRecord.flagID)} locationID=${String(itemRecord.locationID)}`,
      );
      return null;
    }

    setModuleOnline(numericItemID, online);
    if (!online) {
      this._clearModuleActiveEffects(numericItemID);
    }
    setShipDirtTimestamp(itemRecord.locationID);
    return itemRecord;
  }

  _refreshModuleItem(session, itemRecord) {
    if (!itemRecord || !session) {
      return;
    }

    // Force a non-location diff so invCache/godma reliably process OnItemChange
    // for effect-state updates (activeEffects/duration), even when the module
    // did not move and no fitting fields changed.
    const numericSingleton = Number(itemRecord.singleton || 0);
    const forcedPreviousSingleton = numericSingleton === 1 ? 0 : 1;

    syncInventoryItemForSession(
      session,
      itemRecord,
      {
        locationID: itemRecord.locationID,
        flagID: itemRecord.flagID,
        quantity: itemRecord.quantity,
        singleton: forcedPreviousSingleton,
        stacksize: itemRecord.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    // Force a ship cache touch so fitting bars (CPU/PG) are recomputed on
    // client side right after online/offline transitions.
    const activeShip = this._getActiveShipRecord(session);
    if (
      activeShip &&
      Number(activeShip.itemID || 0) > 0 &&
      Number(activeShip.itemID || 0) === Number(itemRecord.locationID || 0)
    ) {
      syncInventoryItemForSession(
        session,
        activeShip,
        {
          locationID: activeShip.locationID,
          flagID: activeShip.flagID,
          quantity: activeShip.quantity,
          singleton: activeShip.singleton,
          stacksize: activeShip.stacksize,
        },
        {
          emitCfgLocation: false,
        },
      );
    }
  }

  _getCharacterItemLocationID(session, options = {}) {
    const allowShipLocation = options.allowShipLocation !== false;
    if (
      !allowShipLocation ||
      (session && session._deferredDockedShipSessionChange)
    ) {
      return this._getLocationID(session);
    }

    return this._getShipID(session);
  }

  _buildCharacterInfoDict(charID, charData, locationID) {
    return {
      type: "dict",
      entries: this._buildCharacterInfoEntries(charID, charData, locationID),
    };
  }

  _buildCharacterInfoEntries(charID, charData, locationID) {
    return [
      [
        charID,
        this._buildCommonGetInfoEntry({
          itemID: charID,
          typeID: charData.typeID || CHARACTER_TYPE_ID,
          ownerID: charID,
          locationID,
          flagID: FLAG_PILOT,
          groupID: CHARACTER_GROUP_ID,
          categoryID: CHARACTER_CATEGORY_ID,
          quantity: -1,
          singleton: 1,
          stacksize: 1,
          description: "character",
          attributes: this._buildCharacterAttributeDict(charData),
        }),
      ],
    ];
  }

  _buildCharacterBrain() {
    // V23.02 treats the brain as a versioned tuple with at least two payload
    // collections. During login it rewrites this to (-1, ...) and later unpacks
    // it again in ApplyBrainEffects/RemoveBrainEffects. Empirically this client
    // unpacks four slots from the stored brain, so keep all collections present
    // even when they are empty.
    return [0, [], [], []];
  }

  _buildShipState(charID, shipID, shipRecord = null) {
    const shipCondition = getShipConditionState(shipRecord);
    return {
      type: "dict",
      entries: [
        [
          shipID,
          this._buildPackedInstanceRow({
            itemID: shipID,
            damage: shipCondition.damage,
            charge: shipCondition.charge,
            armorDamage: shipCondition.armorDamage,
            shieldCharge: shipCondition.shieldCharge,
            incapacitated: shipCondition.incapacitated,
          }),
        ],
        [
          charID,
          this._buildPackedInstanceRow({
            itemID: charID,
            online: true,
            skillPoints: getCharacterSkillPointTotal(charID) || 0,
          }),
        ],
      ],
    };
  }

  _buildShipDogmaSyncPayload(session) {
    const payload = this.Handle_GetAllInfo([false, true], session);
    return payload || this._buildEmptyDict();
  }

  Handle_GetCharacterAttributes(args, session) {
    log.debug("[DogmaIM] GetCharacterAttributes");
    return this._buildCharacterAttributeDict(
      this._getCharacterRecord(session) || {},
    );
  }

  Handle_ShipOnlineModules(args, session) {
    log.debug("[DogmaIM] ShipOnlineModules");
    const shipID = args && args.length > 0 ? args[0] : null;
    const activeShip =
      shipID && Number.isFinite(Number(shipID))
        ? findCharacterShip(this._getCharID(session), Number(shipID))
        : this._getActiveShipRecord(session);
    const fittedItems = this._getFittedItemsForShip(session, activeShip);
    return {
      type: "list",
      items: fittedItems
        .filter((item) => this._isModuleOnline(item.itemID, item))
        .map((item) => item.itemID),
    };
  }

  Handle_SetModuleOnline(args, session) {
    const itemID = this._extractModuleItemID(args, session);
    const itemRecord = this._setModuleOnlineState(itemID, true, session);
    log.debug(
      `[DogmaIM] SetModuleOnline(itemID=${String(itemID)}) -> ${itemRecord ? "OK" : "NOT_FITTED_OR_NOT_FOUND"}`,
    );
    if (itemRecord) {
      this._refreshModuleItem(session, itemRecord);
      return this._buildShipDogmaSyncPayload(session);
    }
    return this._buildEmptyDict();
  }

  Handle_SetModuleOffline(args, session) {
    const itemID = this._extractModuleItemID(args, session);
    const itemRecord = this._setModuleOnlineState(itemID, false, session);
    log.debug(
      `[DogmaIM] SetModuleOffline(itemID=${String(itemID)}) -> ${itemRecord ? "OK" : "NOT_FITTED_OR_NOT_FOUND"}`,
    );
    if (itemRecord) {
      const activationProfile =
        this._resolveModuleActivationProfile(itemRecord);
      const effectID = activationProfile.isMicrowarpdrive
        ? EFFECT_ID_MODULE_BONUS_MICROWARPDRIVE
        : 0;
      const previousEffectState = this._getStoredModuleEffectState(
        itemRecord.itemID,
        effectID,
      );
      this._applyMovementEffect(session, itemRecord, effectID, false);
      this._emitGodmaShipEffect(session, itemRecord, effectID, {
        start: false,
        active: false,
        startTime: previousEffectState && previousEffectState.startedAt,
        duration: previousEffectState && previousEffectState.duration,
        repeat: previousEffectState && previousEffectState.repeat,
        targetID: previousEffectState && previousEffectState.targetID,
      });
      this._refreshModuleItem(session, itemRecord);
      return this._buildShipDogmaSyncPayload(session);
    }
    return this._buildEmptyDict();
  }

  Handle_TakeModuleOnline(args, session) {
    return this.Handle_SetModuleOnline(args, session);
  }

  Handle_TakeModuleOffline(args, session) {
    return this.Handle_SetModuleOffline(args, session);
  }

  Handle_Activate(args, session) {
    const itemID = this._extractModuleItemID(args, session);
    const effectName = this._extractEffectName(args);
    if (session && (session.stationid || session.stationID)) {
      log.debug(
        `[DogmaIM] Activate(itemID=${String(itemID)}, effect=${effectName || "unknown"}) ignored while docked`,
      );
      return null;
    }
    const itemRecord = this._setModuleOnlineState(itemID, true, session);
    log.debug(
      `[DogmaIM] Activate(itemID=${String(itemID)}, effect=${effectName || "unknown"}) -> ${itemRecord ? "OK" : "NOT_FITTED_OR_NOT_FOUND"}`,
    );
    if (itemRecord) {
      const effectID = this._resolveActiveEffectID(effectName);
      const isAlreadyActive = this._isModuleEffectActive(
        itemRecord.itemID,
        effectID,
      );
      if (isAlreadyActive) {
        const previousEffectState = this._getStoredModuleEffectState(
          itemRecord.itemID,
          effectID,
        );
        this._setModuleActiveEffectState(itemRecord.itemID, effectName, false);
        this._applyMovementEffect(session, itemRecord, effectID, false);
        this._emitGodmaShipEffect(session, itemRecord, effectID, {
          start: false,
          active: false,
          startTime: previousEffectState && previousEffectState.startedAt,
          duration: previousEffectState && previousEffectState.duration,
          repeat: previousEffectState && previousEffectState.repeat,
          targetID: previousEffectState && previousEffectState.targetID,
        });
      } else {
        const activationProfile = this._resolveModuleActivationProfile(
          itemRecord,
          effectID,
        );
        const requestedRepeat = this._extractActivationRepeat(args);
        const repeat =
          activationProfile.isMicrowarpdrive && requestedRepeat === 0
            ? 1
            : requestedRepeat;
        const duration = activationProfile.durationMs;
        const targetID = this._extractActivationTargetID(args);
        this._setModuleActiveEffectState(itemRecord.itemID, effectName, true, {
          duration,
          repeat,
          targetID,
          itemRecord,
        });
        this._applyMovementEffect(session, itemRecord, effectID, true);
        const activeEffectState = this._getStoredModuleEffectState(
          itemRecord.itemID,
          effectID,
        );
        this._emitGodmaShipEffect(session, itemRecord, effectID, {
          start: true,
          active: true,
          startTime: null,
          duration:
            (activeEffectState && activeEffectState.duration) !== undefined
              ? activeEffectState.duration
              : duration,
          repeat:
            (activeEffectState && activeEffectState.repeat) !== undefined
              ? activeEffectState.repeat
              : repeat,
          targetID:
            (activeEffectState && activeEffectState.targetID) !== undefined
              ? activeEffectState.targetID
              : targetID,
        });
      }
      return null;
    }
    return null;
  }

  Handle_Deactivate(args, session) {
    const itemID = this._extractModuleItemID(args, session);
    const effectName = this._extractEffectName(args);
    const storedItem = findItemById(itemID);
    const itemRecord = this._repairFittedModuleLocation(session, storedItem);
    const isFitted =
      itemRecord && FITTED_SLOT_FLAGS.includes(Number(itemRecord.flagID || 0));
    log.debug(
      `[DogmaIM] Deactivate(itemID=${String(itemID)}, effect=${effectName || "unknown"}) -> ${isFitted ? "OK" : "NOT_FITTED_OR_NOT_FOUND"}`,
    );
    if (isFitted) {
      const resolvedEffectID = this._resolveActiveEffectID(effectName);
      const previousEffectState = this._getStoredModuleEffectState(
        itemRecord.itemID,
        resolvedEffectID,
      );
      const effectID = this._setModuleActiveEffectState(
        itemRecord.itemID,
        effectName,
        false,
      );
      this._applyMovementEffect(session, itemRecord, effectID, false);
      this._emitGodmaShipEffect(session, itemRecord, effectID, {
        start: false,
        active: false,
        startTime: previousEffectState && previousEffectState.startedAt,
        duration: previousEffectState && previousEffectState.duration,
        repeat: previousEffectState && previousEffectState.repeat,
        targetID: previousEffectState && previousEffectState.targetID,
      });
      return null;
    }
    return null;
  }

  Handle_UnloadAmmo(args, session) {
    const itemID = this._extractModuleItemID(args, session);
    log.debug(`[DogmaIM] UnloadAmmo(itemID=${String(itemID)})`);
    return null;
  }

  Handle_UnloadChargeToContainer(args, session) {
    return this.Handle_UnloadAmmo(args, session);
  }

  Handle_ShipOnlineModules(args, session) {
    log.debug("[DogmaIM] ShipOnlineModules");
    return { type: "list", items: [] };
  }

  Handle_GetTargets() {
    log.debug("[DogmaIM] GetTargets");
    return { type: "list", items: [] };
  }

  Handle_GetTargeters() {
    log.debug("[DogmaIM] GetTargeters");
    return { type: "list", items: [] };
  }

  Handle_GetAllInfo(args, session) {
    log.debug("[DogmaIM] GetAllInfo");

    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const activeShip = this._getActiveShipRecord(session);
    if (session && (session.stationid || session.stationID)) {
      // Docking should fully reset active module effects; keep the server-side
      // active-effect cache aligned so undock does not resurrect stale toggles.
      this._clearSessionModuleActiveEffects(session, activeShip);
    }
    const shipID = activeShip ? activeShip.itemID : this._getShipID(session);
    const shipMetadata = activeShip || this._getShipMetadata(session);
    const ownerID = charID;
    const locationID = this._getLocationID(session);
    const getCharInfo = this._toBoolArg(args && args[0], true);
    const getShipInfo = this._toBoolArg(args && args[1], true);
    const characterLocationID = this._getCharacterItemLocationID(session, {
      allowShipLocation: getShipInfo,
    });
    const locationInfo = this._buildEmptyDict();

    const fittedItems = getShipInfo ? this._getFittedItemsForShip(session, activeShip) : [];

    const shipInfoEntry = getShipInfo
      ? this._buildCommonGetInfoEntry({
          itemID: shipID,
          typeID: shipMetadata.typeID,
          ownerID: shipMetadata.ownerID || ownerID,
          locationID: this._coalesce(shipMetadata.locationID, locationID),
          flagID: this._coalesce(shipMetadata.flagID, 4),
          groupID: shipMetadata.groupID,
          categoryID: shipMetadata.categoryID,
          quantity:
            shipMetadata.quantity === undefined ||
            shipMetadata.quantity === null
              ? -1
              : shipMetadata.quantity,
          singleton:
            shipMetadata.singleton === undefined ||
            shipMetadata.singleton === null
              ? 1
              : shipMetadata.singleton,
          stacksize:
            shipMetadata.stacksize === undefined ||
            shipMetadata.stacksize === null
              ? 1
              : shipMetadata.stacksize,
          customInfo: shipMetadata.customInfo || "",
          description: "ship",
          attributes: this._buildShipAttributeDict(charData, {
            ...shipMetadata,
            fittedItems,
          }),
        })
      : null;

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["activeShipID", shipID],
          ["locationInfo", getShipInfo ? locationInfo : null],
          ["shipModifiedCharAttribs", null],
          [
            "charInfo",
            getCharInfo
              ? [
                  this._buildCharacterInfoDict(
                    charID,
                    charData,
                    characterLocationID,
                  ),
                  this._buildCharacterBrain(),
                ]
              : null,
          ],
          [
            "shipInfo",
            getShipInfo
              ? {
                  type: "dict",
                  entries: this._buildShipInfoEntries(session, shipID, shipInfoEntry, fittedItems),
                }
              : this._buildEmptyDict(),
          ],
          [
            "shipState",
            getShipInfo
              ? this._buildActivationState(charID, shipID, activeShip, fittedItems)
              : null,
          ],
          ["systemWideEffectsOnShip", null],
          ["structureInfo", null],
        ],
      },
    };
  }

  Handle_ShipGetInfo(args, session) {
    log.debug("[DogmaIM] ShipGetInfo");
    const activeShip = this._getActiveShipRecord(session);
    const shipID = activeShip ? activeShip.itemID : this._getShipID(session);
    const shipMetadata = activeShip || this._getShipMetadata(session);
    const ownerID = shipMetadata.ownerID || this._getCharID(session);
    const locationID = shipMetadata.locationID || this._getLocationID(session);
    const fittedItems = this._getFittedItemsForShip(session, shipMetadata);

    const entry = this._buildCommonGetInfoEntry({
      itemID: shipID,
      typeID: shipMetadata.typeID,
      ownerID,
      locationID,
      flagID: this._coalesce(shipMetadata.flagID, 4),
      groupID: shipMetadata.groupID,
      categoryID: shipMetadata.categoryID,
      quantity:
        shipMetadata.quantity === undefined || shipMetadata.quantity === null
          ? -1
          : shipMetadata.quantity,
      singleton:
        shipMetadata.singleton === undefined || shipMetadata.singleton === null
          ? 1
          : shipMetadata.singleton,
      stacksize:
        shipMetadata.stacksize === undefined || shipMetadata.stacksize === null
          ? 1
          : shipMetadata.stacksize,
      customInfo: shipMetadata.customInfo || "",
      description: "ship",
      attributes: this._buildShipAttributeDict(
        this._getCharacterRecord(session) || {},
        { ...shipMetadata, fittedItems },
      ),
    });

    return { type: "dict", entries: this._buildShipInfoEntries(session, shipID, entry, fittedItems) };
  }

  Handle_CharGetInfo(args, session) {
    log.debug("[DogmaIM] CharGetInfo");
    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const characterLocationID = this._getCharacterItemLocationID(session);
    return this._buildCharacterInfoDict(charID, charData, characterLocationID);
  }

  Handle_ItemGetInfo(args, session) {
    const requestedItemID =
      args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[DogmaIM] ItemGetInfo(itemID=${requestedItemID})`);

    const charID = this._getCharID(session);
    const charData = this._getCharacterRecord(session) || {};
    const skillRecord =
      getCharacterSkills(charID).find(
        (skill) =>
          skill.itemID === requestedItemID ||
          skill.itemID === Number.parseInt(String(requestedItemID), 10),
      ) || null;
    const numericItemID =
      Number.parseInt(String(requestedItemID), 10) || this._getShipID(session);
    const shipRecord = findCharacterShip(charID, numericItemID);
    const itemRecord = findItemById(numericItemID);
    const isCharacter = numericItemID === charID;
    if (skillRecord) {
      return this._buildCommonGetInfoEntry({
        itemID: skillRecord.itemID,
        typeID: skillRecord.typeID,
        ownerID: skillRecord.ownerID || charID,
        locationID: this._coalesce(skillRecord.locationID, charID),
        flagID: skillRecord.flagID ?? SKILL_FLAG_ID,
        groupID: skillRecord.groupID,
        categoryID: skillRecord.categoryID,
        quantity: 1,
        singleton: 1,
        stacksize: 1,
        description: skillRecord.itemName || "skill",
      });
    }

    if (itemRecord) {
      return this._buildCommonGetInfoEntry({
        itemID: itemRecord.itemID,
        typeID: itemRecord.typeID,
        ownerID: itemRecord.ownerID || charID,
        locationID: this._coalesce(
          itemRecord.locationID,
          this._getLocationID(session),
        ),
        flagID: this._coalesce(itemRecord.flagID, 0),
        groupID: itemRecord.groupID,
        categoryID: itemRecord.categoryID,
        quantity:
          itemRecord.quantity === undefined || itemRecord.quantity === null
            ? itemRecord.singleton
              ? -1
              : 1
            : itemRecord.quantity,
        singleton:
          itemRecord.singleton === undefined || itemRecord.singleton === null
            ? 0
            : itemRecord.singleton,
        stacksize:
          itemRecord.stacksize === undefined || itemRecord.stacksize === null
            ? 1
            : itemRecord.stacksize,
        customInfo: itemRecord.customInfo || "",
        description: itemRecord.itemName || "item",
        attributes: this._buildGenericItemAttributeDict(itemRecord),
        activeEffects: this._buildModuleActiveEffects(itemRecord),
      });
    }

    const itemID = isCharacter
      ? charID
      : shipRecord
        ? shipRecord.itemID
        : this._getShipID(session);
    const ownerID = charID;
    const locationID = this._getLocationID(session);
    const shipMetadata =
      shipRecord ||
      this._getActiveShipRecord(session) ||
      this._getShipMetadata(session);
    const characterLocationID = this._getCharacterItemLocationID(session);
    const fittedItems = isCharacter
      ? []
      : this._getFittedItemsForShip(session, shipMetadata);

    return this._buildCommonGetInfoEntry({
      itemID,
      typeID: isCharacter ? charData.typeID || 1373 : shipMetadata.typeID,
      ownerID,
      locationID: isCharacter
        ? characterLocationID
        : this._coalesce(shipMetadata.locationID, locationID),
      flagID: isCharacter ? FLAG_PILOT : this._coalesce(shipMetadata.flagID, 4),
      groupID: isCharacter ? 1 : shipMetadata.groupID,
      categoryID: isCharacter ? 3 : shipMetadata.categoryID,
      quantity: isCharacter
        ? -1
        : shipMetadata.quantity === undefined || shipMetadata.quantity === null
          ? -1
          : shipMetadata.quantity,
      singleton: isCharacter
        ? 1
        : shipMetadata.singleton === undefined ||
            shipMetadata.singleton === null
          ? 1
          : shipMetadata.singleton,
      stacksize: isCharacter
        ? 1
        : shipMetadata.stacksize === undefined ||
            shipMetadata.stacksize === null
          ? 1
          : shipMetadata.stacksize,
      customInfo: isCharacter ? "" : shipMetadata.customInfo || "",
      description: "item",
      attributes: isCharacter
        ? this._buildCharacterAttributeDict(charData)
        : this._buildShipAttributeDict(charData, {
            ...shipMetadata,
            fittedItems,
          }),
    });
  }

  Handle_QueryAllAttributesForItem(args, session) {
    const requestedItemID =
      args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[DogmaIM] QueryAllAttributesForItem(itemID=${requestedItemID})`);
    const context = this._resolveItemAttributeContext(requestedItemID, session);
    return this._buildAttributeValueDict(context.attributes);
  }

  Handle_QueryAttributeValue(args, session) {
    const requestedItemID =
      args && args.length > 0 ? args[0] : this._getShipID(session);
    const attributeID = args && args.length > 1 ? Number(args[1]) : null;
    log.debug(
      `[DogmaIM] QueryAttributeValue(itemID=${requestedItemID}, attributeID=${attributeID})`,
    );
    if (!Number.isInteger(attributeID)) {
      return null;
    }
    const context = this._resolveItemAttributeContext(requestedItemID, session);
    return Object.prototype.hasOwnProperty.call(context.attributes, attributeID)
      ? context.attributes[attributeID]
      : null;
  }

  Handle_FullyDescribeAttribute(args, session) {
    const requestedItemID =
      args && args.length > 0 ? args[0] : this._getShipID(session);
    const attributeID = args && args.length > 1 ? Number(args[1]) : null;
    const reason = args && args.length > 2 ? args[2] : "";
    log.debug(
      `[DogmaIM] FullyDescribeAttribute(itemID=${requestedItemID}, attributeID=${attributeID})`,
    );

    const context = this._resolveItemAttributeContext(requestedItemID, session);
    const serverValue = Number.isInteger(attributeID)
      ? context.attributes[attributeID]
      : undefined;
    const baseValue = Number.isInteger(attributeID)
      ? context.baseAttributes[attributeID]
      : undefined;

    return {
      type: "list",
      items: [
        `Item ID:${this._formatDebugValue(context.itemID)}`,
        `Reason:${this._formatDebugValue(reason, "")}`,
        `Server value:${this._formatDebugValue(serverValue)}`,
        `Base value:${this._formatDebugValue(baseValue)}`,
        "Attribute modification graph:",
        "  No server-side modifier graph is implemented in EvEJS yet.",
      ],
    };
  }

  Handle_GetLocationInfo(args, session) {
    log.debug("[DogmaIM] GetLocationInfo");
    return [(session && session.userid) || 1, this._getLocationID(session), 0];
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[DogmaIM] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[DogmaIM] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    if (session) {
      if (
        !session._boundObjectIDs ||
        typeof session._boundObjectIDs !== "object"
      ) {
        session._boundObjectIDs = {};
      }
      session._boundObjectIDs.dogmaIM = idString;
      session.lastBoundObjectID = idString;
    }

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

      log.debug(`[DogmaIM] MachoBindObject nested call: ${methodName}`);
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
}

module.exports = DogmaService;
