const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class InsuranceService extends BaseService {
  constructor() {
    super("insuranceSvc");
  }

  Handle_GetContracts(args, session) {
    log.debug("[InsuranceSvc] GetContracts");
    return { type: "list", items: [] };
  }

  Handle_GetItemsToInsure(args, session) {
    log.debug("[InsuranceSvc] GetItemsToInsure");
    return { type: "list", items: [] };
  }

  Handle_GetInsurancePrice(args, session) {
    log.debug("[InsuranceSvc] GetInsurancePrice");
    return 0;
  }

  Handle_InsureShip(args, session) {
    log.debug("[InsuranceSvc] InsureShip");
    return null;
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[InsuranceSvc] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const nestedCall = args && args.length > 1 ? args[1] : null;

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

      log.debug(`[InsuranceSvc] MachoBindObject nested call: ${methodName}`);
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

    log.warn(`[InsuranceSvc] Unhandled method fallback: ${method}`);
    return null;
  }
}

module.exports = InsuranceService;
