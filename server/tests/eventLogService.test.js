const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const EventLogService = require(path.join(
  repoRoot,
  "server/src/services/logging/eventLogService",
));
const rotatingLog = require(path.join(repoRoot, "server/src/utils/rotatingLog"));

function readLastJsonLine(filePath) {
  const content = fs.readFileSync(filePath, "utf8").trim();
  const lines = content.split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

test("eventLog captures LogClientEvent payloads to the client-events log", async () => {
  const service = new EventLogService();
  const logPath = EventLogService.__testHooks.CLIENT_EVENTS_LOG_PATH;
  const beforeSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;

  const result = service.Handle_LogClientEvent(
    [
      "structureDeployment",
      ["event", "itemID", "detail"],
      "anchor_failed",
      2990007245,
      { detail: "client traceback", big: 10n },
    ],
    {
      clientID: 11065450,
      userid: 11,
      characterID: 140000238,
      solarsystemid2: 30000144,
      shipID: 2990007244,
    },
  );
  assert.equal(result, null);

  await new Promise((resolve) => setImmediate(resolve));
  rotatingLog.closeAll();

  assert.equal(fs.existsSync(logPath), true);
  assert.ok(
    fs.statSync(logPath).size > beforeSize,
    "Expected LogClientEvent to append a client-events log line",
  );
  const line = readLastJsonLine(logPath);
  assert.equal(line.category, "structureDeployment");
  assert.equal(line.eventName, "anchor_failed");
  assert.equal(line.session.characterID, 140000238);
  assert.equal(line.values[1].big, "10");
});
