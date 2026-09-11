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

