const fs = require("fs");
const path = require("path");
const log = require("../../../../utils/logger");

// This response was previously static in packetmap.json: "0c0000007e0000000013054f4b204343"
// 0C 00 00 00 -> Length 12
// 7E 00 00 00 -> Magic
// 00 -> unused
// 13 05 4F 4B 20 43 43 -> String "OK CC" (13 = string, 05 = len, 4F4B204343 = "OK CC")

const RESPONSE_HEX = "0c0000007e0000000013054f4b204343";

module.exports = function (packet, socket) {
  // packet is the full hex string of the received packet
  // We need to extract the session key.
  // The packet that comes here matches "handshake1" needed rule.
  // It typically looks like: ... 13 20 [32 BYTES HEX KEY] ... or similar struct.
  // But based on the 'end' rule in packetmap: "13136372797074696e675f73657373696f6e6b6579"
  // which decodes to .. "crypting_sessionkey"

  // Let's decode the packet properly or regex it.
  // The packet usually contains a tuple or struct with the key.
  // For safety, let's grab the 32 bytes preceding the "crypting_sessionkey" string if possible,
  // OR, simply look for a 32-byte chunk (64 hex chars) if we know the offset.

  // However, `packet` is a HEX STRING.
  // The structure is likely: [Header] [Tuple Marker] [Key String?] [Key Value] ...

  // Let's convert back to buffer for easier inspection if needed, OR just parse the hex.
  // Given the complexity of MachoNet, it's safer to find the key by pattern or fixed offset if we knew it.
  // But previously this was just a static response, so we didn't care about the input.

  // The log showed:
  // "...13 20 c7 e5 3a 7a ... 13 13 63 72 79 70 74 69 6e 67 5f 73 65 73 73 69 6f 6e 6b65 79"
  // "13 20" -> String (0x13) Length 0x20 (32 bytes).
  // So we look for "1320" followed by 64 hex chars.

  // Extract Session IV
  // Look for "crypting_sessioniv" label: 6372797074696e675f73657373696f6e6976
  const IV_LABEL_HEX = "6372797074696e675f73657373696f6e6976";
  const ivLabelIndex = packet.indexOf(IV_LABEL_HEX);

  if (ivLabelIndex !== -1) {
    // After the label, there's a header: 13ff00020000 (6 bytes = 12 hex chars)
    // Then the actual 16-byte IV (32 hex chars)
    const IV_HEADER = "13ff00020000";
    const afterLabel = packet.substring(
      ivLabelIndex + IV_LABEL_HEX.length,
      ivLabelIndex + IV_LABEL_HEX.length + IV_HEADER.length,
    );

    if (afterLabel === IV_HEADER) {
      const ivStart = ivLabelIndex + IV_LABEL_HEX.length + IV_HEADER.length;
      const ivLength = 32; // 16 bytes * 2
      const ivHex = packet.substring(ivStart, ivStart + ivLength);

      socket.sessionIV = Buffer.from(ivHex, "hex");
      log.debug(`captured SessionIV: ${ivHex.substring(0, 10)}...`);
    } else {
      log.warn(`found sessioniv label but unexpected header: ${afterLabel}`);
    }
  } else {
    // Fallback: Use Zero IV (already default in crypto lib if undefined)
    log.debug(`no sessioniv label found, using Zero IV.`);
  }

  // Extract Session Key
  // There are TWO packet types that call this handler:
  // 1. "handshakeKey": contains "1320" marker followed by key - THIS IS THE ENCRYPTION KEY
  // 2. "handshake1": has key-like data before label, but we should NOT overwrite the key from handshakeKey

  // First check if we already have a session key (from handshakeKey packet)
  // commented out to see if i can override the current key with the new key, and see if that works
  // Log first 80 bytes of packet for structure analysis
  console.log(
    `[HANDSHAKE] Packet (first 80 bytes): ${packet.substring(0, 160)}`,
  );

  const KEY_LABEL_HEX = "13136372797074696e675f73657373696f6e6b6579";
  const keyLabelIndex = packet.indexOf(KEY_LABEL_HEX);

  if (keyLabelIndex !== -1) {
    console.log(
      `[HANDSHAKE] Found crypting_sessionkey label at hex pos ${keyLabelIndex}`,
    );

    // Show 10 bytes before and after the label for structural insight
    const ctxBefore = packet.substring(
      Math.max(0, keyLabelIndex - 20),
      keyLabelIndex,
    );
    const ctxAfter = packet.substring(
      keyLabelIndex + KEY_LABEL_HEX.length,
      keyLabelIndex + KEY_LABEL_HEX.length + 80,
    );
    console.log(`[HANDSHAKE]   ...${ctxBefore}|LABEL|${ctxAfter}...`);

    // Try A: key is the 32 bytes BEFORE the label (original approach)
    const keyLength = 64;
    const keyStartBefore = keyLabelIndex - keyLength;
    if (keyStartBefore >= 0) {
      const keyHex = packet.substring(keyStartBefore, keyLabelIndex);
      console.log(`[HANDSHAKE]   [A] 32 bytes BEFORE label: ${keyHex}`);
      // Check if 2 bytes before THOSE bytes are '1320' (string 32-byte marker)
      const prefixBefore = packet.substring(keyStartBefore - 4, keyStartBefore);
      console.log(
        `[HANDSHAKE]   [A] 2 bytes before that: ${prefixBefore} (want '1320' for valid string field)`,
      );
    }

    // Try B: key is 32 bytes AFTER the label, with optional header
    // Pattern: label + [13 20] + <32 bytes>
    const afterLabel = packet.substring(keyLabelIndex + KEY_LABEL_HEX.length);
    const KEY_VALUE_HEADER = "1320";
    if (afterLabel.startsWith(KEY_VALUE_HEADER)) {
      const keyHex = afterLabel.substring(
        KEY_VALUE_HEADER.length,
        KEY_VALUE_HEADER.length + 64,
      );
      socket.sessionKeySecond = Buffer.from(keyHex, "hex");
      socket.sessionKey = socket.sessionKeySecond;
      console.log(
        `[HANDSHAKE]   [B] Key AFTER label (1320+32bytes): ${keyHex.substring(0, 20)}...`,
      );
    } else if (afterLabel.length >= 64) {
      // Try key directly after label without header
      const keyHex = afterLabel.substring(0, 64);
      console.log(
        `[HANDSHAKE]   [B] 32 bytes directly AFTER label (no header): ${keyHex}`,
      );
    } else {
      console.log(
        `[HANDSHAKE]   [B] Nothing useful after label (remaining hex: ${afterLabel.substring(0, 20)})`,
      );
      // Fall back to before-the-label approach
      if (keyStartBefore >= 0) {
        const keyHex = packet.substring(keyStartBefore, keyLabelIndex);
        socket.sessionKeySecond = Buffer.from(keyHex, "hex");
        socket.sessionKey = socket.sessionKeySecond;
        log.debug(
          `captured SessionKeySecond from handshake1 (before label): ${keyHex.substring(0, 10)}...`,
        );
      } else {
        log.warn(`key label found but not enough data before it!`);
      }
    }
  } else {
    // Try handshakeKey packet format: "1320" marker followed by key
    const KEY_MARKER = "1320";
    const keyIndex = packet.indexOf(KEY_MARKER);

    if (keyIndex !== -1) {
      const keyStart = keyIndex + KEY_MARKER.length;
      const keyLength = 64; // 32 bytes * 2
      const keyHex = packet.substring(keyStart, keyStart + keyLength);

      // Store as the "first" key — this is the handshakeKey packet key
      socket.sessionKeyFirst = Buffer.from(keyHex, "hex");
      socket.sessionKey = socket.sessionKeyFirst;
      console.log(
        `[HANDSHAKE] Captured SessionKeyFirst from handshakeKey: ${keyHex.substring(0, 10)}...`,
      );
    } else {
      console.warn("[HANDSHAKE] Could not find session key in packet!");
    }
  }
  // if (!socket.sessionKey) {
  //   const KEY_LABEL_HEX = "13136372797074696e675f73657373696f6e6b6579";
  //   const keyLabelIndex = packet.indexOf(KEY_LABEL_HEX);

  //   if (keyLabelIndex !== -1) {
  //     // handshake1 packet: key is the 64 hex chars (32 bytes) immediately BEFORE the label
  //     const keyLength = 64;
  //     const keyStart = keyLabelIndex - keyLength;

  //     if (keyStart >= 0) {
  //       const keyHex = packet.substring(keyStart, keyLabelIndex);
  //       socket.sessionKey = Buffer.from(keyHex, "hex");
  //       log.debug(
  //         `captured SessionKey from handshake1: ${keyHex.substring(0, 10)}...`,
  //       );
  //     } else {
  //       log.warn(`key label found but not enough data before it!`);
  //     }
  //   } else {
  //     // Try handshakeKey packet format: "1320" marker followed by key
  //     const KEY_MARKER = "1320";
  //     const keyIndex = packet.indexOf(KEY_MARKER);

  //     if (keyIndex !== -1) {
  //       const keyStart = keyIndex + KEY_MARKER.length;
  //       const keyLength = 64; // 32 bytes * 2
  //       const keyHex = packet.substring(keyStart, keyStart + keyLength);

  //       socket.sessionKey = Buffer.from(keyHex, "hex");
  //       console.log(
  //         `[HANDSHAKE] Captured Session Key from handshakeKey: ${keyHex.substring(0, 10)}...`,
  //       );
  //     } else {
  //       console.warn("[HANDSHAKE] Could not find session key in packet!");
  //     }
  //   }
  // } else {
  //   console.log(
  //     `[HANDSHAKE] Session key already exists, not overwriting (key: ${socket.sessionKey.toString("hex").substring(0, 10)}...)`,
  //   );
  // }

  // Send the "OK CC" response
  // If we have both sessionKey AND sessionIV, the session is fully established
  // and we need to encrypt all subsequent packets
  if (socket.sessionKey && socket.sessionIV) {
    const { encrypt } = require("../../utils/crypto");

    // The plaintext "OK CC" packet: 0c0000007e0000000013054f4b204343
    // Structure: [Length 4 bytes][Magic 4 bytes][Null 1 byte][String data]
    // We should encrypt only the payload (everything AFTER the length header)
    const fullPacket = Buffer.from(RESPONSE_HEX, "hex");
    const plaintextPayload = fullPacket.slice(4); // Skip the 4-byte length header

    // Encrypt the payload
    const encryptedPayload = encrypt(
      plaintextPayload,
      socket.sessionKey,
      socket.sessionIV,
    );

    // Wrap with new length header
    const wrapperHeader = Buffer.alloc(4);
    wrapperHeader.writeUInt32LE(encryptedPayload.length, 0);

    const encryptedPacket = Buffer.concat([wrapperHeader, encryptedPayload]);

    // Track last server→client ciphertext block for CBC chaining on next packet
    socket.lastServerCipherBlock = encryptedPayload.slice(-16);

    console.log(
      `[HANDSHAKE] Sending encrypted OK CC (payload: ${encryptedPayload.length} bytes)`,
    );
    socket.write(encryptedPacket);
  } else {
    // Plain response (for handshakeKey packet before IV is established)
    console.log("[HANDSHAKE] Sending OK CC");
    socket.write(Buffer.from(RESPONSE_HEX, "hex"));
  }

  return true;
};
