#!/usr/bin/env node
"use strict";

process.stdout.write(
  "Client-cache DataSync is intentionally separate from the official SDE JSONL sync. " +
    "Use `npm run datasync:sde -- --source tools/DataSync/source_json --dry-run` for SDE data.\n",
);
