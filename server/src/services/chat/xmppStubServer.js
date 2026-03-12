const fs = require("fs");
const path = require("path");
const tls = require("tls");

const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const sessionRegistry = require(path.join(__dirname, "./sessionRegistry"));
const { getCharacterRecord, toBigInt } = require(path.join(
  __dirname,
  "../character/characterState",
));
const { executeChatCommand, DEFAULT_MOTD_MESSAGE } = require(path.join(
  __dirname,
  "./chatCommands",
));

let server = null;
let messageSequence = 0;

const connectedClients = new Set();
const roomMembers = new Map();
const transcriptDir = path.join(__dirname, "../../../logs");
const transcriptPath = path.join(transcriptDir, "xmpp-stub.log");
const certDir = path.join(__dirname, "../../../certs");
const certPath = path.join(certDir, "xmpp-dev-cert.pem");
const keyPath = path.join(certDir, "xmpp-dev-key.pem");

function ensureTranscriptDir() {
  if (!fs.existsSync(transcriptDir)) {
    fs.mkdirSync(transcriptDir, { recursive: true });
  }
}

function readTlsCredentials() {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    throw new Error(
      `Missing XMPP TLS certificate files at ${certDir}`,
    );
  }

  return {
    cert: fs.readFileSync(certPath, "utf8"),
    key: fs.readFileSync(keyPath, "utf8"),
  };
}

function writeTranscript(direction, xml) {
  try {
    ensureTranscriptDir();
    fs.appendFileSync(
      transcriptPath,
      `[${new Date().toISOString()}] ${direction} ${xml}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[XMPP] Failed to write transcript: ${error.message}`);
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractId(xml) {
  const match = /id=['"]([^'"]+)['"]/i.exec(xml);
  return match ? match[1] : "evejs";
}

function extractAttr(xml, name) {
  const pattern = new RegExp(`${name}=['"]([^'"]+)['"]`, "i");
  const match = pattern.exec(xml);
  return match ? decodeXml(match[1]) : "";
}

function extractBody(xml) {
  const match = /<body>([\s\S]*?)<\/body>/i.exec(xml);
  return match ? decodeXml(match[1]).trim() : "";
}

function parsePlainAuth(xml) {
  const match = /<auth[^>]*>([\s\S]*?)<\/auth>/i.exec(xml);
  if (!match) {
    return { userName: "capsuleer", password: "" };
  }

  try {
    const decoded = Buffer.from(match[1].trim(), "base64").toString("utf8");
    const parts = decoded.split("\u0000");
    return {
      userName: parts[1] || parts[0] || "capsuleer",
      password: parts[2] || "",
    };
  } catch (error) {
    log.warn(`[XMPP] Failed to decode SASL auth payload: ${error.message}`);
    return { userName: "capsuleer", password: "" };
  }
}

function buildBoundJid(client) {
  return `${client.userName || "capsuleer"}@localhost/evejs`;
}

function getRoomDomain(roomJid) {
  const bareJid = String(roomJid || "").trim().split("/")[0];
  const atIndex = bareJid.indexOf("@");
  if (atIndex < 0) {
    return "";
  }

  return bareJid.slice(atIndex + 1).trim().toLowerCase();
}

function nextMessageId() {
  messageSequence += 1;
  return `evejs-${Date.now()}-${messageSequence}`;
}

function sendXml(client, xml) {
  if (!client.socket || client.socket.destroyed) {
    return;
  }

  client.socket.write(xml);
  writeTranscript("OUT", xml);
}

function getRoomJid(target) {
  if (!target) {
    return "";
  }

  return target.split("/")[0];
}

function getRoomNick(target, fallback) {
  if (!target || !target.includes("/")) {
    return fallback;
  }

  return target.split("/").slice(1).join("/") || fallback;
}

function getLocalRoomNameForSession(session) {
  const channelID =
    (session &&
      (session.solarsystemid2 || session.solarsystemid || session.stationid || session.stationID)) ||
    30000142;
  return `local_${Number(channelID)}`;
}

function getCorpRoomNameForSession(session) {
  const corpID = Number(
    (session && (session.corporationID || session.corpid)) || 1000044,
  );
  return `corp_${corpID}`;
}

function getLocalRoomNameForClient(client) {
  const session = findSessionForClient(client);
  return getLocalRoomNameForSession(session);
}

function getClientRoomDomain(client) {
  const explicitDomain = String(client && client.roomDomain ? client.roomDomain : "")
    .trim()
    .toLowerCase();
  if (explicitDomain) {
    return explicitDomain;
  }

  return "conference.localhost";
}

function buildConferenceRoomJid(roomName, domain = "conference.localhost") {
  return `${roomName}@${domain || "conference.localhost"}`;
}

function normalizeRoomJid(roomJid, client = null) {
  const rawRoomJid = String(roomJid || "").trim();
  const requestedDomain = getRoomDomain(rawRoomJid);
  const roomDomain = requestedDomain || getClientRoomDomain(client);
  if (client && requestedDomain) {
    client.roomDomain = requestedDomain;
  }
  if (!rawRoomJid) {
    const fallbackRoomName = client
      ? getLocalRoomNameForClient(client)
      : getLocalRoomNameForSession(null);
    return buildConferenceRoomJid(fallbackRoomName, roomDomain);
  }

  const bareJid = rawRoomJid.split("/")[0];
  const roomNamePart = String(bareJid.split("@")[0] || "")
    .trim()
    .toLowerCase();
  if (!roomNamePart) {
    return buildConferenceRoomJid(
      client ? getLocalRoomNameForClient(client) : getLocalRoomNameForSession(null),
      roomDomain,
    );
  }

  if (roomNamePart === "local") {
    return buildConferenceRoomJid(
      client ? getLocalRoomNameForClient(client) : getLocalRoomNameForSession(null),
      roomDomain,
    );
  }

  if (roomNamePart === "corp") {
    const session = client ? findSessionForClient(client) : null;
    return buildConferenceRoomJid(getCorpRoomNameForSession(session), roomDomain);
  }

  const localRoomMatch = /^local_(\d+)$/i.exec(roomNamePart);
  if (localRoomMatch) {
    return buildConferenceRoomJid(`local_${localRoomMatch[1]}`, roomDomain);
  }

  const corpRoomMatch = /^corp_(\d+)$/i.exec(roomNamePart);
  if (corpRoomMatch) {
    return buildConferenceRoomJid(`corp_${corpRoomMatch[1]}`, roomDomain);
  }

  const legacyLocalMatch = /^solarsystemid2?_(\d+)$/i.exec(roomNamePart);
  if (legacyLocalMatch) {
    return buildConferenceRoomJid(`local_${legacyLocalMatch[1]}`, roomDomain);
  }

  const legacyCorpMatch = /^corpid_(\d+)$/i.exec(roomNamePart);
  if (legacyCorpMatch) {
    return buildConferenceRoomJid(`corp_${legacyCorpMatch[1]}`, roomDomain);
  }

  // Keep room names stable across mixed hostnames/domains.
  return buildConferenceRoomJid(roomNamePart, roomDomain);
}

function findSessionForClient(client) {
  const expectedUser = String(client.userName || "").trim().toLowerCase();
  const expectedCharId = Number.parseInt(expectedUser, 10);
  if (!expectedUser) {
    return null;
  }

  return (
    sessionRegistry.getSessions().find((session) => {
      return (
        String(session.userName || "").trim().toLowerCase() === expectedUser ||
        String(session.userid || "").trim().toLowerCase() === expectedUser ||
        (Number.isInteger(expectedCharId) &&
          expectedCharId > 0 &&
          Number(session.characterID || 0) === expectedCharId)
      );
    }) || null
  );
}

function parseCharacterId(value) {
  const numeric = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function getClientCharacterId(client, session = null) {
  const matchedSession = session || findSessionForClient(client);
  if (
    matchedSession &&
    Number.isInteger(Number(matchedSession.characterID || 0)) &&
    Number(matchedSession.characterID || 0) > 0
  ) {
    return Number(matchedSession.characterID);
  }

  return parseCharacterId(client.userName);
}

function getSessionCharacterId(session) {
  if (session && session.chatDisabled) {
    return 0;
  }
  const numericCharacterId = Number(session ? session.characterID || 0 : 0);
  return Number.isInteger(numericCharacterId) && numericCharacterId > 0
    ? numericCharacterId
    : 0;
}

function buildOwnerInfo(charData, charId) {
  return JSON.stringify({
    ownerID: charId,
    ownerName: charData.characterName || String(charId),
    name: charData.characterName || String(charId),
    typeID: charData.typeID || 1373,
  });
}

function getUserDataForCharacterId(charId) {
  if (!charId) {
    return null;
  }

  const charData = getCharacterRecord(charId);
  if (!charData) {
    return null;
  }

  const session =
    sessionRegistry.getSessions().find(
      (candidate) => Number(candidate.characterID || 0) === Number(charId),
    ) || null;

  return {
    charId,
    userJid: `${charId}@localhost`,
    characterName: charData.characterName || String(charId),
    corporationID: Number(charData.corporationID || 1000044),
    allianceID: Number(charData.allianceID || 0),
    // warFactionID means militia enlistment, not the character's empire faction.
    warFactionID: Number(charData.warFactionID || 0),
    typeID: Number(charData.typeID || 1373),
    role: toBigInt(session ? session.role || 0 : 0),
    info: buildOwnerInfo(charData, charId),
  };
}

function getUserDataForJid(jid) {
  const user = String(jid || "").split("@")[0];
  const charId = parseCharacterId(user);
  return getUserDataForCharacterId(charId);
}

function buildEveUserDataElement(userData) {
  if (!userData) {
    return "<eve_user_data corpid='1000044' allianceid='0' warfactionid='0' typeid='1373' role='0'/>";
  }

  return [
    "<eve_user_data",
    ` corpid='${escapeXml(userData.corporationID)}'`,
    ` allianceid='${escapeXml(userData.allianceID)}'`,
    ` warfactionid='${escapeXml(userData.warFactionID)}'`,
    ` typeid='${escapeXml(userData.typeID)}'`,
    ` role='${escapeXml(userData.role)}'`,
    ` info='${escapeXml(userData.info)}'`,
    "/>",
  ].join("");
}

function addRoomMember(roomJid, client) {
  if (!roomJid) {
    return;
  }

  if (!roomMembers.has(roomJid)) {
    roomMembers.set(roomJid, new Set());
  }

  roomMembers.get(roomJid).add(client);
  client.rooms.add(roomJid);
}

function getRoomActiveMembers(roomJid) {
  if (!roomJid || !roomMembers.has(roomJid)) {
    return [];
  }

  const members = roomMembers.get(roomJid);
  const active = [];
  for (const member of members) {
    if (member && member.socket && !member.socket.destroyed) {
      active.push(member);
      continue;
    }

    members.delete(member);
  }

  if (members.size === 0) {
    roomMembers.delete(roomJid);
  }

  return active;
}

function getClientNick(client, fallback = "capsuleer") {
  const candidate = String(client && client.nick ? client.nick : "").trim();
  if (candidate) {
    return candidate;
  }

  return String(fallback || "capsuleer").trim() || "capsuleer";
}

function buildRoomPresenceXml(
  roomJid,
  sourceClient,
  recipientClient,
  options = {},
) {
  const nick = getClientNick(
    sourceClient,
    sourceClient && (sourceClient.userName || "capsuleer"),
  );
  const fromJid = `${roomJid}/${nick}`;
  const toJid = recipientClient && recipientClient.boundJid
    ? recipientClient.boundJid
    : fromJid;
  const idAttribute = options.id ? ` id='${escapeXml(options.id)}'` : "";

  if (options.unavailable) {
    return `<presence from='${escapeXml(fromJid)}' to='${escapeXml(toJid)}' type='unavailable'${idAttribute}/>`;
  }

  const session = findSessionForClient(sourceClient);
  const charId = getClientCharacterId(sourceClient, session);
  const userData = getUserDataForCharacterId(charId);
  const selfStatus = options.selfPresence ? "<status code='110'/>" : "";

  return [
    `<presence from='${escapeXml(fromJid)}' to='${escapeXml(toJid)}'${idAttribute}>`,
    buildEveUserDataElement(userData),
    "<x xmlns='http://jabber.org/protocol/muc#user'>",
    `<item affiliation='member' role='participant' jid='${escapeXml(sourceClient.boundJid)}'/>`,
    selfStatus,
    "</x>",
    "</presence>",
  ].join("");
}

function removeRoomMember(roomJid, client) {
  if (!roomJid || !roomMembers.has(roomJid)) {
    return;
  }

  const members = roomMembers.get(roomJid);
  members.delete(client);
  if (members.size === 0) {
    roomMembers.delete(roomJid);
  }
}

function removeClientFromRooms(client, options = {}) {
  const notifySelf = options.notifySelf !== false;

  for (const roomJid of client.rooms) {
    const remainingMembers = getRoomActiveMembers(roomJid).filter(
      (member) => member !== client,
    );
    for (const member of remainingMembers) {
      sendXml(
        member,
        buildRoomPresenceXml(roomJid, client, member, {
          unavailable: true,
        }),
      );
    }

    if (notifySelf) {
      sendXml(
        client,
        buildRoomPresenceXml(roomJid, client, client, {
          unavailable: true,
        }),
      );
    }

    removeRoomMember(roomJid, client);
  }

  client.rooms.clear();
}

function removeCharacterFromChatRooms(characterId, options = {}) {
  const numericCharacterId = Number.parseInt(String(characterId || 0), 10);
  if (!Number.isInteger(numericCharacterId) || numericCharacterId <= 0) {
    return 0;
  }
  const notifySelf = options.notifySelf !== false;
  const disconnectClient = Boolean(options.disconnectClient);

  let removedCount = 0;
  for (const client of connectedClients) {
    const session = findSessionForClient(client);
    const sessionCharacterId = getSessionCharacterId(session);
    const nickCharacterId = parseCharacterId(client.nick);
    const inferredCharacterId = getClientCharacterId(client, session);
    const matchesCharacter =
      sessionCharacterId === numericCharacterId ||
      nickCharacterId === numericCharacterId ||
      inferredCharacterId === numericCharacterId;

    if (!matchesCharacter) {
      continue;
    }

    removeClientFromRooms(client, { notifySelf });
    client.lastRoomJid = "";
    client.localWelcomeSent = false;
    client.nick = client.userName || "capsuleer";

    if (disconnectClient && client.socket && !client.socket.destroyed) {
      try {
        client.socket.end();
      } catch (error) {
        // ignore socket close race
      }
      try {
        client.socket.destroy();
      } catch (error) {
        // ignore socket destroy race
      }
    }

    removedCount += 1;
  }

  if (removedCount > 0) {
    log.debug(
      `[XMPP] Removed character ${numericCharacterId} from ${removedCount} room session(s)`,
    );
  }

  return removedCount;
}

function buildRoomMessageXml(roomJid, sender, message, recipient) {
  return [
    `<message from='${escapeXml(roomJid)}/${escapeXml(sender)}'`,
    ` to='${escapeXml(recipient.boundJid)}'`,
    " type='groupchat'",
    ` id='${escapeXml(nextMessageId())}'>`,
    `<body>${escapeXml(message)}</body>`,
    "</message>",
  ].join("");
}

function deliverRoomMessage(roomJid, sender, message, recipients = null) {
  const members =
    recipients ||
    getRoomActiveMembers(roomJid);
  if (!members || message === "") {
    return;
  }

  for (const member of members) {
    sendXml(member, buildRoomMessageXml(roomJid, sender, message, member));
  }
}

function sendAdminCommand(client, roomJid, payload) {
  const messageText = JSON.stringify(payload);
  sendXml(client, buildRoomMessageXml(roomJid, "admin", messageText, client));
}

function sendSystemMessageToClient(client, roomJid, message) {
  const normalizedRoomJid = normalizeRoomJid(roomJid, client);
  sendAdminCommand(client, normalizedRoomJid, {
    cmd: "speak",
    charid: 1,
    messageText: String(message || ""),
  });
}

function sendSessionSystemMessage(session, message, roomJid = null) {
  if (!session || !message) {
    return;
  }

  const charId = Number(session.characterID || 0);
  if (!charId) {
    return;
  }

  for (const client of connectedClients) {
    if (getClientCharacterId(client) !== charId) {
      continue;
    }

    sendSystemMessageToClient(
      client,
      roomJid || client.lastRoomJid || normalizeRoomJid("", client),
      message,
    );
  }
}

function buildLocalWelcomeMessage() {
  return DEFAULT_MOTD_MESSAGE;
}

function handleJoinPresence(client, xml) {
  const to = extractAttr(xml, "to");
  const requestId = extractId(xml);
  if (!to) {
    // The client expects an acknowledgement presence here before it proceeds
    // into the actual room joins for Local and Corp.
    sendXml(
      client,
      `<presence from='${escapeXml(client.boundJid)}' to='${escapeXml(client.boundJid)}'/>`,
    );
    return;
  }

  const roomJid = normalizeRoomJid(getRoomJid(to), client);
  const session = findSessionForClient(client);
  const charId = getClientCharacterId(client, session);
  if (!getSessionCharacterId(session)) {
    removeClientFromRooms(client);
    sendXml(
      client,
      buildRoomPresenceXml(roomJid, client, client, {
        id: requestId,
        unavailable: true,
      }),
    );
    return;
  }

  const alreadyJoined = client.rooms.has(roomJid);
  const existingMembers = getRoomActiveMembers(roomJid).filter(
    (member) => member !== client,
  );

  client.lastRoomJid = roomJid || client.lastRoomJid || normalizeRoomJid("", client);
  client.nick =
    String(charId || "")
      .trim() ||
    getRoomNick(to, client.userName || "capsuleer");
  addRoomMember(roomJid, client);

  sendXml(
    client,
    buildRoomPresenceXml(roomJid, client, client, {
      id: requestId,
      selfPresence: true,
    }),
  );

  if (!alreadyJoined) {
    for (const member of existingMembers) {
      sendXml(client, buildRoomPresenceXml(roomJid, member, client));
    }

    for (const member of existingMembers) {
      sendXml(member, buildRoomPresenceXml(roomJid, client, member));
    }
  }

  if (!client.localWelcomeSent && roomJid === normalizeRoomJid("", client)) {
    client.localWelcomeSent = true;
    setTimeout(() => {
      sendSystemMessageToClient(client, roomJid, buildLocalWelcomeMessage());
    }, 100);
  }
}

function handleGroupMessage(client, xml) {
  const body = extractBody(xml);
  if (!body) {
    return;
  }

  const roomJid =
    normalizeRoomJid(getRoomJid(extractAttr(xml, "to")), client) ||
    client.lastRoomJid;
  if (!roomJid) {
    return;
  }

  addRoomMember(roomJid, client);

  const session = findSessionForClient(client);
  if (!getSessionCharacterId(session)) {
    return;
  }

  if (body.startsWith("/") || body.startsWith(".")) {
    const result = session
      ? executeChatCommand(session, body, null, {
          emitChatFeedback: false,
        })
      : {
          handled: true,
          message:
            "Command unavailable: no active game session matched this chat connection.",
        };

    const responseMessage =
      result.message ||
      (result.handled
        ? "Command executed."
        : `Unknown command: ${body}. Use /help.`);

    log.debug(`[XMPP] Command from ${client.userName}: ${body}`);
    sendSystemMessageToClient(client, roomJid, responseMessage);
    return;
  }

  const senderCharacterId =
    getClientCharacterId(client, session) ||
    parseCharacterId(client.nick) ||
    parseCharacterId(client.userName) ||
    1;

  log.debug(`[XMPP] Message from ${senderCharacterId}: ${body}`);
  deliverRoomMessage(roomJid, senderCharacterId, body);
}

function handleEveUserDataIq(client, xml) {
  const id = extractId(xml);
  const requestedJid = extractAttr(xml, "jid") || `${client.userName}@localhost`;
  const userData = getUserDataForJid(requestedJid);
  const resultXml = [
    `<iq type='result' id='${escapeXml(id)}'`,
    ` from='localhost'`,
    ` to='${escapeXml(client.boundJid)}'>`,
    `<query xmlns='urn:xmpp:eve_user_data' jid='${escapeXml(requestedJid)}'>`,
    buildEveUserDataElement(userData),
    "</query>",
    "</iq>",
  ].join("");

  sendXml(client, resultXml);
}

function handleReadyIq(client, xml) {
  if (xml.includes("urn:xmpp:ping")) {
    sendXml(client, `<iq type='result' id='${escapeXml(extractId(xml))}'/>`);
    return;
  }

  if (xml.includes("urn:xmpp:eve_user_data")) {
    handleEveUserDataIq(client, xml);
  }
}

function extractNextReadyStanza(buffer) {
  const patterns = [
    /<message\b[\s\S]*?<\/message>/i,
    /<presence\b[\s\S]*?(?:<\/presence>|\/>)/i,
    /<iq\b[\s\S]*?<\/iq>/i,
  ];

  let bestMatch = null;
  for (const pattern of patterns) {
    const match = pattern.exec(buffer);
    if (!match) {
      continue;
    }

    if (!bestMatch || match.index < bestMatch.index) {
      bestMatch = {
        index: match.index,
        xml: match[0],
      };
    }
  }

  return bestMatch;
}

function drainReadyBuffer(client) {
  while (true) {
    const stanza = extractNextReadyStanza(client.buffer);
    if (!stanza) {
      break;
    }

    client.buffer = client.buffer.slice(stanza.index + stanza.xml.length);

    if (/^<presence\b/i.test(stanza.xml)) {
      handleJoinPresence(client, stanza.xml);
      continue;
    }

    if (/^<message\b/i.test(stanza.xml)) {
      handleGroupMessage(client, stanza.xml);
      continue;
    }

    if (/^<iq\b/i.test(stanza.xml)) {
      handleReadyIq(client, stanza.xml);
    }
  }
}

function handleSocket(socket) {
  const client = {
    socket,
    buffer: "",
    stage: "stream1",
    userName: "capsuleer",
    password: "",
    boundJid: "capsuleer@localhost/evejs",
    nick: "capsuleer",
    lastRoomJid: "",
    localWelcomeSent: false,
    roomDomain: "",
    rooms: new Set(),
  };

  connectedClients.add(client);

  socket.on("data", (chunk) => {
    const xmlChunk = chunk.toString("utf8");
    client.buffer += xmlChunk;
    writeTranscript("IN ", xmlChunk);

    try {
      if (client.stage === "stream1" && client.buffer.includes("<stream:stream")) {
        sendXml(
          client,
          "<?xml version='1.0'?><stream:stream from='localhost' id='evejs' version='1.0' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'><stream:features><mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><mechanism>PLAIN</mechanism></mechanisms></stream:features>",
        );
        client.buffer = "";
        client.stage = "auth";
        return;
      }

      if (client.stage === "auth" && client.buffer.includes("<auth")) {
        const auth = parsePlainAuth(client.buffer);
        client.userName = auth.userName;
        client.password = auth.password;
        client.boundJid = buildBoundJid(client);

        sendXml(
          client,
          "<success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'/>",
        );
        client.buffer = "";
        client.stage = "stream2";
        return;
      }

      if (
        client.stage === "stream2" &&
        client.buffer.includes("<stream:stream")
      ) {
        sendXml(
          client,
          "<?xml version='1.0'?><stream:stream from='localhost' id='evejs2' version='1.0' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'><stream:features><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/><session xmlns='urn:ietf:params:xml:ns:xmpp-session'/></stream:features>",
        );
        client.buffer = "";
        client.stage = "bind";
        return;
      }

      if (client.stage === "bind" && client.buffer.includes("<bind")) {
        const id = extractId(client.buffer);
        client.boundJid = buildBoundJid(client);
        sendXml(
          client,
          `<iq type='result' id='${escapeXml(id)}'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><jid>${escapeXml(client.boundJid)}</jid></bind></iq>`,
        );
        client.buffer = "";
        client.stage = "session";
        return;
      }

      if (client.stage === "session" && client.buffer.includes("<session")) {
        const id = extractId(client.buffer);
        sendXml(client, `<iq type='result' id='${escapeXml(id)}'/>`);
        client.buffer = "";
        client.stage = "ready";
        return;
      }

      if (client.stage === "ready") {
        drainReadyBuffer(client);
      }
    } catch (error) {
      log.warn(`[XMPP] Stub handling error: ${error.message}`);
    }
  });

  socket.on("close", () => {
    connectedClients.delete(client);
    removeClientFromRooms(client);
  });

  socket.on("error", (error) => {
    connectedClients.delete(client);
    removeClientFromRooms(client);
    log.warn(`[XMPP] Client socket error: ${error.message}`);
  });
}

function startXmppStub() {
  if (server) {
    return server;
  }

  server = tls.createServer(
    {
      ...readTlsCredentials(),
      minVersion: "TLSv1",
      maxVersion: "TLSv1.3",
    },
    handleSocket,
  );
  server.listen(config.xmppServerPort, "0.0.0.0");
  server.on("error", (error) => {
    log.err(`[XMPP] stub server error: ${error.message}`);
  });
  server.on("secureConnection", (socket) => {
    writeTranscript(
      "TLSOK",
      `${socket.remoteAddress || "unknown"}:${socket.remotePort || 0}`,
    );
  });
  server.on("tlsClientError", (error, socket) => {
    writeTranscript(
      "TLSERR",
      `${socket.remoteAddress || "unknown"}:${socket.remotePort || 0} ${error.message}`,
    );
    log.warn(`[XMPP] TLS client error: ${error.message}`);
  });

  return server;
}

module.exports = {
  removeCharacterFromChatRooms,
  sendSessionSystemMessage,
  startXmppStub,
};
