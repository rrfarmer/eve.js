/**
 * Inventory Broker Service (invbroker)
 *
 * Handles inventory/item queries from the client.
 * Called after character selection to load inventory data.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class InvBrokerService extends BaseService {
  constructor() {
    super("invbroker");
  }

  _getStationId(session) {
    return (
      (session && (session.stationid || session.stationID || session.locationid)) ||
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
    return (session && (session.shipID || session.shipid)) || 140000101;
  }

  _getShipTypeId(session) {
    const shipTypeID =
      session && Number.isInteger(session.shipTypeID) ? session.shipTypeID : null;
    return shipTypeID && shipTypeID > 0 ? shipTypeID : 606;
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

  _buildInvRow(session, overrides = {}) {
    const itemID = overrides.itemID ?? this._getShipId(session);
    const typeID = overrides.typeID ?? this._getShipTypeId(session);
    const ownerID = overrides.ownerID ?? this._getCharacterId(session);
    const locationID = overrides.locationID ?? this._getStationId(session);
    const flagID = overrides.flagID ?? 4; // station hangar
    const singleton = overrides.singleton ?? 1;
    const quantity = overrides.quantity ?? 1;
    const stacksize = overrides.stacksize ?? quantity;
    const groupID = overrides.groupID ?? 25; // Frigate
    const categoryID = overrides.categoryID ?? 6; // Ship
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
    const shipID = this._getShipId(session);
    if (id === shipID) {
      return {};
    }

    return {
      itemID: Number.isInteger(id) ? id : shipID,
      typeID: this._getShipTypeId(session),
      ownerID: this._getCharacterId(session),
      locationID: this._getStationId(session),
      flagID: 4,
      quantity: 1,
      groupID: 25,
      categoryID: 6,
      customInfo: "",
      singleton: 1,
      stacksize: 1,
    };
  }

  Handle_GetInventory(args, session) {
    const config = require(path.join(__dirname, "../../config"));
    log.debug("[InvBroker] GetInventory");

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    return {
      type: "substruct",
      value: {
        type: "substream",
        value: [idString, now],
      },
    };
  }

  Handle_GetInventoryFromId(args, session) {
    const config = require(path.join(__dirname, "../../config"));
    const itemid = args && args.length > 0 ? args[0] : 0;
    log.debug(`[InvBroker] GetInventoryFromId(itemid=${itemid})`);

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    return {
      type: "substruct",
      value: {
        type: "substream",
        value: [idString, now],
      },
    };
  }

  Handle_SetLabel(args, session) {
    log.debug("[InvBroker] SetLabel");
    return null;
  }

  Handle_List(args, session, kwargs) {
    const argFlag = args && args.length > 0 ? args[0] : null;
    const kwFlag = this._extractKwarg(kwargs, "flag");
    const requestedFlag = kwFlag ?? argFlag;
    log.debug(`[InvBroker] List (inventory contents) flag=${requestedFlag}`);

    // In station/hangar flows the client may query with null/0/4 and still
    // expect the active ship item to be present for dogma item loading.
    if (
      requestedFlag !== null &&
      requestedFlag !== 0 &&
      requestedFlag !== 4 &&
      requestedFlag !== 156
    ) {
      return { type: "list", items: [] };
    }

    const row = this._buildInvRow(session);
    log.debug(`[InvBroker] List row=${JSON.stringify(row)}`);
    return { type: "list", items: [this._buildInvItem(session)] };
  }

  Handle_GetItem(args, session) {
    const itemID = args && args.length > 0 ? args[0] : this._getShipId(session);
    log.debug(`[InvBroker] GetItem(itemID=${itemID})`);

    return this._buildInvItem(session, this._itemOverridesFromId(session, itemID));
  }

  Handle_GetItemByID(args, session) {
    return this.Handle_GetItem(args, session);
  }

  Handle_GetItems(args, session) {
    const ids = args && args.length > 0 && Array.isArray(args[0]) ? args[0] : [];
    log.debug(`[InvBroker] GetItems(count=${ids.length})`);

    const items = ids.map((id) =>
      this._buildInvItem(session, this._itemOverridesFromId(session, id)),
    );
    return { type: "list", items };
  }

  Handle_GetSelfInvItem(args, session) {
    log.debug("[InvBroker] GetSelfInvItem");

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["itemID", this._getShipId(session)],
          ["typeID", this._getShipTypeId(session)],
          ["ownerID", this._getCharacterId(session)],
          ["locationID", this._getStationId(session)],
          ["flagID", 4],
          ["quantity", 1],
          ["groupID", 25],
          ["categoryID", 6],
          ["customInfo", ""],
          ["singleton", 1],
          ["stacksize", 1],
        ],
      },
    };
  }

  Handle_TrashItems(args, session) {
    log.debug("[InvBroker] TrashItems");
    return null;
  }

  Handle_GetItemDescriptor(args, session) {
    log.debug("[InvBroker] GetItemDescriptor");

    const columns = [
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

    return {
      type: "objectex1",
      header: [{ type: "token", value: "blue.DBRowDescriptor" }, [columns]],
      list: [],
      dict: [],
    };
  }

  Handle_GetAvailableTurretSlots(args, session) {
    return [];
  }

  Handle_MachoResolveObject(args, session, kwargs) {
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

      log.debug(`[InvBroker] MachoBindObject nested call: ${methodName}`);
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
}

module.exports = InvBrokerService;
