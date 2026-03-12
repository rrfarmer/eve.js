const path = require("path");

const config = require(path.join(__dirname, "../../config"));

function buildList(items = []) {
  return {
    type: "list",
    items,
  };
}

function buildDict(entries = []) {
  return {
    type: "dict",
    entries,
  };
}

function buildKeyVal(entries = []) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: buildDict(entries),
  };
}

function buildRow(header = [], line = []) {
  return {
    type: "object",
    name: "util.Row",
    args: buildDict([
      ["header", buildList(header)],
      ["line", buildList(line)],
    ]),
  };
}

function buildRowset(header = [], rows = [], name = "util.Rowset") {
  return {
    type: "object",
    name,
    args: buildDict([
      ["header", buildList(header)],
      ["RowClass", { type: "token", value: "util.Row" }],
      ["lines", buildList(rows)],
    ]),
  };
}

function currentFileTime() {
  return BigInt(Date.now()) * 10000n + 116444736000000000n;
}

function normalizeBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }

    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }

    if (value && typeof value === "object" && value.type === "long") {
      return normalizeBigInt(value.value, fallback);
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function buildFiletimeLong(rawValue = null) {
  return {
    type: "long",
    value: normalizeBigInt(rawValue, currentFileTime()),
  };
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (value.type === "wstring" || value.type === "token") {
      return normalizeText(value.value, fallback);
    }

    if (value.type === "int" || value.type === "long") {
      return normalizeText(value.value, fallback);
    }
  }

  return String(value);
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (Buffer.isBuffer(value)) {
    return normalizeNumber(value.toString("utf8"), fallback);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  if (typeof value === "object") {
    if (
      value.type === "int" ||
      value.type === "long" ||
      value.type === "float" ||
      value.type === "double" ||
      value.type === "bool" ||
      value.type === "wstring" ||
      value.type === "token"
    ) {
      return normalizeNumber(value.value, fallback);
    }
  }

  return fallback;
}

function extractList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    value.type === "list" &&
    Array.isArray(value.items)
  ) {
    return value.items;
  }

  return [];
}

function extractDictEntries(value) {
  if (
    value &&
    typeof value === "object" &&
    value.type === "dict" &&
    Array.isArray(value.entries)
  ) {
    return value.entries;
  }

  return [];
}

function resolveBoundNodeId() {
  return config.proxyNodeId;
}

function buildBoundObjectResponse(service, args, session, kwargs) {
  const nestedCall = args && args.length > 1 ? args[1] : null;
  const boundId = config.getNextBoundId();
  const objectId = [`N=${config.proxyNodeId}:${boundId}`, currentFileTime()];

  if (session) {
    if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
      session._boundObjectIDs = {};
    }
    if (service && service.name) {
      session._boundObjectIDs[service.name] = objectId[0];
    }
    session.lastBoundObjectID = objectId[0];
  }

  let callResult = null;
  if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
    const methodName = normalizeText(nestedCall[0], "");
    const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
    const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

    callResult = service.callMethod(
      methodName,
      Array.isArray(callArgs) ? callArgs : [callArgs],
      session,
      callKwargs,
    );
  }

  return [
    {
      type: "substruct",
      value: {
        type: "substream",
        value: objectId,
      },
    },
    callResult != null ? callResult : null,
  ];
}

module.exports = {
  buildList,
  buildDict,
  buildKeyVal,
  buildRow,
  buildRowset,
  currentFileTime,
  normalizeBigInt,
  buildFiletimeLong,
  normalizeText,
  normalizeNumber,
  extractList,
  extractDictEntries,
  resolveBoundNodeId,
  buildBoundObjectResponse,
};
