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
    log.info(`[StationSvc] GetStation(${stationID})`);

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["stationID", stationID],
          ["stationName", "Jita IV - Moon 4 - Caldari Navy Assembly Plant"],
          ["stationTypeID", 1529],
          ["solarSystemID", 30000142],
          ["constellationID", 20000020],
          ["regionID", 10000002],
          ["ownerID", 1000127], // guristas pirates
          ["corporationID", 1000127],  // guristas pirates
          // ["ownerID", 1000009], // caldari provisions
          // ["corporationID", 1000009], // caldari provisions
          ["dockingCostPerVolume", 0.0],
          ["maxShipVolumeDockable", 50000000.0],
          ["officeRentalCost", 10000],
          ["operationID", 22],
          ["stationTypeID", 1529],
          ["security", 1.0],
          ["x", 0.0],
          ["y", 0.0],
          ["z", 0.0],
          ["reprocessingEfficiency", 0.5],
          ["reprocessingStationsTake", 0.05],
          ["reprocessingHangarFlag", 4],
          ["serviceMask", 4294967295],
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
    const ownerID = 1000127; // IMPORTANT: REPLACE THIS WITH ACTUAL OWNER .. i made it guristas for gits and shiggles
    const stationID = session.stationID
    const operationID = 22;
    const stationTypeID = 1529;

    return [ownerID, stationID, operationID, stationTypeID];
  }

  // TODO: return all active users in the station
  // right now we are just retuning one user (the current user)
  Handle_GetGuests(args, session) {
    log.debug("[StationSvc] GetGuests");
    const charId = session && session.characterID ? session.characterID : 1;
    const corpId =
      session && session.corporationID ? session.corporationID : 1000009;
    const allianceId = session && session.allianceID ? session.allianceID : 0;
    const warFactionId =
      session && session.warFactionID ? session.warFactionID : 0;

    // Return a list containing at least the current user's guest tuple
    // The python client expects: for charID, corpID, allianceID, warFactionID in guests:
    return {
      type: "list",
      items: [[charId, corpId, allianceId, warFactionId]],
    };
  }

  // TODO: make this work
  // find out what it wants
  Handle_GetSolarSystem(args, session) {
    log.debug("[StationSvc] GetSolarSystem");
    return null;
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
