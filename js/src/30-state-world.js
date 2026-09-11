// ─── State ──────────────────────────────────────────────────────
const STATE = {
  runners:      [],
  userPick:     null,
  foxPick:      null,
  raceBand:     'mile',
  simResult:    null,
  phase:        'intro',
};

// ─── Canvas + DPI ──────────────────────────────────────────────
const canvas  = document.getElementById('raceCanvas');
const pCanvas = document.getElementById('particleCanvas');
const ctx     = canvas.getContext('2d');
const pCtx    = pCanvas.getContext('2d');

// A rounded-rectangle sub-path: the canvas's own roundRect() where the
// browser has one (every current browser does), arcs where it does not.
// A local helper, so the engine does not patch CanvasRenderingContext2D
// for the whole page.
function roundRectPath(c, x, y, w, h, r) {
  if (typeof c.roundRect === 'function') { c.roundRect(x, y, w, h, r); return; }
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + radius, y);
  c.arcTo(x + w, y,     x + w, y + h, radius);
  c.arcTo(x + w, y + h, x,     y + h, radius);
  c.arcTo(x,     y + h, x,     y,     radius);
  c.arcTo(x,     y,     x + w, y,     radius);
  c.closePath();
}

// ─── Viewport + world layout ────────────────────────────────────
// V2 is a WORLD-space engine. A runner's position is a distance
// travelled measured in horse LENGTHS; the renderer converts
// lengths → world px → screen px through the virtual camera. The
// viewport therefore only sets a scale factor — it never touches the
// race model, which is what lets the window resize mid-race without
// the field jumping.
let viewW = 0, viewH = 0;

// Up to this width the layout is a phone's: framing, the sun's position
// and the hero shot all take their narrow variants.
const NARROW_VIEWPORT_PX = 768;
function isNarrowViewport() { return viewW <= NARROW_VIEWPORT_PX; }

function getNavH() {
  // `parseInt(...) || 60` was wrong: a legitimate --nav-h of 0 is falsy,
  // so a page with no nav bar (this sandbox) still had 60px carved off
  // the bottom of the canvas. Only fall back when the value is genuinely
  // absent or unparseable.
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--nav-h');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 60;
}

// How many viewport-widths of ground the camera covers between the
// stalls and the winning post. Nine reads as a genuine journey while
// keeping the mid-race off the "nothing is happening" line.
const TRAVEL_SCREENS = 9;

// Nose-to-tail size of the horse artwork at scale 1, in world px. A
// "length" is by definition the length of a horse, so this number and
// WORLD.lengthPx have to be the same thing — get it wrong and every gap
// the Racing API gives us is drawn at the wrong size.
const HORSE_ART_LENGTH = 74;

const WORLD = {
  horseScale:   1,   // artwork scale for this viewport
  spreadScale:  1,   // how much of the field a narrow viewport keeps in shot
  lengthPx:    74,   // one horse length, in world px
  spanLengths: 160,  // stalls → winning post, in lengths (derived)
  spanPx:       0,
  horizonY:     0,   // screen y of the horizon
  trackTopY:    0,   // screen y of the far rail
  trackBotY:    0,   // screen y of the near rail
  trackMidY:    0,
};

function layoutWorld() {
  // One knob sets the whole thing: how big a horse is drawn. A length
  // follows from that, and the race distance in lengths follows from
  // wanting the camera to cover TRAVEL_SCREENS of ground either way.
  WORLD.horseScale  = Math.max(0.62, Math.min(1.15, viewW / 1440));
  WORLD.lengthPx    = HORSE_ART_LENGTH * WORLD.horseScale;
  // A phone is a narrower lens on the same race. Left at 1 the field
  // fans out over three screens and the viewer sees four horses and a
  // lot of grass, so narrow viewports pull the field in — the same
  // compromise a real outside-broadcast director makes by going wider.
  WORLD.spreadScale = Math.max(0.55, Math.min(1, viewW / 1100));
  WORLD.spanPx      = viewW * TRAVEL_SCREENS;
  WORLD.spanLengths = WORLD.spanPx / WORLD.lengthPx;

  // The lane band has to survive the final-furlong zoom without the
  // near-side runners sliding off the bottom of the frame, so it is
  // centred close to the middle of the viewport and kept narrow enough
  // that band × maxZoom still fits.
  WORLD.horizonY  = viewH * 0.38;
  WORLD.trackTopY = viewH * 0.47;
  WORLD.trackBotY = viewH * 0.78;
  WORLD.trackMidY = (WORLD.trackTopY + WORLD.trackBotY) / 2;
}

function resize() {
  // Cap the backing store at 2× — a 3× phone display costs three times
  // the fill rate for a difference nobody can see at this line weight,
  // and it is the single biggest lever on holding 60fps.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const prevLengthPx = WORLD.lengthPx;

  viewW = window.innerWidth;
  viewH = window.innerHeight - getNavH();
  for (const c of [canvas, pCanvas]) {
    c.width  = viewW * dpr;
    c.height = viewH * dpr;
    c.style.width  = viewW + 'px';
    c.style.height = viewH + 'px';
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutWorld();

  // Runner positions are stored in lengths, so they survive a resize on
  // their own — but CAM.x is world PIXELS, and layoutWorld() just moved
  // what a pixel is worth. Rescale it, or a browser zoom mid-race leaves
  // the camera pointing at empty track while the field jumps elsewhere.
  if (prevLengthPx > 0 && WORLD.lengthPx !== prevLengthPx) {
    CAM.x *= WORLD.lengthPx / prevLengthPx;
  }

  scheduleTileRebuild();
  relayoutLanes();
  lbRowH = 0;

  // A resize reallocates the canvas backing store, which clears it. Repaint
  // the race as it stands — without advancing it — and let the ambient
  // backdrop repaint itself on its next tick.
  redrawFrame();
  ambientPainted = false;
}
window.addEventListener('resize', resize);

// ─── Race state ─────────────────────────────────────────────────
let horses = [];
let raceRunning = false;
let particles = [];
const firedCommentary = new Set();
let commentaryTimer = 0;
let frameClock = 0;          // ms of wall time since the gate opened

// The master GSAP timeline is the ONLY thing that advances race time.
let masterTL = null;
let finishTL = null;
let tickerRunning = false;

const SHAKE = prefersReducedMotion ? 0 : 1;

// ── The director ────────────────────────────────────────────────
// Every animated scalar the renderer reads lives on this one object,
// and every one of them is written by GSAP — never by hand inside the
// frame loop. Read it top to bottom and you have the entire visual
// state of the race at any instant.
const DIRECTOR_START = Object.freeze({
  progress:  0,      // 0 → 1 race progress
  zoom:      1,      // camera zoom
  anchorX:   0.50,   // screen fraction the camera's focus sits at
  camY:      0,      // vertical camera offset (px)
  tilt:      0,      // camera roll (radians) — a few thousandths, felt not seen
  shake:     0,      // hoof-rumble amplitude (px)
  vignette:  0.10,   // edge fall-off
  groupBias: 0.12,   // 0 = frame the whole principal group, 1 = frame the leader
  fieldFade: 0,      // how far the back markers recede
  flash:     0,      // white flash at the line
  filmRate:  1,      // playback speed after the line: slow motion back up to real time
  postHold:  0,      // 0 → 1, how firmly the camera holds the winning post in shot
  postFrame: 0.40,   // where across the frame the post is held
  pressFlash: 0,     // press flashguns firing at the post, 0 → 1
  letterbox: 0,      // cinema bars, as a fraction of viewport height each
  phase:     'cruise',
});
const DIRECTOR = Object.assign({}, DIRECTOR_START);

// The camera itself. DIRECTOR supplies intent; CAM is the damped
// result that actually gets drawn. `seed` phases the hoof rumble.
const CAM_START = Object.freeze({ x: 0, zoom: 1, shakeX: 0, shakeY: 0 });
const CAM = Object.assign({}, CAM_START, { seed: Math.random() * 1000 });

// ─── Race phases ────────────────────────────────────────────────
// Cruise → Build → Drive → Line. These are DIRECTION phases: they
// decide how the camera behaves. They are deliberately separate from
// BAND.phaseTable, which editorial tunes in the seed JSON and which
// still drives the on-screen commentary and phase strip.
const RACE_PHASES = [
  { key: 'cruise', from: 0.00 },
  { key: 'build',  from: 0.45 },
  { key: 'drive',  from: 0.72 },
  { key: 'line',   from: 0.90 },
];

// Where a direction phase starts, as a fraction of the race.
function phaseFrom(key) {
  return RACE_PHASES.find((ph) => ph.key === key).from;
}

