// ─── Race finish → roll call ───────────────────────────────────
let revealMargin = null;

function raceFinish(margin) {
  raceRunning = false;
  stopTicker();
  revealMargin = margin;

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
      startPosterHero();
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

  // How he won it. The margin is the one fact the podium cannot show, and
  // it is what a reader repeats afterwards.
  const marginEl = document.getElementById('revealMargin');
  if (marginEl) {
    const lengths = revealMargin ? revealMargin.lengths : null;
    marginEl.textContent = lengths === -1 ? 'Dead heat'
      : (lengths === null || lengths === undefined) ? ''
      : 'Won by ' + formatBeatenDistanceCompact(lengths);
  }

  const metaEl = document.getElementById('revealRaceMeta');
  if (metaEl) {
    metaEl.textContent = [STATE.raceName, STATE.raceCourse, STATE.raceTime, STATE.raceDistance]
      .filter(Boolean).join('  ·  ');
  }

  const connEl = document.getElementById('revealConnections');
  if (connEl) {
    const bits = [];
    if (winner.jockey)  bits.push('<span>JOCKEY</span> ' + esc(winner.jockey));
    if (winner.trainer) bits.push('<span>TRAINER</span> ' + esc(winner.trainer));
    connEl.innerHTML = bits.join('<b>·</b>');
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
  tl.to('.winner-poster__rule',    { opacity: 1, scaleX: 1, duration: 0.45, transformOrigin: 'left center' }, '-=0.2');
  tl.call(spawnRevealConfetti, null, '-=0.3');
  tl.to('#revealHorseName',        { opacity: 1, y: 0, duration: 0.5 }, '-=0.25');
  tl.to('.winner-poster__winnerline', { opacity: 1, y: 0, duration: 0.35 }, '-=0.2');
  tl.to('#revealMargin',           { opacity: 1, y: 0, duration: 0.3 }, '-=0.15');
  tl.to('#revealRaceMeta, #revealConnections', { opacity: 1, duration: 0.35, stagger: 0.08 }, '-=0.1');
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
  stopPosterHero();
  revealMargin = null;
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
  gsap.set('.reveal-kicker, #revealRaceMeta, #revealConnections', { opacity: 0 });
  gsap.set('.winner-poster__rule', { opacity: 0, scaleX: 0 });
  gsap.set('#revealHorseName', { opacity: 0, y: 20 });
  gsap.set('.winner-poster__winnerline', { opacity: 0, y: 10 });
  gsap.set('#revealMargin', { opacity: 0, y: 8 });
  gsap.set('#revealVerdictBox', { opacity: 0, y: 12 });
  gsap.set('#revealPodium', { opacity: 0, y: 10 });
  gsap.set('.reveal-actions', { opacity: 0 });
}

