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
              items: ["charID", "online", "stationID", "solarSystemID"],
            },
          ],

          ["RowClass", { type: "token", value: "util.Row" }],

          [
            "lines",
            {
              type: "list",
              items: [
                [
                  session.characterID, // fix: change session.charid to session.characterID to fix null character
                  true,
                  session.stationid,
                  session.solarsystemid2,
                ],
              ],
            },
          ],
        ],
      },
    };
  }
}

module.exports = MapService;
