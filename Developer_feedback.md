# Developer feedback — cinematic replay V2

Review of `cinematic-replay-v2` (PR #1, engine `2.6.0`), and a record of four
changes made on top of it.

**Verdict: 8.5 / 10.** This is a large step up on the previous delivery, and
the four items below are the remainder — none of them is a defect in the race
itself.

---

## What this review found first

The rebuild independently closed every critical and significant finding from
the previous round: the Winner's Circle no longer clips its own podium and
buttons, `js/experience.js` is byte-identical to the baseline again, the dead
code is gone, payload text is escaped, the config merge keeps defaults on a
partial override, and reduced motion reaches a reveal that is actually
visible. Several of those now have unit tests naming the exact failure,
which is the right way to make a fix permanent.

Three things are worth calling out as better than asked for:

- **The performance work is properly engineered.** Establishing that cost is
  per draw call rather than per pixel — by rendering at a quarter of the
  pixels and seeing no change, then halving the fills and going 32 → 52fps —
  is a real experiment, not a guess. Quantifying the visual cost of the
  optimisation (0.2–0.3% of pixels differing by more than 8/255, only where
  merged shapes meet) and leaving a standing rule that any change adding draw
  calls to the horse wants measuring the same way is how this stays fast
  after everyone has forgotten why it was fast.
- **One GSAP timeline as the only clock.** No `raceTime`, no private
  `requestAnimationFrame`, no wall-clock arithmetic in a draw call. That
  deletes an entire class of bug rather than fixing instances of it.
- **`tools/visual-regression.js`.** Seeded, deterministic, fingerprinting both
  canvases and the active screen's markup at ~140 checkpoints. An animation
  codebase without this is one nobody can safely change.

Verified locally: lint clean at `--max-warnings 0`, all tests passing, zero
globals leaked beyond the declared API, and the reveal fitting its viewport
with the CTAs on screen.

---

## The four changes

### 1. `npm test` did not run on Windows

**Was:** `"test": "node --test tests/*.test.js"`

That relies on the shell expanding `tests/*.test.js`. npm runs scripts through
`cmd.exe` on Windows, which does not glob, so `npm test` failed outright with
*Could not find ...\tests\*.test.js*. The tests were fine — the gate in front
of them was not, on the platform this project is developed on.

**Now:** `"test": "node --test tests"`

Node takes a directory and finds the test files itself, so no shell is
involved and the script behaves the same on every platform.

**Carry forward:** anything in `scripts` that relies on a glob, `&&` chaining
quirks or POSIX path separators will behave differently on Windows. Worth a
thought whenever the script block grows.

---

### 2. Nine font files were three fonts

Both families ship as **variable fonts** — every file carries `fvar`/`gvar`.
The five DM Sans files were byte-identical to each other, and Playfair 700 and
900 were byte-identical to each other. It was one variable font downloaded
five times, each `@font-face` pinning the weight axis to a single value.

**Now:** three files, each declared once with a weight range.

| | Before | After |
|---|---|---|
| Files | 9 | 3 |
| Payload | 360KB | **120KB** |
| DM Sans axis | 5 faces pinned 300–700 | one face, `font-weight: 100 1000` |
| Playfair axis | 4 faces pinned 700/900 | two faces (upright, italic), `font-weight: 400 900` |

The ranges are measured, not assumed — glyph advance stops changing outside
them, so declaring wider would clamp silently.

**This also fixed a live bug.** With 700 as the heaviest declared face, every
`font-weight: 800` and `900` in the stylesheets clamped back to 700. Six
elements at 800 and one at 900 were rendering lighter than the CSS asked for.
They now render as themselves.

Checked against the previous build: every weight actually in use renders at an
identical advance width, except those seven, which are now correct. Playfair
is used only at 700 and 900 — both unchanged.

> **Action needed outside this repo.** `fonts/saturday-fonts.css` says it
> mirrors production's `static/fonts/saturday-fonts.css`. The same three files
> and the same three declarations need to land there, or the sandbox stops
> matching the live site. The DM Sans 800/900 text will look slightly bolder
> in production once it does — that is the intended weight arriving, not a
> regression, but it is worth a glance before it ships.

---

### 3. Brand colour was written out 100 times instead of using the token

`--gold` has been defined at `experience.css:9` since the baseline, and gold
was still written as a literal 100 times across the two stylesheets — 82 of
them as `rgba(212,175,55, …)`. `flat.css` defined no custom properties at all.
A palette change meant a find-and-replace across two files and two syntaxes.

**Now:** 195 literals replaced across both sheets, and the `:root` block gained
the colours that were being repeated without a name — `--paper`, `--ink`,
`--fox`, `--rank-silver`, `--rank-bronze` — plus channel triplets
(`--gold-rgb` and friends), because a hex token cannot have its alpha varied
and most uses here are translucent.

**Verified invisible:** computed colour values are byte-identical before and
after across all 356 elements and twelve colour properties — same digest, same
character count.

One literal moved out of the engine: `buildRevealHeader()` built the Winner's
Circle wash as a gradient string and assigned it to `style.background`, which
put brand gold somewhere no palette change could ever reach. It now toggles
`.reveal-bg--win` / `.reveal-bg--turf` and the colour comes from the tokens.
Both tints render exactly as before.

**Deliberately left alone:** the remaining eight colour literals in
`js/flat.js` are artwork, not brand — crowd flag colours, spectator clothing,
saddle-cloth accents, the confetti palette. Routing those through the config
would couple decoration to the brand palette so they all changed together,
which is not what anyone wants. The line worth holding is *chrome uses tokens,
artwork uses its own palette* — and artwork palettes belong in the array where
they are read, as they are now.

---

### 4. The race was silent to a screen reader

`inert` on hidden screens is handled well, and the flow test covering it is
the right test to have. What was missing was everything on the *shown* screen:
the race is a canvas, which to a screen reader is a blank box, and there was
no `aria-live` region, no `role`, and no focus movement between screens.

**Now:**

- **`#raceNarration`** — a polite `role="status"` region carrying the screen
  changes, the phase calls, Mr Fox's commentary and the result. It sits at
  **body level on purpose**: a live region inside a `.screen` is silenced the
  moment `showScreen()` marks that screen inert.
- **One region, replaced rather than appended.** A race is a running
  narration; a reader that has fallen behind should hear where the race is
  now, not work through a backlog.
- **The result is announced explicitly** from `buildRevealHeader()` — winner,
  price, and whether the viewer's pick won. "The Winner's Circle" tells a
  screen-reader user nothing. This is made in `buildRevealHeader()` rather
  than in the reveal's GSAP timeline precisely because a reduced-motion run
  skips that timeline.
- **Both canvases are `aria-hidden="true"`** — they carry no accessible
  content, and the narration speaks for them.
- **Focus follows the screen.** Each `.screen` takes `tabindex="-1"` and
  `showScreen()` moves focus into the screen that just appeared. Without it,
  focus sat on a control that had just been made inert, the browser dropped it
  to `<body>`, and a keyboard user was silently returned to the top of the
  document at every transition. Not on the first call — stealing focus on page
  load is its own bug.

Two tests were added to `tests/flow.test.js` in the existing style, so this
does not quietly regress:

- `the canvas race is narrated, and a transition moves the caret`
- `the result is spoken, even on the reduced-motion path`

**Not done, and worth a conversation:** the narration is a reasonable
transcript rather than a designed experience. Someone who actually uses a
screen reader should hear it before it ships — in particular whether ~22
announcements across a 60-second race is useful or exhausting, and whether the
phase calls and the commentary together are one voice too many.

---

## Verifying all of it

```bash
npm install
npm run lint      # clean at --max-warnings 0
npm test          # 29 tests
python serve.py
```

29 tests: 21 unit, 8 flow. Lint clean. `FlatEngine.version` still reports
`2.6.0` — the engine's behaviour has not changed, so the build badge and any
saved visual-regression baseline remain valid.

---

## Still open, and not addressed here

- **Breakpoint spread.** `768 / 761 / 760 / 700` overlap, and a viewport
  between 761 and 768 matches both the mobile and desktop rule sets. Judging
  this needs a real browser at each width rather than a measurement.
- **Editorial tuning is still in JavaScript.** Race duration, the phase
  thresholds, the camera constants and the V16-era motion constants are all
  hardcoded. The seed JSON exists precisely so pacing can be changed without a
  developer; if the answer to "is 46 seconds too long?" turns out to be yes,
  it should be a config edit rather than a ticket.
- **Fixtures.** Three, all settled results. Forecast mode is out of scope by
  agreement, so this is not a gap in the delivery — but forecast is the
  production default for any upcoming race, so it needs a fixture before that
  path ships.
- **Nobody has measured whether people watch it.** Completion rate, skip rate
  per affordance and replay rate would tell you more about this feature than
  any of the above. It is the one open item that changes what to build next.
