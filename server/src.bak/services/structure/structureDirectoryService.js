const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class StructureDirectoryService extends BaseService {
  constructor() {
    super("structureDirectory");
  }

  Handle_GetMyDockableStructures(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetMyDockableStructures called");
    return { type: "list", items: [] };
  }
}

module.exports = StructureDirectoryService;
