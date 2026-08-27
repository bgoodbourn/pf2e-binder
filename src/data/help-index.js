/* ==================================================================== *
 *  HELP INDEX — the searchable feature list behind the help tab.
 *
 *  One entry per thing a GM would ask "how do I…" about. Pure data: the
 *  help tab renders whatever is here, so adding a feature entry never
 *  touches markup.
 *
 *  Copy is written to be searched as much as read — button labels are
 *  quoted verbatim and the words a GM would actually type ("hp", "dc",
 *  "roll", "damage") are kept in the prose, because `search` matches
 *  title + short + desc as one string.
 *
 *  Fields
 *    id     stable key
 *    tab    general | scenario | encounters | characters | gmnotes
 *           — drives grouping, the chip filter, the eyebrow, the CTA,
 *             and which wireframe schematic renders
 *    title  lowercase, 1–3 words
 *    short  one clause; must fit a single line in the 430px index column
 *    desc   what the feature does, plainly
 *    sym    HelpSym glyph name (see components/icons.jsx)
 *    r      [left, top, width, height] as percentages of the wireframe
 *           box, authored against that tab's schematic in helptab.jsx
 *    go     deep-link target, applied by App's handler. Omitted on
 *           `general` entries, which belong to no workspace.
 * ==================================================================== */

/* Group order in the index, and the chip row. `general` leads because it
 * is app-level: the tabs below it are the four workspaces, in dock order. */
export const HELP_TABS = [
  { id: "general", label: "general" },
  { id: "scenario", label: "scenario" },
  { id: "encounters", label: "encounters" },
  { id: "characters", label: "characters" },
  { id: "gmnotes", label: "gm notes" },
];

export const HELP_INDEX = [
  /* ---------------------------- general ---------------------------- */
  {
    id: "scenario-switcher",
    tab: "general",
    title: "scenario switcher",
    short: "change the active scenario from the top bar",
    sym: "switch",
    r: [76, 1.5, 22, 6],
    desc:
      "the dropdown on the right of the top bar lists every scenario. selecting one loads that " +
      "scenario across all tabs. the last option, “+ new custom scenario…”, creates an empty " +
      "scenario with a title you enter. custom scenarios have no scenario tab - their notes, " +
      "characters, and encounters are always added manually.",
  },
  {
    id: "menu-bar",
    tab: "general",
    title: "menu bar",
    short: "the top bar hides itself; hover the top edge to show it",
    sym: "menu",
    r: [1, 1, 98, 7],
    desc:
      "the top bar hides to leave more room. moving the mouse to the top edge of the window, or " +
      "clicking the “menu” handle, shows it. the “pin menu” button keeps it permanently " +
      "visible. on narrow windows it is always visible.",
  },
  {
    id: "saving",
    tab: "general",
    title: "saving",
    short: "all changes save automatically to this browser",
    sym: "save",
    r: [24, 11, 74, 82],
    desc:
      "every change is saved automatically to this browser's local storage. there is no save " +
      "button. if cloud sync is configured, changes are also backed up online and shared between " +
      "your devices; when the same scenario is edited in two places, the most recent change wins.",
  },
  {
    id: "mobile-view",
    tab: "general",
    title: "mobile view",
    short: "a phone layout for running sessions at the table",
    sym: "mobile",
    r: [62, 1.5, 12, 6],
    desc:
      "the “mobile view” button in the top bar switches to a layout designed for phones. phones " +
      "open in this layout automatically. the mobile layout can run combat, read notes and " +
      "character sheets, and add live notes, but it's designed as a simple helper and doesn't have " +
      "a lot of the features available on desktop. the monitor icon in the mobile header switches " +
      "back from mobile view.",
  },

  /* --------------------------- scenario ---------------------------- */
  {
    id: "scenario-sections",
    tab: "scenario",
    title: "scenario sections",
    short: "the published adventure, split into sections",
    sym: "scenario",
    r: [1.5, 10, 21, 88],
    go: { tab: "scenario" },
    desc:
      "the left rail lists the adventure's sections, grouped by chapter. clicking a section shows " +
      "its text.",
  },
  {
    id: "read-aloud",
    tab: "scenario",
    title: "read-aloud text",
    short: "boxed text to read to the players",
    sym: "read",
    r: [28, 46, 68, 18],
    go: { tab: "scenario" },
    desc: "passages the adventure marks this way appear in a box labelled “read aloud”.",
  },
  {
    id: "scenario-checks",
    tab: "scenario",
    title: "skill checks",
    short: "checks shown with dc and all four outcomes",
    sym: "check",
    r: [28, 68, 68, 17],
    go: { tab: "scenario" },
    desc:
      "skill checks in the adventure are shown as a card with the skill, the dc, and the outcomes " +
      "for critical success, success, failure, and critical failure.",
  },
  {
    id: "wiki-links",
    tab: "scenario",
    title: "wiki links",
    short: "highlighted names open pathfinderwiki",
    sym: "link",
    r: [40, 33, 23, 5],
    go: { tab: "scenario" },
    desc:
      "names of people, places, and creatures are highlighted in the scenario text. clicking one " +
      "opens its PathfinderWiki page in a new browser tab. only the first mention in each " +
      "paragraph is linked.",
  },
  {
    id: "maps",
    tab: "scenario",
    title: "maps",
    short: "every battle map for the adventure, with clickable pins",
    sym: "map",
    r: [1.5, 10.5, 21, 9],
    go: { tab: "scenario", scen: "maps" },
    desc:
      "the “maps” entry at the top of the rail shows all of the adventure's maps. pins on a map " +
      "mark keyed areas and clicking a pin opens that area's section. the legend under each map " +
      "lists the same areas as links.",
  },

  /* -------------------------- encounters --------------------------- */
  {
    id: "encounters",
    tab: "encounters",
    title: "encounters",
    short: "create encounters and switch between them",
    sym: "combat",
    r: [1.5, 10, 21, 9],
    go: { tab: "encounters" },
    desc:
      "the chip at the top of the rail shows the current encounter. expanding it lists the others. " +
      "“+ new encounter” creates an empty encounter. “prefill from scenario” creates the " +
      "adventure's encounters with each creature's stats already entered. “remove” in the header " +
      "deletes the current encounter.",
  },
  {
    id: "initiative",
    tab: "encounters",
    title: "initiative",
    short: "roll, enter, and reorder initiative",
    sym: "initiative",
    r: [27, 29, 7.5, 17],
    go: { tab: "encounters" },
    desc:
      "initiative is shown in the left hand box on the combatant card. combatants will " +
      "automatically reorder if initiative is changed. initiative can be manually entered for any " +
      "combatant. pressing the “roll initiative” button will randomly roll initiative values for " +
      "all non PC combatants. automatic rolls by default are d20 plus the combatant's perception, " +
      "and overwrite any existing values.",
  },
  {
    id: "initiative-order",
    tab: "encounters",
    title: "initiative order list",
    short: "the rail shows the turn order, click a name to jump",
    sym: "list",
    r: [1.5, 20, 21, 62],
    go: { tab: "encounters" },
    desc:
      "the “initiative order” list in the rail shows the whole turn order. clicking a name scrolls " +
      "the main list to that combatant and flashes it briefly. combatants currently visible in the " +
      "main list are highlighted.",
  },
  {
    id: "add-combatants",
    tab: "encounters",
    title: "adding combatants",
    short: "add players, npcs, creatures, or custom combatants",
    sym: "plus",
    r: [26, 19.5, 72, 7],
    go: { tab: "encounters" },
    desc:
      "“+ add player” lists your imported characters and their animal companions. “+ add npc” " +
      "lists scenario and custom npcs that have combat stats. “+ add creature” searches a bestiary " +
      "by name, family, or trait; arrow keys move and enter adds. “add custom” opens a form for " +
      "entering a combatant by hand. “clear” removes every combatant, immediately and without " +
      "confirmation.",
  },
  {
    id: "hit-points",
    tab: "encounters",
    title: "hit points",
    short: "track current hp on each combatant card",
    sym: "heart",
    r: [65.5, 28.5, 12, 8],
    go: { tab: "encounters" },
    desc:
      "current hp is shown beside max hp on the right of each card. type a new value to change it. " +
      "in the mobile layout, “damage” and “heal” buttons apply an amount instead.",
  },
  {
    id: "conditions",
    tab: "encounters",
    title: "conditions",
    short: "apply pathfinder conditions from the full remaster list",
    sym: "condition",
    r: [35.5, 41.5, 23, 5],
    go: { tab: "encounters" },
    desc:
      "“+ condition” opens a searchable list of all conditions. a value and the applying combatant " +
      "can be recorded. applied conditions appear as chips on the card, and the stat tiles show the " +
      "adjusted totals with the modifier. applying a condition the combatant already has updates " +
      "the existing chip. hovering over a chip shows the rule text.",
  },
  {
    id: "condition-values",
    tab: "encounters",
    title: "condition values",
    short: "click a chip to step its value up or down",
    sym: "stepper",
    r: [35.5, 41.5, 11, 5],
    go: { tab: "encounters" },
    desc:
      "clicking a valued condition chip opens − and + buttons. stepping below 1 removes the " +
      "condition. the ✕ on any chip removes it. in the mobile layout, drag a chip up or down to " +
      "change its value.",
  },
  {
    id: "condition-age",
    tab: "encounters",
    title: "condition age dots",
    short: "dots show how many rounds a condition has been unchanged",
    sym: "dots",
    r: [35.5, 41, 23, 6],
    go: { tab: "encounters" },
    desc:
      "each condition chip gains one dot per round since it was applied or last changed, up to " +
      "three dots and then a +. changing the value restarts the count. the count follows the " +
      "target's turns, so a condition applied after the target has already acted starts counting " +
      "from the next round. hovering a chip shows when and who applied it.",
  },
  {
    id: "custom-effects",
    tab: "encounters",
    title: "custom effects",
    short: "build a named effect with your own modifiers",
    sym: "effect",
    r: [47, 41.5, 12, 5],
    go: { tab: "encounters" },
    desc:
      "“+ effect” opens a form for a named effect, e.g. bane, with modifiers to ac, saves, " +
      "perception, attack, damage, or actions, plus any line you type yourself. a typed line with " +
      "no value is stored as a text note on the card. applying the same effect twice creates two " +
      "chips.",
  },
  {
    id: "multi-select",
    tab: "encounters",
    title: "multi-select",
    short: "apply a condition or effect to several combatants at once",
    sym: "select",
    r: [26, 27, 51, 43],
    go: { tab: "encounters" },
    desc:
      "the “select” button switches to selection mode. click rows to select them, or use the " +
      "“all”, “enemies”, and “pcs” shortcuts; “pcs” includes animal companions. “+ condition” " +
      "and “+ effect” then apply to every selected combatant in one step.",
  },
  {
    id: "saving-throws",
    tab: "encounters",
    title: "saving throws",
    short: "click a save tile to roll it",
    sym: "die",
    r: [35.5, 35, 27, 7],
    go: { tab: "encounters" },
    desc:
      "the fort, ref, and will tiles on a combatant card are buttons. clicking one rolls d20 plus " +
      "the adjusted modifier and shows the result. nat 1s and nat 20s are marked. ↻ rerolls and " +
      "✕ dismisses. rolls are not saved anywhere. clicking again re rolls.",
  },
  {
    id: "editing-stats",
    tab: "encounters",
    title: "editing stats",
    short: "change a combatant's ac, hp, saves, or perception",
    sym: "edit",
    r: [35.5, 34.5, 32, 8],
    go: { tab: "encounters" },
    desc:
      "the “✎ edit” button on a card replaces the stat tiles with editable fields for ac, total " +
      "hp, saves, and perception. “✓ done” closes editing. player characters are updated by " +
      "re-importing them, so their cards have no edit button.",
  },
  {
    id: "threat-xp",
    tab: "encounters",
    title: "threat and xp",
    short: "the encounter's difficulty, computed from enemy levels",
    sym: "threat",
    r: [83, 11.5, 15, 6],
    go: { tab: "encounters" },
    desc:
      "the pill in the encounter header shows a threat rating and xp total, computed from each " +
      "enemy's level relative to the party. both the label and the xp number can be edited, and an " +
      "edited value stays until you change it.",
  },
  {
    id: "rounds",
    tab: "encounters",
    title: "rounds",
    short: "advance, rewind, or reset the round counter",
    sym: "round",
    r: [26, 87, 72, 9],
    go: { tab: "encounters" },
    desc:
      "the bar at the bottom shows the current round. “advance to round n” moves forward, ◀ goes " +
      "back one round, and ⟲ resets to round 1. condition age dots advance with the round " +
      "counter. in the mobile layout, “next turn” steps through combatants and advances the round " +
      "when the order wraps.",
  },
  {
    id: "running-sheet",
    tab: "encounters",
    title: "running sheet",
    short: "a per-encounter log stamped with the round",
    sym: "log",
    r: [78.5, 27, 20, 36],
    go: { tab: "encounters" },
    desc:
      "“+ log” adds a line to the running sheet. each line is stamped with the round it was " +
      "written in. lines can be edited or removed at any time.",
  },
  {
    id: "encounter-map",
    tab: "encounters",
    title: "encounter map",
    short: "attach a battle map image to the encounter",
    sym: "map",
    r: [26, 27, 51, 26],
    go: { tab: "encounters" },
    desc:
      "the “map” button shows the encounter's map. set one by pasting an image url or uploading a " +
      "file. encounters prefilled from the scenario include the adventure's map automatically.",
  },
  {
    id: "companions-combat",
    tab: "encounters",
    title: "companions in combat",
    short: "animal companions act on their owner's turn",
    sym: "companion",
    r: [26, 48, 51, 20],
    go: { tab: "encounters" },
    desc:
      "an animal companion added to an encounter is placed directly under its owner and has no " +
      "initiative of its own; it acts on the owner's turn. if the owner is removed from the " +
      "encounter, the companion takes its own place in the order.",
  },

  /* -------------------------- characters --------------------------- */
  {
    id: "importing",
    tab: "characters",
    title: "importing characters",
    short: "bring player characters in from pathbuilder",
    sym: "import",
    r: [1.5, 31.5, 21, 6],
    go: { tab: "characters", add: true },
    desc:
      "in Pathbuilder 2e, use export character → export to foundry vtt (json). enter the 6-digit " +
      "id and press “auto-fetch”, or paste the exported json into the box. auto-fetch goes through " +
      "a public proxy and can fail, vs pasting the json always works. importing a character again " +
      "replaces the earlier version.",
  },
  {
    id: "character-sheets",
    tab: "characters",
    title: "character sheets",
    short: "full derived stats for each imported character",
    sym: "party",
    r: [26, 27, 72, 58],
    go: { tab: "characters" },
    desc:
      "selecting a character in the rail opens their sheet. the pills switch between overview, " +
      "abilities, skills, combat, feats, spells, and gear. spells and companion appear only when " +
      "the character has them. all values are computed from the imported pathbuilder data. the " +
      "notes box on the right saves automatically as you type.",
  },
  {
    id: "npcs",
    tab: "characters",
    title: "npcs",
    short: "the scenario's npcs, plus any you add",
    sym: "npc",
    r: [1.5, 39, 21, 30],
    go: { tab: "characters" },
    desc:
      "npcs are grouped in the rail below the party. “+ add npc” adds one, either as a name and " +
      "description or with full combat stats. npcs with full combat stats can be added to " +
      "encounters. only npcs you added can be removed.",
  },
  {
    id: "aon-links",
    tab: "characters",
    title: "archives of nethys links",
    short: "names on sheets open the rules",
    sym: "book",
    r: [26, 53, 72, 21],
    go: { tab: "characters" },
    desc:
      "ancestries, feats, spells, items, and most other names on a character or npc sheet are " +
      "links to the Archives of Nethys. links open in a new browser tab.",
  },
  {
    id: "animal-companions",
    tab: "characters",
    title: "animal companions",
    short: "companion stat blocks computed from the owner's level",
    sym: "companion",
    r: [56, 28, 13, 6],
    go: { tab: "characters", section: "companion" },
    desc:
      "a character with an animal companion has a companion section on their sheet. the " +
      "companion's ac, hp, saves, skills, and strikes are computed from the species, its " +
      "advancement, and the owner's level, following the player core rules.",
  },
  {
    id: "exporting",
    tab: "characters",
    title: "exporting",
    short: "download a character's pathbuilder json",
    sym: "export",
    r: [73.5, 23, 25, 5],
    go: { tab: "characters" },
    desc:
      "the “export” button on a character sheet downloads the character as json. this is the same " +
      "data pathbuilder exported, and it can be imported again later.",
  },

  /* --------------------------- gm notes ---------------------------- */
  {
    id: "pages-forks",
    tab: "gmnotes",
    title: "pages and forks",
    short: "your prep as an ordered set of pages",
    sym: "pages",
    r: [1.5, 10, 21, 86],
    go: { tab: "gmnotes" },
    desc:
      "the pages rail lists your pages in running order. “+ add page” creates a page; the + on a " +
      "page creates a fork indented under it. drag pages to reorder, and a fork will move with the " +
      "parent. deleting a page also deletes its forks.",
  },
  {
    id: "prep-run",
    tab: "gmnotes",
    title: "prep and run modes",
    short: "prep edits the document, run locks it for the session",
    sym: "mode",
    r: [26, 10.5, 15, 7],
    go: { tab: "gmnotes" },
    desc:
      "in prep mode, blocks can be inserted, edited, and deleted. in run mode the prepared text is " +
      "locked, and clicking anywhere in the document adds a live note at that position.",
  },
  {
    id: "blocks",
    tab: "gmnotes",
    title: "blocks",
    short: "six block types for building a page",
    sym: "blocks",
    r: [26, 32, 61, 38],
    go: { tab: "gmnotes" },
    desc:
      "the + between blocks inserts a section heading, paragraph, read-aloud box, skill check, q&a " +
      "table, or linked entities block. skill check blocks hold the type of check, a dc, a " +
      "secret/open toggle, and text for all four outcomes. q&a tables hold questions you expect " +
      "the players to ask and your prepared answers.",
  },
  {
    id: "live-notes",
    tab: "gmnotes",
    title: "live notes",
    short: "timestamped notes taken during the session",
    sym: "clock",
    r: [26, 81, 61, 9],
    go: { tab: "gmnotes" },
    desc:
      "in run mode, click between blocks or on a “＋ live note” zone to write a note. enter saves " +
      "it, escape cancels. each note is stamped with the time it was written, and can be edited or " +
      "deleted in either mode.",
  },
  {
    id: "note-links",
    tab: "gmnotes",
    title: "links",
    short: "link a page to npcs, encounters, other pages, or urls",
    sym: "link",
    r: [26, 71, 61, 9],
    go: { tab: "gmnotes" },
    desc:
      "a linked entities block holds link chips. “+ add link” searches npcs, encounters, and " +
      "pages, or takes a pasted url. clicking a chip opens the target: an npc's sheet, an " +
      "encounter, a page, or the url in a new browser tab. a chip whose target has been deleted is " +
      "greyed out.",
  },
  {
    id: "notes-search",
    tab: "gmnotes",
    title: "notes search",
    short: "search every page from the top bar",
    sym: "search",
    r: [79, 10.5, 19, 7],
    go: { tab: "gmnotes" },
    desc:
      "the search box above the document searches all pages, including skill check outcomes and " +
      "q&a rows. clicking a result jumps to its page.",
  },
];
