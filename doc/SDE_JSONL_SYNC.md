# EVE SDE JSONL Sync Utility

This guide explains the project-only utility that refreshes EvEJS static data from
the official EVE Online JSONL Static Data Export.

The utility is not part of normal server runtime. It is a maintainer tool that
reads SDE JSONL source files, generates project JSON tables, and writes those
tables only when explicitly run with `--apply`.

This utility does not create live/runtime database baselines. For those, run:

```powershell
npm run db:bootstrap:apply
```

## Location

```text
scripts\DataSync\sync-jsonl-local-static-data.js
```

NPM entrypoint:

```powershell
npm run datasync:sde -- --source tools/DataSync/source_json --dry-run
```

Direct Node entrypoint:

```powershell
node scripts\DataSync\sync-jsonl-local-static-data.js --source tools\DataSync\source_json --dry-run
```

## Source Data

The default local source folder is:

```text
tools\DataSync\source_json
```

That folder should contain the extracted official JSONL SDE, including:

```text
_sde.jsonl
types.jsonl
groups.jsonl
categories.jsonl
```

The tool can also download the latest official JSONL SDE from:

```text
https://developers.eveonline.com/static-data/tranquility/latest.jsonl
https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip
```

## Important Safety Rules

`--dry-run` does not write generated project data under:

```text
server\src\newDatabase\data
```

`--apply` writes generated project data under:

```text
server\src\newDatabase\data\<tableName>\data.json
```

`--download` updates the source folder:

```text
tools\DataSync\source_json
```

This means `--download --dry-run` still replaces the local SDE source folder
after the downloaded SDE validates. The `--dry-run` part only prevents writes to
`server\src\newDatabase\data`.

The utility is intended to update generated static data only. It should not be
used to overwrite player/runtime state tables such as characters, items, mail,
jobs, runtime state, custom corporations, alliances, backups, or similar live
game state.

## Common Commands

Syntax check:

```powershell
node --check scripts\DataSync\sync-jsonl-local-static-data.js
```

Run focused utility tests:

```powershell
node --test server\tests\dataSyncSdeUtility.test.js
```

Preview a narrow local rebuild:

```powershell
node scripts\DataSync\sync-jsonl-local-static-data.js --source tools\DataSync\source_json --dry-run --tables certificates,mapNames
```

Apply only the runtime authority tables that replaced old raw-SDE runtime reads:

```powershell
node scripts\DataSync\sync-jsonl-local-static-data.js --source tools\DataSync\source_json --apply --tables certificates,mapNames,npcCorporationAuthority,npcCharacterAuthority
```

Preview the full supported rebuild from a local SDE folder:

```powershell
node scripts\DataSync\sync-jsonl-local-static-data.js --source tools\DataSync\source_json --dry-run
```

Download the latest official SDE, then preview one generated table:

```powershell
node scripts\DataSync\sync-jsonl-local-static-data.js --download --dry-run --tables certificates
```

Download the latest official SDE and apply all supported generated tables:

```powershell
node scripts\DataSync\sync-jsonl-local-static-data.js --download --apply
```

Use the last command carefully. It rewrites every supported generated SDE table.

## Options

`--source <dir>`

Use an already-extracted JSONL SDE folder.

`--download`

Download and validate the latest official JSONL SDE, then replace
`tools\DataSync\source_json`.

`--dry-run`

Generate output in memory and report whether each project table would be
`same` or `changed`. Does not write generated project data.

`--apply`

Write generated project data to `server\src\newDatabase\data`.

`--tables <list>`

Limit the run to specific table names. The list may be comma-separated or
space-separated.

Without `--tables`, the utility uses the full supported table list.

## Generated Tables

The default full rebuild supports these table names:

```text
itemTypes
shipTypes
skillTypes
typeDogma
shipDogmaAttributes
dbuffCollections
solarSystems
celestials
asteroidBelts
stargates
stations
stationTypes
stargateTypes
movementAttributes
characterCreationRaces
characterCreationBloodlines
factions
industryBlueprints
industryFacilities
itemIcons
shipCosmeticsCatalog
sovereigntyStatic
reprocessingStatic
certificates
mapNames
npcCorporationAuthority
npcCharacterAuthority
```

Each table writes to:

```text
server\src\newDatabase\data\<tableName>\data.json
```

## Runtime Authority Tables

These generated tables exist because some runtime code previously read old raw
SDE JSONL folders directly:

```text
certificates
mapNames
npcCorporationAuthority
npcCharacterAuthority
```

The runtime now reads those generated project JSON files instead of paths like:

```text
data\eve-online-static-data-*-jsonl
```

NPC corporation bootstrap uses the generated authority tables only for SDE-owned
NPC fields. Custom/player corporations and existing runtime-owned fields should
be preserved.

## Output Summary

Every run prints the SDE build, release date, mode, per-table status, and a JSON
summary. Example:

```text
SDE build 3316380 (2026-04-23T11:33:57Z) dry-run
same    server/src/newDatabase/data/certificates/data.json (523364 bytes)
same    server/src/newDatabase/data/mapNames/data.json (151376 bytes)
SUMMARY {"buildNumber":3316380,"releaseDate":"2026-04-23T11:33:57Z","mode":"dry-run","tableCount":2,"changedTables":[]}
```

`changedTables: []` means the generated output matched the current project files.

## Recommended Test Flow

1. Syntax check the utility.
2. Run `server\tests\dataSyncSdeUtility.test.js`.
3. Run a narrow `--dry-run` for the table set you plan to update.
4. Run the matching narrow `--apply`.
5. Run the relevant runtime tests.

Useful runtime checks:

```powershell
node --test server\tests\dataSyncDashboardCoverage.test.js
node --test server\tests\certificateMasteryParity.test.js server\tests\factionNpcParity.test.js
node --test server\tests\startupSolarSystemLoading.test.js server\tests\configAverageMarketPricesParity.test.js
```

For industry/reprocessing data changes, also run:

```powershell
node --test server\tests\industryManufacturingParity.test.js server\tests\reprocessingParity.test.js
```

## Windows NPM Note

On some Windows/npm combinations, this command can print npm warnings about
unknown config flags:

```powershell
npm run datasync:sde -- --source tools/DataSync/source_json --dry-run --tables certificates,mapNames
```

The utility has fallback argument handling for that behavior. The warnings are
from npm, not from the sync utility.
