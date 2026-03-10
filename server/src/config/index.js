/**
 * SERVER CONFIGURATION
 * (skeleton code by AI, revised by Icey and John)
 *
 * default values live here.
 * local overrides can be supplied in evejs.config.json at the repository root
 */

// removed sharedConfigPath as i dont see a use case for it.
// also removed support for environment variables. dont see a use case for it.

const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "../../../evejs.config.json");

const defaults = {
  /**
   * DEV MODE:
   * - auto create non-existant accounts.
   * - authenticates you even when password is incorrect
   */
  devMode: true,

  // the launcher writes the detected client path here
  clientPath: "",
  autoLaunch: false,

  // client version info
  clientVersion: 23.02,
  clientBuild: 3223220,
  eveBirthday: 170472,
  machoVersion: 496,
  projectCodename: "crucible",
  projectRegion: "ccp",
  projectVersion: "V23.02@ccp",

  // WARNING: logLevel not implemented at the moment
  // 2: log everything; 1: log errors (default); 0: log nothing;
  logLevel: 2,

  /**
   * #### WARNING ####
   * it is not recommended to change config values
   * below unless you know what you are doing!
   * #### WARNING ####
   */

  // main server (default for clients is 26000)
  serverPort: 26000,

  // TODO: change so it is port instead of url
  // image server (default for clients is 26001)
  imageServerUrl: "http://127.0.0.1:26001/",

  // WARNING: microservices not implemented at the moment
  // where microservices will be sent instead of official CCP servers.
  microservicesRedirectUrl: "http://localhost:26002/",

  // chat server (default for clients is 5222)
  chatServerPort: 5222,

  // DO NOT CHANGE
  // proxy node ID: evemu uses 0xFFAA
  proxyNodeId: 0xffaa,
};

// read json config from root dir
let configJson = JSON.parse(fs.readFileSync(configPath))

// assemble config
const config = {
  ...defaults,
  ...configJson
}

// bound ID stuff
let nextBoundId = 1;
config.getNextBoundId = function getNextBoundId() {
  return nextBoundId++;
};

module.exports = config;
