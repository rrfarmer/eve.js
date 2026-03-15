const sessions = new Set();
const listeners = new Set();

function register(session) {
  if (session) {
    sessions.add(session);
  }
}

function unregister(session) {
  if (session) {
    sessions.delete(session);
  }
}

function getSessions() {
  return Array.from(sessions).filter(
    (session) => session && session.socket && !session.socket.destroyed,
  );
}

function subscribe(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

module.exports = {
  register,
  unregister,
  getSessions,
  subscribe
};
