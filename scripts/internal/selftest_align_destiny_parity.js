const assert = require("assert");
const path = require("path");

const spaceRuntime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));
const destiny = require(path.join(
  __dirname,
  "../../server/src/space/destiny",
));

function main() {
  const entity = {
    itemID: 140000147,
    speedFraction: 0.75,
  };
  const direction = { x: -0.9, y: 0, z: 0.4 };
  const updates = spaceRuntime._testing.buildDirectedMovementUpdatesForTesting(
    entity,
    direction,
    true,
    1773532114,
  );

  assert.strictEqual(
    typeof destiny.buildAlignToPayload,
    "undefined",
    "AlignTo should not be exported as a Destiny payload builder",
  );
  assert.strictEqual(updates.length, 2, "Align dispatch should include direction and speed");
  assert.strictEqual(updates[0].payload[0], "GotoDirection", "Align should emit GotoDirection");
  assert.deepStrictEqual(
    updates[0].payload[1][0],
    entity.itemID,
    "GotoDirection should target the aligning ship",
  );
  assert.strictEqual(updates[1].payload[0], "SetSpeedFraction", "Align should keep using SetSpeedFraction when needed");

  console.log(JSON.stringify({
    ok: true,
    updateNames: updates.map((update) => update.payload[0]),
    firstPayload: updates[0].payload,
  }, null, 2));
}

main();
