/**
 * Station Service (stationSvc)
 *
 * Handles station-related queries from the client.
 * Called after character selection to get info about the station
 * the character is docked in.
 * 
 * TODO: replace static return data (e.g. GetGuests) with accurate dynamic data.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getStationRecord,
  buildStationServiceMask,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const { buildKeyVal } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { listOnlineGuestsInStation } = require(path.join(
  __dirname,
  "./stationPresence",
));

class StationService extends BaseService {
  constructor(name = "station") {
    super(name);
  }

  // the function below is never called! (not needed)
  Handle_GetStation(args, session) {
    // log session to see if we can send back the session data instead of static data
    console.log(`session data from station::GetStation() : ${JSON.stringify(session)}`)
    console.log(`args data from station::GetStation() : ${JSON.stringify(args)}`)

    const stationID = args && args.length > 0 ? args[0] : 60003760;
    const station = getStationRecord(session, stationID);
    log.info(`[StationSvc] GetStation(${stationID})`);

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["stationID", station.stationID],
          ["stationName", station.stationName],
          ["stationTypeID", station.stationTypeID],
          ["solarSystemID", station.solarSystemID],
          ["constellationID", station.constellationID],
          ["regionID", station.regionID],
          ["ownerID", station.ownerID],
          ["corporationID", station.corporationID],
          ["dockingCostPerVolume", station.dockingCostPerVolume],
          ["maxShipVolumeDockable", Number(station.maxShipVolumeDockable)],
          ["officeRentalCost", station.officeRentalCost],
          ["operationID", station.operationID],
          ["stationTypeID", station.stationTypeID],
          ["security", station.security],
          ["x", 0.0],
          ["y", 0.0],
          ["z", 0.0],
          ["reprocessingEfficiency", 0.5],
          ["reprocessingStationsTake", station.reprocessingStationsTake],
          ["reprocessingHangarFlag", station.reprocessingHangarFlag],
          ["serviceMask", buildStationServiceMask()],
        ],
      },
    };
  }

  // args is an empty array for this function (at least on first load in the station)
  // for this function, we can send back the session data instead of static data
  Handle_GetStationItemBits(args, session) {
    log.debug(`[StationSvc] GetStationItemBits(${session.stationID})`);

    // The client builds a Row from this tuple:
    // ['ownerID', 'itemID', 'operationID', 'stationTypeID']

    // owner id (which should be a corporation (possibly faction)) is not in session data.
    // TODO: either set up database with all station data, or always return static data (same corp every time)
    const station = getStationRecord(session);
    const ownerID = station.ownerID;
    const stationID = station.stationID;
    const operationID = station.operationID;
    const stationTypeID = station.stationTypeID;

    return [ownerID, stationID, operationID, stationTypeID];
  }

  // TODO: return all active users in the station
  // right now we are just retuning one user (the current user)
  Handle_GetGuests(args, session) {
    log.debug("[StationSvc] GetGuests");
    const stationID =
      Number(
        (session && (session.stationid || session.stationID || session.locationid)) ||
        0,
      ) || 60003760;
    const guests = listOnlineGuestsInStation(stationID);

    return {
      type: "list",
      items: guests,
    };
  }

  // TODO: make this work
  // find out what it wants
  Handle_GetSolarSystem(args, session) {
    log.debug("[StationSvc] GetSolarSystem");
    const station = getStationRecord(session);
    return buildKeyVal([
      ["solarSystemID", station.solarSystemID],
      ["solarSystemName", station.solarSystemName],
      ["constellationID", station.constellationID],
      ["constellationName", station.constellationName || ""],
      ["regionID", station.regionID],
      ["regionName", station.regionName || ""],
      ["security", Number(station.security || 0)],
      ["factionID", station.factionID || null],
      ["factionName", station.factionName || ""],
      ["stationID", station.stationID],
      ["stationName", station.stationName],
      ["ownerID", station.ownerID],
      ["ownerName", station.ownerName || station.corporationName || ""],
      ["corporationID", station.corporationID || station.ownerID],
      ["corporationName", station.corporationName || station.ownerName || ""],
      ["orbitID", station.orbitID || null],
      ["stationTypeID", station.stationTypeID || null],
    ]);
  }
}
class StationSvcAlias extends StationService {
  constructor() {
    super("stationSvc");
  }
}

module.exports = {
  StationService,
  StationSvcAlias,
};
