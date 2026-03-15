const path = require("path");

const chatHub = require(path.join(__dirname, "./chatHub"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

function flushPendingInitialBallpark(session, pending, attempt = 0) {
  if (!session || !pending) {
    return;
  }

  if (!session.socket || session.socket.destroyed) {
    return;
  }

  if (!session._space || session._space.initialStateSent) {
    return;
  }

  if (
    pending.awaitBeyonceBound === true &&
    !session._space.beyonceBound
  ) {
    if (attempt >= 40) {
      return;
    }

    setTimeout(() => {
      flushPendingInitialBallpark(session, pending, attempt + 1);
    }, 25);
    return;
  }

  spaceRuntime.ensureInitialBallpark(session, {
    force: pending.force === true,
  });
}

function flushPendingCommandSessionEffects(session) {
  if (!session || typeof session !== "object") {
    return;
  }

  const pendingLocalChannelSync = session._pendingLocalChannelSync || null;
  const pendingInitialBallpark = session._pendingCommandInitialBallpark || null;
  session._pendingLocalChannelSync = null;
  session._pendingCommandInitialBallpark = null;

  if (pendingLocalChannelSync) {
    chatHub.moveLocalSession(session, pendingLocalChannelSync.previousChannelID);
  }

  if (pendingInitialBallpark) {
    setTimeout(() => {
      flushPendingInitialBallpark(session, pendingInitialBallpark);
    }, 0);
  }
}

module.exports = {
  flushPendingCommandSessionEffects,
};
