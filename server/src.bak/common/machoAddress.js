/**
 * Macho Address Types
 *
 * Handles encoding/decoding of EVE macho network addresses.
 *
 * Address types use numeric IDs:
 *   1 = Any (unbound service call)
 *   2 = Node
 *   3 = Client
 *   4 = Broadcast
 *
 * Field order for the Crucible client (confirmed from network data):
 *   ANY:       [type, callID, service, null?]           — service LAST
 *   NODE:      [type, nodeID, callID, service]          — service LAST
 *   CLIENT:    [type, clientID, callID, service]        — service LAST
 *   BROADCAST: [type, broadcastID, narrowTo, idtype]
 *
 * Both encoding and decoding use PyObject("macho.MachoAddress", tuple).
 */

const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));

// ─── Inline strVal helper ───────────────────────────────────────────────────
function strVal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  if (v && typeof v === "object" && v.type === "wstring") return v.value;
  if (v && typeof v === "object" && v.type === "token") return v.value;
  return null;
}

// ─── Address type constants ─────────────────────────────────────────────────
const ADDR_TYPE_ANY = 1;
const ADDR_TYPE_NODE = 2;
const ADDR_TYPE_CLIENT = 3;
const ADDR_TYPE_BROADCAST = 4;
const ADDR_TYPE_SERVICE = 8;

/**
 * Decode a macho address from a decoded marshal value.
 */
function decodeAddress(tup) {
  // Unwrap PyObject wrapper
  if (tup && typeof tup === "object" && tup.type === "object" && tup.args) {
    tup = tup.args;
  }
  if (!Array.isArray(tup) || tup.length < 1) {
    return { type: "unknown", raw: tup };
  }

  const addrType = typeof tup[0] === "number" ? tup[0] : 0;

  switch (addrType) {
    case ADDR_TYPE_ANY:
      // Crucible format: [1, callID, service, null?] — 3 or 4 elements
      return {
        type: "any",
        callID: tup.length > 1 ? tup[1] : 0,
        service: tup.length > 2 ? strVal(tup[2]) : null,
      };

    case ADDR_TYPE_NODE:
      // Crucible format: [2, nodeID, callID, service] — 4 elements
      return {
        type: "node",
        nodeID: tup.length > 1 ? tup[1] : 0,
        callID: tup.length > 2 ? tup[2] : 0,
        service: tup.length > 3 ? strVal(tup[3]) : null,
      };

    case ADDR_TYPE_CLIENT:
      // Crucible format: [3, clientID, callID, service] — 4 elements
      return {
        type: "client",
        clientID: tup.length > 1 ? tup[1] : 0,
        callID: tup.length > 2 ? tup[2] : 0,
        service: tup.length > 3 ? strVal(tup[3]) : null,
      };

    case ADDR_TYPE_BROADCAST:
      // [4, broadcastID, narrowTo, idtype]
      return {
        type: "broadcast",
        broadcastID: tup.length > 1 ? strVal(tup[1]) : null,
        narrowTo: tup.length > 2 ? tup[2] : null,
        idtype: tup.length > 3 ? strVal(tup[3]) : null,
      };

    case ADDR_TYPE_SERVICE:
      // Type 8 observed post-handshake: [8, "config", null]
      return {
        type: "service",
        service: tup.length > 1 ? strVal(tup[1]) : null,
        callID: tup.length > 2 ? tup[2] : 0,
      };

    default:
      log.warn(`[MachoAddr] Unknown address type: ${addrType}`);
      return { type: "unknown", raw: tup };
  }
}

/**
 * Encode a macho address as PyObject("macho.MachoAddress", tuple).
 * Uses Crucible field ordering (service always last).
 */
function encodeAddress(addr) {
  let tuple;

  switch (addr.type) {
    case "any":
      // [type, callID, service, null]
      tuple = [ADDR_TYPE_ANY, addr.callID || null, addr.service || null, null];
      break;

    case "node":
      // [type, nodeID, callID, service]
      tuple = [
        ADDR_TYPE_NODE,
        addr.nodeID != null ? addr.nodeID : 1,
        addr.callID || null,
        addr.service || null,
      ];
      break;

    case "client":
      // [type, clientID, callID, service]
      tuple = [
        ADDR_TYPE_CLIENT,
        typeof addr.clientID === "bigint"
          ? { type: "long", value: addr.clientID }
          : addr.clientID != null
            ? addr.clientID
            : 0,
        addr.callID || null,
        addr.service || null,
      ];
      break;

    case "broadcast":
      // [type, broadcastID, narrowTo, idtype]
      tuple = [
        ADDR_TYPE_BROADCAST,
        addr.broadcastID || null,
        addr.narrowTo || { type: "list", items: [] },
        addr.idtype || null,
      ];
      break;

    case "service":
      // [8, service, null]
      tuple = [ADDR_TYPE_SERVICE, addr.service || null, null];
      break;

    default:
      tuple = [ADDR_TYPE_ANY, null, null, null];
      break;
  }

  // Wrap in PyObject to match C++ PyAddress::Encode()
  return {
    type: "object",
    name: "carbon.common.script.net.machoNetPacket.MachoAddress",
    args: tuple,
  };
}

module.exports = {
  ADDR_TYPE_ANY,
  ADDR_TYPE_NODE,
  ADDR_TYPE_CLIENT,
  ADDR_TYPE_BROADCAST,
  ADDR_TYPE_SERVICE,
  decodeAddress,
  encodeAddress,
  strVal,
};
