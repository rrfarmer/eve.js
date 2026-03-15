const path = require("path");

const database = require(path.join(__dirname, "../../database"));
const log = require(path.join(__dirname, "../../utils/logger"));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const { resolveShipByTypeID } = require(
  path.join(__dirname, "../chat/shipTypeRegistry"),
);
const {
  ensureMigrated,
  getAllItems,
  getCharacterShipItems,
  getCharacterHangarShipItems,
  findCharacterShipItem,
  getActiveShipItem,
  spawnShipInStationHangar,
  setActiveShipForCharacter,
  deleteShipItem,
  CAPSULE_TYPE_ID,
} = require(path.join(__dirname, "../inventory/itemStore"));
const { ensureCharacterSkills, getCharacterSkillPointTotal } = require(
  path.join(__dirname, "../skills/skillState"),
);
const { setCharacterOnlineState, broadcastStationGuestEvent } = require(
  path.join(__dirname, "../station/stationPresence"),
);

const CHARACTERS_TABLE = "characters";
const INV_UPDATE_LOCATION = 3;
const INV_UPDATE_FLAG = 4;
const INV_UPDATE_QUANTITY = 5;
const INV_UPDATE_STACKSIZE = 9; // may need to be swapped with below
const INV_UPDATE_SINGLETON = 10; // may need to be swapped with above
const INVENTORY_ROW_DESCRIPTOR_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 3],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["singleton", 2],
  ["stacksize", 3],
];
const EMPIRE_BY_CORPORATION = Object.freeze({
  1000044: 500001,
  1000115: 500002,
  1000009: 500003,
  1000006: 500004,
});
const FITTED_SLOT_FLAGS = Object.freeze([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  30, 31, 32, 33, 34, 92, 93, 94,
]);
const FITTED_SLOT_FLAG_SET = new Set(FITTED_SLOT_FLAGS);
const DEFAULT_PLEX_BALANCE = 2222;
const DEFAULT_CHARACTER_ATTRIBUTES = Object.freeze({
  charisma: 20,
  intelligence: 20,
  memory: 20,
  perception: 20,
  willpower: 20,
});
const DEFAULT_RESPEC_INFO = Object.freeze({
  freeRespecs: 3,
  lastRespecDate: null,
  nextTimedRespec: null,
});
const DEFAULT_MCT_EXPIRY_FILETIME = "157469184000000000";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.trunc(numeric);
}

function resolveSystemIdentity(solarSystemID, fallback = {}) {
  const system = worldData.getSolarSystemByID(solarSystemID);
  return {
    constellationID:
      Number(
        (system && system.constellationID) || fallback.constellationID || 0,
      ) || 20000020,
    regionID:
      Number((system && system.regionID) || fallback.regionID || 0) || 10000002,
  };
}

function buildList(items) {
  return { type: "list", items };
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeCharacterRecord(charId, record) {
  const clonedRecord = cloneValue(record);
  const writeResult = database.write(
    CHARACTERS_TABLE,
    `/${String(charId)}`,
    clonedRecord,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
    };
  }

  return {
    success: true,
    data: clonedRecord,
  };
}

function toBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }

    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function normalizeSessionShipValue(value) {
  if (value === undefined || value === null || value === 0) {
    return null;
  }

  return value;
}

function appendSessionChange(changes, key, oldValue, newValue) {
  if (oldValue === newValue) {
    return;
  }

  changes[key] = [oldValue, newValue];
}

function hasLocationID(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function normalizeWorldSpaceID(record = {}) {
  const stationID = hasLocationID(record.stationID)
    ? Number(record.stationID)
    : null;
  const worldSpaceID = hasLocationID(record.worldSpaceID)
    ? Number(record.worldSpaceID)
    : null;

  if (!worldSpaceID) {
    return 0;
  }

  // NPC station hangars are station sessions, not separate worldspaces.
  // Mirroring stationID into worldSpaceID makes the client treat login/dock as
  // a mixed location transition and it rebuilds the hangar presentation twice.
  if (stationID && worldSpaceID === stationID) {
    return 0;
  }

  return worldSpaceID;
}

function deriveEmpireID(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(record, "empireID")) {
    if (
      record.empireID === null ||
      record.empireID === undefined ||
      record.empireID === 0
    ) {
      return null;
    }

    return Number(record.empireID) || null;
  }

  const corporationID = Number(record.corporationID || 0);
  return EMPIRE_BY_CORPORATION[corporationID] || null;
}

function deriveFactionID(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(record, "factionID")) {
    if (
      record.factionID === null ||
      record.factionID === undefined ||
      record.factionID === 0
    ) {
      return null;
    }

    return Number(record.factionID) || null;
  }

  return null;
}

function buildDefaultEmploymentHistory(record = {}) {
  const createdAt = String(
    record.startDateTime || record.createDateTime || "132000000000000000",
  );
  const schoolCorpID =
    Number(record.schoolID || record.corporationID || 1000009) || 1000009;
  const currentCorpID =
    Number(record.corporationID || schoolCorpID) || schoolCorpID;
  const history = [
    {
      corporationID: schoolCorpID,
      startDate: createdAt,
      deleted: 0,
    },
  ];

  if (currentCorpID !== schoolCorpID) {
    history.push({
      corporationID: currentCorpID,
      startDate: createdAt,
      deleted: 0,
    });
  }

  return history;
}

function normalizeEmploymentHistory(record = {}) {
  const source = Array.isArray(record.employmentHistory)
    ? record.employmentHistory
    : buildDefaultEmploymentHistory(record);
  const normalized = source
    .map((entry) => ({
      corporationID:
        Number(entry && entry.corporationID) ||
        Number(record.corporationID || 1000009) ||
        1000009,
      startDate: String(
        (entry && (entry.startDate || entry.startDateTime)) ||
          record.startDateTime ||
          record.createDateTime ||
          "132000000000000000",
      ),
      deleted: entry && entry.deleted ? 1 : 0,
    }))
    .sort((left, right) =>
      String(left.startDate).localeCompare(String(right.startDate)),
    );

  return normalized.length ? normalized : buildDefaultEmploymentHistory(record);
}

function getCurrentCorporationStartDate(record = {}, employmentHistory = null) {
  const currentCorporationID = Number(record.corporationID || 0) || 0;
  const history = Array.isArray(employmentHistory)
    ? employmentHistory
    : normalizeEmploymentHistory(record);
  const currentEntry = history
    .filter(
      (entry) =>
        (Number(entry && entry.corporationID) || 0) === currentCorporationID,
    )
    .sort((left, right) =>
      String(left.startDate).localeCompare(String(right.startDate)),
    )
    .pop();

  return String(
    (currentEntry && currentEntry.startDate) ||
      record.startDateTime ||
      record.createDateTime ||
      "132000000000000000",
  );
}

function buildDefaultStandingData(charId, record = {}) {
  const characterID = Number(charId || 0) || 0;
  const corporationID = Number(record.corporationID || 1000009) || 1000009;
  const empireID = Number(record.empireID || deriveEmpireID(record) || 0) || 0;
  const factionID = Number(record.factionID || 0) || empireID || 0;
  const npcRows = [];

  if (characterID && corporationID) {
    npcRows.push({ fromID: characterID, toID: corporationID, standing: 1.25 });
    npcRows.push({ fromID: corporationID, toID: characterID, standing: 1.25 });
  }

  if (characterID && factionID) {
    npcRows.push({ fromID: characterID, toID: factionID, standing: 0.75 });
    npcRows.push({ fromID: factionID, toID: characterID, standing: 0.75 });
  }

  if (corporationID && factionID) {
    npcRows.push({ fromID: corporationID, toID: factionID, standing: 2.0 });
    npcRows.push({ fromID: factionID, toID: corporationID, standing: 2.0 });
  }

  return {
    char: npcRows.filter(
      (entry) => entry.fromID === characterID || entry.toID === characterID,
    ),
    corp: npcRows.filter(
      (entry) => entry.fromID === corporationID || entry.toID === corporationID,
    ),
    npc: npcRows,
  };
}

function normalizeStandingRows(rows = [], fallbackRows = []) {
  const source = Array.isArray(rows) && rows.length ? rows : fallbackRows;
  return source
    .map((entry) => ({
      fromID:
        entry && Object.prototype.hasOwnProperty.call(entry, "fromID")
          ? entry.fromID
          : null,
      toID:
        entry && Object.prototype.hasOwnProperty.call(entry, "toID")
          ? entry.toID
          : null,
      standing: Number(entry && entry.standing) || 0.0,
    }))
    .filter((entry) => entry.fromID !== undefined && entry.toID !== undefined);
}

function normalizeStandingData(charId, record = {}) {
  const fallback = buildDefaultStandingData(charId, record);
  const source =
    record.standingData && typeof record.standingData === "object"
      ? record.standingData
      : {};

  return {
    char: normalizeStandingRows(source.char, fallback.char),
    corp: normalizeStandingRows(source.corp, fallback.corp),
    npc: normalizeStandingRows(source.npc, fallback.npc),
  };
}

function normalizeCharacterAttributes(record = {}) {
  const source =
    record.characterAttributes && typeof record.characterAttributes === "object"
      ? record.characterAttributes
      : {};

  return {
    charisma: normalizeInteger(
      source.charisma ?? source[164],
      DEFAULT_CHARACTER_ATTRIBUTES.charisma,
    ),
    intelligence: normalizeInteger(
      source.intelligence ?? source[165],
      DEFAULT_CHARACTER_ATTRIBUTES.intelligence,
    ),
    memory: normalizeInteger(
      source.memory ?? source[166],
      DEFAULT_CHARACTER_ATTRIBUTES.memory,
    ),
    perception: normalizeInteger(
      source.perception ?? source[167],
      DEFAULT_CHARACTER_ATTRIBUTES.perception,
    ),
    willpower: normalizeInteger(
      source.willpower ?? source[168],
      DEFAULT_CHARACTER_ATTRIBUTES.willpower,
    ),
  };
}

function normalizeRespecInfo(record = {}) {
  const source =
    record.respecInfo && typeof record.respecInfo === "object"
      ? record.respecInfo
      : DEFAULT_RESPEC_INFO;

  return {
    freeRespecs: normalizeInteger(
      source.freeRespecs,
      DEFAULT_RESPEC_INFO.freeRespecs,
    ),
    lastRespecDate: source.lastRespecDate || null,
    nextTimedRespec: source.nextTimedRespec || null,
  };
}

function resolveHomeStationInfo(charData = {}, session = null) {
  const authoritativeHomeStationID =
    Number(charData.homeStationID || charData.cloneStationID || 0) || 0;
  const fallbackHomeStationID =
    Number(
      charData.stationID ||
        charData.worldSpaceID ||
        (session &&
          (session.homeStationID ||
            session.cloneStationID ||
            session.stationID ||
            session.stationid ||
            session.worldspaceid)) ||
        60003760,
    ) || 60003760;
  const homeStationID = authoritativeHomeStationID || fallbackHomeStationID;

  return {
    homeStationID,
    cloneStationID:
      Number(
        charData.cloneStationID || authoritativeHomeStationID || homeStationID,
      ) || homeStationID,
    isFallback: !authoritativeHomeStationID,
  };
}

function normalizeCharacterRecord(charId, record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  ensureMigrated();
  ensureCharacterSkills(charId);

  const normalized = {
    ...record,
  };
  const activeShip = getActiveShipItem(charId);
  const totalSkillPoints = getCharacterSkillPointTotal(charId);
  const gender = Number(normalized.gender);

  normalized.gender = gender === 0 || gender === 1 || gender === 2 ? gender : 1;

  if (activeShip) {
    normalized.shipID = activeShip.itemID;
    normalized.shipTypeID = activeShip.typeID;
    normalized.shipName = activeShip.itemName;
  }

  if (!Object.prototype.hasOwnProperty.call(normalized, "factionID")) {
    normalized.factionID = null;
  }
  normalized.factionID = deriveFactionID(normalized);
  normalized.empireID = deriveEmpireID(normalized);
  normalized.plexBalance = normalizeInteger(
    normalized.plexBalance,
    DEFAULT_PLEX_BALANCE,
  );
  if (!normalized.schoolID) {
    normalized.schoolID = normalized.corporationID || null;
  }
  normalized.securityStatus = Number(
    normalized.securityStatus ?? normalized.securityRating ?? 0,
  );
  normalized.securityRating = normalized.securityStatus;
  normalized.worldSpaceID = normalizeWorldSpaceID(normalized);
  normalized.characterAttributes = normalizeCharacterAttributes(normalized);
  normalized.respecInfo = normalizeRespecInfo(normalized);
  normalized.freeSkillPoints = normalizeInteger(normalized.freeSkillPoints, 0);
  normalized.skillHistory = Array.isArray(normalized.skillHistory)
    ? normalized.skillHistory.map((entry) => ({ ...entry }))
    : [];
  normalized.boosters = Array.isArray(normalized.boosters)
    ? normalized.boosters.map((entry) => ({ ...entry }))
    : [];
  normalized.implants = Array.isArray(normalized.implants)
    ? normalized.implants.map((entry) => ({ ...entry }))
    : [];
  normalized.jumpClones = Array.isArray(normalized.jumpClones)
    ? normalized.jumpClones.map((entry) => ({ ...entry }))
    : [];
  normalized.timeLastCloneJump = String(normalized.timeLastCloneJump || "0");
  normalized.employmentHistory = normalizeEmploymentHistory(normalized);
  normalized.startDateTime = getCurrentCorporationStartDate(
    normalized,
    normalized.employmentHistory,
  );
  normalized.standingData = normalizeStandingData(charId, normalized);
  if (Number.isFinite(totalSkillPoints) && totalSkillPoints > 0) {
    normalized.skillPoints = totalSkillPoints;
  }

  const homeStationInfo = resolveHomeStationInfo(normalized);
  normalized.homeStationID = homeStationInfo.homeStationID;
  normalized.cloneStationID = homeStationInfo.cloneStationID;

  if (Object.prototype.hasOwnProperty.call(normalized, "storedShips")) {
    delete normalized.storedShips;
  }

  return normalized;
}

function getCharacterRecord(charId) {
  ensureMigrated();

  const characters = readCharacters();
  const rawRecord = characters[String(charId)];
  if (!rawRecord) {
    return null;
  }

  const normalizedRecord = normalizeCharacterRecord(charId, rawRecord);
  if (!normalizedRecord) {
    return null;
  }

  if (JSON.stringify(rawRecord) !== JSON.stringify(normalizedRecord)) {
    writeCharacterRecord(charId, normalizedRecord);
  }

  return normalizedRecord;
}

function updateCharacterRecord(charId, updater) {
  const currentRecord = getCharacterRecord(charId);
  if (!currentRecord) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const updatedRecord =
    typeof updater === "function"
      ? updater(cloneValue(currentRecord))
      : updater;
  const normalizedRecord = normalizeCharacterRecord(charId, updatedRecord);
  return writeCharacterRecord(charId, normalizedRecord);
}

function getCharacterShips(charId) {
  return getCharacterShipItems(charId);
}

function findCharacterShip(charId, shipId) {
  return findCharacterShipItem(charId, shipId);
}

function getActiveShipRecord(charId) {
  return getActiveShipItem(charId);
}

function buildInventoryItemRow(item) {
  return {
    type: "packedrow",
    header: {
      type: "objectex1",
      header: [
        { type: "token", value: "blue.DBRowDescriptor" },
        [INVENTORY_ROW_DESCRIPTOR_COLUMNS],
      ],
      list: [],
      dict: [],
    },
    columns: INVENTORY_ROW_DESCRIPTOR_COLUMNS,
    fields: {
      itemID: item.itemID,
      typeID: item.typeID,
      ownerID: item.ownerID,
      locationID: item.locationID,
      flagID: item.flagID,
      quantity: item.quantity,
      groupID: item.groupID,
      categoryID: item.categoryID,
      customInfo: item.customInfo || "",
      singleton: item.singleton,
      stacksize: item.stacksize,
    },
  };
}

function buildLocationChangePayload(item) {
  return buildList([item.itemID, item.itemName || "Ship", 0.0, 0.0, 0.0, null]);
}

function buildItemChangePayload(item, previousState = {}) {
  const entries = [];
  const currentQuantity = Number(item && item.quantity);
  const previousQuantity = Number(previousState.quantity);

  if (
    previousState.locationID !== undefined &&
    previousState.locationID !== item.locationID
  ) {
    entries.push([INV_UPDATE_LOCATION, previousState.locationID]);
  }

  if (
    previousState.flagID !== undefined &&
    previousState.flagID !== item.flagID
  ) {
    entries.push([INV_UPDATE_FLAG, previousState.flagID]);
  }

  if (
    previousState.quantity !== undefined &&
    Number.isFinite(previousQuantity) &&
    Number.isFinite(currentQuantity) &&
    previousQuantity >= 0 &&
    currentQuantity >= 0 &&
    previousQuantity !== currentQuantity
  ) {
    entries.push([INV_UPDATE_QUANTITY, previousState.quantity]);
  }

  if (
    previousState.singleton !== undefined &&
    previousState.singleton !== item.singleton
  ) {
    entries.push([INV_UPDATE_SINGLETON, previousState.singleton]);
  }

  if (
    previousState.stacksize !== undefined &&
    previousState.stacksize !== item.stacksize
  ) {
    entries.push([INV_UPDATE_STACKSIZE, previousState.stacksize]);
  }

  return [
    buildInventoryItemRow(item),
    {
      type: "dict",
      entries,
    },
    null,
  ];
}

function syncInventoryItemForSession(
  session,
  shipItem,
  previousState = {},
  options = {},
) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !shipItem ||
    typeof shipItem !== "object"
  ) {
    return;
  }

  session.sendNotification(
    "OnItemChange",
    "clientID",
    buildItemChangePayload(shipItem, previousState),
  );

  if (options.emitCfgLocation !== false) {
    session.sendNotification("OnCfgDataChanged", "charid", [
      "evelocations",
      buildLocationChangePayload(shipItem),
    ]);
  }

  log.debug(
    `[CharacterState] Synced inventory item ${shipItem.itemID} (${shipItem.itemName || shipItem.typeID}) to client inventory`,
  );
}

function queueDeferredDockedShipSessionChange(
  session,
  shipID,
  previousClientShipID = null,
  options = {},
) {
  if (!session) {
    return;
  }

  const normalizedShipID = normalizeSessionShipValue(shipID);
  if (!normalizedShipID) {
    session._deferredDockedShipSessionChange = null;
    return;
  }

  session._deferredDockedShipSessionChange = {
    shipID: normalizedShipID,
    previousClientShipID: normalizeSessionShipValue(previousClientShipID),
    loginSelection: options.loginSelection === true,
    queuedAt: Date.now(),
    stationHangarListCount: 0,
    stationHangarSelfSeen: false,
    selfFlushTimer: null,
  };
}

function clearDeferredDockedShipSessionChangeTimer(pending) {
  if (!pending || !pending.selfFlushTimer) {
    return;
  }

  clearTimeout(pending.selfFlushTimer);
  pending.selfFlushTimer = null;
}

function scheduleDeferredDockedShipSessionChangeSelfFlush(session) {
  if (!session || !session._deferredDockedShipSessionChange) {
    return;
  }

  const pending = session._deferredDockedShipSessionChange;
  if (pending.selfFlushTimer) {
    return;
  }

  pending.selfFlushTimer = setTimeout(() => {
    if (session._deferredDockedShipSessionChange !== pending) {
      return;
    }

    flushDeferredDockedShipSessionChange(session, {
      trigger: "invbroker.GetSelfInvItemTimer",
    });
  }, 350);
}

function clearDeferredDockedShipSessionChange(session) {
  if (!session) {
    return;
  }

  clearDeferredDockedShipSessionChangeTimer(
    session._deferredDockedShipSessionChange,
  );
  session._deferredDockedShipSessionChange = null;
}

function shouldFlushDeferredDockedShipSessionChange(session, method) {
  if (!session || !session._deferredDockedShipSessionChange) {
    return false;
  }

  const pending = session._deferredDockedShipSessionChange;
  if (method === "GetSelfInvItem") {
    pending.stationHangarSelfSeen = true;
    if (pending.stationHangarListCount >= 1) {
      scheduleDeferredDockedShipSessionChangeSelfFlush(session);
    }
    return false;
  }

  if (method !== "List") {
    return false;
  }

  pending.stationHangarListCount = (pending.stationHangarListCount || 0) + 1;

  // Login needs the active ship restored as soon as the station hangar starts
  // listing ships. Waiting for a later pass can miss the hangar's initial
  // ship-presentation window entirely, which is exactly the "visible for one
  // character, invisible for most others" behavior in the latest traces.
  if (pending.loginSelection) {
    return pending.stationHangarListCount >= 1;
  }

  // The first station-hangar list is part of the initial bind/metadata pass.
  // Waiting for the follow-up list keeps shipid restoration closer to the
  // actual hangar open path instead of the char-select transition.
  return Boolean(
    pending.stationHangarSelfSeen || pending.stationHangarListCount >= 2,
  );
}

function flushDeferredDockedShipSessionChange(session, options = {}) {
  if (
    !session ||
    typeof session.sendSessionChange !== "function" ||
    !session._deferredDockedShipSessionChange
  ) {
    return false;
  }

  const pending = session._deferredDockedShipSessionChange;
  clearDeferredDockedShipSessionChangeTimer(pending);
  const shipID = normalizeSessionShipValue(pending.shipID);
  if (!shipID) {
    session._deferredDockedShipSessionChange = null;
    return false;
  }

  session.sendSessionChange(
    {
      shipid: [null, shipID],
    },
    {
      // Login's deferred active-ship restore behaves like a late remote
      // attribute update, not the initial character-select session bootstrap.
      // Using the bootstrap SID here correlates with the client creating a
      // second local session and logging "Session SID collision!".
      sessionId: 0n,
    },
  );

  session._deferredDockedShipSessionChange = null;
  log.info(
    `[CharacterState] Flushed deferred docked shipid=${shipID} trigger=${options.trigger || "unknown"}`,
  );
  return true;
}

function applyCharacterToSession(session, charId, options = {}) {
  if (!session) {
    return {
      success: false,
      errorMsg: "SESSION_REQUIRED",
    };
  }

  // Character selection reuses the same client session object. Any deferred
  // docked-ship restore still hanging off a previous character selection can
  // flush into the new login and restore the wrong shipid a second later.
  // Start every fresh SelectCharacterID from a clean deferred state.
  if (options.selectionEvent !== false) {
    clearDeferredDockedShipSessionChange(session);
  }

  const charData = getCharacterRecord(charId);
  if (!charData) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(charId) ||
    resolveShipByTypeID(charData.shipTypeID || 606) || {
      itemID: charData.shipID || Number(charId) + 100,
      typeID: charData.shipTypeID || 606,
      itemName: charData.shipName || "Ship",
    };

  const oldCharID = session.characterID;
  const oldCorpID = session.corporationID;
  const oldAllianceID = session.allianceID;
  const oldStationID = session.stationID || session.stationid || null;
  const oldStationID2 = session.stationid2 || null;
  const oldSolarSystemID = session.solarsystemid || null;
  const oldSolarSystemID2 = session.solarsystemid2 || null;
  const oldConstellationID = session.constellationID;
  const oldRegionID = session.regionID;
  const oldGenderID = session.genderID ?? session.genderid ?? null;
  const oldBloodlineID = session.bloodlineID ?? session.bloodlineid ?? null;
  const oldRaceID = session.raceID ?? session.raceid ?? null;
  const oldSchoolID = session.schoolID ?? session.schoolid ?? null;
  const oldShipID = normalizeSessionShipValue(
    session.shipID ?? session.shipid ?? null,
  );
  const oldLocationID = session.locationid ?? null;
  const oldWorldspaceID = session.worldspaceid ?? null;
  const oldHqID = session.hqID;
  const oldBaseID = session.baseID;
  const oldWarFactionID = session.warFactionID;
  const oldCorpRole = session.corprole ?? null;
  const oldRolesAtAll = session.rolesAtAll ?? null;
  const oldRolesAtBase = session.rolesAtBase ?? null;
  const oldRolesAtHQ = session.rolesAtHQ ?? null;
  const oldRolesAtOther = session.rolesAtOther ?? null;
  const storedStationID = hasLocationID(charData.stationID)
    ? Number(charData.stationID)
    : null;
  const storedWorldSpaceID = hasLocationID(charData.worldSpaceID)
    ? Number(charData.worldSpaceID)
    : null;
  const storedSolarSystemID = hasLocationID(charData.solarSystemID)
    ? Number(charData.solarSystemID)
    : 30000142;
  const homeStationInfo = resolveHomeStationInfo(charData, session);
  const homeStationID = homeStationInfo.homeStationID;
  const cloneStationID = homeStationInfo.cloneStationID;
  const isDocked = Boolean(storedStationID);
  const stationID = isDocked ? storedStationID : null;
  const solarSystemID = storedSolarSystemID || 30000142;
  const systemIdentity = resolveSystemIdentity(solarSystemID, charData);
  const shipID = activeShip.itemID || charData.shipID || Number(charId) + 100;
  const shipTypeID = activeShip.typeID || charData.shipTypeID || 601;
  const shipMetadata = resolveShipByTypeID(shipTypeID);

  session.characterID = charId;
  session.charid = charId;
  session.characterName = charData.characterName || "Unknown";
  session.characterTypeID = charData.typeID || 1373;
  session.genderID = charData.gender || 1;
  session.genderid = session.genderID;
  session.bloodlineID = charData.bloodlineID || 1;
  session.bloodlineid = session.bloodlineID;
  session.raceID = charData.raceID || 1;
  session.raceid = session.raceID;
  session.schoolID = charData.schoolID || charData.corporationID || null;
  session.schoolid = session.schoolID;
  session.corporationID = charData.corporationID || 1000009;
  session.corpid = session.corporationID;
  session.allianceID = charData.allianceID || null;
  session.allianceid = session.allianceID || null;
  session.stationid = isDocked ? stationID : null;
  session.stationID = isDocked ? stationID : null;
  session.stationid2 = isDocked ? stationID : null;
  session.worldspaceid = storedWorldSpaceID || null;
  session.locationid = isDocked ? stationID : solarSystemID;
  session.homeStationID = homeStationID;
  session.homestationid = homeStationID;
  session.cloneStationID = cloneStationID;
  session.clonestationid = cloneStationID;
  session.solarsystemid2 = solarSystemID;
  session.solarsystemid = isDocked ? null : solarSystemID;
  session.constellationID = systemIdentity.constellationID;
  session.constellationid = session.constellationID;
  session.regionID = systemIdentity.regionID;
  session.regionid = session.regionID;
  session.activeShipID = shipID;
  // V23.02 station flow still expects the active ship to remain present in the
  // session while docked. Clearing it breaks hangar ship presentation and ship
  // boarding updates in invCache/godma.
  session.shipID = shipID;
  session.shipid = shipID;
  session.shipTypeID = shipTypeID;
  session.shipName =
    (shipMetadata && shipMetadata.name) ||
    activeShip.itemName ||
    charData.shipName ||
    "Ship";
  session.skillPoints = charData.skillPoints || 0;
  session.plexBalance = normalizeInteger(
    charData.plexBalance,
    DEFAULT_PLEX_BALANCE,
  );
  session.hqID = charData.hqID || null;
  session.baseID = charData.baseID || null;
  session.warFactionID = charData.warFactionID || null;
  session.warfactionid = session.warFactionID || null;
  session.corprole = 0n;
  session.rolesAtAll = 0n;
  session.rolesAtBase = 0n;
  session.rolesAtHQ = 0n;
  session.rolesAtOther = 0n;

  const onlineStateResult = setCharacterOnlineState(charId, true, {
    stationID: stationID || undefined,
  });
  if (!onlineStateResult.success) {
    log.warn(
      `[CharState] Failed to mark character ${charId} online: ${onlineStateResult.errorMsg}`,
    );
  }

  if (options.emitNotifications !== false) {
    const isCharacterSelection =
      options.selectionEvent !== false &&
      (oldCharID === undefined || oldCharID === null || oldCharID !== charId);
    const isInitialCharacterSelection =
      isCharacterSelection &&
      (oldCharID === undefined || oldCharID === null || oldCharID === 0);

    const enteredStationFromNonStation =
      isDocked &&
      !oldStationID &&
      !isInitialCharacterSelection &&
      Boolean(oldLocationID || oldSolarSystemID || oldSolarSystemID2);
    // Fresh docked login must carry shipid in the initial station session
    // change. V23.02 primes invCache/godma during that first station
    // transition, and deferring shipid until the hangar list arrives leaves
    // session.shipid as None inside PrimeLocation.
    const deferDockedShipSessionChange =
      options.deferDockedShipSessionChange !== false &&
      isDocked &&
      enteredStationFromNonStation;
    if (isCharacterSelection) {
      session.sendNotification("OnCharacterSelected", "clientID", []);
    }

    const sessionChanges = {};
    appendSessionChange(sessionChanges, "charid", oldCharID || null, charId);
    appendSessionChange(
      sessionChanges,
      "corpid",
      oldCorpID || null,
      session.corporationID,
    );
    appendSessionChange(
      sessionChanges,
      "allianceid",
      oldAllianceID || null,
      session.allianceID || null,
    );
    // The client starts without character identity fields in its session.
    // If a selected character happens to match the server-side constructor
    // defaults (for example Minmatar 1/1), suppressing these "unchanged"
    // values leaves the client session incomplete and breaks clone-grade
    // checks while rendering station ships.
    appendSessionChange(
      sessionChanges,
      "genderID",
      isInitialCharacterSelection ? null : oldGenderID,
      session.genderID,
    );
    appendSessionChange(
      sessionChanges,
      "bloodlineID",
      isInitialCharacterSelection ? null : oldBloodlineID,
      session.bloodlineID,
    );
    appendSessionChange(
      sessionChanges,
      "raceID",
      isInitialCharacterSelection ? null : oldRaceID,
      session.raceID,
    );
    appendSessionChange(
      sessionChanges,
      "schoolID",
      oldSchoolID,
      session.schoolID,
    );
    appendSessionChange(
      sessionChanges,
      "stationid",
      oldStationID || null,
      session.stationid || null,
    );
    appendSessionChange(
      sessionChanges,
      "stationid2",
      oldStationID2 || null,
      session.stationid2 || null,
    );
    appendSessionChange(
      sessionChanges,
      "solarsystemid",
      oldSolarSystemID || null,
      session.solarsystemid || null,
    );
    appendSessionChange(
      sessionChanges,
      "solarsystemid2",
      oldSolarSystemID2 || null,
      session.solarsystemid2 || null,
    );
    appendSessionChange(
      sessionChanges,
      "constellationid",
      oldConstellationID || null,
      session.constellationID,
    );
    appendSessionChange(
      sessionChanges,
      "regionid",
      oldRegionID || null,
      session.regionID,
    );
    appendSessionChange(
      sessionChanges,
      "shipid",
      normalizeSessionShipValue(oldShipID),
      deferDockedShipSessionChange
        ? null
        : normalizeSessionShipValue(session.shipID),
    );
    appendSessionChange(
      sessionChanges,
      "locationid",
      oldLocationID || null,
      session.locationid || null,
    );
    appendSessionChange(
      sessionChanges,
      "worldspaceid",
      oldWorldspaceID || null,
      session.worldspaceid || null,
    );
    if (isCharacterSelection) {
      appendSessionChange(
        sessionChanges,
        "corprole",
        oldCorpRole,
        session.corprole,
      );
      appendSessionChange(
        sessionChanges,
        "rolesAtAll",
        oldRolesAtAll,
        session.rolesAtAll,
      );
      appendSessionChange(
        sessionChanges,
        "rolesAtBase",
        oldRolesAtBase,
        session.rolesAtBase,
      );
      appendSessionChange(
        sessionChanges,
        "rolesAtHQ",
        oldRolesAtHQ,
        session.rolesAtHQ,
      );
      appendSessionChange(
        sessionChanges,
        "rolesAtOther",
        oldRolesAtOther,
        session.rolesAtOther,
      );
    }

    if (Object.keys(sessionChanges).length > 0) {
      session.sendSessionChange(sessionChanges);
    }

    if (deferDockedShipSessionChange) {
      queueDeferredDockedShipSessionChange(
        session,
        session.shipID,
        normalizeSessionShipValue(oldShipID),
        {
          loginSelection: isInitialCharacterSelection,
        },
      );
    } else {
      clearDeferredDockedShipSessionChange(session);
    }

    if (
      isDocked &&
      (oldCharID !== charId ||
        Number(oldStationID || 0) !== Number(stationID || 0))
    ) {
      broadcastStationGuestEvent(
        "OnCharNowInStation",
        {
          characterID: charId,
          corporationID: session.corporationID,
          allianceID: session.allianceID,
          warFactionID: session.warFactionID,
          stationID,
        },
        {
          excludeSession: session,
        },
      );
    }
  }

  if (options.logSelection !== false) {
    log.info(
      `[CharState] Applied ${session.characterName}(${charId}) ship=${session.shipName}(${session.shipTypeID}) activeShipID=${session.activeShipID} docked=${isDocked} station=${session.stationid} system=${solarSystemID}`,
    );
  }

  return {
    success: true,
    data: charData,
  };
}

function activateShipForSession(session, shipId, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const docked = Boolean(session.stationid || session.stationID);
  if (!docked) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const charId = session.characterID;
  const currentShip = getActiveShipRecord(charId);
  const targetShip = findCharacterShip(charId, shipId);
  if (!targetShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const updateResult = setActiveShipForCharacter(charId, targetShip.itemID);
  if (!updateResult.success) {
    return updateResult;
  }

  const applyResult = applyCharacterToSession(session, charId, {
    emitNotifications: options.emitNotifications !== false,
    logSelection: options.logSelection !== false,
    selectionEvent: false,
  });

  if (applyResult.success && options.emitNotifications !== false) {
    // Docked boarding does not move the hull between containers, so the client
    // only sees a shipid session change unless we explicitly refresh the item
    // cache entries that back the hangar/active-ship presentation.
    const refreshedTargetShip = getActiveShipRecord(charId) || targetShip;
    const refreshQueue = [];
    const seenItemIds = new Set();
    let capsuleRemovalState = null;
    const targetPreviousState =
      options &&
      options.targetPreviousState &&
      typeof options.targetPreviousState === "object"
        ? options.targetPreviousState
        : null;

    if (currentShip && currentShip.itemID !== targetShip.itemID) {
      const shouldConsumePreviousCapsule =
        Number(currentShip.typeID || 0) === CAPSULE_TYPE_ID &&
        Number(targetShip.typeID || 0) !== CAPSULE_TYPE_ID;

      if (shouldConsumePreviousCapsule) {
        const deletedCapsule = deleteShipItem(currentShip.itemID);
        if (deletedCapsule.success && deletedCapsule.previousData) {
          capsuleRemovalState = {
            ...deletedCapsule.previousData,
            locationID: 0,
            flagID: 0,
          };
        } else if (deletedCapsule.errorMsg === "SHIP_NOT_FOUND") {
          // Capsule cleanup may already have been applied by the item-store
          // reconciliation path during active-ship sync. The DB is correct in
          // that case, but the client still needs the removal notification.
          capsuleRemovalState = {
            ...currentShip,
            locationID: 0,
            flagID: 0,
          };
        } else {
          log.warn(
            `[CharState] Failed to remove boarded capsule ship=${currentShip.itemID} char=${charId}: ${deletedCapsule.errorMsg}`,
          );
          refreshQueue.push(currentShip);
        }
      } else {
        refreshQueue.push(currentShip);
      }
    }
    refreshQueue.push(refreshedTargetShip);

    if (capsuleRemovalState) {
      syncInventoryItemForSession(
        session,
        capsuleRemovalState,
        {
          locationID: currentShip.locationID,
          flagID: currentShip.flagID,
          quantity: currentShip.quantity,
          singleton: currentShip.singleton,
          stacksize: currentShip.stacksize,
        },
        {
          emitCfgLocation: true,
        },
      );
    }

    for (const shipItem of refreshQueue) {
      if (!shipItem || seenItemIds.has(shipItem.itemID)) {
        continue;
      }

      seenItemIds.add(shipItem.itemID);
      syncInventoryItemForSession(
        session,
        shipItem,
        {
          locationID: shipItem.locationID,
          flagID: shipItem.flagID,
          quantity: shipItem.quantity,
          singleton: shipItem.singleton,
          stacksize: shipItem.stacksize,
        },
        {
          emitCfgLocation: true,
        },
      );
    }
  }

  return {
    ...applyResult,
    changed: !currentShip || currentShip.itemID !== targetShip.itemID,
    activeShip: targetShip,
  };
}

function spawnShipInHangarForSession(session, shipType) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const docked = Boolean(session.stationid || session.stationID);
  if (!docked) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const charId = session.characterID;
  const stationId = session.stationid || session.stationID || 60003760;
  const spawnResult = spawnShipInStationHangar(charId, stationId, shipType);
  if (!spawnResult.success) {
    return spawnResult;
  }

  syncInventoryItemForSession(
    session,
    spawnResult.data,
    {
      locationID: 0,
      flagID: 0,
    },
    {
      emitCfgLocation: true,
    },
  );

  return {
    success: true,
    created: spawnResult.created,
    ship: spawnResult.data,
  };
}

function setActiveShipForSession(session, shipType) {
  return spawnShipInHangarForSession(session, shipType);
}

function getFittedItemsForActiveShip(charId, shipId) {
  const numericCharId = Number(charId || 0);
  const numericShipId = Number(shipId || 0);
  if (numericCharId <= 0 || numericShipId <= 0) {
    return [];
  }

  const allItems = getAllItems();
  const itemList = Array.isArray(allItems)
    ? allItems
    : Object.values(allItems || {});

  return itemList
    .filter(
      (item) =>
        item &&
        Number(item.ownerID || 0) === numericCharId &&
        Number(item.locationID || 0) === numericShipId &&
        FITTED_SLOT_FLAG_SET.has(Number(item.flagID || 0)),
    )
    .sort((left, right) => {
      if (Number(left.flagID || 0) !== Number(right.flagID || 0)) {
        return Number(left.flagID || 0) - Number(right.flagID || 0);
      }

      return Number(left.itemID || 0) - Number(right.itemID || 0);
    });
}

function syncActiveShipFittingForSession(session, options = {}) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
      syncedCount: 0,
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || Number(activeShip.itemID || 0) <= 0) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
      syncedCount: 0,
    };
  }

  const emitCfgLocation = options.emitCfgLocation === true;
  const forceRefresh = options.forceRefresh === true;
  const buildPreviousState = (item) =>
    forceRefresh
      ? {
          locationID: 0,
          flagID: 0,
          quantity: 0,
          singleton: 0,
          stacksize: 0,
        }
      : {
          locationID: item.locationID,
          flagID: item.flagID,
          quantity: item.quantity,
          singleton: item.singleton,
          stacksize: item.stacksize,
        };
  syncInventoryItemForSession(
    session,
    activeShip,
    buildPreviousState(activeShip),
    {
      emitCfgLocation,
    },
  );

  const fittedItems = getFittedItemsForActiveShip(
    session.characterID,
    activeShip.itemID,
  );
  for (const item of fittedItems) {
    syncInventoryItemForSession(session, item, buildPreviousState(item), {
      emitCfgLocation,
    });
  }

  return {
    success: true,
    syncedCount: fittedItems.length + 1,
  };
}

module.exports = {
  CHARACTERS_TABLE,
  DEFAULT_PLEX_BALANCE,
  DEFAULT_MCT_EXPIRY_FILETIME,
  getCharacterRecord,
  updateCharacterRecord,
  resolveHomeStationInfo,
  getCharacterShips,
  findCharacterShip,
  getActiveShipRecord,
  applyCharacterToSession,
  activateShipForSession,
  spawnShipInHangarForSession,
  setActiveShipForSession,
  buildInventoryItemRow,
  buildItemChangePayload,
  syncInventoryItemForSession,
  syncActiveShipFittingForSession,
  shouldFlushDeferredDockedShipSessionChange,
  flushDeferredDockedShipSessionChange,
  toBigInt,
  deriveEmpireID,
  deriveFactionID,
};
