/* ==================================================================== *
 *  Encounter rail — collapsible encounter list + mini initiative order
 *
 *  During combat the combatant list is long and dense, so finding a given
 *  combatant means scrolling and losing your place in the order. This rail
 *  keeps the order permanently on screen, name-only, and makes navigation
 *  one click: the main list scrolls to the row and flashes it.
 *
 *  The rail lives in App's <nav>, the combatant list lives inside
 *  EncountersView, so the two talk through EncNavContext: the view registers
 *  its scroller and each row element, the rail reads visibility off them and
 *  calls back to jump. Nothing here re-sorts or filters — it renders the same
 *  ordered collection the main list already has.
 * ==================================================================== */
import {
  useRef, useState, useCallback, useEffect, useMemo, useLayoutEffect,
} from "react";
import { EncNavContext, useEncNav } from "./useEncNav.js";
import { Sym } from "./icons.jsx";

/* Timings — kept together because the auto-fit loop has to outlast the
 * expand/collapse animation it is reacting to. */
const FIT_WINDOW_MS = 460;  // rAF re-measure window after a toggle, outlasting
                            // the 340ms max-height transition in styles.css
const FLASH_HOLD_MS = 480;  // jumped-to row holds its ring before fading
const FLASH_FADE_MS = 750;  // and how long the fade itself runs, per styles.css

export function EncNavProvider({ children }) {
  const scrollerRef = useRef(null);
  const rowsRef = useRef(new Map()); // combatant id -> row element
  const [visibleIds, setVisibleIds] = useState(() => new Set());
  // Bumped whenever the row registry changes so the observer effect re-runs
  // without the rail having to know anything about the list's render cycle.
  const [rowEpoch, setRowEpoch] = useState(0);
  const [scrollerEpoch, setScrollerEpoch] = useState(0);
  /* How much of the scroller's top edge the sticky toolbar covers. Everything
   * below depends on it: the real top of the visible window is this far down,
   * so it decides where a jump lands, which rows count as on screen, and where
   * the running sheet pins. Kept in a ref as well for the non-reactive readers. */
  const [chromeH, setChromeH] = useState(0);
  const chromeHRef = useRef(0);

  const setScroller = useCallback((el) => {
    scrollerRef.current = el;
    setScrollerEpoch((n) => n + 1);
  }, []);

  const setRow = useCallback((id, el) => {
    const rows = rowsRef.current;
    if (el) rows.set(id, el);
    else rows.delete(id);
    setRowEpoch((n) => n + 1);
  }, []);

  /* Publish the chrome height and the visible window height as custom
   * properties on the scroller, so the running sheet can pin itself under the
   * toolbar and cap its height in pure CSS. ResizeObserver fires once on
   * observe, so there is no separate initial measurement. */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const chrome = scroller.querySelector(".enc-chrome");
    const ro = new ResizeObserver(() => {
      const h = chrome ? chrome.offsetHeight : 0;
      scroller.style.setProperty("--enc-chrome-h", `${h}px`);
      scroller.style.setProperty("--enc-view-h", `${scroller.clientHeight}px`);
      chromeHRef.current = h;
      setChromeH((cur) => (cur === h ? cur : h));
    });
    if (chrome) ro.observe(chrome);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scrollerEpoch]);

  /* On-screen dimming. An IntersectionObserver rooted on the scroller costs
   * nothing per scroll frame, unlike measuring every row on every event. The
   * 10px inset matches the prototype's rule: a sliver of a row peeking past
   * the edge doesn't count as "here". */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const rows = [...rowsRef.current.entries()];
    if (!rows.length) {
      setVisibleIds((cur) => (cur.size ? new Set() : cur));
      return;
    }

    const byEl = new Map(rows.map(([id, el]) => [el, id]));
    const live = new Set();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = byEl.get(e.target);
          if (!id) continue;
          if (e.isIntersecting) live.add(id);
          else live.delete(id);
        }
        setVisibleIds(new Set(live));
      },
      // rows tucked behind the sticky toolbar are not "here" — inset the top of
      // the root by the toolbar's height on top of the usual 10px sliver
      { root: scroller, rootMargin: `${-(chromeH + 10)}px 0px -10px 0px`, threshold: 0 }
    );
    rows.forEach(([, el]) => io.observe(el));
    return () => io.disconnect();
  }, [rowEpoch, scrollerEpoch, chromeH]);

  /* Navigation only — jumping never expands, selects, or otherwise touches the
   * combatant. Offsets are measured against the scroll container rather than
   * offsetParent, which resolves against whichever ancestor happens to be
   * positioned and lands the scroll a couple of hundred pixels off. */
  const flashTimers = useRef(new Map()); // row element -> pending timeout ids
  const clearFlash = useCallback((row) => {
    (flashTimers.current.get(row) || []).forEach(clearTimeout);
    flashTimers.current.delete(row);
    row.classList.remove("flash", "flash-out");
  }, []);

  const jumpTo = useCallback((id) => {
    const scroller = scrollerRef.current;
    const row = rowsRef.current.get(id);
    if (!scroller || !row) return;
    // The visible window starts below the sticky toolbar, so the row has to
    // clear it — without this a row already peeking out under the toolbar is
    // "already there" and the scroll barely moves. Rows near the end of the
    // list stop at the natural end of the scroll; the flash still marks them.
    const top =
      row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - chromeHRef.current - 8), behavior: "smooth" });
    // Flash on, then hand it to a transition to fade back out. Setting both in
    // the same frame would animate the flash in as well as out. Both classes
    // come off at the end so the row goes back to its own styling — .flash-out
    // otherwise leaves a .75s transition on it for good.
    clearFlash(row);
    void row.offsetWidth; // restart the flash if the row is jumped to twice
    row.classList.add("flash");
    flashTimers.current.set(row, [
      window.setTimeout(() => {
        row.classList.add("flash-out");
        row.classList.remove("flash");
      }, FLASH_HOLD_MS),
      window.setTimeout(() => clearFlash(row), FLASH_HOLD_MS + FLASH_FADE_MS),
    ]);
  }, [clearFlash]);

  useEffect(() => {
    const timers = flashTimers.current;
    return () => { timers.forEach((ids) => ids.forEach(clearTimeout)); };
  }, []);

  const value = useMemo(
    () => ({ setScroller, setRow, jumpTo, visibleIds }),
    [setScroller, setRow, jumpTo, visibleIds]
  );
  return <EncNavContext.Provider value={value}>{children}</EncNavContext.Provider>;
}

/* ---- auto-fit: the reason the order never needs a scrollbar ----
 *
 * The order takes whatever height the encounter list leaves it and shrinks its
 * rows and type to fit, rather than introducing a second scroll region in a
 * 290px rail. There is deliberately no practical floor — at 15 encounters
 * expanded and 15 combatants this lands near 17px rows / 10px type. */
function fitFor(available, count) {
  if (!count) return { row: 28, font: 12.5 };
  const row = Math.max(9, Math.min(28, available / count));
  const font = Math.max(6.5, Math.min(12.5, row * 0.58));
  return { row, font };
}

function useAutoFit(count, deps) {
  const boxRef = useRef(null);
  const [fit, setFit] = useState({ row: 28, font: 12.5 });

  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    setFit((cur) => {
      const next = fitFor(el.clientHeight, count);
      return next.row === cur.row && next.font === cur.font ? cur : next;
    });
  }, [count]);

  // Mount + roster change + anything the caller passes (the expand flag).
  useLayoutEffect(measure, [measure, ...deps]);

  // Keep measuring across the list animation: the order's height is being
  // handed back to it a frame at a time, so one measurement at the start would
  // size for the wrong height and one at the end would jump.
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      measure();
      if (now - start < FIT_WINDOW_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  return [boxRef, fit];
}

/* ---- the rail itself ---- */

export function EncounterRail({
  encounters, activeId, ordered, onSelect, onNew, onPrefill,
}) {
  const nav = useEncNav();
  const visibleIds = nav ? nav.visibleIds : null;
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef(null);
  const [listH, setListH] = useState(0);

  const active = encounters.find((e) => e.id === activeId) || null;
  const others = encounters.filter((e) => e.id !== activeId);

  // Measured rather than hard-coded so the expansion survives longer rosters
  // and translated labels.
  useLayoutEffect(() => {
    if (listRef.current) setListH(listRef.current.scrollHeight);
  }, [encounters.length, expanded]);

  // Opening an encounter gives the order its room back. Adjusted during render
  // (React's adjust-state-on-prop-change pattern) — an effect here would paint
  // the list still expanded for a frame.
  const [seenId, setSeenId] = useState(activeId);
  if (seenId !== activeId) { setSeenId(activeId); setExpanded(false); }

  const [orderBoxRef, fit] = useAutoFit(ordered.length, [expanded, ordered.length]);

  const pick = (id) => { onSelect(id); setExpanded(false); };

  /* An animal companion tucked under its owner acts on the owner's turn and has
   * no initiative of its own — the main list hides its initiative cell, so the
   * numeral column goes blank here too rather than showing a stale roll. */
  const owners = new Set(ordered.filter((c) => c.pcId).map((c) => c.pcId));
  const hasOwnInit = (c) => !(c.kind === "companion" && owners.has(c.ownerPcId));

  return (
    <div className="enc-rail">
      {active ? (
        <button
          className="enc-chip"
          aria-expanded={expanded}
          aria-controls="enc-rail-list"
          onClick={() => setExpanded((v) => !v)}
        >
          <Sym name="combat" className="enc-chip-sym" />
          <span className="enc-chip-name">
            {active.name || "untitled"}
            <span className="enc-chip-count"> · {active.combatants.length}</span>
          </span>
          <span className="enc-chip-toggle">
            {expanded ? "hide" : `${others.length} more`}
            <span className={`enc-chip-chev${expanded ? " up" : ""}`} aria-hidden>▾</span>
          </span>
        </button>
      ) : (
        <div className="enc-chip empty">no encounter selected</div>
      )}

      <div
        className="enc-rail-listwrap"
        id="enc-rail-list"
        style={{ maxHeight: expanded ? listH : 0, opacity: expanded ? 1 : 0 }}
        aria-hidden={!expanded}
      >
        <div className="enc-rail-list" ref={listRef}>
          {others.map((e) => (
            <button
              key={e.id}
              className="enc-rail-row"
              tabIndex={expanded ? 0 : -1}
              onClick={() => pick(e.id)}
            >
              <Sym name="combat" className="enc-rail-sym" />
              <span className="enc-rail-name">
                {e.name || "untitled"}
                <span className="enc-rail-count"> · {e.combatants.length}</span>
              </span>
            </button>
          ))}
          <button className="enc-rail-row add" tabIndex={expanded ? 0 : -1} onClick={onNew}>
            <span className="enc-rail-plus">+</span>
            <span className="enc-rail-name">new encounter</span>
          </button>
          <button className="enc-rail-row add" tabIndex={expanded ? 0 : -1} onClick={onPrefill}>
            <span className="enc-rail-plus">↡</span>
            <span className="enc-rail-name">prefill from scenario</span>
          </button>
        </div>
      </div>

      <div className="mini-order">
        <div className="mini-order-head">
          <span className="mini-order-label">initiative order</span>
          <span className="mini-order-n">{ordered.length}</span>
        </div>
        <ul className="mini-order-list" ref={orderBoxRef}>
          {ordered.map((c) => {
            const on = visibleIds ? visibleIds.has(c.id) : false;
            return (
              <li key={c.id}>
                <button
                  className={`mini-row${on ? " on" : ""}`}
                  style={{ height: `${fit.row}px` }}
                  onClick={() => nav && nav.jumpTo(c.id)}
                  title={c.name}
                >
                  <span className="mini-dot" aria-hidden />
                  <span
                    className="mini-init"
                    style={{ fontSize: `${Math.max(6, fit.font - 2)}px` }}
                  >
                    {c.init == null || !hasOwnInit(c) ? "" : c.init}
                  </span>
                  <span className="mini-name" style={{ fontSize: `${fit.font}px` }}>{c.name}</span>
                  {c.kind === "enemy" && <span className="mini-foe" aria-hidden />}
                </button>
              </li>
            );
          })}
          {ordered.length === 0 && <li className="mini-empty">no combatants yet</li>}
        </ul>
      </div>
    </div>
  );
}
