#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.join(__dirname, "..", "..");
const {
  marshalDecode,
  strVal,
} = require(path.join(repoRoot, "server/src/network/tcp/utils/marshal"));
const {
  RESULT_DECRYPT_ERROR,
  RESULT_PADDING_OK_DECODE_FAIL,
  RESULT_DECODED_WAIT_AUTH,
  tryDecodeAuthCandidate,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/authDecryptCandidates",
));
const {
  buildWindowsPatchedPlaceboCandidates,
} = require(path.join(repoRoot, "server/src/network/tcp/utils/authDialects"));

const RESULT_DECODE_FAIL = "decode_fail";
const INFERENCE_DECODED_WAIT_AUTH = "decoded_wait_auth";
const INFERENCE_PLAUSIBLE_KEY_WRONG_FRAMING = "plausible_key_wrong_framing";
const INFERENCE_LIKELY_CRYPTOAPI_WRAPPED_MATERIAL =
  "likely_cryptoapi_wrapped_session_material";
const INFERENCE_UNKNOWN = "unknown";

function usage() {
  console.error(
    [
      "Usage: node tools/macos/analyze-wait-auth-capture.js [options] [capture.json ...]",
      "",
      "When no capture paths are provided, reads server/handshake-captures/*.json.",
      "",
      "Options:",
      "  --json              Print JSON instead of a text report.",
      "  --no-exhaustive     Skip contiguous 32-byte key / 16-byte IV window scans.",
      "  --max-examples=N    Limit examples retained from scans. Default: 8.",
      "  --help              Show this help.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    json: false,
    exhaustive: true,
    maxExamples: 8,
    paths: [],
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-exhaustive") {
      options.exhaustive = false;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("--max-examples=")) {
      const value = Number.parseInt(arg.slice("--max-examples=".length), 10);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid --max-examples value: ${arg}`);
      }
      options.maxExamples = value;
    } else {
      options.paths.push(arg);
    }
  }

  return options;
}

function expandCapturePaths(inputPaths) {
  if (inputPaths.length === 0) {
    const captureDir = path.join(repoRoot, "server/handshake-captures");
    if (!fs.existsSync(captureDir)) {
      return [];
    }
    return fs
      .readdirSync(captureDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(captureDir, name));
  }

  const expanded = [];
  for (const inputPath of inputPaths) {
    const absolutePath = path.resolve(inputPath);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath).sort()) {
        if (name.endsWith(".json")) {
          expanded.push(path.join(absolutePath, name));
        }
      }
    } else {
      expanded.push(absolutePath);
    }
  }
  return expanded;
}

function readCapture(filePath) {
  const absolutePath = path.resolve(filePath);
  return {
    path: absolutePath,
    data: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
  };
}

function bufferFromHex(hex) {
  if (typeof hex !== "string" || hex.length === 0) {
    return null;
  }
  return Buffer.from(hex, "hex");
}

function sha256Hex(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function truncate(value, limit = 96) {
  const text = String(value || "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function valueToBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    return Buffer.from(value, "binary");
  }
  if (value && typeof value === "object" && value.type === "buffer") {
    return Buffer.from(value.data || []);
  }
  return null;
}

function listDictKeys(dictObj, limit = 32) {
  if (!dictObj || dictObj.type !== "dict" || !Array.isArray(dictObj.entries)) {
    return [];
  }
  return dictObj.entries
    .slice(0, limit)
    .map(([key]) => truncate(strVal(key), 40));
}

function summarizeDecoded(value) {
  if (Buffer.isBuffer(value)) {
    return `Buffer(${value.length}B)`;
  }
  if (Array.isArray(value)) {
    const preview = value
      .slice(0, 3)
      .map((entry) => summarizeDecoded(entry))
      .join(", ");
    return `tuple(len=${value.length}${preview ? `, items=[${preview}]` : ""})`;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value.length > 48 ? `${value.slice(0, 45)}...` : value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (value && typeof value === "object") {
    if (value.type === "dict" && Array.isArray(value.entries)) {
      const keys = listDictKeys(value, 4);
      return `dict(${value.entries.length}${keys.length > 0 ? ` keys=[${keys.join(", ")}]` : ""})`;
    }
    if (value.type === "list" && Array.isArray(value.items)) {
      return `list(${value.items.length})`;
    }
    if (value.type === "tuple" && Array.isArray(value.items)) {
      return `tupleObj(${value.items.length})`;
    }
    if (value.type === "long") {
      return "long";
    }
    if (value.type === "buffer" && Array.isArray(value.data)) {
      return `buffer(${value.data.length}B)`;
    }
    return `object(${Object.keys(value).slice(0, 4).join(",")})`;
  }
  return typeof value;
}

function summarizeAuthDecoded(decoded) {
  const summary = {
    decodedSummary: summarizeDecoded(decoded),
  };

  if (!Array.isArray(decoded)) {
    summary.authShape = false;
    return summary;
  }

  const authChallenge = decoded[0];
  const loginData = decoded[1];
  const challengeBuffer = valueToBuffer(authChallenge);
  summary.authShape =
    decoded.length >= 2 &&
    loginData &&
    loginData.type === "dict" &&
    Array.isArray(loginData.entries);
  summary.authTupleLength = decoded.length;
  summary.authChallengeLength = challengeBuffer ? challengeBuffer.length : 0;
  summary.authChallengeSha256 = sha256Hex(challengeBuffer);
  summary.authDictEntryCount = summary.authShape ? loginData.entries.length : 0;
  summary.authKeys = listDictKeys(loginData, 32);

  return summary;
}

function summarizeCandidateResult(candidate, result) {
  const summary = {
    label: candidate.label,
    group: candidate.group || "current",
    resultClass: result.resultClass,
  };

  if (result.error) {
    summary.error = truncate(result.error.message || result.error);
  }
  if (Buffer.isBuffer(result.decrypted)) {
    summary.decryptedLength = result.decrypted.length;
    summary.decryptedSha256 = sha256Hex(result.decrypted);
  }
  if (result.resultClass === RESULT_DECODED_WAIT_AUTH) {
    Object.assign(summary, summarizeAuthDecoded(result.decoded));
  }

  return summary;
}

function evaluatePlaintextPayload(payload) {
  try {
    const decoded = marshalDecode(payload);
    return {
      label: "plaintext",
      resultClass: RESULT_DECODED_WAIT_AUTH,
      ...summarizeAuthDecoded(decoded),
    };
  } catch (error) {
    return {
      label: "plaintext",
      resultClass: RESULT_DECODE_FAIL,
      error: truncate(error.message),
    };
  }
}

function classifyResults(results) {
  if (results.some((result) => result?.resultClass === RESULT_DECODED_WAIT_AUTH)) {
    return RESULT_DECODED_WAIT_AUTH;
  }
  if (
    results.some(
      (result) => result?.resultClass === RESULT_PADDING_OK_DECODE_FAIL,
    )
  ) {
    return RESULT_PADDING_OK_DECODE_FAIL;
  }
  return RESULT_DECRYPT_ERROR;
}

function inferCapturePath(captureData, payloadLength, lowCostResultClass) {
  const rawKeyLength = captureData.sessionKeyRawLength || 0;
  const rawIvLength = captureData.sessionIVRawLength || 0;

  if (lowCostResultClass === RESULT_DECODED_WAIT_AUTH) {
    return {
      label: INFERENCE_DECODED_WAIT_AUTH,
      detail: "auth payload decoded with the current low-cost candidates",
    };
  }

  if (lowCostResultClass === RESULT_PADDING_OK_DECODE_FAIL) {
    return {
      label: INFERENCE_PLAUSIBLE_KEY_WRONG_FRAMING,
      detail: "a candidate produced valid AES padding but not a marshal auth tuple",
    };
  }

  if (
    rawKeyLength === 512 &&
    rawIvLength === 512 &&
    payloadLength > 0 &&
    payloadLength % 16 === 0
  ) {
    return {
      label: INFERENCE_LIKELY_CRYPTOAPI_WRAPPED_MATERIAL,
      detail:
        "512-byte key/IV blobs look like wrapped session material, not direct Placebo AES inputs",
    };
  }

  return {
    label: INFERENCE_UNKNOWN,
    detail: "capture does not match a recognized WAIT_AUTH failure pattern",
  };
}

function buildCandidateResults(captureData, payload) {
  const candidates = buildWindowsPatchedPlaceboCandidates(captureData);

  return candidates.map((candidate) =>
    summarizeCandidateResult(
      candidate,
      tryDecodeAuthCandidate(payload, candidate),
    ),
  );
}

function scanContiguousKeyIvWindows(captureData, payload, options = {}) {
  const rawKey = bufferFromHex(captureData.sessionKeyRawHex);
  const rawIv = bufferFromHex(captureData.sessionIVRawHex);
  const maxExamples = options.maxExamples ?? 8;

  const summary = {
    resultClass: RESULT_DECRYPT_ERROR,
    checked: 0,
    paddingOkCount: 0,
    decodedCount: 0,
    examples: [],
  };

  if (
    !Buffer.isBuffer(rawKey) ||
    !Buffer.isBuffer(rawIv) ||
    rawKey.length < 32 ||
    rawIv.length < 16
  ) {
    summary.error = "capture does not contain raw session key/IV material";
    return summary;
  }

  for (let keyOffset = 0; keyOffset <= rawKey.length - 32; keyOffset += 1) {
    const key = rawKey.subarray(keyOffset, keyOffset + 32);
    for (let ivOffset = 0; ivOffset <= rawIv.length - 16; ivOffset += 1) {
      const iv = rawIv.subarray(ivOffset, ivOffset + 16);
      const candidate = {
        label: `window:${keyOffset}/${ivOffset}`,
        group: "exhaustive",
        key,
        iv,
      };
      const result = tryDecodeAuthCandidate(payload, candidate);
      summary.checked += 1;

      if (result.resultClass === RESULT_DECRYPT_ERROR) {
        continue;
      }

      summary.paddingOkCount += 1;
      if (result.resultClass === RESULT_DECODED_WAIT_AUTH) {
        summary.decodedCount += 1;
      }

      if (summary.examples.length < maxExamples) {
        summary.examples.push({
          keyOffset,
          ivOffset,
          ...summarizeCandidateResult(candidate, result),
        });
      }
    }
  }

  if (summary.decodedCount > 0) {
    summary.resultClass = RESULT_DECODED_WAIT_AUTH;
  } else if (summary.paddingOkCount > 0) {
    summary.resultClass = RESULT_PADDING_OK_DECODE_FAIL;
  }

  return summary;
}

function buildCaptureAnalysis(capture, options = {}) {
  const payload = bufferFromHex(capture.data.payloadHex);
  if (!Buffer.isBuffer(payload)) {
    throw new Error(`Capture is missing payloadHex: ${capture.path || "(memory)"}`);
  }

  const plaintext = evaluatePlaintextPayload(payload);
  const candidateResults = buildCandidateResults(capture.data, payload);
  const currentCandidates = candidateResults.filter(
    (result) => result.group === "default" || result.group === "current",
  );
  const hashReductions = candidateResults.filter(
    (result) => result.group === "hash",
  );
  const lowCostResultClass = classifyResults([
    plaintext,
    ...candidateResults,
  ]);
  const exhaustiveScan =
    options.exhaustive === false
      ? null
      : scanContiguousKeyIvWindows(capture.data, payload, options);
  const overallResultClass =
    exhaustiveScan?.resultClass === RESULT_DECODED_WAIT_AUTH
      ? RESULT_DECODED_WAIT_AUTH
      : lowCostResultClass;
  const inference = inferCapturePath(
    capture.data,
    payload.length,
    lowCostResultClass,
  );

  return {
    path: capture.path || null,
    captureKind: capture.data.captureKind || null,
    state: capture.data.state || null,
    keyVersion: capture.data.keyVersion || null,
    clientBuild: capture.data.clientBuild || null,
    clientVersion: capture.data.clientVersion || null,
    clientProjectVersion: capture.data.clientProjectVersion || null,
    payloadLength: payload.length,
    payloadSha256: sha256Hex(payload),
    sessionKeyRawLength: capture.data.sessionKeyRawLength || 0,
    sessionIVRawLength: capture.data.sessionIVRawLength || 0,
    vipKeyLength: capture.data.vipKeyLength || 0,
    lowCostResultClass,
    overallResultClass,
    inference,
    plaintext,
    currentCandidates,
    hashReductions,
    exhaustiveScan,
  };
}

function formatCandidateLine(candidate) {
  const parts = [
    `${candidate.label}: ${candidate.resultClass}`,
  ];
  if (candidate.authShape !== undefined) {
    parts.push(`authShape=${candidate.authShape ? "yes" : "no"}`);
  }
  if (candidate.decryptedLength) {
    parts.push(`plainLen=${candidate.decryptedLength}`);
  }
  if (candidate.error) {
    parts.push(`error=${candidate.error}`);
  }
  return `    - ${parts.join(" ")}`;
}

function printAnalysisText(analyses) {
  console.log(`WAIT_AUTH analyzer: ${analyses.length} capture(s)`);
  console.log("");

  for (const analysis of analyses) {
    console.log(analysis.path || "(memory capture)");
    console.log(
      `  result: low-cost=${analysis.lowCostResultClass} overall=${analysis.overallResultClass}`,
    );
    console.log(
      `  capture: kind=${analysis.captureKind || "(unknown)"} state=${analysis.state || "(unknown)"} keyVersion=${analysis.keyVersion || "(unknown)"} build=${analysis.clientBuild || "(unknown)"}`,
    );
    console.log(
      `  payload: ${analysis.payloadLength}B sha256=${analysis.payloadSha256}`,
    );
    console.log(
      `  material: rawKey=${analysis.sessionKeyRawLength}B rawIV=${analysis.sessionIVRawLength}B vipKey=${analysis.vipKeyLength}B`,
    );
    console.log(`  inference: ${analysis.inference.label} (${analysis.inference.detail})`);
    console.log(formatCandidateLine(analysis.plaintext));
    console.log("  current AES candidates:");
    for (const candidate of analysis.currentCandidates) {
      console.log(formatCandidateLine(candidate));
    }
    console.log("  hash reductions:");
    for (const candidate of analysis.hashReductions) {
      console.log(formatCandidateLine(candidate));
    }
    if (analysis.exhaustiveScan) {
      const scan = analysis.exhaustiveScan;
      console.log(
        `  exhaustive contiguous scan: ${scan.resultClass} checked=${scan.checked} paddingOk=${scan.paddingOkCount} decoded=${scan.decodedCount}`,
      );
      for (const example of scan.examples) {
        console.log(
          `    - keyOffset=${example.keyOffset} ivOffset=${example.ivOffset} ${example.resultClass}${example.authShape !== undefined ? ` authShape=${example.authShape ? "yes" : "no"}` : ""}${example.error ? ` error=${example.error}` : ""}`,
        );
      }
    }
    console.log("");
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const captures = expandCapturePaths(options.paths).map(readCapture);
  const analyses = captures.map((capture) => buildCaptureAnalysis(capture, options));

  if (options.json) {
    console.log(JSON.stringify(analyses, null, 2));
  } else {
    printAnalysisText(analyses);
  }

  return analyses;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[wait-auth-analyzer] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  RESULT_DECRYPT_ERROR,
  RESULT_PADDING_OK_DECODE_FAIL,
  RESULT_DECODED_WAIT_AUTH,
  INFERENCE_DECODED_WAIT_AUTH,
  INFERENCE_LIKELY_CRYPTOAPI_WRAPPED_MATERIAL,
  INFERENCE_PLAUSIBLE_KEY_WRONG_FRAMING,
  INFERENCE_UNKNOWN,
  buildCaptureAnalysis,
  classifyResults,
  evaluatePlaintextPayload,
  expandCapturePaths,
  main,
  scanContiguousKeyIvWindows,
};
