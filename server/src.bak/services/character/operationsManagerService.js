const BaseService = require("../baseService");
const log = require("../../utils/logger");

class OperationsManagerService extends BaseService {
  constructor() {
    super("operationsManager");
  }

  Handle_can_character_play_the_tutorial(args, session) {
    log.debug("[OperationsManager] can_character_play_the_tutorial called");
    return false;
  }
}

module.exports = OperationsManagerService;
