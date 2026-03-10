const { startXmppStub } = require("../../services/chat/xmppStubServer");

const log = require("../../utils/logger")
const config = require("../../config")

module.exports = {
  enabled: true,
  serviceName: "chatServer",
  exec() {
    startXmppStub();
    log.debug(`chatServer running on http://127.0.0.1:${config.chatServerPort}`)
  },
};
