// Loads js/flat.js into a Node vm context with an inert browser, so its
// pure logic can be unit-tested without a DOM, a canvas or GSAP.
//
// Everything the engine touches at parse time is stubbed: canvases hand
// back a context that swallows every call, the JSON config and replay
// data tags are absent (so the engine takes its built-in defaults), and
// the window is a fixed 1024×640. Nothing is drawn and nothing animates;
// the tests only call the functions flat.js exposes on
// FlatEngine.internals.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE = path.join(__dirname, '..', 'js', 'flat.js');

// A value that absorbs anything: every property is itself, every call
// returns itself, and it reads as 0 in arithmetic.
function inert() {
  const store = Object.create(null);
  const self = new Proxy(function () {}, {
    get(_, key) {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key in store) return store[key];
      return self;
    },
    set(_, key, value) { store[key] = value; return true; },
    apply() { return self; },
    construct() { return self; },
  });
  return self;
}

function loadEngine(options = {}) {
  const document = {
    getElementById: (id) => (id === 'flatConfig' || id === 'replayData'
      ? (options.replayData && id === 'replayData'
        ? { textContent: JSON.stringify(options.replayData) }
        : null)
      : inert()),
    createElement: () => inert(),
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: inert(),
    body: inert(),
  };
  const sandbox = {
    document,
    console,
    innerWidth: 1024,
    innerHeight: 640,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '0' }),
    setTimeout: () => 0,
    clearTimeout() {},
    gsap: inert(),
    Path2D: function Path2D() { return inert(); },
    CanvasRenderingContext2D: function CanvasRenderingContext2D() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  if (options.random) vm.runInContext('Math.random = ' + options.random.toString(), sandbox);
  vm.runInContext(fs.readFileSync(ENGINE, 'utf8'), sandbox, { filename: ENGINE });
  return sandbox.FlatEngine;
}

module.exports = { loadEngine };
