#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, "server", "src", "newDatabase", "data");
const {
  buildRuntimeTableDefault,
  listRuntimeTables,
} = require(path.join(REPO_ROOT, "server", "src", "newDatabase", "runtimeTableDefaults"));

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    dataDir: process.env.EVEJS_NEWDB_DATA_DIR
      ? path.resolve(process.env.EVEJS_NEWDB_DATA_DIR)
      : DEFAULT_DATA_DIR,
    dryRun: false,
    apply: false,
    force: false,
    tables: null,
    help: false,
  };
  const npmConfigState = applyNpmConfigArgs(options);
  const npmPositionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--data-dir requires a directory");
      }
      options.dataDir = path.resolve(REPO_ROOT, argv[index]);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--force") {
      options.force = true;
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
      npmPositionals.push(arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  applyNpmPositionals(options, npmConfigState, npmPositionals);

  if (!options.apply && !options.dryRun) {
    options.dryRun = true;
  }
  if (options.apply && options.dryRun) {
    throw new Error("Choose either --dry-run or --apply, not both");
  }

  return options;
}

function applyNpmConfigArgs(options) {
  const state = {
    saw: false,
    dataDirNeedsValue: false,
    tablesNeedsValue: false,
  };

  const dataDir = npmConfigValue("data-dir");
  if (dataDir) {
    if (isTruthyConfig(dataDir)) {
      state.dataDirNeedsValue = true;
    } else {
      options.dataDir = path.resolve(REPO_ROOT, dataDir);
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
    ["dry-run", "dryRun"],
    ["apply", "apply"],
    ["force", "force"],
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
  if (state.dataDirNeedsValue) {
    if (!positionals[index]) {
      throw new Error("--data-dir requires a directory");
    }
    options.dataDir = path.resolve(REPO_ROOT, positionals[index]);
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

function parseTableList(values) {
  return values
    .flatMap((value) => String(value).split(/[,\s]+/))
    .map((name) => name.trim())
    .filter(Boolean);
}

function printHelp() {
  process.stdout.write(`EvEJS runtime database bootstrap

Usage:
  node scripts/DataSync/bootstrap-newdb-runtime-data.js --apply
  node scripts/DataSync/bootstrap-newdb-runtime-data.js --dry-run --tables marketRuntime,characters

Options:
  --apply          Create missing runtime table data files.
  --dry-run        Preview changes without writing.
  --force          Rewrite existing runtime table data files.
  --data-dir <dir> Use an alternate newDatabase data directory.
  --tables <list>  Comma- or space-separated runtime table list.
`);
}

function relativeToRepo(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
}

function tableDataPath(dataDir, tableName) {
  return path.join(dataDir, tableName, "data.json");
}

function jsonStringify(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function buildPlan(options) {
  const knownTables = new Set(listRuntimeTables());
  const tableNames = options.tables || listRuntimeTables();
  const unknownTables = tableNames.filter((tableName) => !knownTables.has(tableName));
  if (unknownTables.length > 0) {
    throw new Error(`Unknown runtime table(s): ${unknownTables.join(", ")}`);
  }

  return tableNames.map((tableName) => {
    const filePath = tableDataPath(options.dataDir, tableName);
    const exists = fs.existsSync(filePath);
    return {
      table: tableName,
      path: filePath,
      relativePath: relativeToRepo(filePath),
      exists,
      action: exists && !options.force ? "skip" : exists ? "rewrite" : "create",
      text: jsonStringify(buildRuntimeTableDefault(tableName)),
    };
  });
}

function runBootstrap(options) {
  const plan = buildPlan(options);
  if (options.apply) {
    for (const entry of plan) {
      if (entry.action === "skip") {
        continue;
      }
      fs.mkdirSync(path.dirname(entry.path), { recursive: true });
      fs.writeFileSync(entry.path, entry.text, "utf8");
    }
  }

  return {
    dataDir: options.dataDir,
    mode: options.apply ? "apply" : "dry-run",
    force: options.force,
    tableCount: plan.length,
    createdTables: plan.filter((entry) => entry.action === "create").map((entry) => entry.table),
    rewrittenTables: plan.filter((entry) => entry.action === "rewrite").map((entry) => entry.table),
    skippedTables: plan.filter((entry) => entry.action === "skip").map((entry) => entry.table),
    outputs: plan.map((entry) => ({
      table: entry.table,
      path: entry.relativePath,
      action: entry.action,
      exists: entry.exists,
    })),
  };
}

function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  const summary = runBootstrap(options);
  process.stdout.write(`Runtime DB bootstrap ${summary.mode} (${relativeToRepo(summary.dataDir)})\n`);
  for (const output of summary.outputs) {
    process.stdout.write(`${output.action.padEnd(7)} ${output.path}\n`);
  }
  process.stdout.write(`SUMMARY ${JSON.stringify({
    mode: summary.mode,
    force: summary.force,
    tableCount: summary.tableCount,
    createdTables: summary.createdTables,
    rewrittenTables: summary.rewrittenTables,
    skippedCount: summary.skippedTables.length,
  })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_DATA_DIR,
  buildPlan,
  parseArgs,
  runBootstrap,
};
