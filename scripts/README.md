# EvEJS Script Guide

This is the simple Windows launcher set for EvEJS. The goal is:

- one config file
- one one-off cert install
- one server launcher
- two client launchers
- one source zip builder

## Files You Actually Use

- `scripts\windows\EvEJSConfig.bat`
- `scripts\windows\InstallCerts.bat`
- `scripts\windows\StartServerOnly.bat`
- `scripts\windows\RunClientProxy.bat`
- `scripts\windows\RunClientProxyAndDebug.bat`
- `scripts\New-SourceZip.ps1`

## First-Time Setup

1. Install Node.js.
2. From the repo root, run:

```powershell
npm ci
npm --prefix server ci
```

3. Edit `scripts\windows\EvEJSConfig.bat`.
4. Set `EVEJS_CLIENT_PATH` to your EVE client copy.
5. Run `scripts\windows\InstallCerts.bat` once.

`InstallCerts.bat` does two things:

- trusts the shared `eve.js` CA in Windows for the current user
- appends that CA to the client `cacert.pem` bundles used by chat and the ship-skin public gateway

If you move the client to a different folder later, update `EVEJS_CLIENT_PATH` and run `InstallCerts.bat` again.

## Daily Use

1. Start the server:

```bat
scripts\windows\StartServerOnly.bat
```

2. Start the client with one of:

```bat
scripts\windows\RunClientProxy.bat
scripts\windows\RunClientProxyAndDebug.bat
```

Use `RunClientProxyAndDebug.bat` if you want the EVE debug console.

## Client Patch Reminder

These scripts handle proxying and certificates. They do not patch the client binaries for you.

Your client copy still needs the normal EvEJS localhost setup:

- `PATCHED_FILES\blue.dll` copied into the client `bin64` folder
- `start.ini` pointing at `127.0.0.1` on port `26000`

If your client copy already works with EvEJS, you do not need to redo that step.

## Sharing The Repo

To build a clean shareable source zip:

```powershell
npm run zip:source
```

That uses `scripts\New-SourceZip.ps1`.
