/**
 * launcher/server.js
 *
 * launches eve client (if autolaunch is enabled in config)
 * while making sure the httpProxy and httpsProxy redirects
 * to proper server (instead of straight to CCP servers)
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const config = require("../../config");
const log = require("../../utils/logger");

function findAndStartClient() {
  function findExe(inputPath) {
    if (!fs.existsSync(inputPath)) {
      throw new Error("Path does not exist: " + inputPath);
    }

    const stat = fs.statSync(inputPath);
    if (
      stat.isFile() &&
      path.basename(inputPath).toLowerCase() === "exefile.exe"
    ) {
      return inputPath;
    }

    if (stat.isDirectory()) {
      const binExe = path.join(inputPath, "exefile.exe");
      if (fs.existsSync(binExe)) {
        return binExe;
      }

      const bin64 = path.join(inputPath, "bin64", "exefile.exe");
      if (fs.existsSync(bin64)) {
        return bin64;
      }

      const files = fs.readdirSync(inputPath);
      for (const file of files) {
        const full = path.join(inputPath, file);
        const stat = fs.statSync(full);

        if (stat.isDirectory()) {
          try {
            const result = findExe(full);
            if (result) return result;
          } catch {}
        }

        if (file.toLowerCase() === "exefile.exe") {
          return full;
        }
      }
    }

    throw new Error("exefile.exe not found");
  }

  const exe = findExe(config.clientPath);

  const proxyUrl = config.microservicesRedirectUrl.replace(/\/$/, "");

  spawn(exe, [], {
    cwd: path.dirname(exe),
    env: {
      ...process.env,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  });
}

if (config.autoLaunch) {
  module.exports = {
    enabled: true,
    serviceName: "clientLauncher",
    exec() {
      findAndStartClient();
      log.debug(`client is starting...`);
    },
  };
} else {
  module.exports = {
    enabled: false,
    serviceName: "clientLauncher",
    exec() {
      log.warn(`this service is disabled! skipping`);
    },
  };
}
