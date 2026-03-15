const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildDict, buildList, normalizeText } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

const {
  getCorporationFittings,
  saveCorporationFitting,
  saveManyCorporationFittings,
  deleteCorporationFitting,
  updateCorporationFittingMetadata,
} = require(path.join(__dirname, "./fittingState"));
const {
  encodeWireValue,
  extractPayloadArg,
  extractPayloadList,
  extractPositiveIntegers,
  extractTextArgs,
  normalizeSavedFitting,
} = require(path.join(__dirname, "./fittingHelpers"));

class CorpFittingMgrService extends BaseService {
  constructor() {
    super("corpFittingMgr");
  }

    _resolveOwnerID(args, session) {
    const numericArgs = extractPositiveIntegers(args || []);
    return numericArgs[0] || (session && (session.corporationID || session.corpid)) || 0;
  }

  _buildFittingsResponse(fittings) {
    return buildDict(
      Object.entries(fittings).map(([fittingID, fitting]) => [
        Number(fittingID),
        encodeWireValue(fitting),
      ]),
    );
  }

  Handle_GetFittings(args, session) {
    const ownerID = this._resolveOwnerID(args, session);
    log.debug(`[CorpFittingMgr] GetFittings(${ownerID})`);
    return this._buildFittingsResponse(getCorporationFittings(ownerID));
  }

  Handle_SaveFitting(args, session) {
    const ownerID = this._resolveOwnerID(args, session);
    const payload = extractPayloadArg(args || []);

    log.debug(`[CorpFittingMgr] SaveFitting owner=${ownerID}`);

    const fittingResult = normalizeSavedFitting(payload, ownerID);
    if (!fittingResult.success) {
      log.warn(
        `[CorpFittingMgr] SaveFitting rejected owner=${ownerID}: ${fittingResult.errorMsg}`,
      );
      return null;
    }

    const saveResult = saveCorporationFitting(ownerID, fittingResult.data);
    if (!saveResult.success) {
      log.warn(
        `[CorpFittingMgr] SaveFitting failed owner=${ownerID}: ${saveResult.errorMsg}`,
      );
      return null;
    }

    return saveResult.fittingID;
  }

  Handle_SaveManyFittings(args, session) {
    const ownerID = this._resolveOwnerID(args, session);
    const rawPayloads = extractPayloadList(args || []);

    log.debug(
      `[CorpFittingMgr] SaveManyFittings owner=${ownerID} count=${rawPayloads.length}`,
    );

    const normalizedPayloads = [];
    for (const rawPayload of rawPayloads) {
      const fittingResult = normalizeSavedFitting(rawPayload, ownerID);
      if (!fittingResult.success) {
        log.warn(
          `[CorpFittingMgr] SaveManyFittings rejected owner=${ownerID}: ${fittingResult.errorMsg}`,
        );
        return null;
      }

      normalizedPayloads.push(fittingResult.data);
    }

    const saveResult = saveManyCorporationFittings(ownerID, normalizedPayloads);
    if (!saveResult.success) {
      log.warn(
        `[CorpFittingMgr] SaveManyFittings failed owner=${ownerID}: ${saveResult.errorMsg}`,
      );
      return null;
    }

    return buildList(saveResult.data.map((fitting) => fitting.fittingID));
  }

  Handle_DeleteFitting(args, session) {
    const ownerID = this._resolveOwnerID(args, session);
    const numericArgs = extractPositiveIntegers(args || []);
    const fittingID =
      numericArgs.length > 1 && numericArgs[0] === ownerID
        ? numericArgs[1]
        : numericArgs[0] || 0;

    log.debug(
      `[CorpFittingMgr] DeleteFitting owner=${ownerID} fittingID=${fittingID}`,
    );

    if (!fittingID) {
      return null;
    }

    const deleteResult = deleteCorporationFitting(ownerID, fittingID);
    if (!deleteResult.success) {
      log.warn(
        `[CorpFittingMgr] DeleteFitting failed owner=${ownerID} fittingID=${fittingID}: ${deleteResult.errorMsg}`,
      );
    }

    return null;
  }

  Handle_UpdateNameAndDescription(args, session) {
    const ownerID = this._resolveOwnerID(args, session);
    const numericArgs = extractPositiveIntegers(args || []);
    const textArgs = extractTextArgs(args || []);
    const fittingID =
      numericArgs.length > 1 && numericArgs[0] === ownerID
        ? numericArgs[1]
        : numericArgs[0] || 0;
    const name = normalizeText(textArgs[0], "");
    const description = normalizeText(textArgs[1], "");

    log.debug(
      `[CorpFittingMgr] UpdateNameAndDescription owner=${ownerID} fittingID=${fittingID} name=${JSON.stringify(name)}`,
    );

    if (!fittingID) {
      return null;
    }

    const updateResult = updateCorporationFittingMetadata(
      ownerID,
      fittingID,
      name,
      description,
    );
    if (!updateResult.success) {
      log.warn(
        `[CorpFittingMgr] UpdateNameAndDescription failed owner=${ownerID} fittingID=${fittingID}: ${updateResult.errorMsg}`,
      );
    }

    return null;
  }
}

module.exports = CorpFittingMgrService;
