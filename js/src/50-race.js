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
  resetLabels();

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

  // The rest of the field, drawn the way the winner was: take a runner
  // at random with probability proportional to its weight, remove it,
  // draw again. Repeated weighted sampling without replacement, which is
  // what "the order they finished in" means when the weights are win
  // probabilities.
  //
  // It used to sort on weight + Math.random() * 20. With the old additive
  // model that jitter was small against the spread, so the field lined up
  // in ability order almost every time — the race had a near-random
  // winner and near-deterministic placings behind it, which is the wrong
  // way round on both counts. A draw gives an outsider a real chance of
  // running second without ever making the favourite likely to finish
  // last.
  return [winner, ...weightedOrder(STATE.runners.filter((r) => r.id !== winner.id))];
}

// Repeated weighted draw without replacement. Runners with no weight at
// all still come out, in input order, once everything weighted has gone.
function weightedOrder(runners) {
  const pool = runners.slice();
  const out = [];
  while (pool.length) {
    let total = 0;
    for (const r of pool) total += Math.max(0, r.weight) || 0;
    let i = 0;
    if (total > 0) {
      let roll = Math.random() * total;
      for (; i < pool.length - 1; i++) {
        roll -= Math.max(0, pool[i].weight) || 0;
        if (roll <= 0) break;
      }
    }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
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
      stance:        drawStance(),
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
  const cycles = dx / (strideLocalFor(h.stance) * WORLD.horseScale * h.depth);
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
  line:   Object.freeze({ zoom: 1.50, anchorX: 0.62, groupBias: 1,    vignette: 0.40, letterbox: 0.070, shake: 2.6, camY: 12, tilt: 0.010, fieldFade: 0.46 }),
  post:   Object.freeze({ zoom: 1.70, anchorX: 0.60, groupBias: 1,    vignette: 0.50, letterbox: 0.066, shake: 3.1, camY: 12, tilt: 0.013, fieldFade: 0.54 }),
});

// WHY THE LAST TWO ARE SEPARATE SHOTS. The camera used to finish its work
// in the drive: cruise 1.05 → build 1.20 → drive 1.34 → line 1.36. The
// closing sequence, the part the whole race is built towards, added one
// and a half percent of zoom and then held. Everything else about the
// finish was directed — slow motion, flashguns, the rail — while the
// camera, which is the instrument that says "look at this", stopped
// moving exactly when it should have been working hardest.
//
// So `line` is a real push now, and `post` is a second one on top of it
// that arrives with the winner. 1.34 → 1.50 → 1.70, and then the finish
// timeline releases to 1.08 to show the post and the rest of the field
// coming through. That release already existed; it simply had almost
// nothing to release FROM.
//
// The near rail is what limits this, and it is not obvious. Zoom scales
// the lane band about its middle and camY shifts it down, so tightening
// the shot walks the nearest horse's hooves towards the bottom letterbox
// bar — which is drawn over the horses. A short viewport is the binding
// case: at 1440x620 the post shot leaves 21px under the near horse's
// feet, and lifting either the zoom or the letterbox much further starts
// cutting them off. camY is a trap here, because it spends that scarce
// margin to buy headroom at the far rail, where there is already more
// than a hundred pixels of it. Hence the same camY in both, and a
// letterbox that stops deepening. See the frame-safety test.

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

  // Nameplates. Up once the field has settled into a shape worth reading,
  // and they stay up through the run-in to the line.
  //
  // They used to be gone by the final furlong, on the theory that the
  // closing sequence is composed and plates across it would spoil the
  // best moment in the race. That was exactly backwards. The run-in is
  // where the field compresses into a single bunch of bodies, and it is
  // the one stretch where a viewer cannot answer "which one is that?"
  // from the picture alone — Live Positions can say Galiyan leads, but
  // only a plate on the horse can say which of the eight is Galiyan.
  // Taking the names away at the climax removed them at the only moment
  // they were indispensable.
  //
  // What survives of the original instinct is the count: plateFocus
  // narrows the set to the leaders through the closing stages, so the
  // finish is named without being papered over. They clear at the post
  // itself, where the winning-moment scene takes the frame.
  //
  // Held on DIRECTOR so a draw call never has to ask what the progress is.
  tl.to(DIRECTOR, { nameplates: 1, duration: durationS * 0.04, ease: 'sine.out' },
        durationS * 0.07);
  tl.to(DIRECTOR, { plateFocus: 1, duration: durationS * 0.06, ease: 'sine.inOut' },
        durationS * (phaseFrom('line') - 0.04));
  tl.to(DIRECTOR, { nameplates: 0, duration: durationS * 0.015, ease: 'sine.in' },
        durationS * 0.985);

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

  // The run to the post, then the post itself. sine.inOut eases into the
  // first; power2.in gives the second no let-up, so it is still
  // accelerating as the winner reaches the line rather than settling
  // before it.
  tl.to(DIRECTOR, shot('line', { duration: seg * 0.52, ease: 'sine.inOut' }), 'line');
  tl.to(DIRECTOR, shot('post', { duration: seg * 0.46, ease: 'power2.in' }),
        'line+=' + (seg * 0.52));

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

