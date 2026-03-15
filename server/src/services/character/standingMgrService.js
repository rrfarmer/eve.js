const BaseService = require("../baseService");
const log = require("../../utils/logger");
const { getCharacterRecord } = require("./characterState");

// Standings use a real Rowset so the client can call both .Index() and .Filter().
// The Rowset with [fromID, toID, standing] columns handles both methods correctly.
// EVE's client uses IndexedRowset mapped to fromID. If a key is missing, it throws KeyError!
// We must populate it with None and common session IDs so standingsvc doesn't crash on dictionary access.
function buildStandingsRowset(session, rows = []) {
  const charId = session ? session.characterID : 140000001;
  const charRecord = getCharacterRecord(charId) || {};
  const corpId = session ? session.corpid : charRecord.corporationID || 0;
  const allianceId = session && session.allianceid ? session.allianceid : charRecord.allianceID || null;
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

  const rowMap = new Map();
  for (const fromID of uniqueIds) {
    for (const toID of uniqueIds) {
      if (fromID !== toID) {
        rowMap.set(`${String(fromID)}::${String(toID)}`, {
          type: "list",
          items: [fromID, toID, 0.0],
        });
      }
    }
  }

  for (const entry of rows) {
    if (!entry || entry.fromID === entry.toID) {
      continue;
    }

    rowMap.set(`${String(entry.fromID)}::${String(entry.toID)}`, {
      type: "list",
      items: [
        entry.fromID,
        entry.toID,
        Number(entry.standing) || 0.0,
      ],
    });
  }

  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", rowDescriptor],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: [...rowMap.values()] }],
      ],
    },
  };
}

function getStandingData(session, key) {
  const charId = session ? session.characterID : 0;
  const charData = getCharacterRecord(charId) || {};
  const source =
    charData.standingData && typeof charData.standingData === "object"
      ? charData.standingData
      : {};
  return Array.isArray(source[key]) ? source[key] : [];
}

class StandingMgrService extends BaseService {
  constructor(name = "standingMgr") {
    super(name);
  }

  Handle_GetNPCNPCStandings(args, session) {
    log.debug("[StandingMgr] GetNPCNPCStandings called");
    return buildStandingsRowset(session, getStandingData(session, "npc"));
  }

  Handle_GetCharStandings(args, session) {
    log.debug("[StandingMgr] GetCharStandings called");
    return buildStandingsRowset(session, getStandingData(session, "char"));
  }

  Handle_GetCorpStandings(args, session) {
    log.debug("[StandingMgr] GetCorpStandings called");
    return buildStandingsRowset(session, getStandingData(session, "corp"));
  }
}

class Standing2Service extends StandingMgrService {
  constructor() {
    super("standing2");
  }
}

module.exports = {
  StandingMgrService,
  Standing2Service,
};
