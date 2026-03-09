const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class ShipKillCounterService extends BaseService {
  constructor() {
    super("shipKillCounter");
  }

  Handle_GetItemKillCountPlayer(args, session, kwargs) {
    const itemID = args && args.length > 0 ? args[0] : null;
    log.debug(`[ShipKillCounter] GetItemKillCountPlayer(itemID=${itemID})`);
    return 0;
  }

  Handle_GetItemKillCountNPC(args, session, kwargs) {
    const itemID = args && args.length > 0 ? args[0] : null;
    log.debug(`[ShipKillCounter] GetItemKillCountNPC(itemID=${itemID})`);
    return 0;
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[ShipKillCounter] Unhandled method fallback: ${method}`);
    return 0;
  }
}

module.exports = ShipKillCounterService;
