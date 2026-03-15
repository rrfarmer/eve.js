const path = require("path");

const log = require(path.join(__dirname, "./src/utils/logger"));
const config = require(path.join(__dirname, "./src/config"));
const expressProxyService = require(path.join(
  __dirname,
  "./src/_secondary/express/server",
));

log.logAsciiLogo();
console.log();
log.info("starting eve.js proxy only...");
console.log();
log.debug(`microservices redirect: ${config.microservicesRedirectUrl}`);
console.log();

if (expressProxyService.enabled !== true) {
  log.err(
    "proxy-only startup aborted because EVEJS_EXPRESS_PROXY_ENABLED is disabled.",
  );
  process.exit(1);
}

expressProxyService.exec();
