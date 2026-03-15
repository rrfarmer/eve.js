const BaseService = require("../baseService");
const log = require("../../utils/logger");

class SovMgrService extends BaseService {
  constructor() {
    super("sovMgr");
  }

  Handle_GetSovStructuresInfoForLocalSolarSystem(args, session) {
    const solarSystemID =
      Number(session && (session.solarsystemid2 || session.solarsystemid)) || 0;
    log.debug(
      `[SovMgr] GetSovStructuresInfoForLocalSolarSystem called (solarsystemid=${solarSystemID})`,
    );

    // solar4.txt shows the client iterates this result directly in the
    // inflight info panel. Returning None crashes with:
    //   TypeError: 'NoneType' object is not iterable
    // An empty list is the safe no-structures contract.
    return { type: "list", items: [] };
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[SovMgr] Unhandled method fallback: ${method}`);
    return { type: "list", items: [] };
  }
}

module.exports = SovMgrService;
