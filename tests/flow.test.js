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
  for (const sel of ['#revealHorseName', '#revealTrophyWrap', '#revealPodium', '.reveal-actions', '.reveal-kicker']) {
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
