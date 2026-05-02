const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const {
  SdeContext,
  buildTables,
  decodeSdePairs,
  parseArgs,
  romanNumeral,
  runSync,
} = require(path.join(repoRoot, "scripts/DataSync/sync-jsonl-local-static-data"));

function writeJsonl(sourceDir, name, rows) {
  fs.writeFileSync(
    path.join(sourceDir, `${name}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
}

function createMinimalSource() {
  const sourceDir = fs.mkdtempSync(path.join(repoRoot, "target", "datasync-sde-"));
  writeJsonl(sourceDir, "_sde", [
    { _key: "sde", buildNumber: 123456, releaseDate: "2026-04-30T00:00:00Z" },
  ]);
  writeJsonl(sourceDir, "categories", [
    { _key: 16, name: { en: "Skill" }, published: true },
  ]);
  writeJsonl(sourceDir, "groups", [
    { _key: 275, categoryID: 16, name: { en: "Navigation" }, published: true },
  ]);
  writeJsonl(sourceDir, "types", [
    { _key: 3452, groupID: 275, name: { en: "Acceleration Control" }, published: true },
  ]);
  writeJsonl(sourceDir, "certificates", [
    {
      _key: 50,
      groupID: 275,
      name: { en: "Small Energy Turret" },
      description: { en: "Certificate description" },
      recommendedFor: [582, 583, 582],
      skillTypes: [
        {
          _key: 3452,
          basic: 1,
          standard: 2,
          improved: 3,
          advanced: 4,
          elite: 5,
        },
      ],
    },
  ]);
  writeJsonl(sourceDir, "mapRegions", [
    { _key: 10000001, name: { en: "Derelik" } },
  ]);
  writeJsonl(sourceDir, "mapConstellations", [
    { _key: 20000001, regionID: 10000001, name: { en: "San Matar" } },
  ]);
  return sourceDir;
}

test("SDE pair and roman numeral helpers normalize official JSONL conventions", () => {
  assert.deepEqual(
    decodeSdePairs(
      [
        { _key: 3300, _value: 4 },
        { _key: "bad", _value: 1 },
      ],
      "typeID",
      "level",
    ),
    [{ typeID: 3300, level: 4 }],
  );
  assert.equal(romanNumeral(1), "I");
  assert.equal(romanNumeral(9), "IX");
  assert.equal(romanNumeral(14), "XIV");
});

test("generated certificate and map-name tables preserve localized English authority", async () => {
  const sourceDir = createMinimalSource();
  try {
    const ctx = new SdeContext(sourceDir);
    await ctx.validate();

    const outputs = await buildTables(ctx, ["certificates", "mapNames"]);
    const certificate = outputs.certificates.certificatesByID["50"];

    assert.equal(outputs.certificates.source.buildNumber, 123456);
    assert.equal(certificate.groupName, "Navigation");
    assert.equal(certificate.name, "Small Energy Turret");
    assert.deepEqual(certificate.recommendedFor, [582, 583]);
    assert.equal(certificate.requirementsBySkillTypeID["3452"]["5"], 5);
    assert.equal(outputs.mapNames.regionsByID["10000001"], "Derelik");
    assert.equal(
      outputs.mapNames.constellationsByID["20000001"].constellationName,
      "San Matar",
    );
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("dry-run summarizes generated outputs without writing project data", async () => {
  const sourceDir = createMinimalSource();
  try {
    const beforeExists = fs.existsSync(
      path.join(repoRoot, "server/src/newDatabase/data/certificates/data.json"),
    );

    const summary = await runSync({
      sourceDir,
      dryRun: true,
      apply: false,
      download: false,
      tables: ["certificates"],
    });

    assert.equal(summary.mode, "dry-run");
    assert.equal(summary.buildNumber, 123456);
    assert.deepEqual(summary.changedTables, ["certificates"]);
    assert.equal(
      fs.existsSync(path.join(repoRoot, "server/src/newDatabase/data/certificates/data.json")),
      beforeExists,
    );
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("parseArgs reconstructs npm config forwarding on Windows", () => {
  const previous = {
    npm_config_source: process.env.npm_config_source,
    npm_config_tables: process.env.npm_config_tables,
    npm_config_dry_run: process.env.npm_config_dry_run,
  };
  process.env.npm_config_source = "true";
  process.env.npm_config_tables = "true";
  process.env.npm_config_dry_run = "true";
  try {
    const options = parseArgs(["tools/DataSync/source_json", "certificates mapNames"]);
    assert.equal(options.dryRun, true);
    assert.equal(options.apply, false);
    assert.equal(options.sourceDir, path.join(repoRoot, "tools", "DataSync", "source_json"));
    assert.deepEqual(options.tables, ["certificates", "mapNames"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
