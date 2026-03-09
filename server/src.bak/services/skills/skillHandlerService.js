const BaseService = require("../baseService");
const log = require("../../utils/logger");

class SkillHandlerService extends BaseService {
  constructor() {
    super("skillHandler");
  }

  Handle_GetSkillQueueAndFreePoints(args, session) {
    log.debug("[SkillHandler] GetSkillQueueAndFreePoints");

    return [
      { type: "list", items: [] }, // skill queue
      0, // free skill points
    ];
  }
}
