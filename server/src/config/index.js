/**
 * EVE.js Server Configuration
 *
 * Version constants must match the client you're connecting with.
 * These values are from the Crucible v1.6.5 build 360229 client
 * (sourced from EVEVersion.h in evemu_Crucible-master).
 */

let _nextBoundId = 1;

module.exports = {
  // dev mode does the followng
  //  - auto creates users when they log in (and user is not in database)
  //  - authenticates you even when password is incorrect
  devMode: false,

  // YOUR client directory
  clientPath: "C:\\Users\\yumyy\\Documents\\EVE\\_GAME\\localhost",
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
  imageServerUrl: `http://127.0.0.1:26001/`,

  // where microservices (such as skill plan, faction warefare..) will be sent instead of official CCP servers.
  microservicesRedirectUrl: `http://localhost:26002/`,

  // chat server
  xmppServerPort: 5222,

  // proxy node ID: evemu uses 0xFFAA
  proxyNodeId: 0xffaa,

  // shared bound object ID counter - prevents OID collisions across services
  getNextBoundId() {
    return _nextBoundId++;
  },
};
