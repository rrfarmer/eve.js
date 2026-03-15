const assert = require("assert");
const path = require("path");

const database = require(path.join(__dirname, "../../server/src/database"));
const destiny = require(path.join(__dirname, "../../server/src/space/destiny"));
const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const { findShipItemById } = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));
const {
  getSkinCatalogEntry,
  getAppliedSkinMaterialSetID,
} = require(path.join(
  __dirname,
  "../../server/src/services/ship/shipCosmeticsState",
));

function pickCandidateShipRecord() {
  const result = database.read("shipCosmetics", "/");
  assert(result && result.success, "Failed to read shipCosmetics runtime data");

  const shipRecords = Object.values(
    result.data && result.data.ships && typeof result.data.ships === "object"
      ? result.data.ships
      : {},
  );

  for (const record of shipRecords) {
    const shipID = Number(record && record.shipID) || 0;
    const skinID = Number(record && record.skinID) || 0;
    if (!shipID || !skinID) {
      continue;
    }

    const shipItem = findShipItemById(shipID);
    const skinEntry = getSkinCatalogEntry(skinID);
    const expectedMaterialSetID =
      Number(
        skinEntry &&
          skinEntry.material &&
          skinEntry.material.materialSetID,
      ) || null;
    if (!shipItem || !skinEntry || !expectedMaterialSetID) {
      continue;
    }

    return {
      shipID,
      skinID,
      shipItem,
      expectedMaterialSetID,
    };
  }

  return null;
}

function getDictValue(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return undefined;
  }

  const match = dict.entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

function main() {
  const candidate = pickCandidateShipRecord();
  assert(candidate, "No applied ship skin with a resolvable catalog material set was found");

  const resolvedMaterialSetID = getAppliedSkinMaterialSetID(candidate.shipID);
  assert.strictEqual(
    resolvedMaterialSetID,
    candidate.expectedMaterialSetID,
    "Applied skin materialSetID should resolve from runtime skin state",
  );

  const entity = runtime._testing.buildShipEntityForTesting(
    {
      characterID: candidate.shipItem.ownerID || 0,
      shipName: candidate.shipItem.itemName || "Ship Skin Probe",
      corporationID: 0,
      allianceID: 0,
      warFactionID: 0,
    },
    candidate.shipItem,
    Number(candidate.shipItem.spaceState && candidate.shipItem.spaceState.systemID) || 30000142,
  );
  assert(entity, "Ship entity build failed");
  assert.strictEqual(
    entity.skinMaterialSetID,
    candidate.expectedMaterialSetID,
    "Ship entity should carry the applied skin materialSetID",
  );

  const slim = destiny.buildSlimItemDict(entity);
  assert.strictEqual(
    getDictValue(slim, "skinMaterialSetID"),
    candidate.expectedMaterialSetID,
    "Ship slim should expose the applied skin materialSetID",
  );

  console.log(JSON.stringify({
    ok: true,
    shipID: candidate.shipID,
    skinID: candidate.skinID,
    materialSetID: candidate.expectedMaterialSetID,
    slimKeys: slim.entries.map(([key]) => key),
  }, null, 2));
}

main();
