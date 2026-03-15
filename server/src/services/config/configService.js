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
const { findShipItemById } = require(path.join(
  __dirname,
  "../inventory/itemStore",
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
const {
  getAllianceShortNameRecord,
  getCorporationRecord,
  getCorporationStationSolarSystems,
  getOwnerLookupRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));

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

function normalizeSolarSystemID(value, fallback = null) {
  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return numericValue;
  }
  return fallback;
}

function resolveSessionSolarSystemID(session, fallback = null) {
  return normalizeSolarSystemID(
    session &&
      (session.solarSystemID ??
        session.solarsystemid ??
        session.solarSystemID2 ??
        session.solarsystemid2),
    fallback,
  );
}

function buildLocationRow(
  locationID,
  locationName,
  solarSystemID = null,
  position = null,
) {
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
  const addLocation = (
    locationID,
    locationName,
    solarSystemID = null,
    position = null,
  ) => {
    const numericId = Number(locationID) || 0;
    if (numericId <= 0 || !locationName) {
      return;
    }
    rowsById.set(
      numericId,
      buildLocationRow(numericId, locationName, solarSystemID, position),
    );
  };

  for (const system of readStaticRows(TABLE.SOLAR_SYSTEMS)) {
    addLocation(
      system.solarSystemID,
      system.solarSystemName,
      system.solarSystemID,
      system.position,
    );
  }
  for (const station of readStaticRows(TABLE.STATIONS)) {
    addLocation(
      station.stationID,
      station.stationName,
      station.solarSystemID,
      station.position,
    );
  }
  for (const celestial of readStaticRows(TABLE.CELESTIALS)) {
    addLocation(
      celestial.itemID,
      celestial.itemName,
      celestial.solarSystemID,
      celestial.position,
    );
  }
  for (const stargate of readStaticRows(TABLE.STARGATES)) {
    addLocation(
      stargate.itemID,
      stargate.itemName,
      stargate.solarSystemID,
      stargate.position,
    );
  }

  staticLocationRowsById = rowsById;
  return rowsById;
}

function buildShipItemOwnerRow(itemID) {
  const shipItem = findShipItemById(itemID);
  if (!shipItem) {
    return null;
  }

  return [
    Number(shipItem.itemID) || Number(itemID) || 0,
    shipItem.shipName || shipItem.itemName || `Ship ${itemID}`,
    Number(shipItem.shipTypeID || shipItem.typeID) || 606,
    0,
    null,
  ];
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

      const shipItemOwnerRow = buildShipItemOwnerRow(numericId);
      if (shipItemOwnerRow) {
        rows.push(shipItemOwnerRow);
        continue;
      }

      const staticOwner = getStaticOwnerRecord(id, session);
      const dynamicOwner = getOwnerLookupRecord(numericId);
      const ownerRecord = dynamicOwner || staticOwner;
      if (ownerRecord) {
        rows.push([
          ownerRecord.ownerID,
          ownerRecord.ownerName,
          ownerRecord.typeID,
          ownerRecord.gender,
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
 * Live client logs show this RPC still returns the classic 6-column tuple:
 * [locationID, locationName, x, y, z, locationNameID]
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
    const sessionSolarSystemID = resolveSessionSolarSystemID(
      session,
      normalizeSolarSystemID(station && station.solarSystemID, null),
    );
    const locationRowsById = new Map();
    const staticRowsById = getStaticLocationRowsById();

    if (station) {
      locationRowsById.set(
        station.stationID,
        buildLocationRow(
          station.stationID,
          station.stationName,
          station.solarSystemID,
          station.position,
        ),
      );
      locationRowsById.set(
        station.orbitID,
        buildLocationRow(
          station.orbitID,
          station.orbitName || station.stationName,
          station.solarSystemID,
        ),
      );
      locationRowsById.set(
        station.solarSystemID,
        buildLocationRow(
          station.solarSystemID,
          station.solarSystemName || `System ${station.solarSystemID}`,
          station.solarSystemID,
        ),
      );
      locationRowsById.set(
        station.constellationID,
        buildLocationRow(
          station.constellationID,
          station.constellationName || `Constellation ${station.constellationID}`,
          null,
        ),
      );
      locationRowsById.set(
        station.regionID,
        buildLocationRow(
          station.regionID,
          station.regionName || `Region ${station.regionID}`,
          null,
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
        rows.push(
          buildLocationRow(
            numericId,
            shipNameById.get(numericId),
            sessionSolarSystemID,
          ),
        );
      } else if (charNameById.has(numericId)) {
        rows.push(
          buildLocationRow(
            numericId,
            charNameById.get(numericId),
            sessionSolarSystemID,
          ),
        );
      } else if (numericId >= 60000000 && numericId < 64000000) {
        rows.push(
          buildLocationRow(numericId, `Station ${numericId}`, sessionSolarSystemID),
        );
      } else if (numericId >= 30000000 && numericId < 40000000) {
        rows.push(buildLocationRow(numericId, `System ${numericId}`, numericId));
      } else {
        rows.push(
          buildLocationRow(numericId, `Location ${numericId}`, sessionSolarSystemID),
        );
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

    const rows = allianceIDs
      .map((allianceID) => getAllianceShortNameRecord(allianceID))
      .filter(Boolean)
      .map((record) => [record.allianceID, record.shortName]);

    if (rows.length === 0) {
      return [];
    }

    return [["allianceID", "shortName"], rows];
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
      const dynamicOwner = getOwnerLookupRecord(numericId);
      const corporationRecord = getCorporationRecord(numericId);
      const ownerRecord = dynamicOwner || staticOwner;
      rows.push([
        numericId,
        ownerRecord && ownerRecord.tickerName ? ownerRecord.tickerName : "CORP",
        corporationRecord ? corporationRecord.shape1 ?? null : null,
        corporationRecord ? corporationRecord.shape2 ?? null : null,
        corporationRecord ? corporationRecord.shape3 ?? null : null,
        corporationRecord ? corporationRecord.color1 ?? null : null,
        corporationRecord ? corporationRecord.color2 ?? null : null,
        corporationRecord ? corporationRecord.color3 ?? null : null,
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

  Handle_GetStationSolarSystemsByOwner(args, session) {
    const ownerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[ConfigService] GetStationSolarSystemsByOwner(${ownerID})`);
    return {
      type: "list",
      items: getCorporationStationSolarSystems(ownerID),
    };
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


