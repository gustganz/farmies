// A bubble counts as seen when the user stays in the session's tab/terminal for a while (SEEN_MS),
// also when the focus was there all along.
const SEEN_MS = 5 * 1000;

class SeenByFocus {
  constructor({ seenMs = SEEN_MS } = {}) {
    this.seenMs = seenMs;
    this.watched = new Map(); // session id → { ts, since }
  }

  /**
   * pending: sessions waiting for the user ({ id, ts }), focused(s): whether the user is in its
   * tab/terminal now. Returns the ids to mark as seen.
   */
  update(pending, focused, now = Date.now()) {
    const seen = [];
    const ids = new Set();
    for (const s of pending) {
      ids.add(s.id);
      const isFocused = Boolean(focused(s));
      let w = this.watched.get(s.id);
      if (!w || w.ts !== s.ts) {
        w = { ts: s.ts, since: null };
        this.watched.set(s.id, w);
      }
      if (!isFocused) {
        w.since = null;
        continue;
      }
      if (w.since === null) w.since = now;
      if (now - w.since >= this.seenMs) {
        seen.push(s.id);
        this.watched.delete(s.id);
      }
    }
    for (const id of this.watched.keys()) if (!ids.has(id)) this.watched.delete(id);
    return seen;
  }
}

module.exports = { SeenByFocus, SEEN_MS };
