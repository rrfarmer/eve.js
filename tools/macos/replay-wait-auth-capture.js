#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  RESULT_DECODED_WAIT_AUTH,
  RESULT_DECRYPT_ERROR,
  RESULT_PADDING_OK_DECODE_FAIL,
  buildCaptureAnalysis,
} = require(path.join(repoRoot, "tools/macos/analyze-wait-auth-capture"));
const {
  DIALECT_MAC_STOCK_3323810_OBSERVED,
  DIALECT_WINDOWS_PATCHED_PLACEBO,
  decryptWaitAuthWithDialect,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/authDialects",
));

function usage() {
  console.error(
    [
      "Usage: node tools/macos/replay-wait-auth-capture.js [options] <capture.json>",
      "",
      "Options:",
      `  --dialect <name>   ${DIALECT_WINDOWS_PATCHED_PLACEBO} or ${DIALECT_MAC_STOCK_3323810_OBSERVED}`,
      "                     Default: windows_patched_placebo.",
      "  --json             Print JSON.",
      "  --help             Show this help.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    dialect: DIALECT_WINDOWS_PATCHED_PLACEBO,
    json: false,
    path: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dialect") {
      options.dialect = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--dialect=")) {
      options.dialect = arg.slice("--dialect=".length);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (!options.path) {
      options.path = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.path) {
    throw new Error("missing capture path");
  }

  return options;
}

function bufferFromCaptureHex(captureData, fieldName) {
  const value = captureData[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`capture is missing ${fieldName}`);
  }
  return Buffer.from(value, "hex");
}

function readCapture(filePath) {
  const absolutePath = path.resolve(filePath);
  return {
    path: absolutePath,
    data: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
  };
}

function resultClassFromDialectReplay(replay) {
  if (replay.decoded) {
    return RESULT_DECODED_WAIT_AUTH;
  }
  if (
    replay.results.some(
      (entry) => entry.result.resultClass === RESULT_PADDING_OK_DECODE_FAIL,
    )
  ) {
    return RESULT_PADDING_OK_DECODE_FAIL;
  }
  return RESULT_DECRYPT_ERROR;
}

function buildReplay(capture, options = {}) {
  const payload = bufferFromCaptureHex(capture.data, "payloadHex");
  const rawKey = bufferFromCaptureHex(capture.data, "sessionKeyRawHex");
  const rawIv = bufferFromCaptureHex(capture.data, "sessionIVRawHex");
  const analysis = buildCaptureAnalysis(capture, { exhaustive: false });
  const dialect = options.dialect || DIALECT_WINDOWS_PATCHED_PLACEBO;
  let dialectReplay = null;
  let dialectError = null;

  try {
    dialectReplay = decryptWaitAuthWithDialect(capture.data, payload, dialect);
  } catch (error) {
    dialectError = error;
  }

  const dialectResultClass = dialectReplay
    ? resultClassFromDialectReplay(dialectReplay)
    : RESULT_DECRYPT_ERROR;

  return {
    path: capture.path || null,
    dialect,
    captureKind: capture.data.captureKind || null,
    state: capture.data.state || null,
    keyVersion: capture.data.keyVersion || null,
    clientBuild: capture.data.clientBuild || null,
    payloadLength: payload.length,
    rawKeyLength: rawKey.length,
    rawIvLength: rawIv.length,
    lowCostResultClass: analysis.lowCostResultClass,
    dialectResultClass,
    inference: analysis.inference,
    candidateCount: dialectReplay ? dialectReplay.results.length : 0,
    decodedCandidate: dialectReplay?.decoded?.candidate?.label || null,
    dialectError: dialectError ? dialectError.message : null,
  };
}

function printReplayText(replay) {
  console.log(replay.path || "(memory capture)");
  console.log(
    `  capture: kind=${replay.captureKind || "(unknown)"} state=${replay.state || "(unknown)"} keyVersion=${replay.keyVersion || "(unknown)"} build=${replay.clientBuild || "(unknown)"}`,
  );
  console.log(
    `  material: rawKey=${replay.rawKeyLength}B rawIV=${replay.rawIvLength}B payload=${replay.payloadLength}B`,
  );
  console.log(`  dialect: ${replay.dialect}`);
  console.log(`  low-cost result: ${replay.lowCostResultClass}`);
  console.log(`  dialect result:  ${replay.dialectResultClass}`);
  if (replay.inference) {
    console.log(
      `  inference: ${replay.inference.label} (${replay.inference.detail})`,
    );
  }
  if (replay.decodedCandidate) {
    console.log(`  decoded candidate: ${replay.decodedCandidate}`);
  }
  if (replay.dialectError) {
    console.log(`  dialect error: ${replay.dialectError}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const capture = readCapture(options.path);
  const replay = buildReplay(capture, options);

  if (options.json) {
    console.log(JSON.stringify(replay, null, 2));
  } else {
    printReplayText(replay);
  }

  return replay;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[wait-auth-replay] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildReplay,
  main,
};
