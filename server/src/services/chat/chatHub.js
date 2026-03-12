const { toBigInt } = require("../character/characterState");
const { sendSessionSystemMessage } = require("./xmppStubServer");
const sessionRegistry = require("./sessionRegistry");

const joinedChannels = new Map();

const CHANNEL_MODE_CONVERSATIONALIST = 3;
const CHANNEL_HEADERS = [
  "channelID",
  "ownerID",
  "displayName",
  "motd",
  "comparisonKey",
  "memberless",
  "password",
  "mailingList",
  "cspa",
  "temporary",
  "languageRestriction",
  "groupMessageID",
  "channelMessageID",
  "mode",
  "subscribed",
  "estimatedMemberCount",
];
const CHANNEL_MOD_HEADERS = [
  "accessor",
  "mode",
  "untilWhen",
  "originalMode",
  "admin",
  "reason",
];
const CHANNEL_CHAR_HEADERS = [
  "charID",
  "corpID",
  "mode",
  "allianceID",
  "warFactionID",
  "role",
  "extra",
];
const EXTRA_CHAR_HEADERS = ["ownerID", "ownerName", "typeID"];

function getSessionCharacterId(session) {
  if (session && session.chatDisabled) {
    return 0;
  }
  const numericCharacterId = Number(
    session ? session.characterID || session.charid || 0 : 0,
  );
  return Number.isInteger(numericCharacterId) && numericCharacterId > 0
    ? numericCharacterId
    : 0;
}

function hasSelectedCharacter(session) {
  return getSessionCharacterId(session) > 0;
}

function buildList(items) {
  return { type: "list", items };
}

function buildRowset(header, lines) {
  return {
    type: "object",
    name: "util.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", buildList(header)],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", buildList(lines)],
      ],
    },
  };
}

function buildRow(header, line) {
  return {
    type: "object",
    name: "util.Row",
    args: {
      type: "dict",
      entries: [
        ["header", buildList(header)],
        ["line", buildList(line)],
      ],
    },
  };
}

function getLocalChannelForSession(session) {
  const channelID =
    (session &&
      (session.solarsystemid2 || session.solarsystemid || session.stationid || session.stationID)) ||
    30000142;
  const channelName = getLocalChannelName(channelID);

  return {
    key: `solarsystemid2:${channelID}`,
    id: channelID,
    type: "solarsystemid2",
    ownerID: 1,
    displayName: "Local",
    motd:
      "<br>eve.js Local Chat<br>Commands: /help, /wallet, /where, /who, /ship <name>, /tr <character|me> <locationID>",
    comparisonKey: channelName,
    memberless: false,
    password: null,
    mailingList: false,
    cspa: 0,
    temporary: false,
    languageRestriction: false,
    groupMessageID: 0,
    channelMessageID: 0,
    mode: CHANNEL_MODE_CONVERSATIONALIST,
    subscribed: true,
  };
}

function getLocalChannelName(channelID) {
  return `local_${Number(channelID || 30000142)}`;
}

function getActiveSessionsForChannel(channel) {
  if (!channel) {
    return [];
  }

  return sessionRegistry.getSessions().filter((session) => {
    return (
      hasSelectedCharacter(session) &&
      getLocalChannelForSession(session).key === channel.key
    );
  });
}

function syncChannelMembership(channel) {
  if (!channel) {
    return new Set();
  }

  const activeSessions = getActiveSessionsForChannel(channel);
  const members = joinedChannels.get(channel.key) || new Set();

  for (const session of activeSessions) {
    members.add(session);
  }

  for (const member of Array.from(members)) {
    if (
      !member ||
      !member.socket ||
      member.socket.destroyed ||
      !hasSelectedCharacter(member) ||
      getLocalChannelForSession(member).key !== channel.key
    ) {
      members.delete(member);
    }
  }

  if (members.size > 0) {
    joinedChannels.set(channel.key, members);
  } else {
    joinedChannels.delete(channel.key);
  }

  return members;
}

function getChannelMembers(channel) {
  const members = syncChannelMembership(channel);
  if (!members) {
    return [];
  }

  return Array.from(members).filter(
    (session) =>
      session &&
      session.socket &&
      !session.socket.destroyed &&
      hasSelectedCharacter(session),
  );
}

function getEstimatedMemberCount(channel) {
  return getChannelMembers(channel).length;
}

function buildChannelInfoLine(channel) {
  return buildList([
    channel.id,
    channel.ownerID,
    channel.displayName,
    channel.motd,
    channel.comparisonKey,
    channel.memberless,
    channel.password,
    channel.mailingList,
    channel.cspa,
    channel.temporary,
    channel.languageRestriction,
    channel.groupMessageID,
    channel.channelMessageID,
    channel.mode,
    channel.subscribed,
    getEstimatedMemberCount(channel),
  ]);
}

function buildChannelInfo(channel) {
  return buildRow(CHANNEL_HEADERS, [
    channel.id,
    channel.ownerID,
    channel.displayName,
    channel.motd,
    channel.comparisonKey,
    channel.memberless,
    channel.password,
    channel.mailingList,
    channel.cspa,
    channel.temporary,
    channel.languageRestriction,
    channel.groupMessageID,
    channel.channelMessageID,
    channel.mode,
    channel.subscribed,
    getEstimatedMemberCount(channel),
  ]);
}

function buildChannelMods() {
  return buildRowset(CHANNEL_MOD_HEADERS, []);
}

function buildCharacterExtra(session) {
  const characterId = getSessionCharacterId(session);
  return buildRow(EXTRA_CHAR_HEADERS, [
    characterId,
    session.characterName || session.userName || "Unknown",
    session.characterTypeID || 1373,
  ]);
}

function buildChannelChars(channel) {
  const lines = getChannelMembers(channel).map((session) => {
    const characterId = getSessionCharacterId(session);
    return buildList([
      characterId,
      session.corporationID || 0,
      CHANNEL_MODE_CONVERSATIONALIST,
      session.allianceID || 0,
      session.warFactionID || 0,
      { type: "long", value: toBigInt(session.role || 0) },
      buildCharacterExtra(session),
    ]);
  });

  return buildRowset(CHANNEL_CHAR_HEADERS, lines);
}

function buildChannelDescriptor(channel) {
  return [[channel.type, channel.id]];
}

function buildSenderInfo(session) {
  const characterId = getSessionCharacterId(session);
  return [
    session.allianceID || 0,
    session.corporationID || 0,
    [
      characterId,
      session.characterName || session.userName || "Unknown",
      session.characterTypeID || 1373,
    ],
    { type: "long", value: toBigInt(session.role || 0) },
    { type: "long", value: 0n },
    0,
  ];
}

function buildSystemSenderInfo() {
  return [
    0,
    1,
    [1, "EVE System", 1],
    { type: "long", value: 1n },
    { type: "long", value: 0n },
    0,
  ];
}

function sendOnLsc(session, channel, method, sender, argumentsTuple = []) {
  if (!session || !session.socket || session.socket.destroyed) {
    return;
  }

  session.sendNotification("OnLSC", channel.type, [
    buildChannelDescriptor(channel),
    getEstimatedMemberCount(channel),
    method,
    sender,
    argumentsTuple,
  ]);
}

function getChannelsForSession(session) {
  if (!hasSelectedCharacter(session)) {
    return buildRowset(CHANNEL_HEADERS, []);
  }

  const channel = getLocalChannelForSession(session);
  return buildRowset(CHANNEL_HEADERS, [buildChannelInfoLine(channel)]);
}

function joinLocalChannel(session) {
  if (!hasSelectedCharacter(session)) {
    const channel = getLocalChannelForSession(session);
    return {
      channel,
      result: [
        buildChannelDescriptor(channel),
        0,
        [buildChannelInfo(channel), buildChannelMods(), buildChannelChars(channel)],
      ],
    };
  }

  const channel = getLocalChannelForSession(session);

  if (!joinedChannels.has(channel.key)) {
    joinedChannels.set(channel.key, new Set());
  }

  const members = joinedChannels.get(channel.key);
  const alreadyJoined = members.has(session);
  members.add(session);

  if (!alreadyJoined) {
    const sender = buildSenderInfo(session);
    for (const member of getChannelMembers(channel)) {
      sendOnLsc(member, channel, "JoinChannel", sender, []);
    }
  }

  return {
    channel,
    result: [
      buildChannelDescriptor(channel),
      1,
      [buildChannelInfo(channel), buildChannelMods(), buildChannelChars(channel)],
    ],
  };
}

function leaveLocalChannel(session) {
  const channel = getLocalChannelForSession(session);
  const members = joinedChannels.get(channel.key);
  if (!members || !members.has(session)) {
    return null;
  }

  members.delete(session);
  const sender = buildSenderInfo(session);
  for (const member of getChannelMembers(channel)) {
    sendOnLsc(member, channel, "LeaveChannel", sender, []);
  }

  if (members.size === 0) {
    joinedChannels.delete(channel.key);
  }

  return channel;
}

function unregisterSession(session, options = {}) {
  const notifySelf = Boolean(options && options.notifySelf);

  for (const [key, members] of joinedChannels.entries()) {
    if (!members.has(session)) {
      continue;
    }

    const [type, rawId] = key.split(":");
    const channel = {
      ...getLocalChannelForSession(session),
      key,
      type,
      id: Number(rawId),
    };
    const sender = buildSenderInfo(session);

    // For in-session logoff flows (no TCP disconnect), notify the same client
    // so chat UI can tear down channel windows on character-selection return.
    if (notifySelf) {
      sendOnLsc(session, channel, "LeaveChannel", sender, []);
    }

    members.delete(session);
    for (const member of getChannelMembers(channel)) {
      sendOnLsc(member, channel, "LeaveChannel", sender, []);
    }

    if (members.size === 0) {
      joinedChannels.delete(key);
    }
  }
}

function broadcastLocalMessage(session, message) {
  if (!hasSelectedCharacter(session)) {
    return;
  }

  const channel = getLocalChannelForSession(session);
  const sender = buildSenderInfo(session);
  for (const member of getChannelMembers(channel)) {
    sendOnLsc(member, channel, "SendMessage", sender, [message]);
  }
}

function sendSystemMessage(session, message, specificChannel = null) {
  const channel = specificChannel || getLocalChannelForSession(session);
  sendOnLsc(session, channel, "SendMessage", buildSystemSenderInfo(), [message]);
  sendSessionSystemMessage(
    session,
    message,
    `${channel.comparisonKey || getLocalChannelName(channel.id)}@conference.localhost`,
  );
}

module.exports = {
  getChannelsForSession,
  joinLocalChannel,
  leaveLocalChannel,
  unregisterSession,
  broadcastLocalMessage,
  sendSystemMessage,
  getLocalChannelForSession,
  getLocalChannelName,
  hasSelectedCharacter,
};
