# macOS Workflow

This is the supported native macOS workflow for eve.js.

Use this guide when you want to clone the repo, prepare an isolated local EVE
client, start the local server, and launch the staged Mac client without
committing private runtime files.

## Requirements

- macOS with the official EVE Online launcher installed
- Node.js and npm
- Python 3
- Apple command line tools (`ditto`, `xattr`, `codesign`, `security`)
- OpenSSL
- Rust only if you want the optional standalone market daemon

The setup scripts keep the retail EVE install untouched. They create a local
source copy and a disposable staged runtime under:

```text
~/Library/Application Support/eve.js/macos/
```

## First-Time Setup

Install JavaScript dependencies from the repo root:

```bash
npm ci
npm --prefix server ci
```

Prepare the local Mac client:

```bash
bash tools/macos/StartClientSetup.sh
```

The setup helper:

- finds or validates the retail EVE root
- refreshes the isolated source copy
- builds the staged runtime
- installs the eve.js local CA into the login keychain
- writes ignored local config for `Play.sh`
- validates the staged runtime before it exits

If your EVE install is not in the default location, pass either the EVE root or
the `SharedCache` directory:

```bash
bash tools/macos/StartClientSetup.sh --retail-root "/path/to/EVE Online"
```

If you want to skip keychain trust during setup:

```bash
bash tools/macos/StartClientSetup.sh --skip-install-ca
bash tools/macos/install-local-ca.sh
```

After setup, check the machine state:

```bash
bash tools/macos/doctor.sh --check
```

Port warnings are okay when an eve.js server is already running. Required
failures include a fix command.

## Launcher Session Capture

The stock Mac client needs launcher-provided session args. Capture them from a
retail launcher-started EVE process:

```bash
bash tools/macos/capture-launcher-session.sh --open-launcher
```

When the launcher opens, sign in and click Play. The helper saves private
session args to:

```text
~/Library/Application Support/eve.js/macos/launcher-session.args
```

That file contains private session material. Do not copy it into commits,
issues, docs, chat, or logs. The file is written with mode `600`.

You can also chain capture into setup:

```bash
bash tools/macos/StartClientSetup.sh --capture-session --open-launcher
```

If the session expires or login fails, capture again.

## Daily Start

Start the server:

```bash
bash QuickstartServer.sh
```

On macOS, `QuickstartServer.sh` defaults to the stock-client staged-runtime
path. It prints a runtime summary with:

- handshake mode
- local gateway/proxy mode
- gateway TLS certificate path
- CDN allow-list
- market daemon state
- expected nonfatal proxy or market noise

Launch the staged client:

```bash
bash Play.sh --use-captured-session
```

For a launch dry run that prints sanitized args without starting the client:

```bash
bash Play.sh --use-captured-session --dry-run
```

Stop the server with `Ctrl+C`.

## Optional Market

The standalone market daemon is optional. You can log in without it, but market
UI and market routes may be limited.

For a small local market seed:

```bash
bash QuickstartServer.sh --market-smoke
```

For a larger Jita + New Caldari seed:

```bash
bash QuickstartServer.sh --market-jita
```

If another market daemon is already reachable on `127.0.0.1:40111`,
`QuickstartServer.sh` reports that instead of starting a new one.

## Refresh After EVE Updates

When the retail launcher updates EVE, refresh the local source copy and staged
runtime:

```bash
bash tools/macos/StartClientSetup.sh
```

The staged runtime is build-specific:

```text
~/Library/Application Support/eve.js/macos/staged-client/<build>/
~/Library/Application Support/eve.js/macos/staged-client/current
```

Re-running setup is safe. It keeps the retail install untouched and writes only
ignored local runtime state.

## Troubleshooting

Run the doctor first:

```bash
bash tools/macos/doctor.sh --check
```

Common fixes:

| Symptom | Fix |
| --- | --- |
| Missing staged runtime | `bash tools/macos/StartClientSetup.sh` |
| Local CA not trusted | `bash tools/macos/install-local-ca.sh` |
| Missing or expired launcher session | `bash tools/macos/capture-launcher-session.sh --open-launcher` |
| Port already in use | stop the other eve.js server, or override the related `EVEJS_*` port env var |
| Gateway cert SAN failure | delete `server/var/certs/gateway/` and run `bash QuickstartServer.sh` |
| Market daemon unavailable | start with `--market-smoke` or `--market-jita`, or ignore it if you do not need market |

Proxy logs that say `EXPECTED-BLOCKED` are normally policy blocks for telemetry
or unhandled off-box hosts. They are not launch blockers unless the client is
waiting on that exact endpoint.

## Local Files To Keep Out Of Git

Do not commit or paste:

- `~/Library/Application Support/eve.js/macos/launcher-session.args`
- `~/Library/Application Support/eve.js/macos/source-client/`
- `~/Library/Application Support/eve.js/macos/staged-client/`
- `~/Library/Application Support/eve.js/macos/client-ca-bundle.pem`
- `~/Library/Application Support/eve.js/macos/client-stdout.log`
- `~/Library/Application Support/eve.js/macos/client-stderr.log`
- `tools/macos/scripts/EvEJSConfig.local.sh`
- `server/var/certs/gateway/`
- `server/handshake-captures/`
- `server/fixtures/mac-auth/*.json`

The normal setup and launch path should leave `git status` clean except for
intentional source edits.

## Known Limitations

- The supported path is the staged native Mac client with a generated
  `common.ini` `Placebo` boot overlay and the outer `EVE.app` bundle seal
  removed. It is not an on-disk `blue.so` patch.
- The stock Mac `CryptoAPI` path is research-only for this repo. The supported
  login path uses the staged `Placebo` overlay.
- The local public-gateway bridge handles the endpoint families implemented in
  this repo. Missing gateway families should fail visibly instead of being
  confused with setup failure.
- Market is optional unless you are testing market features.
- `--patched-client`, `--runtime-patch-blue-so`, and the Mach-O patch helpers
  are research paths. Do not use them for normal macOS setup.
