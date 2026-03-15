const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const database = require(path.join(__dirname, "../../database"));
const {
  ALLIANCES_TABLE,
  getAllianceRecord,
  getAllianceOwnerRecord,
  getCharacterIDsInCorporation,
} = require(path.join(__dirname, "./corporationState"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  buildBoundObjectResponse,
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildRow,
  buildRowset,
  extractList,
  normalizeNumber,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const ALLIANCE_ROW_HEADER = [
  "allianceID",
  "allianceName",
  "shortName",
  "executorCorpID",
  "creatorCorpID",
  "creatorCharID",
  "description",
  "url",
  "startDate",
  "memberCount",
  "dictatorial",
  "allowWar",
  "currentCapital",
  "currentPrimeHour",
  "newPrimeHour",
  "newPrimeHourValidAfter",
  "deleted",
];

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = Number(value || 0);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return numericValue;
  }
  return fallback;
}

function resolveAllianceIDFromArgs(args, session) {
  const firstArg = args && args.length > 0 ? args[0] : null;
  const firstList = extractList(firstArg);
  if (firstList.length > 0) {
    return normalizePositiveInteger(firstList[0], null);
  }

  const directAllianceID = normalizePositiveInteger(firstArg, null);
  if (directAllianceID) {
    return directAllianceID;
  }

  return normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    null,
  );
}

function getAllAllianceRecords() {
  const result = database.read(ALLIANCES_TABLE, "/");
  const records =
    result.success &&
    result.data &&
    result.data.records &&
    typeof result.data.records === "object"
      ? result.data.records
      : {};

  return Object.keys(records)
    .map((allianceID) => getAllianceRecord(allianceID))
    .filter(Boolean)
    .sort((left, right) => Number(left.allianceID) - Number(right.allianceID));
}

function buildAllianceSummary(allianceRecord) {
  const creatorCorpID =
    normalizePositiveInteger(allianceRecord.creatorCorpID, null) ||
    normalizePositiveInteger(allianceRecord.executorCorporationID, null);
  const creatorCharID =
    normalizePositiveInteger(allianceRecord.creatorCharID, null) ||
    normalizePositiveInteger(allianceRecord.creatorID, null);

  return {
    allianceID: allianceRecord.allianceID,
    allianceName: allianceRecord.allianceName || `Alliance ${allianceRecord.allianceID}`,
    shortName: allianceRecord.shortName || "ALLY",
    executorCorpID: normalizePositiveInteger(
      allianceRecord.executorCorporationID,
      null,
    ),
    creatorCorpID,
    creatorCharID,
    description: allianceRecord.description || "",
    url: allianceRecord.url || "",
    startDate: buildFiletimeLong(allianceRecord.createdAt || 0n),
    memberCount: Number(allianceRecord.memberCount || 0),
    dictatorial: allianceRecord.dictatorial ? 1 : 0,
    allowWar:
      allianceRecord.allowWar === undefined || allianceRecord.allowWar === null
        ? 1
        : allianceRecord.allowWar ? 1 : 0,
    currentCapital: normalizePositiveInteger(allianceRecord.currentCapital, null),
    currentPrimeHour: Number(allianceRecord.currentPrimeHour || 0),
    newPrimeHour: Number(
      allianceRecord.newPrimeHour == null
        ? allianceRecord.currentPrimeHour || 0
        : allianceRecord.newPrimeHour,
    ),
    newPrimeHourValidAfter: buildFiletimeLong(
      allianceRecord.newPrimeHourValidAfter || 0n,
    ),
    deleted: allianceRecord.deleted ? 1 : 0,
    warFactionID: normalizePositiveInteger(allianceRecord.warFactionID, null),
  };
}

function buildAllianceRowPayload(allianceRecord) {
  const summary = buildAllianceSummary(allianceRecord);
  return buildRow(ALLIANCE_ROW_HEADER, [
    summary.allianceID,
    summary.allianceName,
    summary.shortName,
    summary.executorCorpID,
    summary.creatorCorpID,
    summary.creatorCharID,
    summary.description,
    summary.url,
    summary.startDate,
    summary.memberCount,
    summary.dictatorial,
    summary.allowWar,
    summary.currentCapital,
    summary.currentPrimeHour,
    summary.newPrimeHour,
    summary.newPrimeHourValidAfter,
    summary.deleted,
  ]);
}

function buildAllianceKeyValPayload(allianceRecord) {
  const summary = buildAllianceSummary(allianceRecord);
  return buildKeyVal(
    ALLIANCE_ROW_HEADER.map((fieldName) => [
      fieldName,
      summary[fieldName],
    ]).concat([
      ["__header__", ALLIANCE_ROW_HEADER],
      ["warFactionID", summary.warFactionID],
      ["currentCapitalSystem", summary.currentCapital],
      ["newCapitalSystem", null],
      ["newCapitalSystemValidAfter", buildFiletimeLong(0n)],
    ]),
  );
}

function buildAllianceMembersRowset(allianceRecord) {
  const memberCorporationIDs = Array.isArray(allianceRecord.memberCorporationIDs)
    ? allianceRecord.memberCorporationIDs
    : [];
  const defaultStartDate = allianceRecord.createdAt || 0n;

  return buildRowset(
    ["corporationID", "startDate", "deleted"],
    memberCorporationIDs.map((corporationID) =>
      buildList([
        normalizePositiveInteger(corporationID, 0) || 0,
        buildFiletimeLong(defaultStartDate),
        0,
      ]),
    ),
    "eve.common.script.sys.rowset.Rowset",
  );
}

function buildAllianceEmploymentHistory(allianceRecord) {
  return buildRowset(
    ["allianceID", "startDate", "deleted"],
    [
      buildList([
        allianceRecord.allianceID,
        buildFiletimeLong(allianceRecord.createdAt || 0n),
        allianceRecord.deleted ? 1 : 0,
      ]),
    ],
    "eve.common.script.sys.rowset.Rowset",
  );
}

function getCorporationAllianceStartDate(allianceRecord, corporationID) {
  const normalizedCorporationID = normalizePositiveInteger(corporationID, null);
  if (!normalizedCorporationID || !allianceRecord) {
    return 0n;
  }

  const memberCharacterIDs = getCharacterIDsInCorporation(normalizedCorporationID);
  const startDates = memberCharacterIDs
    .map((characterID) => getCharacterRecord(characterID))
    .map((record) => record && record.allianceMemberStartDate)
    .filter(Boolean)
    .map((value) => {
      try {
        return BigInt(value);
      } catch (error) {
        return 0n;
      }
    })
    .filter((value) => value > 0n);

  if (startDates.length > 0) {
    return startDates.sort((left, right) => (left < right ? -1 : 1))[0];
  }

  try {
    return BigInt(allianceRecord.createdAt || 0);
  } catch (error) {
    return 0n;
  }
}

function filetimeDaysSince(filetimeValue) {
  let rawValue = 0n;
  try {
    rawValue = BigInt(filetimeValue || 0);
  } catch (error) {
    rawValue = 0n;
  }

  if (rawValue <= 0n) {
    return 0;
  }

  const nowFiletime = BigInt(Date.now()) * 10000n + 116444736000000000n;
  const diff = nowFiletime - rawValue;
  if (diff <= 0n) {
    return 0;
  }

  const day = 864000000000n;
  return Number(diff / day);
}

class AllianceRegistryService extends BaseService {
  constructor() {
    super("allianceRegistry");
  }

  Handle_IsAllianceLocal(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const isLocal = Boolean(allianceID && getAllianceRecord(allianceID));
    log.debug(`[AllianceRegistry] IsAllianceLocal(${allianceID}) -> ${isLocal}`);
    return isLocal ? 1 : 0;
  }

  Handle_MachoResolveObject(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const allianceRecord = allianceID ? getAllianceRecord(allianceID) : null;
    log.debug(
      `[AllianceRegistry] MachoResolveObject allianceID=${allianceID} found=${Boolean(allianceRecord)}`,
    );
    return allianceRecord ? resolveBoundNodeId() : null;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const allianceRecord = allianceID ? getAllianceRecord(allianceID) : null;
    log.debug(
      `[AllianceRegistry] MachoBindObject allianceID=${allianceID} found=${Boolean(allianceRecord)}`,
    );
    if (!allianceRecord) {
      return null;
    }

    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetAlliance(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const allianceRecord = allianceID ? getAllianceRecord(allianceID) : null;
    log.debug(`[AllianceRegistry] GetAlliance(${allianceID})`);
    return allianceRecord ? buildAllianceRowPayload(allianceRecord) : null;
  }

  Handle_GetAlliancePublicInfo(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const allianceRecord = allianceID ? getAllianceRecord(allianceID) : null;
    log.debug(`[AllianceRegistry] GetAlliancePublicInfo(${allianceID})`);
    return allianceRecord ? buildAllianceKeyValPayload(allianceRecord) : null;
  }

  Handle_GetRankedAlliances(args) {
    const maxLen = Math.max(0, normalizeNumber(args && args[0], 100));
    log.debug(`[AllianceRegistry] GetRankedAlliances(${maxLen})`);
    const items = getAllAllianceRecords()
      .slice(0, maxLen === 0 ? undefined : maxLen)
      .map((record) => buildAllianceRowPayload(record));
    return {
      type: "list",
      items,
    };
  }

  Handle_GetAllianceMembers(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const allianceRecord = allianceID ? getAllianceRecord(allianceID) : null;
    log.debug(`[AllianceRegistry] GetAllianceMembers(${allianceID})`);
    return allianceRecord
      ? buildAllianceMembersRowset(allianceRecord)
      : buildRowset(
          ["corporationID", "startDate", "deleted"],
          [],
          "eve.common.script.sys.rowset.Rowset",
        );
  }

  Handle_GetMembers(args, session) {
    return this.Handle_GetAllianceMembers(args, session);
  }

  Handle_GetEmploymentRecord(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const allianceRecord = allianceID ? getAllianceRecord(allianceID) : null;
    log.debug(`[AllianceRegistry] GetEmploymentRecord(${allianceID})`);
    return allianceRecord
      ? buildAllianceEmploymentHistory(allianceRecord)
      : buildRowset(
          ["allianceID", "startDate", "deleted"],
          [],
          "eve.common.script.sys.rowset.Rowset",
        );
  }

  Handle_GetAllianceContacts() {
    log.debug("[AllianceRegistry] GetAllianceContacts()");
    return buildDict([]);
  }

  Handle_GetLabels() {
    log.debug("[AllianceRegistry] GetLabels()");
    return buildDict([]);
  }

  Handle_GetBulletins() {
    log.debug("[AllianceRegistry] GetBulletins()");
    return buildList([]);
  }

  Handle_GetApplications() {
    log.debug("[AllianceRegistry] GetApplications()");
    return buildDict([]);
  }

  Handle_GetRelationships() {
    log.debug("[AllianceRegistry] GetRelationships()");
    return buildDict([]);
  }

  Handle_GetCapitalSystemInfo(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const allianceRecord = allianceID ? getAllianceRecord(allianceID) : null;
    log.debug(`[AllianceRegistry] GetCapitalSystemInfo(${allianceID})`);
    return buildKeyVal([
      ["currentCapitalSystem", allianceRecord && allianceRecord.currentCapital ? allianceRecord.currentCapital : null],
      ["newCapitalSystem", null],
      ["newCapitalSystemValidAfter", buildFiletimeLong(0n)],
    ]);
  }

  Handle_GetDaysInAlliance(args, session) {
    const allianceID = normalizePositiveInteger(args && args[0], null);
    const corporationID = normalizePositiveInteger(args && args[1], null);
    const allianceRecord =
      allianceID || (session && (session.allianceID || session.allianceid))
        ? getAllianceRecord(allianceID || session.allianceID || session.allianceid)
        : null;
    const startDate = getCorporationAllianceStartDate(allianceRecord, corporationID);
    const days = filetimeDaysSince(startDate);
    log.debug(
      `[AllianceRegistry] GetDaysInAlliance(allianceID=${allianceID}, corporationID=${corporationID}) -> ${days}`,
    );
    return days;
  }

  Handle_GetAllianceMembersOlderThan(args, session) {
    const allianceID = normalizePositiveInteger(args && args[0], null);
    const minimumDays = Math.max(0, normalizeNumber(args && args[1], 0));
    const resolvedAllianceID =
      allianceID ||
      normalizePositiveInteger(session && (session.allianceID || session.allianceid), null);
    const allianceRecord = resolvedAllianceID
      ? getAllianceRecord(resolvedAllianceID)
      : null;

    const memberCorporationIDs = allianceRecord
      ? (Array.isArray(allianceRecord.memberCorporationIDs)
          ? allianceRecord.memberCorporationIDs
          : []
        ).filter((corporationID) => {
          const startDate = getCorporationAllianceStartDate(
            allianceRecord,
            corporationID,
          );
          return filetimeDaysSince(startDate) >= minimumDays;
        })
      : [];

    log.debug(
      `[AllianceRegistry] GetAllianceMembersOlderThan(allianceID=${resolvedAllianceID}, minimumDays=${minimumDays}) -> ${memberCorporationIDs.length}`,
    );

    return {
      type: "list",
      items: memberCorporationIDs.map((corporationID) =>
        normalizePositiveInteger(corporationID, 0) || 0,
      ),
    };
  }

  Handle_GetEveOwners(args) {
    const ownerIDs = extractList(args && args[0])
      .map((ownerID) => getAllianceOwnerRecord(ownerID))
      .filter(Boolean)
      .map((record) =>
        buildList([
          record.ownerID,
          record.ownerName,
          record.typeID,
          record.gender,
          null,
        ]),
      );

    if (ownerIDs.length === 0) {
      return [];
    }

    return [
      ["ownerID", "ownerName", "typeID", "gender", "ownerNameID"],
      ownerIDs,
    ];
  }
}

module.exports = AllianceRegistryService;
