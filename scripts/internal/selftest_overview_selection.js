const assert = require("assert");
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");

const ConfigService = require(path.join(
  projectRoot,
  "server",
  "src",
  "services",
  "config",
  "configService",
));
const BountyProxyService = require(path.join(
  projectRoot,
  "server",
  "src",
  "services",
  "bounty",
  "bountyProxyService",
));

function indexRowsById(tupleSet) {
  assert(Array.isArray(tupleSet), "GetMultiOwnersEx should return a tuple-set array");
  assert.strictEqual(tupleSet.length, 2, "Tuple-set should contain header and rows");
  const rows = tupleSet[1];
  assert(Array.isArray(rows), "Tuple-set rows should be an array");
  return new Map(rows.map((row) => [Number(row[0]), row]));
}

function keyValToObject(keyVal) {
  assert(keyVal && keyVal.type === "object", "Expected util.KeyVal object");
  assert.strictEqual(keyVal.name, "util.KeyVal", "Expected util.KeyVal object");
  assert(keyVal.args && keyVal.args.type === "dict", "Expected KeyVal dict args");
  return Object.fromEntries(keyVal.args.entries || []);
}

function extractListPayload(value, message) {
  assert(value && value.type === "list", message || "Expected marshal list payload");
  assert(Array.isArray(value.items), "Expected marshal list items array");
  return value.items;
}

function run() {
  const configService = new ConfigService();
  const bountyProxyService = new BountyProxyService();
  const fakeSession = {
    charid: 140000002,
    characterID: 140000002,
    solarsystemid2: 30000142,
    solarSystemID2: 30000142,
  };

  const ownerRows = indexRowsById(
    configService.Handle_GetMultiOwnersEx([[140000002, 140000102]], fakeSession),
  );

  const characterRow = ownerRows.get(140000002);
  assert(characterRow, "Character owner row missing");
  assert.strictEqual(characterRow[1], "johnny", "Character ownerName mismatch");
  assert.strictEqual(characterRow[2], 1380, "Character typeID mismatch");

  const shipRow = ownerRows.get(140000102);
  assert(shipRow, "Ship item owner row missing");
  assert.strictEqual(shipRow[1], "Velator", "Ship ownerName should match ship item");
  assert.strictEqual(shipRow[2], 606, "Ship owner typeID should match ship type");
  assert.notStrictEqual(
    shipRow[2],
    1,
    "Ship owner typeID must not fall back to placeholder typeID=1",
  );
  assert.notStrictEqual(
    shipRow[1],
    "Entity 140000102",
    "Ship ownerName must not fall back to placeholder entity name",
  );

  const bountyEntries = extractListPayload(
    bountyProxyService.Handle_GetBounties([
      [0, 140000002, 1000044],
    ]),
    "GetBounties should return a marshal list",
  );
  assert.strictEqual(
    bountyEntries.length,
    3,
    "GetBounties should seed zero-bounty rows for every requested ID",
  );
  for (const [targetID, bountyKeyVal] of bountyEntries) {
    const bounty = keyValToObject(bountyKeyVal);
    assert.strictEqual(
      Number(targetID),
      Number(bounty.targetID),
      "Bounty targetID should match pair key",
    );
    assert.strictEqual(Number(bounty.bounty), 0, "Seeded bounty should be zero");
  }

  const objectExStyleBounties = extractListPayload(
    bountyProxyService.Handle_GetBounties([
      {
        type: "objectex1",
        header: null,
        list: [0, 140000002, 1000044],
        dict: [],
      },
    ]),
    "GetBounties should accept objectex-style set payloads",
  );
  assert.strictEqual(
    objectExStyleBounties.length,
    3,
    "GetBounties should normalize objectex-style set payloads",
  );

  const opaqueSetFallbackBounties = extractListPayload(
    bountyProxyService.Handle_GetBounties([
      {
        type: "opaque-live-set-shape",
        payload: "unparsed",
      },
    ], fakeSession),
    "GetBounties should fall back to known owner IDs when the live set shape is opaque",
  );
  const fallbackTargetIDs = new Set(
    opaqueSetFallbackBounties.map(([targetID]) => Number(targetID)),
  );
  assert(
    fallbackTargetIDs.has(0),
    "Fallback bounty rows should include ownerID 0",
  );
  assert(
    fallbackTargetIDs.has(140000002),
    "Fallback bounty rows should include the selected player character ownerID",
  );
  assert(
    fallbackTargetIDs.has(1000044),
    "Fallback bounty rows should include the player corporation ownerID",
  );

  const [bountiesAndKillRights, killRights] =
    bountyProxyService.Handle_GetBountiesAndKillRights([
      [0, 140000002, 1000044],
    ], fakeSession);
  const bountyRows = extractListPayload(
    bountiesAndKillRights,
    "GetBountiesAndKillRights bounties should be a marshal list",
  );
  assert.strictEqual(
    bountyRows.length,
    3,
    "GetBountiesAndKillRights should seed zero-bounty rows for every requested ID",
  );
  const killRightsRows = extractListPayload(
    killRights,
    "Kill rights payload should be a marshal list",
  );
  assert.strictEqual(killRightsRows.length, 0, "Kill rights payload should be empty");

  console.log("overview-selection-selftest: ok");
  console.log(
    JSON.stringify(
      {
        beforeSymptom: {
          shipTypeID: 1,
          shipName: "Entity 140000102",
          bounties: [],
        },
        afterResult: {
          shipTypeID: shipRow[2],
          shipName: shipRow[1],
          bountyCount: bountyEntries.length,
          bountyTargetIDs: bountyEntries.map(([targetID]) => Number(targetID)),
          opaqueFallbackIncludes: [0, 140000002, 1000044].every((targetID) =>
            fallbackTargetIDs.has(targetID),
          ),
        },
      },
      null,
      2,
    ),
  );
}

run();
