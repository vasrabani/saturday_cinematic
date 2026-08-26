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

let viewW = 0, viewH = 0;

function getNavH() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
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
}
window.addEventListener('resize', resize);
resize();

// ─── Race state ─────────────────────────────────────────────────
let horses = [];
let raceRunning = false;
let raceTime = 0;
let raceDuration = 0;
let animFrame = null;
let lastTimestamp = null;
// End-rush: see experience.js for rationale. Once the leader is at
// the line, override slow-mo and compress remaining time to ~600ms
// so the cinematic doesn't dangle for the back of the field.
let raceTimeAccel = 1;
const LEADER_NEAR_LINE = 0.94;
const END_RUSH_BUDGET_MS = 600;
let particles = [];
let firedCommentary = new Set();
let currentCommentary = '';
let commentaryTimer = 0;
let photoFinishFired = false;

// Camera state for closeup. Smoothly lerps toward target so the zoom
// ramps in instead of snapping. cameraZoom = 1 means full viewport.
let cameraZoom = 1, cameraX = 0, cameraY = 0;
let cameraTargetZoom = 1, cameraTargetX = 0, cameraTargetY = 0;

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

// Skip-to-Finish — see experience.js for the rationale. Bumps the
// master clock so only ~10s of race remain; raceLoop + photo-finish
// + reveal all keep working unchanged. Idempotent via Math.max.
const SKIP_TO_FINISH_REMAINING_MS = 10000;
window.skipToFinish = function () {
  if (!raceRunning || raceDuration <= 0) return;
  raceTime = Math.max(raceTime, raceDuration - SKIP_TO_FINISH_REMAINING_MS);
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

  raceDuration  = (BAND.timings && BAND.timings.raceDurationMs) || 46000;
  raceTime      = 0;
  raceRunning   = true;
  raceTimeAccel = 1;
  lastTimestamp = null;
  firedCommentary.clear();
  photoFinishFired = false;

  buildLeaderboard();
  setPhaseTitle((BAND.phases && BAND.phases.raceStart) || "AND THEY'RE AWAY");

  animFrame = requestAnimationFrame(raceLoop);
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

// Real-distance baseLag override — flat.js' spread is expressed
// as a "lag" (fraction of progress to subtract per rank). The
// replay variant returns the cumulative-lengths gap as a
// trackWidth fraction. 4px floor for photo finishes; null when
// no parsed-distance data is available (caller falls through).
// See experience.js for the parallel implementation.
const REPLAY_MAX_TRACK_SPREAD = 0.18;
const REPLAY_MIN_GAP_PX = 4;
function replayBaseLag(horse, trackWidthPx) {
  if (!REPLAY_DATA || !REPLAY_DATA.has_distances) return null;
  const map = REPLAY_DATA.lengths_behind_winner;
  const lengths = map && map[horse.runner.id];
  if (lengths === undefined) return null;
  if (lengths <= 0) return 0;
  const max = REPLAY_DATA.max_lengths_behind || 1;
  const gapFraction = (lengths / max) * REPLAY_MAX_TRACK_SPREAD;
  const minGap = trackWidthPx > 0
    ? REPLAY_MIN_GAP_PX / trackWidthPx
    : 0.005;
  return Math.max(gapFraction, minGap);
}

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

function buildHorseObjects(positions) {
  const trackTop    = viewH * (TRK.laneTopRatio    || 0.24);
  const trackBottom = viewH * (TRK.laneBottomRatio || 0.78);
  const count       = positions.length;
  const laneH       = (trackBottom - trackTop) / count;
  const HORSE       = SHARED.horse;

  // Random lane assignment so the visual field is mixed at the start —
  // not a perfect diagonal staircase by final position. The lane is
  // purely visual; race progress is independent.
  const lanes = Array.from({ length: count }, (_, i) => i);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }

  horses = positions.map((r, i) => {
    const finalPos = i;
    const lane = lanes[i];

    // Tight gate jitter — every horse breaks essentially level. Spread
    // emerges from the race dynamics, not from a stagger at the start.
    const startX = viewW * (TRK.startX || 0.05) + (Math.random() - 0.5) * 4;

    // Surge timeline: 3–5 windows during the race where a horse boosts
    // OR fades. Negative boosts model stumbles / tactical drops back —
    // they let other horses overtake them on screen.
    const surges = [];
    const surgeCount = (HORSE.minSurges || 2) + 1 +
                       Math.floor(Math.random() * ((HORSE.maxExtraSurges || 2) + 1));
    for (let s = 0; s < surgeCount; s++) {
      const sr = HORSE.surgeStartRange    || [0.05, 0.85];
      const dr = HORSE.surgeDurationRange || [0.04, 0.12];
      const br = HORSE.surgeBoostRange    || [0.5, 1.5];
      // Bias to allow ~30% of surges to be fades (negative).
      const sign = Math.random() < 0.30 ? -1 : 1;
      surges.push({
        start:    sr[0] + Math.random() * (sr[1] - sr[0]),
        duration: dr[0] + Math.random() * (dr[1] - dr[0]),
        boost:    sign * (br[0] + Math.random() * (br[1] - br[0])),
      });
    }
    if (finalPos === 0 && HORSE.winnerFinalSurge) {
      surges.push(HORSE.winnerFinalSurge);
    }

    // Per-horse gait variance — reviewer feedback (Phase 2):
    //   "even a 5-10px variance would make it feel much more natural"
    //
    // Without per-horse variance, every horse bobs at the same rate
    // and amplitude → 16 silhouettes moving in lockstep = a brown
    // blob. With these three random offsets each horse has its own
    // gait identity:
    //   • bobRate:  speed of the up-down body bob (0.85-1.15× base)
    //   • bobAmp:   amplitude of the bob (0.7-1.3× base of 2px)
    //   • laneNudge: small per-horse y-offset (±3px) so adjacent-lane
    //                horses don't sit at perfectly aligned y values.
    //                Subtle but enough to break the grid-stack look.
    const bobRate  = 0.85 + Math.random() * 0.30;   // 0.85-1.15
    const bobAmp   = 0.70 + Math.random() * 0.60;   // 0.70-1.30
    const laneNudge = (Math.random() - 0.5) * 6;     // ±3px

    return {
      runner:       r,
      x:            startX,
      y:            trackTop + laneH * lane + laneH * 0.5 + laneNudge,
      laneIdx:      lane,
      finalPos,
      progress:     0,
      surges,
      bobPhase:     Math.random() * Math.PI * 2,
      legPhase:     Math.random() * Math.PI * 2,
      bobRate:      bobRate,
      bobAmp:       bobAmp,
      lastX:        startX,
    };
  });
}

function raceLoop(ts) {
  if (!raceRunning) return;
  if (!lastTimestamp) lastTimestamp = ts;

  let rawDt = Math.min(ts - lastTimestamp, 50);
  lastTimestamp = ts;

  // Slow-motion final furlong — config-driven. We slow time, not motion,
  // so commentary + leaderboard cadence stretch alongside the race.
  const T = BAND.timings || {};
  const slowFrom = T.slowMoStartProgress || 0.88;
  const slowFactor = T.slowMoFactor || 0.55;
  const progressPre = Math.min(raceTime / raceDuration, 1);

  // End-rush: once the leader is at the line, override slow-mo and
  // compress remaining time so the cinematic doesn't dangle for the
  // back of the field. Set ONCE per race.
  if (raceTimeAccel === 1 && horses[0] && horses[0].progress >= LEADER_NEAR_LINE) {
    const remainingMs = raceDuration - raceTime;
    if (remainingMs > END_RUSH_BUDGET_MS) {
      raceTimeAccel = remainingMs / END_RUSH_BUDGET_MS;
    }
  }

  let dt;
  if (raceTimeAccel > 1) {
    // End-rush overrides slow-mo — wrap up the climax cleanly.
    dt = rawDt * raceTimeAccel;
  } else if (progressPre >= slowFrom) {
    dt = rawDt * slowFactor;
  } else {
    dt = rawDt;
  }
  raceTime += dt;
  const progress = Math.min(raceTime / raceDuration, 1);

  ctx.clearRect(0, 0, viewW, viewH);
  drawSky(progress);

  // Identify top 4 by current progress so the camera can frame them and
  // the rest of the field can fade back during the closeup.
  const sortedByProgress = horses.slice().sort((a, b) => b.progress - a.progress);
  const top4 = sortedByProgress.slice(0, 4);
  const top4Set = new Set(top4.map((h) => h.runner.id));

  // Camera — three-mode TV-style cinematography (Sprint P4 #3).
  //   Mode 1 (wide):     progress < closeupTrigger.  Static establishing shot.
  //   Mode 2 (track):    closeupTrigger ≤ progress < tightTrigger.
  //                      Soft follow on the top-4 bounding box.
  //   Mode 3 (tight):    progress ≥ tightTrigger.
  //                      Hard zoom on the LEADER's neighbourhood for the
  //                      finish-line moment — frames just the winner +
  //                      whoever's threatening them at the line.
  // Smooth lerp + zoom limits keep transitions gentle, never snappy.
  const closeupTrigger = T.closeupTriggerProgress || 0.78;
  const tightTrigger   = T.tightZoomProgress     || 0.92;
  const leader = sortedByProgress[0];
  if (progress > tightTrigger && leader) {
    // Mode 3 — tight on the leader. Frame the leader + ~140px of
    // breathing room either side so a closing horse is still visible.
    cameraTargetX = leader.x;
    cameraTargetY = leader.y;
    cameraTargetZoom = Math.min(2.8, 1.5);
  } else if (progress > closeupTrigger && top4.length) {
    // Mode 2 — soft track on the top-4 bounding box.
    const xs = top4.map((h) => h.x);
    const ys = top4.map((h) => h.y);
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);
    cameraTargetX = (minX + maxX) / 2;
    cameraTargetY = (minY + maxY) / 2;
    const padX = 260, padY = 100;
    const spanX = (maxX - minX) + padX;
    const spanY = (maxY - minY) + padY;
    cameraTargetZoom = Math.min(viewW / spanX, viewH / spanY, 2.4);
  } else {
    // Mode 1 — wide establishing.
    cameraTargetZoom = 1;
    cameraTargetX = viewW / 2;
    cameraTargetY = viewH / 2;
  }
  // Smooth lerp so the zoom ramps in/out, never snaps.
  const lerp = 0.06;
  cameraZoom += (cameraTargetZoom - cameraZoom) * lerp;
  cameraX    += (cameraTargetX    - cameraX)    * lerp;
  cameraY    += (cameraTargetY    - cameraY)    * lerp;

  // Track + horses live inside the camera transform; sky + particles
  // stay screen-space so the framing reads as a tight TV camera move.
  ctx.save();
  if (cameraZoom > 1.01) {
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(cameraZoom, cameraZoom);
    ctx.translate(-cameraX, -cameraY);
  }
  drawTrack();
  drawFurlongPoles(progress);
  // Photo-finish post — renders inside the camera transform so it
  // stays in-track-coordinates and scales with the closeup zoom.
  if (progress >= 0.80) _drawFinishLinePost();
  updateHorses(progress, dt);
  drawHorses(top4Set);
  ctx.restore();

  drawParticles(dt);

  // Photo-finish hold (P5) — screen-space overlay drawn after the
  // camera transform restores, so the FINISH! text always stays
  // perfectly centered regardless of zoom.
  updatePhotoFinish(progress);

  fireCommentary(progress);
  updateCommentary(dt);
  updateLeaderboard(progress);

  // Phase title — prefer the new 7-stage phaseTable when present,
  // fall back to the legacy 4-band logic for band configs that
  // haven't been migrated yet.
  if (BAND.phaseTable && BAND.phaseTable.length) {
    const pt = BAND.phaseTable;
    let activePhase = pt[0];
    for (let i = 1; i < pt.length; i++) {
      if (progress >= pt[i].from) activePhase = pt[i];
      else break;
    }
    setPhaseTitle(activePhase.label);
    updatePhaseStrip(progress, pt, activePhase);
  } else {
    // Legacy 4-band fallback.
    const finalAt = T.finalFurlongProgress || 0.88;
    if (BAND.phases) {
      if (progress > finalAt && BAND.phases.finale) {
        setPhaseTitle(BAND.phases.finale);
      } else if (BAND.phases.kick && T.kickProgress && progress > T.kickProgress) {
        setPhaseTitle(BAND.phases.kick);
      } else if (BAND.phases.turn && T.turnProgress && progress > T.turnProgress) {
        setPhaseTitle(BAND.phases.turn);
      } else if (BAND.phases.midRace && T.midRaceProgress && progress > T.midRaceProgress) {
        setPhaseTitle(BAND.phases.midRace);
      }
    }
  }

  // Hide the Skip-to-Finish pill once we're already in the final
  // 10 seconds — skipping further would do nothing.
  if (raceDuration > 0 && raceDuration - raceTime <= SKIP_TO_FINISH_REMAINING_MS) {
    const wrap = document.querySelector('.race-skip-wrap');
    if (wrap && !wrap.classList.contains('race-skip-hidden')) {
      wrap.classList.add('race-skip-hidden');
    }
  }

  // P6 — the legacy DOM-based photo-finish trigger is now disabled.
  // The new in-canvas updatePhotoFinish() (P5/P6) replaces it and
  // routes to one of three result-aware overlays (photo finish for
  // ≤head, distance headline for clear winners, dead-heat for DH).
  // Keeping the old call here would draw a second "PHOTO FINISH"
  // overlay on top of the new one regardless of margin.
  //
  // The old #flatPhotoFinish DOM element is left in the template
  // (zero rendering cost when never .is-active'd) so a rollback to
  // the old engine wouldn't need template changes.

  if (progress >= 1) {
    raceRunning = false;
    raceFinish();
    return;
  }
  animFrame = requestAnimationFrame(raceLoop);
}

// ─── Drawing ────────────────────────────────────────────────────
function drawSky(progress) {
  const grad = ctx.createLinearGradient(0, 0, 0, viewH * 0.65);
  grad.addColorStop(0, COL.skyTop    || '#7eb8e8');
  grad.addColorStop(1, COL.skyBottom || '#c9a66a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewW, viewH * 0.65);

  // Distant grandstand silhouette
  ctx.fillStyle = 'rgba(20,30,50,0.55)';
  ctx.fillRect(0, viewH * 0.55, viewW, viewH * 0.10);
}

function drawTrack() {
  const top = viewH * (TRK.laneTopRatio    || 0.24);
  const bot = viewH * (TRK.laneBottomRatio || 0.78);

  ctx.fillStyle = COL.trackTurf || '#2d5e3a';
  ctx.fillRect(0, top - 4, viewW, bot - top + 16);

  // Inside rail
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(viewW, top);
  ctx.stroke();

  // Outside rail
  ctx.beginPath();
  ctx.moveTo(0, bot);
  ctx.lineTo(viewW, bot);
  ctx.stroke();

  // Finish line — tall thin black/white striped pole at finishX
  const fx = viewW * (TRK.finishX || 0.94);
  ctx.save();
  for (let y = top - 14; y < bot + 18; y += 8) {
    ctx.fillStyle = ((Math.floor(y / 8)) % 2 === 0) ? '#fff' : '#000';
    ctx.fillRect(fx, y, 4, 8);
  }
  ctx.restore();
}

function drawFurlongPoles(progress) {
  const top = viewH * (TRK.laneTopRatio || 0.24);
  const startX = viewW * (TRK.startX  || 0.05);
  const finishX = viewW * (TRK.finishX || 0.94);
  const span = finishX - startX;
  const step = TRK.furlongPoleEvery || 0.125;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let p = 0; p <= 1.0001; p += step) {
    const x = startX + p * span;
    ctx.fillRect(x - 1, top - 14, 2, 14);
  }
}

function updateHorses(progress, dt) {
  const TRK_START  = TRK.startX  || 0.05;
  const TRK_FINISH = TRK.finishX || 0.94;
  const trackSpan  = TRK_FINISH - TRK_START;

  // Final-spread per band. Sprints stay tight (less time to spread);
  // stayers fan out more. This is where horse[finalPos=N] lands at
  // race end relative to the winner — measured as a fraction of the
  // track span.
  const baseSpread = STATE.raceBand === 'sprint' ? 0.014
                  : STATE.raceBand === 'mile'   ? 0.020
                  :                               0.026;

  horses.forEach((h) => {
    h.lastX = h.x;

    // Active surge windows — bell-curve over each so they ramp in/out
    // smoothly rather than stepping. Negative surges = fades (drops back).
    let surgeMod = 0;
    h.surges.forEach((s) => {
      if (progress >= s.start && progress <= s.start + s.duration) {
        const t = (progress - s.start) / s.duration;
        surgeMod += s.boost * Math.sin(t * Math.PI);
      }
    });

    // Field-spread profile:
    //   • At progress=0    dampening = 0.10  → field bunched at the gate
    //   • At progress=1.0  dampening = 1.00  → final spread asserted
    // Final-pos lag pulls each horse toward its predetermined finish, but
    // the surge term jitters everything in between so positions actually
    // swap on screen mid-race.
    const dampening = 0.10 + progress * 0.90;
    // Replay mode with parsed real distances overrides the linear-
    // by-rank baseLag with the runner's actual cumulative gap. Falls
    // through to the rank formula on forecast routes / replays
    // without parsed distance data.
    const replayLag = replayBaseLag(h, viewW * trackSpan);
    const baseLag   = replayLag !== null
      ? replayLag
      : h.finalPos * baseSpread;
    const surgePush = surgeMod * 0.05;

    // Candidate progress for this frame from raw race-progress, dampened
    // lag and bell-curve surge. The MAX clamp below stops any horse from
    // appearing to retreat — surges still create overtakes, but once a
    // horse reaches a position it never visibly slides back. Without
    // this, the winner overshoots the line on the surge peak then
    // appears to drop back as the bell curve wanes, before crossing.
    const candidate = Math.max(0, Math.min(1, progress - baseLag * dampening + surgePush));
    h.progress = Math.max(h.progress, candidate);

    h.x = viewW * TRK_START + h.progress * viewW * trackSpan;

    // Per-horse gait variance — each horse bobs at its own rate
    // (set in buildHorseObjects) so the pack reads as 16 individual
    // animals instead of one synchronised bobbing blob.
    h.bobPhase += dt * 0.014 * (h.bobRate || 1);
    h.legPhase += dt * 0.022 * (h.bobRate || 1);
  });
}

function drawHorses(top4Set) {
  // Sort by x asc so frontmost draws last (on top).
  const sorted = horses.slice().sort((a, b) => a.x - b.x);

  // Podium = current top 3 by progress (drives label visibility).
  const podium = new Set(
    horses.slice().sort((a, b) => b.progress - a.progress).slice(0, 3).map((h) => h.runner.id)
  );

  // True closeup state — used to dim non-top-4 and grow labels.
  const closeup = cameraZoom > 1.05;

  // Winner-ring trigger (Sprint P4 #8) — once we're in slow-mo AND
  // tight-zoom territory, paint a soft pulsing gold ring around the
  // leader's silhouette. Reads as "this is the winner" without us
  // having to put a chip on screen. Computed once per frame.
  // progress is local to the race loop; recompute here cheaply from
  // the master clock so drawHorses doesn't need a new arg.
  const T = (BAND.timings) || {};
  const progressForRing = raceDuration > 0
    ? Math.min(raceTime / raceDuration, 1) : 0;
  const slowMoActive = progressForRing >= (T.slowMoStartProgress || 0.88);
  const leaderForRing = slowMoActive
    ? horses.slice().sort((a, b) => b.progress - a.progress)[0]
    : null;

  sorted.forEach((h) => {
    const isUser    = STATE.userPick && STATE.userPick.id === h.runner.id;
    const isFox     = STATE.foxPick  && STATE.foxPick.name === h.runner.name;
    const isLeader  = h === sorted[sorted.length - 1];
    const isPodium  = podium.has(h.runner.id);
    const isTop4    = top4Set && top4Set.has(h.runner.id);
    const x = h.x;
    const y = h.y;
    // Per-horse bob amplitude — each horse rises by 1.4-2.6px instead
    // of the old fixed 2px. Combined with bobRate, the field's gait
    // visually de-syncs after ~2 seconds of racing.
    const bob = Math.sin(h.bobPhase) * 2 * (h.bobAmp || 1);
    const speed = Math.max(0, h.x - h.lastX);

    // In closeup mode the camera is framed on the top 4. Everyone else
    // is contextually present but visually receded — alpha 0.30 reads
    // as "out of frame" without removing them from the canvas (so
    // overtakes from behind into the top 4 read smoothly).
    ctx.save();
    if (closeup && !isTop4) ctx.globalAlpha = 0.30;

    drawSpeedLines(x, y + bob, speed, isUser, isFox);

    // Winner gold ring (Sprint P4 #8) — draw BEFORE the silhouette
    // so it reads as a halo around the horse, not on top of it.
    // Animates a soft pulsing radius using bobPhase for variation.
    if (leaderForRing && leaderForRing.runner.id === h.runner.id) {
      const pulse = 1 + Math.sin(h.bobPhase * 2) * 0.08;
      const baseR = 36;
      ctx.save();
      ctx.shadowColor = 'rgba(212, 175, 55, 0.95)';
      ctx.shadowBlur = 22 * pulse;
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y + bob, baseR * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawHorseSilhouette(x, y + bob, h, isUser, isFox, isLeader);
    ctx.restore();

    // TV-style labelling — reviewer feedback fix (Phase 1, v2).
    //
    // BEFORE: ALL podium horses got labels at all times, plus ALL top-4
    // got labels + 1st/2nd/3rd/4th pills during closeup. With horses
    // physically clustered (which is most of the race), the labels
    // stacked into an unreadable brown blob of text.
    //
    // NOW: only the LEADER, the viewer's vote, and Mr Fox's pick get
    // floating labels — same rule everywhere (closeup AND wide). At
    // most 3 labels on screen at any time, all editorially meaningful
    // ("who's winning", "your pick", "the editor's pick"). The Live
    // Positions leaderboard on the right is the single source of truth
    // for identifying everyone else. Cuts visual noise by ~80% with
    // no information lost.
    const hasResultPillData = (
      REPLAY_DATA && REPLAY_DATA.has_result
    );
    const showLabel = isLeader || isUser || isFox;
    if (!showLabel) return;

    ctx.save();
    if (closeup && !isTop4) ctx.globalAlpha = 0.30;
    ctx.font = 'bold ' + (closeup ? '13' : '11') + 'px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    const labelY = y + bob - (closeup ? 22 : 18);
    const name = h.runner.name;
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = 'rgba(6,8,15,0.78)';
    ctx.beginPath();
    ctx.roundRect(x - tw / 2 - 8, labelY - 14, tw + 16, closeup ? 20 : 18, 4);
    ctx.fill();
    ctx.fillStyle = isUser ? COL.userLabel : isFox ? COL.foxLabel : '#ffffff';
    ctx.fillText(name, x, labelY);
    ctx.restore();

    // Per-horse finish-position pill — RESTRICTED to replay mode AND only
    // when we have a real beaten-distance string to attach. In forecast mode
    // the position pills were pure noise (the leaderboard already covers it);
    // in replay they carry editorial weight ("3rd · +1¼"). So we gate on
    // REPLAY_DATA.has_result and only render for ranks 2-4 where the
    // beaten distance adds new information.
    if (closeup && isTop4 && hasResultPillData) {
      const liveSorted = horses.slice().sort((a, b) => b.progress - a.progress);
      const rank = liveSorted.indexOf(h) + 1;
      const gap = rank > 1 ? (REPLAY_DATA.beaten_distances || {})[h.runner.id] : null;
      if (rank >= 1 && rank <= 4 && (rank === 1 || gap)) {
        const ord = rank === 1 ? 'st'
                  : rank === 2 ? 'nd'
                  : rank === 3 ? 'rd' : 'th';
        const pillText = (rank === 1) ? (rank + ord) : (rank + ord + ' · +' + gap);
        const rankColour = rank === 1 ? '#D4AF37'
                         : rank === 2 ? '#C0C0C0'
                         : rank === 3 ? '#CD7F32'
                         : 'rgba(245,228,154,0.85)';
        ctx.save();
        ctx.font = 'bold 11px "DM Sans", sans-serif';
        ctx.textAlign = 'center';
        const pillW = ctx.measureText(pillText).width;
        const pillY = y + bob + 32;
        ctx.fillStyle = 'rgba(6,8,15,0.82)';
        ctx.beginPath();
        ctx.roundRect(x - pillW/2 - 7, pillY - 11, pillW + 14, 16, 4);
        ctx.fill();
        ctx.fillStyle = rankColour;
        ctx.fillText(pillText, x, pillY);
        ctx.restore();
      }
    }
  });
}

function drawSpeedLines(x, y, speed, isUser, isFox) {
  // Speed lines trail behind the horse, scaled by velocity — gives the
  // sense of motion without a per-frame motion-blur composite.
  if (speed < 0.4) return;
  const count = SHARED.speedLineCount || 4;
  ctx.save();
  ctx.strokeStyle = isUser ? COL.userPick : isFox ? COL.foxPick : (COL.speedLine || 'rgba(255,255,255,0.45)');
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const dy = (i - (count - 1) / 2) * 5;
    const length = Math.min(48, speed * (8 + i * 2));
    ctx.globalAlpha = 0.85 - i * 0.18;
    ctx.beginPath();
    ctx.moveTo(x - 14,           y + dy);
    ctx.lineTo(x - 14 - length,  y + dy);
    ctx.stroke();
  }
  ctx.restore();
}

// Coat tones — single hardcoded brown, jockey silks differentiate.
const HORSE_COAT       = '#3a2510';
const HORSE_COAT_SHADE = '#1f1408';

// ── Sprint P5 — hoof-strike dust particles (heavy mode) ─────────────
// Spawned at each gallop-cycle ground contact: off-hind (cyc≈0.00),
// the diagonal pair off-fore + lead-hind (cyc≈0.20), and lead-fore
// (cyc≈0.40). Tracked per-horse via h.lastDustCycle so we spawn
// once per strike rather than every frame between strikes.
function _spawnHoofDust(x, y, h, cyc) {
  const STRIKES = [0.00, 0.20, 0.40];
  const prevCyc = h.lastDustCycle == null ? cyc : h.lastDustCycle;
  h.lastDustCycle = cyc;

  for (const strike of STRIKES) {
    // Did this strike cross between last frame and this frame?
    // Handle the 0.0 wrap-around (prev = 0.9, current = 0.05) carefully.
    const crossed = (prevCyc > strike) ?
      (cyc < prevCyc && cyc >= strike) || (cyc < strike && cyc < prevCyc - 0.5)
      : (cyc >= strike && prevCyc < strike);
    if (!crossed) continue;

    // Spawn 2-3 dust puffs at the hoof position (slightly behind the
    // horse since the hoof has just struck and is about to lift).
    const puffs = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < puffs; i++) {
      const dustX = x - 14 - Math.random() * 8;
      const dustY = y + 18 + Math.random() * 3;
      particles.push({
        x:    dustX,
        y:    dustY,
        vx:   -1 - Math.random() * 1.6,
        vy:   -0.6 - Math.random() * 1.2,
        g:    -0.04,                     // negative gravity = floats up
        life: 0.6 + Math.random() * 0.4,
        size: 5 + Math.random() * 4,
        colour: 'rgba(170,150,120,0.55)',
        rot: 0,
        rotSpeed: 0,
      });
    }
  }
}


// ── Sprint P6 — result-aware finish scene ──────────────────────────
// At the moment of crossing, compute the winning margin and route to
// the right overlay:
//   • margin ≤ head        → PHOTO FINISH  (the existing dramatic overlay)
//   • dead heat             → DEAD HEAT (side-by-side winners)
//   • margin > head         → WON BY X LENGTHS (newspaper-style)
//   • forecast no-result    → simulated margin from final X positions
const PHOTO_FINISH_HOLD_MS = 1500;
let photoFinishStartedAt = null;   // ms timestamp of freeze start
let photoFinishFrozen = false;     // true while held
let photoFinishMargin = null;      // {lengths, source, winners} cached at trigger


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
  const ranked = horses.slice().sort((a, b) => b.progress - a.progress);
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
  const rankedByX = horses.slice().sort((a, b) => b.x - a.x);
  if (rankedByX.length < 2) {
    return { lengths: null, source: 'forecast', winners: [winnerName] };
  }
  const xGap = rankedByX[0].x - rankedByX[1].x;
  const PIXELS_PER_LENGTH = 28;
  const lengths = Math.max(0, xGap / PIXELS_PER_LENGTH);
  return { lengths: lengths, source: 'forecast', winners: [winnerName] };
}

function _drawFinishLinePost() {
  // Draws a finish-line post + banner on the right edge of the
  // canvas. Static — just a visual anchor for the photo-finish moment.
  const T = SHARED.track || {};
  const finishX = viewW * (T.finishX || 0.94);
  const postTopY = viewH * 0.35;
  const postBottomY = viewH * 0.82;

  // White vertical post
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0b0e15';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.rect(finishX - 3, postTopY, 6, postBottomY - postTopY);
  ctx.fill();
  ctx.stroke();

  // Gold finial cap
  ctx.fillStyle = '#D4AF37';
  ctx.beginPath();
  ctx.arc(finishX, postTopY - 2, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7a5a08';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Banner — "FINISH" with gold border
  const banW = 96, banH = 22;
  ctx.fillStyle = 'rgba(11, 14, 21, 0.92)';
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(finishX - banW / 2, postTopY - banH - 16, banW, banH, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#D4AF37';
  ctx.font = 'bold 13px "DM Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FINISH', finishX, postTopY - banH - 16 + 15);
  ctx.restore();
}


function _drawPhotoFinishOverlay() {
  // Big "PHOTO FINISH" text overlay during the freeze hold. Cinema
  // poster level — centered, large serif, gold-tinted with a slight
  // glow. Fades in over the first 0.3s, holds, fades out.
  if (!photoFinishStartedAt) return;
  const elapsed = (performance.now() - photoFinishStartedAt);
  const fadeIn  = Math.min(1, elapsed / 300);
  const fadeOut = Math.max(0, 1 - (elapsed - (PHOTO_FINISH_HOLD_MS - 300)) / 300);
  const alpha = Math.max(0, Math.min(fadeIn, fadeOut));
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Subtle vignette to push focus inward
  const vg = ctx.createRadialGradient(
    viewW / 2, viewH / 2, viewW * 0.18,
    viewW / 2, viewH / 2, viewW * 0.65
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, viewW, viewH);

  // Eyebrow chip
  ctx.fillStyle = 'rgba(11, 14, 21, 0.78)';
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 1.2;
  const ew = 130, eh = 22;
  const ex = viewW / 2 - ew / 2, ey = viewH * 0.28;
  ctx.beginPath();
  ctx.roundRect(ex, ey, ew, eh, 999);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#D4AF37';
  ctx.textAlign = 'center';
  ctx.font = 'bold 10.5px "DM Sans", sans-serif';
  ctx.fillText('📸 PHOTO FINISH', viewW / 2, ey + 15);

  // Big "FINISH!" headline
  ctx.fillStyle = '#f5efde';
  ctx.shadowColor = 'rgba(212, 175, 55, 0.65)';
  ctx.shadowBlur = 18;
  ctx.font = 'bold 64px "Playfair Display", Georgia, serif';
  ctx.fillText('FINISH!', viewW / 2, viewH * 0.42);

  ctx.restore();
}


// ── Distance overlay — newspaper-style "WON BY X LENGTHS" ──────
// Drawn instead of the photo-finish overlay when the winning margin
// is greater than a head. Same fade timing + vignette as the photo
// finish; different copy + chip styling so the eye distinguishes
// "tight" finishes from "clear" ones at a glance.
function _drawDistanceOverlay(margin) {
  if (!photoFinishStartedAt) return;
  const elapsed = (performance.now() - photoFinishStartedAt);
  const fadeIn  = Math.min(1, elapsed / 300);
  const fadeOut = Math.max(0, 1 - (elapsed - (PHOTO_FINISH_HOLD_MS - 300)) / 300);
  const alpha = Math.max(0, Math.min(fadeIn, fadeOut));
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Subtle vignette
  const vg = ctx.createRadialGradient(
    viewW / 2, viewH / 2, viewW * 0.18,
    viewW / 2, viewH / 2, viewW * 0.65
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, viewW, viewH);

  // Eyebrow chip — "★ WINNER" instead of "📸 PHOTO FINISH"
  ctx.fillStyle = 'rgba(11, 14, 21, 0.78)';
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 1.2;
  const ew = 110, eh = 22;
  const ex = viewW / 2 - ew / 2, ey = viewH * 0.28;
  ctx.beginPath();
  ctx.roundRect(ex, ey, ew, eh, 999);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#D4AF37';
  ctx.textAlign = 'center';
  ctx.font = 'bold 10.5px "DM Sans", sans-serif';
  ctx.fillText('★ WINNER', viewW / 2, ey + 15);

  // "WON BY" small superscript
  ctx.fillStyle = 'rgba(245, 239, 222, 0.62)';
  ctx.font = 'bold 14px "DM Sans", sans-serif';
  ctx.fillText('WON BY', viewW / 2, viewH * 0.36);

  // Big "X LENGTHS" headline
  const distText = (margin && margin.lengths != null)
    ? _formatBeatenDistance(margin.lengths)
    : 'A CLEAR MARGIN';
  // Auto-size: shorter strings get the full 64px treatment, longer
  // ones (e.g. THREE-QUARTERS OF A LENGTH) downsize to fit.
  const fontSize = distText.length > 18 ? 40 : distText.length > 12 ? 52 : 64;
  ctx.fillStyle = '#f5efde';
  ctx.shadowColor = 'rgba(212, 175, 55, 0.65)';
  ctx.shadowBlur = 18;
  ctx.font = 'bold ' + fontSize + 'px "Playfair Display", Georgia, serif';
  ctx.fillText(distText, viewW / 2, viewH * 0.46);

  // Winner name underneath — italic Iowan so it reads as caption
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#D4AF37';
  ctx.font = 'italic 22px "Iowan Old Style", Charter, Georgia, serif';
  const winnerName = (margin && margin.winners && margin.winners[0]) || '';
  if (winnerName) {
    ctx.fillText(winnerName, viewW / 2, viewH * 0.54);
  }

  ctx.restore();
}


// ── Dead-heat overlay — side-by-side winners ──────────────────
function _drawDeadHeatOverlay(margin) {
  if (!photoFinishStartedAt) return;
  const elapsed = (performance.now() - photoFinishStartedAt);
  const fadeIn  = Math.min(1, elapsed / 300);
  const fadeOut = Math.max(0, 1 - (elapsed - (PHOTO_FINISH_HOLD_MS - 300)) / 300);
  const alpha = Math.max(0, Math.min(fadeIn, fadeOut));
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Vignette
  const vg = ctx.createRadialGradient(
    viewW / 2, viewH / 2, viewW * 0.18,
    viewW / 2, viewH / 2, viewW * 0.65
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, viewW, viewH);

  // Eyebrow chip — dead-heat themed
  ctx.fillStyle = 'rgba(11, 14, 21, 0.78)';
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 1.2;
  const ew = 130, eh = 22;
  const ex = viewW / 2 - ew / 2, ey = viewH * 0.28;
  ctx.beginPath();
  ctx.roundRect(ex, ey, ew, eh, 999);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#D4AF37';
  ctx.textAlign = 'center';
  ctx.font = 'bold 10.5px "DM Sans", sans-serif';
  ctx.fillText('🤝 DEAD HEAT', viewW / 2, ey + 15);

  // Big headline
  ctx.fillStyle = '#f5efde';
  ctx.shadowColor = 'rgba(212, 175, 55, 0.65)';
  ctx.shadowBlur = 18;
  ctx.font = 'bold 56px "Playfair Display", Georgia, serif';
  ctx.fillText('DEAD HEAT', viewW / 2, viewH * 0.42);

  // Two winners side by side, joined by an ampersand
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#D4AF37';
  ctx.font = 'italic 22px "Iowan Old Style", Charter, Georgia, serif';
  const names = (margin && margin.winners) || [];
  if (names.length >= 2) {
    ctx.fillText(names[0] + '  &  ' + names[1], viewW / 2, viewH * 0.52);
  } else if (names.length === 1) {
    ctx.fillText(names[0], viewW / 2, viewH * 0.52);
  }

  ctx.restore();
}


// Public entry — called from the race loop after drawing horses.
// Returns true when the race is in photo-finish hold (simulation
// should freeze; race loop should not advance the clock).
function updatePhotoFinish(progress) {
  if (!photoFinishStartedAt && progress >= 0.999) {
    photoFinishStartedAt = performance.now();
    photoFinishFrozen = true;
    photoFinishMargin = _computeWinningMargin();
  }
  if (photoFinishFrozen) {
    const elapsed = performance.now() - photoFinishStartedAt;
    const m = photoFinishMargin;
    // Route to the right overlay based on the cached margin.
    if (m && m.lengths === -1) {
      _drawDeadHeatOverlay(m);
    } else if (m && m.lengths != null && m.lengths <= 0.20) {
      _drawPhotoFinishOverlay();    // photo finish (≤ head)
    } else if (m && m.lengths != null) {
      _drawDistanceOverlay(m);      // clear winner with margin
    } else {
      _drawPhotoFinishOverlay();    // defensive fallback
    }
    if (elapsed >= PHOTO_FINISH_HOLD_MS) {
      photoFinishFrozen = false;
    }
  }
  return photoFinishFrozen;
}

// Reset between races (called from the race-start path).
function _resetPhotoFinish() {
  photoFinishStartedAt = null;
  photoFinishFrozen = false;
  photoFinishMargin = null;
}


function drawHorseSilhouette(x, y, h, isUser, isFox, isLeader) {
  // ════════════════════════════════════════════════════════════════
  // SPRINT P5 — anatomically richer silhouette + 4-beat gallop cycle.
  //
  // Replaces the previous 2-phase Muybridge silhouette with:
  //   • Proper 4-beat transverse gallop:
  //       beat 1 — off-hind strikes
  //       beat 2 — lead-hind + off-fore (diagonal) strike together
  //       beat 3 — lead-fore strikes alone
  //       beat 4 — suspension (all four off ground, body lifted)
  //   • Streaming mane (10 strokes flowing back behind the neck)
  //   • Streaming tail (5 strands flowing back)
  //   • Jockey whip raised during the slow-mo final furlong
  //   • Body bob driven by gait phase (slight rise during suspension)
  //   • Anatomy detail: defined eye, ear, nostril, mouth-open in
  //     slow-mo, muscle shadow on the haunches + shoulder
  //
  // Heavy mode (Q2=Heavy chosen): hoof-strike dust particles spawned
  // by _spawnHoofDust() at each ground-contact beat.
  // ════════════════════════════════════════════════════════════════
  const scale = 0.95;

  // ── 4-beat gallop math ─────────────────────────────────────
  // legPhase advances each frame in the race loop. We map it onto
  // a 0-1 cycle position, then derive per-leg foot heights + body
  // bob from that. Each leg's vertical position is a sin curve
  // offset by its position in the gallop sequence:
  //   off-hind:  offset 0.00 — strikes ground first
  //   lead-hind: offset 0.20 — strikes with off-fore (diagonal)
  //   off-fore:  offset 0.20
  //   lead-fore: offset 0.40 — strikes alone
  //   then all four lift into suspension at 0.60-1.00
  const cyc = (h.legPhase / (Math.PI * 2)) % 1;   // 0..1 cycle position
  const gallopY = (offset) => {
    // Sinusoidal "leg up/down" — 0 when grounded, negative when lifted.
    const pos = ((cyc - offset) + 1) % 1;
    // pos 0-0.4 = on ground (foot tucked back, gathering forward)
    // pos 0.4-0.7 = swing forward (foot extended ahead)
    // pos 0.7-1.0 = striking down (foot returning to ground)
    if (pos < 0.4) return 0;                            // grounded
    if (pos < 0.7) return -Math.sin((pos - 0.4) / 0.3 * Math.PI) * 7; // lift + forward
    return -Math.sin((1 - pos) / 0.3 * Math.PI) * 7;    // dropping back to ground
  };
  const gallopX = (offset) => {
    // Foot reaches forward then sweeps back — sin curve in x.
    const pos = ((cyc - offset) + 1) % 1;
    return Math.cos(pos * Math.PI * 2) * 5;
  };
  const offHindOffset  = 0.00;
  const leadHindOffset = 0.20;
  const offForeOffset  = 0.20;
  const leadForeOffset = 0.40;

  // Body bob — slight rise during the suspension phase.
  const suspensionPhase = (cyc > 0.60 && cyc < 1.00)
    ? Math.sin((cyc - 0.60) / 0.40 * Math.PI) : 0;
  const bodyLift = -suspensionPhase * 2.2;

  const sinT = Math.sin(h.legPhase);  // legacy for mane sway
  const cosT = Math.cos(h.legPhase);

  // ── Slow-mo / finish detection — drives whip raise + mouth-open ──
  const progressNow = raceDuration > 0
    ? Math.min(raceTime / raceDuration, 1) : 0;
  const inFinalStretch = progressNow >= 0.85;
  const inSlowMo       = progressNow >= 0.88;

  const silk  = h.runner.silk  || COL.silkDefault;
  const silk2 = h.runner.silk2 || COL.silk2Default;

  // ── HEAVY: hoof-strike dust particles ───────────────────────
  // Spawn a small dust puff at each ground-contact beat. Tracked
  // per-horse via h.lastDustCycle so we don't spam the particle
  // system every frame between strikes.
  _spawnHoofDust(x, y, h, cyc);

  ctx.save();
  ctx.translate(x, y + bodyLift);
  ctx.scale(scale, scale);

  // ── Track shadow (compresses during suspension) ──────────
  const shadowAlpha = 0.32 - suspensionPhase * 0.18;
  const shadowW    = 28 - suspensionPhase * 6;
  ctx.fillStyle = 'rgba(0,0,0,' + shadowAlpha + ')';
  ctx.beginPath();
  ctx.ellipse(0, 22 - bodyLift, shadowW, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Selection glow ─────────────────────────────────────
  if (isUser || isFox || isLeader) {
    const glow = isUser ? 'rgba(212,175,55,0.42)' :
                 isFox  ? 'rgba(220,130,30,0.38)' :
                          'rgba(255,255,255,0.22)';
    const grd = ctx.createRadialGradient(0, 0, 4, 0, 0, 38);
    grd.addColorStop(0, glow);
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(2, 0, 38, 20, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Back legs (off-hind + lead-hind) ────────────────────
  // Each hind leg renders as a hip→hock→hoof segment so the
  // gallop posture reads as actual leg articulation, not lines.
  ctx.strokeStyle = HORSE_COAT_SHADE;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  const offHindFootY  = 28 + gallopY(offHindOffset);
  const offHindFootX  = -10 + gallopX(offHindOffset);
  const leadHindFootY = 28 + gallopY(leadHindOffset);
  const leadHindFootX = -8 + gallopX(leadHindOffset);
  // off-hind — thigh + cannon
  ctx.beginPath();
  ctx.moveTo(-9, 6);
  ctx.lineTo((-9 + offHindFootX) / 2, (6 + offHindFootY) / 2 - 1);
  ctx.lineTo(offHindFootX, offHindFootY);
  ctx.stroke();
  // lead-hind
  ctx.beginPath();
  ctx.moveTo(-7, 7);
  ctx.lineTo((-7 + leadHindFootX) / 2, (7 + leadHindFootY) / 2 - 0.5);
  ctx.lineTo(leadHindFootX, leadHindFootY);
  ctx.stroke();

  // ── Torso ───────────────────────────────────────────────
  ctx.fillStyle = HORSE_COAT;
  ctx.beginPath();
  ctx.moveTo(-16, 1);
  ctx.bezierCurveTo(-15, -7, -4, -9, 8, -8);
  ctx.bezierCurveTo(18, -8, 22, -4, 22, 0);
  ctx.bezierCurveTo(22, 4, 18, 7, 10, 7);
  ctx.bezierCurveTo(2, 8, -8, 7, -16, 4);
  ctx.closePath();
  ctx.fill();

  // Muscle-tone highlight on the shoulder
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(-10, -4);
  ctx.bezierCurveTo(-4, -7, 8, -7, 16, -5);
  ctx.bezierCurveTo(14, -3, 0, -3, -10, -4);
  ctx.closePath();
  ctx.fill();

  // Haunch muscle shadow (new — adds dimensional read on the rump)
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(-12, 1, 5, 6, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // ── Neck + head (extended gallop pose) ──────────────────
  ctx.fillStyle = HORSE_COAT;
  ctx.beginPath();
  ctx.moveTo(20, -2);
  ctx.bezierCurveTo(26, -6, 32, -9, 36, -10);
  ctx.bezierCurveTo(38, -9, 38, -6, 36, -5);
  ctx.bezierCurveTo(30, -3, 22, 0, 22, 2);
  ctx.closePath();
  ctx.fill();
  // Head
  ctx.beginPath();
  ctx.ellipse(37, -10, 5, 3.5, 0.35, 0, Math.PI * 2);
  ctx.fill();
  // Muzzle
  ctx.beginPath();
  ctx.ellipse(41, -8, 2.5, 1.8, 0.5, 0, Math.PI * 2);
  ctx.fill();
  // Eye + eye-glint highlight
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(37, -11, 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(37.2, -11.2, 0.25, 0, Math.PI * 2);
  ctx.fill();
  // Ear
  ctx.fillStyle = HORSE_COAT;
  ctx.beginPath();
  ctx.moveTo(34, -13);
  ctx.lineTo(35, -15);
  ctx.lineTo(36, -13);
  ctx.closePath();
  ctx.fill();
  // Nostril
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.ellipse(42, -7.5, 0.6, 0.4, 0.5, 0, Math.PI * 2);
  ctx.fill();
  // Mouth — opens in slow-mo (effort mode)
  if (inSlowMo) {
    ctx.fillStyle = '#2a0a0a';
    ctx.beginPath();
    ctx.ellipse(42.5, -6.5, 1.6, 0.9, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Flowing mane (streams back behind the neck) ─────────
  ctx.strokeStyle = HORSE_COAT_SHADE;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  const manePulse = Math.sin(h.bobPhase * 1.5) * 1.5;
  for (let i = 0; i < 10; i++) {
    const baseX = 26 - i * 1.1;
    const baseY = -8 + Math.sin(i * 0.5) * 0.6;
    // Each strand streams back proportional to its index
    const endX = baseX - 8 - i * 0.5;
    const endY = baseY + 0 + i * 0.3 + manePulse * (0.4 + i * 0.08);
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(baseX - 4, baseY - 1 + manePulse * 0.3, endX, endY);
    ctx.stroke();
  }

  // ── Flowing tail (streams back behind the rump) ─────────
  ctx.strokeStyle = HORSE_COAT_SHADE;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  const tailPulse = Math.sin(h.bobPhase * 1.2) * 2;
  ctx.beginPath();
  ctx.moveTo(-16, 1);
  ctx.bezierCurveTo(-22, -1 + tailPulse, -28, 1 + tailPulse * 0.6, -32, 5 + tailPulse * 0.3);
  ctx.stroke();
  // Tail strands (5 finer lines for that streaming-in-wind look)
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    const yOff = -1 + i * 1.4;
    ctx.beginPath();
    ctx.moveTo(-18 - i * 1.5, yOff);
    ctx.quadraticCurveTo(
      -25 - i * 2, 1 + i + tailPulse * 0.5,
      -32 - i * 1.5, 5 + i + tailPulse * 0.2
    );
    ctx.stroke();
  }

  // ── Front legs (lead-fore + off-fore) ───────────────────
  ctx.strokeStyle = HORSE_COAT_SHADE;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  const leadForeFootY = 26 + gallopY(leadForeOffset);
  const leadForeFootX = 22 + gallopX(leadForeOffset);
  const offForeFootY  = 26 + gallopY(offForeOffset);
  const offForeFootX  = 20 + gallopX(offForeOffset);
  // lead-fore — shoulder + knee + hoof
  ctx.beginPath();
  ctx.moveTo(18, 5);
  ctx.lineTo((18 + leadForeFootX) / 2, (5 + leadForeFootY) / 2 - 0.5);
  ctx.lineTo(leadForeFootX, leadForeFootY);
  ctx.stroke();
  // off-fore
  ctx.beginPath();
  ctx.moveTo(16, 5);
  ctx.lineTo((16 + offForeFootX) / 2, (5 + offForeFootY) / 2);
  ctx.lineTo(offForeFootX, offForeFootY);
  ctx.stroke();

  // ── Jockey (aero crouch) ────────────────────────────────
  ctx.fillStyle = silk;
  ctx.beginPath();
  ctx.moveTo(-2, -9);
  ctx.bezierCurveTo(2, -16, 12, -17, 18, -13);
  ctx.bezierCurveTo(20, -11, 18, -9, 14, -8);
  ctx.bezierCurveTo(8, -8, 0, -8, -2, -9);
  ctx.closePath();
  ctx.fill();

  // Silk colour-block stripe
  ctx.fillStyle = silk2;
  ctx.beginPath();
  ctx.moveTo(3, -15);
  ctx.lineTo(13, -13);
  ctx.lineTo(12, -10);
  ctx.lineTo(2, -12);
  ctx.closePath();
  ctx.fill();

  // Arms forward to reins
  ctx.strokeStyle = silk;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(14, -10);
  ctx.lineTo(24, -8);
  ctx.stroke();

  // Helmet
  ctx.fillStyle = silk2;
  ctx.beginPath();
  ctx.arc(19, -17, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = silk;
  ctx.fillRect(16, -18, 6, 1.5);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(21, -17, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Boot at horse's belly
  ctx.fillStyle = '#1a0a04';
  ctx.beginPath();
  ctx.ellipse(7, -3, 4, 2, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // ── Whip raised during final stretch (new) ─────────────
  // Jockey's right hand lifts a whip during the final furlong —
  // small but reads as "being asked for everything" on screen.
  // Whip raises by progressing from horizontal (0.85) → fully up (0.95).
  if (inFinalStretch) {
    const whipProgress = Math.min(1, (progressNow - 0.85) / 0.10);
    const whipAngle = -Math.PI / 2 + (1 - whipProgress) * 0.5;
    const whipBaseX = 12, whipBaseY = -13;
    const whipLength = 10;
    ctx.strokeStyle = '#0e0a05';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(whipBaseX, whipBaseY);
    ctx.lineTo(
      whipBaseX + Math.cos(whipAngle) * whipLength,
      whipBaseY + Math.sin(whipAngle) * whipLength
    );
    ctx.stroke();
    // Whip tip highlight
    ctx.fillStyle = 'rgba(245,228,154,0.6)';
    ctx.beginPath();
    ctx.arc(
      whipBaseX + Math.cos(whipAngle) * whipLength,
      whipBaseY + Math.sin(whipAngle) * whipLength,
      0.9, 0, Math.PI * 2
    );
    ctx.fill();
  }

  ctx.restore();
}

// ─── Particles ──────────────────────────────────────────────────
function spawnConfetti(x, y, count, colour) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 6;
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 4,
      g: 0.18 + Math.random() * 0.1,
      life: 1,
      size: 4 + Math.random() * 4,
      colour,
      rot: Math.random() * Math.PI,
      rotSpeed: (Math.random() - 0.5) * 0.4,
    });
  }
}

function drawParticles(dt) {
  pCtx.clearRect(0, 0, viewW, viewH);
  particles = particles.filter((p) => {
    p.vy += p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.rotSpeed;
    p.life -= 0.012;
    if (p.life <= 0 || p.y > viewH + 30) return false;
    pCtx.save();
    pCtx.globalAlpha = p.life;
    pCtx.translate(p.x, p.y);
    pCtx.rotate(p.rot);
    pCtx.fillStyle = p.colour;
    pCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
    pCtx.restore();
    return true;
  });
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
  const liveLeader = horses.reduce(
    (best, h) => (h.progress > (best ? best.progress : -1)) ? h : best,
    null
  );
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

function updateLeaderboard() {
  const c = document.getElementById('raceLeaderboard');
  if (!c) return;

  // Mobile: shift the leaderboard panel from top-right to left
  // once the race is past halfway. Keeps the finishing line
  // unobscured on narrow viewports. Mirrors experience.js' logic
  // so jumps + flat behave identically.
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    const lb = document.querySelector('.race-leaderboard');
    if (lb && raceDuration > 0) {
      const progress = raceTime / raceDuration;
      if (progress >= 0.5) lb.classList.add('lb-shifted-left');
      else lb.classList.remove('lb-shifted-left');
    }
  }

  const rowH = _lbRowHeightPx();
  const ranked = horses.slice().sort((a, b) => b.progress - a.progress);
  ranked.forEach((h, rank) => {
    const row = c.querySelector('[data-runner="' + h.runner.id + '"]');
    if (!row) return;
    const inView = rank < LB_VISIBLE_ROWS;
    if (inView) {
      row.style.transform = 'translateY(' + (rank * rowH) + 'px)';
      row.style.opacity = '1';
      row.style.zIndex = String(LB_VISIBLE_ROWS - rank);
      const pos = row.querySelector('.race-lb-pos');
      if (pos) {
        pos.textContent = rank + 1;
        pos.className = 'race-lb-pos p' + (rank + 1);
      }
    } else {
      row.style.transform = 'translateY(' + (LB_VISIBLE_ROWS * rowH) + 'px)';
      row.style.opacity = '0';
      row.style.zIndex = '0';
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

// ─── Photo finish ──────────────────────────────────────────────
// Photo-finish gate — runs only at the moment the engine is about
// to fire the overlay. Replay mode: read the 1st-to-2nd gap from
// REPLAY_DATA.lengths_behind_winner; skip if > 1.0 lengths. Forecast
// mode: always fire (we have no real result to compare against).
const PHOTO_FINISH_MAX_GAP_LENGTHS = 1.0;
function _shouldFirePhotoFinish() {
  if (!REPLAY_DATA || !REPLAY_DATA.has_result || !REPLAY_DATA.has_distances) {
    return true;
  }
  const order = REPLAY_DATA.result_order || [];
  if (order.length < 2) return true;
  const secondId = order[1];
  const gap = (REPLAY_DATA.lengths_behind_winner || {})[secondId];
  if (gap === undefined) return true;
  return gap <= PHOTO_FINISH_MAX_GAP_LENGTHS;
}

function triggerPhotoFinish() {
  const el = document.getElementById('flatPhotoFinish');
  if (!el) return;
  el.classList.add('is-active');
  setTimeout(() => el.classList.remove('is-active'),
    (SHARED.photoFinishHoldMs || 900) + 400);
}

// ─── Race finish + reveal ──────────────────────────────────────
function raceFinish() {
  const winner = STATE.simResult.winner;
  const positions = STATE.simResult.positions;
  const T = BAND.timings || {};

  // Particles are drawn on the un-transformed pCanvas, so bursts need
  // SCREEN-space coordinates. During closeup the camera is zoomed and
  // the leader appears at viewW/2 + (canvasX - cameraX) × cameraZoom.
  const winnerHorse = horses.find((h) => h.runner.id === winner.id);
  let burstX, burstY;
  if (winnerHorse && cameraZoom > 1.05) {
    burstX = viewW / 2 + (winnerHorse.x - cameraX) * cameraZoom;
    burstY = viewH / 2 + (winnerHorse.y - cameraY) * cameraZoom;
  } else {
    burstX = viewW * (TRK.finishX || 0.94);
    burstY = viewH * 0.5;
  }

  const bursts = T.raceEndConfettiBursts || 7;
  const interval = T.raceEndConfettiIntervalMs || 170;
  for (let i = 0; i < bursts; i++) {
    setTimeout(() => {
      spawnConfetti(burstX, burstY, 22, COL.gold || '#D4AF37');
      spawnConfetti(burstX, burstY, 18, COL.goldLight || '#F5E49A');
      spawnConfetti(burstX, burstY, 12, '#ffffff');
    }, i * interval);
  }

  setCommentaryText(`${winner.name} wins! What a race!`);
  showSubtitle(`${winner.name} — the winner!`, T.winnerHoldMs || 3800);

  setTimeout(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
    pCtx.clearRect(0, 0, viewW, viewH);
    runRollCall(positions, winner);
  }, T.winnerHoldMs || 3800);
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
  // Race-engine state
  particles = [];
  horses = [];
  raceTime = 0;
  raceRunning = false;
  photoFinishFired = false;
  lastPhaseTitle = '';
  firedCommentary.clear();
  _resetPhotoFinish();   // P5 — clear the in-canvas photo-finish hold state
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  pCtx.clearRect(0, 0, viewW, viewH);
  ctx.clearRect(0, 0, viewW, viewH);

  // Camera back to neutral so the next race opens on the wide track.
  cameraZoom = 1; cameraX = viewW / 2; cameraY = viewH / 2;
  cameraTargetZoom = 1; cameraTargetX = viewW / 2; cameraTargetY = viewH / 2;

  // Overlays
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
