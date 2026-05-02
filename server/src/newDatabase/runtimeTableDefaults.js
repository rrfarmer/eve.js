"use strict";

const CUSTOM_CORPORATION_ID_START = 98000000;
const CUSTOM_ALLIANCE_ID_START = 99000000;
const FIRST_MAILING_LIST_ID = 500000000;
const ACCOUNT_ID_FLOOR = 1;
const CHARACTER_ID_FLOOR = 140000001;
const ITEM_ID_FLOOR = 1990000000;
const INDUSTRY_JOB_ID_START = 980000000001;
const INDUSTRY_MONITOR_ID_START = 990000000001;

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const RECORD_TABLE = Object.freeze({ records: {} });
const EMPTY_OBJECT = Object.freeze({});

const RUNTIME_TABLE_DEFAULTS = Object.freeze({
  accessGroups: Object.freeze({ _meta: { nextGroupID: 1 } }),
  accounts: EMPTY_OBJECT,
  alliances: Object.freeze({
    _meta: { nextCustomAllianceID: CUSTOM_ALLIANCE_ID_START },
    records: {},
  }),
  bookmarkFolders: RECORD_TABLE,
  bookmarkGroups: RECORD_TABLE,
  bookmarkKnownFolders: Object.freeze({ recordsByCharacterID: {} }),
  bookmarkRuntimeState: Object.freeze({
    _meta: {
      version: 1,
      nextBookmarkID: 900000001,
      nextFolderID: 500001,
      nextSubfolderID: 700001,
      nextGroupID: 800001,
      migratedCharacterIDs: {},
    },
  }),
  bookmarkSubfolders: RECORD_TABLE,
  bookmarks: RECORD_TABLE,
  calendarEvents: Object.freeze({
    version: 1,
    nextEventID: 980000000000,
    events: {},
  }),
  calendarResponses: Object.freeze({
    version: 1,
    responses: {},
  }),
  characterExpertSystems: EMPTY_OBJECT,
  characterNotes: Object.freeze({
    _meta: {
      version: 1,
      nextNoteID: 1,
    },
    characters: {},
  }),
  characters: EMPTY_OBJECT,
  corporationBills: EMPTY_OBJECT,
  corporationGoals: Object.freeze({
    _meta: { version: 1 },
    records: {},
  }),
  corporationRuntime: EMPTY_OBJECT,
  corporationVotes: EMPTY_OBJECT,
  corporations: Object.freeze({
    _meta: {
      nextCustomCorporationID: CUSTOM_CORPORATION_ID_START,
      npcSeedVersion: 0,
    },
    records: {},
  }),
  dungeonRuntimeState: EMPTY_OBJECT,
  evermarkEntitlements: EMPTY_OBJECT,
  identityState: Object.freeze({
    version: 1,
    nextAccountID: ACCOUNT_ID_FLOOR,
    nextCharacterID: CHARACTER_ID_FLOOR,
    nextItemID: ITEM_ID_FLOOR,
  }),
  industryBlueprintState: Object.freeze({
    _meta: { version: 1 },
    records: {},
  }),
  industryFacilityState: EMPTY_OBJECT,
  industryJobs: Object.freeze({
    _meta: {
      version: 1,
      nextJobID: INDUSTRY_JOB_ID_START,
    },
    jobs: {},
  }),
  industryRuntime: Object.freeze({
    _meta: {
      version: 1,
      nextMonitorID: INDUSTRY_MONITOR_ID_START,
    },
    monitors: {},
  }),
  items: EMPTY_OBJECT,
  killmails: EMPTY_OBJECT,
  lpWallets: Object.freeze({
    _meta: {
      generatedAt: null,
      lastUpdatedAt: null,
    },
    characterWallets: {},
    corporationWallets: {},
  }),
  mail: Object.freeze({
    _meta: {
      nextMessageID: 1,
      nextMailingListID: FIRST_MAILING_LIST_ID,
    },
    messages: {},
    mailboxes: {},
    mailingLists: {},
  }),
  marketEscrow: EMPTY_OBJECT,
  marketRuntime: Object.freeze({
    lastProcessedExpiryEventId: "0",
  }),
  miningLedger: EMPTY_OBJECT,
  miningRuntimeState: EMPTY_OBJECT,
  missionRuntimeState: EMPTY_OBJECT,
  moduleGroupingState: EMPTY_OBJECT,
  newEdenStoreRuntime: EMPTY_OBJECT,
  notifications: Object.freeze({
    _meta: {
      nextNotificationID: 1,
    },
    boxes: {},
  }),
  npcCargo: Object.freeze({
    nextCargoID: 980200000000,
    cargo: {},
  }),
  npcControlState: EMPTY_OBJECT,
  npcEntities: Object.freeze({
    nextEntityID: 980000000000,
    entities: {},
  }),
  npcModules: Object.freeze({
    nextModuleID: 980100000000,
    modules: {},
  }),
  npcRuntimeControllers: Object.freeze({
    controllers: {},
  }),
  npcRuntimeState: EMPTY_OBJECT,
  npcWreckItems: Object.freeze({
    nextWreckItemID: 980400000000,
    items: {},
  }),
  npcWrecks: Object.freeze({
    nextWreckID: 980300000000,
    wrecks: {},
  }),
  overviewSharedPresets: EMPTY_OBJECT,
  planetOrbitalState: EMPTY_OBJECT,
  planetRuntimeState: EMPTY_OBJECT,
  probeRuntimeState: EMPTY_OBJECT,
  raffles: EMPTY_OBJECT,
  rafflesRuntime: Object.freeze({
    nextRaffleId: 1,
    nextRunningId: 1,
  }),
  reprocessingFacilityState: EMPTY_OBJECT,
  savedFittings: EMPTY_OBJECT,
  sharedBookmarkFolders: Object.freeze({ _meta: { nextFolderID: 1 } }),
  shipCosmetics: EMPTY_OBJECT,
  shipLogoFittings: EMPTY_OBJECT,
  skillPlans: EMPTY_OBJECT,
  skillQueues: EMPTY_OBJECT,
  skillTradingState: EMPTY_OBJECT,
  skills: EMPTY_OBJECT,
  sovereignty: EMPTY_OBJECT,
  structureAssetSafety: EMPTY_OBJECT,
  structurePaintwork: EMPTY_OBJECT,
  structureProfiles: EMPTY_OBJECT,
  structureTetherRestrictions: EMPTY_OBJECT,
  structures: EMPTY_OBJECT,
  wormholeRuntimeState: EMPTY_OBJECT,
});

function listRuntimeTables() {
  return Object.keys(RUNTIME_TABLE_DEFAULTS).sort();
}

function isRuntimeTable(tableName) {
  return Object.prototype.hasOwnProperty.call(RUNTIME_TABLE_DEFAULTS, tableName);
}

function buildRuntimeTableDefault(tableName) {
  if (!isRuntimeTable(tableName)) {
    return null;
  }
  return cloneValue(RUNTIME_TABLE_DEFAULTS[tableName]);
}

module.exports = {
  RUNTIME_TABLE_DEFAULTS,
  buildRuntimeTableDefault,
  isRuntimeTable,
  listRuntimeTables,
};
