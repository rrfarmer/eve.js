/**
 * CHARACTER SERVICE
 * (skeleton code by AI, updated by Icey)
 *
 * handles character selection, creation, and related operations
 * 
 * TODO: update support for new database controller
 */

const fs = require("fs");
const path = require("path");
const BaseService = require("../baseService");

const log = require("../../utils/logger");
const database = require("../../newDatabase")
const config = require("../../config")

/**
 * Build a util.KeyVal PyObject — the only working PyObject type in V23.02
 */
function buildKeyVal(entries) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: entries,
    },
  };
}

class CharService extends BaseService {
  constructor() {
    super("charUnboundMgr");
  }

  /**
   * GetCharactersToSelect — V23.02 client calls this locally, which
   * internally calls GetCharacterSelectionData remotely. This handler
   * may still be called by older clients.
   */
  Handle_GetCharactersToSelect(args, session) {
    log.info("[CharService] GetCharactersToSelect");

    const charactersResult = database.read("characters", "/")
    const characters = charactersResult.success ? charactersResult.data : {}
    const userId = session ? session.userid : 0;

    const charList = [];
    for (const [charId, charData] of Object.entries(characters)) {
      if (charData.accountId === userId) {
        charList.push(
          buildKeyVal([
            ["characterID", parseInt(charId)],
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

    const accountResult = database.read("accounts", "/")
    const accounts = accountResult.success ? accountResult.data : {}

    const charactersResult = database.read("characters", "/")
    const characters = charactersResult.success ? charactersResult.data : {}

    const userId = session ? session.userid : 0;
    // find account from userid
    let accountUsername = "user";
    if (accounts) {
      for (const [username, acct] of Object.entries(accounts)) {
        if (acct.id === userId) {
          accountUsername = username;
          break;
        }
      }
    }

    // element 1: user details
    const userDetailsKeyVal = buildKeyVal([
      ["characterSlots", 3],
      ["userName", accountUsername],
      ["creationDate", { type: "long", value: 132000000000000000 }],
      ["subscriptionEndTime", { type: "long", value: 253370764800000000 }], // not sure if we need this.
      ["maxCharacterSlots", 3],
    ]);
    const userDetails = { type: "list", items: [userDetailsKeyVal] };

    // element 2: training details
    // default is (None, None). used for subscription end time display.
    const trainingDetails = [null, null];

    // element 3: character details
    const characterDetails = [];
    for (const [charId, c] of Object.entries(characters)) {
      if (c.accountId === userId) {
        const cid = parseInt(charId);
        characterDetails.push(
          buildKeyVal([
            ["characterID", cid],
            ["characterName", c.characterName || "Unknown"],
            ["deletePrepareDateTime", null],
            ["gender", c.gender || 1],
            ["typeID", c.typeID || 1373],
            ["bloodlineID", c.bloodlineID || 1],
            ["corporationID", c.corporationID || 1000009],
            ["allianceID", c.allianceID || 0],
            ["factionID", null],
            ["stationID", c.stationID || 60003760],
            ["solarSystemID", c.solarSystemID || 30000142],
            ["constellationID", c.constellationID || 20000020],
            ["regionID", c.regionID || 10000002],
            ["balance", c.balance || 100000.0],
            ["balanceChange", 0.0],
            ["skillPoints", c.skillPoints || 50000],
            ["shipTypeID", c.shipTypeID || 606],
            ["shipName", c.shipName || "Velator"],
            ["securityRating", c.securityRating || 0.0],
            ["title", c.title || ""],
            ["unreadMailCount", c.unreadMailCount || 0],
            ["paperdollState", c.paperDollState || 0],
            ["lockTypeID", null],
            [
              "logoffDate",
              { type: "long", value: c.logoffDate || 132000000000000000 },
            ],
            // Skill training info — null = not currently training
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

    // ── Element 4: wars ──
    // Client iterates: for eachWar in wars: eachWar.characterID
    const wars = { type: "list", items: [] };

    log.debug(
      `[CharService] GetCharacterSelectionData: returning ${characterDetails.length} chars`,
    );

    // Return 4-tuple matching V23.02 charselData.py unpack
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
      const entry = kwargs.entries.find((e) => e[0] === "characterID");
      if (entry) charId = entry[1];
    }
    log.info(`[CharService] GetCharacterToSelect(${charId})`);

    const characterResult = database.read("characters", "/")
    const characters = characterResult.success ? characterResult.data : {}
    const c = characters[String(charId)];

    if (!c) {
      log.warn(`[CharService] Character ${charId} not found`);
      return null;
    }

    return buildKeyVal([
      ["unreadMailCount", c.unreadMailCount || 0],
      ["upcomingEventCount", c.upcomingEventCount || 0],
      ["unprocessedNotifications", c.unprocessedNotifications || 0],
      ["characterID", parseInt(charId)],
      ["petitionMessage", c.petitionMessage || ""],
      ["gender", c.gender || 1],
      ["bloodlineID", c.bloodlineID || 1],
      [
        "createDateTime",
        { type: "long", value: c.createDateTime || 132000000000000000 },
      ],
      [
        "startDateTime",
        { type: "long", value: c.startDateTime || 132000000000000000 },
      ],
      ["corporationID", c.corporationID || 1000009],
      ["worldSpaceID", c.worldSpaceID || 0],
      ["stationID", c.stationID || 60003760],
      ["solarSystemID", c.solarSystemID || 30000142],
      ["constellationID", c.constellationID || 20000020],
      ["regionID", c.regionID || 10000002],
      ["allianceID", c.allianceID || 0],
      ["allianceMemberStartDate", c.allianceMemberStartDate || 0],
      ["shortName", c.shortName || "none"],
      ["bounty", c.bounty || 0.0],
      ["skillQueueEndTime", { type: "long", value: c.skillQueueEndTime || 0 }],
      ["skillPoints", c.skillPoints || 50000],
      ["shipTypeID", c.shipTypeID || 606],
      ["shipName", c.shipName || "Ship"],
      ["securityRating", c.securityRating || 0.0],
      ["title", c.title || ""],
      ["balance", c.balance || 100000.0],
      ["aurBalance", c.aurBalance || 0.0],
      ["daysLeft", c.daysLeft || 365],
      ["userType", c.userType || 30],
      ["paperDollState", c.paperDollState || 0],
    ]);
  }
  /**
   * CreateCharacterWithDoll — V23.02 character creation
   * EVEmu signature: (characterName, bloodlineID, genderID, ancestryID, characterInfo, portraitInfo, schoolID)
   * Returns the new characterID
   */
  Handle_CreateCharacterWithDoll(args, session) {
    // V23.02 args (8): [name, bloodlineID, ancestryID, genderID, ???, characterInfo, portraitInfo, schoolID]
    let characterName = args && args.length > 0 ? args[0] : "New Character";
    const bloodlineID = args && args.length > 1 ? args[1] : 1;
    const ancestryID = args && args.length > 2 ? args[2] : 1;
    const genderID = args && args.length > 3 ? args[3] : 1;
    // args[4] = unknown V23.02 field (64?)
    // args[5] = characterInfo (KeyVal with paperdoll DNA/appearance)
    // args[6] = portraitInfo (KeyVal with portrait camera/pose data)
    const schoolID = args && args.length > 7 ? args[7] : 11;

    // Handle name as Buffer, WString object, or string
    if (Buffer.isBuffer(characterName)) {
      characterName = characterName.toString("utf8");
    } else if (characterName && typeof characterName === "object") {
      characterName =
        characterName.value ||
        characterName.name ||
        JSON.stringify(characterName);
    }

    log.info(
      `[CharService] CreateCharacterWithDoll: name="${characterName}" bloodline=${bloodlineID} gender=${genderID} ancestry=${ancestryID} school=${schoolID}`,
    );

    // Read db and generate a new character ID
    const characterResult = database.read("characters", "/")
    const characters = characterResult.success ? characterResult.data : {}

    // Find next available character ID (start at 140000001)
    const existingIds = Object.keys(characters).map(Number);
    const newCharId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 140000001;

    // warning: data below may be innacurate (race -> type -> corp from bloodline)
    // determine race, type, and corp from bloodline
    const bloodlineInfo = {
      1: { raceID: 1, typeID: 1373, corpID: 1000006 }, // Amarr - Amarr
      2: { raceID: 1, typeID: 1374, corpID: 1000006 }, // Ni-Kunni
      3: { raceID: 1, typeID: 1375, corpID: 1000009 }, // Civire (Caldari)
      4: { raceID: 1, typeID: 1376, corpID: 1000009 }, // Deteis (Caldari)
      5: { raceID: 8, typeID: 1377, corpID: 1000115 }, // Gallente
      6: { raceID: 8, typeID: 1378, corpID: 1000115 }, // Intaki
      7: { raceID: 2, typeID: 1379, corpID: 1000044 }, // Sebiestor (Minmatar)
      8: { raceID: 2, typeID: 1380, corpID: 1000044 }, // Brutor (Minmatar)
      11: { raceID: 1, typeID: 1383, corpID: 1000009 }, // Achura (Caldari)
      12: { raceID: 8, typeID: 1384, corpID: 1000115 }, // Jin-Mei
      13: { raceID: 1, typeID: 1385, corpID: 1000006 }, // Khanid
      14: { raceID: 2, typeID: 1386, corpID: 1000044 }, // Vherokior
    };

    const info = bloodlineInfo[bloodlineID] || {
      raceID: 1,
      typeID: 1373,
      corpID: 1000009,
    };
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    // Create the character entry with ALL fields accessed by V23.02 charselData.py
    characters[String(newCharId)] = {
      accountId: session ? session.userid : 1,
      characterName:
        typeof characterName === "string" ? characterName : "New Character",
      gender: genderID,
      bloodlineID: bloodlineID,
      ancestryID: ancestryID,
      raceID: info.raceID,
      typeID: info.typeID,
      corporationID: info.corpID,
      allianceID: 0,
      factionID: null,
      stationID: 60003760,
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
      allianceMemberStartDate: 0,
      // Skill training fields (null = not training)
      skillTypeID: null,
      toLevel: null,
      trainingStartTime: null,
      trainingEndTime: null,
      queueEndTime: null,
      finishSP: null,
      trainedSP: null,
      finishedSkills: [],
    };

    // save character to database
    database.write("characters", `/${String(newCharId)}`, characters[String(newCharId)]);

    log.success(
      `[CharService] Created character "${characterName}" with ID ${newCharId}`,
    );

    // Return the new character ID
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
    return false; // Allow character creation
  }

  Handle_GetCharacterInfo(args, session) {
    log.debug("[CharService] GetCharacterInfo");
    return null;
  }

  Handle_GetCharOmegaDowngradeStatus(args, session, kwargs) {
    log.debug("[CharService] GetCharOmegaDowngradeStatus");
    // Returning null indicates no downgrade pending
    return null;
  }

  Handle_SelectCharacterID(args, session, kwargs) {
    let charId = args && args.length > 0 ? args[0] : 0;
    if (charId === 0 && kwargs && kwargs.entries) {
      const entry = kwargs.entries.find((e) => e[0] === "characterID");
      if (entry) charId = entry[1];
    }
    log.info(`[CharService] SelectCharacterID(${charId})`);

    if (!session) return null;

    const characterResult = database.read("characters", "/")
    const characters = characterResult.success ? characterResult.data : {}
    const charData = characters[String(charId)];

    // Save old values for session change notification
    const oldCharID = session.characterID;
    const oldCorpID = session.corporationID;
    const oldAllianceID = session.allianceID;
    const oldStationID = session.stationID;
    const oldSolarSystemID = session.solarsystemid;
    const oldConstellationID = session.constellationID;
    const oldRegionID = session.regionID;
    const oldShipID = session.shipID;
    const oldHqID = session.hqID;
    const oldBaseID = session.baseID;
    const oldWarFactionID = session.warFactionID;

    // Update session with character data
    session.characterID = charId;
    session.characterName = charData
      ? charData.characterName || "Unknown"
      : "Unknown";
    session.corporationID = charData
      ? charData.corporationID || 1000009
      : 1000009;
    session.allianceID = charData ? charData.allianceID || 0 : 0;

    // default location: JITA 4-4 
    // TODO: make this dynamic; read from db
    const stationID = charData ? charData.stationID || 60003760 : 60003760;
    const solarsystemID = charData
      ? charData.solarSystemID || 30000142
      : 30000142;

    session.stationid = stationID;
    session.stationID = stationID;
    session.stationid2 = stationID;
    session.worldspaceid = stationID;
    session.locationid = stationID;
    session.solarsystemid2 = solarsystemID;

    // Clear space-only variable when docked. Keep ship IDs for station inventory/UI.
    session.solarsystemid = undefined;


    session.constellationID = charData
      ? charData.constellationID || 20000020
      : 20000020;
    session.regionID = charData ? charData.regionID || 10000002 : 10000002;
    // session.shipID is used in session change but EVEmu keeps it around in the DB
    session.shipID = charData ? charData.shipID || charId + 100 : charId + 100;
    session.shipid = session.shipID;
    const selectedShipTypeID = charData && Number.isInteger(charData.shipTypeID) && charData.shipTypeID > 0 ? charData.shipTypeID : 601;
    session.shipTypeID = selectedShipTypeID;
    session.hqID = charData ? charData.hqID || 0 : 0;
    session.baseID = charData ? charData.baseID || 0 : 0;
    session.warFactionID = charData ? charData.warFactionID || 0 : 0;

    log.info(
      `[CharService] Character ${session.characterName}(${charId}) selected — station=${session.stationid} system=${solarsystemID}`,
    );

    // Send OnCharacterSelected to properly initialize client UI states before the next change
    session.sendNotification("OnCharacterSelected", "clientID", []);

    // Send SessionChangeNotification with all changed attributes
    session.sendSessionChange({
      charid: [oldCharID || null, charId],
      corpid: [oldCorpID || null, session.corporationID],
      allianceid: [oldAllianceID || null, session.allianceID || null],
      stationid: [oldStationID || null, session.stationid],
      stationid2: [oldStationID || null, session.stationid2],
      worldspaceid: [null, session.worldspaceid],
      locationid: [null, session.locationid],
      solarsystemid2: [oldSolarSystemID || null, session.solarsystemid2],
      constellationid: [oldConstellationID || null, session.constellationID],
      regionid: [oldRegionID || null, session.regionID],
      shipid: [oldShipID || null, session.shipID],
      corprole: [null, 0n],
      rolesAtAll: [null, 0n],
      rolesAtBase: [null, 0n],
      rolesAtHQ: [null, 0n],
      rolesAtOther: [null, 0n],
      baseID: [oldBaseID || null, session.baseID || null],
      hqID: [oldHqID || null, session.hqID || null],
    });

    return null;
  }

  Handle_ValidateNameEx(args, session) {
    log.debug("[CharService] ValidateNameEx");
    return true; // Name is valid
  }

  Handle_GetCharacterLockType(args, session) {
    log.debug("[CharService] GetCharacterLockType");
    return null; // Returning null means no character lock
  }
}

module.exports = CharService;




