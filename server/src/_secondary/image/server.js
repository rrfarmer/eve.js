const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const log = require("../../utils/logger");

function startImageServer() {
  const server = http.createServer((req, res) => {
    const url = req.url;

    log.debug(`image request: ${url}`);

    // dev mode: always return same image
    // client expects jpeg file!
    const filePath = path.join(__dirname, "images", "CAT.jpeg");

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const data = fs.readFileSync(filePath);

    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": data.length,
    });

    res.end(data);
  });

  const url = new URL(config.imageServerUrl);
  const port = Number.parseInt(url.port, 10);
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;

  server.on("error", (err) => {
    log.err(`[ImageServer] listen error: ${err.message}`);
  });

  server.listen(port);
}

module.exports = {
  enabled: true,
  serviceName: "imageServer",
  exec() {
    startImageServer();
    log.debug(`http image server running on ${config.imageServerUrl}`);
  },
};
