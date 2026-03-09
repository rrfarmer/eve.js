const BaseService = require("../baseService");
const log = require("../../utils/logger");

class XmppChatMgrService extends BaseService {
  constructor() {
    super("XmppChatMgr");
  }

  Handle_Hostname(args, session) {
    log.debug("[XmppChatMgr] Hostname called");
    return "localhost";
  }

  Handle_GetDeprecatedPrefsFallback(args, session) {
    log.debug("[XmppChatMgr] GetDeprecatedPrefsFallback called");
    return "localhost";
  }
}

module.exports = XmppChatMgrService;
