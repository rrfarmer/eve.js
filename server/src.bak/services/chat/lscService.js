/**
 * LSC (Large Scale Chat) Service
 *
 * Handles chat channel operations.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class LSCService extends BaseService {
  constructor() {
    super("LSC");
  }

  Handle_GetChannels(args, session) {
    log.debug("[LSCService] GetChannels");
    return { type: "list", items: [] };
  }

  Handle_GetMyMessages(args, session) {
    log.debug("[LSCService] GetMyMessages");
    return { type: "list", items: [] };
  }

  Handle_JoinChannel(args, session) {
    log.debug("[LSCService] JoinChannel");
    return null;
  }

  Handle_LeaveChannel(args, session) {
    log.debug("[LSCService] LeaveChannel");
    return null;
  }

  Handle_SendMessage(args, session) {
    log.debug("[LSCService] SendMessage");
    return null;
  }
}

module.exports = LSCService;
