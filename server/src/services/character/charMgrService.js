/**
 * Character Manager Service (charMgr)
 *
 * Handles character info queries post-selection.
 * Different from charUnboundMgr — this is bound to a specific character.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class CharMgrService extends BaseService {
  constructor() {
    super("charMgr");
  }

  Handle_GetPublicInfo(args, session) {
    const charId =
      args && args.length > 0 ? args[0] : session ? session.characterID : 0;
    log.info(`[CharMgr] GetPublicInfo(${charId})`);

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["characterID", charId],
          ["characterName", session ? session.characterName : "Unknown"],
          ["typeID", 1373],
          ["raceID", 1],
          ["bloodlineID", 1],
          ["ancestryID", 1],
          ["corporationID", session ? session.corporationID : 1000009],
          ["allianceID", session ? session.allianceID : null],
          ["gender", 1],
          [
            "createDateTime",
            {
              type: "long",
              value: BigInt(Date.now()) * 10000n + 116444736000000000n,
            },
          ],
          ["description", ""],
        ],
      },
    };
  }

  Handle_GetPublicInfo3(args, session) {
    log.debug("[CharMgr] GetPublicInfo3");
    return this.Handle_GetPublicInfo(args, session);
  }

  Handle_GetTopBounties(args, session) {
    log.debug("[CharMgr] GetTopBounties");
    return { type: "list", items: [] };
  }

  Handle_GetPrivateInfo(args, session) {
    log.debug("[CharMgr] GetPrivateInfo");
    return { type: "dict", entries: [] };
  }

  Handle_GetCloneInfo(args, session) {
    log.debug("[CharMgr] GetCloneInfo");
    return null;
  }

  Handle_GetHomeStation(args, session) {
    log.debug("[CharMgr] GetHomeStation");
    return session ? session.stationID : 60003760;
  }

  Handle_LogStartOfCharacterCreation(args, session) {
    log.debug("[CharMgr] LogStartOfCharacterCreation");
    return null;
  }

  // EVEmu PDState: 0=NoRecustomization (finalized), 1=Resculpting,
  // 2=NoExistingCustomization, 3=FullRecustomizing, 4=ForceRecustomize
  Handle_GetPaperdollState(args, session) {
    log.debug("[CharMgr] GetPaperdollState → 0 (NoRecustomization)");
    return 0; // Portrait is finalized
  }

  Handle_GetCharacterSettings(args, session) {
    log.debug("[CharMgr] GetCharacterSettings called");
    return { type: "dict", entries: [] };
  }

  Handle_GetSettingsInfo(args, session) {
    log.debug("[CharMgr] GetSettingsInfo called");
    // Hand-crafted Python 2.7 bytecode for `def f(): return {}`
    // The client calls this code and does len(result), so must return dict not None.
    // co_code = BUILD_MAP(0) + RETURN_VALUE = \x69\x00\x00\x53
    // co_stacksize = 1 (one dict on stack)
    const py2codeHex =
      "630000000000000000010000004300000073040000006900005328010000004e280000000028000000002800000000280000000073080000003c737472696e673e740100000066010000007300000000";
    return [Buffer.from(py2codeHex, "hex"), 0];
  }

  Handle_GetContactList(args, session) {
    log.debug("[CharMgr] GetContactList called");
    // EVEmu returns util.KeyVal with 'addresses' and 'blocked' rowsets
    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["addresses", { type: "list", items: [] }],
          ["blocked", { type: "list", items: [] }],
        ],
      },
    };
  }
}

module.exports = CharMgrService;
