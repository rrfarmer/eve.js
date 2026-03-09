const tls = require("tls");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const log = require("../../utils/logger");

function startXmppServer() {
  const options = {
    key: fs.readFileSync(path.join(__dirname, "certs", "key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "certs", "cert.pem")),
  };

  const server = tls.createServer(options, (socket) => {
    log.debug(
      `[xmppchat] new TLS connection from ${socket.remoteAddress}:${socket.remotePort}`,
    );

    socket.on("data", (data) => {
      const str = data.toString();
      const hex = data.toString("hex");
      log.info(`[xmppchat] received (hex): ${hex}`);
      log.info(`[xmppchat] received (str): ${str}`);

      // Basic stream initiation response
      if (str.includes("<stream:stream")) {
        socket.write(
          "<?xml version='1.0'?><stream:stream xmlns:stream='http://etherx.jabber.org/streams' xmlns='jabber:client' from='localhost' id='some-id' version='1.0'>",
        );
      }
    });

    socket.on("error", (err) => {
      log.err(`[xmppchat] socket error: ${err.message}`);
    });
  });

  server.listen(config.xmppServerPort);
}

module.exports = {
  serviceName: "xmppchat",
  exec() {
    startXmppServer();
    log.debug(`tls xmppchat server running on port ${config.xmppServerPort}`);
  },
};
