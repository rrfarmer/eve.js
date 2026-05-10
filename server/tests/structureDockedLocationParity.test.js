const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { setupNewDatabaseSandbox } = require("./helpers/newDatabaseSandbox");
setupNewDatabaseSandbox("evejs-structure-docked-db-");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const ConfigService = require(path.join(
  repoRoot,
  "server/src/services/config/configService",
));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const CharService = require(path.join(
  repoRoot,
  "server/src/services/character/charService",
));
const {
  jumpSessionToStation,
} = require(path.join(repoRoot, "server/src/space/transitions"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  ITEM_FLAGS,
  findItemById,
  moveItemToLocation,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `Failed to read ${tableName}`);
  return result.data;
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", payload);
  assert.equal(result.success, true, `Failed to write ${tableName}`);
}

function getCandidate() {
  const characters = readTable("characters");
  const characterIDs = Object.keys(characters || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const activeShip = getActiveShipRecord(characterID);
    if (!characterRecord || !activeShip) {
      continue;
    }

    return {
      characterID,
      characterRecord,
      activeShip,
      solarSystemID: Number(characterRecord.solarSystemID) || 30000142,
    };
  }

  assert.fail("Expected at least one character with an active ship");
}

function extractListItems(value) {
  return value && value.type === "list" && Array.isArray(value.items)
    ? value.items
    : [];
}

function extractTupleRows(value) {
  if (!Array.isArray(value) || value.length < 2 || !Array.isArray(value[1])) {
    return [];
  }
  return value[1];
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

function getPrimeAttributes(primeEntry) {
  const attributes = getKeyValEntry(primeEntry, "attributes");
  return new Map(
    attributes &&
    attributes.type === "dict" &&
    Array.isArray(attributes.entries)
      ? attributes.entries.map((entry) => [
        Number(entry[0]) || 0,
        Number(entry[1]) || 0,
      ])
      : [],
  );
}

test("structure-docked sessions resolve config, inventory, and dogma through structureID", () => {
  const charactersBackup = readTable("characters");
  const itemsBackup = readTable("items");
  const structuresBackup = readTable("structures");
  const candidate = getCandidate();

  try {
    structureState.clearStructureCaches();

    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "Docked Session Test Astrahus",
      itemName: "Docked Session Test Astrahus",
      ownerCorpID: Number(candidate.characterRecord.corporationID || 1000009) || 1000009,
      solarSystemID: Number(candidate.solarSystemID) || 30000142,
      position: { x: 310000, y: 0, z: 330000 },
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
      serviceStates: {
        "1": 1,
        "2": 1,
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structureID = createResult.data.structureID;

    const moveShipResult = moveItemToLocation(
      candidate.activeShip.itemID,
      structureID,
      ITEM_FLAGS.HANGAR,
    );
    assert.equal(moveShipResult.success, true, "Expected the active ship to move into the structure hangar");

    const nextCharacters = readTable("characters");
    nextCharacters[String(candidate.characterID)] = {
      ...nextCharacters[String(candidate.characterID)],
      stationID: null,
      structureID,
      solarSystemID: Number(candidate.solarSystemID) || 30000142,
    };
    writeTable("characters", nextCharacters);

    const session = {
      clientID: candidate.characterID + 93000,
      userid: candidate.characterID,
      characterID: candidate.characterID,
      charid: candidate.characterID,
      locationid: Number(candidate.solarSystemID) || 30000142,
      solarsystemid: Number(candidate.solarSystemID) || 30000142,
      solarsystemid2: Number(candidate.solarSystemID) || 30000142,
      socket: { destroyed: false },
      notifications: [],
      sendNotification(name, idType, payload) {
        this.notifications.push({ name, idType, payload });
      },
      sendSessionChange() {},
    };

    const applyResult = applyCharacterToSession(session, candidate.characterID, {
      emitNotifications: false,
      logSelection: false,
    });
    assert.equal(applyResult.success, true, "Expected the character session to apply cleanly");
    assert.equal(
      Number(session.structureid || session.structureID || 0),
      structureID,
      "Expected the applied session to carry structureID",
    );
    assert.equal(
      Number(session.stationid || session.stationID || 0),
      0,
      "Expected the applied session to stop using stationID for structure docking",
    );
    assert.equal(
      Number(session.locationid || 0),
      structureID,
      "Expected structure-docked sessions to move locationid onto the structure",
    );
    assert.equal(
      Number(session.solarsystemid || 0),
      Number(candidate.solarSystemID) || 30000142,
      "Expected structure-docked sessions to keep a live solarsystemid for invCache",
    );
    assert.equal(
      Number(session.solarsystemid2 || 0),
      Number(candidate.solarSystemID) || 30000142,
      "Expected structure-docked sessions to preserve solarsystemid2",
    );
    assert.deepEqual(
      applyResult.notificationPlan && applyResult.notificationPlan.sessionChanges
        ? applyResult.notificationPlan.sessionChanges.structureid
        : null,
      [null, structureID],
      "Expected structure dock session changes to announce the new structureid",
    );
    assert.deepEqual(
      applyResult.notificationPlan && applyResult.notificationPlan.sessionChanges
        ? applyResult.notificationPlan.sessionChanges.locationid
        : null,
      [Number(candidate.solarSystemID) || 30000142, structureID],
      "Expected structure dock session changes to move locationid from the solar system to the structure",
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        (applyResult.notificationPlan && applyResult.notificationPlan.sessionChanges) || {},
        "solarsystemid",
      ),
      false,
      "Expected structure dock session changes not to clear solarsystemid while staying in the same system",
    );

    const configService = new ConfigService();
    const configRows = extractTupleRows(
      configService.Handle_GetMultiLocationsEx([[structureID]], session),
    );
    assert.equal(configRows.length, 1, "Expected a single cfg.evelocations row for the structure");
    assert.equal(
      Number(configRows[0][0]) || 0,
      structureID,
      "Expected GetMultiLocationsEx to resolve the structure location ID",
    );
    assert.ok(
      String(configRows[0][1] || "").includes("Docked Session Test Astrahus"),
      "Expected the structure name to flow through cfg.evelocations",
    );

    const invBroker = new InvBrokerService();
    const bound = invBroker.Handle_GetInventory([10004], session);
    const primeNotification = session.notifications.find(
      (entry) =>
        entry &&
        entry.name === "OnGodmaPrimeItem" &&
        Array.isArray(entry.payload) &&
        Number(entry.payload[0]) === structureID,
    );
    assert.ok(
      primeNotification,
      "Expected binding a structure inventory to prime the structure dogma item",
    );
    assert.equal(
      getPrimeAttributes(primeNotification.payload[1]).get(3101),
      56201,
      "Expected structure dogma prime to include required quantum core type",
    );
    session.notifications.length = 0;
    invBroker.Handle_GetInventoryFromId([structureID], session, {
      locationID: structureID,
    });
    assert.ok(
      session.notifications.some((entry) =>
        entry &&
        entry.name === "OnGodmaPrimeItem" &&
        Array.isArray(entry.payload) &&
        Number(entry.payload[0]) === structureID &&
        getPrimeAttributes(entry.payload[1]).get(3101) === 56201,
      ),
      "Expected binding structure inventory by ID to prime the Core Room dogma attribute",
    );
    const boundID =
      bound &&
      bound.type === "substruct" &&
      bound.value &&
      bound.value.type === "substream" &&
      Array.isArray(bound.value.value)
        ? bound.value.value[0]
        : null;
    assert.ok(boundID, "Expected the structure hangar inventory to bind successfully");
    session.currentBoundObjectID = boundID;

    const inventoryRows = extractListItems(
      invBroker.Handle_List([ITEM_FLAGS.HANGAR], session, {}),
    ).map((row) => (row && row.type === "packedrow" && row.fields ? row.fields : row));
    assert.equal(
      inventoryRows.some((row) => Number(row && row.itemID) === Number(candidate.activeShip.itemID)),
      true,
      "Expected the active ship to remain visible in the structure hangar inventory",
    );

    const dogma = new DogmaService();
    const allInfo = dogma.Handle_GetAllInfo([false, true, true], session);
    const charInfo = getKeyValEntry(allInfo, "charInfo");
    const structureInfo = getKeyValEntry(allInfo, "structureInfo");
    assert.ok(
      Array.isArray(charInfo),
      "Expected structure-docked ship-info GetAllInfo to still include docked charInfo",
    );
    assert.equal(
      charInfo.length,
      2,
      "Expected docked charInfo to remain on the two-value [characterInfo, charBrain] contract",
    );
    assert.ok(
      structureInfo &&
        structureInfo.type === "dict" &&
        Array.isArray(structureInfo.entries),
      "Expected structure-docked GetAllInfo to include structureInfo for dogma priming",
    );
    const structurePrimeEntry = structureInfo.entries.find(
      (entry) => Array.isArray(entry) && Number(entry[0] || 0) === structureID,
    );
    assert.ok(
      structurePrimeEntry,
      "Expected structureInfo to prime the docked structure item itself",
    );
  } finally {
    writeTable("characters", charactersBackup);
    writeTable("items", itemsBackup);
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  }
});

test("character selection reports structure docks through stationID-compatible field", () => {
  const charactersBackup = readTable("characters");
  const itemsBackup = readTable("items");
  const structuresBackup = readTable("structures");
  const candidate = getCandidate();

  try {
    structureState.clearStructureCaches();

    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "Selection Payload Test Astrahus",
      itemName: "Selection Payload Test Astrahus",
      ownerCorpID: Number(candidate.characterRecord.corporationID || 1000009) || 1000009,
      solarSystemID: Number(candidate.solarSystemID) || 30000142,
      position: { x: 315000, y: 0, z: 335000 },
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
    });
    assert.equal(createResult.success, true, "Expected structure creation to succeed");
    const structureID = createResult.data.structureID;

    const moveShipResult = moveItemToLocation(
      candidate.activeShip.itemID,
      structureID,
      ITEM_FLAGS.HANGAR,
    );
    assert.equal(moveShipResult.success, true, "Expected active ship to move into the structure");

    const accountID = Number(candidate.characterRecord.accountId || 910777) || 910777;
    const nextCharacters = readTable("characters");
    nextCharacters[String(candidate.characterID)] = {
      ...nextCharacters[String(candidate.characterID)],
      accountId: accountID,
      stationID: null,
      structureID,
      solarSystemID: Number(candidate.solarSystemID) || 30000142,
    };
    writeTable("characters", nextCharacters);

    const charService = new CharService();
    const selectionPayload = charService.Handle_GetCharacterSelectionData([], {
      userid: accountID,
    });
    const selectionRows = extractListItems(selectionPayload[2]);
    const selectionRow = selectionRows.find(
      (row) => Number(getKeyValEntry(row, "characterID") || 0) === Number(candidate.characterID),
    );
    assert.ok(selectionRow, "Expected the structure-docked character in selection payload");
    assert.equal(
      Number(getKeyValEntry(selectionRow, "stationID") || 0),
      structureID,
      "Expected login selection stationID to carry the docked structure ID",
    );
    assert.equal(
      Number(getKeyValEntry(selectionRow, "structureID") || 0),
      structureID,
      "Expected login selection to preserve explicit structureID too",
    );

    const characterInfo = charService.Handle_GetCharacterToSelect(
      [candidate.characterID],
      { userid: accountID },
    );
    assert.equal(
      Number(getKeyValEntry(characterInfo, "stationID") || 0),
      structureID,
      "Expected GetCharacterToSelect stationID to carry the docked structure ID",
    );
    assert.equal(
      Number(getKeyValEntry(characterInfo, "structureID") || 0),
      structureID,
      "Expected GetCharacterToSelect to preserve explicit structureID too",
    );
  } finally {
    writeTable("characters", charactersBackup);
    writeTable("items", itemsBackup);
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  }
});

test("station-jump GM transport accepts player-owned structure IDs", () => {
  const charactersBackup = readTable("characters");
  const itemsBackup = readTable("items");
  const structuresBackup = readTable("structures");
  const candidate = getCandidate();

  try {
    structureState.clearStructureCaches();
    const createResult = structureState.createStructure({
      typeID: 35832,
      name: "Transport Test Astrahus",
      itemName: "Transport Test Astrahus",
      ownerCorpID: Number(candidate.characterRecord.corporationID || 1000009) || 1000009,
      solarSystemID: Number(candidate.solarSystemID) || 30000142,
      position: { x: 320000, y: 0, z: 340000 },
      state: 110,
      upkeepState: 1,
      hasQuantumCore: true,
      accessProfile: {
        docking: "public",
        tethering: "public",
      },
    });
    assert.equal(createResult.success, true);
    const structureID = createResult.data.structureID;
    const session = {
      clientID: candidate.characterID + 94000,
      userid: candidate.characterID,
      characterID: candidate.characterID,
      charid: candidate.characterID,
      shipID: candidate.activeShip.itemID,
      shipid: candidate.activeShip.itemID,
      activeShipID: candidate.activeShip.itemID,
      stationID: candidate.characterRecord.stationID || null,
      stationid: candidate.characterRecord.stationID || null,
      structureID: candidate.characterRecord.structureID || null,
      structureid: candidate.characterRecord.structureID || null,
      locationid: candidate.characterRecord.stationID || candidate.characterRecord.structureID || candidate.solarSystemID,
      solarsystemid: candidate.solarSystemID,
      solarsystemid2: candidate.solarSystemID,
      socket: { destroyed: false },
      notifications: [],
      sendNotification(name, idType, payload) {
        this.notifications.push({ name, idType, payload });
      },
      sendSessionChange() {},
    };

    const result = jumpSessionToStation(session, structureID);
    assert.equal(result.success, true, result.errorMsg || "Expected structure station-jump to succeed");
    assert.equal(Number(session.structureID || session.structureid), structureID);
    assert.equal(Number(session.stationID || session.stationid || 0), 0);

    const ship = findItemById(candidate.activeShip.itemID);
    assert.equal(Number(ship && ship.locationID), structureID);
    assert.equal(Number(ship && ship.flagID), ITEM_FLAGS.HANGAR);

    const character = getCharacterRecord(candidate.characterID);
    assert.equal(Number(character && character.structureID), structureID);
    assert.equal(Number(character && character.stationID || 0), 0);
  } finally {
    writeTable("characters", charactersBackup);
    writeTable("items", itemsBackup);
    writeTable("structures", structuresBackup);
    structureState.clearStructureCaches();
  }
});
