const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class StructureDirectoryService extends BaseService {
  constructor() {
    super("structureDirectory");
  }

  callMethod(method, args, session, kwargs) {
    const handlerName = `Handle_${method}`;
    if (
      typeof this[handlerName] === "function" ||
      typeof this[method] === "function"
    ) {
      return super.callMethod(method, args, session, kwargs);
    }

    // The modern client probes several structure-directory reads while
    // building station/system UI. Returning null here bubbles into
    // client-side `structures = None` errors in map/surroundings code.
    if (typeof method === "string" && method.startsWith("Get")) {
      log.debug(
        `[StructureDirectoryService] Fallback empty result for ${method}`,
      );
      return { type: "list", items: [] };
    }

    return super.callMethod(method, args, session, kwargs);
  }

  Handle_GetMyDockableStructures(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetMyDockableStructures called");
    return { type: "list", items: [] };
  }

  Handle_GetStructures(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetStructures called");
    return { type: "list", items: [] };
  }

  Handle_GetStructuresInSystem(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetStructuresInSystem called");
    return { type: "list", items: [] };
  }

  Handle_GetSolarsystemStructures(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetSolarsystemStructures called");
    return { type: "list", items: [] };
  }

  Handle_GetStructureMapData(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetStructureMapData called");
    return { type: "list", items: [] };
  }

  Handle_GetJumpBridgesWithMyAccess(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetJumpBridgesWithMyAccess called");

    // Decompiled V23.02 mapView.py uses:
    //   jumpBridgesGates, hasAccessTo, hasNoAccessTo =
    //       sm.GetService('map').GetJumpBridgesWithMyAccess()
    //
    // The empty-state contract therefore needs three top-level values:
    //   1. jumpBridgesGates -> iterable of (structureA, structureB) pairs
    //   2. hasAccessTo      -> iterable of structure IDs with access
    //   3. hasNoAccessTo    -> iterable of structure IDs without access
    //
    // Returning a plain empty list triggers:
    //   ValueError: need more than 0 values to unpack
    // Returning only two values triggers:
    //   ValueError: need more than 2 values to unpack
    //
    // The client only performs iterable membership checks against the access
    // collections, so empty lists are sufficient for the no-data case here.
    return [
      { type: "list", items: [] },
      { type: "list", items: [] },
      { type: "list", items: [] },
    ];
  }
}

module.exports = StructureDirectoryService;
