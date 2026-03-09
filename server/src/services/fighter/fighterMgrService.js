const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class FighterMgrService extends BaseService {
  constructor() {
    super("fighterMgr");
  }

  Handle_GetFightersForShip(args, session, kwargs) {
    log.debug("[FighterMgrService] GetFightersForShip called");
    // Client error: AttributeError: 'list' object has no attribute 'iteritems'
    // This implies that the unpacked values are expected to be dicts.
    return [
      { type: "dict", entries: [] },
      { type: "dict", entries: [] },
      { type: "dict", entries: [] },
    ];
  }
}

module.exports = FighterMgrService;
