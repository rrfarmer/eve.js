const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  activateShipForSession,
  findCharacterShip,
  getActiveShipRecord,
  buildInventoryItemRow,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ensureCapsuleForCharacter,
  ITEM_FLAGS,
  getShipConditionState,
  setShipPackagingState,
  listContainerItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getCharacterSkillPointTotal,
} = require(path.join(__dirname, "../skills/skillState"));
const {
  undockSession,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  isModuleOnline,
} = require(path.join(__dirname, "../dogma/moduleOnlineState"));
const {
  getPendingShipDirtTimestamp,
  setShipDirtTimestamp,
} = require(path.join(__dirname, "./shipDirtState"));
const DBTYPE_I4 = 0x03;
const DBTYPE_R8 = 0x05;
const DBTYPE_BOOL = 0x0b;
const DBTYPE_I8 = 0x14;
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
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
  11, 12, 13, 14, 15, 16, 17, 18,
  19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34,
  92, 93, 94,
]);
const TURRET_SLOT_FLAGS = Object.freeze([27, 28, 29, 30, 31, 32, 33, 34]);


function buildCurrentFileTime() {
  return BigInt(Date.now()) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

class ShipService extends BaseService {
  constructor() {
    super("ship");
    this._shipConfiguration = new Map();
    this._shipDirtTimestamps = new Map();
  }

  _getShipID(session) {
    const activeShip =
      session && session.characterID
        ? getActiveShipRecord(session.characterID)
        : null;
    return (
      (activeShip && (activeShip.itemID || activeShip.shipID)) ||
      (session && (session.activeShipID || session.shipID || session.shipid)) ||
      140000101
    );
  }

  _extractShipId(rawValue) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return Math.trunc(rawValue);
    }

    if (typeof rawValue === "bigint") {
      return Number(rawValue);
    }

    if (typeof rawValue === "string" && rawValue.trim() !== "") {
      return Number.parseInt(rawValue, 10);
    }

    if (Buffer.isBuffer(rawValue)) {
      return Number.parseInt(rawValue.toString("utf8"), 10);
    }

    return 0;
  }

  _extractShipIds(rawValue) {
    if (Array.isArray(rawValue)) {
      return rawValue.map((entry) => this._extractShipId(entry)).filter((entry) => entry > 0);
    }

    if (rawValue && rawValue.type === "list" && Array.isArray(rawValue.items)) {
      return rawValue.items
        .map((entry) => this._extractShipId(entry))
        .filter((entry) => entry > 0);
    }

    const singleShipId = this._extractShipId(rawValue);
    return singleShipId > 0 ? [singleShipId] : [];
  }

  _normalizeFileTime(rawValue) {
    if (typeof rawValue === "bigint") {
      return rawValue > 0n ? rawValue : null;
    }

    if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
      return BigInt(Math.trunc(rawValue));
    }

    if (typeof rawValue === "string" && rawValue.trim() !== "") {
      try {
        const parsed = BigInt(rawValue.trim());
        return parsed > 0n ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    if (Buffer.isBuffer(rawValue)) {
      try {
        const parsed = BigInt(rawValue.toString("utf8").trim());
        return parsed > 0n ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    return null;
  }

  _getPendingDirtTimestamp(shipID, consume = false) {
    const numericShipID = this._extractShipId(shipID);
    if (numericShipID <= 0) {
      return 0n;
    }

    const dirtTimestamp = this._shipDirtTimestamps.get(numericShipID) || 0n;
    if (consume && dirtTimestamp > 0n) {
      this._shipDirtTimestamps.delete(numericShipID);
    }

    return dirtTimestamp;
  }

  _setDirtTimestamp(shipID, rawTimestamp = null) {
    const numericShipID = this._extractShipId(shipID);
    if (numericShipID <= 0) {
      return null;
    }

    const dirtTimestamp = this._normalizeFileTime(rawTimestamp) || buildCurrentFileTime();
    this._shipDirtTimestamps.set(numericShipID, dirtTimestamp);
    return dirtTimestamp;
  }

  _buildActivationResponse(activeShip, session) {
    // The live 23.02 client build in use here still expects a 4-slot
    // activation tuple during ship boarding/activation. The first three slots
    // are the usual instance/charge/weapon-bank caches; the fourth is kept as
    // an empty reserved payload for compatibility with the running client.
    const charID =
      (session && (session.characterID || session.charid || session.userid)) ||
      140000001;
    const shipID =
      (activeShip && (activeShip.itemID || activeShip.shipID)) ||
      this._getShipID(session);
    const skillPoints = getCharacterSkillPointTotal(charID) || 0;
    const shipCondition = getShipConditionState(activeShip);
    const fittedItems = this._getFittedItemsForShip(session, shipID);
    const stateEntries = [
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
          skillPoints,
        }),
      ],
    ];

    for (const fittedItem of fittedItems) {
      stateEntries.push([
        fittedItem.itemID,
        this._buildPackedInstanceRow({
          itemID: fittedItem.itemID,
          online: isModuleOnline(fittedItem.itemID, true),
        }),
      ]);
    }

    return [
      {
        type: "dict",
        entries: stateEntries,
      },
      this._buildModuleChargeCache(fittedItems),
      this._buildWeaponBankCache(fittedItems),
      { type: "dict", entries: [] },
    ];
  }

    _buildModuleChargeCache(fittedItems = []) {
    // The HUD asks for charge data for every visible slot. Modules without
    // ammo still need an explicit empty entry so the client does not fall back
    // to treating the module type as charge data.
    return {
      type: "dict",
      entries: fittedItems.map((item) => [item.itemID, null]),
    };
  }

    _buildWeaponBankCache(fittedItems = []) {
    return {
      type: "dict",
      entries: fittedItems
        .filter((item) => TURRET_SLOT_FLAGS.includes(Number(item.flagID || 0)))
        .map((item) => [item.itemID, null]),
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

    _getFittedItemsForShip(session, shipID = null, slotFlags = FITTED_SLOT_FLAGS) {
    const resolvedShipID = this._extractShipId(shipID) || this._getShipID(session);
    const charID = session && session.characterID ? session.characterID : 0;
    const seen = new Set();
    const fittedItems = [];

    for (const slotFlag of slotFlags) {
      const slotItems = listContainerItems(charID, resolvedShipID, slotFlag);
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


  _getShipConfiguration(shipID) {
    const numericShipID = this._extractShipId(shipID);
    if (!this._shipConfiguration.has(numericShipID)) {
      this._shipConfiguration.set(numericShipID, {
        allowFleetSMBUsage: false,
        allowCorpSMBUsage: false,
        SMB_AllowFleetAccess: false,
        SMB_AllowCorpAccess: false,
        FleetHangar_AllowFleetAccess: false,
        FleetHangar_AllowCorpAccess: false,
      });
    }

    return this._shipConfiguration.get(numericShipID);
  }

  _activateShipById(shipID, session, sourceLabel) {
    if (!session) {
      log.warn(`[Ship] ${sourceLabel} requested without a session`);
      return null;
    }

    const numericShipID = this._extractShipId(shipID);
    if (!Number.isInteger(numericShipID) || numericShipID <= 0) {
      log.warn(`[Ship] ${sourceLabel} received invalid shipID=${String(shipID)}`);
      return null;
    }

    const currentShip = getActiveShipRecord(session.characterID);
    const requestedShip = findCharacterShip(session.characterID, numericShipID);

    log.info(
      `[Ship] ${sourceLabel} shipID=${numericShipID} current=${currentShip ? (currentShip.itemID || currentShip.shipID) : "none"} requested=${requestedShip ? `${requestedShip.shipName}(${requestedShip.shipTypeID})` : "unknown"}`,
    );

    const activationResult = activateShipForSession(session, numericShipID, {
      emitNotifications: true,
      logSelection: true,
    });
    if (!activationResult.success) {
      log.warn(
        `[Ship] ${sourceLabel} failed for shipID=${numericShipID}: ${activationResult.errorMsg}`,
      );
      return null;
    }

    // Bump the active ship dirt timestamp on each boarding/activation so the
    // hangar scene knows this hull needs a one-time visual rematerialization.
    // Handle_GetDirtTimestamp consumes that signal on first read.
    this._setDirtTimestamp(numericShipID);

    const activeShip = activationResult.activeShip || getActiveShipRecord(session.characterID);
    return this._buildActivationResponse(activeShip, session);
  }

  _leaveShip(session, shipID, sourceLabel) {
    if (!session || !session.characterID) {
      log.warn(`[Ship] ${sourceLabel} requested without a selected character`);
      return null;
    }

    const stationID = session.stationid || session.stationID || 60003760;
    const capsuleResult = ensureCapsuleForCharacter(session.characterID, stationID);
    if (!capsuleResult.success || !capsuleResult.data) {
      log.warn(`[Ship] ${sourceLabel} failed to ensure capsule`);
      return null;
    }

    const activationResult = activateShipForSession(
      session,
      capsuleResult.data.itemID,
      {
        emitNotifications: true,
        logSelection: true,
                targetPreviousState: capsuleResult.created
          ? {
              locationID: 0,
              flagID: 0,
              quantity: 0,
              singleton: 0,
              stacksize: 0,
            }
          : null,
      },
    );
    if (!activationResult.success) {
      log.warn(
        `[Ship] ${sourceLabel} failed to activate capsule: ${activationResult.errorMsg}`,
      );
      return null;
    }

    return capsuleResult.data.itemID;
  }

  Handle_GetDirtTimestamp(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const dirtTimestamp = this._getPendingDirtTimestamp(shipID, true);
    log.debug(
      `[Ship] GetDirtTimestamp(shipID=${shipID}) -> ${String(dirtTimestamp)}`,
    );

    // The hangar view polls this during ship presentation. Returning a one-shot
    // FILETIME only when a hull was explicitly reactivated avoids login/dock
    // rematerialization while preserving one redraw for real boarding.
    return dirtTimestamp;
  }

  Handle_SetDirtTimestamp(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const ts = args && args.length > 1 ? args[1] : null;
    const dirtTimestamp = this._setDirtTimestamp(shipID, ts);
    log.debug(
      `[Ship] SetDirtTimestamp(shipID=${shipID}, ts=${String(ts)}, stored=${String(dirtTimestamp)})`,
    );
    return null;
  }

  Handle_GetShipKillCounter(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[Ship] GetShipKillCounter(shipID=${shipID})`);
    return [0, 1];
  }

  Handle_GetKillCounter(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[Ship] GetKillCounter(shipID=${shipID})`);
    return 0;
  }

  Handle_GetDisplayKillCounterValue(args, session, kwargs) {
    log.debug("[Ship] GetDisplayKillCounterValue");
    return 1;
  }

  Handle_GetFittedItems(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[Ship] GetFittedItems(shipID=${shipID})`);
    const fittedItems = this._getFittedItemsForShip(session, shipID);
    return {
      type: "dict",
      entries: fittedItems.map((item) => [item.itemID, buildInventoryItemRow(item)]),
    };
  }

  Handle_GetModules(args, session, kwargs) {
    log.debug("[Ship] GetModules");
    const shipID = args && args.length > 0 ? args[0] : null;
    const fittedItems = this._getFittedItemsForShip(session, shipID);
    return {
      type: "list",
      items: fittedItems.map((item) => item.itemID),
    };
  }

  Handle_ActivateShip(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const oldShipID = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Ship] ActivateShip(shipID=${String(shipID)}, oldShipID=${String(oldShipID)})`,
    );

    return this._activateShipById(shipID, session, "ActivateShip");
  }

  Handle_AssembleShip(args, session, kwargs) {
    const shipIds = this._extractShipIds(args && args.length > 0 ? args[0] : null);
    const stationID =
      (session && (session.stationid || session.stationID)) || 0;
    const charID = session && session.characterID ? session.characterID : 0;
    const rows = [];

    log.info(
      `[Ship] AssembleShip station=${stationID} shipIDs=${JSON.stringify(shipIds)}`,
    );

    for (const shipID of shipIds) {
      const shipItem = findCharacterShip(charID, shipID);
      if (!shipItem) {
        continue;
      }

      if (
        shipItem.locationID !== stationID ||
        shipItem.flagID !== ITEM_FLAGS.HANGAR ||
        shipItem.singleton === 1
      ) {
        continue;
      }

      const updateResult = setShipPackagingState(shipItem.itemID, false);
      if (!updateResult.success) {
        log.warn(
          `[Ship] AssembleShip failed for ${shipID}: ${updateResult.errorMsg}`,
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

      rows.push(buildInventoryItemRow(updateResult.data));
    }

    return [
      {
        type: "list",
        items: rows,
      },
      {
        type: "dict",
        entries: [[10, 0]],
      },
    ];
  }

  Handle_LeaveShip(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.info(`[Ship] LeaveShip(shipID=${String(shipID)})`);
    return this._leaveShip(session, shipID, "LeaveShip");
  }

  Handle_BoardStoredShip(args, session, kwargs) {
    const structureID = args && args.length > 0 ? args[0] : null;
    const shipID = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Ship] BoardStoredShip(structureID=${String(structureID)}, shipID=${String(shipID)})`,
    );

    return this._activateShipById(shipID, session, "BoardStoredShip");
  }

  Handle_Board(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const oldShipID = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Ship] Board(shipID=${String(shipID)}, oldShipID=${String(oldShipID)})`,
    );

    return this._activateShipById(shipID, session, "Board");
  }

  Handle_Undock(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : this._getShipID(session);
    const ignoreContraband = args && args.length > 1 ? Boolean(args[1]) : false;

    log.info(
      `[Ship] Undock(shipID=${String(shipID)}, ignoreContraband=${ignoreContraband})`,
    );

    const result = undockSession(session);
    if (!result.success) {
      log.warn(
        `[Ship] Undock failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      return null;
    }

    return result.data.boundResult || null;
  }

  Handle_Eject(args, session, kwargs) {
    log.info("[Ship] Eject()");
    return this._leaveShip(session, null, "Eject");
  }

  Handle_GetTurretModules(args, session, kwargs) {
    log.debug("[Ship] GetTurretModules");
    const shipID = args && args.length > 0 ? args[0] : null;
    const fittedItems = this._getFittedItemsForShip(
      session,
      shipID,
      TURRET_SLOT_FLAGS,
    );
    return {
      type: "list",
      items: fittedItems.map((item) => item.itemID),
    };
  }

  Handle_GetShipConfiguration(args, session, kwargs) {
    const shipID =
      args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[Ship] GetShipConfiguration(shipID=${String(shipID)})`);
    const configuration = this._getShipConfiguration(shipID);
    const allowFleetAccess = Boolean(
      configuration.SMB_AllowFleetAccess ?? configuration.allowFleetSMBUsage,
    );
    const allowCorpAccess = Boolean(
      configuration.SMB_AllowCorpAccess ?? configuration.allowCorpSMBUsage,
    );
    configuration.allowFleetSMBUsage = allowFleetAccess;
    configuration.SMB_AllowFleetAccess = allowFleetAccess;
    configuration.allowCorpSMBUsage = allowCorpAccess;
    configuration.SMB_AllowCorpAccess = allowCorpAccess;
    configuration.FleetHangar_AllowFleetAccess = allowFleetAccess;
    configuration.FleetHangar_AllowCorpAccess = allowCorpAccess;
    return {
      type: "dict",
      entries: [
        ["allowFleetSMBUsage", allowFleetAccess],
        ["SMB_AllowFleetAccess", allowFleetAccess],
        ["allowCorpSMBUsage", allowCorpAccess],
        ["SMB_AllowCorpAccess", allowCorpAccess],
        ["FleetHangar_AllowFleetAccess", allowFleetAccess],
        ["FleetHangar_AllowCorpAccess", allowCorpAccess],
      ],
    };
  }

  Handle_ConfigureShip(args, session, kwargs) {
    const configPayload =
      args && args.length > 0 && args[0] && typeof args[0] === "object"
        ? args[0]
        : null;
    const shipID = this._getShipID(session);
    const configuration = this._getShipConfiguration(shipID);

    if (configPayload && configPayload.type === "dict" && Array.isArray(configPayload.entries)) {
      for (const [key, value] of configPayload.entries) {
        if (
          key === "allowFleetSMBUsage" ||
          key === "SMB_AllowFleetAccess" ||
          key === "FleetHangar_AllowFleetAccess"
        ) {
          const normalizedValue = Boolean(value);
          configuration.allowFleetSMBUsage = normalizedValue;
          configuration.SMB_AllowFleetAccess = normalizedValue;
          configuration.FleetHangar_AllowFleetAccess = normalizedValue;
        } else if (
          key === "allowCorpSMBUsage" ||
          key === "SMB_AllowCorpAccess" ||
          key === "FleetHangar_AllowCorpAccess"
        ) {
          const normalizedValue = Boolean(value);
          configuration.allowCorpSMBUsage = normalizedValue;
          configuration.SMB_AllowCorpAccess = normalizedValue;
          configuration.FleetHangar_AllowCorpAccess = normalizedValue;
        }
      }
    } else if (configPayload && typeof configPayload === "object") {
      if (
        Object.prototype.hasOwnProperty.call(configPayload, "allowFleetSMBUsage") ||
        Object.prototype.hasOwnProperty.call(configPayload, "SMB_AllowFleetAccess") ||
        Object.prototype.hasOwnProperty.call(configPayload, "FleetHangar_AllowFleetAccess")
      ) {
        const normalizedValue = Boolean(
          Object.prototype.hasOwnProperty.call(configPayload, "FleetHangar_AllowFleetAccess")
            ? configPayload.FleetHangar_AllowFleetAccess
            : Object.prototype.hasOwnProperty.call(configPayload, "SMB_AllowFleetAccess")
            ? configPayload.SMB_AllowFleetAccess
            : configPayload.allowFleetSMBUsage,
        );
        configuration.allowFleetSMBUsage = normalizedValue;
        configuration.SMB_AllowFleetAccess = normalizedValue;
        configuration.FleetHangar_AllowFleetAccess = normalizedValue;
      }
      if (
        Object.prototype.hasOwnProperty.call(configPayload, "allowCorpSMBUsage") ||
        Object.prototype.hasOwnProperty.call(configPayload, "SMB_AllowCorpAccess") ||
        Object.prototype.hasOwnProperty.call(configPayload, "FleetHangar_AllowCorpAccess")
      ) {
        const normalizedValue = Boolean(
          Object.prototype.hasOwnProperty.call(configPayload, "FleetHangar_AllowCorpAccess")
            ? configPayload.FleetHangar_AllowCorpAccess
            : Object.prototype.hasOwnProperty.call(configPayload, "SMB_AllowCorpAccess")
            ? configPayload.SMB_AllowCorpAccess
            : configPayload.allowCorpSMBUsage,
        );
        configuration.allowCorpSMBUsage = normalizedValue;
        configuration.SMB_AllowCorpAccess = normalizedValue;
        configuration.FleetHangar_AllowCorpAccess = normalizedValue;
      }
    }

    log.debug(
      `[Ship] ConfigureShip(shipID=${String(shipID)} allowFleetSMBUsage=${configuration.allowFleetSMBUsage} SMB_AllowFleetAccess=${configuration.SMB_AllowFleetAccess} FleetHangar_AllowFleetAccess=${configuration.FleetHangar_AllowFleetAccess} allowCorpSMBUsage=${configuration.allowCorpSMBUsage} SMB_AllowCorpAccess=${configuration.SMB_AllowCorpAccess} FleetHangar_AllowCorpAccess=${configuration.FleetHangar_AllowCorpAccess})`,
    );
    return null;
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[Ship] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[Ship] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    if (session) {
      if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
        session._boundObjectIDs = {};
      }
      session._boundObjectIDs.ship = idString;
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

      log.debug(`[Ship] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  callMethod(method, args, session, kwargs) {
    const handlerName = `Handle_${method}`;
    const hasExplicitHandler =
      typeof this[handlerName] === "function" || typeof this[method] === "function";
    const response = super.callMethod(method, args, session, kwargs);
    if (hasExplicitHandler || response !== null) {
      return response;
    }

    log.warn(`[Ship] Unhandled method fallback: ${method}`);
    return null;
  }
}

module.exports = ShipService;
