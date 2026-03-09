const BaseService = require("../baseService");
const log = require("../../utils/logger");

class CalendarProxyService extends BaseService {
  constructor() {
    super("calendarProxy");
  }

  Handle_GetEventList(args, session) {
    log.debug("[CalendarProxy] GetEventList called");
    return { type: "list", items: [] };
  }
}

module.exports = CalendarProxyService;
