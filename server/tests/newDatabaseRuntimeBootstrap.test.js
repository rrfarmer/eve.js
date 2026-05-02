const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const {
  buildRuntimeTableDefault,
} = require(path.join(repoRoot, "server/src/newDatabase/runtimeTableDefaults"));

function makeTempDataDir() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "evejs-newdb-runtime-")),
    "data",
  );
}

function runNode(args, env = {}) {
  return childProcess.spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });
}

function readTable(dataDir, tableName) {
  return JSON.parse(
    fs.readFileSync(path.join(dataDir, tableName, "data.json"), "utf8"),
  );
}

test("runtime bootstrap creates selected missing live tables", () => {
  const dataDir = makeTempDataDir();

  try {
    const result = runNode([
      "scripts/DataSync/bootstrap-newdb-runtime-data.js",
      "--apply",
      "--data-dir",
      dataDir,
      "--tables",
      "marketRuntime,characters,corporations",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readTable(dataDir, "marketRuntime").lastProcessedExpiryEventId, "0");
    assert.deepEqual(readTable(dataDir, "characters"), {});
    assert.deepEqual(
      readTable(dataDir, "corporations")._meta,
      buildRuntimeTableDefault("corporations")._meta,
    );
    assert.equal(
      fs.existsSync(path.join(dataDir, "agentAuthority", "data.json")),
      false,
    );
    assert.match(result.stdout, /Runtime DB bootstrap apply/);
  } finally {
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  }
});

test("newDatabase creates known runtime tables on first use", () => {
  const dataDir = makeTempDataDir();

  try {
    const script = `
const fs = require("fs");
const path = require("path");
const db = require("./server/src/newDatabase");
const readResult = db.read("marketRuntime", "/");
const writeResult = db.write("marketEscrow", "/orders/test", { itemID: 34 });
const flushResult = db.flushTableSync("marketEscrow");
const output = {
  readResult,
  writeResult,
  flushResult,
  marketRuntimeExists: fs.existsSync(path.join(process.env.EVEJS_NEWDB_DATA_DIR, "marketRuntime", "data.json")),
  marketEscrowExists: fs.existsSync(path.join(process.env.EVEJS_NEWDB_DATA_DIR, "marketEscrow", "data.json")),
};
process.stdout.write(JSON.stringify(output));
`;
    const result = runNode(["-e", script], {
      EVEJS_NEWDB_DATA_DIR: dataDir,
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.readResult.success, true);
    assert.equal(output.readResult.data.lastProcessedExpiryEventId, "0");
    assert.equal(output.writeResult.success, true);
    assert.equal(output.flushResult.success, true);
    assert.equal(output.marketRuntimeExists, true);
    assert.equal(output.marketEscrowExists, true);
    assert.doesNotMatch(result.stderr, /marketRuntime.*not found/i);
  } finally {
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  }
});

test("newDatabase uses runtime defaults when table directory exists without data file", () => {
  const dataDir = makeTempDataDir();

  try {
    fs.mkdirSync(path.join(dataDir, "marketRuntime"), { recursive: true });
    const script = `
const db = require("./server/src/newDatabase");
const result = db.read("marketRuntime", "/");
process.stdout.write(JSON.stringify(result));
`;
    const result = runNode(["-e", script], {
      EVEJS_NEWDB_DATA_DIR: dataDir,
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.success, true);
    assert.equal(output.data.lastProcessedExpiryEventId, "0");
    assert.deepEqual(readTable(dataDir, "marketRuntime"), {
      lastProcessedExpiryEventId: "0",
    });
  } finally {
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  }
});
