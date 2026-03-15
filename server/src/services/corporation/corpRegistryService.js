const BaseService = require("../baseService");
const path = require("path");
const log = require("../../utils/logger");
const { buildList } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { buildDict } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  getCorporationInfoRecord,
} = require(path.join(__dirname, "./corporationState"));

function resolveCorporationID(session) {
  return (
    (session && (session.corporationID || session.corpid)) ||
    1000044
  );
}

function resolveCEOID(session) {
  return (
    (session && (session.characterID || session.charid)) ||
    null
  );
}

function buildCorporationKeyVal(session) {
  const corporationID = resolveCorporationID(session);
  const info =
    getCorporationInfoRecord(corporationID) || {
      corporationID,
      corporationName: "Your Corp Name",
      ticker: "TICKR",
      ceoID: resolveCEOID(session),
      creatorID: resolveCEOID(session),
      allianceID: (session && (session.allianceID || session.allianceid)) || null,
      description: "A custom corporation.",
      url: "",
      stationID: null,
      deleted: 0,
      taxRate: 0.0,
      memberCount: 1,
      shares: 1000,
      loyaltyPointTaxRate: 0.0,
      friendlyFire: 0,
    };
  const row = [
    info.corporationID,
    info.corporationName,
    info.ticker,
    info.ceoID,
    1,
  ];

  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["corporationID", info.corporationID],
        ["corporationName", info.corporationName],
        ["ticker", info.ticker],
        ["tickerName", info.tickerName || info.ticker],
        ["ceoID", info.ceoID],
        ["creatorID", info.creatorID],
        ["allianceID", info.allianceID],
        ["membership", 1],
        [
          "header",
          [
            "corporationID",
            "corporationName",
            "ticker",
            "ceoID",
            "membership",
          ],
        ],
        ["row", row],
        ["line", row],
        ["description", info.description || ""],
        ["url", info.url || ""],
        ["stationID", info.stationID],
        ["deleted", info.deleted],
        ["taxRate", info.taxRate],
        ["loyaltyPointTaxRate", info.loyaltyPointTaxRate || 0.0],
        ["friendlyFire", info.friendlyFire || 0],
        ["memberCount", info.memberCount],
        ["shares", info.shares],
        ["shape1", info.shape1 ?? null],
        ["shape2", info.shape2 ?? null],
        ["shape3", info.shape3 ?? null],
        ["color1", info.color1 ?? null],
        ["color2", info.color2 ?? null],
        ["color3", info.color3 ?? null],
        ["typeface", info.typeface ?? null],
      ],
    },
  };
}

// Static counter for generating unique bound object IDs

class CorpRegistryService extends BaseService {
  constructor() {
    super("corpRegistry");
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[CorpRegistry] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[PopulationCap] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))} kwargs=${JSON.stringify(kwargs, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );

    // Generate a unique bound object ID
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    // OID = (idString, timestamp)
    const oid = [idString, now];

    // Handle optional nested call
    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[PopulationCap] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    // Return 2-tuple: [SubStruct(SubStream(OID)), callResult]
    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  Handle_GetEveOwners(args, session, kwargs) {
    log.debug("[CorpRegistry] GetEveOwners called");
    return [];
  }

  Handle_List(args, session) {
    log.debug("[CorpRegistry] List called");
    return { type: "list", items: [] };
  }

  Handle_GetAggressionSettings(args, session) {
    log.debug("[CorpSvc] GetAggressionSettings");
    return { type: "dict", entries: [] };
  }

  Handle_GetInfoWindowDataForChar(args, session) {
    const charId =
      args && args.length > 0
        ? Number(args[0]) || 0
        : session
          ? session.characterID || session.charid || 0
          : 0;
    const charData = charId ? getCharacterRecord(charId) || {} : {};

    log.debug(`[CorpRegistry] GetInfoWindowDataForChar(${charId})`);

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          [
            "corpID",
            charData.corporationID || (session ? session.corporationID || session.corpid : 1000044),
          ],
          [
            "allianceID",
            charData.allianceID || (session ? session.allianceID || session.allianceid : null),
          ],
          ["title", charData.title || ""],
        ],
      },
    };
  }

  Handle_GetCorporation(args, session) {
    log.debug("[CorpRegistry] GetCorporation called");
    return buildCorporationKeyVal(session);
  }

  Handle_GetCorporateContacts(args, session) {
    log.debug("[CorpRegistry] GetCorporateContacts called");
    return buildDict([]);
  }

  Handle_GetMyApplications(args, session) {
    log.debug("[CorpRegistry] GetMyApplications called");
    return buildDict([]);
  }

  Handle_GetMyOldApplications(args, session) {
    log.debug("[CorpRegistry] GetMyOldApplications called");
    return buildList([]);
  }

  Handle_GetApplications(args, session) {
    log.debug("[CorpRegistry] GetApplications called");
    return buildDict([]);
  }

  Handle_GetOldApplications(args, session) {
    log.debug("[CorpRegistry] GetOldApplications called");
    return buildList([]);
  }

  Handle_GetCorpWelcomeMail(args, session) {
    log.debug("[CorpRegistry] GetCorpWelcomeMail called");
    return "";
  }
}

module.exports = CorpRegistryService;
