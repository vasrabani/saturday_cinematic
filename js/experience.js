/*
 * THE EXPERIENCE — Saturday Racing Cinematic Engine
 *
 * Three acts:
 *   Act 0: Intro screen
 *   Act 1: Horse parade (each runner announced)
 *   Act 2: The Race (Canvas 2D side-scroller with physics)
 *   Act 3: The Reveal
 *
 * Dependencies: GSAP (loaded via CDN in template)
 *
 * Config: cinematic/seed/cinematic_config.json — embedded via
 * json_script as #cinematicConfig. Timings, commentary, colours,
 * track positions are all data-driven from there.
 */

'use strict';

// ── Config + accessibility flags ─────────────────────────────────────────────
// Loaded once at module init. CONFIG_DEFAULTS is a safety net so the engine
// keeps running if the json_script payload is missing or empty.
const CONFIG_DEFAULTS = {
  timings: {
    raceDurationMs: 62000,
    paradeDelayMsFast: 900,
    paradeDelayMsSlow: 1400,
    paradeLargeFieldThreshold: 20,
    commentaryHoldMs: 3500,
    subtitleDefaultMs: 2500,
    winnerHoldMs: 4000,
    raceEndConfettiBursts: 8,
    raceEndConfettiIntervalMs: 180,
  },
  track: {
    startX: 0.04, finishX: 0.93,
    laneTopRatio: 0.22, laneBottomRatio: 0.80,
    closeupTriggerProgress: 0.80,
    finalFurlongProgress: 0.85,
    secondCircuitProgress: 0.50,
  },
  camera: { panSmoothing: 0.06, zoomSmoothing: 0.015, closeupZoom: 1.5 },
  horse: {
    minSurges: 2, maxExtraSurges: 3,
    surgeStartRange: [0.05, 0.75],
    surgeDurationRange: [0.04, 0.12],
    surgeBoostRange: [0.5, 2.0],
    winnerFinalSurge: { start: 0.82, duration: 0.15, boost: 2.5 },
  },
  colours: {
    gold: '#D4AF37', goldLight: '#F5E49A',
    userPick: 'rgba(212,175,55,0.25)', foxPick: 'rgba(200,120,20,0.20)',
    neutralGlow: 'rgba(100,100,200,0.10)',
    userLabel: '#D4AF37', foxLabel: '#E8A050',
    defaultLabel: 'rgba(240,235,224,0.85)',
    silkDefault: '#C8A951', silk2Default: '#1A2540',
    rankGold: '#D4AF37', rankSilver: '#C0C0C0', rankBronze: '#CD7F32',
    vignette: '#C0392B',
  },
  // Race-phase narrative (reviewer feedback #4 — Phase 3).
  // Seven phases timed to progress milestones, each with a phase
  // title above the canvas + a pre-canned commentary line.
  // Commentary supports {LEADER} / {USER} / {FOX} variable
  // substitution at fire time so the line reads as personalised
  // race-day calling without any LLM cost.
  // Mr Fox voice commentary (Sprint P4 #6) — same library shape as flat.js.
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
  phases: {
    awayWeGo:      "AND THEY'RE AWAY",
    settlingDown:  'SETTLING DOWN',
    steadyPace:    'STEADY THE PACE',
    backStraight:  'INTO THE BACK STRAIGHT',
    twoOut:        'TWO FURLONGS OUT',
    finalFurlong:  'THE FINAL FURLONG',
    driveToLine:   'DRIVING TO THE LINE',
    // Legacy keys kept for back-compat with track config that references
    // them; new code should use the phase-progress table below.
    raceStart:     "AND THEY'RE AWAY",
    secondCircuit: 'INTO THE BACK STRAIGHT',
  },
  // Phase-progress table — drives the new 7-phase title rotation AND
  // the phase-strip UI. Edit here to retune the narrative arc.
  phaseTable: [
    { key: 'awayWeGo',     from: 0.00, label: "AND THEY'RE AWAY" },
    { key: 'settlingDown', from: 0.08, label: 'SETTLING DOWN' },
    { key: 'steadyPace',   from: 0.25, label: 'STEADY THE PACE' },
    { key: 'backStraight', from: 0.45, label: 'INTO THE BACK STRAIGHT' },
    { key: 'twoOut',       from: 0.68, label: 'TWO FURLONGS OUT' },
    { key: 'finalFurlong', from: 0.85, label: 'THE FINAL FURLONG' },
    { key: 'driveToLine',  from: 0.95, label: 'DRIVING TO THE LINE' },
  ],
};
const CONFIG = (() => {
  try {
    const el = document.getElementById('cinematicConfig');
    if (!el) return CONFIG_DEFAULTS;
    const parsed = JSON.parse(el.textContent || '{}');
    // Shallow-merge so missing top-level keys fall back to defaults.
    return Object.assign({}, CONFIG_DEFAULTS, parsed);
  } catch (e) {
    return CONFIG_DEFAULTS;
  }
})();

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Silk badge renderer ──────────────────────────────────────────────────────
// Mirrors races/templates/races/components/atoms/_silk.html so the
// cinematic shows the SAME silks the user just saw on /races/.
// Two render paths:
//   1) Racing API silk image when runner.silk_url is populated
//      (real owner colours, full pattern detail).
//   2) Inline stylised SVG built from silk + silk2 + pattern when
//      no URL is available. Pattern is chosen deterministically
//      from the saddle number — same algorithm the racecard uses.
let _silkIdCounter = 0;
function renderSilkSvg(runner) {
  if (runner && runner.silk_url) {
    // Real Racing API image — width inherited from .silk-svg CSS.
    return '<img class="silk-img" src="' + runner.silk_url +
           '" alt="Silks" loading="lazy" decoding="async">';
  }
  const body   = (runner && runner.silk)  || '#1A3A6B';
  const accent = (runner && runner.silk2) || '#FFFFFF';
  const pat    = (runner && runner.silk_pattern) || 'solid';
  // Unique clipPath id per render — multiple silks coexist on one
  // page (parade card replaces, reveal screen separate) so the id
  // must not collide.
  const id = 'cinSilkClip-' + (++_silkIdCounter);
  // Same path data as _silk.html — keeps proportions identical.
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

// ── State ────────────────────────────────────────────────────────────────────
const STATE = {
  runners:      [],   // from Django context
  userPick:     null,
  foxPick:      null,
  raceName:     '',
  raceDistance: '',
  raceFences:   0,
  paradeIdx:    0,
  simResult:    null, // { winner, positions[] }
  phase:        'intro',
};

// ── Canvas ───────────────────────────────────────────────────────────────────
const canvas  = document.getElementById('raceCanvas');
const pCanvas = document.getElementById('particleCanvas');
const ctx     = canvas.getContext('2d');
const pCtx    = pCanvas.getContext('2d');

// roundRect polyfill — Safari < 16 / Firefox < 113 ship without it.
// All call-sites inside this engine use the simple (x,y,w,h,r) signature
// so this 8-line shim is sufficient.
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

// Logical (CSS-pixel) viewport dimensions. Backing canvas buffers are
// physical-pixel; ctx is scaled by devicePixelRatio so all draw calls
// stay in CSS pixels. Use these everywhere instead of viewW.
let viewW = 0;
let viewH = 0;

// ── Race simulation state ────────────────────────────────────────────────────
let horses        = [];  // runtime horse objects
let raceRunning   = false;
let raceTime      = 0;
let raceDuration  = 0;
let animFrame     = null;
let lastTimestamp = null;
let particles     = [];
// End-rush: once the leader is within touching distance of the line,
// compress the remaining race time so the climax doesn't dangle for
// several seconds while the back of the field catches up. Set ONCE
// from raceLoop when horses[0].progress crosses LEADER_NEAR_LINE.
let raceTimeAccel = 1;
const LEADER_NEAR_LINE = 0.94;
const END_RUSH_BUDGET_MS = 600;
let currentCommentary = '';
let commentaryTimer   = 0;

// Commentary lines keyed by race progress %; loaded from CONFIG so the
// editor can change copy without touching JS.
const COMMENTARY_SCRIPT = CONFIG.commentary || [];

let firedCommentary = new Set();

// ── Resize ───────────────────────────────────────────────────────────────────
function getNavH() { return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60; }


function resize() {
  const dpr  = window.devicePixelRatio || 1;
  const navH = getNavH();
  viewW = window.innerWidth;
  viewH = window.innerHeight - navH;
  // Physical buffer × dpr; CSS-size pinned to logical dimensions so the
  // canvas occupies the viewport; ctx scaled so all draw calls work in
  // CSS-pixel coordinates (viewW * 0.04 stays meaningful).
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

// ── Init ─────────────────────────────────────────────────────────────────────
function init(data) {
  STATE.runners     = data.runners;
  STATE.userPick    = data.userPick;
  STATE.foxPick     = data.foxPick;
  STATE.raceName    = data.raceName;
  STATE.raceDistance = data.raceDistance;
  STATE.raceFences  = data.raceFences || 30;

  // Build intro runner chips
  buildIntroChips();

  // Show intro screen
  showScreen('intro');
}

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
  });
  STATE.phase = name;
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
}

// ── Intro ─────────────────────────────────────────────────────────────────────
function buildIntroChips() {
  const container = document.getElementById('introRunnersPreview');
  if (!container) return;

  // Show first 20 runners as chips
  STATE.runners.slice(0, 20).forEach(r => {
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

window.startExperience = function() {
  // The archive picker is for choosing an archive race on the intro —
  // hide it now that the user has committed. CSS body-class toggle
  // lets it fade out cleanly; replayExperience drops the class to
  // bring it back if the user clicks "Run Again".
  document.body.classList.add('cinematic-experience-running');

  // Reduced-motion users: skip parade + race entirely. Compute a
  // deterministic-ish result instantly and jump to the reveal so they
  // still see who won and where their pick landed, without minutes of
  // animation. Same shape as the cinematic flow, just without the show.
  if (prefersReducedMotion) {
    runStaticReveal();
    return;
  }
  // Animate intro out then begin parade
  gsap.to('#screen-intro', {
    opacity: 0,
    scale: 0.96,
    duration: 0.5,
    ease: 'power2.in',
    onComplete: () => {
      showScreen('parade');
      gsap.fromTo('#screen-parade',
        { opacity: 0 },
        { opacity: 1, duration: 0.4, onComplete: beginParade }
      );
    }
  });
};

// Reduced-motion path: snap straight from intro to reveal screen with
// the simulation result computed instantly. No race loop, no GSAP
// timeline, no commentary cycle. The reveal screen itself is a static
// layout so accessible by default.
//
// buildRacePositions() already honours REPLAY_DATA (Phase 4), so in
// replay mode positions[0] is the real winner; in forecast mode it's
// the weighted sim pick we passed in. Either way we derive `winner`
// from positions[0] rather than the fallback so the reveal never lies
// about a settled result.
function runStaticReveal() {
  const fallback = weightedRandom(STATE.runners);
  const positions = buildRacePositions(fallback);
  const winner = (positions && positions[0]) || fallback;
  STATE.simResult = { winner, positions };
  buildRevealScreen(winner, positions);
  showScreen('reveal');
}

// ── ACT 1: PARADE ─────────────────────────────────────────────────────────────
function beginParade() {
  STATE.paradeIdx = 0;
  buildParadeDots();
  showParadeHorse(0);
}

function buildParadeDots() {
  const container = document.getElementById('paradeDots');
  if (!container) return;
  container.innerHTML = '';
  // Cap dots to 20 to avoid overflow
  const dotCount = Math.min(STATE.runners.length, 20);
  for (let i = 0; i < dotCount; i++) {
    const dot = document.createElement('div');
    dot.className = 'parade-dot';
    dot.id = 'paradeDot-' + i;
    container.appendChild(dot);
  }
}

function updateParadeDots(idx) {
  const dotCount = Math.min(STATE.runners.length, 20);
  for (let i = 0; i < dotCount; i++) {
    const dot = document.getElementById('paradeDot-' + i);
    if (!dot) continue;
    dot.className = 'parade-dot' +
      (i === idx ? ' active' : i < idx ? ' done' : '');
  }
}

function showParadeHorse(idx) {
  if (idx >= STATE.runners.length) {
    // All horses paraded — go to race
    transitionToRace();
    return;
  }

  const r = STATE.runners[idx];
  STATE.paradeIdx = idx;
  updateParadeDots(idx);

  // Update counter
  const counter = document.getElementById('paradeCounter');
  if (counter) counter.textContent = (idx + 1);

  const isUser = STATE.userPick && STATE.userPick.id === r.id;
  const isFox  = STATE.foxPick  && STATE.foxPick.name === r.name;

  // Build tags
  const tagEls = [];
  if (isUser) tagEls.push(`<span class="parade-tag parade-tag--user">🐾 Your Pick</span>`);
  if (isFox)  tagEls.push(`<span class="parade-tag parade-tag--fox">🦊 Fox's Pick</span>`);
  if (r.is_fav) tagEls.push(`<span class="parade-tag parade-tag--fav">Favourite</span>`);
  if (r.sr)   tagEls.push(`<span class="parade-tag parade-tag--sr">SR ${r.sr}</span>`);
  if (r.stars) tagEls.push(`<span class="parade-tag parade-tag--sr">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</span>`);

  // Silk glow colour
  const glowColour = isUser ? 'rgba(212,175,55,0.25)' : isFox ? 'rgba(200,120,20,0.2)' : 'rgba(100,100,200,0.1)';

  const html = `
    <div class="parade-bg-glow" style="background:radial-gradient(ellipse 80% 80% at 50% 50%, ${glowColour}, transparent)"></div>
    <div class="parade-card" id="paradeCard">
      <div class="parade-silk">${renderSilkSvg(r)}</div>
      <div class="parade-number">Horse ${r.number} of ${STATE.runners.length}</div>
      <div class="parade-name">${r.name}</div>
      <div class="parade-connections">
        <strong>J:</strong> ${r.jockey} &nbsp;·&nbsp; <strong>T:</strong> ${r.trainer}
      </div>
      <div class="parade-odds-badge">${r.odds}</div>
      <div class="parade-tags">${tagEls.join('')}</div>
    </div>
  `;

  const stage = document.getElementById('paradeStage');
  if (!stage) return;

  // Animate out old, in new
  if (stage.innerHTML) {
    gsap.to('#paradeCard', {
      opacity: 0, x: -40, duration: 0.22, ease: 'power2.in',
      onComplete: () => {
        stage.innerHTML = html;
        gsap.fromTo('#paradeCard',
          { opacity: 0, x: 50, scale: 0.97 },
          { opacity: 1, x: 0, scale: 1, duration: 0.35, ease: 'power2.out' }
        );
      }
    });
  } else {
    stage.innerHTML = html;
    gsap.fromTo('#paradeCard',
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }
    );
  }

  // Advance automatically — slightly faster for large fields. Both
  // the threshold and the two delays come from CONFIG so the editor
  // can re-pace the parade without touching JS.
  const T   = CONFIG.timings;
  const ms  = STATE.runners.length > T.paradeLargeFieldThreshold
    ? T.paradeDelayMsFast
    : T.paradeDelayMsSlow;
  setTimeout(() => {
    if (STATE.phase === 'parade') showParadeHorse(idx + 1);
  }, ms);
}

window.skipParade = function() {
  STATE.paradeIdx = STATE.runners.length;
  transitionToRace();
};

// ── TRANSITION → RACE ─────────────────────────────────────────────────────────
function transitionToRace() {
  // "The gates open" subtitle
  showSubtitle("The gates open. 40,000 hold their breath.", 2500);

  gsap.to('#screen-parade', {
    opacity: 0, duration: 0.6, delay: 0.5, ease: 'power2.in',
    onComplete: () => {
      showScreen('race');
      gsap.fromTo('#screen-race',
        { opacity: 0 },
        { opacity: 1, duration: 0.4, onComplete: startRace }
      );
    }
  });
}

// ── ACT 2: THE RACE ───────────────────────────────────────────────────────────
function startRace() {
  // Pick a fallback winner for the sim-weight path. In replay mode
  // buildRacePositions() honours REPLAY_DATA (Phase 4) and returns
  // the real finish order — positions[0] is the actual winner, not
  // our random fallback. Derive `winner` from positions[0] so the
  // reveal screen ALWAYS announces whoever crossed the line first,
  // not the pre-sim random pick (which would be wrong on replay).
  const fallback = weightedRandom(STATE.runners);
  const simPositions = buildRacePositions(fallback);
  const simWinner = (simPositions && simPositions[0]) || fallback;
  STATE.simResult = { winner: simWinner, positions: simPositions };

  // Build horse objects for canvas
  buildHorseObjects(simPositions);

  raceDuration  = CONFIG.timings.raceDurationMs;
  raceTime      = 0;
  raceRunning   = true;
  raceTimeAccel = 1;
  lastTimestamp = null;
  firedCommentary.clear();
  inCloseup     = false;
  cameraZoom    = 1;
  // Remove any closeup label from previous run
  const oldLabel = document.getElementById('closeupLabel');
  if (oldLabel) oldLabel.remove();

  // Build leaderboard
  buildLeaderboard();

  // Update phase title
  setPhaseTitle(CONFIG.phases.raceStart);

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
// no replay data is present.
const REPLAY_DATA = (() => {
  try {
    const el = document.getElementById('replayData');
    return el ? JSON.parse(el.textContent || '{}') : null;
  } catch (e) {
    return null;
  }
})();

// Real-distance baseLead override — when REPLAY_DATA carries
// parsed cumulative lengths-behind-winner, each horse's position
// at the line is driven by their actual gap, not the linear-by-rank
// fallback. Returns null when no replay distances are available;
// caller falls through to the existing formula.
//
// Photo-finish floor: ns / hd / dh all map toward 0 lengths. We
// enforce a 4px minimum visual gap so the finishing order remains
// legible — the reveal screen carries the literal distance string.
const REPLAY_MAX_TRACK_SPREAD = 0.18;
const REPLAY_MIN_GAP_PX = 4;
function replayBaseLead(horse, trackWidthPx) {
  if (!REPLAY_DATA || !REPLAY_DATA.has_distances) return null;
  const map = REPLAY_DATA.lengths_behind_winner;
  const lengths = map && map[horse.runner.id];
  if (lengths === undefined) return null;
  if (lengths <= 0) return 1.0;
  const max = REPLAY_DATA.max_lengths_behind || 1;
  const gapFraction = (lengths / max) * REPLAY_MAX_TRACK_SPREAD;
  const minGap = trackWidthPx > 0
    ? REPLAY_MIN_GAP_PX / trackWidthPx
    : 0.005;
  return 1.0 - Math.max(gapFraction, minGap);
}

function buildRacePositions(winner) {
  // ── Replay short-circuit ─────────────────────────────────
  // When the race is settled, the actual finish positions
  // override the sim's shuffle entirely. Winner argument is
  // ignored in favour of result_order[0]. DNFs (runners not
  // in the result_order array) are appended to the back of
  // the field so they still render on the canvas.
  if (REPLAY_DATA && REPLAY_DATA.has_result &&
      Array.isArray(REPLAY_DATA.result_order) &&
      REPLAY_DATA.result_order.length) {
    const byId = new Map(STATE.runners.map(r => [r.id, r]));
    const ordered = REPLAY_DATA.result_order
      .map(id => byId.get(id))
      .filter(Boolean);
    const seen = new Set(REPLAY_DATA.result_order);
    STATE.runners.forEach(r => {
      if (!seen.has(r.id)) ordered.push(r);
    });
    if (ordered.length) return ordered;
    // Fall through to the sim only if the result payload didn't
    // map to any known runner — defensive.
  }

  // Remaining runners shuffled weighted (forecast / fallback path)
  const rest = STATE.runners.filter(r => r.id !== winner.id);
  // Sort rest by weight + noise
  const sorted = rest.sort((a, b) =>
    (b.weight + Math.random() * 20) - (a.weight + Math.random() * 20)
  );
  return [winner, ...sorted];
}

function buildHorseObjects(positions) {
  const H = viewH;
  const trackTop    = H * 0.22;
  const trackBottom = H * 0.80;
  const count       = positions.length;
  const laneH       = (trackBottom - trackTop) / count;

  horses = positions.map((r, i) => {
    const finalPos = i;
    const startX = viewW * 0.04 + Math.random() * 20;

    // Each horse gets random surge windows (2-4 surges during the race)
    const surges = [];
    const surgeCount = 2 + Math.floor(Math.random() * 3);
    for (let s = 0; s < surgeCount; s++) {
      surges.push({
        start: 0.05 + Math.random() * 0.7,
        duration: 0.04 + Math.random() * 0.08,
        boost: 0.5 + Math.random() * 1.5, // surge strength
      });
    }
    // Winner gets a big surge in the final straight
    if (finalPos === 0) {
      surges.push({ start: 0.82, duration: 0.15, boost: 2.5 });
    }

    // Per-horse gait variance (reviewer feedback #2 — Phase 2).
    // Without this, every horse bobs at the same rate + amplitude →
    // 16 silhouettes moving in lockstep = a brown blob. With these
    // three random offsets each horse has its own gait identity:
    //   bobRate     — speed of the up-down body bob (0.85-1.15× base)
    //   bobAmp      — amplitude of the bob (0.7-1.3× base)
    //   laneNudge   — small per-horse y-offset (±3px) so adjacent-lane
    //                  horses don't sit at perfectly aligned y values.
    const bobRate   = 0.85 + Math.random() * 0.30;
    const bobAmp    = 0.70 + Math.random() * 0.60;
    const laneNudge = (Math.random() - 0.5) * 6;
    const baseY     = trackTop + laneH * i + laneH * 0.5 + laneNudge;

    return {
      runner:     r,
      x:          startX,
      y:          baseY,
      targetY:    baseY,
      finalPos:   finalPos,
      baseProgress: 0,  // underlying scripted progress
      surgeBoost:   0,  // current surge add
      progress:     0,  // actual rendered progress
      surges:       surges,
      currentLeadPos: i, // live position 0=first
      bobPhase: Math.random() * Math.PI * 2,
      legPhase: Math.random() * Math.PI * 2,
      bobRate:  bobRate,
      bobAmp:   bobAmp,
    };
  });
}

// ── RACE LOOP ─────────────────────────────────────────────────────────────────
function raceLoop(ts) {
  if (!raceRunning) return;

  if (!lastTimestamp) lastTimestamp = ts;
  const dt = Math.min(ts - lastTimestamp, 50); // cap at 50ms
  lastTimestamp = ts;

  // End-rush: once the leader is touching the line, compress the
  // remaining race time so the climax doesn't dangle for several
  // seconds while the back of the field catches up. Set ONCE per
  // race — the multiplier persists until raceFinish.
  if (raceTimeAccel === 1 && horses[0] && horses[0].progress >= LEADER_NEAR_LINE) {
    const remainingMs = raceDuration - raceTime;
    if (remainingMs > END_RUSH_BUDGET_MS) {
      raceTimeAccel = remainingMs / END_RUSH_BUDGET_MS;
    }
  }
  raceTime += dt * raceTimeAccel;

  const progress = Math.min(raceTime / raceDuration, 1);

  // Clear
  ctx.clearRect(0, 0, viewW, viewH);

  // Draw scene
  drawBackground(progress);
  drawTrack();
  drawFenceMarkers(progress);
  updateHorses(progress, dt);
  drawHorses(progress);
  drawParticles(dt);

  // Commentary
  fireCommentary(progress);
  updateCommentary(dt);

  // Leaderboard update (every ~500ms)
  // Update leaderboard every frame for live positions
  updateLeaderboard(progress);

  // Phase title — seven-stage narrative arc driven by CONFIG.phaseTable.
  // Find the latest phase whose `from` threshold has been passed; that's
  // the current phase. setPhaseTitle is internally idempotent (skips a
  // tween when text is unchanged) so calling it every frame is safe.
  const pt = CONFIG.phaseTable;
  if (pt && pt.length) {
    let activePhase = pt[0];
    for (let i = 1; i < pt.length; i++) {
      if (progress >= pt[i].from) activePhase = pt[i];
      else break;
    }
    setPhaseTitle(activePhase.label);
    updatePhaseStrip(progress, pt, activePhase);
  } else {
    // Legacy fallback — old config without phaseTable.
    if (progress > CONFIG.track.finalFurlongProgress) setPhaseTitle(CONFIG.phases.finalFurlong);
    else if (progress > CONFIG.track.secondCircuitProgress) setPhaseTitle(CONFIG.phases.secondCircuit);
  }

  // Final leg intensity — vignette pulse, screen vibration hint
  if (inCloseup) {
    drawCloseupIntensity(progress);
  }

  // Hide the Skip-to-Finish pill once we're already inside the
  // final 10 seconds — clicking it from here on is a no-op anyway.
  if (raceDuration > 0 && raceDuration - raceTime <= SKIP_TO_FINISH_REMAINING_MS) {
    const wrap = document.querySelector('.race-skip-wrap');
    if (wrap && !wrap.classList.contains('race-skip-hidden')) {
      wrap.classList.add('race-skip-hidden');
    }
  }

  if (progress >= 1) {
    raceRunning = false;
    raceFinish();
    return;
  }

  animFrame = requestAnimationFrame(raceLoop);
}

function drawCloseupIntensity(progress) {
  const W = viewW, H = viewH;
  const intensity = Math.min(1, (progress - 0.80) / 0.18);

  // Pulsing red vignette around edges
  const vigAlpha = intensity * 0.18 * (0.7 + 0.3 * Math.sin(raceTime / 180));
  const vig = ctx.createRadialGradient(W/2, H/2, H * 0.25, W/2, H/2, H * 0.75);
  vig.addColorStop(0, 'transparent');
  vig.addColorStop(1, `rgba(192,57,43,${vigAlpha})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Gold finish line glow intensifies
  if (progress > 0.88) {
    const finAlpha = Math.min(0.6, (progress - 0.88) / 0.08);
    ctx.fillStyle = `rgba(212,175,55,${finAlpha * 0.15})`;
    ctx.fillRect(W * 0.90, 0, W * 0.1, H);
  }
}

// ── CANVAS DRAWING ────────────────────────────────────────────────────────────
function drawBackground(progress) {
  const W = viewW, H = viewH;

  // Sky gradient — shifts from dawn to afternoon
  const skyAlpha = 0.3 + progress * 0.2;
  const grad = ctx.createLinearGradient(0, 0, 0, H * 0.6);
  grad.addColorStop(0, `rgba(8,12,30,${1 - progress * 0.3})`);
  grad.addColorStop(0.5, `rgba(15,20,50,${0.9})`);
  grad.addColorStop(1, `rgba(6,8,15,0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Stars (early race)
  if (progress < 0.3) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 * (1 - progress / 0.3)})`;
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137.5) % W;
      const sy = (i * 97.3) % (H * 0.4);
      ctx.beginPath();
      ctx.arc(sx, sy, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Ground
  const groundGrad = ctx.createLinearGradient(0, H * 0.75, 0, H);
  groundGrad.addColorStop(0, '#1a2e18');
  groundGrad.addColorStop(1, '#0e1a0c');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, H * 0.75, W, H * 0.25);

  // Crowd silhouette
  drawCrowd(W, H);

  // Finishing post at the far right
  if (progress > 0.7) {
    const postAlpha = Math.min(1, (progress - 0.7) / 0.15);
    const postX = W * 0.93;
    ctx.save();
    ctx.globalAlpha = postAlpha;
    ctx.fillStyle = '#F5E49A';
    ctx.fillRect(postX - 3, H * 0.35, 6, H * 0.42);
    ctx.strokeStyle = 'rgba(245,228,154,0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(postX, H * 0.35);
    ctx.lineTo(postX, H * 0.77);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#F5E49A';
    ctx.font = `bold 11px "DM Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', postX, H * 0.33);
    ctx.restore();
  }
}

function drawCrowd(W, H) {
  const crowdY = H * 0.75;
  // Simple silhouette crowd
  ctx.fillStyle = 'rgba(10,12,22,0.9)';
  ctx.fillRect(0, crowdY - 30, W, 35);

  // Individual silhouettes
  ctx.fillStyle = 'rgba(20,24,40,0.95)';
  for (let i = 0; i < W; i += 12) {
    const h = 18 + Math.sin(i * 0.13) * 6 + Math.sin(i * 0.07) * 4;
    ctx.beginPath();
    ctx.ellipse(i, crowdY - 8, 4, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.arc(i, crowdY - 8 - h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTrack() {
  const W = viewW, H = viewH;
  const trackTop    = H * 0.25;
  const trackBottom = H * 0.77;

  const trackGrad = ctx.createLinearGradient(0, trackTop, 0, trackBottom);
  trackGrad.addColorStop(0, 'rgba(30,50,25,0.6)');
  trackGrad.addColorStop(0.5, 'rgba(22,38,18,0.4)');
  trackGrad.addColorStop(1, 'rgba(10,18,8,0.5)');
  ctx.fillStyle = trackGrad;
  ctx.fillRect(0, trackTop, W, trackBottom - trackTop);

  ctx.strokeStyle = 'rgba(212,175,55,0.15)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, trackTop); ctx.lineTo(W, trackTop); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, trackBottom); ctx.lineTo(W, trackBottom); ctx.stroke();

  const stripeCount = 12;
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let i = 0; i < stripeCount; i++) {
    const offset = ((raceTime / 80) % (W / stripeCount)) * stripeCount;
    const x = (i / stripeCount) * W - offset;
    if (x < 0 || x > W) continue;
    ctx.beginPath();
    ctx.moveTo(x, trackTop);
    ctx.lineTo(x + (trackBottom - trackTop) * 0.3, trackBottom);
    ctx.stroke();
  }
}

function drawFenceMarkers(progress) {
  if (STATE.raceFences <= 0) return;

  const W = viewW, H = viewH;
  const fenceCount = STATE.raceFences;
  const trackStart = W * 0.05;
  const trackEnd   = W * 0.92;
  const trackWidth = trackEnd - trackStart;

  // Place fences at even intervals
  for (let i = 1; i <= fenceCount; i++) {
    const fenceProgress = i / (fenceCount + 1);
    // Only draw fences the field hasn't fully passed
    const fieldProgress = Math.min(...horses.map(h => h.progress));
    if (fenceProgress > fieldProgress + 0.08) break;

    const fenceX = trackStart + trackWidth * fenceProgress;
    // Fade as field passes
    const alpha  = Math.max(0, Math.min(0.6, (fenceProgress - fieldProgress + 0.05) * 12));

    ctx.save();
    ctx.globalAlpha = alpha;
    // Fence posts
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(fenceX - 1.5, H * 0.32, 3, H * 0.44);
    ctx.fillRect(fenceX + 18, H * 0.32, 3, H * 0.44);
    // Rails
    ctx.fillStyle = '#C8A951';
    ctx.fillRect(fenceX - 2, H * 0.38, 24, 3);
    ctx.fillRect(fenceX - 2, H * 0.46, 24, 2);
    // Brush
    ctx.fillStyle = '#2d5a1a';
    ctx.fillRect(fenceX - 1, H * 0.50, 22, 14);
    ctx.restore();
  }
}

// Camera state for closeup
let cameraZoom = 1;
let cameraOffsetX = 0;
let inCloseup = false;

function updateHorses(progress, dt) {
  const W = viewW, H = viewH;
  const trackStart = W * 0.04;
  const trackEnd   = W * 0.93;
  const trackWidth = trackEnd - trackStart;
  const count = horses.length;
  const dtSec = dt / 1000;

  // Closeup trigger — Sprint P4 #3 brought this earlier from 0.80 to 0.72
  // so the camera move aligns with the 'TWO FURLONGS OUT' phase title.
  // The viewer sees the title flip AND the camera tighten at the same beat.
  const shouldCloseup = progress >= 0.72;
  if (shouldCloseup && !inCloseup) {
    inCloseup = true;
    triggerCloseup();
  }

  horses.forEach((h, i) => {
    // Replay mode with parsed distances overrides the linear-by-rank
    // spread. Falls through to the existing formula whenever the
    // payload is absent / partial — forecast routes unchanged.
    const replayLead = replayBaseLead(h, trackWidth);
    const baseLead = replayLead !== null
      ? replayLead
      : (i === 0 ? 1.0 : 1.0 - (h.finalPos / count) * 0.15);
    h.baseProgress = Math.min(progress * baseLead, 1);

    let boost = 0;
    h.surges.forEach(s => {
      if (progress >= s.start && progress < s.start + s.duration) {
        const t = (progress - s.start) / s.duration;
        boost += Math.sin(t * Math.PI) * s.boost * 0.015;
      }
    });
    const taper = progress > 0.85 ? Math.max(0, 1 - (progress - 0.85) / 0.12) : 1;
    h.progress = Math.min(h.baseProgress + boost * taper, 1);

    h.x = trackStart + trackWidth * h.progress;

    const trackTop    = H * 0.22;
    const trackBottom = H * 0.78;

    if (inCloseup) {
      const top4 = getTop4();
      const myRank = top4.indexOf(h);
      if (myRank >= 0) {
        const laneH = (trackBottom - trackTop) / 4;
        h.targetY = trackTop + laneH * myRank + laneH * 0.5;
      } else {
        h.targetY = H * 1.5;
      }
    } else {
      const laneH = (trackBottom - trackTop) / count;
      h.targetY = trackTop + laneH * h.finalPos + laneH * 0.5;
    }
    h.y += (h.targetY - h.y) * (inCloseup ? 0.06 : 0.035);

    // Per-horse gait variance — each horse has its own bobRate so the
    // pack visually de-syncs after ~2 seconds of racing.
    h.bobPhase += dt * 0.009 * (h.bobRate || 1);
    h.legPhase += dt * (inCloseup ? 0.022 : 0.015) * (h.bobRate || 1);
  });
}

function getTop4() {
  // Current race leaders by progress
  return [...horses]
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 4);
}

function triggerCloseup() {
  // Zoom in effect via CSS + canvas transform
  showSubtitle("The final straight — four horses left in it!", 3500);

  // Add closeup label
  const existingLabel = document.getElementById('closeupLabel');
  if (!existingLabel) {
    const label = document.createElement('div');
    label.id = 'closeupLabel';
    label.className = 'closeup-label';
    label.textContent = '● FINAL FURLONG';
    document.getElementById('screen-race').appendChild(label);
  }
}

function drawHorses(progress) {
  const sorted = [...horses]
    .filter(h => h.y < viewH * 1.2) // skip off-screen horses
    .sort((a, b) => a.y - b.y);

  const scale = inCloseup ? 1.45 : 0.75; // bigger in closeup

  // Winner gold ring (Sprint P4 #8) — once we're in the slow-mo
  // final stretch, paint a pulsing gold halo around whoever's
  // leading by progress. Reads as "this is the winner" without us
  // having to label it.
  const SLOWMO_START = 0.88;
  const slowMoActive = progress >= SLOWMO_START;
  const leaderForRing = slowMoActive
    ? horses.slice().sort((a, b) => b.progress - a.progress)[0]
    : null;

  sorted.forEach(h => {
    const x = h.x, y = h.y;
    // Per-horse bob amplitude — each horse rises by 0.7-1.3× the base
    // so the field's vertical motion visually de-syncs.
    const bob = Math.sin(h.bobPhase) * (inCloseup ? 4 : 3) * (h.bobAmp || 1);
    const isUser  = STATE.userPick && STATE.userPick.id === h.runner.id;
    const isFox   = STATE.foxPick  && STATE.foxPick.name === h.runner.name;
    const top4    = inCloseup ? getTop4() : null;
    const inTop4  = !inCloseup || (top4 && top4.includes(h));

    if (!inTop4) return;

    // Winner ring renders BEFORE the silhouette so it reads as a halo.
    if (leaderForRing && leaderForRing.runner.id === h.runner.id) {
      const pulse = 1 + Math.sin(h.bobPhase * 2) * 0.08;
      ctx.save();
      ctx.shadowColor = 'rgba(212, 175, 55, 0.95)';
      ctx.shadowBlur = 24 * pulse;
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x + 10, y + bob, 42 * pulse * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawHorseSilhouette(x, y + bob, h, isUser, isFox, h.finalPos === 0, progress, scale);

    // TV-style labelling — reviewer feedback fix (Phase 1).
    //
    // BEFORE: closeup OR finalPos<5 OR user/fox got labels. With horses
    // physically clustered, 4-5 labels stacked into an unreadable mess.
    //
    // NOW: only the live LEADER (sorted by progress), the viewer's pick,
    // and Mr Fox's pick get floating labels. The Live Positions leaderboard
    // on the right is the single source of truth for identifying #2/#3/#4.
    const liveLeader = horses.reduce(
      (best, h2) => (h2.progress > (best ? best.progress : -1)) ? h2 : best,
      null
    );
    const isLiveLeader = liveLeader && liveLeader.runner.id === h.runner.id;
    const showLabel = isLiveLeader || isUser || isFox;
    if (showLabel) {
      const alpha = progress > 0.12 ? Math.min(1, (progress - 0.12) / 0.1) : 0;
      ctx.save();
      ctx.globalAlpha = alpha;
      const fontSize = inCloseup ? 13 : 10;
      ctx.font = `${isUser || isFox || inCloseup ? 'bold' : ''} ${fontSize}px "DM Sans", sans-serif`;
      ctx.textAlign = 'center';
      const labelColour = isUser ? '#D4AF37' : isFox ? '#E8A050' : 'rgba(240,235,224,0.85)';
      ctx.fillStyle = labelColour;
      const labelY = y + bob - (inCloseup ? 36 : 20);
      // Background pill in closeup
      if (inCloseup) {
        const name = h.runner.name;
        const tw = ctx.measureText(name).width;
        ctx.fillStyle = 'rgba(6,8,15,0.75)';
        ctx.beginPath();
        ctx.roundRect(x + 10 - tw/2 - 8, labelY - 14, tw + 16, 20, 4);
        ctx.fill();
        ctx.fillStyle = labelColour;
      }
      const name = inCloseup ? h.runner.name : h.runner.name.split(' ').slice(-1)[0];
      ctx.fillText(name, x + 10, labelY);
      ctx.restore();
    }

    // Per-horse finish-position pill — RESTRICTED to replay mode AND
    // only when we have a real beaten-distance string to attach.
    // In forecast mode the pills were pure noise (the leaderboard
    // already covers positions); in replay they carry editorial weight
    // ("3rd · +1¼"). So we gate on REPLAY_DATA.has_result and only
    // render for ranks 2-4 where the beaten distance adds new info.
    const hasResultPillData = REPLAY_DATA && REPLAY_DATA.has_result;
    if (inCloseup && top4 && hasResultPillData) {
      const rank = top4.indexOf(h) + 1;
      const gap = rank > 1 ? (REPLAY_DATA.beaten_distances || {})[h.runner.id] : null;
      if (rank >= 1 && rank <= 4 && (rank === 1 || gap)) {
        const rankColour = rank === 1 ? '#D4AF37'
                         : rank === 2 ? '#C0C0C0'
                         : rank === 3 ? '#CD7F32'
                         : 'rgba(245,228,154,0.85)';
        const ord = rank === 1 ? 'st'
                  : rank === 2 ? 'nd'
                  : rank === 3 ? 'rd' : 'th';
        const label = (rank === 1) ? (rank + ord) : (rank + ord + ' · +' + gap);
        ctx.save();
        ctx.font = `bold 11px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        const lw = ctx.measureText(label).width;
        const labelX = x + 10;
        const labelY = y + bob + (scale * 22);
        ctx.fillStyle = 'rgba(6,8,15,0.82)';
        ctx.beginPath();
        ctx.roundRect(labelX - lw/2 - 7, labelY - 11, lw + 14, 16, 4);
        ctx.fill();
        ctx.fillStyle = rankColour;
        ctx.fillText(label, labelX, labelY);
        ctx.restore();
      }
    }
  });
}

// Coat colours — single hardcoded brown across the field so jockey
// silks do the differentiating. Two tones: body fill + leg/mane shadow.
const HORSE_COAT       = '#3a2510';
const HORSE_COAT_SHADE = '#1f1408';

function drawHorseSilhouette(x, y, horse, isUser, isFox, isLeader, progress, scale) {
  scale = scale || 0.85;   // slight upscale from the old 0.75 — the new
                            // silhouette has more detail to read at a glance
  // Two-phase Muybridge gait: when sinT > 0 the front legs are
  // extended forward together and the back legs tuck under; when < 0
  // the opposite. Driven by horse.legPhase (advanced in updateHorses).
  const sinT = Math.sin(horse.legPhase);
  const cosT = Math.cos(horse.legPhase);
  const silk  = horse.runner.silk  || '#C8A951';
  const silk2 = horse.runner.silk2 || '#1A2540';

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // ── Track shadow ─────────────────────────────────────────
  // Single biggest grounding effect — without this every horse
  // reads as floating above the turf. Flattened ellipse, soft.
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, 22, 28, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Selection glow ──────────────────────────────────────
  if (isUser || isFox || isLeader) {
    const glowC = isUser ? 'rgba(212,175,55,0.45)' :
                  isFox  ? 'rgba(220,130,30,0.38)' :
                           'rgba(255,255,255,0.22)';
    const grd = ctx.createRadialGradient(0, 0, 4, 0, 0, 38);
    grd.addColorStop(0, glowC);
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(2, 0, 38, 20, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Dust kick-up trail ──────────────────────────────────
  // Three fading puffs behind the hooves — sells motion + speed.
  // Cheap: no particle system, recomputed each frame.
  for (let i = 0; i < 3; i++) {
    const dx = -18 - i * 7 + (i % 2 === 0 ? 0 : -2);
    const dy = 18 + i * 2;
    ctx.fillStyle = `rgba(170,150,120,${0.28 - i * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 5 + i, 3 + i * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Back legs (drawn first so body sits on top) ─────────
  const backLegY = sinT > 0 ? 22 : 28;
  const backLegX = sinT > 0 ? -4 : -14;
  ctx.strokeStyle = HORSE_COAT_SHADE;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  // Back-far
  ctx.beginPath();
  ctx.moveTo(-8, 7);
  ctx.lineTo(backLegX - 1, backLegY);
  ctx.stroke();
  // Back-near
  ctx.beginPath();
  ctx.moveTo(-6, 8);
  ctx.lineTo(backLegX + 2, backLegY + 1);
  ctx.stroke();

  // ── Torso ───────────────────────────────────────────────
  // Sleek galloping shape: arched back, narrow flank, broad chest.
  ctx.fillStyle = HORSE_COAT;
  ctx.beginPath();
  ctx.moveTo(-16, 1);                            // rump base / tail anchor
  ctx.bezierCurveTo(-15, -7, -4, -9, 8, -8);     // top of back arc
  ctx.bezierCurveTo(18, -8, 22, -4, 22, 0);      // withers → shoulder
  ctx.bezierCurveTo(22, 4, 18, 7, 10, 7);        // chest underline
  ctx.bezierCurveTo(2, 8, -8, 7, -16, 4);        // belly → rump
  ctx.closePath();
  ctx.fill();

  // Subtle muscle-tone highlight on the back
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(-10, -4);
  ctx.bezierCurveTo(-4, -7, 8, -7, 16, -5);
  ctx.bezierCurveTo(14, -3, 0, -3, -10, -4);
  ctx.closePath();
  ctx.fill();

  // ── Neck + head (forward-extended gallop pose) ──────────
  ctx.fillStyle = HORSE_COAT;
  ctx.beginPath();
  ctx.moveTo(20, -2);
  ctx.bezierCurveTo(26, -6, 32, -9, 36, -10);    // top of neck
  ctx.bezierCurveTo(38, -9, 38, -6, 36, -5);     // jowl / throat
  ctx.bezierCurveTo(30, -3, 22, 0, 22, 2);       // back to chest
  ctx.closePath();
  ctx.fill();

  // Head — small, pointed forward
  ctx.beginPath();
  ctx.ellipse(37, -10, 5, 3.5, 0.35, 0, Math.PI * 2);
  ctx.fill();
  // Nose
  ctx.beginPath();
  ctx.ellipse(41, -8, 2.5, 1.8, 0.5, 0, Math.PI * 2);
  ctx.fill();
  // Eye
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(37, -11, 0.6, 0, Math.PI * 2);
  ctx.fill();
  // Ear
  ctx.fillStyle = HORSE_COAT;
  ctx.beginPath();
  ctx.moveTo(34, -13);
  ctx.lineTo(35, -15);
  ctx.lineTo(36, -13);
  ctx.closePath();
  ctx.fill();

  // ── Mane (5 wisps flowing back from neck top) ───────────
  ctx.strokeStyle = HORSE_COAT_SHADE;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const mx = 24 + i * 2.5;
    const my = -8 + i * 0.4;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.quadraticCurveTo(mx - 3, my - 1 + cosT * 0.5, mx - 6, my + 1);
    ctx.stroke();
  }

  // ── Tail (thick stem + flowing wisps) ───────────────────
  ctx.strokeStyle = HORSE_COAT_SHADE;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, 1);
  ctx.bezierCurveTo(-22, -1 + sinT * 1.5, -28, 1, -30, 5);
  ctx.stroke();
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-20 - i * 2, -1 + i * 1.2);
    ctx.quadraticCurveTo(-26 - i * 2, 1 + i + sinT, -29 - i * 2, 4 + i);
    ctx.stroke();
  }

  // ── Front legs (drawn last — on top of body) ────────────
  const frontLegY = sinT > 0 ? 26 : 22;
  const frontLegX = sinT > 0 ? 24 : 14;
  ctx.strokeStyle = HORSE_COAT_SHADE;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(16, 5);
  ctx.lineTo(frontLegX + 1, frontLegY + 1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(18, 6);
  ctx.lineTo(frontLegX - 1, frontLegY);
  ctx.stroke();

  // ── Jockey (proper aero crouch) ─────────────────────────
  // Silk body — arched back, butt up, head down toward reins.
  ctx.fillStyle = silk;
  ctx.beginPath();
  ctx.moveTo(-2, -9);
  ctx.bezierCurveTo(2, -16, 12, -17, 18, -13);
  ctx.bezierCurveTo(20, -11, 18, -9, 14, -8);
  ctx.bezierCurveTo(8, -8, 0, -8, -2, -9);
  ctx.closePath();
  ctx.fill();

  // Silk colour-block stripe (chest band — the rider's identity at a glance)
  ctx.fillStyle = silk2;
  ctx.beginPath();
  ctx.moveTo(3, -15);
  ctx.lineTo(13, -13);
  ctx.lineTo(12, -10);
  ctx.lineTo(2, -12);
  ctx.closePath();
  ctx.fill();

  // Arms reaching forward to the reins
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
  // Helmet centre stripe
  ctx.fillStyle = silk;
  ctx.fillRect(16, -18, 6, 1.5);
  // Visor gleam
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(21, -17, 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Boot visible at horse's belly
  ctx.fillStyle = '#1a0a04';
  ctx.beginPath();
  ctx.ellipse(7, -3, 4, 2, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ── PARTICLES ─────────────────────────────────────────────────────────────────
function spawnConfetti(x, y, count, colour) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 8,
      vy: -Math.random() * 10 - 4,
      life: 1,
      decay: 0.012 + Math.random() * 0.01,
      size: 4 + Math.random() * 6,
      colour,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.2,
    });
  }
}

function drawParticles(dt) {
  pCtx.clearRect(0, 0, viewW, viewH);
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += 0.3; // gravity
    p.life -= p.decay;
    p.rot += p.rotV;

    pCtx.save();
    pCtx.globalAlpha = p.life;
    pCtx.translate(p.x, p.y);
    pCtx.rotate(p.rot);
    pCtx.fillStyle = p.colour;
    pCtx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.5);
    pCtx.restore();
  });
}

// ── COMMENTARY ────────────────────────────────────────────────────────────────
function fireCommentary(progress) {
  COMMENTARY_SCRIPT.forEach(c => {
    if (!firedCommentary.has(c.at) && progress >= c.at) {
      firedCommentary.add(c.at);
      setCommentaryText(_renderCommentary(c.text));
    }
  });
}

// Substitute {LEADER} / {USER} / {FOX} placeholders in a commentary
// template with the current race state. Falls through cleanly when
// a placeholder has no value (e.g. user didn't vote → {USER} is empty
// → the line still reads naturally because the surrounding comma is
// also stripped). No-op when the template has no placeholders.
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
    .replace(/,?\s*\{USER\}/g,   userName   ? ', ' + userName : '')
    .replace(/,?\s*\{FOX\}/g,    foxName    ? ', ' + foxName  : '')
    .replace(/\{LEADER\}/g,      leaderName || 'the leader')
    // Tidy any double-spaces or stray commas left behind.
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*\./g, '.');
}

function setCommentaryText(text) {
  currentCommentary = text;
  commentaryTimer = CONFIG.timings.commentaryHoldMs;
  const el = document.getElementById('racingCommentary');
  if (!el) return;
  gsap.fromTo(el,
    { opacity: 0, y: 6 },
    { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }
  );
  el.textContent = text;
}

function updateCommentary(dt) {
  commentaryTimer = Math.max(0, commentaryTimer - dt);
  if (commentaryTimer <= 0) {
    const el = document.getElementById('racingCommentary');
    if (el && parseFloat(el.style.opacity) > 0) {
      gsap.to(el, { opacity: 0, duration: 0.4 });
    }
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
      onComplete: () => {
        gsap.to(el, { opacity: 0, duration: 0.5, delay: duration / 1000 - 0.9 });
      }
    }
  );
}

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
// Mini jockey-cap SVG for the leaderboard — uses both silk colours
// + the same silk_pattern the parade jersey uses. So each row's cap
// matches the horse's jersey design (halved / hooped / striped /
// quartered / starred / solid). Pure two-tone read at a glance.
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

// Leaderboard layout constants — kept in sync with the CSS var
// --lb-row-h in experience.css. Reordered rows slide between Y
// positions via transform + CSS transition.
const LB_VISIBLE_ROWS = 8;
function _lbRowHeightPx() {
  const v = getComputedStyle(document.querySelector('.race-leaderboard') ||
                             document.body)
    .getPropertyValue('--lb-row-h').trim();
  const n = parseInt(v, 10);
  return n > 0 ? n : 26;
}

function buildLeaderboard() {
  const container = document.getElementById('raceLeaderboard');
  if (!container) return;
  // Build ONE row per runner with a stable data-runner id. Each row
  // is absolutely positioned (see CSS) — updateLeaderboard slides
  // them between Y positions via transform when ranks change. The
  // old approach (innerHTML rebuild every frame) destroyed every
  // row's identity each tick, so CSS transitions never ran and the
  // user couldn't see overtakes happen.
  const isMobile = window.innerWidth <= 768;

  // Honest AI win-probability bars — derived from sim_weight() which
  // drives the forecast outcome. Normalised across the field; bar
  // widths normalised relative to the field LEADER so the favourite
  // reads near-full and long-shots show visible-but-thin stubs.
  // Bars do NOT animate during the race — pre-race signal, frozen
  // for the duration. The position number flips live; the bar stays.
  //
  // parseFloat() defends against the runner-payload serialiser
  // emitting weight as a numeric string in some shapes — without it,
  // (string || 0) keeps the string and the sum coerces to NaN
  // ('5.7' + 0 + 0 + ...) → probabilities collapse to a constant.
  const horseWeight = (h) => parseFloat(h.runner.weight) || 0;
  const totalWeight = horses.reduce((s, h) => s + horseWeight(h), 0) || 1;
  const maxProb = Math.max(...horses.map(h => horseWeight(h) / totalWeight));

  container.innerHTML = horses.map(h => {
    const isUser = STATE.userPick && STATE.userPick.id === h.runner.id;
    const isFox  = STATE.foxPick  && STATE.foxPick.name === h.runner.name;
    const nameClass = isUser ? 'user-horse' : isFox ? 'fox-horse' : '';
    const shortName = isMobile
      ? h.runner.name.split(' ')[0]
      : h.runner.name.split(' ').slice(0, 2).join(' ');
    const prob = (h.runner.weight || 0) / totalWeight;
    const probPct = Math.round(prob * 100);
    const barWidth = maxProb > 0 ? Math.max(4, Math.round((prob / maxProb) * 100)) : 0;
    return (
      '<div class="race-lb-row" data-runner="' + h.runner.id + '" style="opacity:0">' +
        '<span class="race-lb-pos">—</span>' +
        '<span class="race-lb-silk">' + renderCapSvg(h.runner) + '</span>' +
        '<span class="race-lb-name-prob">' +
          '<span class="race-lb-name ' + nameClass + '">' + shortName + '</span>' +
          '<span class="race-lb-prob" title="AI win probability">' +
            '<span class="race-lb-prob__bar">' +
              '<span class="race-lb-prob__fill" style="width:' + barWidth + '%"></span>' +
            '</span>' +
            '<span class="race-lb-prob__pct">' + probPct + '%</span>' +
          '</span>' +
        '</span>' +
      '</div>'
    );
  }).join('');
}

function updateLeaderboard(progress) {
  if (horses.length === 0) return;
  const container = document.getElementById('raceLeaderboard');
  if (!container) return;

  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    const lb = document.querySelector('.race-leaderboard');
    if (lb) {
      if (progress >= 0.5) lb.classList.add('lb-shifted-left');
      else lb.classList.remove('lb-shifted-left');
    }
  }

  const rowH = _lbRowHeightPx();
  // Live ranking by current progress — recomputed every frame.
  const ranked = [...horses].sort((a, b) => b.progress - a.progress);
  ranked.forEach((h, rank) => {
    const row = container.querySelector(
      '[data-runner="' + h.runner.id + '"]');
    if (!row) return;
    const inView = rank < LB_VISIBLE_ROWS;
    if (inView) {
      row.style.transform = 'translateY(' + (rank * rowH) + 'px)';
      row.style.opacity = '1';
      row.style.zIndex = String(LB_VISIBLE_ROWS - rank);
      const posEl = row.querySelector('.race-lb-pos');
      if (posEl) {
        posEl.textContent = rank + 1;
        const cls = rank === 0 ? ' p1'
                  : rank === 1 ? ' p2'
                  : rank === 2 ? ' p3' : '';
        posEl.className = 'race-lb-pos' + cls;
      }
    } else {
      // Slide rows that have dropped out of the visible top-8 down
      // and fade — when they climb back in, they slide up again.
      row.style.transform = 'translateY(' + (LB_VISIBLE_ROWS * rowH) + 'px)';
      row.style.opacity = '0';
      row.style.zIndex = '0';
    }
  });
}

function setPhaseTitle(text) {
  const el = document.getElementById('phaseTitle');
  if (!el || el.textContent === text) return;
  el.textContent = text;
  // Subtle GSAP fade so phase changes feel like a beat, not a flicker.
  gsap.fromTo(el,
    { opacity: 0.55, scale: 0.98 },
    { opacity: 1,    scale: 1,    duration: 0.35, ease: 'power2.out' }
  );
}

// Phase progress strip — lazy-builds a horizontal dot row at the top
// of the race screen. Each dot maps to one phase from CONFIG.phaseTable.
// Past phases render as filled gold, the current as a pulsing larger
// dot, future as recessed empty dots. Tells the viewer where they
// are in the race arc without needing to read the phase title.
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
  // Rails fill proportionally to the segment between phases.
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

// ── RACE FINISH ───────────────────────────────────────────────────────────────
function raceFinish() {
  const winner = STATE.simResult.winner;
  const positions = STATE.simResult.positions;

  // Confetti burst at finish line — count, interval and colours are
  // CONFIG-driven so editorial can dial up/down the celebration.
  const finishX = viewW * CONFIG.track.finishX;
  const midY    = viewH * 0.5;
  const T       = CONFIG.timings;
  const C       = CONFIG.colours;

  for (let i = 0; i < T.raceEndConfettiBursts; i++) {
    setTimeout(() => {
      spawnConfetti(finishX, midY, 25, C.gold);
      spawnConfetti(finishX, midY, 20, C.goldLight);
      spawnConfetti(finishX, midY, 15, '#ffffff');
    }, i * T.raceEndConfettiIntervalMs);
  }

  // Commentary
  setCommentaryText(`${winner.name} wins! What a race!`);
  showSubtitle(`${winner.name} — the winner!`, T.winnerHoldMs);

  // Keep drawing for the configured hold period (confetti playout),
  // then run the roll call. The roll call walks every finisher last
  // → first; its winner card dissolves into the reveal trophy.
  setTimeout(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
    pCtx.clearRect(0, 0, viewW, viewH);
    runRollCall(positions, winner);
  }, T.winnerHoldMs);
}

// ── ROLL CALL ─────────────────────────────────────────────────────────────────
// Post-race walkthrough of every finisher, LAST → FIRST. Parade-ring
// visual language; each card holds for a position-specific beat;
// the 1st card dissolves into the reveal trophy.

// Per-rank hold durations. Back-of-field is brisk so big fields don't
// overstay; podium gets a held beat; winner gets the climax. Edit
// here to retune cadence.
const ROLLCALL_HOLD = {
  back:   750,
  third:  1400,
  second: 1600,
  first:  2500,
};
const ROLLCALL_FADE_MS = 220;
let rollCallSkipped = false;

window.skipRollCall = function() {
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
  // Beaten-distance pill — only for non-winners in replay mode.
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
  // Dots fill in left-to-right as we walk last → first. currentDoneCount
  // is the number of cards already revealed (including the current one).
  let html = '';
  for (let i = 0; i < total; i++) {
    let cls = 'rollcall-progress__dot';
    if (i < currentDoneCount - 1)      cls += ' rollcall-progress__dot--done';
    else if (i === currentDoneCount - 1) cls += ' rollcall-progress__dot--current';
    html += '<span class="' + cls + '"></span>';
  }
  return html;
}

function runRollCall(positions, winner) {
  rollCallSkipped = false;
  // Empty or single-runner edge cases — straight to reveal.
  if (!positions || positions.length === 0) {
    transitionToReveal(winner, positions);
    return;
  }

  // GSAP-fade from race screen to roll-call. Same shape as transitionToReveal
  // so the swap feels consistent.
  gsap.to('#screen-race', {
    opacity: 0, duration: 0.6, ease: 'power2.in',
    onComplete: () => {
      showScreen('rollcall');
      gsap.fromTo('#screen-rollcall',
        { opacity: 0 },
        { opacity: 1, duration: 0.5, onComplete: () => _rollCallStep(positions, winner, 0) }
      );
    }
  });
}

function _rollCallStep(positions, winner, idx) {
  // Skip pressed — jump straight to reveal with the winner card.
  if (rollCallSkipped) {
    transitionToReveal(winner, positions);
    return;
  }
  const total = positions.length;
  // idx 0 = last finisher; idx total-1 = winner.
  if (idx >= total) {
    transitionToReveal(winner, positions);
    return;
  }
  const rank = total - idx;          // converts walkthrough idx to finishing position
  const horse = positions[rank - 1]; // positions array is ordered 1st → last
  const stage = document.getElementById('rollcallStage');
  const progress = document.getElementById('rollcallProgress');
  if (stage)    stage.innerHTML    = _buildRollCallCard(horse, rank, total);
  if (progress) progress.innerHTML = _buildRollCallProgress(total, idx + 1);

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
    // Winner card: don't fade out — dissolve straight into reveal so
    // there's no dark cut. transitionToReveal handles the screen swap.
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

// ── ACT 3: THE REVEAL ─────────────────────────────────────────────────────────
function transitionToReveal(winner, positions) {
  // Fade both potentially-active screens. In the normal flow the race
  // screen is already invisible by now and the rollcall screen is
  // live; on the skip-to-reveal path either could be the active one.
  // GSAP handles multi-selector targets natively.
  gsap.to('#screen-race, #screen-rollcall', {
    opacity: 0, duration: 0.8, ease: 'power2.in',
    onComplete: () => {
      buildRevealScreen(winner, positions);
      showScreen('reveal');
      gsap.fromTo('#screen-reveal',
        { opacity: 0 },
        { opacity: 1, duration: 0.5, onComplete: animateReveal }
      );
    }
  });
}

function buildRevealScreen(winner, positions) {
  const isUserWin = STATE.userPick && STATE.userPick.id === winner.id;
  const isFoxWin  = STATE.foxPick  && STATE.foxPick.name === winner.name;

  // Background colour
  const revBg = document.getElementById('revealBg');
  if (revBg) {
    revBg.style.background = isUserWin
      ? 'radial-gradient(ellipse 100% 100% at 50% 50%, rgba(212,175,55,0.12), transparent 65%)'
      : 'radial-gradient(ellipse 100% 100% at 50% 50%, rgba(192,57,43,0.08), transparent 65%)';
  }

  // Silk badge beneath the trophy — matches the parade card style
  // so the winner's identity reads consistently across the experience.
  const silkEl = document.getElementById('revealSilk');
  if (silkEl) {
    silkEl.classList.add('reveal-silk--jersey');
    silkEl.innerHTML = renderSilkSvg(winner);
  }

  // Horse name
  const nameEl = document.getElementById('revealHorseName');
  if (nameEl) nameEl.textContent = winner.name;

  // Odds
  const oddsEl = document.getElementById('revealOdds');
  if (oddsEl) oddsEl.textContent = winner.odds;

  // Verdict
  const vBox = document.getElementById('revealVerdictBox');
  const vTitle = document.getElementById('revealVerdictTitle');
  const vText  = document.getElementById('revealVerdictText');

  if (vBox && vTitle && vText) {
    if (isUserWin) {
      vBox.className = 'reveal-verdict-box reveal-verdict-box--win';
      vTitle.textContent = '🏆 You called it!';
      vText.innerHTML  = `Your pick of <strong>${winner.name}</strong> won the simulated ${STATE.raceName}. Ahead of Mr Fox. The crowd agrees.`;
    } else if (isFoxWin) {
      vBox.className = 'reveal-verdict-box reveal-verdict-box--lose';
      vTitle.textContent = '🦊 The Fox wins again.';
      vText.innerHTML  = `Mr Fox\'s selection <strong>${winner.name}</strong> takes it. Experience beats instinct — this time.`;
    } else {
      vBox.className = 'reveal-verdict-box';
      vTitle.textContent = '⚡ Nobody saw that coming.';
      vText.innerHTML  = `<strong>${winner.name}</strong> at ${winner.odds}. Neither the Fox nor the Cubs called this one.`;
    }
  }

  // Scores
  buildRevealScores(winner, positions);

  // Podium
  buildPodium(positions.slice(0, 3));
}

function buildRevealScores(winner, positions) {
  const container = document.getElementById('revealScores');
  if (!container) return;

  const userPick = STATE.userPick;
  const foxPick  = STATE.foxPick;

  const cards = [];

  if (userPick) {
    const userWon = userPick.id === winner.id;
    const userPos = positions.findIndex(r => r.id === userPick.id) + 1;
    cards.push(`
      <div class="reveal-score-card ${userWon ? 'reveal-score-card--win' : 'reveal-score-card--lose'}">
        <div class="reveal-score-card__who">🐾 Your Pick</div>
        <div class="reveal-score-card__pick">${userPick.name}</div>
        <div class="reveal-score-card__result">
          ${userWon ? '✓ WINNER' : `Finished ${userPos}${ordinal(userPos)}`}
        </div>
      </div>
    `);
  }

  if (foxPick) {
    const foxWon = foxPick.name === winner.name;
    const foxPos = positions.findIndex(r => r.name === foxPick.name) + 1;
    cards.push(`
      <div class="reveal-score-card ${foxWon ? 'reveal-score-card--win' : 'reveal-score-card--lose'}">
        <div class="reveal-score-card__who">🦊 Fox's Pick</div>
        <div class="reveal-score-card__pick">${foxPick.name}</div>
        <div class="reveal-score-card__result">
          ${foxWon ? '✓ WINNER' : `Finished ${foxPos}${ordinal(foxPos)}`}
        </div>
      </div>
    `);
  }

  if (!userPick) {
    cards.push(`
      <div class="reveal-score-card reveal-score-card--neutral">
        <div class="reveal-score-card__who">🐾 Your Pick</div>
        <div class="reveal-score-card__pick">No pick cast</div>
        <div class="reveal-score-card__result"><a href="/members/profile/" style="color:var(--gold)">Cast your vote →</a></div>
      </div>
    `);
  }

  container.innerHTML = cards.join('');
}

function buildPodium(top3) {
  const container = document.getElementById('revealPodium');
  if (!container || top3.length < 1) return;

  const ordinals = ['1st', '2nd', '3rd'];
  const classes  = ['podium-slot--1st', 'podium-slot--2nd', 'podium-slot--3rd'];
  const order    = top3.length >= 3 ? [1, 0, 2] : [0, 1, 2]; // visual podium order: 2nd left, 1st centre, 3rd right

  // Replay mode: surface the raw beaten-distance string under each
  // non-winner so the user sees "+nk" / "+2¼" etc. Skipped on
  // forecast routes (no real result yet).
  const distances = (REPLAY_DATA && REPLAY_DATA.has_result)
    ? REPLAY_DATA.beaten_distances : null;

  const slots = order.slice(0, top3.length).map(i => {
    if (!top3[i]) return '';
    const r = top3[i];
    let gap = '';
    if (distances && i > 0) {
      const raw = distances[r.id];
      if (raw) gap = `<div class="podium-slot__gap">+${raw}</div>`;
    }
    return `
      <div class="podium-slot ${classes[i]}">
        <div class="podium-slot__silk" style="background:${r.silk};border-color:${r.silk2}">${r.number}</div>
        <div class="podium-slot__name">${r.name}</div>
        <div class="podium-slot__pos">${ordinals[i]}</div>
        ${gap}
      </div>
    `;
  });

  container.innerHTML = slots.join('');
}

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return s[(v-20)%10]||s[v]||s[0];
}

// ── REVEAL ANIMATION ──────────────────────────────────────────────────────────
function animateReveal() {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  // Fireworks burst — multiple waves
  const colours = ['#D4AF37','#F5E49A','#C0392B','#ffffff','#4cdb78','#FF6B35'];
  function fireworkBurst(wave) {
    const cx = viewW  * (0.2 + Math.random() * 0.6);
    const cy = viewH * (0.1 + Math.random() * 0.5);
    // Radial burst
    for (let i = 0; i < 50; i++) {
      const angle  = (i / 50) * Math.PI * 2;
      const speed  = 4 + Math.random() * 8;
      const colour = colours[Math.floor(Math.random() * colours.length)];
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1,
        decay: 0.015 + Math.random() * 0.01,
        size: 4 + Math.random() * 5,
        colour,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.15,
      });
    }
  }

  // Wave timing
  fireworkBurst(0);
  [400, 800, 1200, 1800, 2400, 3200].forEach((delay, i) => {
    setTimeout(() => fireworkBurst(i + 1), delay);
  });

  // Keep drawing particles
  let revealParticleFrame;
  function drawRevealParticles() {
    pCtx.clearRect(0, 0, viewW, viewH);
    drawParticles(16);
    if (particles.length > 0) {
      revealParticleFrame = requestAnimationFrame(drawRevealParticles);
    } else {
      pCtx.clearRect(0, 0, viewW, viewH);
    }
  }
  drawRevealParticles();

  // Trophy rise animation — drawn on pCanvas before elements appear
  drawRevealTrophy();

  tl
    .fromTo('.reveal-kicker',       { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5 }, 0.3)
    .fromTo('.reveal-winner-label', { opacity: 0 },         { opacity: 1, duration: 0.4 }, 0.9)
    .fromTo('#revealTrophyWrap',     { opacity: 0, scale: 0.4, rotation: -5 }, { opacity: 1, scale: 1, rotation: 0, duration: 1.0, ease: 'back.out(1.8)' }, 1.0)
    .fromTo('.reveal-horse-name',   { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7 }, 1.9)
    .fromTo('.reveal-horse-odds',   { opacity: 0 },         { opacity: 1, duration: 0.4 }, 2.5)
    .fromTo('.reveal-verdict-box',  { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5 }, 3.0)
    .fromTo('.reveal-podium',       { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5 }, 3.5)
    .fromTo('.reveal-scores',       { opacity: 0 },         { opacity: 1, duration: 0.4 }, 3.9)
    .fromTo('.reveal-actions',      { opacity: 0 },         { opacity: 1, duration: 0.4 }, 4.3);
}

// Trophy SVG drawn on particle canvas as a dramatic rising backdrop
function drawRevealTrophy() {
  const W = viewW, H = viewH;

  let trophyY = H + 200;
  const targetY = H * 0.15;
  let alpha = 0;
  let phase = 0;
  let done = false;

  function renderTrophy() {
    if (done) return;
    trophyY += (targetY - trophyY) * 0.06;
    alpha = Math.min(alpha + 0.025, 0.22);
    phase += 0.02;

    pCtx.save();
    pCtx.globalAlpha = alpha + Math.sin(phase) * 0.03;
    pCtx.translate(W / 2, trophyY);

    const s = Math.min(W, H) * 0.5;
    pCtx.scale(s / 120, s / 130);

    // Trophy body
    const grad = pCtx.createLinearGradient(-45, 0, 45, 0);
    grad.addColorStop(0, '#B8900A');
    grad.addColorStop(0.35, '#F5E49A');
    grad.addColorStop(0.65, '#D4AF37');
    grad.addColorStop(1, '#C8A020');
    pCtx.fillStyle = grad;

    // Cup
    pCtx.beginPath();
    pCtx.moveTo(-45, -60);
    pCtx.lineTo(45, -60);
    pCtx.quadraticCurveTo(55, -20, 40, 15);
    pCtx.quadraticCurveTo(20, 40, 0, 48);
    pCtx.quadraticCurveTo(-20, 40, -40, 15);
    pCtx.quadraticCurveTo(-55, -20, -45, -60);
    pCtx.closePath();
    pCtx.fill();

    // Handles
    pCtx.strokeStyle = '#D4AF37';
    pCtx.lineWidth = 10;
    pCtx.lineCap = 'round';
    pCtx.beginPath();
    pCtx.moveTo(-45, -40);
    pCtx.quadraticCurveTo(-80, -40, -80, 0);
    pCtx.quadraticCurveTo(-80, 30, -42, 10);
    pCtx.stroke();
    pCtx.beginPath();
    pCtx.moveTo(45, -40);
    pCtx.quadraticCurveTo(80, -40, 80, 0);
    pCtx.quadraticCurveTo(80, 30, 42, 10);
    pCtx.stroke();

    // Stem
    pCtx.fillStyle = '#D4AF37';
    pCtx.fillRect(-8, 48, 16, 28);
    // Base
    pCtx.fillRect(-40, 74, 80, 12);
    pCtx.fillRect(-50, 84, 100, 10);

    // Star on cup
    pCtx.fillStyle = 'rgba(255,255,200,0.5)';
    pCtx.beginPath();
    const sp = [0,-30, 6,-20, 16,-18, 8,-10, 10,2, 0,-4, -10,2, -8,-10, -16,-18, -6,-20];
    pCtx.moveTo(sp[0], sp[1]);
    for (let i = 2; i < sp.length; i+=2) pCtx.lineTo(sp[i], sp[i+1]);
    pCtx.closePath();
    pCtx.fill();

    pCtx.restore();

    if (Math.abs(trophyY - targetY) > 2 || alpha < 0.2) {
      requestAnimationFrame(renderTrophy);
    } else {
      done = true;
    }
  }
  requestAnimationFrame(renderTrophy);
}

// Skip-to-Finish — bumps the master clock so only ~10s of race
// remain. The existing raceLoop + end-rush detection + photo-finish
// gate + reveal transition all keep working unchanged; they just
// see the timer "jump" forward. Idempotent: a second click does
// nothing because raceTime can only move forward (Math.max).
const SKIP_TO_FINISH_REMAINING_MS = 10000;
window.skipToFinish = function() {
  if (!raceRunning || raceDuration <= 0) return;
  raceTime = Math.max(raceTime, raceDuration - SKIP_TO_FINISH_REMAINING_MS);
  const wrap = document.querySelector('.race-skip-wrap');
  if (wrap) wrap.classList.add('race-skip-hidden');
};

window.replayExperience = function() {
  gsap.to('#screen-reveal', {
    opacity: 0, duration: 0.4,
    onComplete: () => {
      particles = [];
      pCtx.clearRect(0, 0, viewW, viewH);
      // Reset state
      STATE.simResult = null;
      STATE.paradeIdx = 0;
      // User is back on the intro — restore the archive picker so
      // they can switch races if they want.
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
      showScreen('intro');
      gsap.to('#screen-intro', { opacity: 1, scale: 1, duration: 0.4 });
    }
  });
};

window.goToRacecard = function(url) {
  window.location.href = url;
};
