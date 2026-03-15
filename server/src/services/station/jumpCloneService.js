const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildBoundObjectResponse,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function buildCloneState(session = null) {
  const charData = getCharacterRecord(session && session.characterID) || {};
  const clones = Array.isArray(charData.jumpClones) ? charData.jumpClones : [];
  const implants = Array.isArray(charData.implants) ? charData.implants : [];
  return buildKeyVal([
    [
      "clones",
      buildDict(
        clones.map((entry, index) => [
          Number(entry.cloneID || entry.itemID || index + 1),
          buildKeyVal([
            ["cloneID", Number(entry.cloneID || 0)],
            ["stationID", Number(entry.stationID || charData.cloneStationID || 0)],
            ["name", entry.name || ""],
          ]),
        ]),
      ),
    ],
    [
      "implants",
      buildDict(
        implants.map((entry, index) => [
          Number(entry.typeID || entry.itemID || index + 1),
          buildKeyVal([
            ["typeID", Number(entry.typeID || 0)],
            ["slot", Number(entry.slot || 0)],
            ["name", entry.name || ""],
          ]),
        ]),
      ),
    ],
    ["timeLastJump", buildFiletimeLong(charData.timeLastCloneJump || 0n)],
  ]);
}

class JumpCloneService extends BaseService {
  constructor() {
    super("jumpCloneSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[JumpCloneSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[JumpCloneSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetCloneState(args, session) {
    log.debug("[JumpCloneSvc] GetCloneState");
    return buildCloneState(session);
  }

  Handle_GetShipCloneState() {
    log.debug("[JumpCloneSvc] GetShipCloneState");
    return buildList([]);
  }

  Handle_GetPriceForClone() {
    log.debug("[JumpCloneSvc] GetPriceForClone");
    return 1000000;
  }

  Handle_InstallCloneInStation() {
    log.debug("[JumpCloneSvc] InstallCloneInStation");
    return null;
  }

  Handle_GetStationCloneState(args, session) {
    log.debug("[JumpCloneSvc] GetStationCloneState");
    return buildCloneState(session);
  }

  Handle_OfferShipCloneInstallation() {
    log.debug("[JumpCloneSvc] OfferShipCloneInstallation");
    return null;
  }

  Handle_DestroyInstalledClone() {
    log.debug("[JumpCloneSvc] DestroyInstalledClone");
    return null;
  }

  Handle_AcceptShipCloneInstallation() {
    log.debug("[JumpCloneSvc] AcceptShipCloneInstallation");
    return null;
  }

  Handle_CancelShipCloneInstallation() {
    log.debug("[JumpCloneSvc] CancelShipCloneInstallation");
    return null;
  }

  Handle_CloneJump() {
    log.debug("[JumpCloneSvc] CloneJump");
    return null;
  }
}

module.exports = JumpCloneService;
