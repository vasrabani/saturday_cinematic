/*
 * THE FLAT EXPERIENCE — Saturday Racing cinematic replay engine (flat races)
 *
 * Screen flow: intro → parade → race → the Winning Moment → roll call →
 * reveal. The race is a canvas scene in world space — positions are
 * lengths behind the leader, seen through a damped virtual camera — and
 * one GSAP timeline is its only clock. ARCHITECTURE.md is the full map.
 *
 * Loading: a classic <script>, no modules and no bundler. It must be
 * included AFTER the #replayData JSON tag (and #flatConfig, if any): both
 * are read once, while this file parses. GSAP (js/vendor/gsap.min.js)
 * must be loaded first.
 *
 * Public API (everything else is private to this file):
 *   init(data)              the page's boot script hands over the race
 *   window.startExperience  the intro's Run the Race button
 *   window.skipParade / skipToFinish / skipRollCall / replayExperience
 *   window.FlatEngine       the same functions, the build's version and
 *                           feature list, QA hooks (debug) and the pure
 *                           helpers the unit tests call (internals)
 *
 * Contents, top to bottom:
 *   config · silks · state, canvas and world layout · the director ·
 *   init and screens · intro · parade · race start · race model ·
 *   master timeline · camera · parallax scenery · ambient backdrop ·
 *   track plane · atmosphere · margins · the field · hoof dust ·
 *   press flashguns · broadcast identification · render loop · the horse ·
 *   commentary · leaderboard · crossing the line · result card ·
 *   the Winning Moment · roll call · reveal · replay · public API
 *
 * ─────────────────────────────────────────────────────────────────────
 * GENERATED FILE — do not edit. Built from js/shared/ and js/src/ by
 * tools/build.js; the manifest there is the source order. Edit a
 * fragment and run `npm run build`. `npm test` fails if this file and
 * the fragments disagree.
 * ─────────────────────────────────────────────────────────────────────
 */
(function () {
'use strict';
// ─── CONFIG load ────────────────────────────────────────────────
// The seed JSON (#flatConfig) overrides these. They are the keys the
// engine reads, and nothing else: the seed may still carry V1-era tuning
// keys (speed lines, a photo-finish hold, rank colours) that nothing
// reads any more, and those are ignored.
const FLAT_DEFAULTS = {
  shared: {
    stallsOpenMs: 600,
    subtitleDefaultMs: 2400,
    track: { furlongPoleEvery: 0.125 },
    horse: { minSurges: 2, maxExtraSurges: 2, surgeStartRange: [0.10, 0.75], surgeDurationRange: [0.14, 0.24], surgeBoostRange: [0.5, 1.5], winnerFinalSurge: { start: 0.78, duration: 0.18, boost: 2.4 } },
    colours: { gold: '#D4AF37', userPick: 'rgba(212,175,55,0.28)', foxPick: 'rgba(200,120,20,0.22)', neutralGlow: 'rgba(120,150,200,0.10)', userLabel: '#D4AF37', foxLabel: '#E8A050', silkDefault: '#C8A951', silk2Default: '#1A2540', trackTurf: '#2d5e3a' },
  },
  band: {
    timings: { raceDurationMs: 46000, paradeDelayMsFast: 900, paradeDelayMsSlow: 1300, paradeLargeFieldThreshold: 16, commentaryHoldMs: 3000, slowMoFactor: 0.55 },
    phases: {
      raceStart: "AND THEY'RE AWAY",
    },
    // Seven-stage narrative arc — drives phase-strip + title rotation.
    phaseTable: [
      { key: 'awayWeGo',     from: 0.00, label: "AND THEY'RE AWAY" },
      { key: 'settlingDown', from: 0.08, label: 'SETTLING DOWN' },
      { key: 'steadyPace',   from: 0.25, label: 'STEADY THE PACE' },
      { key: 'backStraight', from: 0.45, label: 'INTO THE BACK STRAIGHT' },
      { key: 'twoOut',       from: 0.68, label: 'TWO FURLONGS OUT' },
      { key: 'finalFurlong', from: 0.85, label: 'THE FINAL FURLONG' },
      { key: 'driveToLine',  from: 0.95, label: 'DRIVING TO THE LINE' },
    ],
    // Mr Fox voice commentary (Sprint P4 #6). Pre-canned templates with
    // {LEADER}/{USER}/{FOX} substitution. Voice notes:
    //   • Punchy, opinionated, never hedged.
    //   • UK racing vernacular — "going strongly", "shown the whip",
    //     "asked for everything".
    //   • Mr Fox by-line implied; speech bubble styled per .race-commentary.
    commentary: [
      { at: 0.02, text: "They're away — and {LEADER} breaks sharp." },
      { at: 0.12, text: "Settling in. {LEADER} happy to make it." },
      { at: 0.28, text: "Steady gallop and {LEADER} dictating." },
      { at: 0.45, text: "Down the back, {LEADER} still has them strung out." },
      { at: 0.58, text: "Halfway. {LEADER} travelling like a winner, {USER} closing." },
      { at: 0.72, text: "{LEADER} kicks first. Anyone going with him?" },
      { at: 0.86, text: "Two out — {LEADER} being asked for everything." },
      { at: 0.93, text: "Final furlong. {LEADER} clear and going away!" },
      { at: 0.98, text: "{LEADER} drives for the line. Fox called it." },
    ],
  },
};

// One level deep, so a seed that overrides one colour or one timing
// keeps the defaults for the rest. Arrays and scalars replace outright;
// null and undefined mean "use the default". Every key in FLAT_DEFAULTS
// is therefore always present, and the engine reads the merged config
// without fallbacks of its own.
function mergeConfig(defaults, override) {
  const out = Object.assign({}, defaults);
  for (const [key, value] of Object.entries(override || {})) {
    if (value === null || value === undefined) continue;
    const both = [value, defaults[key]].every((v) => v && typeof v === 'object' && !Array.isArray(v));
    out[key] = both ? Object.assign({}, defaults[key], definedOnly(value)) : value;
  }
  return out;
}

function definedOnly(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

const FLAT_CONFIG = (() => {
  const el = document.getElementById('flatConfig');
  if (!el) return FLAT_DEFAULTS;
  try {
    const parsed = JSON.parse(el.textContent || '{}');
    return {
      shared: mergeConfig(FLAT_DEFAULTS.shared, parsed.shared),
      band:   mergeConfig(FLAT_DEFAULTS.band,   parsed.band),
    };
  } catch (err) {
    console.warn('flat.js: #flatConfig is not valid JSON; using the built-in defaults.', err);
    return FLAT_DEFAULTS;
  }
})();

const SHARED = FLAT_CONFIG.shared;
const BAND   = FLAT_CONFIG.band;
const COL    = SHARED.colours;
const TRK    = SHARED.track;

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Payload text — horse, jockey and trainer names, prices, silk colours
// and image URLs — goes into markup through esc(). It is data, and data
// does not get to write HTML. Ordinary names come out unchanged.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// ── Silk badge renderer ────────────────────────────────────────
// Mirrors races/templates/races/components/atoms/_silk.html.
// The same renderer lives in experience.js (the jumps engine); keep the
// two in step.
let silkIdCounter = 0;
function renderSilkSvg(runner) {
  if (runner && runner.silk_url) {
    return '<img class="silk-img" src="' + esc(runner.silk_url) +
           '" alt="Silks" loading="lazy" decoding="async">';
  }
  const body   = esc((runner && runner.silk)  || COL.silkDefault);
  const accent = esc((runner && runner.silk2) || COL.silk2Default);
  const pat    = (runner && runner.silk_pattern) || 'solid';
  const id = 'cinSilkClip-' + (++silkIdCounter);
  const BODY_PATH = 'M2 8 L7 4 L11 6 L17 6 L21 4 L26 8 L26 28 Q26 31 23 31 L5 31 Q2 31 2 28 Z';
  const SLEEVES_PATH = 'M2 8 L0 14 L0 20 L4 20 L4 12 Z M26 8 L28 14 L28 20 L24 20 L24 12 Z';
  let patternMarkup = '';
  if (pat === 'halved') {
    patternMarkup = '<rect x="14" y="0" width="14" height="32" fill="' + accent + '"/>';
  } else if (pat === 'hooped') {
    patternMarkup =
      '<rect x="0" y="11" width="28" height="3" fill="' + accent + '"/>' +
      '<rect x="0" y="17" width="28" height="3" fill="' + accent + '"/>' +
      '<rect x="0" y="23" width="28" height="3" fill="' + accent + '"/>';
  } else if (pat === 'striped') {
    patternMarkup =
      '<rect x="13" y="0" width="2" height="32" fill="' + accent + '"/>' +
      '<rect x="7"  y="0" width="2" height="32" fill="' + accent + '" opacity="0.85"/>' +
      '<rect x="19" y="0" width="2" height="32" fill="' + accent + '" opacity="0.85"/>';
  } else if (pat === 'quartered') {
    patternMarkup =
      '<rect x="14" y="0"  width="14" height="11" fill="' + accent + '"/>' +
      '<rect x="0"  y="17" width="14" height="15" fill="' + accent + '"/>';
  } else if (pat === 'starred') {
    patternMarkup =
      '<text x="14" y="22" text-anchor="middle" fill="' + accent +
      '" font-size="13" font-family="Georgia, serif" style="font-weight:900;">★</text>';
  }
  return (
    '<svg class="silk-svg" viewBox="0 0 28 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path fill="' + body + '" d="' + BODY_PATH + '"/>' +
      '<defs><clipPath id="' + id + '"><path d="' + BODY_PATH + '"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + ')">' + patternMarkup + '</g>' +
      '<path fill="' + accent + '" d="' + SLEEVES_PATH + '"/>' +
    '</svg>'
  );
}

// Mini jockey-cap SVG, as in experience.js. Renders a two-tone cap using the runner's
// silk colours + silk_pattern so each row's cap matches its jersey.
let lbCapCounter = 0;
function renderCapSvg(runner) {
  const body   = esc((runner && runner.silk)  || '#1A3A6B');
  const accent = esc((runner && runner.silk2) || '#FFFFFF');
  const pat    = (runner && runner.silk_pattern) || 'solid';
  const id = 'lbCap-' + (++lbCapCounter);
  let patternMarkup = '';
  if (pat === 'halved') {
    patternMarkup = '<rect x="8" y="0" width="8" height="16" fill="' + accent + '"/>';
  } else if (pat === 'hooped') {
    patternMarkup =
      '<rect x="0" y="5"  width="16" height="2" fill="' + accent + '"/>' +
      '<rect x="0" y="9"  width="16" height="2" fill="' + accent + '"/>';
  } else if (pat === 'striped') {
    patternMarkup =
      '<rect x="7" y="0" width="2" height="16" fill="' + accent + '"/>';
  } else if (pat === 'quartered') {
    patternMarkup =
      '<rect x="8" y="0" width="8" height="8" fill="' + accent + '"/>' +
      '<rect x="0" y="8" width="8" height="8" fill="' + accent + '"/>';
  } else if (pat === 'starred') {
    patternMarkup =
      '<text x="8" y="12" text-anchor="middle" font-size="11" font-weight="900" font-family="Georgia, serif" fill="' + accent + '">★</text>';
  }
  return (
    '<svg class="race-lb-cap" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><clipPath id="' + id + '"><circle cx="8" cy="8" r="7.5"/></clipPath></defs>' +
      '<circle cx="8" cy="8" r="7.5" fill="' + body + '"/>' +
      '<g clip-path="url(#' + id + ')">' + patternMarkup + '</g>' +
      '<circle cx="8" cy="8" r="7.5" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="0.6"/>' +
    '</svg>'
  );
}

// ─── Data shapes ────────────────────────────────────────────────
/**
 * A runner, as the page hands it to init(): one row of the racecard.
 * @typedef {Object} Runner
 * @property {number|string} id
 * @property {number} number          saddle-cloth number
 * @property {string} name
 * @property {string} jockey
 * @property {string} trainer
 * @property {string} odds            fractional, e.g. "10/1"
 * @property {number} weight          forecast strength; a number after init()
 * @property {string} [silk]          jersey colour
 * @property {string} [silk2]         second silk colour
 * @property {string} [silk_pattern]  solid | hooped | striped | halved | quartered | starred
 * @property {string} [silk_url]      a real silks image, used when present
 * @property {number} [sr]            speed rating
 * @property {number} [stars]         0–5
 * @property {boolean} [is_fav]
 */

/**
 * What the page's boot script passes to init().
 * @typedef {Object} RaceData
 * @property {Runner[]} runners
 * @property {Runner|null} userPick   the viewer's own pick (matched by id)
 * @property {Runner|null} foxPick    Mr Fox's pick (matched by name)
 * @property {string} raceName
 * @property {string} raceDistance
 * @property {'sprint'|'mile'|'stayer'} raceBand
 */

/**
 * The race's result, read from #replayData (README → Payload contract).
 * @typedef {Object} ReplayData
 * @property {boolean} has_result
 * @property {Array<number|string>} result_order        runner ids, winner first
 * @property {Object<string, string>} beaten_distances  Racing API copy per runner id: "nk", "1 1/2"
 * @property {boolean} has_distances
 * @property {Object<string, number>} lengths_behind_winner
 */

/**
 * A runner in the race scene, built by buildHorseObjects().
 * @typedef {Object} Horse
 * @property {Runner} runner
 * @property {number} finalPos        finishing position, 0 = the winner
 * @property {number} finalLengths    lengths behind the winner at the line
 * @property {number} deficit         live lengths behind the leader
 * @property {number} travel          lengths covered
 * @property {number} worldX          world px from the stalls
 * @property {number} laneIdx         0 = far rail
 * @property {number} depth           lane scale: far rail smallest
 * @property {Array<{start: number, duration: number, lengths: number}>} surges
 * @property {number} duelFloor       how far ahead of the winner the duel may take him
 * @property {number} legPhase        gait phase in radians, advanced by distance
 * @property {number} [lineGap]       lengths behind the winner when the winner crossed
 * @property {number} [salute]        the Winning Moment salute, 0 → 1
 */

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

// ─── Init ───────────────────────────────────────────────────────
let wired = false;   // buttons and the ambient ticker, once per page

/**
 * Hands the race to the engine and shows the intro. Called by the page's
 * boot script once #replayData is in the DOM and GSAP is loaded.
 * @param {RaceData} data
 */
function init(data) {
  // Weights arrive as numbers from the Racing API serialiser, but have
  // arrived as strings before; normalise once so nothing else has to.
  STATE.runners      = data.runners.map((r) => Object.assign({}, r, { weight: Number(r.weight) || 0 }));
  STATE.userPick     = data.userPick;
  STATE.foxPick      = data.foxPick;
  STATE.raceBand     = data.raceBand || 'mile';

  buildIntroChips();
  if (!wired) {
    wireButtons();
    gsap.ticker.add(ambientFrame);
    wired = true;
  }
  showScreen('intro');
}

function wireButtons() {
  const start = document.getElementById('flatStartBtn');
  if (start) start.addEventListener('click', startExperience);
  const skip  = document.getElementById('flatSkipParadeBtn');
  if (skip)  skip.addEventListener('click', skipParade);
  const replay = document.getElementById('flatReplayBtn');
  if (replay) replay.addEventListener('click', replayExperience);
  const raceSkip = document.getElementById('raceSkipBtn');
  if (raceSkip) raceSkip.addEventListener('click', skipToFinish);
  const rcSkip = document.getElementById('rollcallSkipBtn');
  if (rcSkip) rcSkip.addEventListener('click', skipRollCall);
  document.querySelectorAll('.screen [data-href]').forEach((b) => {
    b.addEventListener('click', () => { window.location.href = b.dataset.href; });
  });
}

// One frame at 60fps, in ms: how GSAP's deltaRatio becomes milliseconds,
// and the unit the particle systems step in.
const FRAME_MS = 1000 / 60;

// ─── Scheduled steps ────────────────────────────────────────────
// The flow between screens runs on timers — the parade's pace, the
// stalls, the roll call's holds. They are kept here so a skip can cancel
// the step it skips and Run Again can cancel them all: left running, a
// stale timer from one run fires into the next.
const flowTimers = new Set();

function after(ms, fn) {
  const id = setTimeout(() => { flowTimers.delete(id); fn(); }, ms);
  flowTimers.add(id);
  return id;
}

function cancelTimer(id) {
  clearTimeout(id);
  flowTimers.delete(id);
}

function cancelFlowTimers() {
  flowTimers.forEach((id) => clearTimeout(id));
  flowTimers.clear();
}

// ─── Screen management ──────────────────────────────────────────
// ─── Screen-reader narration ────────────────────────────────────
// The race is a canvas: to a screen reader it is a blank box. Everything
// the picture says — which screen we are on, the phase calls, Mr Fox's
// commentary and the result — is mirrored into #raceNarration, a polite
// live region that lives at body level because a region inside an inert
// screen is not announced.
//
// One region, replaced rather than appended: a race is a running
// narration, and a reader that has fallen behind should hear where the
// race is NOW, not work through a backlog.
let lastAnnounced = '';
function announce(text) {
  const message = String(text || '').trim();
  if (!message || message === lastAnnounced) return;
  lastAnnounced = message;
  const el = document.getElementById('raceNarration');
  if (el) el.textContent = message;
}

// Screens that speak for themselves are not announced generically: the
// reveal announces the actual result instead (buildRevealHeader).
const SCREEN_LABELS = {
  intro:    'Race preview. Choose Run the Race to begin.',
  parade:   'The parade ring.',
  race:     'The race is under way.',
  rollcall: 'The roll call, last to first.',
};

let screenShown = false;
function showScreen(name) {
  STATE.phase = name;
  document.querySelectorAll('.screen').forEach((el) => {
    const active = el.id === 'screen-' + name;
    el.classList.toggle('active', active);
    // A hidden screen's buttons are still in the DOM. Inert, they take no
    // clicks, focus or key presses — Enter on a still-focused Run button,
    // or a Tab onto an invisible Run Again, would restart the flow.
    el.inert = !active;
  });

  // Move the caret into the screen that just appeared. Without this, focus
  // is left on a control that has just been made inert, the browser drops
  // it to <body>, and a keyboard or screen-reader user is silently sent
  // back to the top of the document at every transition. Not on the first
  // call: that one is the page arriving, and stealing focus on load is its
  // own bug.
  const shown = document.getElementById('screen-' + name);
  if (shown && screenShown) {
    try { shown.focus({ preventScroll: true }); } catch { /* jsdom, older browsers */ }
  }
  screenShown = true;

  announce(SCREEN_LABELS[name]);
}

// The viewer's own pick is identified by id; the Fox pick by name — it
// arrives from the Fox model as a runner record of its own.
function isUserPick(runner) { return !!(STATE.userPick && String(STATE.userPick.id) === String(runner.id)); }
function isFoxPick(runner)  { return !!(STATE.foxPick && STATE.foxPick.name === runner.name); }

// ─── Intro chips ────────────────────────────────────────────────
function buildIntroChips() {
  const container = document.getElementById('introRunnersPreview');
  if (!container) return;
  container.innerHTML = '';
  STATE.runners.slice(0, 20).forEach((r) => {
    const chip = document.createElement('div');
    const isUser = isUserPick(r);
    const isFox  = isFoxPick(r);
    chip.className = 'intro-runner-chip' +
      (isUser ? ' intro-runner-chip--user' : '') +
      (isFox  ? ' intro-runner-chip--fox'  : '');
    // The runner's actual cap, not a plain text pill. Twenty names in a
    // row is a list; twenty sets of colours is a racecard, and it primes
    // the viewer for the silks they are about to follow.
    chip.innerHTML =
      '<span class="intro-runner-chip__silk">' + renderCapSvg(r) + '</span>' +
      '<span class="intro-runner-chip__name">' +
        (isUser ? '🐾 ' : isFox ? '🦊 ' : '') + esc(r.name) +
      '</span>';
    container.appendChild(chip);
  });
}

// Skip-to-Finish — one seek on the master timeline. Because the
// timeline owns race progress AND every camera parameter, seeking it
// lands the camera, the phase, the leaderboard and the field all in a
// consistent state; there is no second clock to keep in step.
// Idempotent via Math.max.
const SKIP_TO_FINISH_REMAINING_S = 10;
function skipToFinish() {
  // Past the line there is nothing left to skip: snapping then would
  // only pull the camera off the winning post.
  if (!raceRunning || !masterTL || FINISH.active) return;
  const target = Math.max(masterTL.time(),
                          masterTL.duration() - SKIP_TO_FINISH_REMAINING_S);
  masterTL.seek(target, false);
  snapRaceState();
  hideSkipButton();
}

function hideSkipButton() {
  const wrap = document.querySelector('.race-skip-wrap');
  if (wrap) wrap.classList.add('race-skip-hidden');
}

let experienceStarted = false;

function startExperience() {
  // Once per run: a double-click would otherwise start two parades.
  if (experienceStarted || STATE.phase !== 'intro') return;
  experienceStarted = true;
  // Hide the archive picker now that the user has committed to a
  // race — CSS body-class toggle. replayExperience drops it again.
  document.body.classList.add('cinematic-experience-running');
  if (prefersReducedMotion) {
    runStaticReveal();
    return;
  }
  gsap.to('#screen-intro', {
    opacity: 0, scale: 0.96, duration: 0.5, ease: 'power2.in',
    onComplete: () => {
      showScreen('parade');
      gsap.fromTo('#screen-parade', { opacity: 0 }, { opacity: 1, duration: 0.4, onComplete: beginParade });
    },
  });
}

// The race's finishing order and winner. buildRacePositions() honours
// REPLAY_DATA: on a replay positions[0] is the real winner, in a forecast
// it is the weighted draw passed in. The winner is always positions[0],
// so the reveal announces the horse that actually crosses the line first,
// never the pre-sim draw.
function resolveResult() {
  const fallback = weightedRandom(STATE.runners);
  const positions = buildRacePositions(fallback);
  return { winner: (positions && positions[0]) || fallback, positions };
}

function runStaticReveal() {
  STATE.simResult = resolveResult();
  const { winner, positions } = STATE.simResult;
  buildRevealScreen(winner, positions);
  showScreen('reveal');
  // No motion, so no entrance: the reveal's pieces start hidden (inline
  // opacity in the markup) and only animateReveal() brings them in —
  // jump it straight to its end.
  animateReveal().progress(1);
}

// ─── Parade ─────────────────────────────────────────────────────
let paradeTimer = null;
let leavingParade = false;

function beginParade() {
  leavingParade = false;
  buildParadeDots();
  showParadeHorse(0);
}

function buildParadeDots() {
  const c = document.getElementById('paradeDots');
  if (!c) return;
  c.innerHTML = '';
  const n = Math.min(STATE.runners.length, 20);
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'parade-dot';
    d.id = 'paradeDot-' + i;
    c.appendChild(d);
  }
}

function updateParadeDots(idx) {
  const n = Math.min(STATE.runners.length, 20);
  for (let i = 0; i < n; i++) {
    const d = document.getElementById('paradeDot-' + i);
    if (!d) continue;
    d.className = 'parade-dot' + (i === idx ? ' active' : i < idx ? ' done' : '');
  }
}

function showParadeHorse(idx) {
  if (idx >= STATE.runners.length) {
    transitionToRace();
    return;
  }
  const r = STATE.runners[idx];
  updateParadeDots(idx);
  const counter = document.getElementById('paradeCounter');
  if (counter) counter.textContent = (idx + 1);

  const isUser = isUserPick(r);
  const isFox  = isFoxPick(r);
  const tagEls = [];
  if (isUser)   tagEls.push('<span class="parade-tag parade-tag--user">🐾 Your Pick</span>');
  if (isFox)    tagEls.push('<span class="parade-tag parade-tag--fox">🦊 Fox\'s Pick</span>');
  if (r.is_fav) tagEls.push('<span class="parade-tag parade-tag--fav">Favourite</span>');
  if (r.sr)     tagEls.push('<span class="parade-tag parade-tag--sr">SR ' + esc(r.sr) + '</span>');
  if (r.stars) {
    const stars = Math.max(0, Math.min(5, Math.round(r.stars)));
    tagEls.push('<span class="parade-tag parade-tag--sr">' + '★'.repeat(stars) + '☆'.repeat(5 - stars) + '</span>');
  }

  const glow = isUser ? COL.userPick : isFox ? COL.foxPick : COL.neutralGlow;
  const html =
    '<div class="parade-bg-glow" style="background:radial-gradient(ellipse 80% 80% at 50% 50%, ' + glow + ', transparent)"></div>' +
    '<div class="parade-card" id="paradeCard">' +
    '  <div class="parade-silk">' + renderSilkSvg(r) + '</div>' +
    '  <div class="parade-number">Horse ' + esc(r.number) + ' of ' + STATE.runners.length + '</div>' +
    '  <div class="parade-name">' + esc(r.name) + '</div>' +
    '  <div class="parade-connections"><strong>J:</strong> ' + esc(r.jockey) + ' &nbsp;·&nbsp; <strong>T:</strong> ' + esc(r.trainer) + '</div>' +
    '  <div class="parade-odds-badge">' + esc(r.odds) + '</div>' +
    '  <div class="parade-tags">' + tagEls.join('') + '</div>' +
    '</div>';

  const stage = document.getElementById('paradeStage');
  if (!stage) return;
  if (stage.innerHTML) {
    gsap.to('#paradeCard', {
      opacity: 0, x: -40, duration: 0.22, ease: 'power2.in',
      onComplete: () => {
        stage.innerHTML = html;
        gsap.fromTo('#paradeCard', { opacity: 0, x: 50, scale: 0.97 }, { opacity: 1, x: 0, scale: 1, duration: 0.35, ease: 'power2.out' });
      },
    });
  } else {
    stage.innerHTML = html;
    gsap.fromTo('#paradeCard', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' });
  }

  const T = BAND.timings;
  const ms = STATE.runners.length > T.paradeLargeFieldThreshold ? T.paradeDelayMsFast : T.paradeDelayMsSlow;
  paradeTimer = after(ms, () => { if (STATE.phase === 'parade') showParadeHorse(idx + 1); });
}

function skipParade() {
  cancelTimer(paradeTimer);
  transitionToRace();
}

// ─── Transition → race (with stalls bang) ──────────────────────
function transitionToRace() {
  // Once only: the parade ending and the skip button can both call it.
  if (leavingParade) return;
  leavingParade = true;
  showSubtitle("Into the stalls. The crowd holds its breath.", SHARED.subtitleDefaultMs);
  gsap.to('#screen-parade', {
    opacity: 0, duration: 0.6, delay: 0.4, ease: 'power2.in',
    onComplete: () => {
      showScreen('race');
      gsap.fromTo('#screen-race', { opacity: 0 }, { opacity: 1, duration: 0.4, onComplete: bangStallsAndStart });
    },
  });
}

// How long the opening stalls take to clear the frame (the CSS
// animation's length).
const STALLS_CLEAR_MS = 700;

function bangStallsAndStart() {
  const stalls = document.getElementById('flatStalls');
  // Stalls cover the canvas; bang open after a short held breath.
  after(SHARED.stallsOpenMs, () => {
    if (stalls) stalls.classList.add('is-opening');
    after(STALLS_CLEAR_MS, () => { if (stalls) stalls.classList.add('is-hidden'); });
    startRace();
  });
}

// ─── Race ───────────────────────────────────────────────────────
function startRace() {
  // Idempotent. The parade can hand off twice if the skip button is
  // pressed while its fade-in tween is still running — without this
  // guard that builds a second master timeline, and two timelines both
  // tweening DIRECTOR.progress fight each other for the rest of the
  // race. One race, one clock.
  if (raceRunning) return;

  STATE.simResult = resolveResult();
  buildHorseObjects(STATE.simResult.positions);
  resetWinningMoment();

  frameClock  = 0;
  raceRunning = true;
  FINISH.active = false;
  lastLeaderTravel = 0;
  firedCommentary.clear();
  lbSampleTimer = 0;

  buildLeaderboard();
  setPhaseTitle(BAND.phases.raceStart);

  // The timeline is built and started here, and it is the only clock
  // in the race from this point until crossTheLine() hands over.
  masterTL = buildMasterTimeline();
  startTicker();
  masterTL.play(0);
}

function weightedRandom(runners) {
  const total = runners.reduce((s, r) => s + r.weight, 0);
  const roll = Math.random() * total;
  let cum = 0;
  for (const r of runners) {
    cum += r.weight;
    if (roll <= cum) return r;
  }
  return runners[runners.length - 1];
}

// Replay payload — populated only when the view runs in replay
// mode AND the race is genuinely settled. JS reads it at boot
// from the json_script block injected by the template. When
// has_result is False (the default + the entire forecast path)
// every consumer of REPLAY_DATA falls back to the sim. Pure
// additive — the existing forecast code path is untouched when
// no replay data is present. Mirrors experience.js exactly; keep
// the two engines in step.
const REPLAY_DATA = (() => {
  const el = document.getElementById('replayData');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || '{}');
  } catch (err) {
    // Loud, because the fallback is quiet: without the result the race
    // is a random forecast that looks exactly like the real thing.
    console.error('flat.js: #replayData is not valid JSON; running a forecast instead of the result.', err);
    return null;
  }
})();

function buildRacePositions(winner) {
  // ── Replay short-circuit ─────────────────────────────────
  // When the race is settled, the actual finish positions
  // override the sim's shuffle entirely. Winner argument is
  // ignored in favour of result_order[0]. DNFs (runners not
  // in the result_order array) are appended so they still
  // render on the canvas.
  if (REPLAY_DATA && REPLAY_DATA.has_result &&
      Array.isArray(REPLAY_DATA.result_order) &&
      REPLAY_DATA.result_order.length) {
    // Ids are compared as strings: the payload has been known to send
    // the result's ids and the runners' ids as different types.
    const byId = new Map(STATE.runners.map((r) => [String(r.id), r]));
    const ordered = REPLAY_DATA.result_order
      .map((id) => byId.get(String(id)))
      .filter(Boolean);
    if (ordered.length) {
      const seen = new Set(REPLAY_DATA.result_order.map(String));
      STATE.runners.forEach((r) => {
        if (!seen.has(String(r.id))) ordered.push(r);
      });
      return ordered;
    }
    // Fall through to the sim only if the result payload didn't
    // map to any known runner — defensive.
  }

  // The rest in order of strength, with some luck in it: each runner's
  // weight plus a random draw, drawn once per runner and then sorted.
  const rest = STATE.runners
    .filter((r) => r.id !== winner.id)
    .map((r) => ({ r, key: r.weight + Math.random() * 20 }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.r);
  return [winner, ...rest];
}

// ════════════════════════════════════════════════════════════════
//  RACE MODEL
// ════════════════════════════════════════════════════════════════
// The model answers one question per frame: how many lengths is each
// runner behind the leader right now? Screen position falls out of
// that. Deficits are smoothed, never snapped, so a runner makes ground
// or drops away instead of teleporting between ranks.

// Final deficit behind the winner, in real horse lengths.
// V1 squashed the Racing API distances into 18% of the track width,
// which is why a thirty-length runaway used to look like a three-length
// win. In world space we can afford the truth — the camera simply
// leaves the tail of the field out of frame.
const MAX_VISIBLE_LENGTHS = 46;

// How far, in lengths, the runner-up may poke his head in front of the
// winner at the height of the finish duel. A long head.
const DUEL_HEAD_IN_FRONT = 0.3;

// Surge shape. The shortest a surge may be, as a fraction of the race,
// and how many lengths one unit of surgeBoost is worth.
const SURGE_MIN_SPAN = 0.14;
const SURGE_LENGTHS  = 1.5;

// No horse gallops more than this much faster or slower than the leader.
// Every move in the race — the fan-out, the pace, the surges, the finish
// duel — is a change in a horse's deficit, and the rate that deficit may
// change at is capped at this fraction of the leader's own speed. A horse
// losing ground is then a horse galloping at eighty per cent, which reads
// as tiring; uncapped, the fastest moves had horses travelling backwards
// over the turf, which read as being shoved.
const REL_SPEED_CAP = 0.22;

function finalLengthsFor(runner, rank, invented) {
  if (REPLAY_DATA && REPLAY_DATA.has_distances) {
    const raw = (REPLAY_DATA.lengths_behind_winner || {})[runner.id];
    if (raw !== undefined && raw !== null) {
      return Math.min(MAX_VISIBLE_LENGTHS, Math.max(0, Number(raw) || 0));
    }
  }
  return invented[rank] || 0;
}

// Forecast, or a replay with no per-horse distances: invent the gaps —
// and invent a close finish, because that is what the viewer is there
// for. The winner wins by the real winning margin where the result has
// one (a short head to a neck where it does not), second and third are
// within a length, nine horses are inside five lengths, and only then
// does the tail string out behind them. Built as a running total of the
// gap from each horse to the one in front, so the finishing order can
// never be contradicted by the jitter. Sprints finish tighter than
// stayers.
const BAND_SPREAD = { sprint: 0.86, mile: 0.95, stayer: 1.05 };

function inventFinishGaps(positions, raceBand, winningMargin, random = Math.random) {
  const band = BAND_SPREAD[raceBand] || BAND_SPREAD.stayer;
  const margin = winningMargin == null ? null : Math.min(1.5, winningMargin);
  const gaps = [0];
  for (let r = 1; r < positions.length; r++) {
    const step = r === 1 ? (margin != null ? margin : band * (0.12 + random() * 0.23))
               : r <= 8  ? band * (0.28 + 0.06 * (r - 2) + random() * 0.12)
               :           band * (0.8 + 0.12 * (r - 9) + random() * 0.4);
    gaps.push(Math.min(MAX_VISIBLE_LENGTHS, gaps[r - 1] + step));
  }
  return gaps;
}

// The result's real winning margin in lengths: 0 for a dead heat, null
// when there is no result or it does not say.
function resultWinningMargin(positions) {
  if (!(REPLAY_DATA && REPLAY_DATA.has_result && positions[1])) return null;
  const m = parseBeatenDistance((REPLAY_DATA.beaten_distances || {})[positions[1].id]);
  return m === -1 ? 0 : m;
}

// Pace style shapes a horse's race without changing its result.
// Front-runners spend the first half ahead of where they finish,
// closers spend it behind. Without this the field glides in a fixed
// order from flagfall and the race has no story to tell.
function paceBiasFor(count) {
  const roll   = Math.random();
  const spread = 3 + count * 0.22;                                  // lengths
  if (roll < 0.28) return -spread * (0.4 + Math.random() * 0.6);    // front-runner
  if (roll < 0.62) return  spread * (0.4 + Math.random() * 0.7);    // held up
  return (Math.random() - 0.5) * spread * 0.5;                      // handy
}

// Smoothstep — the fan-out curve for the field. Bunched at the gate,
// fully spread at the line, with no kink in between.
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function buildHorseObjects(positions) {
  const count = positions.length;
  const lanes = assignLanes(count);
  const HORSE = SHARED.horse;
  const invented = inventFinishGaps(positions, STATE.raceBand, resultWinningMargin(positions));

  horses = positions.map((r, rank) => {
    const surges = randomSurges(rank, HORSE);
    const finalLengths = finalLengthsFor(r, rank, invented);
    const duelFloor = addFinishSurges(surges, rank, finalLengths);
    return {
      runner:        r,
      finalLengths:  finalLengths,
      paceBias:      paceBiasFor(count),
      deficit:       0,      // live lengths behind the leader
      travel:        0,      // lengths covered
      worldX:        0,
      lastWorldX:    0,
      speed:         0,      // world px per ms — drives gait rate + dust
      laneIdx:       lanes[rank],
      laneT:         0,
      y:             0,
      depth:         1,
      finalPos:      rank,
      surges:        surges,
      duelFloor:     duelFloor,  // how far ahead of the winner he may get
      bobPhase:      Math.random() * Math.PI * 2,
      legPhase:      Math.random() * Math.PI * 2,
      swayRate:      0.88 + Math.random() * 0.26,
      swayPhase:     Math.random() * Math.PI * 2,
      lastDustCycle: null,
      lbRank:        -1,     // last rank the leaderboard animated to
      idGlow:        0,      // broadcast-identification marker opacity
    };
  });

  relayoutLanes();
  CAM.x    = 0;
  CAM.zoom = 1;
}

// Lane for each finishing position (lanes[rank]).
function assignLanes(count) {
  // Shuffle lane assignment so the field does not read as a staircase
  // sorted by finishing position.
  const lanes = Array.from({ length: count }, (_, i) => i);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  // Except the finish. The horses that fight it out need clear daylight
  // between them across the track: left to the shuffle, the winner and
  // the runner-up were often in neighbouring lanes, drawn one over the
  // other, and a nose-to-nose duel read as one horse out on its own.
  // Spread the first four through the middle of the track, in a random
  // order so the winner is not always on the same side, then fill the
  // rest of the lanes around them.
  const DUELLERS = Math.min(4, count);
  if (count >= 6) {
    const picks = [0.18, 0.40, 0.62, 0.84].slice(0, DUELLERS)
      .map((t) => Math.min(count - 1, Math.round(t * (count - 1))));
    for (let i = picks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picks[i], picks[j]] = [picks[j], picks[i]];
    }
    const rest = lanes.filter((l) => !picks.includes(l));
    lanes.splice(0, lanes.length, ...picks, ...rest);
  }
  return lanes;
}

function randomSurges(rank, HORSE) {
  // Surge windows — 3-5 moments where a horse quickens or drops away.
  // Magnitudes are now in LENGTHS, so a surge is a move you can see
  // and the leaderboard can react to.
  const surges = [];
  const surgeCount = HORSE.minSurges + 1 +
                     Math.floor(Math.random() * (HORSE.maxExtraSurges + 1));
  for (let s = 0; s < surgeCount; s++) {
    const sr = HORSE.surgeStartRange;
    const dr = HORSE.surgeDurationRange;
    const br = HORSE.surgeBoostRange;
    const sign = Math.random() < 0.32 ? -1 : 1;
    // At least SURGE_MIN_SPAN of the race and SURGE_LENGTHS per unit of
    // boost. A move over four percent of the race was a horse shot three
    // lengths up the field and back in under a second — faster than the
    // field itself was galloping, which is what read as being shoved.
    surges.push({
      start:    sr[0] + Math.random() * (sr[1] - sr[0]),
      duration: Math.max(SURGE_MIN_SPAN, dr[0] + Math.random() * (dr[1] - dr[0])),
      lengths:  sign * (br[0] + Math.random() * (br[1] - br[0])) * SURGE_LENGTHS,
    });
  }
  if (rank === 0 && HORSE.winnerFinalSurge) {
    const w = HORSE.winnerFinalSurge;
    surges.push({ start: w.start, duration: w.duration, lengths: w.boost * 2.0 });
  }
  return surges;
}

// Adds the finish duel and the chasing pack's closing move to `surges`.
// Returns how far ahead of the winner this horse may get (duelFloor).
function addFinishSurges(surges, rank, finalLengths) {
  // The finish duel. The placed horses get a surge timed at the top of
  // the straight that wipes out their deficit, so three or four of them
  // come upsides the leader and the last furlong is a question rather
  // than a formality. The runner-up goes further than level: he gets
  // his head in front for a few strides (DUEL_HEAD_IN_FRONT, the only
  // time a deficit may go negative), and the winner has to fight back.
  // surgeWeight collapses to zero by the line, so the finishing order
  // and the margins the payload specifies are still exactly what gets
  // drawn.
  let duelFloor = 0;
  if (rank >= 1 && rank <= 3 && finalLengths > 0.02) {
    // Capped, and deliberately. Sized purely off the final margin, a
    // runaway would have the runner-up close thirteen lengths and then
    // shed them again in the last few strides, which looks like the
    // horse stopping rather than the winner going away. Three and a
    // half lengths is enough to make a close race a question without
    // rewriting a one-sided one.
    const share = rank === 1 ? 1 : rank === 2 ? 0.9 : 0.8;
    const extra = rank === 1 && finalLengths < 3 ? DUEL_HEAD_IN_FRONT : 0;
    const closing = Math.min(finalLengths * share + extra, 3.5);
    // Peaking at 95–97% of the race, so the lead is still changing hands
    // a few strides from the line and the winner only gets back up at
    // the very end.
    surges.push({ start: 0.86 + rank * 0.01, duration: 0.16, lengths: closing });
    if (extra) duelFloor = -DUEL_HEAD_IN_FRONT;
  }
  // The chasing pack. Fifth to ninth close up behind the duel through
  // the final furlong, so the last shot is a charging field rather than
  // three horses and a lot of grass, then fade back to their true
  // margins with everything else by the line.
  if (rank >= 4 && rank <= 8 && finalLengths > 0.3) {
    surges.push({ start: 0.80 + rank * 0.012, duration: 0.17,
                  lengths: Math.min(finalLengths * 0.4, 2.6) });
  }
  return duelFloor;
}

// Lane geometry is pure presentation, so it rebuilds on resize without
// touching the race model. Lanes are laid out in DEPTH: lane 0 runs
// against the far rail (higher on screen, drawn smaller), the last lane
// runs nearest the camera. That one trick is most of why the field
// reads as a three-dimensional pack instead of a row of icons.
// Horses far lane first, so nearer horses are drawn over them. Lanes
// only change on a layout, so this is sorted there rather than per frame.
let horsesByLane = [];

function relayoutLanes() {
  horsesByLane = [];
  if (!horses.length) return;
  const n    = horses.length;
  const band = WORLD.trackBotY - WORLD.trackTopY;
  horses.forEach((h) => {
    const t = n > 1 ? (h.laneIdx + 0.5) / n : 0.5;
    h.laneT = t;
    h.y     = WORLD.trackTopY + t * band;
    h.depth = 0.78 + t * 0.38;
  });
  horsesByLane = horses.slice().sort((a, b) => a.laneT - b.laneT);
}

// Deficit smoothing time-constant. We smooth the DEFICIT rather than
// the absolute position: a lagged absolute position would leave every
// runner — the winner included — short of the line at the finish,
// whereas the deficit is slow-moving and settles exactly on its target.
const DEFICIT_TAU_MS = 320;

let lastLeaderTravel = 0;

function updateRaceModel(dt, snap) {
  // Past the post the field is handed to its own model (runThroughLine).
  if (FINISH.active) { runThroughLine(dt); return; }

  const p = DIRECTOR.progress;

  // Where the front of the race is, in lengths.
  const leaderTravel = p * WORLD.spanLengths;

  // How far the front of the race moved this frame. The cap on every
  // horse's relative move is a fraction of it, so it slows down in slow
  // motion along with everything else.
  const capStep = REL_SPEED_CAP * Math.max(0, leaderTravel - lastLeaderTravel);
  lastLeaderTravel = leaderTravel;

  // Fan-out: 5% of the final spread at the gate, 100% at the line.
  const fan = (0.05 + 0.95 * smoothstep(0, 1, p)) * WORLD.spreadScale;

  // Early-pace distortion decays away by the three-quarter mark, so
  // whatever shape the pace took, the result still lands exactly.
  const paceWeight = 1 - smoothstep(0.10, 0.78, p);

  // Surges taper to nothing over the last 8% so neither the finishing
  // order nor the real margins are ever falsified by a bell curve.
  const surgeWeight = 1 - smoothstep(0.92, 1, p);

  const k = snap ? 1 : 1 - Math.exp(-dt / DEFICIT_TAU_MS);

  horses.forEach((h) => {
    let surge = 0;
    for (let i = 0; i < h.surges.length; i++) {
      const s = h.surges[i];
      if (p >= s.start && p <= s.start + s.duration) {
        surge += s.lengths * Math.sin(((p - s.start) / s.duration) * Math.PI);
      }
    }

    const target = Math.max(
      h.duelFloor * surgeWeight,
      h.finalLengths * fan + h.paceBias * paceWeight - surge * surgeWeight
    );

    let move = (target - h.deficit) * k;
    if (!snap) move = Math.max(-capStep, Math.min(capStep, move));
    h.deficit += move;
    h.travel   = Math.max(0, leaderTravel - h.deficit);
    placeHorse(h, dt, snap);
  });

  // The order is now stale by definition — every position just moved.
  rankedCacheAt = -1;
}

// World position, ground speed and gait from h.travel.
function placeHorse(h, dt, snap) {
  h.lastWorldX = snap ? h.travel * WORLD.lengthPx : h.worldX;
  h.worldX     = h.travel * WORLD.lengthPx;
  const dx = Math.max(0, h.worldX - h.lastWorldX);

  // Instantaneous ground speed, lightly smoothed — the hoof dust keys off
  // it, so a spiky value would flicker.
  const inst = dt > 0 ? dx / dt : 0;
  h.speed += (inst - h.speed) * 0.2;

  // The gait is driven by distance, not by time. A planted hoof has to
  // stay where it was planted while the body passes over it, and that
  // only happens if one gait cycle carries the horse exactly one stride
  // (STRIDE_LOCAL, in the horse's own units, times the scale it is drawn
  // at). Tied to the clock instead, the legs kept galloping at nearly the
  // same rate whatever the horse was doing: in slow motion, pulling up or
  // standing still the hooves slid over the turf, and the small horses in
  // the far lanes skated worst of all.
  const cycles = dx / (STRIDE_LOCAL * WORLD.horseScale * h.depth);
  h.legPhase  += cycles * Math.PI * 2;
  h.bobPhase  += cycles * Math.PI * 2 * 0.62;
  h.swayPhase += dt * 0.0032 * h.swayRate;
}

// ── Through the line ────────────────────────────────────────────
// After the winner hits the line every horse keeps galloping at race
// speed until IT reaches the line, then pulls up the way the winner did:
// its speed eases from race pace towards EASE_TO of it with a time
// constant of EASE_TAU. The whole field runs the same curve, each horse
// starting it at its own moment, so a horse is still flat out as it
// crosses, nobody passes anybody, and the finishers bunch up as they
// pull up. The clock is race time: DIRECTOR.filmRate brings the
// playback from the final furlong's slow motion back to real time.
//
// This replaced a single run-out distance tweened onto the front of the
// race, which made the whole field jump from slow motion to six times
// that speed on the line and then brake to a dead stop in two seconds,
// the chasers included, with their legs still going.
const FINISH  = { active: false, t: 0, v: 0 };
const EASE_TO  = 0.42;
const EASE_TAU = 1.1;    // seconds of race time

function beginRunThrough() {
  FINISH.active = true;
  FINISH.t = 0;
  FINISH.v = WORLD.spanLengths / Math.max(1, masterTL ? masterTL.duration() : 46);  // lengths per race second
  horses.forEach((h) => {
    h.lineGap = h.finalPos === 0 ? 0 : Math.max(0, WORLD.spanLengths - h.travel);
  });
}

// Lengths run past the post, tau race-seconds after crossing it at v
// lengths a second.
function runOnPast(tau, v) {
  return v * (EASE_TO * tau + (1 - EASE_TO) * EASE_TAU * (1 - Math.exp(-tau / EASE_TAU)));
}

function runThroughLine(dt) {
  FINISH.t += (dt / 1000) * DIRECTOR.filmRate;
  const T = FINISH.t, v = FINISH.v, span = WORLD.spanLengths;
  horses.forEach((h) => {
    const reach = h.lineGap / v;             // when this horse gets there
    h.travel = T < reach ? span - h.lineGap + v * T : span + runOnPast(T - reach, v);
    placeHorse(h, dt, false);
  });
  rankedCacheAt = -1;
}

// After a seek the model and the camera are both many seconds behind
// where the clock now is. Left alone the exponential smoothing would
// spend a second visibly sliding everything into place; snapping is
// both correct and invisible.
function snapRaceState() {
  lastLeaderTravel = DIRECTOR.progress * WORLD.spanLengths;
  updateRaceModel(FRAME_MS, true);
  // Zoom first: the focus clamp that keeps the leader in frame is
  // computed against the zoom, so a stale one puts the leader outside
  // the very frame it is supposed to guarantee.
  CAM.zoom = DIRECTOR.zoom;
  CAM.x    = principalGroupFocus() + viewW * 0.05 * DIRECTOR.progress;
}

let rankedCache = [];
let rankedCacheAt = -1;
function rankedHorses() {
  // Ranking is wanted several times a frame; sorting 24 runners more
  // than once per frame is pure waste.
  if (rankedCacheAt === frameClock) return rankedCache;
  rankedCache   = horses.slice().sort((a, b) => b.travel - a.travel);
  rankedCacheAt = frameClock;
  return rankedCache;
}

// ════════════════════════════════════════════════════════════════
//  MASTER TIMELINE
// ════════════════════════════════════════════════════════════════
// One GSAP timeline is the single clock for the entire race. It owns
// race progress, every camera parameter, the slow-motion ramp through
// the final furlong, the scripted broadcast identifications and the
// cinematic pause at the line. Nothing in the render loop advances
// time — a frame is a pure function of what the timeline has written
// into DIRECTOR.

// The shot the camera settles into in each direction phase: the values
// the master timeline tweens DIRECTOR to. `shake` is a multiple of SHAKE,
// which is zero under prefers-reduced-motion.
const SHOTS = Object.freeze({
  cruise: Object.freeze({ zoom: 1.05, anchorX: 0.50, groupBias: 0.12, vignette: 0.12, letterbox: 0,     shake: 0.2, camY: 0,               fieldFade: 0 }),
  build:  Object.freeze({ zoom: 1.20, anchorX: 0.46, groupBias: 0.45, vignette: 0.18, letterbox: 0.03,  shake: 0.6, camY: 4,               fieldFade: 0.10 }),
  drive:  Object.freeze({ zoom: 1.34, anchorX: 0.50, groupBias: 0.62, vignette: 0.26, letterbox: 0.058, shake: 1.3, camY: 9,  tilt: 0.004, fieldFade: 0.34 }),
  line:   Object.freeze({ zoom: 1.36, anchorX: 0.62, groupBias: 1,    vignette: 0.34, letterbox: 0.072, shake: 2.4, camY: 12, tilt: 0.009, fieldFade: 0.40 }),
});

// A tween's worth of DIRECTOR values for a shot.
function shot(key, tween) {
  const s = SHOTS[key];
  return Object.assign({}, s, { shake: SHAKE * s.shake }, tween);
}

function buildMasterTimeline() {
  const durationS = BAND.timings.raceDurationMs / 1000;

  const tl = gsap.timeline({
    paused: true,
    onUpdate:   () => syncRacePhase(DIRECTOR.progress),
    onComplete: crossTheLine,
  });

  // Race progress is linear in timeline time after the break, which
  // keeps every label below expressible as (very nearly) a plain
  // progress fraction. The first START_EASE of it eases in: horses do
  // not leave the stalls at full speed.
  tl.to(DIRECTOR, { progress: 1, duration: durationS, ease: raceProgressEase }, 0);
  RACE_PHASES.forEach((ph) => tl.addLabel(ph.key, durationS * ph.from));

  // ── CRUISE ── wide, level, unhurried. The whole field is legible and
  //    the camera keeps the principal group left of centre so there is
  //    track ahead of them rather than behind.
  tl.to(DIRECTOR, shot('cruise', { duration: durationS * 0.45, ease: 'sine.inOut' }), 'cruise');

  // ── BUILD ── the camera starts taking a side. Framing tightens onto
  //    the front half of the field and the ground moves faster past it.
  tl.to(DIRECTOR, shot('build', { duration: durationS * 0.27, ease: 'sine.inOut' }), 'build');

  // ── DRIVE ── down onto the principal group. Back markers recede, the
  //    camera drops and starts to breathe with the gallop.
  tl.to(DIRECTOR, shot('drive', { duration: durationS * 0.18, ease: 'sine.inOut' }), 'drive');

  // ── LINE ── the dedicated final-furlong sequence.
  addFinalFurlongSequence(tl, durationS);

  // Broadcast identifications — four in a whole race, each resolved
  // against the live order at the moment it fires.
  tl.call(() => identifyRunner('leader',     'LEADS'),    null, durationS * 0.10);
  tl.call(() => identifyRunner('interest',   null),       null, durationS * 0.52);
  tl.call(() => identifyRunner('leader',     'IN FRONT'), null, durationS * 0.79);
  tl.call(() => identifyRunner('challenger', 'CLOSING'),  null, durationS * 0.945);

  return tl;
}

// The field accelerates out of the stalls over the first START_EASE of
// the race, then gallops at a constant speed. Continuous in value and in
// slope, so there is no jolt when the acceleration ends.
const START_EASE = 0.04;
function raceProgressEase(x) {
  const a = START_EASE, k = 1 / (1 - a / 2);
  return x < a ? k * x * x / (2 * a) : k * (x - a / 2);
}

// ── The final furlong ───────────────────────────────────────────
// A dedicated sequence, not simply more of the same but faster. The
// camera drops to the rail and frames the leader on the right of the
// shot with the chasing pack filling the frame behind him — seven to
// nine horses in shot, the duel for the lead among them — the world goes
// into slow motion, and the winning post finally comes into shot from
// the right: it has been out beyond the frame edge for the whole race
// until now.
function addFinalFurlongSequence(tl, durationS) {
  const seg = durationS * (1 - phaseFrom('line'));

  tl.to(DIRECTOR, shot('line', { duration: seg * 0.75, ease: 'sine.inOut' }), 'line');

  tl.call(() => {
    setPhaseTitle('THE FINAL FURLONG');
    const screen = document.getElementById('screen-race');
    if (screen) screen.classList.add('is-final-furlong');
  }, null, 'line');

  // The photographers start firing as the field comes to them.
  tl.to(DIRECTOR, {
    pressFlash: 1, duration: seg * 0.8, ease: 'power2.in',
  }, 'line');

  // Slow motion. We slow the CLOCK, not the horses, so commentary,
  // leaderboard and gait all stretch together. The ramp is tweened from
  // a call() so the tween driving timeScale is not itself being scaled
  // by the value it is changing.
  if (!prefersReducedMotion) {
    const slowTo = BAND.timings.slowMoFactor;
    tl.call(() => {
      gsap.to(tl, { timeScale: slowTo, duration: 1.0, ease: 'power2.out' });
    }, null, 'line');
  }
}

function syncRacePhase(p) {
  let active = RACE_PHASES[0];
  for (let i = 1; i < RACE_PHASES.length; i++) {
    if (p >= RACE_PHASES[i].from) active = RACE_PHASES[i];
    else break;
  }
  if (active.key === DIRECTOR.phase) return;
  DIRECTOR.phase = active.key;
  const screen = document.getElementById('screen-race');
  if (screen) screen.dataset.racePhase = active.key;
}

// ════════════════════════════════════════════════════════════════
//  VIRTUAL CAMERA
// ════════════════════════════════════════════════════════════════
// The camera tracks a focus point somewhere between the centroid of the
// principal racing group and the leader alone; DIRECTOR.groupBias
// slides between the two as the race develops. It is exponentially
// damped toward that focus, so it never snaps and never overshoots into
// a visible wobble — the group stays broadly centred and the world
// moves past it.
const CAM_FOLLOW_TAU_MS = 240;

// From the drive onwards the shot has to hold the leader and the next
// FRAME_PACK - 1 horses — seven to nine in shot is what makes the finish
// read as a race. When the field is too strung out for the director's
// framing to do that, the camera goes wider, down to ZOOM_FLOOR, and
// centres on the group: the wide shot of a runaway winner with the field
// toiling behind him.
const FRAME_PACK = 8;
const ZOOM_FLOOR = 0.9;

// The principal group is the front 40% of the field, floored at four
// runners and capped at ten — beyond that the tail drags the centroid
// backwards and the leaders creep off the right of frame.
function principalGroupSize(count) {
  return Math.min(count, 10, Math.max(4, Math.round(count * 0.4)));
}

function principalGroupFocus() {
  const ranked = rankedHorses();
  if (!ranked.length) return 0;
  const size = principalGroupSize(ranked.length);
  let sum = 0;
  for (let i = 0; i < size; i++) sum += ranked[i].worldX;
  const centroid = sum / size;
  const focus = centroid + (ranked[0].worldX - centroid) * DIRECTOR.groupBias;

  // Hard floor: the leader never leaves the frame. On a runaway the
  // group centroid sits thirty lengths behind the winner, and a camera
  // that honoured it faithfully would spend the closing stages filming
  // the horses that lost. Keep the group centred when the field is
  // tight; follow the leader when it is not.
  const headroom = (viewW * (1 - DIRECTOR.anchorX) - viewW * 0.14) / CAM.zoom;
  return Math.max(focus, ranked[0].worldX - headroom);
}

function updateCamera(dt) {
  // Look a little up the track as the pace lifts, so the viewer sees
  // where the race is going rather than where it has been.
  let target = principalGroupFocus() + viewW * 0.05 * DIRECTOR.progress;

  // While the field is running through the line, hold the winning post
  // in shot at DIRECTOR.postFrame across the frame, so the viewer sees
  // the placed horses come through it and the rest still coming. Left to
  // follow the group, the camera went with the winners and the post slid
  // off the left edge at exactly the moment the viewer wants it.
  if (FINISH.active && DIRECTOR.postHold > 0) {
    const hold = WORLD.spanPx + (DIRECTOR.anchorX - DIRECTOR.postFrame) * viewW / CAM.zoom;
    target += (hold - target) * DIRECTOR.postHold;
  }

  let zoom = DIRECTOR.zoom;
  if (!FINISH.active && DIRECTOR.progress > phaseFrom('drive')) {
    const ranked = rankedHorses();
    const back = ranked[Math.min(ranked.length - 1, FRAME_PACK - 1)];
    if (back) {
      const packW = ranked[0].worldX - back.worldX + 3 * WORLD.lengthPx;
      const fit = viewW * 0.9 / packW;
      // Eased in as the pack stops fitting, so the camera never snaps
      // between the two framings.
      const w = smoothstep(0, 0.15, (DIRECTOR.zoom - fit) / DIRECTOR.zoom);
      if (w > 0) {
        const wide = Math.max(ZOOM_FLOOR, fit);
        const mid  = (ranked[0].worldX + back.worldX) / 2 + 0.3 * WORLD.lengthPx;
        // If even the widest shot cannot hold them all, the leader wins:
        // he stays well inside the right of frame and the tail of the
        // group goes off the left.
        const packTarget = Math.max(mid + (DIRECTOR.anchorX - 0.5) * viewW / wide,
                                    ranked[0].worldX - (0.84 - DIRECTOR.anchorX) * viewW / wide);
        zoom   += (wide - zoom) * w;
        target += (packTarget - target) * w;
      }
    }
  }

  const k = 1 - Math.exp(-dt / CAM_FOLLOW_TAU_MS);
  CAM.x    += (target - CAM.x) * k;
  CAM.zoom += (zoom - CAM.zoom) * k;

  // Hoof rumble. Amplitude comes off the director so it ramps with the
  // phases, and it is flat zero under prefers-reduced-motion.
  if (DIRECTOR.shake > 0.01) {
    const t = frameClock * 0.001;
    CAM.shakeX = Math.sin(t * 27.3 + CAM.seed) * DIRECTOR.shake;
    CAM.shakeY = Math.sin(t * 19.1 + CAM.seed * 1.7) * DIRECTOR.shake * 0.7;
  } else {
    CAM.shakeX = 0;
    CAM.shakeY = 0;
  }
}

// Push the world transform onto a context. Everything drawn between
// this and ctx.restore() is in world coordinates: x is world px from
// the stalls, y is the screen y of the lane.
function pushWorldTransform(c) {
  c.save();
  c.translate(viewW * DIRECTOR.anchorX + CAM.shakeX,
              WORLD.trackMidY + DIRECTOR.camY + CAM.shakeY);
  if (DIRECTOR.tilt) c.rotate(DIRECTOR.tilt);
  c.scale(CAM.zoom, CAM.zoom);
  c.translate(-CAM.x, -WORLD.trackMidY);
}

// Vertical projection. The backdrop is drawn on a separate surface with
// no transform of its own, so it has to put the horizon exactly where
// the world transform would — otherwise the turf climbs over the sky as
// soon as the camera tightens.
function worldToScreenY(wy) {
  return WORLD.trackMidY + (wy - WORLD.trackMidY) * CAM.zoom
       + DIRECTOR.camY + CAM.shakeY;
}

// World-x range currently inside the frame, plus padding. Used to cull
// track furniture and horses — with a nine-screen world most of the
// field is off-camera at any moment, so this is the difference between
// drawing 24 horses a frame and drawing eight.
function visibleWorldRange(pad) {
  const left  = (viewW * DIRECTOR.anchorX)       / CAM.zoom;
  const right = (viewW * (1 - DIRECTOR.anchorX)) / CAM.zoom;
  return { min: CAM.x - left - pad, max: CAM.x + right + pad };
}
// ════════════════════════════════════════════════════════════════
//  PARALLAX — DEPTH PLANES
// ════════════════════════════════════════════════════════════════
// The horses barely move on screen. What moves is the world, and the
// difference in rate between these planes is what sells the speed.
//
//   0.00  sky + sun                           backdrop canvas
//   0.03  high cloud (cirrus, streaks)        backdrop canvas
//   0.045 distant downland                    backdrop canvas
//   0.07  low cloud (cumulus)                 backdrop canvas
//   0.17  grandstands, big screen, crowd      backdrop canvas
//   0.34  treeline                            backdrop canvas
//   0.68  rail crowd, hoardings, rail         race canvas
//   1.00  the turf the race is run on         race canvas
//   1.32  foreground grass, in front          race canvas
//
// The clouds also drift on the wind, independently of the camera, so the
// sky keeps moving backwards past the field even in a held shot.
//
// Every repeating plane is pre-painted into an offscreen tile once per
// resize and blitted after that. That is what makes it affordable to
// paint a grandstand with twenty thousand spectators in it: the cost is
// paid once, not sixty times a second.
const PARALLAX = {
  cloudsHigh: 0.03, hills: 0.045, cloudsLow: 0.07,
  stand: 0.17, trees: 0.34, farRail: 0.68, fore: 1.32,
};

// How much of the camera's zoom each backdrop plane takes. An optical
// zoom magnifies everything equally, but what this camera does is closer
// to a dolly-in: pushing toward the track makes near planes grow much
// faster than far ones. Scaling the whole backdrop by the full zoom
// flattened the scene and, in the tight phases, pushed the grandstand
// roof up over the entire sky.
const PLANE_ZOOM = { cloudsHigh: 0.06, cloudsLow: 0.12, hills: 0.25, stand: 0.55, trees: 0.8 };

// Wind, in screen px per ms at plane scale 1. The low cloud moves faster
// than the high cloud, which is what gives the sky its own depth.
const WIND = { cloudsHigh: 0.0045, cloudsLow: 0.011 };

const TILES = {
  cloudsHigh: null, cloudsLow: null, hills: null, stand: null, trees: null,
  turf: null, railCrowd: null, boards: null, grain: null,
};

// Where the sun is on screen this frame. Written by drawBackdrop(), read
// by drawAtmosphere() for the lens flare.
const SUN = { x: 0, y: 0, visible: 0 };

function makeTile(w, h, paint) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement('canvas');
  c.width  = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(g, w, h);
  return { canvas: c, w: w, h: h };
}

// ── Painting helpers ─────────────────────────────────────────────
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(list) { return list[(Math.random() * list.length) | 0]; }
function rgb(c, k) {
  const f = k == null ? 1 : k;
  return 'rgb(' + Math.min(255, c[0] * f | 0) + ',' +
                  Math.min(255, c[1] * f | 0) + ',' +
                  Math.min(255, c[2] * f | 0) + ')';
}

// Paint something that may straddle the tile's left or right edge twice,
// once on each side, so the tile repeats without a visible seam.
function wrapPaint(w, x, r, fn) {
  fn(x);
  if (x - r < 0) fn(x + w);
  if (x + r > w) fn(x - w);
}

// Aerial perspective. Distance lifts and blues everything a little; a
// grandstand three furlongs away is not as contrasty as the horse in
// front of you, and that difference is half of what makes a scene read
// as deep rather than as layered cut-outs. source-atop keeps it off the
// transparent gaps in the tile.
function hazeTile(g, w, h, rgba) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = rgba;
  g.fillRect(0, 0, w, h);
  g.restore();
}

// Depth of field for pre-painted planes. The far planes sit slightly
// out of focus behind the pin-sharp field, exactly as they would on a
// long lens. The blur is applied to a copy of the tile laid out three
// wide, then the middle third is kept, so the edges blur INTO the next
// repeat rather than into transparency — otherwise every tile join shows
// as a faint vertical seam. ctx.filter is not universal (older Safari);
// where it is missing the tile is used as painted.
const CANVAS_FILTER_OK = (() => {
  try {
    const t = document.createElement('canvas').getContext('2d');
    return typeof t.filter === 'string';
  } catch { return false; }
})();

function softenTile(tile, cssPx) {
  if (!tile || !CANVAS_FILTER_OK || cssPx <= 0) return tile;
  const W = tile.canvas.width, H = tile.canvas.height;
  const k = W / tile.w;                       // device px per css px
  const wide = document.createElement('canvas');
  wide.width = W * 3; wide.height = H;
  const wg = wide.getContext('2d');
  wg.drawImage(tile.canvas, 0, 0);
  wg.drawImage(tile.canvas, W, 0);
  wg.drawImage(tile.canvas, W * 2, 0);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const og = out.getContext('2d');
  og.filter = 'blur(' + (cssPx * k).toFixed(2) + 'px)';
  og.drawImage(wide, -W, 0);
  return { canvas: out, w: tile.w, h: tile.h };
}

// ── Crowd ────────────────────────────────────────────────────────
// At three furlongs a spectator is two or three pixels: a dark body, a
// point of skin, sometimes a hat. The first pass drew them as neat
// circles on neat ellipses in neat rows, which is exactly why the stand
// read as a cartoon. A real crowd at distance is a textured mass: mostly
// dark and neutral clothing, irregular spacing, empty seats showing
// through, riser shadows under each row, and everything under the roof
// sitting in deep shade.
const CLOTHES = [
  [24, 27, 34], [30, 34, 44], [40, 46, 60], [52, 58, 74], [62, 66, 72],
  [88, 92, 100], [120, 124, 130], [160, 162, 166], [214, 214, 212],
  [232, 228, 218], [186, 170, 142], [128, 104, 80], [84, 62, 46],
  [140, 36, 40], [36, 62, 112], [196, 164, 64], [58, 94, 66], [150, 112, 142],
];
const SKINS = [[226, 188, 152], [206, 160, 124], [170, 122, 88], [118, 82, 56], [238, 206, 178]];
const HAIR  = [[28, 22, 18], [52, 38, 26], [96, 72, 44], [150, 140, 130]];

function paintCrowd(g, x0, y0, x1, y1, light, fill, rowH, seat) {
  for (let y = y0; y + rowH <= y1 + 0.01; y += rowH) {
    // The riser under each row — the single most important line for
    // making a terrace read as stepped rather than as a flat wall.
    g.fillStyle = 'rgba(0,0,0,' + (0.28 * light + 0.08).toFixed(3) + ')';
    g.fillRect(x0, y + rowH - 0.55, x1 - x0, 0.55);

    let x = x0 + Math.random() * 1.4;
    while (x < x1) {
      const pw = rnd(1.15, 1.75);
      if (Math.random() < fill) {
        const k = light * rnd(0.8, 1.12);
        g.fillStyle = rgb(pick(CLOTHES), k);
        g.fillRect(x, y + rowH * 0.36, pw, rowH * 0.64);
        g.fillStyle = rgb(pick(SKINS), light * rnd(0.86, 1.05));
        g.fillRect(x + pw * 0.2, y + rowH * 0.04, pw * 0.6, rowH * 0.34);
        if (Math.random() < 0.38) {
          g.fillStyle = rgb(pick(HAIR), light);
          g.fillRect(x + pw * 0.14, y, pw * 0.72, rowH * 0.13);
        }
      } else if (seat) {
        g.fillStyle = rgb(seat, light * 0.9);
        g.fillRect(x, y + rowH * 0.42, pw, rowH * 0.5);
      }
      x += pw + rnd(0.2, 0.55);
    }
  }
}

// Aisles and stairways cut through the seating at regular intervals.
function paintAisles(g, x0, y0, x1, y1, every, light) {
  for (let x = x0 + every * 0.5; x < x1 - 4; x += every + rnd(-6, 6)) {
    g.fillStyle = rgb([150, 150, 146], light * 0.75);
    g.fillRect(x, y0, 2.6, y1 - y0);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = y0; y < y1; y += 2.6) g.fillRect(x, y + 2, 2.6, 0.5);
  }
}

// ── Clouds ───────────────────────────────────────────────────────
// A cumulus is dozens of overlapping billows sitting on a flat base,
// lit from above: bright warm-white crowns, blue-grey bellies. Each
// billow is a radial gradient whose hot spot is pushed toward the sun,
// drawn bottom-up so the lit tops overlap the shaded undersides. That
// is the whole trick — a flat white shape is what makes a cloud look
// drawn rather than photographed.
function paintCumulus(g, cx, baseY, W, H) {
  const puffs = [];
  const n = Math.round(12 + W / 11);
  for (let i = 0; i < n; i++) {
    const t = Math.random() * 2 - 1;
    const dome = Math.sqrt(Math.max(0, 1 - t * t));
    const r = H * rnd(0.2, 0.44) * (0.5 + 0.5 * dome);
    puffs.push({
      x: cx + t * W * 0.46,
      y: baseY - r * 0.5 - dome * H * rnd(0.12, 0.62),
      r: r,
    });
  }
  puffs.sort((a, b) => b.y - a.y);

  g.save();
  // Cumulus sit on a condensation level: the base is flat.
  g.beginPath();
  g.rect(cx - W, baseY - H * 2, W * 2, H * 2 + H * 0.05);
  g.clip();
  for (const p of puffs) {
    const lift = Math.max(0, Math.min(1, (baseY - p.y) / H));
    const body = [172 + lift * 80, 182 + lift * 70, 200 + lift * 52];
    const hx = p.x + p.r * 0.3, hy = p.y - p.r * 0.36;
    const gr = g.createRadialGradient(hx, hy, p.r * 0.04, p.x, p.y, p.r);
    gr.addColorStop(0,    'rgba(255,253,247,' + (0.7 + lift * 0.28).toFixed(3) + ')');
    gr.addColorStop(0.42, 'rgba(' + (body[0] | 0) + ',' + (body[1] | 0) + ',' + (body[2] | 0) + ',0.8)');
    gr.addColorStop(0.78, 'rgba(' + (body[0] | 0) + ',' + (body[1] | 0) + ',' + (body[2] | 0) + ',0.3)');
    gr.addColorStop(1,    'rgba(' + (body[0] | 0) + ',' + (body[1] | 0) + ',' + (body[2] | 0) + ',0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // Shaded base
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const b = g.createLinearGradient(0, baseY - H * 0.32, 0, baseY + H * 0.05);
  b.addColorStop(0, 'rgba(136,150,176,0)');
  b.addColorStop(1, 'rgba(136,150,176,0.42)');
  g.fillStyle = b;
  g.fillRect(cx - W * 0.6, baseY - H * 0.32, W * 1.2, H * 0.4);
  g.restore();
}

// High, thin cloud: stretched soft streaks rather than billows.
function paintCirrus(g, cx, cy, W, H) {
  const n = 6 + (Math.random() * 6 | 0);
  for (let i = 0; i < n; i++) {
    const x = cx + (Math.random() - 0.5) * W * 0.8;
    const y = cy + (Math.random() - 0.5) * H * 0.6;
    const rx = W * rnd(0.14, 0.32);
    const ry = H * rnd(0.12, 0.26);
    g.save();
    g.translate(x, y);
    g.rotate(rnd(-0.06, 0.06));
    g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, 'rgba(252,251,248,' + rnd(0.28, 0.46).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(236,242,250,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

// ── Grandstands ──────────────────────────────────────────────────
// One wide tile holds a composed skyline rather than one stand repeated
// every 540px, which was the other giveaway: a modern cantilevered main
// stand with a glazed hospitality level, an older stand with a pitched
// roof and white iron columns, and a big screen on legs. Gaps between
// them let the downland and the sky show through.
// The main stand, a cantilevered modern grandstand, painted level by
// level from the roof down. `st` is its geometry: left and right edges,
// width, height, and the heights where each level ends.
function paintMainStand(g, L, R, h) {
  const st = {
    L, R, W: R - L, h,
    fY0: h * 0.10, fY1: h * 0.16,    // roof fascia
    uY1: h * 0.42,                   // upper tier ends
    gY1: h * 0.53,                   // glazing ends
    sY1: h * 0.555,                  // balcony slab
    lY1: h * 0.89,                   // lower tier ends
  };
  paintStandFlags(g, st);
  paintStandUpperTier(g, st);
  paintStandFascia(g, st);
  paintStandGlazing(g, st);
  paintStandLowerTier(g, st);
  paintStandColumns(g, st);
  paintStandWall(g, st);
}

function paintStandFlags(g, st) {
  const { L, R, W, h, fY0 } = st;
  // Flags along the roofline
  const FLAGS = [[196, 40, 44], [240, 238, 232], [212, 175, 55], [32, 60, 112]];
  for (let x = L + W * 0.08; x < R - 8; x += W / 6 + rnd(-8, 8)) {
    g.fillStyle = 'rgba(210,214,220,0.9)';
    g.fillRect(x, fY0 - h * 0.085, 0.7, h * 0.085);
    g.fillStyle = rgb(pick(FLAGS), 0.95);
    const fw = h * 0.05, fh = h * 0.032;
    g.beginPath();
    g.moveTo(x + 0.7, fY0 - h * 0.085);
    g.quadraticCurveTo(x + fw * 0.5, fY0 - h * 0.085 - fh * 0.2, x + fw, fY0 - h * 0.08);
    g.lineTo(x + fw, fY0 - h * 0.08 + fh);
    g.quadraticCurveTo(x + fw * 0.5, fY0 - h * 0.085 + fh * 0.8, x + 0.7, fY0 - h * 0.085 + fh);
    g.closePath();
    g.fill();
  }
}

function paintStandUpperTier(g, st) {
  const { L, R, W, h, fY1, uY1 } = st;
  // Under-roof void: the back wall and upper tier sit in deep shade.
  const shade = g.createLinearGradient(0, fY1, 0, uY1);
  shade.addColorStop(0, 'rgb(22,26,34)');
  shade.addColorStop(1, 'rgb(40,46,56)');
  g.fillStyle = shade;
  g.fillRect(L, fY1, W, uY1 - fY1);
  paintCrowd(g, L + 2, fY1 + h * 0.02, R - 2, uY1, 0.44, 0.9, 2.5, [34, 48, 70]);
  paintAisles(g, L, fY1 + h * 0.02, R, uY1, 74, 0.45);
  // The roof's shadow falls hardest on the rows right under it.
  const roofShadow = g.createLinearGradient(0, fY1, 0, fY1 + (uY1 - fY1) * 0.55);
  roofShadow.addColorStop(0, 'rgba(8,10,16,0.62)');
  roofShadow.addColorStop(1, 'rgba(8,10,16,0)');
  g.fillStyle = roofShadow;
  g.fillRect(L, fY1, W, (uY1 - fY1) * 0.55);
  // Roof trusses in the gloom
  g.strokeStyle = 'rgba(160,170,184,0.10)';
  g.lineWidth = 0.6;
  for (let x = L; x < R; x += 16) {
    g.beginPath();
    g.moveTo(x, fY1);
    g.lineTo(x + 8, fY1 + h * 0.035);
    g.lineTo(x + 16, fY1);
    g.stroke();
  }
}

function paintStandFascia(g, st) {
  const { L, W, fY0, fY1 } = st;
  // Roof fascia, sunlit, with a hard highlight on the leading edge
  const fascia = g.createLinearGradient(0, fY0, 0, fY1);
  fascia.addColorStop(0, 'rgb(236,238,236)');
  fascia.addColorStop(1, 'rgb(188,194,200)');
  g.fillStyle = fascia;
  g.fillRect(L - 3, fY0, W + 6, fY1 - fY0);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(L - 3, fY0, W + 6, 0.8);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(L - 3, fY1, W + 6, 1);
}

function paintStandGlazing(g, st) {
  const { L, R, W, uY1, gY1 } = st;
  // Glazed hospitality level: dark glass, a sky reflection across the
  // top, and warm light in some of the boxes.
  const glass = g.createLinearGradient(0, uY1, 0, gY1);
  glass.addColorStop(0,    'rgb(96,120,146)');
  glass.addColorStop(0.35, 'rgb(52,66,84)');
  glass.addColorStop(1,    'rgb(24,30,40)');
  g.fillStyle = glass;
  g.fillRect(L, uY1, W, gY1 - uY1);
  for (let x = L + 2; x < R - 10; x += 13) {
    if (Math.random() < 0.34) {
      g.fillStyle = 'rgba(255,206,146,' + rnd(0.22, 0.5).toFixed(3) + ')';
      g.fillRect(x + 1, uY1 + (gY1 - uY1) * 0.38, 11, (gY1 - uY1) * 0.5);
      // Someone at the window
      if (Math.random() < 0.5) {
        g.fillStyle = 'rgba(18,16,16,0.55)';
        g.fillRect(x + rnd(3, 8), uY1 + (gY1 - uY1) * 0.5, 1.3, (gY1 - uY1) * 0.38);
      }
    }
    g.fillStyle = 'rgba(14,18,24,0.8)';
    g.fillRect(x, uY1, 0.8, gY1 - uY1);
  }
}

function paintStandLowerTier(g, st) {
  const { L, R, W, h, gY1, sY1, lY1 } = st;
  // Balcony slab and its shadow on the lower tier
  g.fillStyle = 'rgb(214,212,204)';
  g.fillRect(L - 2, gY1, W + 4, sY1 - gY1);
  const slabShadow = g.createLinearGradient(0, sY1, 0, sY1 + h * 0.08);
  slabShadow.addColorStop(0, 'rgba(0,0,0,0.38)');
  slabShadow.addColorStop(1, 'rgba(0,0,0,0)');

  // Lower tier, in the sun
  g.fillStyle = 'rgb(58,64,70)';
  g.fillRect(L, sY1, W, lY1 - sY1);
  paintCrowd(g, L + 2, sY1 + 0.5, R - 2, lY1, 0.98, 0.84, 2.9, [30, 92, 84]);
  paintAisles(g, L, sY1, R, lY1, 74, 0.95);
  g.fillStyle = slabShadow;
  g.fillRect(L, sY1, W, h * 0.08);
}

function paintStandColumns(g, st) {
  const { L, R, W, fY1, gY1 } = st;
  // Steel columns, lit on the sun side
  for (let x = L + W / 7; x < R - 6; x += W / 7) {
    g.fillStyle = 'rgb(38,44,54)';
    g.fillRect(x, fY1, 2.4, gY1 - fY1);
    g.fillStyle = 'rgba(220,226,232,0.5)';
    g.fillRect(x + 1.7, fY1, 0.7, gY1 - fY1);
  }
}

function paintStandWall(g, st) {
  const { L, W, h, lY1 } = st;
  // Front wall
  const wall = g.createLinearGradient(0, lY1, 0, h);
  wall.addColorStop(0, 'rgb(232,228,216)');
  wall.addColorStop(1, 'rgb(196,190,176)');
  g.fillStyle = wall;
  g.fillRect(L - 2, lY1, W + 4, h - lY1);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(L - 2, lY1, W + 4, 0.8);
}

function paintOldStand(g, L, R, h) {
  const W = R - L;
  const rY0 = h * 0.36, rY1 = h * 0.45, lY1 = h * 0.89;

  // Pitched roof seen from the front: slate band with gables at the ends
  const slate = g.createLinearGradient(0, rY0, 0, rY1);
  slate.addColorStop(0, 'rgb(74,78,86)');
  slate.addColorStop(1, 'rgb(44,48,56)');
  g.fillStyle = slate;
  g.beginPath();
  g.moveTo(L - 4, rY1);
  g.lineTo(L + W * 0.04, rY0);
  g.lineTo(R - W * 0.04, rY0);
  g.lineTo(R + 4, rY1);
  g.closePath();
  g.fill();
  // Gable pediment at the centre, with a clock
  const cx = (L + R) / 2;
  g.fillStyle = 'rgb(226,222,210)';
  g.beginPath();
  g.moveTo(cx - W * 0.1, rY0 + 1);
  g.lineTo(cx, rY0 - h * 0.1);
  g.lineTo(cx + W * 0.1, rY0 + 1);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgb(30,32,36)';
  g.beginPath();
  g.arc(cx, rY0 - h * 0.035, h * 0.024, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgb(236,232,220)';
  g.beginPath();
  g.arc(cx, rY0 - h * 0.035, h * 0.018, 0, Math.PI * 2);
  g.fill();
  // Lit gutter line
  g.fillStyle = 'rgba(236,236,230,0.85)';
  g.fillRect(L - 4, rY1, W + 8, 1.2);

  // Seating under the roof, shaded near the top
  g.fillStyle = 'rgb(46,50,56)';
  g.fillRect(L, rY1 + 1, W, lY1 - rY1 - 1);
  paintCrowd(g, L + 2, rY1 + 2, R - 2, lY1, 0.7, 0.78, 2.8, [96, 34, 40]);
  const under = g.createLinearGradient(0, rY1, 0, rY1 + (lY1 - rY1) * 0.5);
  under.addColorStop(0, 'rgba(6,8,12,0.55)');
  under.addColorStop(1, 'rgba(6,8,12,0)');
  g.fillStyle = under;
  g.fillRect(L, rY1, W, (lY1 - rY1) * 0.5);

  // White cast-iron columns — the signature of a Victorian stand
  for (let x = L + 6; x < R - 4; x += W / 9) {
    g.fillStyle = 'rgb(236,234,228)';
    g.fillRect(x, rY1 + 1, 1.3, lY1 - rY1);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + 1.3, rY1 + 1, 0.6, lY1 - rY1);
  }

  const wall = g.createLinearGradient(0, lY1, 0, h);
  wall.addColorStop(0, 'rgb(224,218,204)');
  wall.addColorStop(1, 'rgb(188,180,164)');
  g.fillStyle = wall;
  g.fillRect(L - 2, lY1, W + 4, h - lY1);
}

function paintBigScreen(g, L, R, h) {
  const W = R - L;
  const top = h * 0.2, bot = h * 0.56;
  // Legs
  g.fillStyle = 'rgb(34,38,46)';
  g.fillRect(L + W * 0.2, bot, 2.2, h - bot);
  g.fillRect(R - W * 0.2 - 2.2, bot, 2.2, h - bot);
  // Frame + panel showing the race, as every course's big screen does
  g.fillStyle = 'rgb(16,18,22)';
  g.fillRect(L, top, W, bot - top);
  const img = g.createLinearGradient(0, top + 2, 0, bot - 2);
  img.addColorStop(0,    'rgb(104,150,196)');
  img.addColorStop(0.42, 'rgb(150,174,188)');
  img.addColorStop(0.46, 'rgb(46,92,62)');
  img.addColorStop(1,    'rgb(30,70,46)');
  g.fillStyle = img;
  g.fillRect(L + 2, top + 2, W - 4, bot - top - 4);
  // A couple of tiny runners on screen
  g.fillStyle = 'rgba(40,24,14,0.8)';
  g.fillRect(L + W * 0.42, top + (bot - top) * 0.6, W * 0.1, 1.4);
  g.fillRect(L + W * 0.56, top + (bot - top) * 0.64, W * 0.1, 1.4);
  // Screen glare
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(L + 2, top + 2, W - 4, (bot - top) * 0.25);
}

// ── Trees ────────────────────────────────────────────────────────
// Built from leaf clusters rather than single ellipses: forty-odd small
// clumps per crown, each shaded by where it sits relative to the light,
// so the crown has a lit upper-right shoulder and a dark underside. A
// few tall narrow poplars break up the line.
const LEAF = [[26, 44, 32], [34, 56, 38], [44, 70, 46], [58, 86, 56], [74, 102, 64], [94, 122, 74]];

function paintTree(g, cx, groundY, hT, cw, tall) {
  const crownCY = groundY - hT * 0.56;
  const rx = cw / 2, ry = hT * 0.46;
  // Trunk
  g.fillStyle = 'rgb(44,36,28)';
  g.fillRect(cx - 0.6, groundY - hT * 0.3, 1.2, hT * 0.3);
  const n = tall ? 34 : 46;
  const clumps = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random());
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d;
    const light = 0.5 + 0.34 * (dx * 0.6 - dy * 0.8) + rnd(-0.12, 0.12);
    clumps.push({ x: cx + dx * rx, y: crownCY + dy * ry, r: cw * rnd(0.08, 0.17), l: light });
  }
  clumps.sort((a, b) => a.l - b.l);
  for (const c of clumps) {
    const idx = Math.max(0, Math.min(LEAF.length - 1, Math.round(c.l * (LEAF.length - 1))));
    g.fillStyle = rgb(LEAF[idx]);
    g.beginPath();
    g.ellipse(c.x, c.y, c.r, c.r * 0.86, 0, 0, Math.PI * 2);
    g.fill();
  }
}

// Every repeating scenery plane, painted once per resize. The order is
// the order they are painted in, not the order they are drawn in.
function buildBackdropTiles() {
  const cloudK = Math.max(0.55, Math.min(1.1, viewW / 1440));
  TILES.cloudsHigh = buildHighCloudTile(cloudK);
  TILES.cloudsLow  = buildLowCloudTile(cloudK);
  TILES.hills      = buildHillsTile(Math.max(60, viewH * 0.14));
  TILES.stand      = buildStandTile(Math.max(80, viewH * 0.17));
  TILES.trees      = buildTreesTile(Math.max(30, viewH * 0.058));
  TILES.railCrowd  = buildRailCrowdTile();
  TILES.boards     = buildBoardsTile();
  TILES.turf       = buildTurfTile();
}

// ── High cloud ──
function buildHighCloudTile(cloudK) {
  const hiH = Math.round(Math.max(90, viewH * 0.22));
  return softenTile(makeTile(1900, hiH, (g, w, h) => {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const W = rnd(220, 420) * cloudK;
      const cx = (i + 0.5) * (w / n) + rnd(-40, 40);
      paintCirrus(g, Math.max(W / 2, Math.min(w - W / 2, cx)), h * rnd(0.25, 0.7), W, h * 0.3);
    }
  }), 2.2);
}

// ── Low cloud ──
function buildLowCloudTile(cloudK) {
  const loH = Math.round(Math.max(120, viewH * 0.28));
  return softenTile(makeTile(1600, loH, (g, w, h) => {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const W = rnd(150, 320) * cloudK;
      const H = W * rnd(0.34, 0.5);
      const slot = w / n;
      const cx = Math.max(W * 0.55, Math.min(w - W * 0.55, (i + 0.5) * slot + rnd(-slot * 0.2, slot * 0.2)));
      paintCumulus(g, cx, h * rnd(0.74, 0.92), W, Math.min(H, h * 0.7));
    }
  }), 1.1);
}

// ── Distant downland: two ridges, the far one lost in haze ──
// Integer frequencies across the tile width, so the ridges wrap.
function buildHillsTile(hillH) {
  return softenTile(makeTile(1400, hillH, (g, w, h) => {
    const ridge = (base, amp, f1, f2, ph, top, bottom) => {
      const gr = g.createLinearGradient(0, h * 0.15, 0, h);
      gr.addColorStop(0, top);
      gr.addColorStop(1, bottom);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const u = (x / w) * Math.PI * 2;
        g.lineTo(x, h * (base + amp * Math.sin(u * f1 + ph) + amp * 0.45 * Math.sin(u * f2 + ph * 1.7)));
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    };
    ridge(0.40, 0.14, 2, 5, 0.6, 'rgba(150,172,192,0.72)', 'rgba(130,152,170,0.78)');
    ridge(0.60, 0.10, 3, 7, 2.1, 'rgba(98,126,120,0.86)', 'rgba(80,106,98,0.9)');
    // Woodland texture on the near ridge
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * w, y = h * rnd(0.62, 1);
      g.fillStyle = 'rgba(40,62,50,' + rnd(0.15, 0.35).toFixed(3) + ')';
      g.fillRect(x, y, rnd(1, 3), rnd(0.8, 1.6));
    }
  }), 1.2);
}

// ── Grandstands ──
function buildStandTile(standH) {
  return softenTile(makeTile(1500, standH, (g, w, h) => {
    paintMainStand(g, w * 0.055, w * 0.60, h);
    paintOldStand(g, w * 0.64, w * 0.895, h);
    paintBigScreen(g, w * 0.925, w * 0.985, h);
    hazeTile(g, w, h, 'rgba(176,196,214,0.13)');
  }), 0.5);
}

// ── Treeline ──
function buildTreesTile(treeH) {
  return softenTile(makeTile(1100, treeH, (g, w, h) => {
    // Hedge along the bottom, with a broken top edge
    g.fillStyle = 'rgb(30,52,36)';
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.7 + Math.sin(x * 0.37) * 1.2 + rnd(-0.8, 0.8));
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    let x = 0;
    while (x < w) {
      const tall = Math.random() < 0.12;
      const hT = h * (tall ? rnd(0.92, 1.0) : rnd(0.5, 0.88));
      const cw = tall ? h * rnd(0.22, 0.3) : h * rnd(0.45, 0.95);
      wrapPaint(w, x, cw, (px) => paintTree(g, px, h, hT, cw, tall));
      x += cw * rnd(0.5, 0.9);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(10,20,12,0.22)' : 'rgba(120,150,96,0.14)';
      g.fillRect(Math.random() * w, h * rnd(0.72, 1), 1, 1);
    }
    hazeTile(g, w, h, 'rgba(160,184,200,0.1)');
  }), 0.35);
}

// ── Rail-side spectators ──
// Two rows standing at the rail, the back row a touch smaller and
// further into shade. Hats, race cards, binoculars and the odd raised
// arm: small things, but a rail crowd of identical figures is what
// reads as clip art.
function buildRailCrowdTile() {
  return softenTile(makeTile(720, 38, (g, w, h) => {
    for (let x = 4; x < w; x += rnd(4.4, 6.2)) paintRailSpectator(g, x, h - 8, 0.8, 0.8);
    for (let x = 2; x < w; x += rnd(5.2, 7.2)) paintRailSpectator(g, x, h - 1, 1.0, 1.0);
    hazeTile(g, w, h, 'rgba(176,196,214,0.06)');
  }), 0.25);
}

function paintRailSpectator(g, x, base, s, light) {
  const tall = rnd(14, 18) * s;
  const sh = base - tall * 0.62;
  const bw = rnd(4.6, 5.6) * s;
  const coat = pick(CLOTHES);
  g.fillStyle = rgb(coat, light);
  g.beginPath();
  g.moveTo(x - bw * 0.46, base);
  g.lineTo(x - bw * 0.5, sh + 1.2 * s);
  g.quadraticCurveTo(x - bw * 0.5, sh, x - bw * 0.2, sh);
  g.lineTo(x + bw * 0.2, sh);
  g.quadraticCurveTo(x + bw * 0.5, sh, x + bw * 0.5, sh + 1.2 * s);
  g.lineTo(x + bw * 0.46, base);
  g.closePath();
  g.fill();
  // Shade on the side away from the sun
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(x - bw * 0.5, sh + 1, bw * 0.3, base - sh - 1);
  // Head
  const hr = 1.75 * s;
  const hy = sh - hr * 1.05;
  g.fillStyle = rgb(pick(SKINS), light);
  g.beginPath();
  g.ellipse(x, hy, hr * 0.9, hr, 0, 0, Math.PI * 2);
  g.fill();
  const r = Math.random();
  if (r < 0.2) {                                   // trilby / flat cap
    g.fillStyle = rgb(pick([[40, 36, 32], [70, 60, 48], [120, 104, 80]]), light);
    g.fillRect(x - hr * 1.25, hy - hr * 0.55, hr * 2.5, hr * 0.35);
    g.fillRect(x - hr * 0.85, hy - hr * 1.15, hr * 1.7, hr * 0.65);
  } else if (r < 0.27) {                           // fascinator
    g.fillStyle = rgb(pick([[196, 40, 60], [212, 175, 55], [60, 90, 170], [240, 240, 236]]), light);
    g.beginPath();
    g.ellipse(x + hr * 0.5, hy - hr * 0.8, hr * 0.8, hr * 0.45, -0.4, 0, Math.PI * 2);
    g.fill();
  } else {                                         // hair
    g.fillStyle = rgb(pick(HAIR), light);
    g.beginPath();
    g.ellipse(x, hy - hr * 0.35, hr * 0.92, hr * 0.7, 0, Math.PI, 0);
    g.fill();
  }
  const p = Math.random();
  if (p < 0.14) {                                  // arm up, cheering
    g.strokeStyle = rgb(coat, light);
    g.lineWidth = 1.2 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x + bw * 0.4, sh + 1);
    g.lineTo(x + bw * 0.75, sh - tall * 0.3);
    g.stroke();
  } else if (p < 0.24) {                           // binoculars
    g.fillStyle = 'rgb(20,20,22)';
    g.fillRect(x - hr * 0.9, hy - hr * 0.2, hr * 1.8, hr * 0.7);
  } else if (p < 0.36) {                           // race card
    g.fillStyle = 'rgba(244,242,236,0.95)';
    g.fillRect(x + bw * 0.1, sh + tall * 0.15, 1.8 * s, 2.4 * s);
  }
}

// Advertising hoardings: background, wordmark and accent colours.
const BOARD_SCHEMES = [
  { bg: [18, 54, 38], fg: [236, 230, 210], ac: [212, 175, 55] },
  { bg: [22, 30, 60], fg: [242, 242, 242], ac: [206, 60, 60] },
  { bg: [236, 232, 222], fg: [30, 34, 44], ac: [40, 96, 64] },
  { bg: [98, 24, 34], fg: [246, 236, 214], ac: [212, 175, 55] },
  { bg: [14, 16, 20], fg: [232, 232, 232], ac: [120, 172, 222] },
];

// ── Advertising hoardings along the far rail ──
function buildBoardsTile() {
  return makeTile(1024, 13, (g, w, h) => {
    let x = 0;
    while (x < w) {
      const pw = Math.min(w - x, rnd(90, 200));
      const s = pick(BOARD_SCHEMES);
      g.fillStyle = rgb(s.bg);
      g.fillRect(x, 0, pw, h);
      // Faux wordmark and an accent mark
      g.fillStyle = rgb(s.fg);
      let tx = x + pw * rnd(0.18, 0.3);
      const words = 1 + (Math.random() * 2 | 0);
      for (let i = 0; i < words; i++) {
        const ww = pw * rnd(0.12, 0.26);
        g.fillRect(tx, h * 0.38, ww, h * 0.26);
        tx += ww + pw * 0.05;
      }
      g.fillStyle = rgb(s.ac);
      g.beginPath();
      g.arc(x + pw * 0.1, h * 0.5, h * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(x, 0, pw, 0.6);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, h - 1, pw, 1);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x, 0, 0.6, h);
      x += pw;
    }
    hazeTile(g, w, h, 'rgba(176,196,214,0.1)');
  });
}

// ── Turf tile for the track plane ──
// Mown stripes plus a grain of divot marks. Tiled in WORLD px, so it
// scrolls at exactly the rate the horses travel.
function buildTurfTile() {
  const turfW = 320;
  const turfH = Math.max(40, Math.round(viewH * 0.60));
  return makeTile(turfW, turfH, (g, w, h) => {
    g.fillStyle = COL.trackTurf;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.055)';
    g.fillRect(0, 0, w / 2, h);
    for (let i = 0; i < 520; i++) {
      g.fillStyle = Math.random() > 0.5
        ? 'rgba(226,244,206,0.045)' : 'rgba(0,0,0,0.055)';
      g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 5), rnd(0.8, 1.6));
    }
  });
}

// Rebuilding the tiles paints tens of thousands of spectators, which is
// fine once but not on every event of a window drag. Debounced: the old
// tiles keep drawing (slightly mis-sized) until the drag settles.
let tileRebuildTimer = null;
function scheduleTileRebuild() {
  if (!TILES.stand) { buildBackdropTiles(); return; }
  clearTimeout(tileRebuildTimer);
  tileRebuildTimer = setTimeout(() => {
    buildBackdropTiles();
    redrawFrame();
    ambientPainted = false;
  }, 180);
}

function planeScale(key) {
  return 1 + (CAM.zoom - 1) * (PLANE_ZOOM[key] != null ? PLANE_ZOOM[key] : 1);
}

// A tile repeated across the screen: its bottom edge at bottomY, scrolled
// by offsetPx and drawn at `scale`. racePlane() and ambientPlane() work out
// the offset and scale for each plane — its parallax rate, its share of
// the camera zoom, and any motion of its own, like the wind in the clouds.
function blitTiled(c, tile, bottomY, offsetPx, alpha, scale) {
  if (!tile) return;
  const w = tile.w * scale, h = tile.h * scale;
  c.save();
  c.globalAlpha = alpha;
  let x = -(((offsetPx % w) + w) % w);
  for (; x < viewW + w; x += w) c.drawImage(tile.canvas, x, bottomY - h, w, h);
  c.restore();
}

// The scenery behind a shot, back to front: sky, sun, high and low
// cloud, the sun's glow over them, downland, stands, trees, haze. The
// race, the ambient backdrop and the Winning Moment each frame it their
// own way: `planes` gives each tile's baseline, scroll offset (px),
// opacity and scale.
function paintScenery(c, sky, planes, haze) {
  paintSky(c, sky.bottom, sky.warm);
  paintSunDisc(c);
  for (const key of ['cloudsHigh', 'cloudsLow']) blitPlane(c, key, planes[key]);
  paintSunGlow(c);
  for (const key of ['hills', 'stand', 'trees']) blitPlane(c, key, planes[key]);
  paintHorizonHaze(c, haze.horizon, haze.height);
}

function blitPlane(c, key, p) {
  blitTiled(c, TILES[key], p.bottom, p.offset, p.alpha, p.scale);
}

// A plane in the race shot: scrolled by the camera at its parallax rate,
// scaled by its share of the zoom.
function racePlane(key, bottom, alpha, extra) {
  const scale = planeScale(key);
  return { bottom, offset: CAM.x * PARALLAX[key] * scale + (extra || 0), alpha, scale };
}

// ── Sky ──────────────────────────────────────────────────────────
function paintSky(c, skyBottom, warm) {
  const sky = c.createLinearGradient(0, 0, 0, skyBottom);
  sky.addColorStop(0,    '#35699e');
  sky.addColorStop(0.34, '#5b93c8');
  sky.addColorStop(0.66, '#98bedc');
  sky.addColorStop(0.88, '#d0dad8');
  sky.addColorStop(1,    '#e6d6b6');
  c.fillStyle = sky;
  c.fillRect(0, 0, viewW, skyBottom + 2);

  // Afternoon light pooling on the sun side of the sky
  const haze = c.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, viewW * 0.55);
  haze.addColorStop(0, 'rgba(255,236,196,' + (0.36 + warm * 0.14).toFixed(3) + ')');
  haze.addColorStop(1, 'rgba(255,230,180,0)');
  c.fillStyle = haze;
  c.fillRect(0, 0, viewW, skyBottom + 2);
}

function paintSunDisc(c) {
  const r = Math.max(6, viewH * 0.016);
  const g = c.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, r * 5);
  g.addColorStop(0,    'rgba(255,253,244,1)');
  g.addColorStop(0.2,  'rgba(255,248,226,0.95)');
  g.addColorStop(0.45, 'rgba(255,236,196,0.35)');
  g.addColorStop(1,    'rgba(255,230,180,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(SUN.x, SUN.y, r * 5, 0, Math.PI * 2);
  c.fill();
}

// Drawn AFTER the clouds with a screen blend, so a cloud passing the sun
// picks up a bright rim rather than simply blotting it out.
function paintSunGlow(c) {
  c.save();
  c.globalCompositeOperation = 'screen';
  const g = c.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, viewW * 0.26);
  g.addColorStop(0, 'rgba(255,238,204,0.42)');
  g.addColorStop(1, 'rgba(255,238,204,0)');
  c.fillStyle = g;
  c.fillRect(SUN.x - viewW * 0.26, SUN.y - viewW * 0.26, viewW * 0.52, viewW * 0.52);
  c.restore();
}

// Aerial haze sitting on the horizon, over the base of the stands and
// the trees — distance, and a sunny afternoon's worth of moisture.
function paintHorizonHaze(c, horizon, depth) {
  const top = horizon - depth;
  const g = c.createLinearGradient(0, top, 0, horizon + viewH * 0.05);
  g.addColorStop(0,   'rgba(214,224,232,0)');
  g.addColorStop(0.7, 'rgba(214,224,232,0.14)');
  g.addColorStop(1,   'rgba(222,226,222,0.24)');
  c.fillStyle = g;
  c.fillRect(0, top, viewW, horizon + viewH * 0.05 - top);
}

// The backdrop lives on #particleCanvas, which sits behind the race
// canvas in the stacking order. Keeping it on its own surface means the
// track plane can clear and redraw without touching the sky.
function drawBackdrop() {
  pCtx.clearRect(0, 0, viewW, viewH);

  const horizon  = worldToScreenY(WORLD.horizonY);
  const standH   = TILES.stand ? TILES.stand.h * planeScale('stand') : viewH * 0.17;
  const standTop = horizon + 2 - standH;
  const skyBottom = Math.max(horizon + viewH * 0.10, viewH * 0.30);

  // The sun is at infinity: parallax zero, so the clouds sail past it.
  // Placed clear of the Live Positions panel, which owns the top right.
  SUN.x = viewW * (isNarrowViewport() ? 0.5 : 0.64);
  SUN.y = Math.max(viewH * 0.07, standTop - viewH * 0.11);
  SUN.visible = Math.max(0, Math.min(1, (standTop - SUN.y) / (viewH * 0.08)));

  // Clouds sit behind the downland, so the ridge cuts off their bases.
  const t = frameClock;
  paintScenery(pCtx, { bottom: skyBottom, warm: DIRECTOR.progress }, {
    cloudsHigh: racePlane('cloudsHigh', standTop + viewH * 0.03, 0.9, t * WIND.cloudsHigh),
    cloudsLow:  racePlane('cloudsLow',  standTop + viewH * 0.07, 1,   t * WIND.cloudsLow),
    hills:      racePlane('hills', horizon + 6, 0.92),
    stand:      racePlane('stand', horizon + 2, 1),
    trees:      racePlane('trees', horizon + Math.max(14, viewH * 0.045), 1),
  }, { horizon, height: standH * 0.7 });
}

// ════════════════════════════════════════════════════════════════
//  AMBIENT BACKDROP
// ════════════════════════════════════════════════════════════════
// The race screen has an entire racecourse behind it. Every other screen
// was flat black, so the experience read as five separate web pages
// rather than one afternoon at the track — and the cut from the parade
// into the race was a cut from a void into a world.
//
// This paints a slow, dimmed, defocused version of the SAME parallax
// world behind the content screens: the same tiles, the same planes, a
// fraction of the speed, under a heavy scrim so type stays legible. It
// draws on #particleCanvas, which already sits behind every screen, and
// it stands down the instant the race takes the canvas over.
const AMBIENT_DRIFT = 0.011;   // world px per ms — a very slow pan
let ambientX = 0;
let ambientPainted = false;

// A plane in the ambient backdrop: drifting at its parallax rate.
function ambientPlane(key, bottom, alpha, extra) {
  return { bottom, offset: ambientX * PARALLAX[key] + (extra || 0), alpha, scale: 1 };
}

function drawAmbient() {
  const horizon = viewH * 0.54;
  pCtx.clearRect(0, 0, viewW, viewH);

  const standH   = TILES.stand ? TILES.stand.h : viewH * 0.17;
  const standTop = horizon + 2 - standH;
  SUN.x = viewW * (isNarrowViewport() ? 0.5 : 0.64);
  SUN.y = Math.max(viewH * 0.08, standTop - viewH * 0.12);

  // The same sky, sun and clouds as the race, so the parade and the reveal
  // are unmistakably the same afternoon. The clouds drift on the wind
  // here too; the scrim below takes the brightness down for the type.
  paintScenery(pCtx, { bottom: horizon + viewH * 0.06, warm: 0.4 }, {
    cloudsHigh: ambientPlane('cloudsHigh', standTop + viewH * 0.03, 0.9, ambientX * 0.35),
    cloudsLow:  ambientPlane('cloudsLow',  standTop + viewH * 0.07, 1,   ambientX * 0.9),
    hills:      ambientPlane('hills', horizon + 6, 0.8),
    stand:      ambientPlane('stand', horizon + 2, 0.95),
    trees:      ambientPlane('trees', horizon + Math.max(14, viewH * 0.045), 1),
  }, { horizon, height: standH * 0.7 });

  // Turf running off the bottom of frame
  const turf = pCtx.createLinearGradient(0, horizon, 0, viewH);
  turf.addColorStop(0, '#2c4c36');
  turf.addColorStop(1, '#15271c');
  pCtx.fillStyle = turf;
  pCtx.fillRect(0, horizon + viewH * 0.03, viewW, viewH);

  // The scrim. Without this the backdrop fights every headline on top
  // of it; with it, it reads as a place the type is standing in front of.
  const scrim = pCtx.createLinearGradient(0, 0, 0, viewH);
  scrim.addColorStop(0,    'rgba(6,8,15,0.44)');
  scrim.addColorStop(0.45, 'rgba(6,8,15,0.58)');
  scrim.addColorStop(1,    'rgba(6,8,15,0.80)');
  pCtx.fillStyle = scrim;
  pCtx.fillRect(0, 0, viewW, viewH);

  const vg = pCtx.createRadialGradient(
    viewW * 0.5, viewH * 0.5, Math.min(viewW, viewH) * 0.22,
    viewW * 0.5, viewH * 0.5, Math.max(viewW, viewH) * 0.75
  );
  vg.addColorStop(0, 'rgba(2,4,9,0)');
  vg.addColorStop(1, 'rgba(2,4,9,0.5)');
  pCtx.fillStyle = vg;
  pCtx.fillRect(0, 0, viewW, viewH);
}

function ambientFrame() {
  // The race owns both canvases while it is running.
  if (raceRunning) { ambientPainted = false; return; }

  // Reduced motion still gets the scene, it just does not drift.
  if (prefersReducedMotion) {
    if (!ambientPainted) { drawAmbient(); ambientPainted = true; }
    return;
  }

  ambientX += Math.min(gsap.ticker.deltaRatio() * FRAME_MS, 50) * AMBIENT_DRIFT;
  drawAmbient();
}

// ════════════════════════════════════════════════════════════════
//  TRACK PLANE
// ════════════════════════════════════════════════════════════════

// Far rail, running-rail posts and advertising boards. Drawn on the
// race canvas but offset at 0.68 rather than 1.0, so the far side of
// the track slides past more slowly than the turf underfoot — the
// depth cue that makes the track look wide.
function drawFarRail() {
  const y = WORLD.trackTopY;
  // Drawing inside the world transform means geometry at world x lands
  // at rate 1.0. Shifting the whole plane by +CAM.x × (1 − factor)
  // cancels part of that back out, leaving it scrolling at `factor`.
  const shift = CAM.x * (1 - PARALLAX.farRail);

  ctx.save();
  ctx.translate(shift, 0);
  const vis  = visibleWorldRange(viewW);
  const step = WORLD.lengthPx * 3.2;
  const from = Math.floor((vis.min - shift) / step) * step;
  const to   = vis.max - shift;

  // Rail-side spectators, standing behind the boards. Tiled at the same
  // depth as the rail so they track with it, and drawn before the boards
  // so the boards cut them off at the waist the way a real one does.
  if (TILES.railCrowd) {
    const rc = TILES.railCrowd;
    // Scaled by the world's horse size, not drawn at tile resolution:
    // these are people standing next to horses, so on a phone they have
    // to shrink by the same factor the horses do or the rail ends up
    // lined with giants.
    const cs = WORLD.horseScale;
    const cw = rc.w * cs, ch = rc.h * cs;
    let cx = Math.floor((vis.min - shift) / cw) * cw;
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (; cx < to; cx += cw) {
      ctx.drawImage(rc.canvas, cx, y - 22 - ch + 5 * cs, cw, ch);
    }
    ctx.restore();
  }

  // Advertising hoardings in front of them: individual sponsor panels,
  // lit along the top edge and hazed for distance, rather than the flat
  // two-tone band V2 started with.
  if (TILES.boards) {
    const b = TILES.boards;
    let bx = Math.floor((vis.min - shift) / b.w) * b.w;
    ctx.save();
    ctx.globalAlpha = 0.92;
    for (; bx < to; bx += b.w) ctx.drawImage(b.canvas, bx, y - 22, b.w, 13);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(28,40,56,0.62)';
    ctx.fillRect(from - step, y - 22, to - from + step * 2, 13);
  }

  // Running rail
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(from - step, y - 6);
  ctx.lineTo(to, y - 6);
  ctx.stroke();

  ctx.fillStyle = 'rgba(240,244,250,0.38)';
  ctx.beginPath();
  for (let x = from; x < to; x += step) ctx.rect(x, y - 6, 1.6, 7);
  ctx.fill();
  ctx.restore();
}

function drawTurf() {
  const vis = visibleWorldRange(240);
  const top = WORLD.trackTopY - 8;
  const bot = viewH * 1.4;   // run the turf off the bottom of frame

  if (TILES.turf) {
    const tw = TILES.turf.w;
    let x = Math.floor(vis.min / tw) * tw;
    for (; x < vis.max; x += tw) {
      ctx.drawImage(TILES.turf.canvas, x, top, tw, bot - top);
    }
  } else {
    ctx.fillStyle = COL.trackTurf;
    ctx.fillRect(vis.min, top, vis.max - vis.min, bot - top);
  }

  // Depth lighting — the far side of the track sits in cooler, hazier
  // light; the turf under the camera is warm and saturated. Without a
  // gradient here the whole ground reads as one flat sheet of green.
  const shade = ctx.createLinearGradient(0, top, 0, bot);
  shade.addColorStop(0,    'rgba(146,176,186,0.17)');
  shade.addColorStop(0.30, 'rgba(146,176,186,0.03)');
  shade.addColorStop(1,    'rgba(6,14,10,0.32)');
  ctx.fillStyle = shade;
  ctx.fillRect(vis.min, top, vis.max - vis.min, bot - top);
}

// Furlong markers count DOWN to the line, the way a real track does.
// They are the clearest read the viewer gets on how much race is left,
// and because they live in world space they sweep past at full rate.
function drawFurlongMarkers() {
  const vis   = visibleWorldRange(200);
  const every = WORLD.spanPx * TRK.furlongPoleEvery;
  const y     = WORLD.trackTopY;

  let i = Math.max(0, Math.floor(vis.min / every));
  for (; i * every <= vis.max; i++) {
    const x = i * every;
    if (x > WORLD.spanPx - every * 0.4) break;   // the post takes over here
    const left = Math.round((WORLD.spanPx - x) / every);
    if (left <= 0) continue;

    ctx.fillStyle = 'rgba(245,239,222,0.85)';
    ctx.fillRect(x - 1.5, y - 40, 3, 34);
    ctx.fillStyle = 'rgba(11,14,21,0.82)';
    ctx.beginPath();
    roundRectPath(ctx, x - 11, y - 58, 22, 18, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,239,222,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawTextLive(String(left), MARKER_TYPE, x, y - 45);
  }
}

// Track lettering stays live text (not textAsImage): it is big enough on
// screen to read, where a scaled bitmap would come out a shade softer, and
// there are only two or three pieces of it in a frame.
const MARKER_TYPE = { weight: 'bold', size: 11, family: '"DM Sans", sans-serif',
                      fill: 'rgba(245,239,222,0.92)', baseline: 'alphabetic' };

// The winning post. It lives at the far end of the world and is drawn
// only when it is genuinely in shot, which for a nine-screen race means
// the last few seconds. In V1 the finish line was pinned at 94% of the
// viewport from the moment the race started, so the viewer stared at
// the destination for forty seconds; here it arrives.
function drawWinningPost() {
  const x = WORLD.spanPx;
  const vis = visibleWorldRange(160);
  if (x < vis.min || x > vis.max) return;

  const top = WORLD.trackTopY;
  const bot = WORLD.trackBotY;

  // Painted line across the turf: alternate blocks of white and black,
  // each colour one fill.
  ctx.save();
  for (const white of [true, false]) {
    ctx.fillStyle = white ? 'rgba(255,255,255,0.92)' : 'rgba(14,18,26,0.92)';
    ctx.beginPath();
    for (let y = top - 6; y < bot + 26; y += 9) {
      if ((Math.floor(y / 9) % 2 === 0) === white) ctx.rect(x - 2, y, 4, 9);
    }
    ctx.fill();
  }

  // Post + gold finial on the far side
  ctx.fillStyle   = '#f5efde';
  ctx.strokeStyle = 'rgba(11,14,21,0.85)';
  ctx.lineWidth   = 1.2;
  ctx.beginPath();
  ctx.rect(x - 3, top - 92, 6, 92);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COL.gold;
  ctx.beginPath();
  ctx.arc(x, top - 96, 5, 0, Math.PI * 2);
  ctx.fill();

  // Gantry banner
  ctx.fillStyle   = 'rgba(11,14,21,0.94)';
  ctx.strokeStyle = COL.gold;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  roundRectPath(ctx, x - 58, top - 128, 116, 24, 4);
  ctx.fill();
  ctx.stroke();
  drawTextLive('THE LINE', { weight: 'bold', size: 13, family: '"DM Sans", sans-serif',
                             fill: COL.gold, baseline: 'alphabetic' }, x, top - 111);
  ctx.restore();
}

// Foreground plane — grass sweeping past in FRONT of the field at
// better than track rate. Deliberately soft and low-contrast: it reads
// as depth of field rather than as scenery.
function drawForegroundPlane() {
  if (prefersReducedMotion) return;
  const off  = CAM.x * PARALLAX.fore * CAM.zoom;
  const tw   = 190;
  const yTop = viewH - Math.max(28, viewH * 0.07);

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(14,32,22,0.9)';
  ctx.fillRect(0, viewH - 10, viewW, 10);

  // The blades never touch, so they are one stroke.
  ctx.strokeStyle = 'rgba(18,44,28,0.85)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let x = -(((off % tw) + tw) % tw);
  for (; x < viewW + tw; x += tw) {
    for (let i = 0; i < 5; i++) {
      const gx = x + i * 34;
      const gh = 14 + ((i * 53) % 17);
      ctx.moveTo(gx, viewH);
      ctx.quadraticCurveTo(gx + 5, yTop + gh * 0.4, gx + 12, yTop);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// Screen-space vignette + the flash at the line. Both are director
// values, so they ramp with the phases rather than being switched on.
function drawAtmosphere(flashEnergy) {
  if (DIRECTOR.vignette > 0.01) {
    const vg = ctx.createRadialGradient(
      viewW * 0.5, viewH * 0.5, Math.min(viewW, viewH) * 0.28,
      viewW * 0.5, viewH * 0.5, Math.max(viewW, viewH) * 0.72
    );
    vg.addColorStop(0, 'rgba(2,4,9,0)');
    vg.addColorStop(1, 'rgba(2,4,9,' + DIRECTOR.vignette.toFixed(3) + ')');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, viewW, viewH);
  }
  // A wall of flashguns lifts the whole frame a little. Capped, because
  // this is a bloom off the crowd, not a lightning strike.
  if (flashEnergy > 0.01) {
    const bloom = Math.min(0.13, flashEnergy * 0.02);
    ctx.fillStyle = 'rgba(226,238,255,' + bloom.toFixed(3) + ')';
    ctx.fillRect(0, 0, viewW, viewH);
  }

  drawLensFlare();
  drawGrain();

  if (DIRECTOR.flash > 0.005) {
    ctx.fillStyle = 'rgba(255,252,240,' + (DIRECTOR.flash * 0.85).toFixed(3) + ')';
    ctx.fillRect(0, 0, viewW, viewH);
  }

  drawLetterbox();
}

// ── Cinematic finishing ──────────────────────────────────────────
// Three things a camera does that a canvas does not, and which between
// them account for most of the difference between "rendered" and "shot".

// A long lens looking toward a low sun throws an anamorphic streak and a
// line of ghosts through the frame. It fades out as the camera pushes in
// and the stands take the sun out of shot.
function drawLensFlare() {
  const k = SUN.visible * Math.max(0, Math.min(1, 1.4 - CAM.zoom)) * 0.9;
  if (k < 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  const sw = viewW * 0.55;
  const streak = ctx.createLinearGradient(SUN.x - sw, 0, SUN.x + sw, 0);
  streak.addColorStop(0,   'rgba(150,190,255,0)');
  streak.addColorStop(0.5, 'rgba(200,222,255,' + (0.34 * k).toFixed(3) + ')');
  streak.addColorStop(1,   'rgba(150,190,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(SUN.x - sw, SUN.y - 1.2, sw * 2, 2.4);

  const cx = viewW / 2, cy = viewH / 2;
  const GHOSTS = [
    [0.38, 0.020, '255,208,150', 0.10],
    [0.62, 0.046, '150,220,210', 0.06],
    [0.86, 0.028, '190,160,255', 0.07],
    [1.22, 0.075, '255,196,140', 0.045],
  ];
  for (const [t, r, c, a] of GHOSTS) {
    const gx = SUN.x + (cx - SUN.x) * t * 2;
    const gy = SUN.y + (cy - SUN.y) * t * 2;
    const rr = viewH * r;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
    g.addColorStop(0,   'rgba(' + c + ',' + (a * k).toFixed(3) + ')');
    g.addColorStop(0.7, 'rgba(' + c + ',' + (a * k * 0.5).toFixed(3) + ')');
    g.addColorStop(1,   'rgba(' + c + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Film grain: a small noise tile laid over the frame at a new random
// offset every frame. Faint enough that nobody would call it grain, but
// it breaks up the dead-flat fills a canvas produces and knits the
// painted backdrop and the drawn horses into one image.
function buildGrainTile() {
  const S = 192;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.pow(Math.random(), 2.4) * 40;
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, w: S, h: S };
}

function drawGrain() {
  if (!TILES.grain) TILES.grain = buildGrainTile();
  const t = TILES.grain;
  // Static under reduced motion: texture without the dance.
  const ox = prefersReducedMotion ? 0 : -((Math.random() * t.w) | 0);
  const oy = prefersReducedMotion ? 0 : -((Math.random() * t.h) | 0);
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (let y = oy; y < viewH; y += t.h) {
    for (let x = ox; x < viewW; x += t.w) ctx.drawImage(t.canvas, x, y, t.w, t.h);
  }
  ctx.restore();
}

// Cinema bars. They close in through the Build and the Drive and are
// deepest through the final furlong — the frame literally narrows as the
// race does — and ease back a little as the camera opens up at the line.
function drawLetterbox() {
  const f = DIRECTOR.letterbox;
  if (f <= 0.002) return;
  const bar = Math.round(viewH * f);
  ctx.fillStyle = '#020306';
  ctx.fillRect(0, 0, viewW, bar);
  ctx.fillRect(0, viewH - bar, viewW, bar);
}
// ════════════════════════════════════════════════════════════════
//  MARGINS
// ════════════════════════════════════════════════════════════════
// Turning the Racing API beaten-distance strings into numbers and back
// into racing copy. Used by the finish overlay, the roll call and the
// reveal podium, so it lives between the world and the screens.

// Parse the Racing API beaten-distance string into a numeric lengths
// value. Handles: 'nse', 'sh', 'hd', 'nk', '½', '1¼', '2', '5', 'dist',
// 'DH'. Returns:
//   number      — lengths (e.g. 0.05 for nose, 1.25 for 1¼)
//   -1          — dead heat sentinel
//   null        — unparseable / missing
function parseBeatenDistance(s) {
  if (!s && s !== 0) return null;
  const t = String(s).trim().toLowerCase();
  if (!t) return null;
  if (t === 'dh' || t === 'dead heat' || t === 'dead-heat') return -1;
  const TOKEN = {
    'nse': 0.05, 'nose': 0.05,
    'sh':  0.10, 'short head': 0.10, 'short-head': 0.10, 'shd': 0.10,
    'hd':  0.15, 'head': 0.15,
    'nk':  0.25, 'neck': 0.25,
    'dist': 99,  'distance': 99,
  };
  if (TOKEN[t] !== undefined) return TOKEN[t];
  // Numeric parsing — strip 'L'/'l' suffix, convert vulgar fractions,
  // handle "1 1/2" mixed numbers + plain "n/d" fractions.
  let c = t.replace(/l$/, '').trim();
  c = c.replace(/¼/g, '.25').replace(/½/g, '.5').replace(/¾/g, '.75')
       .replace(/⅓/g, '.333').replace(/⅔/g, '.667');
  // "1 1/4" → "1.25"
  c = c.replace(/(\d+)\s+(\d+)\/(\d+)/g, (_, w, n, d) =>
    (parseInt(w, 10) + parseInt(n, 10) / parseInt(d, 10)).toString());
  // "1/2" → "0.5"
  c = c.replace(/^(\d+)\/(\d+)$/, (_, n, d) =>
    (parseInt(n, 10) / parseInt(d, 10)).toString());
  c = c.replace(/\s+/g, '');
  const n = parseFloat(c);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

// Format a numeric lengths value back into the standard racing copy
// used by Racing Post / ATR. Tuned for the finish-line headline so
// the eye reads it at a glance ("1¼ LENGTHS", "A SHORT HEAD").
// Racing's words for a margin under a length and a bit:
// [below this many lengths, headline copy, compact copy].
const MARGIN_WORDS = [
  [0.08, 'A NOSE',                     'nse'],
  [0.12, 'A SHORT HEAD',               'shd'],
  [0.20, 'A HEAD',                     'hd'],
  [0.40, 'A NECK',                     'nk'],
  [0.65, 'HALF A LENGTH',              '½L'],
  [0.90, 'THREE-QUARTERS OF A LENGTH', '¾L'],
  [1.10, 'A LENGTH',                   '1L'],
];

// A margin to the nearest quarter of a length, with a vulgar fraction:
// { value: 2.75, text: '2¾' }.
function quarterLengths(lengths) {
  const q = Math.round(lengths * 4) / 4;
  const whole = Math.floor(q);
  const frac  = q - whole;
  const fracStr = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  return { value: q, text: whole + fracStr };
}

// Headline copy for a margin in lengths ("A NECK", "2¾ LENGTHS"); -1 is
// a dead heat.
function formatBeatenDistance(lengths) {
  if (lengths === null || lengths === undefined) return '';
  if (lengths === -1) return 'DEAD HEAT';
  if (lengths >= 50) return 'A DISTANCE';
  const words = MARGIN_WORDS.find(([below]) => lengths < below);
  if (words) return words[1];
  const q = quarterLengths(lengths);
  return q.text + (q.value === 1 ? ' LENGTH' : ' LENGTHS');
}

// Racecard copy for the podium ("nk", "2¾L", "DH").
function formatBeatenDistanceCompact(lengths) {
  if (lengths === null || lengths === undefined) return '';
  if (lengths === -1) return 'DH';
  if (lengths >= 50) return 'dist';
  const words = MARGIN_WORDS.find(([below]) => lengths < below);
  if (words) return words[2];
  return quarterLengths(lengths).text + 'L';
}

// Compute the winning margin at the finish.
// Returns { lengths, source, winners } where:
//   lengths     — numeric lengths (winner over 2nd), -1 for dead heat
//   source      — 'result' | 'forecast' — drives copy + chip styling
//   winners     — array of horse names — usually [winner] or [dh1, dh2]
function computeWinningMargin() {
  const ranked = rankedHorses();
  if (ranked.length < 1) return null;
  const winnerName = ranked[0].runner.name;

  // ── Result mode — read from the Racing API beaten_distances ──
  if (REPLAY_DATA && REPLAY_DATA.has_result) {
    const dists = REPLAY_DATA.beaten_distances || {};
    // Find the dead-heat case first — 2nd-placed runner's gap is 'DH'.
    if (ranked.length >= 2) {
      const secondGap = parseBeatenDistance(dists[ranked[1].runner.id]);
      if (secondGap === -1) {
        return {
          lengths: -1,
          source:  'result',
          winners: [winnerName, ranked[1].runner.name],
        };
      }
      return {
        lengths: secondGap == null ? null : secondGap,
        source:  'result',
        winners: [winnerName],
      };
    }
  }

  // ── Forecast mode — derive from final X positions ──
  // World space measures the gap in lengths directly — no pixels-per-
  // length fudge factor, because a length IS the unit the model runs in.
  if (ranked.length < 2) {
    return { lengths: null, source: 'forecast', winners: [winnerName] };
  }
  const lengths = Math.max(0, ranked[1].deficit - ranked[0].deficit);
  return { lengths: lengths, source: 'forecast', winners: [winnerName] };
}
// ════════════════════════════════════════════════════════════════
//  THE FIELD
// ════════════════════════════════════════════════════════════════
// Three things changed here from V1, and all three came straight off
// the review:
//
//   • No trails. drawSpeedLines is gone. Speed now comes from the
//     parallax planes moving past a broadly stationary pack, which is
//     how a real camera shot reads. Streaks welded to a sprite are
//     what made it look like a browser game.
//   • No persistent labels. There is no name chip, no rank pill and no
//     pulsing gold ring on any runner at any point. Identification is
//     the broadcast lower-third plus, briefly, a thin ground marker.
//   • Depth. Runners are drawn far-lane-first and scaled by lane, so
//     the pack overlaps and occludes the way a real field does.

function drawField() {
  const vis    = visibleWorldRange(140);
  const ranked = rankedHorses();

  // Far lanes first so nearer horses occlude them.
  const drawList = horsesByLane.filter((h) => h.worldX >= vis.min && h.worldX <= vis.max);

  // The principal group stays fully lit; the tail recedes as the
  // director closes the frame down. Nobody is removed — a horse coming
  // through from the back still reads.
  const groupSize = principalGroupSize(ranked.length);
  const inGroup = new Set();
  for (let i = 0; i < groupSize; i++) inGroup.add(ranked[i].runner.id);

  // Only the opacity changes from horse to horse, so it is put back by
  // hand rather than by a save and restore per horse.
  const alpha = ctx.globalAlpha;
  drawList.forEach((h) => {
    const isUser = isUserPick(h.runner);
    const isFox  = isFoxPick(h.runner);

    ctx.globalAlpha = (!inGroup.has(h.runner.id) && DIRECTOR.fieldFade > 0)
      ? 1 - DIRECTOR.fieldFade * 0.72
      : alpha;

    // Restrained identification. A thin arc of the runner's own silk
    // colour on the turf beneath them, and only while the broadcast
    // lower-third is naming them — it fades with idGlow. The viewer's
    // pick and the Fox pick get a permanent but very quiet version of
    // the same mark: no text, no box, no glow around the animal.
    const markAlpha = Math.max(h.idGlow, (isUser || isFox) ? 0.5 : 0);
    if (markAlpha > 0.01) {
      drawGroundMarker(h, markAlpha, isUser ? COL.userLabel
                                   : isFox  ? COL.foxLabel
                                   :          (h.runner.silk || '#f5efde'));
    }

    const scale = WORLD.horseScale * h.depth;
    spawnHoofDust(h.worldX, h.y, h, strideCycle(h), scale);
    drawHorseSilhouette(h.worldX, h.y, h, scale);
  });
  ctx.globalAlpha = alpha;
}

// A short bar on the turf beneath the hooves, in the runner's own silk
// colour. Deliberately the least emphatic mark that still works: an
// ellipse or a glow around the animal is the arcade treatment we are
// getting rid of, and a floating chip is the label we just removed.
function drawGroundMarker(h, alpha, colour) {
  const s = WORLD.horseScale * h.depth;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha) * 0.75;
  ctx.fillStyle = colour;
  const w = 30 * s;
  ctx.fillRect(h.worldX - w / 2, h.y + 24 * s, w, Math.max(1.5, 2 * s));
  ctx.restore();
}

// ── Hoof dust ───────────────────────────────────────────────────
// Spawned at each gallop ground-contact beat and drawn in WORLD space,
// so a divot stays where it was kicked up and the camera leaves it
// behind. In V1 the dust lived in screen space on a canvas stacked
// underneath an opaque track, which is why nobody ever saw it.
const MAX_PARTICLES = 160;

function spawnHoofDust(wx, y, h, cyc, artScale) {
  if (prefersReducedMotion) return;
  if (particles.length > MAX_PARTICLES) return;
  if (h.speed < 0.02) return;

  const prevCyc = h.lastDustCycle == null ? cyc : h.lastDustCycle;
  h.lastDustCycle = cyc;

  for (const strike of GAIT_STRIKES) {
    const crossed = (prevCyc > strike)
      ? (cyc < prevCyc && cyc >= strike) || (cyc < strike && cyc < prevCyc - 0.5)
      : (cyc >= strike && prevCyc < strike);
    if (!crossed) continue;

    const puffs = Math.random() < 0.55 ? 1 : 0;
    for (let i = 0; i < puffs; i++) {
      particles.push({
        x:      wx - 16 * artScale - Math.random() * 10 * artScale,
        y:      y + 19 * artScale + Math.random() * 3,
        // Kicked backwards hard enough to be left behind by a galloping
        // horse — without this the puffs pool under the animal and read
        // as a pale halo rather than as ground being torn up.
        vx:     -3.2 - Math.random() * 3.4,
        vy:     -0.35 - Math.random() * 0.8,
        g:      -0.02,
        life:   0.45 + Math.random() * 0.3,
        size:   (2.6 + Math.random() * 2.6) * artScale,
        depth:  artScale,
      });
    }
  }
}

// Dust is drawn inside the world transform, between the far lanes and
// the near ones, so it sits in the pack rather than on top of it.
function drawHoofDust(dt) {
  const step = dt > 0 ? Math.max(0.5, Math.min(2.5, dt / FRAME_MS)) : 0;
  particles = particles.filter((p) => {
    p.vy += p.g * step;
    p.x  += p.vx * step;
    p.y  += p.vy * step;
    p.life -= 0.014 * step;
    if (p.life <= 0) return false;
    ctx.globalAlpha = p.life * 0.20;
    ctx.fillStyle = 'rgb(186,170,140)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    return true;
  });
  ctx.globalAlpha = 1;
}

// ── Press flashguns ─────────────────────────────────────────────
// The photographers are banked up at the winning post, and the wall of
// flashguns going off as the field crosses is the single most
// recognisable image in racing. They fire in the crowd BEHIND the rail,
// so the horses occlude them, and each one lives about a sixth of a
// second — a flashgun is a hard pop, not a glow, and giving them a slow
// fade turns the finish into fairy lights.
const MAX_FLASHES = 60;
let pressFlashes = [];

function spawnPressFlashes(dt) {
  const intensity = DIRECTOR.pressFlash;
  if (intensity <= 0.02 || prefersReducedMotion) return;
  if (pressFlashes.length >= MAX_FLASHES) return;

  // Expected pops per second scales with the director's intensity.
  const perSecond = 85 * intensity;
  if (dt <= 0 || Math.random() > (perSecond * dt) / 1000) return;

  // Banked around the post, thickest right on it.
  const spreadLengths = 7 * (0.35 + Math.random());
  const side = Math.random() < 0.5 ? -1 : 1;
  pressFlashes.push({
    x:    WORLD.spanPx + side * spreadLengths * WORLD.lengthPx * Math.random(),
    y:    WORLD.trackTopY - 16 - Math.random() * Math.max(30, viewH * 0.09),
    life: 1,
    size: (10 + Math.random() * 12) * WORLD.horseScale,
  });
}

function drawPressFlashes(dt) {
  if (!pressFlashes.length) return 0;
  const step = dt > 0 ? Math.max(0.5, Math.min(2.5, dt / FRAME_MS)) : 0;
  let energy = 0;
  pressFlashes = pressFlashes.filter((f) => {
    f.life -= 0.115 * step;
    if (f.life <= 0) return false;
    // Sharp attack, sharp decay — the curve is what makes it a flashgun.
    const a = f.life * f.life;
    energy += a;
    const r = f.size * (1.5 - f.life * 0.5);
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    g.addColorStop(0,    'rgba(255,255,255,' + a.toFixed(3) + ')');
    g.addColorStop(0.22, 'rgba(240,248,255,' + (0.7 * a).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(200,222,255,' + (0.22 * a).toFixed(3) + ')');
    g.addColorStop(1,    'rgba(180,210,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();

    // A short horizontal streak on the freshest pops. Camera flashes in
    // a bank read as a line of light, not a field of dots.
    if (f.life > 0.55) {
      const sw = r * 2.6, sa = (f.life - 0.55) / 0.45;
      const sg = ctx.createLinearGradient(f.x - sw, f.y, f.x + sw, f.y);
      sg.addColorStop(0,   'rgba(220,236,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,' + (0.55 * sa).toFixed(3) + ')');
      sg.addColorStop(1,   'rgba(220,236,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(f.x - sw, f.y - 0.9, sw * 2, 1.8);
    }
    return true;
  });
  return energy;
}

// ════════════════════════════════════════════════════════════════
//  BROADCAST IDENTIFICATION
// ════════════════════════════════════════════════════════════════
// The replacement for the floating name chips. A lower-third slides in
// from the left, names one runner, and leaves — the way a director cuts
// to a name super when there is something worth saying about a horse.
// Four in a race, ~2.6s each.
//
// The element is created from JS rather than declared in index.html, so
// nothing has to move into the Django template (ARCHITECTURE.md §10).
const BROADCAST_ID_MS = 2600;
let bcastEl = null;
let bcastTween = null;

function broadcastEl() {
  if (bcastEl && bcastEl.isConnected) return bcastEl;
  const screen = document.getElementById('screen-race');
  if (!screen) return null;
  const el = document.createElement('div');
  el.className = 'bcast-id';
  el.id = 'broadcastId';
  el.setAttribute('aria-live', 'polite');
  screen.appendChild(el);
  bcastEl = el;
  return el;
}

// role: 'leader' | 'challenger' | 'interest'
function identifyRunner(role, tag) {
  if (!raceRunning || !horses.length) return;
  const ranked = rankedHorses();
  let h = null;
  let label = tag;

  if (role === 'leader') {
    h = ranked[0];
  } else if (role === 'challenger') {
    h = ranked[1] || ranked[0];
  } else {
    // Something the viewer has a reason to care about: their own pick,
    // then the Fox pick, then whoever is making the most ground.
    const mine = horses.find((x) => isUserPick(x.runner));
    const fox  = horses.find((x) => isFoxPick(x.runner));
    if (mine)      { h = mine; label = label || 'YOUR PICK'; }
    else if (fox)  { h = fox;  label = label || 'FOX PICK';  }
    else           { h = ranked[Math.min(2, ranked.length - 1)]; label = label || 'IN TOUCH'; }
  }
  if (!h) return;
  showBroadcastId(h, label || 'IN FRONT');
}

function showBroadcastId(h, tag) {
  const el = broadcastEl();
  if (!el) return;

  el.innerHTML =
    '<span class="bcast-id__silk">' + renderCapSvg(h.runner) + '</span>' +
    '<span class="bcast-id__body">' +
      '<span class="bcast-id__name">' + esc(h.runner.name) + '</span>' +
      '<span class="bcast-id__meta">' + esc(h.runner.jockey) + ' &middot; ' + esc(h.runner.odds) + '</span>' +
    '</span>' +
    '<span class="bcast-id__tag">' + tag + '</span>';

  if (bcastTween) bcastTween.kill();
  const tl = gsap.timeline();
  tl.fromTo(el, { opacity: 0, x: -26 },
                { opacity: 1, x: 0, duration: 0.42, ease: 'power3.out' });
  tl.to(el, { opacity: 0, x: -14, duration: 0.34, ease: 'power2.in' },
        '+=' + (BROADCAST_ID_MS / 1000));
  bcastTween = tl;

  // Matching ground marker under that runner, for exactly as long as
  // the lower-third is up.
  gsap.killTweensOf(h);
  gsap.fromTo(h, { idGlow: 0 }, {
    idGlow: 0.85, duration: 0.4, ease: 'power2.out',
    onComplete: () => gsap.to(h, {
      idGlow: 0, duration: 0.5, delay: BROADCAST_ID_MS / 1000, ease: 'power2.in',
    }),
  });
}

function clearBroadcastId() {
  if (bcastTween) { bcastTween.kill(); bcastTween = null; }
  if (bcastEl) { bcastEl.innerHTML = ''; gsap.set(bcastEl, { opacity: 0 }); }
}

// ════════════════════════════════════════════════════════════════
//  RENDER LOOP
// ════════════════════════════════════════════════════════════════
// Runs on gsap.ticker rather than a private requestAnimationFrame, so
// the timeline and the renderer are stepped by the same clock in the
// same order every frame. A frame reads state and draws; it never
// advances time and never decides anything about the race.

function renderFrame() {
  if (!raceRunning) return;

  const dt = Math.min(gsap.ticker.deltaRatio() * FRAME_MS, 50);
  frameClock += dt;

  if (HERO.active) { renderHeroFrame(dt); return; }

  updateRaceModel(dt);
  updateCamera(dt);
  drawRaceScene(dt);

  // DOM overlays — cheap, and each throttles itself.
  const p = DIRECTOR.progress;
  fireCommentary(p);
  updateCommentary(dt);
  updateLeaderboard(dt);
  updateRacePhaseTitle(p);
}

// The race picture for the current state. The particle systems (hoof
// dust, flashguns) step on by dt as they draw; with dt = 0 they are drawn
// where they are.
function drawRaceScene(dt) {
  drawBackdrop();

  ctx.clearRect(0, 0, viewW, viewH);
  pushWorldTransform(ctx);
  drawTurf();
  drawFarRail();
  drawFurlongMarkers();
  drawWinningPost();
  drawHoofDust(dt);
  spawnPressFlashes(dt);
  const flashEnergy = drawPressFlashes(dt);
  drawField();
  ctx.restore();

  drawForegroundPlane();
  drawAtmosphere(flashEnergy);
}

// Repaint the frame as it stands, without advancing anything — for a
// resize, which clears the canvas.
function redrawFrame() {
  if (!raceRunning) return;
  if (HERO.active) renderHeroFrame(0);
  else drawRaceScene(0);
}

// The editorial phase title and strip still come from BAND.phaseTable,
// which is tuned in the seed JSON. The final-furlong label is owned by
// the master timeline, so we stop overwriting it once we are past it.
function updateRacePhaseTitle(progress) {
  const pt = BAND.phaseTable;
  if (!pt || !pt.length) return;
  let active = pt[0];
  for (let i = 1; i < pt.length; i++) {
    if (progress >= pt[i].from) active = pt[i];
    else break;
  }
  if (DIRECTOR.phase !== 'line') setPhaseTitle(active.label);
  updatePhaseStrip(progress, pt, active);
}

function startTicker() {
  if (tickerRunning) return;
  gsap.ticker.add(renderFrame);
  tickerRunning = true;
}

function stopTicker() {
  if (!tickerRunning) return;
  gsap.ticker.remove(renderFrame);
  tickerRunning = false;
}

// ════════════════════════════════════════════════════════════════
//  THE HORSE
// ════════════════════════════════════════════════════════════════
// A thoroughbred and jockey at full gallop, drawn from paths. No sprite
// sheet: a production race can field 24 runners in silks we have never
// seen, so the whole animal is procedural and takes its colours from the
// payload.
//
// What makes a drawn horse read as real, in order of importance:
//
//   1. THE LEGS ARTICULATE. Each hoof follows a gallop path — planted
//      and sweeping back through the stance, then lifting, folding and
//      reaching forward through the swing — and the knee or hock angle
//      is SOLVED from where the hoof is (two-bone inverse kinematics).
//      So the foreleg folds at the knee as it comes through, the hind
//      leg tucks under the belly, and nothing ever swings like a stick.
//   2. VOLUME. The coat is lit from the sun: bright along the topline,
//      sheen over the quarters and shoulder, dark under the barrel, and
//      the muscle masses — forearm, gaskin — are shapes, not lines.
//   3. THE STRIDE MOVES THE WHOLE ANIMAL. The body pitches with the
//      stride, the head and neck nod as the forelegs land, and the
//      jockey rides it: he stays level while the horse moves under him.
//   4. THE JOCKEY IS A JOCKEY. Short irons, knees up at the withers,
//      flat back, hands down the neck on the reins, in the runner's
//      actual silks.
//   5. INDIVIDUALS. Coat colour, face markings and white socks are all
//      derived from the runner id, so every horse is recognisably the
//      same horse on every replay and no two in a field look cloned.
//
// Local grid, unchanged from V2 so HORSE_ART_LENGTH still defines a
// length: ground at y = +28, withers about y = -15, point of buttock
// x ≈ -21, muzzle x ≈ +55.

// Coat palettes: body / shade (muscle shadow) / points (mane, tail,
// lower legs) / belly (lit underline).
// body, shade and belly are the coat; points the mane, tail and lower
// legs. farLower and nearLower are the lower legs on each side (a bay's
// are black, a chestnut's stay chestnut); muzzle the soft nose; a grey
// has dapples.
const MUZZLE = 'rgba(20,12,8,0.55)';
const HORSE_COATS = [
  { name: 'bay',            body: '#7b4a1f', shade: '#4f2e11', points: '#1a1008', belly: '#9d6531',
    farLower: '#1a1008', nearLower: '#1a1008', muzzle: MUZZLE },
  { name: 'dark bay',       body: '#553219', shade: '#35200c', points: '#140c06', belly: '#724a22',
    farLower: '#140c06', nearLower: '#140c06', muzzle: MUZZLE },
  { name: 'chestnut',       body: '#a0582a', shade: '#6d3915', points: '#8a4718', belly: '#c2783f',
    farLower: '#5c3014', nearLower: '#6d3915', muzzle: MUZZLE },
  { name: 'liver chestnut', body: '#6a371b', shade: '#44220f', points: '#552a12', belly: '#8a532b',
    farLower: '#552a12', nearLower: '#44220f', muzzle: MUZZLE },
  { name: 'black',          body: '#2f241c', shade: '#18120d', points: '#0d0a07', belly: '#4a392a',
    farLower: '#0d0a07', nearLower: '#0d0a07', muzzle: MUZZLE },
  { name: 'grey',           body: '#aca6a0', shade: '#7b746f', points: '#5a534e', belly: '#cbc5bf',
    farLower: '#6a635e', nearLower: '#7b746f', muzzle: '#6c645e', dapples: true },
].map(Object.freeze);

function runnerHash(runner) {
  const id = String((runner && runner.id) || (runner && runner.name) || '');
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

// Deterministic per-runner coat. Same horse, same colour, every replay.
function coatFor(runner) {
  // Weighted the way a real field looks: mostly bay and chestnut, with
  // the grey and the black as the two that catch the eye.
  const WEIGHTS = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5];
  return HORSE_COATS[WEIGHTS[runnerHash(runner) % WEIGHTS.length]];
}

// Face marking and white socks, also from the id. Roughly a third of
// horses carry a blaze or stripe and a fifth of legs a white sock, which
// is about what a real field looks like.
// Runner ids are short ("12", "1043"), so the high bits of the string
// hash are always zero — reading markings straight off it gave every
// horse in the field the same socks. An integer finaliser spreads the
// bits properly before we read them.
function mixHash(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function markingsFor(runner) {
  const hsh = mixHash(runnerHash(runner));
  const FACE = ['none', 'none', 'none', 'star', 'stripe', 'blaze'];
  const r = (n) => ((hsh >>> n) & 7);
  return {
    face:  FACE[(hsh >>> 5) % FACE.length],
    // [far fore, near fore, far hind, near hind]
    socks: [r(8) === 0, r(11) === 1, r(14) < 2, r(17) < 2],
  };
}

// ── Cached gradients ─────────────────────────────────────────────
// Canvas gradients are defined in user space and read through whatever
// transform is current when they are used, so one gradient in local
// horse coordinates serves every horse, every frame. Building them per
// horse per frame is 24 × 60 allocations a second for nothing.
const gradientCache = {};
function horseGrad(key, make) {
  return gradientCache[key] || (gradientCache[key] = make());
}

// ── Gait ─────────────────────────────────────────────────────────
// A transverse gallop, four beats then a moment of suspension. These are
// the points in the stride cycle where each hoof strikes the ground:
//   far hind 0.00 → near hind 0.10 → far fore 0.29 → near fore 0.40,
// each staying down for STANCE of the cycle, and then all four are off
// the ground from 0.59 until the far hind lands again. A racehorse at
// full gallop has each foot down for about a fifth of the stride.
const GAIT = { farHind: 0.00, nearHind: 0.10, farFore: 0.29, nearFore: 0.40 };
const STANCE = 0.19;
const GAIT_STRIKES = Object.freeze([GAIT.farHind, GAIT.nearHind, GAIT.farFore, GAIT.nearFore]);
const SUSPENSION = GAIT.nearFore + STANCE;     // all four off the ground from here

// How far a planted hoof sweeps back under the body, in the horse's own
// units, and so how far one gait cycle has to carry the horse for the
// hooves not to slide: STRIDE_LOCAL, about 1.4 lengths. placeHorse()
// advances the gait by distance against this.
const STRIDE_SWEEP = 19.5;
const STRIDE_LOCAL = STRIDE_SWEEP / STANCE;

// The leg rig, in the horse's own units. Each leg hangs from its root
// (rx, ry: the elbow for a foreleg, the stifle for a hind), strikes the
// ground `front` of the root and leaves it `back` of it — so every hoof
// sweeps STRIDE_SWEEP while it is down — lifts `lift` through the swing,
// and has two bones, `upper` and `lower`. Forelegs bend forward at the
// knee, hind legs backward at the hock. `w` is how thick it is drawn at
// the root, the joint and the cannon; the near legs, nearer the camera,
// are a little thicker.
const LEG_RIG = Object.freeze({
  farFore:  Object.freeze({ rx:  16.5, ry: -0.5, front: 10, back:  -9.5, lift: 15, upper: 14, lower: 16.2, fore: true,
                            w: Object.freeze([5.2, 3.0, 2.1]) }),
  nearFore: Object.freeze({ rx:  18.5, ry:  0.5, front: 10, back:  -9.5, lift: 15, upper: 14, lower: 16.2, fore: true,
                            w: Object.freeze([6.0, 3.2, 2.3]) }),
  farHind:  Object.freeze({ rx: -11.5, ry: -2.5, front:  7, back: -12.5, lift: 12, upper: 15, lower: 17.8, fore: false,
                            w: Object.freeze([6.2, 3.2, 2.2]) }),
  nearHind: Object.freeze({ rx: -13.5, ry: -1.5, front:  7, back: -12.5, lift: 12, upper: 15, lower: 17.8, fore: false,
                            w: Object.freeze([7.2, 3.4, 2.4]) }),
});

// Where the hoof is, relative to the leg's root, at cycle position u
// (u = 0 at the moment it strikes). Planted and sweeping back through
// the stance; then lifted, folded and carried forward through the swing.
function hoofPath(u, front, back, lift, fore) {
  if (u < STANCE) {
    return { x: front + (back - front) * (u / STANCE), y: 0, planted: true };
  }
  const t = (u - STANCE) / (1 - STANCE);
  // A foreleg folds hard at the knee early in the swing: the hoof comes
  // UP and BACK before it reaches forward. A hind leg tucks under.
  const along = fore ? smoothstep(0.3, 1, t) : smoothstep(0.08, 0.95, t);
  const up = Math.pow(Math.sin(Math.PI * t), fore ? 0.75 : 1.1);
  return { x: back + (front - back) * along, y: -lift * up, planted: false, t: t };
}

// Two-bone inverse kinematics. Given the root of a leg, where its hoof
// has to be, and the lengths of the upper and lower bones, find the
// joint between them. `bend` is +1 for a joint that points backward
// (the hock) and -1 for one that points forward (the knee).
function solveLeg(rx, ry, tx, ty, a, b, bend) {
  let dx = tx - rx, dy = ty - ry;
  let d = Math.hypot(dx, dy) || 0.001;
  const maxD = a + b - 0.02;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const ang = Math.atan2(dy, dx) + bend * Math.acos(Math.max(-1, Math.min(1, cosA)));
  return {
    jx: rx + Math.cos(ang) * a, jy: ry + Math.sin(ang) * a,
    fx: rx + dx, fy: ry + dy,
  };
}

// A tapered limb segment: a quad whose width runs from w1 at one end to
// w2 at the other.
function taper(c, x1, y1, x2, y2, w1, w2) {
  c.beginPath();
  taperPath(c, x1, y1, x2, y2, w1, w2);
  c.fill();
}

function dot(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

// The same shapes added to the current path instead of filled on their
// own, so that parts sharing a colour go to the GPU as one fill. A draw
// call costs much the same however small its shape, and a full field is
// hundreds of small shapes a frame: on a phone it is the number of draw
// calls, not the number of pixels, that sets the frame rate.
//
// The quad runs anticlockwise on screen, and so does the circle here:
// under the non-zero rule, overlapping shapes traced in opposite
// directions cancel, and where a joint overlaps a limb there would be a
// hole.
function taperPath(c, x1, y1, x2, y2, w1, w2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  c.moveTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2);
  c.lineTo(x2 + nx * w2 / 2, y2 + ny * w2 / 2);
  c.lineTo(x2 - nx * w2 / 2, y2 - ny * w2 / 2);
  c.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2);
  c.closePath();
}

function dotPath(c, x, y, r) {
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, Math.PI * 2, true);
}

// One side's pair of legs, the hind and the fore, root to hoof. `upperCol`
// is the coat (forearm and gaskin are muscle, the colour of the body);
// `lowerCol` is the points colour — the black lower legs of a bay. A white
// sock replaces the pastern and fetlock. Each entry of `pair` is a solved
// leg (solveHorseLegs) and whether it has a sock.
//
// The hind and the fore of a side never touch — the hind hoof stays well
// behind the fore through the whole stride — so each colour is one fill
// for the pair, laid down in a single leg's order: upper, lower, sock,
// hoof. The same picture from a third of the draw calls; a full field's
// legs had been close to half of every frame's.
function drawLegPair(c, pair, upperCol, lowerCol, detail) {
  const legs = pair.map(limbShape);

  c.fillStyle = upperCol;
  c.beginPath();
  for (const g of legs) {
    taperPath(c, g.rx, g.ry, g.jx, g.jy, g.wRoot, g.wJoint);
    dotPath(c, g.jx, g.jy, g.wJoint * 0.52);
  }
  c.fill();

  c.fillStyle = lowerCol;
  c.beginPath();
  for (const g of legs) {
    taperPath(c, g.jx, g.jy, g.ftx, g.fty, g.wJoint * 0.78, g.wCannon);
    if (!g.sock) pasternPath(c, g);
  }
  c.fill();

  if (legs.some((g) => g.sock)) {
    c.fillStyle = detail ? '#ebe7de' : '#b9b4aa';
    c.beginPath();
    for (const g of legs) {
      if (!g.sock) continue;
      taperPath(c, g.jx + (g.ftx - g.jx) * 0.55, g.jy + (g.fty - g.jy) * 0.55, g.ftx, g.fty,
                g.wCannon * 1.02, g.wCannon * 1.02);
      pasternPath(c, g);
    }
    c.fill();
  }

  for (const sock of [false, true]) {
    if (!legs.some((g) => g.sock === sock)) continue;
    c.fillStyle = sock ? '#5d554c' : '#1b1714';
    c.beginPath();
    for (const g of legs) if (g.sock === sock) hoofOutline(c, g);
    c.fill();
  }

  if (detail) {
    // Tendon line down the back of the cannon, catching no light.
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = 0.45;
    c.beginPath();
    for (const g of legs) {
      c.moveTo(g.jx - 0.6, g.jy + 1);
      c.lineTo(g.ftx - 0.8, g.fty - 0.5);
    }
    c.stroke();
  }
}

// The points of one leg. The fetlock sits most of the way down the lower
// bone; the pastern then slopes forward into the hoof, which is flat on
// the ground when planted and follows the leg when it is not.
function limbShape({ leg, sock }) {
  const { rx, ry, jx, jy, fx, fy, planted, w } = leg;
  return {
    rx, ry, jx, jy, planted, sock,
    ftx: jx + (fx - jx) * 0.82, fty: jy + (fy - jy) * 0.82,
    hx: planted ? fx + 1.6 : fx + (fx - jx) * 0.06,
    hy: planted ? fy : fy + (fy - jy) * 0.06,
    wRoot: w[0], wJoint: w[1], wCannon: w[2],
  };
}

// Fetlock and pastern, down to the hoof.
function pasternPath(c, g) {
  dotPath(c, g.ftx, g.fty, g.wCannon * 0.62);
  taperPath(c, g.ftx, g.fty, g.hx, g.hy, g.wCannon * 0.9, g.wCannon * 0.72);
}

// The hoof, turned to follow the leg through the air: the quad a
// translate() and rotate() to the hoof would draw, worked out here so
// that hooves can share a fill.
function hoofOutline(c, g) {
  const w = g.wCannon;
  const ang = g.planted ? 0 : Math.atan2(g.hy - g.fty, g.hx - g.ftx) - Math.PI / 2;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const px = (x, y) => g.hx + x * cs - y * sn;
  const py = (x, y) => g.hy + x * sn + y * cs;
  c.moveTo(px(-w * 0.55, -w * 0.9), py(-w * 0.55, -w * 0.9));
  c.lineTo(px(w * 0.85, -w * 0.9), py(w * 0.85, -w * 0.9));
  c.lineTo(px(w * 1.25, 0.5), py(w * 1.25, 0.5));
  c.lineTo(px(-w * 0.65, 0.5), py(-w * 0.65, 0.5));
  c.closePath();
}

// The fixed outlines — barrel, neck, head, the jockey's torso — in the
// horse's own units. Built once, on first use: one set serves every horse
// in every frame, where building them per horse per frame was 96 Path2D
// allocations a frame for a full field.
let horsePathCache = null;
function horsePaths() {
  if (horsePathCache) return horsePathCache;
  // Deep through the girth, tucked up at the flank, a strong round
  // hindquarter, a sloping shoulder. Shallower and longer than you would
  // guess — that is the difference between a racehorse and a cob.
  const body = new Path2D();
  body.moveTo(-21, -6);
  body.bezierCurveTo(-22.5, -12, -18.5, -16.5, -11, -16.2);   // quarters
  body.bezierCurveTo(-4, -16, 2, -14.4, 8, -14.6);            // back
  body.bezierCurveTo(11, -14.8, 14, -16.6, 17, -15.2);        // withers
  body.bezierCurveTo(20.5, -13.6, 23.4, -10, 24.2, -5);       // shoulder
  body.bezierCurveTo(25, -1.6, 24, 1.4, 21, 3.2);             // breast
  body.bezierCurveTo(17, 4.7, 11, 4.7, 5, 3.9);               // girth
  body.bezierCurveTo(-1, 3.1, -5, 1.4, -9, 1);                // belly, tucked
  body.bezierCurveTo(-13, 0.6, -16, 1, -18, 0);               // flank → stifle
  body.bezierCurveTo(-20, -1, -21, -3, -21, -6);              // back of thigh
  body.closePath();
  const neck = new Path2D();
  neck.moveTo(12.5, -15.6);
  neck.bezierCurveTo(19.5, -22.5, 28, -28.4, 37.2, -30.6);    // crest
  neck.bezierCurveTo(39.8, -31.2, 41.4, -29.6, 40.8, -27.6);  // poll
  neck.bezierCurveTo(35.4, -23.4, 28.4, -16.2, 24.2, -7);     // throat
  neck.bezierCurveTo(21, -6, 16.4, -9, 12.5, -15.6);
  neck.closePath();
  const head = new Path2D();
  head.moveTo(38.4, -31.2);
  head.bezierCurveTo(43, -31.8, 47.2, -30.2, 50.6, -27.2);    // forehead
  head.lineTo(54, -23.2);                                     // face
  head.bezierCurveTo(55.4, -21.7, 55.1, -20, 53.5, -19.4);    // nose
  head.bezierCurveTo(52.2, -18.9, 51, -18.4, 49.8, -18.6);    // lip
  head.bezierCurveTo(48.8, -18.2, 47.8, -18.3, 47, -19);      // chin
  head.bezierCurveTo(44, -19.8, 41, -21, 39.2, -24);          // jaw
  head.bezierCurveTo(38.3, -26, 37.9, -28.6, 38.4, -31.2);
  head.closePath();
  // The torso, back flat, backside up.
  const torso = new Path2D();
  torso.moveTo(0.4, -23.4);
  torso.bezierCurveTo(1.4, -27.8, 8, -30.2, 15, -29.4);
  torso.bezierCurveTo(17.6, -29, 18.4, -27, 17.2, -25.2);
  torso.bezierCurveTo(14.6, -23, 9, -22, 4, -21.8);
  torso.bezierCurveTo(2, -21.8, 0.7, -22.4, 0.4, -23.4);
  torso.closePath();
  // Neck and head in one coat-coloured fill.
  const neckAndHead = new Path2D();
  neckAndHead.addPath(neck);
  neckAndHead.addPath(head);
  horsePathCache = { body, neck, head, neckAndHead, torso };
  return horsePathCache;
}

// ── Drawing a horse ──────────────────────────────────────────────
// drawHorseSilhouette() works out the pose, sets up the transform and
// draws the parts in painter's order: shadow, far legs, tail, body, neck
// and head, tack, near legs, jockey. The parts share the canvas transform
// and state, each picking up where the one before left off; none of them
// saves or restores anything the next one relies on.
function drawHorseSilhouette(x, y, h, artScale) {
  const look = horseLook(h, artScale || 1);
  const pose = stridePose(h);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(look.scale, look.scale);
  const m = ctx.getTransform();
  look.px = Math.hypot(m.a, m.b);
  drawHorseShadow(pose);

  ctx.translate(0, pose.bodyLift);
  ctx.rotate(pose.pitch);

  const legs = solveHorseLegs(pose);
  drawFarLegs(legs, look);
  drawHorseTail(h, look);
  drawHorseBody(look);
  drawHorseFront(h, look, pose);
  drawHorseTack(h, look);
  drawNearLegs(legs, look);
  drawJockey(h, look, pose, bitPosition(pose.neckAng));

  ctx.restore();
}

// What this runner looks like: coat, markings, silks, and whether the
// small details are worth drawing at this size.
function horseLook(h, scale) {
  return {
    scale:  scale,
    px:     1,               // screen pixels per horse unit, once the horse is placed
    detail: scale >= 0.72,
    coat:   h.coat  || (h.coat  = coatFor(h.runner)),
    marks:  h.marks || (h.marks = markingsFor(h.runner)),
    silk:   h.runner.silk  || COL.silkDefault,
    silk2:  h.runner.silk2 || COL.silk2Default,
    pat:    h.runner.silk_pattern || 'solid',
  };
}

// Where the horse is in its stride and what that does to the whole
// animal: highest through the suspension, lowest as the forelegs take the
// weight; nose-up as the hinds drive and nose-down as the fores land; the
// neck and head nodding against that.
// Through the final furlong the jockey's hands pump and the whip comes
// up; from ALL_OUT_FROM the horse is at full stretch — nostrils flared,
// mouth open. (Both are race progress, not the slow-motion ramp.)
const FINAL_STRETCH_FROM = 0.85;
const ALL_OUT_FROM       = 0.88;

// Where the horse is in its gait cycle, 0 → 1 from the far hind's strike.
function strideCycle(h) {
  return (h.legPhase / (Math.PI * 2)) % 1;
}

function stridePose(h) {
  const cyc = strideCycle(h);
  const susp = cyc > SUSPENSION ? Math.sin((cyc - SUSPENSION) / (1 - SUSPENSION) * Math.PI) : 0;
  const foreLoad = (cyc > GAIT.farFore && cyc < SUSPENSION)
    ? Math.sin((cyc - GAIT.farFore) / (SUSPENSION - GAIT.farFore) * Math.PI) : 0;
  const progress = DIRECTOR.progress;
  return {
    cyc:      cyc,
    susp:     susp,
    bodyLift: -susp * 2.6 + foreLoad * 0.9,
    pitch:    Math.sin((cyc - 0.16) * Math.PI * 2) * 0.03 + Math.sin(h.swayPhase) * 0.006,
    neckAng:  Math.sin((cyc - 0.40) * Math.PI * 2) * 0.07,
    progress: progress,
    finalStretch: progress >= FINAL_STRETCH_FROM,
    allOut:       progress >= ALL_OUT_FROM,
  };
}

// Ground shadow, cast away from the sun and tightening as the horse
// leaves the ground. Drawn before the body pitches — shadows do not. Its
// strength goes in as an opacity, not a colour string built per horse
// per frame.
function drawHorseShadow(pose) {
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * (0.3 - pose.susp * 0.14);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(-7, 28, 30 - pose.susp * 5, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
}

// The legs: hoof targets from the gait (hoofPath), joints solved (solveLeg).
// The ground is expressed in the body's pitched frame, so a planted hoof
// stays planted while the body rocks over it.
function solveHorseLegs(pose) {
  const legs = {};
  for (const key of ['farFore', 'nearFore', 'farHind', 'nearHind']) {
    const rig = LEG_RIG[key];
    const u = ((pose.cyc - GAIT[key]) % 1 + 1) % 1;
    const hp = hoofPath(u, rig.front, rig.back, rig.lift, rig.fore);
    const tx = rig.rx + hp.x;
    const ty = (28 - pose.bodyLift) - tx * pose.pitch + hp.y;
    const j = solveLeg(rig.rx, rig.ry, tx, ty, rig.upper, rig.lower, rig.fore ? -1 : 1);
    legs[key] = { rx: rig.rx, ry: rig.ry, jx: j.jx, jy: j.jy, fx: j.fx, fy: j.fy, planted: hp.planted, w: rig.w };
  }
  return legs;
}

// Far-side legs sit in shadow behind the body.
function drawFarLegs(legs, look) {
  const { coat, marks } = look;
  drawLegPair(ctx, [
    { leg: legs.farHind, sock: marks.socks[2] },
    { leg: legs.farFore, sock: marks.socks[0] },
  ], coat.shade, coat.farLower, false);
}

// Near-side legs, over the body.
function drawNearLegs(legs, look) {
  const { coat, marks, detail } = look;
  const { nearHind, nearFore } = legs;
  drawLegPair(ctx, [
    { leg: nearHind, sock: marks.socks[3] },
    { leg: nearFore, sock: marks.socks[1] },
  ], coat.body, coat.nearLower, detail);
  if (detail) {
    // Gaskin and forearm take the light on their front edges.
    ctx.fillStyle = 'rgba(255,240,214,0.12)';
    ctx.beginPath();
    taperPath(ctx, nearHind.rx + 1.2, nearHind.ry, nearHind.jx + 0.8, nearHind.jy, 2.4, 1);
    taperPath(ctx, nearFore.rx + 1.4, nearFore.ry, nearFore.jx + 0.8, nearFore.jy, 2.0, 0.9);
    ctx.fill();
  }
}

function drawHorseTail(h, look) {
  const { coat, detail } = look;
  // ── Tail ───────────────────────────────────────────────────
  // A flowing mass off the dock, streaming back and a little down,
  // swinging with the stride.
  const tw = Math.sin(h.bobPhase * 1.1) * 1.8;
  ctx.fillStyle = coat.points;
  ctx.beginPath();
  ctx.moveTo(-19.5, -13);
  ctx.bezierCurveTo(-26, -14 + tw * 0.4, -33, -11 + tw * 0.8, -40, -6 + tw);
  ctx.bezierCurveTo(-41.5, -3.5 + tw, -39, -1.5 + tw * 0.8, -35, -2.8 + tw * 0.6);
  ctx.bezierCurveTo(-29, -4.5 + tw * 0.4, -24, -6.5, -19.5, -8);
  ctx.closePath();
  ctx.fill();
  if (detail) {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-21, -12 + i * 1.1);
      ctx.quadraticCurveTo(-30, -11 + i * 1.3 + tw * 0.7, -38 - i * 0.6, -6 + i * 1.2 + tw);
      ctx.stroke();
    }
  }
}

function drawHorseBody(look) {
  const { coat, detail } = look;
  // ── Body ───────────────────────────────────────────────────
  const body = horsePaths().body;

  ctx.fillStyle = coat.body;
  ctx.fill(body);

  // Light and volume, laid over the body outline. Each layer is the
  // outline filled with a gradient rather than a rectangle clipped to the
  // outline: a clip costs the GPU a mask of its own, per horse per frame.
  // The picture is the same because the outline sits wholly inside each
  // layer's rectangle, and the radial sheens fade to nothing before they
  // reach its edge.
  ctx.fillStyle = horseGrad('bodyVol', () => {
    const g = ctx.createLinearGradient(0, -17, 0, 5);
    g.addColorStop(0,    'rgba(255,240,214,0.20)');
    g.addColorStop(0.32, 'rgba(255,240,214,0.02)');
    g.addColorStop(0.62, 'rgba(0,0,0,0.06)');
    g.addColorStop(1,    'rgba(0,0,0,0.38)');
    return g;
  });
  ctx.fill(body);
  if (detail) {
    // Sheen over the quarters and the shoulder: a groomed coat shines.
    ctx.fillStyle = horseGrad('quarterSheen', () => {
      const g = ctx.createRadialGradient(-12, -11.5, 0, -12, -11.5, 9.5);
      g.addColorStop(0, 'rgba(255,244,222,0.24)');
      g.addColorStop(1, 'rgba(255,244,222,0)');
      return g;
    });
    ctx.fill(body);
    ctx.fillStyle = horseGrad('shoulderSheen', () => {
      const g = ctx.createRadialGradient(18, -9, 0, 18, -9, 7.5);
      g.addColorStop(0, 'rgba(255,244,222,0.18)');
      g.addColorStop(1, 'rgba(255,244,222,0)');
      return g;
    });
    ctx.fill(body);
    // Dapples on a grey, which do run to the edge: clipped.
    if (coat.dapples) {
      ctx.save();
      ctx.clip(body);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4, rr = 3 + (i % 4) * 1.6;
        dot(ctx, -12 + Math.cos(a) * rr * 1.3, -9 + Math.sin(a) * rr * 0.7, 0.9 + (i % 3) * 0.3);
      }
      ctx.restore();
    }
  }

  if (detail) {
    // Muscle creases: the stifle fold in front of the quarters and the
    // line behind the elbow.
    ctx.strokeStyle = 'rgba(0,0,0,0.26)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-7.5, -8);
    ctx.quadraticCurveTo(-9.8, -3, -9, 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(15, -6);
    ctx.quadraticCurveTo(14.4, -1, 16, 3.4);
    ctx.stroke();
    // Rim light along the topline — the sun is above and behind camera.
    ctx.strokeStyle = 'rgba(255,238,206,0.4)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-20, -11);
    ctx.bezierCurveTo(-18, -16, -11.5, -16.4, -11, -16.2);
    ctx.bezierCurveTo(-4, -16, 2, -14.4, 8, -14.6);
    ctx.stroke();
  }
}

// ── Neck and head ──
// One group, pivoting at the withers so the whole front end nods with
// the stride.
function drawHorseFront(h, look, pose) {
  ctx.save();
  ctx.translate(14, -14.5);
  ctx.rotate(pose.neckAng);
  ctx.translate(-14, 14.5);
  drawNeckAndHead(look);
  drawHeadFeatures(look, pose);
  drawMane(h, look);
  drawBridle(look);
  ctx.restore();
}

// The neck and head shapes, their light and volume, and the face marking.
function drawNeckAndHead(look) {
  const { coat, marks, detail } = look;
  const { neck, head, neckAndHead } = horsePaths();

  ctx.fillStyle = coat.body;
  ctx.fill(neckAndHead);

  // Light and volume: outlines filled with gradients, as on the body, and
  // for the same reason — no clips.
  ctx.fillStyle = horseGrad('neckVol', () => {
    const g = ctx.createLinearGradient(30, -30, 22, -10);
    g.addColorStop(0,   'rgba(255,240,214,0.18)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1,   'rgba(0,0,0,0.3)');
    return g;
  });
  ctx.fill(neck);
  // The face planes: lit forehead, shaded muzzle and underside.
  ctx.fillStyle = horseGrad('headVol', () => {
    const g = ctx.createLinearGradient(44, -31, 47, -18);
    g.addColorStop(0,   'rgba(255,240,214,0.16)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.04)');
    g.addColorStop(1,   'rgba(0,0,0,0.34)');
    return g;
  });
  ctx.fill(head);
  if (detail) {
    // The round cheek (jowl), catching the light
    ctx.fillStyle = horseGrad('cheek', () => {
      const g = ctx.createRadialGradient(42.4, -25.4, 0, 42.4, -25.4, 3.8);
      g.addColorStop(0, 'rgba(255,244,222,0.22)');
      g.addColorStop(1, 'rgba(255,244,222,0)');
      return g;
    });
    ctx.fill(head);
  }
  // Face marking, which comes right up to the edge of the face: clipped.
  if (marks.face !== 'none') {
    ctx.save();
    ctx.clip(head);
    ctx.fillStyle = '#f1ede4';
    if (marks.face === 'star') {
      dot(ctx, 46.6, -28.6, 1.1);
    } else {
      const w = marks.face === 'blaze' ? 1.5 : 0.7;
      ctx.beginPath();
      ctx.moveTo(45.2, -29.8);
      ctx.lineTo(47.6, -30);
      ctx.lineTo(54.6, -21.4 + w * 0.2);
      ctx.lineTo(54.2 - w, -20.4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

// Throatlatch, ears, eye, muzzle — the nostrils flaring and the mouth
// open under maximum effort in the slow-motion finish.
function drawHeadFeatures(look, pose) {
  const { coat, detail } = look;
  const inSlowMo = pose.allOut;
  if (detail) {
    // Throatlatch and jawline shadow, separating the head from the neck.
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(39.4, -29.8);
    ctx.bezierCurveTo(39.2, -26, 41, -22.4, 45, -20.2);
    ctx.stroke();
    // Jugular groove down the neck
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(37, -25);
    ctx.quadraticCurveTo(29, -19, 23.5, -10);
    ctx.stroke();
  }

  // Ears, pricked
  ctx.fillStyle = coat.body;
  ctx.beginPath();
  ctx.moveTo(38.6, -30.6); ctx.quadraticCurveTo(37.2, -34.2, 38.4, -36.4);
  ctx.quadraticCurveTo(40.4, -34, 40.8, -31);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = coat.shade;
  ctx.beginPath();
  ctx.moveTo(40.6, -30.8); ctx.quadraticCurveTo(40.2, -34, 41.6, -35.8);
  ctx.quadraticCurveTo(43, -33.4, 42.6, -30.6);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = '#0a0806';
  ctx.beginPath();
  ctx.ellipse(44.8, -27.2, 1.05, 0.8, 0.35, 0, Math.PI * 2);
  ctx.fill();
  if (detail) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    dot(ctx, 45.1, -27.5, 0.3);
  }

  // Muzzle, nostril — flaring under maximum effort — and an open mouth
  ctx.fillStyle = coat.muzzle;
  ctx.beginPath();
  ctx.ellipse(52.6, -20.6, 2.2, 1.7, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0604';
  ctx.beginPath();
  ctx.ellipse(53.2, -21.6, inSlowMo ? 0.95 : 0.65, inSlowMo ? 0.62 : 0.42, 0.6, 0, Math.PI * 2);
  ctx.fill();
  if (inSlowMo) {
    ctx.fillStyle = '#2e0d0d';
    ctx.beginPath();
    ctx.ellipse(50.4, -18.6, 1.4, 0.6, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMane(h, look) {
  const { coat, detail } = look;
  // ── Mane and forelock ──────────────────────────────────────
  // A mass along the crest, flying back and up at speed, with strands
  // breaking off it. Stops short of the poll so it never swallows the
  // head — a horse without a readable head does not read as a horse.
  const mp = Math.sin(h.bobPhase * 1.5) * 1.2;
  ctx.fillStyle = coat.points;
  ctx.beginPath();
  ctx.moveTo(37, -30.4);
  ctx.bezierCurveTo(30, -29.8 + mp * 0.3, 22, -25 + mp * 0.5, 14, -17.5);
  ctx.bezierCurveTo(15.5, -20 + mp, 22, -26.5 + mp, 30, -31.5 + mp * 0.6);
  ctx.quadraticCurveTo(34, -32.6, 37, -30.4);
  ctx.closePath();
  ctx.fill();
  // The strands and the forelock are one stroke: the same pen throughout.
  const maneN = detail ? 9 : 4;
  ctx.strokeStyle = coat.points;
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < maneN; i++) {
    const t = i / (maneN - 1);
    const bx = 35 - t * 20, by = -30 + t * 13;
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx - 3, by - 2.4 + mp * 0.4, bx - 6.5, by - 1.2 + mp * (0.4 + t * 0.4));
  }
  // Forelock streaming back over the forehead
  ctx.moveTo(39.6, -31.4);
  ctx.quadraticCurveTo(38, -33.4 + mp * 0.3, 35.6, -33.4 + mp * 0.4);
  ctx.stroke();
}

function drawBridle(look) {
  const { detail } = look;
  // ── Bridle ─────────────────────────────────────────────────
  if (detail) {
    ctx.strokeStyle = 'rgba(16,12,10,0.85)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();                          // headpiece + cheekpiece
    ctx.moveTo(40.2, -31.4);
    ctx.lineTo(48.4, -21.4);
    ctx.stroke();
    ctx.beginPath();                          // browband
    ctx.moveTo(40.2, -31.4);
    ctx.lineTo(43.8, -30.6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236,234,228,0.9)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();                          // noseband
    ctx.moveTo(49.3, -24.6);
    ctx.lineTo(51.6, -19.2);
    ctx.stroke();
  }
}

// Where the bit is, in body space, once the neck has nodded — the reins
// run from here to the jockey's hands.
function bitPosition(neckAng) {
  const bitX0 = 50.2 - 14, bitY0 = -20.2 + 14.5;
  return {
    x: 14 + bitX0 * Math.cos(neckAng) - bitY0 * Math.sin(neckAng),
    y: -14.5 + bitX0 * Math.sin(neckAng) + bitY0 * Math.cos(neckAng),
  };
}

function drawHorseTack(h, look) {
  const { detail } = look;
  // ── Tack ───────────────────────────────────────────────────
  // Number cloth under the saddle, the tiny racing saddle on top, a
  // girth round the barrel and a breastgirth across the chest.
  const num = h.runner.number;
  ctx.fillStyle = '#ebe6da';
  ctx.beginPath();
  ctx.moveTo(-1.8, -15);
  ctx.lineTo(7.4, -15.3);
  ctx.lineTo(8, -8);
  ctx.lineTo(-2.5, -7.6);
  ctx.closePath();
  ctx.fill();
  if (detail) {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.35;
    ctx.stroke();
  }
  if (num != null) drawClothNumber(h, look, num);
  ctx.fillStyle = '#231a14';                  // saddle
  ctx.beginPath();
  ctx.moveTo(-0.8, -15.4);
  ctx.quadraticCurveTo(3.4, -17.2, 8.2, -15.8);
  ctx.lineTo(7.6, -14.4);
  ctx.quadraticCurveTo(3.4, -15.2, -0.4, -14.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e6e2d8';                  // girth
  taper(ctx, 11.6, -14.2, 12.8, 4.2, 1.5, 1.4);
  if (detail) {
    ctx.strokeStyle = 'rgba(230,226,216,0.9)'; // breastgirth
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(12.6, -8);
    ctx.quadraticCurveTo(18, -7, 23.6, -4.2);
    ctx.stroke();
  }
}

// The number on the saddle cloth — live text only in the Winning Moment's
// close-up, which is bigger than any of its bitmaps (textAsImage).
const CLOTH_TYPE = { weight: 700, size: 5.2, family: '"DM Sans", Helvetica, Arial, sans-serif',
                     fill: '#171b22', baseline: 'middle' };
function drawClothNumber(h, look, num) {
  const img = horseTextImage(h, 'clothImages', String(num), CLOTH_TYPE, look);
  if (img) drawTextImage(img, 2.8, -11.4);
  else drawTextLive(String(num), CLOTH_TYPE, 2.8, -11.4);
}

// ── Text as an image ─────────────────────────────────────────────
// Text is the dearest thing a race frame draws. Every fillText is laid
// out and its glyphs prepared for the GPU afresh, and under a horse's
// transform — scaled, pitching with the stride — no two frames can share
// them: the saddle cloths alone were a third of a slow phone's frame. So a
// horse's text, its number and a starred silk, is set once into bitmaps
// and drawn as an image.
//
// The image goes through the canvas's ordinary bilinear filtering: asking
// for mipmaps ('high' smoothing) cost the GPU more than the text had cost
// the CPU. Bilinear filtering only holds up to halving the size, so each
// text is set, as it is needed, at 1, 2, 4 and 8 pixels to the unit, and
// the one drawn is the smallest that is at least as fine as the screen —
// its own small set of mipmaps, each one set as real text at that size.
// `type` is the text's weight, size (in the units it is drawn in),
// family, colour and baseline. Until the typeface has loaded the text is
// drawn live, so a bitmap is never made in a fallback font.
const HORSE_TEXT_AS_IMAGE_UP_TO = 2;                  // art scale up to which a horse's text is an image
const TEXT_IMAGE_PX = Object.freeze([1, 2, 4, 8]);    // bitmap pixels per unit, level by level
const textImages = new Map();

// A horse's text at the level for its size on screen (look.px), kept on
// the horse under `slot`. Null means live text: the close-up, or a
// typeface still loading.
function horseTextImage(h, slot, text, type, look) {
  if (look.scale > HORSE_TEXT_AS_IMAGE_UP_TO) return null;
  let level = 0;
  while (level < TEXT_IMAGE_PX.length - 1 && TEXT_IMAGE_PX[level] < look.px) level++;
  const levels = h[slot] || (h[slot] = []);
  return levels[level] || (levels[level] = textImage(text, type, TEXT_IMAGE_PX[level]));
}

function drawTextImage(img, x, y) {
  ctx.drawImage(img.canvas, x - img.ax, y - img.ay, img.w, img.h);
}

function drawTextLive(text, type, x, y) {
  ctx.fillStyle = type.fill;
  ctx.font = type.weight + ' ' + type.size + 'px ' + type.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = type.baseline;
  ctx.fillText(text, x, y);
  ctx.textBaseline = 'alphabetic';
}

// The bitmap, at k pixels to the unit: the text centred on an anchor that
// sits where the live text's (x, y) would, with room round it for any
// glyph of the face. Shared between horses and races.
function textImage(text, type, k) {
  const key = [text, type.weight, type.size, type.family, type.fill, type.baseline, k].join('|');
  const cached = textImages.get(key);
  if (cached) return cached;
  if (document.fonts && !document.fonts.check(type.weight + ' 12px ' + type.family)) return null;
  const em = type.size * k;
  const font = type.weight + ' ' + em + 'px ' + type.family;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width + 2 * k);
  c.height = Math.ceil(em * 1.6);
  const anchorY = type.baseline === 'middle' ? c.height / 2 : Math.round(em * 1.15);
  g.font = font;               // sizing the canvas reset its state
  g.fillStyle = type.fill;
  g.textAlign = 'center';
  g.textBaseline = type.baseline;
  g.fillText(text, c.width / 2, anchorY);
  const img = { canvas: c, w: c.width / k, h: c.height / k, ax: c.width / 2 / k, ay: anchorY / k };
  textImages.set(key, img);
  return img;
}

// ── The jockey ───────────────────────────────────────────────────
// He rides the stride rather than moving with it: the horse's back rises
// and falls and pitches under him while his upper body stays level, which
// is the thing that makes a jockey look like he is riding and not glued
// on. Through the final furlong his hands pump with the stride and the
// whip comes up.
//
// The Winning Moment salute (h.salute, 0 → 1) is blended into the same
// rig rather than swapped in, so he rises into it: the upper body comes up
// out of the crouch, rotating back around the hip; one arm goes up; the
// other hand keeps the reins, shortened as he sits up. The pose is the
// V16.1 delivery's.
function drawJockey(h, look, pose, bit) {
  ctx.save();
  ctx.translate(4, -15.8);
  ctx.rotate(-pose.pitch * 0.75);
  ctx.translate(-4, 15.8 - pose.bodyLift * 0.55);

  const pump = pose.finalStretch ? Math.sin(pose.cyc * Math.PI * 2) * 1.6 : 0;
  const handX = 25.4 + pump, handY = -19.8 + Math.abs(pump) * 0.2;
  const sal = h.salute || 0;
  const rig = {
    pump, handX, handY, sal,
    salA:    -0.40 * sal,
    salLift: 0.5 * sal,
    reinX:   handX + (20.5 - handX) * sal,
    reinY:   handY + (-22.4 - handY) * sal,
  };

  drawReins(bit, pose.bodyLift, rig);
  drawJockeyLeg();

  // Upper body: rotated about the hip and lifted by the salute. The legs,
  // irons and reins above stay where they are. Nothing is drawn after the
  // upper body, so it needs its own save only to undo the salute.
  const saluting = sal > 0.001;
  if (saluting) {
    ctx.save();
    ctx.translate(2.4, -22.6 - rig.salLift);
    ctx.rotate(rig.salA);
    ctx.translate(-2.4, 22.6);
    drawRiddenHand(look, rig);
  }
  drawJockeyTorso(h, look);
  drawJockeyArm(look, rig);
  if (pose.finalStretch && sal < 0.3) drawWhip(pose, rig);
  drawJockeyHead(look, rig);
  if (saluting) ctx.restore();   // end upper body
  ctx.restore();                 // end jockey
}

function drawReins(bit, bodyLift, rig) {
  const bitX = bit.x, bitY = bit.y;
  const { reinX, reinY } = rig;
  // Reins, bit to hands.
  ctx.strokeStyle = 'rgba(22,16,12,0.9)';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(bitX, bitY + bodyLift * 0.55);
  ctx.quadraticCurveTo((bitX + reinX) / 2, (bitY + reinY) / 2 + 2.4, reinX, reinY);
  ctx.stroke();
}

function drawJockeyLeg() {
  // Stirrup leather and iron
  ctx.strokeStyle = 'rgba(28,22,18,0.9)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(4.2, -15.4);
  ctx.lineTo(7.4, -10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(210,214,220,0.95)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(8, -9.4, 1.1, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // Thigh (white breeches) and boot, knee up at the withers
  ctx.fillStyle = '#ece9e2';
  ctx.beginPath();
  taperPath(ctx, 2.4, -22.6, 12.2, -17.4, 3.6, 2.6);
  dotPath(ctx, 12.2, -17.4, 1.3);
  ctx.fill();
  ctx.fillStyle = '#16120f';
  ctx.beginPath();
  taperPath(ctx, 12.2, -17.4, 7.2, -10.6, 2.4, 1.8);
  taperPath(ctx, 7.2, -10.6, 9.8, -9.8, 1.8, 1.2);
  ctx.fill();
  ctx.fillStyle = '#b8864c';                  // boot top
  taper(ctx, 11.8, -16.8, 11.1, -15.8, 2.6, 2.5);
}

// In the salute, the far hand stays on the reins, behind the torso.
function drawRiddenHand(look, rig) {
  const { silk2 } = look;
  const { salA, salLift, reinX, reinY } = rig;
  // The far hand stays on the reins: work out where the rein end is in
  // this rotated frame, and reach the far arm to it, behind the torso.
  const dx = reinX - 2.4, dy = reinY + 22.6 + salLift;
  const qx = 2.4 + dx * Math.cos(-salA) - dy * Math.sin(-salA);
  const qy = -22.6 + dx * Math.sin(-salA) + dy * Math.cos(-salA);
  const ex = (14.2 + qx) / 2 + 1.4, ey = (-27.6 + qy) / 2 + 0.6;
  ctx.fillStyle = silk2;
  taper(ctx, 14.2, -27.6, ex, ey, 2.4, 2.0);
  taper(ctx, ex, ey, qx, qy, 2.0, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  taper(ctx, 14.2, -27.6, ex, ey, 2.4, 2.0);
  taper(ctx, ex, ey, qx, qy, 2.0, 1.5);
  ctx.fillStyle = '#e3dfd6';
  dot(ctx, qx, qy, 1.0);
}

function drawJockeyTorso(h, look) {
  const { silk, silk2, pat } = look;
  // Torso in the runner's silks, back flat, backside up
  const torso = horsePaths().torso;
  ctx.fillStyle = silk;
  ctx.fill(torso);
  // Silk sheen on top, shadow underneath
  const silkVol = horseGrad('silkVol', () => {
    const g = ctx.createLinearGradient(0, -30.5, 0, -21.6);
    g.addColorStop(0,   'rgba(255,255,255,0.28)');
    g.addColorStop(0.4, 'rgba(255,255,255,0)');
    g.addColorStop(1,   'rgba(0,0,0,0.3)');
    return g;
  });
  // A plain silk has nothing that crosses the outline, so its sheen is
  // the outline filled with the gradient — no clip, as on the horse. A
  // pattern runs off the edge of the torso and is clipped to it; its
  // hoops or stripes never overlap, so they are one fill.
  if (!SILK_PATTERNS.has(pat)) {
    ctx.fillStyle = silkVol;
    ctx.fill(torso);
    return;
  }
  ctx.save();
  ctx.clip(torso);
  ctx.fillStyle = silk2;
  if (pat === 'starred') {
    const type = { weight: 700, size: 6, family: 'Georgia, serif', fill: silk2, baseline: 'alphabetic' };
    const img = horseTextImage(h, 'starImages', '★', type, look);
    if (img) drawTextImage(img, 8.5, -23.8);
    else drawTextLive('★', type, 8.5, -23.8);
  } else {
    ctx.beginPath();
    if (pat === 'hooped') {
      for (let i = -31; i < -20; i += 2.6) ctx.rect(-2, i, 22, 1.25);
    } else if (pat === 'striped') {
      for (let i = 1; i < 18; i += 3.2) ctx.rect(i, -32, 1.2, 12);
    } else if (pat === 'halved') {
      ctx.rect(8.5, -32, 12, 12);
    } else {
      ctx.rect(8.5, -32, 12, 5.6);
      ctx.rect(-2, -26.4, 10.5, 6);
    }
    ctx.fill();
  }
  ctx.fillStyle = silkVol;
  ctx.fillRect(-1, -31, 20, 10);
  ctx.restore();
}

// The silk patterns drawn over the body colour; anything else is plain.
const SILK_PATTERNS = new Set(['hooped', 'striped', 'halved', 'quartered', 'starred']);

function drawJockeyArm(look, rig) {
  const { silk2 } = look;
  const { pump, handX, handY, sal, salA } = rig;
  // Arm down the neck to the reins, sleeve in the secondary colour —
  // or, in the salute, raised with a clenched glove. The raised arm is
  // posed in the world (straight up, a slight bend forward at the elbow)
  // and carried back into the tilted upper-body frame, so it stays
  // vertical however far he has sat up.
  const cs = Math.cos(-salA), sn = Math.sin(-salA);
  const up = (wx, wy) => [14.8 + wx * cs - wy * sn, -27.2 + wx * sn + wy * cs];
  const [sEx, sEy] = up(1.6, -7.4), [sFx, sFy] = up(0.6, -14.6);
  const elbowX = (18.6 + pump * 0.45) + (sEx - (18.6 + pump * 0.45)) * sal;
  const elbowY = -23.2 + (sEy + 23.2) * sal;
  const armX = (handX - 0.6) + (sFx - (handX - 0.6)) * sal;
  const armY = handY + (sFy - handY) * sal;
  const gloveX = handX + (sFx - handX) * sal;
  const gloveY = handY + (sFy - 0.6 - handY) * sal;
  ctx.fillStyle = silk2;
  ctx.beginPath();
  taperPath(ctx, 14.8, -27.2, elbowX, elbowY, 2.6, 2.2);
  dotPath(ctx, elbowX, elbowY, 1.1);
  taperPath(ctx, elbowX, elbowY, armX, armY, 2.1, 1.6);
  ctx.fill();
  ctx.fillStyle = '#f2efe8';                  // glove
  dot(ctx, gloveX, gloveY, 1.05 + sal * 0.25);
}

// Through the final furlong, cocked and coming down with the stride.
function drawWhip(pose, rig) {
  const progressNow = pose.progress, cyc = pose.cyc;
  const { handX, handY } = rig;
  const t = Math.min(1, (progressNow - FINAL_STRETCH_FROM) / 0.06);
  const swing = Math.max(0, Math.sin(cyc * Math.PI * 2 + 1.2));
  const ang = -Math.PI / 2 - 0.5 + (1 - t) * 0.7 + swing * 0.55;
  ctx.strokeStyle = '#120d08';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(handX + Math.cos(ang) * 11, handY + Math.sin(ang) * 11);
  ctx.stroke();
}

function drawJockeyHead(look, rig) {
  const { silk, silk2, detail } = look;
  const { sal, salA } = rig;
  // Head: helmet under a silk cap, peak forward, goggles, a sliver of
  // face. Low between the shoulders, eyes up the track — and still up
  // the track in the salute: the head takes back most of the lean. The
  // head is the last thing drawn on the horse, so it saves the canvas
  // only to undo that turn.
  const saluting = sal > 0.001;
  if (saluting) {
    ctx.save();
    ctx.translate(17.6, -28.2);
    ctx.rotate(-salA * 0.7);
    ctx.translate(-17.6, 28.2);
  }
  ctx.fillStyle = '#d9b08c';
  dot(ctx, 21.4, -28.4, 1.15);
  ctx.fillStyle = silk2;
  ctx.beginPath();
  ctx.arc(19.8, -30.6, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = silk;
  ctx.beginPath();
  ctx.moveTo(21.4, -32.2);
  ctx.lineTo(24.8, -31);
  ctx.lineTo(21.8, -29.8);
  ctx.closePath();
  ctx.fill();
  if (detail) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    dot(ctx, 18.8, -32, 0.9);
    ctx.fillStyle = 'rgba(214,224,236,0.9)';   // goggles
    ctx.beginPath();
    ctx.ellipse(21.9, -29.6, 1.1, 0.7, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (saluting) ctx.restore();   // end head
}

// ─── Commentary ─────────────────────────────────────────────────
function fireCommentary(progress) {
  BAND.commentary.forEach((c) => {
    if (!firedCommentary.has(c.at) && progress >= c.at) {
      firedCommentary.add(c.at);
      setCommentaryText(renderCommentary(c.text));
    }
  });
}

// Substitute {LEADER} / {USER} / {FOX} placeholders with current race
// state. Mirror of the same helper in experience.js.
function renderCommentary(template) {
  if (!template || template.indexOf('{') === -1) return template;
  const liveLeader = rankedHorses()[0] || null;
  const leaderName = liveLeader ? liveLeader.runner.name : '';
  const userName   = (STATE.userPick && STATE.userPick.name) || '';
  const foxName    = (STATE.foxPick  && STATE.foxPick.name)  || '';
  // A pick that is not there takes its comma and space with it; one
  // that is keeps whatever the template put in front of it.
  return template
    .replace(/,?\s*\{USER\}/g, (m) => (userName ? m.replace('{USER}', () => userName) : ''))
    .replace(/,?\s*\{FOX\}/g,  (m) => (foxName  ? m.replace('{FOX}', () => foxName) : ''))
    .replace(/\{LEADER\}/g,    leaderName || 'the leader')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*\./g, '.');
}

// Phase-strip update — mirror of experience.js, scoped to flat-race
// containers. Lazy-builds the dot strip once + flips state classes
// each frame as progress crosses phase thresholds.
// The strip's elements, cached when it is built so a frame does not
// query the DOM for them; and the last values written, so a frame only
// writes what has changed.
let phaseStripEls = null;

function updatePhaseStrip(progress, phaseTable, activePhase) {
  if (!phaseStripEls || !phaseStripEls.strip.isConnected) phaseStripEls = buildPhaseStrip(phaseTable);
  const { dots, rails } = phaseStripEls;

  const activeIdx = phaseTable.indexOf(activePhase);
  if (activeIdx !== phaseStripEls.activeIdx) {
    phaseStripEls.activeIdx = activeIdx;
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-past',    i <  activeIdx);
      dot.classList.toggle('is-current', i === activeIdx);
      dot.classList.toggle('is-future',  i >  activeIdx);
    });
  }
  rails.forEach((rail, i) => {
    const from = phaseTable[i].from;
    const to   = phaseTable[i + 1].from;
    const span = Math.max(0.001, to - from);
    const fill = (Math.max(0, Math.min(1, (progress - from) / span)) * 100).toFixed(1) + '%';
    if (fill !== phaseStripEls.fills[i]) {
      phaseStripEls.fills[i] = fill;
      rail.style.setProperty('--fill', fill);
    }
  });
}

function buildPhaseStrip(phaseTable) {
  let strip = document.getElementById('phaseStrip');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'phaseStrip';
    strip.className = 'race-phase-strip';
    strip.innerHTML = phaseTable.map((p, i) =>
      '<span class="race-phase-strip__dot" data-phase="' + i + '" ' +
            'title="' + esc(p.label) + '"></span>' +
      (i < phaseTable.length - 1
        ? '<span class="race-phase-strip__rail" data-rail="' + i + '"></span>'
        : '')
    ).join('');
    const raceScreen = document.getElementById('screen-race');
    if (raceScreen) raceScreen.appendChild(strip);
  }
  return {
    strip,
    dots:  phaseTable.map((p, i) => strip.querySelector('[data-phase="' + i + '"]')),
    rails: phaseTable.slice(1).map((p, i) => strip.querySelector('[data-rail="' + i + '"]')),
    activeIdx: null,
    fills: [],
  };
}

function setCommentaryText(text) {
  commentaryTimer = BAND.timings.commentaryHoldMs;
  announce(text);
  const el = document.getElementById('racingCommentary');
  if (!el) return;
  gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
  el.textContent = text;
}

// Counts the current line's hold down and fades it once when it runs out.
function updateCommentary(dt) {
  if (commentaryTimer <= 0) return;
  commentaryTimer = Math.max(0, commentaryTimer - dt);
  if (commentaryTimer > 0) return;
  const el = document.getElementById('racingCommentary');
  if (el) gsap.to(el, { opacity: 0, duration: 0.4 });
}

function showSubtitle(text, duration) {
  const el = document.querySelector('.subtitle__text');
  if (!el) return;
  el.textContent = text;
  gsap.killTweensOf(el);
  gsap.fromTo(el,
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out',
      onComplete: () => gsap.to(el, { opacity: 0, duration: 0.5, delay: duration / 1000 - 0.9 }),
    });
}

// ─── Leaderboard ────────────────────────────────────────────────
// Leaderboard uses the SAME markup classes as the jumps engine
// (.race-lb-row / .race-lb-pos / .race-lb-silk / .race-lb-name) so it
// inherits experience.css styling — no duplicate CSS in flat.css.

// Leaderboard layout constants — see experience.js for the rationale.
// Rows persist with stable data-runner IDs; updateLeaderboard slides
// them between Y positions via transform. CSS handles the transition.
const LB_VISIBLE_ROWS = 8;
// The row pitch the stylesheet sets (--lb-row-h), read once per layout
// rather than on every leaderboard sample. resize() forgets it.
let lbRowH = 0;
function lbRowHeightPx() {
  if (lbRowH) return lbRowH;
  const v = getComputedStyle(document.querySelector('.race-leaderboard') ||
                             document.body)
    .getPropertyValue('--lb-row-h').trim();
  const n = parseInt(v, 10);
  lbRowH = n > 0 ? n : 26;
  return lbRowH;
}

// The leaderboard's rows by runner id.
let lbRows = new Map();

function buildLeaderboard() {
  const c = document.getElementById('raceLeaderboard');
  if (!c) return;
  c.innerHTML = '';
  lbRows = new Map();

  // Win-probability bars — derived from the same runner weights the
  // forecast draws its winner from (weightedRandom). Normalised across the
  // field so they sum to 100%. Honest pre-race signal: these are what
  // the model thinks NOW, not animated "fake convergence" during the
  // race. The position number flips live during play; the bar stays
  // fixed — that's the contract with the viewer.
  //
  const horseWeight = (h) => h.runner.weight;
  const totalWeight = horses.reduce((s, h) => s + horseWeight(h), 0) || 1;
  // Find the field maximum so the bar fill is normalised to the front
  // runner's probability instead of 100% — most realistic. The favourite
  // bar reaches ~95%, everyone else proportional. Cleaner read than
  // showing 35% on the favourite as a tiny stub.
  const maxProb = Math.max(...horses.map(h => horseWeight(h) / totalWeight));

  horses.forEach(h => {
    const r = h.runner;
    const isUser = isUserPick(r);
    const isFox  = isFoxPick(r);
    const prob   = horseWeight(h) / totalWeight;
    const probPct = Math.round(prob * 100);
    // Bar width relative to the field leader's probability — keeps the
    // favourite bar near-full and the long-shots visibly thin without
    // the bottom of the field showing 1px slivers.
    const barWidth = maxProb > 0 ? Math.max(4, Math.round((prob / maxProb) * 100)) : 0;
    const row = document.createElement('div');
    row.className = 'race-lb-row';
    row.dataset.runner = r.id;
    row.style.opacity = '0';
    row.innerHTML =
      '<span class="race-lb-pos">—</span>' +
      '<span class="race-lb-silk">' + renderCapSvg(r) + '</span>' +
      '<span class="race-lb-name-prob">' +
        '<span class="race-lb-name' + (isUser ? ' user-horse' : isFox ? ' fox-horse' : '') + '">' + esc(r.name) + '</span>' +
        '<span class="race-lb-prob" title="AI win probability">' +
          '<span class="race-lb-prob__bar">' +
            '<span class="race-lb-prob__fill" style="width:' + barWidth + '%"></span>' +
          '</span>' +
          '<span class="race-lb-prob__pct">' + probPct + '%</span>' +
        '</span>' +
      '</span>';
    c.appendChild(row);
    lbRows.set(r.id, row);
  });
}

// Live Positions is now animated rather than rewritten. V1 wrote
// row.style.transform on every row on every frame and let a CSS
// transition try to catch up, which produced a permanently-in-flight
// panel where nothing read as a change. Here the ranking is sampled a
// few times a second, and a row is only touched when its rank actually
// moves — at which point GSAP slides it, the position number flips, and
// the row briefly carries a direction class so the eye is drawn to the
// change instead of to the constant motion.
const LB_SAMPLE_MS   = 220;
const LB_SLIDE_S     = 0.45;
let   lbSampleTimer = 0;

function updateLeaderboard(dt) {
  const c = document.getElementById('raceLeaderboard');
  if (!c) return;

  lbSampleTimer -= dt;
  if (lbSampleTimer > 0) return;
  lbSampleTimer = LB_SAMPLE_MS;

  // The panel stays where it starts: the finish line arrives left of
  // centre, so the panel never covers it.

  const rowH   = lbRowHeightPx();
  const ranked = rankedHorses();

  ranked.forEach((h, rank) => {
    if (h.lbRank === rank) return;          // nothing moved — leave it alone

    const row = lbRows.get(h.runner.id);
    if (!row) return;
    const climbed = h.lbRank >= 0 && rank < h.lbRank;
    const fell    = h.lbRank >= 0 && rank > h.lbRank;
    h.lbRank = rank;

    const inView = rank < LB_VISIBLE_ROWS;
    gsap.to(row, {
      y:        (inView ? rank : LB_VISIBLE_ROWS) * rowH,
      opacity:  inView ? 1 : 0,
      duration: LB_SLIDE_S,
      ease:     'power3.out',
      overwrite: 'auto',
    });
    row.style.zIndex = String(inView ? LB_VISIBLE_ROWS - rank : 0);

    if (!inView) return;

    const pos = row.querySelector('.race-lb-pos');
    if (pos) {
      pos.className = 'race-lb-pos p' + (rank + 1);
      // Flip the number rather than swapping the text under the reader.
      gsap.fromTo(pos,
        { y: climbed ? 8 : fell ? -8 : 0, opacity: 0.2 },
        { y: 0, opacity: 1, duration: 0.32, ease: 'power2.out',
          onStart: () => { pos.textContent = rank + 1; } });
    }

    if (climbed || fell) {
      const cls = climbed ? 'is-climbing' : 'is-falling';
      row.classList.add(cls);
      gsap.delayedCall(0.65, () => row.classList.remove(cls));
    }
  });
}
// ─── Phase title ───────────────────────────────────────────────
let lastPhaseTitle = '';
function setPhaseTitle(text) {
  if (text === lastPhaseTitle) return;
  lastPhaseTitle = text;
  announce(text);
  const el = document.getElementById('phaseTitle');
  if (!el) return;
  gsap.fromTo(el, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.4 });
  el.textContent = text;
}

// ════════════════════════════════════════════════════════════════
//  CROSSING THE LINE
// ════════════════════════════════════════════════════════════════
// The moment the race is decided is its own sequence, not a fade. In
// order:
//
//   1. A single frame of flash as the field hits the line.
//   2. The run-through. The camera opens up and holds the winning post
//      while the rest of the field gallops through it (runThroughLine),
//      the playback coming back from slow motion to real time.
//   3. The result card, sized to the actual margin — not before seven
//      finishers have come through the line behind the winner.
//   4. Out to the Winning Moment, then the roll call.
//
// Like everything else in the race, it is one GSAP timeline.
// The zoom the camera opens to at the line: eighteen lengths of track
// on a desktop, enough for the placed horses on one side of the post and
// the stragglers on the other.
const FINISH_ZOOM = 1.08;

const FINISH_PAUSE_S  = 2.45;  // line → card, at the least
const FINISH_PAUSE_MAX_S = 6.5;
const RESULT_HOLD_S   = 1.70;

// The playback speed over the finish: the final furlong's slow motion
// for a beat on the line, then back up to real time.
const FILM_RAMP_AT_S  = 0.15;
const FILM_RAMP_S     = 1.4;

// When to bring the result card in. Not before FINISH_PAUSE_S, and not
// before FINISHERS_BEFORE_CARD horses have come through the line behind
// the winner — on a close finish that is well inside the minimum, but a
// runaway's field is still a dozen lengths out when the winner crosses,
// and the card used to arrive with nobody else in the picture.
const FINISHERS_BEFORE_CARD = 7;
function finishPauseS(lineGaps, v, slowFrom) {
  const gaps = lineGaps.slice().sort((a, b) => a - b);
  const gap = gaps[Math.min(gaps.length - 1, FINISHERS_BEFORE_CARD)] || 0;
  const need = gap / v + 0.1;                     // race seconds until he is through
  // Walk the playback-speed curve to find the wall-clock time.
  let film = 0, wall = 0;
  while (film < need && wall < FINISH_PAUSE_MAX_S) {
    const u = Math.max(0, Math.min(1, (wall - FILM_RAMP_AT_S) / FILM_RAMP_S));
    film += 0.02 * (slowFrom + (1 - slowFrom) * (0.5 - 0.5 * Math.cos(Math.PI * u)));
    wall += 0.02;
  }
  return Math.max(FINISH_PAUSE_S, Math.min(FINISH_PAUSE_MAX_S, wall + 0.25));
}

function crossTheLine() {
  const margin = computeWinningMargin();
  setPhaseTitle('PAST THE POST');
  clearBroadcastId();
  hideSkipButton();

  // The field goes on through the line under its own model from here.
  beginRunThrough();
  DIRECTOR.filmRate = masterTL ? masterTL.timeScale() : 1;
  const pause = finishPauseS(horses.map((h) => h.lineGap), FINISH.v, DIRECTOR.filmRate);

  finishTL = gsap.timeline({ onComplete: () => runWinningMoment(margin) });

  // 1 — the flash as the winner hits the line
  finishTL.to(DIRECTOR, { flash: 1, duration: 0.06, ease: 'none' }, 0);
  finishTL.to(DIRECTOR, { flash: 0, duration: 0.55, ease: 'power2.out' }, 0.06);

  // 2 — the run-through (runThroughLine). A beat of slow motion on the
  //     line itself, then the playback comes back up to real time as the
  //     rest of the field comes through.
  finishTL.to(DIRECTOR, { filmRate: 1, duration: FILM_RAMP_S, ease: 'sine.inOut' }, FILM_RAMP_AT_S);

  // 3 — and the camera opens up and holds the post to show them do it.
  //     Through the final furlong the shot is on the leader; at the line
  //     it widens and settles with the post held a third of the way
  //     across, then eases a little further across as the placed horses
  //     pull up — the winners on the right, the stragglers still coming
  //     on the left.
  finishTL.to(DIRECTOR, {
    zoom: FINISH_ZOOM, anchorX: 0.5, groupBias: 0.1, fieldFade: 0.10, letterbox: 0.05,
    camY: 4, tilt: 0.003, vignette: 0.28, postHold: 1,
    duration: 1.5, ease: 'power2.out',
  }, 0.05);
  finishTL.to(DIRECTOR, { postFrame: 0.30, duration: 3.6, ease: 'sine.inOut' }, 0.6);

  // The flashguns keep going for a moment after they have passed, then
  // thin out as the photographers stop shooting.
  finishTL.to(DIRECTOR, {
    pressFlash: 0, duration: 2.8, ease: 'power2.out',
  }, 0.35);

  // 4 — the held shot. The camera drifts in a touch and darkens its
  //     edges while the last of the placed horses come through. Only a
  //     touch: the winners are pulling up on the right of the frame and a
  //     tighter shot would push them out of it.
  const drift = prefersReducedMotion ? 0 : 1;
  finishTL.to(DIRECTOR, {
    zoom: FINISH_ZOOM + 0.04 * drift,
    vignette: 0.42,
    duration: 1.6, ease: 'sine.out',
  }, 1.55);

  // 5 — the result card
  finishTL.call(() => showResultCard(margin), null, pause);
  finishTL.call(() => hideResultCard(), null, pause + RESULT_HOLD_S);
  finishTL.to({}, { duration: pause + RESULT_HOLD_S + 0.5 }, 0);
}

// ── Result card ─────────────────────────────────────────────────
// A DOM lower-third rather than canvas text: it stays sharp at every
// pixel ratio, reflows on a phone without a font-size table, and the
// entry animation is a GSAP timeline like everything else. Created
// from JS so index.html and the Django template are untouched.
let resultEl = null;

function resultCardEl() {
  if (resultEl && resultEl.isConnected) return resultEl;
  const screen = document.getElementById('screen-race');
  if (!screen) return null;
  const el = document.createElement('div');
  el.className = 'race-result';
  el.id = 'raceResult';
  screen.appendChild(el);
  resultEl = el;
  return el;
}

function showResultCard(margin) {
  const el = resultCardEl();
  if (!el) return;

  const lengths = margin && margin.lengths;
  const names   = (margin && margin.winners) || [];
  const isDH    = lengths === -1;
  const isPhoto = !isDH && lengths != null && lengths <= 0.20;

  const eyebrow = isDH    ? 'DEAD HEAT'
                : isPhoto ? 'PHOTO FINISH'
                :           'WINNER';
  const headline = isDH ? names.slice(0, 2).join('  &  ')
                        : (names[0] || '');
  const sub = isDH ? 'Nothing between them'
            : (lengths != null ? 'Won by ' + formatBeatenDistance(lengths).toLowerCase()
                               : 'Won on the line');

  el.innerHTML =
    '<span class="race-result__eyebrow">' + eyebrow + '</span>' +
    '<span class="race-result__name">' + esc(headline) + '</span>' +
    '<span class="race-result__margin">' + sub + '</span>';
  el.classList.toggle('race-result--photo', isPhoto || isDH);

  gsap.timeline()
    .set(el, { display: 'flex' })
    .fromTo(el, { opacity: 0, y: 18 },
                { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' })
    .fromTo(el.querySelectorAll('span'),
            { opacity: 0, y: 10 },
            { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'power2.out' }, 0.06);
}

function hideResultCard() {
  if (!resultEl) return;
  gsap.to(resultEl, {
    opacity: 0, y: -10, duration: 0.4, ease: 'power2.in',
    onComplete: () => { if (resultEl) resultEl.style.display = 'none'; },
  });
}

// ════════════════════════════════════════════════════════════════
//  THE WINNING MOMENT
// ════════════════════════════════════════════════════════════════
// A dedicated hero shot between the finish and the roll call. The
// choreography is taken from the V16.1 delivery (saturday_cinematic_v2,
// runWinningMoment): the camera cuts close on the winner, who is still
// galloping, and pushes in; after 1.25s the jockey comes up out of the
// crouch into a one-arm salute while keeping the reins; a gold-edged
// "WINNING MOMENT" card resolves at the top; confetti bursts from both
// sides; the frame vignettes and the letterbox closes it like a
// broadcast sting. 5.2 seconds.
//
// What is ours rather than theirs is everything in the frame. Their
// version cut to a painted sky-and-grass backdrop and a sprite horse.
// Here it is our racecourse — the same sky, clouds, stands, rail crowd,
// hoardings and turf, magnified and scrolling past as a low tracking
// shot — and our horse and jockey, drawn by drawHorseSilhouette() at
// hero scale, with the salute added to the jockey rig.
//
// It is still one GSAP timeline (winTL) writing into one state object
// (HERO), and renderFrame() hands over to renderHeroFrame() while it
// runs. Skipped entirely under prefers-reduced-motion, as theirs is.
const WINNING_MOMENT_S = 5.2;
const HERO_STRIDE_HZ   = 2.2;     // strides a second at full speed
let winTL = null;

const HERO = {
  active: false,
  horse:  null,
  push:   0,       // 0 → 1, the camera pushing in
  speed:  1,       // the winner's gallop, easing but never stopping
  scroll: 0,       // px of turf travelled since the cut
  crowd:  null,    // a softer copy of the rail crowd, for the long lens
  confetti: [],
};

// Where the rail sits in the hero frame, and how big the winner is.
function heroLayout() {
  const narrow = isNarrowViewport();
  const railY = viewH * (narrow ? 0.60 : 0.655);
  // Horse length on screen at the end of the push. The push itself is
  // theirs: 1.55× → 2.25×, i.e. the horse grows by 1.45 across it.
  // On a phone the whole drawing — tail tip (x = -40) to muzzle (x = +55),
  // a quarter longer than the horse itself — has to fit the width.
  const endLen = Math.min(viewW * (narrow ? 0.66 : 0.36), viewH * 0.62);
  const len = endLen / 1.45 * (1 + 0.45 * HERO.push);
  const scale = len / HORSE_ART_LENGTH;
  return {
    railY: railY,
    scale: scale,
    x: viewW * 0.5 - 7.5 * scale,               // centre the drawing, not the origin
    groundY: viewH * (narrow ? 0.82 : 0.9),
  };
}

function drawHeroBackdrop() {
  pCtx.clearRect(0, 0, viewW, viewH);
  const L = heroLayout();
  const horizon = L.railY - viewH * 0.085;
  const S = 1.65;                               // long-lens magnification
  const standH = TILES.stand ? TILES.stand.h * S : viewH * 0.28;
  const standTop = horizon + 2 - standH;
  const sc = HERO.scroll;

  SUN.x = viewW * (isNarrowViewport() ? 0.74 : 0.8);
  SUN.y = Math.max(viewH * 0.06, standTop - viewH * 0.1);
  SUN.visible = 1;

  paintScenery(pCtx, { bottom: horizon + viewH * 0.08, warm: 0.9 }, {
    cloudsHigh: { bottom: standTop + viewH * 0.05, offset: sc * 0.012 + frameClock * WIND.cloudsHigh, alpha: 0.9, scale: 1.25 },
    cloudsLow:  { bottom: standTop + viewH * 0.10, offset: sc * 0.03  + frameClock * WIND.cloudsLow,  alpha: 1,   scale: 1.35 },
    hills:      { bottom: horizon + 6,             offset: sc * 0.05, alpha: 0.9, scale: 1.4 },
    stand:      { bottom: horizon + 2,             offset: sc * 0.16, alpha: 1,   scale: S },
    trees:      { bottom: horizon + viewH * 0.035, offset: sc * 0.3,  alpha: 1,   scale: 1.9 },
  }, { horizon, height: standH * 0.6 });
}

function drawHeroTrack() {
  const L = heroLayout();
  const sc = HERO.scroll;
  const bs = Math.max(1.6, viewH / 330);         // hoarding / crowd scale

  // Rail crowd, soft — they are well behind the point of focus.
  const crowd = HERO.crowd || TILES.railCrowd;
  if (crowd) blitTiled(ctx, crowd, L.railY - 13 * bs + 5 * bs, sc * 0.6, 0.95, bs * 1.1);
  if (TILES.boards) blitTiled(ctx, TILES.boards, L.railY, sc * 0.62, 0.95, bs);

  // Running rail
  ctx.fillStyle = 'rgba(248,248,244,0.9)';
  ctx.fillRect(0, L.railY - 3 * bs * 0.4, viewW, 2.2 * bs * 0.5);

  // Turf, scrolling at the gallop, with its own depth light
  if (TILES.turf) {
    const tw = TILES.turf.w;
    let x = -(((sc % tw) + tw) % tw);
    for (; x < viewW; x += tw) ctx.drawImage(TILES.turf.canvas, x, L.railY, tw, viewH - L.railY);
  }
  const shade = ctx.createLinearGradient(0, L.railY, 0, viewH);
  shade.addColorStop(0, 'rgba(160,190,196,0.14)');
  shade.addColorStop(1, 'rgba(4,10,6,0.42)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, L.railY, viewW, viewH - L.railY);

  // Lateral streaks: the turf blurring past the lens. Theirs, adapted.
  if (!prefersReducedMotion) {
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#f5efde';
    ctx.lineWidth = 2;
    const drift = (sc * 0.42) % 150;
    for (let i = -1; i < 9; i++) {
      const yy = L.railY + (viewH - L.railY) * 0.18 + i * 22;
      ctx.beginPath();
      ctx.moveTo(-150 + drift, yy);
      ctx.lineTo(viewW, yy - 8);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function burstHeroConfetti(x, y, n, colour) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 6;
    HERO.confetti.push({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4,
      g: 0.18 + Math.random() * 0.1, life: 1,
      w: 4 + Math.random() * 4, rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4, colour: colour,
    });
  }
}

function drawHeroConfetti(dt) {
  const step = dt > 0 ? Math.max(0.5, Math.min(2.5, dt / FRAME_MS)) : 0;
  HERO.confetti = HERO.confetti.filter((p) => {
    p.vy += p.g * step;
    p.x += p.vx * step;
    p.y += p.vy * step;
    p.rot += p.spin * step;
    p.life -= 0.012 * step;
    if (p.life <= 0 || p.y > viewH + 30) return false;
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.colour;
    ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
    ctx.restore();
    return true;
  });
}

function renderHeroFrame(dt) {
  const h = HERO.horse;
  const L = heroLayout();

  // The winner keeps galloping; the gait eases as the speed does, and the
  // turf passes under him exactly one stride per cycle, so his hooves stay
  // planted on it (see placeHorse).
  const cycles = dt / 1000 * HERO_STRIDE_HZ * (0.55 + 0.45 * HERO.speed);
  const passed = cycles * STRIDE_LOCAL * L.scale;
  HERO.scroll += passed;
  h.legPhase  += cycles * Math.PI * 2;
  h.bobPhase  += cycles * Math.PI * 2 * 0.62;
  h.swayPhase += dt * 0.0032;
  h.speed = 0.3;                                 // keeps the hoof dust coming

  drawHeroBackdrop();
  ctx.clearRect(0, 0, viewW, viewH);
  drawHeroTrack();

  // Divots are thrown back and left behind as the ground goes past.
  for (const p of particles) p.x -= passed * 0.85;
  drawHoofDust(dt);

  // Local y = +28 is the ground line of the horse artwork.
  spawnHoofDust(L.x, L.groundY - 28 * L.scale, h, strideCycle(h), L.scale);
  drawHorseSilhouette(L.x, L.groundY - 28 * L.scale, h, L.scale);

  // Dark edges, then the celebration.
  const vg = ctx.createRadialGradient(
    viewW * 0.5, viewH * 0.52, viewW * 0.18,
    viewW * 0.5, viewH * 0.52, viewW * 0.72
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.48)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, viewW, viewH);

  drawHeroConfetti(dt);
  drawGrain();
  drawLetterbox();
}

// ── The card ─────────────────────────────────────────────────────
let winEl = null;

function winMomentEl() {
  if (winEl && winEl.isConnected) return winEl;
  const screen = document.getElementById('screen-race');
  if (!screen) return null;
  const el = document.createElement('div');
  el.className = 'win-moment';
  el.id = 'winMoment';
  screen.appendChild(el);
  winEl = el;
  return el;
}

function showWinnerMomentCard(winner, margin) {
  const el = winMomentEl();
  if (!el) return;
  const odds = winner.odds || '';
  let marginText = '';
  if (margin && margin.lengths === -1) marginText = 'DEAD HEAT';
  else if (margin && margin.lengths != null && margin.lengths >= 0) marginText = formatBeatenDistance(margin.lengths);
  const meta = ['WINNER', odds ? String(odds) : '', marginText].filter(Boolean).join('   ·   ');
  el.innerHTML =
    '<span class="win-moment__eyebrow">SATURDAY RACING  ·  WINNING MOMENT</span>' +
    '<span class="win-moment__name">' + esc(winner.name || 'WINNER') + '</span>' +
    '<span class="win-moment__meta">' + esc(meta) + '</span>';
  el.style.display = 'flex';
  // Theirs resolves over 18% of the moment with a cubic ease-out.
  gsap.fromTo(el, { opacity: 0, y: -8 },
              { opacity: 1, y: 0, duration: WINNING_MOMENT_S * 0.18, ease: 'power3.out' });
}

function hideWinnerMomentCard() {
  if (!winEl) return;
  gsap.killTweensOf(winEl);
  winEl.style.display = 'none';
  gsap.set(winEl, { opacity: 0 });
}

function runWinningMoment(margin) {
  const winner = STATE.simResult.winner;
  const h = horses.find((x) => x.runner.id === winner.id);
  if (!h || prefersReducedMotion) { raceFinish(margin); return; }

  hideResultCard();
  particles = [];
  pressFlashes = [];
  HERO.active = true;
  HERO.horse  = h;
  HERO.push   = 0;
  HERO.speed  = 1;
  HERO.scroll = 0;
  HERO.confetti = [];
  HERO.crowd  = HERO.crowd || softenTile(TILES.railCrowd, 1.4);
  h.salute = 0;

  const screen = document.getElementById('screen-race');
  if (screen) screen.classList.add('is-winning-moment');
  setCommentaryText(`${winner.name} has done it — a winning moment to remember.`);
  gsap.killTweensOf(DIRECTOR);
  Object.assign(DIRECTOR, { flash: 0, vignette: 0, letterbox: 0.021 });

  // The last hero frame stays on the canvas while the roll call fades in;
  // the card and the chrome class are cleared by the next race or replay.
  winTL = gsap.timeline({ onComplete: () => { HERO.active = false; raceFinish(margin); } });
  // Camera push, eased out, over the first 48% of the moment.
  winTL.to(HERO, { push: 1, duration: WINNING_MOMENT_S * 0.48, ease: 'power3.out' }, 0);
  // Still galloping at the end, just not flat out.
  winTL.to(HERO, { speed: 0.6, duration: WINNING_MOMENT_S, ease: 'sine.inOut' }, 0);
  // 1.25s in, up out of the crouch into the salute.
  winTL.to(h, { salute: 1, duration: 0.45, ease: 'power2.out' }, 1.25);
  winTL.call(() => showWinnerMomentCard(winner, margin), null, WINNING_MOMENT_S * 0.28);
  for (let i = 0; i < 4; i++) {
    winTL.call(() => {
      burstHeroConfetti(viewW * 0.70, viewH * 0.34, 18, COL.gold);
      burstHeroConfetti(viewW * 0.30, viewH * 0.38, 12, '#ffffff');
    }, null, 1.55 + i * 0.21);
  }
  // The letterbox closes the scene over its last 30%.
  winTL.to(DIRECTOR, { letterbox: 0.038, duration: WINNING_MOMENT_S * 0.3, ease: 'power2.in' },
           WINNING_MOMENT_S * 0.7);
}

function resetWinningMoment() {
  if (winTL) { winTL.kill(); winTL = null; }
  HERO.active = false;
  HERO.horse = null;
  HERO.confetti = [];
  gsap.killTweensOf(HERO);
  hideWinnerMomentCard();
  const screen = document.getElementById('screen-race');
  if (screen) screen.classList.remove('is-winning-moment');
}

// ─── Race finish → roll call ───────────────────────────────────
function raceFinish(margin) {
  raceRunning = false;
  stopTicker();

  const winner    = STATE.simResult.winner;
  const positions = STATE.simResult.positions;

  const line = (margin && margin.lengths === -1)
    ? `${winner.name} — a dead heat!`
    : `${winner.name} wins it.`;
  setCommentaryText(line);

  runRollCall(positions, winner);
}
// ─── Roll Call ──────────────────────────────────────────────────
// Post-race walkthrough of every finisher, LAST → FIRST. Mirrors
// experience.js (the jumps engine). Reuses
// experience.css styling so jumps + flat look identical here.
const ROLLCALL_HOLD_MS = {
  back:   750,
  third:  1400,
  second: 1600,
  first:  2500,
};
const ROLLCALL_FADE_MS = 220;
let rollCallSkipped = false;
let rollCallHold = null;     // the pending hold timer, while a card is up
let rollCallRun = null;      // { positions, winner } for the walk in progress

function skipRollCall() {
  rollCallSkipped = true;
  if (rollCallHold !== null && rollCallRun) {
    cancelTimer(rollCallHold);
    rollCallHold = null;
    transitionToReveal(rollCallRun.winner, rollCallRun.positions);
  }
}

function rollCallHoldFor(rank) {
  if (rank === 1) return ROLLCALL_HOLD_MS.first;
  if (rank === 2) return ROLLCALL_HOLD_MS.second;
  if (rank === 3) return ROLLCALL_HOLD_MS.third;
  return ROLLCALL_HOLD_MS.back;
}

// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 23rd.
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return n + 'th';
  const units = n % 10;
  return n + (units === 1 ? 'st' : units === 2 ? 'nd' : units === 3 ? 'rd' : 'th');
}

function rollCallPositionLabel(rank, total) {
  if (rank === total) return 'LAST PLACE';
  return ordinal(rank) + ' PLACE';
}

function buildRollCallCard(horse, rank, total) {
  const isWinner = rank === 1;
  const medalCls = rank === 1 ? 'rollcall-medallion--1st'
                 : rank === 2 ? 'rollcall-medallion--2nd'
                 : rank === 3 ? 'rollcall-medallion--3rd' : '';
  let distHtml = '';
  if (!isWinner && REPLAY_DATA && REPLAY_DATA.has_result) {
    const raw = (REPLAY_DATA.beaten_distances || {})[horse.id];
    if (raw) distHtml = '<div class="rollcall-distance">+' + esc(raw) + '</div>';
  }
  const cardCls = isWinner ? 'rollcall-card rollcall-card--winner' : 'rollcall-card';
  return (
    '<div class="' + cardCls + '">' +
      '<div class="rollcall-medallion ' + medalCls + '">' + rank + '</div>' +
      '<div class="rollcall-position-label">' + rollCallPositionLabel(rank, total) + '</div>' +
      '<div class="parade-silk">' + renderSilkSvg(horse) + '</div>' +
      '<div class="rollcall-name">' + esc(horse.name) + '</div>' +
      '<div class="rollcall-connections">' +
        '<strong>J:</strong> ' + esc(horse.jockey) + ' &nbsp;·&nbsp; ' +
        '<strong>T:</strong> ' + esc(horse.trainer) +
      '</div>' +
      distHtml +
    '</div>'
  );
}

function buildRollCallProgress(total, currentDoneCount) {
  let html = '';
  for (let i = 0; i < total; i++) {
    let cls = 'rollcall-progress__dot';
    if (i < currentDoneCount - 1)        cls += ' rollcall-progress__dot--done';
    else if (i === currentDoneCount - 1) cls += ' rollcall-progress__dot--current';
    html += '<span class="' + cls + '"></span>';
  }
  return html;
}

function runRollCall(positions, winner) {
  rollCallSkipped = false;
  rollCallRun = { positions, winner };
  if (!positions || positions.length === 0) {
    transitionToReveal(winner, positions);
    return;
  }
  gsap.to('#screen-race', {
    opacity: 0, duration: 0.6, ease: 'power2.in',
    onComplete: () => {
      showScreen('rollcall');
      gsap.fromTo('#screen-rollcall',
        { opacity: 0 },
        { opacity: 1, duration: 0.5, onComplete: () => rollCallStep(positions, winner, 0) }
      );
    },
  });
}

function rollCallStep(positions, winner, idx) {
  if (rollCallSkipped) {
    transitionToReveal(winner, positions);
    return;
  }
  const total = positions.length;
  if (idx >= total) {
    transitionToReveal(winner, positions);
    return;
  }
  const rank = total - idx;
  const horse = positions[rank - 1];
  const stage = document.getElementById('rollcallStage');
  const progressEl = document.getElementById('rollcallProgress');
  if (stage)      stage.innerHTML      = buildRollCallCard(horse, rank, total);
  if (progressEl) progressEl.innerHTML = buildRollCallProgress(total, idx + 1);

  gsap.fromTo('.rollcall-card',
    { opacity: 0, y: 24, scale: 0.97 },
    { opacity: 1, y: 0, scale: 1,
      duration: ROLLCALL_FADE_MS / 1000, ease: 'power2.out' }
  );

  const hold = rollCallHoldFor(rank);
  rollCallHold = after(hold, () => {
    rollCallHold = null;
    if (rollCallSkipped) {
      transitionToReveal(winner, positions);
      return;
    }
    // Winner card dissolves straight into trophy — no fade-out.
    if (rank === 1) {
      transitionToReveal(winner, positions);
      return;
    }
    gsap.to('.rollcall-card', {
      opacity: 0, y: -18, scale: 0.97,
      duration: ROLLCALL_FADE_MS / 1000, ease: 'power2.in',
      onComplete: () => rollCallStep(positions, winner, idx + 1),
    });
  });
}

function transitionToReveal(winner, positions) {
  // Fade both potentially-active screens (race or rollcall). Whichever
  // is visible animates; the other is already opacity 0 and a no-op.
  gsap.to('#screen-race, #screen-rollcall', {
    opacity: 0, duration: 0.6, ease: 'power2.in',
    onComplete: () => {
      buildRevealScreen(winner, positions);
      showScreen('reveal');
      gsap.fromTo('#screen-reveal', { opacity: 0 }, { opacity: 1, duration: 0.5, onComplete: animateReveal });
    },
  });
}

function buildRevealScreen(winner, positions) {
  const isUserWin = isUserPick(winner);
  buildRevealHeader(winner, isUserWin);
  buildRevealPodium(positions);
  buildRevealVerdict(positions, isUserWin);
}

// Background, winner's name, odds and silks under the trophy.
function buildRevealHeader(winner, isUserWin) {
  const revBg = document.getElementById('revealBg');
  if (revBg) {
    // Tint comes from .reveal-bg--win / --turf in experience.css, so brand
    // gold stays in the palette rather than in a gradient string here.
    revBg.classList.toggle('reveal-bg--win', !!isUserWin);
    revBg.classList.toggle('reveal-bg--turf', !isUserWin);
  }

  const horseEl = document.getElementById('revealHorseName');
  if (horseEl) horseEl.textContent = winner.name;
  const oddsEl = document.getElementById('revealOdds');
  if (oddsEl) oddsEl.textContent = winner.odds;

  // Silk badge beneath the trophy — matches the parade-card design
  // so the winner's identity reads consistently across the experience.
  const silkEl = document.getElementById('revealSilk');
  if (silkEl) {
    silkEl.classList.add('reveal-silk--jersey');
    silkEl.innerHTML = renderSilkSvg(winner);
  }

  // The result, spoken. This replaces the generic screen announcement for
  // the reveal — "the Winner's Circle" tells a screen-reader user nothing;
  // who won, at what price, and whether their pick came in tells them
  // everything. It is the one announcement that must land, so it is made
  // here rather than left to the reveal's GSAP timeline, which a
  // reduced-motion run skips.
  const price = winner.odds ? ' at ' + winner.odds : '';
  announce('Result: ' + winner.name + ' wins' + price + '. ' +
           (isUserWin ? 'Your pick won.' : 'Your pick did not win.'));
}

// The first three, with their silks, margins and prices.
function buildRevealPodium(positions) {
  const podium = document.getElementById('revealPodium');
  if (podium) {
    // Replay mode: format the raw beaten-distance into compact racing
    // copy ("½L", "1¼L", "hd", "nse") rather than the raw "+.5" string.
    // Skipped on forecast routes (no real result yet).
    const distances = (REPLAY_DATA && REPLAY_DATA.has_result)
      ? REPLAY_DATA.beaten_distances : null;
    const MEDALS = ['🥇', '🥈', '🥉'];
    podium.innerHTML = positions.slice(0, 3).map((r, i) => {
      // Compact beaten-distance copy for the podium chip. ALWAYS emits
      // a span (empty for 1st) so the CSS grid columns line up across
      // all three rows — without this placeholder, auto-placement put
      // the winner's odds in column 5 instead of column 6, making the
      // 1st-row right edge shorter than the others.
      let gapInner = '';
      if (distances && i > 0) {
        const lengths = parseBeatenDistance(distances[r.id]);
        gapInner = formatBeatenDistanceCompact(lengths) || '';
      }
      const gapHtml = '<span class="reveal-podium__gap' +
                     (gapInner ? '' : ' is-empty') + '">' +
                     gapInner + '</span>';

      // Use the proper racing-silk SVG renderer (same one the live
      // leaderboard uses). When the Racing API has supplied silk_url,
      // it renders the real silk image; otherwise it builds an SVG
      // jersey from silk + silk2 + silk_pattern matching the racecard.
      const silkHtml =
        '<span class="reveal-podium__silk" aria-hidden="true">' +
          renderSilkSvg(r) +
        '</span>';

      return (
        '<div class="reveal-podium__row reveal-podium__row--' + (i + 1) + '">' +
          '<span class="reveal-podium__medal" aria-hidden="true">' + MEDALS[i] + '</span>' +
          '<span class="reveal-podium__pos">' + ordinal(i + 1) + '</span>' +
          silkHtml +
          '<span class="reveal-podium__name">' + esc(r.name) + '</span>' +
          gapHtml +
          '<span class="reveal-podium__odds">' + esc(r.odds) + '</span>' +
        '</div>'
      );
    }).join('');
  }
}

// How the viewer's own pick got on.
function buildRevealVerdict(positions, isUserWin) {
  const verdictBox = document.getElementById('revealVerdictBox');
  const verdictTitle = document.getElementById('revealVerdictTitle');
  const verdictText  = document.getElementById('revealVerdictText');
  if (verdictTitle && verdictText && verdictBox) {
    if (isUserWin) {
      verdictTitle.textContent = '🐾 Your pick wins!';
      verdictText.textContent  = 'You called it. Trust the read.';
    } else if (STATE.userPick) {
      const userFinishIdx = positions.findIndex((r) => isUserPick(r));
      verdictTitle.textContent = '🐾 Your pick: ' + STATE.userPick.name;
      verdictText.textContent  = userFinishIdx >= 0
        ? 'Finished ' + ordinal(userFinishIdx + 1)
        : 'Finished out of frame.';
    } else {
      verdictTitle.textContent = 'No pick on record';
      verdictText.textContent  = 'Make a pick on the racecard before next Saturday.';
    }
  }
}

// Gold falling through frame as the trophy lands. This is the one place
// in the experience where confetti belongs — it was removed from the
// race itself, where it read as an arcade flourish over a sports
// broadcast. Built from DOM nodes rather than canvas because the reveal
// screen sits above both canvases, and torn down when it lands so
// nothing accumulates across replays.
const REVEAL_CONFETTI_COUNT = 44;

function spawnRevealConfetti() {
  if (prefersReducedMotion) return;
  const screen = document.getElementById('screen-reveal');
  if (!screen) return;

  let layer = document.getElementById('revealConfetti');
  if (layer) layer.remove();
  layer = document.createElement('div');
  layer.className = 'reveal-confetti';
  layer.id = 'revealConfetti';
  screen.appendChild(layer);

  const COLOURS = ['#D4AF37', '#F5E49A', '#C8A951', '#FFFFFF', '#E8C86A'];
  const pieces = [];
  for (let i = 0; i < REVEAL_CONFETTI_COUNT; i++) {
    const el = document.createElement('i');
    el.style.background = COLOURS[(Math.random() * COLOURS.length) | 0];
    el.style.left = (Math.random() * 100).toFixed(2) + '%';
    el.style.width = (4 + Math.random() * 5).toFixed(1) + 'px';
    el.style.height = (7 + Math.random() * 9).toFixed(1) + 'px';
    layer.appendChild(el);
    pieces.push(el);
  }

  gsap.set(pieces, { y: -40, opacity: 1, rotation: () => Math.random() * 360 });
  gsap.to(pieces, {
    y: () => window.innerHeight + 80,
    x: () => (Math.random() - 0.5) * 220,
    rotation: () => (Math.random() - 0.5) * 900,
    opacity: 0,
    ease: 'none',
    duration: () => 2.4 + Math.random() * 2.2,
    delay: () => Math.random() * 1.1,
    // One callback for the whole fall, once the last piece has landed.
    onComplete: () => layer.remove(),
  });
}

function animateReveal() {
  const tl = gsap.timeline();
  tl.to('.reveal-kicker',          { opacity: 1, y: 0, duration: 0.4 });
  tl.to('.reveal-winner-label',    { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
  tl.to('#revealTrophyWrap',       { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.4)' }, '-=0.15');
  tl.call(spawnRevealConfetti, null, '-=0.35');
  tl.to('#revealHorseName',        { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
  tl.to('#revealOdds',             { opacity: 1, duration: 0.3 }, '-=0.1');
  tl.to('#revealVerdictBox',       { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
  tl.to('#revealPodium',           { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
  // The podium is the densest thing on the screen, so it earns its own
  // stagger rather than fading in as one block.
  tl.fromTo('.reveal-podium__row',
    { opacity: 0, x: -28 },
    { opacity: 1, x: 0, duration: 0.45, stagger: 0.12, ease: 'power3.out' }, '-=0.25');
  tl.to('.reveal-actions',         { opacity: 1, duration: 0.4 }, '-=0.1');
  return tl;
}

// ─── Replay ────────────────────────────────────────────────────
function replayExperience() {
  // User is going back to the intro — restore the archive picker.
  document.body.classList.remove('cinematic-experience-running');
  resetFlow();
  resetRaceEngine();
  resetRaceOverlays();
  resetScreens();
  showScreen('intro');
}

function resetFlow() {
  cancelFlowTimers();
  experienceStarted = false;
  leavingParade = false;
  // The next parade opens on its first card, with its entrance, not on
  // the last run's card and the swap animation.
  const paradeStage = document.getElementById('paradeStage');
  if (paradeStage) paradeStage.innerHTML = '';
  rollCallHold = null;
  rollCallRun = null;
  // Re-arm the Skip-to-Finish pill for the next run.
  const skipWrap = document.querySelector('.race-skip-wrap');
  if (skipWrap) skipWrap.classList.remove('race-skip-hidden');
  // Reset roll-call state — a fresh run gets a fresh walk.
  rollCallSkipped = false;
  const rcStage = document.getElementById('rollcallStage');
  if (rcStage) rcStage.innerHTML = '';
  const rcProgress = document.getElementById('rollcallProgress');
  if (rcProgress) rcProgress.innerHTML = '';
}

function resetRaceEngine() {
  // Kill the timelines first: they write into DIRECTOR every tick, so
  // resetting the director while one is still alive gets overwritten
  // on the very next frame.
  if (masterTL) { masterTL.kill(); masterTL = null; }
  if (finishTL) { finishTL.kill(); finishTL = null; }
  gsap.killTweensOf(DIRECTOR);
  horses.forEach((h) => gsap.killTweensOf(h));
  stopTicker();

  raceRunning  = false;
  particles    = [];
  pressFlashes = [];
  horses      = [];
  horsesByLane = [];
  frameClock  = 0;
  lastPhaseTitle = '';
  firedCommentary.clear();
  lbSampleTimer = 0;
  rankedCache   = [];
  rankedCacheAt = -1;

  Object.assign(DIRECTOR, DIRECTOR_START);
  Object.assign(CAM, CAM_START);
  FINISH.active = false;

  pCtx.clearRect(0, 0, viewW, viewH);
  ctx.clearRect(0, 0, viewW, viewH);
}

function resetRaceOverlays() {
  // The last race's closing line is written after the ticker stops, so
  // it never fades on its own; clear it, or the next race opens on it.
  const commentary = document.getElementById('racingCommentary');
  if (commentary) {
    gsap.killTweensOf(commentary);
    commentary.textContent = '';
    gsap.set(commentary, { opacity: 0 });
  }
  commentaryTimer = 0;
  // Race-screen overlays
  const raceScreen = document.getElementById('screen-race');
  if (raceScreen) {
    raceScreen.classList.remove('is-final-furlong');
    delete raceScreen.dataset.racePhase;
  }
  clearBroadcastId();
  resetWinningMoment();
  const confetti = document.getElementById('revealConfetti');
  if (confetti) { gsap.killTweensOf(confetti.children); confetti.remove(); }
  if (resultEl) { resultEl.style.display = 'none'; gsap.set(resultEl, { opacity: 0 }); }
  const strip = document.getElementById('phaseStrip');
  if (strip) strip.remove();

  const stalls = document.getElementById('flatStalls');
  if (stalls) stalls.classList.remove('is-opening', 'is-hidden');
}

function resetScreens() {
  // Wipe stale GSAP inline styles off every screen so the CSS rules
  // (.screen { opacity: 0 } / .screen.active { opacity: 1 }) take over
  // again cleanly. Without this, `#screen-intro` is left with the
  // `style="opacity:0"` GSAP wrote when the user first clicked Start,
  // which silently overrides the active-class CSS — Run Again would
  // appear to do nothing because the intro stays invisible.
  gsap.set('.screen', { clearProps: 'all' });

  // Restore the reveal screen's inner elements to their hidden
  // starting state so animateReveal() plays cleanly on the next race.
  gsap.set('.reveal-kicker, .reveal-winner-label', { opacity: 0 });
  gsap.set('#revealTrophyWrap', { opacity: 0, scale: 0.7 });
  gsap.set('#revealHorseName', { opacity: 0, y: 20 });
  gsap.set('#revealOdds', { opacity: 0 });
  gsap.set('#revealVerdictBox', { opacity: 0, y: 12 });
  gsap.set('#revealPodium', { opacity: 0, y: 10 });
  gsap.set('.reveal-actions', { opacity: 0 });
}

// ─── Public API ─────────────────────────────────────────────────
// What the page calls: the production boot script calls init() and, on
// the reduced-motion path, startExperience(); the buttons are wired in
// wireButtons(). FlatEngine groups the same functions with the build's
// version and feature list (the sandbox's staleness badge reads these),
// QA hooks for deterministic regression runs (tools/visual-regression.js)
// and the pure helpers the unit tests in tests/ exercise. Nothing in the
// product reads debug or internals.
const PUBLIC_API = { init, startExperience, skipParade, skipToFinish, skipRollCall, replayExperience };
Object.assign(window, PUBLIC_API);

window.FlatEngine = Object.freeze(Object.assign({
  version: '2.6.0',
  features: Object.freeze(['world-camera', 'coat-palette', 'rail-crowd',
                           'run-through', 'distance-gait', 'encapsulated', 'batched-draw']),
}, PUBLIC_API, {
  debug: Object.freeze({
    // Replace the engine's load-time randomness, for a repeatable run.
    reseed(camSeed) {
      CAM.seed = camSeed;
      ambientX = 0;
      ambientPainted = false;
    },
  }),
  internals: Object.freeze({
    parseBeatenDistance, formatBeatenDistance, formatBeatenDistanceCompact, ordinal,
    inventFinishGaps, raceProgressEase, runOnPast, finishPauseS, smoothstep,
    hoofPath, solveLeg, solveHorseLegs, limbShape, taperPath, dotPath, coatFor, markingsFor,
    LEG_RIG, STRIDE_SWEEP, STANCE, STRIDE_LOCAL, START_EASE, EASE_TO,
    FINISH_PAUSE_S, FINISH_PAUSE_MAX_S, MAX_VISIBLE_LENGTHS,
    esc, mergeConfig, buildRacePositions, renderCommentary,
  }),
}));

// First layout. Deliberately the last statement in the module: resize()
// builds the scenery tiles, which needs every tile painter above to be
// defined, and TILES and its painters are declared in source order.
resize();
})();
