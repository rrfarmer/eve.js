const BaseService = require("../baseService");
const log = require("../../utils/logger");

class EssMgrService extends BaseService {
  constructor() {
    super("essMgr");
  }

  Handle_GetDataForClientSolarSystem(args, session, kwargs) {
    const solarSystemID =
      (session && (session.solarsystemid2 || session.solarsystemid)) || null;
    log.debug(
      `[EssMgr] GetDataForClientSolarSystem called (solarsystemid=${solarSystemID})`,
    );

    return null;
  }

  Handle_IsClientLinkedToReserveBank() {
    return false;
  }

  Handle_GetMainBankTheftsForClientSolarSystem() {
    return [];
  }

  Handle_GetReserveBankTheftsForClientSolarSystem() {
    return [];
  }

  Handle_AttemptLinkToMainBank() {
    return null;
  }

  Handle_AttemptLinkToReserveBank() {
    return null;
  }

  Handle_RequestMainBankUnlink() {
    return null;
  }

  Handle_RequestReserveBankUnlink() {
    return null;
  }

  Handle_RequestUnlockReserveBank() {
    return null;
  }
}

module.exports = EssMgrService;