const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const publicGatewayLocal = require(path.join(
  __dirname,
  "../../server/src/_secondary/express/publicGatewayLocal",
));
const sessionRegistry = require(path.join(
  __dirname,
  "../../server/src/services/chat/sessionRegistry",
));
const {
  getCharacterRecord,
  getActiveShipRecord,
} = require(path.join(
  __dirname,
  "../../server/src/services/character/characterState",
));
const {
  findShipItemById,
  updateShipItem,
} = require(path.join(
  __dirname,
  "../../server/src/services/inventory/itemStore",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSpaceState(position) {
  return {
    systemID: 30000142,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    targetPoint: {
      x: position.x,
      y: position.y,
      z: position.z - 1000,
    },
    speedFraction: 0,
    mode: "STOP",
  };
}

function buildSession(characterID, shipItem) {
  const character = getCharacterRecord(characterID);
  assert(character, `Character ${characterID} not found`);

  return {
    clientID: shipItem.itemID,
    characterID,
    characterName: character.characterName || character.name || `Char ${characterID}`,
    corporationID: Number(character.corporationID || 0) || 0,
    allianceID: Number(character.allianceID || 0) || 0,
    warFactionID: Number(character.warFactionID || 0) || 0,
    shipName: shipItem.itemName || `Ship ${shipItem.itemID}`,
    socket: { destroyed: false },
    sendNotification() {},
  };
}

function getShipIDsFromStates(states) {
  return states
    .map((state) => Number(state && state.ship && state.ship.sequential) || 0)
    .filter(Boolean)
    .sort((left, right) => left - right);
}

function main() {
  const firstCharacterID = 140000001;
  const secondCharacterID = 140000002;
  const firstShip = cloneValue(getActiveShipRecord(firstCharacterID));
  const secondShip = cloneValue(getActiveShipRecord(secondCharacterID));
  assert(firstShip, `No active ship for character ${firstCharacterID}`);
  assert(secondShip, `No active ship for character ${secondCharacterID}`);

  const savedFirstShip = cloneValue(findShipItemById(firstShip.itemID));
  const savedSecondShip = cloneValue(findShipItemById(secondShip.itemID));
  assert(savedFirstShip, `Inventory ship ${firstShip.itemID} not found`);
  assert(savedSecondShip, `Inventory ship ${secondShip.itemID} not found`);

  const firstSession = buildSession(firstCharacterID, firstShip);
  const secondSession = buildSession(secondCharacterID, secondShip);

  firstShip.spaceState = buildSpaceState({
    x: -107303362560,
    y: -18744975360,
    z: 436789052160,
  });
  secondShip.spaceState = buildSpaceState({
    x: -107303342560,
    y: -18744975360,
    z: 436789062160,
  });

  let firstAttached = false;
  let secondAttached = false;
  let firstRegistered = false;
  let secondRegistered = false;

  try {
    runtime.ensureScene(30000142);
    runtime.attachSession(firstSession, firstShip, {
      systemID: 30000142,
      spawnStopped: true,
      skipLegacyStationNormalization: true,
    });
    firstAttached = true;
    runtime.attachSession(secondSession, secondShip, {
      systemID: 30000142,
      spawnStopped: true,
      skipLegacyStationNormalization: true,
    });
    secondAttached = true;

    sessionRegistry.register(firstSession);
    firstRegistered = true;
    sessionRegistry.register(secondSession);
    secondRegistered = true;

    const visibleTargets = publicGatewayLocal._testing.getObserverCharacterIDsForShip(
      firstShip.itemID,
    );
    assert.deepStrictEqual(
      visibleTargets,
      [firstCharacterID, secondCharacterID],
      "Live ship skin notice targets should include every visible observer",
    );

    const secondBubbleStates =
      publicGatewayLocal._testing.buildBubbleShipStatesForCharacter(secondCharacterID);
    const secondBubbleShipIDs = getShipIDsFromStates(secondBubbleStates);
    assert.deepStrictEqual(
      secondBubbleShipIDs,
      [firstShip.itemID, secondShip.itemID].sort((left, right) => left - right),
      "Observer GetAllInBubble should include visible remote ships",
    );

    console.log(JSON.stringify({
      ok: true,
      shipID: firstShip.itemID,
      observerCharacterIDs: visibleTargets,
      observerBubbleShipIDs: secondBubbleShipIDs,
    }, null, 2));
  } finally {
    if (firstRegistered) {
      sessionRegistry.unregister(firstSession);
    }
    if (secondRegistered) {
      sessionRegistry.unregister(secondSession);
    }
    if (firstAttached && firstSession._space) {
      runtime.detachSession(firstSession, { broadcast: false });
    }
    if (secondAttached && secondSession._space) {
      runtime.detachSession(secondSession, { broadcast: false });
    }

    const restoreFirstResult = updateShipItem(savedFirstShip.itemID, savedFirstShip);
    const restoreSecondResult = updateShipItem(savedSecondShip.itemID, savedSecondShip);
    assert(restoreFirstResult.success, "Failed to restore first ship after self-test");
    assert(restoreSecondResult.success, "Failed to restore second ship after self-test");
  }
}

main();
