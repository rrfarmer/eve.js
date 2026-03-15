/**
 * EVE.js Server Configuration
 *
 * Default values live here. Optional local overrides can be supplied in
 * evejs.config.local.json at the repository root, or with EVEJS_* env vars.
 */

const fs = require("fs");
const path = require("path");

let nextBoundId = 1;

const rootDir = path.resolve(__dirname, "../../..");
const localConfigPath = path.join(rootDir, "evejs.config.local.json");
const sharedConfigPath = path.join(rootDir, "evejs.config.json");

const defaults = {
  // dev mode does the following
  //  - auto creates users when they log in (and user is not in database)
  //  - authenticates you even when password is incorrect
  devMode: true,

  // the launcher writes the detected client path here
  clientPath: "",
  autoLaunch: true,

  // client version info
  clientVersion: 23.02,
  clientBuild: 3145366,
  eveBirthday: 170472,
  machoVersion: 496,
  projectCodename: "crucible",
  projectRegion: "ccp",
  projectVersion: "V23.02@ccp",

  // 2: log everything; 1: log errors (default); 0: log nothing;
  logLevel: 2,

  // #### WARNING #### \\
  // it is recommended not to edit the config values
  // below unless you know what you're doing!
  // #### WARNING #### \\

  // main server
  serverPort: 26000,

  // image server
  // imageServerPort: 26001,
  imageServerUrl: "http://127.0.0.1:26001/",

  // where microservices will be sent instead of official CCP servers.
  microservicesRedirectUrl: "http://localhost:26002/",

  // chat server
  xmppServerPort: 5222,

  // modern eve_public user-license stubs
  omegaLicenseEnabled: true,

  // in-process hot reload for most service logic without disconnecting clients
  hotReloadEnabled: true,
  hotReloadWatch: true,
  reloadOnFileChange: true,
  hotReloadDebounceMs: 750,

  // proxy node ID: evemu uses 0xFFAA
  proxyNodeId: 0xffaa,
};

function readJsonConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function parseBoolean(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseNumber(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withDefinedEntries(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

const fileConfig = {
  ...readJsonConfig(sharedConfigPath),
  ...readJsonConfig(localConfigPath),
};

const envConfig = withDefinedEntries({
  devMode: parseBoolean(process.env.EVEJS_DEV_MODE),
  clientPath: process.env.EVEJS_CLIENT_PATH || undefined,
  autoLaunch: parseBoolean(process.env.EVEJS_AUTO_LAUNCH),
  logLevel: parseNumber(process.env.EVEJS_LOG_LEVEL),
  serverPort: parseNumber(process.env.EVEJS_SERVER_PORT),
  imageServerUrl: process.env.EVEJS_IMAGE_SERVER_URL || undefined,
  microservicesRedirectUrl:
    process.env.EVEJS_MICROSERVICES_REDIRECT_URL || undefined,
  xmppServerPort: parseNumber(process.env.EVEJS_XMPP_SERVER_PORT),
  omegaLicenseEnabled: parseBoolean(process.env.EVEJS_OMEGA_LICENSE),
  hotReloadEnabled: parseBoolean(process.env.EVEJS_HOT_RELOAD),
  hotReloadWatch: parseBoolean(process.env.EVEJS_HOT_RELOAD_WATCH),
  reloadOnFileChange: parseBoolean(process.env.EVEJS_RELOAD_ON_FILE_CHANGE),
  hotReloadDebounceMs: parseNumber(process.env.EVEJS_HOT_RELOAD_DEBOUNCE_MS),
  proxyNodeId: parseNumber(process.env.EVEJS_PROXY_NODE_ID),
});

const config = {
  ...defaults,
  ...fileConfig,
  ...envConfig,
};

if (config.reloadOnFileChange === undefined || config.reloadOnFileChange === null) {
  config.reloadOnFileChange = config.hotReloadWatch;
}
config.hotReloadWatch = config.reloadOnFileChange !== false;

config.getNextBoundId = function getNextBoundId() {
  return nextBoundId++;
};

module.exports = config;
