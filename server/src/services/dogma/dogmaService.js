/**
 * Dogma IM Service (dogmaIM)
 *
 * Handles dogma (attributes/effects) related calls.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class DogmaService extends BaseService {
  constructor() {
    super("dogmaIM");
  }

  _getCharID(session) {
    return (session && (session.characterID || session.charid || session.userid)) || 140000001;
  }

  _getShipID(session) {
    return (session && (session.shipID || session.shipid)) || 140000101;
  }

  _getShipTypeID(session) {
    return session && Number.isInteger(session.shipTypeID) && session.shipTypeID > 0
      ? session.shipTypeID
      : 606;
  }

  _getLocationID(session) {
    return (
      (session && (session.stationid || session.stationID || session.locationid || session.solarsystemid2 || session.solarsystemid)) ||
      60003760
    );
  }

  _nowFileTime() {
    return BigInt(Date.now()) * 10000n + 116444736000000000n;
  }

  _buildInvRow(itemID, typeID, ownerID, locationID, flagID, groupID, categoryID) {
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
              1,
              groupID,
              categoryID,
              "",
              1,
              1,
            ],
          ],
        ],
      },
    };
  }

  _buildCommonGetInfoEntry({ itemID, typeID, ownerID, locationID, flagID, groupID, categoryID, description }) {
    const invItem = this._buildInvRow(
      itemID,
      typeID,
      ownerID,
      locationID,
      flagID,
      groupID,
      categoryID,
    );
    const now = this._nowFileTime();

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["itemID", itemID],
          ["invItem", invItem],
          ["activeEffects", { type: "dict", entries: [] }],
          ["attributes", { type: "dict", entries: [] }],
          ["description", description || ""],
          ["time", now],
          ["wallclockTime", now],
        ],
      },
    };
  }

  _buildShipStatusRow(shipID) {
    return {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", ["instanceID", "online", "damage", "charge", "skillPoints", "armorDamage", "shieldCharge", "incapacitated"]],
          ["line", [shipID, false, 0.0, 0.0, 0, 0.0, 1.0, false]],
        ],
      },
    };
  }

  Handle_GetCharacterAttributes(args, session) {
    log.debug("[DogmaIM] GetCharacterAttributes");
    return { type: "dict", entries: [] };
  }

  Handle_ShipOnlineModules(args, session) {
    log.debug("[DogmaIM] ShipOnlineModules");
    return { type: "list", items: [] };
  }

  Handle_GetAllInfo(args, session) {
    log.debug("[DogmaIM] GetAllInfo");

    const charID = this._getCharID(session);
    const shipID = this._getShipID(session);
    const shipTypeID = this._getShipTypeID(session);
    const ownerID = charID;
    const locationID = this._getLocationID(session);

    const charInfoEntry = this._buildCommonGetInfoEntry({
      itemID: charID,
      typeID: 1373,
      ownerID,
      locationID,
      flagID: 0,
      groupID: 1,
      categoryID: 3,
      description: "character",
    });

    const shipInfoEntry = this._buildCommonGetInfoEntry({
      itemID: shipID,
      typeID: shipTypeID,
      ownerID,
      locationID,
      flagID: 4,
      groupID: 25,
      categoryID: 6,
      description: "ship",
    });

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["activeShipID", shipID],
          ["locationInfo", { type: "dict", entries: [] }],
          ["shipModifiedCharAttribs", null],
          [
            "charInfo",
            {
              type: "dict",
              entries: [[charID, charInfoEntry]],
            },
          ],
          [
            "shipInfo",
            {
              type: "dict",
              entries: [[shipID, shipInfoEntry]],
            },
          ],
          [
            "shipState",
            [
              {
                type: "dict",
                entries: [[shipID, this._buildShipStatusRow(shipID)]],
              },
              { type: "dict", entries: [] },
              { type: "dict", entries: [] },
            ],
          ],
          ["systemWideEffectsOnShip", null],
          ["structureInfo", null],
        ],
      },
    };
  }

  Handle_ShipGetInfo(args, session) {
    log.debug("[DogmaIM] ShipGetInfo");
    const shipID = this._getShipID(session);
    const shipTypeID = this._getShipTypeID(session);
    const ownerID = this._getCharID(session);
    const locationID = this._getLocationID(session);

    const entry = this._buildCommonGetInfoEntry({
      itemID: shipID,
      typeID: shipTypeID,
      ownerID,
      locationID,
      flagID: 4,
      groupID: 25,
      categoryID: 6,
      description: "ship",
    });

    return { type: "dict", entries: [[shipID, entry]] };
  }

  Handle_CharGetInfo(args, session) {
    log.debug("[DogmaIM] CharGetInfo");
    const charID = this._getCharID(session);
    const locationID = this._getLocationID(session);

    const entry = this._buildCommonGetInfoEntry({
      itemID: charID,
      typeID: 1373,
      ownerID: charID,
      locationID,
      flagID: 0,
      groupID: 1,
      categoryID: 3,
      description: "character",
    });

    return { type: "dict", entries: [[charID, entry]] };
  }

  Handle_ItemGetInfo(args, session) {
    const requestedItemID = args && args.length > 0 ? args[0] : this._getShipID(session);
    log.debug(`[DogmaIM] ItemGetInfo(itemID=${requestedItemID})`);

    const shipID = this._getShipID(session);
    const isShip = requestedItemID === shipID;
    const itemID = isShip ? shipID : Number.parseInt(String(requestedItemID), 10) || shipID;
    const ownerID = this._getCharID(session);
    const locationID = this._getLocationID(session);

    return this._buildCommonGetInfoEntry({
      itemID,
      typeID: this._getShipTypeID(session),
      ownerID,
      locationID,
      flagID: isShip ? 4 : 0,
      groupID: isShip ? 25 : 1,
      categoryID: isShip ? 6 : 3,
      description: "item",
    });
  }

  Handle_GetLocationInfo(args, session) {
    log.debug("[DogmaIM] GetLocationInfo");
    return [
      (session && session.userid) || 1,
      this._getLocationID(session),
      0,
    ];
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

module.exports = DogmaService;
