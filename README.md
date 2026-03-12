# Welcome to eve.js!

> [!WARNING]
> This repo is still early-stage. The current focus is getting practical client features working, not full retail parity.

## Windows Quick Start

1. Install dependencies once:

```powershell
npm ci
npm --prefix server ci
```

2. Edit `scripts\windows\EvEJSConfig.bat`.
3. Set `EVEJS_CLIENT_PATH` to your EVE client copy.
4. Run `scripts\windows\InstallCerts.bat` once.
5. Start the server with `scripts\windows\StartServerOnly.bat`.
6. Start the client with either:
   - `scripts\windows\RunClientProxy.bat`
   - `scripts\windows\RunClientProxyAndDebug.bat`

The full launcher guide is in [scripts/README.md](scripts/README.md).

## Important Notes

- The cert installer covers both chat TLS and the local public-gateway TLS used by ship skins.
- The launcher scripts do not patch the client binaries for you. Your client still needs the normal EvEJS localhost setup such as the patched `blue.dll` and `start.ini`.
- Chat setup and troubleshooting are documented in [docs/CHAT.md](docs/CHAT.md).

## Data Builders

Reference-data builders now live under `scripts/dev/`.

Useful commands:

```powershell
npm run sync:ship-data
npm run build:ship-cosmetics-data
npm run build:reference-data
```

## Sharing The Repo

Create a clean source zip with:

```powershell
npm run zip:source
```

That uses `scripts\New-SourceZip.ps1` and excludes local scratch data such as `_local`, `client`, `node_modules`, and raw Fuzzwork dumps.
