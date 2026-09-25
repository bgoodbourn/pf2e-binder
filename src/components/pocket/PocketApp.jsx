/* ==================================================================== *
 *  PocketApp — the phone cheat sheet
 *
 *  One screen you can leave face-up beside the laptop: per-PC reminders
 *  (written on desktop) and your own "things to remember". Replaces the old
 *  mobile companion.
 *
 *  Read-only against the synced overlay: nothing here calls patch(), so the
 *  phone can never clobber the laptop's edits. Its own state (the remember
 *  list, session clock, stay-awake switch) lives in localStorage only.
 * ==================================================================== */
import { useState, useEffect, useCallback, useMemo } from "react";
import "../../pocket.css";
import { useScenarioData } from "../../data/ScenarioContext.jsx";
import { parseBuild } from "../../lib/pf2e.js";

const STORE_KEY = "binder:pocket:v1";
const SESSION_MS = 4 * 60 * 60 * 1000;

// Phone-local state. Storage can throw (private mode, blocked site data), so
// every read and write falls back to in-memory state.
function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}
function usePocketStore() {
  const [store, setStore] = useState(readStore);
  const update = useCallback((changes) => {
    setStore((prev) => {
      const next = { ...prev, ...changes };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        // not persisted this time; the in-memory state still works
      }
      return next;
    });
  }, []);
  return [store, update];
}

const canWake = typeof navigator !== "undefined" && "wakeLock" in navigator;

// Hold a screen wake lock while `on`. The browser drops it whenever the page
// is hidden, so it's re-requested each time the page becomes visible again.
function useWakeLock(on) {
  useEffect(() => {
    if (!on || !canWake) return undefined;
    let lock = null;
    let done = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen")
        .then((l) => { if (done) l.release(); else lock = l; })
        .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", acquire);
      if (lock) lock.release().catch(() => {});
    };
  }, [on]);
}

// The current time, refreshed every `ms` while `on` (drives the clock readout).
function useNow(on, ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

const hm = (ms) => {
  const mins = Math.floor(ms / 60000);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
};

const toLines = (text) =>
  (text || "").split("\n").map((l) => l.replace(/^\s*[-•·*]\s*/, "").trim()).filter(Boolean);

export default function PocketApp({ onRequestDesktop }) {
  const { ready, scenario, scenarios, activeId, setActiveId, overlay } = useScenarioData();
  const [store, update] = usePocketStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const pcs = useMemo(() => (overlay.pcs || []).map((raw) => parseBuild(raw)).filter(Boolean), [overlay.pcs]);
  const reminders = overlay.reminders || {};
  const remember = store.remember || [];

  // Session clock: banked time plus the running stretch since `clockSince`.
  const since = store.clockSince ?? null;
  const now = useNow(since != null, 15000);
  const banked = store.clockMs || 0;
  const elapsed = banked + (since != null ? Math.max(0, now - since) : 0);
  const toggleClock = () =>
    since != null
      ? update({ clockMs: banked + (Date.now() - since), clockSince: null })
      : update({ clockSince: Date.now() });

  useWakeLock(!!store.awake);

  const startEdit = () => { setDraft(remember.join("\n")); setEditing(true); };
  const saveEdit = () => { update({ remember: toLines(draft) }); setEditing(false); };

  if (!ready) return <div className="pocket pocket-boot">loading…</div>;

  const title = (scenario?.meta?.title || scenario?.title || "no scenario").toLowerCase();

  return (
    <div className="pocket">
      <header className="pk-head">
        <label className="pk-title">
          <span>{title}</span>
          <select
            aria-label="switch scenario"
            value={activeId || ""}
            onChange={(e) => setActiveId(e.target.value)}
          >
            {scenarios.map((s) => (
              <option key={s.scenario_id} value={s.scenario_id}>{(s.title || "untitled").toLowerCase()}</option>
            ))}
          </select>
        </label>
        <div className="pk-tools">
          <button
            className={`pk-clock ${since != null ? "running" : ""}`}
            onClick={toggleClock}
            aria-label={since != null ? "pause session clock" : "start session clock"}
          >
            {hm(elapsed)}<span className="pk-of">/{hm(SESSION_MS)}</span>
          </button>
          {since == null && elapsed > 0 && (
            <button className="pk-link" onClick={() => update({ clockMs: 0 })}>reset</button>
          )}
          {canWake && (
            <button
              className={`pk-awake ${store.awake ? "on" : ""}`}
              onClick={() => update({ awake: !store.awake })}
              aria-pressed={!!store.awake}
              title="keep the screen on"
            >
              {store.awake ? "awake" : "sleep ok"}
            </button>
          )}
        </div>
      </header>

      <section className="pk-sec">
        <h2>party</h2>
        {pcs.length === 0 && <p className="pk-empty">import the party on desktop to see it here.</p>}
        {pcs.map((pc) => (
          <div className="pk-pc" key={pc.id}>
            <div>
              <span className="pk-name">{pc.name}</span>{" "}
              <span className="pk-sub">{[pc.cls, pc.level].filter((x) => x != null && x !== "").join(" ")}</span>
            </div>
            {toLines(reminders[pc.id]).length > 0 && (
              <ul>{toLines(reminders[pc.id]).map((r, i) => <li key={i}>{r}</li>)}</ul>
            )}
          </div>
        ))}
      </section>

      <section className="pk-sec">
        <h2>
          things to remember
          {!editing && <button className="pk-link" onClick={startEdit}>edit</button>}
        </h2>
        {editing ? (
          <>
            <textarea
              className="pk-edit"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.max(5, draft.split("\n").length + 1)}
              placeholder="one per line"
              autoFocus
            />
            <div className="pk-edit-actions">
              <button className="pk-link" onClick={() => setEditing(false)}>cancel</button>
              <button className="pk-btn" onClick={saveEdit}>done</button>
            </div>
          </>
        ) : (
          remember.length > 0
            ? <ul>{remember.map((r, i) => <li key={i}>{r}</li>)}</ul>
            : <p className="pk-empty">nothing yet. tap edit to add some.</p>
        )}
      </section>

      <footer className="pk-foot">
        <button className="pk-link" onClick={onRequestDesktop}>open desktop layout</button>
      </footer>
    </div>
  );
}
