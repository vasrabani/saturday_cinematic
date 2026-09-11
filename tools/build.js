/*
 * Builds js/flat.js from js/shared/ and js/src/.
 *
 *   node tools/build.js          write js/flat.js
 *   node tools/build.js --check  exit non-zero if js/flat.js is stale
 *
 * WHY A BUILD AT ALL. The engine had grown to 5,800 lines in one file, and
 * two of its helpers — the silk and cap renderers — also existed, copied, in
 * js/experience.js, where they had already drifted apart. Splitting the
 * source fixes both. Shipping the split does not: ARCHITECTURE.md § 9 says
 * of production "everything under css/, img/, and js/flat.js translates
 * directly. Copy the file, done." Production includes one classic <script>
 * from <head>, and an ES module would defer past the inline boot script that
 * calls init(). So the source is many files and the artefact stays one.
 *
 * This is a concatenation, not a bundler. The fragments share one function
 * scope inside the IIFE exactly as they did when they were one file, so no
 * import/export rewiring was needed and no cross-reference changed. That is
 * the point: the split is a slice of the original file, which is why it can
 * be proved to change nothing.
 *
 * THE ORDER BELOW IS THE FILE. It is the original source order, so the built
 * output declares everything exactly where it used to, with one deliberate
 * exception: renderCapSvg has moved up from the leaderboard section into
 * js/shared/silks.js, next to the silk renderer it belongs with. Both are
 * function declarations, and the two id counters beside them are only read
 * when those functions run, long after load.
 *
 * js/flat.js is GENERATED. Edit the fragments, then run this. `npm test`
 * fails if the two have fallen out of step.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'js', 'flat.js');

// Original source order. Shared fragments sit where their code used to be.
const MANIFEST = [
  'js/src/10-config.js',
  'js/shared/payload-text.js',
  'js/shared/silks.js',            // + renderCapSvg, moved up from the leaderboard
  'js/src/20-data-shapes.js',
  'js/src/30-state-world.js',
  'js/src/40-flow.js',
  'js/src/50-race.js',
  'js/src/60-scenery.js',
  'js/src/65-world-paint.js',
  'js/src/70-horse.js',
  'js/src/75-labels.js',
  'js/src/80-commentary.js',
  'js/src/85-leaderboard.js',
  'js/src/86-leaderboard-rows.js',
  'js/src/90-result.js',
  'js/src/92-reveal.js',
  'js/src/99-api.js',
];

const GENERATED_NOTE = [
  ' *',
  ' * ─────────────────────────────────────────────────────────────────────',
  ' * GENERATED FILE — do not edit. Built from js/shared/ and js/src/ by',
  ' * tools/build.js; the manifest there is the source order. Edit a',
  ' * fragment and run `npm run build`. `npm test` fails if this file and',
  ' * the fragments disagree.',
  ' * ─────────────────────────────────────────────────────────────────────',
].join('\n');

function build() {
  const banner = fs.readFileSync(path.join(ROOT, 'js/src/00-banner.txt'), 'utf8');
  const marked = banner.replace(/\n \*\/\s*$/, '\n' + GENERATED_NOTE + '\n */\n');
  if (marked === banner) throw new Error('could not mark the banner as generated');

  const parts = MANIFEST.map((rel) => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return text.endsWith('\n') ? text : text + '\n';
  });

  return marked + '(function () {\n' + "'use strict';\n" + parts.join('') + '})();\n';
}

const built = build();

if (process.argv.includes('--check')) {
  const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (onDisk === built) {
    console.log('js/flat.js is up to date with js/src and js/shared.');
    process.exit(0);
  }
  console.error('js/flat.js is STALE — it does not match a fresh build of\n' +
                'js/shared/ and js/src/. Run `npm run build` and commit the result.');
  process.exit(1);
}

fs.writeFileSync(OUT, built);
console.log('js/flat.js written — %d lines from %d fragments.',
            built.split('\n').length - 1, MANIFEST.length);
