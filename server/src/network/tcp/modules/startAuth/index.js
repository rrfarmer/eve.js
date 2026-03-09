const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "../../../../database/db.json");
const database = JSON.parse(fs.readFileSync(dbPath));

const needed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "./needed.json")),
);

// put what you want to exec here
function toExec(packet, socket) {
  // First, decrypt the packet from the client
  if (socket.sessionKey) {
    const { decrypt } = require("../../utils/crypto");

    console.log(
      `[STARTAUTH] Session Key: ${socket.sessionKey.toString("hex").substring(0, 20)}...`,
    );
    console.log(
      `[STARTAUTH] Session IV: ${socket.sessionIV ? socket.sessionIV.toString("hex").substring(0, 20) + "..." : "NONE (using zero IV)"}`,
    );

    // The packet is a hex string, convert to Buffer
    const packetBuffer = Buffer.from(packet, "hex");
    const encryptedPayload = packetBuffer.slice(4); // skip 4-byte length header

    console.log(`[STARTAUTH] Full packet length: ${packetBuffer.length} bytes`);
    console.log(
      `[STARTAUTH] Encrypted payload: ${encryptedPayload.length} bytes`,
    );
    console.log(
      `[STARTAUTH] First 40 bytes of payload: ${encryptedPayload.slice(0, 40).toString("hex")}`,
    );

    // Build a list of IVs to try, in priority order.
    // Eve Online's CBC mode may chain the IV across packets — the last ciphertext
    // block of the previous packet in the same direction becomes the next IV.
    const ivsToTry = [];

    if (socket.lastClientCipherBlock)
      ivsToTry.push({
        label: "last client cipherblock (CBC chain)",
        iv: socket.lastClientCipherBlock,
      });

    if (socket.lastServerCipherBlock)
      ivsToTry.push({
        label: "last server cipherblock (CBC chain)",
        iv: socket.lastServerCipherBlock,
      });

    if (socket.sessionIV)
      ivsToTry.push({ label: "captured session IV", iv: socket.sessionIV });

    if (encryptedPayload.length >= 16)
      ivsToTry.push({
        label: "last 16 bytes of payload",
        iv: encryptedPayload.slice(-16),
      });

    ivsToTry.push({ label: "zero IV", iv: Buffer.alloc(16) });

    // Build a list of candidate keys.
    // The handshakeKey packet sends one key (sessionKeyFirst),
    // the handshake1 packet sends a second key (sessionKeySecond).
    // We don't know which one the client uses for startAuth, so try both.
    const keysToTry = [];
    if (socket.sessionKeyFirst)
      keysToTry.push({
        keyLabel: "sessionKeyFirst (handshakeKey packet)",
        key: socket.sessionKeyFirst,
      });
    if (socket.sessionKeySecond)
      keysToTry.push({
        keyLabel: "sessionKeySecond (handshake1 packet)",
        key: socket.sessionKeySecond,
      });
    // Fallback in case neither named key exists
    if (keysToTry.length === 0 && socket.sessionKey)
      keysToTry.push({
        keyLabel: "sessionKey (generic)",
        key: socket.sessionKey,
      });

    let decryptedPayload = null;
    let successKey = null;
    let successIV = null;

    outer: for (const { keyLabel, key } of keysToTry) {
      console.log(
        `[STARTAUTH] Trying key: ${keyLabel} (${key.toString("hex").substring(0, 16)}...)`,
      );
      for (const { label, iv } of ivsToTry) {
        try {
          decryptedPayload = decrypt(encryptedPayload, key, iv);
          successKey = keyLabel;
          successIV = label;
          break outer;
        } catch (err) {
          console.error(`[STARTAUTH]   ✗ iv=${label}: ${err.message}`);
        }
      }
    }

    if (!decryptedPayload) {
      console.error(
        "[STARTAUTH] All decryption attempts failed. Possible causes:",
      );
      console.error(
        "  - Session key from handshake is incorrect or misaligned",
      );
      console.error(
        "  - Client uses a different cipher mode (e.g. RC4 or AES-CFB)",
      );
      console.error(
        "  - Client-to-server and server-to-client use separate keys",
      );
    }
  }

  // gen secret
  let secret = crypto.randomBytes(16);
  console.log(`SECRET: ${secret.toString("hex")}`);

  // ENCRYPTION
  if (socket.sessionKey) {
    const { encrypt } = require("../../utils/crypto");

    // Construct the payload to be encrypted: [Magic (4)] + [Null (1)] + [Secret]
    // Note: The length is NOT included in the encrypted block, it wraps the block.
    // Magic: 0x7e (as uint32LE -> 7E 00 00 00)
    // Null: 0x00
    // Secret: 16 bytes

    const innerHeader = Buffer.alloc(5);
    innerHeader.writeUInt32LE(0x7e, 0); // Magic at 0
    innerHeader[4] = 0x00; // Null at 4

    const plaintextPayload = Buffer.concat([innerHeader, secret]);

    // Encrypt the payload
    const encryptedPayload = encrypt(
      plaintextPayload,
      socket.sessionKey,
      socket.sessionIV,
    );

    // Track the last server→client ciphertext block for CBC chaining on the next packet
    socket.lastServerCipherBlock = encryptedPayload.slice(-16);

    // Construct the final packet: [Length of Encrypted Block] + [Encrypted Block]
    const wrapperHeader = Buffer.alloc(4);
    wrapperHeader.writeUInt32LE(encryptedPayload.length, 0);

    const responsePacket = Buffer.concat([wrapperHeader, encryptedPayload]);

    console.log(
      `[STARTAUTH] Encrypted packet with session key. Payload len: ${encryptedPayload.length}`,
    );
    socket.write(responsePacket);
  } else {
    // Plaintext fallback (incorrect for this client but kept for reference/fallback)
    const header = Buffer.alloc(9);
    const payloadLength = secret.length; // 16 bytes
    const totalPacketLength = header.length + payloadLength;

    // write packet length (payload length)
    header.writeUInt32LE(totalPacketLength - 4, 0);
    // write magic number
    header.writeUInt32LE(0x7e, 4);
    // write null byte
    header[8] = 0x00;

    let responsePacket = Buffer.concat([header, secret]);

    console.warn(`[STARTAUTH] No session key found! Sending plaintext.`);
    socket.write(responsePacket);
  }

  // store secret
  database["auth"] = database["auth"] || {};
  database["auth"]["clientSecretHex"] = secret.toString("hex");
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2));

  return true;
}

module.exports = function (packet, socket) {
  // double check packet passed matches what is needed (may remove later)
  for (const rule of needed) {
    const startMatches = rule.start !== null && packet.startsWith(rule.start);
    const endMatches = rule.end !== null && packet.endsWith(rule.end);

    if (startMatches || endMatches) {
      const success = toExec(packet, socket);
      if (!success) return false;
      return true;
    }
  }

  return false;
};
