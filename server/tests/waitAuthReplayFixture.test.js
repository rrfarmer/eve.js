const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  INFERENCE_LIKELY_CRYPTOAPI_WRAPPED_MATERIAL,
  RESULT_DECRYPT_ERROR,
} = require(path.join(repoRoot, "tools/macos/analyze-wait-auth-capture"));
const {
  DIALECT_MAC_STOCK_3323810_OBSERVED,
  DIALECT_WINDOWS_PATCHED_PLACEBO,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/authDialects",
));
const { buildReplay } = require(path.join(
  repoRoot,
  "tools/macos/replay-wait-auth-capture",
));

const stockMacFixturePath = path.join(
  repoRoot,
  "server/fixtures/mac-auth/stock-mac-3323810-wait-auth.json",
);

function readFixtureCapture() {
  return {
    path: stockMacFixturePath,
    data: JSON.parse(fs.readFileSync(stockMacFixturePath, "utf8")),
  };
}

if (!fs.existsSync(stockMacFixturePath)) {
  test("stock Mac WAIT_AUTH fixture replay", { skip: "local stock Mac fixture is not present" }, () => {});
} else {
  test("stock Mac WAIT_AUTH fixture replays the current failing baseline", () => {
    const replay = buildReplay(readFixtureCapture(), {
      dialect: DIALECT_WINDOWS_PATCHED_PLACEBO,
    });

    assert.equal(replay.state, "WAIT_AUTH");
    assert.equal(replay.keyVersion, "placebo");
    assert.equal(replay.clientBuild, 3323810);
    assert.equal(replay.rawKeyLength, 512);
    assert.equal(replay.rawIvLength, 512);
    assert.equal(replay.payloadLength, 320);
    assert.equal(replay.lowCostResultClass, RESULT_DECRYPT_ERROR);
    assert.equal(replay.dialectResultClass, RESULT_DECRYPT_ERROR);
    assert.equal(
      replay.inference.label,
      INFERENCE_LIKELY_CRYPTOAPI_WRAPPED_MATERIAL,
    );
    assert.equal(replay.decodedCandidate, null);
    assert.ok(replay.candidateCount > 0);
  });

  test("stock Mac observed dialect remains an explicit placeholder", () => {
    const replay = buildReplay(readFixtureCapture(), {
      dialect: DIALECT_MAC_STOCK_3323810_OBSERVED,
    });

    assert.equal(replay.rawKeyLength, 512);
    assert.equal(replay.rawIvLength, 512);
    assert.equal(replay.payloadLength, 320);
    assert.equal(
      replay.dialectError,
      "mac stock auth dialect not yet identified",
    );
  });
}
