/* ==================================================================== *
 *  Icons + visual marks
 *
 *  Inline SVG glyph sets (workspace nav, scenario section symbols, in-content
 *  pictograms) plus the severity meter and call-out/tier marks. Bold geometric
 *  marks in one visual weight — the binder's primary visual language.
 * ==================================================================== */

/* ----------------------------- icons ------------------------------- */
export function Sym({ name, className }) {
  const p = { viewBox: "0 0 40 40", className, "aria-hidden": true };
  switch (name) {
    case "party":
      return (
        <svg {...p}>
          <circle cx="14" cy="14" r="6" />
          <circle cx="27" cy="17" r="4.6" />
          <path d="M4 34c0-6 4.6-9.5 10-9.5S24 28 24 34z" />
          <path d="M23 34c.4-4.6 3.4-7.4 7.2-7.4 3.6 0 6.3 2.6 6.8 7.4z" />
        </svg>
      );
    case "scenario":
      return (
        <svg {...p}>
          <path d="M19 11C13.5 8.2 8 8.2 4 10.4v18.4c4-2.2 9.5-2.2 15 .6z" />
          <path d="M21 11c5.5-2.8 11-2.8 15-.6v18.4c-4-2.2-9.5-2.2-15 .6z" />
        </svg>
      );
    case "overview":
      return (
        <svg {...p}>
          <path d="M20 2.5l4.6 12.9L37.5 20l-12.9 4.6L20 37.5l-4.6-12.9L2.5 20l12.9-4.6z" />
        </svg>
      );
    case "abilities":
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="2.6" />
          <circle cx="20" cy="20" r="5" />
        </svg>
      );
    case "skills":
      return (
        <svg {...p}>
          <rect x="6" y="9" width="28" height="4.2" rx="2.1" />
          <rect x="6" y="18" width="20" height="4.2" rx="2.1" />
          <rect x="6" y="27" width="24" height="4.2" rx="2.1" />
        </svg>
      );
    case "combat":
      return (
        <svg {...p}>
          <path d="M20 3l13 5v9c0 9-5.6 15-13 20C12.6 32 7 26 7 17V8z" />
        </svg>
      );
    case "companion": // rhombus — a companion at its owner's side
      return (
        <svg {...p}>
          <path d="M20 4l12 16-12 16L8 20z" />
        </svg>
      );
    case "gmnotes":
      return (
        <svg {...p}>
          <rect x="9" y="5.5" width="22" height="29" rx="3.4" fill="none" stroke="currentColor" strokeWidth="2.6" />
          <path d="M14 14h12M14 20h12M14 26h8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      );
    case "feats":
      return (
        <svg {...p}>
          <path d="M20 4l4 11h11l-9 7 3.4 11L20 27l-9.4 6L14 22l-9-7h11z" />
        </svg>
      );
    case "spells":
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="5.4" />
          <circle cx="20" cy="6" r="2.4" />
          <circle cx="20" cy="34" r="2.4" />
          <circle cx="6" cy="20" r="2.4" />
          <circle cx="34" cy="20" r="2.4" />
          <circle cx="10" cy="10" r="2" />
          <circle cx="30" cy="30" r="2" />
        </svg>
      );
    case "gear":
      return (
        <svg {...p}>
          <path d="M14 6h12l-1.5 7h-9z" />
          <rect x="8" y="13" width="24" height="21" rx="4" />
        </svg>
      );
    default:
      return <svg {...p}><circle cx="20" cy="20" r="6" /></svg>;
  }
}

/* ------------------------------------------------------------------ *
 *  help-index glyphs — one per feature entry in the help tab.
 *
 *  Same 40×40 geometric language as Sym, but fill/stroke are bound to
 *  currentColor: the help index inverts the icon tile when a row is
 *  selected (dark tile, light glyph), which the nav glyphs never do.
 * ------------------------------------------------------------------ */
export function HelpSym({ name, className }) {
  const p = { viewBox: "0 0 40 40", className, fill: "currentColor", "aria-hidden": true };
  // shorthand for the stroked half of the set
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    /* ---- general ---- */
    case "switch":
      return <svg {...p}><path {...s} strokeWidth="3.4" d="M7 15h22l-6.5-6.5M33 25H11l6.5 6.5" /></svg>;
    case "menu":
      return (
        <svg {...p}>
          <rect x="6" y="11" width="28" height="4.4" rx="2.2" />
          <rect x="6" y="18" width="28" height="4.4" rx="2.2" />
          <rect x="6" y="25" width="17" height="4.4" rx="2.2" />
        </svg>
      );
    case "save":
      return <svg {...p}><path d="M13.5 31a8.5 8.5 0 0 1-.8-16.9 10.5 10.5 0 0 1 20 2.6A7.2 7.2 0 0 1 30.5 31z" /></svg>;
    case "mobile":
      return (
        <svg {...p}>
          <rect {...s} x="12" y="4.5" width="16" height="31" rx="4.4" />
          <rect x="17" y="29" width="6" height="2.6" rx="1.3" />
        </svg>
      );

    /* ---- scenario ---- */
    case "scenario":
      return (
        <svg {...p}>
          <path d="M19 11C13.5 8.2 8 8.2 4 10.4v18.4c4-2.2 9.5-2.2 15 .6z" />
          <path d="M21 11c5.5-2.8 11-2.8 15-.6v18.4c-4-2.2-9.5-2.2-15 .6z" />
        </svg>
      );
    case "read":
      return (
        <svg {...p}>
          <rect {...s} x="5" y="8" width="30" height="20" rx="4.4" />
          <path d="M12.5 27h9l-9 8z" />
        </svg>
      );
    case "check":
      return <svg {...p}><path {...s} strokeWidth="4.2" d="M8.5 21l8 8L31.5 11" /></svg>;
    case "link":
      return (
        <svg {...p}>
          <path {...s} strokeWidth="3.4" d="M16.5 23.5l7-7" />
          <path {...s} strokeWidth="3.4" d="M21.5 12.5l2.8-2.8a6.6 6.6 0 0 1 9.3 9.3l-2.8 2.8" />
          <path {...s} strokeWidth="3.4" d="M18.5 27.5l-2.8 2.8a6.6 6.6 0 0 1-9.3-9.3l2.8-2.8" />
        </svg>
      );
    case "map":
      return (
        <svg {...p}>
          <path fillRule="evenodd" clipRule="evenodd" d="M20 3.5c-6.2 0-11.2 5-11.2 11.2C8.8 23.2 20 36.5 20 36.5S31.2 23.2 31.2 14.7C31.2 8.5 26.2 3.5 20 3.5zm0 15.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4z" />
        </svg>
      );

    /* ---- encounters ---- */
    case "combat":
      return <svg {...p}><path d="M20 3l13 5v9c0 9-5.6 15-13 20C12.6 32 7 26 7 17V8z" /></svg>;
    case "initiative":
      return (
        <svg {...p}>
          <rect x="6" y="8" width="28" height="4.6" rx="2.3" />
          <rect x="6" y="17.7" width="21" height="4.6" rx="2.3" />
          <rect x="6" y="27.4" width="13" height="4.6" rx="2.3" />
        </svg>
      );
    case "list":
      return (
        <svg {...p}>
          <circle cx="9" cy="10.5" r="3" /><rect x="16" y="8.2" width="18" height="4.6" rx="2.3" />
          <circle cx="9" cy="20" r="3" /><rect x="16" y="17.7" width="18" height="4.6" rx="2.3" />
          <circle cx="9" cy="29.5" r="3" /><rect x="16" y="27.2" width="18" height="4.6" rx="2.3" />
        </svg>
      );
    case "plus":
      return <svg {...p}><path {...s} strokeWidth="4.4" d="M20 7.5v25M7.5 20h25" /></svg>;
    case "heart":
      return <svg {...p}><path d="M20 34.5S5.5 25.4 5.5 16A7.8 7.8 0 0 1 20 11.6 7.8 7.8 0 0 1 34.5 16c0 9.4-14.5 18.5-14.5 18.5z" /></svg>;
    case "condition":
      return (
        <svg {...p}>
          <path {...s} d="M20 4l13.5 7.8v16.4L20 36 6.5 28.2V11.8z" />
          <circle cx="20" cy="20" r="4.6" />
        </svg>
      );
    case "stepper":
      return (
        <svg {...p}>
          <rect {...s} x="3.5" y="13" width="33" height="14" rx="7" />
          <path {...s} strokeWidth="2.8" d="M9.5 20h4.6M25.9 20h4.6M28.2 17.7v4.6" />
        </svg>
      );
    case "dots":
      return <svg {...p}><circle cx="10.5" cy="20" r="3.6" /><circle cx="20" cy="20" r="3.6" /><circle cx="29.5" cy="20" r="3.6" /></svg>;
    case "effect":
      return (
        <svg {...p}>
          <path d="M17 4.5l3.2 8.8 8.8 3.2-8.8 3.2L17 28.5l-3.2-8.8L5 16.5l8.8-3.2z" />
          <path d="M29.5 24l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" />
        </svg>
      );
    case "select":
      return (
        <svg {...p}>
          <rect {...s} x="5.5" y="5.5" width="29" height="29" rx="6.4" />
          <path {...s} strokeWidth="3.6" d="M12.5 20.5l5.2 5.2 9.8-11.4" />
        </svg>
      );
    case "die":
      return (
        <svg {...p}>
          <path {...s} d="M20 3.5l14.2 8.2v16.6L20 36.5 5.8 28.3V11.7z" />
          <path d="M20 11.5l7.2 12.4H12.8z" />
        </svg>
      );
    case "edit":
      return (
        <svg {...p}>
          <path d="M28.4 5.6l6 6-3.7 3.7-6-6z" />
          <path d="M22.6 11.4l6 6L13.9 32.1 5.6 34.4l2.3-8.3z" />
        </svg>
      );
    case "threat":
      return (
        <svg {...p}>
          <path {...s} strokeWidth="3.4" d="M6 28a14 14 0 0 1 28 0" />
          <path {...s} strokeWidth="3.4" d="M20 28l8.5-9.5" />
          <circle cx="20" cy="28" r="3.2" />
        </svg>
      );
    case "round":
      return (
        <svg {...p}>
          <path {...s} strokeWidth="3.6" d="M33.5 20a13.5 13.5 0 1 1-5.2-10.7" />
          <path d="M34.5 5.5v9.5H25z" />
        </svg>
      );
    case "log":
      return (
        <svg {...p}>
          <rect {...s} x="7.5" y="7" width="25" height="28" rx="4.4" />
          <rect x="14.5" y="3.5" width="11" height="6.4" rx="3.2" />
          <path {...s} d="M14 19h12M14 26h8" />
        </svg>
      );

    /* ---- characters ---- */
    case "party":
      return (
        <svg {...p}>
          <circle cx="14" cy="14" r="6" />
          <circle cx="27" cy="17" r="4.6" />
          <path d="M4 34c0-6 4.6-9.5 10-9.5S24 28 24 34z" />
          <path d="M23 34c.4-4.6 3.4-7.4 7.2-7.4 3.6 0 6.3 2.6 6.8 7.4z" />
        </svg>
      );
    case "npc":
      return <svg {...p}><circle cx="20" cy="13" r="7.2" /><path d="M6 35.5c0-7.6 6.3-12.4 14-12.4s14 4.8 14 12.4z" /></svg>;
    case "companion":
      return <svg {...p}><path d="M20 4l12 16-12 16L8 20z" /></svg>;
    case "book":
      return (
        <svg {...p}>
          <rect {...s} x="8.5" y="4.5" width="23" height="31" rx="4" />
          <path d="M16.5 4.5h7.6v13.4L20.3 15l-3.8 2.9z" />
        </svg>
      );
    case "import":
      return (
        <svg {...p}>
          <path {...s} strokeWidth="3.4" d="M20 4.5v19M12 15.5l8 8 8-8" />
          <path {...s} strokeWidth="3.4" d="M6.5 28.5v3.4a3.6 3.6 0 0 0 3.6 3.6h19.8a3.6 3.6 0 0 0 3.6-3.6v-3.4" />
        </svg>
      );
    case "export":
      return (
        <svg {...p}>
          <path {...s} strokeWidth="3.4" d="M20 23.5v-19M12 12.5l8-8 8 8" />
          <path {...s} strokeWidth="3.4" d="M6.5 28.5v3.4a3.6 3.6 0 0 0 3.6 3.6h19.8a3.6 3.6 0 0 0 3.6-3.6v-3.4" />
        </svg>
      );

    /* ---- gm notes ---- */
    case "pages":
      return (
        <svg {...p}>
          <path d="M7.5 5h13.8l8.2 8.2v20.3a2 2 0 0 1-2 2H7.5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
          <path {...s} d="M34.5 12.5v20.8a4 4 0 0 1-4 4H14" />
        </svg>
      );
    case "mode":
      return <svg {...p}><rect {...s} x="3.5" y="12" width="33" height="16" rx="8" /><circle cx="27.5" cy="20" r="4.8" /></svg>;
    case "blocks":
      return (
        <svg {...p}>
          <rect x="5.5" y="6.5" width="29" height="7.4" rx="2.6" />
          <rect {...s} strokeWidth="2.8" x="5.5" y="16.3" width="29" height="7.4" rx="2.6" />
          <rect x="5.5" y="26.1" width="18" height="7.4" rx="2.6" />
        </svg>
      );
    case "clock":
      return <svg {...p}><circle {...s} cx="20" cy="20" r="14.5" /><path {...s} d="M20 10.5v10l6.6 4.2" /></svg>;
    case "search":
      return (
        <svg {...p}>
          <circle {...s} strokeWidth="3.2" cx="17.5" cy="17.5" r="10.6" />
          <path {...s} strokeWidth="3.8" d="M25.4 25.4L34 34" />
        </svg>
      );

    default:
      return <svg {...p}><circle cx="20" cy="20" r="6" /></svg>;
  }
}

/* ------------------------------------------------------------------ */
/*  symbol-logos — bold geometric marks, one visual weight            */
/*  (the brand's primary visual language: black on off-white)         */
/* ------------------------------------------------------------------ */

export function ScenSym({ name, className }) {
  const p = { viewBox: "0 0 40 40", className, "aria-hidden": true };
  switch (name) {
    case "overview": // compass star
      return (
        <svg {...p}>
          <path d="M20 2.5l4.6 12.9L37.5 20l-12.9 4.6L20 37.5l-4.6-12.9L2.5 20l12.9-4.6z" />
        </svg>
      );
    case "background": // open book
      return (
        <svg {...p}>
          <path d="M19 11C13.5 8.2 8 8.2 4 10.4v18.4c4-2.2 9.5-2.2 15 .6z" />
          <path d="M21 11c5.5-2.8 11-2.8 15-.6v18.4c-4-2.2-9.5-2.2-15 .6z" />
        </svg>
      );
    case "start": // orbiting marks
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="20" cy="20" r="5.6" />
          <circle cx="20" cy="6.4" r="2.6" />
          <circle cx="32" cy="26" r="2.6" />
          <circle cx="8" cy="26" r="2.6" />
        </svg>
      );
    case "journey": // boat
      return (
        <svg {...p}>
          <path d="M5.5 26h29l-3.2 6.3c-.3.5-.8.7-1.4.7H10.1c-.6 0-1.1-.2-1.4-.7z" />
          <path d="M19 6.6c0-1 1.3-1.5 1.9-.6l8.5 11.1c.5.7 0 1.6-.9 1.6H19z" />
          <rect x="18.3" y="6" width="1.7" height="18" rx=".85" />
        </svg>
      );
    case "cassomir": // three-legged frog (eyes)
      return (
        <svg {...p}>
          <ellipse cx="20" cy="25" rx="13" ry="8" />
          <circle cx="13" cy="14" r="5.6" />
          <circle cx="27" cy="14" r="5.6" />
          <circle cx="13" cy="13" r="2" fill="#f4f4f2" />
          <circle cx="27" cy="13" r="2" fill="#f4f4f2" />
        </svg>
      );
    case "swamp": // quicksand rings
      return (
        <svg {...p}>
          <g fill="none" stroke="currentColor" strokeWidth="3">
            <circle cx="20" cy="20" r="14" />
            <circle cx="20" cy="20" r="8.4" />
          </g>
          <circle cx="20" cy="20" r="2.8" />
        </svg>
      );
    case "trail": // winding trail
      return (
        <svg {...p}>
          <path
            d="M9 7c0 9 22 9 22 18 0 4.5-3.2 7-8 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "enclave": // hut
      return (
        <svg {...p}>
          <path d="M20 6l15 16.5H5z" />
          <rect x="9" y="22" width="22" height="10.5" rx="1.5" />
          <rect x="16.6" y="25.5" width="6.8" height="7" rx="1" fill="#f4f4f2" />
        </svg>
      );
    case "ruinsB": // broken columns
      return (
        <svg {...p}>
          <rect x="8" y="12" width="7" height="24" rx="1.6" />
          <rect x="8" y="8.5" width="7" height="2.6" rx="1.3" />
          <rect x="25" y="18" width="7" height="18" rx="1.6" />
          <circle cx="20.5" cy="33.5" r="1.7" />
        </svg>
      );
    case "real": // mushroom (Rain)
      return (
        <svg {...p}>
          <path d="M6 21c0-8 6.3-13.5 14-13.5S34 13 34 21z" />
          <path d="M16 21h8v9.5c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2z" />
          <circle cx="15" cy="16" r="2" fill="#f4f4f2" />
          <circle cx="24.5" cy="14" r="1.6" fill="#f4f4f2" />
        </svg>
      );
    case "ruinsC": // summoning-rune column
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="20" cy="20" r="9" />
          <circle cx="20" cy="20" r="3.2" fill="#f4f4f2" />
        </svg>
      );
    case "conclusion": // medal / wayfinder
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M20 9.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L20 28.5l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" />
        </svg>
      );
    case "rewards": // gem
      return (
        <svg {...p}>
          <path d="M20 5l11 10-11 20L9 15z" />
          <path d="M9 15h22M20 5v30" fill="none" stroke="#f4f4f2" strokeWidth="1.6" />
        </svg>
      );
    default:
      return <svg {...p} />;
  }
}

/* SYM_FOR: loaded at runtime from the scenario data layer */

/* monoline pictograms for in-content cues */
export function Pict({ name }) {
  const p = {
    viewBox: "0 0 20 20",
    className: "pict",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  switch (name) {
    case "read":
      return (
        <svg {...p}>
          <rect x="3" y="3.6" width="14" height="10" rx="3" />
          <path d="M7 13.6v3l3.4-3" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>
          <path d="M10 2.2l6.6 3.7v8.2L10 17.8l-6.6-3.7V5.9z" />
          <circle cx="10" cy="9.9" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "hazard":
      return (
        <svg {...p}>
          <path d="M10 3l7.2 12.8H2.8z" />
          <path d="M10 8.2v3.6" />
          <circle cx="10" cy="14" r=".5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "reward":
      return (
        <svg {...p}>
          <path d="M10 3l5.2 4.6L10 17.2 4.8 7.6z" />
        </svg>
      );
    case "hero":
      return (
        <svg {...p}>
          <path d="M10 2.6l2.2 4.7 5.1.6-3.8 3.5.9 5.1L10 14.6l-4.4 2.5.9-5.1L2.7 8.5l5.1-.6z" />
        </svg>
      );
    case "dev":
      return (
        <svg {...p}>
          <path d="M10 3.2v11M5.6 10.5L10 14.8l4.4-4.3" />
        </svg>
      );
    case "note":
      return (
        <svg {...p}>
          <path d="M10 3.4l1.7 4.9 4.9 1.7-4.9 1.7L10 16.6l-1.7-4.9L3.4 10l4.9-1.7z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "down":
      return (
        <svg {...p}>
          <path d="M10 4v11M5.6 11l4.4 4.4L14.4 11" />
        </svg>
      );
    default:
      return <svg {...p} />;
  }
}

/* severity meter — monochrome, structure encodes the threat level */
const THREAT_LEVEL = { Trivial: 1, Low: 2, Moderate: 3, Severe: 4 };
export function Severity({ threat }) {
  if (!threat) return null;
  const n = THREAT_LEVEL[threat] || 0;
  return (
    <span className="sev" title={threat}>
      <span className="sev-dots">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`sev-dot ${i < n ? "on" : ""}`} />
        ))}
      </span>
      <span className="sev-label">{threat}</span>
    </span>
  );
}

/* tier marker — filled = success degrees, hollow = failure degrees */
export function TierMark({ k }) {
  const spec = {
    "crit-success": [["on"], ["on"]],
    success: [["on"]],
    fail: [[""]],
    "crit-fail": [[""], [""]],
  }[k] || [];
  return (
    <span className="tier-mark">
      {spec.map((d, i) => (
        <span key={i} className={`tdot ${d[0]}`} />
      ))}
    </span>
  );
}
