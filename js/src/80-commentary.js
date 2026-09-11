// ─── Commentary ─────────────────────────────────────────────────
function fireCommentary(progress) {
  BAND.commentary.forEach((c) => {
    if (!firedCommentary.has(c.at) && progress >= c.at) {
      firedCommentary.add(c.at);
      setCommentaryText(renderCommentary(c.text));
    }
  });
}

// Substitute {LEADER} / {USER} / {FOX} placeholders with current race
// state. Mirror of the same helper in experience.js.
function renderCommentary(template) {
  if (!template || template.indexOf('{') === -1) return template;
  const liveLeader = rankedHorses()[0] || null;
  const leaderName = liveLeader ? liveLeader.runner.name : '';
  const userName   = (STATE.userPick && STATE.userPick.name) || '';
  const foxName    = (STATE.foxPick  && STATE.foxPick.name)  || '';
  // A pick that is not there takes its comma and space with it; one
  // that is keeps whatever the template put in front of it.
  return template
    .replace(/,?\s*\{USER\}/g, (m) => (userName ? m.replace('{USER}', () => userName) : ''))
    .replace(/,?\s*\{FOX\}/g,  (m) => (foxName  ? m.replace('{FOX}', () => foxName) : ''))
    .replace(/\{LEADER\}/g,    leaderName || 'the leader')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*\./g, '.');
}

// Phase-strip update — mirror of experience.js, scoped to flat-race
// containers. Lazy-builds the dot strip once + flips state classes
// each frame as progress crosses phase thresholds.
// The strip's elements, cached when it is built so a frame does not
// query the DOM for them; and the last values written, so a frame only
// writes what has changed.
let phaseStripEls = null;

function updatePhaseStrip(progress, phaseTable, activePhase) {
  if (!phaseStripEls || !phaseStripEls.strip.isConnected) phaseStripEls = buildPhaseStrip(phaseTable);
  const { dots, rails } = phaseStripEls;

  const activeIdx = phaseTable.indexOf(activePhase);
  if (activeIdx !== phaseStripEls.activeIdx) {
    phaseStripEls.activeIdx = activeIdx;
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-past',    i <  activeIdx);
      dot.classList.toggle('is-current', i === activeIdx);
      dot.classList.toggle('is-future',  i >  activeIdx);
    });
  }
  rails.forEach((rail, i) => {
    const from = phaseTable[i].from;
    const to   = phaseTable[i + 1].from;
    const span = Math.max(0.001, to - from);
    const fill = (Math.max(0, Math.min(1, (progress - from) / span)) * 100).toFixed(1) + '%';
    if (fill !== phaseStripEls.fills[i]) {
      phaseStripEls.fills[i] = fill;
      rail.style.setProperty('--fill', fill);
    }
  });
}

function buildPhaseStrip(phaseTable) {
  let strip = document.getElementById('phaseStrip');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'phaseStrip';
    strip.className = 'race-phase-strip';
    strip.innerHTML = phaseTable.map((p, i) =>
      '<span class="race-phase-strip__dot" data-phase="' + i + '" ' +
            'title="' + esc(p.label) + '"></span>' +
      (i < phaseTable.length - 1
        ? '<span class="race-phase-strip__rail" data-rail="' + i + '"></span>'
        : '')
    ).join('');
    const raceScreen = document.getElementById('screen-race');
    if (raceScreen) raceScreen.appendChild(strip);
  }
  return {
    strip,
    dots:  phaseTable.map((p, i) => strip.querySelector('[data-phase="' + i + '"]')),
    rails: phaseTable.slice(1).map((p, i) => strip.querySelector('[data-rail="' + i + '"]')),
    activeIdx: null,
    fills: [],
  };
}

function setCommentaryText(text) {
  commentaryTimer = BAND.timings.commentaryHoldMs;
  announce(text);
  const el = document.getElementById('racingCommentary');
  if (!el) return;
  gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' });
  el.textContent = text;
}

// Counts the current line's hold down and fades it once when it runs out.
function updateCommentary(dt) {
  if (commentaryTimer <= 0) return;
  commentaryTimer = Math.max(0, commentaryTimer - dt);
  if (commentaryTimer > 0) return;
  const el = document.getElementById('racingCommentary');
  if (el) gsap.to(el, { opacity: 0, duration: 0.4 });
}

function showSubtitle(text, duration) {
  const el = document.querySelector('.subtitle__text');
  if (!el) return;
  el.textContent = text;
  gsap.killTweensOf(el);
  gsap.fromTo(el,
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out',
      onComplete: () => gsap.to(el, { opacity: 0, duration: 0.5, delay: duration / 1000 - 0.9 }),
    });
}

