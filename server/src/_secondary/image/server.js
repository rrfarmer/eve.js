const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const log = require("../../utils/logger");

function startImageServer() {
  const server = http.createServer((req, res) => {
    const url = String(req.url || "/");
    const normalizedUrl = url.toLowerCase();

    log.debug(`image request: ${url}`);

    let filePath = path.join(__dirname, "images", "CAT.jpeg");
    let contentType = "image/jpeg";

    if (
      normalizedUrl.includes("/character/") ||
      normalizedUrl.includes("/portrait/")
    ) {
      filePath = path.join(__dirname, "images", "hi.jpg");
      contentType = "image/jpeg";
    } else if (normalizedUrl.includes("/corporation/")) {
      filePath = path.join(__dirname, "images", "hi.png");
      contentType = "image/png";
    } else if (normalizedUrl.includes("/alliance/")) {
      filePath = path.join(__dirname, "images", "alliance-default.png");
      contentType = "image/png";
    } else if (normalizedUrl.endsWith(".png")) {
      filePath = path.join(__dirname, "images", "hi.png");
      contentType = "image/png";
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const data = fs.readFileSync(filePath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "public, max-age=300",
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
