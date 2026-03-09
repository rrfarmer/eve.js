/**
 * Corporation Service (corporationSvc)
 *
 * Handles corporation-related queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class CorpService extends BaseService {
  constructor() {
    super("corporationSvc");
  }

  Handle_GetMyCorporationInfo(args, session) {
    log.debug("[CorpSvc] GetMyCorporationInfo");
    return { type: "dict", entries: [] };
  }

  Handle_GetNPCDivisions(args, session) {
    log.debug("[CorpSvc] GetNPCDivisions");
    return { type: "list", items: [] };
  }

  Handle_GetEmploymentRecord(args, session) {
    log.debug("[CorpSvc] GetEmploymentRecord");
    return { type: "list", items: [] };
  }

  Handle_GetRecruitmentAdsByCriteria(args, session) {
    log.debug("[CorpSvc] GetRecruitmentAdsByCriteria");
    return { type: "list", items: [] };
  }

  Handle_GetInfoWindowDataForChar(args, session) {
    log.debug("[CorpSvc] GetInfoWindowDataForChar");
    return { type: "dict", entries: [] };
  }
}

module.exports = CorpService;
