const path = require("path");

const database = require(path.join(__dirname, "../../database"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));

const CHARACTERS_TABLE = "characters";
const SKILLS_TABLE = "skills";
const SKILL_FLAG_ID = 7;
const MAX_SKILL_LEVEL = 5;
const MAX_SKILL_POINTS = 256000;
const DEFAULT_SKILL_RANK = 1;

let skillReferenceCache = null;

function readCharacters() {
  const result = database.read(CHARACTERS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function readSkillsTable() {
  const result = database.read(SKILLS_TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeSkillsTable(skillsTable) {
  return database.write(SKILLS_TABLE, "/", skillsTable);
}

function writeCharacter(charId, record) {
  return database.write(CHARACTERS_TABLE, `/${String(charId)}`, record);
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSkillReference() {
  if (skillReferenceCache) {
    return skillReferenceCache;
  }

  try {
    skillReferenceCache = readStaticRows(TABLE.SKILL_TYPES);
  } catch (error) {
    log.warn(`[SkillState] Failed to load skill reference data: ${error.message}`);
    skillReferenceCache = [];
  }

  return skillReferenceCache;
}

function getSkillTypes() {
  return loadSkillReference();
}

function buildSkillItemId(charId, typeId) {
  return toNumber(charId, 0) * 100000 + toNumber(typeId, 0);
}

function buildSkillRecord(charId, skillType) {
  const numericCharId = toNumber(charId, 0);
  return {
    itemID: buildSkillItemId(numericCharId, skillType.typeID),
    typeID: skillType.typeID,
    ownerID: numericCharId,
    locationID: numericCharId,
    flagID: SKILL_FLAG_ID,
    categoryID: skillType.categoryID || 16,
    groupID: skillType.groupID || 0,
    groupName: skillType.groupName || "",
    itemName: skillType.name,
    published: Boolean(skillType.published),
    skillLevel: MAX_SKILL_LEVEL,
    trainedSkillLevel: MAX_SKILL_LEVEL,
    effectiveSkillLevel: MAX_SKILL_LEVEL,
    virtualSkillLevel: null,
    skillRank: toNumber(skillType.skillRank, DEFAULT_SKILL_RANK),
    skillPoints: MAX_SKILL_POINTS,
    trainedSkillPoints: MAX_SKILL_POINTS,
    inTraining: false,
    trainingStartSP: MAX_SKILL_POINTS,
    trainingDestinationSP: MAX_SKILL_POINTS,
    trainingStartTime: null,
    trainingEndTime: null,
  };
}

function normalizeSkillRecord(charId, existingRecord, skillType) {
  const baseRecord = buildSkillRecord(charId, skillType);
  return {
    ...baseRecord,
    ...(existingRecord && typeof existingRecord === "object" ? existingRecord : {}),
    itemID: buildSkillItemId(charId, skillType.typeID),
    typeID: skillType.typeID,
    ownerID: toNumber(charId, 0),
    locationID: toNumber(charId, 0),
    flagID: SKILL_FLAG_ID,
    categoryID: skillType.categoryID || 16,
    groupID: skillType.groupID || 0,
    groupName: skillType.groupName || "",
    itemName: skillType.name,
    published: Boolean(skillType.published),
    skillLevel: MAX_SKILL_LEVEL,
    trainedSkillLevel: MAX_SKILL_LEVEL,
    effectiveSkillLevel: MAX_SKILL_LEVEL,
    virtualSkillLevel: null,
    skillRank: toNumber(
      existingRecord && existingRecord.skillRank,
      toNumber(skillType.skillRank, DEFAULT_SKILL_RANK),
    ),
    skillPoints: MAX_SKILL_POINTS,
    trainedSkillPoints: MAX_SKILL_POINTS,
    inTraining: false,
    trainingStartSP: MAX_SKILL_POINTS,
    trainingDestinationSP: MAX_SKILL_POINTS,
    trainingStartTime: null,
    trainingEndTime: null,
  };
}

function syncCharacterSkillPoints(charId, totalSkillPoints) {
  const characters = readCharacters();
  const record = characters[String(charId)];
  if (!record) {
    return;
  }

  if (toNumber(record.skillPoints, 0) === totalSkillPoints) {
    return;
  }

  writeCharacter(charId, {
    ...record,
    skillPoints: totalSkillPoints,
  });
}

function ensureCharacterSkills(charId) {
  const skillTypes = getSkillTypes();
  if (skillTypes.length === 0) {
    return [];
  }

  const numericCharId = toNumber(charId, 0);
  const skillsTable = readSkillsTable();
  const characterKey = String(numericCharId);
  const existingSkills = skillsTable[characterKey] || {};
  const nextSkills = {};
  let dirty = !skillsTable[characterKey];

  for (const skillType of skillTypes) {
    const typeKey = String(skillType.typeID);
    const normalizedRecord = normalizeSkillRecord(
      numericCharId,
      existingSkills[typeKey],
      skillType,
    );
    nextSkills[typeKey] = normalizedRecord;

    if (
      !existingSkills[typeKey] ||
      JSON.stringify(existingSkills[typeKey]) !== JSON.stringify(normalizedRecord)
    ) {
      dirty = true;
    }
  }

  if (dirty) {
    skillsTable[characterKey] = nextSkills;
    const writeResult = writeSkillsTable(skillsTable);
    if (!writeResult || !writeResult.success) {
      log.warn(`[SkillState] Failed to persist skills for character ${numericCharId}`);
    }
  }

  const skills = Object.values(nextSkills).map((record) => cloneValue(record));
  const totalSkillPoints = skills.reduce(
    (sum, skill) => sum + toNumber(skill.skillPoints, 0),
    0,
  );
  syncCharacterSkillPoints(numericCharId, totalSkillPoints);
  return skills;
}

function ensureAllCharacterSkills() {
  const characters = readCharacters();
  const results = {};
  for (const charId of Object.keys(characters)) {
    results[charId] = ensureCharacterSkills(charId).length;
  }
  return results;
}

function getCharacterSkills(charId) {
  return ensureCharacterSkills(charId)
    .sort((left, right) => left.typeID - right.typeID)
    .map((record) => cloneValue(record));
}

function getCharacterSkillMap(charId) {
  const entries = getCharacterSkills(charId).map((record) => [
    record.typeID,
    cloneValue(record),
  ]);
  return new Map(entries);
}

function getCharacterSkillPointTotal(charId) {
  const skills = getCharacterSkills(charId);
  if (skills.length === 0) {
    return null;
  }

  return skills.reduce((sum, skill) => sum + toNumber(skill.skillPoints, 0), 0);
}

module.exports = {
  SKILL_FLAG_ID,
  MAX_SKILL_LEVEL,
  MAX_SKILL_POINTS,
  buildSkillRecord,
  ensureAllCharacterSkills,
  ensureCharacterSkills,
  getCharacterSkillMap,
  getCharacterSkillPointTotal,
  getCharacterSkills,
  getSkillTypes,
};

