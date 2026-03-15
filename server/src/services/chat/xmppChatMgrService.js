const BaseService = require("../baseService");
const log = require("../../utils/logger");
const { getLocalChannelForSession } = require("./chatHub");

function getCorpChannelName(session) {
  const corpId = Number(
    (session && (session.corporationID || session.corpid)) || 0,
  );
  return `corp_${corpId}`;
}

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

  Handle_ResyncSystemChannelAccess(args, session) {
    const channel = getLocalChannelForSession(session);
    const channels = [channel.comparisonKey, getCorpChannelName(session)];
    log.debug(
      `[XmppChatMgr] ResyncSystemChannelAccess -> ${JSON.stringify(channels)}`,
    );
    return channels;
  }
}

module.exports = XmppChatMgrService;
