/* ==================================================================== *
 *  GM NOTES WORKSPACE — prep/run document editor (ported from design)
 *
 *  A left rail of pages (each with optional forks), a prep/run mode toggle,
 *  search, and a document of editable blocks (heading, paragraph, read-aloud,
 *  skill check, q&a, links, live note). Text edits mutate a working model and
 *  debounce-save to the per-scenario overlay; structural changes re-render.
 *
 *  Only GmNotes is consumed outside this module.
 * ==================================================================== */
import { useState, useEffect, useRef } from "react";
import { Sym } from "./icons.jsx";
import { gmStamp } from "../lib/gmnotes-util.js";

const gmClone = (x) => JSON.parse(JSON.stringify(x || []));
function gmSeedUid(pages) {
  let max = 0;
  const scan = (s) => {
    const mm = /(\d+)$/.exec(String(s || ""));
    if (mm) max = Math.max(max, +mm[1]);
  };
  (pages || []).forEach((p) => {
    scan(p.id);
    (p.blocks || []).forEach((b) => scan(b.id));
  });
  return max + 1;
}

const GM_BLOCK_TYPES = [
  { type: "heading", label: "section heading" },
  { type: "p", label: "paragraph" },
  { type: "read", label: "read-aloud box" },
  { type: "check", label: "skill check" },
  { type: "qa", label: "q&a table" },
  { type: "links", label: "linked entities" },
];

const GM_NPC = "oklch(0.6 0.13 32)";
const GM_ENC = "oklch(0.6 0.13 250)";
const GM_PAGE = "oklch(0.58 0.12 150)";
const GM_URL = "oklch(0.55 0.13 310)";
const gmLinkColor = (t) =>
  t === "enc" ? GM_ENC : t === "pc" ? "#111" : t === "page" ? GM_PAGE : t === "url" ? GM_URL : GM_NPC;

const gmLiveBadge = {
  fontSize: 10.5, textTransform: "lowercase", letterSpacing: ".04em", color: "#9a6a2e",
  background: "#f2e6d4", padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
};

/* contenteditable that never overwrites itself while focused (cursor-safe) */
function GmEditable({ value, editable, tag = "div", className, style, placeholder, onText, onBlur, onKeyDown, id }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const want = value == null ? "" : value;
    if (document.activeElement !== el && el.textContent !== want) el.textContent = want;
  });
  const Tag = tag;
  return (
    <Tag
      id={id}
      ref={ref}
      contentEditable={editable ? true : undefined}
      suppressContentEditableWarning
      data-ph={placeholder}
      className={className}
      style={style}
      onInput={onText ? (e) => onText(e.currentTarget.textContent) : undefined}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

function GmDots({ n }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, marginRight: 1 }}>
      {[0, 1, 2, 3].map((k) => (
        <span key={k} style={{ width: 6, height: 6, borderRadius: "50%", border: "1.3px solid #111", background: k < n ? "#111" : "transparent", display: "inline-block" }} />
      ))}
    </span>
  );
}

function GmInsertMenu({ onPick }) {
  return (
    <div className="gmn-palette">
      <div className="gmn-palette-label">insert block</div>
      {GM_BLOCK_TYPES.map((b) => (
        <button key={b.type} className="gmn-palette-item" onClick={() => onPick(b.type)}>{b.label}</button>
      ))}
    </div>
  );
}

const GM_LP_FILTERS = [
  { key: "all", label: "all" },
  { key: "npc", label: "npcs" },
  { key: "enc", label: "encounters" },
  { key: "page", label: "pages" },
  { key: "url", label: "url" },
];

/* Concept A · command-bar link picker — keyboard-first search across npcs,
 * encounters, pages/forks, plus an external-url mode. */
function GmLinkPicker({ npcs, encounters, pageEntries, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [url, setUrl] = useState("");
  const [urlLabel, setUrlLabel] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const urlRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => { (filter === "url" ? urlRef : inputRef).current?.focus(); }, [filter]);
  useEffect(() => {
    const onDown = (e) => { if (cardRef.current && !cardRef.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const has = (s) => !!s && s.toLowerCase().includes(q);
  const npcMeta = (n) => [n.role, n.source].filter(Boolean).join(" · ");
  const wantNpc = filter === "all" || filter === "npc";
  const wantEnc = filter === "all" || filter === "enc";
  const wantPage = filter === "all" || filter === "page";

  const people = wantNpc ? npcs.filter((n) => !q || has(n.name) || has(npcMeta(n))).map((n) => ({ type: "npc", refId: n.id, name: n.name, meta: npcMeta(n) })) : [];
  const encs = wantEnc ? encounters.filter((e) => !q || has(e.name)).map((e) => ({ type: "enc", refId: e.id, name: e.name, meta: "" })) : [];
  const pgs = wantPage ? pageEntries.filter((p) => !q || has(p.name) || has(p.meta)).map((p) => ({ type: "page", refId: p.id, name: p.name, meta: p.meta })) : [];
  const groups = [
    { key: "people", label: "people", items: people },
    { key: "encounters", label: "encounters", items: encs },
    { key: "pages", label: "pages & forks", items: pgs },
  ].filter((g) => g.items.length > 0);
  const flat = groups.flatMap((g) => g.items);
  const isUrl = filter === "url";
  const hi = Math.min(highlight, Math.max(0, flat.length - 1));

  const setQ = (v) => { setQuery(v); setHighlight(0); };
  const setF = (k) => { setFilter(k); setHighlight(0); };
  const linkUrl = () => { const u = url.trim(); if (u) onPick({ type: "url", name: urlLabel.trim() || u, url: u }); };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (isUrl) { if (e.key === "Enter") { e.preventDefault(); linkUrl(); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(flat.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[hi]) onPick(flat[hi]); }
  };

  let idx = -1; // running index across visible groups for keyboard highlight
  return (
    <div ref={cardRef} className="gmn-lp" onMouseDown={(e) => e.stopPropagation()}>
      <div className="gmn-lp-search">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="#9a9a95" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="7" r="4.4" /><path d="M10.2 10.2 14 14" /></svg>
        <input ref={inputRef} value={query} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="link to a person, place, page, or url…" />
        <span className="gmn-lp-esc">esc</span>
      </div>
      <div className="gmn-lp-chips">
        {GM_LP_FILTERS.map((f) => (
          <button key={f.key} className={`gmn-lp-chip${filter === f.key ? " active" : ""}`} onClick={() => setF(f.key)}>
            {f.key !== "all" && <span className="gmn-lp-chipdot" style={{ background: gmLinkColor(f.key) }} />}
            {f.label}
          </button>
        ))}
      </div>

      {isUrl ? (
        <div className="gmn-lp-urlwrap">
          <div className="gmn-lp-urllabel">paste an external link</div>
          <div className="gmn-lp-urlrow">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="oklch(0.55 0.13 310)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="5.6" /><path d="M2.6 8h10.8M8 2.4c1.7 1.8 1.7 9.4 0 11.2M8 2.4c-1.7 1.8-1.7 9.4 0 11.2" /></svg>
            <input ref={urlRef} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onKey} placeholder="https://…" />
          </div>
          <div className="gmn-lp-urlrow gmn-lp-urlname">
            <input value={urlLabel} onChange={(e) => setUrlLabel(e.target.value)} onKeyDown={onKey} placeholder="label (optional)" />
          </div>
          <button className="gmn-lp-urlbtn" disabled={!url.trim()} onClick={linkUrl}>link this url</button>
        </div>
      ) : (
        <div className="gmn-lp-list">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="gmn-lp-ghead"><span className="gmn-lp-glabel">{g.label}</span><span className="gmn-lp-gcount">{g.items.length}</span></div>
              {g.items.map((it) => {
                idx++;
                const at = idx;
                return (
                  <button
                    key={it.type + it.refId}
                    className="gmn-lp-row"
                    style={{ background: at === hi ? "#f1f0ec" : "transparent" }}
                    onMouseEnter={() => setHighlight(at)}
                    onClick={() => onPick(it)}
                  >
                    <span className="gmn-lp-dot" style={{ background: gmLinkColor(it.type) }} />
                    <span className="gmn-lp-name">{it.name}</span>
                    {it.meta && <span className="gmn-lp-meta">{it.meta}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div className="gmn-lp-empty">no matches for “{query}”</div>}
        </div>
      )}

      <div className="gmn-lp-foot">
        <span className="gmn-lp-hint"><span className="gmn-lp-key">↑↓</span> move</span>
        <span className="gmn-lp-hint"><span className="gmn-lp-key">↵</span> link</span>
      </div>
    </div>
  );
}

function gmNewBlock(id, type) {
  switch (type) {
    case "heading": return { id, type: "heading", text: "" };
    case "read": return { id, type: "read", text: "" };
    case "check": return { id, type: "check", skill: "", dc: "", secret: true, tiers: [
      { label: "crit success", dotsOn: 4, text: "" },
      { label: "success", dotsOn: 3, text: "" },
      { label: "failure", dotsOn: 2, text: "" },
      { label: "crit failure", dotsOn: 1, text: "" },
    ] };
    case "qa": return { id, type: "qa", qaTitle: "if the players ask…", rows: [{ q: "", a: "" }, { q: "", a: "" }] };
    case "links": return { id, type: "links", items: [] };
    default: return { id, type: "p", text: "" };
  }
}

/* eslint-disable react-hooks/immutability -- GM notes deliberately mutates the
 * working model in place for cursor-stable contenteditable, then forces a
 * re-render with a fresh array ref on structural changes. No React Compiler
 * runs in this build, so this uncontrolled-input pattern is safe. */
export function GmNotes({ initialPages, onPersist, npcs = [], encounters = [], onOpenNpc, onOpenEncounter }) {
  // Working model in state (read during render → lint-safe). Text edits mutate
  // block objects in place WITHOUT setState (no re-render → cursor stays put);
  // structural changes call setPages. `latest` mirrors the model for saves.
  const [pages, setPages] = useState(() => gmClone(initialPages || []));
  const [uidStart] = useState(() => gmSeedUid(initialPages || []));
  const uidRef = useRef(uidStart);
  const latest = useRef(pages);
  const saveTimer = useRef(null);
  const dragFrom = useRef(null);
  const focusComposer = useRef(false);

  const [activeId, setActiveId] = useState(() => (gmClone(initialPages || [])[0]?.id ?? null));
  const [mode, setMode] = useState("prep");
  const [search, setSearch] = useState("");
  const [menuAt, setMenuAt] = useState(null);
  const [composerAt, setComposerAt] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [linkPickerAt, setLinkPickerAt] = useState(null); // block id with the link picker open

  const isPrep = mode === "prep";
  const uid = (pfx = "b") => pfx + uidRef.current++;

  useEffect(() => { latest.current = pages; });

  // next = authoritative pages to persist; immediate flushes now (structural),
  // otherwise debounced (text). Debounced fires use latest.current.
  const save = (next, immediate) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (immediate) {
      saveTimer.current = null;
      latest.current = next;
      onPersist(gmClone(next));
    } else {
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        onPersist(gmClone(latest.current));
      }, 500);
    }
  };

  // Flush any pending save when unmounting (scenario switch / leaving the tab).
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        onPersist(gmClone(latest.current));
      }
    },
    [onPersist]
  );

  // Also flush the pending text-edit debounce before the page is backgrounded
  // or closed — unmount doesn't fire on iOS tab-away, so without this the last
  // in-progress note edit can be lost. Mirrors the overlay-level flush.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        onPersist(gmClone(latest.current));
      }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onPersist]);

  // Focus the live-note composer when it opens.
  useEffect(() => {
    if (composerAt !== null && focusComposer.current) {
      const el = document.getElementById("gm-live-composer");
      if (el) el.focus();
      focusComposer.current = false;
    }
  }, [composerAt]);

  const mains = pages.filter((p) => p.group !== "fork");
  const active = pages.find((p) => p.id === activeId) || pages[0] || null;

  const goPage = (pid) => { setActiveId(pid); setMenuAt(null); setComposerAt(null); setLinkPickerAt(null); setSearch(""); };
  const openMenu = (i) => { setComposerAt(null); setLinkPickerAt(null); setMenuAt((cur) => (cur === i ? null : i)); };
  const startNote = (i) => { focusComposer.current = true; setMenuAt(null); setComposerAt(i); };

  // mutate active.blocks in place, then re-render with a fresh array ref
  const commitStructural = (immediate = true) => {
    const next = [...pages];
    setPages(next);
    save(next, immediate);
  };
  const insertBlock = (i, type) => {
    const nb = gmNewBlock(uid(), type);
    active.blocks.splice(i, 0, nb);
    setMenuAt(null);
    commitStructural();
    if (type === "links") setLinkPickerAt(nb.id); // open the picker on a fresh links block
  };
  const removeBlock = (block) => { active.blocks = active.blocks.filter((b) => b !== block); commitStructural(); };

  // link picker: append / remove items on a links block (store the canonical shape)
  const addLink = (block, item) => {
    const clean = item.type === "url"
      ? { type: "url", name: item.name, url: item.url }
      : { type: item.type, name: item.name, refId: item.refId };
    block.items.push(clean);
    setLinkPickerAt(null);
    commitStructural();
  };
  const removeLink = (block, li) => { block.items.splice(li, 1); commitStructural(); };

  // navigate a chip to its target (npc sheet, encounter, page/fork, or url)
  const navigateLink = (it) => {
    if (it.type === "url") { if (it.url) window.open(it.url, "_blank", "noopener,noreferrer"); return; }
    if (it.type === "page") { if (pages.some((p) => p.id === it.refId)) goPage(it.refId); return; }
    if (it.type === "npc") { onOpenNpc && onOpenNpc(it.refId); return; }
    if (it.type === "enc") { onOpenEncounter && onOpenEncounter(it.refId); return; }
  };

  // targets for the picker: other pages/forks in this notes tab
  const pageEntries = pages
    .filter((p) => p.id !== (active && active.id))
    .map((p) =>
      p.group === "fork"
        ? { id: p.id, name: p.title, meta: "fork · " + (pages.find((x) => x.id === p.parentId)?.title || "") }
        : { id: p.id, name: p.title, meta: "page " + (mains.findIndex((m) => m.id === p.id) + 1) }
    );

  // a link is "dangling" when its target no longer exists (urls never dangle)
  const npcIdSet = new Set(npcs.map((n) => n.id));
  const encIdSet = new Set(encounters.map((e) => e.id));
  const pageIdSet = new Set(pages.map((p) => p.id));
  const linkDangling = (it) =>
    it.type === "npc" ? !npcIdSet.has(it.refId)
    : it.type === "enc" ? !encIdSet.has(it.refId)
    : it.type === "page" ? !pageIdSet.has(it.refId)
    : it.type === "url" ? !it.url
    : false;
  const commitNote = (i, text) => {
    const t = (text || "").trim();
    if (t) active.blocks.splice(i, 0, { id: uid(), type: "note", text: t, stamp: gmStamp() });
    setComposerAt(null);
    if (t) commitStructural();
  };
  const onNoteKey = (e, i) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitNote(i, e.currentTarget.textContent); }
    else if (e.key === "Escape") { e.preventDefault(); setComposerAt(null); }
  };

  const addPage = () => {
    const pid = uid("page");
    const next = [...pages, { id: pid, title: "new page", group: "main", blocks: [] }];
    setPages(next);
    setActiveId(pid); setMode("prep"); setMenuAt(null); setComposerAt(null); setSearch("");
    save(next, true);
  };
  const addFork = (pageId) => {
    const fid = uid("fork");
    let j = pages.findIndex((p) => p.id === pageId) + 1;
    while (j < pages.length && pages[j].group === "fork" && pages[j].parentId === pageId) j++;
    const next = [...pages];
    next.splice(j, 0, { id: fid, title: "new fork", group: "fork", parentId: pageId, blocks: [] });
    setPages(next);
    setActiveId(fid); setMode("prep"); setMenuAt(null); setComposerAt(null); setSearch("");
    save(next, true);
  };
  const deletePage = (pid) => {
    const pg = pages.find((p) => p.id === pid);
    if (!pg) return;
    const removeIds = [pid];
    if (pg.group !== "fork") pages.filter((p) => p.parentId === pid).forEach((f) => removeIds.push(f.id));
    const next = pages.filter((p) => removeIds.indexOf(p.id) === -1);
    setPages(next);
    let nid = activeId;
    if (removeIds.indexOf(nid) !== -1) nid = next[0]?.id ?? null;
    setActiveId(nid); setMenuAt(null); setComposerAt(null);
    save(next, true);
  };

  const onDragOver = (e) => { if (e) e.preventDefault(); };
  const onDragEnd = () => { dragFrom.current = null; setDragOver(null); };
  const startDrag = (i) => { dragFrom.current = i; };
  const dragEnter = (i) => { if (dragFrom.current == null || dragOver === i) return; setDragOver(i); };
  const drop = (i) => {
    const from = dragFrom.current;
    if (from != null && to_ok(from, i, mains.length) && from !== i) {
      const reordered = [...mains];
      const moved = reordered.splice(from, 1)[0];
      reordered.splice(i, 0, moved);
      const next = [];
      reordered.forEach((mn) => {
        next.push(mn);
        pages.filter((p) => p.group === "fork" && p.parentId === mn.id).forEach((f) => next.push(f));
      });
      setPages(next);
      save(next, true);
    }
    dragFrom.current = null;
    setDragOver(null);
  };

  // search across pages/blocks
  const q = search.trim().toLowerCase();
  const results = [];
  if (q) {
    const push = (page, kind, text) => {
      if (text && text.toLowerCase().includes(q)) {
        results.push({ page: page.title, kind, snippet: text.length > 90 ? text.slice(0, 90) + "…" : text, id: page.id });
      }
    };
    pages.forEach((page) => {
      (page.blocks || []).forEach((b) => {
        if (b.text) push(page, b.type === "read" ? "read-aloud" : b.type === "note" ? "live note" : "note", b.text);
        if (b.type === "check") { push(page, "check", b.skill); b.tiers.forEach((t) => push(page, "check · " + t.label, t.text)); }
        if (b.type === "qa") { push(page, "q&a", b.qaTitle); b.rows.forEach((r) => { push(page, "q&a", r.q); push(page, "q&a", r.a); }); }
      });
    });
  }
  const shown = results.slice(0, 8);

  const parent = active && active.group === "fork" ? pages.find((x) => x.id === active.parentId) : null;
  const crumb = !active
    ? ""
    : active.group === "fork"
    ? (parent ? `${parent.title} → ${active.title}` : `fork → ${active.title}`)
    : `running order · page ${mains.findIndex((x) => x.id === active.id) + 1} of ${mains.length}`;

  const renderZone = (index) => {
    if (isPrep) {
      return (
        <div style={{ position: "relative" }}>
          <div className="gmn-insert" onClick={() => openMenu(index)}>
            <span className="gmn-insert-plus">+</span>
            <span className="gmn-insert-line" />
            {index === 0 && <span className="gmn-insert-label">insert block</span>}
          </div>
          {menuAt === index && <GmInsertMenu onPick={(t) => insertBlock(index, t)} />}
        </div>
      );
    }
    return (
      <div style={{ position: "relative" }}>
        <div className="gmn-notezone" onClick={() => startNote(index)}>＋ live note</div>
        {composerAt === index && (
          <div className="gmn-composer">
            <span style={gmLiveBadge}>live note</span>
            <div id="gm-live-composer" contentEditable suppressContentEditableWarning onKeyDown={(e) => onNoteKey(e, index)} data-ph="type a live note — enter to save, esc to cancel" style={{ flex: 1, fontSize: 13.5, color: "#3a3a38", lineHeight: 1.5, minHeight: 20 }} />
          </div>
        )}
      </div>
    );
  };

  const renderBlock = (b) => {
    const editable = isPrep || b.type === "note";
    const onText = (text) => { b.text = text; save(pages, false); };
    switch (b.type) {
      case "heading":
        return <GmEditable tag="h3" className="gmn-h" editable={editable} placeholder="section heading" value={b.text} onText={onText} />;
      case "p":
        return <GmEditable tag="p" className="gmn-p" editable={editable} placeholder="write a note…" value={b.text} onText={onText} />;
      case "read":
        return (
          <div className="gmn-read">
            <span className="gmn-read-tag">read aloud</span>
            <GmEditable className="gmn-read-body" editable={editable} placeholder="text to read aloud…" value={b.text} onText={onText} />
          </div>
        );
      case "check": {
        const secret = b.secret !== false;
        return (
          <div className="gmn-card">
            <div className="gmn-card-head">
              <Sym name="combat" className="gmn-card-ico" />
              <GmEditable tag="span" className="gmn-card-title" editable={editable} placeholder="skill — what they're rolling" value={b.skill} onText={(t) => { b.skill = t; save(pages, false); }} />
              <span className="gmn-dc">dc <GmEditable tag="span" editable={editable} placeholder="0" value={b.dc} onText={(t) => { b.dc = t; save(pages, false); }} style={{ minWidth: 14, display: "inline-block" }} /></span>
              <button
                className={`gmn-secret-toggle${secret ? "" : " open"}`}
                title="click to toggle secret / open"
                onClick={(e) => { e.stopPropagation(); b.secret = !secret; commitStructural(); }}
              >
                {secret ? "secret" : "open"}
              </button>
            </div>
            <dl style={{ margin: 0 }}>
              {b.tiers.map((t, ti) => (
                <div className="gmn-tier" key={ti}>
                  <dt><GmDots n={t.dotsOn} />{t.label}</dt>
                  <GmEditable tag="dd" editable={editable} placeholder="what happens…" value={t.text} onText={(x) => { t.text = x; save(pages, false); }} />
                </div>
              ))}
            </dl>
          </div>
        );
      }
      case "qa":
        return (
          <div className="gmn-card">
            <div className="gmn-card-head">
              <Sym name="overview" className="gmn-card-ico" />
              <GmEditable tag="span" className="gmn-card-title" editable={editable} placeholder="if the players ask…" value={b.qaTitle} onText={(t) => { b.qaTitle = t; save(pages, false); }} />
            </div>
            <dl style={{ margin: 0 }}>
              {b.rows.map((row, ri) => (
                <div className="gmn-qarow" key={ri}>
                  <GmEditable tag="dt" editable={editable} placeholder="the question…" value={row.q} onText={(x) => { row.q = x; save(pages, false); }} />
                  <GmEditable tag="dd" editable={editable} placeholder="your answer / what to reveal…" value={row.a} onText={(x) => { row.a = x; save(pages, false); }} />
                  {isPrep && b.rows.length > 1 && (
                    <button className="gmn-qarow-del" title="remove row" onClick={(e) => { e.stopPropagation(); b.rows.splice(ri, 1); commitStructural(); }}>✕</button>
                  )}
                </div>
              ))}
            </dl>
            {isPrep && (
              <button
                className="gmn-qa-add"
                onClick={(e) => {
                  e.stopPropagation();
                  const dl = e.currentTarget.previousElementSibling;
                  b.rows.push({ q: "", a: "" });
                  commitStructural();
                  // drop the cursor into the new question once it has rendered
                  requestAnimationFrame(() => dl.lastElementChild?.querySelector("dt")?.focus());
                }}
              >
                + add row
              </button>
            )}
          </div>
        );
      case "links":
        return (
          <div className="gmn-links">
            <div className="gmn-links-label">linked to this page</div>
            <div className="gmn-links-row">
              {b.items.map((it, li) => {
                const dangling = linkDangling(it);
                const kind = it.type === "enc" ? "encounter" : it.type === "page" ? "page" : "npc";
                return (
                  <span
                    className={`gmn-chip gmn-chip-link${dangling ? " dangling" : ""}`}
                    key={li}
                    title={dangling ? `${kind} no longer exists` : it.type === "url" ? it.url : `open ${kind}`}
                    onClick={() => { if (!dangling) navigateLink(it); }}
                  >
                    <span className="gmn-chip-dot" style={{ background: gmLinkColor(it.type) }} />
                    {it.name}
                    {it.type === "url" && !dangling && <span className="gmn-chip-ext" aria-hidden="true">↗</span>}
                    {isPrep && <button className="gmn-chipdel" title="remove link" onClick={(e) => { e.stopPropagation(); removeLink(b, li); }}>✕</button>}
                  </span>
                );
              })}
              {b.items.length === 0 && !isPrep && <span className="gmn-links-empty">no links</span>}
            </div>
            {isPrep && (
              <div style={{ position: "relative", marginTop: 9 }}>
                <button className="gmn-addlink" onMouseDown={(e) => e.stopPropagation()} onClick={() => setLinkPickerAt((cur) => (cur === b.id ? null : b.id))}>+ add link</button>
                {linkPickerAt === b.id && (
                  <GmLinkPicker
                    npcs={npcs}
                    encounters={encounters}
                    pageEntries={pageEntries}
                    onPick={(item) => addLink(b, item)}
                    onClose={() => setLinkPickerAt(null)}
                  />
                )}
              </div>
            )}
          </div>
        );
      case "note":
        return (
          <div className="gmn-note">
            <span style={gmLiveBadge}>live note</span>
            <GmEditable className="gmn-note-body" editable value={b.text} onText={onText} />
            {b.stamp && <span className="gmn-note-stamp">{b.stamp}</span>}
            <button className="gmn-notedel" title="delete note" onClick={() => removeBlock(b)}>✕</button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <nav className="gmn-rail">
        <div className="gmn-railsc">
          <div style={{ marginBottom: 14 }}>
            <div className="gmn-rail-head">
              <span>pages</span>
              {mains.length > 1 && <span style={{ color: "#c2c1ba" }}>drag to reorder</span>}
            </div>
            {mains.map((mn, mi) => {
              const act = mn.id === activeId;
              return (
                <div
                  key={mn.id}
                  draggable
                  onDragStart={() => startDrag(mi)}
                  onDragEnter={() => dragEnter(mi)}
                  onDragOver={onDragOver}
                  onDrop={() => drop(mi)}
                  onDragEnd={onDragEnd}
                  style={{ position: "relative" }}
                >
                  {dragOver === mi && <div className="gmn-dropline" />}
                  <div className={`gmn-row${act ? " active" : ""}`} onClick={() => goPage(mn.id)}>
                    <Sym name="gmnotes" className="gmn-row-ico" />
                    <span className="gmn-row-title">{mn.title}</span>
                    <button className="gmn-ctrl" title="add a sub-fork" onClick={(e) => { e.stopPropagation(); addFork(mn.id); }}>+</button>
                    <button className="gmn-ctrl del" title="delete page" onClick={(e) => { e.stopPropagation(); deletePage(mn.id); }}>✕</button>
                  </div>
                  {pages.filter((x) => x.group === "fork" && x.parentId === mn.id).map((f) => {
                    const fa = f.id === activeId;
                    return (
                      <div key={f.id} className="gmn-fork-wrap">
                        <div className={`gmn-fork${fa ? " active" : ""}`} onClick={() => goPage(f.id)}>
                          <span className="gmn-fork-arrow">→</span>
                          <span className="gmn-row-title">{f.title}</span>
                          <button className="gmn-ctrl del" title="delete fork" onClick={(e) => { e.stopPropagation(); deletePage(f.id); }}>✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <button className="gmn-addpage" onClick={addPage}>
            <span style={{ width: 18, textAlign: "center", fontSize: 17 }}>+</span>
            <span>add page</span>
          </button>
        </div>
      </nav>

      <main className="gmn-main">
        <div className="gmn-panel">
          <div className="gmn-topbar">
            <div className="gmn-seg">
              <span className={`gmn-seg-opt${isPrep ? " on" : ""}`} onClick={() => { setMode("prep"); setComposerAt(null); }}>prep</span>
              <span className={`gmn-seg-opt${!isPrep ? " on" : ""}`} onClick={() => { setMode("run"); setMenuAt(null); setLinkPickerAt(null); }}>run</span>
            </div>
            <span className="gmn-modehint">{isPrep ? "add or edit blocks" : "click anywhere to add a note"}</span>
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <div className="gmn-searchbox">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#9a9a95" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="7" r="4.4" /><path d="M10.2 10.2 14 14" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search…" />
              </div>
              {shown.length > 0 && (
                <div className="gmn-results">
                  <div className="gmn-results-label">{results.length} match{results.length === 1 ? "" : "es"}</div>
                  {shown.map((res, ri) => (
                    <button key={ri} className="gmn-result" onClick={() => goPage(res.id)}>
                      <div className="gmn-result-meta">{res.page} · {res.kind}</div>
                      <div className="gmn-result-snip">{res.snippet}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="gmn-doc">
            {!active ? (
              <div className="gmn-blank">no pages yet</div>
            ) : (
              <div key={`${active.id}:${mode}`}>
                <div className="gmn-crumb">{crumb}</div>
                <GmEditable
                  tag="h2"
                  className="gmn-pagetitle"
                  editable={isPrep}
                  placeholder="page title"
                  value={active.title}
                  onText={(t) => { active.title = t; save(pages, false); }}
                  onBlur={() => setPages((p) => [...p])}
                />
                {renderZone(0)}
                {active.blocks.map((b, i) => (
                  <div key={b.id} style={{ position: "relative" }}>
                    <div onClick={!isPrep && b.type !== "note" ? () => startNote(i + 1) : undefined} style={{ position: "relative", cursor: !isPrep ? "text" : "default" }}>
                      {renderBlock(b)}
                    </div>
                    {isPrep && b.type !== "note" && (
                      <button className="gmn-blockdel" title="delete block" onClick={() => removeBlock(b)}>✕</button>
                    )}
                    {renderZone(i + 1)}
                  </div>
                ))}
                {active.blocks.length === 0 && (
                  <div className="gmn-blank">use the + above to insert a block</div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
/* eslint-enable react-hooks/immutability */

function to_ok(from, to, len) {
  return from >= 0 && from < len && to >= 0 && to < len;
}
