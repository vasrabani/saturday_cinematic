/*
 * Read-only integration check against the Saturday Racing Django repo.
 *
 *   node tools/check-integration.js <path-to-saturday-repo>
 *
 * Writes nothing, anywhere. It answers one question: if the sandbox were
 * copied into that repo right now, what would be missing or stale?
 *
 * Four checks:
 *   1. DOM contract  — every id the engine looks up, against flat.html
 *   2. Asset parity  — which files differ, so the copy list is evidence
 *   3. Font parity   — the variable-font declarations and their files
 *   4. Template bits — the attributes the narration and focus work need
 *
 * Run it before integrating to get the work list, and again afterwards:
 * a clean run is the gate. See INTEGRATION.md.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = path.join(__dirname, '..');
const repo = process.argv[2];

if (!repo) {
  console.error('usage: node tools/check-integration.js <path-to-saturday-repo>');
  process.exit(2);
}
if (!fs.existsSync(path.join(repo, 'manage.py'))) {
  console.error('not a Django project (no manage.py): ' + repo);
  process.exit(2);
}

const TEMPLATE = path.join(repo, 'cinematic/templates/cinematic/flat.html');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const strip = (s) => (s === null ? null : s.replace(/\r\n/g, '\n'));

let problems = 0;
const fail = (msg) => { problems++; console.log('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);
const head = (msg) => console.log('\n' + msg);

// Ids the engine creates itself. These must NOT be in the template.
const ENGINE_CREATED = new Set(['phaseStrip', 'revealConfetti', 'broadcastId', 'raceResult', 'winMoment']);

// ── 1. DOM contract ────────────────────────────────────────────
head('DOM contract (ids js/flat.js looks up)');
const engine = read(path.join(SANDBOX, 'js/flat.js'));
const template = strip(read(TEMPLATE));
if (!template) {
  fail('template not found: ' + TEMPLATE);
} else {
  const ids = [...new Set([...engine.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))]
    .filter((id) => !/^(screen-|paradeDot-)/.test(id))
    .filter((id) => !ENGINE_CREATED.has(id))
    .sort();
  const present = (id) =>
    template.includes('id="' + id + '"') || template.includes('json_script:"' + id + '"');
  const missing = ids.filter((id) => !present(id));
  missing.forEach((id) => fail('#' + id + ' is not in flat.html'));
  if (!missing.length) ok(ids.length + ' required ids all present');

  for (const id of ENGINE_CREATED) {
    if (template.includes('id="' + id + '"')) {
      fail('#' + id + ' is in flat.html but the engine creates it — remove it');
    }
  }

  // ── 4. Attributes the narration and focus work depend on ──
  head('Narration and focus');
  const screens = ['intro', 'parade', 'race', 'rollcall', 'reveal'];
  const untabbed = screens.filter((s) =>
    !new RegExp('id="screen-' + s + '"[^>]*tabindex="-1"').test(template) &&
    !new RegExp('tabindex="-1"[^>]*id="screen-' + s + '"').test(template));
  untabbed.forEach((s) => fail('#screen-' + s + ' needs tabindex="-1" so focus can move to it'));
  if (!untabbed.length) ok('all five screens are focus targets');

  for (const c of ['particleCanvas', 'raceCanvas']) {
    const tag = (template.match(new RegExp('<canvas[^>]*id="' + c + '"[^>]*>')) || [''])[0];
    if (!/aria-hidden="true"/.test(tag)) fail('#' + c + ' needs aria-hidden="true"');
  }
  if (/id="raceNarration"/.test(template)) {
    const inScreen = /<div class="screen[\s\S]*?id="raceNarration"/.test(template);
    if (inScreen) fail('#raceNarration is inside a .screen — an inert screen does not announce');
    else ok('#raceNarration present, outside the screens');
  }
}

// ── 2. Asset parity ────────────────────────────────────────────
head('Assets (sandbox → Django static)');
const ASSETS = [
  ['css/experience.css',  'cinematic/static/cinematic/css/experience.css'],
  ['css/flat.css',        'cinematic/static/cinematic/css/flat.css'],
  ['js/flat.js',          'cinematic/static/cinematic/js/flat.js'],
  ['js/experience.js',    'cinematic/static/cinematic/js/experience.js'],
  ['js/vendor/gsap.min.js', 'cinematic/static/cinematic/js/vendor/gsap.min.js'],
];
for (const [from, to] of ASSETS) {
  const a = strip(read(path.join(SANDBOX, from)));
  const b = strip(read(path.join(repo, to)));
  if (b === null) fail(to + ' does not exist in the repo');
  else if (a === b) ok(from + ' — identical, no copy needed');
  else fail(from + ' → ' + to + ' (differs, needs copying)');
}

// ── 3. Fonts ───────────────────────────────────────────────────
head('Fonts');
const fontCss = strip(read(path.join(repo, 'static/fonts/saturday-fonts.css')));
const sandboxFontCss = strip(read(path.join(SANDBOX, 'fonts/saturday-fonts.css')));
if (fontCss === null) fail('static/fonts/saturday-fonts.css not found');
else if (fontCss === sandboxFontCss) ok('saturday-fonts.css — identical, no copy needed');
else {
  // Count declarations, not the word: the sandbox file explains itself in a
  // comment that mentions @font-face.
  const faces = (css) => (css.match(/@font-face\s*\{/g) || []).length;
  fail('saturday-fonts.css differs — ' + faces(fontCss) + ' faces in the repo, ' +
       faces(sandboxFontCss) + ' in the sandbox');
}
const fontDir = path.join(repo, 'static/fonts');
if (fs.existsSync(fontDir)) {
  const have = fs.readdirSync(fontDir).filter((f) => f.endsWith('.woff2')).sort();
  const want = fs.readdirSync(path.join(SANDBOX, 'fonts')).filter((f) => f.endsWith('.woff2')).sort();
  const stale = have.filter((f) => !want.includes(f));
  const absent = want.filter((f) => !have.includes(f));
  absent.forEach((f) => fail('static/fonts/' + f + ' missing — copy it'));
  stale.forEach((f) => fail('static/fonts/' + f + ' is now unused — delete it'));
  if (!stale.length && !absent.length) ok(want.length + ' font files match');
}

// ── Verdict ────────────────────────────────────────────────────
console.log('\n' + (problems === 0
  ? 'Integration check clean — the repo matches this sandbox.'
  : problems + ' item(s) outstanding. See INTEGRATION.md.'));
process.exit(problems === 0 ? 0 : 1);
