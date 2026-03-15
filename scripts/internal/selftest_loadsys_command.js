const assert = require("assert");
const path = require("path");

const { executeChatCommand } = require(path.join(
  __dirname,
  "../../server/src/services/chat/chatCommands",
));
const worldData = require(path.join(
  __dirname,
  "../../server/src/space/worldData",
));
const spaceRuntime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));

const TEST_SYSTEM_ID = 30000142;

function main() {
  const stargates = worldData.getStargatesForSystem(TEST_SYSTEM_ID);
  const destinationSystemIDs = [...new Set(
    stargates
      .map((stargate) => Number(stargate.destinationSolarSystemID || 0))
      .filter((systemID) => Number.isInteger(systemID) && systemID > 0 && systemID !== TEST_SYSTEM_ID),
  )];
  assert(destinationSystemIDs.length > 0, "Test system should have destination gates");

  spaceRuntime._testing.clearScenes();

  const session = {
    characterID: 140000001,
    solarsystemid2: TEST_SYSTEM_ID,
  };

  try {
    const result = executeChatCommand(
      session,
      "/loadsys",
      null,
      { emitChatFeedback: false },
    );

    assert.strictEqual(result.handled, true, "Command should be handled");
    assert(
      result.message.includes("/loadsys"),
      "Feedback should mention the command",
    );
    assert(
      result.message.includes("loaded"),
      "Feedback should mention loaded systems",
    );
    for (const systemID of destinationSystemIDs) {
      assert(
        spaceRuntime.isSolarSystemSceneLoaded(systemID),
        `Destination system ${systemID} should be loaded`,
      );
    }

    console.log(JSON.stringify({
      ok: true,
      testSystemID: TEST_SYSTEM_ID,
      destinationSystemIDs,
      message: result.message,
    }, null, 2));
  } finally {
    spaceRuntime._testing.clearScenes();
  }
}

main();
