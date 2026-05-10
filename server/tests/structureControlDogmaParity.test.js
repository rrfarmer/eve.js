const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

process.env.EVEJS_SKIP_NPC_STARTUP = "1";

const repoRoot = path.join(__dirname, "..", "..");
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const worldData = require(path.join(
  repoRoot,
  "server/src/space/worldData",
));
const {
  buildStructureInventoryDogmaItem,
  getStructureParentLocationID,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureDogmaPrime",
));

const originalGetStructureByID = worldData.getStructureByID;

function buildControlledStructureSession() {
  return {
    clientID: 92002,
    userid: 1,
    characterID: 140000002,
    charid: 140000002,
    shipID: 1030000000000,
    shipid: 1030000000000,
    activeShipID: 990112614,
    structureID: 1030000000000,
    structureid: 1030000000000,
    locationid: 1030000000000,
    solarsystemid: 30002187,
    solarsystemid2: 30002187,
    sendNotification() {},
  };
}

function buildControlledStructureRecord() {
  return {
    structureID: 1030000000000,
    typeID: 35832,
    ownerCorpID: 1000044,
    ownerID: 1000044,
    solarSystemID: 30002187,
    itemName: "TestAstrahus",
    radius: 16000,
    shieldCapacity: 240000,
    armorHP: 180000,
    hullHP: 180000,
    conditionState: {
      shieldCharge: 1,
      armorDamage: 0,
      damage: 0,
      charge: 1,
    },
  };
}

function buildDockedShipRecord() {
  return {
    itemID: 990112614,
    typeID: 606,
    ownerID: 140000002,
    locationID: 1030000000000,
    flagID: 4,
    groupID: 25,
    categoryID: 6,
    quantity: -1,
    singleton: 1,
    stacksize: 1,
    conditionState: {
      shieldCharge: 1,
      armorDamage: 0,
      damage: 0,
      charge: 1,
    },
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

test.afterEach(() => {
  worldData.getStructureByID = originalGetStructureByID;
});

test("structure dogma prime rows parent the structure to the solar system", () => {
  const structure = buildControlledStructureRecord();
  const invItem = buildStructureInventoryDogmaItem(structure);

  assert.equal(invItem.itemID, structure.structureID);
  assert.equal(invItem.locationID, structure.solarSystemID);
  assert.notEqual(invItem.locationID, structure.structureID);
  assert.equal(
    getStructureParentLocationID({
      ...structure,
      solarSystemID: null,
      locationID: structure.structureID,
    }, 30000142),
    30000142,
  );
});

test("dogma GetAllInfo primes the controlled structure as the active ship", () => {
  const session = buildControlledStructureSession();
  const structure = buildControlledStructureRecord();
  const dogma = new DogmaService();

  dogma._getCharacterRecord = () => ({
    characterID: session.characterID,
    charID: session.characterID,
    securityStatus: 0,
    characterAttributes: {},
  });
  dogma._getActiveShipRecord = () => buildDockedShipRecord();
  worldData.getStructureByID = (structureID) => {
    assert.equal(Number(structureID), structure.structureID);
    return structure;
  };

  const allInfo = dogma.Handle_GetAllInfo([false, true, true], session);

  assert.equal(getKeyValEntry(allInfo, "activeShipID"), structure.structureID);

  const shipInfo = getKeyValEntry(allInfo, "shipInfo");
  const shipInfoEntries = getDictEntryMap(shipInfo);
  assert.equal(shipInfoEntries.has(structure.structureID), true);
  assert.equal(shipInfoEntries.has(990112614), false);

  const structureShipInfo = shipInfoEntries.get(structure.structureID);
  const structureShipFields = new Map(structureShipInfo.args.entries);
  const structureInvItem = structureShipFields.get("invItem");
  const structureInvRow = new Map(structureInvItem.args.entries).get("line");
  assert.equal(structureInvRow[2], structure.ownerCorpID);
  assert.equal(
    structureInvRow[3],
    structure.solarSystemID,
    "Expected the controlled structure item to be parented to its solar system",
  );
  assert.notEqual(structureInvRow[3], structure.structureID);
  assert.equal(structureInvRow[6], 1657);
  assert.equal(structureInvRow[7], 65);
  const attributeEntries = getDictEntryMap(structureShipFields.get("attributes"));
  assert.equal(attributeEntries.has(2216), true);
  assert.equal(attributeEntries.get(1175), 0);
  assert.equal(attributeEntries.get(1176), 0);
  assert.equal(attributeEntries.get(1177), 0);
  assert.equal(attributeEntries.get(1224), 1);
  assert.equal(attributeEntries.get(3101), 56201);

  const shipState = getKeyValEntry(allInfo, "shipState");
  assert.ok(Array.isArray(shipState), "Expected shipState tuple payload");
  const shipStateEntries = getDictEntryMap(shipState[0]);
  assert.equal(shipStateEntries.has(structure.structureID), true);
});

test("dogma ShipGetInfo and ItemGetInfo resolve the controlled structure", () => {
  const session = buildControlledStructureSession();
  const structure = buildControlledStructureRecord();
  const dogma = new DogmaService();

  dogma._getCharacterRecord = () => ({
    characterID: session.characterID,
    charID: session.characterID,
    securityStatus: 0,
    characterAttributes: {},
  });
  dogma._getActiveShipRecord = () => buildDockedShipRecord();
  worldData.getStructureByID = () => structure;

  const shipInfo = dogma.Handle_ShipGetInfo([], session);
  const shipInfoEntries = getDictEntryMap(shipInfo);
  assert.equal(shipInfoEntries.has(structure.structureID), true);

  const itemInfo = dogma.Handle_ItemGetInfo([structure.structureID], session);
  const itemInfoFields = new Map(itemInfo.args.entries);
  assert.equal(itemInfoFields.get("itemID"), structure.structureID);
  const itemInfoRow = new Map(itemInfoFields.get("invItem").args.entries).get("line");
  assert.equal(
    itemInfoRow[0],
    structure.structureID,
  );
  assert.equal(itemInfoRow[3], structure.solarSystemID);
  const itemInfoAttributes = getDictEntryMap(itemInfoFields.get("attributes"));
  assert.equal(itemInfoAttributes.get(1177), 0);
  assert.equal(itemInfoAttributes.get(3101), 56201);
});

test("dogma GetAllInfo does not flush deferred docked fitting replay while controlling a structure", () => {
  const session = buildControlledStructureSession();
  const dogma = new DogmaService();

  session._deferredDockedFittingReplay = {
    shipID: 990112614,
    selfFlushTimer: setTimeout(() => {}, 60_000),
  };

  dogma.afterCallResponse("GetAllInfo", session);

  assert.ok(session._deferredDockedFittingReplay);
  clearTimeout(session._deferredDockedFittingReplay.selfFlushTimer);
  session._deferredDockedFittingReplay = null;
});
