/**
 * MachoNet Service
 *
 * Handles initial server info queries from the client.
 * This is one of the first services called after handshake.
 * The client calls machoNet.GetInitVals() to get server configuration.
 *
 * Based on NetService.cpp in EVEmu.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));

class MachoNetService extends BaseService {
  constructor() {
    super("machoNet");
  }

  /**
   * GetInitVals — returns initial server values
   *
   * From NetService.cpp: Returns [serviceInfo, emptyDict]
   * serviceInfo is a dict mapping service names to their access level.
   * The client uses this at ServiceCallGPCS.py:197 to know where
   * to route service calls:
   *   where = self.machoNet.serviceInfo[service]
   *
   * Access levels from C++:
   *   None   = direct call (unbound services)
   *   "location" / "locationPreferred" / "solarsystem" / "solarsystem2"
   *   "station" / "character" / "corporation" / "bulk"
   */
  getServiceInfoDict() {
    return {
      type: "dict",
      entries: [
        ["machoNet", null],
        ["config", null],
        ["objectCaching", null],
        ["alert", null],
        ["authentication", null],
        ["account", null],
        ["charUnboundMgr", null],
        ["charMgr", null],
        ["home_station", null],
        ["homestation", null],
        ["homeStation", null],
        ["corpRegistry", null],
        ["allianceRegistry", null],
        ["corpmgr", null],
        ["fwCharacterEnlistmentMgr", null],
        ["corpStationMgr", null],
        ["stationSvc", null],
        ["station", "station"],
        ["ship", "station"],
        ["map", null],
        ["structureDirectory", null],
        ["fwWarzoneSolarsystem", null],
        ["beyonce", "solarsystem2"],
        ["dogmaIM", "character"],
        ["invbroker", "station"],
        ["charFittingMgr", null],
        ["corpFittingMgr", null],
        ["LSC", null],
        ["onlineStatus", null],
        ["billMgr", null],
        ["corporationSvc", null],
        ["warsInfoMgr", null],
        ["certificateMgr", null],
        ["tutorialSvc", null],
        ["agentMgr", null],
        ["bookmarkMgr", null],
        ["standing2", null],
        ["dungeonExplorationMgr", null],
        ["userSvc", null],
        ["skillMgr", null],
        ["skillMgr2", null],
        ["skillHandler", null],
        ["contractMgr", null],
        ["blueprintManager", null],
        ["repairSvc", "station"],
        ["repackagingSvc", null],
        ["reprocessingSvc", "station"],
        ["insuranceSvc", "station"],
        ["jumpCloneSvc", null],
        ["LPSvc", "station"],
        ["slash", null],
        ["subscriptionMgr", null],
        ["loginCampaignManager", null],
        ["seasonalLoginCampaignManager", null],
      ],
    };
  }

  Handle_GetInitVals(args, session) {
    log.info("[MachoNet] GetInitVals");
    // Return [serviceInfo, globalConfig]
    // globalConfig is used by client for things like:
    //   machoNet.GetGlobalConfig().get('imageserverurl') - portrait/logo image server
    //   machoNet.GetGlobalConfig().get('defaultPortraitSaveSize') - portrait save size
    const globalConfig = {
      type: "dict",
      entries: [
        // Image server URL — required by evePhotosvc.py RemoteImageCacher
        // Without this, imageServer=None and portrait loading crashes
        ["imageserverurl", config.imageServerUrl],
        ["defaultPortraitSaveSize", 256],
      ],
    };
    return [this.getServiceInfoDict(), globalConfig];
  }

  Handle_GetServiceInfo(args, session) {
    log.debug("[MachoNet] GetServiceInfo");
    return this.getServiceInfoDict();
  }

  /**
   * GetTime — returns the current server time as a Win32 FILETIME
   */
  Handle_GetTime(args, session) {
    log.debug("[MachoNet] GetTime");
    // Convert to Win32 FILETIME (100-nanosecond intervals since 1601-01-01)
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    return { type: "long", value: now };
  }

  Handle_GetClusterGameStatisticsForClient(args, session) {
    log.debug("[MachoNet] GetClusterGameStatisticsForClient");
    // V23.02 mapSvc unpacks:
    //   sol, sta, statDivisor =
    //     sm.ProxySvc('machoNet').GetClusterGameStatisticsForClient('EVE', ({}, {}, 0))
    // and then iterates sol/sta as dict-like objects while dividing by
    // statDivisor. The safe empty-state contract is therefore:
    //   ({}, {}, 1)
    return [{}, {}, 1];
  }
}

module.exports = MachoNetService;
