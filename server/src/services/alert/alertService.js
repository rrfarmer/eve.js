/**
 * Alert Service
 *
 * Handles client alert calls like crash reports (BeanCount).
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

function decodeTraceValue(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (
    value &&
    typeof value === "object" &&
    value.type === "Buffer" &&
    Array.isArray(value.data)
  ) {
    return Buffer.from(value.data).toString("utf8");
  }
  if (Array.isArray(value)) {
    return value.map(decodeTraceValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, decodeTraceValue(entry)]),
    );
  }
  return value;
}

class AlertService extends BaseService {
  constructor() {
    super("alert");
  }

  Handle_BeanCount(args, session) {
    log.debug("[AlertService] BeanCount (crash report)");
    // Client unpacks: (nextErrorKeyHash, nodeID) = result
    return [null, null];
  }

  Handle_SendClientStackTraceAlert(args, session) {
    const traceData = args && args.length > 0 ? args : [];
    const decodedTraceData = decodeTraceValue(traceData);
    log.warn(
      `[AlertService] SendClientStackTraceAlert char=${session && session.characterID} ` +
        `trace=${JSON.stringify(decodedTraceData).slice(0, 4000)}`,
    );
    return null;
  }
}

module.exports = AlertService;
