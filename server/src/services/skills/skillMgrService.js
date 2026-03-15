/**
 * Skill Manager Service (skillMgr)
 *
 * Handles skill-related queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  getCharacterSkillPointTotal,
  getCharacterSkills,
} = require(path.join(__dirname, "./skillState"));

const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;

function buildKeyVal(entries) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

function buildList(items = []) {
  return {
    type: "list",
    items,
  };
}

class SkillMgrService extends BaseService {
  constructor() {
    super("skillMgr");
  }

  _getCharacterId(session) {
    return (
      (session && (session.characterID || session.charid || session.userid)) ||
      140000001
    );
  }

  _buildSkillInfo(skillRecord) {
    return buildKeyVal([
      ["itemID", skillRecord.itemID],
      ["typeID", skillRecord.typeID],
      ["ownerID", skillRecord.ownerID],
      ["locationID", skillRecord.locationID],
      ["flagID", skillRecord.flagID],
      ["groupID", skillRecord.groupID],
      ["groupName", skillRecord.groupName || ""],
      ["skillLevel", skillRecord.skillLevel],
      ["trainedSkillLevel", skillRecord.trainedSkillLevel],
      ["effectiveSkillLevel", skillRecord.effectiveSkillLevel],
      ["virtualSkillLevel", skillRecord.virtualSkillLevel ?? null],
      ["skillRank", skillRecord.skillRank || 1],
      ["skillPoints", skillRecord.skillPoints],
      ["trainedSkillPoints", skillRecord.trainedSkillPoints ?? skillRecord.skillPoints],
      ["published", Boolean(skillRecord.published)],
      ["inTraining", Boolean(skillRecord.inTraining)],
    ]);
  }

  _buildSkillsDict(session) {
    const skills = getCharacterSkills(this._getCharacterId(session));
    return {
      type: "dict",
      entries: skills.map((skillRecord) => [
        skillRecord.typeID,
        this._buildSkillInfo(skillRecord),
      ]),
    };
  }

  _buildSkillQueue() {
    return buildList([]);
  }

  _buildEmptyDict() {
    return { type: "dict", entries: [] };
  }

  _getCharacterData(session) {
    return getCharacterRecord(this._getCharacterId(session)) || {};
  }

  _buildCharacterAttributes(session) {
    const charData = getCharacterRecord(this._getCharacterId(session)) || {};
    const source = charData.characterAttributes || {};
    return {
      type: "dict",
      entries: [
        [ATTRIBUTE_CHARISMA, Number(source[ATTRIBUTE_CHARISMA] ?? source.charisma ?? 20)],
        [
          ATTRIBUTE_INTELLIGENCE,
          Number(source[ATTRIBUTE_INTELLIGENCE] ?? source.intelligence ?? 20),
        ],
        [ATTRIBUTE_MEMORY, Number(source[ATTRIBUTE_MEMORY] ?? source.memory ?? 20)],
        [
          ATTRIBUTE_PERCEPTION,
          Number(source[ATTRIBUTE_PERCEPTION] ?? source.perception ?? 20),
        ],
        [ATTRIBUTE_WILLPOWER, Number(source[ATTRIBUTE_WILLPOWER] ?? source.willpower ?? 20)],
      ],
    };
  }

  Handle_GetMySkillQueue(args, session) {
    log.debug("[SkillMgr] GetMySkillQueue");
    return this._buildSkillQueue();
  }

  Handle_GetMySkillInfo(args, session) {
    log.debug("[SkillMgr] GetMySkillInfo");
    return buildKeyVal([
      ["skills", this._buildSkillsDict(session)],
      ["skillPoints", getCharacterSkillPointTotal(this._getCharacterId(session)) || 0],
      ["freeSkillPoints", 0],
      ["queue", this._buildSkillQueue()],
    ]);
  }

  Handle_GetSkillQueue(args, session) {
    log.debug("[SkillMgr] GetSkillQueue");
    return this._buildSkillQueue();
  }

  Handle_GetSkillHistory(args, session) {
    log.debug("[SkillMgr] GetSkillHistory");
    const charData = this._getCharacterData(session);
    const history = Array.isArray(charData.skillHistory) ? charData.skillHistory : [];
    return buildList(
      history.map((entry) =>
        buildKeyVal([
          ["logDate", { type: "long", value: BigInt(String(entry.logDate || 0)) }],
          ["eventTypeID", Number(entry.eventTypeID || 0)],
          ["skillTypeID", Number(entry.skillTypeID || 0)],
          ["absolutePoints", Number(entry.absolutePoints || 0)],
          ["level", Number(entry.level || 0)],
        ]),
      ),
    );
  }

  Handle_GetSkillPoints(args, session) {
    log.debug("[SkillMgr] GetSkillPoints");
    return getCharacterSkillPointTotal(this._getCharacterId(session)) || 0;
  }

  Handle_GetCharacterAttributeModifiers(args, session) {
    log.debug("[SkillMgr] GetCharacterAttributeModifiers");
    return { type: "list", items: [] };
  }

  Handle_GetAttributes(args, session) {
    log.debug("[SkillMgr] GetAttributes");
    return this._buildCharacterAttributes(session);
  }

  Handle_GetSkills(args, session) {
    log.debug("[SkillMgr] GetSkills");
    return this._buildSkillsDict(session);
  }

  Handle_GetAllSkills(args, session) {
    log.debug("[SkillMgr] GetAllSkills");
    return this._buildSkillsDict(session);
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
    const charData = this._getCharacterData(session);
    const respecInfo =
      charData.respecInfo && typeof charData.respecInfo === "object"
        ? charData.respecInfo
        : {};
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["freeRespecs", Number(respecInfo.freeRespecs ?? 3)],
          ["lastRespecDate", respecInfo.lastRespecDate || null],
          ["nextTimedRespec", respecInfo.nextTimedRespec || null],
        ],
      },
    };
  }

  Handle_GetSkillQueueAndFreePoints(args, session) {
    log.debug("[SkillMgr] GetSkillQueueAndFreePoints called");
    const charData = this._getCharacterData(session);
    return [this._buildSkillQueue(), Number(charData.freeSkillPoints || 0)];
  }

  Handle_GetBoosters(args, session) {
    log.debug("[SkillMgr] GetBoosters called");
    const charData = this._getCharacterData(session);
    const boosters = Array.isArray(charData.boosters) ? charData.boosters : [];
    return {
      type: "dict",
      entries: boosters.map((entry, index) => [
        Number(entry.typeID || entry.itemID || index + 1),
        buildKeyVal(Object.entries(entry || {})),
      ]),
    };
  }

  Handle_GetImplants(args, session) {
    log.debug("[SkillMgr] GetImplants called");
    const charData = this._getCharacterData(session);
    const implants = Array.isArray(charData.implants) ? charData.implants : [];
    return {
      type: "dict",
      entries: implants.map((entry, index) => [
        Number(entry.typeID || entry.itemID || index + 1),
        buildKeyVal(Object.entries(entry || {})),
      ]),
    };
  }

  Handle_GetFreeSkillPoints(args, session) {
    log.debug("[SkillMgr] GetFreeSkillPoints called");
    const charData = this._getCharacterData(session);
    return Number(charData.freeSkillPoints || 0);
  }

  Handle_GetFreeSkillPointsAppliedToQueue(args, session) {
    log.debug("[SkillMgr] GetFreeSkillPointsAppliedToQueue called");
    return this._buildEmptyDict();
  }

  Handle_GetFreeSkillPointsAppliedToSkills(args, session) {
    log.debug("[SkillMgr] GetFreeSkillPointsAppliedToSkills called");
    return this._buildEmptyDict();
  }

  Handle_ApplyFreeSkillPointsToQueue(args, session) {
    log.debug("[SkillMgr] ApplyFreeSkillPointsToQueue called");
    return 0;
  }

  Handle_ApplyFreeSkillPointsToSkills(args, session) {
    log.debug("[SkillMgr] ApplyFreeSkillPointsToSkills called");
    return 0;
  }

  Handle_ApplyFreeSkillPoints(args, session) {
    log.debug("[SkillMgr] ApplyFreeSkillPoints called");
    return 0;
  }

  Handle_SaveNewQueue(args, session) {
    log.debug("[SkillMgr] SaveNewQueue called");
    return null;
  }

  Handle_AbortTraining(args, session) {
    log.debug("[SkillMgr] AbortTraining called");
    return null;
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
