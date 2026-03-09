/**
 * Base Service
 *
 * All game services extend this. Provides method dispatch and
 * a standard interface for the service manager.
 */

const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));

class BaseService {
  constructor(name) {
    this._name = name;
  }

  get name() {
    return this._name;
  }

  /**
   * Called by the packet dispatcher to invoke a method on this service.
   * Override this to add custom dispatch logic, or just define methods
   * in your subclass and this will find them automatically.
   *
   * @param {string} method - Method name from the call request
   * @param {Array} args - Arguments from the call request
   * @param {object} session - Client session
   * @returns {*} Result to send back to the client
   */
  callMethod(method, args, session, kwargs) {
    // Try to find a handler method named Handle_<method> or just <method>
    const handlerName = `Handle_${method}`;
    if (typeof this[handlerName] === "function") {
      return this[handlerName](args, session, kwargs);
    }
    if (typeof this[method] === "function") {
      return this[method](args, session, kwargs);
    }

    log.warn(`[${this._name}] Unhandled method: ${method}`);
    return null;
  }
}

module.exports = BaseService;
