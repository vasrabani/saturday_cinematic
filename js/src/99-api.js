// ─── Public API ─────────────────────────────────────────────────
// What the page calls: the production boot script calls init() and, on
// the reduced-motion path, startExperience(); the buttons are wired in
// wireButtons(). FlatEngine groups the same functions with the build's
// version and feature list (the sandbox's staleness badge reads these),
// QA hooks for deterministic regression runs (tools/visual-regression.js)
// and the pure helpers the unit tests in tests/ exercise. Nothing in the
// product reads debug or internals.
const PUBLIC_API = { init, startExperience, skipParade, skipToFinish, skipRollCall, replayExperience };
Object.assign(window, PUBLIC_API);

window.FlatEngine = Object.freeze(Object.assign({
  version: '2.6.0',
  features: Object.freeze(['world-camera', 'coat-palette', 'rail-crowd',
                           'run-through', 'distance-gait', 'encapsulated', 'batched-draw']),
}, PUBLIC_API, {
  debug: Object.freeze({
    // Replace the engine's load-time randomness, for a repeatable run.
    reseed(camSeed) {
      CAM.seed = camSeed;
      ambientX = 0;
      ambientPainted = false;
    },
  }),
  internals: Object.freeze({
    parseBeatenDistance, formatBeatenDistance, formatBeatenDistanceCompact, ordinal,
    inventFinishGaps, raceProgressEase, runOnPast, finishPauseS, smoothstep,
    hoofPath, solveLeg, solveHorseLegs, limbShape, taperPath, dotPath, coatFor, markingsFor,
    LEG_RIG, STRIDE_SWEEP, STANCE, STRIDE_LOCAL, START_EASE, EASE_TO,
    FINISH_PAUSE_S, FINISH_PAUSE_MAX_S, MAX_VISIBLE_LENGTHS,
    esc, mergeConfig, buildRacePositions, renderCommentary,
  }),
}));

// First layout. Deliberately the last statement in the module: resize()
// builds the scenery tiles, which needs every tile painter above to be
// defined, and TILES and its painters are declared in source order.
resize();
