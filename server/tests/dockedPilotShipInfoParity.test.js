const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

function findDockedCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters table");

  for (const characterID of Object.keys(charactersResult.data || {})
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0)
    .sort((left, right) => left - right)) {
    const characterRecord = getCharacterRecord(characterID);
    const activeShip = getActiveShipRecord(characterID);
    const stationID = Number(
      characterRecord && (characterRecord.stationID || characterRecord.stationid || 0),
    ) || 0;
    if (characterRecord && activeShip && stationID > 0) {
      return {
        characterID,
        stationID,
        shipID: Number(activeShip.itemID) || 0,
      };
    }
  }

  assert.fail("Expected at least one docked character with an active ship");
}

function buildDockedSession(candidate) {
  return {
    clientID: candidate.characterID + 94000,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    locationid: candidate.stationID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    activeShipID: candidate.shipID,
    sendNotification() {},
  };
}

function getKeyValEntry(value, key) {
  if (
    !value ||
    value.type !== "object" ||
    value.name !== "util.KeyVal" ||
    !value.args ||
    value.args.type !== "dict" ||
    !Array.isArray(value.args.entries)
  ) {
    return null;
  }

  const entry = value.args.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : null;
}

function getDictEntryMap(value) {
  if (!value || value.type !== "dict" || !Array.isArray(value.entries)) {
    return new Map();
  }
  return new Map(value.entries);
}

test("docked ship-info GetAllInfo includes the pilot row for client dogma LoadItem", () => {
  const candidate = findDockedCandidate();
  const dogma = new DogmaService();
  const allInfo = dogma.Handle_GetAllInfo(
    [false, true, null],
    buildDockedSession(candidate),
  );
  const shipInfoEntries = getDictEntryMap(getKeyValEntry(allInfo, "shipInfo"));
  const pilotEntry = shipInfoEntries.get(candidate.characterID);

  assert.ok(
    pilotEntry,
    "Expected shipInfo to include the character item row during docked login",
  );

  const pilotFields = new Map(pilotEntry.args.entries);
  const pilotInvItem = pilotFields.get("invItem");
  const pilotRow = new Map(pilotInvItem.args.entries).get("line");
  assert.equal(pilotRow[0], candidate.characterID);
  assert.equal(pilotRow[3], candidate.shipID);
  assert.equal(pilotRow[4], 57);
  assert.equal(pilotRow[6], 1);
  assert.equal(pilotRow[7], 3);
});
