const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildPositionFromClientRequest,
  cancelStructureUnanchorByID,
  deployStructureFromInventoryItem,
  normalizeExtraConfig,
  unanchorStructureByID,
} = require(path.join(__dirname, "../sovereignty/sovPlayerDeployment"));
const structureLog = require(path.join(__dirname, "./structureLog"));

function safeJson(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, entry) => {
      if (typeof entry === "bigint") {
        return entry.toString();
      }
      if (entry && typeof entry === "object") {
        if (seen.has(entry)) {
          return "[circular]";
        }
        seen.add(entry);
      }
      return entry;
    });
  } catch (error) {
    return JSON.stringify({ error: error.message });
  }
}

function buildSessionSummary(session) {
  return {
    userID: session && (session.userid || session.userID),
    characterID: session && (session.characterID || session.charid),
    corporationID: session && (session.corporationID || session.corpid),
    allianceID: session && (session.allianceID || session.allianceid),
    shipID:
      session &&
      ((session._space && session._space.shipID) ||
        session.shipID ||
        session.shipid),
    solarSystemID:
      session &&
      ((session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid),
    corprole: session && session.corprole,
  };
}

function buildErrorSummary(error) {
  return {
    name: error && error.name,
    message: error && error.message,
    code: error && error.code,
    machoErrorResponse: error && error.machoErrorResponse,
    stack: error && error.stack,
  };
}

class StructureDeploymentService extends BaseService {
  constructor() {
    super("structureDeployment");
  }

  Handle_Anchor(args, session) {
    const itemID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const x = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const z = Array.isArray(args) && args.length > 2 ? args[2] : null;
    const rotationYaw = Array.isArray(args) && args.length > 3 ? args[3] : null;
    const profileID = Array.isArray(args) && args.length > 4 ? args[4] : null;
    const structureName = Array.isArray(args) && args.length > 5 ? args[5] : "";
    const reinforceWeekday = Array.isArray(args) && args.length > 7 ? args[7] : null;
    const reinforceHour = Array.isArray(args) && args.length > 8 ? args[8] : null;
    const extraConfig = Array.isArray(args) && args.length > 9 ? args[9] : null;

    structureLog.info(
      `structureDeployment.Anchor begin ${safeJson({
        session: buildSessionSummary(session),
        itemID,
        x,
        z,
        rotationYaw,
        profileID,
        structureName,
        reinforceWeekday,
        reinforceHour,
        extraConfig,
      })}`,
    );
    try {
      const result = deployStructureFromInventoryItem(session, itemID, {
        position: buildPositionFromClientRequest(session, x, z),
        rotationYaw,
        profileID,
        structureName,
        reinforceWeekday,
        reinforceHour,
        ...normalizeExtraConfig(extraConfig),
      });
      structureLog.info(
        `structureDeployment.Anchor success ${safeJson({
          itemID,
          result,
        })}`,
      );
    } catch (error) {
      structureLog.error(
        `structureDeployment.Anchor failure ${safeJson({
          session: buildSessionSummary(session),
          itemID,
          args,
          error: buildErrorSummary(error),
        })}`,
      );
      throw error;
    }
    return null;
  }

  Handle_Unanchor(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    unanchorStructureByID(session, structureID);
    return null;
  }

  Handle_CancelUnanchor(args, session) {
    const structureID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    cancelStructureUnanchorByID(session, structureID);
    return null;
  }
}

module.exports = StructureDeploymentService;
