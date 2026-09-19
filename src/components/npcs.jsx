/* ==================================================================== *
 *  NPC components
 *
 *  The "add NPC" modal (quick name+description or a full stat block) and the
 *  NPC sheet renderer, whose description / role text is click-to-edit. Parse
 *  helpers below normalize the free-text full form into structured fields.
 * ==================================================================== */
import { useState, useRef, useEffect } from "react";
import { sign, ABILITIES } from "../lib/pf2e.js";
import { Sym } from "./icons.jsx";
import { Stat, NotesBox } from "./party.jsx";

/* parse helpers for the full-npc form */
const npcNum = (s) => {
  const t = (s || "").trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
};
const npcList = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const npcLines = (s) => (s || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
const npcSkills = (s) =>
  npcList(s).map((item) => {
    const m = item.match(/^(.*?)\s*([+-]\d+)\s*$/);
    return m ? [m[1].trim(), parseInt(m[2], 10)] : [item, 0];
  });

const NPC_ABILS = ABILITIES.map(([k]) => k);

/* add NPC: two modes — quick (name + description) or full stat block */
export function AddNpc({ onAdd, onClose }) {
  const [mode, setMode] = useState("quick");
  const [f, setF] = useState({
    name: "", ancestry: "", source: "", description: "", tactics: "",
    level: "", ac: "", hp: "", perception: "", fort: "", ref: "", will: "",
    traits: "", skills: "", speed: "", languages: "", strikes: "", spells: "",
    str: "", dex: "", con: "", int: "", wis: "", cha: "",
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.name.trim();

  const submit = () => {
    if (!valid) return;
    if (mode === "quick") {
      onAdd({ name: f.name.trim(), ancestry: f.ancestry.trim(), description: f.description.trim() });
    } else {
      const traits = npcList(f.traits);
      const ancestry = f.ancestry.trim();
      if (ancestry && !traits.some((t) => t.toLowerCase() === ancestry.toLowerCase())) traits.unshift(ancestry);
      const anyAb = NPC_ABILS.some((k) => f[k].trim());
      onAdd({
        name: f.name.trim(),
        ancestry,
        traits,
        source: f.source.trim(),
        description: f.description.trim(),
        notes: f.tactics.trim(),
        level: npcNum(f.level),
        ac: npcNum(f.ac), hp: npcNum(f.hp), perception: npcNum(f.perception),
        fort: npcNum(f.fort), ref: npcNum(f.ref), will: npcNum(f.will),
        abilities: anyAb ? Object.fromEntries(NPC_ABILS.map((k) => [k, npcNum(f[k]) ?? 0])) : null,
        skills: npcSkills(f.skills),
        speed: f.speed.trim(),
        languages: npcList(f.languages),
        attacks: npcLines(f.strikes),
        spells: npcLines(f.spells),
      });
    }
    onClose();
  };

  const tabStyle = { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "9px 14px", borderRadius: 9 };
  const groupHead = { fontSize: 10.5, letterSpacing: ".04em", textTransform: "lowercase", color: "var(--faint)", margin: "2px 0 9px" };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 580, maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        {/* head + mode toggle */}
        <div style={{ padding: "22px 24px 14px" }}>
          <div className="modal-head" style={{ marginBottom: 14 }}>
            <h3 className="modal-title" style={{ flex: 1 }}>add npc</h3>
            <button className="modal-x" onClick={onClose} aria-label="close">×</button>
          </div>
          <div className="toggle" style={{ borderRadius: 13, padding: 5, gap: 5 }}>
            <button className={`toggle-opt${mode === "quick" ? " on" : ""}`} style={tabStyle} onClick={() => setMode("quick")}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>name + description</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--faint)" }}>quick npc</span>
            </button>
            <button className={`toggle-opt${mode === "full" ? " on" : ""}`} style={tabStyle} onClick={() => setMode("full")}>
              <span style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "var(--accent)" }}>✦</span>full details</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--faint)" }}>full npc</span>
            </button>
          </div>
        </div>

        {/* body */}
        <div style={{ overflowY: "auto", padding: "6px 24px 10px", flex: 1 }}>
          {mode === "quick" ? (
            <>
              <div className="form-grid name-row">
                <label className="field"><span>name <i>*</i></span><input className="inp" value={f.name} onChange={set("name")} placeholder="e.g. themolin" autoFocus /></label>
                <label className="field"><span>ancestry</span><input className="inp" value={f.ancestry} onChange={set("ancestry")} placeholder="e.g. human" /></label>
              </div>
              <label className="field span2" style={{ marginTop: 14 }}><span>description</span><textarea className="inp area" rows={4} value={f.description} onChange={set("description")} placeholder="who they are, what the party knows…" /></label>
            </>
          ) : (
            <>
              <div className="form-grid name-row">
                <label className="field"><span>name <i>*</i></span><input className="inp" value={f.name} onChange={set("name")} autoFocus /></label>
                <label className="field"><span>creature lvl</span><input className="inp" type="number" value={f.level} onChange={set("level")} placeholder="3" /></label>
              </div>
              <div className="form-grid name-row" style={{ marginTop: 12 }}>
                <label className="field"><span>ancestry</span><input className="inp" value={f.ancestry} onChange={set("ancestry")} placeholder="human" /></label>
                <label className="field"><span>source</span><input className="inp" value={f.source} onChange={set("source")} placeholder="appendix p.21" /></label>
              </div>
              <label className="field span2" style={{ marginTop: 12 }}><span>traits</span><input className="inp" value={f.traits} onChange={set("traits")} placeholder="unique, le, medium, human, humanoid" /></label>
              <label className="field span2" style={{ marginTop: 12 }}><span>description</span><textarea className="inp area" rows={3} value={f.description} onChange={set("description")} placeholder="who they are, what the party knows…" /></label>
              <label className="field span2" style={{ marginTop: 12 }}><span>role / tactics</span><textarea className="inp area" rows={2} value={f.tactics} onChange={set("tactics")} placeholder="how they behave in a scene or fight…" /></label>

              <div style={{ ...groupHead, marginTop: 18 }}>combat stats</div>
              <div className="form-grid three">
                <label className="field"><span>armor class</span><input className="inp" value={f.ac} onChange={set("ac")} placeholder="17" /></label>
                <label className="field"><span>hit points</span><input className="inp" value={f.hp} onChange={set("hp")} placeholder="31" /></label>
                <label className="field"><span>perception</span><input className="inp" value={f.perception} onChange={set("perception")} placeholder="+7" /></label>
              </div>

              <div style={{ ...groupHead, marginTop: 16 }}>saving throws</div>
              <div className="form-grid three">
                <label className="field"><span>fortitude</span><input className="inp" value={f.fort} onChange={set("fort")} placeholder="+8" /></label>
                <label className="field"><span>reflex</span><input className="inp" value={f.ref} onChange={set("ref")} placeholder="+9" /></label>
                <label className="field"><span>will</span><input className="inp" value={f.will} onChange={set("will")} placeholder="+10" /></label>
              </div>

              <div style={{ ...groupHead, marginTop: 16 }}>ability modifiers</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 7 }}>
                {NPC_ABILS.map((k) => (
                  <label className="field" key={k} style={{ alignItems: "center", gap: 4 }}>
                    <span style={{ textTransform: "uppercase" }}>{k}</span>
                    <input className="inp" value={f[k]} onChange={set(k)} placeholder="+0" style={{ textAlign: "center", padding: "8px 4px" }} />
                  </label>
                ))}
              </div>

              <label className="field span2" style={{ marginTop: 16 }}><span>skills</span><input className="inp" value={f.skills} onChange={set("skills")} placeholder="arcana +11, society +9, stealth +7" /></label>
              <div className="form-grid name-row" style={{ marginTop: 12 }}>
                <label className="field"><span>speed</span><input className="inp" value={f.speed} onChange={set("speed")} placeholder="25 feet" /></label>
                <label className="field"><span>languages</span><input className="inp" value={f.languages} onChange={set("languages")} placeholder="common, jotun, varisian" /></label>
              </div>
              <label className="field span2" style={{ marginTop: 12 }}><span>strikes</span><textarea className="inp area" rows={2} value={f.strikes} onChange={set("strikes")} placeholder="melee — staff +7 (1d4 B); ranged — crossbow +7 (1d8 P)" /></label>
              <label className="field span2" style={{ marginTop: 12 }}><span>spells &amp; reactions</span><textarea className="inp area" rows={3} value={f.spells} onChange={set("spells")} placeholder="arcane prepared DC 20, attack +12; counterspell reaction…" /></label>
            </>
          )}
        </div>

        {/* footer */}
        <div className="modal-foot" style={{ margin: 0, padding: "16px 24px 18px", borderTop: "1px solid var(--hush)" }}>
          <button className="mini" onClick={onClose}>cancel</button>
          <button className="btn" disabled={!valid} onClick={submit}>add npc</button>
        </div>
      </div>
    </div>
  );
}

/* click-to-edit paragraph: reads as plain text, becomes an auto-growing
 * textarea in place. blur or ⌘/ctrl+enter saves, esc cancels. */
function EditableText({ value, onCommit, className, placeholder, ariaLabel }) {
  const [draft, setDraft] = useState(null); // null = not editing
  const ref = useRef(null);
  const skipBlur = useRef(false);
  const editing = draft != null;

  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  });
  useEffect(() => {
    const el = ref.current;
    if (editing && el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [editing]);

  const start = () => { skipBlur.current = false; setDraft(value || ""); };
  const commit = () => {
    if (draft == null) return;
    const t = draft.trim();
    if (t !== (value || "")) onCommit(t);
    setDraft(null);
  };
  const cancel = () => { skipBlur.current = true; setDraft(null); };

  if (!editing) {
    return (
      <p
        className={`${className} npc-edit${value ? "" : " empty"}`}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        title="click to edit"
        onClick={start}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } }}
      >
        {value || placeholder}
      </p>
    );
  }
  return (
    <textarea
      ref={ref}
      className={`${className} npc-edit npc-edit-area`}
      rows={1}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (skipBlur.current) skipBlur.current = false; else commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      }}
    />
  );
}

export function NpcSheet({ npc, note, onNote, onEditText, onResetText, onRemove }) {
  const v = (x) => (x == null ? "?" : x);
  const sv = (x) => (x == null ? "?" : sign(x));
  const eyebrow = [npc.role, npc.source].filter(Boolean).join(" · ");
  const hasStats = npc.ac != null || npc.hp != null || npc.perception != null;
  return (
    <article className="article">
      <div className="pc-head">
        <Sym name="party" className="article-sym" />
        <div className="pc-head-main">
          {eyebrow && <div className="article-eyebrow">{eyebrow}</div>}
          <h2 className="article-title">{npc.name}</h2>
          <div className="pc-sub">{npc.level != null ? `creature ${npc.level}` : "npc · no combat block"}</div>
        </div>
        <div className="pc-head-right">
          <NotesBox value={note} onChange={onNote} />
          {(onResetText || onRemove) && (
            <div className="pc-actions">
              {onResetText && <button className="mini" onClick={onResetText} title="restore the scenario's original description and role">reset text</button>}
              {onRemove && <button className="mini danger" onClick={onRemove}>remove</button>}
            </div>
          )}
        </div>
      </div>

      {npc.traits && npc.traits.length > 0 && (
        <div className="chips npc-traits">{npc.traits.map((t) => <span key={t} className="chip ghost">{t}</span>)}</div>
      )}

      {onEditText ? (
        <>
          <EditableText key={`${npc.id}:description`} className="npc-desc" value={npc.description} onCommit={(t) => onEditText("description", t)} placeholder="add a description…" ariaLabel="description" />
          <h3 className="sheet-h">role</h3>
          <EditableText key={`${npc.id}:notes`} className="sec-p" value={npc.notes} onCommit={(t) => onEditText("notes", t)} placeholder="add role / tactics…" ariaLabel="role" />
        </>
      ) : (
        <>
          {npc.description && <p className="npc-desc">{npc.description}</p>}
          {npc.notes && (
            <>
              <h3 className="sheet-h">role</h3>
              <p className="sec-p">{npc.notes}</p>
            </>
          )}
        </>
      )}

      {hasStats && (
        <div className="stat-grid">
          <Stat label="armor class" value={v(npc.ac)} />
          <Stat label="hit points" value={v(npc.hp)} />
          <Stat label="perception" value={sv(npc.perception)} />
        </div>
      )}

      <h3 className="sheet-h">saving throws</h3>
      <div className="row-list">
        {[["fortitude", npc.fort], ["reflex", npc.ref], ["will", npc.will]].map(([k, val]) => (
          <div className="line" key={k}>
            <span className="line-name">{k}</span>
            <span className="line-val">{sv(val)}</span>
          </div>
        ))}
      </div>

      {npc.abilities && (
        <>
          <h3 className="sheet-h">abilities</h3>
          <div className="ability-grid">
            {ABILITIES.map(([k]) => (
              <div className="ability" key={k}>
                <div className="ability-mod">{sign(npc.abilities[k])}</div>
                <div className="ability-name">{k}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {npc.skills && (
        <>
          <h3 className="sheet-h">skills</h3>
          <div className="row-list">
            {npc.skills.map(([name, mod]) => (
              <div className="line" key={name}><span className="line-name">{name}</span><span className="line-val">{sign(mod)}</span></div>
            ))}
          </div>
        </>
      )}

      {(npc.speed || npc.languages) && (
        <>
          <h3 className="sheet-h">details</h3>
          <dl className="kv">
            {npc.speed && <div><dt>speed</dt><dd>{npc.speed}</dd></div>}
            {npc.languages && <div><dt>languages</dt><dd>{npc.languages.join(", ")}{npc.langNote ? `; ${npc.langNote}` : ""}</dd></div>}
          </dl>
        </>
      )}

      {npc.attacks && (
        <>
          <h3 className="sheet-h">strikes</h3>
          <ul className="npc-lines">{npc.attacks.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </>
      )}
      {npc.spells && (
        <>
          <h3 className="sheet-h">spells</h3>
          <ul className="npc-lines">{npc.spells.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </>
      )}
      {npc.special && (
        <>
          <h3 className="sheet-h">abilities & reactions</h3>
          <ul className="npc-lines">{npc.special.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </>
      )}
    </article>
  );
}
