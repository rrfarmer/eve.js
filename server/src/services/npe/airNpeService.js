const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class AirNpeService extends BaseService {
  constructor() {
    super("air_npe");
  }

  Handle_is_air_npe_enabled(args, session, kwargs) {
    log.debug("[AirNpeService] is_air_npe_enabled called");
    return false;
  }

  Handle_get_air_npe_state(args, session) {
    log.debug("[AirNPE] get_air_npe_state called");
    return 2; // AirNpeState.COMPLETED
  }
}

module.exports = AirNpeService;
