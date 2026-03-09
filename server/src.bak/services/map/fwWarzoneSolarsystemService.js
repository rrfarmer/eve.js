const BaseService = require("../baseService");
const log = require("../../utils/logger");

class FwWarzoneSolarsystemService extends BaseService {
  constructor() {
    super("fwWarzoneSolarsystem");
  }

  Handle_GetLocalOccupationState(args, session) {
    log.debug("[fwWarzoneSvc] GetLocalOccupationState called");

    return [
      {
        type: "object",
        name: "util.KeyVal",
        args: {
          type: "dict",
          entries: [
            ["adjacencyState", 0],
            ["ownerFactionID", null],
            ["occupierFactionID", null],
            ["isBorg", false],
          ],
        },
      },
      null,
    ];
  }
}

module.exports = FwWarzoneSolarsystemService;
