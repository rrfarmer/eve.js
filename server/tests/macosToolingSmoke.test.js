const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-macos-tooling-"));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
  });

  if (options.expectStatus === undefined) {
    assert.equal(
      result.status,
      0,
      `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } else {
    assert.equal(result.status, options.expectStatus);
  }

  return result;
}

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

function writeExecutable(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

function createFakeStagedRuntime(t) {
  const root = makeTempDir(t);
  const stagedRoot = path.join(root, "staged");
  const appBundle = path.join(stagedRoot, "SharedCache", "tq", "EVE.app");
  const buildDir = path.join(appBundle, "Contents", "Resources", "build");
  const bin64Dir = path.join(buildDir, "bin64");
  const wrapperPath = path.join(appBundle, "Contents", "MacOS", "EVE");
  const exefilePath = path.join(bin64Dir, "exefile");
  const sessionFile = path.join(root, "launcher-session.args");

  writeExecutable(wrapperPath);
  writeExecutable(exefilePath);
  fs.writeFileSync(path.join(bin64Dir, "cacert.pem"), "stock client CA bundle\n");
  fs.writeFileSync(path.join(buildDir, "start.ini"), "[main]\ncryptoPack = CarbonIO\n");
  fs.mkdirSync(path.join(stagedRoot, "SharedCache", "ResFiles"), { recursive: true });
  fs.writeFileSync(
    path.join(stagedRoot, ".evejs-stage-metadata.json"),
    JSON.stringify(
      {
        stageVersion: 2,
        sourceRoot: path.join(root, "source"),
        build: "test-build",
        sourceBlueSOSha256: "",
        stagedBlueSOSha256: "",
        patchState: "unpatched",
        signed: false,
        signTime: null,
        signMode: "",
        signIdentity: null,
        exefileEntitlementsMode: "",
        bootCommonOverlay: true,
        bootCryptoPack: "Placebo",
        appBundleSignatureMode: "outer-removed",
        resfilesMode: "copy",
        entrypoint: "exefile",
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    sessionFile,
    [
      "/ssoToken=secret-sso-token",
      "/refreshToken=secret-refresh-token",
      "/LauncherData=secret-launcher-data",
      "/deviceID=secret-device-id",
      "/machineHash=secret-machine-hash",
      "/journeyID=secret-journey-id",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );

  return { root, stagedRoot, sessionFile };
}

function isolatedMacEnv(root, overrides = {}) {
  return {
    HOME: root,
    EVEJS_MAC_LOCAL_CONFIG_PATH: path.join(root, "no-local-config.sh"),
    ...overrides,
  };
}

test("macOS shell tooling passes bash syntax checks", (t) => {
  if (!commandAvailable("bash", ["--version"])) {
    t.skip("bash is not available");
    return;
  }

  const scripts = [
    "Play.sh",
    "QuickstartServer.sh",
    ...fs
      .readdirSync(path.join(repoRoot, "tools", "macos"))
      .filter((name) => name.endsWith(".sh"))
      .map((name) => path.join("tools", "macos", name)),
    ...fs
      .readdirSync(path.join(repoRoot, "tools", "macos", "scripts"))
      .filter((name) => name.endsWith(".sh") && !name.endsWith(".local.sh"))
      .map((name) => path.join("tools", "macos", "scripts", name)),
  ].sort();

  assert.ok(scripts.length > 5, "expected macOS scripts to be discovered");
  for (const script of scripts) {
    run("bash", ["-n", script]);
  }
});

test("macOS doctor check mode reports remediation and quiet mode suppresses output", (t) => {
  const root = makeTempDir(t);
  const env = isolatedMacEnv(root, {
    EVEJS_MAC_RETAIL_ROOT: path.join(root, "missing-retail"),
    EVEJS_MAC_SOURCE_ROOT: path.join(root, "missing-source"),
    EVEJS_MAC_STAGED_BASE: path.join(root, "missing-staged-base"),
    EVEJS_MAC_STAGED_ROOT: path.join(root, "missing-staged-base", "current"),
    EVEJS_MAC_SESSION_FILE: path.join(root, "missing-session.args"),
    EVEJS_GATEWAY_CERT_DIR: path.join(root, "missing-gateway-cert"),
    EVEJS_GATEWAY_CERT_PATH: path.join(root, "missing-gateway-cert", "gateway-dev-cert.pem"),
    EVEJS_GATEWAY_KEY_PATH: path.join(root, "missing-gateway-cert", "gateway-dev-key.pem"),
  });

  const check = spawnSync("bash", ["tools/macos/doctor.sh", "--check"], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.notEqual(check.status, 0);
  assert.match(check.stdout, /FAIL\s+Retail EVE root/);
  assert.match(check.stdout, /fix: .*StartClientSetup\.sh/);

  const quiet = spawnSync("bash", ["tools/macos/doctor.sh", "--quiet"], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.notEqual(quiet.status, 0);
  assert.equal(quiet.stdout, "");
  assert.equal(quiet.stderr, "");
});

test("gateway certificate builder emits public-gateway DNS SANs and loopback IP SAN", (t) => {
  if (!commandAvailable("openssl", ["version"])) {
    t.skip("openssl is not available");
    return;
  }

  const root = makeTempDir(t);
  const outCert = path.join(root, "gateway-dev-cert.pem");
  const outKey = path.join(root, "gateway-dev-key.pem");

  run("bash", [
    "tools/macos/build-gateway-cert.sh",
    "--ca-cert",
    "server/certs/xmpp-ca-cert.pem",
    "--ca-key",
    "server/certs/xmpp-ca-key.pem",
    "--out-cert",
    outCert,
    "--out-key",
    outKey,
  ]);

  assert.ok(fs.existsSync(outCert));
  assert.ok(fs.existsSync(outKey));

  const cert = run("openssl", [
    "x509",
    "-in",
    outCert,
    "-noout",
    "-subject",
    "-ext",
    "subjectAltName",
  ]).stdout;

  assert.match(cert, /CN\s*=\s*live-public-gateway\.evetech\.net|CN=live-public-gateway\.evetech\.net/);
  assert.match(cert, /DNS:dev-public-gateway\.evetech\.net/);
  assert.match(cert, /DNS:live-public-gateway\.evetech\.net/);
  assert.match(cert, /DNS:public-gateway\.evetech\.net/);
  assert.match(cert, /DNS:localhost/);
  assert.match(cert, /IP Address:127\.0\.0\.1|IP:127\.0\.0\.1/);
});

test("Play.sh captured-session dry run redacts private launcher args", (t) => {
  if (!commandAvailable("python3", ["--version"])) {
    t.skip("python3 is not available");
    return;
  }

  const { root, stagedRoot, sessionFile } = createFakeStagedRuntime(t);
  const result = run("bash", ["Play.sh", "--use-captured-session", "--skip-blue-so-inspect", "--dry-run"], {
    env: isolatedMacEnv(root, {
      EVEJS_MAC_STAGED_ROOT: stagedRoot,
      EVEJS_MAC_SESSION_FILE: sessionFile,
      EVEJS_PROXY_URL: "http://127.0.0.1:26002",
      EVEJS_SERVER_HOST: "127.0.0.1",
    }),
  });

  assert.match(result.stdout, /Dry run only\. Final launch command:/);
  assert.match(result.stdout, /\/ssoToken=/);
  assert.match(result.stdout, /\/refreshToken=/);
  assert.match(result.stdout, /\/LauncherData=/);
  assert.match(result.stdout, /\/deviceID=/);
  assert.match(result.stdout, /\/machineHash=/);
  assert.match(result.stdout, /\/journeyID=/);

  for (const secret of [
    "secret-sso-token",
    "secret-refresh-token",
    "secret-launcher-data",
    "secret-device-id",
    "secret-machine-hash",
    "secret-journey-id",
  ]) {
    assert.doesNotMatch(result.stdout, new RegExp(secret));
  }
});
