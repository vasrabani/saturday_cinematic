/*
 * Visual regression check for the flat engine — a development tool, not
 * part of the product. Paste it into the browser console on the sandbox
 * page (index.html, served by serve.py) once the intro is showing.
 *
 * It replays the whole experience — intro, parade, race, Skip to Finish,
 * the line, the Winning Moment, roll call and reveal — on a manual clock
 * with seeded randomness, and fingerprints both canvases and the active
 * screen's markup at ~140 checkpoints. Two runs of the same code produce
 * identical fingerprints, so comparing a run against a saved baseline
 * shows exactly where a change altered what the viewer sees.
 *
 *   VisualRegression.run()             // replay everything (~30s, blocks the tab)
 *   VisualRegression.save('baseline')  // keep this run as the baseline
 *   VisualRegression.compare('baseline')
 *
 * Record the baseline and the comparison at the same window size, with
 * the same fixture (?data=…). The run takes over Math.random, the timers
 * and the GSAP ticker, and ignores window resizes, so reload the page
 * afterwards.
 */
(() => {
  'use strict';

  const engine = window.FlatEngine;
  if (!engine || !engine.debug) throw new Error('FlatEngine.debug not found — is js/flat.js loaded?');

  // ── Seeded randomness (mulberry32) ──
  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ── Timers on a manual clock ──
  let now = 0, queue = [], nextId = 1;
  window.setTimeout = (fn, ms, ...args) => {
    const id = nextId++;
    queue.push({ id, due: now + (Number(ms) || 0), fn, args });
    return id;
  };
  window.clearTimeout = (id) => { queue = queue.filter((t) => t.id !== id); };
  const runDueTimers = () => {
    for (;;) {
      queue.sort((a, b) => a.due - b.due || a.id - b.id);
      if (!queue.length || queue[0].due > now) return;
      const t = queue.shift();
      if (typeof t.fn === 'function') t.fn(...t.args);
    }
  };

  // ── GSAP on the same clock ──
  const ticker = gsap.ticker;
  const updateRoot = ticker._listeners.find((f) => f.name === 'updateRoot');
  if (updateRoot) ticker.remove(updateRoot);
  ticker.sleep();
  ticker.wake = () => {};
  window.requestAnimationFrame = () => 0;
  ticker.deltaRatio = () => 1;
  const FRAME_MS = 1000 / 60;
  let time = 1000;
  gsap.updateRoot(time);

  const step = (frames) => {
    for (let i = 0; i < frames; i++) {
      now += FRAME_MS;
      runDueTimers();
      time += FRAME_MS / 1000;
      gsap.updateRoot(time);
      ticker._listeners.slice().forEach((listener) => listener(time, FRAME_MS, 0));
    }
  };

  // ── Fingerprints ──
  const fnv = (words) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < words.length; i++) { h ^= words[i]; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  };
  const canvasPrint = (id) => {
    const c = document.getElementById(id);
    if (!c || !c.width) return '-';
    return fnv(new Uint32Array(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.buffer));
  };
  const textPrint = (s) => fnv(Array.from(s, (ch) => ch.charCodeAt(0)));
  const activeScreen = () => document.querySelector('.screen.active');
  const screenId = () => { const s = activeScreen(); return s ? s.id : '-'; };

  const marks = [];
  let frame = 0;
  const mark = (label) => {
    const s = activeScreen();
    marks.push({ label, frame, screen: screenId(), race: canvasPrint('raceCanvas'),
                 back: canvasPrint('particleCanvas'), dom: textPrint(s ? s.innerHTML : '') });
  };
  const run = (frames, every, label) => {
    for (let i = 0; i < frames; i++) { step(1); frame++; if (frame % every === 0) mark(label); }
  };
  const until = (done, maxFrames, every, label) => {
    for (let i = 0; i < maxFrames && !done(); i++) { step(1); frame++; if (frame % every === 0) mark(label); }
  };

  // A known starting state: intro tweens finished, the engine's load-time
  // randomness replaced, the scenery tiles repainted from the seed.
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 1 });
  step(120);
  frame = 0;
  engine.debug.reseed(500);
  window.dispatchEvent(new Event('resize'));
  step(30);
  mark('intro');

  // From here on a real resize would redraw and rebuild the scenery,
  // drawing random numbers out of turn and making this a different run —
  // resizing the window, or a screenshot tool that does, mid-run. Ignore
  // them until the page is reloaded.
  window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);

  const phases = [
    () => { // intro → parade → race
      window.startExperience();
      until(() => screenId() === 'screen-parade', 600, 30, 'intro-out');
      run(420, 30, 'parade');
      window.skipParade();
      until(() => screenId() === 'screen-race', 900, 30, 'to-race');
    },
    () => run(780, 40, 'race'),                                   // the stalls and 13s of racing
    () => { window.skipToFinish(); run(700, 20, 'finish-run'); }, // Skip to Finish
    // The line, the run-through, the card and the Winning Moment — in two
    // halves, so no single call runs long enough to trip a timeout.
    () => until(() => screenId() !== 'screen-race', 700, 20, 'line+hero'),
    () => until(() => screenId() !== 'screen-race', 700, 20, 'line+hero'),
    () => { // roll call and reveal
      run(420, 30, 'rollcall');
      window.skipRollCall();
      until(() => screenId() === 'screen-reveal', 1500, 30, 'to-reveal');
      run(360, 30, 'reveal');
    },
  ];
  let next = 0;

  window.VisualRegression = {
    marks,
    phase() { if (next < phases.length) phases[next++](); return { phase: next, frame, marks: marks.length, screen: screenId() }; },
    run() { while (next < phases.length) this.phase(); return this.phase(); },
    save(key) { localStorage.setItem('vr:' + key, JSON.stringify(marks)); return marks.length + ' checkpoints saved as ' + key; },
    compare(key) {
      const base = JSON.parse(localStorage.getItem('vr:' + key) || '[]');
      const diffs = [];
      for (let i = 0; i < Math.max(base.length, marks.length); i++) {
        const b = base[i], m = marks[i];
        if (!b || !m) { diffs.push('#' + i + ' missing in ' + (b ? 'this run' : 'the baseline')); continue; }
        for (const k of ['label', 'frame', 'screen', 'race', 'back', 'dom']) {
          if (b[k] !== m[k]) diffs.push('#' + i + ' ' + b.label + ' @' + b.frame + ' ' + k + ': ' + b[k] + ' → ' + m[k]);
        }
      }
      return { baseline: base.length, run: marks.length, differences: diffs.length, first: diffs.slice(0, 20) };
    },
  };
  return 'VisualRegression ready — call VisualRegression.run()';
})();
