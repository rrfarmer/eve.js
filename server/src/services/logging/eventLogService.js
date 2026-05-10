const path = require("path");

const BaseService = require("../baseService");
const log = require("../../utils/logger");
const rotatingLog = require("../../utils/rotatingLog");

const CLIENT_EVENTS_LOG_PATH = path.join(
  __dirname,
  "../../../logs/client-events.log",
);

function sanitizeForLog(value, options = {}) {
  const maxDepth = Number(options.maxDepth || 6);
  const maxArrayLength = Number(options.maxArrayLength || 80);
  const seen = options.seen || new WeakSet();

  function visit(entry, depth) {
    if (entry === null || entry === undefined) {
      return entry;
    }
    if (typeof entry === "bigint") {
      return entry.toString();
    }
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      return entry;
    }
    if (Buffer.isBuffer(entry)) {
      return {
        type: "buffer",
        encoding: "base64",
        value: entry.toString("base64"),
      };
    }
    if (typeof entry !== "object") {
      return String(entry);
    }
    if (seen.has(entry)) {
      return "[circular]";
    }
    if (depth >= maxDepth) {
      return "[depth-limit]";
    }

    seen.add(entry);
    if (Array.isArray(entry)) {
      const items = entry
        .slice(0, maxArrayLength)
        .map((item) => visit(item, depth + 1));
      if (entry.length > maxArrayLength) {
        items.push(`[${entry.length - maxArrayLength} more items]`);
      }
      seen.delete(entry);
      return items;
    }

    const result = {};
    for (const [key, child] of Object.entries(entry)) {
      result[key] = visit(child, depth + 1);
    }
    seen.delete(entry);
    return result;
  }

  return visit(value, 0);
}

function buildSessionContext(session) {
  return sanitizeForLog({
    clientID: session && session.clientID,
    userID: session && (session.userid || session.userID),
    characterID: session && (session.characterID || session.charid),
    shipID:
      session &&
      ((session._space && session._space.shipID) ||
        session.shipID ||
        session.shipid),
    solarSystemID:
      session &&
      ((session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid),
    stationID: session && (session.stationID || session.stationid),
    structureID: session && (session.structureID || session.structureid),
  });
}

function appendClientEventLog(payload) {
  try {
    rotatingLog.append(
      CLIENT_EVENTS_LOG_PATH,
      `${JSON.stringify(payload)}\n`,
    );
  } catch (error) {
    log.warn(`[EventLog] Failed to write client-events.log: ${error.message}`);
  }
}

class EventLogService extends BaseService {
  constructor() {
    super("eventLog");
  }

  Handle_LogClientEvent(args, session) {
    const eventArgs = Array.isArray(args) ? args : [];
    const payload = {
      ts: new Date().toISOString(),
      session: buildSessionContext(session),
      category: eventArgs[0] ?? null,
      columns: sanitizeForLog(eventArgs[1] ?? null),
      eventName: eventArgs[2] ?? null,
      values: sanitizeForLog(eventArgs.slice(3)),
      args: sanitizeForLog(eventArgs),
    };
    appendClientEventLog(payload);
    log.debug(
      `[EventLog] LogClientEvent category=${JSON.stringify(payload.category)} event=${JSON.stringify(payload.eventName)} values=${eventArgs.length - 3}`,
    );
    return null;
  }

  Handle_LogClientStats(args, session) {
    log.debug("[EventLog] LogClientStats called");
    return null;
  }

  Handle_LogPlayerRequestedDisconnect(args, session) {
    log.debug("[EventLog] LogPlayerRequestedDisconnect called");
    return null;
  }
}

module.exports = EventLogService;
module.exports.__testHooks = {
  CLIENT_EVENTS_LOG_PATH,
  sanitizeForLog,
};
