const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const PlanetMgrService = require(path.join(
  repoRoot,
  "server/src/services/planet/planetMgrService",
));

test("planetMgr returns an empty list shape when the character has no colonies", () => {
  const result =
    PlanetMgrService._testing.buildPlanetListForCharacter({});

  assert.deepEqual(result, {
    type: "list",
    items: [],
  });
});

test("planetMgr builds planet rows from colony-style character data", () => {
  const result = PlanetMgrService._testing.buildPlanetListForCharacter({
    colonies: [
      {
        planetID: 40000002,
        commandCenterLevel: 4,
        pinCount: 12,
      },
    ],
  });

  assert.equal(result.type, "list");
  assert.equal(result.items.length, 1);

  const row = result.items[0];
  assert.equal(row.name, "util.KeyVal");
  const entries = new Map(row.args.entries);

  assert.equal(entries.get("planetID"), 40000002);
  assert.equal(entries.get("solarSystemID"), 30000001);
  assert.equal(entries.get("typeID"), 11);
  assert.equal(entries.get("numberOfPins"), 12);
  assert.equal(entries.get("celestialIndex"), 1);
  assert.equal(entries.get("commandCenterLevel"), 4);
});
