const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const EssMgrService = require(path.join(
  repoRoot,
  "server/src/services/dynamic/essMgrService",
));

test("essMgr registers under the retail client service name", () => {
  const service = new EssMgrService();

  assert.equal(service.name, "essMgr");
});

test("essMgr returns offline ESS data for the current solar system", () => {
  const service = new EssMgrService();
  const session = {
    solarsystemid2: 30000142,
  };

  assert.equal(service.Handle_GetDataForClientSolarSystem([], session), null);
  assert.equal(
    service.callMethod("GetDataForClientSolarSystem", [], session),
    null,
  );
});

test("essMgr exposes disabled reserve bank and empty theft histories", () => {
  const service = new EssMgrService();

  assert.equal(service.Handle_IsClientLinkedToReserveBank(), false);
  assert.deepEqual(service.Handle_GetMainBankTheftsForClientSolarSystem(), []);
  assert.deepEqual(service.Handle_GetReserveBankTheftsForClientSolarSystem(), []);
});

test("essMgr link and unlock operations are no-op handlers", () => {
  const service = new EssMgrService();

  assert.equal(service.Handle_AttemptLinkToMainBank(), null);
  assert.equal(service.Handle_AttemptLinkToReserveBank(), null);
  assert.equal(service.Handle_RequestMainBankUnlink(), null);
  assert.equal(service.Handle_RequestReserveBankUnlink(), null);
  assert.equal(service.Handle_RequestUnlockReserveBank([12345]), null);
});