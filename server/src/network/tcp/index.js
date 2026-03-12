// EVE.js TCP Server
// Handles client connections and drives the handshake state machine.
// After handshake, routes packets via the PacketDispatcher.

const path = require("path");
const net = require("net");

const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const EVEHandshake = require(path.join(__dirname, "./handshake"));
const { marshalDecode } = require(path.join(__dirname, "./utils/marshal"));
const ClientSession = require(path.join(__dirname, "../clientSession"));
const PacketDispatcher = require(path.join(__dirname, "../packetDispatcher"));
const sessionRegistry = require(path.join(
  __dirname,
  "../../services/chat/sessionRegistry",
));
const { performCharacterLogoff } = require(path.join(
  __dirname,
  "../../services/user/logoffCharacter",
));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const { MACHONETMSG_TYPE } = require(
  path.join(__dirname, "../../common/packetTypes"),
);
const { encodeAddress } = require(
  path.join(__dirname, "../../common/machoAddress"),
);

/**
 * start the tcp server.
 * @param {ServiceManager} serviceManager - the service manager with registered services
 */
module.exports = function (serviceManager) {
  const dispatcher = new PacketDispatcher(serviceManager);

  function logDebug(t) {
    if (config.logLevel > 1) log.debug(t);
  }

  function logInfo(t) {
    if (config.logLevel > 0) log.info(t);
  }

  function cleanupClientSession(clientSession) {
    if (!clientSession || clientSession._disconnectCleaned) {
      return;
    }

    clientSession._disconnectCleaned = true;
    performCharacterLogoff(clientSession, "tcp");
    spaceRuntime.detachSession(clientSession, { broadcast: true });
    sessionRegistry.unregister(clientSession);
  }

  const server = net
    .createServer((socket) => {
      logInfo(
        `New connection from ${socket.remoteAddress}:${socket.remotePort}`,
      );

      let tcpBuffer = Buffer.alloc(0);

      // Create a handshake state machine for this connection
      const handshake = new EVEHandshake(socket);
      let handshakeComplete = false;
      let clientSession = null;

      // Start the handshake (sends VersionExchangeServer)
      handshake.start();

      // Listen for data
      socket.on("data", (chunk) => {
        tcpBuffer = Buffer.concat([tcpBuffer, chunk]);

        // Frame-level parsing: packets are [4-byte LE length] [payload]
        while (tcpBuffer.length >= 4) {
          const payloadLength = tcpBuffer.readUInt32LE(0);

          // Sanity check
          if (payloadLength <= 0 || payloadLength > 10_000_000) {
            log.err(`[TCP] Invalid payload length: ${payloadLength}`);
            tcpBuffer = Buffer.alloc(0);
            break;
          }

          const totalLength = 4 + payloadLength;
          if (tcpBuffer.length < totalLength) break; // Need more data

          // Extract the payload (everything after the 4-byte length)
          const payload = tcpBuffer.slice(4, totalLength);
          tcpBuffer = tcpBuffer.slice(totalLength);

          if (!handshakeComplete) {
            // Pass to handshake state machine
            try {
              const result = handshake.handlePacket(payload);
              if (result.done) {
                handshakeComplete = true;
                logDebug(
                  `Handshake complete for ${socket.remoteAddress} — entering packet dispatch mode`,
                );

                // Create client session from handshake data
                clientSession = new ClientSession(
                  {
                    userId: handshake.userId,
                    userName: handshake.userName,
                    clientId: handshake.clientId,
                    role: handshake.role,
                    sessionId: handshake.sessionId,
                  },
                  socket,
                  {
                    encrypted: handshake.encrypted,
                    sessionKey: handshake.sessionKey,
                    sessionIV: handshake.sessionIV,
                    encryptFn: handshake.encrypted
                      ? (data) => handshake._encrypt(data)
                      : null,
                    decryptFn: handshake.encrypted
                      ? (data) => handshake._decrypt(data)
                      : null,
                  },
                );

                logInfo(
                  `session created for ${clientSession.userName} (ID: ${clientSession.userid})`,
                );
                sessionRegistry.register(clientSession);

                // Send SessionInitialStateNotification to unblock client
                // The client waits for this before making further service calls
                _sendSessionInitNotification(clientSession, config);
              }
            } catch (err) {
              log.err(`handshake error: ${err.message}`);
              logDebug(`stack: ${err.stack}`);
            }
          } else {
            // ── Post-handshake packet dispatch ──────────────────────────
            try {
              // Decrypt if needed
              let data = payload;
              if (clientSession) {
                data = clientSession.decryptPacket(payload);
              }

              // Check for zlib compression
              if (data[0] === 0x78) {
                const zlib = require("zlib");
                data = zlib.inflateSync(data);
              }

              // Unmarshal the packet
              const decoded = marshalDecode(data);

              if (decoded && decoded.type === "object" && decoded.args) {
                logDebug(
                  `[TCP] incoming PyPacket: ${decoded.name} has tuple length: ${decoded.args.length}`,
                );
              }

              logDebug(
                `[TCP] decoded packet: ${JSON.stringify(decoded, (k, v) => {
                  if (typeof v === "bigint") return v.toString();
                  if (v && v.type === "Buffer" && v.data) {
                    // Decode buffer data to readable string
                    try {
                      return `<Buffer:${Buffer.from(v.data).toString("utf8")}>`;
                    } catch (e) {}
                  }
                  return v;
                }).substring(0, 500)}`,
              );

              // dispatch through the packet dispatcher
              dispatcher.dispatch(decoded, clientSession);
            } catch (err) {
              log.err(`[TCP] packet processing error: ${err.message}`);
              logDebug(`[TCP] stack: ${err.stack}`);
              logDebug(
                `[TCP] raw: ${payload.toString("hex").substring(0, 80)}...`,
              );
            }
          }
        }
      });

      socket.on("close", () => {
        cleanupClientSession(clientSession);
        logInfo(
          `connection closed: ${socket.remoteAddress}:${socket.remotePort}`,
        );
      });

      socket.on("error", (err) => {
        cleanupClientSession(clientSession);
        log.err(`[TCP] socket error: ${err.message}`);
      });
    })
    .listen(config.serverPort, "0.0.0.0", () => {
      log.success(`eve.js is running!`);
      log.success(`(port: ${config.serverPort})`);
    });
};

/**
 * Send a SessionInitialStateNotification to the client.
 * The client blocks until it receives this after the handshake.
 */
function _sendSessionInitNotification(session, config) {
  const sessionID =
    typeof session.sid === "bigint"
      ? session.sid
      : BigInt(session.sid || session.sessionID || (Date.now() * 15));
  session.sid = sessionID;
  session.sessionID = sessionID;

  const initialState = {
    type: "dict",
    entries: [
      ["userid", session.userid || 0],
      ["userType", 30],
      [
        "role",
        {
          type: "long",
          value: session.role ? BigInt(session.role) : 6917529029788565504n,
        },
      ],
      ["address", session.address || "127.0.0.1"],
      ["languageID", "EN"],
    ],
  };

  const payload = [
    { type: "long", value: sessionID },
    5, // sessionType = GAME
    initialState,
  ];

  const responseTuple = [
    MACHONETMSG_TYPE.SESSIONINITIALSTATENOTIFICATION, // type = 18
    encodeAddress({
      type: "node",
      nodeID: config.proxyNodeId,
      callID: 0,
      service: null,
    }),
    encodeAddress({
      type: "client",
      clientID: session.clientID || session.clientId || 0,
      callID: 0,
      service: null,
    }),
    session.userid || null,
    payload, // payload tuple
    { type: "dict", entries: [] }, // named payload
    null, // contextKey
    null, // traceID/bssid (8th element)
    null, // spanID/bssctx (9th element)
    null, // 10th
    null, // 11th
    null, // 12th
    null, // 13th
    null, // 14th
  ];

  const packet = {
    type: "object",
    name: "carbon.common.script.net.machoNetPacket.SessionInitialStateNotification",
    args: responseTuple,
  };

  log.info(
    `[SessionInit] Sending initial session state for user ${session.userid}`,
  );
  session.sendPacket(packet);
}
