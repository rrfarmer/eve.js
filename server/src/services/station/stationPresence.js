const path = require("path");

const database = require(path.join(__dirname, "../../database"));
const log = require(path.join(__dirname, "../../utils/logger"));
const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));

const CHARACTERS_TABLE = "characters";
const WINDOWS_EPOCH_FILETIME = 116444736000000000n;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getCurrentFileTimeString() {
  return (BigInt(Date.now()) * 10000n + WINDOWS_EPOCH_FILETIME).toString();
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function snapshotSessionPresence(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  const characterID = toNumber(session.characterID ?? session.charid, 0);
  const stationID = toNumber(
    session.stationid ?? session.stationID ?? session.locationid,
    0,
  );
  if (characterID <= 0 || stationID <= 0) {
    return null;
  }

  return {
    characterID,
    corporationID: toNumber(session.corporationID ?? session.corpid, 0),
    allianceID: toNumber(session.allianceID ?? session.allianceid, 0),
    warFactionID: toNumber(session.warFactionID ?? session.warfactionid, 0),
    stationID,
  };
}

function buildGuestTuple(presence) {
  return [
    toNumber(presence.characterID, 0),
    toNumber(presence.corporationID, 0),
    toNumber(presence.allianceID, 0),
    toNumber(presence.warFactionID, 0),
  ];
}

function listOnlineGuestsInStation(stationID) {
  const normalizedStationID = toNumber(stationID, 0);
  if (normalizedStationID <= 0) {
    return [];
  }

  const liveGuests = [];
  const seenCharacterIds = new Set();

  for (const session of sessionRegistry.getSessions()) {
    const presence = snapshotSessionPresence(session);
    if (!presence || presence.stationID !== normalizedStationID) {
      continue;
    }

    if (seenCharacterIds.has(presence.characterID)) {
      continue;
    }

    seenCharacterIds.add(presence.characterID);
    liveGuests.push(buildGuestTuple(presence));
  }

  if (liveGuests.length > 0) {
    return liveGuests;
  }

  const characters = readCharacters();
  const guests = [];

  for (const [characterID, record] of Object.entries(characters)) {
    if (!record || !record.online) {
      continue;
    }

    if (toNumber(record.stationID, 0) !== normalizedStationID) {
      continue;
    }

    guests.push([
      toNumber(characterID, 0),
      toNumber(record.corporationID, 0),
      toNumber(record.allianceID, 0),
      toNumber(record.warFactionID ?? record.factionID, 0),
    ]);
  }

  return guests;
}

function setCharacterOnlineState(charId, online, options = {}) {
  const numericCharId = toNumber(charId, 0);
  if (numericCharId <= 0) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const characters = readCharacters();
  const record = characters[String(numericCharId)];
  if (!record || typeof record !== "object") {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const nextRecord = {
    ...record,
    online: Boolean(online),
  };

  const stationID = toNumber(options.stationID, 0);
  if (stationID > 0) {
    nextRecord.stationID = stationID;
  }

  if (!online) {
    nextRecord.logoffDate = getCurrentFileTimeString();
  }

  if (JSON.stringify(record) === JSON.stringify(nextRecord)) {
    return {
      success: true,
      changed: false,
      data: nextRecord,
    };
  }

  const writeResult = database.write(
    CHARACTERS_TABLE,
    `/${String(numericCharId)}`,
    nextRecord,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
    };
  }

  return {
    success: true,
    changed: true,
    data: nextRecord,
  };
}

function broadcastStationGuestEvent(
  notificationName,
  presence,
  { excludeSession = null } = {},
) {
  if (!notificationName || !presence || typeof presence !== "object") {
    return 0;
  }

  const stationID = toNumber(presence.stationID, 0);
  if (stationID <= 0) {
    return 0;
  }

  const payloadTuple = [buildGuestTuple(presence)];
  let sentCount = 0;

  for (const session of sessionRegistry.getSessions()) {
    if (!session || session === excludeSession) {
      continue;
    }

    const sessionStationID = toNumber(
      session.stationid ?? session.stationID ?? session.locationid,
      0,
    );
    const sessionCharacterID = toNumber(session.characterID ?? session.charid, 0);

    if (sessionStationID !== stationID || sessionCharacterID <= 0) {
      continue;
    }

    session.sendNotification(notificationName, "stationid", payloadTuple);
    sentCount += 1;
  }

  log.debug(
    `[StationPresence] Broadcast ${notificationName} station=${stationID} char=${presence.characterID} sent=${sentCount}`,
  );
  return sentCount;
}

module.exports = {
  snapshotSessionPresence,
  listOnlineGuestsInStation,
  setCharacterOnlineState,
  broadcastStationGuestEvent,
};
