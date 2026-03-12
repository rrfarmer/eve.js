const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));

class CrimewatchService extends BaseService {
  constructor() {
    super("crimewatch");
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[CrimewatchService] MachoResolveObject called");
    // The EVE client requests a bound object from this service.
    // In EVEmu, this returns the Node ID (e.g. 888444).
    // We return our configured proxy node ID.
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[CrimewatchService] MachoBindObject args=${args ? args.length : 0}`,
    );

    // Generate a unique bound object ID
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    // OID = (idString, timestamp)
    const oid = [idString, now];

    // Handle optional nested call
    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0].toString()
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(
        `[CrimewatchService] MachoBindObject nested call: ${methodName}`,
      );
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    // Return 2-tuple: [SubStruct(SubStream(OID)), callResult]
    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  Handle_GetClientStates(args, session, kwargs) {
    log.debug("[CrimewatchService] GetClientStates called");
    // crimewatchSvc.py:
    // myCombatTimers, myEngagements, flaggedCharacters, safetyLevel = eveMoniker.CharGetCrimewatchLocation().GetClientStates()
    //
    // myCombatTimers = (weaponTimerState, pvpTimerState, npcTimerState, criminalTimerState, disapprovalTimerState)
    // each timerState = (state, expiryTime)
    //
    // flaggedCharacters = (criminals, suspects)

    // JS Arrays are encoded as PyTuple by the marshaler automatically
    // all Timer states idle = 0, expiryTime = None
    const idleTimer = [0, null];
    const myCombatTimers = [
      idleTimer,
      idleTimer,
      idleTimer,
      idleTimer,
      idleTimer,
    ];

    const flaggedCharacters = [
      { type: "list", items: [] }, // criminals
      { type: "list", items: [] }, // suspects
    ];

    const myEngagements = { type: "dict", entries: [] };
    const safetyLevel = 1; // const.shipSafetyLevelFull = 1

    return [myCombatTimers, myEngagements, flaggedCharacters, safetyLevel];
  }

  Handle_GetMySecurityStatus(args, session) {
    const charID =
      (session && (session.characterID || session.charid || session.userid)) || 0;
    const charData = charID ? getCharacterRecord(charID) || {} : {};
    const securityStatus = Number(
      charData.securityStatus ?? charData.securityRating ?? 0,
    );
    const normalizedStatus = Number.isFinite(securityStatus) ? securityStatus : 0;

    log.debug(
      `[CrimewatchService] GetMySecurityStatus(charID=${charID}) -> ${normalizedStatus}`,
    );

    return normalizedStatus;
  }
}

module.exports = CrimewatchService;
