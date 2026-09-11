// ── Result card ─────────────────────────────────────────────────
// A DOM lower-third rather than canvas text: it stays sharp at every
// pixel ratio, reflows on a phone without a font-size table, and the
// entry animation is a GSAP timeline like everything else. Created
// from JS so index.html and the Django template are untouched.
let resultEl = null;

function resultCardEl() {
  if (resultEl && resultEl.isConnected) return resultEl;
  const screen = document.getElementById('screen-race');
  if (!screen) return null;
  const el = document.createElement('div');
  el.className = 'race-result';
  el.id = 'raceResult';
  screen.appendChild(el);
  resultEl = el;
  return el;
}

function showResultCard(margin) {
  const el = resultCardEl();
  if (!el) return;

  const lengths = margin && margin.lengths;
  const names   = (margin && margin.winners) || [];
  const isDH    = lengths === -1;
  const isPhoto = !isDH && lengths != null && lengths <= 0.20;

  const eyebrow = isDH    ? 'DEAD HEAT'
                : isPhoto ? 'PHOTO FINISH'
                :           'WINNER';
  const headline = isDH ? names.slice(0, 2).join('  &  ')
                        : (names[0] || '');
  const sub = isDH ? 'Nothing between them'
            : (lengths != null ? 'Won by ' + formatBeatenDistance(lengths).toLowerCase()
                               : 'Won on the line');

  el.innerHTML =
    '<span class="race-result__eyebrow">' + eyebrow + '</span>' +
    '<span class="race-result__name">' + esc(headline) + '</span>' +
    '<span class="race-result__margin">' + sub + '</span>';
  el.classList.toggle('race-result--photo', isPhoto || isDH);

  gsap.timeline()
    .set(el, { display: 'flex' })
    .fromTo(el, { opacity: 0, y: 18 },
                { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' })
    .fromTo(el.querySelectorAll('span'),
            { opacity: 0, y: 10 },
            { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'power2.out' }, 0.06);
}

function hideResultCard() {
  if (!resultEl) return;
  gsap.to(resultEl, {
    opacity: 0, y: -10, duration: 0.4, ease: 'power2.in',
    onComplete: () => { if (resultEl) resultEl.style.display = 'none'; },
  });
}

// ════════════════════════════════════════════════════════════════
//  THE WINNING MOMENT
// ════════════════════════════════════════════════════════════════
// A dedicated hero shot between the finish and the roll call. The
// choreography is taken from the V16.1 delivery (saturday_cinematic_v2,
// runWinningMoment): the camera cuts close on the winner, who is still
// galloping, and pushes in; after 1.25s the jockey comes up out of the
// crouch into a one-arm salute while keeping the reins; a gold-edged
// "WINNING MOMENT" card resolves at the top; confetti bursts from both
// sides; the frame vignettes and the letterbox closes it like a
// broadcast sting. 5.2 seconds.
//
// What is ours rather than theirs is everything in the frame. Their
// version cut to a painted sky-and-grass backdrop and a sprite horse.
// Here it is our racecourse — the same sky, clouds, stands, rail crowd,
// hoardings and turf, magnified and scrolling past as a low tracking
// shot — and our horse and jockey, drawn by drawHorseSilhouette() at
// hero scale, with the salute added to the jockey rig.
//
// It is still one GSAP timeline (winTL) writing into one state object
// (HERO), and renderFrame() hands over to renderHeroFrame() while it
// runs. Skipped entirely under prefers-reduced-motion, as theirs is.
const WINNING_MOMENT_S = 5.2;
const HERO_STRIDE_HZ   = 2.2;     // strides a second at full speed
let winTL = null;

const HERO = {
  active: false,
  poster: 0,       // 0 = the full-frame Winning Moment, 1 = behind the reveal poster
  horse:  null,
  push:   0,       // 0 → 1, the camera pushing in
  speed:  1,       // the winner's gallop, easing but never stopping
  scroll: 0,       // px of turf travelled since the cut
  crowd:  null,    // a softer copy of the rail crowd, for the long lens
  confetti: [],
};

// Where the rail sits in the hero frame, and how big the winner is.
function heroLayout() {
  const narrow = isNarrowViewport();
  const railY = viewH * (narrow ? 0.60 : 0.655);
  // Horse length on screen at the end of the push. The push itself is
  // theirs: 1.55× → 2.25×, i.e. the horse grows by 1.45 across it.
  // On a phone the whole drawing — tail tip (x = -40) to muzzle (x = +55),
  // a quarter longer than the horse itself — has to fit the width.
  const endLen = Math.min(viewW * (narrow ? 0.66 : 0.36), viewH * 0.62);
  const len = endLen / 1.45 * (1 + 0.45 * HERO.push);
  const scale = len / HORSE_ART_LENGTH;
  // In poster mode the story column owns the right of the frame, so the
  // winner moves left and sits higher, clear of the podium bar.
  const poster = HERO.poster ? 1 : 0;
  return {
    railY: railY,
    scale: scale * (poster && !narrow ? 0.92 : 1),
    x: viewW * (poster ? (narrow ? 0.5 : 0.30) : 0.5) - 7.5 * scale,
    groundY: viewH * (narrow ? 0.82 : 0.9) - (poster ? viewH * 0.06 : 0),
  };
}

function drawHeroBackdrop() {
  pCtx.clearRect(0, 0, viewW, viewH);
  const L = heroLayout();
  const horizon = L.railY - viewH * 0.085;
  const S = 1.65;                               // long-lens magnification
  const standH = TILES.stand ? TILES.stand.h * S : viewH * 0.28;
  const standTop = horizon + 2 - standH;
  const sc = HERO.scroll;

  SUN.x = viewW * (isNarrowViewport() ? 0.74 : 0.8);
  SUN.y = Math.max(viewH * 0.06, standTop - viewH * 0.1);
  SUN.visible = 1;

  paintScenery(pCtx, { bottom: horizon + viewH * 0.08, warm: 0.9 }, {
    cloudsHigh: { bottom: standTop + viewH * 0.05, offset: sc * 0.012 + frameClock * WIND.cloudsHigh, alpha: 0.9, scale: 1.25 },
    cloudsLow:  { bottom: standTop + viewH * 0.10, offset: sc * 0.03  + frameClock * WIND.cloudsLow,  alpha: 1,   scale: 1.35 },
    hills:      { bottom: horizon + 6,             offset: sc * 0.05, alpha: 0.9, scale: 1.4 },
    stand:      { bottom: horizon + 2,             offset: sc * 0.16, alpha: 1,   scale: S },
    trees:      { bottom: horizon + viewH * 0.035, offset: sc * 0.3,  alpha: 1,   scale: 1.9 },
  }, { horizon, height: standH * 0.6 });
}

function drawHeroTrack() {
  const L = heroLayout();
  const sc = HERO.scroll;
  const bs = Math.max(1.6, viewH / 330);         // hoarding / crowd scale

  // Rail crowd, soft — they are well behind the point of focus.
  const crowd = HERO.crowd || TILES.railCrowd;
  if (crowd) blitTiled(ctx, crowd, L.railY - 13 * bs + 5 * bs, sc * 0.6, 0.95, bs * 1.1);
  if (TILES.boards) blitTiled(ctx, TILES.boards, L.railY, sc * 0.62, 0.95, bs);

  // Running rail
  ctx.fillStyle = 'rgba(248,248,244,0.9)';
  ctx.fillRect(0, L.railY - 3 * bs * 0.4, viewW, 2.2 * bs * 0.5);

  // Turf, scrolling at the gallop, with its own depth light
  if (TILES.turf) {
    const tw = TILES.turf.w;
    let x = -(((sc % tw) + tw) % tw);
    for (; x < viewW; x += tw) ctx.drawImage(TILES.turf.canvas, x, L.railY, tw, viewH - L.railY);
  }
  const shade = ctx.createLinearGradient(0, L.railY, 0, viewH);
  shade.addColorStop(0, 'rgba(160,190,196,0.14)');
  shade.addColorStop(1, 'rgba(4,10,6,0.42)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, L.railY, viewW, viewH - L.railY);

  // Lateral streaks: the turf blurring past the lens. Theirs, adapted.
  if (!prefersReducedMotion) {
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#f5efde';
    ctx.lineWidth = 2;
    const drift = (sc * 0.42) % 150;
    for (let i = -1; i < 9; i++) {
      const yy = L.railY + (viewH - L.railY) * 0.18 + i * 22;
      ctx.beginPath();
      ctx.moveTo(-150 + drift, yy);
      ctx.lineTo(viewW, yy - 8);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function burstHeroConfetti(x, y, n, colour) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 6;
    HERO.confetti.push({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4,
      g: 0.18 + Math.random() * 0.1, life: 1,
      w: 4 + Math.random() * 4, rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4, colour: colour,
    });
  }
}

function drawHeroConfetti(dt) {
  const step = dt > 0 ? Math.max(0.5, Math.min(2.5, dt / FRAME_MS)) : 0;
  HERO.confetti = HERO.confetti.filter((p) => {
    p.vy += p.g * step;
    p.x += p.vx * step;
    p.y += p.vy * step;
    p.rot += p.spin * step;
    p.life -= 0.012 * step;
    if (p.life <= 0 || p.y > viewH + 30) return false;
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.colour;
    ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
    ctx.restore();
    return true;
  });
}

// The reveal holds the winner behind the poster rather than cutting to a
// trophy, so the hero scene outlives the Winning Moment. raceFinish()
// stops the race ticker, so this is a loop of its own — it draws the one
// horse and nothing else, and the poster is DOM over the top of it.
let posterTicking = false;

// The poster's own surface. #raceCanvas is inside the race screen, which
// is no longer showing, and #particleCanvas is the ambient painter's —
// sharing either meant fighting over it. This one is the poster's alone,
// at body level between the ambient backdrop and the screens.
//
// Created from JS rather than declared in the markup, the same way the
// broadcast lower-third is, so nothing has to move into the Django
// template (ARCHITECTURE.md § 10).
let posterCanvas = null;
let posterCtx = null;

function ensurePosterCanvas() {
  if (posterCanvas && posterCanvas.isConnected) return posterCtx;
  const el = document.createElement('canvas');
  el.id = 'posterCanvas';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  posterCanvas = el;
  posterCtx = el.getContext('2d');
  sizePosterCanvas();
  return posterCtx;
}

function sizePosterCanvas() {
  if (!posterCanvas) return;
  posterCanvas.width  = canvas.width;
  posterCanvas.height = canvas.height;
  posterCanvas.style.width  = viewW + 'px';
  posterCanvas.style.height = viewH + 'px';
}

function posterTick() {
  renderHeroFrame(Math.min(gsap.ticker.deltaRatio() * (1000 / 60), 50));
  const g = ensurePosterCanvas();
  if (!g) return;
  if (posterCanvas.width !== canvas.width) sizePosterCanvas();
  // Both source canvases are the same backing-store size, so this is a
  // straight 1:1 blit: the long-lens backdrop first, the horse over it.
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, posterCanvas.width, posterCanvas.height);
  g.drawImage(pCanvas, 0, 0);
  g.drawImage(canvas, 0, 0);
}

function startPosterHero() {
  if (posterTicking || !HERO.horse || prefersReducedMotion) return;
  // Settled: the push is over, and he is coming back to a canter rather
  // than still being driven.
  HERO.poster = 1;
  HERO.push   = 1;
  HERO.active = true;
  gsap.to(HERO, { speed: 0.28, duration: 1.6, ease: 'sine.out' });
  gsap.ticker.add(posterTick);
  posterTicking = true;
}

function stopPosterHero() {
  if (posterTicking) { gsap.ticker.remove(posterTick); posterTicking = false; }
  if (posterCanvas) { posterCanvas.remove(); posterCanvas = null; posterCtx = null; }
  HERO.poster = 0;
  HERO.active = false;
}

function renderHeroFrame(dt) {
  const h = HERO.horse;
  if (!h) return;
  const L = heroLayout();

  // The winner keeps galloping; the gait eases as the speed does, and the
  // turf passes under him exactly one stride per cycle, so his hooves stay
  // planted on it (see placeHorse).
  const cycles = dt / 1000 * HERO_STRIDE_HZ * (0.55 + 0.45 * HERO.speed);
  const passed = cycles * STRIDE_LOCAL * L.scale;
  HERO.scroll += passed;
  h.legPhase  += cycles * Math.PI * 2;
  h.bobPhase  += cycles * Math.PI * 2 * 0.62;
  h.swayPhase += dt * 0.0032;
  h.speed = 0.3;                                 // keeps the hoof dust coming

  drawHeroBackdrop();
  ctx.clearRect(0, 0, viewW, viewH);
  drawHeroTrack();

  // Divots are thrown back and left behind as the ground goes past.
  for (const p of particles) p.x -= passed * 0.85;
  drawHoofDust(dt);

  // Local y = +28 is the ground line of the horse artwork.
  spawnHoofDust(L.x, L.groundY - 28 * L.scale, h, strideCycle(h), L.scale);
  drawHorseSilhouette(L.x, L.groundY - 28 * L.scale, h, L.scale);

  // Dark edges, then the celebration.
  const vg = ctx.createRadialGradient(
    viewW * 0.5, viewH * 0.52, viewW * 0.18,
    viewW * 0.5, viewH * 0.52, viewW * 0.72
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.48)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, viewW, viewH);

  drawHeroConfetti(dt);
  drawGrain();
  drawLetterbox();
}

// ── The card ─────────────────────────────────────────────────────
let winEl = null;

function winMomentEl() {
  if (winEl && winEl.isConnected) return winEl;
  const screen = document.getElementById('screen-race');
  if (!screen) return null;
  const el = document.createElement('div');
  el.className = 'win-moment';
  el.id = 'winMoment';
  screen.appendChild(el);
  winEl = el;
  return el;
}

function showWinnerMomentCard(winner, margin) {
  const el = winMomentEl();
  if (!el) return;
  const odds = winner.odds || '';
  let marginText = '';
  if (margin && margin.lengths === -1) marginText = 'DEAD HEAT';
  else if (margin && margin.lengths != null && margin.lengths >= 0) marginText = formatBeatenDistance(margin.lengths);
  const meta = ['WINNER', odds ? String(odds) : '', marginText].filter(Boolean).join('   ·   ');
  el.innerHTML =
    '<span class="win-moment__eyebrow">SATURDAY RACING  ·  WINNING MOMENT</span>' +
    '<span class="win-moment__name">' + esc(winner.name || 'WINNER') + '</span>' +
    '<span class="win-moment__meta">' + esc(meta) + '</span>';
  el.style.display = 'flex';
  // Theirs resolves over 18% of the moment with a cubic ease-out.
  gsap.fromTo(el, { opacity: 0, y: -8 },
              { opacity: 1, y: 0, duration: WINNING_MOMENT_S * 0.18, ease: 'power3.out' });
}

function hideWinnerMomentCard() {
  if (!winEl) return;
  gsap.killTweensOf(winEl);
  winEl.style.display = 'none';
  gsap.set(winEl, { opacity: 0 });
}

function runWinningMoment(margin) {
  const winner = STATE.simResult.winner;
  const h = horses.find((x) => x.runner.id === winner.id);
  if (!h || prefersReducedMotion) { raceFinish(margin); return; }

  hideResultCard();
  particles = [];
  pressFlashes = [];
  HERO.active = true;
  HERO.horse  = h;
  HERO.push   = 0;
  HERO.speed  = 1;
  HERO.scroll = 0;
  HERO.confetti = [];
  HERO.crowd  = HERO.crowd || softenTile(TILES.railCrowd, 1.4);
  h.salute = 0;

  const screen = document.getElementById('screen-race');
  if (screen) screen.classList.add('is-winning-moment');
  setCommentaryText(`${winner.name} has done it — a winning moment to remember.`);
  gsap.killTweensOf(DIRECTOR);
  Object.assign(DIRECTOR, { flash: 0, vignette: 0, letterbox: 0.021 });

  // The last hero frame stays on the canvas while the roll call fades in;
  // the card and the chrome class are cleared by the next race or replay.
  winTL = gsap.timeline({ onComplete: () => { HERO.active = false; raceFinish(margin); } });
  // Camera push, eased out, over the first 48% of the moment.
  winTL.to(HERO, { push: 1, duration: WINNING_MOMENT_S * 0.48, ease: 'power3.out' }, 0);
  // Still galloping at the end, just not flat out.
  winTL.to(HERO, { speed: 0.6, duration: WINNING_MOMENT_S, ease: 'sine.inOut' }, 0);
  // 1.25s in, up out of the crouch into the salute.
  winTL.to(h, { salute: 1, duration: 0.45, ease: 'power2.out' }, 1.25);
  winTL.call(() => showWinnerMomentCard(winner, margin), null, WINNING_MOMENT_S * 0.28);
  for (let i = 0; i < 4; i++) {
    winTL.call(() => {
      burstHeroConfetti(viewW * 0.70, viewH * 0.34, 18, COL.gold);
      burstHeroConfetti(viewW * 0.30, viewH * 0.38, 12, '#ffffff');
    }, null, 1.55 + i * 0.21);
  }
  // The letterbox closes the scene over its last 30%.
  winTL.to(DIRECTOR, { letterbox: 0.038, duration: WINNING_MOMENT_S * 0.3, ease: 'power2.in' },
           WINNING_MOMENT_S * 0.7);
}

function resetWinningMoment() {
  if (winTL) { winTL.kill(); winTL = null; }
  HERO.active = false;
  HERO.horse = null;
  HERO.confetti = [];
  gsap.killTweensOf(HERO);
  hideWinnerMomentCard();
  const screen = document.getElementById('screen-race');
  if (screen) screen.classList.remove('is-winning-moment');
}

