const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { setupNewDatabaseSandbox } = require("./helpers/newDatabaseSandbox");
setupNewDatabaseSandbox("evejs-structure-core-db-");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  STRUCTURE_STATE,
  STRUCTURE_UPKEEP_STATE,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureConstants",
));
const {
  STRUCTURE_AMMO_FLAG,
  STRUCTURE_DEED_FLAG,
  STRUCTURE_FIGHTER_FLAG,
  STRUCTURE_MOON_MATERIAL_FLAG,
  GROUP_STRUCTURE_DEED,
  isStructureOwnedBayFlag,
  isStructureContextOwnedBayFlag,
} = require(path.join(
  repoRoot,
  "server/src/services/structure/structureInventoryFlags",
));
const structureQuantumCore = require(path.join(
  repoRoot,
  "server/src/services/structure/structureQuantumCore",
));
const spaceRuntime = require(path.join(
  repoRoot,
  "server/src/space/runtime",
));
const {
  ITEM_FLAGS,
  findItemById,
  grantItemToCharacterLocation,
  listContainerItems,
  resetInventoryStoreForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

const TEST_CHARACTER_ID = 140000001;
const TEST_CORPORATION_ID = 980090001;
const ASTRAHUS_TYPE_ID = 35832;
const ASTRAHUS_CORE_TYPE_ID = 56201;
const RAITARU_CORE_TYPE_ID = 56203;
const ANTIMATTER_CHARGE_M_TYPE_ID = 230;
const TEMPLAR_II_TYPE_ID = 40556;
const TRITANIUM_TYPE_ID = 34;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotMutableTables() {
  return {
    structures: cloneValue(database.read("structures", "/").data || {}),
    identityState: cloneValue(database.read("identityState", "/").data || {}),
    items: cloneValue(database.read("items", "/").data || {}),
  };
}

function restoreMutableTables(snapshot) {
  database.write("structures", "/", cloneValue(snapshot.structures));
  database.write("identityState", "/", cloneValue(snapshot.identityState));
  database.write("items", "/", cloneValue(snapshot.items));
  database.flushAllSync();
  structureState.clearStructureCaches();
  resetInventoryStoreForTests();
}

function buildStructureSession(characterID, corporationID, structureID) {
  return {
    clientID: characterID + 820000,
    userid: characterID,
    characterID,
    charid: characterID,
    corporationID,
    corpid: corporationID,
    stationID: structureID,
    stationid: structureID,
    structureID,
    structureid: structureID,
    shipID: structureID,
    shipid: structureID,
    currentBoundObjectID: null,
    notifications: [],
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange() {},
  };
}

function extractBoundID(value) {
  return (
    value &&
    value.type === "substruct" &&
    value.value &&
    value.value.type === "substream" &&
    Array.isArray(value.value.value)
      ? value.value.value[0]
      : null
  );
}

function bindStructureInventory(service, session, structureID) {
  const bound = service.Handle_GetInventoryFromId(
    [structureID],
    session,
    { locationID: structureID },
  );
  const boundID = extractBoundID(bound);
  assert.ok(boundID, "Expected structure inventory bind to succeed");
  session.currentBoundObjectID = boundID;
}

function getKeyValNumber(value, key) {
  const entries =
    value &&
    value.args &&
    value.args.type === "dict" &&
    Array.isArray(value.args.entries)
      ? value.args.entries
      : [];
  const entry = entries.find(([entryKey]) => entryKey === key);
  return Number(entry && entry[1]) || 0;
}

function getPackedRowFields(rowset) {
  return (rowset && rowset.type === "list" && Array.isArray(rowset.items)
    ? rowset.items
    : [])
    .map((row) => row && row.fields)
    .filter(Boolean);
}

function getOnItemChangeFields(notification) {
  return notification &&
    Array.isArray(notification.payload) &&
    notification.payload[0] &&
    notification.payload[0].fields
    ? notification.payload[0].fields
    : {};
}

function createAstrahus(overrides = {}) {
  structureState.clearStructureCaches();
  const createResult = structureState.createStructure({
    typeID: ASTRAHUS_TYPE_ID,
    name: `Quantum Core Test Astrahus ${Date.now()}`,
    itemName: "Quantum Core Test Astrahus",
    ownerCorpID: TEST_CORPORATION_ID,
    solarSystemID: 30000142,
    state: STRUCTURE_STATE.ANCHORING,
    stateStartedAt: Date.now() - 1000,
    stateEndsAt: null,
    upkeepState: STRUCTURE_UPKEEP_STATE.LOW_POWER,
    hasQuantumCore: false,
    quantumCoreItemTypeID: ASTRAHUS_CORE_TYPE_ID,
    accessProfile: {
      docking: "public",
      tethering: "public",
    },
    ...overrides,
  });
  assert.equal(createResult.success, true, "Expected structure creation");
  return createResult.data;
}

function grantCoreToPersonalHangar(structureID, typeID = ASTRAHUS_CORE_TYPE_ID) {
  const grantResult = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    structureID,
    ITEM_FLAGS.HANGAR,
    typeID,
    1,
  );
  assert.equal(grantResult.success, true, "Expected core grant");
  assert.ok(grantResult.data.items.length > 0, "Expected granted core item");
  return grantResult.data.items[0];
}

test("structure inventory constants include deed bay and quantum core group", () => {
  assert.equal(ITEM_FLAGS.STRUCTURE_DEED, 180);
  assert.equal(STRUCTURE_AMMO_FLAG, 5);
  assert.equal(STRUCTURE_FIGHTER_FLAG, 158);
  assert.equal(STRUCTURE_DEED_FLAG, 180);
  assert.equal(STRUCTURE_MOON_MATERIAL_FLAG, 186);
  assert.equal(GROUP_STRUCTURE_DEED, 4086);
  assert.equal(isStructureOwnedBayFlag(164), true);
  assert.equal(isStructureOwnedBayFlag(172), true);
  assert.equal(isStructureOwnedBayFlag(180), true);
  assert.equal(isStructureOwnedBayFlag(ITEM_FLAGS.CARGO_HOLD), false);
  assert.equal(isStructureOwnedBayFlag(ITEM_FLAGS.FIGHTER_BAY), false);
  assert.equal(isStructureContextOwnedBayFlag(ITEM_FLAGS.CARGO_HOLD), true);
  assert.equal(isStructureContextOwnedBayFlag(ITEM_FLAGS.FIGHTER_BAY), true);
  assert.equal(structureQuantumCore.getRequiredQuantumCoreTypeID(ASTRAHUS_TYPE_ID), ASTRAHUS_CORE_TYPE_ID);
});

test("structure controller ammo and fighter bay flags are structure-owned only in structure context", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const structure = createAstrahus();
  const session = buildStructureSession(
    TEST_CHARACTER_ID,
    TEST_CORPORATION_ID,
    structure.structureID,
  );
  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structure.structureID);

  const ammoGrant = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    structure.structureID,
    ITEM_FLAGS.HANGAR,
    ANTIMATTER_CHARGE_M_TYPE_ID,
    100,
  );
  assert.equal(ammoGrant.success, true);
  const ammo = ammoGrant.data.items[0];
  const movedAmmoID = invbroker.Handle_Add(
    [ammo.itemID, structure.structureID],
    session,
    { flag: ITEM_FLAGS.CARGO_HOLD },
  );
  const storedAmmo = findItemById(Number(movedAmmoID) || ammo.itemID);
  assert.equal(Number(storedAmmo.ownerID), TEST_CORPORATION_ID);
  assert.equal(Number(storedAmmo.locationID), structure.structureID);
  assert.equal(Number(storedAmmo.flagID), ITEM_FLAGS.CARGO_HOLD);

  const fighterGrant = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    structure.structureID,
    ITEM_FLAGS.HANGAR,
    TEMPLAR_II_TYPE_ID,
    1,
  );
  assert.equal(fighterGrant.success, true);
  const fighter = fighterGrant.data.items[0];
  const movedFighterID = invbroker.Handle_Add(
    [fighter.itemID, structure.structureID],
    session,
    { flag: ITEM_FLAGS.FIGHTER_BAY },
  );
  const storedFighter = findItemById(Number(movedFighterID) || fighter.itemID);
  assert.equal(Number(storedFighter.ownerID), TEST_CORPORATION_ID);
  assert.equal(Number(storedFighter.locationID), structure.structureID);
  assert.equal(Number(storedFighter.flagID), ITEM_FLAGS.FIGHTER_BAY);

  const ammoRows = getPackedRowFields(
    invbroker.Handle_List([], session, { flag: ITEM_FLAGS.CARGO_HOLD }),
  );
  assert.equal(ammoRows.some((row) => Number(row.itemID) === Number(storedAmmo.itemID)), true);
  assert.equal(ammoRows.every((row) => Number(row.ownerID) === TEST_CORPORATION_ID), true);

  const fighterRows = getPackedRowFields(
    invbroker.Handle_List([], session, { flag: ITEM_FLAGS.FIGHTER_BAY }),
  );
  assert.equal(fighterRows.some((row) => Number(row.itemID) === Number(storedFighter.itemID)), true);
  assert.equal(fighterRows.every((row) => Number(row.ownerID) === TEST_CORPORATION_ID), true);

  const fighterCapacity = invbroker.Handle_GetCapacity(
    [],
    session,
    { flag: ITEM_FLAGS.FIGHTER_BAY },
  );
  assert.equal(getKeyValNumber(fighterCapacity, "capacity") > 0, true);
  assert.equal(getKeyValNumber(fighterCapacity, "used") > 0, true);
});

test("structure ammo and fighter bays reject invalid item categories", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const structure = createAstrahus();
  const session = buildStructureSession(
    TEST_CHARACTER_ID,
    TEST_CORPORATION_ID,
    structure.structureID,
  );
  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structure.structureID);

  const tritaniumGrant = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    structure.structureID,
    ITEM_FLAGS.HANGAR,
    TRITANIUM_TYPE_ID,
    1000,
  );
  assert.equal(tritaniumGrant.success, true);
  const tritanium = tritaniumGrant.data.items[0];

  assert.equal(
    invbroker.Handle_Add(
      [tritanium.itemID, structure.structureID],
      session,
      { flag: ITEM_FLAGS.CARGO_HOLD },
    ),
    null,
  );
  assert.equal(
    invbroker.Handle_Add(
      [tritanium.itemID, structure.structureID],
      session,
      { flag: ITEM_FLAGS.FIGHTER_BAY },
    ),
    null,
  );

  const currentTritanium = findItemById(tritanium.itemID);
  assert.equal(Number(currentTritanium.ownerID), TEST_CHARACTER_ID);
  assert.equal(Number(currentTritanium.locationID), structure.structureID);
  assert.equal(Number(currentTritanium.flagID), ITEM_FLAGS.HANGAR);
});

test("installing a quantum core transfers it to the structure-owned deed bay and advances onlining", (t) => {
  const snapshot = snapshotMutableTables();
  const originalSyncStructureSceneState = spaceRuntime.syncStructureSceneState;
  const structureSceneSyncCalls = [];
  spaceRuntime.syncStructureSceneState = (systemID, options = {}) => {
    structureSceneSyncCalls.push({ systemID: Number(systemID), options });
    return { success: true, data: { added: [], updated: [] } };
  };
  t.after(() => {
    spaceRuntime.syncStructureSceneState = originalSyncStructureSceneState;
    restoreMutableTables(snapshot);
  });
  resetInventoryStoreForTests();

  const structure = createAstrahus();
  assert.equal(Number(structure.state), STRUCTURE_STATE.ONLINING_VULNERABLE);
  assert.equal(structure.stateEndsAt, null);
  const session = buildStructureSession(
    TEST_CHARACTER_ID,
    TEST_CORPORATION_ID,
    structure.structureID,
  );
  const core = grantCoreToPersonalHangar(structure.structureID);
  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structure.structureID);

  const movedCoreID = invbroker.Handle_Add(
    [core.itemID, structure.structureID],
    session,
    { flag: STRUCTURE_DEED_FLAG },
  );

  const installedCore = findItemById(Number(movedCoreID) || core.itemID);
  assert.equal(Number(installedCore.ownerID), TEST_CORPORATION_ID);
  assert.equal(Number(installedCore.locationID), structure.structureID);
  assert.equal(Number(installedCore.flagID), STRUCTURE_DEED_FLAG);
  assert.equal(
    listContainerItems(TEST_CHARACTER_ID, structure.structureID, ITEM_FLAGS.HANGAR)
      .some((item) => Number(item.itemID) === Number(installedCore.itemID)),
    false,
    "Installed core should leave the personal hangar",
  );
  assert.equal(
    listContainerItems(TEST_CORPORATION_ID, structure.structureID, STRUCTURE_DEED_FLAG)
      .some((item) => Number(item.itemID) === Number(installedCore.itemID)),
    true,
    "Installed core should be visible in the structure-owned deed bay",
  );

  const updatedStructure = structureState.getStructureByID(structure.structureID, {
    refresh: false,
  });
  assert.equal(updatedStructure.hasQuantumCore, true);
  assert.equal(Number(updatedStructure.quantumCoreItemID), Number(installedCore.itemID));
  assert.equal(Number(updatedStructure.quantumCoreItemTypeID), ASTRAHUS_CORE_TYPE_ID);
  assert.equal(Number(updatedStructure.state), STRUCTURE_STATE.ONLINING_VULNERABLE);
  assert.ok(Number(updatedStructure.stateEndsAt) > Date.now());
  assert.equal(Number(updatedStructure.upkeepState), STRUCTURE_UPKEEP_STATE.LOW_POWER);
  assert.equal(
    structureSceneSyncCalls.some((call) => call.systemID === structure.solarSystemID),
    true,
    "Installing a core should refresh the live structure scene",
  );
});

test("expired anchoring without a core becomes dockable onlining-vulnerable", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const nowMs = Date.now();
  const structure = createAstrahus({
    state: STRUCTURE_STATE.ANCHORING,
    stateStartedAt: nowMs - 100000,
    stateEndsAt: nowMs - 1,
    hasQuantumCore: false,
  });
  structureState.tickStructures(nowMs);
  const updatedStructure = structureState.getStructureByID(structure.structureID, {
    refresh: false,
  });
  assert.equal(Number(updatedStructure.state), STRUCTURE_STATE.ONLINING_VULNERABLE);
  assert.equal(updatedStructure.stateEndsAt, null);
  assert.equal(updatedStructure.hasQuantumCore, false);
  assert.equal(Number(updatedStructure.upkeepState), STRUCTURE_UPKEEP_STATE.LOW_POWER);

  const session = buildStructureSession(
    TEST_CHARACTER_ID,
    TEST_CORPORATION_ID,
    structure.structureID,
  );
  assert.equal(
    structureState.canCharacterDockAtStructure(session, updatedStructure).success,
    true,
    "Post-anchoring core-needed structures should be dockable",
  );
});

test("legacy pre-core onlining rows normalize to low power", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const structure = createAstrahus({
    state: STRUCTURE_STATE.ONLINING_VULNERABLE,
    stateEndsAt: null,
    hasQuantumCore: false,
    upkeepState: STRUCTURE_UPKEEP_STATE.FULL_POWER,
  });
  const updatedStructure = structureState.getStructureByID(structure.structureID, {
    refresh: false,
  });

  assert.equal(Number(updatedStructure.state), STRUCTURE_STATE.ONLINING_VULNERABLE);
  assert.equal(updatedStructure.hasQuantumCore, false);
  assert.equal(Number(updatedStructure.upkeepState), STRUCTURE_UPKEEP_STATE.LOW_POWER);
});

test("wrong quantum core type is rejected and remains in personal hangar", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const structure = createAstrahus();
  const session = buildStructureSession(
    TEST_CHARACTER_ID,
    TEST_CORPORATION_ID,
    structure.structureID,
  );
  const wrongCore = grantCoreToPersonalHangar(structure.structureID, RAITARU_CORE_TYPE_ID);
  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structure.structureID);

  const moveResult = invbroker.Handle_Add(
    [wrongCore.itemID, structure.structureID],
    session,
    { flag: STRUCTURE_DEED_FLAG },
  );
  assert.equal(moveResult, null);

  const currentCore = findItemById(wrongCore.itemID);
  assert.equal(Number(currentCore.ownerID), TEST_CHARACTER_ID);
  assert.equal(Number(currentCore.locationID), structure.structureID);
  assert.equal(Number(currentCore.flagID), ITEM_FLAGS.HANGAR);
  assert.equal(
    structureState.getStructureByID(structure.structureID, { refresh: false }).hasQuantumCore,
    false,
  );
});

test("listing the deed bay repairs an already-misowned quantum core row", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const structure = createAstrahus();
  const session = buildStructureSession(
    TEST_CHARACTER_ID,
    TEST_CORPORATION_ID,
    structure.structureID,
  );
  const grantResult = grantItemToCharacterLocation(
    TEST_CHARACTER_ID,
    structure.structureID,
    STRUCTURE_DEED_FLAG,
    ASTRAHUS_CORE_TYPE_ID,
    1,
  );
  assert.equal(grantResult.success, true);
  const misplacedCore = grantResult.data.items[0];

  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structure.structureID);
  session.notifications.length = 0;
  invbroker.Handle_List([STRUCTURE_DEED_FLAG], session, {});

  assert.equal(
    session.notifications.some((entry) => {
      const fields = getOnItemChangeFields(entry);
      return entry &&
        entry.name === "OnItemChange" &&
        Number(fields.itemID) === Number(misplacedCore.itemID);
    }),
    false,
    "Repair-on-list should not send a live core item-change notification while the Core Room UI is opening",
  );
  assert.equal(
    session.notifications.some((entry) => {
      const fields = getOnItemChangeFields(entry);
      return entry &&
        entry.name === "OnItemChange" &&
        Number(fields.itemID) === Number(structure.structureID) &&
        Number(fields.locationID) === Number(structure.solarSystemID);
    }),
    true,
    "Expected Core Room listing to repair any stale structure self cache row",
  );

  const repairedCore = findItemById(misplacedCore.itemID);
  assert.equal(Number(repairedCore.ownerID), TEST_CORPORATION_ID);
  assert.equal(Number(repairedCore.flagID), STRUCTURE_DEED_FLAG);
  assert.equal(
    listContainerItems(TEST_CORPORATION_ID, structure.structureID, STRUCTURE_DEED_FLAG)
      .some((item) => Number(item.itemID) === Number(misplacedCore.itemID)),
    true,
  );

  const updatedStructure = structureState.getStructureByID(structure.structureID, {
    refresh: false,
  });
  assert.equal(updatedStructure.hasQuantumCore, true);
  assert.equal(Number(updatedStructure.quantumCoreItemID), Number(misplacedCore.itemID));
  assert.equal(Number(updatedStructure.state), STRUCTURE_STATE.ONLINING_VULNERABLE);
});

test("destroying a cored structure drops the actual installed core item", (t) => {
  const snapshot = snapshotMutableTables();
  t.after(() => restoreMutableTables(snapshot));
  resetInventoryStoreForTests();

  const structure = createAstrahus({
    state: STRUCTURE_STATE.SHIELD_VULNERABLE,
    stateEndsAt: null,
  });
  const session = buildStructureSession(
    TEST_CHARACTER_ID,
    TEST_CORPORATION_ID,
    structure.structureID,
  );
  const core = grantCoreToPersonalHangar(structure.structureID);
  const invbroker = new InvBrokerService();
  bindStructureInventory(invbroker, session, structure.structureID);
  const movedCoreID = invbroker.Handle_Add(
    [core.itemID, structure.structureID],
    session,
    { flag: STRUCTURE_DEED_FLAG },
  );
  const installedCoreID = Number(movedCoreID) || core.itemID;

  const destroyResult = structureState.destroyStructure(structure.structureID, {
    skipAssetSafety: true,
  });
  assert.equal(destroyResult.success, true, "Expected structure destruction");
  const loot = destroyResult.data && destroyResult.data.loot;
  const dropLocationID =
    Number(loot && loot.wreck && loot.wreck.itemID) ||
    Number(
      loot &&
        loot.containers &&
        loot.containers[0] &&
        loot.containers[0].containerID,
    ) ||
    0;
  assert.ok(dropLocationID > 0, "Expected a core drop location");

  const droppedCore = findItemById(installedCoreID);
  assert.equal(Number(droppedCore && droppedCore.locationID), dropLocationID);
  assert.equal(Number(droppedCore && droppedCore.flagID), ITEM_FLAGS.HANGAR);
  assert.equal(Number(droppedCore && droppedCore.typeID), ASTRAHUS_CORE_TYPE_ID);
});
