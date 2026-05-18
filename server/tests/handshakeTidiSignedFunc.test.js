const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const EVEHandshake = require(path.join(
  repoRoot,
  "server/src/network/tcp/handshake",
));
const { marshalDecode, strVal } = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function dictEntries(value) {
  assert.equal(value && value.type, "dict");
  return new Map(value.entries.map(([key, entryValue]) => [strVal(key), entryValue]));
}

test("stock client mode disables signedFunc injection", () => {
  const [payload, verification] =
    EVEHandshake._testing.buildClientSignedFuncTuple(12345, "stock");

  assert.deepEqual(payload, EVEHandshake._testing.MARSHALED_NONE);
  assert.equal(verification, false);
});

test("patched client mode keeps TiDi signedFunc injection", () => {
  const [payload, verification] =
    EVEHandshake._testing.buildClientSignedFuncTuple(12345, "patched");

  assert.notDeepEqual(payload, EVEHandshake._testing.MARSHALED_NONE);
  assert.equal(verification, false);
});

test("TiDi signedFunc snaps both into and out of TiDi", (t) => {
  const originalFlag = config.devHandshakeSeedSkillExtractorAccessToken;
  t.after(() => {
    config.devHandshakeSeedSkillExtractorAccessToken = originalFlag;
  });

  config.devHandshakeSeedSkillExtractorAccessToken = true;
  const source = EVEHandshake._testing.buildTidiSignedFuncSource();

  assert.match(source, /blue\.os\.dilationOverloadAdjustment = 0\.1/);
  assert.match(source, /blue\.os\.dilationUnderloadAdjustment = 1000(?:\.0)?/);
  assert.match(source, /blue\.os\.dilationOverloadAdjustment = 0\.8254/);
  assert.match(source, /blue\.os\.dilationUnderloadAdjustment = 1\.059254/);
  assert.match(source, /photoUploadSvc'\)\.Upload\(charID, photoData\)/);
  assert.match(
    source,
    /_evejs_photosvc\._evejs_original_add_portrait = _evejs_photosvc\.EvePhoto\.AddPortrait/,
  );
  assert.match(
    source,
    /def _evejs_add_portrait\(self, portraitPath, charID, _evejs_original_add_portrait=_evejs_photosvc\._evejs_original_add_portrait\):/,
  );
  assert.match(source, /PORTRAIT_UPLOAD_HANDLER:OK/);
  assert.match(source, /_evejs_connection = sm\.GetService\('connection'\)/);
  assert.match(source, /_evejs_connection\.accessToken = 'evejs-local-skill-extractor'/);
  assert.doesNotMatch(source, /_evejs_connection\.computerHash = 1/);
  assert.match(source, /SKILL_EXTRACTOR_ACCESS_TOKEN:OK/);
  assert.doesNotMatch(source, /INDUSTRY_CHARACTER_MODIFIER_FALLBACK:OK/);
  assert.doesNotMatch(
    source,
    /_evejs_clientdogma\.DogmaLocation\.GetIndustryCharacterModifiers = _evejs_get_industry_character_modifiers/,
  );
});

test("TiDi signedFunc omits the skill extractor token patch when disabled", (t) => {
  const originalFlag = config.devHandshakeSeedSkillExtractorAccessToken;
  t.after(() => {
    config.devHandshakeSeedSkillExtractorAccessToken = originalFlag;
  });

  config.devHandshakeSeedSkillExtractorAccessToken = false;
  const source = EVEHandshake._testing.buildTidiSignedFuncSource();

  assert.doesNotMatch(source, /SKILL_EXTRACTOR_ACCESS_TOKEN:OK/);
  assert.doesNotMatch(source, /_evejs_connection\.accessToken = 'evejs-local-skill-extractor'/);
  assert.doesNotMatch(source, /INDUSTRY_CHARACTER_MODIFIER_FALLBACK:OK/);
  assert.doesNotMatch(
    source,
    /_evejs_clientdogma\.DogmaLocation\.GetIndustryCharacterModifiers = _evejs_get_industry_character_modifiers/,
  );
});

test("CryptoHandshakeAck includes stock LoginSso token contract", () => {
  const writes = [];
  const handshake = new EVEHandshake({
    remoteAddress: "127.0.0.1",
    write: (packet) => writes.push(packet),
  });

  handshake.userId = 1;
  handshake.userName = "EVE-SSO-CONNECTION";
  handshake.clientId = 1000042;
  handshake.role = 1;
  handshake.languageId = "EN";
  handshake.countryCode = "US";
  handshake.accessToken = "local-sso-token";
  handshake.computerHash = null;
  handshake.sessionId = 123456789n;

  const result = handshake._handleFuncResult(["", Buffer.alloc(0), null]);

  assert.deepEqual(result, { done: true });
  assert.equal(writes.length, 1);

  const frame = writes[0];
  const decoded = marshalDecode(frame.slice(4));
  const entries = dictEntries(decoded);

  assert.equal(strVal(entries.get("access_token")), "local-sso-token");
  assert.equal(entries.get("computer_hash"), null);
  assert.equal(entries.get("session_init").type, "dict");
  assert.equal(entries.get("sessionID"), 123456789n);
});

test("auto-created accounts reserve the next free numeric account id above persisted references", (t) => {
  const originalAccounts = cloneValue(database.read("accounts", "/").data || {});
  const originalCharacters = cloneValue(database.read("characters", "/").data || {});
  const originalIdentityState = cloneValue(database.read("identityState", "/").data || {});

  t.after(() => {
    database.write("accounts", "/", originalAccounts, { force: true });
    database.write("characters", "/", originalCharacters, { force: true });
    database.write("identityState", "/", originalIdentityState, { force: true });
    database.flushAllSync();
  });

  database.write(
    "accounts",
    "/",
    {
      alpha: { id: 1 },
      gamma: { id: 3 },
    },
    { force: true },
  );
  database.write(
    "characters",
    "/",
    {
      140000099: {
        accountId: 9,
        characterName: "Stale Ownership",
      },
    },
    { force: true },
  );
  database.write(
    "identityState",
    "/",
    {
      version: 1,
      nextAccountID: 1,
      nextCharacterID: 140000001,
    },
    { force: true },
  );
  database.flushAllSync();

  assert.equal(EVEHandshake._testing.reserveAccountID(), 10);
});
