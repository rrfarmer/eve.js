const BaseService = require("../baseService");
const log = require("../../utils/logger");
const path = require("path");

class SkillMgr2Service extends BaseService {
  constructor() {
    super("skillMgr2");
  }

  Handle_GetMySkillHandler(args, session) {
    return {
      type: "object",
      name: "carbon.common.script.net.moniker.Moniker",
      args: [
        "skillMgr", // [0] __serviceName
        null, // [1] __nodeID
        session.characterID, // [2] __bindParams
        null, // [3] __sessionCheck
      ],
    };
  }
}

module.exports = SkillMgr2Service;
