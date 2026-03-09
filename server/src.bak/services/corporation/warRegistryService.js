const BaseService = require("../baseService");
const path = require("path");
const log = require("../../utils/logger");

// Static counter for generating unique bound object IDs

class WarRegistryService extends BaseService {
  constructor() {
    super("warRegistry");
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[WarRegistry] MachoResolveObject called");
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

  Handle_GetWars(args, session) {
    log.debug("[WarCSO] GetWars called");

    // Duck-type the IndexRowset by returning an empty dictionary
    return {
      type: "dict",
      entries: [],
    };
  }

  // Handle_GetWars(args, session) {
  //   log.debug("[WarRegistry] GetWars called");

  //   const header = {
  //     type: "objectex1",
  //     name: "blue.DBRowDescriptor",
  //     args: [
  //       [
  //         ["warID", 3],
  //         ["declaredByID", 3],
  //         ["againstID", 3],
  //         ["timeDeclared", 6],
  //         ["timeFinished", 6],
  //         ["retracted", 2],
  //         ["retractedBy", 3],
  //         ["billID", 3],
  //         ["mutual", 2],
  //       ],
  //     ],
  //   };

  //   return {
  //     type: "object",
  //     name: "eve.common.script.sys.rowset.IndexRowset",
  //     args: {
  //       type: "dict",
  //       entries: [
  //         ["header", header],
  //         ["RowClass", { type: "token", value: "util.Row" }],
  //         ["idName", "warID"],
  //         ["items", { type: "dict", entries: [] }],
  //       ],
  //     },
  //   };
  // }
}

module.exports = WarRegistryService;
