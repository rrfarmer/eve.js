/**
 * EVE Service Manager
 *
 * Ported from EVEServiceManager in eve-server.cpp.
 * Registers game services by name and dispatches CALL_REQ to them.
 */

const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));

class ServiceManager {
  constructor() {
    this._services = new Map();
    this._boundObjects = new Map(); // OID string -> service instance
  }

  /**
   * Register a service instance. The service must have a `name` property.
   * @param {BaseService} service
   */
  register(service) {
    const name = service.name;
    if (!name) {
      throw new Error("service must have a 'name' property!");
    }
    if (this._services.has(name)) {
      log.warn(`service already registered: ${name}`);
    }
    this._services.set(name, service);
    log.debug(`service registered: ${name}`);
  }

  /**
   * Register a bound object OID string -> service mapping.
   * Called whenever a service creates a bound object via MachoBindObject.
   */
  registerBoundObject(oidString, service) {
    this._boundObjects.set(oidString, service);
    log.debug(`bound object registered: ${oidString} -> ${service.name}`);
  }

  /**
   * Look up a registered service by name, also checking bound object OIDs.
   * @param {string} name
   * @returns {BaseService|null}
   */
  lookup(name) {
    return this._services.get(name) || this._boundObjects.get(name) || null;
  }

  /**
   * Get a list of all registered service names.
   */
  getServiceNames() {
    return Array.from(this._services.keys());
  }

  /**
   * Get the total number of registered services.
   */
  get count() {
    return this._services.size;
  }
}

module.exports = ServiceManager;
