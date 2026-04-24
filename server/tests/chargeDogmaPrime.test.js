const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  buildInventoryItem,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  resolveItemByName,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  getAttributeIDByNames,
  getLoadedChargeItems,
  getFittedModuleItems,
  isModuleOnline,
} = require(path.join(repoRoot, "server/src/services/fitting/liveFittingState"));
const {
  _testing: runtimeTesting,
} = require(path.join(repoRoot, "server/src/space/runtime"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
  syncChargeSublocationForSession,
  syncChargeSublocationTransitionForSession,
  syncLoadedChargeDogmaBootstrapForSession,
  _testing: characterStateTesting,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const InvBrokerService = require(path.join(
  repoRoot,
  "server/src/services/inventory/invBrokerService",
));

const ATTRIBUTE_QUANTITY = getAttributeIDByNames("quantity") || 805;

function resolveExactItem(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item '${name}' to exist`);
  return result.match;
}

function buildLoadedCharge(typeName, itemID, shipID, flagID, quantity = 1) {
  const type = resolveExactItem(typeName);
  return buildInventoryItem({
    itemID,
    typeID: type.typeID,
    ownerID: 9000001,
    locationID: shipID,
    flagID,
    singleton: 0,
    quantity,
    stacksize: quantity,
  });
}

function findLiveSpaceChargeCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Expected to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (
      !characterRecord ||
      !ship ||
      !ship.spaceState ||
      Number(characterRecord.stationID || characterRecord.stationid || 0) > 0
    ) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    if (!fittedModules.some((moduleItem) => isModuleOnline(moduleItem))) {
      continue;
    }

    const loadedCharges = getLoadedChargeItems(characterID, ship.itemID);
    if (loadedCharges.length === 0) {
      continue;
    }

    return loadedCharges[0];
  }

  assert.fail("Expected an in-space character with a loaded fitted charge");
}

function findLiveSpaceChargeBootstrapCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Expected to read characters table");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (
      !characterRecord ||
      !ship ||
      !ship.spaceState ||
      Number(characterRecord.stationID || characterRecord.stationid || 0) > 0
    ) {
      continue;
    }

    const loadedCharges = getLoadedChargeItems(characterID, ship.itemID);
    if (loadedCharges.length <= 0) {
      continue;
    }

    return {
      characterID,
      shipID: ship.itemID,
      loadedCharge: loadedCharges[0],
    };
  }

  assert.fail("Expected an in-space character with a loaded fitted charge bootstrap candidate");
}

function readPrimeAttributes(primeEntry) {
  const entries =
    primeEntry &&
    primeEntry.name === "util.KeyVal" &&
    primeEntry.args &&
    primeEntry.args.type === "dict" &&
    Array.isArray(primeEntry.args.entries)
      ? primeEntry.args.entries
      : [];
  const attributeEntry = entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "attributes",
  );
  const attributeEntries =
    attributeEntry &&
    attributeEntry[1] &&
    attributeEntry[1].type === "dict" &&
    Array.isArray(attributeEntry[1].entries)
      ? attributeEntry[1].entries
      : [];

  return new Map(
    attributeEntries.map((entry) => [
      Number(Array.isArray(entry) ? entry[0] : 0) || 0,
      Number(Array.isArray(entry) ? entry[1] : 0) || 0,
    ]),
  );
}

function readPrimeInvItem(primeEntry) {
  const entries =
    primeEntry &&
    primeEntry.name === "util.KeyVal" &&
    primeEntry.args &&
    primeEntry.args.type === "dict" &&
    Array.isArray(primeEntry.args.entries)
      ? primeEntry.args.entries
      : [];
  const invItemEntry = entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "invItem",
  );
  const invItem =
    invItemEntry &&
    invItemEntry[1] &&
    invItemEntry[1].name === "util.Row" &&
    invItemEntry[1].args &&
    invItemEntry[1].args.type === "dict" &&
    Array.isArray(invItemEntry[1].args.entries)
      ? invItemEntry[1]
      : null;
  if (!invItem) {
    return null;
  }
  const header =
    invItem.args.entries.find((entry) => Array.isArray(entry) && entry[0] === "header")?.[1] || [];
  const line =
    invItem.args.entries.find((entry) => Array.isArray(entry) && entry[0] === "line")?.[1] || [];
  const fields = {};
  for (let index = 0; index < header.length; index += 1) {
    fields[String(header[index])] = line[index];
  }
  return fields;
}

function readPrimeInvHeader(primeEntry) {
  const entries =
    primeEntry &&
    primeEntry.name === "util.KeyVal" &&
    primeEntry.args &&
    primeEntry.args.type === "dict" &&
    Array.isArray(primeEntry.args.entries)
      ? primeEntry.args.entries
      : [];
  const invItemEntry = entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "invItem",
  );
  const invItem =
    invItemEntry &&
    invItemEntry[1] &&
    invItemEntry[1].name === "util.Row" &&
    invItemEntry[1].args &&
    invItemEntry[1].args.type === "dict" &&
    Array.isArray(invItemEntry[1].args.entries)
      ? invItemEntry[1]
      : null;
  if (!invItem) {
    return [];
  }
  return (
    invItem.args.entries.find(
      (entry) => Array.isArray(entry) && entry[0] === "header",
    )?.[1] || []
  );
}

function readInventoryDescriptorColumns(descriptor) {
  return Array.isArray(descriptor && descriptor.header) &&
    Array.isArray(descriptor.header[1]) &&
    Array.isArray(descriptor.header[1][0])
    ? descriptor.header[1][0].map((column) =>
      Array.isArray(column) ? String(column[0]) : String(column),
    )
    : [];
}

function readInventoryDescriptorColumnPairs(descriptor) {
  return Array.isArray(descriptor && descriptor.header) &&
    Array.isArray(descriptor.header[1]) &&
    Array.isArray(descriptor.header[1][0])
    ? descriptor.header[1][0].map((column) => [
      String(Array.isArray(column) ? column[0] : column),
      Number(Array.isArray(column) ? column[1] : NaN),
    ])
    : [];
}

function readOnItemChangeKeys(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const changeDict =
    Array.isArray(payload) && payload[1] && payload[1].type === "dict"
      ? payload[1]
      : null;
  return Array.isArray(changeDict && changeDict.entries)
    ? changeDict.entries
      .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
      .filter((key) => key > 0)
      .sort((left, right) => left - right)
    : [];
}

function readOnItemChangeDescriptorColumnPairs(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.type === "packedrow" &&
    row.header &&
    Array.isArray(row.header.header) &&
    Array.isArray(row.header.header[1]) &&
    Array.isArray(row.header.header[1][0])
    ? row.header.header[1][0].map((column) => [
      String(Array.isArray(column) ? column[0] : column),
      Number(Array.isArray(column) ? column[1] : NaN),
    ])
    : [];
}

function readOnItemChangeItemID(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.fields &&
    row.fields.itemID !== undefined
    ? row.fields.itemID
    : null;
}

function readOnItemChangeFields(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const row = Array.isArray(payload) ? payload[0] : null;
  return row && row.fields && typeof row.fields === "object"
    ? row.fields
    : {};
}

function readOnItemChangePreviousValue(notification, key) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const changeDict =
    Array.isArray(payload) && payload[1] && payload[1].type === "dict"
      ? payload[1]
      : null;
  const matchingEntry = Array.isArray(changeDict && changeDict.entries)
    ? changeDict.entries.find((entry) => (
      Number(Array.isArray(entry) ? entry[0] : 0) === Number(key)
    ))
    : null;
  return Array.isArray(matchingEntry) ? matchingEntry[1] : undefined;
}

function readOnGodmaPrimeTupleItemID(notification) {
  const payload = notification && Array.isArray(notification.payload)
    ? notification.payload
    : null;
  const primeEntry = Array.isArray(payload) ? payload[1] : null;
  const entries =
    primeEntry &&
    primeEntry.name === "util.KeyVal" &&
    primeEntry.args &&
    primeEntry.args.type === "dict" &&
    Array.isArray(primeEntry.args.entries)
      ? primeEntry.args.entries
      : [];
  const invItemEntry = entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "invItem",
  );
  const invItem =
    invItemEntry &&
    invItemEntry[1] &&
    invItemEntry[1].name === "util.Row" &&
    invItemEntry[1].args &&
    invItemEntry[1].args.type === "dict" &&
    Array.isArray(invItemEntry[1].args.entries)
      ? invItemEntry[1]
      : null;
  if (!invItem) {
    return null;
  }
  const lineEntry = invItem.args.entries.find(
    (entry) => Array.isArray(entry) && entry[0] === "line",
  );
  return Array.isArray(lineEntry && lineEntry[1]) ? lineEntry[1][0] : null;
}

function extractModuleAttributeChanges(notifications) {
  return (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => notification && notification.name === "OnModuleAttributeChanges")
    .flatMap((notification) => {
      const payload = Array.isArray(notification.payload)
        ? notification.payload[0]
        : null;
      return payload && payload.type === "list" && Array.isArray(payload.items)
        ? payload.items
        : [];
    });
}

test("charge tuple godma prime stays on the public quantity-only contract", () => {
  const chargeItem = buildLoadedCharge(
    "Gleam L",
    983100021,
    983100001,
    27,
    1,
  );

  const primeEntry = characterStateTesting.buildChargeDogmaPrimeEntry(chargeItem);
  const attributes = readPrimeAttributes(primeEntry);
  const invItem = readPrimeInvItem(primeEntry);
  const invHeader = readPrimeInvHeader(primeEntry);

  assert.equal(Number(attributes.get(ATTRIBUTE_QUANTITY)), 1);
  assert.equal(attributes.size, 1);
  assert.deepEqual(
    invHeader,
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ],
  );
  assert.equal(invItem && invItem.typeID, chargeItem.typeID);
  assert.equal(invItem && invItem.locationID, chargeItem.locationID);
  assert.equal(invItem && invItem.flagID, chargeItem.flagID);
  assert.equal(invItem && invItem.stacksize, 1);
  assert.equal(invItem && invItem.quantity, 1);
  assert.equal(invItem && invItem.singleton, 0);
});

test("live fitted charge primes keep quantity on the public quantity-only contract", () => {
  const liveChargeItem = findLiveSpaceChargeCandidate();

  const primeEntry = characterStateTesting.buildChargeDogmaPrimeEntry(liveChargeItem);
  const attributes = readPrimeAttributes(primeEntry);
  const invItem = readPrimeInvItem(primeEntry);
  const expectedQuantity = Number(liveChargeItem.stacksize ?? liveChargeItem.quantity ?? 0);

  assert.equal(
    Number(attributes.get(ATTRIBUTE_QUANTITY)),
    expectedQuantity,
    "Expected a live fitted charge prime to preserve the current loaded quantity",
  );
  assert.equal(
    attributes.size,
    1,
    "Expected a live fitted charge prime to stay on quantity-only dogma parity",
  );
  assert.equal(invItem && invItem.typeID, liveChargeItem.typeID);
  assert.equal(invItem && invItem.locationID, liveChargeItem.locationID);
  assert.equal(invItem && invItem.flagID, liveChargeItem.flagID);
  assert.equal(invItem && invItem.stacksize, expectedQuantity);
  assert.equal(invItem && invItem.singleton, 0);
});

test("tuple charge rows normalize nullable stacksize fields for fitting consumers", () => {
  const row = characterStateTesting.buildChargeSublocationRow({
    itemID: [2990001841, 31, 42696],
    typeID: 42696,
    ownerID: 140000003,
    locationID: 2990001841,
    flagID: 31,
    quantity: 300,
    groupID: 1769,
    categoryID: 8,
    customInfo: null,
    stacksize: null,
    singleton: null,
  });

  assert.equal(row && row.fields && row.fields.quantity, 300);
  assert.equal(row && row.fields && row.fields.stacksize, 300);
  assert.equal(row && row.fields && row.fields.singleton, 0);
  assert.equal(row && row.fields && row.fields.customInfo, "");
});

test("tuple charge OnItemChange falls back to previous quantity for ixStackSize old values", () => {
  const notifications = [];
  const session = {
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncChargeSublocationForSession(
    session,
    {
      itemID: [2990001841, 31, 42696],
      typeID: 42696,
      ownerID: 140000003,
      locationID: 2990001841,
      flagID: 31,
      quantity: 299,
      groupID: 1769,
      categoryID: 8,
      customInfo: "",
      stacksize: 299,
      singleton: 0,
    },
    {
      locationID: 2990001841,
      flagID: 31,
      quantity: 300,
    },
  );

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].name, "OnItemChange");
  assert.equal(
    readOnItemChangePreviousValue(notifications[0], 10),
    300,
    "Expected ixStackSize to use the previous quantity when stacksize is omitted",
  );
});

test("invbroker item descriptor keeps singleton/stacksize as concrete DB types", () => {
  const invBroker = new InvBrokerService();
  const descriptor = invBroker.Handle_GetItemDescriptor([], null);

  // The packaged client in this worktree does not tolerate EveJS Elysian advertising
  // true virtual item columns without a backing virtual getter/setter. Keeping
  // stacksize/singleton concrete avoids the global "Virtual columns are
  // read-only" / "no mVirtualGetSet" failures in godma/invCache/HUD code.
  assert.deepEqual(
    readInventoryDescriptorColumnPairs(descriptor),
    [
      ["itemID", 20],
      ["typeID", 3],
      ["ownerID", 3],
      ["locationID", 20],
      ["flagID", 2],
      ["quantity", 3],
      ["groupID", 3],
      ["categoryID", 3],
      ["customInfo", 129],
      ["stacksize", 3],
      ["singleton", 2],
    ],
  );
  assert.deepEqual(
    readInventoryDescriptorColumns(descriptor),
    [
      "itemID",
      "typeID",
      "ownerID",
      "locationID",
      "flagID",
      "quantity",
      "groupID",
      "categoryID",
      "customInfo",
      "stacksize",
      "singleton",
    ],
  );
});

test("same-type tuple charge transitions keep live ammo consumption on ixStackSize only", () => {
  const heavyMissile = resolveExactItem("Scourge Heavy Missile");
  const notifications = [];
  const session = {
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncChargeSublocationTransitionForSession(session, {
    shipID: 990114054,
    flagID: 27,
    ownerID: 140000003,
    previousState: { typeID: heavyMissile.typeID, quantity: 12 },
    nextState: { typeID: heavyMissile.typeID, quantity: 11 },
    primeNextCharge: false,
  });

  const tupleRow = notifications.find(
    (entry) => entry && entry.name === "OnItemChange",
  );
  assert.ok(tupleRow, "Expected a same-type ammo decrement to emit a tuple-backed OnItemChange");
  assert.deepEqual(
    readOnItemChangeKeys(tupleRow),
    [10],
    "Expected same-type live ammo consumption to stay on an ixStackSize-only tuple update",
  );
  assert.deepEqual(
    readOnItemChangeDescriptorColumnPairs(tupleRow),
    [
      ["itemID", 129],
      ["typeID", 3],
      ["ownerID", 3],
      ["locationID", 20],
      ["flagID", 2],
      ["quantity", 3],
      ["groupID", 3],
      ["categoryID", 3],
      ["customInfo", 129],
      ["stacksize", 3],
      ["singleton", 2],
    ],
    "Expected tuple-backed ammo repair rows to stay on the reference charge sublocation descriptor contract",
  );
  const tupleFields = readOnItemChangeFields(tupleRow);
  assert.equal(
    Number(tupleFields.locationID) || 0,
    990114054,
    "Expected same-type tuple updates to keep the existing ship location instead of reappearing from location 0",
  );
  assert.equal(
    Number(tupleFields.flagID) || 0,
    27,
    "Expected same-type tuple updates to keep the existing launcher flag instead of reappearing from flag 0",
  );
  assert.equal(
    notifications.some((entry) => entry && entry.name === "OnGodmaPrimeItem"),
    false,
    "Expected same-type live ammo consumption to avoid re-priming an already-live tuple charge",
  );
});

test("type-swapped tuple charge transitions queue the tuple repair after godma-prime", () => {
  const scourgeHeavy = resolveExactItem("Scourge Heavy Missile");
  const mjolnirHeavy = resolveExactItem("Mjolnir Heavy Missile");
  const notifications = [];
  const session = {
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncChargeSublocationTransitionForSession(session, {
    shipID: 990114054,
    flagID: 27,
    ownerID: 140000003,
    previousState: { typeID: scourgeHeavy.typeID, quantity: 12 },
    nextState: { typeID: mjolnirHeavy.typeID, quantity: 10 },
    primeNextCharge: true,
  });

  const tupleRow = notifications.find(
    (entry) => {
      if (!entry || entry.name !== "OnItemChange") {
        return false;
      }
      const itemID = readOnItemChangeItemID(entry);
      return (
        Array.isArray(itemID) &&
        Number(itemID[0]) === 990114054 &&
        Number(itemID[1]) === 27 &&
        Number(itemID[2]) === Number(mjolnirHeavy.typeID)
      );
    },
  );
  assert.equal(
    tupleRow,
    undefined,
    "Expected a live ammo type swap to defer the tuple-backed OnItemChange until the post-prime repair timer fires",
  );
  assert.equal(
    notifications.some((entry) => entry && entry.name === "OnGodmaPrimeItem"),
    true,
    "Expected a live ammo type swap to still godma-prime the new tuple charge item",
  );

  const timers =
    session._space && session._space._chargeSublocationReplayTimers instanceof Map
      ? [...session._space._chargeSublocationReplayTimers.values()]
      : [];
  assert.ok(
    timers.length > 0,
    "Expected a live ammo type swap to schedule a delayed tuple-backed repair",
  );
  for (const timer of timers) {
    clearTimeout(timer);
  }
});

test("refresh-only charge bootstrap stays on tuple-row repair only and schedules a delayed tuple repair", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "refresh-only",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  const immediateTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.ok(
    session._space._chargeBootstrapRepairTimer,
    "Expected refresh-only HUD charge recovery to schedule one delayed tuple-backed repair",
  );
  assert.equal(immediateTupleRepairs.length >= 1, true);
  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    false,
    "Expected refresh-only HUD charge recovery to avoid re-priming the tuple charge and stay on item-change repairs only",
  );
  assert.equal(
    readOnItemChangeKeys(immediateTupleRepairs[0]).includes(10),
    true,
    "Expected refresh-only HUD charge recovery to immediately restate the tuple row through ixStackSize repair data",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const delayedTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const latestTupleRepair = delayedTupleRepairs[delayedTupleRepairs.length - 1];

  assert.equal(
    delayedTupleRepairs.length >= (immediateTupleRepairs.length + 1),
    true,
    "Expected refresh-only HUD charge recovery to emit a final tuple-backed repair after the client's synthetic prime rows",
  );
  assert.deepEqual(
    readOnItemChangeKeys(latestTupleRepair),
    [3, 4, 10],
    "Expected the delayed refresh-only tuple repair to stay on the location/flag/stacksize contract",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("quantity-and-repair charge bootstrap skips tuple godma-prime but still sends quantity bootstrap before the delayed tuple repair", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "quantity-and-repair",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    false,
    "Expected quantity-and-repair HUD charge recovery to avoid re-priming the tuple charge when MakeShipActive already created it",
  );
  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnItemChange" &&
      JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
    )),
    false,
    "Expected quantity-and-repair HUD charge recovery to defer tuple row repair until after the delayed bootstrap tick",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const quantityChanges = extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === ATTRIBUTE_QUANTITY &&
    Number(change[5]) === Number(candidate.loadedCharge.stacksize ?? candidate.loadedCharge.quantity ?? 0)
  ));
  const delayedTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstQuantityBootstrapIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    extractModuleAttributeChanges([entry]).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    ))
  ));
  const firstTupleRepairIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    quantityChanges.length >= 1,
    true,
    "Expected quantity-and-repair HUD charge recovery to bootstrap tuple quantity through OnModuleAttributeChanges",
  );
  assert.equal(
    delayedTupleRepairs.length >= 1,
    true,
    "Expected quantity-and-repair HUD charge recovery to emit a delayed tuple-backed repair after the quantity bootstrap",
  );
  assert.equal(
    firstQuantityBootstrapIndex >= 0 && firstQuantityBootstrapIndex < firstTupleRepairIndex,
    true,
    "Expected the tuple quantity bootstrap to land before the delayed tuple row repair when tuple godma-prime is skipped",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("repair-then-quantity charge bootstrap skips tuple godma-prime and restates the tuple row before quantity", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "repair-then-quantity",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  const immediateTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    false,
    "Expected repair-then-quantity charge recovery to avoid re-priming the tuple charge",
  );
  assert.equal(
    immediateTupleRepairs.length >= 1,
    true,
    "Expected repair-then-quantity charge recovery to restate the tuple row immediately",
  );
  assert.equal(
    readOnItemChangeKeys(immediateTupleRepairs[0]).includes(10),
    true,
    "Expected repair-then-quantity charge recovery to keep the tuple row on ixStackSize repair data",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const quantityChanges = extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === ATTRIBUTE_QUANTITY &&
    Number(change[5]) === Number(candidate.loadedCharge.stacksize ?? candidate.loadedCharge.quantity ?? 0)
  ));
  const firstTupleRepairIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstQuantityBootstrapIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    extractModuleAttributeChanges([entry]).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    ))
  ));

  assert.equal(
    quantityChanges.length >= 1,
    true,
    "Expected repair-then-quantity charge recovery to bootstrap tuple quantity after the tuple row exists",
  );
  assert.equal(
    firstTupleRepairIndex >= 0 && firstTupleRepairIndex < firstQuantityBootstrapIndex,
    true,
    "Expected the tuple row repair to land before the tuple quantity bootstrap for login recovery",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("prime-and-repair charge bootstrap sends quantity bootstrap before the delayed tuple repair", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "prime-and-repair",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  const immediateTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    true,
    "Expected prime-and-repair HUD charge recovery to godma-prime the tuple charge first",
  );
  assert.equal(
    immediateTupleRepairs.length,
    0,
    "Expected prime-and-repair HUD charge recovery to defer the tuple row repair until after the delayed bootstrap tick",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const quantityChanges = extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === ATTRIBUTE_QUANTITY &&
    Number(change[5]) === Number(candidate.loadedCharge.stacksize ?? candidate.loadedCharge.quantity ?? 0)
  ));
  const delayedTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstQuantityBootstrapIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    extractModuleAttributeChanges([entry]).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    ))
  ));
  const firstTupleRepairIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    quantityChanges.length >= 1,
    true,
    "Expected prime-and-repair HUD charge recovery to bootstrap tuple quantity through OnModuleAttributeChanges",
  );
  assert.equal(
    delayedTupleRepairs.length >= 1,
    true,
    "Expected prime-and-repair HUD charge recovery to emit a delayed tuple-backed repair after the quantity bootstrap",
  );
  assert.equal(
    firstQuantityBootstrapIndex >= 0 && firstQuantityBootstrapIndex < firstTupleRepairIndex,
    true,
    "Expected the tuple quantity bootstrap to land before the delayed tuple row repair",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("prime-repair-then-quantity charge bootstrap primes first, then repairs the tuple row before the follow-up quantity", async () => {
  const candidate = findLiveSpaceChargeBootstrapCandidate();
  const notifications = [];
  const session = {
    characterID: candidate.characterID,
    charid: candidate.characterID,
    shipID: candidate.shipID,
    shipid: candidate.shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncLoadedChargeDogmaBootstrapForSession(session, candidate.shipID, {
    mode: "prime-repair-then-quantity",
    refreshDelayMs: 20,
  });

  const tupleKey = [
    candidate.shipID,
    candidate.loadedCharge.flagID,
    candidate.loadedCharge.typeID,
  ];
  const immediateTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));

  assert.equal(
    notifications.some((entry) => (
      entry &&
      entry.name === "OnGodmaPrimeItem" &&
      JSON.stringify(readOnGodmaPrimeTupleItemID(entry)) === JSON.stringify(tupleKey)
    )),
    true,
    "Expected prime-repair-then-quantity HUD charge recovery to godma-prime the tuple charge first",
  );
  assert.equal(
    immediateTupleRepairs.length,
    0,
    "Expected prime-repair-then-quantity HUD charge recovery to defer the tuple row repair until after the delayed bootstrap tick",
  );

  await new Promise((resolve) => setTimeout(resolve, 35));

  const quantityChanges = extractModuleAttributeChanges(notifications).filter((change) => (
    Array.isArray(change) &&
    JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
    Number(change[3]) === ATTRIBUTE_QUANTITY &&
    Number(change[5]) === Number(candidate.loadedCharge.stacksize ?? candidate.loadedCharge.quantity ?? 0)
  ));
  const delayedTupleRepairs = notifications.filter((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstTupleRepairIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstQuantityBootstrapIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnModuleAttributeChanges" &&
    extractModuleAttributeChanges([entry]).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify(tupleKey) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    ))
  ));

  assert.equal(
    delayedTupleRepairs.length >= 1,
    true,
    "Expected prime-repair-then-quantity HUD charge recovery to emit a delayed tuple-backed repair after the godma-prime",
  );
  assert.equal(
    quantityChanges.length >= 1,
    true,
    "Expected prime-repair-then-quantity HUD charge recovery to resend tuple quantity after the repaired row",
  );
  assert.equal(
    firstTupleRepairIndex >= 0 && firstTupleRepairIndex < firstQuantityBootstrapIndex,
    true,
    "Expected the repaired tuple row to land before the follow-up tuple quantity in prime-repair-then-quantity mode",
  );

  if (session._space._chargeBootstrapRepairTimer) {
    clearTimeout(session._space._chargeBootstrapRepairTimer);
    session._space._chargeBootstrapRepairTimer = null;
  }
});

test("real HUD charge-row sessions restate the integer charge row after a same-ammo live charge transition", () => {
  const shipID = 990114999;
  const flagID = 27;
  const charge = buildLoadedCharge(
    "Baryon Exotic Plasma L",
    990115000,
    shipID,
    flagID,
    481,
  );
  const notifications = [];
  const session = {
    characterID: 9000001,
    charid: 9000001,
    shipID,
    shipid: shipID,
    _space: {
      useRealChargeInventoryHudRows: true,
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  const notified = runtimeTesting.notifyRuntimeChargeTransitionToSessionForTesting(
    session,
    shipID,
    flagID,
    {
      typeID: charge.typeID,
      quantity: 481,
    },
    {
      typeID: charge.typeID,
      quantity: 480,
    },
    session.characterID,
    {
      previousChargeItem: charge,
      nextChargeItem: {
        ...charge,
        quantity: 480,
        stacksize: 480,
      },
    },
  );

  assert.equal(notified, true);

  const tupleKey = [shipID, flagID, charge.typeID];
  const firstTupleReplayIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(tupleKey)
  ));
  const firstRealRowReplayIndex = notifications.findIndex((entry) => (
    entry &&
    entry.name === "OnItemChange" &&
    Number(readOnItemChangeItemID(entry)) === Number(charge.itemID)
  ));

  assert.equal(
    firstTupleReplayIndex >= 0,
    true,
    "Expected the live tuple charge transition to keep the dogma tuple lane updated",
  );
  assert.equal(
    firstRealRowReplayIndex >= 0,
    true,
    "Expected the real loaded charge HUD row to be restated after the tuple transition",
  );
  assert.equal(
    firstTupleReplayIndex < firstRealRowReplayIndex,
    true,
    "Expected the real charge-row replay to land after the tuple transition so the HUD stays bound to the integer item",
  );

  const realRowFields = readOnItemChangeFields(notifications[firstRealRowReplayIndex]);
  assert.equal(Number(realRowFields.itemID), Number(charge.itemID));
  assert.equal(Number(realRowFields.stacksize), 480);
  assert.equal(Number(realRowFields.quantity), 480);
});

test("real HUD reload transitions finish on the integer charge row after the delayed tuple finalize", async () => {
  const shipID = 990115100;
  const flagID = 27;
  const previousCharge = buildLoadedCharge(
    "Baryon Exotic Plasma L",
    990115101,
    shipID,
    flagID,
    300,
  );
  const nextCharge = buildLoadedCharge(
    "Meson Exotic Plasma L",
    990115102,
    shipID,
    flagID,
    500,
  );
  const notifications = [];
  const session = {
    characterID: 9000001,
    charid: 9000001,
    shipID,
    shipid: shipID,
    _space: {
      useRealChargeInventoryHudRows: true,
    },
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  const dogma = new DogmaService();

  dogma._notifyChargeQuantityTransition(
    session,
    session.characterID,
    shipID,
    flagID,
    {
      typeID: previousCharge.typeID,
      quantity: 300,
    },
    {
      typeID: nextCharge.typeID,
      quantity: 500,
    },
    {
      forceTupleRepair: true,
      previousChargeItem: previousCharge,
      nextChargeItem: nextCharge,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 180));

  const nextTupleKey = [shipID, flagID, nextCharge.typeID];
  const lastNextTupleReplayIndex = notifications.reduce((index, entry, entryIndex) => (
    entry &&
    entry.name === "OnItemChange" &&
    JSON.stringify(readOnItemChangeItemID(entry)) === JSON.stringify(nextTupleKey)
      ? entryIndex
      : index
  ), -1);
  const lastRealRowReplayIndex = notifications.reduce((index, entry, entryIndex) => (
    entry &&
    entry.name === "OnItemChange" &&
    Number(readOnItemChangeItemID(entry)) === Number(nextCharge.itemID)
      ? entryIndex
      : index
  ), -1);

  assert.equal(
    lastNextTupleReplayIndex >= 0,
    true,
    "Expected reload charge transitions to keep the tuple dogma lane updated",
  );
  assert.equal(
    lastRealRowReplayIndex >= 0,
    true,
    "Expected reload charge transitions to restate the real loaded charge row",
  );
  assert.equal(
    lastNextTupleReplayIndex < lastRealRowReplayIndex,
    true,
    "Expected the real charge-row replay to land after the delayed tuple finalize so tooltips stay bound to the integer row",
  );

  const finalRealRowFields = readOnItemChangeFields(
    notifications[lastRealRowReplayIndex],
  );
  assert.equal(Number(finalRealRowFields.itemID), Number(nextCharge.itemID));
  assert.equal(Number(finalRealRowFields.stacksize), 500);
  assert.equal(Number(finalRealRowFields.quantity), 500);
});

test("slot unload cancels any pending delayed tuple replay for that rack flag", async () => {
  const chargeType = resolveExactItem("Mjolnir Light Missile");
  const shipID = 990119999;
  const flagID = 27;
  const notifications = [];
  const session = {
    characterID: 9000001,
    charid: 9000001,
    shipID,
    shipid: shipID,
    _space: {},
    socket: { destroyed: false },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };

  syncChargeSublocationTransitionForSession(session, {
    shipID,
    flagID,
    ownerID: session.characterID,
    previousState: { typeID: 0, quantity: 0 },
    nextState: { typeID: chargeType.typeID, quantity: 40 },
    primeNextCharge: true,
    nextChargeRepairDelayMs: 20,
  });

  assert.ok(
    session._space._chargeSublocationReplayTimers instanceof Map &&
      session._space._chargeSublocationReplayTimers.has(`${shipID}:${flagID}`),
    "Expected charge recovery to schedule a delayed tuple replay",
  );

  syncChargeSublocationTransitionForSession(session, {
    shipID,
    flagID,
    ownerID: session.characterID,
    previousState: { typeID: chargeType.typeID, quantity: 40 },
    nextState: { typeID: 0, quantity: 0 },
  });

  assert.equal(
    session._space._chargeSublocationReplayTimers.has(`${shipID}:${flagID}`),
    false,
    "Expected slot unload to cancel the pending tuple replay timer",
  );

  const immediateNotificationCount = notifications.length;
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(
    notifications.length,
    immediateNotificationCount,
    "Expected no delayed tuple replay to survive after the slot was unloaded",
  );
  assert.equal(
    extractModuleAttributeChanges(notifications).some((change) => (
      Array.isArray(change) &&
      JSON.stringify(change[2]) === JSON.stringify([shipID, flagID, chargeType.typeID]) &&
      Number(change[3]) === ATTRIBUTE_QUANTITY
    )),
    false,
    "Expected unload to suppress stale tuple quantity replays for the removed charge",
  );
});
