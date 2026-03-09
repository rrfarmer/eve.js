const BaseService = require("../baseService");
const log = require("../../utils/logger");

// Standings use a real Rowset so the client can call both .Index() and .Filter().
// The Rowset with [fromID, toID, standing] columns handles both methods correctly.
// EVE's client uses IndexedRowset mapped to fromID. If a key is missing, it throws KeyError!
// We must populate it with None and common session IDs so standingsvc doesn't crash on dictionary access.
function emptyStandingsRowset(session) {
  const charId = session ? session.characterID : 140000001;
  const corpId = session ? session.corpid : 1000044;
  const allianceId = session && session.allianceid ? session.allianceid : null;
  const factionId = session && session.factionid ? session.factionid : null;
  const warFactionId =
    session && session.warfactionid ? session.warfactionid : null;

  // We add 'null' explicitly to handle `session.allianceid` and `session.factionid` being None.
  // We also add corpId, charId, etc. so that any lookup by the GUI resolves to 0.0 instead of a crash.
  const idsToSeed = [
    charId,
    corpId,
    allianceId,
    factionId,
    warFactionId,
    null,
    0,
    1,
    -1,
  ];

  // Seed all known NPC factions (500000 through 500050)
  for (let i = 500000; i <= 500050; i++) {
    idsToSeed.push(i);
  }

  // Filter unique values to avoid duplicate keys in the IndexedRowset
  const uniqueIds = Array.from(new Set(idsToSeed));

  const rowDescriptor = {
    type: "list",
    items: ["fromID", "toID", "standing"],
  };

  const rows = [];
  for (const fromID of uniqueIds) {
    for (const toID of uniqueIds) {
      if (fromID !== toID) {
        rows.push({
          type: "list",
          items: [fromID, toID, 0.0],
        });
      }
    }
  }

  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", rowDescriptor],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: rows }],
      ],
    },
  };
}

class StandingMgrService extends BaseService {
  constructor() {
    super("standingMgr");
  }

  Handle_GetNPCNPCStandings(args, session) {
    log.debug("[StandingMgr] GetNPCNPCStandings called");
    return emptyStandingsRowset(session);
  }

  Handle_GetCharStandings(args, session) {
    log.debug("[StandingMgr] GetCharStandings called");
    return emptyStandingsRowset(session);
  }

  Handle_GetCorpStandings(args, session) {
    log.debug("[StandingMgr] GetCorpStandings called");
    return emptyStandingsRowset(session);
  }
}

module.exports = StandingMgrService;
