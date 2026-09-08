# Cinematic Replay — Architecture

Written for someone joining the codebase cold. Reads front-to-back in ~15 minutes and gives you a map of where every piece lives, why it's structured this way, and where it's safe (and unsafe) to change things.

---

## 1. What this feature is

The Cinematic Replay is a self-contained, ~60-second animated re-run of a horse race, told in five scenes:

**Intro → Parade → Race → Roll Call → Reveal**

It's the emotional cap on a Saturday Racing article about a race — a reader has read the analysis, and now watches the animated re-run of what actually happened (or, if the race hasn't run yet, a simulated forecast).

The whole thing renders in one browser tab, no server round-trips after the initial data load, no images of real horses. Every frame is either canvas 2D, inline SVG, or DOM elements orchestrated by GSAP. It works down to a mid-range phone.

The race scene is **Cinematic Replay V2**. The guiding principle behind it is worth stating before any of the mechanics, because most of the design decisions in §6 and §8 only make sense in its light:

> The user should feel that the camera is travelling alongside a horse race — not that horse sprites are moving across a webpage.

In practice that means the race is rendered in **world space** and viewed through a **virtual camera**, and that every animated value in the scene is owned by a single **GSAP master timeline**. Both are covered in detail below.

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
│   ├── flat.js             ← THE ENGINE — ~2,900 lines, do the work here
│   ├── experience.js       ← jumps-race engine (Grand National etc.); dormant in this sandbox
│   └── vendor/
│       └── gsap.min.js     ← self-hosted (production pins the exact same copy)
├── data/
│   ├── race.json           ← 24-runner mid-field-spread scenario (default)
│   ├── race-close-finish.json  ← 24-runner photo-finish scenario
│   └── race-runaway.json   ← 24-runner runaway-winner scenario
├── img/
│   └── silks/              ← sample silk images referenced by runners' silk_url
└── fonts/
    ├── saturday-fonts.css  ← @font-face rules mirrored from production
    └── *.woff2             ← Playfair Display (4 faces) + DM Sans (5 weights)
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
| `replay_data.beaten_distances`, `.lengths_behind_winner`, `.max_lengths_behind` | field spread, result card, roll call, podium | keyed by runner id (as string) |

V2 reads `lengths_behind_winner` as **real lengths** and draws them at real scale, because a length in world space is by definition the length of the horse being drawn. V1 squashed the whole field into 18% of the track width, which is why a thirty-length runaway used to look like a three-length win. Nothing about the payload changed — only what the renderer does with it.

If `has_result` is `false` or the whole `replay_data` block is missing, the engine drops into simulation mode — it uses each runner's `weight` as a probability, picks a winner via weighted random, and improvises finishing positions with lane jitter and stride variance. **The sim path is the same code path as the replay path** — replay just supplies a pre-known result that overrides the weighted draw.

---

## 6. The engine — `js/flat.js` deep dive

About 2,900 lines. The layout in the file matches the runtime sequence, so scrolling top-to-bottom follows the race. The race scene is split into banner-commented sections (`// ═══ RACE MODEL ═══` and so on) — grep for those banners and you have the table of contents.

### 6.1 Module structure (top-to-bottom)

```
Section                          What lives there
─────────────────────────────────────────────────────────────────────────
CONFIG load                      FLAT_DEFAULTS, the #flatConfig read, COL/TRK
Silk badge renderer              renderSilkSvg() — the silks primitive (§6.5)
State                            STATE — the single source of runtime truth
Canvas + DPI                     raceCanvas + particleCanvas contexts
Viewport + world layout          WORLD, layoutWorld(), resize()
Race state                       horses, particles, masterTL, DIRECTOR, CAM
Race phases                      RACE_PHASES — Cruise / Build / Drive / Line
Init                             init(), wireButtons(), showScreen()
Intro chips                      intro previews + the reduced-motion reveal
Parade                           per-horse walkout, dots, skip
Transition → race                stalls BANG, startRace()
                                 weightedRandom(), buildRacePositions()
RACE MODEL                       deficits in lengths, pace shape, surges,
                                 smoothing, buildHorseObjects, relayoutLanes
MASTER TIMELINE                  buildMasterTimeline(), the four phases,
                                 addFinalFurlongSequence()
VIRTUAL CAMERA                   principalGroupFocus(), updateCamera(),
                                 pushWorldTransform(), visibleWorldRange()
PARALLAX — SEVEN DEPTH PLANES    offscreen tiles + drawBackdrop()
TRACK PLANE                      turf, far rail, furlong markers,
                                 winning post, foreground, atmosphere
MARGINS                          beaten-distance parse/format helpers
THE FIELD                        drawField(), ground markers, hoof dust
BROADCAST IDENTIFICATION         the lower-third that replaced the labels
RENDER LOOP                      renderFrame() on gsap.ticker
THE HORSE                        drawHorseSilhouette() — anatomy + gallop
Commentary                       Mr Fox beats + the phase strip
Leaderboard                      buildLeaderboard() + animated updates
Phase title                      setPhaseTitle()
CROSSING THE LINE                the flash, the held shot, the result card
Roll Call                        last-to-first walk-in, one row per horse
Reveal                           trophy, winner, verdict card, podium
Replay                           replayExperience() — the full teardown
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

**A second, finer state machine runs inside the race screen.** `RACE_PHASES` describes how the *camera* behaves as the race develops:

```
'cruise' (0%)  →  'build' (45%)  →  'drive' (72%)  →  'line' (90%)
```

- **Cruise** — wide, level, unhurried. The whole field is legible and the camera keeps the principal group near the centre of frame with track ahead of them.
- **Build** — the camera starts taking a side. Framing tightens onto the front half of the field; the ground moves faster past it.
- **Drive** — down onto the principal group. Back markers recede, the camera drops and begins to breathe with the gallop.
- **Line** — the dedicated final-furlong sequence. The camera closes onto the two or three runners that can still win, the world goes into slow motion, and the winning post comes into shot for the first time.

Each phase is one GSAP tween on the `DIRECTOR` object; the boundaries are labels on the master timeline. The active key is mirrored onto `#screen-race` as `data-race-phase`, which is how CSS reacts to it.

These are deliberately **separate** from `BAND.phaseTable`, the seven editorial beats ("SETTLING DOWN", "TWO FURLONGS OUT") that editorial tunes in the seed JSON and that still drive the on-screen title and phase strip. Direction and copy change independently.

### 6.3 The DOM ↔ phase mapping

| Phase | Screen div | Primary content |
|---|---|---|
| `intro` | `#screen-intro` | Race title, meta chips (course/time/distance/runners), band pill, hero copy, static preview of the field |
| `parade` | `#screen-parade` | One horse at a time walks across `#paradeStage`. `#paradeCounter` updates, `#paradeDots` shows progress |
| `race` | `#screen-race` | Two `<canvas>` elements (backdrop planes on `#particleCanvas`, track + field + foreground on `#raceCanvas`), plus DOM overlays: `#raceLeaderboard` for live positions, `#racingCommentary` for spoken beats, and two elements the engine injects at runtime — `.bcast-id` (broadcast identification) and `.race-result` (the card after the line). The legacy `#flatPhotoFinish` element is left in the markup and never activated |
| `rollcall` | `#screen-rollcall` | Last-to-first parade of horses back onto `#rollcallStage`, each with silk + name + finish position |
| `reveal` | `#screen-reveal` | Trophy SVG, winner name, verdict box, podium chips, three action buttons |

CSS puts every `.screen` into position: absolute + opacity: 0 by default; adding `.active` fades it in. Only one is ever visible.

### 6.4 World space, the camera, and the frame

This is the heart of V2, and the part most worth understanding before you change anything in the race scene.

**Positions are distances, not pixels.** Every runner carries a `deficit` measured in **horse lengths behind the leader**. `WORLD.lengthPx` is how many world pixels a length is worth, and it is derived from the size of the horse artwork, because a length is by definition the length of a horse. Screen position falls out of that:

```
deficit (lengths)  ->  travel (lengths)  ->  worldX (px)  ->  screenX (px)
                                                            via the camera
```

The consequence: the viewport only ever sets a scale factor. It never touches the race model, which is what lets the window resize mid-race without the field jumping, and what lets the Racing API's real beaten distances be drawn at their real size.

**Runner movement is interpolated, never snapped.** Each frame the model computes a *target* deficit from the fan-out curve, the runner's pace style and any active surge, and then eases the live deficit toward it with an exponential filter (`DEFICIT_TAU_MS`). We smooth the deficit rather than the absolute position on purpose: a lagged absolute position would leave every runner, the winner included, short of the line at the finish, whereas a deficit is slow-moving and settles exactly on its target.

**The camera follows the race.** `principalGroupFocus()` returns a point somewhere between the centroid of the front 40% of the field and the leader on their own; `DIRECTOR.groupBias` slides between the two as the race develops. `updateCamera()` damps `CAM.x` toward that focus, so the camera never snaps and never overshoots into a visible wobble. A hard floor keeps the leader inside the frame no matter what — on a runaway the centroid sits thirty lengths behind the winner, and a camera that honoured it faithfully would spend the closing stages filming the horses that lost.

`pushWorldTransform(ctx)` then puts the canvas into world coordinates. Everything drawn between it and `ctx.restore()` uses world x and lane y; the transform handles the pan, the zoom, the camera drop, the roll and the hoof rumble.

**A frame is a pure function of `DIRECTOR`.** `renderFrame()` runs on `gsap.ticker` rather than a private `requestAnimationFrame`, so the timeline and the renderer are stepped by the same clock in the same order every frame:

```javascript
function renderFrame() {
  const dt = Math.min(gsap.ticker.deltaRatio() * 16.667, 50);
  frameClock += dt;

  updateRaceModel(dt);      // deficits -> travel -> worldX
  updateCamera(dt);         // damped follow + zoom + shake

  drawBackdrop();           // sky + 3 far planes, on #particleCanvas

  ctx.clearRect(...);
  pushWorldTransform(ctx);  // ---- world space ----
  drawTurf();               //   the ground, at rate 1.0
  drawFarRail();            //   far rail + boards, at rate 0.68
  drawFurlongMarkers();     //   distance to go, counting down
  drawWinningPost();        //   only when actually in shot
  drawHoofDust();           //   divots, left behind in world space
  drawField();              //   far lanes first, near lanes last
  ctx.restore();            // ---- back to screen space ----

  drawForegroundPlane();    // grass in FRONT of the field, rate 1.32
  drawAtmosphere();         // vignette + the flash at the line

  fireCommentary(p);        // DOM overlays, each self-throttling
  updateCommentary(dt);
  updateLeaderboard(dt);
  updateRacePhaseTitle(p);
}
```

Nothing here advances time and nothing here decides anything about the race. If you find yourself wanting to write `if (progress > x) doSomething()` inside a draw call, the answer is almost always a tween on `DIRECTOR` in the master timeline instead.

**Culling matters.** The world is nine viewport-widths long, so most of the field is off camera at any moment. `visibleWorldRange()` gates the horses and the track furniture; it is the difference between drawing 24 horses a frame and drawing eight. Measured cost of a full frame with a 24-runner field: ~3.6ms at 1440x800, ~2.3ms at 375x812 — comfortably inside the 16.7ms budget for 60fps.

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

The horses are drawn procedurally in `drawHorseSilhouette()` as a chain of ellipses and curves — no sprite sheet, no pre-baked images. This is deliberate:

- **Any race, any runners**: a production race could have 4 or 24 runners with jockeys and silks we've never rendered before. Pre-baked sprites can't accommodate this without a huge asset library.
- **Legibility at all scales**: the same code renders convincingly at phone width (250px lane widths) and desktop (900px+).
- **Cheap**: canvas + simple geometry keeps this at 60fps on mid-range phones.

**Proportions carry this drawing, not detail.** A thoroughbred is leggy and shallow through the body: the legs are about as long as the barrel is deep, the girth is deep but narrow, and there is a pronounced tuck-up at the flank. Draw it with a round belly and short legs and you get a pony however good the shading is — which is exactly what the first V2 attempt produced. The local grid the paths are laid out on:

```
y = -30   top of the jockey's cap
y = -14   withers / topline
y =  +2   belly (tucked up)
y = +28   ground line
x = -40   tip of the streaming tail
x = +48   muzzle
```

That span is what makes `HORSE_ART_LENGTH` the definition of a "length" everywhere else in the engine — get the drawing's proportions wrong and every gap the Racing API gives us is drawn at the wrong size.

Each horse has:

- **A coat** — `coatFor()` gives each runner a bay / dark bay / chestnut / liver chestnut / black / grey, hashed from the runner id so the same horse looks the same on every replay, and weighted the way a real field looks (mostly bay and chestnut, with the grey and the black as the two that catch the eye). Bays and blacks get black points on mane, tail and lower legs. A field of 24 identical brown horses was the single most artificial thing about V1.
- **Articulated legs** — forearm / cannon / hoof, with a real hock angle on the hind pair: the hock kicks backward behind the quarters and the cannon runs down and forward. Drawn as a straight line a leg reads as a stick. The off-side pair is drawn first, darker and at lower alpha, so the near pair reads in front of it.
- **A gallop cycle** — the 4-beat transverse gallop, with legs animated by a phase offset per horse. Adjacent horses get slightly different cycles so they don't visually sync ("lane jitter + stride variance").
- **A saddle cloth with the runner's number** — where the number lives on a real racecourse. This is the quiet identification the brief asked for: it travels with the horse and needs no floating chip.
- **A jockey in the runner's real silks** — the crouch is a `Path2D` that the runner's actual `silk_pattern` (hooped / striped / halved / quartered / starred / solid) is clipped into, so the rider matches the racecard, the leaderboard cap and the podium.
- **Micro-motion** — a body roll and a head nod driven off `swayPhase`, a couple of degrees and a couple of pixels. Not visible as an effect; very visible by its absence.
- **Depth** — runners are scaled by their lane's distance from the camera and drawn far-lane-first, so the pack overlaps and occludes the way a real field does.
- **Hoof dust** — divots kicked up at each ground-contact beat, spawned and drawn in *world* space so the camera leaves them behind.

**Three things V1 attached to the horses are gone, and should stay gone.** They are the main reason the old scene read as a browser game:

- **Sprite trails.** `drawSpeedLines()` is deleted. Speed now comes from parallax planes moving past a broadly stationary pack, which is how a real camera shot reads. Streaks welded to a sprite read as an arcade effect.
- **Persistent labels.** No name chip, no rank pill on any runner at any point. See § 6.8.
- **Highlight rings.** No pulsing gold ring, no radial aura around the leader or the viewer's pick.

**Level of detail.** Below `scale >= 0.72` — a phone, or a runner against the far rail — the eye glint, the bridle, the goggles, the cheek plane and half the mane strands are sub-pixel, and across 24 runners they cost real time. The `detail` flag drops them. The silhouette, the coat, the silks and the number always draw, because those are what carry at any size.

Two traps worth not repeating, both of which turned the animal into an unreadable dark mass on earlier passes: filling the head in the shade colour rather than the coat colour, and running the mane strokes over the poll. A horse without a readable head does not read as a horse.

The most valuable levers for a designer looking at horse aesthetics:
- `drawHorseSilhouette()` — the anatomy itself.
- `HORSE_COATS` / `coatFor()` — the palette and how often each colour comes up.
- `_spawnHoofDust()` — density, size and colour of the divots.

### 6.7 Parallax — seven depth planes

The horses barely move on screen. What moves is the world, and the difference in scroll rate between these planes is what sells the speed.

| Rate | Plane | Surface |
|---|---|---|
| 0.00 | sky + sun haze | `#particleCanvas` |
| 0.06 | distant downland | `#particleCanvas` |
| 0.17 | grandstand + crowd | `#particleCanvas` |
| 0.34 | treeline / hedge | `#particleCanvas` |
| 0.68 | rail-side spectators, running rail + advertising boards | `#raceCanvas` |
| 1.00 | the turf the race is run on | `#raceCanvas` |
| 1.32 | foreground grass, in front of the field | `#raceCanvas` |

The repeating planes are pre-painted into offscreen tiles once per resize and blitted after that — repainting a grandstand from paths every frame is the kind of thing that quietly costs 4ms.

**The crowd is two separate planes, and it needs to be.** The grandstand tile (0.17) seats its crowd in rows on a raked terrace, each spectator a head and a pair of shoulders, densest at the front and thinning toward the back — which is both how a stand fills up and what makes it read as people rather than as texture. But a stand on the horizon is scenery; what makes a racecourse feel attended is people close to the action, so `TILES.railCrowd` puts a row of spectators right behind the running rail at 0.68, with the advertising boards drawn in front of them so the boards cut them off at the waist the way a real one does. The rail crowd is scaled by `WORLD.horseScale`: they are people standing next to horses, so on a phone they have to shrink by the same factor the horses do.

Two gotchas if you add a plane:

- A plane drawn **inside** the world transform lands at rate 1.0. To get rate `f`, shift it by `CAM.x * (1 - f)` and offset your draw range by the same amount (`drawFarRail()` is the worked example).
- A plane drawn **outside** the world transform has to put the horizon where the world transform would, or the turf climbs over the sky the moment the camera tightens. `worldToScreenY()` exists for exactly that.

### 6.8 Broadcast identification

The replacement for V1's floating name chips. A lower-third slides in from the left, names one runner, and leaves — the way a director cuts to a name super when there is something worth saying about a horse. Four in a whole race, ~2.6s each, scheduled as `.call()` beats on the master timeline and resolved against the live order at the moment they fire:

| At | Who | Tag |
|---|---|---|
| 10% | the leader | LEADS |
| 52% | the viewer's pick, else the Fox pick, else third | YOUR PICK / FOX PICK / IN TOUCH |
| 79% | the leader | IN FRONT |
| 94.5% | the runner in second | CLOSING |

While a runner is named, a short bar in their own silk colour is drawn on the turf beneath their hooves. The viewer's pick and the Fox pick carry a quieter permanent version of the same mark. That bar is deliberately the least emphatic mark that still works: an ellipse or a glow around the animal is the arcade treatment we removed, and a floating chip is the label we removed.

The element is created from JS, not declared in `index.html`, so nothing has to move into the Django template (see § 10).

### 6.9 The ambient backdrop

The race screen has an entire racecourse behind it. Every other screen was flat black, so the experience read as five separate web pages rather than one afternoon at the track — and the cut from the parade into the race was a cut from a void into a world.

`drawAmbient()` paints a slow, dimmed, defocused version of the **same** parallax world behind the content screens: the same tiles, the same planes, a fraction of the speed, under a scrim heavy enough that type stays legible. It draws on `#particleCanvas`, which already sits behind every screen, and `ambientFrame()` stands down the instant `raceRunning` goes true and the race takes the canvas over.

Two things this depends on:

- **The content screens have to be translucent.** `#screen-intro`, `#screen-parade`, `#screen-rollcall` and `#screen-reveal` are `rgba(6,8,15,0.34-0.40)` rather than solid `var(--dark)`. Make one of them opaque again and the backdrop silently disappears behind it.
- **It runs on `gsap.ticker`,** the same clock as the race renderer, added once in `init()`. Measured cost is negligible (well under a tenth of a millisecond a frame at 1440×860) because it is three tile blits and four gradients. Under `prefers-reduced-motion` it paints once and stops.

### 6.10 Sim vs replay

The single most important branch in `flat.js` is inside `buildRacePositions()`, which decides the finishing ORDER, and `finalLengthsFor()`, which decides the GAPS. Both branches produce the same output shape, so everything downstream is agnostic.

```
// ORDER  -- buildRacePositions()
if (REPLAY_DATA && REPLAY_DATA.has_result) {
   ordered = result_order.map(id => runner)      // the real result
} else {
   winner  = weightedRandom(runners)             // a weighted draw
   ordered = [winner, ...rest sorted by jittered weight]
}

// GAPS  -- finalLengthsFor(runner, rank), in real horse lengths
if (REPLAY_DATA.has_distances) {
   lengths = lengths_behind_winner[runner.id]    // the real margin
} else {
   lengths = band * 0.42 * rank^1.45 + jitter    // a plausible fan-out
}
```

The engine then runs the same model, the same camera and the same timeline for both paths.

**Why `rank^1.45` and not `rank`.** A linear fan-out finished second a length and a half back and eighth eleven lengths adrift, which is a procession — and it made Skip to Finish drop you into a race that was already decided. Real fields do not spread linearly: the placed horses finish close together and the tail strings out behind them. The exponent gives that shape, under half a length back in second while still leaving thirty-odd for the back markers.

**The finish duel.** `buildHorseObjects()` gives the second and third runners a surge timed at the top of the straight, sized off their final margin, which all but wipes out their deficit so they draw upsides the leader. Because it rides on the ordinary surge machinery — and `surgeWeight` collapses to zero over the last 8% — the margin the payload specifies is still exactly what gets drawn at the line. The closing sequence of a typical race now runs: level at 79%, winner a half-length up at 87%, level again at 93%, winner asserting to the true margin by the line.

It is **capped at 3.5 lengths**, and that matters. Sized purely off the final margin, a thirteen-length runaway would have the runner-up close the whole way and then shed it again in the last few strides — which reads as the second horse stopping rather than the winner going away. The cap makes a close race a question without rewriting a one-sided one: `race-runaway` still finishes with the winner alone and thirteen clear. The user cannot tell from the animation itself which mode is active — that's the point.

`replay_data.has_distances = false` puts the replay path into a hybrid mode: the winner and finishing order are honoured, but per-horse gaps are invented (the runaway fixture is this case).

---

## 7. Visual layer

CSS lives in two files that split responsibilities on subject, not scope:

### `css/experience.css` (shared cinematic chrome)

- Screen layout — every `.screen` positioning, fade behaviour, active state, **and the rule that lets a screen scroll itself**. Every screen is a fixed, full-viewport pane and the body never scrolls, because the race is a canvas that has to fill the window. The content screens (intro, roll call, reveal) are ordinary stacked content though, and at a small window, a high browser zoom or a short landscape phone they are simply taller than the pane — at which point `overflow: visible` on a fixed element put the overspill somewhere no scrollbar on the page could reach it. `.screen` is now `overflow-y: auto` with `justify-content: safe center`; the `safe` half matters just as much, because plain `center` on an overflowing flex column pushes the first child off the *top* of the scroll box, where a scrollbar cannot reach it either. `#screen-race` opts out — it is a full-bleed canvas and must never scroll.
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
- **V2 broadcast chrome**, in a block at the end of the file:
  - `.bcast-id` — the lower-third that replaced the on-canvas name chips
  - `.race-result` — the card shown after the pause at the line
  - `.race-lb-row.is-climbing / .is-falling` — the direction tint on a
    leaderboard row that has just gained or lost places
  - `#screen-race[data-race-phase="..."]` — chrome that steps back as the
    camera closes in
  - `#screen-race { background: transparent }` — the race screen has to be
    see-through so the parallax backdrop drawn on `#particleCanvas` (below it
    in the stacking order) is visible

**Rule of thumb**: if a style would apply equally well to a jumps race (Grand National, Cheltenham), it belongs in `experience.css`. If it's specific to the flat-race visual grammar (stalls, band pills, photo-finish flash), it belongs in `flat.css`.

The parent body carries a state class the CSS reads: `body.page-experience--sprint / --mile / --stayer`. That class is set by `boot()` in `index.html` from `payload.band` and drives palette variations across both stylesheets.

---

## 8. GSAP orchestration

GSAP (self-hosted at `js/vendor/gsap.min.js`) drives the screen transitions and the choreography inside each screen, as it always did. What changed in V2 is that it also drives the race scene.

### 8.1 One timeline owns the race

`buildMasterTimeline()` returns a single `gsap.timeline()` that is the only clock in the race. It owns:

- race progress (`DIRECTOR.progress`, tweened 0 to 1 with `ease: 'none'`, so timeline time and progress fraction are interchangeable)
- every camera parameter, one tween per phase, labelled `cruise` / `build` / `drive` / `line`
- the slow-motion ramp through the final furlong
- the scripted broadcast identifications, as `.call()` beats
- the cinematic pause at the line, via `onComplete`

Nothing else advances time. The canvas render loop reads `DIRECTOR` and draws; it never asks what o'clock it is.

Everything a frame needs lives on one object:

```javascript
const DIRECTOR = {
  progress, zoom, anchorX, camY, tilt, shake,
  vignette, groupBias, fieldFade, flash, phase,
};
```

Read that declaration top to bottom and you have the entire visual state of the race at any instant. Every field on it is written by GSAP and never by hand inside the frame loop.

### 8.2 Why this shape

Three things fall out of it for free, and each was a bug or a limitation in V1:

- **Skip-to-finish is one `seek()`.** Because the timeline owns progress *and* the camera *and* the phase, seeking lands all of them in a consistent state. V1 had a second clock (`raceTime`) that had to be nudged by hand, plus an `raceTimeAccel` end-rush hack to stop the cinematic dangling.
- **Slow motion is `timeScale`, not a special case.** We slow the clock, not the horses, so commentary, leaderboard cadence and gait all stretch together. The ramp is tweened from inside a `.call()` so the tween driving `timeScale` is not itself being scaled by the value it is changing.
- **Teardown is total.** `replayExperience()` kills `masterTL`, `finishTL` and any tweens on `DIRECTOR` and on the horse objects *first*, then resets state. Reset a director while a timeline is still alive and the next tick simply writes the old values back.

### 8.3 The final furlong

`addFinalFurlongSequence()` is its own sub-sequence rather than "more of the same, faster": the camera drops to the rail and closes down onto the two or three runners that can still win, the world goes into slow motion, and the winning post comes into shot from the right for the first time in the race. In V1 the finish line was pinned at 94% of the viewport from the moment the gates opened, so the viewer stared at the destination for forty seconds; in V2 it lives at the far end of the world and is only drawn when it is genuinely in frame, which works out at roughly the last three seconds.

### 8.4 Crossing the line

`crossTheLine()` builds `finishTL`, in order:

1. A single frame of flash as the field hits the line.
2. **The run-out.** `DIRECTOR.runOut` tweens to `runOutLengths()` on a `power2.out`, and `updateRaceModel` adds it to the leader's travel. The whole field carries on past the winning post and decelerates, because horses do not stop dead on the line — and because the placed runners need somewhere to finish.

   The distance is measured **against the frame**, not fixed: `viewW / FINISH_ZOOM / WORLD.lengthPx × 0.55`, clamped to 4–12 lengths. Ten lengths is about half a desktop frame and reads perfectly, but on a 375px phone ten lengths is wider than the entire viewport — the winner and the whole field ran off the right-hand edge and the finish played to an empty screen. Desktop resolves to ~9.9, a phone to ~4.2.
3. **The camera opens up.** Through the final furlong the shot is tight on the leader; at the line it widens to zoom 1.08 and the focus falls back off the winner onto the group (`groupBias` → 0.1). This is the cut a broadcast director makes to show you the placings, and without it the winner runs on alone while everyone else finishes off-frame. `updateCamera()` also clamps the focus so the post stays at least 10% in from the left edge while `runOut` is non-zero — on a blanket finish the group centroid *is* the winner, so an unclamped camera follows them past the post and the line slides out of shot at exactly the moment the viewer wants it.
4. **A held shot.** Everything has settled; the camera drifts and nothing else happens. This pause is the whole point of the sequence; take it out and the finish reads as an animation ending rather than a race being won.
5. The result card, sized to the actual margin: PHOTO FINISH under a head, DEAD HEAT when the API says so, otherwise WINNER with the margin spelled out. It sits high in the frame (`top: 27%`) because the finish shot now has most of a field running through the middle of it.
6. Out to the roll call.

**Press flashguns.** The photographers are banked at the winning post, and the wall of flashguns going off as the field crosses is the single most recognisable image in racing. `DIRECTOR.pressFlash` ramps up through the final furlong on the master timeline and is faded out by `finishTL`; `spawnPressFlashes()` emits from it at a rate proportional to the intensity. Three things make them read as flashguns rather than fairy lights:

- They fire in the crowd **behind the far rail**, so the horses occlude them.
- Each lives about a sixth of a second on a squared decay — a flashgun is a hard pop, and a slow fade turns the finish into Christmas lights.
- The freshest ones get a short horizontal streak, because a bank of flashes reads as a line of light rather than a field of dots.

A capped screen-space bloom (`drawAtmosphere`) lifts the whole frame slightly while they are firing.

### 8.5 The leaderboard

Live Positions is animated, not rewritten. V1 wrote `row.style.transform` on every row on every frame and left a CSS transition to chase it, which produced a permanently in-flight panel where nothing read as a *change*. V2 samples the ranking a few times a second and only touches a row when its rank actually moves — at which point GSAP slides it, the position number flips, and the row briefly carries `.is-climbing` or `.is-falling` so the eye is drawn to the change rather than to constant motion. The CSS transition on `transform` was removed for the same reason: a transition and a tween on the same property fight, and the tween always lands late.

### 8.6 Elsewhere

Outside the race screen, GSAP is used as it was before:

| Phase | GSAP timelines |
|---|---|
| Intro | Kicker fade-in, title reveal, meta chip stagger |
| Parade | Per-horse entry (silk scale, name slide), skip button pulse |
| Race | Stalls BANG, plus everything in § 8.1-8.5 |
| Roll call | Per-row entry from off-screen right, position number count-up |
| Reveal | Trophy scale + glow, winner name slide-up, verdict box fade, podium row stagger, gold confetti, action bar entry |

**Reveal confetti** is DOM (`spawnRevealConfetti()`), not canvas, because the reveal screen sits above both canvases. Forty-four nodes, GSAP-driven, torn down by the last piece to land and again on `replayExperience()` so nothing accumulates across replays. This is the one place in the experience where confetti belongs — it was removed from the race itself, where it read as an arcade flourish over a sports broadcast.

**Intro runner chips** carry the runner's actual cap (`renderCapSvg`) rather than being text pills. Twenty-four names in a row is a list; twenty-four sets of colours is a racecard, and it primes the viewer for the silks they are about to follow.

### 8.7 prefers-reduced-motion

Two layers, and both matter:

- The engine short-circuits. `startExperience()` routes a reduced-motion visitor straight to `runStaticReveal()` — the settled result, no animated race. This is V1 behaviour and is unchanged.
- The race scene is hardened anyway, so nothing depends on that short-circuit holding. `SHAKE` is a flat `0`, so every camera-rumble tween multiplies out to nothing; the slow-motion ramp is skipped; hoof dust and the foreground plane never spawn; the finish drift is zero. `css/flat.css` carries a matching `@media (prefers-reduced-motion: reduce)` block for the DOM chrome.

---

## 9. Sandbox ↔ production divergence

This sandbox is designed to feel identical to production so you can iterate confidently, but three things are different. When you PR your changes, flag these separately:

| Difference | Sandbox | Production | If you change it |
|---|---|---|---|
| Bootstrap | `index.html` static file, `fetch()` a JSON fixture | Django template server-renders payload + `#replayData` | HTML structure changes need a template task in the main repo. Vas moves the change into `cinematic/templates/cinematic/flat.html` |
| Data source | Three static fixtures in `data/` | Live race data from the app's DB + Racing API sync | Data-shape changes need a matching Python model/serializer change in the main repo |
| GSAP + flat.js load | Dynamic `<script>` injection after `#replayData` is in place | Static `<script src>` tags in `<head>` (server has already rendered `#replayData`) | Don't undo the dynamic pattern in the sandbox — it exists to defend against a specific bug. Production doesn't need it |
| Nav bar | None. `index.html` sets `:root { --nav-h: 0px }` | A real 60px site nav; `base.css` sets `--nav-h` | Sandbox-only. `experience.css` keeps a `var(--nav-h, 60px)` fallback so that if the variable ever went missing in production the experience would not slide up underneath the nav |
| Asset caching | `index.html` stamps `?v=<timestamp>` onto the stylesheets and the engine scripts | Django asset versioning | Sandbox-only, and it must not be copied. `python -m http.server` sends no `Cache-Control`, so without it browsers heuristically cache `flat.css` and `flat.js` and you review code you edited ten minutes ago |
| Scenario picker | `.sandbox-picker`, styled entirely inside `index.html` | Not present | Keep its styling in `index.html`. Positioning it from `flat.css` does not even work — the inline `<style>` block comes after the stylesheet links and wins |

Everything under `css/`, `img/`, and `js/flat.js` translates directly. Copy the file, done.

---

## 10. Extension patterns

Common jobs you might take on and where they belong.

### Change how a horse looks

`js/flat.js` → the `THE HORSE` section, `drawHorseSilhouette()`. Also `_spawnHoofDust()` for the divots. Please do not reintroduce trails, rings or floating labels on the animals (§ 6.6).

### Change the camera

`js/flat.js` → the `MASTER TIMELINE` section. Each of the four phases is one tween on `DIRECTOR`; change the numbers there rather than reaching into `updateCamera()`, which only damps toward whatever the director asked for. The follow feel itself is `CAM_FOLLOW_TAU_MS` in the `VIRTUAL CAMERA` section.

### Change how the world looks or how fast it moves

`js/flat.js` → the `PARALLAX` section for the backdrop planes and their scroll rates, `TRACK PLANE` for the turf, rail, furlong markers and winning post. Read the two gotchas in § 6.7 before adding a plane.

### Change how spread out the field is

`js/flat.js` → the `RACE MODEL` section. `finalLengthsFor()` decides where each runner ends up, `paceBiasFor()` decides the shape of their race, and `WORLD.spreadScale` pulls the field in on narrow viewports so a phone does not show four horses and a lot of grass.

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
- **`raceCanvas` and `particleCanvas` carry different planes.** `particleCanvas` sits *below* the race screen in the stacking order, so V2 gives it the backdrop: sky, downland, grandstand, treeline. `raceCanvas` carries the track plane, the field and the foreground. That is also why `#screen-race` has to be transparent — an opaque race screen hides the backdrop entirely, which is what happened in V1 and why nobody ever saw the hoof dust.
- **The master timeline is the only clock.** There is no `raceTime`, no private `requestAnimationFrame` and no wall-clock arithmetic in the race scene. `renderFrame()` runs on `gsap.ticker` and reads `DIRECTOR`. If you need something to happen at a moment in the race, add a tween or a `.call()` to the timeline — do not add a `if (progress > x)` branch to a draw call.
- **Positions are smoothed, and it is the *deficit* that is smoothed.** Smoothing an absolute position would leave every runner, the winner included, short of the line at the finish. See § 6.4.
- **`startRace()` is idempotent.** The parade can hand off twice if the skip button is pressed while its fade-in tween is still running. Without the guard that builds a second master timeline, and two timelines both tweening `DIRECTOR.progress` fight each other for the rest of the race.
- **A `seek()` needs a `snapRaceState()`.** After skip-to-finish the model and the camera are both many seconds behind where the clock now is; left alone the exponential smoothing would spend a second visibly sliding everything into place.
- **`finalLengthsFor()` reads `runner.id` as a string** into the `lengths_behind_winner` lookup — the fixtures use string keys deliberately (JSON keys can't be numbers). If you add fixtures, keep this convention.
- **Real distances are capped at `MAX_VISIBLE_LENGTHS` (46).** A Racing API "distance" beaten would otherwise put the tail of the field two full screens behind, which costs render time for horses nobody can see.
- **`WORLD.spreadScale` is a lens, not a lie.** On a narrow viewport the field is pulled in so a phone does not show four horses and a lot of grass. Finishing order and relative gaps are untouched; only the overall fan-out is scaled.
- **The camera has a hard floor that keeps the leader in frame.** On a runaway the group centroid sits thirty lengths behind the winner. Honouring it faithfully would mean filming the horses that lost.
- **`getNavH()` cannot use `||` for its fallback.** It reads `--nav-h` and falls back to 60px when the variable is absent — but `parseInt('0px') || 60` is `60`, so a page that legitimately has no nav bar still had 60px carved off the bottom of the canvas and a dead band across the top of every screen. It tests `Number.isFinite` instead. Any other zero-valued CSS variable read this way has the same trap.
- **A resize is not free during a race.** Reallocating the canvas backing store clears it, and runner positions are stored in lengths but `CAM.x` is world *pixels* — so `resize()` rescales the camera by the change in `WORLD.lengthPx` and repaints once. Without the rescale, a browser zoom mid-race leaves the camera pointing at empty track while the field jumps somewhere else.
- **The Fox overlay** (a small avatar that appears with certain race narratives) is a DOM element the race screen manages, not a canvas draw. Look for `fox` in `flat.js` for the trigger logic.

---

## 12. Where to start on a first task

If you're picking up work fresh:

1. Run `python serve.py` and watch `race`, then `race-close-finish`, then `race-runaway` end-to-end. Understand what changes between them. (Use `serve.py` rather than `python -m http.server` — it disables caching, without which the browser will happily serve you a stale engine while you wonder why your change did nothing.)
2. Open `js/flat.js` and scan the section headers (they're commented every ~50 lines). You don't need to understand every function — just know where each concern lives.
3. Pick something small first — a colour tweak, a font-weight change on the reveal screen, a slight change to the speed lines. Ship it as a scoped PR. Vas will merge and integrate to production, and you'll see the shape of the review loop.
4. From there, take on bigger visual work.

**Golden rule**: if you find yourself wanting to change something in `data/*.json` or `index.html` to make your visual change work, stop and ask. Data-shape changes and structural changes need to land in production template + Python code, so they're separate PRs with different reviewers.

For anything visual — colours, motion, geometry, layout, typography, silks — you're in charge. That's what this sandbox is for.
