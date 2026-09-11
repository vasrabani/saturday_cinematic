# Integration runbook — cinematic replay V2 → Saturday Racing

> **STATUS: PREPARED, NOT INTEGRATED.**
> Nothing in the Django repo has been changed. Everything below was derived by
> reading it. `tools/check-integration.js` writes nothing, anywhere.

**Target:** `C:\Agile_Frameworks\racing\saturday` — branch `main`, clean, at
`ad0aeb17`. Template: `cinematic/templates/cinematic/flat.html` (261 lines).

## The short version

The change is smaller than expected: **three asset files, the fonts, and eight
lines of template.** Two files everyone assumed would need copying turn out to
be byte-identical to production already.

```bash
node tools/check-integration.js C:/Agile_Frameworks/racing/saturday
```

That prints the work list and exits non-zero until it is done. Run it before
starting, and again at the end — **a clean run is the gate**. It currently
reports 24 outstanding items, all listed below.

---

## What was verified about the target

| Check | Result |
|---|---|
| `#replayData` before `flat.js` | **Already correct** — payload at line 210, engine at 223 |
| `--nav-h` | **Already correct** — `static/css/base.css:108` sets `60px`, and the engine reads it from CSS (not from `RACE_DATA.navHeight`, which is vestigial) |
| `js/experience.js` | **Identical** to the sandbox — do not copy |
| `js/vendor/gsap.min.js` | **Identical** — do not copy |
| Production-only CSS | **Nothing would be lost.** Zero selectors exist in production's stylesheets that the sandbox lacks |
| Engine-created ids | None wrongly present in the template |

That last one matters most. The template carries features the sandbox has
never had — the AI confidence badge, the archive picker partial, the Deep Dive
cross-link, the trophy SVG, `#revealScores`. All of them are already styled in
the sandbox's `experience.css`, so copying the stylesheets **does not delete
them**. This was checked selector by selector, not assumed.

---

## Step 1 — assets (three files)

```bash
SAND=C:/Agile_Frameworks/demo/cinematic-lab
PROD=C:/Agile_Frameworks/racing/saturday

cp "$SAND/css/experience.css" "$PROD/cinematic/static/cinematic/css/experience.css"
cp "$SAND/css/flat.css"       "$PROD/cinematic/static/cinematic/css/flat.css"
cp "$SAND/js/flat.js"         "$PROD/cinematic/static/cinematic/js/flat.js"
```

`js/flat.js` is generated — run `npm run build` first so it matches
`js/src/`. `npm test` refuses to run if it does not.

Do **not** copy `js/experience.js` or `js/vendor/gsap.min.js`. They already
match, and copying them would only add line-ending churn.

## Step 2 — fonts (nine files become three)

```bash
cp "$SAND/fonts/saturday-fonts.css"           "$PROD/static/fonts/saturday-fonts.css"
cp "$SAND/fonts/dm-sans.woff2"                "$PROD/static/fonts/"
cp "$SAND/fonts/playfair-display.woff2"       "$PROD/static/fonts/"
cp "$SAND/fonts/playfair-display-italic.woff2" "$PROD/static/fonts/"

cd "$PROD" && git rm static/fonts/dm-sans-{300,400,500,600,700}.woff2 \
                     static/fonts/playfair-display-{700,900,700italic,900italic}.woff2
```

Both families are variable fonts; the nine files were three, duplicated. See
`Developer_feedback.md` § 2.

**This is site-wide, not cinematic-only.** `static/fonts/saturday-fonts.css` is
the whole site's type. Expect `font-weight: 800`/`900` text to render slightly
bolder **everywhere**, because it was silently clamping to 700 and now resolves
properly. That is the intended weight arriving, but it is a visible change
outside the cinematic and wants a look at the landing page and racecard before
it ships.

## Step 3 — template (`cinematic/templates/cinematic/flat.html`)

Three edits. Nothing is removed.

**3a. The narration region.** After `<div id="loadingBar" style="width:0%"></div>`:

```html
{# Screen-reader narration. The race is a canvas, so the commentary, phase
   calls and result are announced here instead. Body level, NOT inside a
   .screen: showScreen() marks the others inert, and an inert subtree is
   not announced. #}
<div id="raceNarration" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
```

**3b. The canvases are decorative.** They carry no accessible content; the
narration speaks for them.

```html
<canvas id="particleCanvas" aria-hidden="true"></canvas>
<canvas id="raceCanvas" aria-hidden="true"></canvas>
```

**3c. Screens become focus targets.** Add `tabindex="-1"` to all five:

```html
<div class="screen flat-screen" id="screen-intro" tabindex="-1">
```

…and the same for `screen-parade`, `screen-race`, `screen-rollcall`,
`screen-reveal`. Without it, focus sits on a control that `showScreen()` has
just made inert, the browser drops it to `<body>`, and a keyboard user is
returned to the top of the document at every transition.

`.sr-only` ships in `experience.css` (line 696), so step 1 covers it.

## Step 4 — the jumps template

`cinematic/templates/cinematic/experience.html` needs **3a, 3b and 3c too** if
the jumps cinematic should be narrated. The engine work is flat-only, so the
jumps page gets nothing from this and the edits are inert there — skip them
unless the jumps engine is also being brought forward.

---

## Verifying afterwards

```bash
node tools/check-integration.js C:/Agile_Frameworks/racing/saturday   # must exit 0
cd C:/Agile_Frameworks/racing/saturday && python manage.py test cinematic
python manage.py collectstatic --noinput
```

`cinematic/tests_a11y.py` already exists in the repo. I read it: it asserts
that GSAP is vendored rather than pulled from a CDN, and three things about the
boot script — that the reduced-motion media query is present, that the path
invokes `window.startExperience`, and that it uses `reduced ? 0 : 800`. **None
of the three template edits touches the boot script**, so those tests keep
passing unchanged.

Then, in a browser on a settled race:

1. The intro renders and **RUN THE RACE** starts the parade.
2. The race runs; Skip to Finish, Skip to the Race and Skip to Trophy all work.
3. The Winner's Circle shows the podium **and its buttons on screen** at
   1440×900 and 1280×720 — the clipping bug that this release fixes.
4. Console is silent.
5. With a screen reader, or by watching `#raceNarration.textContent`: the
   screen changes, phase calls, commentary and a `Result: …` line all announce.
6. Tab after a transition — focus should be inside the new screen.

---

## Two risks in the target, neither introduced by this work

**1. The notification banner mis-sizes the cinematic.** `base.html:107` adds
`has-notif-banner` to `<body>` for any signed-in user with notifications, and
`base.css` compensates with `padding-top: calc(var(--nav-h) + 44px)` on
`.site-main` — but `--nav-h` stays `60px`. The cinematic's `.screen` is
`position: fixed; top: var(--nav-h)`, so it ignores that padding entirely and
the top 44px of every cinematic screen sits under the banner.

This affects the **current** production cinematic too. Worth checking while
signed in with notifications. The fix, if confirmed, is for the banner to raise
`--nav-h` rather than pad `.site-main`.

**2. Forecast mode has no fixture.** The sandbox's three fixtures are all
settled results — the engagement scoped forecast mode out ("this bundle is
post-race replay only"). The engine does support it and it is unit-tested
(*"a forecast puts the drawn winner first and every runner in once"*), but it
has never been exercised in a browser. **Forecast is the production default for
any upcoming race**, so it deserves a deliberate look on a real unsettled race
before this goes near a Saturday.

---

## Rollback

Everything is a file copy plus eight lines of template, so:

```bash
cd C:/Agile_Frameworks/racing/saturday && git checkout -- cinematic/ static/fonts/
```

There are no migrations, no view changes, no data-shape changes. The payload
contract is untouched — `runners`, `user_pick`, `fox_pick` and `replay_data`
are read exactly as they are today.
