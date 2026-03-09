/**
 * Account Service
 *
 * Handles account-related client calls like GetEntryTypes, GetKeyMap, etc.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class AccountService extends BaseService {
  constructor() {
    super("account");
  }

  Handle_AccountService(args, session) {
    log.debug("[AccountService] AccountService called");
    return null;
  }

  Handle_GetEntryTypes(args, session) {
    log.debug("[AccountService] GetEntryTypes");
    // Return an empty rowset for now
    return { type: "dict", entries: [] };
  }

  Handle_GetKeyMap(args, session) {
    log.debug("[AccountService] GetKeyMap");
    return { type: "dict", entries: [] };
  }
}

module.exports = AccountService;
