const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));

const ACTIVE_CHARACTER_ID = 140000238;
const CONTROLLED_STRUCTURE_ID = 1030000000001;

function protoNumber(value) {
  if (value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value || 0);
}

function buildLiveControlledStructureSession() {
  return {
    characterID: ACTIVE_CHARACTER_ID,
    charid: ACTIVE_CHARACTER_ID,
    shipid: CONTROLLED_STRUCTURE_ID,
    shipID: CONTROLLED_STRUCTURE_ID,
    structureid: CONTROLLED_STRUCTURE_ID,
    structureID: CONTROLLED_STRUCTURE_ID,
    socket: {
      destroyed: false,
    },
  };
}

function buildGatewayEnvelope(
  typeName,
  payloadBuffer = Buffer.alloc(0),
  activeCharacterID = 0,
) {
  const envelope = publicGatewayLocal._testing.RequestEnvelope.create({
    payload: {
      type_url: `type.googleapis.com/${typeName}`,
      value: Buffer.from(payloadBuffer),
    },
    authoritative_context: activeCharacterID
      ? {
          active_character: { sequential: activeCharacterID },
          identity: {
            character: { sequential: activeCharacterID },
          },
        }
      : undefined,
  });
  return Buffer.from(
    publicGatewayLocal._testing.RequestEnvelope.encode(envelope).finish(),
  );
}

function decodeGatewayResponse(buffer) {
  return publicGatewayLocal._testing.ResponseEnvelope.decode(buffer);
}

test("controlled structures answer ship cosmetic state with a no-skin fallback", (t) => {
  const session = buildLiveControlledStructureSession();
  sessionRegistry.register(session);
  t.after(() => sessionRegistry.unregister(session));

  const state = publicGatewayLocal._testing.buildShipStateObject(
    CONTROLLED_STRUCTURE_ID,
    ACTIVE_CHARACTER_ID,
  );

  assert.ok(state, "expected controlled structure active ship to have state");
  assert.equal(protoNumber(state.character.sequential), ACTIVE_CHARACTER_ID);
  assert.equal(protoNumber(state.ship.sequential), CONTROLLED_STRUCTURE_ID);
  assert.deepEqual(state.skin, { no_skin: true });
});

test("unknown non-controlled ship cosmetic state still returns missing", () => {
  const missingState = publicGatewayLocal._testing.buildShipStateObject(
    CONTROLLED_STRUCTURE_ID + 100,
    ACTIVE_CHARACTER_ID,
  );

  assert.equal(missingState, null);
});

test("controlled structure cosmetic GetRequest returns 200 instead of 404", (t) => {
  const session = buildLiveControlledStructureSession();
  sessionRegistry.register(session);
  t.after(() => sessionRegistry.unregister(session));

  const protoRoot = publicGatewayLocal._testing.PROTO_ROOT;
  const requestType = protoRoot.lookupType(
    "eve_public.cosmetic.ship.api.GetRequest",
  );
  const responseType = protoRoot.lookupType(
    "eve_public.cosmetic.ship.api.GetResponse",
  );

  const requestPayload = Buffer.from(
    requestType
      .encode(
        requestType.create({
          ship: { sequential: CONTROLLED_STRUCTURE_ID },
        }),
      )
      .finish(),
  );

  const responseEnvelope = decodeGatewayResponse(
    publicGatewayLocal.buildGatewayResponseForRequest(
      buildGatewayEnvelope(
        "eve_public.cosmetic.ship.api.GetRequest",
        requestPayload,
        ACTIVE_CHARACTER_ID,
      ),
    ),
  );

  assert.equal(responseEnvelope.status_code, 200);
  assert.equal(
    responseEnvelope.payload.type_url,
    "type.googleapis.com/eve_public.cosmetic.ship.api.GetResponse",
  );

  const decoded = responseType.decode(Buffer.from(responseEnvelope.payload.value));
  assert.equal(protoNumber(decoded.state.ship.sequential), CONTROLLED_STRUCTURE_ID);
  assert.equal(decoded.state.skin.no_skin, true);
  assert.equal(decoded.state.skin.firstparty, null);
  assert.equal(decoded.state.skin.thirdparty, null);
});
