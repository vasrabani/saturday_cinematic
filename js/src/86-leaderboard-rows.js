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

  // Win-probability bars — the same weights the forecast draws its winner
  // from, normalised across the field so they sum to 100%. Honest pre-race
  // signal: these are what the model thinks NOW, not animated "fake
  // convergence" during the race. The position number flips live during
  // play; the bar stays fixed — that's the contract with the viewer.
  //
  // Which is why an unpriced race shows no bars at all. The weights are
  // led by the market, so with no market every runner weighs the same and
  // the panel would print an identical percentage against all of them —
  // a number derived from nothing, under a label reading "win
  // probability". On an ante-post or pre-declaration card the honest
  // answer is to say nothing, so the name simply takes the whole row.
  const priced = horses.some((h) => h.runner.priced);
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
        (priced
          ? '<span class="race-lb-prob" title="Forecast win chance">' +
              '<span class="race-lb-prob__bar">' +
                '<span class="race-lb-prob__fill" style="width:' + barWidth + '%"></span>' +
              '</span>' +
              '<span class="race-lb-prob__pct">' + probPct + '%</span>' +
            '</span>'
          : '') +
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

