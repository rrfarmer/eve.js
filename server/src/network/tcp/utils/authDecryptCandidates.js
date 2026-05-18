const crypto = require("crypto");
const { marshalDecode } = require("./marshal");

const RESULT_DECRYPT_ERROR = "decrypt_error";
const RESULT_PADDING_OK_DECODE_FAIL = "padding_ok_decode_fail";
const RESULT_DECODED_WAIT_AUTH = "decoded_wait_auth";

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (typeof value === "string" && value.length > 0) {
    return Buffer.from(value, "hex");
  }
  return null;
}

function candidateKeyHex(key, iv) {
  return `${key.toString("hex")}:${iv.toString("hex")}`;
}

function sha256(...parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    if (Buffer.isBuffer(part)) {
      hash.update(part);
    }
  }
  return hash.digest();
}

function pushCandidate(candidates, seen, candidate) {
  if (
    !Buffer.isBuffer(candidate.key) ||
    !Buffer.isBuffer(candidate.iv) ||
    candidate.key.length !== 32 ||
    candidate.iv.length !== 16
  ) {
    return;
  }

  const key = candidateKeyHex(candidate.key, candidate.iv);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push({
    group: "current",
    ...candidate,
    key: Buffer.from(candidate.key),
    iv: Buffer.from(candidate.iv),
  });
}

function buildAuthDecryptCandidates({
  sessionKey,
  sessionIV,
  rawKey,
  rawIv,
  vipKey,
  includeDefault = false,
  includeHashReductions = true,
} = {}) {
  const currentKey = toBuffer(sessionKey);
  const currentIv = toBuffer(sessionIV);
  const fullKey = toBuffer(rawKey);
  const fullIv = toBuffer(rawIv);
  const fullVipKey = toBuffer(vipKey);
  const candidates = [];
  const seen = new Set();

  if (includeDefault) {
    pushCandidate(candidates, seen, {
      label: "default",
      group: "default",
      key: currentKey,
      iv: currentIv,
    });
  }

  if (
    !Buffer.isBuffer(fullKey) ||
    !Buffer.isBuffer(fullIv) ||
    fullKey.length < 32 ||
    fullIv.length < 16
  ) {
    return candidates;
  }

  const keyHead = fullKey.subarray(0, 32);
  const keyTail = fullKey.subarray(fullKey.length - 32);
  const ivHead = fullIv.subarray(0, 16);
  const ivTail = fullIv.subarray(fullIv.length - 16);
  const shaKey = sha256(fullKey);
  const shaIv = sha256(fullIv);

  pushCandidate(candidates, seen, {
    label: "head/tail",
    key: keyHead,
    iv: ivTail,
  });
  pushCandidate(candidates, seen, {
    label: "tail/head",
    key: keyTail,
    iv: ivHead,
  });
  pushCandidate(candidates, seen, {
    label: "tail/tail",
    key: keyTail,
    iv: ivTail,
  });
  pushCandidate(candidates, seen, {
    label: "sha256(raw)/head",
    key: shaKey,
    iv: ivHead,
  });
  pushCandidate(candidates, seen, {
    label: "sha256(raw)/tail",
    key: shaKey,
    iv: ivTail,
  });
  pushCandidate(candidates, seen, {
    label: "sha256(raw)/sha256(raw)",
    key: shaKey,
    iv: shaIv.subarray(0, 16),
  });

  if (!includeHashReductions) {
    return candidates;
  }

  pushCandidate(candidates, seen, {
    label: "sha256(key+iv)/head",
    group: "hash",
    key: sha256(fullKey, fullIv),
    iv: ivHead,
  });
  pushCandidate(candidates, seen, {
    label: "sha256(iv+key)/tail",
    group: "hash",
    key: sha256(fullIv, fullKey),
    iv: ivTail,
  });

  if (Buffer.isBuffer(fullVipKey) && fullVipKey.length > 0) {
    pushCandidate(candidates, seen, {
      label: "sha256(vip+key)/head",
      group: "hash",
      key: sha256(fullVipKey, fullKey),
      iv: ivHead,
    });
    pushCandidate(candidates, seen, {
      label: "sha256(key+vip)/tail",
      group: "hash",
      key: sha256(fullKey, fullVipKey),
      iv: ivTail,
    });
    pushCandidate(candidates, seen, {
      label: "sha256(vip+key)/sha256(vip+iv)",
      group: "hash",
      key: sha256(fullVipKey, fullKey),
      iv: sha256(fullVipKey, fullIv).subarray(0, 16),
    });
    pushCandidate(candidates, seen, {
      label: "sha256(key+vip)/sha256(iv+vip)",
      group: "hash",
      key: sha256(fullKey, fullVipKey),
      iv: sha256(fullIv, fullVipKey).subarray(0, 16),
    });
  }

  return candidates;
}

function tryDecodeAuthCandidate(payload, candidate) {
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      candidate.key,
      candidate.iv,
    );
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]);

    try {
      const decoded = marshalDecode(decrypted);
      return {
        resultClass: RESULT_DECODED_WAIT_AUTH,
        decoded,
        decrypted,
      };
    } catch (decodeError) {
      return {
        resultClass: RESULT_PADDING_OK_DECODE_FAIL,
        decrypted,
        error: decodeError,
      };
    }
  } catch (decryptError) {
    return {
      resultClass: RESULT_DECRYPT_ERROR,
      error: decryptError,
    };
  }
}

module.exports = {
  RESULT_DECRYPT_ERROR,
  RESULT_PADDING_OK_DECODE_FAIL,
  RESULT_DECODED_WAIT_AUTH,
  buildAuthDecryptCandidates,
  candidateKeyHex,
  tryDecodeAuthCandidate,
};
