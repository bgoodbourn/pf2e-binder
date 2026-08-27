/* ==================================================================== *
 *  HELP TAB — a searchable index of every feature, as its own workspace.
 *
 *  Help is a destination, not a tour: the user picks what to read and in
 *  what order. The left column searches and browses; the right shows one
 *  feature, with a schematic of the screen it lives on and its region
 *  outlined, so "where is it?" is answered visually before the user goes
 *  back to work.
 *
 *  Content lives in src/data/help-index.js — nothing here is copy.
 * ==================================================================== */
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { HelpSym } from "./icons.jsx";

/* ------------------------------------------------------------------ *
 *  Wireframe schematics
 *
 *  One shape per workspace, drawn from percentage-positioned bars so a
 *  feature's [left, top, width, height] region lands on a real element.
 *  Deliberately abstract — grey bars, no text — so it reads as a map of
 *  the app rather than a screenshot that has to be kept up to date.
 *
 *  Bar tuple: [x, y, w, h, tone?]. Tones: bar (default), dim, dark,
 *  title, block (a soft filled panel), box (an outlined panel).
 * ------------------------------------------------------------------ */

/* the top dock, common to every workspace */
const TOPBAR = [
  [2.5, 3, 8, 3, "dark"],
  [13, 3, 5.5, 3], [19.5, 3, 5.5, 3], [26, 3, 5.5, 3], [32.5, 3, 5.5, 3],
  [52, 3, 7, 3, "dim"], [62, 3, 10, 3, "dim"], [76, 3, 20, 3, "dim"],
];

const WIRE = {
  /* app-level features: the generic shape of the binder */
  shell: [
    [2, 12, 17, 1.5], [2, 16, 20, 1.5], [2, 20, 14, 1.5], [2, 24, 18, 1.5],
    [27, 14, 32, 2.6, "title"],
    [27, 20, 66, 1.4, "dim"], [27, 24, 62, 1.4, "dim"], [27, 28, 45, 1.4, "dim"],
    [27, 34, 66, 16, "block"],
    [27, 54, 60, 1.4, "dim"], [27, 58, 52, 1.4, "dim"],
  ],

  /* rail of chapters + the article, with a read-aloud box and a check card */
  scenario: [
    [2, 11.5, 8, 1.2, "dim"],
    [2, 14.5, 19, 2.4],
    [2, 20, 10, 1.2, "dim"],
    [2, 23.5, 19, 2.2], [2, 27.5, 19, 2.2], [2, 31.5, 19, 2.2], [2, 35.5, 19, 2.2], [2, 39.5, 19, 2.2],
    [2, 45, 9, 1.2, "dim"],
    [2, 48.5, 19, 2.2], [2, 52.5, 19, 2.2], [2, 56.5, 19, 2.2],
    [28, 13, 30, 3, "title"],
    [28, 20, 66, 1.5, "dim"], [28, 24, 62, 1.5, "dim"], [28, 28, 68, 1.5, "dim"],
    [40, 32.5, 23, 1.8, "dark"],
    [28, 37, 58, 1.5, "dim"], [28, 41, 64, 1.5, "dim"],
    [28, 46, 68, 18, "block"],
    [28, 68, 68, 17, "box"],
  ],

  /* encounter rail + header, toolbar, combatant cards, running sheet, round bar */
  encounters: [
    [2, 10.5, 19, 7, "block"],
    [2, 20.5, 11, 1.2, "dim"],
    [2, 23.5, 19, 2.2], [2, 29.1, 19, 2.2], [2, 34.7, 19, 2.2], [2, 40.3, 19, 2.2], [2, 45.9, 19, 2.2],
    [2, 51.5, 19, 2.2], [2, 57.1, 19, 2.2], [2, 62.7, 19, 2.2], [2, 68.3, 19, 2.2], [2, 73.9, 19, 2.2],
    [26, 11, 72, 7, "block"], [27.5, 13, 24, 2.6, "title"], [83, 11.5, 15, 6, "box"],
    [26, 20, 72, 6, "box"],
    [27, 21.5, 9, 3], [37, 21.5, 9, 3], [47, 21.5, 9, 3], [57, 21.5, 7, 3],
    [65, 21.5, 5, 3, "dim"], [71, 21.5, 5, 3, "dim"], [77, 21.5, 5, 3, "dim"],
    [26, 28, 51, 19, "box"],
    [27.5, 29.5, 6, 16], [36, 30, 24, 2.4, "title"], [62.5, 30, 3, 2.4, "dim"], [66, 29.5, 10, 5.5],
    [36, 35.5, 4.6, 5.5, "block"], [41.4, 35.5, 4.6, 5.5, "block"], [46.8, 35.5, 4.6, 5.5, "block"],
    [52.2, 35.5, 4.6, 5.5, "block"], [57.6, 35.5, 4.6, 5.5, "block"],
    [36, 42, 10, 3, "dim"], [47, 42, 11, 3, "dim"],
    [26, 49, 51, 19, "box"],
    [26, 70, 51, 14, "box"],
    [79, 28, 19, 34, "block"],
    [26, 88, 72, 8, "block"],
  ],

  /* rail of party + npcs, sheet head with notes, section pills, stat tiles */
  characters: [
    [2, 11, 10, 1.2, "dim"],
    [2, 14.5, 19, 2.4], [2, 19, 19, 2.4], [2, 23.5, 19, 2.4], [2, 28, 19, 2.4],
    [2, 32.5, 19, 2.4, "dim"],
    [2, 40, 9, 1.2, "dim"],
    [2, 43.5, 19, 2.4], [2, 48, 19, 2.4], [2, 52.5, 19, 2.4], [2, 57, 19, 2.4],
    [27, 12, 6.5, 10, "dark"],
    [36, 13, 22, 3, "title"], [36, 18, 16, 1.6, "dim"],
    [74, 12, 24, 10, "block"], [74, 22.5, 25, 2.4, "dim"],
    [26.5, 28, 8, 4.5], [35.5, 28, 9, 4.5], [45.5, 28, 8, 4.5], [54.5, 28, 10, 4.5], [65.5, 28, 8, 4.5],
    [26, 36, 17, 13, "block"], [44.3, 36, 17, 13, "block"], [62.6, 36, 17, 13, "block"], [80.9, 36, 17, 13, "block"],
    [26, 53, 70, 1.5, "dim"], [26, 57, 64, 1.5, "dim"], [26, 61, 68, 1.5, "dim"],
    [26, 65, 58, 1.5, "dim"], [26, 69, 66, 1.5, "dim"],
    [26, 77, 72, 8, "box"],
  ],

  /* pages rail, prep/run bar with search, document blocks */
  gmnotes: [
    [2, 11, 7, 1.2, "dim"],
    [2, 14.5, 19, 2.4], [5, 18.5, 16, 2.2, "dim"], [5, 22, 16, 2.2, "dim"],
    [2, 26, 19, 2.4], [2, 30.5, 19, 2.4], [5, 34.5, 16, 2.2, "dim"],
    [2, 91, 19, 2.4, "dim"],
    [26, 11, 15, 6, "block"], [43, 13, 13, 1.6, "dim"], [79, 11, 19, 6, "box"],
    [26, 20, 22, 1.6, "dim"],
    [26, 24, 30, 3, "title"],
    [26, 32, 60, 1.5, "dim"], [26, 35.5, 56, 1.5, "dim"],
    [26, 40, 60, 10, "block"],
    [26, 53, 60, 14, "box"],
    [26, 71, 60, 8, "box"],
    [26, 81, 60, 7, "block"],
  ],
};

/* The one animation in the design: the highlight rectangle glides between
 * features, which is what makes the schematic legible as a map. */
function HelpWire({ shape, r, label }) {
  const bars = WIRE[shape] || WIRE.shell;
  const [left, top, width, height] = r;
  // The label chip sits above the rectangle. A region up in the top bar has no
  // room there, so it drops below — and a region that also reaches the floor
  // (a full-height rail) has room for neither, so it tucks inside. Regions out
  // at the right edge anchor the chip to their right, or it runs off the box.
  const pos = top >= 12 ? "" : top + height <= 88 ? " below" : " inside";
  const align = left + width > 72 ? " right" : "";
  return (
    <div className="htab-wire">
      <div className="htab-wire-band" />
      <div className="htab-wire-rail" />
      {[...TOPBAR, ...bars].map(([x, y, w, h, tone], i) => (
        <div
          key={i}
          className={`htab-bar${tone ? ` t-${tone}` : ""}`}
          style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
        />
      ))}
      <div
        className="htab-hl"
        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
      >
        <span className={`htab-hl-chip${pos}${align}`}>{label}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Help tab
 * ------------------------------------------------------------------ */
export function HelpTab({ tabs, entries, fromTab, onGo, onClose }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  // open on something relevant: the first entry for the tab the user left
  const [selected, setSelected] = useState(
    () => (entries.find((e) => e.tab === fromTab) || entries[0])?.id || null
  );
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const labelFor = useCallback(
    (id) => tabs.find((t) => t.id === id)?.label || id,
    [tabs]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter !== "all" && e.tab !== filter) return false;
      if (!q) return true;
      return `${e.title} ${e.short} ${e.desc}`.toLowerCase().includes(q);
    });
  }, [entries, query, filter]);

  // grouped in fixed tab order; a group with no matches doesn't render
  const groups = useMemo(
    () =>
      tabs
        .map((t) => ({ ...t, items: matches.filter((e) => e.tab === t.id) }))
        .filter((g) => g.items.length),
    [tabs, matches]
  );

  // Selection survives being filtered out — typing should never blank the
  // detail pane. Only fall back when the selected entry is gone entirely.
  const feature = useMemo(
    () => entries.find((e) => e.id === selected) || entries[0] || null,
    [entries, selected]
  );

  const fire = useCallback(() => {
    if (!feature) return;
    if (feature.go) onGo(feature.go);
    else onClose();
  }, [feature, onGo, onClose]);

  // ↑/↓ move through the flattened visible list, enter opens, / searches,
  // esc leaves. This surface gets used mid-session, so it earns shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); fire(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!matches.length) return;
      e.preventDefault();
      const flat = groups.flatMap((g) => g.items);
      const at = flat.findIndex((f) => f.id === selected);
      const next = e.key === "ArrowDown"
        ? (at < 0 ? 0 : Math.min(at + 1, flat.length - 1))
        : (at < 0 ? 0 : Math.max(at - 1, 0));
      setSelected(flat[next].id);
      listRef.current
        ?.querySelector(`[data-hid="${flat[next].id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groups, matches, selected, fire, onClose]);

  return (
    <div className="htab">
      {/* ---- index column ---- */}
      <div className="htab-index">
        <div className="htab-index-head">
          <h2 className="htab-h">what's in here</h2>
          <div className="htab-search">
            <HelpSym name="search" className="htab-search-icon" />
            <input
              ref={searchRef}
              className="htab-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search features — initiative, conditions, hp…"
              aria-label="search features"
            />
            <span className="htab-count">{matches.length} of {entries.length}</span>
          </div>
          <div className="htab-chips">
            <button
              type="button"
              className={`htab-chip${filter === "all" ? " on" : ""}`}
              onClick={() => setFilter("all")}
            >
              all
            </button>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`htab-chip${filter === t.id ? " on" : ""}`}
                onClick={() => setFilter(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="htab-list" ref={listRef}>
          {groups.map((g) => (
            <div key={g.id}>
              <div className="htab-group">{g.label}</div>
              {g.items.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  data-hid={f.id}
                  className={`htab-row${selected === f.id ? " on" : ""}`}
                  onClick={() => setSelected(f.id)}
                >
                  <span className="htab-tile"><HelpSym name={f.sym} className="htab-tile-sym" /></span>
                  <span className="htab-row-main">
                    <span className="htab-row-t">{f.title}</span>
                    <span className="htab-row-s">{f.short}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}

          {!matches.length && (
            <div className="htab-empty">
              <div className="htab-empty-t">nothing matches “{query}”</div>
              <button type="button" className="htab-empty-btn" onClick={() => setQuery("")}>
                clear the search
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---- detail pane ---- */}
      {feature && (
        <div className="htab-detail">
          <div className="htab-eyebrow">
            {feature.tab === "general" ? "the binder" : `${labelFor(feature.tab)} tab`}
          </div>
          <h3 className="htab-title">{feature.title}</h3>
          <p className="htab-desc">{feature.desc}</p>

          <HelpWire
            shape={feature.tab === "general" ? "shell" : feature.tab}
            r={feature.r}
            label={feature.title}
          />

          <div className="htab-actions">
            <button type="button" className="htab-cta" onClick={fire}>
              {feature.go ? `open it in the ${labelFor(feature.tab)} tab →` : "close help →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
