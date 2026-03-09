const BaseService = require("../baseService");
const log = require("../../utils/logger");

class OfficeManagerService extends BaseService {
  constructor() {
    super("officeManager");
  }

  Handle_GetMyCorporationsOffices(args, session) {
    log.debug("[OfficeManager] GetMyCorporationsOffices called");
    return { type: "list", entries: [] };
  }
}

module.exports = OfficeManagerService;
