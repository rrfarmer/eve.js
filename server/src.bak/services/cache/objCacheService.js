/**
 * Object Caching Service
 *
 * Handles cached data queries. Many EVE services cache their responses,
 * and the client asks for cache status before making actual calls.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class ObjCacheService extends BaseService {
  constructor() {
    super("objectCaching");
  }

  Handle_GetCachableObject(args, session) {
    const cacheKey = args && args.length > 0 ? args[0] : "unknown";
    log.debug(
      `[ObjCache] GetCachableObject: ${JSON.stringify(cacheKey).substring(0, 100)}`,
    );
    // Return None — client will proceed without cached data
    return null;
  }

  Handle_UpdateCache(args, session) {
    log.debug("[ObjCache] UpdateCache");
    return null;
  }
}

module.exports = ObjCacheService;
