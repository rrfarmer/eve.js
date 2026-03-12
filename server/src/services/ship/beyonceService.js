const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const {
  buildBoundObjectResponse,
  normalizeNumber,
  extractDictEntries,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  jumpSessionViaStargate,
} = require(path.join(__dirname, "../../space/transitions"));

class BeyonceService extends BaseService {
  constructor() {
    super("beyonce");
  }

  Handle_GetFormations(args, session) {
    spaceRuntime.markBeyonceBound(session);

    return [
      [
        "Diamond",
        [
          [100.0, 0.0, 0.0],
          [0.0, 100.0, 0.0],
          [-100.0, 0.0, 0.0],
          [0.0, -100.0, 0.0],
        ],
      ],
      [
        "Arrow",
        [
          [100.0, 0.0, -50.0],
          [50.0, 0.0, 0.0],
          [-100.0, 0.0, -50.0],
          [-50.0, 0.0, 0.0],
        ],
      ],
    ];
  }

  Handle_UpdateStateRequest(args, session) {
    spaceRuntime.markBeyonceBound(session);
    // The client probes this repeatedly while already in space; forcing a
    // full AddBalls2/SetState replay causes scene-object churn and visible
    // respawn flicker.
    spaceRuntime.ensureInitialBallpark(session);
    return null;
  }

  Handle_CmdGotoDirection(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);

    log.info(
      `[Beyonce] CmdGotoDirection char=${session && session.characterID} dir=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoDirection(session, { x, y, z });
    return null;
  }

  Handle_CmdAlignTo(args, session, kwargs) {
    const kwargEntries = extractDictEntries(kwargs);
    const dstEntry = kwargEntries.find(([key]) => {
      const normalizedKey = Buffer.isBuffer(key) ? key.toString("utf8") : String(key);
      return normalizedKey === "dstID";
    });
    const targetID = normalizeNumber(
      args && args[0] !== undefined ? args[0] : dstEntry ? dstEntry[1] : 0,
      0,
    );
    log.info(
      `[Beyonce] CmdAlignTo char=${session && session.characterID} target=${targetID}`,
    );
    spaceRuntime.alignTo(session, targetID);
    return null;
  }

  Handle_CmdFollowBall(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    const range = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdFollowBall char=${session && session.characterID} target=${targetID} range=${range}`,
    );
    if (targetID > 0 && range <= 50) {
      const dockingDebug = spaceRuntime.getDockingDebugState(session, targetID);
      if (dockingDebug) {
        log.info(`[Beyonce] CmdFollowBall dockingState=${JSON.stringify(dockingDebug)}`);
      }
    }

    spaceRuntime.followBall(session, targetID, range);
    return null;
  }

  Handle_CmdOrbit(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    const range = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdOrbit char=${session && session.characterID} target=${targetID} range=${range}`,
    );
    spaceRuntime.orbit(session, targetID, range);
    return null;
  }

  Handle_CmdSetSpeedFraction(args, session) {
    const fraction = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdSetSpeedFraction char=${session && session.characterID} fraction=${fraction}`,
    );
    spaceRuntime.setSpeedFraction(session, fraction);
    return null;
  }

  Handle_CmdStop(args, session) {
    log.info(`[Beyonce] CmdStop char=${session && session.characterID}`);
    spaceRuntime.stop(session);
    return null;
  }

  Handle_CmdWarpToStuff(args, session, kwargs) {
    const warpType = String(args && args[0] ? args[0] : "");
    const rawTarget = args && args.length > 1 ? args[1] : null;
    const numericTarget = normalizeNumber(rawTarget, 0);
    const minimumRange = normalizeNumber(kwargs && kwargs.minRange, 0);

    log.info(
      `[Beyonce] CmdWarpToStuff char=${session && session.characterID} type=${warpType} target=${numericTarget || rawTarget} minRange=${minimumRange}`,
    );

    let result = null;
    if (
      (warpType === "item" ||
        warpType === "scan" ||
        warpType === "launch" ||
        warpType === "bookmark" ||
        warpType === "char" ||
        !warpType) &&
      numericTarget > 0
    ) {
      result = spaceRuntime.warpToEntity(session, numericTarget, { minimumRange });
    } else if (
      rawTarget &&
      typeof rawTarget === "object" &&
      rawTarget.x !== undefined &&
      rawTarget.y !== undefined &&
      rawTarget.z !== undefined
    ) {
      result = spaceRuntime.warpToPoint(session, rawTarget, { minimumRange });
    } else {
      result = {
        success: false,
        errorMsg: "UNSUPPORTED_WARP_TARGET",
      };
    }

    if (!result || !result.success) {
      log.warn(
        `[Beyonce] CmdWarpToStuff failed for char=${session && session.characterID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      );
    }

    return null;
  }

  Handle_CmdWarpToStuffAutopilot(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdWarpToStuffAutopilot char=${session && session.characterID} target=${targetID}`,
    );
    spaceRuntime.warpToEntity(session, targetID, { minimumRange: 10000 });
    return null;
  }

  Handle_CmdDock(args, session) {
    const stationID = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdDock char=${session && session.characterID} station=${stationID}`,
    );
    const dockingDebug = spaceRuntime.getDockingDebugState(session, stationID);
    if (dockingDebug) {
      log.info(`[Beyonce] CmdDock state=${JSON.stringify(dockingDebug)}`);
    }

    if (!spaceRuntime.canDockAtStation(session, stationID)) {
      log.info(
        `[Beyonce] CmdDock converting to docking approach for char=${session && session.characterID} station=${stationID}`,
      );
      const followed = spaceRuntime.followBall(session, stationID, 50, {
        dockingTargetID: stationID,
      });
      if (!followed) {
        log.info(
          `[Beyonce] CmdDock keeping existing docking approach for char=${session && session.characterID} station=${stationID}`,
        );
      }
      throwWrappedUserError("DockingApproach");
    }

    const result = spaceRuntime.acceptDocking(session, stationID);
    if (!result.success) {
      log.warn(
        `[Beyonce] CmdDock failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      return null;
    }

    return result.data.acceptedAtFileTime || null;
  }

  Handle_CmdStargateJump(args, session) {
    const fromStargateID = normalizeNumber(args && args[0], 0);
    const toStargateID = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdStargateJump char=${session && session.characterID} from=${fromStargateID} to=${toStargateID}`,
    );

    const result = jumpSessionViaStargate(session, fromStargateID, toStargateID);
    if (!result.success) {
      log.warn(
        `[Beyonce] CmdStargateJump failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      return null;
    }

    return result.data.boundResult || null;
  }

  Handle_MachoResolveObject(args, session) {
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    spaceRuntime.markBeyonceBound(session);
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  afterCallResponse(methodName, session) {
    if (methodName !== "MachoBindObject") {
      return;
    }

    spaceRuntime.ensureInitialBallpark(session);
  }
}

module.exports = BeyonceService;
