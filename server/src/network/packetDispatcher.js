/**
 * EVE Packet Dispatcher
 *
 * Ported from EVEPktDispatch.cpp — routes decoded PyPackets by their type
 * to the appropriate handler. After the handshake completes, every incoming
 * packet from the client is a macho PyPacket that ends up here.
 */

const path = require("path");
const fs = require("fs");
const log = require(path.join(__dirname, "../utils/logger"));
const { MACHONETMSG_TYPE, getTypeName } = require(
  path.join(__dirname, "../common/packetTypes"),
);
const { isMachoWrappedException } = require(
  path.join(__dirname, "../common/machoErrors"),
);
const { decodePacket, decodeCallRequest, encodePacketTuple } = require(
  path.join(__dirname, "../common/pyPacket"),
);
const { encodeAddress } = require(
  path.join(__dirname, "../common/machoAddress"),
);
const config = require(path.join(__dirname, "../config"));
const slashDebugPath = path.join(__dirname, "../../logs/slash-debug.log");
const spaceDebugPath = path.join(__dirname, "../../logs/space-undock-debug.log");

function appendSlashDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(slashDebugPath), { recursive: true });
    fs.appendFileSync(
      slashDebugPath,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[PacketDispatcher] Failed to write slash debug log: ${error.message}`);
  }
}

function appendSpaceDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(spaceDebugPath), { recursive: true });
    fs.appendFileSync(
      spaceDebugPath,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[PacketDispatcher] Failed to write space debug log: ${error.message}`);
  }
}

function summarizeValue(value, depth = 0) {
  if (depth > 4) {
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
    return value.map((item) => summarizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const summary = {};
    for (const [key, entryValue] of Object.entries(value)) {
      summary[key] = summarizeValue(entryValue, depth + 1);
    }
    return summary;
  }

  return String(value);
}

class PacketDispatcher {
  constructor(serviceManager) {
    this.serviceManager = serviceManager;
  }

  /**
   * Dispatch a decoded marshal value (the raw tuple from the wire).
   * Returns true if the packet was handled.
   */
  dispatch(rawDecoded, session) {
    const pkt = decodePacket(rawDecoded);
    if (!pkt) {
      log.warn("[PacketDispatcher] Could not decode raw packet into PyPacket");
      log.debug(
        `[PacketDispatcher] Raw type: ${typeof rawDecoded}, keys: ${rawDecoded && typeof rawDecoded === "object" ? Object.keys(rawDecoded).join(",") : "N/A"}`,
      );
      return false;
    }

    log.debug(
      `[Dispatch] ${pkt.typeName} → service=${pkt.service || "?"} src=${pkt.source.type} dst=${pkt.dest.type} src_raw=${JSON.stringify(pkt.source)}`,
    );

    switch (pkt.type) {
      case MACHONETMSG_TYPE.CALL_REQ:
        return this._handleCallReq(pkt, session);

      case MACHONETMSG_TYPE.CALL_RSP:
        return this._handleCallRsp(pkt, session);

      case MACHONETMSG_TYPE.NOTIFICATION:
        return this._handleNotification(pkt, session);

      case MACHONETMSG_TYPE.PING_REQ:
        return this._handlePingReq(pkt, session);

      case MACHONETMSG_TYPE.PING_RSP:
        return this._handlePingRsp(pkt, session);

      case MACHONETMSG_TYPE.SESSIONCHANGENOTIFICATION:
        return this._handleSessionChange(pkt, session);

      case MACHONETMSG_TYPE.ERRORRESPONSE:
        return this._handleErrorResponse(pkt, session);

      default:
        return this._handleOther(pkt, session);
    }
  }

  _handleCallReq(pkt, session) {
    let serviceName = pkt.service || pkt.dest.service;
    const call = decodeCallRequest(pkt.payload);

    // EVE 23.02: For bound object calls, the service name is null in the address,
    // but the OID string (e.g. "N=1:5") is in the call body's remoteObject field.
    if (!serviceName && call.remoteObject) {
      const ro = call.remoteObject;
      if (typeof ro === "string") {
        serviceName = ro;
      } else if (Buffer.isBuffer(ro)) {
        serviceName = ro.toString("utf8");
      }
    }

    // EVE 23.02: Client places its callID in the source address (e.g. [2, 0, 1, null] -> callID=1)
    // The dest address might contain proxyNodeId at index 1 instead of callID.
    const callID = pkt.source.callID || pkt.dest.callID || 0;

    log.debug(
      `[CallReq] ${serviceName || "?"}::${call.method}() callID=${callID}`,
    );
    const lookedUpService =
      this.serviceManager && serviceName
        ? this.serviceManager.lookup(serviceName)
        : null;
    const resolvedServiceName = lookedUpService ? lookedUpService.name : serviceName;
    const lowerResolvedServiceName = String(
      resolvedServiceName || serviceName || "",
    ).toLowerCase();
    const lowerMethodName = String(call.method || "").toLowerCase();
    const traceSpaceCall =
      call.method === "Undock" ||
      resolvedServiceName === "beyonce" ||
      (resolvedServiceName === "ship" && call.method === "MachoBindObject") ||
      lowerMethodName.includes("homestation") ||
      lowerMethodName.includes("home_station") ||
      lowerResolvedServiceName.includes("home_station") ||
      lowerResolvedServiceName.includes("homestation") ||
      lowerResolvedServiceName.includes("homestation");
    if (traceSpaceCall) {
      appendSpaceDebug(
        `CallReq service=${resolvedServiceName || serviceName || "?"} rawService=${serviceName || "?"} method=${call.method} callID=${callID} currentBound=${session && session.currentBoundObjectID ? session.currentBoundObjectID : "null"} args=${JSON.stringify(summarizeValue(call.args))} kwargs=${JSON.stringify(summarizeValue(call.kwargs))}`,
      );
    }
    if (serviceName === "slash") {
      appendSlashDebug(
        `CallReq method=${call.method} callID=${callID} args=${JSON.stringify(summarizeValue(call.args))} kwargs=${JSON.stringify(summarizeValue(call.kwargs))} raw=${JSON.stringify(summarizeValue(call.raw))}`,
      );
    }

    if (this.serviceManager && serviceName) {
      const service = lookedUpService;
      if (service) {
        const previousBoundObjectID = session
          ? session.currentBoundObjectID
          : null;
        try {
          if (session) {
            session.currentBoundObjectID =
              typeof serviceName === "string" && serviceName.startsWith("N=")
                ? serviceName
                : null;
          }
          const result = service.callMethod(
            call.method,
            call.args,
            session,
            call.kwargs,
          );

          // Scan results for bound object OIDs and register them
          // so future calls to those OIDs route back to this service.
          this._scanAndRegisterOIDs(result, service);
          if (traceSpaceCall) {
            appendSpaceDebug(
              `CallRsp service=${service.name} method=${call.method} callID=${callID} result=${JSON.stringify(summarizeValue(result))}`,
            );
          }

          // Always send a response, even if result is null/undefined
          this._sendCallResponse(
            pkt,
            result !== undefined ? result : null,
            session,
          );
          if (typeof service.afterCallResponse === "function") {
            service.afterCallResponse(call.method, session, {
              args: call.args,
              kwargs: call.kwargs,
              result,
              packet: pkt,
            });
          }
          return true;
        } catch (err) {
          log.err(
            `[CallReq] Error in ${serviceName}::${call.method}: ${err.message}`,
          );
          if (traceSpaceCall) {
            appendSpaceDebug(
              `CallErr service=${service.name} method=${call.method} callID=${callID} error=${err && err.stack ? err.stack : err.message}`,
            );
          }
          if (isMachoWrappedException(err)) {
            this._sendErrorResponse(pkt, err.machoErrorResponse, session);
          } else {
            this._sendCallResponse(pkt, null, session);
          }
          return true;
        } finally {
          if (session) {
            session.currentBoundObjectID = previousBoundObjectID || null;
          }
        }
      } else {
        log.warn(`[CallReq] No service registered for: ${serviceName}`);
        // Send None response so client doesn't hang
        this._sendCallResponse(pkt, null, session);
      }
    } else {
      log.warn(`[CallReq] No service name in packet`);
      this._sendCallResponse(pkt, null, session);
    }

    return true;
  }

  _handleCallRsp(pkt, session) {
    log.debug("[CallRsp] Received call response (client → server, unusual)");
    return true;
  }

  _handleNotification(pkt, session) {
    log.debug(`[Notification] ${pkt.dest.broadcastID || "?"}`);
    return true;
  }

  _handlePingReq(pkt, session) {
    log.debug("[PingReq] Responding to ping");

    const now = BigInt(Date.now()) * 10000n + 116444736000000000n; // Win32 FILETIME

    // Build ping response with timing data like EVEmu
    const pingList = {
      type: "list",
      items: [
        [now - 20n, now, "proxy::handle_message"],
        [now - 20n, now, "proxy::writing"],
        [now - 20n, now, "server::handle_message"],
        [now - 20n, now, "server::turnaround"],
        [now - 20n, now, "proxy::handle_message"],
        [now - 20n, now, "proxy::writing"],
      ],
    };

    // Build response as PyObject("macho.PingRsp", tuple)
    const responseTuple = [
      MACHONETMSG_TYPE.PING_RSP, // type
      encodeAddress(pkt.dest), // swap src/dst
      encodeAddress(pkt.source),
      pkt.userID || null,
      [pingList], // payload
      { type: "dict", entries: [] }, // named payload
      pkt.oob || null, // contextKey
      pkt.bssid || null, // traceID/bssid (8th element required)
      pkt.spanid || null, // spanID/bssctx (9th element required)
      pkt.extra9 || null, // 10th
      pkt.extra10 || null, // 11th
      pkt.extra11 || null, // 12th
      pkt.extra12 || null, // 13th
      pkt.extra13 || null, // 14th
    ];

    const responseObj = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.PingRsp",
      args: responseTuple,
    };

    if (session && session.sendPacket) {
      session.sendPacket(responseObj);
    }
    return true;
  }

  _handlePingRsp(pkt, session) {
    log.debug("[PingRsp] Received ping response");
    return true;
  }

  _handleSessionChange(pkt, session) {
    log.debug("[SessionChange] Session change notification from client");
    return true;
  }

  _handleErrorResponse(pkt, session) {
    log.warn("[ErrorResponse] Received error from client");
    return true;
  }

  _handleOther(pkt, session) {
    log.warn(`[Dispatch] Unhandled packet type: ${pkt.typeName} (${pkt.type})`);
    return false;
  }

  /**
   * Send a CALL_RSP back to the client.
   *
   * Matches C++ PyPacket::Encode() format:
   *   PyObject("macho.CallRsp", [type, source, dest, userID, payload, namedPayload, oob])
   *
   * Where:
   *   source = PyObject("macho.MachoAddress", [2, nodeID, service, callID])
   *   dest   = PyObject("macho.MachoAddress", [3, clientID, 0, null])
   *   payload = [substream(result)]
   *   namedPayload = {} (empty dict)
   */
  _sendCallResponse(pkt, result, session) {
    if (!session || !session.sendPacket) return;

    // The callID comes from the source address of the request
    const callID = pkt.source.callID || pkt.dest.callID || 0;

    // Build the 7-element tuple
    const responseTuple = [
      MACHONETMSG_TYPE.CALL_RSP, // type = 7

      // Source = server node (carries the callID so client can match response)
      encodeAddress({
        type: "node",
        nodeID: config.proxyNodeId,
        service: pkt.dest.service || null,
        callID: callID,
      }),

      // Dest = client
      encodeAddress({
        ...pkt.source,
        callID: callID,
        service: null,
      }),

      // userID
      session.userid || pkt.userID || null,

      // payload = [substream(result)]
      [{ type: "substream", value: result }],

      // namedPayload = empty dict (not null, per C++ code)
      { type: "dict", entries: [] },

      // contextKey
      pkt.oob || null,

      // traceID/bssid (8th element required)
      pkt.bssid || null,

      // spanID/bssctx (9th element required)
      pkt.spanid || null,
      pkt.extra9 || null, // 10th
      pkt.extra10 || null, // 11th
      pkt.extra11 || null, // 12th
      pkt.extra12 || null, // 13th
      pkt.extra13 || null, // 14th
    ];

    // Wrap in PyObject to match C++ PyPacket::Encode()
    const responseObj = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.CallRsp",
      args: responseTuple,
    };

    log.debug(
      `[CallRsp] Sending response for callID=${callID} payload=${JSON.stringify(responseObj, (k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );
    session.sendPacket(responseObj);
  }

  _sendErrorResponse(pkt, machoError, session) {
    if (!session || !session.sendPacket) return;

    const callID = pkt.source.callID || pkt.dest.callID || 0;
    const responseTuple = [
      MACHONETMSG_TYPE.ERRORRESPONSE,
      encodeAddress(pkt.dest),
      encodeAddress({
        ...pkt.source,
        callID,
        service: null,
      }),
      session.userid || pkt.userID || null,
      [
        MACHONETMSG_TYPE.CALL_REQ,
        machoError && machoError.errorCode !== undefined
          ? machoError.errorCode
          : 2,
        [{ type: "substream", value: machoError ? machoError.payload : null }],
      ],
      { type: "dict", entries: [] },
      pkt.oob || null,
      pkt.bssid || null,
      pkt.spanid || null,
      pkt.extra9 || null,
      pkt.extra10 || null,
      pkt.extra11 || null,
      pkt.extra12 || null,
      pkt.extra13 || null,
    ];

    const responseObj = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.ErrorResponse",
      args: responseTuple,
    };

    log.debug(`[ErrorRsp] Sending wrapped exception for callID=${callID}`);
    session.sendPacket(responseObj);
  }
  /**
   * Recursively scan a result for bound object OID patterns and register them.
   * Handles:
   *  - MachoBindObject result: [substruct(substream([oid, ts])), callResult]
   *  - Direct substruct return: { type: "substruct", value: ... }
   */
  _scanAndRegisterOIDs(result, service) {
    if (!result || !this.serviceManager) return;
    try {
      if (Array.isArray(result)) {
        for (const elem of result) {
          this._tryRegisterSubstruct(elem, service);
        }
      }
      this._tryRegisterSubstruct(result, service);
    } catch (e) {
      // Silently ignore extraction failures
    }
  }

  _tryRegisterSubstruct(obj, service) {
    if (!obj || typeof obj !== "object" || obj.type !== "substruct") return;
    try {
      const substream = obj.value;
      const oid =
        substream && substream.type === "substream"
          ? substream.value
          : substream;
      if (
        Array.isArray(oid) &&
        typeof oid[0] === "string" &&
        oid[0].startsWith("N=")
      ) {
        this.serviceManager.registerBoundObject(oid[0], service);
      }
    } catch (e) {
      // ignore
    }
  }
}

module.exports = PacketDispatcher;
