/**
 * Subscription Manager Service (subscriptionMgr)
 *
 * Handles subscription/account status queries from the client.
 * Modern EVE clients call this during the login flow.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class SubscriptionMgrService extends BaseService {
  constructor() {
    super("subscriptionMgr");
  }

  _resolveCloneGrade() {
    // Modern clients expect a clone state enum, not invType IDs (164/300).
    // 2 is commonly Omega, 1 is Alpha.
    const raw = process.env.EVE_CLONE_GRADE;
    if (!raw) return 1;

    const val = String(raw).trim().toLowerCase();
    if (val === "omega") return 1;
    if (val === "alpha") return 1;
    if (val === "trial") return 0;

    const parsed = Number.parseInt(val, 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 10) {
      return parsed;
    }
    return 1;
  }

  Handle_GetSubscriptionStatus(args, session) {
    log.debug("[SubscriptionMgr] GetSubscriptionStatus");
    // Return a minimal subscription status - Omega (subscribed)
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["isSubscribed", true],
          ["subscriptionDaysRemaining", 365],
        ],
      },
    };
  }

  Handle_GetSubscriptionInfo(args, session) {
    log.debug("[SubscriptionMgr] GetSubscriptionInfo");
    return null;
  }

  Handle_GetCloneGrade(args, session) {
    const grade = this._resolveCloneGrade();
    log.debug(`[SubscriptionMgr] GetCloneGrade -> ${grade}`);
    return grade;
  }
}

module.exports = SubscriptionMgrService;
