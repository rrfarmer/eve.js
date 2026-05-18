const {
  RESULT_DECODED_WAIT_AUTH,
  buildAuthDecryptCandidates,
  tryDecodeAuthCandidate,
} = require("./authDecryptCandidates");

const DIALECT_WINDOWS_PATCHED_PLACEBO = "windows_patched_placebo";
const DIALECT_MAC_STOCK_3323810_OBSERVED = "mac_stock_3323810_observed";

function bufferFromHex(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return Buffer.from(value, "hex");
}

function buildWindowsPatchedPlaceboCandidates(captureData) {
  return buildAuthDecryptCandidates({
    sessionKey: bufferFromHex(captureData.sessionKeyHex),
    sessionIV: bufferFromHex(captureData.sessionIVHex),
    rawKey: bufferFromHex(captureData.sessionKeyRawHex),
    rawIv: bufferFromHex(captureData.sessionIVRawHex),
    vipKey: bufferFromHex(captureData.vipKeyHex),
    includeDefault: true,
    includeHashReductions: true,
  });
}

function decryptWindowsPatchedPlacebo(captureData, payload) {
  const candidates = buildWindowsPatchedPlaceboCandidates(captureData);
  const results = candidates.map((candidate) => ({
    candidate,
    result: tryDecodeAuthCandidate(payload, candidate),
  }));
  const decoded = results.find(
    (entry) => entry.result.resultClass === RESULT_DECODED_WAIT_AUTH,
  );

  return {
    dialect: DIALECT_WINDOWS_PATCHED_PLACEBO,
    decoded: decoded || null,
    results,
  };
}

function decryptMacStock3323810Observed() {
  throw new Error("mac stock auth dialect not yet identified");
}

function decryptWaitAuthWithDialect(captureData, payload, dialectName) {
  switch (dialectName) {
    case DIALECT_WINDOWS_PATCHED_PLACEBO:
      return decryptWindowsPatchedPlacebo(captureData, payload);
    case DIALECT_MAC_STOCK_3323810_OBSERVED:
      return decryptMacStock3323810Observed(captureData, payload);
    default:
      throw new Error(`unknown auth dialect: ${dialectName}`);
  }
}

module.exports = {
  DIALECT_WINDOWS_PATCHED_PLACEBO,
  DIALECT_MAC_STOCK_3323810_OBSERVED,
  buildWindowsPatchedPlaceboCandidates,
  decryptWaitAuthWithDialect,
  decryptWindowsPatchedPlacebo,
  decryptMacStock3323810Observed,
};
