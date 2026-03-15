const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const { buildKeyVal } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  getCorporationPublicInfo,
} = require(path.join(__dirname, "./corporationState"));

function resolveCorporationInfo(corpID, session) {
  const numericCorpID = Number(corpID) || 0;
  const characterID =
    session && (session.characterID || session.charid) ? Number(session.characterID || session.charid) : 0;
  const charData = characterID ? getCharacterRecord(characterID) || {} : {};
  const publicInfo = getCorporationPublicInfo(numericCorpID);
  if (publicInfo) {
    return publicInfo;
  }

  return {
    corporationID: numericCorpID,
    corporationName:
      numericCorpID === Number(charData.corporationID || 0)
        ? "Your Corp Name"
        : `Corporation ${numericCorpID}`,
    ticker: "CORP",
    tickerName: "CORP",
    ceoID: numericCorpID === Number(charData.corporationID || 0) ? characterID || null : null,
    creatorID: numericCorpID === Number(charData.corporationID || 0) ? characterID || null : null,
    allianceID:
      numericCorpID === Number(charData.corporationID || 0)
        ? charData.allianceID || (session ? session.allianceID || session.allianceid : null)
        : null,
    description: "",
    stationID: null,
    shares: 1000,
    deleted: 0,
    url: "",
    taxRate: 0.0,
    loyaltyPointTaxRate: 0.0,
    friendlyFire: 0,
    memberCount: 1,
  };
}

class CorpMgrService extends BaseService {
  constructor() {
    super("corpmgr");
  }

  Handle_GetPublicInfo(args, session) {
    const corpID = args && args.length > 0 ? args[0] : 0;
    const info = resolveCorporationInfo(corpID, session);
    log.debug(`[CorpMgr] GetPublicInfo(${info.corporationID})`);

    return buildKeyVal([
      ["corporationID", info.corporationID],
      ["corporationName", info.corporationName],
      ["ticker", info.ticker],
      ["tickerName", info.tickerName || info.ticker],
      ["ceoID", info.ceoID],
      ["creatorID", info.creatorID],
      ["allianceID", info.allianceID],
      ["description", info.description],
      ["stationID", info.stationID],
      ["shares", info.shares],
      ["deleted", info.deleted],
      ["url", info.url],
      ["taxRate", info.taxRate],
      ["loyaltyPointTaxRate", info.loyaltyPointTaxRate || 0.0],
      ["friendlyFire", info.friendlyFire || 0],
      ["memberCount", info.memberCount],
      ["shape1", info.shape1 ?? null],
      ["shape2", info.shape2 ?? null],
      ["shape3", info.shape3 ?? null],
      ["color1", info.color1 ?? null],
      ["color2", info.color2 ?? null],
      ["color3", info.color3 ?? null],
      ["typeface", info.typeface ?? null],
    ]);
  }

  Handle_GetCorporationIDForCharacter(args, session) {
    const charID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const charData = charID ? getCharacterRecord(charID) || {} : {};
    const corporationID =
      charData.corporationID || (session ? session.corporationID || session.corpid : 1000044);
    log.debug(`[CorpMgr] GetCorporationIDForCharacter(${charID}) -> ${corporationID}`);
    return corporationID;
  }
}

module.exports = CorpMgrService;
