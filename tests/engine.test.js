// Unit tests for the pure logic in js/flat.js: `npm test` (node --test).
// The engine is loaded into an inert browser by load-engine.js; these
// tests only call what it exposes on FlatEngine.internals.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./load-engine');

const E = loadEngine().internals;

// Values built inside the engine's vm context have that context's
// prototypes; strict deep-equality compares prototypes, so compare plain
// copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Deterministic Math.random for the tests that invent a race.
function seeded(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('exposes the public API', () => {
  const api = loadEngine();
  for (const name of ['init', 'startExperience', 'skipParade', 'skipToFinish', 'skipRollCall', 'replayExperience']) {
    assert.equal(typeof api[name], 'function', name);
  }
});

test('parseBeatenDistance reads Racing API distances', () => {
  const p = E.parseBeatenDistance;
  assert.equal(p('nse'), 0.05);
  assert.equal(p('shd'), 0.10);
  assert.equal(p('hd'), 0.15);
  assert.equal(p('nk'), 0.25);
  assert.equal(p('1/2'), 0.5);
  assert.equal(p('1 1/2'), 1.5);
  assert.equal(p('3/4L'), 0.75);
  assert.equal(p('½'), 0.5);
  assert.equal(p('.5'), 0.5);
  assert.equal(p('13'), 13);
  assert.equal(p('dist'), 99);
  assert.equal(p('DH'), -1);
  assert.equal(p(''), null);
  assert.equal(p(null), null);
  assert.equal(p('n/a'), null);
});

test('formatBeatenDistance writes racing copy', () => {
  const f = E.formatBeatenDistance;
  assert.equal(f(0.05), 'A NOSE');
  assert.equal(f(0.1), 'A SHORT HEAD');
  assert.equal(f(0.15), 'A HEAD');
  assert.equal(f(0.25), 'A NECK');
  assert.equal(f(0.5), 'HALF A LENGTH');
  assert.equal(f(0.75), 'THREE-QUARTERS OF A LENGTH');
  assert.equal(f(1), 'A LENGTH');
  assert.equal(f(1.25), '1¼ LENGTHS');
  assert.equal(f(2.5), '2½ LENGTHS');
  assert.equal(f(13), '13 LENGTHS');
  assert.equal(f(60), 'A DISTANCE');
  assert.equal(f(null), '');
  assert.equal(E.formatBeatenDistanceCompact(1.75), '1¾L');
  assert.equal(E.formatBeatenDistanceCompact(-1), 'DH');
});

test('ordinal suffixes, including the teens and twenties', () => {
  const o = E.ordinal;
  const cases = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th',
                  21: '21st', 22: '22nd', 23: '23rd', 24: '24th', 101: '101st', 111: '111th', 112: '112th' };
  for (const [n, want] of Object.entries(cases)) assert.equal(o(Number(n)), want);
});

test('invented finishing gaps are a close finish, in finishing order', () => {
  const field = Array.from({ length: 24 }, (_, i) => ({ id: i + 1 }));
  for (let s = 1; s <= 20; s++) {
    const gaps = E.inventFinishGaps(field, 'stayer', null, seeded(s));
    assert.equal(gaps.length, 24);
    assert.equal(gaps[0], 0);
    for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] >= gaps[i - 1], 'monotonic at ' + i);
    assert.ok(gaps[1] <= 0.4, 'winner by a neck at most, got ' + gaps[1]);
    assert.ok(gaps[8] <= 5.5, 'nine inside five and a half lengths, got ' + gaps[8]);
    assert.ok(gaps[23] <= E.MAX_VISIBLE_LENGTHS);
  }
});

test('invented gaps honour the real winning margin and a dead heat', () => {
  const field = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(E.inventFinishGaps(field, 'mile', 0.2, seeded(1))[1], 0.2);
  assert.equal(E.inventFinishGaps(field, 'mile', 0, seeded(1))[1], 0);
});

test('race progress eases out of the stalls and is continuous', () => {
  const f = E.raceProgressEase, a = E.START_EASE;
  assert.equal(f(0), 0);
  assert.ok(Math.abs(f(1) - 1) < 1e-12);
  const eps = 1e-7;
  assert.ok(Math.abs(f(a - eps) - f(a + eps)) < 1e-6, 'continuous at the join');
  const slope = (x) => (f(x + eps) - f(x - eps)) / (2 * eps);
  assert.ok(Math.abs(slope(a - 1e-4) - slope(a + 1e-4)) < 1e-2, 'no jolt at the join');
  let prev = -1;
  for (let x = 0; x <= 1; x += 0.01) { assert.ok(f(x) >= prev); prev = f(x); }
});

test('the run-through leaves the line at race pace and pulls up smoothly', () => {
  const v = 3.8, R = (t) => E.runOnPast(t, v);
  assert.equal(R(0), 0);
  const eps = 1e-6;
  assert.ok(Math.abs(R(eps) / eps - v) < 1e-3, 'crosses the line at race speed');
  let prev = 0;
  for (let t = 0.1; t < 10; t += 0.1) { assert.ok(R(t) > prev); prev = R(t); }
  const late = (R(20 + eps) - R(20)) / eps;
  assert.ok(Math.abs(late - v * E.EASE_TO) < 1e-3, 'settles at EASE_TO of race pace');
});

test('the result card waits for seven finishers, within its bounds', () => {
  const close = Array.from({ length: 24 }, (_, i) => i * 0.3);
  const runaway = [0, 13, 15, 16.5, 18, 19.5, 21, 22.5, 24, 25.5];
  const a = E.finishPauseS(close, 3.8, 0.55);
  const b = E.finishPauseS(runaway, 3.8, 0.55);
  assert.equal(a, E.FINISH_PAUSE_S, 'a close finish keeps the minimum pause');
  assert.ok(b > a && b <= E.FINISH_PAUSE_MAX_S, 'a runaway waits longer, but not forever: ' + b);
});

// Every horse now has its own stance, so the invariant has to hold across
// the whole band and not just at the reference horse. If it ever fails,
// hooves skate over the turf again — the fault the distance-driven gait
// exists to prevent, and the one the small far-lane horses showed worst.
const STANCES = () => {
  const lo = E.STANCE * (1 - E.STANCE_SPREAD), hi = E.STANCE * (1 + E.STANCE_SPREAD);
  return [lo, E.STANCE, hi, (lo + E.STANCE) / 2, (hi + E.STANCE) / 2];
};

test('a planted hoof sweeps exactly one stride sweep, so it cannot skate', () => {
  for (const stance of STANCES()) {
    for (const [name, leg] of Object.entries(E.LEG_RIG)) {
      const where = name + ' at stance ' + stance.toFixed(4);
      assert.equal(leg.front - leg.back, E.STRIDE_SWEEP, name);
      const strike = E.hoofPath(0, leg.front, leg.back, leg.lift, leg.fore, stance);
      const lift = E.hoofPath(stance - 1e-9, leg.front, leg.back, leg.lift, leg.fore, stance);
      assert.ok(strike.planted && lift.planted, where + ' planted through the stance');
      assert.ok(Math.abs(strike.x - lift.x - E.STRIDE_SWEEP) < 1e-6, where + ' sweep');
      assert.ok(!E.hoofPath(stance + 1e-9, leg.front, leg.back, leg.lift, leg.fore, stance).planted,
                where + ' swings the instant the stance ends');
    }
    // The whole point: one cycle carries the horse sweep/stance, so a
    // shorter stance is a longer stride. placeHorse divides by exactly
    // this, which is what keeps the hoof on the ground.
    assert.ok(Math.abs(E.strideLocalFor(stance) - E.STRIDE_SWEEP / stance) < 1e-12);
  }
  assert.ok(Math.abs(E.STRIDE_LOCAL - E.STRIDE_SWEEP / E.STANCE) < 1e-12);
  assert.equal(E.strideLocalFor(0), E.STRIDE_LOCAL, 'a horse with no stance falls back to the reference');
  assert.equal(E.suspensionFrom(0), E.suspensionFrom(E.STANCE));
});

// The rig is tuned close to full extension at the moment of strike, which
// is why stance is the dial rather than the drawn sweep. If a planted hoof
// ever stopped reaching the ground, solveLeg would silently clamp it and
// the horse would run on tiptoe.
//
// Poses come from stridePose rather than a sweep of cyc x bodyLift x
// pitch. The cross-product contains poses the horse cannot be in — full
// suspension lift at the moment a foreleg strikes, for one — and the rig
// misses the ground by three units in those, which means nothing. Body
// lift is a function of where in the cycle the horse is, so the only
// honest test is to ask the gait for the pose and check that one.
test('a planted hoof actually reaches the ground at every stance', () => {
  for (const stance of STANCES()) {
    for (let i = 0; i < 400; i++) {
      const pose = E.stridePose({ legPhase: (i / 400) * Math.PI * 2, stance, swayPhase: i * 0.017 });
      const legs = E.solveHorseLegs(pose);
      for (const [key, leg] of Object.entries(legs)) {
        if (!leg.planted) continue;
        const want = (28 - pose.bodyLift) - leg.fx * pose.pitch;
        // Measured worst across the band is 0.48, on a horse drawn 74
        // units long — under 0.7% of its length, and invisible. A real
        // IK clamp misses by several units, so this catches that without
        // pinning the rig's existing slack.
        assert.ok(Math.abs(leg.fy - want) < 0.6,
                  key + ' is off the ground by ' + (leg.fy - want).toFixed(3) +
                  ' at cyc ' + pose.cyc.toFixed(3) + ', stance ' + stance.toFixed(4));
      }
    }
  }
});

// Two horses at the same speed must NOT turn their legs over at the same
// rate. That identity is what made the field gallop as one animal.
test('stride length varies between horses, within a believable band', () => {
  let lo = Infinity, hi = -Infinity;
  let seq = 0;
  const rand = () => ((seq = (seq + 0.137) % 1), seq);
  for (let i = 0; i < 500; i++) {
    const st = E.drawStance(rand);
    lo = Math.min(lo, st); hi = Math.max(hi, st);
  }
  assert.ok(lo >= E.STANCE * (1 - E.STANCE_SPREAD) - 1e-12, 'stance under the band: ' + lo);
  assert.ok(hi <= E.STANCE * (1 + E.STANCE_SPREAD) + 1e-12, 'stance over the band: ' + hi);

  // The cadence spread that produces, at one speed. Enough to read as
  // individual horses; not so much that one looks broken.
  const ratio = E.strideLocalFor(lo) / E.strideLocalFor(hi);
  assert.ok(ratio > 1.15, 'cadence spread too small to see: ' + ratio.toFixed(3));
  assert.ok(ratio < 1.45, 'cadence spread implausibly wide: ' + ratio.toFixed(3));
});

test('two-bone IK keeps both bones at their length', () => {
  const s = E.solveLeg(0, 0, 6, 25, 14, 16.2, -1);
  assert.ok(Math.abs(Math.hypot(s.jx, s.jy) - 14) < 1e-9, 'upper bone');
  assert.ok(Math.abs(Math.hypot(s.fx - s.jx, s.fy - s.jy) - 16.2) < 1e-9, 'lower bone');
  assert.ok(Math.abs(s.fx - 6) < 1e-9 && Math.abs(s.fy - 25) < 1e-9, 'reaches the target');
});

// Stands in for a canvas context: records each sub-path as a polygon, an
// arc sampled along its sweep.
function pathRecorder() {
  const shapes = [];
  let current = null;
  return {
    shapes,
    moveTo(x, y) { current = [[x, y]]; shapes.push(current); },
    lineTo(x, y) { current.push([x, y]); },
    closePath() {},
    arc(x, y, r, start, end, anticlockwise) {
      const sweep = anticlockwise ? -(Math.PI * 2) : Math.PI * 2;   // the engine only draws whole circles
      for (let i = 1; i <= 64; i++) {
        const a = start + sweep * i / 64;
        current.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
      }
    },
  };
}

// Twice the signed area: which way round a polygon is traced.
function winding(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.sign(a);
}

test('a joint and a limb wind the same way, so one fill of both has no hole', () => {
  const dot = pathRecorder();
  E.dotPath(dot, 3, 4, 1.5);
  for (let k = 0; k < 16; k++) {                 // a limb pointing every way round
    const limb = pathRecorder();
    const a = k * Math.PI / 8;
    E.taperPath(limb, 0, 0, Math.cos(a) * 10, Math.sin(a) * 10, 3, 2);
    assert.equal(winding(limb.shapes[0]), winding(dot.shapes[0]), 'limb at ' + (k * 22.5) + '°');
  }
});

test('the hind and fore legs of a side never touch, so they can share a fill', () => {
  // How far one leg reaches along the body: its bones at their drawn
  // widths, the joints, and the hoof however it is turned.
  const reach = (g) => {
    const xs = [g.rx - g.wRoot / 2, g.rx + g.wRoot / 2, g.jx - g.wJoint, g.jx + g.wJoint,
                g.ftx - g.wCannon, g.ftx + g.wCannon, g.hx - g.wCannon * 1.4, g.hx + g.wCannon * 1.4];
    return [Math.min(...xs), Math.max(...xs)];
  };
  // The whole stride, at the extremes of rise and pitch stridePose() gives,
  // and at every stance a horse can be dealt — a shorter stance moves the
  // hoof through its sweep faster, so the legs meet at different moments.
  for (const stance of STANCES()) {
    for (let cyc = 0; cyc < 1; cyc += 0.005) {
      for (const bodyLift of [-2.6, 0, 0.9]) {
        for (const pitch of [-0.04, 0, 0.04]) {
          const legs = E.solveHorseLegs({ cyc, bodyLift, pitch, stance });
          for (const [hind, fore] of [['farHind', 'farFore'], ['nearHind', 'nearFore']]) {
            const back = reach(E.limbShape({ leg: legs[hind], sock: false }));
            const front = reach(E.limbShape({ leg: legs[fore], sock: false }));
            assert.ok(back[1] < front[0], hind + ' clear of ' + fore + ' at ' + cyc.toFixed(3) +
                                          ', stance ' + stance.toFixed(4));
          }
        }
      }
    }
  }
});

test('smoothstep clamps and eases', () => {
  const s = E.smoothstep;
  assert.equal(s(0, 1, -1), 0);
  assert.equal(s(0, 1, 2), 1);
  assert.equal(s(0, 1, 0.5), 0.5);
  assert.ok(s(0, 1, 0.25) < 0.25);
});

test('coats and markings are stable per runner and vary across a field', () => {
  const runner = { id: '42605', name: 'Daiquiri Bay' };
  assert.deepEqual(E.coatFor(runner), E.coatFor({ ...runner }));
  assert.deepEqual(E.markingsFor(runner), E.markingsFor({ ...runner }));
  const socks = new Set();
  for (let i = 1; i <= 24; i++) socks.add(JSON.stringify(E.markingsFor({ id: String(i) }).socks));
  assert.ok(socks.size > 3, 'short ids must not all get the same socks');
});

// ── The result, the commentary, the config, the markup ──────────────

const FIELD = [
  { id: 1, name: 'Opportunity', weight: 105 },
  { id: 2, name: 'Hopewell Rock', weight: 99 },
  { id: 3, name: 'Daiquiri Bay', weight: 108 },
  { id: 4, name: 'Ascending', weight: 97 },
];
const raceData = (extra) => Object.assign({ runners: FIELD, userPick: null, foxPick: null,
                                            raceName: 'Test', raceDistance: '1m', raceBand: 'mile' }, extra);

test('a replay runs in the real finishing order, non-finishers appended', () => {
  const api = loadEngine({ replayData: { has_result: true, result_order: [3, 1, 4] } });
  api.init(raceData());
  const order = plain(api.internals.buildRacePositions(FIELD[0]).map((r) => r.id));
  assert.deepEqual(order, [3, 1, 4, 2]);
});

// The placings behind the winner are a repeated weighted draw without
// replacement, not a sort. A sort on weight + jitter made the field line
// up in ability order nearly every time, so the race had a near-random
// winner and near-deterministic placings — the wrong way round twice.
// What a draw has to give is a strong horse that usually finishes near
// the front and occasionally does not.
test('the field is drawn, so strength shapes the placings without fixing them', () => {
  const api = loadEngine({ random: seeded(11) });
  const heavy = [
    { id: 1, name: 'Short Price', weight: 400 },
    { id: 2, name: 'Mid Price', weight: 100 },
    { id: 3, name: 'Long Shot', weight: 25 },
  ];
  api.init({ runners: heavy, userPick: null, foxPick: null,
             raceName: 'T', raceDistance: '1m', raceBand: 'mile' });

  const RUNS = 4000;
  const sum = new Map(), best = new Map(), worst = new Map();
  for (let i = 0; i < RUNS; i++) {
    // Winner held fixed so this measures the ORDERING of the rest.
    const order = api.internals.buildRacePositions(heavy[1]);
    order.forEach((r, k) => {
      sum.set(r.id, (sum.get(r.id) || 0) + k);
      if (r.id !== 2) {
        if (k === 1) best.set(r.id, (best.get(r.id) || 0) + 1);
        if (k === 2) worst.set(r.id, (worst.get(r.id) || 0) + 1);
      }
    });
  }
  assert.ok(sum.get(1) / RUNS < sum.get(3) / RUNS,
            'the heavier runner must average a better finish than the long shot');
  // ...but neither outcome is fixed. Both finish second sometimes and
  // last sometimes, which is the whole point of drawing rather than
  // sorting.
  for (const id of [1, 3]) {
    assert.ok(best.get(id) > 0 && worst.get(id) > 0,
              'runner ' + id + ' never varied its placing — that is a sort, not a draw');
  }
});

// Weights arrive from the server as forecast win probabilities, so a
// zero-weight runner is a data fault, not a horse with no chance. It has
// to come out of the draw rather than fall out of the race.
test('a field with no weights at all still returns every runner once', () => {
  const api = loadEngine({ random: seeded(5) });
  const flat = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  api.init({ runners: flat, userPick: null, foxPick: null,
             raceName: 'T', raceDistance: '1m', raceBand: 'mile' });
  const order = plain(api.internals.buildRacePositions(flat[0]).map((r) => r.id));
  assert.equal(order[0], 1);
  assert.deepEqual(order.slice().sort(), [1, 2, 3]);
});

test('a forecast puts the drawn winner first and every runner in once', () => {
  const api = loadEngine({ random: seeded(7) });
  api.init(raceData());
  const order = plain(api.internals.buildRacePositions(FIELD[1]).map((r) => r.id));
  assert.equal(order[0], 2);
  assert.deepEqual(order.slice().sort(), [1, 2, 3, 4]);
});

test('commentary fills in the picks and drops the ones that are missing', () => {
  const api = loadEngine();
  api.init(raceData({ userPick: FIELD[0] }));
  const say = api.internals.renderCommentary;
  assert.equal(say('Halfway. {LEADER} travelling like a winner, {USER} closing.'),
               'Halfway. the leader travelling like a winner, Opportunity closing.');
  assert.equal(say('{LEADER} kicks first, {FOX} tracking him.'), 'the leader kicks first tracking him.');
  assert.equal(say('No placeholders here.'), 'No placeholders here.');
  // A pick that is there keeps the template's own punctuation.
  assert.equal(say('Watch {USER} now.'), 'Watch Opportunity now.');
});

test('a replay matches ids whatever their type, and falls back to the sim when none match', () => {
  const api = loadEngine({ replayData: { has_result: true, result_order: ['3', '1'] } });
  api.init(raceData());
  assert.deepEqual(plain(api.internals.buildRacePositions(FIELD[0]).map((r) => r.id)), [3, 1, 2, 4]);

  const none = loadEngine({ replayData: { has_result: true, result_order: [97, 98] }, random: seeded(3) });
  none.init(raceData());
  const order = plain(none.internals.buildRacePositions(FIELD[3]).map((r) => r.id));
  assert.equal(order[0], 4, 'the sim, led by the drawn winner');
  assert.deepEqual(order.slice().sort(), [1, 2, 3, 4]);
});

test('a partial config override keeps the other defaults', () => {
  const merge = E.mergeConfig;
  const merged = plain(merge({ colours: { gold: '#D4AF37', userPick: 'x' }, horse: { range: [1, 2] }, n: 1 },
                             { colours: { gold: '#FFF' }, horse: { range: [5] } }));
  assert.deepEqual(merged.colours, { gold: '#FFF', userPick: 'x' });
  assert.deepEqual(merged.horse.range, [5], 'arrays replace');
  assert.equal(merged.n, 1);
  assert.deepEqual(plain(merge({ a: 1 }, undefined)), { a: 1 });
});

test('payload text is escaped on its way into markup, and ordinary names are not touched', () => {
  assert.equal(E.esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(E.esc("Fox's Pick & Co"), 'Fox&#39;s Pick &amp; Co');
  assert.equal(E.esc('Daiquiri Bay (GB)'), 'Daiquiri Bay (GB)');
  assert.equal(E.esc(8), '8');
});

// ── Nameplates ──────────────────────────────────────────────────
// The plates name the leading runners. What makes them read as a race
// rather than as a fault is that they do not follow every swap.

const OPTS = { maxVisible: 4, holdFrames: 3 };
const order = (...ids) => ids;

test('a plate waits for a runner to hold the place', () => {
  const streaks = new Map();
  // Two frames in the top four is not yet enough.
  assert.deepEqual(plain(E.labelSlots(order(1, 2, 3, 4, 5), [], streaks, OPTS)), []);
  assert.deepEqual(plain(E.labelSlots(order(1, 2, 3, 4, 5), [], streaks, OPTS)), []);
  assert.deepEqual(plain(E.labelSlots(order(1, 2, 3, 4, 5), [], streaks, OPTS)), [1, 2, 3, 4]);
});

test('a plate does not follow a momentary swap', () => {
  const streaks = new Map();
  for (let i = 0; i < 3; i++) E.labelSlots(order(1, 2, 3, 4, 5), [], streaks, OPTS);

  // 4 and 5 trade places for a single frame. 4 keeps its plate — losing
  // one the instant a horse is headed is the flicker this exists to stop.
  const swapped = plain(E.labelSlots(order(1, 2, 3, 5, 4), [], streaks, OPTS));
  assert.ok(swapped.includes(4), 'a plate was dropped on one frame out of the four');
  assert.ok(!swapped.includes(5), '5 took a plate the moment it came up');

  // Held for long enough, the change does carry.
  for (let i = 0; i < 3; i++) E.labelSlots(order(1, 2, 3, 5, 4), [], streaks, OPTS);
  const settled = plain(E.labelSlots(order(1, 2, 3, 5, 4), [], streaks, OPTS));
  assert.ok(settled.includes(5) && !settled.includes(4), 'the swap never carried');
});

test('the picks keep a plate from anywhere in the field', () => {
  const streaks = new Map();
  for (let i = 0; i < 4; i++) E.labelSlots(order(1, 2, 3, 4, 5, 6, 7), [7], streaks, OPTS);
  const slots = plain(E.labelSlots(order(1, 2, 3, 4, 5, 6, 7), [7], streaks, OPTS));
  assert.equal(slots[0], 7, 'a pinned runner is named first');
  assert.ok(slots.includes(1), 'pinning cost the leader its plate');
});

test('a runner who leaves the race stops being tracked', () => {
  const streaks = new Map();
  for (let i = 0; i < 4; i++) E.labelSlots(order(1, 2, 3, 4), [], streaks, OPTS);
  assert.ok(streaks.has(4));
  E.labelSlots(order(1, 2, 3), [], streaks, OPTS);
  assert.ok(!streaks.has(4), 'a departed runner was left in the tracking map');
});

test('maxVisible 0 turns the plates off', () => {
  const streaks = new Map();
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(plain(E.labelSlots(order(1, 2, 3), [1], streaks, { maxVisible: 0, holdFrames: 3 })), []);
  }
});
