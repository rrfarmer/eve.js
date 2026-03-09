const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class ShipService extends BaseService {
  constructor() {
    super("ship");
  }

  Handle_GetDirtTimestamp(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[Ship] GetDirtTimestamp(shipID=${shipID})`);

    // FILETIME ticks (100ns since 1601) as python long-compatible value.
    return BigInt(Date.now()) * 10000n + 116444736000000000n;
  }

  Handle_SetDirtTimestamp(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    const ts = args && args.length > 1 ? args[1] : null;
    log.debug(`[Ship] SetDirtTimestamp(shipID=${shipID}, ts=${String(ts)})`);
    return null;
  }

  Handle_GetShipKillCounter(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[Ship] GetShipKillCounter(shipID=${shipID})`);
    return [0, 1];
  }

  Handle_GetKillCounter(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[Ship] GetKillCounter(shipID=${shipID})`);
    return 0;
  }

  Handle_GetDisplayKillCounterValue(args, session, kwargs) {
    log.debug("[Ship] GetDisplayKillCounterValue");
    return 1;
  }

  Handle_GetFittedItems(args, session, kwargs) {
    const shipID = args && args.length > 0 ? args[0] : null;
    log.debug(`[Ship] GetFittedItems(shipID=${shipID})`);
    return { type: "dict", entries: [] };
  }

  Handle_GetModules(args, session, kwargs) {
    log.debug("[Ship] GetModules");
    return { type: "list", items: [] };
  }

  Handle_GetTurretModules(args, session, kwargs) {
    log.debug("[Ship] GetTurretModules");
    return { type: "list", items: [] };
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[Ship] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[Ship] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

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

      log.debug(`[Ship] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[Ship] Unhandled method fallback: ${method}`);
    return null;
  }
}

module.exports = ShipService;
