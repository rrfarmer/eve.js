# Data Repo Cleanup Plan

This is the working plan for separating source-controlled project data from live
server state.

## Current Problem

`server/src/newDatabase/data` currently mixes several different data classes:

- generated static authority, such as SDE-derived item, map, station, dogma, and
  certificate tables
- authored static authority, such as NPC profiles, spawn rules, mission data,
  store catalog inputs, and other hand-maintained project data
- baseline/new-server state, such as empty or starter table contents
- live mutable server state, such as characters, items, mail, jobs, runtime
  systems, corporation runtime data, and database backups

Keeping all of those in one tracked folder makes normal server/test runs dirty
the repository quickly.

## First Cleanup Pass

This pass does two things:

1. Ignore local mutable `data.json` files for clearly live/runtime tables.
2. Untrack already-committed live/runtime `data.json`, `data.json.bak`, and
   `data.json.tmp-*` files without deleting the local working copies.

This pass intentionally keeps static authority and generator-owned data
trackable until we have a bootstrap/data-pack workflow.

## Still Trackable For Now

Examples:

- SDE/generated static authority tables: `itemTypes`, `typeDogma`,
  `solarSystems`, `stations`, `certificates`, `mapNames`
- authored authority tables: `npcProfiles`, `npcSpawnGroups`,
  `npcStartupRules`, `missionAuthority`, `dungeonAuthority`
- table helper files such as `index.js`

## Future Work

1. Add a table manifest that classifies each table as runtime, generated static,
   authored static, or baseline seed.
2. Add a bootstrap command for new-server setup.
3. Move default live database state to a local ignored folder such as
   `server/var/newDatabase/data`.
4. Update tests so they always use a temporary `EVEJS_NEWDB_DATA_DIR` under
   `target/`.
5. Add a doctor command that reports missing tables, malformed JSON, stale
   generated data, tracked runtime files, and leftover backup/temp files.
6. Decide whether generated static authority should be committed, regenerated on
   setup, or distributed as a versioned data pack.

## New Server Direction

The long-term goal is:

- source control stores code, docs, generators, templates, and authored specs
- generated/static data is reproducible from tools or a known data pack
- live runtime/player state is local and ignored
- new server setup is explicit, repeatable, and does not depend on committing
  mutable JSON files
