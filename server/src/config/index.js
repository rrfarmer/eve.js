/**
 * EVE.js Server Configuration
 *
 * Default values live here. Optional local overrides can be supplied in
 * evejs.config.local.json at the repository root, or with EVEJS_* env vars.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

let nextBoundId = 1;

const rootDir = path.resolve(__dirname, "../../..");
const localConfigPath = path.join(rootDir, "evejs.config.local.json");
const sharedConfigPath = path.join(rootDir, "evejs.config.json");

const defaults = {
  // dev mode does the following
  //  - auto creates users when they log in (and user is not in database)
  //  - authenticates you even when password is incorrect
  devMode: false,

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
  microservicesBindHost: "0.0.0.0",
  publicHost: "",

  // chat server
  xmppServerHost: "",
  xmppServerPort: 5222,

  // modern eve_public user-license stubs
  omegaLicenseEnabled: true,

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
  return Boolean(normalized) && normalized !== "0.0.0.0" && normalized !== "::";
}

function isLoopbackHost(host) {
  const normalized = normalizeHost(host).toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

function detectPublicHost(preferredHost = "") {
  const preferred = normalizeHost(preferredHost);
  if (isUsableHost(preferred)) {
    return preferred;
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

function rewriteLoopbackUrlHost(rawUrl, replacementHost) {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    if (!isLoopbackHost(parsed.hostname) || !isUsableHost(replacementHost)) {
      return rawUrl;
    }

    parsed.hostname = replacementHost;
    return parsed.toString();
  } catch {
    return rawUrl;
  }
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
  microservicesBindHost:
    process.env.EVEJS_MICROSERVICES_BIND_HOST || undefined,
  publicHost: process.env.EVEJS_PUBLIC_HOST || undefined,
  xmppServerHost: process.env.EVEJS_XMPP_SERVER_HOST || undefined,
  xmppServerPort: parseNumber(process.env.EVEJS_XMPP_SERVER_PORT),
  omegaLicenseEnabled: parseBoolean(process.env.EVEJS_OMEGA_LICENSE),
  proxyNodeId: parseNumber(process.env.EVEJS_PROXY_NODE_ID),
});

const config = {
  ...defaults,
  ...fileConfig,
  ...envConfig,
};

const legacyChatHost = normalizeHost(fileConfig.chatServerHost || process.env.EVEJS_CHAT_SERVER_HOST);
const resolvedPublicHost = detectPublicHost(
  config.publicHost || config.xmppServerHost || legacyChatHost,
);
config.publicHost = resolvedPublicHost;
config.microservicesBindHost = normalizeHost(config.microservicesBindHost) || "0.0.0.0";
config.microservicesRedirectUrl = rewriteLoopbackUrlHost(
  config.microservicesRedirectUrl,
  resolvedPublicHost,
);
config.imageServerUrl = rewriteLoopbackUrlHost(
  config.imageServerUrl,
  resolvedPublicHost,
);
if (!isUsableHost(config.xmppServerHost) && isUsableHost(legacyChatHost)) {
  config.xmppServerHost = legacyChatHost;
}

config.getNextBoundId = function getNextBoundId() {
  return nextBoundId++;
};

module.exports = config;
