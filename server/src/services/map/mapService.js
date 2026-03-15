/**
 * Map Service
 *
 * Handles map-related queries from the client.
 * The character selection screen calls GetSecurityModifiedSystems()
 * to display modified security status next to solar system names.
 */

const path = require("path");
const fs = require("fs");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  buildStationServiceMask,
} = require(path.join(__dirname, "../_shared/stationStaticData"));

class MapService extends BaseService {
  constructor() {
    super("map");
  }

  /**
   * GetSecurityModifiedSystems — returns systems whose security has been
   * modified (e.g. by Triglavian invasions).
   *
   * Client does:
   *   modifiedSecuritySystems = mapSvc.GetSecurityModifiedSystems()
   *   try:
   *       indexedSystems = modifiedSecuritySystems.Index('solarSystemID')
   *       ...
   *   except AttributeError:
   *       pass
   *   return ''
   *
   * V23.02 does NOT have the dbutil C-extension module, so returning a
   * dbutil.CRowset token causes ImportError: No module named dbutil.
   * Instead we return a simple util.KeyVal — the client's AttributeError
   * guard catches the missing .Index() and gracefully returns ''.
   */
  Handle_GetSecurityModifiedSystems(args, session, kwargs) {
    log.debug("[MapService] GetSecurityModifiedSystems called");

    // V23.02 has NONE of: dbutil.CRowset, util.Rowset, util.IndexRowset.
    // The only working PyObject type is util.KeyVal, but it lacks .Index().
    //
    // Approach: set KeyVal's "Index" attribute to the util.Row CLASS via token.
    // util.Row is in the marshal string table (entry 80), so it's whitelisted.
    // We know `import util` succeeds (util.Rowset gave "'module' has no attr").
    //
    // When client calls: modifiedSecuritySystems.Index('solarSystemID')
    // it calls: util.Row('solarSystemID') → creates an empty Row object
    // Then: 30000142 in Row(...) → False (empty row, nothing matches)
    // So no security modifier text is applied — correct for no modified systems.
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [["Index", { type: "token", value: "util.Row" }]],
      },
    };
  }

  Handle_GetStationInfo(args, session) {
    const stations = [...worldData.ensureLoaded().stations].sort(
      (left, right) => Number(left.stationID) - Number(right.stationID),
    );
    const sharedServiceMask = buildStationServiceMask();

    return {
      type: "object",
      name: "eve.common.script.sys.rowset.Rowset",
      args: {
        type: "dict",
        entries: [
          [
            "header",
            {
              type: "list",
              items: [
                "stationID",
                "solarSystemID",
                "operationID",
                "stationTypeID",
                "ownerID",
                "serviceMask",
                "constellationID",
                "regionID",
              ],
            },
          ],

          ["RowClass", { type: "token", value: "util.Row" }],

          [
            "lines",
            {
              type: "list",
              items: stations.map((station) => [
                Number(station.stationID) || null,
                Number(station.solarSystemID) || null,
                Number(station.operationID) || null,
                Number(station.stationTypeID) || null,
                Number(station.corporationID || station.ownerID) || null,
                sharedServiceMask,
                Number(station.constellationID) || null,
                Number(station.regionID) || null,
              ]),
            },
          ],
        ],
      },
    };
  }

  Handle_GetStationCount(args, session) {
    const world = worldData.ensureLoaded();
    const stationCountBySystemID = new Map();

    for (const system of world.solarSystems) {
      stationCountBySystemID.set(Number(system.solarSystemID) || 0, 0);
    }

    for (const station of world.stations) {
      const solarSystemID = Number(station.solarSystemID) || 0;
      stationCountBySystemID.set(
        solarSystemID,
        (stationCountBySystemID.get(solarSystemID) || 0) + 1,
      );
    }

    return {
      type: "list",
      items: [...stationCountBySystemID.entries()].sort(
        (left, right) => left[0] - right[0],
      ),
    };
  }
}

module.exports = MapService;
