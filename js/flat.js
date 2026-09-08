/*
 * THE FLAT EXPERIENCE — Saturday Racing Cinematic Engine (flat racing)
 *
 * Renders a band-tuned cinematic for sprint / mile / stayer flat
 * races. Same screen flow as the jumps engine (intro → parade →
 * race → reveal), but with flat-specific visuals:
 *   • Stalls graphic that bangs open at t=0
 *   • Speed lines trailing horses based on velocity
 *   • Slow-motion final furlong (last X% of race plays at slowMoFactor)
 *   • Photo-finish freeze frame at the line
 *   • Furlong poles instead of jumps fences
 *   • Daylight palette
 *
 * Config: cinematic/seed/flat_config.json — embedded server-side via
 * json_script as #flatConfig. Tempo, commentary, phase titles, and
 * palette all data-driven so editorial tuning needs no JS edit.
 *
 * Dependencies: GSAP (loaded via CDN in flat.html template).
 */

'use strict';

// ─── CONFIG load ────────────────────────────────────────────────
// Defaults are minimal — the seed JSON should always populate these.
const FLAT_DEFAULTS = {
  shared: {
    stallsOpenMs: 600,
    photoFinishHoldMs: 900,
    subtitleDefaultMs: 2400,
    track: { startX: 0.05, finishX: 0.94, laneTopRatio: 0.24, laneBottomRatio: 0.78, furlongPoleEvery: 0.125 },
    horse: { minSurges: 2, maxExtraSurges: 2, surgeStartRange: [0.10, 0.75], surgeDurationRange: [0.04, 0.10], surgeBoostRange: [0.5, 1.5], winnerFinalSurge: { start: 0.78, duration: 0.18, boost: 2.4 } },
    colours: { gold: '#D4AF37', goldLight: '#F5E49A', userPick: 'rgba(212,175,55,0.28)', foxPick: 'rgba(200,120,20,0.22)', neutralGlow: 'rgba(120,150,200,0.10)', userLabel: '#D4AF37', foxLabel: '#E8A050', defaultLabel: 'rgba(244,240,232,0.88)', silkDefault: '#C8A951', silk2Default: '#1A2540', rankGold: '#D4AF37', rankSilver: '#C0C0C0', rankBronze: '#CD7F32', skyTop: '#7eb8e8', skyBottom: '#c9a66a', trackTurf: '#2d5e3a', speedLine: 'rgba(255,255,255,0.45)' },
  },
  band: {
    label: 'Mile',
    timings: { raceDurationMs: 46000, paradeDelayMsFast: 900, paradeDelayMsSlow: 1300, paradeLargeFieldThreshold: 16, commentaryHoldMs: 3000, winnerHoldMs: 3800, raceEndConfettiBursts: 7, raceEndConfettiIntervalMs: 170, slowMoStartProgress: 0.86, slowMoFactor: 0.55, closeupTriggerProgress: 0.74, finalFurlongProgress: 0.88 },
    phases: {
      raceStart: "AND THEY'RE AWAY",
      midRace:   'STEADY THE PACE',
      turn:      'INTO THE BACK STRAIGHT',
      kick:      'TWO FURLONGS OUT',
      finale:    'DRIVING TO THE LINE',
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

const FLAT_CONFIG = (() => {
  try {
    const el = document.getElementById('flatConfig');
    if (!el) return FLAT_DEFAULTS;
    const parsed = JSON.parse(el.textContent || '{}');
    return {
      shared: Object.assign({}, FLAT_DEFAULTS.shared, parsed.shared || {}),
      band:   Object.assign({}, FLAT_DEFAULTS.band,   parsed.band   || {}),
    };
  } catch (e) {
    return FLAT_DEFAULTS;
  }
})();

const SHARED = FLAT_CONFIG.shared;
const BAND   = FLAT_CONFIG.band;
const COL    = SHARED.colours;
const TRK    = SHARED.track;

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Silk badge renderer ────────────────────────────────────────
// Mirrors races/templates/races/components/atoms/_silk.html.
// Duplicated from experience.js — Phase 3 will hoist this into a
// shared module along with the rest of the engine code.
let _silkIdCounter = 0;
function renderSilkSvg(runner) {
  if (runner && runner.silk_url) {
    return '<img class="silk-img" src="' + runner.silk_url +
           '" alt="Silks" loading="lazy" decoding="async">';
  }
  const body   = (runner && runner.silk)  || COL.silkDefault  || '#1A3A6B';
  const accent = (runner && runner.silk2) || COL.silk2Default || '#FFFFFF';
  const pat    = (runner && runner.silk_pattern) || 'solid';
  const id = 'cinSilkClip-' + (++_silkIdCounter);
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

// ─── State ──────────────────────────────────────────────────────
const STATE = {
  runners:      [],
  userPick:     null,
  foxPick:      null,
  raceName:     '',
  raceDistance: '',
  raceBand:     'mile',
  paradeIdx:    0,
  simResult:    null,
  phase:        'intro',
};

// ─── Canvas + DPI ──────────────────────────────────────────────
const canvas  = document.getElementById('raceCanvas');
const pCanvas = document.getElementById('particleCanvas');
const ctx     = canvas.getContext('2d');
const pCtx    = pCanvas.getContext('2d');

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const radius = Math.max(0, Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2));
    this.beginPath();
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y,     x + w, y + h, radius);
    this.arcTo(x + w, y + h, x,     y + h, radius);
    this.arcTo(x,     y + h, x,     y,     radius);
    this.arcTo(x,     y,     x + w, y,     radius);
    this.closePath();
    return this;
  };
}

// ─── Viewport + world layout ────────────────────────────────────
// V2 is a WORLD-space engine. A runner's position is a distance
// travelled measured in horse LENGTHS; the renderer converts
// lengths → world px → screen px through the virtual camera. The
// viewport therefore only sets a scale factor — it never touches the
// race model, which is what lets the window resize mid-race without
// the field jumping.
let viewW = 0, viewH = 0;

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

  buildBackdropTiles();
  relayoutLanes();

  // A resize reallocates the canvas backing store, which clears it. The
  // race loop repaints on the next tick, but every other phase would be
  // left staring at a blank canvas, so repaint once here.
  if (raceRunning) renderFrame();
}
window.addEventListener('resize', resize);

// ─── Race state ─────────────────────────────────────────────────
let horses = [];
let raceRunning = false;
let particles = [];
let firedCommentary = new Set();
let currentCommentary = '';
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
const DIRECTOR = {
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
  reveal:    0,      // finish-card reveal 0 → 1
  phase:     'cruise',
};

// The camera itself. DIRECTOR supplies intent; CAM is the damped
// result that actually gets drawn.
const CAM = { x: 0, zoom: 1, shakeX: 0, shakeY: 0, seed: Math.random() * 1000 };

// ─── Race phases ────────────────────────────────────────────────
// Cruise → Build → Drive → Line. These are DIRECTION phases: they
// decide how the camera behaves. They are deliberately separate from
// BAND.phaseTable, which editorial tunes in the seed JSON and which
// still drives the on-screen commentary and phase strip.
const RACE_PHASES = [
  { key: 'cruise', from: 0.00, label: 'CRUISE' },
  { key: 'build',  from: 0.45, label: 'BUILD'  },
  { key: 'drive',  from: 0.72, label: 'DRIVE'  },
  { key: 'line',   from: 0.90, label: 'LINE'   },
];

// ─── Init ───────────────────────────────────────────────────────
function init(data) {
  STATE.runners      = data.runners;
  STATE.userPick     = data.userPick;
  STATE.foxPick      = data.foxPick;
  STATE.raceName     = data.raceName;
  STATE.raceDistance = data.raceDistance;
  STATE.raceBand     = data.raceBand || 'mile';

  buildIntroChips();
  wireButtons();
  showScreen('intro');
}
window.init = init;

function wireButtons() {
  const start = document.getElementById('flatStartBtn');
  if (start) start.addEventListener('click', () => window.startExperience());
  const skip  = document.getElementById('flatSkipParadeBtn');
  if (skip)  skip.addEventListener('click', () => window.skipParade());
  const replay = document.getElementById('flatReplayBtn');
  if (replay) replay.addEventListener('click', () => window.replayExperience());
  const raceSkip = document.getElementById('raceSkipBtn');
  if (raceSkip) raceSkip.addEventListener('click', () => window.skipToFinish());
  const rcSkip = document.getElementById('rollcallSkipBtn');
  if (rcSkip) rcSkip.addEventListener('click', () => window.skipRollCall());
  document.querySelectorAll('[data-href]').forEach((b) => {
    b.addEventListener('click', () => { window.location.href = b.dataset.href; });
  });
}

// ─── Screen management ──────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  STATE.phase = name;
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
}

// ─── Intro chips ────────────────────────────────────────────────
function buildIntroChips() {
  const container = document.getElementById('introRunnersPreview');
  if (!container) return;
  STATE.runners.slice(0, 20).forEach((r) => {
    const chip = document.createElement('div');
    const isUser = STATE.userPick && STATE.userPick.id === r.id;
    const isFox  = STATE.foxPick  && STATE.foxPick.name === r.name;
    chip.className = 'intro-runner-chip' +
      (isUser ? ' intro-runner-chip--user' : '') +
      (isFox  ? ' intro-runner-chip--fox'  : '');
    chip.textContent = (isUser ? '🐾 ' : isFox ? '🦊 ' : '') + r.name;
    container.appendChild(chip);
  });
}

// Skip-to-Finish — one seek on the master timeline. Because the
// timeline owns race progress AND every camera parameter, seeking it
// lands the camera, the phase, the leaderboard and the field all in a
// consistent state; there is no second clock to keep in step.
// Idempotent via Math.max.
const SKIP_TO_FINISH_REMAINING_S = 10;
window.skipToFinish = function () {
  if (!raceRunning || !masterTL) return;
  const target = Math.max(masterTL.time(),
                          masterTL.duration() - SKIP_TO_FINISH_REMAINING_S);
  masterTL.seek(target, false);
  snapRaceState();
  const wrap = document.querySelector('.race-skip-wrap');
  if (wrap) wrap.classList.add('race-skip-hidden');
};

window.startExperience = function () {
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
};

// buildRacePositions() honours REPLAY_DATA (Phase 4) — in replay mode
// positions[0] is the real winner, in forecast it's the weighted sim
// pick we passed in. Deriving `winner` from positions[0] means the
// static reveal never lies about a settled result.
function runStaticReveal() {
  const fallback = weightedRandom(STATE.runners);
  const positions = buildRacePositions(fallback);
  const winner = (positions && positions[0]) || fallback;
  STATE.simResult = { winner, positions };
  buildRevealScreen(winner, positions);
  showScreen('reveal');
}

// ─── Parade ─────────────────────────────────────────────────────
function beginParade() {
  STATE.paradeIdx = 0;
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
  STATE.paradeIdx = idx;
  updateParadeDots(idx);
  const counter = document.getElementById('paradeCounter');
  if (counter) counter.textContent = (idx + 1);

  const isUser = STATE.userPick && STATE.userPick.id === r.id;
  const isFox  = STATE.foxPick  && STATE.foxPick.name === r.name;
  const tagEls = [];
  if (isUser)   tagEls.push('<span class="parade-tag parade-tag--user">🐾 Your Pick</span>');
  if (isFox)    tagEls.push('<span class="parade-tag parade-tag--fox">🦊 Fox\'s Pick</span>');
  if (r.is_fav) tagEls.push('<span class="parade-tag parade-tag--fav">Favourite</span>');
  if (r.sr)     tagEls.push('<span class="parade-tag parade-tag--sr">SR ' + r.sr + '</span>');
  if (r.stars)  tagEls.push('<span class="parade-tag parade-tag--sr">' + '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars) + '</span>');

  const glow = isUser ? COL.userPick : isFox ? COL.foxPick : COL.neutralGlow;
  const html =
    '<div class="parade-bg-glow" style="background:radial-gradient(ellipse 80% 80% at 50% 50%, ' + glow + ', transparent)"></div>' +
    '<div class="parade-card" id="paradeCard">' +
    '  <div class="parade-silk">' + renderSilkSvg(r) + '</div>' +
    '  <div class="parade-number">Horse ' + r.number + ' of ' + STATE.runners.length + '</div>' +
    '  <div class="parade-name">' + r.name + '</div>' +
    '  <div class="parade-connections"><strong>J:</strong> ' + r.jockey + ' &nbsp;·&nbsp; <strong>T:</strong> ' + r.trainer + '</div>' +
    '  <div class="parade-odds-badge">' + r.odds + '</div>' +
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

  const T = BAND.timings || {};
  const ms = STATE.runners.length > (T.paradeLargeFieldThreshold || 16)
    ? (T.paradeDelayMsFast || 900)
    : (T.paradeDelayMsSlow || 1300);
  setTimeout(() => { if (STATE.phase === 'parade') showParadeHorse(idx + 1); }, ms);
}

window.skipParade = function () {
  STATE.paradeIdx = STATE.runners.length;
  transitionToRace();
};

// ─── Transition → race (with stalls bang) ──────────────────────
function transitionToRace() {
  showSubtitle("Into the stalls. The crowd holds its breath.", SHARED.subtitleDefaultMs);
  gsap.to('#screen-parade', {
    opacity: 0, duration: 0.6, delay: 0.4, ease: 'power2.in',
    onComplete: () => {
      showScreen('race');
      gsap.fromTo('#screen-race', { opacity: 0 }, { opacity: 1, duration: 0.4, onComplete: bangStallsAndStart });
    },
  });
}

function bangStallsAndStart() {
  const stalls = document.getElementById('flatStalls');
  // Stalls cover the canvas; bang open after a short held breath.
  setTimeout(() => {
    if (stalls) stalls.classList.add('is-opening');
    setTimeout(() => { if (stalls) stalls.classList.add('is-hidden'); }, 700);
    startRace();
  }, SHARED.stallsOpenMs || 600);
}

// ─── Race ───────────────────────────────────────────────────────
function startRace() {
  // Idempotent. The parade can hand off twice if the skip button is
  // pressed while its fade-in tween is still running — without this
  // guard that builds a second master timeline, and two timelines both
  // tweening DIRECTOR.progress fight each other for the rest of the
  // race. One race, one clock.
  if (raceRunning) return;

  // buildRacePositions() honours REPLAY_DATA (Phase 4): in replay
  // mode positions[0] is the real winner, in forecast it's our
  // weighted random pick passed in. Derive `winner` from positions[0]
  // so the reveal screen announces the horse that ACTUALLY crossed
  // the line first — not the pre-sim random fallback, which would
  // be wrong on replay routes.
  const fallback = weightedRandom(STATE.runners);
  const positions = buildRacePositions(fallback);
  const winner = (positions && positions[0]) || fallback;
  STATE.simResult = { winner, positions };
  buildHorseObjects(positions);

  frameClock  = 0;
  raceRunning = true;
  firedCommentary.clear();
  _lbSampleTimer = 0;
  STATE.finishMargin = null;

  buildLeaderboard();
  setPhaseTitle((BAND.phases && BAND.phases.raceStart) || "AND THEY'RE AWAY");

  // The timeline is built and started here, and it is the only clock
  // in the race from this point until crossTheLine() hands over.
  masterTL = buildMasterTimeline();
  startTicker();
  masterTL.play(0);
}

function weightedRandom(runners) {
  const total = runners.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total, cum = 0;
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
// no replay data is present. Mirrors experience.js exactly so
// the two engines stay in lockstep until Phase 3 hoists this
// into a shared module.
const REPLAY_DATA = (() => {
  try {
    const el = document.getElementById('replayData');
    return el ? JSON.parse(el.textContent || '{}') : null;
  } catch (e) {
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
    const byId = new Map(STATE.runners.map((r) => [r.id, r]));
    const ordered = REPLAY_DATA.result_order
      .map((id) => byId.get(id))
      .filter(Boolean);
    const seen = new Set(REPLAY_DATA.result_order);
    STATE.runners.forEach((r) => {
      if (!seen.has(r.id)) ordered.push(r);
    });
    if (ordered.length) return ordered;
    // Fall through to the sim only if the result payload didn't
    // map to any known runner — defensive.
  }

  const rest = STATE.runners.filter((r) => r.id !== winner.id);
  const sorted = rest.sort((a, b) =>
    (b.weight + Math.random() * 20) - (a.weight + Math.random() * 20)
  );
  return [winner, ...sorted];
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

function finalLengthsFor(runner, rank) {
  if (REPLAY_DATA && REPLAY_DATA.has_distances) {
    const raw = (REPLAY_DATA.lengths_behind_winner || {})[runner.id];
    if (raw !== undefined && raw !== null) {
      return Math.min(MAX_VISIBLE_LENGTHS, Math.max(0, Number(raw) || 0));
    }
  }
  // Forecast, or a replay with no parsed distances: invent a plausible
  // fan-out. Sprints finish tighter than stayers.
  const per = STATE.raceBand === 'sprint' ? 0.85
            : STATE.raceBand === 'mile'   ? 1.15
            :                               1.45;
  return rank === 0 ? 0
       : Math.min(MAX_VISIBLE_LENGTHS, rank * per + Math.random() * per);
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

  // Shuffle lane assignment so the field does not read as a staircase
  // sorted by finishing position.
  const lanes = Array.from({ length: count }, (_, i) => i);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }

  const HORSE = SHARED.horse || {};

  horses = positions.map((r, rank) => {
    // Surge windows — 3-5 moments where a horse quickens or drops away.
    // Magnitudes are now in LENGTHS, so a surge is a move you can see
    // and the leaderboard can react to.
    const surges = [];
    const surgeCount = (HORSE.minSurges || 2) + 1 +
                       Math.floor(Math.random() * ((HORSE.maxExtraSurges || 2) + 1));
    for (let s = 0; s < surgeCount; s++) {
      const sr = HORSE.surgeStartRange    || [0.05, 0.85];
      const dr = HORSE.surgeDurationRange || [0.04, 0.12];
      const br = HORSE.surgeBoostRange    || [0.5, 1.5];
      const sign = Math.random() < 0.32 ? -1 : 1;
      surges.push({
        start:    sr[0] + Math.random() * (sr[1] - sr[0]),
        duration: dr[0] + Math.random() * (dr[1] - dr[0]),
        lengths:  sign * (br[0] + Math.random() * (br[1] - br[0])) * 2.4,
      });
    }
    if (rank === 0 && HORSE.winnerFinalSurge) {
      const w = HORSE.winnerFinalSurge;
      surges.push({ start: w.start, duration: w.duration, lengths: w.boost * 2.0 });
    }

    return {
      runner:        r,
      finalLengths:  finalLengthsFor(r, rank),
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
      bobPhase:      Math.random() * Math.PI * 2,
      legPhase:      Math.random() * Math.PI * 2,
      bobRate:       0.88 + Math.random() * 0.26,
      bobAmp:        0.75 + Math.random() * 0.50,
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

// Lane geometry is pure presentation, so it rebuilds on resize without
// touching the race model. Lanes are laid out in DEPTH: lane 0 runs
// against the far rail (higher on screen, drawn smaller), the last lane
// runs nearest the camera. That one trick is most of why the field
// reads as a three-dimensional pack instead of a row of icons.
function relayoutLanes() {
  if (!horses.length) return;
  const n    = horses.length;
  const band = WORLD.trackBotY - WORLD.trackTopY;
  horses.forEach((h) => {
    const t = n > 1 ? (h.laneIdx + 0.5) / n : 0.5;
    h.laneT = t;
    h.y     = WORLD.trackTopY + t * band;
    h.depth = 0.78 + t * 0.38;
  });
}

// Deficit smoothing time-constant. We smooth the DEFICIT rather than
// the absolute position: a lagged absolute position would leave every
// runner — the winner included — short of the line at the finish,
// whereas the deficit is slow-moving and settles exactly on its target.
const DEFICIT_TAU_MS = 320;

function updateRaceModel(dt) {
  const p = DIRECTOR.progress;

  // Where the front of the race is, in lengths.
  const leaderTravel = p * WORLD.spanLengths;

  // Fan-out: 5% of the final spread at the gate, 100% at the line.
  const fan = (0.05 + 0.95 * smoothstep(0, 1, p)) * WORLD.spreadScale;

  // Early-pace distortion decays away by the three-quarter mark, so
  // whatever shape the pace took, the result still lands exactly.
  const paceWeight = 1 - smoothstep(0.10, 0.78, p);

  // Surges taper to nothing over the last 8% so neither the finishing
  // order nor the real margins are ever falsified by a bell curve.
  const surgeWeight = 1 - smoothstep(0.92, 1, p);

  const k = 1 - Math.exp(-dt / DEFICIT_TAU_MS);

  horses.forEach((h) => {
    let surge = 0;
    for (let i = 0; i < h.surges.length; i++) {
      const s = h.surges[i];
      if (p >= s.start && p <= s.start + s.duration) {
        surge += s.lengths * Math.sin(((p - s.start) / s.duration) * Math.PI);
      }
    }

    const target = Math.max(
      0,
      h.finalLengths * fan + h.paceBias * paceWeight - surge * surgeWeight
    );

    h.deficit += (target - h.deficit) * k;
    h.travel   = Math.max(0, leaderTravel - h.deficit);

    h.lastWorldX = h.worldX;
    h.worldX     = h.travel * WORLD.lengthPx;

    // Instantaneous ground speed, lightly smoothed — the gait cycle and
    // the hoof dust both key off it, so a spiky value would flicker.
    const inst = dt > 0 ? (h.worldX - h.lastWorldX) / dt : 0;
    h.speed += (inst - h.speed) * 0.2;

    // Galloping micro-motion. Stride rate follows ground speed so the
    // legs stay in sync with the travel, slow motion included.
    const strideRate = 0.010 + Math.min(0.030, h.speed * 0.020);
    h.bobPhase  += dt * strideRate * 0.62 * h.bobRate;
    h.legPhase  += dt * strideRate * h.bobRate;
    h.swayPhase += dt * 0.0032 * h.bobRate;
  });

  // The order is now stale by definition — every position just moved.
  _rankedCacheAt = -1;
}

// After a seek the model and the camera are both many seconds behind
// where the clock now is. Left alone the exponential smoothing would
// spend a second visibly sliding everything into place; snapping is
// both correct and invisible.
function snapRaceState() {
  updateRaceModel(100000);
  // Zoom first: the focus clamp that keeps the leader in frame is
  // computed against the zoom, so a stale one puts the leader outside
  // the very frame it is supposed to guarantee.
  CAM.zoom = DIRECTOR.zoom;
  CAM.x    = principalGroupFocus() + viewW * 0.05 * DIRECTOR.progress;
}

let _rankedCache = [];
let _rankedCacheAt = -1;
function rankedHorses() {
  // Ranking is wanted several times a frame; sorting 24 runners more
  // than once per frame is pure waste.
  if (_rankedCacheAt === frameClock) return _rankedCache;
  _rankedCache   = horses.slice().sort((a, b) => b.travel - a.travel);
  _rankedCacheAt = frameClock;
  return _rankedCache;
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

function buildMasterTimeline() {
  const T         = BAND.timings || {};
  const durationS = (T.raceDurationMs || 46000) / 1000;

  const tl = gsap.timeline({
    paused: true,
    onUpdate:   () => syncRacePhase(DIRECTOR.progress),
    onComplete: crossTheLine,
  });

  // Race progress is linear in timeline time, which keeps every label
  // below expressible as a plain progress fraction.
  tl.to(DIRECTOR, { progress: 1, duration: durationS, ease: 'none' }, 0);
  RACE_PHASES.forEach((ph) => tl.addLabel(ph.key, durationS * ph.from));

  // ── CRUISE ── wide, level, unhurried. The whole field is legible and
  //    the camera keeps the principal group left of centre so there is
  //    track ahead of them rather than behind.
  tl.to(DIRECTOR, {
    zoom: 1.05, anchorX: 0.50, groupBias: 0.12, vignette: 0.12,
    shake: SHAKE * 0.2, camY: 0, fieldFade: 0,
    duration: durationS * 0.45, ease: 'sine.inOut',
  }, 'cruise');

  // ── BUILD ── the camera starts taking a side. Framing tightens onto
  //    the front half of the field and the ground moves faster past it.
  tl.to(DIRECTOR, {
    zoom: 1.20, anchorX: 0.46, groupBias: 0.45, vignette: 0.18,
    shake: SHAKE * 0.6, camY: 4, fieldFade: 0.10,
    duration: durationS * 0.27, ease: 'sine.inOut',
  }, 'build');

  // ── DRIVE ── down onto the principal group. Back markers recede, the
  //    camera drops and starts to breathe with the gallop.
  tl.to(DIRECTOR, {
    zoom: 1.44, anchorX: 0.41, groupBias: 0.78, vignette: 0.26,
    shake: SHAKE * 1.3, camY: 9, tilt: 0.004, fieldFade: 0.34,
    duration: durationS * 0.18, ease: 'power2.in',
  }, 'drive');

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

// ── The final furlong ───────────────────────────────────────────
// A dedicated sequence, not simply more of the same but faster. The
// camera drops to the rail and closes down onto the two or three
// runners that can still win it, the world goes into slow motion, and
// the winning post finally comes into shot from the right — it has been
// out beyond the frame edge for the whole race until now.
function addFinalFurlongSequence(tl, durationS) {
  const seg = durationS * (1 - RACE_PHASES[3].from);

  tl.to(DIRECTOR, {
    zoom: 1.72, anchorX: 0.36, groupBias: 1, vignette: 0.34,
    shake: SHAKE * 2.4, camY: 14, tilt: 0.009, fieldFade: 0.55,
    duration: seg * 0.75, ease: 'power2.in',
  }, 'line');

  tl.call(() => {
    setPhaseTitle('THE FINAL FURLONG');
    const screen = document.getElementById('screen-race');
    if (screen) screen.classList.add('is-final-furlong');
  }, null, 'line');

  // Slow motion. We slow the CLOCK, not the horses, so commentary,
  // leaderboard and gait all stretch together. The ramp is tweened from
  // a call() so the tween driving timeScale is not itself being scaled
  // by the value it is changing.
  if (!prefersReducedMotion) {
    const slowTo = (BAND.timings && BAND.timings.slowMoFactor) || 0.55;
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

function principalGroupFocus() {
  const ranked = rankedHorses();
  if (!ranked.length) return 0;
  // The principal group is the front 40% of the field, floored at four
  // runners and capped at ten — beyond that the tail drags the centroid
  // backwards and the leaders creep off the right of frame.
  const size = Math.min(ranked.length,
                        Math.min(10, Math.max(4, Math.round(ranked.length * 0.4))));
  let sum = 0;
  for (let i = 0; i < size; i++) sum += ranked[i].worldX;
  const centroid = sum / size;
  let focus = centroid + (ranked[0].worldX - centroid) * DIRECTOR.groupBias;

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
  const target = principalGroupFocus() + viewW * 0.05 * DIRECTOR.progress;

  const k = 1 - Math.exp(-dt / CAM_FOLLOW_TAU_MS);
  CAM.x    += (target - CAM.x) * k;
  CAM.zoom += (DIRECTOR.zoom - CAM.zoom) * k;

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

function worldToScreenX(wx) {
  return (wx - CAM.x) * CAM.zoom + viewW * DIRECTOR.anchorX + CAM.shakeX;
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
//  PARALLAX — SEVEN DEPTH PLANES
// ════════════════════════════════════════════════════════════════
// The horses barely move on screen. What moves is the world, and the
// difference in rate between these planes is what sells the speed.
//
//   0.00  sky + sun haze                     backdrop canvas
//   0.06  distant downland                   backdrop canvas
//   0.17  grandstand + crowd                 backdrop canvas
//   0.34  treeline / hedge                   backdrop canvas
//   0.68  far running rail + ad boards       race canvas
//   1.00  the turf the race is run on        race canvas
//   1.32  foreground grass, in front         race canvas
//
// The three repeating mid-planes are pre-painted into offscreen tiles
// once per resize and blitted after that. Repainting a grandstand from
// paths every frame is the kind of thing that quietly costs 4ms.
const PARALLAX = { hills: 0.06, stand: 0.17, trees: 0.34, farRail: 0.68, fore: 1.32 };

const TILES = { hills: null, stand: null, trees: null, turf: null, railCrowd: null };

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

function buildBackdropTiles() {
  const hillH  = Math.max(60,  viewH * 0.14);
  const standH = Math.max(80,  viewH * 0.20);
  const treeH  = Math.max(30,  viewH * 0.058);

  // ── Distant downland ──
  TILES.hills = makeTile(760, hillH, (g, w, h) => {
    g.fillStyle = 'rgba(122,150,172,0.55)';
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(0, h * 0.55);
    for (let x = 0; x <= w; x += 40) {
      g.lineTo(x, h * (0.42 + 0.20 * Math.sin(x * 0.0091) + 0.08 * Math.sin(x * 0.031)));
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  });

  // ── Grandstand + crowd ──
  // The crowd is the thing that makes a racecourse look like a
  // racecourse. V1 scattered 340 grey 2px dots and it read as noise on
  // a wall. Here they sit in rows on a raked terrace, each a head and a
  // pair of shoulders, densest at the rail and thinning toward the back
  // — which is both how a stand fills up and what makes it read as
  // people rather than texture.
  TILES.stand = makeTile(540, standH, (g, w, h) => {
    const roofY = h * 0.13;
    const deckY = h * 0.36;

    // Roof, with a lit leading edge
    g.fillStyle = 'rgba(64,80,104,0.96)';
    g.beginPath();
    g.moveTo(4, roofY + 14);
    g.lineTo(w * 0.5, roofY - 8);
    g.lineTo(w - 4, roofY + 14);
    g.lineTo(w - 4, roofY + 26);
    g.lineTo(4, roofY + 26);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(248,244,232,0.34)';
    g.fillRect(4, roofY + 24, w - 8, 2.5);

    // Terrace, shaded under the roof and lighter toward the front
    const terrace = g.createLinearGradient(0, roofY + 26, 0, h);
    terrace.addColorStop(0, 'rgba(38,48,66,0.98)');
    terrace.addColorStop(1, 'rgba(78,92,114,0.98)');
    g.fillStyle = terrace;
    g.fillRect(4, roofY + 26, w - 8, h - roofY - 26);

    // Step lines, so the rake reads
    g.strokeStyle = 'rgba(16,22,34,0.30)';
    g.lineWidth = 1;
    const rows = 9;
    for (let r = 0; r < rows; r++) {
      const ry = deckY + (h - deckY - 4) * (r / rows);
      g.beginPath();
      g.moveTo(6, ry);
      g.lineTo(w - 6, ry);
      g.stroke();
    }

    // The crowd itself
    const SKIN = ['#d8ae86', '#b9855c', '#8a5c3a', '#e8c8a6', '#6b4526'];
    const TOPS = ['#c8d2e0', '#8f9bb0', '#5f6b80', '#a8b6c8', '#d6dae2',
                  '#7b6355', '#9c8570', '#b34b3f', '#3f5f7a', '#d4af37'];
    for (let r = 0; r < rows; r++) {
      const ry   = deckY + (h - deckY - 6) * (r / rows) + 3;
      // Front rows are nearer, so bigger, and packed tighter.
      const size = 2.9 - (r / rows) * 1.1;
      const step = size * 2.5;
      // Back rows thin out; a stand is never uniformly full.
      const fill = 0.94 - (r / rows) * 0.34;
      for (let cx = 8; cx < w - 8; cx += step) {
        if (Math.random() > fill) continue;
        const jx = cx + (Math.random() - 0.5) * size;
        const jy = ry + (Math.random() - 0.5) * 1.4;
        // Shoulders
        g.fillStyle = TOPS[(Math.random() * TOPS.length) | 0];
        g.beginPath();
        g.ellipse(jx, jy + size * 0.95, size * 0.95, size * 0.8, 0, Math.PI, 0);
        g.fill();
        // Head
        g.fillStyle = SKIN[(Math.random() * SKIN.length) | 0];
        g.beginPath();
        g.arc(jx, jy, size * 0.55, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Roof supports, drawn over the crowd so they sit in front
    g.fillStyle = 'rgba(26,34,50,0.5)';
    for (let x = 46; x < w - 24; x += 104) g.fillRect(x, roofY + 26, 3.5, h - roofY - 26);
  });

  // ── Treeline / hedge ──
  TILES.trees = makeTile(430, treeH, (g, w, h) => {
    g.fillStyle = 'rgba(48,84,58,0.95)';
    for (let i = 0; i < 16; i++) {
      const cx = (i / 16) * w + (i % 3) * 9;
      const r  = h * (0.34 + ((i * 37) % 11) / 24);
      g.beginPath();
      g.ellipse(cx, h - r * 0.35, r * 0.9, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(34,64,44,1)';
    g.fillRect(0, h - h * 0.28, w, h * 0.28);
  });

  // ── Rail-side spectators ──
  // People standing AT the rail, in among the running rail posts. The
  // grandstand alone reads as scenery on the horizon; this is the row
  // that puts a crowd close enough to the action to matter, and it
  // scrolls at the far-rail rate rather than the horizon rate.
  TILES.railCrowd = makeTile(300, 34, (g, w, h) => {
    const SKIN = ['#d8ae86', '#b9855c', '#8a5c3a', '#e8c8a6'];
    const COATS = ['#2f3d52', '#4a5568', '#6b3f36', '#8a9099', '#243244',
                   '#7a6a52', '#a8452f', '#d4af37', '#c8cdd6'];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const cx = 6 + (i / n) * (w - 12) + (Math.random() - 0.5) * 6;
      const base = h - 2 - Math.random() * 1.5;
      const tall = 13 + Math.random() * 4;
      // Body
      g.fillStyle = COATS[(Math.random() * COATS.length) | 0];
      g.beginPath();
      g.moveTo(cx - 2.4, base);
      g.lineTo(cx - 1.9, base - tall * 0.62);
      g.lineTo(cx + 1.9, base - tall * 0.62);
      g.lineTo(cx + 2.4, base);
      g.closePath();
      g.fill();
      // Head
      g.fillStyle = SKIN[(Math.random() * SKIN.length) | 0];
      g.beginPath();
      g.arc(cx, base - tall * 0.62 - 2.1, 2.0, 0, Math.PI * 2);
      g.fill();
      // A few have an arm up
      if (Math.random() < 0.18) {
        g.strokeStyle = g.fillStyle;
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(cx + 1.6, base - tall * 0.55);
        g.lineTo(cx + 3.4, base - tall * 0.9);
        g.stroke();
      }
    }
  });

  // ── Turf tile for the track plane ──
  // Mown stripes plus a grain of divot marks. Tiled in WORLD px, so it
  // scrolls at exactly the rate the horses travel.
  const turfW = 320;
  const turfH = Math.max(40, Math.round(viewH * 0.60));
  TILES.turf = makeTile(turfW, turfH, (g, w, h) => {
    g.fillStyle = COL.trackTurf || '#2d5e3a';
    g.fillRect(0, 0, w, h);
    // Mower stripes, alternating light and dark down the straight.
    g.fillStyle = 'rgba(255,255,255,0.055)';
    g.fillRect(0, 0, w / 2, h);
    // Grain
    for (let i = 0; i < 160; i++) {
      g.fillStyle = Math.random() > 0.5
        ? 'rgba(226,244,206,0.05)' : 'rgba(0,0,0,0.05)';
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1.5);
    }
  });
}

// Tiles are laid out in SCREEN space, scaled by the camera zoom so a
// backdrop plane magnifies with everything else, and offset by
// CAM.x × factor × zoom so its scroll rate stays in proportion to the
// turf no matter how tight the framing gets.
function drawTiled(c, tile, bottomY, factor, alpha) {
  if (!tile) return;
  const s = CAM.zoom;
  const w = tile.w * s;
  const h = tile.h * s;
  const offsetPx = CAM.x * factor * s;
  c.save();
  c.globalAlpha = alpha;
  let x = -(((offsetPx % w) + w) % w);
  for (; x < viewW + w; x += w) c.drawImage(tile.canvas, x, bottomY - h, w, h);
  c.restore();
}

// The backdrop lives on #particleCanvas, which sits behind the race
// canvas in the stacking order. Keeping it on its own surface means the
// track plane can clear and redraw without touching the sky.
function drawBackdrop() {
  pCtx.clearRect(0, 0, viewW, viewH);

  const horizon = worldToScreenY(WORLD.horizonY);

  // Sky — a daylight gradient that only deepens at the very top of
  // frame. The band the viewer actually looks at, just above the
  // grandstand roofline, stays bright.
  const warm = DIRECTOR.progress;
  const skyBottom = Math.max(horizon + viewH * 0.10, viewH * 0.30);
  const sky = pCtx.createLinearGradient(0, 0, 0, skyBottom);
  sky.addColorStop(0,    '#4d88bd');
  sky.addColorStop(0.42, COL.skyTop    || '#7eb8e8');
  sky.addColorStop(0.72, '#a9cbe6');
  sky.addColorStop(0.90, '#d8dcd2');
  sky.addColorStop(1,    COL.skyBottom || '#c9a66a');
  pCtx.fillStyle = sky;
  pCtx.fillRect(0, 0, viewW, skyBottom + 2);

  // Low sun haze sitting just above the horizon.
  const haze = pCtx.createRadialGradient(
    viewW * 0.72, horizon - viewH * 0.06, 0,
    viewW * 0.72, horizon - viewH * 0.06, viewW * 0.42
  );
  haze.addColorStop(0, 'rgba(255,240,205,' + (0.34 + warm * 0.16).toFixed(3) + ')');
  haze.addColorStop(1, 'rgba(255,232,180,0)');
  pCtx.fillStyle = haze;
  pCtx.fillRect(0, 0, viewW, horizon + viewH * 0.10);

  // Each plane sits ON the horizon and scrolls at its own rate. The
  // treeline overlaps it slightly so there is no seam where the turf
  // starts.
  drawTiled(pCtx, TILES.hills, horizon + 6,  PARALLAX.hills, 0.85);
  drawTiled(pCtx, TILES.stand, horizon + 2, PARALLAX.stand, 0.97);
  drawTiled(pCtx, TILES.trees, horizon + Math.max(14, viewH * 0.045),
            PARALLAX.trees, 1);
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

  // Advertising board band in front of them. Deliberately low contrast —
  // it is scenery at depth, not a headline.
  ctx.fillStyle = 'rgba(28,40,56,0.62)';
  ctx.fillRect(from - step, y - 22, to - from + step * 2, 13);
  ctx.fillStyle = 'rgba(212,175,55,0.10)';
  for (let x = from; x < to; x += step * 4) {
    ctx.fillRect(x, y - 22, step * 1.7, 13);
  }

  // Running rail
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(from - step, y - 6);
  ctx.lineTo(to, y - 6);
  ctx.stroke();

  ctx.fillStyle = 'rgba(240,244,250,0.38)';
  for (let x = from; x < to; x += step) ctx.fillRect(x, y - 6, 1.6, 7);
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
    ctx.fillStyle = COL.trackTurf || '#2d5e3a';
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
  const every = WORLD.spanPx * (TRK.furlongPoleEvery || 0.125);
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
    ctx.roundRect(x - 11, y - 58, 22, 18, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,239,222,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(245,239,222,0.92)';
    ctx.font = 'bold 11px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(left), x, y - 45);
  }
}

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

  // Painted line across the turf
  ctx.save();
  for (let y = top - 6; y < bot + 26; y += 9) {
    ctx.fillStyle = (Math.floor(y / 9) % 2 === 0) ? 'rgba(255,255,255,0.92)'
                                                  : 'rgba(14,18,26,0.92)';
    ctx.fillRect(x - 2, y, 4, 9);
  }

  // Post + gold finial on the far side
  ctx.fillStyle   = '#f5efde';
  ctx.strokeStyle = 'rgba(11,14,21,0.85)';
  ctx.lineWidth   = 1.2;
  ctx.beginPath();
  ctx.rect(x - 3, top - 92, 6, 92);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COL.gold || '#D4AF37';
  ctx.beginPath();
  ctx.arc(x, top - 96, 5, 0, Math.PI * 2);
  ctx.fill();

  // Gantry banner
  ctx.fillStyle   = 'rgba(11,14,21,0.94)';
  ctx.strokeStyle = COL.gold || '#D4AF37';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 58, top - 128, 116, 24, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COL.gold || '#D4AF37';
  ctx.font = 'bold 13px "DM Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('THE LINE', x, top - 111);
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

  ctx.strokeStyle = 'rgba(18,44,28,0.85)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  let x = -(((off % tw) + tw) % tw);
  for (; x < viewW + tw; x += tw) {
    for (let i = 0; i < 5; i++) {
      const gx = x + i * 34;
      const gh = 14 + ((i * 53) % 17);
      ctx.beginPath();
      ctx.moveTo(gx, viewH);
      ctx.quadraticCurveTo(gx + 5, yTop + gh * 0.4, gx + 12, yTop);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Screen-space vignette + the flash at the line. Both are director
// values, so they ramp with the phases rather than being switched on.
function drawAtmosphere() {
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
  if (DIRECTOR.flash > 0.005) {
    ctx.fillStyle = 'rgba(255,252,240,' + (DIRECTOR.flash * 0.85).toFixed(3) + ')';
    ctx.fillRect(0, 0, viewW, viewH);
  }
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
function _parseBeatenDistance(s) {
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
function _formatBeatenDistance(lengths) {
  if (lengths === null || lengths === undefined) return '';
  if (lengths >= 50) return 'A DISTANCE';
  if (lengths < 0.08) return 'A NOSE';
  if (lengths < 0.12) return 'A SHORT HEAD';
  if (lengths < 0.20) return 'A HEAD';
  if (lengths < 0.40) return 'A NECK';
  if (lengths < 0.65) return 'HALF A LENGTH';
  if (lengths < 0.90) return 'THREE-QUARTERS OF A LENGTH';
  if (lengths < 1.10) return 'A LENGTH';
  // Round to nearest quarter for the headline.
  const q = Math.round(lengths * 4) / 4;
  const whole = Math.floor(q);
  const frac  = q - whole;
  const fracStr = frac === 0.25 ? '¼' : frac === 0.5 ? '½' :
                  frac === 0.75 ? '¾' : '';
  const num = whole + fracStr;
  return num + (q === 1 ? ' LENGTH' : ' LENGTHS');
}


// Compact beaten-distance formatter — sized for chips + podium rows
// where the full "HALF A LENGTH" would overflow. Mirrors the Racing
// Post abbreviated style: nse / shd / hd / nk / ½L / ¾L / 1¼L etc.
function _formatBeatenDistanceCompact(lengths) {
  if (lengths === null || lengths === undefined) return '';
  if (lengths === -1) return 'DH';
  if (lengths >= 50) return 'dist';
  if (lengths < 0.08) return 'nse';
  if (lengths < 0.12) return 'shd';
  if (lengths < 0.20) return 'hd';
  if (lengths < 0.40) return 'nk';
  if (lengths < 0.65) return '½L';
  if (lengths < 0.90) return '¾L';
  if (lengths < 1.10) return '1L';
  const q = Math.round(lengths * 4) / 4;
  const whole = Math.floor(q);
  const frac  = q - whole;
  const fracStr = frac === 0.25 ? '¼' : frac === 0.5 ? '½' :
                  frac === 0.75 ? '¾' : '';
  return whole + fracStr + 'L';
}


// Compute the winning margin at the finish.
// Returns { lengths, source, winners } where:
//   lengths     — numeric lengths (winner over 2nd), -1 for dead heat
//   source      — 'result' | 'forecast' — drives copy + chip styling
//   winners     — array of horse names — usually [winner] or [dh1, dh2]
function _computeWinningMargin() {
  const ranked = rankedHorses();
  if (ranked.length < 1) return null;
  const winnerName = ranked[0].runner.name;

  // ── Result mode — read from the Racing API beaten_distances ──
  if (REPLAY_DATA && REPLAY_DATA.has_result) {
    const dists = REPLAY_DATA.beaten_distances || {};
    // Find the dead-heat case first — 2nd-placed runner's gap is 'DH'.
    if (ranked.length >= 2) {
      const secondGap = _parseBeatenDistance(dists[ranked[1].runner.id]);
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
  // ~28px per length is calibrated against the existing track scale.
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

// Coat tones — one hardcoded brown for every runner. The jockey silks
// are what tell them apart, exactly as they do on a real racecourse.
const HORSE_COAT       = '#3a2510';
const HORSE_COAT_SHADE = '#1f1408';

function drawField() {
  const vis    = visibleWorldRange(140);
  const ranked = rankedHorses();
  const leader = ranked[0];

  // Far lanes first so nearer horses occlude them.
  const drawList = horses
    .filter((h) => h.worldX >= vis.min && h.worldX <= vis.max)
    .sort((a, b) => a.laneT - b.laneT);

  // The principal group stays fully lit; the tail recedes as the
  // director closes the frame down. Nobody is removed — a horse coming
  // through from the back still reads.
  const groupSize = Math.min(ranked.length, Math.max(4, Math.round(ranked.length * 0.4)));
  const inGroup = new Set();
  for (let i = 0; i < groupSize; i++) inGroup.add(ranked[i].runner.id);

  drawList.forEach((h) => {
    const isUser = STATE.userPick && STATE.userPick.id === h.runner.id;
    const isFox  = STATE.foxPick  && STATE.foxPick.name === h.runner.name;

    ctx.save();
    if (!inGroup.has(h.runner.id) && DIRECTOR.fieldFade > 0) {
      ctx.globalAlpha = 1 - DIRECTOR.fieldFade * 0.72;
    }

    // Restrained identification. A thin arc of the runner's own silk
    // colour on the turf beneath them, and only while the broadcast
    // lower-third is naming them — it fades with idGlow. The viewer's
    // pick and the Fox pick get a permanent but very quiet version of
    // the same mark: no text, no box, no glow around the animal.
    const markAlpha = Math.max(h.idGlow, (isUser || isFox) ? 0.5 : 0);
    if (markAlpha > 0.01) {
      drawGroundMarker(h, markAlpha, isUser ? (COL.userLabel || '#D4AF37')
                                   : isFox  ? (COL.foxLabel  || '#E8A050')
                                   :          (h.runner.silk || '#f5efde'));
    }

    drawHorseSilhouette(h.worldX, h.y, h, WORLD.horseScale * h.depth);
    ctx.restore();
  });
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

function _spawnHoofDust(wx, y, h, cyc, artScale) {
  if (prefersReducedMotion) return;
  if (particles.length > MAX_PARTICLES) return;
  if (h.speed < 0.02) return;

  const STRIKES = [0.00, 0.20, 0.40];
  const prevCyc = h.lastDustCycle == null ? cyc : h.lastDustCycle;
  h.lastDustCycle = cyc;

  for (const strike of STRIKES) {
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
  const step = Math.max(0.5, Math.min(2.5, dt / 16.67));
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
let _bcastEl = null;
let _bcastTween = null;

function broadcastEl() {
  if (_bcastEl && _bcastEl.isConnected) return _bcastEl;
  const screen = document.getElementById('screen-race');
  if (!screen) return null;
  const el = document.createElement('div');
  el.className = 'bcast-id';
  el.id = 'broadcastId';
  el.setAttribute('aria-live', 'polite');
  screen.appendChild(el);
  _bcastEl = el;
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
    const pick = STATE.userPick && horses.find((x) => x.runner.id === STATE.userPick.id);
    const fox  = STATE.foxPick  && horses.find((x) => x.runner.name === STATE.foxPick.name);
    if (pick)      { h = pick; label = label || 'YOUR PICK'; }
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
      '<span class="bcast-id__name">' + h.runner.name + '</span>' +
      '<span class="bcast-id__meta">' + h.runner.jockey + ' &middot; ' + h.runner.odds + '</span>' +
    '</span>' +
    '<span class="bcast-id__tag">' + tag + '</span>';

  if (_bcastTween) _bcastTween.kill();
  const tl = gsap.timeline();
  tl.fromTo(el, { opacity: 0, x: -26 },
                { opacity: 1, x: 0, duration: 0.42, ease: 'power3.out' });
  tl.to(el, { opacity: 0, x: -14, duration: 0.34, ease: 'power2.in' },
        '+=' + (BROADCAST_ID_MS / 1000));
  _bcastTween = tl;

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
  if (_bcastTween) { _bcastTween.kill(); _bcastTween = null; }
  if (_bcastEl) { _bcastEl.innerHTML = ''; gsap.set(_bcastEl, { opacity: 0 }); }
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

  const dt = Math.min(gsap.ticker.deltaRatio() * 16.667, 50);
  frameClock += dt;

  updateRaceModel(dt);
  updateCamera(dt);

  drawBackdrop();

  ctx.clearRect(0, 0, viewW, viewH);
  pushWorldTransform(ctx);
  drawTurf();
  drawFarRail();
  drawFurlongMarkers();
  drawWinningPost();
  drawHoofDust(dt);
  drawField();
  ctx.restore();

  drawForegroundPlane();
  drawAtmosphere();

  // DOM overlays — cheap, and each throttles itself.
  const p = DIRECTOR.progress;
  fireCommentary(p);
  updateCommentary(dt);
  updateLeaderboard(dt);
  updateRacePhaseTitle(p);
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
// A thoroughbred in profile at full gallop, drawn from paths. No sprite
// sheet: a production race can field 24 runners with silks we have
// never rendered before, so the whole animal is procedural and takes
// its colours from the payload.
//
// PROPORTIONS matter more than detail here, and they are what the first
// pass got wrong. A thoroughbred is leggy and shallow through the body:
// the legs are about as long as the barrel is deep, the girth is deep
// but narrow, and there is a pronounced tuck-up at the flank. Draw it
// with a round belly and short legs and you get a pony, however good
// the shading is. The local grid used below:
//
//        y = -30  ── top of the jockey's cap
//        y = -14  ── withers / topline
//        y =  +2  ── belly (tucked up)
//        y = +28  ── ground line
//        x = -40  ── tip of the streaming tail
//        x = +48  ── muzzle
//
// so the animal is roughly 74 units nose to tail, which is what makes
// HORSE_ART_LENGTH the definition of a "length" everywhere else.
//
// The build, front to back:
//   • Coat        — a real field is not 24 identical brown horses. Each
//                   runner gets a bay / dark bay / chestnut / liver
//                   chestnut / black / grey, picked deterministically
//                   from the runner id so the same horse looks the same
//                   on every replay. Bays and blacks get black points
//                   (mane, tail, lower legs); everyone gets a lighter
//                   underline where the light bounces off the turf.
//   • Legs        — articulated forearm / cannon / hoof, with the
//                   off-side pair drawn first in a darker tone so the
//                   near pair reads in front of them.
//   • Number cloth— the saddle cloth carries the runner's number, the
//                   way it does on a real racecourse. This is the quiet
//                   identification the brief asked for: it travels with
//                   the horse and needs no floating chip.
//   • Jockey      — a crouched rider whose silks are the runner's ACTUAL
//                   silk pattern (hooped / striped / halved / quartered
//                   / starred / solid), clipped to the torso so it
//                   matches the racecard, the leaderboard cap and the
//                   podium.
//
// Motion is the 4-beat transverse gallop from V1, kept because it is
// correct, plus V2's body roll and a stride rate that follows ground
// speed.

// Coat palettes: body / shade (muscle shadow) / points (mane, tail,
// lower legs) / belly (lit underline).
const HORSE_COATS = [
  { name: 'bay',            body: '#7a4a1e', shade: '#54300f', points: '#1a1008', belly: '#9c6330' },
  { name: 'dark bay',       body: '#553219', shade: '#37200c', points: '#140c06', belly: '#71491f' },
  { name: 'chestnut',       body: '#9c5423', shade: '#6f3a14', points: '#8a4718', belly: '#bd7038' },
  { name: 'liver chestnut', body: '#68361a', shade: '#46230f', points: '#552a12', belly: '#875028' },
  { name: 'black',          body: '#33271d', shade: '#1d1611', points: '#0d0a07', belly: '#493829' },
  { name: 'grey',           body: '#a9a39e', shade: '#7d7671', points: '#5a534e', belly: '#c6c0bb' },
];

// Deterministic per-runner coat. Same horse, same colour, every replay.
function coatFor(runner) {
  const id = String((runner && runner.id) || (runner && runner.name) || '');
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  // Weighted the way a real field looks: mostly bay and chestnut, with
  // the grey and the black as the two that catch your eye.
  const WEIGHTS = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5];
  return HORSE_COATS[WEIGHTS[hash % WEIGHTS.length]];
}

// One leg: shoulder/hip -> knee/hock -> hoof. The upper segment is
// drawn heavier than the cannon so the limb tapers like a real one.
function drawLeg(c, ox, oy, kx, ky, fx, fy, colour, w) {
  c.strokeStyle = colour;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = w * 2.0;
  c.beginPath();
  c.moveTo(ox, oy);
  c.lineTo(kx, ky);
  c.stroke();
  c.lineWidth = w * 0.85;
  c.beginPath();
  c.moveTo(kx, ky);
  c.lineTo(fx, fy);
  c.stroke();
  c.fillStyle = '#16120e';
  c.beginPath();
  c.ellipse(fx, fy + 0.4, w * 1.0, w * 0.7, 0, 0, Math.PI * 2);
  c.fill();
}

function drawHorseSilhouette(x, y, h, artScale) {
  const scale = artScale || 1;

  // ── 4-beat transverse gallop ────────────────────────────────
  //   off-hind   0.00  strikes first
  //   lead-hind  0.20  strikes with the off-fore (the diagonal pair)
  //   off-fore   0.20
  //   lead-fore  0.40  strikes alone
  //   0.60-1.00        suspension, all four off the ground
  const cyc = (h.legPhase / (Math.PI * 2)) % 1;
  const lift = (offset) => {
    const pos = ((cyc - offset) + 1) % 1;
    if (pos < 0.4) return 0;
    if (pos < 0.7) return -Math.sin((pos - 0.4) / 0.3 * Math.PI) * 10;
    return -Math.sin((1 - pos) / 0.3 * Math.PI) * 10;
  };
  const reach = (offset) => Math.cos(((cyc - offset) + 1) % 1 * Math.PI * 2) * 7;

  const OFF_HIND = 0.00, LEAD_HIND = 0.20, OFF_FORE = 0.20, LEAD_FORE = 0.40;

  const suspension = (cyc > 0.60 && cyc < 1.00)
    ? Math.sin((cyc - 0.60) / 0.40 * Math.PI) : 0;
  const bodyLift = -suspension * 2.8;

  const progressNow    = DIRECTOR.progress;
  const inFinalStretch = progressNow >= 0.85;
  const inSlowMo       = progressNow >= 0.88;

  const coat  = h.coat || (h.coat = coatFor(h.runner));
  const silk  = h.runner.silk  || COL.silkDefault;
  const silk2 = h.runner.silk2 || COL.silk2Default;
  const pat   = h.runner.silk_pattern || 'solid';

  _spawnHoofDust(x, y, h, cyc, scale);

  // Body roll and the suspension rise. A couple of degrees, a couple of
  // pixels — invisible as an effect, very visible by its absence.
  const roll = Math.sin(h.swayPhase) * 0.015 + Math.sin(h.legPhase) * 0.008;
  const detail = scale >= 0.72;

  ctx.save();
  ctx.translate(x, y + bodyLift * scale);
  ctx.rotate(roll);
  ctx.scale(scale, scale);

  // ── Ground shadow (tightens as the horse leaves the ground) ──
  ctx.fillStyle = 'rgba(0,0,0,' + (0.28 - suspension * 0.16).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(0, 28 - bodyLift, 26 - suspension * 6, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Off-side legs ───────────────────────────────────────────
  // Drawn first and darker, so the near pair reads in front of them.
  // That one trick is most of what gives the animal depth.
  ctx.globalAlpha = 0.7;
  drawLeg(ctx, -12, -6,
          -21 + reach(OFF_HIND) * 0.35, 9 + lift(OFF_HIND) * 0.35,
          -13 + reach(OFF_HIND),        28 + lift(OFF_HIND),
          coat.points, 1.55);
  drawLeg(ctx, 16, -5,
          18 + reach(OFF_FORE) * 0.5, 11 + lift(OFF_FORE) * 0.4,
          19 + reach(OFF_FORE),       28 + lift(OFF_FORE),
          coat.points, 1.55);
  ctx.globalAlpha = 1;

  // ── Tail ────────────────────────────────────────────────────
  // Streaming straight back off the dock, level with the topline, not
  // hanging. Drawn before the body so it comes out from behind.
  const tailSway = Math.sin(h.bobPhase * 1.15) * 1.8;
  ctx.strokeStyle = coat.points;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(-19, -10);
  ctx.bezierCurveTo(-26, -9 + tailSway, -32, -5 + tailSway * 0.7,
                    -37, 2 + tailSway * 0.4);
  ctx.stroke();
  ctx.lineWidth = 0.85;
  for (let i = 0; detail && i < 4; i++) {
    const sp = -1 + i * 1.1;
    ctx.beginPath();
    ctx.moveTo(-19.5, -10 + sp * 0.25);
    ctx.quadraticCurveTo(-28 - i * 0.7, -6 + sp + tailSway * 0.6,
                         -36 - i * 1.1, 3 + sp * 1.2 + tailSway * 0.3);
    ctx.stroke();
  }

  // ── Barrel ──────────────────────────────────────────────────
  // Deep at the girth, shallow and tucked up at the flank, well muscled
  // over the quarters. Shallower and longer than it looks like it should
  // be — that is what makes it a racehorse rather than a cob.
  ctx.fillStyle = coat.body;
  ctx.beginPath();
  ctx.moveTo(-20, -9);                                 // dock
  ctx.bezierCurveTo(-21, -14, -14, -16, -4, -15);      // croup
  ctx.bezierCurveTo(6, -15, 13, -15, 18, -13);         // back to withers
  ctx.bezierCurveTo(22, -12, 24, -8, 23, -4);          // point of shoulder
  ctx.bezierCurveTo(22, 0, 18, 3, 13, 3);              // girth
  ctx.bezierCurveTo(7, 4, 1, 3, -3, 1);                // belly, tucked up
  ctx.bezierCurveTo(-10, -1, -16, -3, -19, -5);        // flank -> stifle
  ctx.closePath();
  ctx.fill();

  // Lit topline
  ctx.fillStyle = 'rgba(255,255,255,0.11)';
  ctx.beginPath();
  ctx.moveTo(-15, -13);
  ctx.bezierCurveTo(-6, -16, 8, -16, 18, -13);
  ctx.bezierCurveTo(8, -14, -6, -14, -15, -13);
  ctx.closePath();
  ctx.fill();

  // Lighter underline
  ctx.fillStyle = coat.belly;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(-3, 1);
  ctx.bezierCurveTo(4, 4, 10, 4, 15, 2);
  ctx.bezierCurveTo(9, 6, 1, 5, -3, 1);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Quarters and shoulder — the two big muscle masses
  ctx.fillStyle = coat.shade;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(-13, -8, 6.5, 6, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(18, -7, 4.2, 5.5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // ── Neck and head ───────────────────────
  // The neck is long and TAPERS — deep where it leaves the withers,
  // narrow at the throat — and the head is a long wedge carried out in
  // front of it. Two mistakes in the earlier passes are worth not
  // repeating: filling the head in the shade colour and running the
  // mane over the poll both turn the whole top of the animal into one
  // dark mass, and a horse without a readable head does not read as a
  // horse at all.
  ctx.fillStyle = coat.body;
  ctx.beginPath();
  ctx.moveTo(11, -13);                                  // withers
  ctx.bezierCurveTo(20, -20, 30, -26, 39, -29);         // crest
  ctx.bezierCurveTo(41, -29.5, 42, -27.5, 41, -26);     // poll
  ctx.bezierCurveTo(34, -22, 27, -15, 23, -6);          // throat
  ctx.bezierCurveTo(18, -7, 13, -9, 11, -13);           // chest
  ctx.closePath();
  ctx.fill();

  // Head — a long wedge, same coat as the neck so it reads as one
  // animal, separated by a jawline rather than by a colour change.
  ctx.beginPath();
  ctx.moveTo(39.5, -29.5);                              // poll
  ctx.bezierCurveTo(45, -30, 50, -28.5, 53, -25.5);     // forehead
  ctx.bezierCurveTo(55, -23.5, 55, -21.5, 52.5, -20.8); // nose
  ctx.bezierCurveTo(48, -19.8, 43, -21.5, 40, -24.5);   // muzzle -> jaw
  ctx.closePath();
  ctx.fill();

  if (detail) {
    // Jawline: the shadow under the cheek that separates head from neck.
    ctx.strokeStyle = coat.shade;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(40.4, -28.4);
    ctx.quadraticCurveTo(41.6, -24.6, 45, -22.4);
    ctx.stroke();

    // Cheekbone highlight, so the head has a plane instead of reading flat
    ctx.fillStyle = coat.belly;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(46, -25.6, 4.2, 2.4, -0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Ears — coat coloured with a dark inner, at the poll
  ctx.fillStyle = coat.body;
  ctx.beginPath();
  ctx.moveTo(38.8, -29.2); ctx.lineTo(38.4, -33.4); ctx.lineTo(40.8, -29.6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(41.2, -29.4); ctx.lineTo(42.4, -33); ctx.lineTo(43.6, -28.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = coat.points;
  ctx.beginPath();
  ctx.moveTo(39.2, -29.6); ctx.lineTo(39.0, -32); ctx.lineTo(40.1, -29.8);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = '#0b0906';
  ctx.beginPath();
  ctx.ellipse(44.6, -27, 1.05, 0.85, 0.15, 0, Math.PI * 2);
  ctx.fill();
  if (detail) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(44.9, -27.3, 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  // Muzzle, nostril, and an open mouth under maximum effort
  ctx.fillStyle = coat.name === 'grey' ? '#6a625d' : '#2a1a10';
  ctx.beginPath();
  ctx.ellipse(52.6, -22.4, 2.1, 1.7, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0806';
  ctx.beginPath();
  ctx.ellipse(52.2, -23.8, 0.62, 0.44, 0.35, 0, Math.PI * 2);
  ctx.fill();
  if (inSlowMo) {
    ctx.fillStyle = '#2e0d0d';
    ctx.beginPath();
    ctx.ellipse(51.6, -21, 1.5, 0.85, 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Mane ───────────────────────────────
  // Short strokes streaming off the crest, stopping short of the poll
  // so they never cover the head.
  ctx.strokeStyle = coat.points;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  const manePulse = Math.sin(h.bobPhase * 1.5) * 1.4;
  const maneN = detail ? 9 : 5;
  for (let i = 0; i < maneN; i++) {
    const t  = i / (maneN - 1);
    const bx = 36 - t * 23;
    const by = -27.5 + t * 13;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx - 3.5, by - 1.2 + manePulse * 0.25,
                         bx - 6.5, by + 1.4 + manePulse * (0.3 + t * 0.5));
    ctx.stroke();
  }

  // Bridle — cheekpiece and a rein running back to the hands
  if (detail) {
    ctx.strokeStyle = 'rgba(18,13,9,0.8)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(47.4, -28.6);
    ctx.lineTo(50.4, -22.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(50.2, -23);
    ctx.quadraticCurveTo(37, -19.5, 26, -13);
    ctx.stroke();
  }

  // ── Saddle cloth ────────────────────────────────────────────
  // Small, cream rather than white, sitting under the saddle on the
  // upper flank — the identification that travels with the horse.
  const num = h.runner.number;
  if (num != null) {
    ctx.fillStyle = 'rgba(232,226,212,0.92)';
    ctx.beginPath();
    ctx.moveTo(-1.5, -13.2);
    ctx.lineTo(6, -13.6);
    ctx.lineTo(6.8, -6.2);
    ctx.lineTo(-2.4, -5.8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,26,20,0.22)';
    ctx.lineWidth = 0.35;
    ctx.stroke();
    ctx.fillStyle = '#1b2028';
    ctx.font = '700 6.4px "DM Sans", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 2.2, -9.6);
    ctx.textBaseline = 'alphabetic';
  }

  // ── Near-side legs ──────────────────────────────────────────
  drawLeg(ctx, -13, -7,
          -22 + reach(LEAD_HIND) * 0.4, 9 + lift(LEAD_HIND) * 0.4,
          -14 + reach(LEAD_HIND),       28 + lift(LEAD_HIND),
          coat.points, 1.8);
  drawLeg(ctx, 18, -6,
          20 + reach(LEAD_FORE) * 0.55, 11 + lift(LEAD_FORE) * 0.45,
          21 + reach(LEAD_FORE),        28 + lift(LEAD_FORE),
          coat.points, 1.8);

  // ── Jockey ──────────────────────────────────────────────────
  // Up out of the saddle, weight over the withers, backside high, head
  // low between the hands.
  const torso = new Path2D();
  torso.moveTo(-3, -16);
  torso.bezierCurveTo(-1, -24, 8, -28, 15, -25);
  torso.bezierCurveTo(18, -23.5, 17.5, -20, 13.5, -18.5);
  torso.bezierCurveTo(7, -16.5, 1, -15.5, -3, -16);
  torso.closePath();

  ctx.fillStyle = silk;
  ctx.fill(torso);

  // The runner's real silk pattern, clipped to the jockey's back so it
  // matches the racecard, the leaderboard cap and the podium.
  ctx.save();
  ctx.clip(torso);
  ctx.fillStyle = silk2;
  if (pat === 'hooped') {
    for (let i = -29; i < -14; i += 3.6) ctx.fillRect(-6, i, 28, 1.8);
  } else if (pat === 'striped') {
    for (let i = -3; i < 18; i += 4.5) ctx.fillRect(i, -30, 1.8, 18);
  } else if (pat === 'halved') {
    ctx.fillRect(6, -30, 16, 18);
  } else if (pat === 'quartered') {
    ctx.fillRect(6, -30, 16, 7);
    ctx.fillRect(-6, -21, 12, 9);
  } else if (pat === 'starred') {
    ctx.font = '700 8px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('★', 7, -20);
  }
  ctx.restore();

  // Bent leg in the short stirrup — the detail that makes the crouch
  // read as a jockey rather than a jacket on a horse.
  ctx.strokeStyle = '#efeadf';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(3, -17);
  ctx.lineTo(1.5, -11.5);
  ctx.lineTo(6.5, -9.5);
  ctx.stroke();
  ctx.fillStyle = '#15100a';
  ctx.beginPath();
  ctx.ellipse(7.8, -9.2, 2.5, 1.4, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // Arms reaching down the neck to the reins
  ctx.strokeStyle = silk;
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.moveTo(12.5, -21);
  ctx.quadraticCurveTo(19, -19, 24.5, -14.5);
  ctx.stroke();

  // Cap in the secondary silk colour, peak in the primary
  ctx.fillStyle = silk2;
  ctx.beginPath();
  ctx.arc(16, -27, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = silk;
  ctx.beginPath();
  ctx.moveTo(17.6, -28.6);
  ctx.lineTo(22, -27.2);
  ctx.lineTo(17.8, -25.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(14.8, -28.2, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // Goggles
  if (detail) {
    ctx.fillStyle = 'rgba(228,235,244,0.85)';
    ctx.beginPath();
    ctx.ellipse(19, -25.6, 1.5, 1.05, -0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Whip, raised through the final furlong ──────────────────
  if (inFinalStretch) {
    const t = Math.min(1, (progressNow - 0.85) / 0.10);
    const ang = -Math.PI / 2 + (1 - t) * 0.55;
    const bx = 9, by = -24, len = 10;
    ctx.strokeStyle = '#0e0a05';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(ang) * len, by + Math.sin(ang) * len);
    ctx.stroke();
  }

  ctx.restore();
}
// ─── Commentary ─────────────────────────────────────────────────
function fireCommentary(progress) {
  (BAND.commentary || []).forEach((c) => {
    if (!firedCommentary.has(c.at) && progress >= c.at) {
      firedCommentary.add(c.at);
      setCommentaryText(_renderCommentary(c.text));
    }
  });
}

// Substitute {LEADER} / {USER} / {FOX} placeholders with current race
// state. Mirror of the same helper in experience.js.
function _renderCommentary(template) {
  if (!template || template.indexOf('{') === -1) return template;
  const liveLeader = rankedHorses()[0] || null;
  const leaderName = liveLeader ? liveLeader.runner.name : '';
  const userName   = (STATE.userPick && STATE.userPick.name) || '';
  const foxName    = (STATE.foxPick  && STATE.foxPick.name)  || '';
  return template
    .replace(/,?\s*\{USER\}/g, userName ? ', ' + userName : '')
    .replace(/,?\s*\{FOX\}/g,  foxName  ? ', ' + foxName  : '')
    .replace(/\{LEADER\}/g,    leaderName || 'the leader')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*\./g, '.');
}

// Phase-strip update — mirror of experience.js, scoped to flat-race
// containers. Lazy-builds the dot strip once + flips state classes
// each frame as progress crosses phase thresholds.
function updatePhaseStrip(progress, phaseTable, activePhase) {
  let strip = document.getElementById('phaseStrip');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'phaseStrip';
    strip.className = 'race-phase-strip';
    strip.innerHTML = phaseTable.map((p, i) =>
      '<span class="race-phase-strip__dot" data-phase="' + i + '" ' +
            'title="' + p.label + '"></span>' +
      (i < phaseTable.length - 1
        ? '<span class="race-phase-strip__rail" data-rail="' + i + '"></span>'
        : '')
    ).join('');
    const raceScreen = document.getElementById('screen-race');
    if (raceScreen) raceScreen.appendChild(strip);
  }
  const activeIdx = phaseTable.indexOf(activePhase);
  phaseTable.forEach((p, i) => {
    const dot = strip.querySelector('[data-phase="' + i + '"]');
    if (!dot) return;
    dot.classList.toggle('is-past',    i <  activeIdx);
    dot.classList.toggle('is-current', i === activeIdx);
    dot.classList.toggle('is-future',  i >  activeIdx);
  });
  for (let i = 0; i < phaseTable.length - 1; i++) {
    const rail = strip.querySelector('[data-rail="' + i + '"]');
    if (!rail) continue;
    const from = phaseTable[i].from;
    const to   = phaseTable[i + 1].from;
    const span = Math.max(0.001, to - from);
    const fill = Math.max(0, Math.min(1, (progress - from) / span));
    rail.style.setProperty('--fill', (fill * 100).toFixed(1) + '%');
  }
}

function setCommentaryText(text) {
  currentCommentary = text;
  commentaryTimer = (BAND.timings && BAND.timings.commentaryHoldMs) || 3000;
  const el = document.getElementById('racingCommentary');
  if (!el) return;
  gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
  el.textContent = text;
}

function updateCommentary(dt) {
  commentaryTimer = Math.max(0, commentaryTimer - dt);
  if (commentaryTimer <= 0) {
    const el = document.getElementById('racingCommentary');
    if (el && parseFloat(el.style.opacity) > 0) gsap.to(el, { opacity: 0, duration: 0.4 });
  }
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

// Mini jockey-cap SVG — duplicated from experience.js until Phase 3
// hoists shared helpers. Renders a two-tone cap using the runner's
// silk colours + silk_pattern so each row's cap matches its jersey.
let _lbCapCounter = 0;
function renderCapSvg(runner) {
  const body   = (runner && runner.silk)  || '#1A3A6B';
  const accent = (runner && runner.silk2) || '#FFFFFF';
  const pat    = (runner && runner.silk_pattern) || 'solid';
  const id = 'lbCap-' + (++_lbCapCounter);
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

// Leaderboard layout constants — see experience.js for the rationale.
// Rows persist with stable data-runner IDs; updateLeaderboard slides
// them between Y positions via transform. CSS handles the transition.
const LB_VISIBLE_ROWS = 8;
function _lbRowHeightPx() {
  const v = getComputedStyle(document.querySelector('.race-leaderboard') ||
                             document.body)
    .getPropertyValue('--lb-row-h').trim();
  const n = parseInt(v, 10);
  return n > 0 ? n : 26;
}

function buildLeaderboard() {
  const c = document.getElementById('raceLeaderboard');
  if (!c) return;
  c.innerHTML = '';

  // Win-probability bars — derived from the SAME sim_weight() the
  // forecast engine uses to pick the outcome. Normalised across the
  // field so they sum to 100%. Honest pre-race signal: these are what
  // the model thinks NOW, not animated "fake convergence" during the
  // race. The position number flips live during play; the bar stays
  // fixed — that's the contract with the viewer.
  //
  // parseFloat() defends against the runner-payload serialiser
  // emitting weight as a numeric string in some shapes — without it,
  // (string || 0) keeps the string and arithmetic collapses to NaN,
  // making every probability render as the same low number (~5%).
  const horseWeight = (h) => parseFloat(h.runner.weight) || 0;
  const totalWeight = horses.reduce((s, h) => s + horseWeight(h), 0) || 1;
  // Find the field maximum so the bar fill is normalised to the front
  // runner's probability instead of 100% — most realistic. The favourite
  // bar reaches ~95%, everyone else proportional. Cleaner read than
  // showing 35% on the favourite as a tiny stub.
  const maxProb = Math.max(...horses.map(h => horseWeight(h) / totalWeight));

  horses.forEach(h => {
    const r = h.runner;
    const isUser = STATE.userPick && STATE.userPick.id === r.id;
    const isFox  = STATE.foxPick  && STATE.foxPick.name === r.name;
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
        '<span class="race-lb-name' + (isUser ? ' user-horse' : isFox ? ' fox-horse' : '') + '">' + r.name + '</span>' +
        '<span class="race-lb-prob" title="AI win probability">' +
          '<span class="race-lb-prob__bar">' +
            '<span class="race-lb-prob__fill" style="width:' + barWidth + '%"></span>' +
          '</span>' +
          '<span class="race-lb-prob__pct">' + probPct + '%</span>' +
        '</span>' +
      '</span>';
    c.appendChild(row);
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
let   _lbSampleTimer = 0;

function updateLeaderboard(dt) {
  const c = document.getElementById('raceLeaderboard');
  if (!c) return;

  _lbSampleTimer -= dt;
  if (_lbSampleTimer > 0) return;
  _lbSampleTimer = LB_SAMPLE_MS;

  // V1 slid this panel to the left edge halfway through the race so it
  // would not cover the finish line, which in V1 was pinned near the
  // right edge of the viewport for the whole race. In V2 the line is in
  // world space and arrives at the camera anchor — left of centre — so
  // the old shift moves the panel INTO the finish rather than out of
  // it. The panel now stays where it starts.

  const rowH   = _lbRowHeightPx();
  const ranked = rankedHorses();

  ranked.forEach((h, rank) => {
    if (h.lbRank === rank) return;          // nothing moved — leave it alone

    const row = c.querySelector('[data-runner="' + h.runner.id + '"]');
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
//   2. A held shot. The horses stop, the camera does not — it keeps
//      drifting in on the winner for the better part of a second with
//      nothing on screen but the result of the race. This pause is the
//      whole point of the sequence; take it out and the finish reads
//      as an animation ending rather than a race being won.
//   3. The result card, sized to the actual margin.
//   4. Out to the roll call.
//
// Like everything else in the race, it is one GSAP timeline.
const FINISH_PAUSE_S = 0.85;   // silence between the line and the card
const RESULT_HOLD_S  = 2.30;

function crossTheLine() {
  const margin = _computeWinningMargin();
  STATE.finishMargin = margin;
  setPhaseTitle('PAST THE POST');
  clearBroadcastId();

  finishTL = gsap.timeline({ onComplete: () => raceFinish(margin) });

  // 1 — the flash
  finishTL.to(DIRECTOR, { flash: 1, duration: 0.06, ease: 'none' }, 0);
  finishTL.to(DIRECTOR, { flash: 0, duration: 0.55, ease: 'power2.out' }, 0.06);

  // 2 — the held shot. Slow, continuous, and completely uneventful.
  const drift = prefersReducedMotion ? 0 : 1;
  finishTL.to(DIRECTOR, {
    zoom:     DIRECTOR.zoom + 0.24 * drift,
    camY:     DIRECTOR.camY + 9 * drift,
    tilt:     DIRECTOR.tilt + 0.004 * drift,
    vignette: 0.46,
    duration: 2.6, ease: 'sine.out',
  }, 0);

  // 3 — the result card
  finishTL.call(() => showResultCard(margin), null, FINISH_PAUSE_S);
  finishTL.call(() => hideResultCard(), null, FINISH_PAUSE_S + RESULT_HOLD_S);
  finishTL.to({}, { duration: FINISH_PAUSE_S + RESULT_HOLD_S + 0.5 }, 0);
}

// ── Result card ─────────────────────────────────────────────────
// A DOM lower-third rather than canvas text: it stays sharp at every
// pixel ratio, reflows on a phone without a font-size table, and the
// entry animation is a GSAP timeline like everything else. Created
// from JS so index.html and the Django template are untouched.
let _resultEl = null;

function resultCardEl() {
  if (_resultEl && _resultEl.isConnected) return _resultEl;
  const screen = document.getElementById('screen-race');
  if (!screen) return null;
  const el = document.createElement('div');
  el.className = 'race-result';
  el.id = 'raceResult';
  screen.appendChild(el);
  _resultEl = el;
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
            : (lengths != null ? 'Won by ' + _formatBeatenDistance(lengths).toLowerCase()
                               : 'Won on the line');

  el.innerHTML =
    '<span class="race-result__eyebrow">' + eyebrow + '</span>' +
    '<span class="race-result__name">' + headline + '</span>' +
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
  if (!_resultEl) return;
  gsap.to(_resultEl, {
    opacity: 0, y: -10, duration: 0.4, ease: 'power2.in',
    onComplete: () => { if (_resultEl) _resultEl.style.display = 'none'; },
  });
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
// experience.js — Phase 3 will hoist into a shared module. Reuses
// experience.css styling so jumps + flat look identical here.
const ROLLCALL_HOLD = {
  back:   750,
  third:  1400,
  second: 1600,
  first:  2500,
};
const ROLLCALL_FADE_MS = 220;
let rollCallSkipped = false;

window.skipRollCall = function () {
  rollCallSkipped = true;
};

function _rollCallHoldFor(rank) {
  if (rank === 1) return ROLLCALL_HOLD.first;
  if (rank === 2) return ROLLCALL_HOLD.second;
  if (rank === 3) return ROLLCALL_HOLD.third;
  return ROLLCALL_HOLD.back;
}

function _rollCallPositionLabel(rank, total) {
  if (rank === total) return 'LAST PLACE';
  return rank + (rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th') + ' PLACE';
}

function _buildRollCallCard(horse, rank, total) {
  const isWinner = rank === 1;
  const medalCls = rank === 1 ? 'rollcall-medallion--1st'
                 : rank === 2 ? 'rollcall-medallion--2nd'
                 : rank === 3 ? 'rollcall-medallion--3rd' : '';
  let distHtml = '';
  if (!isWinner && REPLAY_DATA && REPLAY_DATA.has_result) {
    const raw = (REPLAY_DATA.beaten_distances || {})[horse.id];
    if (raw) distHtml = '<div class="rollcall-distance">+' + raw + '</div>';
  }
  const cardCls = isWinner ? 'rollcall-card rollcall-card--winner' : 'rollcall-card';
  return (
    '<div class="' + cardCls + '">' +
      '<div class="rollcall-medallion ' + medalCls + '">' + rank + '</div>' +
      '<div class="rollcall-position-label">' + _rollCallPositionLabel(rank, total) + '</div>' +
      '<div class="parade-silk">' + renderSilkSvg(horse) + '</div>' +
      '<div class="rollcall-name">' + horse.name + '</div>' +
      '<div class="rollcall-connections">' +
        '<strong>J:</strong> ' + horse.jockey + ' &nbsp;·&nbsp; ' +
        '<strong>T:</strong> ' + horse.trainer +
      '</div>' +
      distHtml +
    '</div>'
  );
}

function _buildRollCallProgress(total, currentDoneCount) {
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
        { opacity: 1, duration: 0.5, onComplete: () => _rollCallStep(positions, winner, 0) }
      );
    },
  });
}

function _rollCallStep(positions, winner, idx) {
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
  if (stage)      stage.innerHTML      = _buildRollCallCard(horse, rank, total);
  if (progressEl) progressEl.innerHTML = _buildRollCallProgress(total, idx + 1);

  gsap.fromTo('.rollcall-card',
    { opacity: 0, y: 24, scale: 0.97 },
    { opacity: 1, y: 0, scale: 1,
      duration: ROLLCALL_FADE_MS / 1000, ease: 'power2.out' }
  );

  const hold = _rollCallHoldFor(rank);
  setTimeout(() => {
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
      onComplete: () => _rollCallStep(positions, winner, idx + 1),
    });
  }, hold);
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
  const isUserWin = STATE.userPick && STATE.userPick.id === winner.id;
  const revBg = document.getElementById('revealBg');
  if (revBg) {
    revBg.style.background = isUserWin
      ? 'radial-gradient(ellipse 100% 100% at 50% 50%, rgba(212,175,55,0.12), transparent 65%)'
      : 'radial-gradient(ellipse 100% 100% at 50% 50%, rgba(45,94,58,0.10), transparent 65%)';
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

  const podium = document.getElementById('revealPodium');
  if (podium) {
    // Replay mode: format the raw beaten-distance into compact racing
    // copy ("½L", "1¼L", "hd", "nse") rather than the raw "+.5" string.
    // Skipped on forecast routes (no real result yet).
    const distances = (REPLAY_DATA && REPLAY_DATA.has_result)
      ? REPLAY_DATA.beaten_distances : null;
    const MEDALS = ['🥇', '🥈', '🥉'];
    const POS_LABELS = ['1st', '2nd', '3rd'];
    podium.innerHTML = positions.slice(0, 3).map((r, i) => {
      // Compact beaten-distance copy for the podium chip. ALWAYS emits
      // a span (empty for 1st) so the CSS grid columns line up across
      // all three rows — without this placeholder, auto-placement put
      // the winner's odds in column 5 instead of column 6, making the
      // 1st-row right edge shorter than the others.
      let gapInner = '';
      if (distances && i > 0) {
        const lengths = _parseBeatenDistance(distances[r.id]);
        gapInner = _formatBeatenDistanceCompact(lengths) || '';
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
          '<span class="reveal-podium__pos">' + POS_LABELS[i] + '</span>' +
          silkHtml +
          '<span class="reveal-podium__name">' + r.name + '</span>' +
          gapHtml +
          '<span class="reveal-podium__odds">' + r.odds + '</span>' +
        '</div>'
      );
    }).join('');
  }

  const verdictBox = document.getElementById('revealVerdictBox');
  const verdictTitle = document.getElementById('revealVerdictTitle');
  const verdictText  = document.getElementById('revealVerdictText');
  if (verdictTitle && verdictText && verdictBox) {
    if (isUserWin) {
      verdictTitle.textContent = '🐾 Your pick wins!';
      verdictText.textContent  = 'You called it. Trust the read.';
    } else if (STATE.userPick) {
      const userFinishIdx = positions.findIndex((r) => r.id === STATE.userPick.id);
      verdictTitle.textContent = '🐾 Your pick: ' + STATE.userPick.name;
      verdictText.textContent  = userFinishIdx >= 0
        ? 'Finished ' + (userFinishIdx + 1) + (userFinishIdx === 0 ? 'st' : userFinishIdx === 1 ? 'nd' : userFinishIdx === 2 ? 'rd' : 'th')
        : 'Finished out of frame.';
    } else {
      verdictTitle.textContent = 'No pick on record';
      verdictText.textContent  = 'Make a pick on the racecard before next Saturday.';
    }
  }
}

function animateReveal() {
  const tl = gsap.timeline();
  tl.to('.reveal-kicker',          { opacity: 1, y: 0, duration: 0.4 });
  tl.to('.reveal-winner-label',    { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
  tl.to('#revealTrophyWrap',       { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.4)' }, '-=0.15');
  tl.to('#revealHorseName',        { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
  tl.to('#revealOdds',             { opacity: 1, duration: 0.3 }, '-=0.1');
  tl.to('#revealVerdictBox',       { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
  tl.to('#revealPodium',           { opacity: 1, y: 0, duration: 0.4 }, '-=0.1');
  tl.to('.reveal-actions',         { opacity: 1, duration: 0.4 }, '-=0.1');
}

// ─── Replay ────────────────────────────────────────────────────
window.replayExperience = function () {
  // User is going back to the intro — restore the archive picker.
  document.body.classList.remove('cinematic-experience-running');
  // Re-arm the Skip-to-Finish pill for the next run.
  const skipWrap = document.querySelector('.race-skip-wrap');
  if (skipWrap) skipWrap.classList.remove('race-skip-hidden');
  // Reset roll-call state — a fresh run gets a fresh walk.
  rollCallSkipped = false;
  const rcStage = document.getElementById('rollcallStage');
  if (rcStage) rcStage.innerHTML = '';
  const rcProgress = document.getElementById('rollcallProgress');
  if (rcProgress) rcProgress.innerHTML = '';

  // ── Race engine ──
  // Kill the timelines first: they write into DIRECTOR every tick, so
  // resetting the director while one is still alive gets overwritten
  // on the very next frame.
  if (masterTL) { masterTL.kill(); masterTL = null; }
  if (finishTL) { finishTL.kill(); finishTL = null; }
  gsap.killTweensOf(DIRECTOR);
  horses.forEach((h) => gsap.killTweensOf(h));
  stopTicker();

  raceRunning = false;
  particles   = [];
  horses      = [];
  frameClock  = 0;
  lastPhaseTitle = '';
  firedCommentary.clear();
  _lbSampleTimer = 0;
  _rankedCache   = [];
  _rankedCacheAt = -1;
  STATE.finishMargin = null;

  Object.assign(DIRECTOR, {
    progress: 0, zoom: 1, anchorX: 0.50, camY: 0, tilt: 0, shake: 0,
    vignette: 0.10, groupBias: 0.12, fieldFade: 0, flash: 0, reveal: 0,
    phase: 'cruise',
  });
  CAM.x = 0; CAM.zoom = 1; CAM.shakeX = 0; CAM.shakeY = 0;

  pCtx.clearRect(0, 0, viewW, viewH);
  ctx.clearRect(0, 0, viewW, viewH);

  // Race-screen overlays
  const raceScreen = document.getElementById('screen-race');
  if (raceScreen) {
    raceScreen.classList.remove('is-final-furlong');
    delete raceScreen.dataset.racePhase;
  }
  clearBroadcastId();
  if (_resultEl) { _resultEl.style.display = 'none'; gsap.set(_resultEl, { opacity: 0 }); }
  const strip = document.getElementById('phaseStrip');
  if (strip) strip.remove();

  const stalls = document.getElementById('flatStalls');
  if (stalls) stalls.classList.remove('is-opening', 'is-hidden');
  const photo = document.getElementById('flatPhotoFinish');
  if (photo) photo.classList.remove('is-active');

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

  showScreen('intro');
};

// First layout. Deliberately the last statement in the module: resize()
// populates the parallax tile cache, and `const TILES` is declared far
// below this point in source order.
resize();
