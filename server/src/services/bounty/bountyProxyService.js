const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class BountyProxyService extends BaseService {
  constructor() {
    super("bountyProxy");
  }

  Handle_GetBountiesAndKillRights() {
    log.debug("[BountyProxy] GetBountiesAndKillRights");
    return [
      { type: "dict", entries: [] },
      { type: "dict", entries: [] },
    ];
  }

  Handle_GetMyKillRights() {
    log.debug("[BountyProxy] GetMyKillRights");
    return { type: "list", items: [] };
  }

  callMethod(method, args, session, kwargs) {
    const result = super.callMethod(method, args, session, kwargs);
    if (result !== null) {
      return result;
    }

    log.warn(`[BountyProxy] Unhandled method fallback: ${method}`);
    return { type: "list", items: [] };
  }
}

module.exports = BountyProxyService;
