/**
 * User Service — "userSvc"
 *
 * Handles account-level queries such as redeem tokens and reporting bots.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { performCharacterLogoff } = require(path.join(
  __dirname,
  "./logoffCharacter",
));
const database = require(path.join(__dirname, "../../database"));
const {
  buildFiletimeLong,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  DEFAULT_MCT_EXPIRY_FILETIME,
} = require(path.join(__dirname, "../character/characterState"));

function getAccountRecordByUserID(userID) {
  const result = database.read("accounts", "/");
  const accounts = result.success && result.data ? result.data : {};

  for (const [username, account] of Object.entries(accounts)) {
    if (Number(account && account.id) === Number(userID || 0)) {
      return {
        username,
        account,
      };
    }
  }

  return null;
}

function buildDefaultTrainingSlots() {
  return {
    2: DEFAULT_MCT_EXPIRY_FILETIME,
    3: DEFAULT_MCT_EXPIRY_FILETIME,
  };
}

class UserService extends BaseService {
  constructor() {
    super("userSvc");
  }

  /**
   * GetRedeemTokens — returns tokens available to redeem
   *
   * Called during login process. If no tokens are available,
   * it returns an empty list. EVEmu does: `return new PyList();`
   */
  Handle_GetRedeemTokens(args, session, kwargs) {
    log.debug("[UserService] GetRedeemTokens called");
    // Return empty PyList
    return {
      type: "list",
      items: [],
    };
  }

  Handle_GetMultiCharactersTrainingSlots(args, session) {
    log.debug("[userSvc] GetMultiCharactersTrainingSlots called");
    const accountRecord = getAccountRecordByUserID(session && session.userid);
    const configuredSlots =
      accountRecord &&
      accountRecord.account &&
      accountRecord.account.multiCharacterTrainingSlots &&
      typeof accountRecord.account.multiCharacterTrainingSlots === "object"
        ? accountRecord.account.multiCharacterTrainingSlots
        : buildDefaultTrainingSlots();

    return {
      type: "dict",
      entries: Object.entries(configuredSlots).map(([slot, expiry]) => [
        Number(slot),
        buildFiletimeLong(expiry),
      ]),
    };
  }
  
  Handle_UserLogOffCharacter(args, session) {
    log.info(
      `[userSvc] UserLogOffCharacter called (charID=${session ? session.characterID || 0 : 0})`,
    );
    return performCharacterLogoff(session, "userSvc");
  }
}

module.exports = UserService;
