#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node tools/summarize-capture.mjs <capture.json>");
  process.exit(2);
}

const root = JSON.parse(fs.readFileSync(file, "utf8"));

function maybeDecodeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const compact = value.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0) {
    return Buffer.from(compact, "hex");
  }
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length % 4 === 0) {
    try {
      const buffer = Buffer.from(compact, "base64");
      if (buffer.length > 0) {
        return buffer;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function walk(value, path = "$") {
  if (typeof value === "string") {
    const buffer = maybeDecodeString(value);
    if (buffer && buffer.length >= 16) {
      const digest = crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex")
        .slice(0, 16);
      console.log(`${path}: string-bytes len=${buffer.length} sha256[:8]=${digest}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      walk(entry, `${path}.${key}`);
    }
  }
}

walk(root);
