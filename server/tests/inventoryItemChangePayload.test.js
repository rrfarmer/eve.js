const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const {
  buildItemChangePayload,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

function extractChangeKeys(payload) {
  const changeDict = Array.isArray(payload) ? payload[1] : null;
  if (!changeDict || changeDict.type !== "dict" || !Array.isArray(changeDict.entries)) {
    return [];
  }
  return changeDict.entries
    .map((entry) => Number(Array.isArray(entry) ? entry[0] : 0) || 0)
    .filter((key) => key > 0)
    .sort((left, right) => left - right);
}

function extractChangeEntryMap(payload) {
  const changeDict = Array.isArray(payload) ? payload[1] : null;
  return new Map(
    changeDict && changeDict.type === "dict" && Array.isArray(changeDict.entries)
      ? changeDict.entries
      : [],
  );
}

function extractRowDescriptorColumns(payload) {
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.header &&
    Array.isArray(row.header.header) &&
    Array.isArray(row.header.header[1]) &&
    Array.isArray(row.header.header[1][0])
    ? row.header.header[1][0].map((column) =>
      Array.isArray(column) ? String(column[0]) : String(column),
    )
      : [];
}

function extractRowDescriptorColumnPairs(payload) {
  const row = Array.isArray(payload) ? payload[0] : null;
  return row &&
    row.header &&
    Array.isArray(row.header.header) &&
    Array.isArray(row.header.header[1]) &&
    Array.isArray(row.header.header[1][0])
    ? row.header.header[1][0].map((column) => [
      Array.isArray(column) ? String(column[0]) : String(column),
      Array.isArray(column) ? Number(column[1]) : NaN,
    ])
    : [];
}

function extractRowFields(payload) {
  const row = Array.isArray(payload) ? payload[0] : null;
  return row && row.fields && typeof row.fields === "object" ? row.fields : {};
}

test("stackable inventory item changes prefer ixStackSize over ixQuantity", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 990001,
      typeID: 34,
      ownerID: 140000004,
      locationID: 990101212,
      flagID: 5,
      quantity: 4,
      stacksize: 4,
      singleton: 0,
      groupID: 18,
      categoryID: 8,
      customInfo: "",
    },
    {
      locationID: 990101212,
      flagID: 5,
      quantity: 5,
      stacksize: 5,
      singleton: 0,
    },
  );

  assert.deepEqual(
    extractChangeKeys(payload),
    [10],
    "Expected stackable cargo updates to advertise ixStackSize only",
  );
});

test("singleton inventory item changes still keep their non-quantity deltas", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 990002,
      typeID: 594,
      ownerID: 140000004,
      locationID: 990101212,
      flagID: 27,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
      groupID: 53,
      categoryID: 7,
      customInfo: "",
    },
    {
      locationID: 60003760,
      flagID: 27,
      quantity: -1,
      stacksize: 1,
      singleton: 1,
    },
  );

  assert.deepEqual(
    extractChangeKeys(payload),
    [3],
    "Expected singleton item moves to keep their location delta intact",
  );
});

test("inventory item changes marshal when locationID exceeds int32", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 980400000000,
      typeID: 34,
      ownerID: 1000134,
      locationID: 980300000000,
      flagID: 4,
      quantity: 10,
      stacksize: 10,
      singleton: 0,
      groupID: 18,
      categoryID: 4,
      customInfo: "",
    },
    {
      locationID: 980300000000,
      flagID: 4,
      quantity: 12,
      stacksize: 12,
      singleton: 0,
    },
  );

  assert.doesNotThrow(
    () => marshalEncode(payload),
    "Expected large wreck-backed location IDs to marshal in item change payloads",
  );
});

test("inventory item change rows keep CCP customInfo-stacksize-singleton order and normalize singleton drone fields", () => {
  const payload = buildItemChangePayload(
    {
      itemID: 991003770,
      typeID: 2203,
      ownerID: 140000013,
      locationID: 991003768,
      flagID: 87,
      quantity: null,
      stacksize: null,
      singleton: 1,
      groupID: 100,
      categoryID: 18,
      customInfo: null,
    },
    {},
  );

  assert.deepEqual(
    extractRowDescriptorColumns(payload),
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
    "Expected OnItemChange inventory rows to stay on the same customInfo-stacksize-singleton order as invbroker rows",
  );
  assert.deepEqual(
    extractRowDescriptorColumnPairs(payload),
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
    "Expected normal OnItemChange inventory rows to keep concrete singleton/stacksize DB types",
  );

  const fields = extractRowFields(payload);
  assert.equal(fields.customInfo, "");
  assert.equal(fields.quantity, -1);
  assert.equal(fields.stacksize, 1);
  assert.equal(fields.singleton, 1);
});

test("structure self item changes are parented to the solar system", () => {
  const originalGetStructureByID = structureState.getStructureByID;
  const structureID = 1030999900001;
  const solarSystemID = 30000144;
  const ownerCorpID = 98000004;

  structureState.getStructureByID = (requestedID, options = {}) => {
    if (Number(requestedID) !== structureID) {
      return originalGetStructureByID.call(structureState, requestedID, options);
    }
    return {
      structureID,
      typeID: 35832,
      itemName: "Payload Test Astrahus",
      ownerCorpID,
      ownerID: ownerCorpID,
      solarSystemID,
    };
  };

  try {
    const payload = buildItemChangePayload(
      {
        itemID: structureID,
        typeID: 35832,
        ownerID: ownerCorpID,
        locationID: structureID,
        flagID: 0,
        quantity: 1,
        stacksize: 1,
        singleton: 1,
        groupID: 1657,
        categoryID: 65,
        customInfo: "",
      },
      {
        locationID: structureID,
        flagID: 0,
        quantity: 1,
        stacksize: 1,
        singleton: 1,
      },
    );

    const fields = extractRowFields(payload);
    assert.equal(fields.itemID, structureID);
    assert.equal(fields.typeID, 35832);
    assert.equal(fields.ownerID, ownerCorpID);
    assert.equal(fields.locationID, solarSystemID);
    assert.notEqual(fields.locationID, structureID);
    assert.equal(fields.flagID, 0);
    assert.equal(fields.groupID, 1657);
    assert.equal(fields.categoryID, 65);
    assert.equal(fields.customInfo, "Payload Test Astrahus");
    assert.equal(fields.stacksize, 1);
    assert.equal(fields.singleton, 1);
    assert.ok(
      !extractChangeKeys(payload).includes(3),
      "Expected normalized structure self rows to avoid advertising the old self-parent location",
    );
  } finally {
    structureState.getStructureByID = originalGetStructureByID;
  }
});

test("structure self cache repair can target a stale self-parented cache entry", () => {
  const originalGetStructureByID = structureState.getStructureByID;
  const structureID = 1030999900003;
  const solarSystemID = 30000144;
  const ownerCorpID = 98000004;

  structureState.getStructureByID = (requestedID, options = {}) => {
    if (Number(requestedID) !== structureID) {
      return originalGetStructureByID.call(structureState, requestedID, options);
    }
    return {
      structureID,
      typeID: 35832,
      itemName: "Cache Repair Astrahus",
      ownerCorpID,
      ownerID: ownerCorpID,
      solarSystemID,
    };
  };

  try {
    const payload = buildItemChangePayload(
      {
        itemID: structureID,
        typeID: 35832,
        ownerID: ownerCorpID,
        locationID: structureID,
        flagID: 0,
        quantity: 1,
        stacksize: 1,
        singleton: 1,
        groupID: 1657,
        categoryID: 65,
        customInfo: "",
      },
      {
        locationID: structureID,
        flagID: 0,
        quantity: 1,
        stacksize: 1,
        singleton: 1,
      },
      {
        preserveStructureSelfPreviousLocation: true,
      },
    );

    const fields = extractRowFields(payload);
    const changes = extractChangeEntryMap(payload);
    assert.equal(fields.itemID, structureID);
    assert.equal(fields.locationID, solarSystemID);
    assert.notEqual(fields.locationID, structureID);
    assert.equal(changes.get(3), structureID);
  } finally {
    structureState.getStructureByID = originalGetStructureByID;
  }
});

test("structure bay item changes keep the structure as their location", () => {
  const originalGetStructureByID = structureState.getStructureByID;
  const structureID = 1030999900002;
  const childItemID = 2990999900002;

  structureState.getStructureByID = (requestedID, options = {}) => {
    if (Number(requestedID) !== structureID) {
      return originalGetStructureByID.call(structureState, requestedID, options);
    }
    return {
      structureID,
      typeID: 35832,
      itemName: "Bay Content Test Astrahus",
      ownerCorpID: 98000004,
      ownerID: 98000004,
      solarSystemID: 30000144,
    };
  };

  try {
    const payload = buildItemChangePayload(
      {
        itemID: childItemID,
        typeID: 4246,
        ownerID: 98000004,
        locationID: structureID,
        flagID: 172,
        quantity: 40,
        stacksize: 40,
        singleton: 0,
        groupID: 1136,
        categoryID: 4,
        customInfo: "",
      },
      {
        locationID: structureID,
        flagID: 4,
        quantity: 40,
        stacksize: 40,
        singleton: 0,
      },
    );

    const fields = extractRowFields(payload);
    assert.equal(fields.itemID, childItemID);
    assert.equal(fields.locationID, structureID);
    assert.equal(fields.flagID, 172);
    assert.deepEqual(
      extractChangeKeys(payload),
      [4],
      "Expected bay contents to keep normal inventory deltas",
    );
  } finally {
    structureState.getStructureByID = originalGetStructureByID;
  }
});
