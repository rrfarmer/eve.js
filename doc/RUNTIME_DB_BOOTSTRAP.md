# Runtime Database Bootstrap

EvEJS keeps live server state in `server/src/newDatabase/data`, but the mutable
`data.json` files are intentionally ignored by Git. A new checkout therefore
needs a local baseline before the server starts writing player/runtime state.

## Create Baseline Files

Run:

```powershell
npm run db:bootstrap:apply
```

This creates missing runtime tables such as `marketRuntime`, `characters`,
`items`, `corporations`, mail, calendar, bookmark, NPC runtime, industry state,
and other live tables.

Preview without writing:

```powershell
npm run db:bootstrap:dry-run
```

For a narrowed run:

```powershell
node scripts\DataSync\bootstrap-newdb-runtime-data.js --apply --tables marketRuntime,characters
```

## What It Does Not Create

This bootstrap is only for live/runtime baseline files. It does not generate
SDE-derived static tables such as item types, dogma, map data, certificates, or
stations. For those, run the SDE sync utility:

```powershell
npm run datasync:sde -- --download --apply
```

## Server Fallback

The database layer also creates known runtime tables on first use. That means a
missing `marketRuntime/data.json` no longer causes a table-not-found warning on a
fresh setup. Unknown table names still fail normally so real mistakes remain
visible.
