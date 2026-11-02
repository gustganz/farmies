// A bubble counts as seen when the user stays in the session's tab/terminal for a while:
// briefly (SHORT_MS) when the focus came there after the bubble appeared, longer (LONG_MS) when it
// was there all along (the user may have been looking at another screen when Claude finished).
const SHORT_MS = 5 * 1000;
const LONG_MS = 60 * 1000;

class SeenByFocus {
  constructor({ shortMs = SHORT_MS, longMs = LONG_MS } = {}) {
    this.shortMs = shortMs;
    this.longMs = longMs;
    this.watched = new Map(); // session id → { ts, focusedAtStart, lost, since }
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
        w = { ts: s.ts, focusedAtStart: isFocused, lost: false, since: isFocused ? now : null };
        this.watched.set(s.id, w);
      }
      if (!isFocused) {
        w.lost = true;
        w.since = null;
        continue;
      }
      if (w.since === null) w.since = now;
      const needed = w.focusedAtStart && !w.lost ? this.longMs : this.shortMs;
      if (now - w.since >= needed) {
        seen.push(s.id);
        this.watched.delete(s.id);
      }
    }
    for (const id of this.watched.keys()) if (!ids.has(id)) this.watched.delete(id);
    return seen;
  }
}

module.exports = { SeenByFocus, SHORT_MS, LONG_MS };
