const path = require("path");

const database = require(path.join(__dirname, "../../database"));

const CHARACTERS_TABLE = "characters";
const FALLBACK_CHARACTER_ID = 140000001;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function getCharacterRecord(charId) {
  const characters = readCharacters();
  return characters[String(toNumber(charId, 0))] || null;
}

function listAccountCharacterIds(accountId) {
  const numericAccountId = toNumber(accountId, 0);
  if (numericAccountId <= 0) {
    return [];
  }

  return Object.entries(readCharacters())
    .filter(
      ([, record]) => toNumber(record && record.accountId, 0) === numericAccountId,
    )
    .map(([charId]) => toNumber(charId, 0))
    .filter((charId) => charId > 0)
    .sort((left, right) => right - left);
}

function getLatestAccountCharacterId(accountId) {
  const characterIds = listAccountCharacterIds(accountId);
  return characterIds.length > 0 ? characterIds[0] : 0;
}

function resolveSessionCharacterId(session, options = {}) {
  const fallbackCharacterId = toNumber(
    options.fallbackCharacterId,
    FALLBACK_CHARACTER_ID,
  );
  const candidates = [];

  if (options.boundCharacterId !== undefined && options.boundCharacterId !== null) {
    candidates.push(options.boundCharacterId);
  }

  if (session && typeof session === "object") {
    candidates.push(
      session.characterID,
      session.charid,
      session.selectedCharacterID,
      session.lastCreatedCharacterID,
    );
  }

  for (const candidate of candidates) {
    const charId = toNumber(candidate, 0);
    if (charId <= 0) {
      continue;
    }

    if (getCharacterRecord(charId)) {
      return charId;
    }
  }

  const allowAccountFallback = options.allowAccountFallback !== false;
  if (allowAccountFallback && session) {
    const accountCharacterId = getLatestAccountCharacterId(session.userid);
    if (accountCharacterId > 0) {
      return accountCharacterId;
    }
  }

  if (fallbackCharacterId > 0 && getCharacterRecord(fallbackCharacterId)) {
    return fallbackCharacterId;
  }

  const allowGlobalFallback = options.allowGlobalFallback !== false;
  if (!allowGlobalFallback) {
    return fallbackCharacterId;
  }

  const highestCharacterId = Object.keys(readCharacters())
    .map((charId) => toNumber(charId, 0))
    .filter((charId) => charId > 0)
    .sort((left, right) => right - left)[0];
  return highestCharacterId || fallbackCharacterId;
}

function extractCharacterIdFromBindParams(bindParams) {
  if (bindParams === undefined || bindParams === null) {
    return 0;
  }

  if (Buffer.isBuffer(bindParams)) {
    return extractCharacterIdFromBindParams(bindParams.toString("utf8"));
  }

  if (typeof bindParams === "number" || typeof bindParams === "bigint") {
    return toNumber(bindParams, 0);
  }

  if (typeof bindParams === "string") {
    return toNumber(bindParams.trim(), 0);
  }

  if (Array.isArray(bindParams)) {
    for (const entry of bindParams) {
      const candidate = extractCharacterIdFromBindParams(entry);
      if (candidate > 0) {
        return candidate;
      }
    }
    return 0;
  }

  if (typeof bindParams === "object") {
    const directKeys = ["characterID", "charID", "charid", "id", "value"];
    for (const key of directKeys) {
      if (!Object.prototype.hasOwnProperty.call(bindParams, key)) {
        continue;
      }

      const candidate = extractCharacterIdFromBindParams(bindParams[key]);
      if (candidate > 0) {
        return candidate;
      }
    }

    if (Array.isArray(bindParams.entries)) {
      for (const [rawKey, rawValue] of bindParams.entries) {
        const key = String(rawKey).toLowerCase();
        if (key !== "characterid" && key !== "charid") {
          continue;
        }

        const candidate = extractCharacterIdFromBindParams(rawValue);
        if (candidate > 0) {
          return candidate;
        }
      }
    }
  }

  return 0;
}

module.exports = {
  toNumber,
  readCharacters,
  getCharacterRecord,
  listAccountCharacterIds,
  getLatestAccountCharacterId,
  resolveSessionCharacterId,
  extractCharacterIdFromBindParams,
};
