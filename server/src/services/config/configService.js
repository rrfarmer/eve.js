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

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));

const log = require(path.join(__dirname, "../../utils/logger"));
const database = require("../../database")
const { getCharacterShips } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const { buildKeyVal } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { getStationRecord } = require(path.join(
  __dirname,
  "../_shared/stationStaticData",
));
const { getStaticOwnerRecord } = require(path.join(
  __dirname,
  "../_shared/stationStaticData",
));

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

function buildAveragePriceEntry(price, adjustedPrice = null) {
  const normalizedAverage = Number(price) || 0;
  const normalizedAdjusted =
    adjustedPrice == null ? normalizedAverage : Number(adjustedPrice) || 0;

  return buildKeyVal([
    ["averagePrice", normalizedAverage],
    ["adjustedPrice", normalizedAdjusted],
  ]);
}

let staticLocationRowsById = null;

function buildLocationRow(locationID, locationName, position = null) {
  return [
    locationID,
    locationName,
    Number(position && position.x) || 0.0,
    Number(position && position.y) || 0.0,
    Number(position && position.z) || 0.0,
    null,
  ];
}

function getStaticLocationRowsById() {
  if (staticLocationRowsById) {
    return staticLocationRowsById;
  }

  const rowsById = new Map();
  const addLocation = (locationID, locationName, position = null) => {
    const numericId = Number(locationID) || 0;
    if (numericId <= 0 || !locationName) {
      return;
    }
    rowsById.set(
      numericId,
      buildLocationRow(numericId, locationName, position),
    );
  };

  for (const system of readStaticRows(TABLE.SOLAR_SYSTEMS)) {
    addLocation(system.solarSystemID, system.solarSystemName, system.position);
  }
  for (const station of readStaticRows(TABLE.STATIONS)) {
    addLocation(station.stationID, station.stationName, station.position);
  }
  for (const celestial of readStaticRows(TABLE.CELESTIALS)) {
    addLocation(celestial.itemID, celestial.itemName, celestial.position);
  }
  for (const stargate of readStaticRows(TABLE.STARGATES)) {
    addLocation(stargate.itemID, stargate.itemName, stargate.position);
  }

  staticLocationRowsById = rowsById;
  return rowsById;
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
      const numericId = Number(id) || 0;
      if (numericId <= 0) {
        continue;
      }

      // Check if this is a character ID we know about
      const charData = characters[String(numericId)];
      if (charData) {
        rows.push([
          numericId, // ownerID
          charData.characterName || "Unknown", // ownerName
          charData.typeID || 1373, // typeID
          charData.gender || 1, // gender
          null, // ownerNameID
        ]);
        continue;
      }

      const staticOwner = getStaticOwnerRecord(id, session);
      if (staticOwner) {
        rows.push([
          staticOwner.ownerID,
          staticOwner.ownerName,
          staticOwner.typeID,
          staticOwner.gender,
          null,
        ]);
        continue;
      }

      // NPC corps (1000000-1999999 range)
      if (numericId >= 1000000 && numericId < 2000000) {
        rows.push([
          numericId,
          `Corporation ${numericId}`,
          2, // typeID = 2 (Corporation)
          0, // gender
          null, // ownerNameID
        ]);
        continue;
      }

      // Unknown entities — return placeholder
      rows.push([numericId, `Entity ${numericId}`, 1, 0, null]);
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
    const station = getStationRecord(session);
    const locationRowsById = new Map();
    const staticRowsById = getStaticLocationRowsById();

    if (station) {
      locationRowsById.set(
        station.stationID,
        buildLocationRow(station.stationID, station.stationName),
      );
      locationRowsById.set(
        station.orbitID,
        buildLocationRow(station.orbitID, station.stationName),
      );
      locationRowsById.set(
        station.solarSystemID,
        buildLocationRow(
          station.solarSystemID,
          station.solarSystemName || `System ${station.solarSystemID}`,
        ),
      );
      locationRowsById.set(
        station.constellationID,
        buildLocationRow(
          station.constellationID,
          station.constellationName || `Constellation ${station.constellationID}`,
        ),
      );
      locationRowsById.set(
        station.regionID,
        buildLocationRow(
          station.regionID,
          station.regionName || `Region ${station.regionID}`,
        ),
      );
    }

    const shipNameById = new Map();
    const charNameById = new Map();
    for (const [charId, c] of Object.entries(characters)) {
      const cid = parseInt(charId, 10);
      if (Number.isInteger(cid)) {
        charNameById.set(cid, c.characterName || `Character ${cid}`);
      }
      for (const ship of getCharacterShips(cid)) {
        if (ship && Number.isInteger(ship.shipID)) {
          shipNameById.set(ship.shipID, ship.shipName || "Ship");
        }
      }
    }

    const rows = [];

    for (const id of requestedIds) {
      const numericId = Number(id) || 0;
      if (numericId <= 0) {
        continue;
      }

      if (locationRowsById.has(numericId)) {
        rows.push(locationRowsById.get(numericId));
      } else if (staticRowsById.has(numericId)) {
        rows.push(staticRowsById.get(numericId));
      } else if (shipNameById.has(numericId)) {
        rows.push(buildLocationRow(numericId, shipNameById.get(numericId)));
      } else if (charNameById.has(numericId)) {
        rows.push(buildLocationRow(numericId, charNameById.get(numericId)));
      } else if (numericId >= 60000000 && numericId < 64000000) {
        rows.push(buildLocationRow(numericId, `Station ${numericId}`));
      } else if (numericId >= 30000000 && numericId < 40000000) {
        rows.push(buildLocationRow(numericId, `System ${numericId}`));
      } else {
        rows.push(buildLocationRow(numericId, `Location ${numericId}`));
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
      const numericId = Number(id) || 0;
      if (numericId <= 0) {
        continue;
      }

      const staticOwner = getStaticOwnerRecord(numericId, session);
      rows.push([
        numericId,
        staticOwner && staticOwner.tickerName ? staticOwner.tickerName : "CORP",
        0,
        0,
        0,
        0,
        0,
        0,
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
    const ships = readStaticRows(TABLE.SHIP_TYPES);
    return {
      type: "dict",
      entries: ships
        .filter((ship) => Number(ship.typeID) > 0 && Number(ship.basePrice) > 0)
        .map((ship) => [
          Number(ship.typeID),
          buildAveragePriceEntry(ship.basePrice),
        ]),
    };
  }
}

module.exports = ConfigService;



