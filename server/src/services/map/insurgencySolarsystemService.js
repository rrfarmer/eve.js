const BaseService = require("../baseService");
const log = require("../../utils/logger");

class InsurgencySolarsystemService extends BaseService {
  constructor() {
    super("insurgencySolarsystem");
  }

  Handle_GetAllVisibleCampaigns(args, session) {
    log.debug("[InsurgencySolarsystem] GetAllVisibleCampaigns called");
    return { type: "list", items: [] };
  }

  Handle_GetLocalCampaignClientSnapshot(args, session) {
    log.debug("[InsurgencySolarsystem] GetLocalCampaignClientSnapshot called");
    return { type: "list", items: [] };
  }
}

module.exports = InsurgencySolarsystemService;
