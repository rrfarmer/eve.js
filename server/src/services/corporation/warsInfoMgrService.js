const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class WarsInfoMgrService extends BaseService {
  constructor() {
    super("warsInfoMgr");
  }

  Handle_GetWarsByOwnerID(args) {
    const ownerID = args && args.length > 0 ? args[0] : null;

    // The client loads alliance/corp "War History" through warsInfoMgr.
    // Returning an empty list keeps that tab honest until real war data exists.
    log.debug(`[WarsInfoMgr] GetWarsByOwnerID(${ownerID}) -> []`);

    // This is intentionally a simple list, because the V23.02 info window
    // just iterates wars and shows "Nothing Found" when the list is empty.
    return [];
  }
}

module.exports = WarsInfoMgrService;
