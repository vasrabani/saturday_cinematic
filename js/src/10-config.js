// ─── CONFIG load ────────────────────────────────────────────────
// The seed JSON (#flatConfig) overrides these. They are the keys the
// engine reads, and nothing else: the seed may still carry V1-era tuning
// keys (speed lines, a photo-finish hold, rank colours) that nothing
// reads any more, and those are ignored.
const FLAT_DEFAULTS = {
  shared: {
    stallsOpenMs: 600,
    subtitleDefaultMs: 2400,
    track: { furlongPoleEvery: 0.125 },
    horse: { minSurges: 2, maxExtraSurges: 2, surgeStartRange: [0.10, 0.75], surgeDurationRange: [0.14, 0.24], surgeBoostRange: [0.5, 1.5], winnerFinalSurge: { start: 0.78, duration: 0.18, boost: 2.4 } },
    // Nameplates naming the leading runners. maxVisible 0 turns them off
    // entirely, which is the honest way to A/B whether they help.
    labels: { maxVisible: 4, maxVisibleNarrow: 2, maxVisibleLine: 3,
              narrowWidth: 700, holdFrames: 12 },
    colours: { gold: '#D4AF37', rankSilver: '#C0C0C0', rankBronze: '#CD7F32', userPick: 'rgba(212,175,55,0.28)', foxPick: 'rgba(200,120,20,0.22)', neutralGlow: 'rgba(120,150,200,0.10)', userLabel: '#D4AF37', foxLabel: '#E8A050', silkDefault: '#C8A951', silk2Default: '#1A2540', trackTurf: '#2d5e3a' },
  },
  band: {
    timings: { raceDurationMs: 46000, paradeDelayMsFast: 900, paradeDelayMsSlow: 1300, paradeLargeFieldThreshold: 16, commentaryHoldMs: 3000, slowMoFactor: 0.55 },
    phases: {
      raceStart: "AND THEY'RE AWAY",
    },
    // Seven-stage narrative arc — drives phase-strip + title rotation.
    phaseTable: [
      { key: 'awayWeGo',     from: 0.00, label: "AND THEY'RE AWAY" },
      { key: 'settlingDown', from: 0.08, label: 'SETTLING DOWN' },
      { key: 'steadyPace',   from: 0.25, label: 'STEADY THE PACE' },
      { key: 'backStraight', from: 0.45, label: 'INTO THE BACK STRAIGHT' },
      { key: 'twoOut',       from: 0.68, label: 'TWO FURLONGS OUT' },
      { key: 'finalFurlong', from: 0.85, label: 'THE FINAL FURLONG' },
      { key: 'driveToLine',  from: 0.95, label: 'DRIVING TO THE LINE' },
    ],
    // Mr Fox voice commentary (Sprint P4 #6). Pre-canned templates with
    // {LEADER}/{USER}/{FOX} substitution. Voice notes:
    //   • Punchy, opinionated, never hedged.
    //   • UK racing vernacular — "going strongly", "shown the whip",
    //     "asked for everything".
    //   • Mr Fox by-line implied; speech bubble styled per .race-commentary.
    commentary: [
      { at: 0.02, text: "They're away — and {LEADER} breaks sharp." },
      { at: 0.12, text: "Settling in. {LEADER} happy to make it." },
      { at: 0.28, text: "Steady gallop and {LEADER} dictating." },
      { at: 0.45, text: "Down the back, {LEADER} still has them strung out." },
      { at: 0.58, text: "Halfway. {LEADER} travelling like a winner, {USER} closing." },
      { at: 0.72, text: "{LEADER} kicks first. Anyone going with him?" },
      { at: 0.86, text: "Two out — {LEADER} being asked for everything." },
      { at: 0.93, text: "Final furlong. {LEADER} clear and going away!" },
      { at: 0.98, text: "{LEADER} drives for the line. Fox called it." },
    ],
  },
};

// One level deep, so a seed that overrides one colour or one timing
// keeps the defaults for the rest. Arrays and scalars replace outright;
// null and undefined mean "use the default". Every key in FLAT_DEFAULTS
// is therefore always present, and the engine reads the merged config
// without fallbacks of its own.
function mergeConfig(defaults, override) {
  const out = Object.assign({}, defaults);
  for (const [key, value] of Object.entries(override || {})) {
    if (value === null || value === undefined) continue;
    const both = [value, defaults[key]].every((v) => v && typeof v === 'object' && !Array.isArray(v));
    out[key] = both ? Object.assign({}, defaults[key], definedOnly(value)) : value;
  }
  return out;
}

function definedOnly(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

const FLAT_CONFIG = (() => {
  const el = document.getElementById('flatConfig');
  if (!el) return FLAT_DEFAULTS;
  try {
    const parsed = JSON.parse(el.textContent || '{}');
    return {
      shared: mergeConfig(FLAT_DEFAULTS.shared, parsed.shared),
      band:   mergeConfig(FLAT_DEFAULTS.band,   parsed.band),
    };
  } catch (err) {
    console.warn('flat.js: #flatConfig is not valid JSON; using the built-in defaults.', err);
    return FLAT_DEFAULTS;
  }
})();

const SHARED = FLAT_CONFIG.shared;
const BAND   = FLAT_CONFIG.band;
const COL    = SHARED.colours;
const TRK    = SHARED.track;

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

