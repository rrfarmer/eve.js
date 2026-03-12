const path = require("path");

const database = require(path.join(__dirname, "../../database"));

const CHARACTERS_TABLE = "characters";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
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

function ensureCharacterFittings(charId) {
  const characters = readCharacters();
  const key = String(charId);
  const record = characters[key];
  if (!record) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
      data: {},
    };
  }

  if (
    !record.savedFittings ||
    typeof record.savedFittings !== "object" ||
    Array.isArray(record.savedFittings)
  ) {
    characters[key] = {
      ...record,
      savedFittings: {},
    };
    writeCharacters(characters);
  }

  return {
    success: true,
    data: cloneValue(characters[key].savedFittings || {}),
  };
}

function getCharacterFittings(charId) {
  return ensureCharacterFittings(charId).data || {};
}

module.exports = {
  getCharacterFittings,
  ensureCharacterFittings,
};

