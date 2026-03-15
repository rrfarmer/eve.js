const assert = require("assert");
const path = require("path");

const BeyonceService = require(path.join(
  __dirname,
  "../../server/src/services/ship/beyonceService",
));
const spaceRuntime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));

function buildKwargs(entries) {
  return {
    type: "dict",
    entries,
  };
}

function main() {
  const service = new BeyonceService();
  const session = {
    characterID: 140000001,
  };
  const originalAlignTo = spaceRuntime.alignTo;
  const calls = [];

  spaceRuntime.alignTo = (activeSession, targetID) => {
    calls.push({
      characterID: activeSession && activeSession.characterID,
      targetID,
    });
    return true;
  };

  try {
    service.Handle_CmdAlignTo(
      [],
      session,
      buildKwargs([
        ["dstID", 50000403],
        ["bookmarkID", null],
      ]),
    );
    assert.strictEqual(calls[0].targetID, 50000403, "dstID kwarg should drive align target");

    service.Handle_CmdAlignTo(
      [],
      session,
      buildKwargs([
        ["dstID", null],
        ["bookmarkID", 140000001001],
      ]),
    );
    assert.strictEqual(calls[1].targetID, 60003760, "bookmarkID should resolve to bookmark itemID");

    service.Handle_CmdAlignTo([40169062], session, null);
    assert.strictEqual(calls[2].targetID, 40169062, "positional target should still work");

    console.log(JSON.stringify({
      ok: true,
      calls,
    }, null, 2));
  } finally {
    spaceRuntime.alignTo = originalAlignTo;
  }
}

main();
