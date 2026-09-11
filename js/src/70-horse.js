// ── Cached gradients ─────────────────────────────────────────────
// Canvas gradients are defined in user space and read through whatever
// transform is current when they are used, so one gradient in local
// horse coordinates serves every horse, every frame. Building them per
// horse per frame is 24 × 60 allocations a second for nothing.
const gradientCache = {};
function horseGrad(key, make) {
  return gradientCache[key] || (gradientCache[key] = make());
}

// ── Gait ─────────────────────────────────────────────────────────
// A transverse gallop, four beats then a moment of suspension. These are
// the points in the stride cycle where each hoof strikes the ground:
//   far hind 0.00 → near hind 0.10 → far fore 0.29 → near fore 0.40,
// each staying down for STANCE of the cycle, and then all four are off
// the ground from 0.59 until the far hind lands again. A racehorse at
// full gallop has each foot down for about a fifth of the stride.
const GAIT = { farHind: 0.00, nearHind: 0.10, farFore: 0.29, nearFore: 0.40 };
const STANCE = 0.19;
const GAIT_STRIKES = Object.freeze([GAIT.farHind, GAIT.nearHind, GAIT.farFore, GAIT.nearFore]);

// How far a planted hoof sweeps back under the body, in the horse's own
// units, and so how far one gait cycle has to carry the horse for the
// hooves not to slide: STRIDE_LOCAL, about 1.4 lengths. placeHorse()
// advances the gait by distance against this.
const STRIDE_SWEEP = 19.5;
const STRIDE_LOCAL = STRIDE_SWEEP / STANCE;

// ── Every horse strides differently ──────────────────────────────
// STANCE above is the reference horse. Each runner gets its own, drawn
// once at the gate and carried for the race.
//
// This is the fix for a field that galloped as one animal. The gait is
// driven by distance — legPhase advances by ground covered, not by the
// clock — so two horses at the same speed with one shared STANCE had
// *identical* stride frequency, to the last decimal. Their phases could
// only drift apart through differences in speed, which meant the field
// locked into a single cadence exactly when the speeds converged: the
// bunched run-in, where a viewer is most likely to be looking closely.
//
// Stance is the right dial to vary rather than the drawn sweep. The
// no-skate invariant is that the body advances STRIDE_SWEEP while a hoof
// is down, so one cycle carries STRIDE_SWEEP / stance — meaning a horse
// that keeps its feet down for less of the cycle takes a longer stride
// and spends more of it in the air. That is a real difference between
// racehorses, and it falls straight out of the existing geometry: the
// drawn leg sweep is untouched, so the rig's reach is untouched. Scaling
// the sweep instead would have needed longer bones, because the foreleg
// is already within a fraction of full extension at the moment of
// strike.
//
// ±12% is about the spread of real thoroughbred stride lengths. At the
// same ground speed the shortest strider in a field turns its legs over
// roughly a quarter faster than the longest, which is plainly visible
// as the pack refusing to beat in time.
const STANCE_SPREAD = 0.12;

function drawStance(rand) {
  return STANCE * (1 + (((rand || Math.random)() * 2) - 1) * STANCE_SPREAD);
}

// One gait cycle carries the horse this far, in its own units.
function strideLocalFor(stance) {
  return STRIDE_SWEEP / (stance || STANCE);
}

// All four feet are off the ground from here until the far hind lands.
function suspensionFrom(stance) {
  return GAIT.nearFore + (stance || STANCE);
}

// The leg rig, in the horse's own units. Each leg hangs from its root
// (rx, ry: the elbow for a foreleg, the stifle for a hind), strikes the
// ground `front` of the root and leaves it `back` of it — so every hoof
// sweeps STRIDE_SWEEP while it is down — lifts `lift` through the swing,
// and has two bones, `upper` and `lower`. Forelegs bend forward at the
// knee, hind legs backward at the hock. `w` is how thick it is drawn at
// the root, the joint and the cannon; the near legs, nearer the camera,
// are a little thicker.
const LEG_RIG = Object.freeze({
  farFore:  Object.freeze({ rx:  16.5, ry: -0.5, front: 10, back:  -9.5, lift: 15, upper: 14, lower: 16.2, fore: true,
                            w: Object.freeze([5.2, 3.0, 2.1]) }),
  nearFore: Object.freeze({ rx:  18.5, ry:  0.5, front: 10, back:  -9.5, lift: 15, upper: 14, lower: 16.2, fore: true,
                            w: Object.freeze([6.0, 3.2, 2.3]) }),
  farHind:  Object.freeze({ rx: -11.5, ry: -2.5, front:  7, back: -12.5, lift: 12, upper: 15, lower: 17.8, fore: false,
                            w: Object.freeze([6.2, 3.2, 2.2]) }),
  nearHind: Object.freeze({ rx: -13.5, ry: -1.5, front:  7, back: -12.5, lift: 12, upper: 15, lower: 17.8, fore: false,
                            w: Object.freeze([7.2, 3.4, 2.4]) }),
});

// Where the hoof is, relative to the leg's root, at cycle position u
// (u = 0 at the moment it strikes). Planted and sweeping back through
// the stance; then lifted, folded and carried forward through the swing.
function hoofPath(u, front, back, lift, fore, stance) {
  const st = stance || STANCE;
  if (u < st) {
    return { x: front + (back - front) * (u / st), y: 0, planted: true };
  }
  const t = (u - st) / (1 - st);
  // A foreleg folds hard at the knee early in the swing: the hoof comes
  // UP and BACK before it reaches forward. A hind leg tucks under.
  const along = fore ? smoothstep(0.3, 1, t) : smoothstep(0.08, 0.95, t);
  const up = Math.pow(Math.sin(Math.PI * t), fore ? 0.75 : 1.1);
  return { x: back + (front - back) * along, y: -lift * up, planted: false, t: t };
}

// Two-bone inverse kinematics. Given the root of a leg, where its hoof
// has to be, and the lengths of the upper and lower bones, find the
// joint between them. `bend` is +1 for a joint that points backward
// (the hock) and -1 for one that points forward (the knee).
function solveLeg(rx, ry, tx, ty, a, b, bend) {
  let dx = tx - rx, dy = ty - ry;
  let d = Math.hypot(dx, dy) || 0.001;
  const maxD = a + b - 0.02;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const ang = Math.atan2(dy, dx) + bend * Math.acos(Math.max(-1, Math.min(1, cosA)));
  return {
    jx: rx + Math.cos(ang) * a, jy: ry + Math.sin(ang) * a,
    fx: rx + dx, fy: ry + dy,
  };
}

// A tapered limb segment: a quad whose width runs from w1 at one end to
// w2 at the other.
function taper(c, x1, y1, x2, y2, w1, w2) {
  c.beginPath();
  taperPath(c, x1, y1, x2, y2, w1, w2);
  c.fill();
}

function dot(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

// The same shapes added to the current path instead of filled on their
// own, so that parts sharing a colour go to the GPU as one fill. A draw
// call costs much the same however small its shape, and a full field is
// hundreds of small shapes a frame: on a phone it is the number of draw
// calls, not the number of pixels, that sets the frame rate.
//
// The quad runs anticlockwise on screen, and so does the circle here:
// under the non-zero rule, overlapping shapes traced in opposite
// directions cancel, and where a joint overlaps a limb there would be a
// hole.
function taperPath(c, x1, y1, x2, y2, w1, w2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  c.moveTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2);
  c.lineTo(x2 + nx * w2 / 2, y2 + ny * w2 / 2);
  c.lineTo(x2 - nx * w2 / 2, y2 - ny * w2 / 2);
  c.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2);
  c.closePath();
}

function dotPath(c, x, y, r) {
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, Math.PI * 2, true);
}

// One side's pair of legs, the hind and the fore, root to hoof. `upperCol`
// is the coat (forearm and gaskin are muscle, the colour of the body);
// `lowerCol` is the points colour — the black lower legs of a bay. A white
// sock replaces the pastern and fetlock. Each entry of `pair` is a solved
// leg (solveHorseLegs) and whether it has a sock.
//
// The hind and the fore of a side never touch — the hind hoof stays well
// behind the fore through the whole stride — so each colour is one fill
// for the pair, laid down in a single leg's order: upper, lower, sock,
// hoof. The same picture from a third of the draw calls; a full field's
// legs had been close to half of every frame's.
function drawLegPair(c, pair, upperCol, lowerCol, detail) {
  const legs = pair.map(limbShape);

  c.fillStyle = upperCol;
  c.beginPath();
  for (const g of legs) {
    taperPath(c, g.rx, g.ry, g.jx, g.jy, g.wRoot, g.wJoint);
    dotPath(c, g.jx, g.jy, g.wJoint * 0.52);
  }
  c.fill();

  c.fillStyle = lowerCol;
  c.beginPath();
  for (const g of legs) {
    taperPath(c, g.jx, g.jy, g.ftx, g.fty, g.wJoint * 0.78, g.wCannon);
    if (!g.sock) pasternPath(c, g);
  }
  c.fill();

  if (legs.some((g) => g.sock)) {
    c.fillStyle = detail ? '#ebe7de' : '#b9b4aa';
    c.beginPath();
    for (const g of legs) {
      if (!g.sock) continue;
      taperPath(c, g.jx + (g.ftx - g.jx) * 0.55, g.jy + (g.fty - g.jy) * 0.55, g.ftx, g.fty,
                g.wCannon * 1.02, g.wCannon * 1.02);
      pasternPath(c, g);
    }
    c.fill();
  }

  for (const sock of [false, true]) {
    if (!legs.some((g) => g.sock === sock)) continue;
    c.fillStyle = sock ? '#5d554c' : '#1b1714';
    c.beginPath();
    for (const g of legs) if (g.sock === sock) hoofOutline(c, g);
    c.fill();
  }

  if (detail) {
    // Tendon line down the back of the cannon, catching no light.
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = 0.45;
    c.beginPath();
    for (const g of legs) {
      c.moveTo(g.jx - 0.6, g.jy + 1);
      c.lineTo(g.ftx - 0.8, g.fty - 0.5);
    }
    c.stroke();
  }
}

// The points of one leg. The fetlock sits most of the way down the lower
// bone; the pastern then slopes forward into the hoof, which is flat on
// the ground when planted and follows the leg when it is not.
function limbShape({ leg, sock }) {
  const { rx, ry, jx, jy, fx, fy, planted, w } = leg;
  return {
    rx, ry, jx, jy, planted, sock,
    ftx: jx + (fx - jx) * 0.82, fty: jy + (fy - jy) * 0.82,
    hx: planted ? fx + 1.6 : fx + (fx - jx) * 0.06,
    hy: planted ? fy : fy + (fy - jy) * 0.06,
    wRoot: w[0], wJoint: w[1], wCannon: w[2],
  };
}

// Fetlock and pastern, down to the hoof.
function pasternPath(c, g) {
  dotPath(c, g.ftx, g.fty, g.wCannon * 0.62);
  taperPath(c, g.ftx, g.fty, g.hx, g.hy, g.wCannon * 0.9, g.wCannon * 0.72);
}

// The hoof, turned to follow the leg through the air: the quad a
// translate() and rotate() to the hoof would draw, worked out here so
// that hooves can share a fill.
function hoofOutline(c, g) {
  const w = g.wCannon;
  const ang = g.planted ? 0 : Math.atan2(g.hy - g.fty, g.hx - g.ftx) - Math.PI / 2;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const px = (x, y) => g.hx + x * cs - y * sn;
  const py = (x, y) => g.hy + x * sn + y * cs;
  c.moveTo(px(-w * 0.55, -w * 0.9), py(-w * 0.55, -w * 0.9));
  c.lineTo(px(w * 0.85, -w * 0.9), py(w * 0.85, -w * 0.9));
  c.lineTo(px(w * 1.25, 0.5), py(w * 1.25, 0.5));
  c.lineTo(px(-w * 0.65, 0.5), py(-w * 0.65, 0.5));
  c.closePath();
}

// The fixed outlines — barrel, neck, head, the jockey's torso — in the
// horse's own units. Built once, on first use: one set serves every horse
// in every frame, where building them per horse per frame was 96 Path2D
// allocations a frame for a full field.
let horsePathCache = null;
function horsePaths() {
  if (horsePathCache) return horsePathCache;
  // Deep through the girth, tucked up at the flank, a strong round
  // hindquarter, a sloping shoulder. Shallower and longer than you would
  // guess — that is the difference between a racehorse and a cob.
  const body = new Path2D();
  body.moveTo(-21, -6);
  body.bezierCurveTo(-22.5, -12, -18.5, -16.5, -11, -16.2);   // quarters
  body.bezierCurveTo(-4, -16, 2, -14.4, 8, -14.6);            // back
  body.bezierCurveTo(11, -14.8, 14, -16.6, 17, -15.2);        // withers
  body.bezierCurveTo(20.5, -13.6, 23.4, -10, 24.2, -5);       // shoulder
  body.bezierCurveTo(25, -1.6, 24, 1.4, 21, 3.2);             // breast
  body.bezierCurveTo(17, 4.7, 11, 4.7, 5, 3.9);               // girth
  body.bezierCurveTo(-1, 3.1, -5, 1.4, -9, 1);                // belly, tucked
  body.bezierCurveTo(-13, 0.6, -16, 1, -18, 0);               // flank → stifle
  body.bezierCurveTo(-20, -1, -21, -3, -21, -6);              // back of thigh
  body.closePath();
  const neck = new Path2D();
  neck.moveTo(12.5, -15.6);
  neck.bezierCurveTo(19.5, -22.5, 28, -28.4, 37.2, -30.6);    // crest
  neck.bezierCurveTo(39.8, -31.2, 41.4, -29.6, 40.8, -27.6);  // poll
  neck.bezierCurveTo(35.4, -23.4, 28.4, -16.2, 24.2, -7);     // throat
  neck.bezierCurveTo(21, -6, 16.4, -9, 12.5, -15.6);
  neck.closePath();
  const head = new Path2D();
  head.moveTo(38.4, -31.2);
  head.bezierCurveTo(43, -31.8, 47.2, -30.2, 50.6, -27.2);    // forehead
  head.lineTo(54, -23.2);                                     // face
  head.bezierCurveTo(55.4, -21.7, 55.1, -20, 53.5, -19.4);    // nose
  head.bezierCurveTo(52.2, -18.9, 51, -18.4, 49.8, -18.6);    // lip
  head.bezierCurveTo(48.8, -18.2, 47.8, -18.3, 47, -19);      // chin
  head.bezierCurveTo(44, -19.8, 41, -21, 39.2, -24);          // jaw
  head.bezierCurveTo(38.3, -26, 37.9, -28.6, 38.4, -31.2);
  head.closePath();
  // The torso, back flat, backside up.
  const torso = new Path2D();
  torso.moveTo(0.4, -23.4);
  torso.bezierCurveTo(1.4, -27.8, 8, -30.2, 15, -29.4);
  torso.bezierCurveTo(17.6, -29, 18.4, -27, 17.2, -25.2);
  torso.bezierCurveTo(14.6, -23, 9, -22, 4, -21.8);
  torso.bezierCurveTo(2, -21.8, 0.7, -22.4, 0.4, -23.4);
  torso.closePath();
  // Neck and head in one coat-coloured fill.
  const neckAndHead = new Path2D();
  neckAndHead.addPath(neck);
  neckAndHead.addPath(head);
  horsePathCache = { body, neck, head, neckAndHead, torso };
  return horsePathCache;
}

// ── Drawing a horse ──────────────────────────────────────────────
// drawHorseSilhouette() works out the pose, sets up the transform and
// draws the parts in painter's order: shadow, far legs, tail, body, neck
// and head, tack, near legs, jockey. The parts share the canvas transform
// and state, each picking up where the one before left off; none of them
// saves or restores anything the next one relies on.
function drawHorseSilhouette(x, y, h, artScale) {
  const look = horseLook(h, artScale || 1);
  const pose = stridePose(h);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(look.scale, look.scale);
  const m = ctx.getTransform();
  look.px = Math.hypot(m.a, m.b);
  drawHorseShadow(pose);

  ctx.translate(0, pose.bodyLift);
  ctx.rotate(pose.pitch);

  const legs = solveHorseLegs(pose);
  drawFarLegs(legs, look);
  drawHorseTail(h, look);
  drawHorseBody(look);
  drawHorseFront(h, look, pose);
  drawHorseTack(h, look);
  drawNearLegs(legs, look);
  drawJockey(h, look, pose, bitPosition(pose.neckAng));

  ctx.restore();
}

// What this runner looks like: coat, markings, silks, and whether the
// small details are worth drawing at this size.
function horseLook(h, scale) {
  return {
    scale:  scale,
    px:     1,               // screen pixels per horse unit, once the horse is placed
    detail: scale >= 0.72,
    coat:   h.coat  || (h.coat  = coatFor(h.runner)),
    marks:  h.marks || (h.marks = markingsFor(h.runner)),
    silk:   h.runner.silk  || COL.silkDefault,
    silk2:  h.runner.silk2 || COL.silk2Default,
    pat:    h.runner.silk_pattern || 'solid',
  };
}

// Where the horse is in its stride and what that does to the whole
// animal: highest through the suspension, lowest as the forelegs take the
// weight; nose-up as the hinds drive and nose-down as the fores land; the
// neck and head nodding against that.
// Through the final furlong the jockey's hands pump and the whip comes
// up; from ALL_OUT_FROM the horse is at full stretch — nostrils flared,
// mouth open. (Both are race progress, not the slow-motion ramp.)
const FINAL_STRETCH_FROM = 0.85;
const ALL_OUT_FROM       = 0.88;

// Where the horse is in its gait cycle, 0 → 1 from the far hind's strike.
function strideCycle(h) {
  return (h.legPhase / (Math.PI * 2)) % 1;
}

function stridePose(h) {
  const cyc = strideCycle(h);
  const stance = h.stance || STANCE;
  const SUSPENSION = suspensionFrom(stance);
  const susp = cyc > SUSPENSION ? Math.sin((cyc - SUSPENSION) / (1 - SUSPENSION) * Math.PI) : 0;
  const foreLoad = (cyc > GAIT.farFore && cyc < SUSPENSION)
    ? Math.sin((cyc - GAIT.farFore) / (SUSPENSION - GAIT.farFore) * Math.PI) : 0;
  const progress = DIRECTOR.progress;
  return {
    cyc:      cyc,
    stance:   stance,
    susp:     susp,
    bodyLift: -susp * 2.6 + foreLoad * 0.9,
    pitch:    Math.sin((cyc - 0.16) * Math.PI * 2) * 0.03 + Math.sin(h.swayPhase) * 0.006,
    neckAng:  Math.sin((cyc - 0.40) * Math.PI * 2) * 0.07,
    progress: progress,
    finalStretch: progress >= FINAL_STRETCH_FROM,
    allOut:       progress >= ALL_OUT_FROM,
  };
}

// Ground shadow, cast away from the sun and tightening as the horse
// leaves the ground. Drawn before the body pitches — shadows do not. Its
// strength goes in as an opacity, not a colour string built per horse
// per frame.
function drawHorseShadow(pose) {
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * (0.3 - pose.susp * 0.14);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(-7, 28, 30 - pose.susp * 5, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
}

// The legs: hoof targets from the gait (hoofPath), joints solved (solveLeg).
// The ground is expressed in the body's pitched frame, so a planted hoof
// stays planted while the body rocks over it.
function solveHorseLegs(pose) {
  const legs = {};
  for (const key of ['farFore', 'nearFore', 'farHind', 'nearHind']) {
    const rig = LEG_RIG[key];
    const u = ((pose.cyc - GAIT[key]) % 1 + 1) % 1;
    const hp = hoofPath(u, rig.front, rig.back, rig.lift, rig.fore, pose.stance);
    const tx = rig.rx + hp.x;
    const ty = (28 - pose.bodyLift) - tx * pose.pitch + hp.y;
    const j = solveLeg(rig.rx, rig.ry, tx, ty, rig.upper, rig.lower, rig.fore ? -1 : 1);
    legs[key] = { rx: rig.rx, ry: rig.ry, jx: j.jx, jy: j.jy, fx: j.fx, fy: j.fy, planted: hp.planted, w: rig.w };
  }
  return legs;
}

// Far-side legs sit in shadow behind the body.
function drawFarLegs(legs, look) {
  const { coat, marks } = look;
  drawLegPair(ctx, [
    { leg: legs.farHind, sock: marks.socks[2] },
    { leg: legs.farFore, sock: marks.socks[0] },
  ], coat.shade, coat.farLower, false);
}

// Near-side legs, over the body.
function drawNearLegs(legs, look) {
  const { coat, marks, detail } = look;
  const { nearHind, nearFore } = legs;
  drawLegPair(ctx, [
    { leg: nearHind, sock: marks.socks[3] },
    { leg: nearFore, sock: marks.socks[1] },
  ], coat.body, coat.nearLower, detail);
  if (detail) {
    // Gaskin and forearm take the light on their front edges.
    ctx.fillStyle = 'rgba(255,240,214,0.12)';
    ctx.beginPath();
    taperPath(ctx, nearHind.rx + 1.2, nearHind.ry, nearHind.jx + 0.8, nearHind.jy, 2.4, 1);
    taperPath(ctx, nearFore.rx + 1.4, nearFore.ry, nearFore.jx + 0.8, nearFore.jy, 2.0, 0.9);
    ctx.fill();
  }
}

function drawHorseTail(h, look) {
  const { coat, detail } = look;
  // ── Tail ───────────────────────────────────────────────────
  // A flowing mass off the dock, streaming back and a little down,
  // swinging with the stride.
  const tw = Math.sin(h.bobPhase * 1.1) * 1.8;
  ctx.fillStyle = coat.points;
  ctx.beginPath();
  ctx.moveTo(-19.5, -13);
  ctx.bezierCurveTo(-26, -14 + tw * 0.4, -33, -11 + tw * 0.8, -40, -6 + tw);
  ctx.bezierCurveTo(-41.5, -3.5 + tw, -39, -1.5 + tw * 0.8, -35, -2.8 + tw * 0.6);
  ctx.bezierCurveTo(-29, -4.5 + tw * 0.4, -24, -6.5, -19.5, -8);
  ctx.closePath();
  ctx.fill();
  if (detail) {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-21, -12 + i * 1.1);
      ctx.quadraticCurveTo(-30, -11 + i * 1.3 + tw * 0.7, -38 - i * 0.6, -6 + i * 1.2 + tw);
      ctx.stroke();
    }
  }
}

function drawHorseBody(look) {
  const { coat, detail } = look;
  // ── Body ───────────────────────────────────────────────────
  const body = horsePaths().body;

  ctx.fillStyle = coat.body;
  ctx.fill(body);

  // Light and volume, laid over the body outline. Each layer is the
  // outline filled with a gradient rather than a rectangle clipped to the
  // outline: a clip costs the GPU a mask of its own, per horse per frame.
  // The picture is the same because the outline sits wholly inside each
  // layer's rectangle, and the radial sheens fade to nothing before they
  // reach its edge.
  ctx.fillStyle = horseGrad('bodyVol', () => {
    const g = ctx.createLinearGradient(0, -17, 0, 5);
    g.addColorStop(0,    'rgba(255,240,214,0.20)');
    g.addColorStop(0.32, 'rgba(255,240,214,0.02)');
    g.addColorStop(0.62, 'rgba(0,0,0,0.06)');
    g.addColorStop(1,    'rgba(0,0,0,0.38)');
    return g;
  });
  ctx.fill(body);
  if (detail) {
    // Sheen over the quarters and the shoulder: a groomed coat shines.
    ctx.fillStyle = horseGrad('quarterSheen', () => {
      const g = ctx.createRadialGradient(-12, -11.5, 0, -12, -11.5, 9.5);
      g.addColorStop(0, 'rgba(255,244,222,0.24)');
      g.addColorStop(1, 'rgba(255,244,222,0)');
      return g;
    });
    ctx.fill(body);
    ctx.fillStyle = horseGrad('shoulderSheen', () => {
      const g = ctx.createRadialGradient(18, -9, 0, 18, -9, 7.5);
      g.addColorStop(0, 'rgba(255,244,222,0.18)');
      g.addColorStop(1, 'rgba(255,244,222,0)');
      return g;
    });
    ctx.fill(body);
    // Dapples on a grey, which do run to the edge: clipped.
    if (coat.dapples) {
      ctx.save();
      ctx.clip(body);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4, rr = 3 + (i % 4) * 1.6;
        dot(ctx, -12 + Math.cos(a) * rr * 1.3, -9 + Math.sin(a) * rr * 0.7, 0.9 + (i % 3) * 0.3);
      }
      ctx.restore();
    }
  }

  if (detail) {
    // Muscle creases: the stifle fold in front of the quarters and the
    // line behind the elbow.
    ctx.strokeStyle = 'rgba(0,0,0,0.26)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-7.5, -8);
    ctx.quadraticCurveTo(-9.8, -3, -9, 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(15, -6);
    ctx.quadraticCurveTo(14.4, -1, 16, 3.4);
    ctx.stroke();
    // Rim light along the topline — the sun is above and behind camera.
    ctx.strokeStyle = 'rgba(255,238,206,0.4)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-20, -11);
    ctx.bezierCurveTo(-18, -16, -11.5, -16.4, -11, -16.2);
    ctx.bezierCurveTo(-4, -16, 2, -14.4, 8, -14.6);
    ctx.stroke();
  }
}

// ── Neck and head ──
// One group, pivoting at the withers so the whole front end nods with
// the stride.
function drawHorseFront(h, look, pose) {
  ctx.save();
  ctx.translate(14, -14.5);
  ctx.rotate(pose.neckAng);
  ctx.translate(-14, 14.5);
  drawNeckAndHead(look);
  drawHeadFeatures(look, pose);
  drawMane(h, look);
  drawBridle(look);
  ctx.restore();
}

// The neck and head shapes, their light and volume, and the face marking.
function drawNeckAndHead(look) {
  const { coat, marks, detail } = look;
  const { neck, head, neckAndHead } = horsePaths();

  ctx.fillStyle = coat.body;
  ctx.fill(neckAndHead);

  // Light and volume: outlines filled with gradients, as on the body, and
  // for the same reason — no clips.
  ctx.fillStyle = horseGrad('neckVol', () => {
    const g = ctx.createLinearGradient(30, -30, 22, -10);
    g.addColorStop(0,   'rgba(255,240,214,0.18)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1,   'rgba(0,0,0,0.3)');
    return g;
  });
  ctx.fill(neck);
  // The face planes: lit forehead, shaded muzzle and underside.
  ctx.fillStyle = horseGrad('headVol', () => {
    const g = ctx.createLinearGradient(44, -31, 47, -18);
    g.addColorStop(0,   'rgba(255,240,214,0.16)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.04)');
    g.addColorStop(1,   'rgba(0,0,0,0.34)');
    return g;
  });
  ctx.fill(head);
  if (detail) {
    // The round cheek (jowl), catching the light
    ctx.fillStyle = horseGrad('cheek', () => {
      const g = ctx.createRadialGradient(42.4, -25.4, 0, 42.4, -25.4, 3.8);
      g.addColorStop(0, 'rgba(255,244,222,0.22)');
      g.addColorStop(1, 'rgba(255,244,222,0)');
      return g;
    });
    ctx.fill(head);
  }
  // Face marking, which comes right up to the edge of the face: clipped.
  if (marks.face !== 'none') {
    ctx.save();
    ctx.clip(head);
    ctx.fillStyle = '#f1ede4';
    if (marks.face === 'star') {
      dot(ctx, 46.6, -28.6, 1.1);
    } else {
      const w = marks.face === 'blaze' ? 1.5 : 0.7;
      ctx.beginPath();
      ctx.moveTo(45.2, -29.8);
      ctx.lineTo(47.6, -30);
      ctx.lineTo(54.6, -21.4 + w * 0.2);
      ctx.lineTo(54.2 - w, -20.4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

// Throatlatch, ears, eye, muzzle — the nostrils flaring and the mouth
// open under maximum effort in the slow-motion finish.
function drawHeadFeatures(look, pose) {
  const { coat, detail } = look;
  const inSlowMo = pose.allOut;
  if (detail) {
    // Throatlatch and jawline shadow, separating the head from the neck.
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(39.4, -29.8);
    ctx.bezierCurveTo(39.2, -26, 41, -22.4, 45, -20.2);
    ctx.stroke();
    // Jugular groove down the neck
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(37, -25);
    ctx.quadraticCurveTo(29, -19, 23.5, -10);
    ctx.stroke();
  }

  // Ears, pricked
  ctx.fillStyle = coat.body;
  ctx.beginPath();
  ctx.moveTo(38.6, -30.6); ctx.quadraticCurveTo(37.2, -34.2, 38.4, -36.4);
  ctx.quadraticCurveTo(40.4, -34, 40.8, -31);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = coat.shade;
  ctx.beginPath();
  ctx.moveTo(40.6, -30.8); ctx.quadraticCurveTo(40.2, -34, 41.6, -35.8);
  ctx.quadraticCurveTo(43, -33.4, 42.6, -30.6);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = '#0a0806';
  ctx.beginPath();
  ctx.ellipse(44.8, -27.2, 1.05, 0.8, 0.35, 0, Math.PI * 2);
  ctx.fill();
  if (detail) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    dot(ctx, 45.1, -27.5, 0.3);
  }

  // Muzzle, nostril — flaring under maximum effort — and an open mouth
  ctx.fillStyle = coat.muzzle;
  ctx.beginPath();
  ctx.ellipse(52.6, -20.6, 2.2, 1.7, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0604';
  ctx.beginPath();
  ctx.ellipse(53.2, -21.6, inSlowMo ? 0.95 : 0.65, inSlowMo ? 0.62 : 0.42, 0.6, 0, Math.PI * 2);
  ctx.fill();
  if (inSlowMo) {
    ctx.fillStyle = '#2e0d0d';
    ctx.beginPath();
    ctx.ellipse(50.4, -18.6, 1.4, 0.6, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMane(h, look) {
  const { coat, detail } = look;
  // ── Mane and forelock ──────────────────────────────────────
  // A mass along the crest, flying back and up at speed, with strands
  // breaking off it. Stops short of the poll so it never swallows the
  // head — a horse without a readable head does not read as a horse.
  const mp = Math.sin(h.bobPhase * 1.5) * 1.2;
  ctx.fillStyle = coat.points;
  ctx.beginPath();
  ctx.moveTo(37, -30.4);
  ctx.bezierCurveTo(30, -29.8 + mp * 0.3, 22, -25 + mp * 0.5, 14, -17.5);
  ctx.bezierCurveTo(15.5, -20 + mp, 22, -26.5 + mp, 30, -31.5 + mp * 0.6);
  ctx.quadraticCurveTo(34, -32.6, 37, -30.4);
  ctx.closePath();
  ctx.fill();
  // The strands and the forelock are one stroke: the same pen throughout.
  const maneN = detail ? 9 : 4;
  ctx.strokeStyle = coat.points;
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < maneN; i++) {
    const t = i / (maneN - 1);
    const bx = 35 - t * 20, by = -30 + t * 13;
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx - 3, by - 2.4 + mp * 0.4, bx - 6.5, by - 1.2 + mp * (0.4 + t * 0.4));
  }
  // Forelock streaming back over the forehead
  ctx.moveTo(39.6, -31.4);
  ctx.quadraticCurveTo(38, -33.4 + mp * 0.3, 35.6, -33.4 + mp * 0.4);
  ctx.stroke();
}

function drawBridle(look) {
  const { detail } = look;
  // ── Bridle ─────────────────────────────────────────────────
  if (detail) {
    ctx.strokeStyle = 'rgba(16,12,10,0.85)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();                          // headpiece + cheekpiece
    ctx.moveTo(40.2, -31.4);
    ctx.lineTo(48.4, -21.4);
    ctx.stroke();
    ctx.beginPath();                          // browband
    ctx.moveTo(40.2, -31.4);
    ctx.lineTo(43.8, -30.6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236,234,228,0.9)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();                          // noseband
    ctx.moveTo(49.3, -24.6);
    ctx.lineTo(51.6, -19.2);
    ctx.stroke();
  }
}

// Where the bit is, in body space, once the neck has nodded — the reins
// run from here to the jockey's hands.
function bitPosition(neckAng) {
  const bitX0 = 50.2 - 14, bitY0 = -20.2 + 14.5;
  return {
    x: 14 + bitX0 * Math.cos(neckAng) - bitY0 * Math.sin(neckAng),
    y: -14.5 + bitX0 * Math.sin(neckAng) + bitY0 * Math.cos(neckAng),
  };
}

function drawHorseTack(h, look) {
  const { detail } = look;
  // ── Tack ───────────────────────────────────────────────────
  // Number cloth under the saddle, the tiny racing saddle on top, a
  // girth round the barrel and a breastgirth across the chest.
  const num = h.runner.number;
  ctx.fillStyle = '#ebe6da';
  ctx.beginPath();
  ctx.moveTo(-1.8, -15);
  ctx.lineTo(7.4, -15.3);
  ctx.lineTo(8, -8);
  ctx.lineTo(-2.5, -7.6);
  ctx.closePath();
  ctx.fill();
  if (detail) {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.35;
    ctx.stroke();
  }
  if (num != null) drawClothNumber(h, look, num);
  ctx.fillStyle = '#231a14';                  // saddle
  ctx.beginPath();
  ctx.moveTo(-0.8, -15.4);
  ctx.quadraticCurveTo(3.4, -17.2, 8.2, -15.8);
  ctx.lineTo(7.6, -14.4);
  ctx.quadraticCurveTo(3.4, -15.2, -0.4, -14.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e6e2d8';                  // girth
  taper(ctx, 11.6, -14.2, 12.8, 4.2, 1.5, 1.4);
  if (detail) {
    ctx.strokeStyle = 'rgba(230,226,216,0.9)'; // breastgirth
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(12.6, -8);
    ctx.quadraticCurveTo(18, -7, 23.6, -4.2);
    ctx.stroke();
  }
}

// The number on the saddle cloth — live text only in the Winning Moment's
// close-up, which is bigger than any of its bitmaps (textAsImage).
const CLOTH_TYPE = { weight: 700, size: 5.2, family: '"DM Sans", Helvetica, Arial, sans-serif',
                     fill: '#171b22', baseline: 'middle' };
function drawClothNumber(h, look, num) {
  const img = horseTextImage(h, 'clothImages', String(num), CLOTH_TYPE, look);
  if (img) drawTextImage(img, 2.8, -11.4);
  else drawTextLive(String(num), CLOTH_TYPE, 2.8, -11.4);
}

// ── Text as an image ─────────────────────────────────────────────
// Text is the dearest thing a race frame draws. Every fillText is laid
// out and its glyphs prepared for the GPU afresh, and under a horse's
// transform — scaled, pitching with the stride — no two frames can share
// them: the saddle cloths alone were a third of a slow phone's frame. So a
// horse's text, its number and a starred silk, is set once into bitmaps
// and drawn as an image.
//
// The image goes through the canvas's ordinary bilinear filtering: asking
// for mipmaps ('high' smoothing) cost the GPU more than the text had cost
// the CPU. Bilinear filtering only holds up to halving the size, so each
// text is set, as it is needed, at 1, 2, 4 and 8 pixels to the unit, and
// the one drawn is the smallest that is at least as fine as the screen —
// its own small set of mipmaps, each one set as real text at that size.
// `type` is the text's weight, size (in the units it is drawn in),
// family, colour and baseline. Until the typeface has loaded the text is
// drawn live, so a bitmap is never made in a fallback font.
const HORSE_TEXT_AS_IMAGE_UP_TO = 2;                  // art scale up to which a horse's text is an image
const TEXT_IMAGE_PX = Object.freeze([1, 2, 4, 8]);    // bitmap pixels per unit, level by level
const textImages = new Map();

// A horse's text at the level for its size on screen (look.px), kept on
// the horse under `slot`. Null means live text: the close-up, or a
// typeface still loading.
function horseTextImage(h, slot, text, type, look) {
  if (look.scale > HORSE_TEXT_AS_IMAGE_UP_TO) return null;
  let level = 0;
  while (level < TEXT_IMAGE_PX.length - 1 && TEXT_IMAGE_PX[level] < look.px) level++;
  const levels = h[slot] || (h[slot] = []);
  return levels[level] || (levels[level] = textImage(text, type, TEXT_IMAGE_PX[level]));
}

function drawTextImage(img, x, y) {
  ctx.drawImage(img.canvas, x - img.ax, y - img.ay, img.w, img.h);
}

function drawTextLive(text, type, x, y) {
  ctx.fillStyle = type.fill;
  ctx.font = type.weight + ' ' + type.size + 'px ' + type.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = type.baseline;
  ctx.fillText(text, x, y);
  ctx.textBaseline = 'alphabetic';
}

// The bitmap, at k pixels to the unit: the text centred on an anchor that
// sits where the live text's (x, y) would, with room round it for any
// glyph of the face. Shared between horses and races.
function textImage(text, type, k) {
  const key = [text, type.weight, type.size, type.family, type.fill, type.baseline, k].join('|');
  const cached = textImages.get(key);
  if (cached) return cached;
  if (document.fonts && !document.fonts.check(type.weight + ' 12px ' + type.family)) return null;
  const em = type.size * k;
  const font = type.weight + ' ' + em + 'px ' + type.family;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width + 2 * k);
  c.height = Math.ceil(em * 1.6);
  const anchorY = type.baseline === 'middle' ? c.height / 2 : Math.round(em * 1.15);
  g.font = font;               // sizing the canvas reset its state
  g.fillStyle = type.fill;
  g.textAlign = 'center';
  g.textBaseline = type.baseline;
  g.fillText(text, c.width / 2, anchorY);
  const img = { canvas: c, w: c.width / k, h: c.height / k, ax: c.width / 2 / k, ay: anchorY / k };
  textImages.set(key, img);
  return img;
}

// ── The jockey ───────────────────────────────────────────────────
// He rides the stride rather than moving with it: the horse's back rises
// and falls and pitches under him while his upper body stays level, which
// is the thing that makes a jockey look like he is riding and not glued
// on. Through the final furlong his hands pump with the stride and the
// whip comes up.
//
// The Winning Moment salute (h.salute, 0 → 1) is blended into the same
// rig rather than swapped in, so he rises into it: the upper body comes up
// out of the crouch, rotating back around the hip; one arm goes up; the
// other hand keeps the reins, shortened as he sits up. The pose is the
// V16.1 delivery's.
function drawJockey(h, look, pose, bit) {
  ctx.save();
  ctx.translate(4, -15.8);
  ctx.rotate(-pose.pitch * 0.75);
  ctx.translate(-4, 15.8 - pose.bodyLift * 0.55);

  const pump = pose.finalStretch ? Math.sin(pose.cyc * Math.PI * 2) * 1.6 : 0;
  const handX = 25.4 + pump, handY = -19.8 + Math.abs(pump) * 0.2;
  const sal = h.salute || 0;
  const rig = {
    pump, handX, handY, sal,
    salA:    -0.40 * sal,
    salLift: 0.5 * sal,
    reinX:   handX + (20.5 - handX) * sal,
    reinY:   handY + (-22.4 - handY) * sal,
  };

  drawReins(bit, pose.bodyLift, rig);
  drawJockeyLeg();

  // Upper body: rotated about the hip and lifted by the salute. The legs,
  // irons and reins above stay where they are. Nothing is drawn after the
  // upper body, so it needs its own save only to undo the salute.
  const saluting = sal > 0.001;
  if (saluting) {
    ctx.save();
    ctx.translate(2.4, -22.6 - rig.salLift);
    ctx.rotate(rig.salA);
    ctx.translate(-2.4, 22.6);
    drawRiddenHand(look, rig);
  }
  drawJockeyTorso(h, look);
  drawJockeyArm(look, rig);
  if (pose.finalStretch && sal < 0.3) drawWhip(pose, rig);
  drawJockeyHead(look, rig);
  if (saluting) ctx.restore();   // end upper body
  ctx.restore();                 // end jockey
}

function drawReins(bit, bodyLift, rig) {
  const bitX = bit.x, bitY = bit.y;
  const { reinX, reinY } = rig;
  // Reins, bit to hands.
  ctx.strokeStyle = 'rgba(22,16,12,0.9)';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(bitX, bitY + bodyLift * 0.55);
  ctx.quadraticCurveTo((bitX + reinX) / 2, (bitY + reinY) / 2 + 2.4, reinX, reinY);
  ctx.stroke();
}

function drawJockeyLeg() {
  // Stirrup leather and iron
  ctx.strokeStyle = 'rgba(28,22,18,0.9)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(4.2, -15.4);
  ctx.lineTo(7.4, -10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(210,214,220,0.95)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(8, -9.4, 1.1, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // Thigh (white breeches) and boot, knee up at the withers
  ctx.fillStyle = '#ece9e2';
  ctx.beginPath();
  taperPath(ctx, 2.4, -22.6, 12.2, -17.4, 3.6, 2.6);
  dotPath(ctx, 12.2, -17.4, 1.3);
  ctx.fill();
  ctx.fillStyle = '#16120f';
  ctx.beginPath();
  taperPath(ctx, 12.2, -17.4, 7.2, -10.6, 2.4, 1.8);
  taperPath(ctx, 7.2, -10.6, 9.8, -9.8, 1.8, 1.2);
  ctx.fill();
  ctx.fillStyle = '#b8864c';                  // boot top
  taper(ctx, 11.8, -16.8, 11.1, -15.8, 2.6, 2.5);
}

// In the salute, the far hand stays on the reins, behind the torso.
function drawRiddenHand(look, rig) {
  const { silk2 } = look;
  const { salA, salLift, reinX, reinY } = rig;
  // The far hand stays on the reins: work out where the rein end is in
  // this rotated frame, and reach the far arm to it, behind the torso.
  const dx = reinX - 2.4, dy = reinY + 22.6 + salLift;
  const qx = 2.4 + dx * Math.cos(-salA) - dy * Math.sin(-salA);
  const qy = -22.6 + dx * Math.sin(-salA) + dy * Math.cos(-salA);
  const ex = (14.2 + qx) / 2 + 1.4, ey = (-27.6 + qy) / 2 + 0.6;
  ctx.fillStyle = silk2;
  taper(ctx, 14.2, -27.6, ex, ey, 2.4, 2.0);
  taper(ctx, ex, ey, qx, qy, 2.0, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  taper(ctx, 14.2, -27.6, ex, ey, 2.4, 2.0);
  taper(ctx, ex, ey, qx, qy, 2.0, 1.5);
  ctx.fillStyle = '#e3dfd6';
  dot(ctx, qx, qy, 1.0);
}

function drawJockeyTorso(h, look) {
  const { silk, silk2, pat } = look;
  // Torso in the runner's silks, back flat, backside up
  const torso = horsePaths().torso;
  ctx.fillStyle = silk;
  ctx.fill(torso);
  // Silk sheen on top, shadow underneath
  const silkVol = horseGrad('silkVol', () => {
    const g = ctx.createLinearGradient(0, -30.5, 0, -21.6);
    g.addColorStop(0,   'rgba(255,255,255,0.28)');
    g.addColorStop(0.4, 'rgba(255,255,255,0)');
    g.addColorStop(1,   'rgba(0,0,0,0.3)');
    return g;
  });
  // A plain silk has nothing that crosses the outline, so its sheen is
  // the outline filled with the gradient — no clip, as on the horse. A
  // pattern runs off the edge of the torso and is clipped to it; its
  // hoops or stripes never overlap, so they are one fill.
  if (!SILK_PATTERNS.has(pat)) {
    ctx.fillStyle = silkVol;
    ctx.fill(torso);
    return;
  }
  ctx.save();
  ctx.clip(torso);
  ctx.fillStyle = silk2;
  if (pat === 'starred') {
    const type = { weight: 700, size: 6, family: 'Georgia, serif', fill: silk2, baseline: 'alphabetic' };
    const img = horseTextImage(h, 'starImages', '★', type, look);
    if (img) drawTextImage(img, 8.5, -23.8);
    else drawTextLive('★', type, 8.5, -23.8);
  } else {
    ctx.beginPath();
    if (pat === 'hooped') {
      for (let i = -31; i < -20; i += 2.6) ctx.rect(-2, i, 22, 1.25);
    } else if (pat === 'striped') {
      for (let i = 1; i < 18; i += 3.2) ctx.rect(i, -32, 1.2, 12);
    } else if (pat === 'halved') {
      ctx.rect(8.5, -32, 12, 12);
    } else {
      ctx.rect(8.5, -32, 12, 5.6);
      ctx.rect(-2, -26.4, 10.5, 6);
    }
    ctx.fill();
  }
  ctx.fillStyle = silkVol;
  ctx.fillRect(-1, -31, 20, 10);
  ctx.restore();
}

// The silk patterns drawn over the body colour; anything else is plain.
const SILK_PATTERNS = new Set(['hooped', 'striped', 'halved', 'quartered', 'starred']);

function drawJockeyArm(look, rig) {
  const { silk2 } = look;
  const { pump, handX, handY, sal, salA } = rig;
  // Arm down the neck to the reins, sleeve in the secondary colour —
  // or, in the salute, raised with a clenched glove. The raised arm is
  // posed in the world (straight up, a slight bend forward at the elbow)
  // and carried back into the tilted upper-body frame, so it stays
  // vertical however far he has sat up.
  const cs = Math.cos(-salA), sn = Math.sin(-salA);
  const up = (wx, wy) => [14.8 + wx * cs - wy * sn, -27.2 + wx * sn + wy * cs];
  const [sEx, sEy] = up(1.6, -7.4), [sFx, sFy] = up(0.6, -14.6);
  const elbowX = (18.6 + pump * 0.45) + (sEx - (18.6 + pump * 0.45)) * sal;
  const elbowY = -23.2 + (sEy + 23.2) * sal;
  const armX = (handX - 0.6) + (sFx - (handX - 0.6)) * sal;
  const armY = handY + (sFy - handY) * sal;
  const gloveX = handX + (sFx - handX) * sal;
  const gloveY = handY + (sFy - 0.6 - handY) * sal;
  ctx.fillStyle = silk2;
  ctx.beginPath();
  taperPath(ctx, 14.8, -27.2, elbowX, elbowY, 2.6, 2.2);
  dotPath(ctx, elbowX, elbowY, 1.1);
  taperPath(ctx, elbowX, elbowY, armX, armY, 2.1, 1.6);
  ctx.fill();
  ctx.fillStyle = '#f2efe8';                  // glove
  dot(ctx, gloveX, gloveY, 1.05 + sal * 0.25);
}

// Through the final furlong, cocked and coming down with the stride.
function drawWhip(pose, rig) {
  const progressNow = pose.progress, cyc = pose.cyc;
  const { handX, handY } = rig;
  const t = Math.min(1, (progressNow - FINAL_STRETCH_FROM) / 0.06);
  const swing = Math.max(0, Math.sin(cyc * Math.PI * 2 + 1.2));
  const ang = -Math.PI / 2 - 0.5 + (1 - t) * 0.7 + swing * 0.55;
  ctx.strokeStyle = '#120d08';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(handX + Math.cos(ang) * 11, handY + Math.sin(ang) * 11);
  ctx.stroke();
}

function drawJockeyHead(look, rig) {
  const { silk, silk2, detail } = look;
  const { sal, salA } = rig;
  // Head: helmet under a silk cap, peak forward, goggles, a sliver of
  // face. Low between the shoulders, eyes up the track — and still up
  // the track in the salute: the head takes back most of the lean. The
  // head is the last thing drawn on the horse, so it saves the canvas
  // only to undo that turn.
  const saluting = sal > 0.001;
  if (saluting) {
    ctx.save();
    ctx.translate(17.6, -28.2);
    ctx.rotate(-salA * 0.7);
    ctx.translate(-17.6, 28.2);
  }
  ctx.fillStyle = '#d9b08c';
  dot(ctx, 21.4, -28.4, 1.15);
  ctx.fillStyle = silk2;
  ctx.beginPath();
  ctx.arc(19.8, -30.6, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = silk;
  ctx.beginPath();
  ctx.moveTo(21.4, -32.2);
  ctx.lineTo(24.8, -31);
  ctx.lineTo(21.8, -29.8);
  ctx.closePath();
  ctx.fill();
  if (detail) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    dot(ctx, 18.8, -32, 0.9);
    ctx.fillStyle = 'rgba(214,224,236,0.9)';   // goggles
    ctx.beginPath();
    ctx.ellipse(21.9, -29.6, 1.1, 0.7, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (saluting) ctx.restore();   // end head
}

