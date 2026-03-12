const BaseService = require("../baseService");
const log = require("../../utils/logger");
const os = require("os");
const config = require("../../config");
const { getLocalChannelForSession, hasSelectedCharacter } = require("./chatHub");

function getCorpChannelName(session) {
  const corpId = Number(
    (session && (session.corporationID || session.corpid)) || 1000044,
  );
  return `corp_${corpId}`;
}

function normalizeHost(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("::ffff:")) {
    return normalized.slice("::ffff:".length);
  }

  if (normalized === "::1") {
    return "127.0.0.1";
  }

  return normalized;
}

function isUsableHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized) {
    return false;
  }

  return normalized !== "0.0.0.0" && normalized !== "::";
}

function isLoopbackHost(host) {
  const normalized = normalizeHost(host);
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

function detectChatHost(session) {
  const configuredHost = normalizeHost(config.xmppServerHost);
  if (isUsableHost(configuredHost)) {
    return configuredHost;
  }

  const sessionLocalHost = normalizeHost(
    session && session.socket ? session.socket.localAddress : "",
  );
  if (isUsableHost(sessionLocalHost) && !isLoopbackHost(sessionLocalHost)) {
    return sessionLocalHost;
  }

  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    if (!Array.isArray(addresses)) {
      continue;
    }

    const candidate = addresses.find(
      (entry) => entry && entry.family === "IPv4" && !entry.internal,
    );
    if (candidate && isUsableHost(candidate.address)) {
      return normalizeHost(candidate.address);
    }
  }

  return "127.0.0.1";
}

class XmppChatMgrService extends BaseService {
  constructor() {
    super("XmppChatMgr");
  }

  Handle_Hostname(args, session) {
    const chatHost = detectChatHost(session);
    log.debug(`[XmppChatMgr] Hostname called -> ${chatHost}`);
    return chatHost;
  }

  Handle_GetDeprecatedPrefsFallback(args, session) {
    const chatHost = detectChatHost(session);
    log.debug(`[XmppChatMgr] GetDeprecatedPrefsFallback called -> ${chatHost}`);
    return chatHost;
  }

  Handle_ResyncSystemChannelAccess(args, session) {
    if (!hasSelectedCharacter(session)) {
      log.debug("[XmppChatMgr] ResyncSystemChannelAccess -> [] (no character)");
      return [];
    }

    const channel = getLocalChannelForSession(session);
    const channels = [channel.comparisonKey, getCorpChannelName(session)];
    log.debug(
      `[XmppChatMgr] ResyncSystemChannelAccess -> ${JSON.stringify(channels)}`,
    );
    return channels;
  }
}

module.exports = XmppChatMgrService;
