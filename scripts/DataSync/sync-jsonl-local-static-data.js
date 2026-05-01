#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const crypto = require("crypto");
const readline = require("readline");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SOURCE_DIR = path.join(REPO_ROOT, "tools", "DataSync", "source_json");
const DATA_ROOT = path.join(REPO_ROOT, "server", "src", "newDatabase", "data");
const LATEST_JSONL_URL = "https://developers.eveonline.com/static-data/tranquility/latest.jsonl";
const LATEST_JSONL_ZIP_URL = "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip";

const REQUIRED_SOURCE_FILES = [
  "_sde.jsonl",
  "types.jsonl",
  "groups.jsonl",
  "categories.jsonl",
];

const DEFAULT_TABLES = [
  "itemTypes",
  "shipTypes",
  "skillTypes",
  "typeDogma",
  "shipDogmaAttributes",
  "dbuffCollections",
  "solarSystems",
  "celestials",
  "asteroidBelts",
  "stargates",
  "stations",
  "stationTypes",
  "stargateTypes",
  "movementAttributes",
  "characterCreationRaces",
  "characterCreationBloodlines",
  "factions",
  "industryBlueprints",
  "industryFacilities",
  "itemIcons",
  "shipCosmeticsCatalog",
  "sovereigntyStatic",
  "reprocessingStatic",
  "certificates",
  "mapNames",
  "npcCorporationAuthority",
  "npcCharacterAuthority",
];

const NUMERIC_TYPE_FIELDS = [
  "mass",
  "volume",
  "capacity",
  "portionSize",
  "raceID",
  "basePrice",
  "marketGroupID",
  "iconID",
  "soundID",
  "graphicID",
  "radius",
];

const LOCAL_STATION_TYPE_FIELDS = [
  "dockEntry",
  "dockOrientation",
  "graphicLocationID",
  "directionalLocatorCategories",
  "undockLocatorCategories",
];

const DOGMA_ATTRIBUTE_IDS = Object.freeze({
  mass: 4,
  maxVelocity: 37,
  inertia: 70,
  signatureRadius: 552,
  warpSpeedMultiplier: 600,
  reprocessingSkillType: 790,
  refiningYieldMultiplier: 2045,
  rigSize: 1547,
  gasDecompressionEfficiencyBase: 2634,
  gasDecompressionEfficiencyBonusAdd: 2635,
});

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    sourceDir: DEFAULT_SOURCE_DIR,
    download: false,
    dryRun: false,
    apply: false,
    tables: null,
  };
  const npmConfigState = applyNpmConfigArgs(options);
  const npmPositionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--download") {
      options.download = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--source") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--source requires a directory");
      }
      options.sourceDir = path.resolve(REPO_ROOT, argv[index]);
    } else if (arg === "--tables") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--tables requires a comma-separated list");
      }
      const tableValues = [argv[index]];
      while (argv[index + 1] && !argv[index + 1].startsWith("-")) {
        index += 1;
        tableValues.push(argv[index]);
      }
      options.tables = parseTableList(tableValues);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (npmConfigState.saw && !arg.startsWith("-")) {
      // Some Windows/npm combinations consume script flags as npm config and
      // leave only their values in argv. The npm_config_* fallback above owns
      // those values, so collect the positional crumbs for reconstruction.
      npmPositionals.push(arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  applyNpmPositionals(options, npmConfigState, npmPositionals);

  if (!options.dryRun && !options.apply && !options.download) {
    options.dryRun = true;
  }
  if (options.dryRun && options.apply) {
    throw new Error("Choose either --dry-run or --apply, not both");
  }

  return options;
}

function applyNpmConfigArgs(options) {
  const state = {
    saw: false,
    sourceNeedsValue: false,
    tablesNeedsValue: false,
  };
  const source = npmConfigValue("source");
  if (source) {
    if (isTruthyConfig(source)) {
      state.sourceNeedsValue = true;
    } else {
      options.sourceDir = path.resolve(REPO_ROOT, source);
    }
    state.saw = true;
  }

  const tables = npmConfigValue("tables");
  if (tables) {
    if (isTruthyConfig(tables)) {
      state.tablesNeedsValue = true;
    } else {
      options.tables = parseTableList([tables]);
    }
    state.saw = true;
  }

  for (const [optionName, property] of [
    ["download", "download"],
    ["dry-run", "dryRun"],
    ["apply", "apply"],
  ]) {
    const value = npmConfigValue(optionName);
    if (isTruthyConfig(value)) {
      options[property] = true;
      state.saw = true;
    }
  }

  return state;
}

function applyNpmPositionals(options, state, positionals) {
  if (!state.saw || positionals.length === 0) {
    return;
  }
  let index = 0;
  if (state.sourceNeedsValue) {
    if (!positionals[index]) {
      throw new Error("--source requires a directory");
    }
    options.sourceDir = path.resolve(REPO_ROOT, positionals[index]);
    index += 1;
  }
  if (state.tablesNeedsValue) {
    options.tables = parseTableList(positionals.slice(index));
    if (options.tables.length === 0) {
      throw new Error("--tables requires a comma-separated list");
    }
    index = positionals.length;
  }
  if (positionals.length > index) {
    throw new Error(`Unknown option: ${positionals[index]}`);
  }
}

function parseTableList(values) {
  return values
    .flatMap((value) => String(value).split(/[,\s]+/))
    .map((name) => name.trim())
    .filter(Boolean);
}

function npmConfigValue(name) {
  const normalized = name.replace(/-/g, "_");
  const keys = [
    `npm_config_${normalized}`,
    `NPM_CONFIG_${normalized.toUpperCase()}`,
  ];
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== "" && value !== "undefined") {
      return value;
    }
  }
  return null;
}

function isTruthyConfig(value) {
  if (value === null || value === undefined) {
    return false;
  }
  return ["1", "true", "yes"].includes(String(value).toLowerCase());
}

function printHelp() {
  process.stdout.write(`EVE JSONL SDE sync utility

Usage:
  node scripts/DataSync/sync-jsonl-local-static-data.js --source tools/DataSync/source_json --dry-run
  node scripts/DataSync/sync-jsonl-local-static-data.js --download --apply

Options:
  --download       Download and extract the latest official JSONL SDE first.
  --source <dir>   Use a prepared JSONL source directory.
  --dry-run        Validate and summarize changed outputs without writing.
  --apply          Write regenerated project JSON files.
  --tables <list>  Comma-separated table names to rebuild.
`);
}

function relativeToRepo(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
}

function tableDataPath(tableName) {
  return path.join(DATA_ROOT, tableName, "data.json");
}

function toInt(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveInt(value, fallback = null) {
  const numeric = toInt(value, null);
  return numeric && numeric > 0 ? numeric : fallback;
}

function localize(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (value && typeof value === "object") {
    if (typeof value.en === "string" && value.en.trim()) {
      return value.en.trim();
    }
    for (const candidate of Object.values(value)) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return fallback;
}

function localizedObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function decodeSdePairs(value, keyName = "typeID", valueName = "level") {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const key = toInt(entry._key, null);
      if (key === null) {
        return null;
      }
      return {
        [keyName]: key,
        [valueName]: entry._value,
      };
    })
    .filter(Boolean);
}

function sortNumericStrings(left, right) {
  return Number(left) - Number(right);
}

function stableObjectFromEntries(entries) {
  const output = {};
  for (const [key, value] of entries) {
    output[String(key)] = value;
  }
  return output;
}

function jsonStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJsonFileIfPresent(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function readJsonl(filePath, onRow) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, "utf8"),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${lineNumber}: ${error.message}`);
    }
    await onRow(row);
  }
}

async function readFirstJsonlRecord(filePath) {
  let first = null;
  await readJsonl(filePath, (row) => {
    if (first === null) {
      first = row;
    }
  });
  return first;
}

function romanNumeral(value) {
  let number = toInt(value, 0) || 0;
  if (number <= 0) {
    return String(value || "");
  }
  const numerals = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let output = "";
  for (const [amount, symbol] of numerals) {
    while (number >= amount) {
      output += symbol;
      number -= amount;
    }
  }
  return output;
}

function seededRange(seed, min, max) {
  const low = Number(min) || 0;
  const high = Number(max) || low;
  if (high <= low) {
    return low;
  }
  const x = Math.sin(Number(seed) * 12.9898) * 43758.5453;
  const fraction = x - Math.floor(x);
  return Math.round(low + fraction * (high - low));
}

function pickAsteroidFieldStyle(security, solarSystemID) {
  const numericSecurity = Number(security);
  if (solarSystemID >= 31000000) {
    return "wormhole_standard";
  }
  if (Number.isFinite(numericSecurity) && numericSecurity >= 0.45) {
    return "empire_highsec_standard";
  }
  if (Number.isFinite(numericSecurity) && numericSecurity > 0.0) {
    return "empire_lowsec_standard";
  }
  return "nullsec_standard";
}

function fieldProfileForStyle(styleID) {
  if (styleID === "empire_highsec_standard") {
    return {
      asteroidCountMin: 16,
      asteroidCountMax: 24,
      clusterCountMin: 3,
      clusterCountMax: 4,
      fieldRadiusMinMeters: 26000,
      fieldRadiusMaxMeters: 34000,
      clusterRadiusMinMeters: 3500,
      clusterRadiusMaxMeters: 7000,
      verticalSpreadMinMeters: 2000,
      verticalSpreadMaxMeters: 5000,
      largeAsteroidCountMin: 0,
      largeAsteroidCountMax: 1,
    };
  }
  if (styleID === "empire_lowsec_standard") {
    return {
      asteroidCountMin: 18,
      asteroidCountMax: 28,
      clusterCountMin: 3,
      clusterCountMax: 5,
      fieldRadiusMinMeters: 30000,
      fieldRadiusMaxMeters: 42000,
      clusterRadiusMinMeters: 4500,
      clusterRadiusMaxMeters: 8500,
      verticalSpreadMinMeters: 3000,
      verticalSpreadMaxMeters: 6500,
      largeAsteroidCountMin: 1,
      largeAsteroidCountMax: 2,
    };
  }
  if (styleID === "wormhole_standard") {
    return {
      asteroidCountMin: 12,
      asteroidCountMax: 22,
      clusterCountMin: 2,
      clusterCountMax: 4,
      fieldRadiusMinMeters: 34000,
      fieldRadiusMaxMeters: 52000,
      clusterRadiusMinMeters: 5000,
      clusterRadiusMaxMeters: 9500,
      verticalSpreadMinMeters: 4000,
      verticalSpreadMaxMeters: 9000,
      largeAsteroidCountMin: 1,
      largeAsteroidCountMax: 3,
    };
  }
  return {
    asteroidCountMin: 20,
    asteroidCountMax: 34,
    clusterCountMin: 4,
    clusterCountMax: 6,
    fieldRadiusMinMeters: 36000,
    fieldRadiusMaxMeters: 56000,
    clusterRadiusMinMeters: 5000,
    clusterRadiusMaxMeters: 10000,
    verticalSpreadMinMeters: 4000,
    verticalSpreadMaxMeters: 10000,
    largeAsteroidCountMin: 1,
    largeAsteroidCountMax: 3,
  };
}

function buildAsteroidFieldFields(itemID, security, solarSystemID) {
  const styleID = pickAsteroidFieldStyle(security, solarSystemID);
  const profile = fieldProfileForStyle(styleID);
  return {
    fieldStyleID: styleID,
    fieldSeed: itemID,
    asteroidCount: seededRange(itemID + 1, profile.asteroidCountMin, profile.asteroidCountMax),
    clusterCount: seededRange(itemID + 2, profile.clusterCountMin, profile.clusterCountMax),
    fieldRadiusMeters: seededRange(itemID + 3, profile.fieldRadiusMinMeters, profile.fieldRadiusMaxMeters),
    clusterRadiusMeters: seededRange(itemID + 4, profile.clusterRadiusMinMeters, profile.clusterRadiusMaxMeters),
    verticalSpreadMeters: seededRange(itemID + 5, profile.verticalSpreadMinMeters, profile.verticalSpreadMaxMeters),
    largeAsteroidCount: seededRange(itemID + 6, profile.largeAsteroidCountMin, profile.largeAsteroidCountMax),
  };
}

class SdeContext {
  constructor(sourceDir) {
    this.sourceDir = path.resolve(sourceDir);
    this.cache = new Map();
    this.sde = null;
  }

  filePath(name) {
    return path.join(this.sourceDir, `${name}.jsonl`);
  }

  async validate() {
    if (!fs.existsSync(this.sourceDir)) {
      throw new Error(`Source directory not found: ${this.sourceDir}`);
    }
    for (const fileName of REQUIRED_SOURCE_FILES) {
      const filePath = path.join(this.sourceDir, fileName);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Required SDE file missing: ${relativeToRepo(filePath)}`);
      }
    }
    const sde = await readFirstJsonlRecord(this.filePath("_sde"));
    if (!sde || sde._key !== "sde" || !Number.isInteger(Number(sde.buildNumber))) {
      throw new Error("_sde.jsonl is missing the sde build record");
    }
    this.sde = {
      buildNumber: Number(sde.buildNumber),
      releaseDate: String(sde.releaseDate || ""),
    };
  }

  sourceMeta(extra = {}) {
    return {
      provider: "EVE Static Data JSONL",
      authority: `eve-online-static-data-${this.sde.buildNumber}-jsonl`,
      sourceDir: relativeToRepo(this.sourceDir),
      buildNumber: this.sde.buildNumber,
      releaseDate: this.sde.releaseDate,
      ...extra,
    };
  }

  async rows(name) {
    const cacheKey = `rows:${name}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    const filePath = this.filePath(name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`SDE file missing: ${relativeToRepo(filePath)}`);
    }
    const rows = [];
    await readJsonl(filePath, (row) => {
      rows.push(row);
    });
    rows.sort((left, right) => Number(left._key) - Number(right._key));
    this.cache.set(cacheKey, rows);
    return rows;
  }

  async map(name) {
    const cacheKey = `map:${name}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    const rows = await this.rows(name);
    const map = new Map();
    for (const row of rows) {
      map.set(Number(row._key), row);
    }
    this.cache.set(cacheKey, map);
    return map;
  }

  async typeContext() {
    const cacheKey = "typeContext";
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    const categories = await this.map("categories");
    const groups = await this.map("groups");
    const types = await this.map("types");
    const context = { categories, groups, types };
    this.cache.set(cacheKey, context);
    return context;
  }

  async dogmaAttributeTypesByID() {
    const cacheKey = "dogmaAttributeTypesByID";
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    const attributes = {};
    for (const row of await this.rows("dogmaAttributes")) {
      const attributeID = Number(row._key);
      attributes[String(attributeID)] = {
        attributeID,
        attributeName: localize(row.displayName, localize(row.name, "")),
        description: localize(row.description, ""),
        iconID: toNumberOrNull(row.iconID),
        defaultValue: toNumberOrNull(row.defaultValue) ?? 0,
        published: row.published === true,
        displayName: localize(row.displayName, ""),
        unitID: toNumberOrNull(row.unitID),
        stackable: row.stackable !== false,
        highIsGood: row.highIsGood !== false,
        categoryID: toNumberOrNull(row.attributeCategoryID),
        name: localize(row.name, ""),
        dataType: toNumberOrNull(row.dataType),
        displayWhenZero: row.displayWhenZero === true,
      };
    }
    this.cache.set(cacheKey, attributes);
    return attributes;
  }

  async dogmaEffectTypesByID() {
    const cacheKey = "dogmaEffectTypesByID";
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    const effects = {};
    for (const row of await this.rows("dogmaEffects")) {
      const effectID = Number(row._key);
      effects[String(effectID)] = {
        effectID,
        name: localize(row.name, ""),
        displayName: localize(row.displayName, ""),
        description: localize(row.description, ""),
        guid: row.guid || null,
        effectCategoryID: toNumberOrNull(row.effectCategoryID),
        iconID: toNumberOrNull(row.iconID),
        dischargeAttributeID: toNumberOrNull(row.dischargeAttributeID),
        durationAttributeID: toNumberOrNull(row.durationAttributeID),
        distribution: row.distribution ?? null,
        rangeAttributeID: toNumberOrNull(row.rangeAttributeID),
        falloffAttributeID: toNumberOrNull(row.falloffAttributeID),
        trackingSpeedAttributeID: toNumberOrNull(row.trackingSpeedAttributeID),
        resistanceAttributeID: toNumberOrNull(row.resistanceAttributeID),
        fittingUsageChanceAttributeID: toNumberOrNull(row.fittingUsageChanceAttributeID),
        npcUsageChanceAttributeID: toNumberOrNull(row.npcUsageChanceAttributeID),
        npcActivationChanceAttributeID: toNumberOrNull(row.npcActivationChanceAttributeID),
        published: row.published === true,
        isOffensive: row.isOffensive === true,
        isAssistance: row.isAssistance === true,
        isWarpSafe: row.isWarpSafe !== false,
        disallowAutoRepeat: row.disallowAutoRepeat === true,
        electronicChance: row.electronicChance === true,
        propulsionChance: row.propulsionChance === true,
        rangeChance: row.rangeChance === true,
        modifierInfo: Array.isArray(row.modifierInfo) ? row.modifierInfo : [],
      };
    }
    this.cache.set(cacheKey, effects);
    return effects;
  }
}

async function normalizeTypeRow(ctx, row) {
  const { groups, categories } = await ctx.typeContext();
  const typeID = Number(row._key);
  const groupID = toInt(row.groupID, 0) || 0;
  const group = groups.get(groupID) || {};
  const categoryID = toInt(group.categoryID, 0) || 0;
  const category = categories.get(categoryID) || {};
  const output = {
    typeID,
    groupID,
    categoryID,
    groupName: localize(group.name, `Group ${groupID}`),
    categoryName: localize(category.name, `Category ${categoryID}`),
    name: localize(row.name, `Type ${typeID}`),
  };
  for (const field of NUMERIC_TYPE_FIELDS) {
    output[field] = toNumberOrNull(row[field]);
  }
  output.published = row.published === true;
  return output;
}

async function buildTypeRows(ctx, predicate) {
  const rows = [];
  for (const row of await ctx.rows("types")) {
    const typeID = Number(row._key);
    if (!Number.isInteger(typeID) || typeID <= 0) {
      continue;
    }
    const normalized = await normalizeTypeRow(ctx, row);
    if (!predicate || predicate(normalized, row)) {
      rows.push(normalized);
    }
  }
  rows.sort((left, right) => left.typeID - right.typeID);
  return rows;
}

function stripCategoryName(row) {
  const { categoryName, ...rest } = row;
  return rest;
}

async function buildItemTypes(ctx) {
  const rows = (await buildTypeRows(ctx)).map(stripCategoryName);
  return {
    source: ctx.sourceMeta({ jsonlSync: { sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: rows.length,
    types: rows,
  };
}

async function buildShipTypes(ctx) {
  const rows = (await buildTypeRows(ctx, (row) => row.categoryID === 6)).map(stripCategoryName);
  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedTypeIDs: rows.map((row) => row.typeID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: rows.length,
    ships: rows,
  };
}

async function buildSkillTypes(ctx) {
  const rows = (await buildTypeRows(ctx, (row) => row.categoryID === 16)).map(stripCategoryName);
  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedTypeIDs: rows.map((row) => row.typeID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: rows.length,
    skills: rows,
  };
}

async function buildStationTypes(ctx) {
  const previous = readJsonFileIfPresent(tableDataPath("stationTypes"), {});
  const localByTypeID = new Map();
  for (const row of Array.isArray(previous.stationTypes) ? previous.stationTypes : []) {
    localByTypeID.set(Number(row.stationTypeID), row);
  }
  const rows = [];
  for (const base of await buildTypeRows(ctx, (row) => row.groupID === 15)) {
    const previousRow = localByTypeID.get(base.typeID) || {};
    const row = {
      stationTypeID: base.typeID,
      typeName: base.name,
      groupID: base.groupID,
      categoryID: base.categoryID,
      groupName: base.groupName,
      raceID: base.raceID,
      graphicID: base.graphicID,
      radius: base.radius,
      basePrice: base.basePrice,
      volume: base.volume,
      portionSize: base.portionSize,
      published: base.published,
    };
    for (const field of LOCAL_STATION_TYPE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(previousRow, field)) {
        row[field] = previousRow[field];
      }
    }
    rows.push(row);
  }
  return {
    source: ctx.sourceMeta({
      jsonlSync: { updatedStationTypeIDs: rows.map((row) => row.stationTypeID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate },
      localExtensions: { preservedFields: LOCAL_STATION_TYPE_FIELDS },
    }),
    count: rows.length,
    stationTypes: rows,
  };
}

async function buildStargateTypes(ctx) {
  const rows = [];
  for (const base of await buildTypeRows(ctx, (row) => row.groupID === 10)) {
    rows.push({
      typeID: base.typeID,
      typeName: base.name,
      groupID: base.groupID,
      categoryID: base.categoryID,
      groupName: base.groupName,
      raceID: base.raceID,
      graphicID: base.graphicID,
      published: base.published,
    });
  }
  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedStargateTypeIDs: rows.map((row) => row.typeID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: rows.length,
    stargateTypes: rows,
  };
}

async function buildTypeDogma(ctx) {
  const typeMap = (await ctx.typeContext()).types;
  const attributeTypesByID = await ctx.dogmaAttributeTypesByID();
  const effectTypesByID = await ctx.dogmaEffectTypesByID();
  const typesByTypeID = {};
  let totalAttributes = 0;
  let totalEffects = 0;

  await readJsonl(ctx.filePath("typeDogma"), (row) => {
    const typeID = Number(row._key);
    if (!Number.isInteger(typeID) || typeID <= 0) {
      return;
    }
    const typeRow = typeMap.get(typeID) || {};
    const attributes = {};
    for (const attr of Array.isArray(row.dogmaAttributes) ? row.dogmaAttributes : []) {
      const attributeID = Number(attr.attributeID);
      if (!Number.isInteger(attributeID)) {
        continue;
      }
      attributes[String(attributeID)] = Number(attr.value);
      totalAttributes += 1;
    }
    const effects = (Array.isArray(row.dogmaEffects) ? row.dogmaEffects : [])
      .map((effect) => ({
        effectID: Number(effect.effectID),
        isDefault: effect.isDefault === true,
      }))
      .filter((effect) => Number.isInteger(effect.effectID))
      .sort((left, right) => left.effectID - right.effectID);
    totalEffects += effects.length;
    typesByTypeID[String(typeID)] = {
      typeID,
      typeName: localize(typeRow.name, `Type ${typeID}`),
      attributeCount: Object.keys(attributes).length,
      effectCount: effects.length,
      attributes: stableObjectFromEntries(
        Object.entries(attributes).sort(([left], [right]) => sortNumericStrings(left, right)),
      ),
      effects,
    };
  });

  return {
    source: ctx.sourceMeta({
      supplements: [
        {
          key: "standardMicroJumpDriveDistance",
          description: "Seed mjdJumpRange=100000 for standard micro jump drives when the current JSONL snapshot omits attribute 2066.",
        },
        {
          key: "capitalMicroJumpDriveDistance",
          description: "Seed mjdJumpRange=250000 for capital micro jump drives if a future JSONL snapshot omits attribute 2066.",
        },
      ],
      jsonlSync: { sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate },
    }),
    attributeTypesByID,
    effectTypesByID,
    typesByTypeID,
    counts: {
      types: Object.keys(typesByTypeID).length,
      attributeTypes: Object.keys(attributeTypesByID).length,
      effectTypes: Object.keys(effectTypesByID).length,
      totalAttributes,
      totalEffects,
    },
  };
}

async function buildShipDogmaAttributes(ctx) {
  const typeRows = await buildTypeRows(ctx, (row) => row.categoryID === 6);
  const shipTypeIDs = new Set(typeRows.map((row) => row.typeID));
  const typeNames = new Map(typeRows.map((row) => [row.typeID, row.name]));
  const shipAttributesByTypeID = {};
  let totalAttributes = 0;

  await readJsonl(ctx.filePath("typeDogma"), (row) => {
    const typeID = Number(row._key);
    if (!shipTypeIDs.has(typeID)) {
      return;
    }
    const attributes = {};
    for (const attr of Array.isArray(row.dogmaAttributes) ? row.dogmaAttributes : []) {
      const attributeID = Number(attr.attributeID);
      if (!Number.isInteger(attributeID)) {
        continue;
      }
      attributes[String(attributeID)] = Number(attr.value);
      totalAttributes += 1;
    }
    shipAttributesByTypeID[String(typeID)] = {
      typeID,
      typeName: typeNames.get(typeID) || `Type ${typeID}`,
      attributeCount: Object.keys(attributes).length,
      attributes: stableObjectFromEntries(
        Object.entries(attributes).sort(([left], [right]) => sortNumericStrings(left, right)),
      ),
    };
  });

  const attributeTypesByID = await ctx.dogmaAttributeTypesByID();
  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedShipTypeIDs: [...shipTypeIDs].sort((left, right) => left - right), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    counts: {
      shipTypes: Object.keys(shipAttributesByTypeID).length,
      attributeTypes: Object.keys(attributeTypesByID).length,
      totalAttributes,
    },
    attributeTypesByID,
    shipAttributesByTypeID,
  };
}

async function buildDbuffCollections(ctx) {
  const rows = await ctx.rows("dbuffCollections");
  const collectionsByID = {};
  for (const row of rows) {
    const collectionID = Number(row._key);
    collectionsByID[String(collectionID)] = {
      collectionID,
      aggregateMode: row.aggregateMode || null,
      operation: toNumberOrNull(row.operation),
      operationName: row.operationName || null,
      developerDescription: row.developerDescription || "",
      itemModifiers: Array.isArray(row.itemModifiers) ? row.itemModifiers : [],
      locationModifiers: Array.isArray(row.locationModifiers) ? row.locationModifiers : [],
      locationGroupModifiers: Array.isArray(row.locationGroupModifiers) ? row.locationGroupModifiers : [],
      locationCategoryModifiers: Array.isArray(row.locationCategoryModifiers) ? row.locationCategoryModifiers : [],
      locationRequiredSkillModifiers: Array.isArray(row.locationRequiredSkillModifiers) ? row.locationRequiredSkillModifiers : [],
    };
  }
  return {
    source: ctx.sourceMeta({ jsonlSync: { sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    counts: { collectionCount: Object.keys(collectionsByID).length },
    collectionsByID,
  };
}

async function buildSolarSystems(ctx) {
  const rows = [];
  for (const row of await ctx.rows("mapSolarSystems")) {
    const solarSystemID = Number(row._key);
    rows.push({
      regionID: toInt(row.regionID, null),
      constellationID: toInt(row.constellationID, null),
      solarSystemID,
      solarSystemName: localize(row.name, `Solar System ${solarSystemID}`),
      position: row.position || { x: 0, y: 0, z: 0 },
      security: toNumberOrNull(row.securityStatus),
      factionID: toNumberOrNull(row.factionID),
      radius: toNumberOrNull(row.radius),
      sunTypeID: null,
      securityClass: row.securityClass || null,
    });
  }
  const sunTypeBySystemID = new Map();
  await readJsonl(ctx.filePath("mapStars"), (row) => {
    sunTypeBySystemID.set(Number(row.solarSystemID), toInt(row.typeID, null));
  });
  for (const row of rows) {
    row.sunTypeID = sunTypeBySystemID.get(row.solarSystemID) || null;
  }
  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedSolarSystemIDs: rows.map((row) => row.solarSystemID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: rows.length,
    solarSystems: rows,
  };
}

async function buildMapNames(ctx) {
  const regionsByID = {};
  for (const row of await ctx.rows("mapRegions")) {
    regionsByID[String(row._key)] = localize(row.name, `Region ${row._key}`);
  }
  const constellationsByID = {};
  for (const row of await ctx.rows("mapConstellations")) {
    constellationsByID[String(row._key)] = {
      constellationID: Number(row._key),
      constellationName: localize(row.name, `Constellation ${row._key}`),
      regionID: toInt(row.regionID, null),
    };
  }
  return {
    source: ctx.sourceMeta({ description: "Generated region and constellation names for runtime map lookups." }),
    counts: {
      regions: Object.keys(regionsByID).length,
      constellations: Object.keys(constellationsByID).length,
    },
    regionsByID,
    constellationsByID,
  };
}

async function buildCelestialSupport(ctx) {
  const typeRows = await buildTypeRows(ctx);
  const typeInfoByID = new Map(typeRows.map((row) => [row.typeID, row]));
  const systems = new Map();
  for (const row of await ctx.rows("mapSolarSystems")) {
    systems.set(Number(row._key), {
      solarSystemID: Number(row._key),
      solarSystemName: localize(row.name, `Solar System ${row._key}`),
      constellationID: toInt(row.constellationID, null),
      regionID: toInt(row.regionID, null),
      security: toNumberOrNull(row.securityStatus),
      securityClass: row.securityClass || null,
    });
  }
  const planetNamesByID = new Map();
  for (const row of await ctx.rows("mapPlanets")) {
    const system = systems.get(Number(row.solarSystemID));
    if (system) {
      planetNamesByID.set(Number(row._key), `${system.solarSystemName} ${romanNumeral(row.celestialIndex)}`);
    }
  }
  return { typeInfoByID, systems, planetNamesByID };
}

function buildCelestialRow(row, support, kind, itemName) {
  const itemID = Number(row._key);
  const system = support.systems.get(Number(row.solarSystemID)) || {};
  const typeInfo = support.typeInfoByID.get(Number(row.typeID)) || {};
  return {
    itemID,
    typeID: toInt(row.typeID, null),
    groupID: toInt(typeInfo.groupID, null),
    categoryID: toInt(typeInfo.categoryID, null),
    groupName: typeInfo.groupName || null,
    solarSystemID: toInt(row.solarSystemID, null),
    constellationID: system.constellationID || null,
    regionID: system.regionID || null,
    orbitID: toNumberOrNull(row.orbitID),
    position: row.position || { x: 0, y: 0, z: 0 },
    radius: toNumberOrNull(row.radius),
    itemName,
    security: system.security ?? null,
    securityClass: system.securityClass || null,
    celestialIndex: toNumberOrNull(row.celestialIndex),
    orbitIndex: toNumberOrNull(row.orbitIndex),
    kind,
  };
}

async function buildCelestials(ctx) {
  const support = await buildCelestialSupport(ctx);
  const celestials = [];

  for (const row of await ctx.rows("mapStars")) {
    const system = support.systems.get(Number(row.solarSystemID));
    if (!system) {
      continue;
    }
    celestials.push(buildCelestialRow(
      { ...row, position: { x: 0, y: 0, z: 0 }, celestialIndex: null, orbitIndex: null },
      support,
      "sun",
      `${system.solarSystemName} - Star`,
    ));
  }

  if (fs.existsSync(ctx.filePath("mapSecondarySuns"))) {
    for (const row of await ctx.rows("mapSecondarySuns")) {
      const system = support.systems.get(Number(row.solarSystemID));
      if (!system) {
        continue;
      }
      celestials.push(buildCelestialRow(
        { ...row, celestialIndex: null, orbitIndex: null },
        support,
        "secondarySun",
        `${system.solarSystemName} - Secondary Star`,
      ));
    }
  }

  for (const row of await ctx.rows("mapPlanets")) {
    const name = support.planetNamesByID.get(Number(row._key));
    if (name) {
      celestials.push(buildCelestialRow(row, support, "planet", name));
    }
  }

  for (const row of await ctx.rows("mapAsteroidBelts")) {
    const orbitName = support.planetNamesByID.get(Number(row.orbitID)) || `Celestial ${row.orbitID}`;
    celestials.push(buildCelestialRow(
      row,
      support,
      "asteroidBelt",
      `${orbitName} - Asteroid Belt ${toInt(row.orbitIndex, 0) || 0}`,
    ));
  }

  celestials.sort((left, right) => left.itemID - right.itemID);
  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedCelestialIDs: celestials.map((row) => row.itemID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: celestials.length,
    celestials,
  };
}

async function buildAsteroidBelts(ctx) {
  const support = await buildCelestialSupport(ctx);
  const belts = [];
  for (const row of await ctx.rows("mapAsteroidBelts")) {
    const orbitName = support.planetNamesByID.get(Number(row.orbitID)) || `Celestial ${row.orbitID}`;
    const celestial = buildCelestialRow(
      row,
      support,
      "asteroidBelt",
      `${orbitName} - Asteroid Belt ${toInt(row.orbitIndex, 0) || 0}`,
    );
    belts.push({
      ...celestial,
      ...buildAsteroidFieldFields(celestial.itemID, celestial.security, celestial.solarSystemID),
    });
  }
  belts.sort((left, right) => left.itemID - right.itemID);
  return {
    source: ctx.sourceMeta({ provider: "EVE Static Data JSONL + local asteroid field derivation" }),
    count: belts.length,
    belts,
  };
}

async function buildStargates(ctx) {
  const systems = new Map();
  for (const row of await ctx.rows("mapSolarSystems")) {
    systems.set(Number(row._key), localize(row.name, `Solar System ${row._key}`));
  }
  const typeInfo = new Map((await buildTypeRows(ctx)).map((row) => [row.typeID, row]));
  const stargates = [];
  for (const row of await ctx.rows("mapStargates")) {
    const itemID = Number(row._key);
    const destination = row.destination || {};
    const destinationSolarSystemID = toInt(destination.solarSystemID, null);
    const destinationID = toInt(destination.stargateID, null);
    const type = typeInfo.get(Number(row.typeID)) || {};
    const destinationSystemName = systems.get(destinationSolarSystemID) || `Solar System ${destinationSolarSystemID}`;
    stargates.push({
      itemID,
      typeID: toInt(row.typeID, null),
      solarSystemID: toInt(row.solarSystemID, null),
      itemName: `Stargate (${destinationSystemName})`,
      position: row.position || { x: 0, y: 0, z: 0 },
      radius: toNumberOrNull(type.radius) ?? 15000,
      destinationID,
      destinationSolarSystemID,
      destinationName: `Stargate (${systems.get(toInt(row.solarSystemID, null)) || row.solarSystemID})`,
    });
  }
  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedStargateIDs: stargates.map((row) => row.itemID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: stargates.length,
    stargates,
  };
}

async function buildStations(ctx) {
  const support = await buildCelestialSupport(ctx);
  const stationTypesPayload = await buildStationTypes(ctx);
  const stationTypesByID = new Map(stationTypesPayload.stationTypes.map((row) => [row.stationTypeID, row]));
  const systemRows = await ctx.rows("mapSolarSystems");
  const systems = new Map(systemRows.map((row) => [Number(row._key), row]));
  const constellationRows = await ctx.rows("mapConstellations");
  const constellations = new Map(constellationRows.map((row) => [Number(row._key), row]));
  const regionRows = await ctx.rows("mapRegions");
  const regions = new Map(regionRows.map((row) => [Number(row._key), row]));
  const corporations = await ctx.map("npcCorporations");
  const operations = await ctx.map("stationOperations");
  const stationRows = await ctx.rows("npcStations");
  const orbitIDs = new Set(stationRows.map((row) => Number(row.orbitID)).filter(Boolean));
  const moonNames = new Map();

  await readJsonl(ctx.filePath("mapMoons"), (row) => {
    const moonID = Number(row._key);
    if (!orbitIDs.has(moonID)) {
      return;
    }
    const planetName = support.planetNamesByID.get(Number(row.orbitID)) || `Celestial ${row.orbitID}`;
    moonNames.set(moonID, `${planetName} - Moon ${toInt(row.orbitIndex, 0) || 0}`);
  });

  const stations = [];
  for (const row of stationRows) {
    const stationID = Number(row._key);
    const system = systems.get(Number(row.solarSystemID)) || {};
    const constellation = constellations.get(Number(system.constellationID)) || {};
    const region = regions.get(Number(system.regionID)) || {};
    const corporation = corporations.get(Number(row.ownerID)) || {};
    const operation = operations.get(Number(row.operationID)) || {};
    const stationType = stationTypesByID.get(Number(row.typeID)) || {};
    const orbitName =
      moonNames.get(Number(row.orbitID)) ||
      support.planetNamesByID.get(Number(row.orbitID)) ||
      `Celestial ${row.orbitID}`;
    const corporationName = localize(corporation.name, `Corporation ${row.ownerID}`);
    const operationName = localize(operation.operationName, "");
    const stationName = row.name
      ? localize(row.name, `Station ${stationID}`)
      : row.useOperationName && operationName
        ? `${orbitName} - ${corporationName} ${operationName}`
        : `${orbitName} - ${corporationName}`;

    stations.push({
      stationID,
      security: toNumberOrNull(system.securityStatus),
      dockingCostPerVolume: 0,
      maxShipVolumeDockable: 50000000,
      officeRentalCost: 10000,
      operationID: toInt(row.operationID, null),
      stationTypeID: toInt(row.typeID, null),
      corporationID: toInt(row.ownerID, null),
      solarSystemID: toInt(row.solarSystemID, null),
      solarSystemName: localize(system.name, `Solar System ${row.solarSystemID}`),
      constellationID: toInt(system.constellationID, null),
      constellationName: localize(constellation.name, `Constellation ${system.constellationID}`),
      regionID: toInt(system.regionID, null),
      regionName: localize(region.name, `Region ${system.regionID}`),
      stationName,
      position: row.position || { x: 0, y: 0, z: 0 },
      reprocessingEfficiency: toNumberOrNull(row.reprocessingEfficiency),
      reprocessingStationsTake: toNumberOrNull(row.reprocessingStationsTake),
      reprocessingHangarFlag: toNumberOrNull(row.reprocessingHangarFlag),
      itemName: stationName,
      itemID: stationID,
      groupID: stationType.groupID ?? 15,
      categoryID: stationType.categoryID ?? 3,
      orbitID: toInt(row.orbitID, null),
      orbitName,
      orbitGroupID: moonNames.has(Number(row.orbitID)) ? 8 : 7,
      orbitTypeID: moonNames.has(Number(row.orbitID)) ? 14 : null,
      orbitKind: moonNames.has(Number(row.orbitID)) ? "moon" : "planet",
      stationTypeName: stationType.typeName || `Type ${row.typeID}`,
      stationRaceID: stationType.raceID ?? null,
      stationGraphicID: stationType.graphicID ?? null,
      radius: stationType.radius ?? null,
      interactionRadius: stationType.radius ?? null,
      useOperationName: row.useOperationName === true,
      dockEntry: stationType.dockEntry || null,
      dockOrientation: stationType.dockOrientation || null,
      graphicLocationID: stationType.graphicLocationID || null,
      directionalLocatorCategories: stationType.directionalLocatorCategories || [],
      undockLocatorCategories: stationType.undockLocatorCategories || [],
    });
  }

  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedStationIDs: stations.map((row) => row.stationID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: stations.length,
    stations,
  };
}

async function buildMovementAttributes(ctx) {
  const typeRows = await buildTypeRows(ctx, (row) => [2, 3, 6].includes(row.categoryID));
  const targetIDs = new Set(typeRows.map((row) => row.typeID));
  const baseByID = new Map(typeRows.map((row) => [row.typeID, row]));
  const dogmaByID = new Map();
  await readJsonl(ctx.filePath("typeDogma"), (row) => {
    const typeID = Number(row._key);
    if (!targetIDs.has(typeID)) {
      return;
    }
    const attributes = {};
    for (const attr of Array.isArray(row.dogmaAttributes) ? row.dogmaAttributes : []) {
      attributes[String(attr.attributeID)] = Number(attr.value);
    }
    dogmaByID.set(typeID, attributes);
  });

  const attributes = [];
  for (const base of typeRows) {
    const dogma = dogmaByID.get(base.typeID) || {};
    const mass = toNumberOrNull(base.mass) ?? toNumberOrNull(dogma[DOGMA_ATTRIBUTE_IDS.mass]);
    const inertia = toNumberOrNull(dogma[DOGMA_ATTRIBUTE_IDS.inertia]);
    const maxVelocity = toNumberOrNull(dogma[DOGMA_ATTRIBUTE_IDS.maxVelocity]);
    attributes.push({
      typeID: base.typeID,
      typeName: base.name,
      mass,
      maxVelocity,
      inertia,
      radius: toNumberOrNull(base.radius),
      signatureRadius: toNumberOrNull(dogma[DOGMA_ATTRIBUTE_IDS.signatureRadius]),
      warpSpeedMultiplier: toNumberOrNull(dogma[DOGMA_ATTRIBUTE_IDS.warpSpeedMultiplier]),
      alignTime: mass !== null && inertia !== null ? -Math.log(0.25) * mass * inertia / 1000000 : null,
      maxAccelerationTime: null,
    });
  }
  return {
    source: ctx.sourceMeta({ jsonlSync: { updatedTypeIDs: attributes.map((row) => row.typeID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
    count: attributes.length,
    attributes,
  };
}

async function buildCharacterCreationRaces(ctx) {
  const types = (await ctx.typeContext()).types;
  const races = [];
  for (const row of await ctx.rows("races")) {
    const raceID = Number(row._key);
    if (![1, 2, 4, 8].includes(raceID) || !row.shipTypeID) {
      continue;
    }
    const ship = types.get(Number(row.shipTypeID)) || {};
    races.push({
      raceID,
      name: localize(row.name, `Race ${raceID}`),
      shipTypeID: toInt(row.shipTypeID, null),
      shipName: localize(ship.name, `Type ${row.shipTypeID}`),
      skills: decodeSdePairs(row.skills, "typeID", "level")
        .map((skill) => ({ typeID: skill.typeID, level: toInt(skill.level, 0) || 0 }))
        .sort((left, right) => left.typeID - right.typeID),
    });
  }
  return {
    races,
    count: races.length,
    source: ctx.sourceMeta({ jsonlSync: { updatedRaceIDs: races.map((row) => row.raceID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
  };
}

async function buildCharacterCreationBloodlines(ctx) {
  const bloodlines = [];
  for (const row of await ctx.rows("bloodlines")) {
    const bloodlineID = Number(row._key);
    if (![1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14].includes(bloodlineID)) {
      continue;
    }
    bloodlines.push({
      bloodlineID,
      name: localize(row.name, `Bloodline ${bloodlineID}`),
      raceID: toInt(row.raceID, null),
      corporationID: toInt(row.corporationID, null),
    });
  }
  return {
    bloodlines,
    count: bloodlines.length,
    source: ctx.sourceMeta({ jsonlSync: { updatedBloodlineIDs: bloodlines.map((row) => row.bloodlineID), sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate } }),
  };
}

async function buildFactions(ctx) {
  const records = {};
  for (const row of await ctx.rows("factions")) {
    const factionID = Number(row._key);
    records[String(factionID)] = {
      factionID,
      corporationID: toInt(row.corporationID, null),
      name: localize(row.name, `Faction ${factionID}`),
      shortDescription: localize(row.shortDescription, ""),
      description: localize(row.description, ""),
      flatLogo: row.flatLogo || null,
      flatLogoWithName: row.flatLogoWithName || null,
      iconID: toInt(row.iconID, null),
      militiaCorporationID: toInt(row.militiaCorporationID, null),
      solarSystemID: toInt(row.solarSystemID, null),
      sizeFactor: toNumberOrNull(row.sizeFactor),
      uniqueName: row.uniqueName === true,
      memberRaces: Array.isArray(row.memberRaces) ? row.memberRaces : [],
    };
  }
  return {
    _meta: {
      source: `${relativeToRepo(ctx.sourceDir)}/factions.jsonl`,
      buildNumber: ctx.sde.buildNumber,
      releaseDate: ctx.sde.releaseDate,
      count: Object.keys(records).length,
    },
    records,
  };
}

function normalizeActivity(raw = {}) {
  return {
    time: toInt(raw.time, 0) || 0,
    materials: (Array.isArray(raw.materials) ? raw.materials : [])
      .map((entry) => ({ typeID: toInt(entry.typeID, 0) || 0, quantity: toInt(entry.quantity, 0) || 0 }))
      .filter((entry) => entry.typeID > 0 && entry.quantity > 0),
    products: (Array.isArray(raw.products) ? raw.products : [])
      .map((entry) => ({ typeID: toInt(entry.typeID, 0) || 0, quantity: toInt(entry.quantity, 0) || 0, probability: toNumberOrNull(entry.probability) }))
      .filter((entry) => entry.typeID > 0 && entry.quantity > 0),
    skills: (Array.isArray(raw.skills) ? raw.skills : [])
      .map((entry) => ({ typeID: toInt(entry.typeID, 0) || 0, level: toInt(entry.level, 0) || 0 }))
      .filter((entry) => entry.typeID > 0),
  };
}

async function buildIndustryBlueprints(ctx) {
  const typeRows = await buildTypeRows(ctx);
  const typeByID = new Map(typeRows.map((row) => [row.typeID, row]));
  const definitions = [];
  const definitionsByTypeID = {};
  const blueprintTypeIDsByProductTypeID = {};
  const manufacturingBlueprintTypeIDs = [];

  for (const row of await ctx.rows("blueprints")) {
    const blueprintTypeID = Number(row._key || row.blueprintTypeID);
    const blueprintType = typeByID.get(blueprintTypeID) || {};
    const activities = {};
    for (const [activityName, activity] of Object.entries(row.activities || {})) {
      activities[activityName] = normalizeActivity(activity);
    }
    const product = activities.manufacturing && activities.manufacturing.products[0]
      ? activities.manufacturing.products[0]
      : null;
    const productType = product ? typeByID.get(product.typeID) || {} : {};
    const definition = {
      blueprintTypeID,
      blueprintName: blueprintType.name || `Type ${blueprintTypeID}`,
      blueprintGroupID: blueprintType.groupID || null,
      blueprintGroupName: blueprintType.groupName || null,
      blueprintCategoryID: blueprintType.categoryID || null,
      blueprintCategoryName: blueprintType.categoryName || null,
      productTypeID: product ? product.typeID : null,
      productName: product ? productType.name || `Type ${product.typeID}` : null,
      productGroupID: product ? productType.groupID || null : null,
      productGroupName: product ? productType.groupName || null : null,
      productCategoryID: product ? productType.categoryID || null : null,
      productCategoryName: product ? productType.categoryName || null : null,
      maxProductionLimit: toInt(row.maxProductionLimit, 0) || 0,
      published: blueprintType.published === true,
      activities,
    };
    definitions.push(definition);
    definitionsByTypeID[String(blueprintTypeID)] = definition;
    if (product) {
      blueprintTypeIDsByProductTypeID[String(product.typeID)] = blueprintTypeID;
      manufacturingBlueprintTypeIDs.push(blueprintTypeID);
    }
  }

  return {
    source: ctx.sourceMeta({ loader: "scripts/DataSync/sync-jsonl-local-static-data.js" }),
    blueprintDefinitions: definitions,
    blueprintDefinitionsByTypeID: definitionsByTypeID,
    blueprintTypeIDsByProductTypeID,
    manufacturingBlueprintTypeIDs: manufacturingBlueprintTypeIDs.sort((left, right) => left - right),
  };
}

async function buildIndustryFacilities(ctx) {
  const operations = await ctx.map("stationOperations");
  const systems = await ctx.map("mapSolarSystems");
  const facilities = [];
  for (const row of await ctx.rows("npcStations")) {
    const operation = operations.get(Number(row.operationID)) || {};
    const serviceIDs = Array.isArray(operation.services) ? operation.services.map((id) => Number(id)).sort((left, right) => left - right) : [];
    const system = systems.get(Number(row.solarSystemID)) || {};
    facilities.push({
      facilityID: Number(row._key),
      solarSystemID: toInt(row.solarSystemID, null),
      regionID: toInt(system.regionID, null),
      typeID: toInt(row.typeID, null),
      ownerID: toInt(row.ownerID, null),
      operationID: toInt(row.operationID, null),
      serviceIDs,
      supportsFactory: serviceIDs.some((id) => [10, 13, 14, 17, 18, 19, 20, 21, 22, 23, 24, 25].includes(id)),
      supportsLaboratory: serviceIDs.some((id) => [11, 12, 14, 23, 24].includes(id)),
      manufacturingFactor: toNumberOrNull(operation.manufacturingFactor) ?? 1,
      researchFactor: toNumberOrNull(operation.researchFactor) ?? 1,
    });
  }
  const byID = {};
  for (const facility of facilities) {
    byID[String(facility.facilityID)] = facility;
  }
  return {
    source: ctx.sourceMeta({ loader: "scripts/DataSync/sync-jsonl-local-static-data.js" }),
    npcFacilityProfiles: facilities,
    npcFacilityProfilesByFacilityID: byID,
  };
}

async function buildItemIcons(ctx) {
  const iconsByID = {};
  for (const row of await ctx.rows("icons")) {
    const iconID = Number(row._key);
    const iconFile = typeof row.iconFile === "string" ? row.iconFile.trim() : "";
    if (Number.isInteger(iconID) && iconFile) {
      iconsByID[String(iconID)] = iconFile;
    }
  }
  return {
    meta: {
      version: 1,
      description: "Cached iconID to res path authority for local store/catalog image seeding.",
      updatedAt: new Date().toISOString(),
      sourceSnapshot: `eve-online-static-data-${ctx.sde.buildNumber}-jsonl`,
    },
    iconsByID,
  };
}

async function buildShipCosmeticsCatalog(ctx) {
  const typeRows = await buildTypeRows(ctx);
  const typesByID = new Map(typeRows.map((row) => [row.typeID, row]));
  const materialsByMaterialID = {};
  for (const row of await ctx.rows("skinMaterials")) {
    const materialID = Number(row._key);
    materialsByMaterialID[String(materialID)] = {
      skinMaterialID: materialID,
      displayNameID: toInt(row.displayNameID, null),
      materialSetID: toInt(row.materialSetID, null),
      displayName: localizedObject(row.displayName),
    };
  }

  const licensesBySkinID = new Map();
  const licenseTypesByTypeID = {};
  for (const row of await ctx.rows("skinLicenses")) {
    const licenseTypeID = Number(row.licenseTypeID || row._key);
    const typeInfo = typesByID.get(licenseTypeID) || {};
    const license = {
      licenseTypeID,
      duration: toInt(row.duration, null),
      isSingleUse: row.isSingleUse === true,
      typeName: typeInfo.name || `Type ${licenseTypeID}`,
      published: typeInfo.published === true,
      groupID: typeInfo.groupID || null,
      groupName: typeInfo.groupName || null,
      groupPublished: true,
    };
    licenseTypesByTypeID[String(licenseTypeID)] = license;
    const skinID = Number(row.skinID);
    if (!licensesBySkinID.has(skinID)) {
      licensesBySkinID.set(skinID, []);
    }
    licensesBySkinID.get(skinID).push(license);
  }

  const skinsBySkinID = {};
  const shipTypesByTypeID = {};
  for (const row of await ctx.rows("skins")) {
    const skinID = Number(row._key);
    const material = materialsByMaterialID[String(row.skinMaterialID)] || null;
    const licenseTypes = (licensesBySkinID.get(skinID) || []).sort((left, right) => left.licenseTypeID - right.licenseTypeID);
    const shipTypeIDs = (Array.isArray(row.types) ? row.types : []).map(Number).sort((left, right) => left - right);
    skinsBySkinID[String(skinID)] = {
      skinID,
      internalName: row.internalName || `SKIN ${skinID}`,
      skinMaterialID: toInt(row.skinMaterialID, null),
      material,
      shipTypeIDs,
      licenseTypeIDs: licenseTypes.map((license) => license.licenseTypeID),
      licenseTypes,
      allowCCPDevs: row.allowCCPDevs === true,
      skinDescription: row.skinDescription || null,
      visibleSerenity: row.visibleSerenity === true,
      visibleTranquility: row.visibleTranquility !== false,
    };
    for (const typeID of shipTypeIDs) {
      if (!shipTypesByTypeID[String(typeID)]) {
        shipTypesByTypeID[String(typeID)] = {
          typeID,
          skinIDs: [],
          materialIDs: [],
          licenseTypeIDs: [],
        };
      }
      shipTypesByTypeID[String(typeID)].skinIDs.push(skinID);
      if (row.skinMaterialID != null) {
        shipTypesByTypeID[String(typeID)].materialIDs.push(Number(row.skinMaterialID));
      }
      shipTypesByTypeID[String(typeID)].licenseTypeIDs.push(...licenseTypes.map((license) => license.licenseTypeID));
    }
  }

  for (const entry of Object.values(shipTypesByTypeID)) {
    entry.skinIDs = [...new Set(entry.skinIDs)].sort((left, right) => left - right);
    entry.materialIDs = [...new Set(entry.materialIDs)].sort((left, right) => left - right);
    entry.licenseTypeIDs = [...new Set(entry.licenseTypeIDs)].sort((left, right) => left - right);
  }

  return {
    meta: ctx.sourceMeta({
      description: "Ship cosmetics catalog synchronized from the local EVE Static Data JSONL snapshot.",
      jsonlSync: { sourceDir: relativeToRepo(ctx.sourceDir), buildNumber: ctx.sde.buildNumber, releaseDate: ctx.sde.releaseDate },
    }),
    counts: {
      skins: Object.keys(skinsBySkinID).length,
      shipTypes: Object.keys(shipTypesByTypeID).length,
      materials: Object.keys(materialsByMaterialID).length,
      licenseTypes: Object.keys(licenseTypesByTypeID).length,
    },
    skinsBySkinID,
    shipTypesByTypeID,
    materialsByMaterialID,
    licenseTypesByTypeID,
  };
}

async function buildReprocessingStatic(ctx) {
  const typeRows = await buildTypeRows(ctx);
  const typesByID = new Map(typeRows.map((row) => [row.typeID, row]));
  const typeDogmaAttrs = new Map();
  await readJsonl(ctx.filePath("typeDogma"), (row) => {
    const attributes = {};
    for (const attr of Array.isArray(row.dogmaAttributes) ? row.dogmaAttributes : []) {
      attributes[String(attr.attributeID)] = Number(attr.value);
    }
    typeDogmaAttrs.set(Number(row._key), attributes);
  });

  const reprocessingTypes = [];
  for (const row of await ctx.rows("typeMaterials")) {
    const typeID = Number(row._key);
    const typeInfo = typesByID.get(typeID);
    if (!typeInfo) {
      continue;
    }
    const attributes = typeDogmaAttrs.get(typeID) || {};
    reprocessingTypes.push({
      typeID,
      name: typeInfo.name,
      groupID: typeInfo.groupID,
      categoryID: typeInfo.categoryID,
      groupName: typeInfo.groupName,
      portionSize: typeInfo.portionSize,
      basePrice: typeInfo.basePrice,
      published: typeInfo.published,
      reprocessingSkillType: toNumberOrNull(attributes[DOGMA_ATTRIBUTE_IDS.reprocessingSkillType]),
      reprocessingFamily: String(typeInfo.groupName || "").toLowerCase().includes("ice") ? "ice" : "ore",
      isRefinable: true,
      isRecyclable: true,
      materials: (Array.isArray(row.materials) ? row.materials : [])
        .map((entry) => ({ materialTypeID: toInt(entry.materialTypeID, 0) || 0, quantity: toInt(entry.quantity, 0) || 0 }))
        .filter((entry) => entry.materialTypeID > 0 && entry.quantity > 0),
      randomizedMaterials: [],
      averageRandomizedOutputs: [],
    });
  }

  const compressedTypeBySourceTypeID = {};
  const sourceTypesByCompressedTypeID = {};
  for (const row of await ctx.rows("compressibleTypes")) {
    const sourceTypeID = Number(row._key);
    const compressedTypeID = Number(row.compressedTypeID);
    compressedTypeBySourceTypeID[String(sourceTypeID)] = compressedTypeID;
    if (!sourceTypesByCompressedTypeID[String(compressedTypeID)]) {
      sourceTypesByCompressedTypeID[String(compressedTypeID)] = [];
    }
    sourceTypesByCompressedTypeID[String(compressedTypeID)].push(sourceTypeID);
  }

  const structureReprocessingProfiles = typeRows
    .filter((row) => row.categoryID === 6 || row.categoryID === 65)
    .map((row) => {
      const attrs = typeDogmaAttrs.get(row.typeID) || {};
      return {
        typeID: row.typeID,
        name: row.name,
        rigSize: toNumberOrNull(attrs[DOGMA_ATTRIBUTE_IDS.rigSize]) ?? 1,
        reprocessingYieldBonusPercent: 0,
        gasDecompressionEfficiencyBase: toNumberOrNull(attrs[DOGMA_ATTRIBUTE_IDS.gasDecompressionEfficiencyBase]) ?? 0.8,
        gasDecompressionEfficiencyBonusAdd: toNumberOrNull(attrs[DOGMA_ATTRIBUTE_IDS.gasDecompressionEfficiencyBonusAdd]) ?? 0,
      };
    });

  const reprocessingRigProfiles = typeRows
    .filter((row) => /reprocessing|materials reclamation|ore grading|ice grading|moon ore/i.test(row.name))
    .map((row) => {
      const attrs = typeDogmaAttrs.get(row.typeID) || {};
      return {
        typeID: row.typeID,
        name: row.name,
        rigSize: toNumberOrNull(attrs[DOGMA_ATTRIBUTE_IDS.rigSize]),
        refiningYieldMultiplierBase: toNumberOrNull(attrs[DOGMA_ATTRIBUTE_IDS.refiningYieldMultiplier]),
        securityMultipliers: { high: 1, low: 1.06, null: 1.12 },
        yieldClasses: /ice/i.test(row.name) ? ["ice"] : ["ore"],
        isGeneralMonitor: /monitor/i.test(row.name),
      };
    });

  return {
    source: ctx.sourceMeta({
      loader: "scripts/DataSync/sync-jsonl-local-static-data.js",
      randomizedChoiceMode: "Official JSONL SDE does not include local client randomized material rows; those remain sourced from client-cache DataSync.",
    }),
    reprocessingTypes,
    structureReprocessingProfiles,
    reprocessingRigProfiles,
    compressedTypeBySourceTypeID,
    sourceTypesByCompressedTypeID,
  };
}

async function buildSovereigntyStatic(ctx) {
  const planets = await ctx.map("mapPlanets");
  const stars = await ctx.map("mapStars");
  const systems = await ctx.map("mapSolarSystems");
  const types = new Map((await buildTypeRows(ctx)).map((row) => [row.typeID, row]));
  const planetDefinitions = [];
  const starConfigurations = [];
  const planetsBySolarSystemID = {};

  for (const row of await ctx.rows("planetResources")) {
    const itemID = Number(row._key);
    const planet = planets.get(itemID);
    const star = stars.get(itemID);
    if (planet) {
      const solarSystemID = Number(planet.solarSystemID);
      const definition = {
        planetID: itemID,
        solarSystemID,
        power: toInt(row.power, 0) || 0,
        workforce: toInt(row.workforce, 0) || 0,
        reagentDefinitions: Array.isArray(row.reagents) ? row.reagents : [],
      };
      planetDefinitions.push(definition);
      if (!planetsBySolarSystemID[String(solarSystemID)]) {
        planetsBySolarSystemID[String(solarSystemID)] = [];
      }
      planetsBySolarSystemID[String(solarSystemID)].push(itemID);
    } else if (star) {
      starConfigurations.push({
        starID: itemID,
        solarSystemID: Number(star.solarSystemID),
        power: toInt(row.power, 0) || 0,
      });
    }
  }

  for (const list of Object.values(planetsBySolarSystemID)) {
    list.sort((left, right) => left - right);
  }

  const claimableSolarSystemIDs = Object.keys(planetsBySolarSystemID)
    .map(Number)
    .filter((solarSystemID) => {
      const system = systems.get(solarSystemID);
      return system && Number(system.securityStatus) <= 0.0;
    })
    .sort((left, right) => left - right);

  const upgradeDefinitions = [];
  for (const row of await ctx.rows("sovereigntyUpgrades")) {
    const typeID = Number(row._key);
    const typeInfo = types.get(typeID) || {};
    upgradeDefinitions.push({
      installationTypeID: typeID,
      powerRequired: toInt(row.power_allocation, 0) || 0,
      workforceRequired: toInt(row.workforce_allocation, 0) || 0,
      fuelTypeID: row.fuel ? toInt(row.fuel.type_id, null) : null,
      fuelConsumptionPerHour: row.fuel ? toInt(row.fuel.hourly_upkeep, 0) || 0 : 0,
      fuelStartupCost: row.fuel ? toInt(row.fuel.startup_cost, 0) || 0 : 0,
      mutuallyExclusiveGroup: row.mutually_exclusive_group || null,
      powerProduced: toInt(row.power_production, 0) || 0,
      workforceProduced: toInt(row.workforce_production, 0) || 0,
      requiredStrategicIndex: toInt(row.required_strategic_index, 0) || 0,
      typeName: typeInfo.name || `Type ${typeID}`,
      groupID: typeInfo.groupID || null,
      published: typeInfo.published === true,
    });
  }

  return {
    source: ctx.sourceMeta({ loader: "scripts/DataSync/sync-jsonl-local-static-data.js" }),
    planetDefinitionsVersion: { major: 23, minor: 2, patch: 0, prerelease_tags: [], build_tags: ["evejs"] },
    claimableSolarSystemIDs,
    planetDefinitions: planetDefinitions.sort((left, right) => left.planetID - right.planetID),
    planetsBySolarSystemID,
    starConfigurations: starConfigurations.sort((left, right) => left.starID - right.starID),
    upgradeDefinitions: upgradeDefinitions.sort((left, right) => left.installationTypeID - right.installationTypeID),
  };
}

async function buildCertificates(ctx) {
  const groupRows = await ctx.map("groups");
  const certificates = [];
  const certificatesByID = {};
  const certificateIDsByGroupID = {};
  const certificateIDsByShipTypeID = {};

  for (const row of await ctx.rows("certificates")) {
    const certificateID = Number(row._key);
    const requirementsBySkillTypeID = {};
    for (const requirement of Array.isArray(row.skillTypes) ? row.skillTypes : []) {
      const skillTypeID = Number(requirement._key);
      requirementsBySkillTypeID[String(skillTypeID)] = {
        1: toInt(requirement.basic, 0) || 0,
        2: toInt(requirement.standard, 0) || 0,
        3: toInt(requirement.improved, 0) || 0,
        4: toInt(requirement.advanced, 0) || 0,
        5: toInt(requirement.elite, 0) || 0,
      };
    }
    const groupID = toInt(row.groupID, 0) || 0;
    const group = groupRows.get(groupID) || {};
    const certificate = {
      certificateID,
      groupID,
      groupName: localize(group.name, `Group ${groupID}`),
      name: localize(row.name, `Certificate ${certificateID}`),
      description: localize(row.description, ""),
      recommendedFor: [...new Set((Array.isArray(row.recommendedFor) ? row.recommendedFor : []).map(Number).filter((id) => id > 0))]
        .sort((left, right) => left - right),
      requirementsBySkillTypeID,
    };
    certificates.push(certificate);
    certificatesByID[String(certificateID)] = certificate;
    if (!certificateIDsByGroupID[String(groupID)]) {
      certificateIDsByGroupID[String(groupID)] = [];
    }
    certificateIDsByGroupID[String(groupID)].push(certificateID);
    for (const shipTypeID of certificate.recommendedFor) {
      if (!certificateIDsByShipTypeID[String(shipTypeID)]) {
        certificateIDsByShipTypeID[String(shipTypeID)] = [];
      }
      certificateIDsByShipTypeID[String(shipTypeID)].push(certificateID);
    }
  }
  certificates.sort((left, right) => left.name.localeCompare(right.name) || left.certificateID - right.certificateID);
  for (const ids of Object.values(certificateIDsByGroupID)) {
    ids.sort((left, right) => left - right);
  }
  for (const ids of Object.values(certificateIDsByShipTypeID)) {
    ids.sort((left, right) => left - right);
  }
  return {
    source: ctx.sourceMeta({ description: "Generated certificate authority for certificate runtime." }),
    counts: {
      certificates: certificates.length,
      groups: Object.keys(certificateIDsByGroupID).length,
      recommendedShipTypes: Object.keys(certificateIDsByShipTypeID).length,
    },
    certificates,
    certificatesByID,
    certificateIDsByGroupID,
    certificateIDsByShipTypeID,
  };
}

async function buildNpcCorporationAuthority(ctx) {
  const recordsByID = {};
  const records = [];
  for (const row of await ctx.rows("npcCorporations")) {
    const corporationID = Number(row._key);
    const record = { ...row, corporationID };
    recordsByID[String(corporationID)] = record;
    records.push(record);
  }
  return {
    source: ctx.sourceMeta({ sourceTables: ["npcCorporations.jsonl"] }),
    counts: { corporations: records.length },
    records,
    recordsByID,
  };
}

async function buildNpcCharacterAuthority(ctx) {
  const recordsByID = {};
  const records = [];
  for (const row of await ctx.rows("npcCharacters")) {
    const characterID = Number(row._key);
    const record = { ...row, characterID };
    recordsByID[String(characterID)] = record;
    records.push(record);
  }
  return {
    source: ctx.sourceMeta({ sourceTables: ["npcCharacters.jsonl"] }),
    counts: { characters: records.length },
    records,
    recordsByID,
  };
}

const BUILDERS = {
  itemTypes: buildItemTypes,
  shipTypes: buildShipTypes,
  skillTypes: buildSkillTypes,
  typeDogma: buildTypeDogma,
  shipDogmaAttributes: buildShipDogmaAttributes,
  dbuffCollections: buildDbuffCollections,
  solarSystems: buildSolarSystems,
  celestials: buildCelestials,
  asteroidBelts: buildAsteroidBelts,
  stargates: buildStargates,
  stations: buildStations,
  stationTypes: buildStationTypes,
  stargateTypes: buildStargateTypes,
  movementAttributes: buildMovementAttributes,
  characterCreationRaces: buildCharacterCreationRaces,
  characterCreationBloodlines: buildCharacterCreationBloodlines,
  factions: buildFactions,
  industryBlueprints: buildIndustryBlueprints,
  industryFacilities: buildIndustryFacilities,
  itemIcons: buildItemIcons,
  shipCosmeticsCatalog: buildShipCosmeticsCatalog,
  sovereigntyStatic: buildSovereigntyStatic,
  reprocessingStatic: buildReprocessingStatic,
  certificates: buildCertificates,
  mapNames: buildMapNames,
  npcCorporationAuthority: buildNpcCorporationAuthority,
  npcCharacterAuthority: buildNpcCharacterAuthority,
};

function requestUrl(url, outputPath = null) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "evejs-datasync/1.0" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        requestUrl(nextUrl, outputPath).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      if (outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        const stream = fs.createWriteStream(outputPath);
        response.pipe(stream);
        stream.on("finish", () => {
          stream.close(() => resolve({ url, outputPath }));
        });
        stream.on("error", reject);
      } else {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    });
    request.on("error", reject);
  });
}

function extractZip(zipPath, destinationPath) {
  fs.mkdirSync(destinationPath, { recursive: true });
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "Expand-Archive", "-LiteralPath", zipPath, "-DestinationPath", destinationPath, "-Force"],
      { stdio: "pipe", encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`Expand-Archive failed: ${result.stderr || result.stdout}`);
    }
    return;
  }
  const result = spawnSync("unzip", ["-q", zipPath, "-d", destinationPath], { stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`unzip failed: ${result.stderr || result.stdout}`);
  }
}

function findExtractedSourceDir(rootDir) {
  const direct = path.join(rootDir, "types.jsonl");
  if (fs.existsSync(direct)) {
    return rootDir;
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(rootDir, entry.name);
    if (fs.existsSync(path.join(candidate, "types.jsonl"))) {
      return candidate;
    }
  }
  throw new Error(`Could not find extracted JSONL SDE under ${rootDir}`);
}

function replaceDirectory(sourceDir, targetDir) {
  const backupDir = `${targetDir}.previous-${Date.now()}`;
  if (fs.existsSync(targetDir)) {
    fs.renameSync(targetDir, backupDir);
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  try {
    fs.renameSync(sourceDir, targetDir);
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    if (fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, targetDir);
    }
    throw error;
  }
}

async function downloadLatestSource(targetDir = DEFAULT_SOURCE_DIR) {
  const latestRaw = await requestUrl(LATEST_JSONL_URL);
  const latest = JSON.parse(latestRaw.trim());
  if (!latest || latest._key !== "sde" || !Number.isInteger(Number(latest.buildNumber))) {
    throw new Error("latest.jsonl did not return an SDE build record");
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-sde-"));
  const zipPath = path.join(tempRoot, "sde-jsonl.zip");
  const extractRoot = path.join(tempRoot, "extract");
  await requestUrl(LATEST_JSONL_ZIP_URL, zipPath);
  extractZip(zipPath, extractRoot);
  const extractedSourceDir = findExtractedSourceDir(extractRoot);
  const ctx = new SdeContext(extractedSourceDir);
  await ctx.validate();
  if (ctx.sde.buildNumber !== Number(latest.buildNumber)) {
    throw new Error(`Downloaded SDE build ${ctx.sde.buildNumber} does not match latest ${latest.buildNumber}`);
  }
  replaceDirectory(extractedSourceDir, targetDir);
  return {
    buildNumber: ctx.sde.buildNumber,
    releaseDate: ctx.sde.releaseDate,
    targetDir,
  };
}

async function buildTables(ctx, tableNames) {
  const outputs = {};
  for (const tableName of tableNames) {
    const builder = BUILDERS[tableName];
    if (!builder) {
      throw new Error(`Unknown table: ${tableName}`);
    }
    outputs[tableName] = await builder(ctx);
  }
  return outputs;
}

function diffOutput(tableName, payload) {
  const filePath = tableDataPath(tableName);
  const nextText = jsonStringify(payload);
  const previousText = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  return {
    table: tableName,
    path: filePath,
    relativePath: relativeToRepo(filePath),
    exists: fs.existsSync(filePath),
    changed: previousText !== nextText,
    previousHash: previousText ? sha256(previousText) : null,
    nextHash: sha256(nextText),
    bytes: Buffer.byteLength(nextText, "utf8"),
    text: nextText,
  };
}

async function runSync(options) {
  if (options.download) {
    const downloaded = await downloadLatestSource(options.sourceDir);
    process.stdout.write(`Downloaded SDE build ${downloaded.buildNumber} to ${relativeToRepo(downloaded.targetDir)}\n`);
  }

  const tableNames = options.tables || DEFAULT_TABLES;
  const unknown = tableNames.filter((tableName) => !BUILDERS[tableName]);
  if (unknown.length > 0) {
    throw new Error(`Unknown table(s): ${unknown.join(", ")}`);
  }

  const ctx = new SdeContext(options.sourceDir);
  await ctx.validate();
  const outputs = await buildTables(ctx, tableNames);
  const diffs = [];
  for (const tableName of tableNames) {
    const diff = diffOutput(tableName, outputs[tableName]);
    diffs.push(diff);
    if (options.apply) {
      fs.mkdirSync(path.dirname(diff.path), { recursive: true });
      fs.writeFileSync(diff.path, diff.text, "utf8");
    }
  }

  return {
    sourceDir: options.sourceDir,
    buildNumber: ctx.sde.buildNumber,
    releaseDate: ctx.sde.releaseDate,
    mode: options.apply ? "apply" : "dry-run",
    tableCount: tableNames.length,
    changedTables: diffs.filter((diff) => diff.changed).map((diff) => diff.table),
    outputs: diffs.map((diff) => ({
      table: diff.table,
      path: diff.relativePath,
      changed: diff.changed,
      exists: diff.exists,
      bytes: diff.bytes,
      previousHash: diff.previousHash,
      nextHash: diff.nextHash,
    })),
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }
  const summary = await runSync(options);
  process.stdout.write(`SDE build ${summary.buildNumber} (${summary.releaseDate}) ${summary.mode}\n`);
  for (const output of summary.outputs) {
    const marker = output.changed ? "changed" : "same";
    process.stdout.write(`${marker.padEnd(7)} ${output.path} (${output.bytes} bytes)\n`);
  }
  process.stdout.write(`SUMMARY ${JSON.stringify({
    buildNumber: summary.buildNumber,
    releaseDate: summary.releaseDate,
    mode: summary.mode,
    tableCount: summary.tableCount,
    changedTables: summary.changedTables,
  })}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  BUILDERS,
  DEFAULT_TABLES,
  SdeContext,
  buildTables,
  decodeSdePairs,
  downloadLatestSource,
  parseArgs,
  romanNumeral,
  runSync,
};
