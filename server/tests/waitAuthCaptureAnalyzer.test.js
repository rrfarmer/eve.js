const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  RESULT_DECRYPT_ERROR,
  RESULT_PADDING_OK_DECODE_FAIL,
  RESULT_DECODED_WAIT_AUTH,
  INFERENCE_DECODED_WAIT_AUTH,
  INFERENCE_LIKELY_CRYPTOAPI_WRAPPED_MATERIAL,
  INFERENCE_PLAUSIBLE_KEY_WRONG_FRAMING,
  buildCaptureAnalysis,
} = require(path.join(repoRoot, "tools/macos/analyze-wait-auth-capture"));
const { encodePacket } = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

function encryptAes256Cbc(payload, key, iv) {
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(payload), cipher.final()]);
}

function buildCapture({
  payload,
  sessionKey = Buffer.alloc(32, 0x11),
  sessionIV = Buffer.alloc(16, 0x22),
  rawKey,
  rawIv,
  vipKey = Buffer.alloc(32, 0x33),
}) {
  const fullRawKey = rawKey || Buffer.concat([sessionKey, Buffer.alloc(480, 0x44)]);
  const fullRawIv = rawIv || Buffer.concat([sessionIV, Buffer.alloc(496, 0x55)]);

  return {
    path: "/tmp/generated-wait-auth-capture.json",
    data: {
      captureKind: "decrypt_failure",
      state: "WAIT_AUTH",
      keyVersion: "placebo",
      clientBuild: 3307202,
      payloadLength: payload.length,
      payloadHex: payload.toString("hex"),
      sessionKeyHex: sessionKey.toString("hex"),
      sessionIVHex: sessionIV.toString("hex"),
      sessionKeyRawLength: fullRawKey.length,
      sessionKeyRawHex: fullRawKey.toString("hex"),
      sessionIVRawLength: fullRawIv.length,
      sessionIVRawHex: fullRawIv.toString("hex"),
      vipKeyLength: vipKey.length,
      vipKeyHex: vipKey.toString("hex"),
    },
  };
}

test("WAIT_AUTH analyzer classifies generated decoded captures", () => {
  const sessionKey = Buffer.alloc(32, 0x61);
  const sessionIV = Buffer.alloc(16, 0x62);
  const authPayload = encodePacket([
    Buffer.from("challenge"),
    {
      type: "dict",
      entries: [["user_name", "maclocal1"]],
    },
  ]).subarray(4);
  const capture = buildCapture({
    sessionKey,
    sessionIV,
    payload: encryptAes256Cbc(authPayload, sessionKey, sessionIV),
  });

  const analysis = buildCaptureAnalysis(capture, { exhaustive: false });

  assert.equal(analysis.lowCostResultClass, RESULT_DECODED_WAIT_AUTH);
  assert.equal(analysis.overallResultClass, RESULT_DECODED_WAIT_AUTH);
  assert.equal(analysis.inference.label, INFERENCE_DECODED_WAIT_AUTH);
  assert.equal(analysis.currentCandidates[0].label, "default");
  assert.equal(
    analysis.currentCandidates[0].resultClass,
    RESULT_DECODED_WAIT_AUTH,
  );
  assert.deepEqual(analysis.currentCandidates[0].authKeys, ["user_name"]);
});

test("WAIT_AUTH analyzer classifies generated padding-only captures", () => {
  const sessionKey = Buffer.alloc(32, 0x71);
  const sessionIV = Buffer.alloc(16, 0x72);
  const capture = buildCapture({
    sessionKey,
    sessionIV,
    payload: encryptAes256Cbc(
      Buffer.from("not a marshaled auth payload"),
      sessionKey,
      sessionIV,
    ),
  });

  const analysis = buildCaptureAnalysis(capture, { exhaustive: false });

  assert.equal(analysis.lowCostResultClass, RESULT_PADDING_OK_DECODE_FAIL);
  assert.equal(analysis.overallResultClass, RESULT_PADDING_OK_DECODE_FAIL);
  assert.equal(
    analysis.inference.label,
    INFERENCE_PLAUSIBLE_KEY_WRONG_FRAMING,
  );
  assert.equal(
    analysis.currentCandidates[0].resultClass,
    RESULT_PADDING_OK_DECODE_FAIL,
  );
});

test("WAIT_AUTH analyzer classifies generated decrypt-error captures", () => {
  const capture = buildCapture({
    payload: Buffer.alloc(320, 0x99),
  });

  const analysis = buildCaptureAnalysis(capture, { exhaustive: false });

  assert.equal(analysis.lowCostResultClass, RESULT_DECRYPT_ERROR);
  assert.equal(analysis.overallResultClass, RESULT_DECRYPT_ERROR);
  assert.equal(
    analysis.inference.label,
    INFERENCE_LIKELY_CRYPTOAPI_WRAPPED_MATERIAL,
  );
  assert.ok(
    analysis.currentCandidates.every(
      (candidate) => candidate.resultClass === RESULT_DECRYPT_ERROR,
    ),
  );
});
