/**
 * Corporation Service (corporationSvc)
 *
 * Handles corporation-related queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildRow,
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getCorporationInfoRecord,
} = require(path.join(__dirname, "./corporationState"));

function resolveCharacterInfo(args, session) {
  const charId =
    args && args.length > 0 ? args[0] : session ? session.characterID : 0;

  return {
    charId,
    charData: getCharacterRecord(charId) || {},
  };
}

function buildCorporationInfo(session, charData) {
  const corpId =
    charData.corporationID ||
    (session ? session.corporationID || session.corpid : 1000044);
  const info =
    getCorporationInfoRecord(corpId) || {
      corporationID: corpId,
      corporationName: "Your Corp Name",
      ticker: "TICKR",
      tickerName: "TICKR",
      ceoID: (session && (session.characterID || session.charid)) || null,
      creatorID: (session && (session.characterID || session.charid)) || null,
      allianceID:
        charData.allianceID || (session ? session.allianceID || session.allianceid : null),
      memberCount: 1,
      shares: 1000,
      deleted: 0,
      stationID: null,
      taxRate: 0.0,
      description: "A custom corporation.",
      url: "",
      loyaltyPointTaxRate: 0.0,
      friendlyFire: 0,
    };
  const row = [
    info.corporationID,
    info.corporationName,
    info.ticker,
    info.ceoID,
    1,
  ];

  return buildKeyVal([
    ["corporationID", info.corporationID],
    ["corporationName", info.corporationName],
    ["ticker", info.ticker],
    ["tickerName", info.tickerName || info.ticker],
    ["allianceID", info.allianceID],
    ["ceoID", info.ceoID],
    ["creatorID", info.creatorID],
    ["membership", 1],
    ["shares", info.shares],
    ["deleted", info.deleted],
    ["stationID", info.stationID],
    ["header", ["corporationID", "corporationName", "ticker", "ceoID", "membership"]],
    ["row", row],
    ["line", row],
    ["memberCount", info.memberCount],
    ["taxRate", info.taxRate],
    ["loyaltyPointTaxRate", info.loyaltyPointTaxRate || 0.0],
    ["friendlyFire", info.friendlyFire || 0],
    ["shape1", info.shape1 ?? null],
    ["shape2", info.shape2 ?? null],
    ["shape3", info.shape3 ?? null],
    ["color1", info.color1 ?? null],
    ["color2", info.color2 ?? null],
    ["color3", info.color3 ?? null],
    ["typeface", info.typeface ?? null],
    ["description", info.description || ""],
    ["url", info.url || ""],
  ]);
}

function buildMedalInfoRowset(medals = []) {
  return buildRowset(
    [
      "medalID",
      "issuerID",
      "ownerID",
      "status",
      "reason",
      "date",
      "isDeleted",
    ],
    medals.map((entry) =>
      buildList([
        Number(entry.medalID || 0),
        Number(entry.issuerID || 0),
        Number(entry.ownerID || 0),
        Number(entry.status ?? 3),
        entry.reason || "",
        buildFiletimeLong(entry.date || entry.issueDate || entry.createdAt || 0n),
        entry.isDeleted ? 1 : 0,
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function buildMedalGraphicsRowset(medalGraphics = []) {
  return buildRowset(
    [
      "medalID",
      "part",
      "graphic",
      "color",
    ],
    medalGraphics.map((entry) =>
      buildList([
        Number(entry.medalID || 0),
        Number(entry.part || 0),
        Number(entry.graphic || entry.graphicID || 0),
        Number(entry.color || entry.colorID || 0),
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

class CorpService extends BaseService {
  constructor() {
    super("corporationSvc");
  }

  Handle_GetMyCorporationInfo(args, session) {
    log.debug("[CorpSvc] GetMyCorporationInfo");
    const { charData } = resolveCharacterInfo(args, session);
    return buildCorporationInfo(session, charData);
  }

  Handle_GetNPCDivisions() {
    log.debug("[CorpSvc] GetNPCDivisions");
    return { type: "list", items: [] };
  }

  Handle_GetEmploymentRecord(args, session) {
    log.debug("[CorpSvc] GetEmploymentRecord");
    const { charData } = resolveCharacterInfo(args, session);
    const history = Array.isArray(charData.employmentHistory)
      ? charData.employmentHistory
      : [
          {
            corporationID:
              charData.corporationID || (session ? session.corporationID : 1000044),
            startDate: charData.startDateTime || charData.createDateTime,
            deleted: 0,
          },
        ];
    const sortedHistory = history
      .slice()
      .sort((left, right) =>
        String(right && right.startDate ? right.startDate : "").localeCompare(
          String(left && left.startDate ? left.startDate : ""),
        ),
      );
    return buildRowset(
      ["corporationID", "startDate", "deleted"],
      sortedHistory.map((entry) =>
        buildList([
          Number(entry.corporationID) ||
            charData.corporationID ||
            (session ? session.corporationID : 1000044),
          buildFiletimeLong(entry.startDate || charData.startDateTime || charData.createDateTime),
          entry.deleted ? 1 : 0,
        ]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetRecruitmentAdsByCriteria() {
    log.debug("[CorpSvc] GetRecruitmentAdsByCriteria");
    return { type: "list", items: [] };
  }

  Handle_GetCorpInfo(args) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[CorpSvc] GetCorpInfo(${corporationID})`);
    const info = getCorporationInfoRecord(corporationID);
    if (!info) {
      return null;
    }

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
      ["solarSystemID", info.solarSystemID],
      ["shares", info.shares],
      ["deleted", info.deleted],
      ["url", info.url],
      ["taxRate", info.taxRate],
      ["loyaltyPointTaxRate", info.loyaltyPointTaxRate || 0.0],
      ["friendlyFire", info.friendlyFire || 0],
      ["memberCount", info.memberCount],
      ["isNPC", info.isNPC ? 1 : 0],
      ["shape1", info.shape1 ?? null],
      ["shape2", info.shape2 ?? null],
      ["shape3", info.shape3 ?? null],
      ["color1", info.color1 ?? null],
      ["color2", info.color2 ?? null],
      ["color3", info.color3 ?? null],
      ["typeface", info.typeface ?? null],
    ]);
  }

  Handle_GetEmployementRecordAndCharacterTransfers(args, session) {
    log.debug("[CorpSvc] GetEmployementRecordAndCharacterTransfers");
    return [this.Handle_GetEmploymentRecord(args, session), { type: "list", items: [] }];
  }

  Handle_GetMedalsReceived(args, session) {
    log.debug("[CorpSvc] GetMedalsReceived");
    const { charData } = resolveCharacterInfo(args, session);
    const medals = Array.isArray(charData.medalsReceived)
      ? charData.medalsReceived
      : [];
    const medalGraphics = Array.isArray(charData.medalGraphics)
      ? charData.medalGraphics
      : [];

    return [buildMedalInfoRowset(medals), buildMedalGraphicsRowset(medalGraphics)];
  }

  Handle_GetMedalDetails(args, session) {
    const medalID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[CorpSvc] GetMedalDetails(${medalID})`);
    const { charData } = resolveCharacterInfo([], session);
    const medalDetails = Array.isArray(charData.medalsReceived)
      ? charData.medalsReceived.find((entry) => Number(entry.medalID || 0) === medalID)
      : null;

    return buildRow(
      ["medalID", "title", "description"],
      [
        medalID,
        medalDetails && medalDetails.title ? medalDetails.title : "",
        medalDetails && medalDetails.description ? medalDetails.description : "",
      ],
    );
  }

  Handle_GetInfoWindowDataForChar(args, session) {
    log.debug("[CorpSvc] GetInfoWindowDataForChar");
    const { charData } = resolveCharacterInfo(args, session);
    return buildKeyVal([
      ["corpID", charData.corporationID || (session ? session.corporationID : 1000044)],
      ["allianceID", charData.allianceID || (session ? session.allianceID : null)],
      ["title", charData.title || ""],
    ]);
  }
}

module.exports = CorpService;
