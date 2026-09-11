// Flow tests: the real page markup, GSAP and js/flat.js in jsdom, driven
// by a manual clock through the whole experience — the screens, the
// buttons, skip, Run Again, reduced motion. jsdom has no layout and no
// canvas, so nothing is drawn (the canvases hand back a context that
// swallows every call); what is under test is the flow between screens.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const GSAP = read('js/vendor/gsap.min.js');
const ENGINE = read('js/flat.js');
const MARKUP = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');   // the page, not its boot script
const API = ['init', 'startExperience', 'skipParade', 'skipToFinish', 'skipRollCall', 'replayExperience', 'FlatEngine'];

// A 2D context that accepts every call and every property.
function inertContext() {
  const fns = new Map();
  const self = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 0 });
      if (!fns.has(key)) fns.set(key, () => self);
      return fns.get(key);
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return self;
}

/**
 * Loads the page and the engine and hands the race over, the way the
 * sandbox's boot script does. Returns the window and a manual clock.
 */
function boot({ reducedMotion = false, fixture = 'race' } = {}) {
  const { window } = new JSDOM(MARKUP, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { document } = window;

  // What jsdom does not have.
  window.matchMedia = (query) => ({ matches: reducedMotion && /reduce/.test(query), addListener() {}, removeListener() {} });
  window.HTMLCanvasElement.prototype.getContext = () => inertContext();
  window.Path2D = function Path2D() { return inertContext(); };
  window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};

  // Timers on a manual clock.
  let now = 0, nextId = 1, queue = [];
  window.setTimeout = (fn, ms) => { const id = nextId++; queue.push({ id, due: now + (Number(ms) || 0), fn }); return id; };
  window.clearTimeout = (id) => { queue = queue.filter((t) => t.id !== id); };

  // The race, as the page embeds it.
  const payload = JSON.parse(read('data/' + fixture + '.json'));
  const tag = document.createElement('script');
  tag.type = 'application/json';
  tag.id = 'replayData';
  tag.textContent = JSON.stringify(payload.replay_data || {});
  document.body.appendChild(tag);

  const before = new Set(Object.keys(window));
  window.eval(GSAP);
  const afterGsap = new Set(Object.keys(window));
  window.eval(ENGINE);
  const added = Object.keys(window).filter((k) => !afterGsap.has(k) && !before.has(k));

  // GSAP on the same clock.
  const ticker = window.gsap.ticker;
  const updateRoot = ticker._listeners.find((f) => f.name === 'updateRoot');
  if (updateRoot) ticker.remove(updateRoot);
  ticker.sleep();
  ticker.wake = () => {};
  ticker.deltaRatio = () => 1;
  let time = 1000;
  window.gsap.updateRoot(time);
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60;
      for (;;) {
        queue.sort((a, b) => a.due - b.due || a.id - b.id);
        if (!queue.length || queue[0].due > now) break;
        queue.shift().fn();
      }
      time += 1 / 60;
      window.gsap.updateRoot(time);
      ticker._listeners.slice().forEach((listener) => listener(time, 1000 / 60, 0));
    }
  };

  window.init({
    runners: payload.runners, userPick: payload.user_pick, foxPick: payload.fox_pick,
    raceName: payload.race_name, raceDistance: payload.race_distance, raceBand: payload.band,
  });
  step(60);

  const screen = () => { const s = document.querySelector('.screen.active'); return s ? s.id.replace('screen-', '') : null; };
  const until = (name, maxFrames) => {
    for (let i = 0; i < maxFrames && screen() !== name; i++) step(1);
    return screen();
  };
  const click = (id) => document.getElementById(id).click();
  return { window, document, step, screen, until, click, added, timers: () => queue.length, payload };
}

test('the engine adds its public API to the page and nothing else', () => {
  const { added } = boot();
  assert.deepEqual(added.sort(), API.slice().sort());
});

test('the whole experience runs, from Run the Race to Run Again', () => {
  const page = boot();
  const { document, click } = page;
  assert.equal(page.screen(), 'intro');

  click('flatStartBtn');
  assert.equal(page.until('parade', 120), 'parade');
  page.step(120);
  click('flatSkipParadeBtn');
  assert.equal(page.until('race', 180), 'race');

  page.step(120);
  click('raceSkipBtn');
  assert.ok(document.querySelector('.race-skip-wrap').classList.contains('race-skip-hidden'));

  // To the line, the Winning Moment and the roll call, collecting the
  // roll call's position labels on the way.
  const labels = new Set();
  for (let i = 0; i < 2400 && page.screen() !== 'reveal'; i++) {
    page.step(1);
    const label = document.querySelector('.rollcall-position-label');
    if (label) labels.add(label.textContent);
    if (labels.size >= 5) click('rollcallSkipBtn');
  }
  assert.equal(page.screen(), 'reveal');
  assert.ok(labels.has('LAST PLACE'));
  assert.ok(labels.has('23rd PLACE') && labels.has('22nd PLACE') && labels.has('21st PLACE'), [...labels].join(', '));
  assert.equal(document.getElementById('revealHorseName').textContent, 'Daiquiri Bay');

  page.step(240);
  click('flatReplayBtn');
  assert.equal(page.screen(), 'intro');
  assert.equal(document.getElementById('racingCommentary').textContent, '', 'no commentary left over');
  assert.equal(document.getElementById('paradeStage').innerHTML, '', 'the parade starts afresh');
  assert.equal(document.getElementById('rollcallStage').innerHTML, '');
  assert.ok(!document.querySelector('.race-skip-wrap').classList.contains('race-skip-hidden'), 'Skip to Finish is back');
  assert.equal(document.getElementById('revealConfetti'), null);

  // And it runs again.
  click('flatStartBtn');
  assert.equal(page.until('parade', 120), 'parade');
});

test('only the showing screen takes clicks, focus and keys', () => {
  const page = boot();
  const inert = () => Object.fromEntries([...page.document.querySelectorAll('.screen')].map((s) => [s.id, s.inert]));
  assert.deepEqual(inert(), { 'screen-intro': false, 'screen-parade': true, 'screen-race': true,
                              'screen-rollcall': true, 'screen-reveal': true });
  page.click('flatStartBtn');
  page.until('parade', 120);
  assert.equal(inert()['screen-intro'], true);
  assert.equal(inert()['screen-parade'], false);
});

test('pressing Run the Race twice starts one parade', () => {
  const page = boot();
  page.click('flatStartBtn');
  page.click('flatStartBtn');
  page.until('parade', 120);
  page.step(90);
  assert.equal(page.timers(), 1, 'one parade, one pace timer');
});

test('pressing Skip twice hands over to the race once', () => {
  const page = boot();
  page.click('flatStartBtn');
  page.until('parade', 120);
  page.click('flatSkipParadeBtn');
  page.click('flatSkipParadeBtn');
  page.until('race', 180);
  // The race screen fades in (0.4s) and then the stalls timer is set:
  // one hand-off, one stalls timer.
  page.step(30);
  assert.equal(page.timers(), 1);
});

test('with reduced motion the result is shown straight away, and shown', () => {
  const page = boot({ reducedMotion: true });
  page.click('flatStartBtn');
  assert.equal(page.screen(), 'reveal');
  for (const sel of ['#revealHorseName', '.winner-poster__winnerline', '#revealMargin',
                       '#revealPodium', '.reveal-actions', '.reveal-kicker']) {
    assert.equal(page.document.querySelector(sel).style.opacity, '1', sel + ' is visible');
  }
  assert.equal(page.document.getElementById('revealHorseName').textContent, 'Daiquiri Bay');
});

test('the canvas race is narrated, and a transition moves the caret', () => {
  const page = boot();
  const { document, click } = page;
  const narration = document.getElementById('raceNarration');

  // The region has to sit outside every .screen: showScreen() marks the
  // screens it is not showing inert, and an inert subtree is not announced.
  assert.ok(narration, 'no #raceNarration region');
  assert.equal(narration.getAttribute('role'), 'status');
  assert.equal(narration.getAttribute('aria-live'), 'polite');
  assert.equal(narration.closest('.screen'), null, 'narration must not live inside a screen');

  // The canvases carry no accessible content; the narration speaks for them.
  for (const canvas of document.querySelectorAll('canvas')) {
    assert.equal(canvas.getAttribute('aria-hidden'), 'true', canvas.id + ' is not hidden');
  }

  assert.match(narration.textContent, /Run the Race/i);

  click('flatStartBtn');
  assert.equal(page.until('parade', 120), 'parade');
  assert.match(narration.textContent, /parade/i);
  // Focus follows the screen, rather than being dropped on the floor when
  // the control the user just pressed is made inert.
  assert.equal(document.activeElement.id, 'screen-parade');
});

test('the result is spoken, even on the reduced-motion path', () => {
  const page = boot({ reducedMotion: true });
  const winner = page.payload.runners.find((r) => r.id === page.payload.replay_data.result_order[0]);

  page.click('flatStartBtn');
  page.step(60);

  const said = page.document.getElementById('raceNarration').textContent;
  assert.match(said, /^Result:/);
  assert.ok(said.includes(winner.name), 'the winner is not named in: ' + said);
});

// A galloping horse is judged in body lengths a second, not in pixels, and
// the race lasts the same number of seconds on every screen. So the field's
// apparent pace is spanLengths / raceDuration, and that has to come out the
// same at 375px as at 2560px or the horses look sluggish on a phone and
// hurried on an ultrawide — which is exactly what they did, at 44% and 155%
// of desktop pace. horseScale is clamped so a phone's horses stay big enough
// to read; the span is divided by the same clamp factor so the two cancel.
test('the field gallops at the same lengths per second on every screen', () => {
  const { window } = boot();
  const { WORLD } = window.FlatEngine.internals;

  const at = (width) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    window.dispatchEvent(new window.Event('resize'));
    return WORLD.spanLengths;
  };

  // Phones, tablets, laptops, desktops, ultrawides. Both ends of the
  // horseScale clamp and the unclamped middle.
  const widths = [320, 375, 414, 768, 1024, 1280, 1440, 1920, 2560, 3440];
  const paces = widths.map(at);

  for (let i = 0; i < widths.length; i++) {
    assert.ok(Number.isFinite(paces[i]) && paces[i] > 0,
              widths[i] + 'px gave a nonsense span: ' + paces[i]);
    assert.ok(Math.abs(paces[i] - paces[0]) < 0.01,
              widths[i] + 'px gallops at ' + (paces[i] / paces[0] * 100).toFixed(0) +
              '% of ' + widths[0] + 'px — the span no longer cancels the horseScale clamp');
  }

  // The artwork still scales with the viewport; it is only the pace that
  // is held constant. Without this a "fix" that froze the whole layout
  // would pass the assertion above.
  Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  const phone = WORLD.lengthPx;
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
  assert.ok(WORLD.lengthPx > phone, 'a desktop horse should still be drawn bigger than a phone one');
});

// No shot in the table may cut the feet off the nearest horse.
//
// This is not obvious from the numbers, which is why it is a test. Zoom
// scales the lane band about its middle and camY shifts it down, so
// tightening the shot walks the near lane towards the bottom letterbox
// bar — and the letterbox is painted over the horses, not behind them.
// The three move together, so raising any one of them alone eats the
// margin the other two left.
//
// Only the near rail is checked. The far rail is the same geometry in
// reverse, but the frame holds sky and grandstand above the track and
// that margin never drops below about 120px, where the near side gets
// down to 21. It is the one that binds.
//
// The projection comes from the engine rather than being re-derived
// here: a copy of worldToScreenY in a test would stop being a test of
// worldToScreenY the first time somebody changed it.
test('no shot crops the nearest horse, on any viewport', () => {
  const page = boot();
  const { window } = page;
  // The field only exists once the race is under way.
  page.click('flatStartBtn');
  page.until('parade', 240);
  window.skipParade();
  assert.equal(page.until('race', 600), 'race', 'never reached the race');
  const E = window.FlatEngine.internals;
  // The screen turns over a beat before buildHorseObjects runs.
  for (let i = 0; i < 240 && E.field().length < 2; i++) page.step(1);
  const { SHOTS, DIRECTOR, CAM, worldToScreenY, field } = E;

  // Landscape phone and short laptop windows are the binding cases —
  // a tall viewport has margin to spare at every shot.
  const VIEWPORTS = [[1920, 1080], [1500, 900], [1280, 720], [1440, 620], [390, 780]];
  const MIN_MARGIN = 12;

  const saved = Object.assign({}, DIRECTOR);
  const savedZoom = CAM.zoom;

  for (const [w, h] of VIEWPORTS) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
    window.dispatchEvent(new window.Event('resize'));

    const runners = field();
    assert.ok(runners.length > 1, 'no field to frame');
    // The nearest horse is the one furthest down the lane band.
    const near = runners.reduce((a, b) => (a.laneT > b.laneT ? a : b));

    for (const [name, shot] of Object.entries(SHOTS)) {
      Object.assign(DIRECTOR, shot);
      CAM.zoom = shot.zoom;
      CAM.shakeY = shot.shake * 0.7;          // worst of the hoof rumble
      const hoof = worldToScreenY(near.y);
      const bottomBar = window.innerHeight * (1 - (shot.letterbox || 0));
      const margin = bottomBar - hoof;
      assert.ok(margin > MIN_MARGIN,
                'shot "' + name + '" at ' + w + 'x' + h + ' leaves ' + margin.toFixed(0) +
                'px under the near horse — raise the letterbox, the zoom or camY and ' +
                'it loses its feet (need >' + MIN_MARGIN + ')');
    }
  }

  Object.assign(DIRECTOR, saved);
  CAM.zoom = savedZoom;
  CAM.shakeY = 0;
});

// The closing sequence has to actually close. The camera used to finish
// its work in the drive and add 1.5% of zoom across the final furlong,
// which is why the finish felt flat however well the rest was directed.
test('the camera keeps tightening into the line, then releases', () => {
  const { window } = boot();
  const { SHOTS } = window.FlatEngine.internals;
  const order = ['cruise', 'build', 'drive', 'line', 'post'];

  for (let i = 1; i < order.length; i++) {
    assert.ok(SHOTS[order[i]].zoom > SHOTS[order[i - 1]].zoom,
              order[i] + ' must be tighter than ' + order[i - 1]);
  }
  // The last two beats are where it was flat. Each has to be a move the
  // eye can read, not a rounding difference.
  for (const [from, to] of [['drive', 'line'], ['line', 'post']]) {
    const step = SHOTS[to].zoom / SHOTS[from].zoom - 1;
    assert.ok(step > 0.08, from + ' to ' + to + ' is only ' + (step * 100).toFixed(1) +
                           '% of zoom — not a move, a rounding error');
  }
  // And the shake and vignette build with it, so the push is felt and
  // not merely measured.
  assert.ok(SHOTS.post.shake > SHOTS.line.shake);
  assert.ok(SHOTS.post.vignette > SHOTS.line.vignette);

  // The speed cue rides the same curve. It cannot fall back at any point:
  // the final furlong plays at 0.55 of real time, so the frame is the
  // only thing left saying the horses are flat out, and a cue that
  // eased off there would take the last of it away.
  for (let i = 1; i < order.length; i++) {
    assert.ok(SHOTS[order[i]].speedCue >= SHOTS[order[i - 1]].speedCue,
              order[i] + ' feels slower than ' + order[i - 1]);
  }
  assert.equal(SHOTS.cruise.speedCue, 0, 'the opening shot is unhurried');
  assert.equal(SHOTS.post.speedCue, 1, 'the line is as fast as it gets');
});

// The ground streaks are placed off a hash of their world tile, not off
// Math.random, because they are redrawn every frame: a streak that moved
// between frames would strobe rather than scroll.
test('ground streaks sit still between frames', () => {
  const { streakHash } = boot().window.FlatEngine.internals;

  for (const i of [-4000, -7, 0, 1, 2, 993, 250000]) {
    const a = streakHash(i);
    assert.equal(streakHash(i), a, 'streak ' + i + ' moved between calls');
    assert.ok(a >= 0 && a < 1, 'streak ' + i + ' out of range: ' + a);
  }
  // Neighbours must not clump, or the turf grows stripes instead of grain.
  const runs = [];
  for (let i = 0; i < 400; i++) runs.push(streakHash(i));
  const buckets = [0, 0, 0, 0];
  runs.forEach((v) => buckets[Math.min(3, Math.floor(v * 4))]++);
  buckets.forEach((n, k) => assert.ok(n > 400 / 4 * 0.5,
    'quarter ' + k + ' holds only ' + n + ' of 400 streaks — the hash clumps'));
});
