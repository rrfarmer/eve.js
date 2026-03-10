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
  setShipPackagingState,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  getCharacterSkillPointTotal,
} = require(path.join(__dirname, "../skills/skillState"));
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

class ShipService extends BaseService {
  constructor() {
    super("ship");
    this._shipConfiguration = new Map();
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

  _buildActivationResponse(activeShip, session) {
    // V23.02 clientDogmaLocation._MakeShipActive unpacks:
    //   instanceCache, instanceFlagQuantityCache, wbData, heatStates
    // Returning the older 3-tuple crashes boarding/activation immediately.
    const charID =
      (session && (session.characterID || session.charid || session.userid)) ||
      140000001;
    const shipID =
      (activeShip && (activeShip.itemID || activeShip.shipID)) ||
      this._getShipID(session);
    const skillPoints = getCharacterSkillPointTotal(charID) || 0;

    return [
      {
        type: "dict",
        entries: [
          [
            shipID,
            this._buildPackedInstanceRow({
              itemID: shipID,
              shieldCharge: 1.0,
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
        ],
      },
      { type: "dict", entries: [] },
      { type: "dict", entries: [] },
      { type: "dict", entries: [] },
    ];
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
    log.debug(`[Ship] GetDirtTimestamp(shipID=${shipID})`);

    // FILETIME ticks (100ns since 1601) as python long-compatible value.
    return BigInt(Date.now()) * 10000n + 116444736000000000n;
  }

  Handle_SetDirtTimestamp(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const ts = args && args.length > 1 ? args[1] : null;
    log.debug(`[Ship] SetDirtTimestamp(shipID=${shipID}, ts=${String(ts)})`);
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
    return { type: "dict", entries: [] };
  }

  Handle_GetModules(args, session, kwargs) {
    log.debug("[Ship] GetModules");
    return { type: "list", items: [] };
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

  Handle_Eject(args, session, kwargs) {
    log.info("[Ship] Eject()");
    return this._leaveShip(session, null, "Eject");
  }

  Handle_GetTurretModules(args, session, kwargs) {
    log.debug("[Ship] GetTurretModules");
    return { type: "list", items: [] };
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
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[Ship] Unhandled method fallback: ${method}`);
    return null;
  }
}

module.exports = ShipService;
