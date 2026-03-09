/**
 * Config Service
 *
 * Handles client config/settings calls including owner/location/ticker lookups.
 *
 * V23.02 client calls cfg.eveowners.Prime(), cfg.evelocations.Prime(),
 * cfg.corptickernames.Prime() during character selection, which make remote
 * calls to GetMultiOwnersEx, GetMultiLocationsEx, GetMultiCorpTickerNamesEx.
 *
 * EVEmu returns "TupleSet" format: ([columnNames], [[row1], [row2], ...])
 * For empty results: empty tuple ().
 */

const fs = require("fs");
const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));

const log = require(path.join(__dirname, "../../utils/logger"));
const database = require("../../newDatabase")

/**
 * Extract a plain JS array from a value that might be:
 *   - A plain array: [1, 2, 3]
 *   - A marshal list object: {type: 'list', items: [1, 2, 3]}
 */
function extractList(val) {
  if (Array.isArray(val)) return val;
  if (
    val &&
    typeof val === "object" &&
    val.type === "list" &&
    Array.isArray(val.items)
  ) {
    return val.items;
  }
  return [];
}

class ConfigService extends BaseService {
  constructor() {
    super("config");
  }

  /**
   * GetMultiOwnersEx — fetch owner info for a list of entity IDs.
   *
   * EVEmu returns TupleSet: ([ownerID, ownerName, typeID, gender, ownerNameID], [rows])
   * The client's _Prime method expects a tuple, NOT a list.
   */
  Handle_GetMultiOwnersEx(args, session) {
    const rawArg = args && args.length > 0 ? args[0] : [];
    const requestedIds = extractList(rawArg);
    log.debug(
      `[ConfigService] GetMultiOwnersEx: ${JSON.stringify(requestedIds)}`,
    );

    const characterResult = database.read("characters", "/")
    const characters = characterResult.success ? characterResult.data : {}

    const rows = [];

    for (const id of requestedIds) {
      // Check if this is a character ID we know about
      const charData = characters[String(id)];
      if (charData) {
        rows.push([
          id, // ownerID
          charData.characterName || "Unknown", // ownerName
          charData.typeID || 1373, // typeID
          charData.gender || 1, // gender
          null, // ownerNameID
        ]);
        continue;
      }

      // NPC corps (1000000-1999999 range)
      if (id >= 1000000 && id < 2000000) {
        rows.push([
          id,
          `Corporation ${id}`,
          2, // typeID = 2 (Corporation)
          0, // gender
          null, // ownerNameID
        ]);
        continue;
      }

      // Unknown entities — return placeholder
      rows.push([id, `Entity ${id}`, 1, 0, null]);
    }

    if (rows.length === 0) {
      return [];
    }

    // Return TupleSet: ([columnNames], [rows])
    return [["ownerID", "ownerName", "typeID", "gender", "ownerNameID"], rows];
  }

  /**
   * GetMultiLocationsEx — fetch location info for a list of location IDs.
   *
   * EVEmu returns TupleSet: ([locationID, locationName, x, y, z, locationNameID], [rows])
   */
  Handle_GetMultiLocationsEx(args, session) {
    const rawArg = args && args.length > 0 ? args[0] : [];
    const requestedIds = extractList(rawArg);
    log.debug(
      `[ConfigService] GetMultiLocationsEx: ${JSON.stringify(requestedIds)}`,
    );

    const characterResult = database.read("characters", "/")
    const characters = characterResult.success ? characterResult.data : {}

    const shipNameById = new Map();
    const charNameById = new Map();
    for (const [charId, c] of Object.entries(characters)) {
      const cid = parseInt(charId, 10);
      if (Number.isInteger(cid)) {
        charNameById.set(cid, c.characterName || `Character ${cid}`);
      }
      if (c && Number.isInteger(c.shipID)) {
        shipNameById.set(c.shipID, c.shipName || "Velator");
      }
    }

    const rows = [];

    for (const id of requestedIds) {
      if (shipNameById.has(id)) {
        rows.push([id, shipNameById.get(id), 0.0, 0.0, 0.0, null]);
      } else if (charNameById.has(id)) {
        rows.push([id, charNameById.get(id), 0.0, 0.0, 0.0, null]);
      } else if (id >= 60000000 && id < 64000000) {
        rows.push([id, `Station ${id}`, 0.0, 0.0, 0.0, null]);
      } else if (id >= 30000000 && id < 40000000) {
        rows.push([id, `System ${id}`, 0.0, 0.0, 0.0, null]);
      } else {
        rows.push([id, `Location ${id}`, 0.0, 0.0, 0.0, null]);
      }
    }

    if (rows.length === 0) {
      return [];
    }

    return [
      ["locationID", "locationName", "x", "y", "z", "locationNameID"],
      rows,
    ];
  }
  Handle_GetMultiAllianceShortNamesEx(args, session) {
    const rawArg = args && args.length > 0 ? args[0] : [];
    const allianceIDs = extractList(rawArg);
    log.debug(
      `[ConfigService] GetMultiAllianceShortNamesEx: ${JSON.stringify(allianceIDs)}`,
    );

    // No alliances implemented yet
    return [];
  }

  /**
   * GetMultiCorpTickerNamesEx — fetch corporation ticker names.
   *
   * Called by cfg.corptickernames.Prime()
   */
  Handle_GetMultiCorpTickerNamesEx(args, session) {
    const rawArg = args && args.length > 0 ? args[0] : [];
    const requestedIds = extractList(rawArg);
    log.debug(
      `[ConfigService] GetMultiCorpTickerNamesEx: ${JSON.stringify(requestedIds)}`,
    );

    const rows = [];

    for (const id of requestedIds) {
      rows.push([
        id, // corporationID
        "CORP", // tickerName
        0,
        0,
        0, // shape1, shape2, shape3
        0,
        0,
        0, // color1, color2, color3
      ]);
    }

    if (rows.length === 0) {
      return [];
    }

    return [
      [
        "corporationID",
        "tickerName",
        "shape1",
        "shape2",
        "shape3",
        "color1",
        "color2",
        "color3",
      ],
      rows,
    ];
  }

  Handle_GetMapObjects(args, session) {
    log.debug("[ConfigService] GetMapObjects");
    return { type: "list", items: [] };
  }

  Handle_GetMultiGraphicsEx(args, session) {
    log.debug("[ConfigService] GetMultiGraphicsEx");
    return [];
  }

  Handle_GetBlackListedPlanets(args, session) {
    log.debug("[ConfigService] GetBlackListedPlanets");
    return { type: "list", items: [] };
  }

  Handle_GetOldStationData(args, session) {
    log.debug("[ConfigService] GetOldStationData");
    return { type: "list", items: [] };
  }

  Handle_GetAverageMarketPrices(args, session) {
    log.debug("[ConfigService] GetAverageMarketPrices");
    return { type: "dict", entries: [] };
  }
}

module.exports = ConfigService;


