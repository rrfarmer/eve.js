const { startXmppStub } = require("../../services/chat/xmppStubServer");

const log = require("../../utils/logger")
const config = require("../../config")

module.exports = {
  enabled: true,
  serviceName: "chatServer",
  exec() {
    startXmppStub();
    const host = config.xmppServerHost || "127.0.0.1";
    log.debug(`chatServer running on tls://${host}:${config.xmppServerPort}/`)
  },
};
