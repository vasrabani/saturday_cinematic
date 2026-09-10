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
6. `flat.js` reads `#replayData` synchronously into a top-level `const REPLAY_DATA` (`REPLAY_DATA`, near the top of the race-model section).

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
PARALLAX — DEPTH PLANES          scenery tiles, clouds, drawBackdrop()
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
CROSSING THE LINE                the flash, the run-through, the result card
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

Each phase's entry function does the work: `beginParade()`, `startRace()`, `runRollCall()`, `runReveal()`. There's no formal state machine library — the transitions are hardcoded at the end of each phase (parade ends → `transitionToRace()`; race ends → `runWinningMoment()` → `runRollCall()`; etc.). Simple and readable; hard to accidentally skip a phase.

The `#skip` buttons on each screen fast-forward to the next phase and are also allowed to short-circuit long GSAP timelines.

**A second, finer state machine runs inside the race screen.** `RACE_PHASES` describes how the *camera* behaves as the race develops:

```
'cruise' (0%)  →  'build' (45%)  →  'drive' (72%)  →  'line' (90%)
```

- **Cruise** — wide, level, unhurried. The whole field is legible and the camera keeps the principal group near the centre of frame with track ahead of them.
- **Build** — the camera starts taking a side. Framing tightens onto the front half of the field; the ground moves faster past it.
- **Drive** — down onto the principal group. Back markers recede, the camera drops and begins to breathe with the gallop.
- **Line** — the dedicated final-furlong sequence. The camera frames the leader on the right with the chasing pack filling the shot behind him (seven to nine horses in frame, the duel among them), the world goes into slow motion, and the winning post comes into shot for the first time.

Each phase is one GSAP tween on the `DIRECTOR` object; the boundaries are labels on the master timeline. The active key is mirrored onto `#screen-race` as `data-race-phase`, which is how CSS reacts to it.

These are deliberately **separate** from `BAND.phaseTable`, the seven editorial beats ("SETTLING DOWN", "TWO FURLONGS OUT") that editorial tunes in the seed JSON and that still drive the on-screen title and phase strip. Direction and copy change independently.

### 6.3 The DOM ↔ phase mapping

| Phase | Screen div | Primary content |
|---|---|---|
| `intro` | `#screen-intro` | Race title, meta chips (course/time/distance/runners), band pill, hero copy, static preview of the field |
| `parade` | `#screen-parade` | One horse at a time walks across `#paradeStage`. `#paradeCounter` updates, `#paradeDots` shows progress |
| `race` | `#screen-race` | Two `<canvas>` elements (backdrop planes on `#particleCanvas`, track + field + foreground on `#raceCanvas`), plus DOM overlays: `#raceLeaderboard` for live positions, `#racingCommentary` for spoken beats, and two elements the engine injects at runtime — `.bcast-id` (broadcast identification), `.race-result` (the card after the line) and `.win-moment` (the Winning Moment card, § 8.4c). The legacy `#flatPhotoFinish` element is left in the markup and never activated |
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

**No horse gallops more than 22% faster or slower than the leader** (`REL_SPEED_CAP`). Every move in the race is a change in a horse's deficit, and the rate a deficit may change at is capped at that fraction of the leader's own travel that frame — so it slows down in slow motion along with everything else. Before the cap the fastest surges moved a horse 4.7 lengths a second against the leader while the field itself was galloping at 3.8: for a moment that horse was travelling *backwards* over the turf, which is what read as horses being shoved about. A horse losing ground is now a horse galloping at eighty per cent, which reads as tiring. Surges were lengthened to match (`SURGE_MIN_SPAN`, at least 14% of the race), so the cap rarely has to bite. The race also no longer leaves the stalls at full speed: `raceProgressEase` accelerates the field over the first 4% of the race (about 1.8s), continuous in value and slope so there is no jolt when it ends. Skip to Finish still lands in one step — `snapRaceState()` bypasses the cap.

**The camera follows the race.** `principalGroupFocus()` returns a point somewhere between the centroid of the front 40% of the field and the leader on their own; `DIRECTOR.groupBias` slides between the two as the race develops. `updateCamera()` damps `CAM.x` toward that focus, so the camera never snaps and never overshoots into a visible wobble. A hard floor keeps the leader inside the frame no matter what — on a runaway the centroid sits thirty lengths behind the winner, and a camera that honoured it faithfully would spend the closing stages filming the horses that lost.

**From the drive onwards the shot must hold the leader and the next seven** (`FRAME_PACK`). When the field is too strung out for the director's framing to do that, `updateCamera()` goes wider — down to `ZOOM_FLOOR` (0.9) — and centres on the group from the leader back to the eighth horse, eased in as the pack stops fitting so there is never a snap between the two framings. If even the widest shot cannot hold them all, the leader wins: he is kept inside 84% of the frame and the tail goes off the left. It never engages on a close race; on `race-runaway` it is the wide shot of the winner thirteen clear with the field toiling behind him, seven horses in frame instead of two.

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
y = -33   top of the jockey's cap
y = -15   withers / topline
y =  +3   belly (tucked up)
y = +28   ground line
x = -40   tip of the streaming tail
x = -21   point of buttock
x = +55   muzzle
```

That span is what makes `HORSE_ART_LENGTH` the definition of a "length" everywhere else in the engine — get the drawing's proportions wrong and every gap the Racing API gives us is drawn at the wrong size.

**The legs are a rig, not an animation.** This is the single change that most separates a real-looking horse from a drawn one. Each hoof follows a gallop path — planted and sweeping back through the stance, then lifting, folding and reaching forward through the swing (`hoofPath()`) — and the knee or hock between the leg's root and its hoof is *solved* from where the hoof is, with two-bone inverse kinematics (`solveLeg()`). So the foreleg folds hard at the knee as it comes through, the hind leg tucks up under the belly, and a planted hoof stays planted while the body travels over it. A leg that is animated as an angle swings like a stick however carefully the angles are chosen.

The gait is a transverse gallop, four footfalls then a moment of suspension (`GAIT`, `STANCE`):

```
far hind 0.00 → near hind 0.10 → far fore 0.29 → near fore 0.40
each hoof down for 0.19 of the cycle; all four off the ground 0.59 → 1.00
```

A racehorse at full gallop has each foot on the ground for about a fifth of the stride, and it matters for more than accuracy — see below. `_spawnHoofDust()` fires on the same four footfalls, so the divots come off the hooves that are actually on the ground. The ground target is expressed in the body's *pitched* frame, so the hooves don't skate while the body rocks.

**The gait is driven by distance, not by time.** A planted hoof sweeps `STRIDE_SWEEP` (19.5 units) back under the body while it is down, so for it to stay where it was planted, one gait cycle has to carry the horse exactly `STRIDE_LOCAL` = `STRIDE_SWEEP / STANCE` of its own units — about 1.4 lengths — at whatever scale it is drawn. `placeHorse()` advances `legPhase` by the distance the horse actually travelled that frame over that stride, so cadence follows ground speed exactly: in slow motion the legs slow with the travel, a horse pulling up after the line canters, and the smaller horses in the far lanes take proportionally quicker strides. It used to be tied to the clock, at nearly the same rate whatever the horse was doing, and the hooves slid over the turf everywhere — the horses covered 1.5 lengths a stride on legs drawn for 0.7, worst of all in slow motion, after the line (when the field stopped dead with its legs still going) and in the far lanes. With a stance of 0.36 the stride needed for planted hooves would have meant five strides a second; 0.19 gives 2.7 at race speed, which is about what a racehorse does. The Winning Moment uses the same rule the other way round: the turf is scrolled one stride per cycle at hero scale.

**The stride moves the whole animal.** The body rises through the suspension and drops as the forelegs take the weight; it pitches nose-up as the hinds drive and nose-down as the fores land; and the neck and head, drawn as one group pivoting at the withers, nod against that. **The jockey rides it**: his group counter-rotates and counter-lifts, so his upper body stays level while the horse moves under him. That is what makes a rider look like he is riding rather than glued on.

Each horse has:

- **A coat** — `coatFor()` gives each runner a bay / dark bay / chestnut / liver chestnut / black / grey, hashed from the runner id so the same horse looks the same on every replay, and weighted the way a real field looks (mostly bay and chestnut, with the grey and the black as the two that catch the eye). Bays and blacks get black points on mane, tail and lower legs; greys get dapples. A field of 24 identical brown horses was the single most artificial thing about V1.
- **Markings** — `markingsFor()` gives about a third of horses a star, stripe or blaze and about a fifth of legs a white sock, from the same id. Note the `_mixHash()` step: runner ids are short (`"12"`, `"1043"`), so the high bits of the raw string hash are always zero, and reading markings straight off it gave every horse in the field identical socks.
- **Volume** — the coat is lit: warm along the topline with a rim of sunlight, sheen over the quarters and shoulder, dark under the barrel, creases at the stifle and behind the elbow. Forearm and gaskin are tapered muscle shapes (`drawLimb()` / `taper()`), not strokes, with joint bulges at knee, hock and fetlock, a pastern sloping into the hoof, and a tendon line down the back of the cannon. The far-side legs are drawn first in the shade colour so the near pair reads in front of them.
- **A head that reads** — a long wedge with a round jowl, a straight face, flared nostril (more so in the final furlong), pricked ears, an eye with a catch-light, and the throatlatch shadow that separates head from neck. A bridle with noseband and reins running back to the jockey's hands.
- **Racing tack** — number cloth under a small racing saddle, a girth and a breastgirth. The number is where it lives on a real racecourse, which makes it the quiet identification the brief asked for: it travels with the horse and needs no floating chip.
- **A jockey who is a jockey** — short irons with the stirrup leather visible, knee up at the withers, white breeches and black boots with tan tops, a flat back, arms down the neck to the reins, a silk-covered helmet with goggles. The torso is a `Path2D` that the runner's actual `silk_pattern` is clipped into, sleeves in the secondary colour, so the rider matches the racecard, the leaderboard cap and the podium. Through the final furlong his hands pump with the stride and the whip comes up.
- **Depth** — runners are scaled by their lane's distance from the camera and drawn far-lane-first, so the pack overlaps and occludes the way a real field does.
- **Hoof dust** — divots kicked up at each footfall, spawned and drawn in *world* space so the camera leaves them behind.

**Shading is cheap because the gradients are cached** (`horseGrad()`). A canvas gradient is defined in user space and read through whatever transform is current when it is used, so one gradient in local horse coordinates serves every horse in every frame. Building them per horse per frame would be over a thousand allocations a second for nothing. Measured frame cost with the full field: about 5ms at 1440×860 with 16 horses on screen, about 4ms on a 375px phone.

**Three things V1 attached to the horses are gone, and should stay gone.** They are the main reason the old scene read as a browser game:

- **Sprite trails.** `drawSpeedLines()` is deleted. Speed now comes from parallax planes moving past a broadly stationary pack, which is how a real camera shot reads. Streaks welded to a sprite read as an arcade effect.
- **Persistent labels.** No name chip, no rank pill on any runner at any point. See § 6.8.
- **Highlight rings.** No pulsing gold ring, no radial aura around the leader or the viewer's pick.

**Level of detail.** Below `scale >= 0.72` — a phone, or a runner against the far rail — the catch-light, the bridle, the goggles, the sheen, the creases, the tendon lines and most of the mane and tail strands are sub-pixel, and across 24 runners they cost real time. The `detail` flag drops them. The silhouette, the coat, the silks and the number always draw, because those are what carry at any size.

Two traps worth not repeating, both of which turned the animal into an unreadable dark mass on earlier passes: filling the head in the shade colour rather than the coat colour, and running the mane strokes over the poll. A horse without a readable head does not read as a horse.

The most valuable levers for a designer looking at horse aesthetics:
- `drawHorseSilhouette()` — the anatomy itself.
- `hoofPath()` and the `leg()` calls inside `drawHorseSilhouette()` — stride length (`front`, `back`), how high each hoof lifts, and bone lengths. Change these and the gait changes; the IK keeps the joints honest.
- `HORSE_COATS` / `coatFor()` / `markingsFor()` — the palette, how often each colour comes up, and how common blazes and socks are.
- `_spawnHoofDust()` — density, size and colour of the divots.

### 6.7 Parallax — the depth planes

The horses barely move on screen. What moves is the world, and the difference in scroll rate between these planes is what sells the speed.

| Rate | Plane | Surface |
|---|---|---|
| 0.00 | sky + sun | `#particleCanvas` |
| 0.03 | high cloud (cirrus), plus wind | `#particleCanvas` |
| 0.045 | distant downland, two ridges | `#particleCanvas` |
| 0.07 | low cloud (cumulus), plus wind | `#particleCanvas` |
| 0.17 | grandstands, big screen, crowd | `#particleCanvas` |
| 0.34 | treeline | `#particleCanvas` |
| 0.68 | rail-side spectators, hoardings, running rail | `#raceCanvas` |
| 1.00 | the turf the race is run on | `#raceCanvas` |
| 1.32 | foreground grass, in front of the field | `#raceCanvas` |

The repeating planes are pre-painted into offscreen tiles once per resize and blitted after that — repainting a grandstand from paths every frame is the kind of thing that quietly costs 4ms. That is also what makes realism affordable: the stand tile holds tens of thousands of spectators, and the cost is paid once. Because the rebuild is now tens of milliseconds, `resize()` calls `scheduleTileRebuild()`, which debounces it until a window drag settles; the old tiles keep drawing in the meantime.

**Clouds move backwards past the field for two reasons at once.** They have a parallax rate like every other plane, and they also drift on the wind (`WIND`, screen px per ms), so the sky keeps moving even in a held shot. The low cumulus drifts faster than the high cirrus, which gives the sky its own depth. The sun sits at parallax zero — it is at infinity — so the clouds sail across it, and its glow is drawn *after* the clouds with a `screen` blend so a cloud passing it picks up a bright rim instead of simply blotting it out. The clouds sit behind the downland, so the ridge cuts off their bases.

**Each plane takes only part of the camera's zoom** (`PLANE_ZOOM`). An optical zoom magnifies everything equally, but this camera behaves like a dolly-in: pushing toward the track makes near planes grow much faster than far ones. Scaling the whole backdrop by the full zoom flattened the scene and, in the tight phases, pushed the grandstand roof up over the entire sky. The bottom anchor of each plane still comes from the full-zoom horizon, so nothing opens a gap against the turf — only the plane's *height* and scroll take the reduced scale.

**Why the scenery used to look like a cartoon, and what fixed it.** Flat fills, hard edges and regular repetition. Every tile painter now does four things:

- *Lighting.* A consistent sun, upper right. Cloud billows have their hot spot pushed toward it; tree clumps are shaded by where they sit in the crown; the stand's fascia is sunlit while everything under the roof is in deep shade.
- *Irregularity.* The crowd is a textured mass — mostly dark and neutral clothing, uneven spacing, empty seats showing through, riser shadows under each row, aisles cutting through — not neat heads on neat shoulders in neat rows.
- *Aerial perspective.* `hazeTile()` lifts and blues each far plane a little, and `paintHorizonHaze()` lays moisture over the base of the stands. A grandstand three furlongs away is not as contrasty as the horse in front of you.
- *Depth of field.* `softenTile()` blurs the far planes slightly behind the pin-sharp field. It blurs a copy laid out three tiles wide and keeps the middle third, so edges blur into the next repeat rather than into transparency — otherwise every tile join shows as a faint seam. Where `ctx.filter` is unsupported the tile is used as painted.

The grandstand tile is also one composed skyline rather than one stand repeated: a cantilevered main stand with flags, a glazed hospitality level and a sunlit lower tier; an older stand with a slate roof, a clock pediment and white cast-iron columns; and a big screen showing the race.

**The crowd is two separate planes, and it needs to be.** The grandstand tile (0.17) seats its crowd on raked terraces, sunlit in the lower tier and in deep shade under the roof. But a stand on the horizon is scenery; what makes a racecourse feel attended is people close to the action, so `TILES.railCrowd` puts a row of spectators right behind the running rail at 0.68, with the advertising boards drawn in front of them so the boards cut them off at the waist the way a real one does. The rail crowd is scaled by `WORLD.horseScale`: they are people standing next to horses, so on a phone they have to shrink by the same factor the horses do.

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
   lengths = inventFinishGaps(positions)[rank]   // a close finish, invented
}
```

The engine then runs the same model, the same camera and the same timeline for both paths.

**Invented gaps are a close finish.** When the payload has no per-horse distances (a forecast, or a result whose `lengths_behind_winner` is empty, like the default fixture), `inventFinishGaps()` builds them as a running total of the gap from each horse to the one in front: the winner wins by the result's real winning margin where there is one (`beaten_distances` of the runner-up — a head in the default fixture) and by a short head to a neck where there is not; second to eighth are each a quarter to three quarters of a length behind the one in front; only from the ninth does the tail string out. That puts second and third within a length, nine horses inside about four lengths — all in the final shot — and the back markers still twenty-odd lengths adrift. Built as a running total, the jitter can never contradict the finishing order.

It used to be a power law — `0.42 × rank^1.45`, then `0.36 × rank^1.35` — on the reasoning that real fields string out. They do, but it put the fourth two and a half lengths back and the ninth seven or more, and because the chasing pack's surges fade out over the last 8% of the race, the pack visibly fell away from the winner in the final strides: the finish read as one horse winning easily, which is the opposite of what the viewer wants from it. Real distances, where the payload has them, are still drawn at their true size.

**The finish duel.** `buildHorseObjects()` gives the second, third and fourth runners a surge timed at the top of the straight, sized off their final margin, which wipes out most of their deficit so they come upsides the leader. The runner-up goes further than level: his surge carries an extra `DUEL_HEAD_IN_FRONT` (0.3 lengths) and his `duelFloor` lets his deficit go that far negative, so for a few strides he has his head in front and the leaderboard shows him leading — then the winner fights back. That is the only time a deficit may go below zero. Because it all rides on the ordinary surge machinery — and `surgeWeight` collapses to zero over the last 8%, taking `duelFloor` with it — the finishing order and the margins the payload specifies are still exactly what gets drawn at the line. The duel surges peak at 95–97% of the race, so the lead is still changing hands a few strides out. After Skip to Finish the default fixture now runs: the runner-up in front from 85% to 97% with the winner a quarter of a length down and third within half a length, the winner getting back up at 97%, and a head in it at the line with nine horses inside four lengths. On the photo-finish fixture the lead changes hands the same way and the winner gets back up by the nose.

**The chasing pack closes too.** Fifth to ninth get a smaller surge through the final furlong — 40% of their margin, at most 2.6 lengths — so the last shot is a charging field rather than three horses and a lot of grass, and they fade back to their true margins with everything else by the line.

**The duellers get lanes with daylight between them.** Lanes are otherwise shuffled, and left to the shuffle the winner and the runner-up were often in neighbouring lanes, drawn one over the other — a nose-to-nose duel read as one horse out on its own. `buildHorseObjects()` puts the first four at 18%, 40%, 62% and 84% of the way across the track, in a random order, so a close finish shows as a line of horses across the course.

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
- **The Winning Moment** (§ 8.4c): `.win-moment` and its three spans, and
  `#screen-race.is-winning-moment`, which fades the leaderboard, phase title,
  phase strip, skip button and lower-third out of the hero shot
- **Intro typography**, the last block in the file: the first page's type,
  matched to the V16.1 delivery (`saturday_cinematic_v2`) — a smaller,
  balanced title, the lighter italic "The Virtual", a coral kicker, the band
  subtitle in Playfair Display italic, smaller and more tracked meta, chips,
  button and caption. Type only; the layout is ours. Everything is scoped
  to `.page-experience--flat #screen-intro`, so no other screen moves. The
  caption under the button carries an inline style in `index.html`, so its
  three rules are `!important`

**Rule of thumb**: if a style would apply equally well to a jumps race (Grand National, Cheltenham), it belongs in `experience.css`. If it's specific to the flat-race visual grammar (stalls, band pills, photo-finish flash), it belongs in `flat.css`.

The parent body carries a state class the CSS reads: `body.page-experience--sprint / --mile / --stayer`. That class is set by `boot()` in `index.html` from `payload.band` and drives palette variations across both stylesheets.

---

## 8. GSAP orchestration

GSAP (self-hosted at `js/vendor/gsap.min.js`) drives the screen transitions and the choreography inside each screen, as it always did. What changed in V2 is that it also drives the race scene.

### 8.1 One timeline owns the race

`buildMasterTimeline()` returns a single `gsap.timeline()` that is the only clock in the race. It owns:

- race progress (`DIRECTOR.progress`, tweened 0 to 1 with `raceProgressEase` — an acceleration out of the stalls over the first 4%, then linear — so timeline time and progress fraction are interchangeable to within 2%)
- every camera parameter, one tween per phase, labelled `cruise` / `build` / `drive` / `line`
- the slow-motion ramp through the final furlong
- the scripted broadcast identifications, as `.call()` beats
- the cinematic pause at the line, via `onComplete`

Nothing else advances time. The canvas render loop reads `DIRECTOR` and draws; it never asks what o'clock it is.

Everything a frame needs lives on one object:

```javascript
const DIRECTOR = {
  progress, zoom, anchorX, camY, tilt, shake, vignette, groupBias,
  fieldFade, flash, filmRate, postHold, postFrame, pressFlash, letterbox, phase,
};
```

Read that declaration top to bottom and you have the entire visual state of the race at any instant. Every field on it is written by GSAP and never by hand inside the frame loop.

### 8.2 Why this shape

Three things fall out of it for free, and each was a bug or a limitation in V1:

- **Skip-to-finish is one `seek()`.** Because the timeline owns progress *and* the camera *and* the phase, seeking lands all of them in a consistent state. V1 had a second clock (`raceTime`) that had to be nudged by hand, plus an `raceTimeAccel` end-rush hack to stop the cinematic dangling.
- **Slow motion is `timeScale`, not a special case.** We slow the clock, not the horses, so commentary, leaderboard cadence and gait all stretch together. The ramp is tweened from inside a `.call()` so the tween driving `timeScale` is not itself being scaled by the value it is changing.
- **Teardown is total.** `replayExperience()` kills `masterTL`, `finishTL`, `winTL` and any tweens on `DIRECTOR` and on the horse objects *first*, then resets state. Reset a director while a timeline is still alive and the next tick simply writes the old values back.

### 8.3 The final furlong

`addFinalFurlongSequence()` is its own sub-sequence rather than "more of the same, faster": the camera drops to the rail and frames the leader on the right of the shot (`anchorX` 0.62, `groupBias` 1, zoom 1.36) with the chasing pack filling the frame behind him — seven to nine horses, with the duel for the lead among them — the world goes into slow motion, and the winning post comes into shot from the right for the first time in the race. It used to close down onto the two or three runners that could still win, which left the finish looking like one horse on its own. In V1 the finish line was pinned at 94% of the viewport from the moment the gates opened, so the viewer stared at the destination for forty seconds; in V2 it lives at the far end of the world and is only drawn when it is genuinely in frame, which works out at roughly the last three seconds.

### 8.4 Crossing the line

`crossTheLine()` builds `finishTL`, in order:

1. A single frame of flash as the field hits the line.
2. **The run-through.** `beginRunThrough()` hands the field to its own model, `runThroughLine()`. Every horse keeps galloping at race speed until *it* reaches the line, then pulls up the way the winner did — its speed easing from race pace towards `EASE_TO` (42%) of it with a time constant of `EASE_TAU` (1.1s). The whole field runs the same curve, each horse starting it at its own moment, so every horse is still flat out as it crosses, nobody passes anybody, and the finishers bunch up as they pull up. Its clock is race time: `DIRECTOR.filmRate` holds the final furlong's slow motion for a beat on the line and then brings the playback back up to real time as the rest come through.

   This replaced a single run-out distance tweened onto the front of the race (`DIRECTOR.runOut`). On a `power2.out` over 2.2s that made the whole field jump from 2.1 lengths a second to 13.4 on the line — six times the speed, in one frame — and then brake to a dead stop inside two seconds with their legs still going, the chasers included, several of them before they had reached the post. It was the "pushed, then skidding" finish.
3. **The camera opens up and holds the post.** Through the final furlong the shot is on the leader; at the line it widens to zoom 1.08 (eighteen lengths of track on a desktop) and `updateCamera()` holds the winning post at `DIRECTOR.postFrame` across the frame — 40%, easing to 30% as the placed horses pull up — blended in by `DIRECTOR.postHold`. The winners pull up on the right, the stragglers are still coming on the left. Left to follow the group, the camera went with the winners and the post slid off the left edge at exactly the moment the viewer wants it.
4. **A held shot.** The camera drifts in a touch (only a touch: the winners are on the right of the frame and a tighter shot would push them out of it) and the edges darken while the last of the placed horses come through.
5. The result card, sized to the actual margin: PHOTO FINISH under a head, DEAD HEAT when the API says so, otherwise WINNER with the margin spelled out. It sits high in the frame (`top: 27%`) because the finish shot now has most of a field running through the middle of it. It comes in at `finishPauseS()`: not before 2.45s, and not before seven horses have come through the line behind the winner (`FINISHERS_BEFORE_CARD`), up to 6.5s. On a close finish that is well inside the minimum; on the runaway the field is still thirteen lengths out when the winner crosses, and the card used to arrive with nobody else in the picture.

   Measured after Skip to Finish on a 1024px desktop: `race` — twelve or thirteen in frame through the final furlong, the lead changing hands three times, a head between the first two at the line with nine inside four lengths, eleven through the line behind the winner and four still coming when the card (PHOTO FINISH, won by a neck) appears; `race-close-finish` — the whole field in frame, a blanket finish won by a nose; `race-runaway` — seven in frame in the wide shot, eight through behind the winner and four still coming when the card appears at 6.3s.
6. Out to the Winning Moment (§ 8.4c), and from there to the roll call. The result card is held for 1.7s rather than 2.3s now, because the Winning Moment card restates it.

**Press flashguns.** The photographers are banked at the winning post, and the wall of flashguns going off as the field crosses is the single most recognisable image in racing. `DIRECTOR.pressFlash` ramps up through the final furlong on the master timeline and is faded out by `finishTL`; `spawnPressFlashes()` emits from it at a rate proportional to the intensity. Three things make them read as flashguns rather than fairy lights:

- They fire in the crowd **behind the far rail**, so the horses occlude them.
- Each lives about a sixth of a second on a squared decay — a flashgun is a hard pop, and a slow fade turns the finish into Christmas lights.
- The freshest ones get a short horizontal streak, because a bank of flashes reads as a line of light rather than a field of dots.

A capped screen-space bloom (`drawAtmosphere`) lifts the whole frame slightly while they are firing.

### 8.4b Cinematic finishing

Three things a camera does that a canvas does not, drawn last in `drawAtmosphere()`:

- **Cinema bars.** `DIRECTOR.letterbox` is 0 through the Cruise and closes in through Build (3%), Drive (5.8%) and the final furlong (7.2% of the viewport height, top and bottom) — the frame narrows as the race does — then eases back to 5% as the camera opens up at the line. The DOM chrome sits over the bars, which is how broadcast graphics sit over a letterboxed picture anyway.
- **Lens flare.** An anamorphic streak through the sun and a line of ghosts toward the frame centre, faded out as the camera pushes in and the stands take the sun out of shot.
- **Film grain.** A small noise tile laid over the frame at a new random offset each frame, faint enough that nobody would call it grain. It breaks up the dead-flat fills a canvas produces and knits the painted backdrop and the drawn horses into one image. Static under `prefers-reduced-motion`.

Horse shadows are offset away from the sun, so every shadow in the frame agrees about where the light is.

### 8.4c The Winning Moment

A 5.2-second scene between the finish and the roll call, `runWinningMoment()`. The **choreography is the V16.1 delivery's** (`saturday_cinematic_v2`, its `runWinningMoment()`), beat for beat:

| Time | Beat |
|---|---|
| 0 | Cut close on the winner, still galloping. Letterbox to 2.1% |
| 0 → 2.5s | The camera pushes in, `power3.out` — the horse grows by 1.45× |
| 0 → 5.2s | The gallop eases from full speed to 60%, never stopping |
| 1.25s | The jockey comes up out of the crouch into a one-arm salute, over 0.45s, keeping the reins in the other hand |
| 1.46s | The gold-edged card resolves at the top: SATURDAY RACING · WINNING MOMENT, the winner's name, WINNER · odds · margin (DEAD HEAT on a dead heat) |
| 1.55s | Four confetti bursts, 0.21s apart, gold from the right and white from the left |
| 3.64 → 5.2s | The letterbox closes to 3.8%, like a broadcast sting |
| 5.2s | Out to the roll call |

**Everything in the frame is ours.** Their version cut to a painted sky-and-grass backdrop and a sprite. Here it is our racecourse — the same sky, sun, clouds, stands, rail crowd, hoardings and turf tiles as the race, magnified as if through a long lens and scrolling past as a low tracking shot — and our horse and jockey, drawn by `drawHorseSilhouette()` at hero scale with the same coat, markings and silks the viewer has just watched win.

How it is built, in the same shape as the race:

- **One timeline, one state object.** `winTL` writes into `HERO` (`push`, `speed`, `scroll`, `confetti`) and into the winner's `h.salute`; nothing else advances. `renderFrame()` hands the frame to `renderHeroFrame()` while `HERO.active` is set, so there is still one render loop. The turf is scrolled one stride (`STRIDE_LOCAL` at hero scale) per gait cycle, so the winner's hooves stay planted in this shot too.
- **The salute is part of the jockey rig**, blended by `h.salute` (0 → 1) rather than swapped in, so he rises into it. The upper body rotates back about the hip; the head takes back most of that lean, so his eyes stay up the track; the far arm is solved to keep hold of the reins; the near arm is posed in *world* space — straight up, a slight bend at the elbow — and carried back into the tilted frame, so it stays vertical however far he has sat up. The whip is put away. `h.salute` is 0 for every other horse, and the race never sets it, so the rig is unchanged in the race.
- **Framing measures the whole drawing**, tail tip to muzzle — a quarter longer than `HORSE_ART_LENGTH` — and centres that, not the horse's origin. On a phone the horse is sized to two-thirds of the width; sizing it like desktop put its head off the right-hand edge.
- **Teardown.** `resetWinningMoment()` kills `winTL`, hides the card and drops the class; `replayExperience()` and `startRace()` both call it. At the end of the scene only `HERO.active` is cleared, so the last hero frame stays on the canvas while the roll call fades in.
- Skipped under `prefers-reduced-motion`, as theirs is: the finish goes straight to the roll call.

### 8.5 The leaderboard

Live Positions is animated, not rewritten. V1 wrote `row.style.transform` on every row on every frame and left a CSS transition to chase it, which produced a permanently in-flight panel where nothing read as a *change*. V2 samples the ranking a few times a second and only touches a row when its rank actually moves — at which point GSAP slides it, the position number flips, and the row briefly carries `.is-climbing` or `.is-falling` so the eye is drawn to the change rather than to constant motion. The CSS transition on `transform` was removed for the same reason: a transition and a tween on the same property fight, and the tween always lands late.

### 8.6 Elsewhere

Outside the race screen, GSAP is used as it was before:

| Phase | GSAP timelines |
|---|---|
| Intro | Kicker fade-in, title reveal, meta chip stagger (type matched to V16.1, § 7) |
| Parade | Per-horse entry (silk scale, name slide), skip button pulse |
| Race | Stalls BANG, plus everything in § 8.1-8.5, including the Winning Moment |
| Roll call | Per-row entry from off-screen right, position number count-up |
| Reveal | Trophy scale + glow, winner name slide-up, verdict box fade, podium row stagger, gold confetti, action bar entry |

**Reveal confetti** is DOM (`spawnRevealConfetti()`), not canvas, because the reveal screen sits above both canvases. Forty-four nodes, GSAP-driven, torn down by the last piece to land and again on `replayExperience()` so nothing accumulates across replays. Confetti stays out of the race itself, where it read as an arcade flourish over a sports broadcast; it appears only after the result is in — in the Winning Moment (canvas, § 8.4c) and here.

**Intro runner chips** carry the runner's actual cap (`renderCapSvg`) rather than being text pills. Twenty-four names in a row is a list; twenty-four sets of colours is a racecard, and it primes the viewer for the silks they are about to follow.

### 8.7 prefers-reduced-motion

Two layers, and both matter:

- The engine short-circuits. `startExperience()` routes a reduced-motion visitor straight to `runStaticReveal()` — the settled result, no animated race. This is V1 behaviour and is unchanged.
- The race scene is hardened anyway, so nothing depends on that short-circuit holding. `SHAKE` is a flat `0`, so every camera-rumble tween multiplies out to nothing; the slow-motion ramp is skipped; hoof dust and the foreground plane never spawn; the finish drift is zero; the Winning Moment is skipped. `css/flat.css` carries a matching `@media (prefers-reduced-motion: reduce)` block for the DOM chrome.

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
