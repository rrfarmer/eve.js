/**
 * Skill Manager Service (skillMgr)
 *
 * Handles skill-related queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class SkillMgrService extends BaseService {
  constructor() {
    super("skillMgr");
  }

  Handle_GetMySkillQueue(args, session) {
    log.debug("[SkillMgr] GetMySkillQueue");
    return { type: "list", items: [] };
  }

  Handle_GetMySkillInfo(args, session) {
    log.debug("[SkillMgr] GetMySkillInfo");
    return { type: "dict", entries: [] };
  }

  Handle_GetSkillQueue(args, session) {
    log.debug("[SkillMgr] GetSkillQueue");
    return { type: "list", items: [] };
  }

  Handle_GetSkillHistory(args, session) {
    log.debug("[SkillMgr] GetSkillHistory");
    return { type: "list", items: [] };
  }

  _buildSkillsDict() {
    // Must be dict-like: client does .get(skillTypeID)
    return { type: "dict", entries: [] };
  }

  Handle_GetSkills(args, session) {
    log.debug("[SkillMgr] GetSkills");
    return this._buildSkillsDict();
  }

  Handle_GetAllSkills(args, session) {
    log.debug("[SkillMgr] GetAllSkills");
    return this._buildSkillsDict();
  }

  Handle_CharStartTrainingSkillByTypeID(args, session) {
    log.debug("[SkillMgr] CharStartTrainingSkillByTypeID");
    return { type: "list", items: [] };
  }

  Handle_CharStopTrainingSkill(args, session) {
    log.debug("[SkillMgr] CharStopTrainingSkill");
    return { type: "list", items: [] };
  }

  Handle_GetRespecInfo(args, session) {
    log.debug("[SkillMgr] GetRespecInfo");
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["freeRespecs", 3],
          ["lastRespecDate", null],
          ["nextTimedRespec", null],
        ],
      },
    };
  }

  Handle_GetSkillQueueAndFreePoints(args, session) {
    log.debug("[SkillMgr] GetSkillQueueAndFreePoints called");
    return [{ type: "list", items: [] }, 0];
  }

  Handle_GetBoosters(args, session) {
    log.debug("[SkillMgr] GetBoosters called");
    return { type: "list", items: [] };
  }

  Handle_CheckAndSendNotifications(args, session) {
    log.debug("[SkillMgr] CheckAndSendNotifications called");
    return { type: "list", items: [] };
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[SkillMgr] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[SkillMgr] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );

    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const oid = [idString, now];

    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[SkillMgr] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }
}

module.exports = SkillMgrService;
