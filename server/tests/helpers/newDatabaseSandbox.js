const fs = require("fs");
const os = require("os");
const path = require("path");

function setupNewDatabaseSandbox(prefix = "evejs-newdb-test-") {
  if (global.__eveJsNewDatabaseSandbox) {
    return global.__eveJsNewDatabaseSandbox;
  }

  const repoRoot = path.join(__dirname, "..", "..", "..");
  const originalDataDir = process.env.EVEJS_NEWDB_DATA_DIR;
  const sourceDataDir = originalDataDir
    ? path.resolve(originalDataDir)
    : path.join(repoRoot, "server/src/newDatabase/data");
  const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  fs.cpSync(sourceDataDir, testDataDir, { recursive: true });
  process.env.EVEJS_NEWDB_DATA_DIR = testDataDir;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;

    try {
      const databasePath = path.join(repoRoot, "server/src/newDatabase");
      if (require.cache[require.resolve(databasePath)]) {
        require(databasePath).flushAllSync();
      }
    } catch (error) {
      // Best-effort cleanup during process shutdown.
    }

    if (originalDataDir === undefined) {
      delete process.env.EVEJS_NEWDB_DATA_DIR;
    } else {
      process.env.EVEJS_NEWDB_DATA_DIR = originalDataDir;
    }
    fs.rmSync(testDataDir, { recursive: true, force: true });
  };

  process.once("exit", cleanup);

  global.__eveJsNewDatabaseSandbox = {
    dataDir: testDataDir,
    cleanup,
  };
  return global.__eveJsNewDatabaseSandbox;
}

module.exports = {
  setupNewDatabaseSandbox,
};
