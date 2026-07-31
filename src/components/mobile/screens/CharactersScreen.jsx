/* Characters tab — searchable roster of the party (PCs) and key NPCs. */
import { useState, useMemo } from "react";
import { IconChevDown, IconSearch } from "../parts/MobileIcons.jsx";
import { characterRow } from "../parts/characterModel.js";

const FILTERS = [
  { id: "all", label: "all" },
  { id: "npcs", label: "npcs" },
  { id: "party", label: "party" },
];

function Row({ r, onOpen }) {
  return (
    <button className={`m-cast-row${r.tucked ? " tucked" : ""}`} style={{ borderLeftColor: r.accent }} onClick={() => onOpen(r.kind, r.id)}>
      <span className="m-cast-tile" style={{ color: r.accent }}>{r.initials}</span>
      <span className="m-cast-main">
        <span className="m-cast-name">{r.name}</span>
        <span className="m-cast-sub">{r.sub}</span>
      </span>
      <span className="m-cast-stats">{r.ac != null ? `ac ${r.ac}` : ""}{r.ac != null && r.hp != null ? " · " : ""}{r.hp != null ? `hp ${r.hp}` : ""}</span>
      <span className="m-cast-chev"><IconChevDown size={15} /></span>
    </button>
  );
}

export function CharactersScreen({ pcs, npcs, companions, onOpen }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  // Each PC is followed by its own companions, tucked under it.
  const partyRows = useMemo(
    () =>
      pcs.flatMap((p) => [
        characterRow("pc", p),
        ...(companions || []).filter((c) => c.owner.id === p.id).map((c) => characterRow("companion", c)),
      ]),
    [pcs, companions]
  );
  const npcRows = useMemo(() => npcs.map((n) => characterRow("npc", n)), [npcs]);

  const ql = q.trim().toLowerCase();
  const match = (r) => !ql || r.name.toLowerCase().includes(ql) || r.sub.toLowerCase().includes(ql);
  const showNpcs = filter !== "party";
  const showParty = filter !== "npcs";
  const npcsF = npcRows.filter(match);
  const partyF = partyRows.filter(match);

  return (
    <div className="m-screen m-characters">
      <header className="m-header">
        <h1 className="m-title">characters</h1>
        <div className="m-search">
          <IconSearch size={16} />
          <input className="m-search-inp" placeholder="search name, trait, ancestry…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="m-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={`m-filter ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </header>

      <div className="m-body">
        {showNpcs && npcsF.length > 0 && (
          <>
            <div className="m-section-label">key npcs</div>
            {npcsF.map((r) => <Row key={r.id} r={r} onOpen={onOpen} />)}
          </>
        )}
        {showParty && partyF.length > 0 && (
          <>
            <div className="m-section-label">the party</div>
            {partyF.map((r) => <Row key={r.id} r={r} onOpen={onOpen} />)}
          </>
        )}
        {(showNpcs ? npcsF.length : 0) + (showParty ? partyF.length : 0) === 0 && (
          <div className="m-empty">
            {pcs.length + npcs.length === 0
              ? "no characters yet — import party members or add npcs in the desktop binder."
              : "no matches."}
          </div>
        )}
      </div>
    </div>
  );
}
