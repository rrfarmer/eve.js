const BaseService = require("../baseService");
const path = require("path");
const log = require("../../utils/logger");

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

  Handle_GetCorporation(args, session) {
    log.debug("[CorpRegistry] GetCorporation called");
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["corporationID", session.corpid],
          [
            "header",
            {
              type: "list",
              items: [
                "corporationID",
                "corporationName",
                "ticker",
                "ceoID",
                "membership",
              ],
            },
          ],
          [
            "row",
            [
              session.corpid,
              "Your Corp Name", // Replace with your desired name
              "TICKR", // Replace with your desired ticker
              session.charid, // Setting you as the CEO to satisfy the menu check
              1, // Membership count
            ],
          ],
          // These additional fields are often checked by bco_corporations.py
          ["description", "A custom corporation."],
          ["url", "http://localhost"],
          ["taxRate", 0.0],
          ["memberCount", 1],
          ["shares", 1000],
        ],
      },
    };
  }

  Handle_GetMyApplications(args, session) {
    log.debug("[CorpRegistry] GetMyApplications called");
    return {
      type: "object",
      name: "eve.common.script.sys.rowset.Rowset",
      args: {
        type: "dict",
        entries: [
          [
            "header",
            [
              "corporationID",
              "characterID",
              "applicationText",
              "applicationDateTime",
              "status",
            ],
          ],
          ["RowClass", { type: "token", value: "util.Row" }],
          ["lines", []],
        ],
      },
    };
  }
}

module.exports = CorpRegistryService;
