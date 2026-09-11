// ════════════════════════════════════════════════════════════════
//  RUNNER NAMEPLATES
// ════════════════════════════════════════════════════════════════
// Small plates naming the leading runners, each tethered to its horse.
//
// Live Positions already gives the viewer the ORDER. What it cannot do
// is say which of sixteen animals on the screen is the one called
// Highwayman, and that link — a name attached to a body — is what makes
// a race feel close rather than watched from the stands.
//
// This is deliberate ground to retread: the broadcast lower-third
// (§ BROADCAST IDENTIFICATION) replaced an earlier set of floating name
// chips that read as a game HUD. The difference is scope. The
// lower-third is the director's super — one runner, four times a race,
// when there is something to say. These are ambient identification, and
// they survive only by being disciplined about it:
//
//   • Never more than a few, and fewer on a phone.
//   • Never during the final furlong. That sequence is composed — the
//     camera drops to the rail, the post comes into shot — and plates
//     across it would spoil the best moment in the race. Visibility is
//     a DIRECTOR value tweened by the master timeline, not a branch on
//     progress inside a draw call.
//   • Never while the lower-third is naming someone. Two devices naming
//     horses at once is clutter, and the super wins.
//   • Dropped rather than overlapped when the pack compresses.
//
// Cost. ARCHITECTURE.md § 6.6: text is the dearest thing a race frame
// draws, and a change that adds text to the frame is a performance
// change. So the names go through the same bitmap path the saddle
// cloths use — textImage() caches by content, so a name is rasterised
// once for the whole race and blitted thereafter. A full set of plates
// is a handful of fills and a blit each, against a frame that spends
// over a thousand on the field.

// How long a runner must hold, or lose, a place before a plate follows.
// Without this the plates flicker every time two horses trade places,
// which reads as a fault rather than as a race.
const LABEL_TYPE = Object.freeze({
  weight: '700', size: 11, family: '"DM Sans", system-ui, sans-serif',
  fill: '#F6F3EC', baseline: 'middle',
});

// Plates are drawn in screen space, so a bitmap wants device pixels.
// Matched to the cap resize() puts on the backing store.
function labelPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

const labelStreaks = new Map();   // runner id → frames held, in or out

function resetLabels() {
  labelStreaks.clear();
}

/**
 * Which runners hold a plate this frame.
 *
 * A runner has to hold a place in the top `maxVisible` for `holdFrames`
 * before taking a plate, and has to lose it for as long before giving
 * one up. Pinned runners — the viewer's pick and the Fox's — keep a
 * plate wherever they are in the field, which is the whole point of
 * them being pinned; they are allowed beyond `maxVisible`, up to two.
 *
 * Pure but for `streaks`, which is passed in so a race can carry it
 * between frames and a test can hand over an empty Map.
 *
 * @param {Array} orderedIds  live order, leader first
 * @param {Array} pinnedIds   always plated when still in the race
 * @param {Map}   streaks     per-runner counter, carried between frames
 * @param {{maxVisible:number, holdFrames:number}} opts
 * @returns {Array} runner ids to plate, in priority order
 */
function labelSlots(orderedIds, pinnedIds, streaks, opts) {
  const max  = Math.max(0, Math.floor(opts.maxVisible) || 0);
  const hold = Math.max(1, Math.floor(opts.holdFrames) || 1);
  if (!max) return [];

  const contenders = new Set(orderedIds.slice(0, max));
  const live = new Set(orderedIds);

  // Each runner carries a count and whether it currently holds a plate.
  // The count runs toward `hold` while the runner is in contention and
  // back toward zero while it is not, but only the two extremes flip the
  // plate — a Schmitt trigger. Gating the plate on the count alone would
  // drop it the instant a horse was headed, which is the flicker this
  // exists to stop. A runner who has left the race stops being tracked.
  for (const id of new Set([...orderedIds, ...streaks.keys()])) {
    if (!live.has(id)) { streaks.delete(id); continue; }
    const state = streaks.get(id) || { n: 0, on: false };
    state.n = contenders.has(id)
      ? Math.min(hold, state.n + 1)
      : Math.max(0, state.n - 1);
    if (state.n >= hold) state.on = true;
    else if (state.n <= 0) state.on = false;
    if (!state.on && state.n === 0) streaks.delete(id);
    else streaks.set(id, state);
  }

  const out = [];
  const pinned = (pinnedIds || []).filter((id) => live.has(id));
  for (const id of pinned) if (!out.includes(id)) out.push(id);

  for (const id of orderedIds) {
    if (out.length >= max + Math.min(2, pinned.length)) break;
    if (out.includes(id)) continue;
    const state = streaks.get(id);
    if (state && state.on) out.push(id);
  }
  return out;
}

// Where a plate may sit, in screen pixels above the horse's back. Tried
// in order; a runner whose every offset collides is left unnamed, which
// is always better than two plates on top of each other.
const LABEL_RISE = Object.freeze([0, -19, -38, -57, -76]);
const LABEL_H = 18;

// How far the plates step back under the broadcast lower-third. Deep
// enough that the super clearly wins the eye, shallow enough that the
// plates are still readable — at 0.7 they were gone rather than
// secondary, and a viewer who has been following a name loses it three
// times a race.
const LABEL_SUPER_DIM = 0.4;
const LABEL_PAD = 9;

function labelAccent(h, rank) {
  if (isUserPick(h.runner)) return COL.userLabel;
  if (isFoxPick(h.runner))  return COL.foxLabel;
  if (rank === 0) return COL.gold;
  if (rank === 1) return COL.rankSilver;
  if (rank === 2) return COL.rankBronze;
  return 'rgba(255,255,255,0.45)';
}

// Screen position of a horse's withers — where a tether should land.
// Uses the same projection the world transform applies, so the plate
// tracks the horse through zoom, camera drift and the hoof rumble.
// DIRECTOR.tilt is ignored: it is a few thousandths of a radian, worth
// under two pixels here, and not worth a rotation per plate.
function horseAnchor(h) {
  const artScale = WORLD.horseScale * h.depth;
  return {
    x: viewW * DIRECTOR.anchorX + CAM.shakeX + (h.worldX - CAM.x) * CAM.zoom,
    y: worldToScreenY(h.y - 44 * artScale),
  };
}

function drawRunnerLabels() {
  const cfg = SHARED.labels;
  const strength = DIRECTOR.nameplates;
  if (!cfg || !cfg.maxVisible || strength <= 0.01) return;
  // The lower-third owns naming while it is on screen — but it takes the
  // eye by being brighter, not by clearing the track. Hiding the plates
  // outright removed them for four stretches of a race that is not long
  // to begin with, and the viewer loses the thread each time.
  //
  // Deference is a ramp, not a switch. Testing a boolean against idGlow
  // stepped the whole set down the instant the super began and back up
  // when it ended, and a step in alpha reads as a fault — the plates
  // appeared to drop out and return. Scaling by the glow itself instead
  // means they recede exactly as the super arrives and come back with it,
  // which is the two devices handing over rather than colliding. idGlow
  // is set on the runner being named for exactly as long as the super is
  // up, so this costs no DOM read per frame.
  const glow = horses.reduce((m, h) => Math.max(m, h.idGlow), 0);

  const ranked = rankedHorses();
  if (!ranked.length) return;

  const maxVisible = viewW < (cfg.narrowWidth || 700)
    ? (cfg.maxVisibleNarrow || 2)
    : cfg.maxVisible;

  const byId = new Map(ranked.map((h, i) => [h.runner.id, { h, rank: i }]));
  const pinned = ranked
    .filter((h) => isUserPick(h.runner) || isFoxPick(h.runner))
    .map((h) => h.runner.id);

  const ids = labelSlots(ranked.map((h) => h.runner.id), pinned, labelStreaks,
                         { maxVisible: maxVisible, holdFrames: cfg.holdFrames });
  if (!ids.length) return;

  const k = labelPixelRatio();
  const placed = [];

  const alpha = strength * (1 - LABEL_SUPER_DIM * Math.min(1, glow / BROADCAST_ID_GLOW));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';

  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) continue;
    const { h, rank } = entry;
    const anchor = horseAnchor(h);
    if (anchor.x < -80 || anchor.x > viewW + 80) continue;

    const text = (h.runner.number ? h.runner.number + '  ' : '') + h.runner.name;
    const img = textImage(text, LABEL_TYPE, k);
    const width = (img ? img.w / k : text.length * 6.2) + LABEL_PAD * 2;

    // First offset that clears everything already placed, or nothing.
    let box = null;
    for (const rise of LABEL_RISE) {
      const left = Math.max(4, Math.min(viewW - width - 4, anchor.x - width / 2));
      const top  = anchor.y - LABEL_H + rise;
      if (top < 6) continue;
      const cand = { left, top, right: left + width, bottom: top + LABEL_H };
      const hits = placed.some((p) => !(cand.right + 5 < p.left || cand.left - 5 > p.right ||
                                        cand.bottom + 4 < p.top || cand.top - 4 > p.bottom));
      if (!hits) { box = cand; break; }
    }
    if (!box) continue;
    placed.push(box);

    const accent = labelAccent(h, rank);

    // Tether first, so the plate sits over its own line.
    ctx.strokeStyle = accent;
    ctx.globalAlpha = alpha * 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.left + width / 2, box.bottom);
    ctx.lineTo(anchor.x, anchor.y + 4);
    ctx.stroke();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = 'rgba(7,10,16,0.82)';
    ctx.beginPath();
    roundRectPath(ctx, box.left, box.top, width, LABEL_H, 4);
    ctx.fill();

    ctx.fillStyle = accent;
    ctx.fillRect(box.left, box.top, 2.5, LABEL_H);

    const cx = box.left + width / 2 + 1;
    const cy = box.top + LABEL_H / 2;
    if (img) drawTextImage(img, cx, cy);
    else drawTextLive(text, LABEL_TYPE, cx, cy);
  }

  ctx.restore();
}
