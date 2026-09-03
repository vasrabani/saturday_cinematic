# Cinematic Replay — Architecture

Written for someone joining the codebase cold. Reads front-to-back in ~15 minutes and gives you a map of where every piece lives, why it's structured this way, and where it's safe (and unsafe) to change things.

---

## 1. What this feature is

The Cinematic Replay is a self-contained, ~60-second animated re-run of a horse race, told in five scenes:

**Intro → Parade → Race → Roll Call → Reveal**

It's the emotional cap on a Saturday Racing article about a race — a reader has read the analysis, and now watches the animated re-run of what actually happened (or, if the race hasn't run yet, a simulated forecast).

The whole thing renders in one browser tab, no server round-trips after the initial data load, no images of real horses. Every frame is either canvas 2D, inline SVG, or DOM elements orchestrated by GSAP. It works down to a mid-range phone.

This sandbox (`cinematic-lab`) is a stripped-down copy of the same engine, with three hand-authored fixture races swapped in for real production data. The engine is byte-identical to production.

---

## 2. The 30-second data flow

```
┌──────────────────┐    fetch()    ┌──────────────────┐   parse    ┌────────────────┐
│  data/race.json  │──────────────▶│    index.html    │───────────▶│  #replayData   │
│  (fixture)       │               │   boot() glue    │            │  <script>tag   │
└──────────────────┘               └──────────────────┘            └────────┬───────┘
                                                                            │ read once, sync
                                                                            ▼
                                            ┌───────────────────────────────────────┐
                                            │             js/flat.js                │
                                            │  REPLAY_DATA + FLAT_CONFIG + STATE    │
                                            │                                       │
                                            │  init() → wireButtons() → showScreen  │
                                            │                                       │
                                            │  phase machine drives 5 screens:      │
                                            │  intro → parade → race → rollcall     │
                                            │           → reveal                    │
                                            │                                       │
                                            │  canvas + SVG + GSAP orchestrated     │
                                            └───────────────────────────────────────┘
```

The engine is completely inert until it has data. Once `boot()` fires, everything runs client-side.

---

## 3. Repo layout

```
cinematic-lab/
├── ARCHITECTURE.md         ← this document
├── README.md               ← quick-start + payload contract + scope contract
├── index.html              ← sandbox bootstrap (production replaces this with a Django template)
├── css/
│   ├── experience.css      ← shared cinematic chrome (screens, buttons, roll call, reveal, trophy)
│   └── flat.css            ← flat-race specifics (stalls, photo finish, leaderboard, band pill)
├── js/
│   ├── flat.js             ← THE ENGINE — 2,500 lines, do the work here
│   ├── experience.js       ← jumps-race engine (Grand National etc.); dormant in this sandbox
│   └── vendor/
│       └── gsap.min.js     ← self-hosted (production pins the exact same copy)
├── data/
│   ├── race.json           ← 24-runner mid-field-spread scenario (default)
│   ├── race-close-finish.json  ← 24-runner photo-finish scenario
│   └── race-runaway.json   ← 24-runner runaway-winner scenario
└── img/
    └── silks/              ← sample silk images referenced by runners' silk_url
```

**Two engines?** Flat-race and jumps-race need meaningfully different visuals (starting stalls vs. tape start; photo finish vs. run-in gallop; different track geometry). Rather than one monster file, they're split into `flat.js` and `experience.js`. This sandbox only wires up `flat.js`; treat `experience.js` as reference material.

---

## 4. Runtime bootstrap (production diverges here)

The sandbox startup is deliberately different from production. Understand it before you edit `index.html`.

### Sandbox (this repo)

1. `index.html` loads, static HTML only — no JS engine yet.
2. Inline `<script>` block reads `?data=<slug>` from the URL, defaulting to `race`.
3. `fetch('data/<slug>.json')` pulls the fixture.
4. `boot(payload)` injects the fixture into the DOM in the right shape:
   - Populates the intro title, meta chips, band pill, parade header from the payload.
   - **Creates a `<script type="application/json" id="replayData">` tag** containing the payload.
5. **Only then** does it dynamically load `gsap.min.js` and `flat.js`.
6. `flat.js` reads `#replayData` synchronously into a top-level `const REPLAY_DATA` (see `flat.js:476-ish`).

### Why the dynamic load

`flat.js` reads `#replayData` **once**, at parse time, into a `const`. There's no runtime lookup, no polling, no fallback if the node doesn't exist yet. If `flat.js` runs before `#replayData` is in the DOM, `REPLAY_DATA` is `null` for the rest of the page's life — and the engine silently falls back to a simulated result instead of honouring `result_order`. Loading `flat.js` via a normal `<script src>` at the top of the file reproduces exactly that bug.

The contractor who reconstructed the sandbox found this behaviour and documented it in `index.html:187-208`. Don't undo that pattern.

### Production

In production the whole page is a Django template (`cinematic/templates/cinematic/flat.html` in the main repo). Django server-side-renders the intro title, meta chips, band pill and `#replayData` script tag directly into the HTML. Because it's already in the initial DOM, the script tags for GSAP and `flat.js` can be plain static `<script src>` tags in `<head>` — no dynamic load needed.

**What this means for you**: any change you make to `index.html` structure (adding a new screen, a new DOM element the engine expects) needs to be flagged in the PR as "STRUCTURAL — needs to move into the Django template." Purely visual work in CSS or JS integrates cleanly without any template work.

---

## 5. The payload contract

Full spec is in `README.md § Payload contract`. Quick reference of what the engine actually reads:

| Field | Consumer | Notes |
|---|---|---|
| `race_name`, `race_course`, `race_time`, `race_distance`, `race_prize` | intro screen, parade header | pure display |
| `band` | body class + pill | `sprint` / `mile` / `stayer` — palettes swap on this |
| `band_subtitle` | flat band pill copy | free text |
| `runners[]` | everything | the field itself |
| `runners[].id`, `.number`, `.name`, `.jockey`, `.trainer`, `.odds` | display + labels | `odds` is fractional; engine parses it |
| `runners[].silk`, `.silk2`, `.silk_pattern` | `renderSilkSvg` | hex + `'halved' \| 'hooped' \| 'striped' \| 'quartered' \| 'starred' \| 'solid'` |
| `runners[].silk_url` | `renderSilkSvg` | when truthy, wins over silk/silk2/silk_pattern |
| `runners[].sr` | rating chip on parade + roll call | 0-140 speed rating |
| `runners[].stars` | star row | 0-5 |
| `runners[].is_fav` | market-favourite flag | drives the FAV pip |
| `runners[].weight` | sim + result lag calculation | dimensionless "how likely" score |
| `user_pick`, `fox_pick` | branded overlays throughout | full runner object copies |
| `replay_data.has_result` | branch to replay or sim | when false, engine simulates |
| `replay_data.result_order` | authoritative finish order | array of runner ids, first-to-last |
| `replay_data.winner_name`, `.winner_sp` | reveal screen | display |
| `replay_data.beaten_distances`, `.lengths_behind_winner`, `.max_lengths_behind` | photo-finish stagger + Fin column | keyed by runner id (as string) |

If `has_result` is `false` or the whole `replay_data` block is missing, the engine drops into simulation mode — it uses each runner's `weight` as a probability, picks a winner via weighted random, and improvises finishing positions with lane jitter and stride variance. **The sim path is the same code path as the replay path** — replay just supplies a pre-known result that overrides the weighted draw.

---

## 6. The engine — `js/flat.js` deep dive

2,507 lines. The layout in the file matches the runtime sequence, so scrolling top-to-bottom follows the race.

### 6.1 Module structure (top-to-bottom)

```
Lines
   1-100    Constants: COL palette, config knobs, top-level REPLAY_DATA read
 101-142    renderSilkSvg() — the silks primitive (see § 6.5)
 144-160    STATE object — the single source of runtime truth
 158-215    Canvas setup + DPI handling (raceCanvas + particleCanvas)
 224-260    init() + wireButtons() + showScreen() — kickoff and phase toggling
 263-310    Intro screen builders (chips, static reveal fallback)
 320-410    Parade phase (per-horse walkout, dots, skip)
 419-460    Race start — the stalls "BANG" transition + startRace()
 460-540    weightedRandom(), buildRacePositions(), replayBaseLag() — the sim
 537-615    buildHorseObjects() — the per-horse state each frame will update
 616-790    raceLoop() — the ONLY requestAnimationFrame call in the file
 790-1050   Rendering primitives: drawSky, drawTrack, drawFurlongPoles,
            updateHorses, drawHorses, drawSpeedLines
1050-1300   Hoof dust particle system + beaten-distance formatters
1300-1900   Leaderboard live positions, race commentary, phase transitions,
            slow-motion camera, Fox overlay
1900-2100   Photo finish freeze frame + silk cap renderer
2100-2400   Roll call phase (last-to-first walk-in, one row per horse)
2400-2507   Reveal phase (trophy, winner name, verdict card, podium, actions)
```

Read the file this way and it tells you the story of a race.

### 6.2 The state machine

`STATE.phase` is a plain string. Five values, in this order:

```
'intro'  →  'parade'  →  'race'  →  'rollcall'  →  'reveal'
```

Transitions happen through `showScreen(name)`, which:

1. Sets `STATE.phase = name`.
2. Removes `.active` from every `.screen` element.
3. Adds `.active` to `#screen-<name>`.

Each phase's entry function does the work: `beginParade()`, `startRace()`, `runRollCall()`, `runReveal()`. There's no formal state machine library — the transitions are hardcoded at the end of each phase (parade ends → `transitionToRace()`; race ends → `runRollCall()`; etc.). Simple and readable; hard to accidentally skip a phase.

The `#skip` buttons on each screen fast-forward to the next phase and are also allowed to short-circuit long GSAP timelines.

### 6.3 The DOM ↔ phase mapping

| Phase | Screen div | Primary content |
|---|---|---|
| `intro` | `#screen-intro` | Race title, meta chips (course/time/distance/runners), band pill, hero copy, static preview of the field |
| `parade` | `#screen-parade` | One horse at a time walks across `#paradeStage`. `#paradeCounter` updates, `#paradeDots` shows progress |
| `race` | `#screen-race` | Two `<canvas>` elements (sky+track+horses on `#raceCanvas`, hoof dust on `#particleCanvas`), plus DOM overlays: `#raceLeaderboard` for live positions, `#racingCommentary` for spoken beats, `#flatPhotoFinish` for the freeze frame |
| `rollcall` | `#screen-rollcall` | Last-to-first parade of horses back onto `#rollcallStage`, each with silk + name + finish position |
| `reveal` | `#screen-reveal` | Trophy SVG, winner name, verdict box, podium chips, three action buttons |

CSS puts every `.screen` into position: absolute + opacity: 0 by default; adding `.active` fades it in. Only one is ever visible.

### 6.4 The race loop — how the canvas frame is built

`raceLoop(ts)` at line 616 is the only `requestAnimationFrame` loop in the file. Every frame:

```javascript
raceLoop(ts) {
  const dt = ts - lastTs;                    // ms since last frame
  const progress = elapsed / RACE_DURATION;  // 0.0 → 1.0

  drawSky(progress);         // gradient background (colour drifts with progress)
  drawTrack();               // green turf + white rail
  drawFurlongPoles(progress);// scrolling distance markers
  updateHorses(progress, dt);// physics: advance each horse's x-position
  drawHorses(top4Set);       // procedural anatomy + gallop cycle
  drawSpeedLines(...);       // motion streaks behind leaders
  drawHoofDust();             // particle system (separate canvas)

  // DOM overlays that live outside canvas:
  updateLeaderboardDOM();     // rewrites #raceLeaderboard innerHTML
  fireCommentaryBeat();       // GSAP-driven copy into #racingCommentary

  if (progress >= 1) fireFinish();
  else requestAnimationFrame(raceLoop);
}
```

**One canvas, one loop, no react-style reconciliation.** Live positions are inserted into `#raceLeaderboard` as a plain innerHTML rewrite because the leaderboard is tiny (top ~6 rows). Everything else is drawn onto pixels.

### 6.5 Silks — procedural + optional override

Every runner gets a jockey silk. `renderSilkSvg(runner)` at line 101 produces one of two things:

- **If `runner.silk_url` is truthy**: an `<img class="silk-img" src="...">` tag.
- **Otherwise**: an inline `<svg>` drawn from three fields:
  - `silk` → primary hex (body colour)
  - `silk2` → secondary hex (accent colour + sleeves)
  - `silk_pattern` → shape of the accent overlay (one of 6 patterns)

The procedural path uses a fixed body path (`BODY_PATH` at line 110) and a fixed sleeves path (`SLEEVES_PATH` at line 111). The pattern overlay is inserted between the body and the sleeves, clipped to the body shape. Result: consistent silhouette across all silks, differentiated by colour and pattern.

The `img/silks/*.svg` files in this sandbox are the same six patterns rendered as standalone files, so `silk_url` produces visually identical output to the procedural path. This exists mostly as a demonstration — production hooks `silk_url` up to the Racing API silks CDN when the editor has customised a specific runner's colours. Swap in your own PNG/WEBP/SVG whenever you want to enhance the look for a specific runner.

### 6.6 The horses themselves

The horses are drawn procedurally in `drawHorses()` (~line 908) as a chain of ellipses and curves — no sprite sheet, no pre-baked images. This is deliberate:

- **Any race, any runners**: a production race could have 4 or 24 runners with jockeys and silks we've never rendered before. Pre-baked sprites can't accommodate this without a huge asset library.
- **Legibility at all scales**: the same code renders convincingly at phone width (250px lane widths) and desktop (900px+).
- **Cheap**: canvas + simple geometry keeps this at 60fps on mid-range phones.

Each horse has:

- **Body geometry** — a chain of ellipses (torso, neck, head) with a mane and tail.
- **A gallop cycle** — legs are animated by a phase offset per horse, cycling at ~4Hz. Adjacent horses get slightly different cycles so they don't visually sync ("lane jitter + stride variance").
- **A silk overlay on the jockey** — mini SVG cap drawn on top, matching that runner's silk fields.
- **Speed lines** — thin white streaks behind the top 4 horses, faded further back.
- **Hoof dust** — a particle system on the second canvas, lower opacity, drifting up as the horses pass.

The three most valuable levers for a designer looking at horse aesthetics:
- `drawHorses()` — the anatomy itself.
- The `_hoofDustParticle` push in `updateHorses()` — density + colour of the dust.
- `drawSpeedLines()` — the motion-line treatment.

### 6.7 Sim vs replay

The single most important branch in `flat.js` is inside `buildRacePositions()`. Both branches produce the same output shape (an ordered list of runners with per-horse lag targets), so everything downstream is agnostic.

```
if (REPLAY_DATA && REPLAY_DATA.has_result) {
   // REPLAY: use result_order + beaten_distances to set exact per-horse lag
   winner = runners.find(r => r.id === result_order[0])
   for each runner: lag = replayBaseLag(runner, trackWidthPx)
                          (lag comes from lengths_behind_winner)
} else {
   // SIM: pick a winner by weighted random, invent plausible lags
   winner = weightedRandom(runners)
   for each other runner: lag = jittered exponential falloff by weight rank
}
```

The engine then runs the same `raceLoop` for both paths. The user cannot tell from the animation itself which mode is active — that's the point.

`replay_data.has_distances = false` puts the replay path into a hybrid mode: the winner and finishing order are honoured, but per-horse gaps are invented (the runaway fixture is this case).

---

## 7. Visual layer

CSS lives in two files that split responsibilities on subject, not scope:

### `css/experience.css` (shared cinematic chrome)

- Screen layout — every `.screen` positioning, fade behaviour, active state
- Button primitives (`.reveal-btn`, `.rollcall-skip-btn`, etc.)
- Typography scale (intro title, kicker, meta chips)
- Roll call visual grammar (rows, positions, silks, spacing)
- Reveal screen: trophy layout, verdict box, podium chips, action bar
- CSS variables for the palette and spacing (search for `:root` at the top)

### `css/flat.css` (flat-race specifics)

- Flat band pill styling (colour-swaps by `.flat-band-pill--sprint / --mile / --stayer`)
- Starting stalls (`#flatStalls`) and the "BANG" animation
- Photo-finish overlay (`#flatPhotoFinish` flash + label)
- Race leaderboard (`#raceLeaderboard`) rows, silks column, positions
- Race commentary (`#racingCommentary`) — the ticker line at the bottom
- Parade stage horse card

**Rule of thumb**: if a style would apply equally well to a jumps race (Grand National, Cheltenham), it belongs in `experience.css`. If it's specific to the flat-race visual grammar (stalls, band pills, photo-finish flash), it belongs in `flat.css`.

The parent body carries a state class the CSS reads: `body.page-experience--sprint / --mile / --stayer`. That class is set by `boot()` in `index.html` from `payload.band` and drives palette variations across both stylesheets.

---

## 8. GSAP orchestration

GSAP (self-hosted at `js/vendor/gsap.min.js`) is used for **DOM animation only** — not for canvas. The canvas has its own frame loop. GSAP drives the screen transitions and the choreography inside each screen.

Roughly:

| Phase | GSAP timelines |
|---|---|
| Intro | Kicker fade-in, title character reveal, meta chip stagger |
| Parade | Per-horse entry (silk scale, name slide), skip button pulse |
| Race | Stalls BANG (scale + shake), photo-finish flash overlay, commentary line rotation |
| Roll call | Per-row entry from off-screen right, position number count-up |
| Reveal | Trophy scale + rotate + glow, winner name slide-up, verdict box fade, podium stagger, action bar entry |

GSAP timelines are set up inline within their phase's entry function. Search `gsap.timeline(` or `gsap.to(` to find them. They're generally short (5-10 lines each).

**Skips**: every phase has a skip button. Its click handler calls `.kill()` on the current timeline and jumps state to end-state, then advances the phase.

---

## 9. Sandbox ↔ production divergence

This sandbox is designed to feel identical to production so you can iterate confidently, but three things are different. When you PR your changes, flag these separately:

| Difference | Sandbox | Production | If you change it |
|---|---|---|---|
| Bootstrap | `index.html` static file, `fetch()` a JSON fixture | Django template server-renders payload + `#replayData` | HTML structure changes need a template task in the main repo. Vas moves the change into `cinematic/templates/cinematic/flat.html` |
| Data source | Three static fixtures in `data/` | Live race data from the app's DB + Racing API sync | Data-shape changes need a matching Python model/serializer change in the main repo |
| GSAP + flat.js load | Dynamic `<script>` injection after `#replayData` is in place | Static `<script src>` tags in `<head>` (server has already rendered `#replayData`) | Don't undo the dynamic pattern in the sandbox — it exists to defend against a specific bug. Production doesn't need it |

Everything under `css/`, `img/`, and `js/flat.js` translates directly. Copy the file, done.

---

## 10. Extension patterns

Common jobs you might take on and where they belong.

### Change how a horse looks

`js/flat.js` → `drawHorses()` (line ~908). Also `_hoofDustParticle` for dust, `drawSpeedLines()` for motion streaks.

### Change how silks look

- **Procedural**: `js/flat.js` → `renderSilkSvg()` (line ~101). Modify body path, sleeves path, or pattern markup.
- **Per-runner override**: populate `silk_url` on runners in the fixture JSON, pointing at any image the browser can render. Fallback is transparent — if the image 404s the browser shows the alt text; the procedural path only runs if `silk_url` is falsy.

### Change screen transitions

`js/flat.js` → find the phase's entry function (`beginParade`, `transitionToRace`, `runRollCall`, `runReveal`) or `showScreen()` for the top-level fade behaviour.

### Add a new decorative element to a screen

Two clean options:

1. **JS-injected**: create it in the phase's entry function via `document.createElement`, append to the screen div, GSAP-animate. Zero HTML changes, zero production template work.
2. **HTML-declared**: add it to `index.html` and to `cinematic/templates/cinematic/flat.html` in the main repo. Style in CSS. Requires Vas to sync the template change.

Prefer option 1 for animated flourishes and option 2 for structural elements you'll style heavily.

### Add a new race band (e.g., "juvenile")

1. Add a CSS variant: `.page-experience--juvenile` in `experience.css` with palette overrides.
2. Add `.flat-band-pill--juvenile` in `flat.css`.
3. Fixtures pass `band: "juvenile"` — `boot()` in `index.html` automatically adds the body class.

### Add a new phase

Non-trivial. You'd need:

1. A new `<div class="screen flat-screen" id="screen-<name>">` in `index.html` (and the production template).
2. Update `showScreen()` — it already handles any `id="screen-<x>"`, so just call `showScreen('<name>')` from the previous phase's exit.
3. An entry function that sets up the screen and eventually calls the next phase.
4. CSS in `experience.css` (shared chrome) or `flat.css` (flat-specific).

Talk to Vas before doing this — the five phases are opinionated storytelling, not scaffolding, so adding a sixth is a product decision as much as a technical one.

### Add a new fixture

1. Copy `data/race.json` to `data/my-scenario.json`.
2. Edit the runners + `replay_data`.
3. Add an `<option value="my-scenario">` to the `#scenarioPick` `<select>` in `index.html`.
4. Reload the page and use the dropdown.

Nothing else. The engine will pick it up automatically.

---

## 11. Non-obvious behaviours worth knowing

- **The engine is silent about missing data.** If `replay_data` is absent, it falls back to sim mode without any user-visible warning. If `#replayData` isn't in the DOM when `flat.js` parses, `REPLAY_DATA` is `null` for the rest of the page's life. Neither surfaces as an error — the animation just becomes a simulation. That's why the dynamic load matters.
- **`raceCanvas` and `particleCanvas` are separate for a reason.** The particle canvas (hoof dust) has different opacity + blend requirements, and separating them keeps the composite cheap.
- **All timing is progress-based, not wall-clock.** `RACE_DURATION` is a constant; `progress = elapsed / RACE_DURATION`. This means `Skip` can force `progress = 1` and everything renders correctly to end-state.
- **The `top4Set`** passed to `drawHorses()` is used to decorate the leaders (speed lines, label chips). Horses outside the top 4 are drawn plainer — cheaper and less visually noisy.
- **`replayBaseLag()` reads `runner.id` as a string** into `lengths_behind_winner` lookup — the fixtures use string keys deliberately (JSON keys can't be numbers). If you add fixtures, keep this convention.
- **Photo finish**: `photoFinishFired` is a module-level flag that gates the freeze frame overlay. If `progress > 0.92` AND the top 2 horses are within a body of each other AND the flag hasn't fired, it fires (once). Adjusting the threshold changes how often the flash triggers.
- **The Fox overlay** (a small avatar that appears with certain race narratives) is a DOM element the race screen manages, not a canvas draw. Look for `fox` in `flat.js` for the trigger logic.

---

## 12. Where to start on a first task

If you're picking up work fresh:

1. Run `python -m http.server 8080` and watch `race`, then `race-close-finish`, then `race-runaway` end-to-end. Understand what changes between them.
2. Open `js/flat.js` and scan the section headers (they're commented every ~50 lines). You don't need to understand every function — just know where each concern lives.
3. Pick something small first — a colour tweak, a font-weight change on the reveal screen, a slight change to the speed lines. Ship it as a scoped PR. Vas will merge and integrate to production, and you'll see the shape of the review loop.
4. From there, take on bigger visual work.

**Golden rule**: if you find yourself wanting to change something in `data/*.json` or `index.html` to make your visual change work, stop and ask. Data-shape changes and structural changes need to land in production template + Python code, so they're separate PRs with different reviewers.

For anything visual — colours, motion, geometry, layout, typography, silks — you're in charge. That's what this sandbox is for.
