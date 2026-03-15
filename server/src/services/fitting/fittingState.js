const path = require("path");

const database = require(path.join(__dirname, "../../database"));

const CHARACTERS_TABLE = "characters";
const CORPORATION_FITTINGS_TABLE = "corporationFittings";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readScopedRecord(tableName, ownerId) {
  const result = database.read(tableName, `/${String(ownerId)}`);
  if (!result.success || !result.data || typeof result.data !== "object") {
    return null;
  }

  return result.data;
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeCharacters(data) {
  return Boolean(database.write(CHARACTERS_TABLE, "/", data).success);
}

function ensureScopedFittings(tableName, ownerId, options = {}) {
  const numericOwnerId = Number(ownerId) || 0;
  if (numericOwnerId <= 0) {
    return {
      success: false,
      errorMsg: "OWNER_NOT_FOUND",
      data: {},
    };
  }

  let record = readScopedRecord(tableName, numericOwnerId);

  if (!record) {
    if (!options.createIfMissing) {
      return {
        success: false,
        errorMsg: "OWNER_NOT_FOUND",
        data: {},
      };
    }

    record = {
      savedFittings: {},
    };
  }

  if (
    !record.savedFittings ||
    typeof record.savedFittings !== "object" ||
    Array.isArray(record.savedFittings)
  ) {
    record = {
      ...record,
      savedFittings: {},
    };
  }

  return {
    success: true,
    ownerID: numericOwnerId,
    record: cloneValue(record),
    data: cloneValue(record.savedFittings || {}),
  };
}

function writeScopedRecord(tableName, ownerId, record) {
  return database.write(tableName, `/${String(ownerId)}`, record);
}

function getNextFittingID(fittings = {}) {
  let maxFittingID = 0;

  for (const [key, fitting] of Object.entries(fittings)) {
    const numericKey = Number.parseInt(key, 10);
    if (Number.isInteger(numericKey) && numericKey > maxFittingID) {
      maxFittingID = numericKey;
    }

    const nestedFittingID =
      fitting && Number.isInteger(Number(fitting.fittingID))
        ? Number(fitting.fittingID)
        : 0;
    if (nestedFittingID > maxFittingID) {
      maxFittingID = nestedFittingID;
    }
  }

  return maxFittingID + 1;
}

function saveScopedFitting(tableName, ownerId, fitting, options = {}) {
  const scopeResult = ensureScopedFittings(tableName, ownerId, options);
  if (!scopeResult.success) {
    return scopeResult;
  }

  const fittingID =
    (fitting && Number.isInteger(Number(fitting.fittingID))
      ? Number(fitting.fittingID)
      : 0) || getNextFittingID(scopeResult.data);

  const nextRecord = {
    ...scopeResult.record,
    savedFittings: {
      ...scopeResult.data,
      [String(fittingID)]: {
        ...cloneValue(fitting),
        fittingID,
        ownerID: scopeResult.ownerID,
      },
    },
  };

  const writeResult = writeScopedRecord(
    tableName,
    scopeResult.ownerID,
    nextRecord,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
      data: null,
    };
  }

  return {
    success: true,
    fittingID,
    data: cloneValue(nextRecord.savedFittings[String(fittingID)]),
  };
}

function saveManyScopedFittings(tableName, ownerId, fittings, options = {}) {
  const scopeResult = ensureScopedFittings(tableName, ownerId, options);
  if (!scopeResult.success) {
    return scopeResult;
  }

  const nextFittings = {
    ...scopeResult.data,
  };
  let nextFittingID = getNextFittingID(nextFittings);
  const saved = [];

  for (const fitting of fittings) {
    const explicitFittingID =
      fitting && Number.isInteger(Number(fitting.fittingID))
        ? Number(fitting.fittingID)
        : 0;
    const fittingID = explicitFittingID || nextFittingID;
    if (fittingID >= nextFittingID) {
      nextFittingID = fittingID + 1;
    }

    const normalizedFitting = {
      ...cloneValue(fitting),
      fittingID,
      ownerID: scopeResult.ownerID,
    };
    nextFittings[String(fittingID)] = normalizedFitting;
    saved.push(cloneValue(normalizedFitting));
  }

  const nextRecord = {
    ...scopeResult.record,
    savedFittings: nextFittings,
  };
  const writeResult = writeScopedRecord(
    tableName,
    scopeResult.ownerID,
    nextRecord,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
      data: null,
    };
  }

  return {
    success: true,
    data: saved,
  };
}

function deleteScopedFitting(tableName, ownerId, fittingID, options = {}) {
  const scopeResult = ensureScopedFittings(tableName, ownerId, options);
  if (!scopeResult.success) {
    return scopeResult;
  }

  const fittingKey = String(fittingID);
  if (!Object.prototype.hasOwnProperty.call(scopeResult.data, fittingKey)) {
    return {
      success: false,
      errorMsg: "FITTING_NOT_FOUND",
      data: null,
    };
  }

  const nextFittings = {
    ...scopeResult.data,
  };
  delete nextFittings[fittingKey];

  const nextRecord = {
    ...scopeResult.record,
    savedFittings: nextFittings,
  };

  const writeResult = writeScopedRecord(
    tableName,
    scopeResult.ownerID,
    nextRecord,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
      data: null,
    };
  }

  return {
    success: true,
    data: null,
  };
}

function updateScopedFittingMetadata(
  tableName,
  ownerId,
  fittingID,
  name,
  description,
  options = {},
) {
  const scopeResult = ensureScopedFittings(tableName, ownerId, options);
  if (!scopeResult.success) {
    return scopeResult;
  }

  const fittingKey = String(fittingID);
  const existingFitting = scopeResult.data[fittingKey];
  if (!existingFitting) {
    return {
      success: false,
      errorMsg: "FITTING_NOT_FOUND",
      data: null,
    };
  }

  const nextRecord = {
    ...scopeResult.record,
    savedFittings: {
      ...scopeResult.data,
      [fittingKey]: {
        ...cloneValue(existingFitting),
        name,
        description,
      },
    },
  };

  const writeResult = writeScopedRecord(
    tableName,
    scopeResult.ownerID,
    nextRecord,
  );
  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_ERROR",
      data: null,
    };
  }

  return {
    success: true,
    data: cloneValue(nextRecord.savedFittings[fittingKey]),
  };
}

function ensureCharacterFittings(charId) {
  return ensureScopedFittings(CHARACTERS_TABLE, charId);
}

function getCharacterFittings(charId) {
  return ensureCharacterFittings(charId).data || {};
}

function saveCharacterFitting(charId, fitting) {
  return saveScopedFitting(CHARACTERS_TABLE, charId, fitting);
}

function saveManyCharacterFittings(charId, fittings) {
  return saveManyScopedFittings(CHARACTERS_TABLE, charId, fittings);
}

function deleteCharacterFitting(charId, fittingID) {
  return deleteScopedFitting(CHARACTERS_TABLE, charId, fittingID);
}

function updateCharacterFittingMetadata(charId, fittingID, name, description) {
  return updateScopedFittingMetadata(
    CHARACTERS_TABLE,
    charId,
    fittingID,
    name,
    description,
  );
}

function ensureCorporationFittings(corporationId) {
  return ensureScopedFittings(CORPORATION_FITTINGS_TABLE, corporationId, {
    createIfMissing: true,
  });
}

function getCorporationFittings(corporationId) {
  return ensureCorporationFittings(corporationId).data || {};
}

function saveCorporationFitting(corporationId, fitting) {
  return saveScopedFitting(
    CORPORATION_FITTINGS_TABLE,
    corporationId,
    fitting,
    {
      createIfMissing: true,
    },
  );
}

function saveManyCorporationFittings(corporationId, fittings) {
  return saveManyScopedFittings(
    CORPORATION_FITTINGS_TABLE,
    corporationId,
    fittings,
    {
      createIfMissing: true,
    },
  );
}

function deleteCorporationFitting(corporationId, fittingID) {
  return deleteScopedFitting(
    CORPORATION_FITTINGS_TABLE,
    corporationId,
    fittingID,
    {
      createIfMissing: true,
    },
  );
}

function updateCorporationFittingMetadata(
  corporationId,
  fittingID,
  name,
  description,
) {
  return updateScopedFittingMetadata(
    CORPORATION_FITTINGS_TABLE,
    corporationId,
    fittingID,
    name,
    description,
    {
      createIfMissing: true,
    },
  );
}

module.exports = {
  getCharacterFittings,
  ensureCharacterFittings,
  saveCharacterFitting,
  saveManyCharacterFittings,
  deleteCharacterFitting,
  updateCharacterFittingMetadata,
  getCorporationFittings,
  ensureCorporationFittings,
  saveCorporationFitting,
  saveManyCorporationFittings,
  deleteCorporationFitting,
  updateCorporationFittingMetadata,
};
