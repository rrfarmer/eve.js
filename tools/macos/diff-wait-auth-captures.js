#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function usage() {
  console.error(
    "Usage: node tools/macos/diff-wait-auth-captures.js <capture-a.json> <capture-b.json>",
  );
  process.exit(1);
}

function loadCapture(filePath) {
  const absolutePath = path.resolve(filePath);
  return {
    path: absolutePath,
    data: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
  };
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value === null || value === undefined || value === "") {
    return "(none)";
  }
  return String(value);
}

function firstDiffByteIndex(hexA, hexB) {
  if (!hexA || !hexB) {
    return null;
  }
  const a = Buffer.from(hexA, "hex");
  const b = Buffer.from(hexB, "hex");
  const limit = Math.min(a.length, b.length);
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) {
      return index;
    }
  }
  if (a.length !== b.length) {
    return limit;
  }
  return null;
}

if (process.argv.length !== 4) {
  usage();
}

const [captureA, captureB] = process.argv.slice(2).map(loadCapture);
const compareKeys = [
  "captureKind",
  "clientVersion",
  "clientBuild",
  "clientProjectVersion",
  "keyVersion",
  "decryptCandidate",
  "payloadLength",
  "payloadSha256",
  "decodedSummary",
  "authTupleLength",
  "authChallengeLength",
  "authChallengeSha256",
  "authDictEntryCount",
  "authKeys",
  "authUserName",
  "authUserLanguageId",
  "authPasswordHashLength",
  "authPasswordHashSha256",
  "sessionKeyRawLength",
  "sessionIVRawLength",
  "plaintextHandshakePackets",
];

console.log(`A: ${captureA.path}`);
console.log(`B: ${captureB.path}`);
console.log("");

for (const key of compareKeys) {
  const left = captureA.data[key];
  const right = captureB.data[key];
  const same = JSON.stringify(left) === JSON.stringify(right);
  console.log(`${same ? "==" : "!="} ${key}`);
  console.log(`   A: ${formatValue(left)}`);
  console.log(`   B: ${formatValue(right)}`);
}

const payloadDiff = firstDiffByteIndex(
  captureA.data.payloadHex,
  captureB.data.payloadHex,
);
if (payloadDiff !== null) {
  console.log("");
  console.log(`payloadHex first differing byte: ${payloadDiff}`);
}
