const assert = require("assert");
const path = require("path");

const ClientSession = require(path.join(
  __dirname,
  "../../server/src/network/clientSession",
));
const destiny = require(path.join(
  __dirname,
  "../../server/src/space/destiny",
));
const { MACHONETMSG_TYPE } = require(path.join(
  __dirname,
  "../../server/src/common/packetTypes",
));
const { marshalDecode } = require(path.join(
  __dirname,
  "../../server/src/network/tcp/utils/marshal",
));
const { decodePacket } = require(path.join(
  __dirname,
  "../../server/src/common/pyPacket",
));

function bufferToUtf8(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value && typeof value === "object" && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString("utf8");
  }
  return value;
}

function main() {
  let written = null;
  const socket = {
    destroyed: false,
    remoteAddress: "127.0.0.1",
    write(buffer) {
      written = buffer;
    },
  };

  const session = new ClientSession(
    {
      userId: 1,
      clientId: 65450,
      sessionId: 1n,
    },
    socket,
  );

  session.sendNotification(
    "DoDestinyUpdate",
    "clientID",
    destiny.buildDestinyUpdatePayload([
      {
        stamp: 1773524299,
        payload: destiny.buildOnSlimItemChangePayload(
          50001248,
          { type: "object", name: "fake.slim", args: [] },
        ),
      },
    ]),
  );

  assert(written, "Expected destiny notification packet to be written");
  const decodedPacket = decodePacket(marshalDecode(written.subarray(4)));
  assert(decodedPacket, "Expected to decode notification packet");
  assert.strictEqual(
    decodedPacket.type,
    MACHONETMSG_TYPE.NOTIFICATION,
    "Expected MACHONET notification",
  );
  assert.strictEqual(
    decodedPacket.dest.type,
    "broadcast",
    "Destiny updates should travel as a broadcast notification",
  );
  assert.strictEqual(
    bufferToUtf8(decodedPacket.dest.broadcastID),
    "DoDestinyUpdate",
    "Slim item changes should travel inside DoDestinyUpdate",
  );

  const innerPayload = marshalDecode(decodedPacket.payload[0][1]);
  assert(Array.isArray(innerPayload), "Expected wrapped notification payload array");
  assert.strictEqual(innerPayload[0], 1, "Expected broadcast-notify wrapper flag");
  const updates = innerPayload[1][0];
  assert(updates && updates.type === "list", "Expected list of destiny updates");
  assert.strictEqual(updates.items.length, 1, "Expected one slim item change update");
  const updatePayload = updates.items[0][1];
  assert.strictEqual(
    bufferToUtf8(updatePayload[0]),
    "OnSlimItemChange",
    "Expected OnSlimItemChange inside Destiny update stream",
  );
  assert.deepStrictEqual(
    updatePayload[1][0],
    50001248,
    "Expected itemID as first OnSlimItemChange payload argument",
  );

  console.log(JSON.stringify({
    ok: true,
    destType: decodedPacket.dest.type,
    broadcastID: bufferToUtf8(decodedPacket.dest.broadcastID),
    method: bufferToUtf8(updatePayload[0]),
    itemID: updatePayload[1][0],
  }, null, 2));
}

main();
