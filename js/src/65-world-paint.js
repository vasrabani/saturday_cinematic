// ── Sky ──────────────────────────────────────────────────────────
function paintSky(c, skyBottom, warm) {
  const sky = c.createLinearGradient(0, 0, 0, skyBottom);
  sky.addColorStop(0,    '#35699e');
  sky.addColorStop(0.34, '#5b93c8');
  sky.addColorStop(0.66, '#98bedc');
  sky.addColorStop(0.88, '#d0dad8');
  sky.addColorStop(1,    '#e6d6b6');
  c.fillStyle = sky;
  c.fillRect(0, 0, viewW, skyBottom + 2);

  // Afternoon light pooling on the sun side of the sky
  const haze = c.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, viewW * 0.55);
  haze.addColorStop(0, 'rgba(255,236,196,' + (0.36 + warm * 0.14).toFixed(3) + ')');
  haze.addColorStop(1, 'rgba(255,230,180,0)');
  c.fillStyle = haze;
  c.fillRect(0, 0, viewW, skyBottom + 2);
}

function paintSunDisc(c) {
  const r = Math.max(6, viewH * 0.016);
  const g = c.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, r * 5);
  g.addColorStop(0,    'rgba(255,253,244,1)');
  g.addColorStop(0.2,  'rgba(255,248,226,0.95)');
  g.addColorStop(0.45, 'rgba(255,236,196,0.35)');
  g.addColorStop(1,    'rgba(255,230,180,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(SUN.x, SUN.y, r * 5, 0, Math.PI * 2);
  c.fill();
}

// Drawn AFTER the clouds with a screen blend, so a cloud passing the sun
// picks up a bright rim rather than simply blotting it out.
function paintSunGlow(c) {
  c.save();
  c.globalCompositeOperation = 'screen';
  const g = c.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, viewW * 0.26);
  g.addColorStop(0, 'rgba(255,238,204,0.42)');
  g.addColorStop(1, 'rgba(255,238,204,0)');
  c.fillStyle = g;
  c.fillRect(SUN.x - viewW * 0.26, SUN.y - viewW * 0.26, viewW * 0.52, viewW * 0.52);
  c.restore();
}

// Aerial haze sitting on the horizon, over the base of the stands and
// the trees — distance, and a sunny afternoon's worth of moisture.
function paintHorizonHaze(c, horizon, depth) {
  const top = horizon - depth;
  const g = c.createLinearGradient(0, top, 0, horizon + viewH * 0.05);
  g.addColorStop(0,   'rgba(214,224,232,0)');
  g.addColorStop(0.7, 'rgba(214,224,232,0.14)');
  g.addColorStop(1,   'rgba(222,226,222,0.24)');
  c.fillStyle = g;
  c.fillRect(0, top, viewW, horizon + viewH * 0.05 - top);
}

// The backdrop lives on #particleCanvas, which sits behind the race
// canvas in the stacking order. Keeping it on its own surface means the
// track plane can clear and redraw without touching the sky.
function drawBackdrop() {
  pCtx.clearRect(0, 0, viewW, viewH);

  const horizon  = worldToScreenY(WORLD.horizonY);
  const standH   = TILES.stand ? TILES.stand.h * planeScale('stand') : viewH * 0.17;
  const standTop = horizon + 2 - standH;
  const skyBottom = Math.max(horizon + viewH * 0.10, viewH * 0.30);

  // The sun is at infinity: parallax zero, so the clouds sail past it.
  // Placed clear of the Live Positions panel, which owns the top right.
  SUN.x = viewW * (isNarrowViewport() ? 0.5 : 0.64);
  SUN.y = Math.max(viewH * 0.07, standTop - viewH * 0.11);
  SUN.visible = Math.max(0, Math.min(1, (standTop - SUN.y) / (viewH * 0.08)));

  // Clouds sit behind the downland, so the ridge cuts off their bases.
  const t = frameClock;
  paintScenery(pCtx, { bottom: skyBottom, warm: DIRECTOR.progress }, {
    cloudsHigh: racePlane('cloudsHigh', standTop + viewH * 0.03, 0.9, t * WIND.cloudsHigh),
    cloudsLow:  racePlane('cloudsLow',  standTop + viewH * 0.07, 1,   t * WIND.cloudsLow),
    hills:      racePlane('hills', horizon + 6, 0.92),
    stand:      racePlane('stand', horizon + 2, 1),
    trees:      racePlane('trees', horizon + Math.max(14, viewH * 0.045), 1),
  }, { horizon, height: standH * 0.7 });
}

// ════════════════════════════════════════════════════════════════
//  AMBIENT BACKDROP
// ════════════════════════════════════════════════════════════════
// The race screen has an entire racecourse behind it. Every other screen
// was flat black, so the experience read as five separate web pages
// rather than one afternoon at the track — and the cut from the parade
// into the race was a cut from a void into a world.
//
// This paints a slow, dimmed, defocused version of the SAME parallax
// world behind the content screens: the same tiles, the same planes, a
// fraction of the speed, under a heavy scrim so type stays legible. It
// draws on #particleCanvas, which already sits behind every screen, and
// it stands down the instant the race takes the canvas over.
const AMBIENT_DRIFT = 0.011;   // world px per ms — a very slow pan
let ambientX = 0;
let ambientPainted = false;

// A plane in the ambient backdrop: drifting at its parallax rate.
function ambientPlane(key, bottom, alpha, extra) {
  return { bottom, offset: ambientX * PARALLAX[key] + (extra || 0), alpha, scale: 1 };
}

function drawAmbient() {
  const horizon = viewH * 0.54;
  pCtx.clearRect(0, 0, viewW, viewH);

  const standH   = TILES.stand ? TILES.stand.h : viewH * 0.17;
  const standTop = horizon + 2 - standH;
  SUN.x = viewW * (isNarrowViewport() ? 0.5 : 0.64);
  SUN.y = Math.max(viewH * 0.08, standTop - viewH * 0.12);

  // The same sky, sun and clouds as the race, so the parade and the reveal
  // are unmistakably the same afternoon. The clouds drift on the wind
  // here too; the scrim below takes the brightness down for the type.
  paintScenery(pCtx, { bottom: horizon + viewH * 0.06, warm: 0.4 }, {
    cloudsHigh: ambientPlane('cloudsHigh', standTop + viewH * 0.03, 0.9, ambientX * 0.35),
    cloudsLow:  ambientPlane('cloudsLow',  standTop + viewH * 0.07, 1,   ambientX * 0.9),
    hills:      ambientPlane('hills', horizon + 6, 0.8),
    stand:      ambientPlane('stand', horizon + 2, 0.95),
    trees:      ambientPlane('trees', horizon + Math.max(14, viewH * 0.045), 1),
  }, { horizon, height: standH * 0.7 });

  // Turf running off the bottom of frame
  const turf = pCtx.createLinearGradient(0, horizon, 0, viewH);
  turf.addColorStop(0, '#2c4c36');
  turf.addColorStop(1, '#15271c');
  pCtx.fillStyle = turf;
  pCtx.fillRect(0, horizon + viewH * 0.03, viewW, viewH);

  // The scrim. Without this the backdrop fights every headline on top
  // of it; with it, it reads as a place the type is standing in front of.
  const scrim = pCtx.createLinearGradient(0, 0, 0, viewH);
  scrim.addColorStop(0,    'rgba(6,8,15,0.44)');
  scrim.addColorStop(0.45, 'rgba(6,8,15,0.58)');
  scrim.addColorStop(1,    'rgba(6,8,15,0.80)');
  pCtx.fillStyle = scrim;
  pCtx.fillRect(0, 0, viewW, viewH);

  const vg = pCtx.createRadialGradient(
    viewW * 0.5, viewH * 0.5, Math.min(viewW, viewH) * 0.22,
    viewW * 0.5, viewH * 0.5, Math.max(viewW, viewH) * 0.75
  );
  vg.addColorStop(0, 'rgba(2,4,9,0)');
  vg.addColorStop(1, 'rgba(2,4,9,0.5)');
  pCtx.fillStyle = vg;
  pCtx.fillRect(0, 0, viewW, viewH);
}

function ambientFrame() {
  // The race owns both canvases while it is running.
  if (raceRunning) { ambientPainted = false; return; }

  // Reduced motion still gets the scene, it just does not drift.
  if (prefersReducedMotion) {
    if (!ambientPainted) { drawAmbient(); ambientPainted = true; }
    return;
  }

  ambientX += Math.min(gsap.ticker.deltaRatio() * FRAME_MS, 50) * AMBIENT_DRIFT;
  drawAmbient();
}

// ════════════════════════════════════════════════════════════════
//  TRACK PLANE
// ════════════════════════════════════════════════════════════════

// Far rail, running-rail posts and advertising boards. Drawn on the
// race canvas but offset at 0.68 rather than 1.0, so the far side of
// the track slides past more slowly than the turf underfoot — the
// depth cue that makes the track look wide.
function drawFarRail() {
  const y = WORLD.trackTopY;
  // Drawing inside the world transform means geometry at world x lands
  // at rate 1.0. Shifting the whole plane by +CAM.x × (1 − factor)
  // cancels part of that back out, leaving it scrolling at `factor`.
  const shift = CAM.x * (1 - PARALLAX.farRail);

  ctx.save();
  ctx.translate(shift, 0);
  const vis  = visibleWorldRange(viewW);
  const step = WORLD.lengthPx * 3.2;
  const from = Math.floor((vis.min - shift) / step) * step;
  const to   = vis.max - shift;

  // Rail-side spectators, standing behind the boards. Tiled at the same
  // depth as the rail so they track with it, and drawn before the boards
  // so the boards cut them off at the waist the way a real one does.
  if (TILES.railCrowd) {
    const rc = TILES.railCrowd;
    // Scaled by the world's horse size, not drawn at tile resolution:
    // these are people standing next to horses, so on a phone they have
    // to shrink by the same factor the horses do or the rail ends up
    // lined with giants.
    const cs = WORLD.horseScale;
    const cw = rc.w * cs, ch = rc.h * cs;
    let cx = Math.floor((vis.min - shift) / cw) * cw;
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (; cx < to; cx += cw) {
      ctx.drawImage(rc.canvas, cx, y - 22 - ch + 5 * cs, cw, ch);
    }
    ctx.restore();
  }

  // Advertising hoardings in front of them: individual sponsor panels,
  // lit along the top edge and hazed for distance, rather than the flat
  // two-tone band V2 started with.
  if (TILES.boards) {
    const b = TILES.boards;
    let bx = Math.floor((vis.min - shift) / b.w) * b.w;
    ctx.save();
    ctx.globalAlpha = 0.92;
    for (; bx < to; bx += b.w) ctx.drawImage(b.canvas, bx, y - 22, b.w, 13);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(28,40,56,0.62)';
    ctx.fillRect(from - step, y - 22, to - from + step * 2, 13);
  }

  // Running rail
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(from - step, y - 6);
  ctx.lineTo(to, y - 6);
  ctx.stroke();

  ctx.fillStyle = 'rgba(240,244,250,0.38)';
  ctx.beginPath();
  for (let x = from; x < to; x += step) ctx.rect(x, y - 6, 1.6, 7);
  ctx.fill();
  ctx.restore();
}

function drawTurf() {
  const vis = visibleWorldRange(240);
  const top = WORLD.trackTopY - 8;
  const bot = viewH * 1.4;   // run the turf off the bottom of frame

  if (TILES.turf) {
    const tw = TILES.turf.w;
    let x = Math.floor(vis.min / tw) * tw;
    for (; x < vis.max; x += tw) {
      ctx.drawImage(TILES.turf.canvas, x, top, tw, bot - top);
    }
  } else {
    ctx.fillStyle = COL.trackTurf;
    ctx.fillRect(vis.min, top, vis.max - vis.min, bot - top);
  }

  // Depth lighting — the far side of the track sits in cooler, hazier
  // light; the turf under the camera is warm and saturated. Without a
  // gradient here the whole ground reads as one flat sheet of green.
  const shade = ctx.createLinearGradient(0, top, 0, bot);
  shade.addColorStop(0,    'rgba(146,176,186,0.17)');
  shade.addColorStop(0.30, 'rgba(146,176,186,0.03)');
  shade.addColorStop(1,    'rgba(6,14,10,0.32)');
  ctx.fillStyle = shade;
  ctx.fillRect(vis.min, top, vis.max - vis.min, bot - top);
}

// Furlong markers count DOWN to the line, the way a real track does.
// They are the clearest read the viewer gets on how much race is left,
// and because they live in world space they sweep past at full rate.
function drawFurlongMarkers() {
  const vis   = visibleWorldRange(200);
  const every = WORLD.spanPx * TRK.furlongPoleEvery;
  const y     = WORLD.trackTopY;

  let i = Math.max(0, Math.floor(vis.min / every));
  for (; i * every <= vis.max; i++) {
    const x = i * every;
    if (x > WORLD.spanPx - every * 0.4) break;   // the post takes over here
    const left = Math.round((WORLD.spanPx - x) / every);
    if (left <= 0) continue;

    ctx.fillStyle = 'rgba(245,239,222,0.85)';
    ctx.fillRect(x - 1.5, y - 40, 3, 34);
    ctx.fillStyle = 'rgba(11,14,21,0.82)';
    ctx.beginPath();
    roundRectPath(ctx, x - 11, y - 58, 22, 18, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,239,222,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawTextLive(String(left), MARKER_TYPE, x, y - 45);
  }
}

// Track lettering stays live text (not textAsImage): it is big enough on
// screen to read, where a scaled bitmap would come out a shade softer, and
// there are only two or three pieces of it in a frame.
const MARKER_TYPE = { weight: 'bold', size: 11, family: '"DM Sans", sans-serif',
                      fill: 'rgba(245,239,222,0.92)', baseline: 'alphabetic' };

// The winning post. It lives at the far end of the world and is drawn
// only when it is genuinely in shot, which for a nine-screen race means
// the last few seconds. In V1 the finish line was pinned at 94% of the
// viewport from the moment the race started, so the viewer stared at
// the destination for forty seconds; here it arrives.
function drawWinningPost() {
  const x = WORLD.spanPx;
  const vis = visibleWorldRange(160);
  if (x < vis.min || x > vis.max) return;

  const top = WORLD.trackTopY;
  const bot = WORLD.trackBotY;

  // Painted line across the turf: alternate blocks of white and black,
  // each colour one fill.
  ctx.save();
  for (const white of [true, false]) {
    ctx.fillStyle = white ? 'rgba(255,255,255,0.92)' : 'rgba(14,18,26,0.92)';
    ctx.beginPath();
    for (let y = top - 6; y < bot + 26; y += 9) {
      if ((Math.floor(y / 9) % 2 === 0) === white) ctx.rect(x - 2, y, 4, 9);
    }
    ctx.fill();
  }

  // Post + gold finial on the far side
  ctx.fillStyle   = '#f5efde';
  ctx.strokeStyle = 'rgba(11,14,21,0.85)';
  ctx.lineWidth   = 1.2;
  ctx.beginPath();
  ctx.rect(x - 3, top - 92, 6, 92);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COL.gold;
  ctx.beginPath();
  ctx.arc(x, top - 96, 5, 0, Math.PI * 2);
  ctx.fill();

  // Gantry banner
  ctx.fillStyle   = 'rgba(11,14,21,0.94)';
  ctx.strokeStyle = COL.gold;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  roundRectPath(ctx, x - 58, top - 128, 116, 24, 4);
  ctx.fill();
  ctx.stroke();
  drawTextLive('THE LINE', { weight: 'bold', size: 13, family: '"DM Sans", sans-serif',
                             fill: COL.gold, baseline: 'alphabetic' }, x, top - 111);
  ctx.restore();
}

// Foreground plane — grass sweeping past in FRONT of the field at
// better than track rate. Deliberately soft and low-contrast: it reads
// as depth of field rather than as scenery.
function drawForegroundPlane() {
  if (prefersReducedMotion) return;
  const off  = CAM.x * PARALLAX.fore * CAM.zoom;
  const tw   = 190;
  const yTop = viewH - Math.max(28, viewH * 0.07);

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(14,32,22,0.9)';
  ctx.fillRect(0, viewH - 10, viewW, 10);

  // The blades never touch, so they are one stroke.
  ctx.strokeStyle = 'rgba(18,44,28,0.85)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let x = -(((off % tw) + tw) % tw);
  for (; x < viewW + tw; x += tw) {
    for (let i = 0; i < 5; i++) {
      const gx = x + i * 34;
      const gh = 14 + ((i * 53) % 17);
      ctx.moveTo(gx, viewH);
      ctx.quadraticCurveTo(gx + 5, yTop + gh * 0.4, gx + 12, yTop);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// Screen-space vignette + the flash at the line. Both are director
// values, so they ramp with the phases rather than being switched on.
function drawAtmosphere(flashEnergy) {
  if (DIRECTOR.vignette > 0.01) {
    const vg = ctx.createRadialGradient(
      viewW * 0.5, viewH * 0.5, Math.min(viewW, viewH) * 0.28,
      viewW * 0.5, viewH * 0.5, Math.max(viewW, viewH) * 0.72
    );
    vg.addColorStop(0, 'rgba(2,4,9,0)');
    vg.addColorStop(1, 'rgba(2,4,9,' + DIRECTOR.vignette.toFixed(3) + ')');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, viewW, viewH);
  }
  // A wall of flashguns lifts the whole frame a little. Capped, because
  // this is a bloom off the crowd, not a lightning strike.
  if (flashEnergy > 0.01) {
    const bloom = Math.min(0.13, flashEnergy * 0.02);
    ctx.fillStyle = 'rgba(226,238,255,' + bloom.toFixed(3) + ')';
    ctx.fillRect(0, 0, viewW, viewH);
  }

  drawLensFlare();
  drawGrain();

  if (DIRECTOR.flash > 0.005) {
    ctx.fillStyle = 'rgba(255,252,240,' + (DIRECTOR.flash * 0.85).toFixed(3) + ')';
    ctx.fillRect(0, 0, viewW, viewH);
  }

  drawLetterbox();
}

// ── Cinematic finishing ──────────────────────────────────────────
// Three things a camera does that a canvas does not, and which between
// them account for most of the difference between "rendered" and "shot".

// A long lens looking toward a low sun throws an anamorphic streak and a
// line of ghosts through the frame. It fades out as the camera pushes in
// and the stands take the sun out of shot.
function drawLensFlare() {
  const k = SUN.visible * Math.max(0, Math.min(1, 1.4 - CAM.zoom)) * 0.9;
  if (k < 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  const sw = viewW * 0.55;
  const streak = ctx.createLinearGradient(SUN.x - sw, 0, SUN.x + sw, 0);
  streak.addColorStop(0,   'rgba(150,190,255,0)');
  streak.addColorStop(0.5, 'rgba(200,222,255,' + (0.34 * k).toFixed(3) + ')');
  streak.addColorStop(1,   'rgba(150,190,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(SUN.x - sw, SUN.y - 1.2, sw * 2, 2.4);

  const cx = viewW / 2, cy = viewH / 2;
  const GHOSTS = [
    [0.38, 0.020, '255,208,150', 0.10],
    [0.62, 0.046, '150,220,210', 0.06],
    [0.86, 0.028, '190,160,255', 0.07],
    [1.22, 0.075, '255,196,140', 0.045],
  ];
  for (const [t, r, c, a] of GHOSTS) {
    const gx = SUN.x + (cx - SUN.x) * t * 2;
    const gy = SUN.y + (cy - SUN.y) * t * 2;
    const rr = viewH * r;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
    g.addColorStop(0,   'rgba(' + c + ',' + (a * k).toFixed(3) + ')');
    g.addColorStop(0.7, 'rgba(' + c + ',' + (a * k * 0.5).toFixed(3) + ')');
    g.addColorStop(1,   'rgba(' + c + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(gx, gy, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Film grain: a small noise tile laid over the frame at a new random
// offset every frame. Faint enough that nobody would call it grain, but
// it breaks up the dead-flat fills a canvas produces and knits the
// painted backdrop and the drawn horses into one image.
function buildGrainTile() {
  const S = 192;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.pow(Math.random(), 2.4) * 40;
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, w: S, h: S };
}

function drawGrain() {
  if (!TILES.grain) TILES.grain = buildGrainTile();
  const t = TILES.grain;
  // Static under reduced motion: texture without the dance.
  const ox = prefersReducedMotion ? 0 : -((Math.random() * t.w) | 0);
  const oy = prefersReducedMotion ? 0 : -((Math.random() * t.h) | 0);
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (let y = oy; y < viewH; y += t.h) {
    for (let x = ox; x < viewW; x += t.w) ctx.drawImage(t.canvas, x, y, t.w, t.h);
  }
  ctx.restore();
}

// Cinema bars. They close in through the Build and the Drive and are
// deepest through the final furlong — the frame literally narrows as the
// race does — and ease back a little as the camera opens up at the line.
function drawLetterbox() {
  const f = DIRECTOR.letterbox;
  if (f <= 0.002) return;
  const bar = Math.round(viewH * f);
  ctx.fillStyle = '#020306';
  ctx.fillRect(0, 0, viewW, bar);
  ctx.fillRect(0, viewH - bar, viewW, bar);
}
// ════════════════════════════════════════════════════════════════
//  MARGINS
// ════════════════════════════════════════════════════════════════
// Turning the Racing API beaten-distance strings into numbers and back
// into racing copy. Used by the finish overlay, the roll call and the
// reveal podium, so it lives between the world and the screens.

// Parse the Racing API beaten-distance string into a numeric lengths
// value. Handles: 'nse', 'sh', 'hd', 'nk', '½', '1¼', '2', '5', 'dist',
// 'DH'. Returns:
//   number      — lengths (e.g. 0.05 for nose, 1.25 for 1¼)
//   -1          — dead heat sentinel
//   null        — unparseable / missing
function parseBeatenDistance(s) {
  if (!s && s !== 0) return null;
  const t = String(s).trim().toLowerCase();
  if (!t) return null;
  if (t === 'dh' || t === 'dead heat' || t === 'dead-heat') return -1;
  const TOKEN = {
    'nse': 0.05, 'nose': 0.05,
    'sh':  0.10, 'short head': 0.10, 'short-head': 0.10, 'shd': 0.10,
    'hd':  0.15, 'head': 0.15,
    'nk':  0.25, 'neck': 0.25,
    'dist': 99,  'distance': 99,
  };
  if (TOKEN[t] !== undefined) return TOKEN[t];
  // Numeric parsing — strip 'L'/'l' suffix, convert vulgar fractions,
  // handle "1 1/2" mixed numbers + plain "n/d" fractions.
  let c = t.replace(/l$/, '').trim();
  c = c.replace(/¼/g, '.25').replace(/½/g, '.5').replace(/¾/g, '.75')
       .replace(/⅓/g, '.333').replace(/⅔/g, '.667');
  // "1 1/4" → "1.25"
  c = c.replace(/(\d+)\s+(\d+)\/(\d+)/g, (_, w, n, d) =>
    (parseInt(w, 10) + parseInt(n, 10) / parseInt(d, 10)).toString());
  // "1/2" → "0.5"
  c = c.replace(/^(\d+)\/(\d+)$/, (_, n, d) =>
    (parseInt(n, 10) / parseInt(d, 10)).toString());
  c = c.replace(/\s+/g, '');
  const n = parseFloat(c);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

// Format a numeric lengths value back into the standard racing copy
// used by Racing Post / ATR. Tuned for the finish-line headline so
// the eye reads it at a glance ("1¼ LENGTHS", "A SHORT HEAD").
// Racing's words for a margin under a length and a bit:
// [below this many lengths, headline copy, compact copy].
const MARGIN_WORDS = [
  [0.08, 'A NOSE',                     'nse'],
  [0.12, 'A SHORT HEAD',               'shd'],
  [0.20, 'A HEAD',                     'hd'],
  [0.40, 'A NECK',                     'nk'],
  [0.65, 'HALF A LENGTH',              '½L'],
  [0.90, 'THREE-QUARTERS OF A LENGTH', '¾L'],
  [1.10, 'A LENGTH',                   '1L'],
];

// A margin to the nearest quarter of a length, with a vulgar fraction:
// { value: 2.75, text: '2¾' }.
function quarterLengths(lengths) {
  const q = Math.round(lengths * 4) / 4;
  const whole = Math.floor(q);
  const frac  = q - whole;
  const fracStr = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  return { value: q, text: whole + fracStr };
}

// Headline copy for a margin in lengths ("A NECK", "2¾ LENGTHS"); -1 is
// a dead heat.
function formatBeatenDistance(lengths) {
  if (lengths === null || lengths === undefined) return '';
  if (lengths === -1) return 'DEAD HEAT';
  if (lengths >= 50) return 'A DISTANCE';
  const words = MARGIN_WORDS.find(([below]) => lengths < below);
  if (words) return words[1];
  const q = quarterLengths(lengths);
  return q.text + (q.value === 1 ? ' LENGTH' : ' LENGTHS');
}

// Racecard copy for the podium ("nk", "2¾L", "DH").
function formatBeatenDistanceCompact(lengths) {
  if (lengths === null || lengths === undefined) return '';
  if (lengths === -1) return 'DH';
  if (lengths >= 50) return 'dist';
  const words = MARGIN_WORDS.find(([below]) => lengths < below);
  if (words) return words[2];
  return quarterLengths(lengths).text + 'L';
}

// Compute the winning margin at the finish.
// Returns { lengths, source, winners } where:
//   lengths     — numeric lengths (winner over 2nd), -1 for dead heat
//   source      — 'result' | 'forecast' — drives copy + chip styling
//   winners     — array of horse names — usually [winner] or [dh1, dh2]
function computeWinningMargin() {
  const ranked = rankedHorses();
  if (ranked.length < 1) return null;
  const winnerName = ranked[0].runner.name;

  // ── Result mode — read from the Racing API beaten_distances ──
  if (REPLAY_DATA && REPLAY_DATA.has_result) {
    const dists = REPLAY_DATA.beaten_distances || {};
    // Find the dead-heat case first — 2nd-placed runner's gap is 'DH'.
    if (ranked.length >= 2) {
      const secondGap = parseBeatenDistance(dists[ranked[1].runner.id]);
      if (secondGap === -1) {
        return {
          lengths: -1,
          source:  'result',
          winners: [winnerName, ranked[1].runner.name],
        };
      }
      return {
        lengths: secondGap == null ? null : secondGap,
        source:  'result',
        winners: [winnerName],
      };
    }
  }

  // ── Forecast mode — derive from final X positions ──
  // World space measures the gap in lengths directly — no pixels-per-
  // length fudge factor, because a length IS the unit the model runs in.
  if (ranked.length < 2) {
    return { lengths: null, source: 'forecast', winners: [winnerName] };
  }
  const lengths = Math.max(0, ranked[1].deficit - ranked[0].deficit);
  return { lengths: lengths, source: 'forecast', winners: [winnerName] };
}
// ════════════════════════════════════════════════════════════════
//  THE FIELD
// ════════════════════════════════════════════════════════════════
// Three things changed here from V1, and all three came straight off
// the review:
//
//   • No trails. drawSpeedLines is gone. Speed now comes from the
//     parallax planes moving past a broadly stationary pack, which is
//     how a real camera shot reads. Streaks welded to a sprite are
//     what made it look like a browser game.
//   • No persistent labels. There is no name chip, no rank pill and no
//     pulsing gold ring on any runner at any point. Identification is
//     the broadcast lower-third plus, briefly, a thin ground marker.
//   • Depth. Runners are drawn far-lane-first and scaled by lane, so
//     the pack overlaps and occludes the way a real field does.

function drawField() {
  const vis    = visibleWorldRange(140);
  const ranked = rankedHorses();

  // Far lanes first so nearer horses occlude them.
  const drawList = horsesByLane.filter((h) => h.worldX >= vis.min && h.worldX <= vis.max);

  // The principal group stays fully lit; the tail recedes as the
  // director closes the frame down. Nobody is removed — a horse coming
  // through from the back still reads.
  const groupSize = principalGroupSize(ranked.length);
  const inGroup = new Set();
  for (let i = 0; i < groupSize; i++) inGroup.add(ranked[i].runner.id);

  // Only the opacity changes from horse to horse, so it is put back by
  // hand rather than by a save and restore per horse.
  const alpha = ctx.globalAlpha;
  drawList.forEach((h) => {
    const isUser = isUserPick(h.runner);
    const isFox  = isFoxPick(h.runner);

    ctx.globalAlpha = (!inGroup.has(h.runner.id) && DIRECTOR.fieldFade > 0)
      ? 1 - DIRECTOR.fieldFade * 0.72
      : alpha;

    // Restrained identification. A thin arc of the runner's own silk
    // colour on the turf beneath them, and only while the broadcast
    // lower-third is naming them — it fades with idGlow. The viewer's
    // pick and the Fox pick get a permanent but very quiet version of
    // the same mark: no text, no box, no glow around the animal.
    const markAlpha = Math.max(h.idGlow, (isUser || isFox) ? 0.5 : 0);
    if (markAlpha > 0.01) {
      drawGroundMarker(h, markAlpha, isUser ? COL.userLabel
                                   : isFox  ? COL.foxLabel
                                   :          (h.runner.silk || '#f5efde'));
    }

    const scale = WORLD.horseScale * h.depth;
    spawnHoofDust(h.worldX, h.y, h, strideCycle(h), scale);
    drawHorseSilhouette(h.worldX, h.y, h, scale);
  });
  ctx.globalAlpha = alpha;
}

// A short bar on the turf beneath the hooves, in the runner's own silk
// colour. Deliberately the least emphatic mark that still works: an
// ellipse or a glow around the animal is the arcade treatment we are
// getting rid of, and a floating chip is the label we just removed.
function drawGroundMarker(h, alpha, colour) {
  const s = WORLD.horseScale * h.depth;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha) * 0.75;
  ctx.fillStyle = colour;
  const w = 30 * s;
  ctx.fillRect(h.worldX - w / 2, h.y + 24 * s, w, Math.max(1.5, 2 * s));
  ctx.restore();
}

// ── Hoof dust ───────────────────────────────────────────────────
// Spawned at each gallop ground-contact beat and drawn in WORLD space,
// so a divot stays where it was kicked up and the camera leaves it
// behind. In V1 the dust lived in screen space on a canvas stacked
// underneath an opaque track, which is why nobody ever saw it.
const MAX_PARTICLES = 160;

function spawnHoofDust(wx, y, h, cyc, artScale) {
  if (prefersReducedMotion) return;
  if (particles.length > MAX_PARTICLES) return;
  if (h.speed < 0.02) return;

  const prevCyc = h.lastDustCycle == null ? cyc : h.lastDustCycle;
  h.lastDustCycle = cyc;

  for (const strike of GAIT_STRIKES) {
    const crossed = (prevCyc > strike)
      ? (cyc < prevCyc && cyc >= strike) || (cyc < strike && cyc < prevCyc - 0.5)
      : (cyc >= strike && prevCyc < strike);
    if (!crossed) continue;

    const puffs = Math.random() < 0.55 ? 1 : 0;
    for (let i = 0; i < puffs; i++) {
      particles.push({
        x:      wx - 16 * artScale - Math.random() * 10 * artScale,
        y:      y + 19 * artScale + Math.random() * 3,
        // Kicked backwards hard enough to be left behind by a galloping
        // horse — without this the puffs pool under the animal and read
        // as a pale halo rather than as ground being torn up.
        vx:     -3.2 - Math.random() * 3.4,
        vy:     -0.35 - Math.random() * 0.8,
        g:      -0.02,
        life:   0.45 + Math.random() * 0.3,
        size:   (2.6 + Math.random() * 2.6) * artScale,
        depth:  artScale,
      });
    }
  }
}

// Dust is drawn inside the world transform, between the far lanes and
// the near ones, so it sits in the pack rather than on top of it.
function drawHoofDust(dt) {
  const step = dt > 0 ? Math.max(0.5, Math.min(2.5, dt / FRAME_MS)) : 0;
  particles = particles.filter((p) => {
    p.vy += p.g * step;
    p.x  += p.vx * step;
    p.y  += p.vy * step;
    p.life -= 0.014 * step;
    if (p.life <= 0) return false;
    ctx.globalAlpha = p.life * 0.20;
    ctx.fillStyle = 'rgb(186,170,140)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    return true;
  });
  ctx.globalAlpha = 1;
}

// ── Press flashguns ─────────────────────────────────────────────
// The photographers are banked up at the winning post, and the wall of
// flashguns going off as the field crosses is the single most
// recognisable image in racing. They fire in the crowd BEHIND the rail,
// so the horses occlude them, and each one lives about a sixth of a
// second — a flashgun is a hard pop, not a glow, and giving them a slow
// fade turns the finish into fairy lights.
const MAX_FLASHES = 60;
let pressFlashes = [];

function spawnPressFlashes(dt) {
  const intensity = DIRECTOR.pressFlash;
  if (intensity <= 0.02 || prefersReducedMotion) return;
  if (pressFlashes.length >= MAX_FLASHES) return;

  // Expected pops per second scales with the director's intensity.
  const perSecond = 85 * intensity;
  if (dt <= 0 || Math.random() > (perSecond * dt) / 1000) return;

  // Banked around the post, thickest right on it.
  const spreadLengths = 7 * (0.35 + Math.random());
  const side = Math.random() < 0.5 ? -1 : 1;
  pressFlashes.push({
    x:    WORLD.spanPx + side * spreadLengths * WORLD.lengthPx * Math.random(),
    y:    WORLD.trackTopY - 16 - Math.random() * Math.max(30, viewH * 0.09),
    life: 1,
    size: (10 + Math.random() * 12) * WORLD.horseScale,
  });
}

function drawPressFlashes(dt) {
  if (!pressFlashes.length) return 0;
  const step = dt > 0 ? Math.max(0.5, Math.min(2.5, dt / FRAME_MS)) : 0;
  let energy = 0;
  pressFlashes = pressFlashes.filter((f) => {
    f.life -= 0.115 * step;
    if (f.life <= 0) return false;
    // Sharp attack, sharp decay — the curve is what makes it a flashgun.
    const a = f.life * f.life;
    energy += a;
    const r = f.size * (1.5 - f.life * 0.5);
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    g.addColorStop(0,    'rgba(255,255,255,' + a.toFixed(3) + ')');
    g.addColorStop(0.22, 'rgba(240,248,255,' + (0.7 * a).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(200,222,255,' + (0.22 * a).toFixed(3) + ')');
    g.addColorStop(1,    'rgba(180,210,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();

    // A short horizontal streak on the freshest pops. Camera flashes in
    // a bank read as a line of light, not a field of dots.
    if (f.life > 0.55) {
      const sw = r * 2.6, sa = (f.life - 0.55) / 0.45;
      const sg = ctx.createLinearGradient(f.x - sw, f.y, f.x + sw, f.y);
      sg.addColorStop(0,   'rgba(220,236,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,' + (0.55 * sa).toFixed(3) + ')');
      sg.addColorStop(1,   'rgba(220,236,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(f.x - sw, f.y - 0.9, sw * 2, 1.8);
    }
    return true;
  });
  return energy;
}

// ════════════════════════════════════════════════════════════════
//  BROADCAST IDENTIFICATION
// ════════════════════════════════════════════════════════════════
// The replacement for the floating name chips. A lower-third slides in
// from the left, names one runner, and leaves — the way a director cuts
// to a name super when there is something worth saying about a horse.
// Four in a race, ~2.6s each.
//
// The element is created from JS rather than declared in index.html, so
// nothing has to move into the Django template (ARCHITECTURE.md §10).
const BROADCAST_ID_MS = 2600;

// Peak opacity of the ground marker under the runner being named. Also
// how far idGlow travels, which § RUNNER NAMEPLATES reads to know how
// far the super has come up: the plates defer in proportion to it, so
// the two have to agree on the top of the range.
const BROADCAST_ID_GLOW = 0.85;
let bcastEl = null;
let bcastTween = null;

function broadcastEl() {
  if (bcastEl && bcastEl.isConnected) return bcastEl;
  const screen = document.getElementById('screen-race');
  if (!screen) return null;
  const el = document.createElement('div');
  el.className = 'bcast-id';
  el.id = 'broadcastId';
  el.setAttribute('aria-live', 'polite');
  screen.appendChild(el);
  bcastEl = el;
  return el;
}

// role: 'leader' | 'challenger' | 'interest'
function identifyRunner(role, tag) {
  if (!raceRunning || !horses.length) return;
  const ranked = rankedHorses();
  let h = null;
  let label = tag;

  if (role === 'leader') {
    h = ranked[0];
  } else if (role === 'challenger') {
    h = ranked[1] || ranked[0];
  } else {
    // Something the viewer has a reason to care about: their own pick,
    // then the Fox pick, then whoever is making the most ground.
    const mine = horses.find((x) => isUserPick(x.runner));
    const fox  = horses.find((x) => isFoxPick(x.runner));
    if (mine)      { h = mine; label = label || 'YOUR PICK'; }
    else if (fox)  { h = fox;  label = label || 'FOX PICK';  }
    else           { h = ranked[Math.min(2, ranked.length - 1)]; label = label || 'IN TOUCH'; }
  }
  if (!h) return;
  showBroadcastId(h, label || 'IN FRONT');
}

function showBroadcastId(h, tag) {
  const el = broadcastEl();
  if (!el) return;

  el.innerHTML =
    '<span class="bcast-id__silk">' + renderCapSvg(h.runner) + '</span>' +
    '<span class="bcast-id__body">' +
      '<span class="bcast-id__name">' + esc(h.runner.name) + '</span>' +
      '<span class="bcast-id__meta">' + esc(h.runner.jockey) + ' &middot; ' + esc(h.runner.odds) + '</span>' +
    '</span>' +
    '<span class="bcast-id__tag">' + tag + '</span>';

  if (bcastTween) bcastTween.kill();
  const tl = gsap.timeline();
  tl.fromTo(el, { opacity: 0, x: -26 },
                { opacity: 1, x: 0, duration: 0.42, ease: 'power3.out' });
  tl.to(el, { opacity: 0, x: -14, duration: 0.34, ease: 'power2.in' },
        '+=' + (BROADCAST_ID_MS / 1000));
  bcastTween = tl;

  // Matching ground marker under that runner, for exactly as long as
  // the lower-third is up.
  gsap.killTweensOf(h);
  gsap.fromTo(h, { idGlow: 0 }, {
    idGlow: BROADCAST_ID_GLOW, duration: 0.4, ease: 'power2.out',
    onComplete: () => gsap.to(h, {
      idGlow: 0, duration: 0.5, delay: BROADCAST_ID_MS / 1000, ease: 'power2.in',
    }),
  });
}

function clearBroadcastId() {
  if (bcastTween) { bcastTween.kill(); bcastTween = null; }
  if (bcastEl) { bcastEl.innerHTML = ''; gsap.set(bcastEl, { opacity: 0 }); }
}

// ════════════════════════════════════════════════════════════════
//  RENDER LOOP
// ════════════════════════════════════════════════════════════════
// Runs on gsap.ticker rather than a private requestAnimationFrame, so
// the timeline and the renderer are stepped by the same clock in the
// same order every frame. A frame reads state and draws; it never
// advances time and never decides anything about the race.

function renderFrame() {
  if (!raceRunning) return;

  const dt = Math.min(gsap.ticker.deltaRatio() * FRAME_MS, 50);
  frameClock += dt;

  if (HERO.active) { renderHeroFrame(dt); return; }

  updateRaceModel(dt);
  updateCamera(dt);
  drawRaceScene(dt);

  // DOM overlays — cheap, and each throttles itself.
  const p = DIRECTOR.progress;
  fireCommentary(p);
  updateCommentary(dt);
  updateLeaderboard(dt);
  updateRacePhaseTitle(p);
}

// The race picture for the current state. The particle systems (hoof
// dust, flashguns) step on by dt as they draw; with dt = 0 they are drawn
// where they are.
function drawRaceScene(dt) {
  drawBackdrop();

  ctx.clearRect(0, 0, viewW, viewH);
  pushWorldTransform(ctx);
  drawTurf();
  drawFarRail();
  drawFurlongMarkers();
  drawWinningPost();
  drawHoofDust(dt);
  spawnPressFlashes(dt);
  const flashEnergy = drawPressFlashes(dt);
  drawField();
  ctx.restore();

  drawForegroundPlane();
  drawRunnerLabels();
  drawAtmosphere(flashEnergy);
}

// Repaint the frame as it stands, without advancing anything — for a
// resize, which clears the canvas.
function redrawFrame() {
  if (!raceRunning) return;
  if (HERO.active) renderHeroFrame(0);
  else drawRaceScene(0);
}

// The editorial phase title and strip still come from BAND.phaseTable,
// which is tuned in the seed JSON. The final-furlong label is owned by
// the master timeline, so we stop overwriting it once we are past it.
function updateRacePhaseTitle(progress) {
  const pt = BAND.phaseTable;
  if (!pt || !pt.length) return;
  let active = pt[0];
  for (let i = 1; i < pt.length; i++) {
    if (progress >= pt[i].from) active = pt[i];
    else break;
  }
  if (DIRECTOR.phase !== 'line') setPhaseTitle(active.label);
  updatePhaseStrip(progress, pt, active);
}

function startTicker() {
  if (tickerRunning) return;
  gsap.ticker.add(renderFrame);
  tickerRunning = true;
}

function stopTicker() {
  if (!tickerRunning) return;
  gsap.ticker.remove(renderFrame);
  tickerRunning = false;
}

// ════════════════════════════════════════════════════════════════
//  THE HORSE
// ════════════════════════════════════════════════════════════════
// A thoroughbred and jockey at full gallop, drawn from paths. No sprite
// sheet: a production race can field 24 runners in silks we have never
// seen, so the whole animal is procedural and takes its colours from the
// payload.
//
// What makes a drawn horse read as real, in order of importance:
//
//   1. THE LEGS ARTICULATE. Each hoof follows a gallop path — planted
//      and sweeping back through the stance, then lifting, folding and
//      reaching forward through the swing — and the knee or hock angle
//      is SOLVED from where the hoof is (two-bone inverse kinematics).
//      So the foreleg folds at the knee as it comes through, the hind
//      leg tucks under the belly, and nothing ever swings like a stick.
//   2. VOLUME. The coat is lit from the sun: bright along the topline,
//      sheen over the quarters and shoulder, dark under the barrel, and
//      the muscle masses — forearm, gaskin — are shapes, not lines.
//   3. THE STRIDE MOVES THE WHOLE ANIMAL. The body pitches with the
//      stride, the head and neck nod as the forelegs land, and the
//      jockey rides it: he stays level while the horse moves under him.
//   4. THE JOCKEY IS A JOCKEY. Short irons, knees up at the withers,
//      flat back, hands down the neck on the reins, in the runner's
//      actual silks.
//   5. INDIVIDUALS. Coat colour, face markings and white socks are all
//      derived from the runner id, so every horse is recognisably the
//      same horse on every replay and no two in a field look cloned.
//
// Local grid, unchanged from V2 so HORSE_ART_LENGTH still defines a
// length: ground at y = +28, withers about y = -15, point of buttock
// x ≈ -21, muzzle x ≈ +55.

// Coat palettes: body / shade (muscle shadow) / points (mane, tail,
// lower legs) / belly (lit underline).
// body, shade and belly are the coat; points the mane, tail and lower
// legs. farLower and nearLower are the lower legs on each side (a bay's
// are black, a chestnut's stay chestnut); muzzle the soft nose; a grey
// has dapples.
const MUZZLE = 'rgba(20,12,8,0.55)';
const HORSE_COATS = [
  { name: 'bay',            body: '#7b4a1f', shade: '#4f2e11', points: '#1a1008', belly: '#9d6531',
    farLower: '#1a1008', nearLower: '#1a1008', muzzle: MUZZLE },
  { name: 'dark bay',       body: '#553219', shade: '#35200c', points: '#140c06', belly: '#724a22',
    farLower: '#140c06', nearLower: '#140c06', muzzle: MUZZLE },
  { name: 'chestnut',       body: '#a0582a', shade: '#6d3915', points: '#8a4718', belly: '#c2783f',
    farLower: '#5c3014', nearLower: '#6d3915', muzzle: MUZZLE },
  { name: 'liver chestnut', body: '#6a371b', shade: '#44220f', points: '#552a12', belly: '#8a532b',
    farLower: '#552a12', nearLower: '#44220f', muzzle: MUZZLE },
  { name: 'black',          body: '#2f241c', shade: '#18120d', points: '#0d0a07', belly: '#4a392a',
    farLower: '#0d0a07', nearLower: '#0d0a07', muzzle: MUZZLE },
  { name: 'grey',           body: '#aca6a0', shade: '#7b746f', points: '#5a534e', belly: '#cbc5bf',
    farLower: '#6a635e', nearLower: '#7b746f', muzzle: '#6c645e', dapples: true },
].map(Object.freeze);

function runnerHash(runner) {
  const id = String((runner && runner.id) || (runner && runner.name) || '');
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash;
}

// Deterministic per-runner coat. Same horse, same colour, every replay.
function coatFor(runner) {
  // Weighted the way a real field looks: mostly bay and chestnut, with
  // the grey and the black as the two that catch the eye.
  const WEIGHTS = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5];
  return HORSE_COATS[WEIGHTS[runnerHash(runner) % WEIGHTS.length]];
}

// Face marking and white socks, also from the id. Roughly a third of
// horses carry a blaze or stripe and a fifth of legs a white sock, which
// is about what a real field looks like.
// Runner ids are short ("12", "1043"), so the high bits of the string
// hash are always zero — reading markings straight off it gave every
// horse in the field the same socks. An integer finaliser spreads the
// bits properly before we read them.
function mixHash(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function markingsFor(runner) {
  const hsh = mixHash(runnerHash(runner));
  const FACE = ['none', 'none', 'none', 'star', 'stripe', 'blaze'];
  const r = (n) => ((hsh >>> n) & 7);
  return {
    face:  FACE[(hsh >>> 5) % FACE.length],
    // [far fore, near fore, far hind, near hind]
    socks: [r(8) === 0, r(11) === 1, r(14) < 2, r(17) < 2],
  };
}

