/**
 * Client Session
 *
 * Tracks per-client session attributes after the handshake completes.
 * Ported from EVEClientSession / ClientSession in the C++ server.
 *
 * Session attributes mirror what the C++ server tracks:
 *   userid, characterID, corporationID, stationID, solarsystemid, role, etc.
 */

const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));
const { marshalEncode, marshalDecode, encodePacket } = require(
  path.join(__dirname, "./tcp/utils/marshal"),
);
const { MACHONETMSG_TYPE } = require(
  path.join(__dirname, "../common/packetTypes"),
);
const { encodeAddress } = require(
  path.join(__dirname, "../common/machoAddress"),
);
const config = require(path.join(__dirname, "../config"));

class ClientSession {
  /**
   * @param {object} handshakeData - Data from the completed handshake
   * @param {net.Socket} socket - The TCP socket for this client
   * @param {object} options - Encryption state (key, iv, encrypt/decrypt funcs)
   */
  constructor(handshakeData, socket, options = {}) {
    // Core identity
    this.userid = handshakeData.userId || 0;
    this.userName = handshakeData.userName || "";
    this.clientID = handshakeData.clientId || 0;
    this.clientId = this.clientID; // alias for camelCase consistency
    this.role = handshakeData.role || 0;

    // Character data (set after character selection)
    this.characterID = 0;
    this.characterName = "";
    this.corporationID = 0;
    this.allianceID = 0;
    this.stationID = 0;
    this.solarsystemid = 0;
    this.constellationID = 0;
    this.regionID = 0;
    this.shipID = 0;
    this.hqID = 0;
    this.baseID = 0;
    this.warFactionID = 0;

    // Network
    this.socket = socket;
    this.address = socket ? socket.remoteAddress : "unknown";

    // Encryption state
    this.encrypted = options.encrypted || false;
    this.sessionKey = options.sessionKey || null;
    this.sessionIV = options.sessionIV || null;
    this._encryptFn = options.encryptFn || null;
    this._decryptFn = options.decryptFn || null;

    // Timestamps
    this.connectTime = Date.now();
    this.lastActivity = Date.now();
  }

  /**
   * Send a marshaled packet to this client.
   * The value is encoded, optionally encrypted, and framed with a 4-byte length.
   */
  sendPacket(value) {
    if (!this.socket || this.socket.destroyed) {
      log.warn(`[Session] Cannot send to ${this.address}: socket closed`);
      return;
    }

    this.lastActivity = Date.now();

    // Marshal the value
    const marshaled = marshalEncode(value);

    log.debug(`[Session] Sending packet (${marshaled.length} bytes)`);
    log.debug(
      `[Session] Outgoing hex: ${marshaled.toString("hex").substring(0, 160)}...`,
    );

    if (this.encrypted && this._encryptFn) {
      // Encrypt, then frame
      const encrypted = this._encryptFn(marshaled);
      const header = Buffer.alloc(4);
      header.writeUInt32LE(encrypted.length, 0);
      this.socket.write(Buffer.concat([header, encrypted]));
    } else {
      // Frame without encryption
      const header = Buffer.alloc(4);
      header.writeUInt32LE(marshaled.length, 0);
      this.socket.write(Buffer.concat([header, marshaled]));
    }
  }

  /**
   * Decrypt incoming raw packet data.
   * @param {Buffer} data - Raw payload (after removing 4-byte length header)
   * @returns {Buffer} Decrypted data
   */
  decryptPacket(data) {
    if (this.encrypted && this._decryptFn) {
      return this._decryptFn(data);
    }
    return data;
  }

  /**
   * Send a SessionChangeNotification (type 16) to the client.
   *
   * This is sent after character selection to inform the client of
   * all session attribute changes (characterID, stationID, etc.).
   *
   * The payload format is: [sessionID, sessionDict]
   *   sessionDict contains entries of [oldValue, newValue] pairs.
   *
   * From EVEmu C++ SessionChangeNotification::Encode():
   *   PyObject("macho.SessionChangeNotification", [type, src, dst, userID, payload, {}, null])
   */
  sendSessionChange(changes) {
    if (!this.socket || this.socket.destroyed) return;

    // Build the session change dict — each entry is [oldValue, newValue]
    const changeEntries = [];
    for (const [key, [oldVal, newVal]] of Object.entries(changes)) {
      changeEntries.push([key, [oldVal, newVal]]);
    }

    // SessionChangeNotification payload per General.xmlp:
    //   tuple(sessionID: long, tuple(clueless: int, changes: dict), nodesOfInterest: listInt)
    const payload = [
      { type: "long", value: 0n }, // sessionID
      [0, { type: "dict", entries: changeEntries }], // [clueless=0, changes dict]
      { type: "list", items: [-1, config.proxyNodeId] }, // nodesOfInterest
    ];

    const responseTuple = [
      MACHONETMSG_TYPE.SESSIONCHANGENOTIFICATION, // type = 16
      encodeAddress({
        type: "node",
        nodeID: config.proxyNodeId,
        callID: 0,
        service: null,
      }),
      encodeAddress({
        type: "client",
        clientID: this.clientID,
        callID: 0,
        service: null,
      }),
      this.userid || null,
      payload, // payload tuple (NOT wrapped in extra array)
      { type: "dict", entries: [] }, // named payload
      null, // contextKey
      null, // traceID/bssid (8th element required)
      null, // spanID/bssctx (9th element required)
      null, // 10th
      null, // 11th
      null, // 12th
      null, // 13th
      null, // 14th
    ];

    const packet = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.SessionChangeNotification",
      args: responseTuple,
    };

    log.info(
      `[Session] Sending SessionChangeNotification with ${changeEntries.length} changes`,
    );
    this.sendPacket(packet);
  }

  /**
   * Send a MACHONETMSG_TYPE.NOTIFICATION to the client.
   * Mirrors EVEmu's `Client::SendNotification(notifyType, idType, payload)`
   */
  sendNotification(notifyType, idType, payloadTuple = []) {
    if (!this.socket || this.socket.destroyed) return;

    // Source address: Node
    // C++: packet->source.type = PyAddress::Node; packet->source.objectID = m_services.GetNodeID();
    const sourceAddr = encodeAddress({
      type: "node",
      nodeID: config.proxyNodeId,
    });

    // Dest address: Broadcast
    // C++: dest.type = PyAddress::Broadcast; dest.service = notifyType; dest.bcast_idtype = idType; dest.objectID = GetClientID();
    const destAddr = encodeAddress({
      type: "broadcast",
      idtype: idType || "ownerid",
      broadcastID: notifyType, // ServiceCallGPCS expects notifyType to be the broadcastID
    });

    // explicitly marshal [1, payloadTuple] so BroadcastStuffGPCS properly parses the args array
    // 1 = object/RPC call, 0 = simple byte transfer
    const unpickledPayload = [1, payloadTuple];
    const marshalledPayload = marshalEncode(unpickledPayload);

    const responseTuple = [
      MACHONETMSG_TYPE.NOTIFICATION, // type = 15
      sourceAddr,
      destAddr,
      this.userid || null,
      [[0, marshalledPayload]], // payload argument: must double wrap because the Notification packet has 1 param 'payload'
      { type: "dict", entries: [] }, // named payload
      null, // contextKey
      null, // traceID/bssid (8th element required)
      null, // spanID/bssctx (9th element required)
      null, // 10th
      null, // 11th
      null, // 12th
      null, // 13th
      null, // 14th
    ];

    const packet = {
      type: "object",
      name: "carbon.common.script.net.machoNetPacket.Notification",
      args: responseTuple,
    };

    log.debug(`[Session] Sending Notification ${notifyType} (${idType})`);
    this.sendPacket(packet);
  }

  /**
   * Get a summary of this session for logging.
   */
  toString() {
    return `[Session ${this.address} user=${this.userName}(${this.userid}) char=${this.characterName}(${this.characterID})]`;
  }
}

module.exports = ClientSession;
