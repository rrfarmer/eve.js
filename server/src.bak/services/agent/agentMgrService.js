const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class AgentMgrService extends BaseService {
  constructor() {
    super("agentMgr");
  }

  Handle_GetAgents(args, session, kwargs) {
    log.debug("[AgentMgrService] GetAgents called");

    // V23.02 has no Rowset class (util.Rowset, utillib.Rowset, dbutil.CRowset
    // all fail with "'module' has no attribute 'Rowset'").
    // Return util.KeyVal — the agents.py Clone/AddField calls will throw
    // non-fatal tasklet exceptions that are logged but don't crash the client.
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
                "agentID",
                "agentTypeID",
                "divisionID",
                "level",
                "stationID",
                "corporationID",
                "solarsystemID",
                "factionID",
              ],
            },
          ],
          [
            "RowClass",
            { type: "token", value: "carbon.common.script.sys.row.Row" },
          ],
          ["lines", { type: "list", items: [] }],
        ],
      },
    };
  }
  Handle_GetMyJournalDetails(args, session, kwargs) {
    log.debug("[AgentMgrService] GetMyJournalDetails called");
    return [
      { type: "list", items: [] }, // missions
      { type: "list", items: [] }, // research
    ];
  }
}

module.exports = AgentMgrService;
