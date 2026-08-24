# Cinematic Lab — Saturday Racing

A self-contained sandbox for iterating on the **cinematic replay** GSAP experience without needing Django, a database, or any of the wider Saturday Racing codebase.

Everything you need to reproduce what you see at
<https://www.saturday-racing.com/cinematic/replay/> lives in this folder.

---

## Quick start

```bash
python -m http.server 8080
```

Then open <http://localhost:8080/> — the intro screen fades in and the “RUN THE RACE” button drives the full sequence:

**Intro → Parade → Race → Roll Call → Reveal (Trophy + Verdict + Podium)**

You must serve through a local web server. Opening `index.html` directly with `file://` will fail — the sandbox fetches `data/race.json` at boot and browsers block `fetch` from `file://` for security.

Node users can substitute `npx http-server -p 8080`. Any static server works.

---

## Scenarios

The dropdown in the top-right lets you switch between three pre-baked payloads:

| Slug                     | What it exercises                                                          |
| ------------------------ | -------------------------------------------------------------------------- |
| `race`                   | Real 12-runner finish — clear winner, mid-field spread. **Default.**       |
| `race-close-finish`      | Photo finish — top three separated by less than one length.                |
| `race-runaway`           | Twelve lengths clear — tests the “dominant winner” staging.                |

You can also switch by URL: `?data=race-close-finish`, `?data=race-runaway`.

Each JSON file in `data/` is a self-contained race payload matching the production shape exactly (see **Payload contract** below). Add your own scenarios there — just drop `data/my-scenario.json` and add an `<option value="my-scenario">` to the picker in `index.html`.

---

## What you can (and cannot) change

**Edit freely:**

- `css/experience.css` — the shared visual language for the cinematic (screens, buttons, roll call, reveal, trophy).
- `css/flat.css` — flat-race-specific styling (stalls, photo finish, leaderboard, band pill).
- `js/flat.js` — the flat-race engine (parade → race → roll call → reveal, all GSAP timelines and canvas rendering).

**Do not touch:**

- `index.html` — this exists only to bootstrap the sandbox. The production template lives in `cinematic/templates/cinematic/flat.html` on the main app. If you change HTML structure here it will not carry over. If you need a new DOM element, add it via JS in `flat.js` (e.g. `document.createElement(...)`) and Vas will move the tag into the production template during integration.
- `js/experience.js` — this is the jumps-race engine (used for Grand National / Cheltenham Gold Cup). Left in the bundle for reference. Not wired here.
- `js/vendor/gsap.min.js` — production self-hosts this exact copy.
- `data/*.json` — treat as read-only fixtures. If you need a new scenario, add a **new** file rather than editing these.

---

## Payload contract

Every scenario JSON has this top-level shape (already implemented in the fixtures):

```jsonc
{
  "race_name":     "Legends Global Yorkshire Oaks (Group 1)",
  "race_course":   "York",
  "race_time":     "15:35",
  "race_distance": "1m 3f 188y",
  "race_prize":    "£425,000",
  "band":          "flat",
  "band_subtitle": "Post-race replay · Real finishing positions.",

  "runners":     [ /* array of runner dicts */ ],
  "user_pick":   { "id": 1104, "name": "Bluestocking", "number": 4 },
  "fox_pick":    { "id": 1102, "name": "Warm Heart",   "number": 2 },

  "replay_data": { /* see below */ }
}
```

### Runner dict (per `runners[]`)

```jsonc
{
  "id":           1101,
  "number":       1,
  "name":         "Emily Upjohn",
  "jockey":       "Frankie Dettori",
  "trainer":      "John & Thady Gosden",
  "odds":         "5/4",            // fractional; engine parses to decimal
  "silk":         "#B91C1C",         // primary silk hex
  "silk2":        "#FFFFFF",         // secondary silk hex
  "silk_url":     "",                // optional Racing API silk image
  "silk_pattern": "hooped",          // 'halved'|'hooped'|'striped'|'quartered'|'starred'|'solid'
  "sr":           128,               // speed rating, 0-140-ish
  "stars":        5,                 // AI stars, 0-5
  "is_fav":       true,              // market favourite flag
  "weight":       112.0              // sim weight — higher = more likely to win
}
```

### Replay data (`replay_data`)

```jsonc
{
  "has_result":       true,          // engine short-circuits to forecast mode when false
  "is_abandoned":     false,
  "result_order":     [1101, 1102, 1104, ...],   // runner ids, first-to-last
  "winner_name":      "Emily Upjohn",
  "winner_sp":        "5/4",
  "place2_name":      "Warm Heart",
  "place3_name":      "Bluestocking",

  "beaten_distances": {              // keyed by runner id (as string)
    "1102": "3/4",
    "1104": "1 1/2",
    ...
  },
  "lengths_behind_winner": {         // cumulative from the winner, in decimal lengths
    "1101": 0.0,
    "1102": 0.75,
    "1104": 2.25,
    ...
  },
  "max_lengths_behind": 25.35,       // used to scale the finish stagger
  "has_distances":      true         // false = no beaten-distance data available
}
```

**Silk palette** — the production app cycles this 14-colour palette when the editor hasn’t customised silks. Keep to it for consistency:

```
#B91C1C / #FFFFFF   crimson + white
#1A7D4A / #F5E49A   emerald + gold
#1E40AF / #FBBF24   royal blue + yellow
#7C3AED / #FFFFFF   purple + white
#EA580C / #0B0E15   orange + black
#0B0E15 / #FBBF24   black + yellow
#0EA5E9 / #FFFFFF   sky + white
#DC2626 / #FBBF24   red + yellow
#166534 / #FFFFFF   forest + white
#5B21B6 / #FBBF24   violet + yellow
#0F766E / #FFFFFF   teal + white
#B45309 / #FFFFFF   rust + white
#7E22CE / #F5E49A   plum + gold
#0891B2 / #0B0E15   cyan + black
```

---

## Scope of the engagement

**In scope** — improve the graphical representation and GSAP experience:

- Better parade choreography (currently a straightforward reveal-and-swap).
- Race-phase transitions (intro → parade → race → roll call → reveal) — tighter timing, more cinematic camera moves.
- Roll-call staging (currently reveals last-to-first with a stagger — feels flat).
- Reveal screen — trophy entry, verdict card, podium.
- Photo-finish flourish when `max_lengths_behind < 2`.
- Runaway-winner treatment when `max_lengths_behind > 10`.
- Anything that makes the sequence feel more premium.

**Out of scope:**

- New backend data or schema changes.
- The jumps-race engine (`experience.js`) — that’s a separate deliverable.
- The forecast (pre-race) mode — this bundle is post-race replay only.
- Analytics wiring, A/B toggles, feature flags.

---

## Delivering back

Push your changes to the private repo Vas shared with you and open PRs against `main`. He’ll cherry-pick the CSS/JS diffs into the main Saturday Racing repo — no direct access needed.

Please keep commits scoped (“Parade timing”, “Reveal trophy entry”, etc.) so review + integration stays clean. If you find yourself needing a DOM structure change, drop it in a PR description note rather than editing `index.html` — Vas will move the markup change into the production template during integration.

---

## Troubleshooting

**“Data load failed” banner on first open**
You’re on `file://`. Kill the tab, run `python -m http.server 8080` from this folder, and reopen at `http://localhost:8080/`.

**Trophy / podium missing on the reveal screen**
Check the browser console for a JS error. The reveal reads `#replayData` at boot; a malformed scenario JSON will hang the engine at the fade-out.

**Runners don’t appear in the parade**
Verify your scenario JSON has `runners[]` populated. The engine short-circuits to the reveal screen when `runners.length === 0`.

**Silks look identical**
Your scenario JSON is missing `silk` / `silk2` or setting them to the DB default (`#1a3a6b` + `#ffffff`). Use hex values from the palette above.

---

## Contact

**Vas Rabani** · vasrabani@hotmail.co.uk
Ping on Upwork for engagement questions or Slack for anything urgent.
"# saturday_cinematic" 
