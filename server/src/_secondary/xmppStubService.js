const { startXmppStub } = require("../services/chat/xmppStubServer");

module.exports = {
  enabled: true,
  serviceName: "xmppStub",
  exec() {
    startXmppStub();
  },
};
