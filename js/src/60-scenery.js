// ── Painting helpers ─────────────────────────────────────────────
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(list) { return list[(Math.random() * list.length) | 0]; }
function rgb(c, k) {
  const f = k == null ? 1 : k;
  return 'rgb(' + Math.min(255, c[0] * f | 0) + ',' +
                  Math.min(255, c[1] * f | 0) + ',' +
                  Math.min(255, c[2] * f | 0) + ')';
}

// Paint something that may straddle the tile's left or right edge twice,
// once on each side, so the tile repeats without a visible seam.
function wrapPaint(w, x, r, fn) {
  fn(x);
  if (x - r < 0) fn(x + w);
  if (x + r > w) fn(x - w);
}

// Aerial perspective. Distance lifts and blues everything a little; a
// grandstand three furlongs away is not as contrasty as the horse in
// front of you, and that difference is half of what makes a scene read
// as deep rather than as layered cut-outs. source-atop keeps it off the
// transparent gaps in the tile.
function hazeTile(g, w, h, rgba) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = rgba;
  g.fillRect(0, 0, w, h);
  g.restore();
}

// Depth of field for pre-painted planes. The far planes sit slightly
// out of focus behind the pin-sharp field, exactly as they would on a
// long lens. The blur is applied to a copy of the tile laid out three
// wide, then the middle third is kept, so the edges blur INTO the next
// repeat rather than into transparency — otherwise every tile join shows
// as a faint vertical seam. ctx.filter is not universal (older Safari);
// where it is missing the tile is used as painted.
const CANVAS_FILTER_OK = (() => {
  try {
    const t = document.createElement('canvas').getContext('2d');
    return typeof t.filter === 'string';
  } catch { return false; }
})();

function softenTile(tile, cssPx) {
  if (!tile || !CANVAS_FILTER_OK || cssPx <= 0) return tile;
  const W = tile.canvas.width, H = tile.canvas.height;
  const k = W / tile.w;                       // device px per css px
  const wide = document.createElement('canvas');
  wide.width = W * 3; wide.height = H;
  const wg = wide.getContext('2d');
  wg.drawImage(tile.canvas, 0, 0);
  wg.drawImage(tile.canvas, W, 0);
  wg.drawImage(tile.canvas, W * 2, 0);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const og = out.getContext('2d');
  og.filter = 'blur(' + (cssPx * k).toFixed(2) + 'px)';
  og.drawImage(wide, -W, 0);
  return { canvas: out, w: tile.w, h: tile.h };
}

// ── Crowd ────────────────────────────────────────────────────────
// At three furlongs a spectator is two or three pixels: a dark body, a
// point of skin, sometimes a hat. The first pass drew them as neat
// circles on neat ellipses in neat rows, which is exactly why the stand
// read as a cartoon. A real crowd at distance is a textured mass: mostly
// dark and neutral clothing, irregular spacing, empty seats showing
// through, riser shadows under each row, and everything under the roof
// sitting in deep shade.
const CLOTHES = [
  [24, 27, 34], [30, 34, 44], [40, 46, 60], [52, 58, 74], [62, 66, 72],
  [88, 92, 100], [120, 124, 130], [160, 162, 166], [214, 214, 212],
  [232, 228, 218], [186, 170, 142], [128, 104, 80], [84, 62, 46],
  [140, 36, 40], [36, 62, 112], [196, 164, 64], [58, 94, 66], [150, 112, 142],
];
const SKINS = [[226, 188, 152], [206, 160, 124], [170, 122, 88], [118, 82, 56], [238, 206, 178]];
const HAIR  = [[28, 22, 18], [52, 38, 26], [96, 72, 44], [150, 140, 130]];

function paintCrowd(g, x0, y0, x1, y1, light, fill, rowH, seat) {
  for (let y = y0; y + rowH <= y1 + 0.01; y += rowH) {
    // The riser under each row — the single most important line for
    // making a terrace read as stepped rather than as a flat wall.
    g.fillStyle = 'rgba(0,0,0,' + (0.28 * light + 0.08).toFixed(3) + ')';
    g.fillRect(x0, y + rowH - 0.55, x1 - x0, 0.55);

    let x = x0 + Math.random() * 1.4;
    while (x < x1) {
      const pw = rnd(1.15, 1.75);
      if (Math.random() < fill) {
        const k = light * rnd(0.8, 1.12);
        g.fillStyle = rgb(pick(CLOTHES), k);
        g.fillRect(x, y + rowH * 0.36, pw, rowH * 0.64);
        g.fillStyle = rgb(pick(SKINS), light * rnd(0.86, 1.05));
        g.fillRect(x + pw * 0.2, y + rowH * 0.04, pw * 0.6, rowH * 0.34);
        if (Math.random() < 0.38) {
          g.fillStyle = rgb(pick(HAIR), light);
          g.fillRect(x + pw * 0.14, y, pw * 0.72, rowH * 0.13);
        }
      } else if (seat) {
        g.fillStyle = rgb(seat, light * 0.9);
        g.fillRect(x, y + rowH * 0.42, pw, rowH * 0.5);
      }
      x += pw + rnd(0.2, 0.55);
    }
  }
}

// Aisles and stairways cut through the seating at regular intervals.
function paintAisles(g, x0, y0, x1, y1, every, light) {
  for (let x = x0 + every * 0.5; x < x1 - 4; x += every + rnd(-6, 6)) {
    g.fillStyle = rgb([150, 150, 146], light * 0.75);
    g.fillRect(x, y0, 2.6, y1 - y0);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = y0; y < y1; y += 2.6) g.fillRect(x, y + 2, 2.6, 0.5);
  }
}

// ── Clouds ───────────────────────────────────────────────────────
// A cumulus is dozens of overlapping billows sitting on a flat base,
// lit from above: bright warm-white crowns, blue-grey bellies. Each
// billow is a radial gradient whose hot spot is pushed toward the sun,
// drawn bottom-up so the lit tops overlap the shaded undersides. That
// is the whole trick — a flat white shape is what makes a cloud look
// drawn rather than photographed.
function paintCumulus(g, cx, baseY, W, H) {
  const puffs = [];
  const n = Math.round(12 + W / 11);
  for (let i = 0; i < n; i++) {
    const t = Math.random() * 2 - 1;
    const dome = Math.sqrt(Math.max(0, 1 - t * t));
    const r = H * rnd(0.2, 0.44) * (0.5 + 0.5 * dome);
    puffs.push({
      x: cx + t * W * 0.46,
      y: baseY - r * 0.5 - dome * H * rnd(0.12, 0.62),
      r: r,
    });
  }
  puffs.sort((a, b) => b.y - a.y);

  g.save();
  // Cumulus sit on a condensation level: the base is flat.
  g.beginPath();
  g.rect(cx - W, baseY - H * 2, W * 2, H * 2 + H * 0.05);
  g.clip();
  for (const p of puffs) {
    const lift = Math.max(0, Math.min(1, (baseY - p.y) / H));
    const body = [172 + lift * 80, 182 + lift * 70, 200 + lift * 52];
    const hx = p.x + p.r * 0.3, hy = p.y - p.r * 0.36;
    const gr = g.createRadialGradient(hx, hy, p.r * 0.04, p.x, p.y, p.r);
    gr.addColorStop(0,    'rgba(255,253,247,' + (0.7 + lift * 0.28).toFixed(3) + ')');
    gr.addColorStop(0.42, 'rgba(' + (body[0] | 0) + ',' + (body[1] | 0) + ',' + (body[2] | 0) + ',0.8)');
    gr.addColorStop(0.78, 'rgba(' + (body[0] | 0) + ',' + (body[1] | 0) + ',' + (body[2] | 0) + ',0.3)');
    gr.addColorStop(1,    'rgba(' + (body[0] | 0) + ',' + (body[1] | 0) + ',' + (body[2] | 0) + ',0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // Shaded base
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const b = g.createLinearGradient(0, baseY - H * 0.32, 0, baseY + H * 0.05);
  b.addColorStop(0, 'rgba(136,150,176,0)');
  b.addColorStop(1, 'rgba(136,150,176,0.42)');
  g.fillStyle = b;
  g.fillRect(cx - W * 0.6, baseY - H * 0.32, W * 1.2, H * 0.4);
  g.restore();
}

// High, thin cloud: stretched soft streaks rather than billows.
function paintCirrus(g, cx, cy, W, H) {
  const n = 6 + (Math.random() * 6 | 0);
  for (let i = 0; i < n; i++) {
    const x = cx + (Math.random() - 0.5) * W * 0.8;
    const y = cy + (Math.random() - 0.5) * H * 0.6;
    const rx = W * rnd(0.14, 0.32);
    const ry = H * rnd(0.12, 0.26);
    g.save();
    g.translate(x, y);
    g.rotate(rnd(-0.06, 0.06));
    g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, 'rgba(252,251,248,' + rnd(0.28, 0.46).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(236,242,250,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

// ── Grandstands ──────────────────────────────────────────────────
// One wide tile holds a composed skyline rather than one stand repeated
// every 540px, which was the other giveaway: a modern cantilevered main
// stand with a glazed hospitality level, an older stand with a pitched
// roof and white iron columns, and a big screen on legs. Gaps between
// them let the downland and the sky show through.
// The main stand, a cantilevered modern grandstand, painted level by
// level from the roof down. `st` is its geometry: left and right edges,
// width, height, and the heights where each level ends.
function paintMainStand(g, L, R, h) {
  const st = {
    L, R, W: R - L, h,
    fY0: h * 0.10, fY1: h * 0.16,    // roof fascia
    uY1: h * 0.42,                   // upper tier ends
    gY1: h * 0.53,                   // glazing ends
    sY1: h * 0.555,                  // balcony slab
    lY1: h * 0.89,                   // lower tier ends
  };
  paintStandFlags(g, st);
  paintStandUpperTier(g, st);
  paintStandFascia(g, st);
  paintStandGlazing(g, st);
  paintStandLowerTier(g, st);
  paintStandColumns(g, st);
  paintStandWall(g, st);
}

function paintStandFlags(g, st) {
  const { L, R, W, h, fY0 } = st;
  // Flags along the roofline
  const FLAGS = [[196, 40, 44], [240, 238, 232], [212, 175, 55], [32, 60, 112]];
  for (let x = L + W * 0.08; x < R - 8; x += W / 6 + rnd(-8, 8)) {
    g.fillStyle = 'rgba(210,214,220,0.9)';
    g.fillRect(x, fY0 - h * 0.085, 0.7, h * 0.085);
    g.fillStyle = rgb(pick(FLAGS), 0.95);
    const fw = h * 0.05, fh = h * 0.032;
    g.beginPath();
    g.moveTo(x + 0.7, fY0 - h * 0.085);
    g.quadraticCurveTo(x + fw * 0.5, fY0 - h * 0.085 - fh * 0.2, x + fw, fY0 - h * 0.08);
    g.lineTo(x + fw, fY0 - h * 0.08 + fh);
    g.quadraticCurveTo(x + fw * 0.5, fY0 - h * 0.085 + fh * 0.8, x + 0.7, fY0 - h * 0.085 + fh);
    g.closePath();
    g.fill();
  }
}

function paintStandUpperTier(g, st) {
  const { L, R, W, h, fY1, uY1 } = st;
  // Under-roof void: the back wall and upper tier sit in deep shade.
  const shade = g.createLinearGradient(0, fY1, 0, uY1);
  shade.addColorStop(0, 'rgb(22,26,34)');
  shade.addColorStop(1, 'rgb(40,46,56)');
  g.fillStyle = shade;
  g.fillRect(L, fY1, W, uY1 - fY1);
  paintCrowd(g, L + 2, fY1 + h * 0.02, R - 2, uY1, 0.44, 0.9, 2.5, [34, 48, 70]);
  paintAisles(g, L, fY1 + h * 0.02, R, uY1, 74, 0.45);
  // The roof's shadow falls hardest on the rows right under it.
  const roofShadow = g.createLinearGradient(0, fY1, 0, fY1 + (uY1 - fY1) * 0.55);
  roofShadow.addColorStop(0, 'rgba(8,10,16,0.62)');
  roofShadow.addColorStop(1, 'rgba(8,10,16,0)');
  g.fillStyle = roofShadow;
  g.fillRect(L, fY1, W, (uY1 - fY1) * 0.55);
  // Roof trusses in the gloom
  g.strokeStyle = 'rgba(160,170,184,0.10)';
  g.lineWidth = 0.6;
  for (let x = L; x < R; x += 16) {
    g.beginPath();
    g.moveTo(x, fY1);
    g.lineTo(x + 8, fY1 + h * 0.035);
    g.lineTo(x + 16, fY1);
    g.stroke();
  }
}

function paintStandFascia(g, st) {
  const { L, W, fY0, fY1 } = st;
  // Roof fascia, sunlit, with a hard highlight on the leading edge
  const fascia = g.createLinearGradient(0, fY0, 0, fY1);
  fascia.addColorStop(0, 'rgb(236,238,236)');
  fascia.addColorStop(1, 'rgb(188,194,200)');
  g.fillStyle = fascia;
  g.fillRect(L - 3, fY0, W + 6, fY1 - fY0);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(L - 3, fY0, W + 6, 0.8);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(L - 3, fY1, W + 6, 1);
}

function paintStandGlazing(g, st) {
  const { L, R, W, uY1, gY1 } = st;
  // Glazed hospitality level: dark glass, a sky reflection across the
  // top, and warm light in some of the boxes.
  const glass = g.createLinearGradient(0, uY1, 0, gY1);
  glass.addColorStop(0,    'rgb(96,120,146)');
  glass.addColorStop(0.35, 'rgb(52,66,84)');
  glass.addColorStop(1,    'rgb(24,30,40)');
  g.fillStyle = glass;
  g.fillRect(L, uY1, W, gY1 - uY1);
  for (let x = L + 2; x < R - 10; x += 13) {
    if (Math.random() < 0.34) {
      g.fillStyle = 'rgba(255,206,146,' + rnd(0.22, 0.5).toFixed(3) + ')';
      g.fillRect(x + 1, uY1 + (gY1 - uY1) * 0.38, 11, (gY1 - uY1) * 0.5);
      // Someone at the window
      if (Math.random() < 0.5) {
        g.fillStyle = 'rgba(18,16,16,0.55)';
        g.fillRect(x + rnd(3, 8), uY1 + (gY1 - uY1) * 0.5, 1.3, (gY1 - uY1) * 0.38);
      }
    }
    g.fillStyle = 'rgba(14,18,24,0.8)';
    g.fillRect(x, uY1, 0.8, gY1 - uY1);
  }
}

function paintStandLowerTier(g, st) {
  const { L, R, W, h, gY1, sY1, lY1 } = st;
  // Balcony slab and its shadow on the lower tier
  g.fillStyle = 'rgb(214,212,204)';
  g.fillRect(L - 2, gY1, W + 4, sY1 - gY1);
  const slabShadow = g.createLinearGradient(0, sY1, 0, sY1 + h * 0.08);
  slabShadow.addColorStop(0, 'rgba(0,0,0,0.38)');
  slabShadow.addColorStop(1, 'rgba(0,0,0,0)');

  // Lower tier, in the sun
  g.fillStyle = 'rgb(58,64,70)';
  g.fillRect(L, sY1, W, lY1 - sY1);
  paintCrowd(g, L + 2, sY1 + 0.5, R - 2, lY1, 0.98, 0.84, 2.9, [30, 92, 84]);
  paintAisles(g, L, sY1, R, lY1, 74, 0.95);
  g.fillStyle = slabShadow;
  g.fillRect(L, sY1, W, h * 0.08);
}

function paintStandColumns(g, st) {
  const { L, R, W, fY1, gY1 } = st;
  // Steel columns, lit on the sun side
  for (let x = L + W / 7; x < R - 6; x += W / 7) {
    g.fillStyle = 'rgb(38,44,54)';
    g.fillRect(x, fY1, 2.4, gY1 - fY1);
    g.fillStyle = 'rgba(220,226,232,0.5)';
    g.fillRect(x + 1.7, fY1, 0.7, gY1 - fY1);
  }
}

function paintStandWall(g, st) {
  const { L, W, h, lY1 } = st;
  // Front wall
  const wall = g.createLinearGradient(0, lY1, 0, h);
  wall.addColorStop(0, 'rgb(232,228,216)');
  wall.addColorStop(1, 'rgb(196,190,176)');
  g.fillStyle = wall;
  g.fillRect(L - 2, lY1, W + 4, h - lY1);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(L - 2, lY1, W + 4, 0.8);
}

function paintOldStand(g, L, R, h) {
  const W = R - L;
  const rY0 = h * 0.36, rY1 = h * 0.45, lY1 = h * 0.89;

  // Pitched roof seen from the front: slate band with gables at the ends
  const slate = g.createLinearGradient(0, rY0, 0, rY1);
  slate.addColorStop(0, 'rgb(74,78,86)');
  slate.addColorStop(1, 'rgb(44,48,56)');
  g.fillStyle = slate;
  g.beginPath();
  g.moveTo(L - 4, rY1);
  g.lineTo(L + W * 0.04, rY0);
  g.lineTo(R - W * 0.04, rY0);
  g.lineTo(R + 4, rY1);
  g.closePath();
  g.fill();
  // Gable pediment at the centre, with a clock
  const cx = (L + R) / 2;
  g.fillStyle = 'rgb(226,222,210)';
  g.beginPath();
  g.moveTo(cx - W * 0.1, rY0 + 1);
  g.lineTo(cx, rY0 - h * 0.1);
  g.lineTo(cx + W * 0.1, rY0 + 1);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgb(30,32,36)';
  g.beginPath();
  g.arc(cx, rY0 - h * 0.035, h * 0.024, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgb(236,232,220)';
  g.beginPath();
  g.arc(cx, rY0 - h * 0.035, h * 0.018, 0, Math.PI * 2);
  g.fill();
  // Lit gutter line
  g.fillStyle = 'rgba(236,236,230,0.85)';
  g.fillRect(L - 4, rY1, W + 8, 1.2);

  // Seating under the roof, shaded near the top
  g.fillStyle = 'rgb(46,50,56)';
  g.fillRect(L, rY1 + 1, W, lY1 - rY1 - 1);
  paintCrowd(g, L + 2, rY1 + 2, R - 2, lY1, 0.7, 0.78, 2.8, [96, 34, 40]);
  const under = g.createLinearGradient(0, rY1, 0, rY1 + (lY1 - rY1) * 0.5);
  under.addColorStop(0, 'rgba(6,8,12,0.55)');
  under.addColorStop(1, 'rgba(6,8,12,0)');
  g.fillStyle = under;
  g.fillRect(L, rY1, W, (lY1 - rY1) * 0.5);

  // White cast-iron columns — the signature of a Victorian stand
  for (let x = L + 6; x < R - 4; x += W / 9) {
    g.fillStyle = 'rgb(236,234,228)';
    g.fillRect(x, rY1 + 1, 1.3, lY1 - rY1);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + 1.3, rY1 + 1, 0.6, lY1 - rY1);
  }

  const wall = g.createLinearGradient(0, lY1, 0, h);
  wall.addColorStop(0, 'rgb(224,218,204)');
  wall.addColorStop(1, 'rgb(188,180,164)');
  g.fillStyle = wall;
  g.fillRect(L - 2, lY1, W + 4, h - lY1);
}

function paintBigScreen(g, L, R, h) {
  const W = R - L;
  const top = h * 0.2, bot = h * 0.56;
  // Legs
  g.fillStyle = 'rgb(34,38,46)';
  g.fillRect(L + W * 0.2, bot, 2.2, h - bot);
  g.fillRect(R - W * 0.2 - 2.2, bot, 2.2, h - bot);
  // Frame + panel showing the race, as every course's big screen does
  g.fillStyle = 'rgb(16,18,22)';
  g.fillRect(L, top, W, bot - top);
  const img = g.createLinearGradient(0, top + 2, 0, bot - 2);
  img.addColorStop(0,    'rgb(104,150,196)');
  img.addColorStop(0.42, 'rgb(150,174,188)');
  img.addColorStop(0.46, 'rgb(46,92,62)');
  img.addColorStop(1,    'rgb(30,70,46)');
  g.fillStyle = img;
  g.fillRect(L + 2, top + 2, W - 4, bot - top - 4);
  // A couple of tiny runners on screen
  g.fillStyle = 'rgba(40,24,14,0.8)';
  g.fillRect(L + W * 0.42, top + (bot - top) * 0.6, W * 0.1, 1.4);
  g.fillRect(L + W * 0.56, top + (bot - top) * 0.64, W * 0.1, 1.4);
  // Screen glare
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(L + 2, top + 2, W - 4, (bot - top) * 0.25);
}

// ── Trees ────────────────────────────────────────────────────────
// Built from leaf clusters rather than single ellipses: forty-odd small
// clumps per crown, each shaded by where it sits relative to the light,
// so the crown has a lit upper-right shoulder and a dark underside. A
// few tall narrow poplars break up the line.
const LEAF = [[26, 44, 32], [34, 56, 38], [44, 70, 46], [58, 86, 56], [74, 102, 64], [94, 122, 74]];

function paintTree(g, cx, groundY, hT, cw, tall) {
  const crownCY = groundY - hT * 0.56;
  const rx = cw / 2, ry = hT * 0.46;
  // Trunk
  g.fillStyle = 'rgb(44,36,28)';
  g.fillRect(cx - 0.6, groundY - hT * 0.3, 1.2, hT * 0.3);
  const n = tall ? 34 : 46;
  const clumps = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random());
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d;
    const light = 0.5 + 0.34 * (dx * 0.6 - dy * 0.8) + rnd(-0.12, 0.12);
    clumps.push({ x: cx + dx * rx, y: crownCY + dy * ry, r: cw * rnd(0.08, 0.17), l: light });
  }
  clumps.sort((a, b) => a.l - b.l);
  for (const c of clumps) {
    const idx = Math.max(0, Math.min(LEAF.length - 1, Math.round(c.l * (LEAF.length - 1))));
    g.fillStyle = rgb(LEAF[idx]);
    g.beginPath();
    g.ellipse(c.x, c.y, c.r, c.r * 0.86, 0, 0, Math.PI * 2);
    g.fill();
  }
}

// Every repeating scenery plane, painted once per resize. The order is
// the order they are painted in, not the order they are drawn in.
function buildBackdropTiles() {
  const cloudK = Math.max(0.55, Math.min(1.1, viewW / 1440));
  TILES.cloudsHigh = buildHighCloudTile(cloudK);
  TILES.cloudsLow  = buildLowCloudTile(cloudK);
  TILES.hills      = buildHillsTile(Math.max(60, viewH * 0.14));
  TILES.stand      = buildStandTile(Math.max(80, viewH * 0.17));
  TILES.trees      = buildTreesTile(Math.max(30, viewH * 0.058));
  TILES.railCrowd  = buildRailCrowdTile();
  TILES.boards     = buildBoardsTile();
  TILES.turf       = buildTurfTile();
}

// ── High cloud ──
function buildHighCloudTile(cloudK) {
  const hiH = Math.round(Math.max(90, viewH * 0.22));
  return softenTile(makeTile(1900, hiH, (g, w, h) => {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const W = rnd(220, 420) * cloudK;
      const cx = (i + 0.5) * (w / n) + rnd(-40, 40);
      paintCirrus(g, Math.max(W / 2, Math.min(w - W / 2, cx)), h * rnd(0.25, 0.7), W, h * 0.3);
    }
  }), 2.2);
}

// ── Low cloud ──
function buildLowCloudTile(cloudK) {
  const loH = Math.round(Math.max(120, viewH * 0.28));
  return softenTile(makeTile(1600, loH, (g, w, h) => {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const W = rnd(150, 320) * cloudK;
      const H = W * rnd(0.34, 0.5);
      const slot = w / n;
      const cx = Math.max(W * 0.55, Math.min(w - W * 0.55, (i + 0.5) * slot + rnd(-slot * 0.2, slot * 0.2)));
      paintCumulus(g, cx, h * rnd(0.74, 0.92), W, Math.min(H, h * 0.7));
    }
  }), 1.1);
}

// ── Distant downland: two ridges, the far one lost in haze ──
// Integer frequencies across the tile width, so the ridges wrap.
function buildHillsTile(hillH) {
  return softenTile(makeTile(1400, hillH, (g, w, h) => {
    const ridge = (base, amp, f1, f2, ph, top, bottom) => {
      const gr = g.createLinearGradient(0, h * 0.15, 0, h);
      gr.addColorStop(0, top);
      gr.addColorStop(1, bottom);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const u = (x / w) * Math.PI * 2;
        g.lineTo(x, h * (base + amp * Math.sin(u * f1 + ph) + amp * 0.45 * Math.sin(u * f2 + ph * 1.7)));
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    };
    ridge(0.40, 0.14, 2, 5, 0.6, 'rgba(150,172,192,0.72)', 'rgba(130,152,170,0.78)');
    ridge(0.60, 0.10, 3, 7, 2.1, 'rgba(98,126,120,0.86)', 'rgba(80,106,98,0.9)');
    // Woodland texture on the near ridge
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * w, y = h * rnd(0.62, 1);
      g.fillStyle = 'rgba(40,62,50,' + rnd(0.15, 0.35).toFixed(3) + ')';
      g.fillRect(x, y, rnd(1, 3), rnd(0.8, 1.6));
    }
  }), 1.2);
}

// ── Grandstands ──
function buildStandTile(standH) {
  return softenTile(makeTile(1500, standH, (g, w, h) => {
    paintMainStand(g, w * 0.055, w * 0.60, h);
    paintOldStand(g, w * 0.64, w * 0.895, h);
    paintBigScreen(g, w * 0.925, w * 0.985, h);
    hazeTile(g, w, h, 'rgba(176,196,214,0.13)');
  }), 0.5);
}

// ── Treeline ──
function buildTreesTile(treeH) {
  return softenTile(makeTile(1100, treeH, (g, w, h) => {
    // Hedge along the bottom, with a broken top edge
    g.fillStyle = 'rgb(30,52,36)';
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.7 + Math.sin(x * 0.37) * 1.2 + rnd(-0.8, 0.8));
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    let x = 0;
    while (x < w) {
      const tall = Math.random() < 0.12;
      const hT = h * (tall ? rnd(0.92, 1.0) : rnd(0.5, 0.88));
      const cw = tall ? h * rnd(0.22, 0.3) : h * rnd(0.45, 0.95);
      wrapPaint(w, x, cw, (px) => paintTree(g, px, h, hT, cw, tall));
      x += cw * rnd(0.5, 0.9);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(10,20,12,0.22)' : 'rgba(120,150,96,0.14)';
      g.fillRect(Math.random() * w, h * rnd(0.72, 1), 1, 1);
    }
    hazeTile(g, w, h, 'rgba(160,184,200,0.1)');
  }), 0.35);
}

// ── Rail-side spectators ──
// Two rows standing at the rail, the back row a touch smaller and
// further into shade. Hats, race cards, binoculars and the odd raised
// arm: small things, but a rail crowd of identical figures is what
// reads as clip art.
function buildRailCrowdTile() {
  return softenTile(makeTile(720, 38, (g, w, h) => {
    for (let x = 4; x < w; x += rnd(4.4, 6.2)) paintRailSpectator(g, x, h - 8, 0.8, 0.8);
    for (let x = 2; x < w; x += rnd(5.2, 7.2)) paintRailSpectator(g, x, h - 1, 1.0, 1.0);
    hazeTile(g, w, h, 'rgba(176,196,214,0.06)');
  }), 0.25);
}

function paintRailSpectator(g, x, base, s, light) {
  const tall = rnd(14, 18) * s;
  const sh = base - tall * 0.62;
  const bw = rnd(4.6, 5.6) * s;
  const coat = pick(CLOTHES);
  g.fillStyle = rgb(coat, light);
  g.beginPath();
  g.moveTo(x - bw * 0.46, base);
  g.lineTo(x - bw * 0.5, sh + 1.2 * s);
  g.quadraticCurveTo(x - bw * 0.5, sh, x - bw * 0.2, sh);
  g.lineTo(x + bw * 0.2, sh);
  g.quadraticCurveTo(x + bw * 0.5, sh, x + bw * 0.5, sh + 1.2 * s);
  g.lineTo(x + bw * 0.46, base);
  g.closePath();
  g.fill();
  // Shade on the side away from the sun
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(x - bw * 0.5, sh + 1, bw * 0.3, base - sh - 1);
  // Head
  const hr = 1.75 * s;
  const hy = sh - hr * 1.05;
  g.fillStyle = rgb(pick(SKINS), light);
  g.beginPath();
  g.ellipse(x, hy, hr * 0.9, hr, 0, 0, Math.PI * 2);
  g.fill();
  const r = Math.random();
  if (r < 0.2) {                                   // trilby / flat cap
    g.fillStyle = rgb(pick([[40, 36, 32], [70, 60, 48], [120, 104, 80]]), light);
    g.fillRect(x - hr * 1.25, hy - hr * 0.55, hr * 2.5, hr * 0.35);
    g.fillRect(x - hr * 0.85, hy - hr * 1.15, hr * 1.7, hr * 0.65);
  } else if (r < 0.27) {                           // fascinator
    g.fillStyle = rgb(pick([[196, 40, 60], [212, 175, 55], [60, 90, 170], [240, 240, 236]]), light);
    g.beginPath();
    g.ellipse(x + hr * 0.5, hy - hr * 0.8, hr * 0.8, hr * 0.45, -0.4, 0, Math.PI * 2);
    g.fill();
  } else {                                         // hair
    g.fillStyle = rgb(pick(HAIR), light);
    g.beginPath();
    g.ellipse(x, hy - hr * 0.35, hr * 0.92, hr * 0.7, 0, Math.PI, 0);
    g.fill();
  }
  const p = Math.random();
  if (p < 0.14) {                                  // arm up, cheering
    g.strokeStyle = rgb(coat, light);
    g.lineWidth = 1.2 * s;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x + bw * 0.4, sh + 1);
    g.lineTo(x + bw * 0.75, sh - tall * 0.3);
    g.stroke();
  } else if (p < 0.24) {                           // binoculars
    g.fillStyle = 'rgb(20,20,22)';
    g.fillRect(x - hr * 0.9, hy - hr * 0.2, hr * 1.8, hr * 0.7);
  } else if (p < 0.36) {                           // race card
    g.fillStyle = 'rgba(244,242,236,0.95)';
    g.fillRect(x + bw * 0.1, sh + tall * 0.15, 1.8 * s, 2.4 * s);
  }
}

// Advertising hoardings: background, wordmark and accent colours.
const BOARD_SCHEMES = [
  { bg: [18, 54, 38], fg: [236, 230, 210], ac: [212, 175, 55] },
  { bg: [22, 30, 60], fg: [242, 242, 242], ac: [206, 60, 60] },
  { bg: [236, 232, 222], fg: [30, 34, 44], ac: [40, 96, 64] },
  { bg: [98, 24, 34], fg: [246, 236, 214], ac: [212, 175, 55] },
  { bg: [14, 16, 20], fg: [232, 232, 232], ac: [120, 172, 222] },
];

// ── Advertising hoardings along the far rail ──
function buildBoardsTile() {
  return makeTile(1024, 13, (g, w, h) => {
    let x = 0;
    while (x < w) {
      const pw = Math.min(w - x, rnd(90, 200));
      const s = pick(BOARD_SCHEMES);
      g.fillStyle = rgb(s.bg);
      g.fillRect(x, 0, pw, h);
      // Faux wordmark and an accent mark
      g.fillStyle = rgb(s.fg);
      let tx = x + pw * rnd(0.18, 0.3);
      const words = 1 + (Math.random() * 2 | 0);
      for (let i = 0; i < words; i++) {
        const ww = pw * rnd(0.12, 0.26);
        g.fillRect(tx, h * 0.38, ww, h * 0.26);
        tx += ww + pw * 0.05;
      }
      g.fillStyle = rgb(s.ac);
      g.beginPath();
      g.arc(x + pw * 0.1, h * 0.5, h * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(x, 0, pw, 0.6);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, h - 1, pw, 1);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x, 0, 0.6, h);
      x += pw;
    }
    hazeTile(g, w, h, 'rgba(176,196,214,0.1)');
  });
}

// ── Turf tile for the track plane ──
// Mown stripes plus a grain of divot marks. Tiled in WORLD px, so it
// scrolls at exactly the rate the horses travel.
function buildTurfTile() {
  const turfW = 320;
  const turfH = Math.max(40, Math.round(viewH * 0.60));
  return makeTile(turfW, turfH, (g, w, h) => {
    g.fillStyle = COL.trackTurf;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.055)';
    g.fillRect(0, 0, w / 2, h);
    for (let i = 0; i < 520; i++) {
      g.fillStyle = Math.random() > 0.5
        ? 'rgba(226,244,206,0.045)' : 'rgba(0,0,0,0.055)';
      g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 5), rnd(0.8, 1.6));
    }
  });
}

// Rebuilding the tiles paints tens of thousands of spectators, which is
// fine once but not on every event of a window drag. Debounced: the old
// tiles keep drawing (slightly mis-sized) until the drag settles.
let tileRebuildTimer = null;
function scheduleTileRebuild() {
  if (!TILES.stand) { buildBackdropTiles(); return; }
  clearTimeout(tileRebuildTimer);
  tileRebuildTimer = setTimeout(() => {
    buildBackdropTiles();
    redrawFrame();
    ambientPainted = false;
  }, 180);
}

function planeScale(key) {
  return 1 + (CAM.zoom - 1) * (PLANE_ZOOM[key] != null ? PLANE_ZOOM[key] : 1);
}

// A tile repeated across the screen: its bottom edge at bottomY, scrolled
// by offsetPx and drawn at `scale`. racePlane() and ambientPlane() work out
// the offset and scale for each plane — its parallax rate, its share of
// the camera zoom, and any motion of its own, like the wind in the clouds.
function blitTiled(c, tile, bottomY, offsetPx, alpha, scale) {
  if (!tile) return;
  const w = tile.w * scale, h = tile.h * scale;
  c.save();
  c.globalAlpha = alpha;
  let x = -(((offsetPx % w) + w) % w);
  for (; x < viewW + w; x += w) c.drawImage(tile.canvas, x, bottomY - h, w, h);
  c.restore();
}

// The scenery behind a shot, back to front: sky, sun, high and low
// cloud, the sun's glow over them, downland, stands, trees, haze. The
// race, the ambient backdrop and the Winning Moment each frame it their
// own way: `planes` gives each tile's baseline, scroll offset (px),
// opacity and scale.
function paintScenery(c, sky, planes, haze) {
  paintSky(c, sky.bottom, sky.warm);
  paintSunDisc(c);
  for (const key of ['cloudsHigh', 'cloudsLow']) blitPlane(c, key, planes[key]);
  paintSunGlow(c);
  for (const key of ['hills', 'stand', 'trees']) blitPlane(c, key, planes[key]);
  paintHorizonHaze(c, haze.horizon, haze.height);
}

function blitPlane(c, key, p) {
  blitTiled(c, TILES[key], p.bottom, p.offset, p.alpha, p.scale);
}

// A plane in the race shot: scrolled by the camera at its parallax rate,
// scaled by its share of the zoom.
function racePlane(key, bottom, alpha, extra) {
  const scale = planeScale(key);
  return { bottom, offset: CAM.x * PARALLAX[key] * scale + (extra || 0), alpha, scale };
}

