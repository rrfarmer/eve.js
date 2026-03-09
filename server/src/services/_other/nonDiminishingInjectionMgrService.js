const path = require("path"); // required for db implementation
const fs = require("fs"); // required for db implementation

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class nonDiminishingInjectionMgrService extends BaseService {
  constructor() {
    super("nonDiminishingInjectionMgr");
  }

  Handle_GetAvailableNonDiminishingInjections(args, session) {
    // not sure what this is for...
    // return empty tuple for now
    return [];
  }
}

module.exports = nonDiminishingInjectionMgrService;
