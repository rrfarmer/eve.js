const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const chatHub = require(path.join(__dirname, "../chat/chatHub"));
const { removeCharacterFromChatRooms } = require(path.join(
  __dirname,
  "../chat/xmppStubServer",
));
const {
  snapshotSessionPresence,
  setCharacterOnlineState,
  broadcastStationGuestEvent,
} = require(path.join(__dirname, "../station/stationPresence"));

function appendChange(changes, key, oldValue, newValue) {
  const normalizedOld = oldValue === undefined ? null : oldValue;
  const normalizedNew = newValue === undefined ? null : newValue;
  if (normalizedOld === normalizedNew) {
    return;
  }

  changes[key] = [normalizedOld, normalizedNew];
}

function performCharacterLogoff(session, source = "userSvc") {
  const charId = session ? Number(session.characterID || 0) : 0;
  const selectedCharacterId = session
    ? Number(session.selectedCharacterID || 0)
    : 0;
  log.info(`[${source}] Character logoff called (charID=${charId || 0})`);

  if (!session) {
    return null;
  }
  session.chatDisabled = true;

  const presence = snapshotSessionPresence(session);
  const offlineCandidates = [
    presence ? Number(presence.characterID || 0) : 0,
    charId,
    selectedCharacterId,
  ]
    .filter((candidate) => Number.isInteger(candidate) && candidate > 0)
    .filter((candidate, index, values) => values.indexOf(candidate) === index);
  for (const offlineCharId of offlineCandidates) {
    const offlineResult = setCharacterOnlineState(offlineCharId, false);
    if (!offlineResult.success) {
      log.warn(
        `[${source}] Failed to mark character ${offlineCharId} offline: ${offlineResult.errorMsg}`,
      );
      continue;
    }
    log.debug(
      `[${source}] Marked character ${offlineCharId} offline (changed=${offlineResult.changed !== false})`,
    );
  }

  if (presence) {
    broadcastStationGuestEvent("OnCharNoLongerInStation", presence, {
      excludeSession: session,
    });
  }

  chatHub.unregisterSession(session);
  const removedXmppClients = removeCharacterFromChatRooms(
    (presence && presence.characterID) || charId || selectedCharacterId || 0,
    {
      notifySelf: false,
      disconnectClient: true,
    },
  );
  if (removedXmppClients > 0) {
    log.debug(
      `[${source}] Removed ${removedXmppClients} XMPP room client(s) for logged-off character`,
    );
  }

  const changes = {};
  appendChange(changes, "charid", session.characterID ?? session.charid ?? null, null);
  appendChange(changes, "corpid", session.corporationID ?? session.corpid ?? null, null);
  appendChange(
    changes,
    "allianceid",
    session.allianceID ?? session.allianceid ?? null,
    null,
  );
  appendChange(changes, "genderID", session.genderID ?? session.genderid ?? null, null);
  appendChange(
    changes,
    "bloodlineID",
    session.bloodlineID ?? session.bloodlineid ?? null,
    null,
  );
  appendChange(changes, "raceID", session.raceID ?? session.raceid ?? null, null);
  appendChange(changes, "schoolID", session.schoolID ?? session.schoolid ?? null, null);
  appendChange(changes, "stationid", session.stationid ?? session.stationID ?? null, null);
  appendChange(
    changes,
    "solarsystemid2",
    session.solarsystemid2 ?? session.solarsystemid ?? null,
    null,
  );
  appendChange(
    changes,
    "constellationid",
    session.constellationID ?? session.constellationid ?? null,
    null,
  );
  appendChange(changes, "regionid", session.regionID ?? session.regionid ?? null, null);
  appendChange(changes, "shipid", session.shipID ?? session.shipid ?? null, null);
  appendChange(changes, "corprole", session.corprole ?? null, 0n);
  appendChange(changes, "rolesAtAll", session.rolesAtAll ?? null, 0n);
  appendChange(changes, "rolesAtBase", session.rolesAtBase ?? null, 0n);
  appendChange(changes, "rolesAtHQ", session.rolesAtHQ ?? null, 0n);
  appendChange(changes, "rolesAtOther", session.rolesAtOther ?? null, 0n);

  session.selectedCharacterID = 0;
  session.lastCreatedCharacterID = 0;
  session.characterID = 0;
  session.charid = 0;
  session.characterName = "";
  session.characterTypeID = 1373;
  session.genderID = 1;
  session.genderid = 1;
  session.bloodlineID = 1;
  session.bloodlineid = 1;
  session.raceID = 1;
  session.raceid = 1;
  session.schoolID = null;
  session.schoolid = null;
  session.corporationID = 0;
  session.corpid = 0;
  session.allianceID = null;
  session.allianceid = null;
  session.stationid = null;
  session.stationID = null;
  session.stationid2 = null;
  session.worldspaceid = null;
  session.locationid = null;
  session.solarsystemid2 = null;
  session.solarsystemid = null;
  session.constellationID = null;
  session.constellationid = null;
  session.regionID = null;
  session.regionid = null;
  session.activeShipID = null;
  session.shipID = null;
  session.shipid = null;
  session.shipTypeID = null;
  session.shipName = "";
  session.skillPoints = 0;
  session.hqID = null;
  session.baseID = null;
  session.warFactionID = null;
  session.warfactionid = null;
  session.corprole = 0n;
  session.rolesAtAll = 0n;
  session.rolesAtBase = 0n;
  session.rolesAtHQ = 0n;
  session.rolesAtOther = 0n;

  if (Object.keys(changes).length > 0 && typeof session.sendSessionChange === "function") {
    session.sendSessionChange(changes);
  }

  return null;
}

module.exports = {
  performCharacterLogoff,
};
