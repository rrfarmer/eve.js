const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildDict, buildList, normalizeText } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  getCharacterFittings,
  saveCharacterFitting,
  saveManyCharacterFittings,
  deleteCharacterFitting,
  updateCharacterFittingMetadata,
} = require(path.join(__dirname, "./fittingState"));
const {
  encodeWireValue,
  extractPayloadArg,
  extractPayloadList,
  extractPositiveIntegers,
  extractTextArgs,
  normalizeSavedFitting,
} = require(path.join(__dirname, "./fittingHelpers"));

class CharFittingMgrService extends BaseService {
  constructor() {
    super("charFittingMgr");
  }

    _resolveOwnerID(args, session) {
    const numericArgs = extractPositiveIntegers(args || []);
    return numericArgs[0] || (session && session.characterID) || 0;
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
    log.debug(`[CharFittingMgr] GetFittings(${ownerID})`);
    return this._buildFittingsResponse(getCharacterFittings(ownerID));
  }

  Handle_SaveFitting(args, session) {
    const ownerID = this._resolveOwnerID(args, session);
    const payload = extractPayloadArg(args || []);

    log.debug(`[CharFittingMgr] SaveFitting owner=${ownerID}`);

    const fittingResult = normalizeSavedFitting(payload, ownerID);
    if (!fittingResult.success) {
      log.warn(
        `[CharFittingMgr] SaveFitting rejected owner=${ownerID}: ${fittingResult.errorMsg}`,
      );
      return null;
    }

    const saveResult = saveCharacterFitting(ownerID, fittingResult.data);
    if (!saveResult.success) {
      log.warn(
        `[CharFittingMgr] SaveFitting failed owner=${ownerID}: ${saveResult.errorMsg}`,
      );
      return null;
    }

    return saveResult.fittingID;
  }

  Handle_SaveManyFittings(args, session) {
    const ownerID = this._resolveOwnerID(args, session);
    const rawPayloads = extractPayloadList(args || []);

    log.debug(
      `[CharFittingMgr] SaveManyFittings owner=${ownerID} count=${rawPayloads.length}`,
    );

    const normalizedPayloads = [];
    for (const rawPayload of rawPayloads) {
      const fittingResult = normalizeSavedFitting(rawPayload, ownerID);
      if (!fittingResult.success) {
        log.warn(
          `[CharFittingMgr] SaveManyFittings rejected owner=${ownerID}: ${fittingResult.errorMsg}`,
        );
        return null;
      }

      normalizedPayloads.push(fittingResult.data);
    }

    const saveResult = saveManyCharacterFittings(ownerID, normalizedPayloads);
    if (!saveResult.success) {
      log.warn(
        `[CharFittingMgr] SaveManyFittings failed owner=${ownerID}: ${saveResult.errorMsg}`,
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
      `[CharFittingMgr] DeleteFitting owner=${ownerID} fittingID=${fittingID}`,
    );

    if (!fittingID) {
      return null;
    }

    const deleteResult = deleteCharacterFitting(ownerID, fittingID);
    if (!deleteResult.success) {
      log.warn(
        `[CharFittingMgr] DeleteFitting failed owner=${ownerID} fittingID=${fittingID}: ${deleteResult.errorMsg}`,
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
      `[CharFittingMgr] UpdateNameAndDescription owner=${ownerID} fittingID=${fittingID} name=${JSON.stringify(name)}`,
    );

    if (!fittingID) {
      return null;
    }

    const updateResult = updateCharacterFittingMetadata(
      ownerID,
      fittingID,
      name,
      description,
    );
    if (!updateResult.success) {
      log.warn(
        `[CharFittingMgr] UpdateNameAndDescription failed owner=${ownerID} fittingID=${fittingID}: ${updateResult.errorMsg}`,
      );
    }

    return null;
  }
}

module.exports = CharFittingMgrService;
