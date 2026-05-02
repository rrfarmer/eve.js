# EvEJS Universe Seeder

Designed by John Elysian.

EvEJS Universe Seeder is a guided Windows tool for checking and updating persistent universe site data.

## Quick Start

1. Extract the zip.
2. Double-click `install.bat`.
3. Let the installer find your EvEJS folder, or paste the folder path when asked.
4. Launch the seeder from the desktop shortcut or from:

```text
tools\universe-site-seed\RunUniverseSiteSeeder.bat
```

## What It Does

- Checks whether your universe site data is current.
- Guides you through the next safe action.
- Seeds persistent universe sites only when needed.
- Shows progress clearly while it works.
- Keeps the advanced details and logs available without putting them in your way.

## Requirements

- Windows 10 or Windows 11, 64-bit.
- Node.js LTS.
- An EvEJS checkout with `server\src\newDatabase\data`.

The installer checks these for you. If Node.js is missing, it can install Node.js LTS through `winget`.

## Safety

The first check is read-only. The tool only writes data when you choose `Seed Universe` or `Force Rebuild` inside the app.

Before seeding, close the running EvEJS server so the data files are not in active use.

## Files Installed

The installer copies the seeder to:

```text
tools\universe-site-seed
```

It installs only the files needed to run the tool:

- `universe-site-seed.exe`
- `seed_universe_sites.js`
- `RunUniverseSiteSeeder.bat`
- `data\spec\dungeonSpawnProfiles.json`
- this guide

## For Maintainers

To build a fresh distributable zip, run:

```bat
tools\universe-site-seed\PackageUniverseSiteSeeder.bat
```

The finished package is written to:

```text
tools\universe-site-seed\dist\universe-site-seed.zip
```
