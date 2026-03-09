const BaseService = require("../baseService");
const log = require("../../utils/logger");

class AccessGroupBookmarkMgrService extends BaseService {
  constructor() {
    super("accessGroupBookmarkMgr");
  }

  Handle_GetMyActiveBookmarks(args, session) {
    log.debug("[AccessGroupBookmarkMgr] GetMyActiveBookmarks called");
    return [
      { type: "list", entries: [] },
      { type: "list", entries: [] },
      { type: "list", entries: [] },
    ];
    // return {
    //   type: "tuple",
    //   entries: [
    //     { type: "list", entries: [] },
    //     { type: "list", entries: [] },
    //     { type: "list", entries: [] },
    //   ],
    // };
  }

  Handle_AddFolder(args, session) {
    log.debug("[AccessGroupBookmarkMgr] AddFolder called");
    return null;
  }
}

module.exports = AccessGroupBookmarkMgrService;
