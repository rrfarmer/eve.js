/**
 * CHARACTER SERVICE
 * (skeleton code by AI, updated by Icey)
 *
 * handles character selection, creation, and related operations
 *
 * TODO: update support for new database controller
 */

const BaseService = require("../baseService");
const log = require("../../utils/logger");
const database = require("../../database");
const { applyCharacterToSession, getCharacterRecord } = require("./characterState");
const { restoreSpaceSession } = require("../../space/transitions");
const {
  ensureCharacterSkills,
  getCharacterSkillPointTotal,
} = require("../skills/skillState");

/**
 * Build a util.KeyVal PyObject — the only working PyObject type in V23.02
 */
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

function unwrapCreationArg(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return unwrapCreationArg(value.value);
    }
    if (Object.prototype.hasOwnProperty.call(value, "name")) {
      return unwrapCreationArg(value.name);
    }
  }

  return value;
}

function readCreationIntArg(args, index, fallback, legacyIndex = null) {
  const rawPrimary = args && args.length > index ? unwrapCreationArg(args[index]) : undefined;
  const rawLegacy =
    legacyIndex !== null && args && args.length > legacyIndex
      ? unwrapCreationArg(args[legacyIndex])
      : undefined;
  const candidate =
    rawPrimary !== undefined && rawPrimary !== null && rawPrimary !== ""
      ? rawPrimary
      : rawLegacy;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeCreationGender(value, fallback = 1) {
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}

function summarizeCreationArg(value, depth = 0) {
  if (depth > 3) {
    return "<max-depth>";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer:${value.toString("utf8")}>`;
  }

  if (Array.isArray(value)) {
    const summarized = value
      .slice(0, 8)
      .map((entry) => summarizeCreationArg(entry, depth + 1));
    if (value.length > 8) {
      summarized.push(`<+${value.length - 8} more>`);
    }
    return summarized;
  }

  if (typeof value === "object") {
    const summary = {};
    for (const [key, entryValue] of Object.entries(value).slice(0, 8)) {
      summary[key] = summarizeCreationArg(entryValue, depth + 1);
    }
    if (Object.keys(value).length > 8) {
      summary.__truncated__ = `<+${Object.keys(value).length - 8} more>`;
    }
    return summary;
  }

  return String(value);
}

class CharService extends BaseService {
  constructor() {
    super("charUnboundMgr");
  }

  _normalizeAllianceId(value) {
    const numeric = Number(value) || 0;
    return numeric > 0 ? numeric : null;
  }

  /**
   * GetCharactersToSelect — V23.02 client calls this locally, which
   * internally calls GetCharacterSelectionData remotely. This handler
   * may still be called by older clients.
   */
  Handle_GetCharactersToSelect(args, session) {
    log.info("[CharService] GetCharactersToSelect");

    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};
    const userId = session ? session.userid : 0;

    const charList = [];
    for (const [charId, charData] of Object.entries(characters)) {
      if (charData.accountId === userId) {
        charList.push(
          buildKeyVal([
            ["characterID", parseInt(charId, 10)],
            ["characterName", charData.characterName || "Unknown"],
            ["deletePrepareDateTime", null],
            ["gender", charData.gender || 1],
            ["typeID", charData.typeID || 1373],
          ]),
        );
      }
    }

    log.debug(
      `[CharService] Returning ${charList.length} characters for userId=${userId}`,
    );

    return { type: "list", items: charList };
  }

  /**
   * GetCharacterSelectionData — V23.02 primary entry point.
   *
   * From decompiled charselData.py line 31:
   *   userDetails, trainingDetails, characterDetails, wars = \
   *       self.charRemoteSvc.GetCharacterSelectionData()
   *
   * Returns 4-tuple: (userDetails, trainingDetails, characterDetails, wars)
   */
  Handle_GetCharacterSelectionData(args, session) {
    log.debug("[CharService] GetCharacterSelectionData");

    const accountResult = database.read("accounts", "/");
    const accounts = accountResult.success ? accountResult.data : {};

    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};

    const userId = session ? session.userid : 0;
    let accountUsername = "user";
    if (accounts) {
      for (const [username, acct] of Object.entries(accounts)) {
        if (acct.id === userId) {
          accountUsername = username;
          break;
        }
      }
    }

    const userDetailsKeyVal = buildKeyVal([
      ["characterSlots", 3],
      ["userName", accountUsername],
      ["creationDate", { type: "long", value: 132000000000000000 }],
      ["subscriptionEndTime", { type: "long", value: 157469184000000000 }],
      ["maxCharacterSlots", 3],
    ]);
    const userDetails = { type: "list", items: [userDetailsKeyVal] };

    const trainingDetails = [null, null];

    const characterDetails = [];
    for (const [charId, rawCharacter] of Object.entries(characters)) {
      if (rawCharacter.accountId === userId) {
        const character = getCharacterRecord(charId) || rawCharacter;
        const cid = parseInt(charId, 10);
        const allianceID = this._normalizeAllianceId(character.allianceID);
        const skillPoints = getCharacterSkillPointTotal(cid) || character.skillPoints || 50000;
        characterDetails.push(
          buildKeyVal([
            ["characterID", cid],
            ["characterName", character.characterName || "Unknown"],
            ["deletePrepareDateTime", null],
            ["gender", character.gender || 1],
            ["typeID", character.typeID || 1373],
            ["bloodlineID", character.bloodlineID || 1],
            ["corporationID", character.corporationID || 1000009],
            ["allianceID", allianceID],
            // Keep character-select payload close to upstream.
            // Exposing empire/school/faction state here caused the client to
            // incorrectly surface war/faction UI on the selection screen.
            ["factionID", null],
            ["stationID", character.stationID ?? null],
            ["solarSystemID", character.solarSystemID || 30000142],
            ["constellationID", character.constellationID || 20000020],
            ["regionID", character.regionID || 10000002],
            ["balance", character.balance ?? 100000.0],
            ["plexBalance", character.plexBalance ?? 2222],
            ["balanceChange", 0.0],
            ["skillPoints", skillPoints],
            ["shipTypeID", character.shipTypeID || 606],
            ["shipName", character.shipName || "Velator"],
            ["securityRating", character.securityStatus ?? character.securityRating ?? 0.0],
            ["securityStatus", character.securityStatus ?? character.securityRating ?? 0.0],
            ["title", character.title || ""],
            ["unreadMailCount", character.unreadMailCount || 0],
            ["paperdollState", character.paperDollState || 0],
            ["lockTypeID", null],
            [
              "logoffDate",
              { type: "long", value: character.logoffDate || 132000000000000000 },
            ],
            ["skillTypeID", null],
            ["toLevel", null],
            ["trainingStartTime", null],
            ["trainingEndTime", null],
            ["queueEndTime", null],
            ["finishSP", null],
            ["trainedSP", null],
            ["finishedSkills", { type: "list", items: [] }],
          ]),
        );
      }
    }

    const wars = { type: "list", items: [] };

    log.debug(
      `[CharService] GetCharacterSelectionData: returning ${characterDetails.length} chars`,
    );

    return [
      userDetails,
      trainingDetails,
      { type: "list", items: characterDetails },
      wars,
    ];
  }

  /**
   * GetCharacterToSelect — returns detailed info for one character
   */
  Handle_GetCharacterToSelect(args, session, kwargs) {
    let charId = args && args.length > 0 ? args[0] : 0;
    if (charId === 0 && kwargs && kwargs.entries) {
      const entry = kwargs.entries.find((candidate) => candidate[0] === "characterID");
      if (entry) {
        charId = entry[1];
      }
    }
    log.info(`[CharService] GetCharacterToSelect(${charId})`);

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};
    const character = getCharacterRecord(charId) || characters[String(charId)];
    const allianceID = this._normalizeAllianceId(character && character.allianceID);
    const skillPoints =
      getCharacterSkillPointTotal(charId) ||
      (character && character.skillPoints) ||
      50000;

    if (!character) {
      log.warn(`[CharService] Character ${charId} not found`);
      return null;
    }

    return buildKeyVal([
      ["unreadMailCount", character.unreadMailCount || 0],
      ["upcomingEventCount", character.upcomingEventCount || 0],
      ["unprocessedNotifications", character.unprocessedNotifications || 0],
      ["characterID", parseInt(charId, 10)],
      ["petitionMessage", character.petitionMessage || ""],
      ["gender", character.gender || 1],
      ["bloodlineID", character.bloodlineID || 1],
      [
        "createDateTime",
        { type: "long", value: character.createDateTime || 132000000000000000 },
      ],
      [
        "startDateTime",
        { type: "long", value: character.startDateTime || 132000000000000000 },
      ],
      ["corporationID", character.corporationID || 1000009],
      ["worldSpaceID", character.worldSpaceID || 0],
      ["stationID", character.stationID ?? null],
      ["solarSystemID", character.solarSystemID || 30000142],
      ["constellationID", character.constellationID || 20000020],
      ["regionID", character.regionID || 10000002],
      ["allianceID", allianceID],
      ["allianceMemberStartDate", allianceID ? character.allianceMemberStartDate || 0 : null],
      ["shortName", character.shortName || "none"],
      ["bounty", character.bounty || 0.0],
      ["skillQueueEndTime", { type: "long", value: character.skillQueueEndTime || 0 }],
      ["skillPoints", skillPoints],
      ["shipTypeID", character.shipTypeID || 606],
      ["shipName", character.shipName || "Ship"],
      ["securityRating", character.securityStatus ?? character.securityRating ?? 0.0],
      ["securityStatus", character.securityStatus ?? character.securityRating ?? 0.0],
      ["title", character.title || ""],
      ["balance", character.balance ?? 100000.0],
      ["aurBalance", character.aurBalance ?? 0.0],
      ["plexBalance", character.plexBalance ?? 2222],
      ["daysLeft", character.daysLeft || 365],
      ["userType", character.userType || 30],
      ["paperDollState", character.paperDollState || 0],
    ]);
  }

  /**
   * CreateCharacterWithDoll — V23.02 character creation
   * EVEmu signature: (characterName, bloodlineID, genderID, ancestryID, characterInfo, portraitInfo, schoolID)
   * Returns the new characterID
   */
  Handle_CreateCharacterWithDoll(args, session) {
    let characterName = args && args.length > 0 ? args[0] : "New Character";
    const bloodlineID = readCreationIntArg(args, 1, 1);
    const parsedGenderID = readCreationIntArg(args, 2, 1);
    const genderID = normalizeCreationGender(parsedGenderID, 1);
    const ancestryID = readCreationIntArg(args, 3, 1);
    const schoolID = readCreationIntArg(args, 6, 11, 7);

    if (Buffer.isBuffer(characterName)) {
      characterName = characterName.toString("utf8");
    } else if (characterName && typeof characterName === "object") {
      characterName =
        characterName.value ||
        characterName.name ||
        JSON.stringify(characterName);
    }

    log.info(
      `[CharService] CreateCharacterWithDoll rawArgs=${JSON.stringify(
        summarizeCreationArg(args),
      )}`,
    );
    if (parsedGenderID !== genderID) {
      log.warn(
        `[CharService] CreateCharacterWithDoll clamped invalid gender=${parsedGenderID} -> ${genderID}`,
      );
    }
    log.info(
      `[CharService] CreateCharacterWithDoll: name="${characterName}" bloodline=${bloodlineID} gender=${genderID} ancestry=${ancestryID} school=${schoolID}`,
    );

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};

    const existingIds = Object.keys(characters).map(Number);
    const newCharId =
      existingIds.length > 0 ? Math.max(...existingIds) + 1 : 140000001;

    const bloodlineInfo = {
      1: { raceID: 1, typeID: 1373, corpID: 1000006 },
      2: { raceID: 1, typeID: 1374, corpID: 1000006 },
      3: { raceID: 1, typeID: 1375, corpID: 1000009 },
      4: { raceID: 1, typeID: 1376, corpID: 1000009 },
      5: { raceID: 8, typeID: 1377, corpID: 1000115 },
      6: { raceID: 8, typeID: 1378, corpID: 1000115 },
      7: { raceID: 2, typeID: 1379, corpID: 1000044 },
      8: { raceID: 2, typeID: 1380, corpID: 1000044 },
      11: { raceID: 1, typeID: 1383, corpID: 1000009 },
      12: { raceID: 8, typeID: 1384, corpID: 1000115 },
      13: { raceID: 1, typeID: 1385, corpID: 1000006 },
      14: { raceID: 2, typeID: 1386, corpID: 1000044 },
    };

    const info = bloodlineInfo[bloodlineID] || {
      raceID: 1,
      typeID: 1373,
      corpID: 1000009,
    };
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    characters[String(newCharId)] = {
      accountId: session ? session.userid : 1,
      characterName:
        typeof characterName === "string" ? characterName : "New Character",
      gender: genderID,
      bloodlineID,
      ancestryID,
      raceID: info.raceID,
      typeID: info.typeID,
      corporationID: info.corpID,
      schoolID: schoolID || info.corpID,
      allianceID: 0,
      factionID: null,
      stationID: 60003760,
      homeStationID: 60003760,
      cloneStationID: 60003760,
      solarSystemID: 30000142,
      constellationID: 20000020,
      regionID: 10000002,
      createDateTime: now.toString(),
      startDateTime: now.toString(),
      logoffDate: now.toString(),
      deletePrepareDateTime: null,
      lockTypeID: null,
      securityRating: 0.0,
      title: "",
      description: "Character created via EVE.js",
      balance: 100000.0,
      aurBalance: 0.0,
      plexBalance: 2222,
      balanceChange: 0.0,
      skillPoints: 50000,
      shipTypeID: 606,
      shipName: "Velator",
      bounty: 0.0,
      skillQueueEndTime: 0,
      daysLeft: 365,
      userType: 30,
      paperDollState: 0,
      petitionMessage: "",
      worldSpaceID: 0,
      unreadMailCount: 0,
      upcomingEventCount: 0,
      unprocessedNotifications: 0,
      shipID: newCharId + 100,
      shortName: "none",
      employmentHistory: [
        {
          corporationID: info.corpID,
          startDate: now.toString(),
          deleted: 0,
        },
      ],
      standingData: {
        char: [],
        corp: [],
        npc: [],
      },
      characterAttributes: {
        charisma: 20,
        intelligence: 20,
        memory: 20,
        perception: 20,
        willpower: 20,
      },
      respecInfo: {
        freeRespecs: 3,
        lastRespecDate: null,
        nextTimedRespec: null,
      },
      freeSkillPoints: 0,
      skillHistory: [],
      boosters: [],
      implants: [],
      jumpClones: [],
      timeLastCloneJump: "0",
      allianceMemberStartDate: 0,
      skillTypeID: null,
      toLevel: null,
      trainingStartTime: null,
      trainingEndTime: null,
      queueEndTime: null,
      finishSP: null,
      trainedSP: null,
      finishedSkills: [],
    };

    database.write(
      "characters",
      `/${String(newCharId)}`,
      characters[String(newCharId)],
    );
    ensureCharacterSkills(newCharId);
    const createdCharacter = getCharacterRecord(newCharId);

    log.success(
      `[CharService] Created character "${characterName}" with ID ${newCharId} ship=${createdCharacter ? createdCharacter.shipID : "unknown"}`,
    );

    return newCharId;
  }

  Handle_GetCohortsForUser(args, session) {
    log.debug("[CharService] GetCohortsForUser");
    return { type: "list", items: [] };
  }

  Handle_GetTopBounties(args, session) {
    log.debug("[CharService] GetTopBounties");
    return { type: "list", items: [] };
  }

  Handle_GetCharCreationInfo(args, session) {
    log.debug("[CharService] GetCharCreationInfo");
    return { type: "dict", entries: [] };
  }

  Handle_GetCharNewExtraCreationInfo(args, session) {
    log.debug("[CharService] GetCharNewExtraCreationInfo");
    return { type: "dict", entries: [] };
  }

  Handle_IsUserReceivingCharacter(args, session) {
    log.debug("[CharService] IsUserReceivingCharacter");
    return false;
  }

  Handle_GetCharacterInfo(args, session) {
    log.debug("[CharService] GetCharacterInfo");
    return this.Handle_GetCharacterToSelect(args, session);
  }

  Handle_GetCharOmegaDowngradeStatus(args, session, kwargs) {
    log.debug("[CharService] GetCharOmegaDowngradeStatus");
    return null;
  }

  Handle_SelectCharacterID(args, session, kwargs) {
    let charId = args && args.length > 0 ? args[0] : 0;
    if (charId === 0 && kwargs && kwargs.entries) {
      const entry = kwargs.entries.find((candidate) => candidate[0] === "characterID");
      if (entry) {
        charId = entry[1];
      }
    }
    log.info(`[CharService] SelectCharacterID(${charId})`);

    if (!session) {
      return null;
    }

    const applyResult = applyCharacterToSession(session, charId, {
      emitNotifications: true,
      logSelection: true,
    });

    if (!applyResult.success) {
      log.warn(
        `[CharService] Failed to select character ${charId}: ${applyResult.errorMsg}`,
      );
    } else if (!session.stationid && !session.stationID) {
      restoreSpaceSession(session);
    }

    return null;
  }

  Handle_ValidateNameEx(args, session) {
    log.debug("[CharService] ValidateNameEx");
    return true;
  }

  Handle_GetCharacterLockType(args, session) {
    log.debug("[CharService] GetCharacterLockType");
    return null;
  }
}

module.exports = CharService;
