const config = require("../../config")
const {
  spawnShipInHangarForSession,
  getActiveShipRecord,
  applyCharacterToSession,
} = require("../character/characterState");
const sessionRegistry = require("./sessionRegistry");
const {
  getAllItems,
  getCharacterHangarShipItems,
} = require("../inventory/itemStore");
const {
  getCharacterWallet,
  setCharacterBalance,
  adjustCharacterBalance,
  emitPlexBalanceChangeToSession,
  setCharacterPlexBalance,
  adjustCharacterPlexBalance,
} = require("../account/walletState");
const { resolveShipByName } = require("./shipTypeRegistry");
const { resolveSolarSystemByName } = require("./solarSystemRegistry");
const {
  createCustomAllianceForCorporation,
  createCustomCorporation,
  joinCorporationToAllianceByName,
  getCorporationRecord,
} = require("../corporation/corporationState");
const {
  jumpSessionToSolarSystem,
  jumpSessionToStation,
} = require("../../space/transitions");
const worldData = require("../../space/worldData");
const spaceRuntime = require("../../space/runtime");
const {
  buildEffectListText,
  playPlayableEffect,
  stopAllPlayableEffects,
} = require("./specialFxRegistry");

const DEFAULT_MOTD_MESSAGE = [
  "Welcome to EvEJS.",
  "This emulator build is still work in progress.",
  "Local chat and slash commands are enabled.",
  "Use /help to see the current command list.",
].join(" ");
const AVAILABLE_SLASH_COMMANDS = [
  "addisk",
  "announce",
  "addplex",
  "corpcreate",
  "commandlist",
  "commands",
  "giveme",
  "hangar",
  "help",
  "item",
  "dock",
  "effect",
  "fit",
  "load",
  "motd",
  "reload",
  "joinalliance",
  "loadsys",
  "solar",
  "session",
  "setalliance",
  "setplex",
  "setisk",
  "ship",
  "tr",
  "typeinfo",
  "wallet",
  "where",
  "who",
];
const COMMANDS_HELP_TEXT = [
  "Commands:",
  "/help",
  "/motd",
  "/dock",
  "/reload",
  "/effect <name>",
  "/where",
  "/who",
  "/wallet",
  "/corpcreate <corporation name>",
  "/setalliance <alliance name>",
  "/joinalliance <alliance name>",
  "/loadsys",
  "/solar <system name>",
  "/addisk <amount>",
  "/addplex <amount>",
  "/setisk <amount>",
  "/setplex <amount>",
  "/ship <ship name>",
  "/giveme <ship name>",
  "/load <character|me> <typeID> [quantity]",
  "/load <ship name|typeID|DNA|EFT>",
  "/fit <character|me> <typeID> [quantity]",
  "/fit <ship name|typeID|DNA|EFT>",
  "/hangar",
  "/item <itemID>",
  "/typeinfo <ship name>",
  "/session",
  "/tr <character|me> <locationID>",
  "/announce <message>",
].join(" ");

function normalizeCommandName(value) {
  return String(value || "").trim().toLowerCase();
}

function getTeleportSession() {
  return require("../../space/transitions").teleportSession;
}

function formatDistanceMeters(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0 m";
  }
  if (numeric >= 1000) {
    return `${(numeric / 1000).toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} km`;
  }
  return `${Math.round(numeric).toLocaleString("en-US")} m`;
}

function formatIsk(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ISK`;
}

function formatPlex(value) {
  return `${Math.max(0, Math.trunc(Number(value || 0))).toLocaleString("en-US")} PLEX`;
}

function formatSignedPlex(value) {
  const numeric = Math.trunc(Number(value || 0));
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toLocaleString("en-US")} PLEX`;
}

function parseAmount(value) {
  const text = String(value || "")
    .trim()
    .replace(/,/g, "")
    .replace(/_/g, "");
  if (!text) {
    return null;
  }

  const match = /^(-?\d+(?:\.\d+)?)([kmbt])?$/i.exec(text);
  if (!match) {
    return null;
  }

  const baseValue = Number(match[1]);
  if (!Number.isFinite(baseValue)) {
    return null;
  }

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    t: 1_000_000_000_000,
  };
  const suffix = String(match[2] || "").toLowerCase();
  return baseValue * (multiplier[suffix] || 1);
}

function formatSuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    return "";
  }

  return ` Suggestions: ${suggestions.join(", ")}`;
}

function emitChatFeedback(chatHub, session, options, message) {
  if (!message) {
    return;
  }

  if (
    chatHub &&
    session &&
    (!options || options.emitChatFeedback !== false)
  ) {
        const delayMs =
      options && Number.isFinite(Number(options.chatFeedbackDelayMs))
        ? Math.max(0, Number(options.chatFeedbackDelayMs))
        : config.COMMAND_FEEDBACK_DELAY_MS;

    setTimeout(() => {
      if (!session.socket || session.socket.destroyed) {
        return;
      }

      chatHub.sendSystemMessage(session, message);
    }, delayMs);
    chatHub.sendSystemMessage(session, message);
  }
}

function handledResult(chatHub, session, options, message) {
  emitChatFeedback(chatHub, session, options, message);
  return {
    handled: true,
    message,
  };
}

function flushPendingLocalChannelSync(chatHub, session) {
  if (
    !chatHub ||
    !session ||
    typeof chatHub.moveLocalSession !== "function"
  ) {
    return;
  }

  const pending = session._pendingLocalChannelSync || null;
  if (!pending) {
    return;
  }

  session._pendingLocalChannelSync = null;
  chatHub.moveLocalSession(session, pending.previousChannelID);
}

function normalizePositiveInteger(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function refreshAffiliationSessions(characterIDs) {
  const targetCharacterIDs = new Set(
    (Array.isArray(characterIDs) ? characterIDs : [])
      .map((characterID) => normalizePositiveInteger(characterID))
      .filter(Boolean),
  );

  if (targetCharacterIDs.size === 0) {
    return;
  }

  for (const targetSession of sessionRegistry.getSessions()) {
    const characterID = normalizePositiveInteger(
      targetSession && (targetSession.characterID || targetSession.charid),
    );
    if (!characterID || !targetCharacterIDs.has(characterID)) {
      continue;
    }

    applyCharacterToSession(targetSession, characterID, {
      selectionEvent: false,
      emitNotifications: true,
      logSelection: false,
    });
  }
}

function reconcileSolarTargetSessionIdentity(session, solarSystem) {
  if (
    !session ||
    !solarSystem ||
    typeof session.sendSessionChange !== "function"
  ) {
    return false;
  }

  const targetSolarSystemID =
    normalizePositiveInteger(solarSystem.solarSystemID) || null;
  const targetConstellationID =
    normalizePositiveInteger(solarSystem.constellationID) || null;
  const targetRegionID =
    normalizePositiveInteger(solarSystem.regionID) || null;

  if (!targetSolarSystemID) {
    return false;
  }

  const sessionChanges = {};
  const applyChange = (key, nextValue, aliases) => {
    const previousValue = normalizePositiveInteger(
      aliases.map((alias) => session[alias]).find((value) => value !== undefined),
    );
    const normalizedNextValue = normalizePositiveInteger(nextValue);
    if (previousValue === normalizedNextValue) {
      return;
    }

    for (const alias of aliases) {
      session[alias] = normalizedNextValue;
    }
    sessionChanges[key] = [previousValue, normalizedNextValue];
  };

  applyChange("solarsystemid2", targetSolarSystemID, ["solarsystemid2"]);
  applyChange("solarsystemid", targetSolarSystemID, ["solarsystemid"]);
  applyChange("locationid", targetSolarSystemID, ["locationid"]);

  if (targetConstellationID) {
    applyChange("constellationid", targetConstellationID, [
      "constellationid",
      "constellationID",
    ]);
  }

  if (targetRegionID) {
    applyChange("regionid", targetRegionID, [
      "regionid",
      "regionID",
    ]);
  }

  if (Object.keys(sessionChanges).length === 0) {
    return false;
  }

  session.sendSessionChange(sessionChanges);
  return true;
}

function getWalletSummary(session) {
  const wallet = session && session.characterID
    ? getCharacterWallet(session.characterID)
    : null;
  if (!wallet) {
    return null;
  }

  const deltaText =
    wallet.balanceChange === 0
      ? "0.00 ISK"
      : `${wallet.balanceChange > 0 ? "+" : ""}${formatIsk(wallet.balanceChange)}`;

  return `Wallet balance: ${formatIsk(wallet.balance)}. PLEX: ${formatPlex(wallet.plexBalance)}. Last ISK change: ${deltaText}.`;
}

function getLocationSummary(session) {
  if (!session || !session.characterID) {
    return "No character selected.";
  }

  if (session.stationid || session.stationID) {
    return `Docked in station ${session.stationid || session.stationID}, solar system ${session.solarsystemid2 || session.solarsystemid || "unknown"}.`;
  }

  if (session.solarsystemid2 || session.solarsystemid) {
    return `In space in solar system ${session.solarsystemid2 || session.solarsystemid}.`;
  }

  return "Current location is unknown.";
}

function getActiveSolarSystemID(session) {
  return normalizePositiveInteger(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
  );
}

function formatSolarSystemLabel(systemID) {
  const system = worldData.getSolarSystemByID(systemID);
  return system && system.solarSystemName
    ? `${system.solarSystemName}(${systemID})`
    : String(systemID || 0);
}

function formatSolarSystemList(systemIDs) {
  const uniqueIDs = [...new Set((Array.isArray(systemIDs) ? systemIDs : []).filter(Boolean))];
  return uniqueIDs.length > 0
    ? uniqueIDs.map((systemID) => formatSolarSystemLabel(systemID)).join(", ")
    : "none";
}

function getConnectedCharacterSummary() {
  const connected = sessionRegistry
    .getSessions()
    .filter((session) => Number(session.characterID || 0) > 0)
    .map(
      (session) =>
        `${session.characterName || session.userName || "Unknown"}(${session.characterID})`,
    );

  if (connected.length === 0) {
    return "No active characters are connected.";
  }

  return `Connected characters (${connected.length}): ${connected.join(", ")}`;
}

function getSessionSummary(session) {
  if (!session || !session.characterID) {
    return "No active character session.";
  }

  return [
    `char=${session.characterName || "Unknown"}(${session.characterID})`,
    `ship=${session.shipName || "Ship"}(${session.shipID || session.shipid || 0})`,
    `corp=${session.corporationID || 0}`,
    `station=${session.stationid || session.stationID || 0}`,
    `system=${session.solarsystemid2 || session.solarsystemid || 0}`,
    `wallet=${formatIsk(session.balance || 0)}`,
  ].join(" | ");
}

function resolveTeleportTargetSession(invokingSession, targetText) {
  const normalizedTarget = normalizeCommandName(targetText);
  if (!normalizedTarget) {
    return null;
  }

  if (
    normalizedTarget === "me" ||
    normalizedTarget === "self" ||
    normalizedTarget === String(invokingSession && invokingSession.characterID)
  ) {
    return invokingSession;
  }

  const numericTarget = Number(normalizedTarget);
  const activeSessions = sessionRegistry
    .getSessions()
    .filter((candidate) => Number(candidate && candidate.characterID) > 0);

  if (Number.isInteger(numericTarget) && numericTarget > 0) {
    const byId = activeSessions.find(
      (candidate) => Number(candidate.characterID || candidate.charid || 0) === numericTarget,
    );
    if (byId) {
      return byId;
    }
  }

  return (
    activeSessions.find(
      (candidate) =>
        normalizeCommandName(candidate.characterName || candidate.userName) === normalizedTarget,
    ) || null
  );
}

function getHangarSummary(session) {
  if (!session || !session.characterID) {
    return "No active character session.";
  }

  const stationId = session.stationid || session.stationID;
  if (!stationId) {
    return "You must be docked to inspect the station ship hangar.";
  }

  const activeShip = getActiveShipRecord(session.characterID);
  const hangarShips = getCharacterHangarShipItems(session.characterID, stationId);
  const shipSummary = hangarShips
    .map((ship) => `${ship.itemName}(${ship.itemID})`)
    .join(", ");

  return [
    `Active ship: ${activeShip ? `${activeShip.itemName}(${activeShip.itemID})` : "none"}.`,
    `Hangar ships (${hangarShips.length}): ${shipSummary || "none"}.`,
  ].join(" ");
}

function getItemSummary(argumentText) {
  const itemID = Number(argumentText);
  if (!Number.isInteger(itemID) || itemID <= 0) {
    return "Usage: /item <itemID>";
  }

  const item = getAllItems()[String(itemID)];
  if (!item) {
    return `Item not found: ${itemID}.`;
  }

  return [
    `Item ${item.itemID}: ${item.itemName || "Unknown"}`,
    `type=${item.typeID}`,
    `owner=${item.ownerID}`,
    `location=${item.locationID}`,
    `flag=${item.flagID}`,
    `singleton=${item.singleton}`,
    `quantity=${item.quantity}`,
  ].join(" | ");
}

function sendAnnouncement(chatHub, session, message) {
  if (!message) {
    return;
  }

  for (const targetSession of sessionRegistry.getSessions()) {
    if (chatHub) {
      chatHub.sendSystemMessage(targetSession, message);
    }
  }
}

function handleShipSpawn(commandLabel, session, argumentText, chatHub, options) {
  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: /${commandLabel} <ship name>`,
    );
  }

  const shipLookup = resolveShipByName(argumentText);
  if (!shipLookup.success) {
    const message =
      shipLookup.errorMsg === "SHIP_NOT_FOUND"
        ? `Ship not found: ${argumentText}.${formatSuggestions(shipLookup.suggestions)}`
        : `Ship name is ambiguous: ${argumentText}.${formatSuggestions(shipLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const spawnResult = spawnShipInHangarForSession(session, shipLookup.match);
  if (!spawnResult.success) {
    let message = "Ship spawn failed.";
    if (spawnResult.errorMsg === "DOCK_REQUIRED") {
      message = "You must be docked before spawning ships into your hangar.";
    } else if (spawnResult.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before spawning ships.";
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    `${shipLookup.match.name} was added to your ship hangar. /${commandLabel} only spawns the hull for now; board it manually from the hangar.`,
  );
}

function unquoteArgument(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  return text;
}

function parseLegacyLoadRequest(argumentText) {
  const match =
    /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s+(\d+)(?:\s+(\d+))?\s*$/.exec(
      String(argumentText || ""),
    );
  if (!match) {
    return null;
  }

  const targetText = unquoteArgument(match[1] || match[2] || match[3] || "");
  const typeID = Number(match[4]);
  const quantity = match[5] ? Number(match[5]) : 1;
  if (!targetText || !Number.isInteger(typeID) || typeID <= 0) {
    return null;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_QUANTITY",
      targetText,
      typeID,
      quantity,
    };
  }

  return {
    success: true,
    targetText,
    typeID,
    quantity,
  };
}

function grantLegacyTypeToSession(targetSession, typeID, quantity) {
  if (!targetSession || !targetSession.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const shipType = resolveShipByTypeID(typeID);
  if (shipType) {
    const stationId = targetSession.stationid || targetSession.stationID;
    if (!stationId) {
      return {
        success: false,
        errorMsg: "DOCK_REQUIRED_FOR_SHIP",
      };
    }

    const spawnedShips = [];
    for (let index = 0; index < quantity; index += 1) {
      const spawnResult = spawnShipInHangarForSession(targetSession, shipType);
      if (!spawnResult.success) {
        return spawnResult;
      }

      spawnedShips.push(spawnResult.ship);
    }

    return {
      success: true,
      kind: "ship",
      quantity,
      entry: shipType,
      containerLabel: "ship hangar",
      items: spawnedShips,
    };
  }

  const stationId = targetSession.stationid || targetSession.stationID;
  const shipId = targetSession.shipID || targetSession.shipid || 0;
  const moduleType = resolveModuleByTypeID(typeID);
  if (!moduleType) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_TYPE_ID",
    };
  }

  const locationID = stationId || shipId;
  const flagID = stationId ? ITEM_FLAGS.HANGAR : shipId ? ITEM_FLAGS.CARGO_HOLD : 0;
  if (!locationID || !flagID) {
    return {
      success: false,
      errorMsg: "NO_DESTINATION",
    };
  }

  const createResult = createInventoryItemForCharacter(
    targetSession.characterID,
    locationID,
    moduleType,
    {
      flagID,
      quantity,
      stacksize: quantity,
      singleton: 0,
    },
  );
  if (!createResult.success) {
    return createResult;
  }

  syncInventoryItemForSession(
    targetSession,
    createResult.data,
    createResult.previousData || {
      locationID: 0,
      flagID: 0,
      quantity: 0,
      singleton: createResult.data.singleton,
      stacksize: 0,
    },
    {
      emitCfgLocation: true,
    },
  );

  return {
    success: true,
    kind: "item",
    quantity,
    entry: createResult.data,
    requestedTypeID: typeID,
    containerLabel: stationId ? "item hangar" : "cargo hold",
  };
}

function resolveShipSpec(argumentText) {
  const rawText = String(argumentText || "").trim();
  if (!rawText) {
    return {
      success: false,
      errorMsg: "SHIP_NAME_REQUIRED",
      suggestions: [],
    };
  }

  const normalizedText = rawText.replace(/^<url=fitting:/i, "").replace(/>.*$/s, "");
  const dnaMatch = /^(\d+)(?::.*)?$/.exec(normalizedText);
  if (
    dnaMatch &&
    (normalizedText.includes(";") || normalizedText.includes(":"))
  ) {
    const byType = resolveShipByTypeID(Number(dnaMatch[1]));
    if (!byType) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
        suggestions: [],
      };
    }

    return {
      success: true,
      match: byType,
      source: "DNA",
      fittingPayloadIncluded: normalizedText.includes(";"),
    };
  }

  const eftMatch = /^\[([^,\]]+)\s*,/m.exec(rawText);
  if (eftMatch) {
    const lookup = resolveShipByName(eftMatch[1]);
    if (lookup.success) {
      return {
        ...lookup,
        source: "EFT",
        fittingPayloadIncluded: true,
      };
    }

    return lookup;
  }

  const numericTypeID = Number(rawText);
  if (Number.isInteger(numericTypeID) && numericTypeID > 0) {
    const byType = resolveShipByTypeID(numericTypeID);
    if (byType) {
      return {
        success: true,
        match: byType,
        source: "typeID",
        fittingPayloadIncluded: false,
      };
    }
  }

  const lookup = resolveShipByName(rawText);
  if (!lookup.success) {
    return lookup;
  }

  return {
    ...lookup,
    source: "name",
    fittingPayloadIncluded: false,
  };
}

function loadShipForSession(session, shipSpec) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const stationId = session.stationid || session.stationID;
  if (!stationId) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (activeShip && Number(activeShip.typeID || 0) === Number(shipSpec.typeID || 0)) {
    return {
      success: true,
      alreadyActive: true,
      created: false,
      ship: activeShip,
    };
  }

  const hangarShips = getCharacterHangarShipItems(session.characterID, stationId);
  const existingShip =
    hangarShips.find(
      (ship) => Number(ship.typeID || 0) === Number(shipSpec.typeID || 0),
    ) || null;
  let targetShip = existingShip;
  let created = false;

  if (!targetShip) {
    const spawnResult = spawnShipInHangarForSession(session, shipSpec);
    if (!spawnResult.success) {
      return spawnResult;
    }

    targetShip = spawnResult.ship;
    created = Boolean(spawnResult.created);
  }

  const activationResult = activateShipForSession(session, targetShip.itemID, {
    emitNotifications: true,
    logSelection: true,
  });
  if (!activationResult.success) {
    return activationResult;
  }

  return {
    success: true,
    alreadyActive: false,
    created,
    ship: activationResult.activeShip || targetShip,
  };
}

function handleLoadLikeCommand(commandLabel, session, argumentText, chatHub, options) {
  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: /${commandLabel} <character|me> <typeID> [quantity] | <ship name|typeID|DNA|EFT>`,
    );
  }

  const legacyLoadRequest = parseLegacyLoadRequest(argumentText);
  if (legacyLoadRequest) {
    if (!legacyLoadRequest.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `Usage: /${commandLabel} <character|me> <typeID> [quantity]`,
      );
    }

    const targetSession = resolveTeleportTargetSession(
      session,
      legacyLoadRequest.targetText,
    );
    if (!targetSession) {
      return handledResult(
        chatHub,
        session,
        options,
        `Character not found: ${legacyLoadRequest.targetText}.`,
      );
    }

    const grantResult = grantLegacyTypeToSession(
      targetSession,
      legacyLoadRequest.typeID,
      legacyLoadRequest.quantity,
    );
    if (!grantResult.success) {
      let message = `${commandLabel} failed.`;
      if (grantResult.errorMsg === "DOCK_REQUIRED") {
        message = "You must be docked before spawning ships into the hangar.";
      } else if (grantResult.errorMsg === "DOCK_REQUIRED_FOR_SHIP") {
        message = "You must be docked before loading ships by typeID.";
      } else if (grantResult.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Select a character first.";
      } else if (grantResult.errorMsg === "NO_DESTINATION") {
        message = "Target character must be docked or have an active ship.";
      } else if (grantResult.errorMsg === "UNSUPPORTED_TYPE_ID") {
        message = `Unsupported typeID: ${legacyLoadRequest.typeID}. Use a valid ship/module typeID.`;
      }
      return handledResult(chatHub, session, options, message);
    }

    const targetName =
      targetSession.characterName || targetSession.userName || legacyLoadRequest.targetText;
    const fitNote =
      commandLabel === "fit"
        ? " Module fitting is not implemented yet, so the item was only added to inventory."
        : "";
    const descriptor =
      grantResult.kind === "ship"
        ? grantResult.entry.name
        : grantResult.entry.itemName || grantResult.entry.name || `typeID ${legacyLoadRequest.typeID}`;
    const quantityText =
      grantResult.quantity > 1 ? ` x${grantResult.quantity}` : "";
    return handledResult(
      chatHub,
      session,
      options,
      `Loaded ${descriptor}${quantityText} for ${targetName} into the ${grantResult.containerLabel}.${fitNote}`.trim(),
    );
  }

  const shipSpec = resolveShipSpec(argumentText);
  if (!shipSpec.success) {
    if (shipSpec.errorMsg === "SHIP_NOT_FOUND") {
      const numericTypeID = Number(argumentText);
      const moduleByTypeID =
        Number.isInteger(numericTypeID) && numericTypeID > 0
          ? resolveModuleByTypeID(numericTypeID)
          : null;
      const moduleLookup =
        moduleByTypeID
          ? {
              success: true,
              match: moduleByTypeID,
              suggestions: [],
            }
          : Number.isInteger(numericTypeID) && numericTypeID > 0
            ? {
                success: false,
                match: null,
                suggestions: [],
                errorMsg: "MODULE_NOT_FOUND",
              }
            : resolveModuleByName(argumentText);

      if (moduleLookup && moduleLookup.success && moduleLookup.match) {
        const grantResult = grantLegacyTypeToSession(
          session,
          moduleLookup.match.typeID,
          1,
        );
        if (!grantResult.success) {
          let message = `${commandLabel} failed.`;
          if (grantResult.errorMsg === "CHARACTER_NOT_SELECTED") {
            message = "Select a character first.";
          } else if (grantResult.errorMsg === "NO_DESTINATION") {
            message = "You must be docked or have an active ship to receive modules.";
          } else if (grantResult.errorMsg === "UNSUPPORTED_TYPE_ID") {
            message = `Unsupported typeID: ${moduleLookup.match.typeID}.`;
          }
          return handledResult(chatHub, session, options, message);
        }

        const fitNote =
          commandLabel === "fit"
            ? " Module fitting is not implemented yet, so the item was only added to inventory."
            : "";
        return handledResult(
          chatHub,
          session,
          options,
          `Loaded ${moduleLookup.match.name} into the ${grantResult.containerLabel}.${fitNote}`.trim(),
        );
      }

      const combinedSuggestions = [
        ...(Array.isArray(shipSpec.suggestions) ? shipSpec.suggestions : []),
        ...(moduleLookup && Array.isArray(moduleLookup.suggestions)
          ? moduleLookup.suggestions
          : []),
      ]
        .filter(Boolean)
        .slice(0, 5);
      const message = Number.isInteger(numericTypeID) && numericTypeID > 0
        ? `Unsupported typeID: ${numericTypeID}. Use a valid ship/module typeID.${formatSuggestions(combinedSuggestions)}`
        : `Ship or module not found: ${argumentText}.${formatSuggestions(combinedSuggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }

    const message =
      shipSpec.errorMsg === "AMBIGUOUS_SHIP_NAME"
        ? `Ship name is ambiguous: ${argumentText}.${formatSuggestions(shipSpec.suggestions)}`.trim()
        : `Usage: /${commandLabel} <character|me> <typeID> [quantity] | <ship name|typeID|DNA|EFT>`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const result = loadShipForSession(session, shipSpec.match);
  if (!result.success) {
    let message = `${commandLabel} failed.`;
    if (result.errorMsg === "DOCK_REQUIRED") {
      message = `You must be docked before using /${commandLabel}.`;
    } else if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character first.";
    }
    return handledResult(chatHub, session, options, message);
  }

  const fitNote =
    commandLabel === "fit" || shipSpec.fittingPayloadIncluded
      ? " Module fitting is not implemented yet, so only the hull was loaded."
      : "";
  const actionText = result.alreadyActive
    ? `${shipSpec.match.name} is already your active ship.`
    : `${shipSpec.match.name} is now active${result.created ? " (new hull spawned)" : ""}.`;
  return handledResult(
    chatHub,
    session,
    options,
    `${actionText} Source=${shipSpec.source}.${fitNote}`.trim(),
  );
}

function getHotReloadSummary() {
  const controller = getHotReloadController();
  if (!controller) {
    return "Hot reload is disabled.";
  }

  const status = controller.getStatus();
  const lastReloadText = status.lastReloadAt
    ? `last=${status.lastReloadAt}`
    : "last=never";
  const restartText = status.restartPending
    ? `restart=pending(${(status.pendingRestartFiles || []).join(", ") || "unknown"})`
    : "restart=clear";
  return [
    `Hot reload: watch=${status.watchEnabled ? "on" : "off"}`,
    `watching=${status.watching ? "yes" : "no"}`,
    `count=${status.reloadCount}`,
    lastReloadText,
    restartText,
  ].join(" | ");
}


function handleSolarTeleport(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /solar.",
    );
  }

  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /solar <system name>",
    );
  }

  const lookup = resolveSolarSystemByName(argumentText);
  if (!lookup.success) {
    const message =
      lookup.errorMsg === "SOLAR_SYSTEM_NOT_FOUND"
        ? `Solar system not found: ${argumentText}.${formatSuggestions(lookup.suggestions)}`
        : `Solar system name is ambiguous: ${argumentText}.${formatSuggestions(lookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const result = jumpSessionToSolarSystem(session, lookup.match.solarSystemID);
  if (!result.success) {
    let message = "Solar-system jump failed.";
    if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship not found for this character.";
    } else if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before using /solar.";
    } else if (result.errorMsg === "SOLAR_SYSTEM_NOT_FOUND") {
      message = `Solar system not found: ${lookup.match.solarSystemName}.`;
    } else if (result.errorMsg === "SOLAR_JUMP_IN_PROGRESS") {
      message = "A solar-system jump is already in progress for this character.";
    }

    return handledResult(chatHub, session, options, message);
  }

  const spawnState = result.data && result.data.spawnState;
  const targetSolarSystem =
    (result.data && result.data.solarSystem) ||
    worldData.getSolarSystemByID(lookup.match.solarSystemID);
  const anchorText = spawnState
    ? ` near ${spawnState.anchorType} ${spawnState.anchorName}`
    : "";

  // The transition path should already send the correct full location identity.
  // Keep a command-side backstop here so /solar does not depend exclusively on
  // later session hydration if region/constellation drift again.
  reconcileSolarTargetSessionIdentity(session, targetSolarSystem);

  // Move Local before emitting feedback so slash responses do not land in the
  // new system while the client is still joined to the previous room.
  flushPendingLocalChannelSync(chatHub, session);

  return handledResult(
    chatHub,
    session,
    options,
    `Teleported to ${lookup.match.solarSystemName} (${lookup.match.solarSystemID})${anchorText}.`,
  );
}

function handleHomeDock(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /dock.",
    );
  }

  const homeStationID = Number(
    session.homeStationID ||
    session.homestationid ||
    session.cloneStationID ||
    session.clonestationid ||
    0,
  ) || 0;

  if (!homeStationID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Home station is not set for this character.",
    );
  }

  if (
    Number(session.stationid || session.stationID || 0) === homeStationID
  ) {
    return handledResult(
      chatHub,
      session,
      options,
      `Already docked at home station ${homeStationID}.`,
    );
  }

  const result = jumpSessionToStation(session, homeStationID);
  if (!result.success) {
    let message = "Dock command failed.";
    if (result.errorMsg === "SHIP_NOT_FOUND") {
      message = "Active ship not found for this character.";
    } else if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before using /dock.";
    } else if (result.errorMsg === "STATION_NOT_FOUND") {
      message = `Home station not found: ${homeStationID}.`;
    } else if (result.errorMsg === "STATION_JUMP_IN_PROGRESS") {
      message = "A dock transition is already in progress for this character.";
    }

    return handledResult(chatHub, session, options, message);
  }

  const station = result.data && result.data.station;
  flushPendingLocalChannelSync(chatHub, session);
  return handledResult(
    chatHub,
    session,
    options,
    `Docked at ${station ? station.stationName : `station ${homeStationID}`}.`,
  );
}

function handleEffectCommand(session, argumentText, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before using /effect.",
    );
  }

  if (!session._space || session.stationid || session.stationID) {
    return handledResult(
      chatHub,
      session,
      options,
      "You must be in space to use /effect.",
    );
  }

  const trimmed = String(argumentText || "").trim();
  if (!trimmed || trimmed === "list" || trimmed === "help" || trimmed === "?") {
    return handledResult(chatHub, session, options, buildEffectListText());
  }

  const parts = trimmed.split(/\s+/);
  const verb = normalizeCommandName(parts[0]);
  const stop = verb === "stop" || verb === "off";
  const effectName = stop ? parts.slice(1).join(" ").trim() : trimmed;
  if (stop && !effectName) {
    const stopResult = stopAllPlayableEffects(session);
    if (!stopResult.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "Effect stop failed.",
      );
    }
    return handledResult(
      chatHub,
      session,
      options,
      "Stopped all known self FX on your ship.",
    );
  }

  if (!effectName) {
    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /effect <name>, /effect stop, or /effect stop <name>",
    );
  }

  const result = playPlayableEffect(session, effectName, { stop });
  if (!result.success) {
    if (result.errorMsg === "EFFECT_NOT_FOUND") {
      return handledResult(
        chatHub,
        session,
        options,
        `Unknown effect: ${effectName}. ${buildEffectListText()}`,
      );
    }
    if (result.errorMsg === "DESTINY_NOT_READY") {
      return handledResult(
        chatHub,
        session,
        options,
        "Space scene is not ready for FX yet. Try again in a moment.",
      );
    }
    if (result.errorMsg === "DEBUG_TEST_TARGET_NO_STATION") {
      return handledResult(
        chatHub,
        session,
        options,
        "That debug/test effect needs a nearby station target, but there is no station entity available in the current scene.",
      );
    }
    if (result.errorMsg === "DEBUG_TEST_TARGET_OUT_OF_RANGE") {
      const maxRangeText = formatDistanceMeters(
        result.data && result.data.maxRangeMeters,
      );
      const nearestDistanceText = formatDistanceMeters(
        result.data && result.data.nearestDistanceMeters,
      );
      const targetName =
        (result.data && result.data.targetName) || "the nearest station";
      return handledResult(
        chatHub,
        session,
        options,
        `That debug/test effect needs a nearby station target within ${maxRangeText}. The nearest station is ${targetName} at ${nearestDistanceText}.`,
      );
    }
    return handledResult(
      chatHub,
      session,
      options,
      "Effect playback failed.",
    );
  }

  const effect = result.data.effect;
  const autoTarget = result.data.autoTarget;
  if (effect.debugOnly && autoTarget) {
    return handledResult(
      chatHub,
      session,
      options,
      `${stop ? "Stopped" : "Played"} debug/test ${effect.key} (${effect.guid}) on your ship using nearby station ${autoTarget.targetName} (${autoTarget.targetID}) at ${formatDistanceMeters(autoTarget.distanceMeters)}.`,
    );
  }
  if (effect.debugOnly) {
    return handledResult(
      chatHub,
      session,
      options,
      `${stop ? "Stopped" : "Played"} debug/test ${effect.key} (${effect.guid}) on your ship.`,
    );
  }
  return handledResult(
    chatHub,
    session,
    options,
    `${stop ? "Stopped" : "Played"} ${effect.key} (${effect.guid}) on your ship.`,
  );
}

function handleLoadSystemCommand(session, chatHub, options) {
  if (!session || !session.characterID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Select a character before loading stargate destination systems.",
    );
  }

  const currentSystemID = getActiveSolarSystemID(session);
  if (!currentSystemID) {
    return handledResult(
      chatHub,
      session,
      options,
      "Current solar system could not be resolved.",
    );
  }

  const stargates = worldData.getStargatesForSystem(currentSystemID);
  if (stargates.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `No stargates found in ${formatSolarSystemLabel(currentSystemID)}.`,
    );
  }

  const destinationSystemIDs = [...new Set(
    stargates
      .map((stargate) => normalizePositiveInteger(stargate.destinationSolarSystemID))
      .filter((systemID) => systemID && systemID !== currentSystemID),
  )];
  if (destinationSystemIDs.length === 0) {
    return handledResult(
      chatHub,
      session,
      options,
      `No valid stargate destination systems found in ${formatSolarSystemLabel(currentSystemID)}.`,
    );
  }

  const alreadyLoaded = destinationSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  spaceRuntime.ensureScene(currentSystemID, {
    refreshStargates: false,
    broadcastStargateChanges: false,
  });
  const activationChanges = spaceRuntime.preloadSolarSystems(destinationSystemIDs, {
    broadcast: true,
  });
  const loadedNow = destinationSystemIDs.filter((systemID) =>
    spaceRuntime.isSolarSystemSceneLoaded(systemID),
  );
  const newlyLoaded = loadedNow.filter(
    (systemID) => !alreadyLoaded.includes(systemID),
  );
  const failed = destinationSystemIDs.filter(
    (systemID) => !loadedNow.includes(systemID),
  );

  return handledResult(
    chatHub,
    session,
    options,
    [
      `/loadsys ${formatSolarSystemLabel(currentSystemID)}:`,
      `loaded ${newlyLoaded.length}/${destinationSystemIDs.length} destination systems`,
      `(${formatSolarSystemList(newlyLoaded)})`,
      alreadyLoaded.length > 0
        ? `already loaded: ${formatSolarSystemList(alreadyLoaded)}`
        : null,
      failed.length > 0
        ? `failed: ${formatSolarSystemList(failed)}`
        : null,
      `gate updates emitted: ${activationChanges.length}.`,
    ].filter(Boolean).join(" "),
  );
}

function executeChatCommand(session, rawMessage, chatHub, options = {}) {
  const trimmed = String(rawMessage || "").trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith(".")) {
    return { handled: false };
  }

  const commandLine = trimmed.slice(1).trim();
  if (!commandLine) {
    return handledResult(
      chatHub,
      session,
      options,
      "No command supplied. Use /help.",
    );
  }

  const [commandName, ...rest] = commandLine.split(/\s+/);
  const command = normalizeCommandName(commandName);
  const argumentText = rest.join(" ").trim();

  if (
    command === "help" ||
    command === "commands" ||
    command === "commandlist"
  ) {
    return handledResult(chatHub, session, options, COMMANDS_HELP_TEXT);
  }

  if (command === "motd") {
    return handledResult(chatHub, session, options, DEFAULT_MOTD_MESSAGE);
  }

    if (command === "reload") {
    const controller = getHotReloadController();
    if (!controller) {
      return handledResult(chatHub, session, options, "Hot reload is disabled.");
    }

    if (!argumentText || normalizeCommandName(argumentText) === "now") {
      const result = controller.reloadNow("slash");
      if (!result.success) {
        return handledResult(
          chatHub,
          session,
          options,
          `Reload failed: ${result.error || "unknown error"}.`,
        );
      }

      const restartNote =
        result.restartRequiredFiles && result.restartRequiredFiles.length > 0
          ? ` Restart still required for: ${result.restartRequiredFiles.join(", ")}.`
          : "";
      return handledResult(
        chatHub,
        session,
        options,
        `Reloaded ${result.serviceCount} services at ${result.at}.${restartNote}`.trim(),
      );
    }

    if (normalizeCommandName(argumentText) === "status") {
      return handledResult(chatHub, session, options, getHotReloadSummary());
    }

    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /reload [now|status]",
    );
  }


  if (command === "where") {
    return handledResult(chatHub, session, options, getLocationSummary(session));
  }

  if (command === "dock") {
    return handleHomeDock(session, chatHub, options);
  }

  if (command === "effect") {
    return handleEffectCommand(session, argumentText, chatHub, options);
  }

  if (command === "loadsys") {
    return handleLoadSystemCommand(session, chatHub, options);
  }

  if (command === "who") {
    return handledResult(
      chatHub,
      session,
      options,
      getConnectedCharacterSummary(),
    );
  }

  if (command === "wallet" || command === "isk") {
    const summary = getWalletSummary(session);
    return handledResult(
      chatHub,
      session,
      options,
      summary || "Select a character before checking wallet balance.",
    );
  }

  if (command === "corpcreate") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before creating a corporation.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /corpcreate <corporation name>",
      );
    }

    const result = createCustomCorporation(session.characterID, argumentText);
    if (!result.success) {
      const message =
        result.errorMsg === "CORPORATION_NAME_TAKEN"
          ? `Corporation already exists: ${argumentText}.`
          : "Corporation creation failed.";
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Created corporation ${result.data.corporationRecord.corporationName} [${result.data.corporationRecord.tickerName}] and moved your character into it.`,
    );
  }

  if (command === "setalliance") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before creating an alliance.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setalliance <alliance name>",
      );
    }

    const corporationRecord = getCorporationRecord(session.corporationID);
    if (!corporationRecord) {
      return handledResult(
        chatHub,
        session,
        options,
        "Current corporation could not be resolved.",
      );
    }

    const result = createCustomAllianceForCorporation(
      session.characterID,
      corporationRecord.corporationID,
      argumentText,
    );
    if (!result.success) {
      let message = "Alliance creation failed.";
      if (result.errorMsg === "CUSTOM_CORPORATION_REQUIRED") {
        message = "You must be in a custom corporation before creating an alliance.";
      } else if (result.errorMsg === "ALLIANCE_NAME_TAKEN") {
        message = `Alliance already exists: ${argumentText}.`;
      }
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Created alliance ${result.data.allianceRecord.allianceName} [${result.data.allianceRecord.shortName}] and set your corporation into it.`,
    );
  }

  if (command === "joinalliance") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before joining an alliance.",
      );
    }

    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /joinalliance <alliance name>",
      );
    }

    const corporationRecord = getCorporationRecord(session.corporationID);
    if (!corporationRecord) {
      return handledResult(
        chatHub,
        session,
        options,
        "Current corporation could not be resolved.",
      );
    }

    const result = joinCorporationToAllianceByName(
      corporationRecord.corporationID,
      argumentText,
    );
    if (!result.success) {
      let message = "Alliance join failed.";
      if (result.errorMsg === "CUSTOM_CORPORATION_REQUIRED") {
        message = "You must be in a custom corporation before joining a custom alliance.";
      } else if (result.errorMsg === "ALLIANCE_NOT_FOUND") {
        message = `Alliance not found: ${argumentText}.`;
      } else if (result.errorMsg === "ALREADY_IN_ALLIANCE") {
        message = `Your corporation is already in ${argumentText}.`;
      }
      return handledResult(chatHub, session, options, message);
    }

    refreshAffiliationSessions(result.data.affectedCharacterIDs);
    return handledResult(
      chatHub,
      session,
      options,
      `Joined alliance ${result.data.allianceRecord.allianceName} [${result.data.allianceRecord.shortName}].`,
    );
  }

  if (command === "solar") {
    return handleSolarTeleport(session, argumentText, chatHub, options);
  }

  if (command === "addisk") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing wallet balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addisk <amount>",
      );
    }

    const result = adjustCharacterBalance(session.characterID, amount, {
      description: `Admin /addisk by ${session.characterName || session.userName || "unknown"}`,
      ownerID1: session.characterID,
      ownerID2: session.characterID,
      referenceID: session.characterID,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        result.errorMsg === "INSUFFICIENT_FUNDS"
          ? "Wallet change failed: insufficient funds."
          : "Wallet change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted wallet by ${formatIsk(amount)}. New balance: ${formatIsk(result.data.balance)}.`,
    );
  }

  if (command === "addplex") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing PLEX balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addplex <amount>",
      );
    }

    const result = adjustCharacterPlexBalance(session.characterID, amount);
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "PLEX balance change failed.",
      );
    }

    emitPlexBalanceChangeToSession(session, result.data.plexBalance);

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted PLEX by ${formatSignedPlex(amount)}. New balance: ${formatPlex(result.data.plexBalance)}.`,
    );
  }

  if (command === "setisk") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing wallet balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setisk <amount>",
      );
    }

    const result = setCharacterBalance(session.characterID, amount, {
      description: `Admin /setisk by ${session.characterName || session.userName || "unknown"}`,
      ownerID1: session.characterID,
      ownerID2: session.characterID,
      referenceID: session.characterID,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        result.errorMsg === "INSUFFICIENT_FUNDS"
          ? "Wallet change failed: balance cannot be negative."
          : "Wallet change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Wallet balance set to ${formatIsk(result.data.balance)}.`,
    );
  }

  if (command === "setplex") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing PLEX balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setplex <amount>",
      );
    }

    const result = setCharacterPlexBalance(session.characterID, amount);
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        "PLEX balance change failed.",
      );
    }

    emitPlexBalanceChangeToSession(session, result.data.plexBalance);

    return handledResult(
      chatHub,
      session,
      options,
      `PLEX balance set to ${formatPlex(result.data.plexBalance)}.`,
    );
  }

  if (command === "ship" || command === "giveme") {
    return handleShipSpawn(command, session, argumentText, chatHub, options);
  }

  if (command === "load" || command === "fit") {
    return handleLoadLikeCommand(command, session, argumentText, chatHub, options);
  }

  if (command === "hangar") {
    return handledResult(chatHub, session, options, getHangarSummary(session));
  }

  if (command === "session") {
    return handledResult(chatHub, session, options, getSessionSummary(session));
  }

  if (command === "item") {
    return handledResult(chatHub, session, options, getItemSummary(argumentText));
  }

  if (command === "typeinfo") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /typeinfo <ship name>",
      );
    }

    const lookup = resolveShipByName(argumentText);
    if (!lookup.success) {
      const message =
        lookup.errorMsg === "SHIP_NOT_FOUND"
          ? `Ship type not found: ${argumentText}.${formatSuggestions(lookup.suggestions)}`
          : `Ship type name is ambiguous: ${argumentText}.${formatSuggestions(lookup.suggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }

    return handledResult(
      chatHub,
      session,
      options,
      `${lookup.match.name}: typeID=${lookup.match.typeID}, groupID=${lookup.match.groupID}, categoryID=${lookup.match.categoryID}.`,
    );
  }

  if (command === "announce") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /announce <message>",
      );
    }

    sendAnnouncement(chatHub, session, argumentText);
    return handledResult(
      chatHub,
      session,
      options,
      `Announcement sent: ${argumentText}`,
    );
  }

    if (command === "tr") {
    const parts = argumentText ? argumentText.split(/\s+/).filter(Boolean) : [];
    if (parts.length === 0) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /tr <character|me> <locationID>",
      );
    }

    const targetText = parts.length === 1 ? "me" : parts[0];
    const destinationText = parts.length === 1 ? parts[0] : parts.slice(1).join(" ");
    const targetSession = resolveTeleportTargetSession(session, targetText);

    if (!targetSession) {
      return handledResult(
        chatHub,
        session,
        options,
        `Teleport target not found or not online: ${targetText}.`,
      );
    }

    const destinationID = Number(destinationText);
    if (!Number.isInteger(destinationID) || destinationID <= 0) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /tr <character|me> <locationID>",
      );
    }

    const result = getTeleportSession()(targetSession, destinationID);
    if (!result.success) {
      let message = "Teleport failed.";
      if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Teleport failed: no active character selected.";
      } else if (result.errorMsg === "SHIP_NOT_FOUND") {
        message = "Teleport failed: active ship not found.";
      } else if (result.errorMsg === "DESTINATION_NOT_FOUND") {
        message = `Teleport destination not found: ${destinationID}.`;
      }

      return handledResult(chatHub, session, options, message);
    }

    const destinationLabel =
      (result.data && result.data.summary) || `location ${destinationID}`;
    if (chatHub && targetSession !== session) {
      chatHub.sendSystemMessage(
        targetSession,
        `You were teleported to ${destinationLabel}.`,
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      targetSession === session
        ? `Teleported to ${destinationLabel}.`
        : `Teleported ${targetSession.characterName || targetSession.characterID} to ${destinationLabel}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Unknown command: /${command}. Use /help.`,
  );
}

module.exports = {
  AVAILABLE_SLASH_COMMANDS,
  COMMANDS_HELP_TEXT,
  DEFAULT_MOTD_MESSAGE,
  executeChatCommand,
};
