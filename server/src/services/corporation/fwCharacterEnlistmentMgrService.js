const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class FwCharacterEnlistmentMgrService extends BaseService {
  constructor() {
    super("fwCharacterEnlistmentMgr");
  }

  Handle_GetMyEnlistment() {
    log.debug("[FwCharacterEnlistmentMgr] GetMyEnlistment");
    return [null, null, null];
  }

  Handle_GetCorpAllowedEnlistmentFactions(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(
      `[FwCharacterEnlistmentMgr] GetCorpAllowedEnlistmentFactions(${corporationID})`,
    );
    return { type: "list", items: [] };
  }

  Handle_SetMyCorpAllowedEnlistmentFactions(args) {
    log.debug("[FwCharacterEnlistmentMgr] SetMyCorpAllowedEnlistmentFactions");
    return { type: "list", items: [] };
  }

  Handle_GetMyDirectEnlistmentCooldownTimestamp() {
    log.debug(
      "[FwCharacterEnlistmentMgr] GetMyDirectEnlistmentCooldownTimestamp",
    );
    return 0;
  }

  Handle_CreateMyDirectEnlistment() {
    log.debug("[FwCharacterEnlistmentMgr] CreateMyDirectEnlistment");
    return null;
  }

  Handle_RemoveMyDirectEnlistment() {
    log.debug("[FwCharacterEnlistmentMgr] RemoveMyDirectEnlistment");
    return null;
  }
}

module.exports = FwCharacterEnlistmentMgrService;
