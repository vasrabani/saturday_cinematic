// ── Silk badge renderer ────────────────────────────────────────
// Mirrors races/templates/races/components/atoms/_silk.html.
// The same renderer lives in experience.js (the jumps engine); keep the
// two in step.
let silkIdCounter = 0;
function renderSilkSvg(runner) {
  if (runner && runner.silk_url) {
    return '<img class="silk-img" src="' + esc(runner.silk_url) +
           '" alt="Silks" loading="lazy" decoding="async">';
  }
  const body   = esc((runner && runner.silk)  || COL.silkDefault);
  const accent = esc((runner && runner.silk2) || COL.silk2Default);
  const pat    = (runner && runner.silk_pattern) || 'solid';
  const id = 'cinSilkClip-' + (++silkIdCounter);
  const BODY_PATH = 'M2 8 L7 4 L11 6 L17 6 L21 4 L26 8 L26 28 Q26 31 23 31 L5 31 Q2 31 2 28 Z';
  const SLEEVES_PATH = 'M2 8 L0 14 L0 20 L4 20 L4 12 Z M26 8 L28 14 L28 20 L24 20 L24 12 Z';
  let patternMarkup = '';
  if (pat === 'halved') {
    patternMarkup = '<rect x="14" y="0" width="14" height="32" fill="' + accent + '"/>';
  } else if (pat === 'hooped') {
    patternMarkup =
      '<rect x="0" y="11" width="28" height="3" fill="' + accent + '"/>' +
      '<rect x="0" y="17" width="28" height="3" fill="' + accent + '"/>' +
      '<rect x="0" y="23" width="28" height="3" fill="' + accent + '"/>';
  } else if (pat === 'striped') {
    patternMarkup =
      '<rect x="13" y="0" width="2" height="32" fill="' + accent + '"/>' +
      '<rect x="7"  y="0" width="2" height="32" fill="' + accent + '" opacity="0.85"/>' +
      '<rect x="19" y="0" width="2" height="32" fill="' + accent + '" opacity="0.85"/>';
  } else if (pat === 'quartered') {
    patternMarkup =
      '<rect x="14" y="0"  width="14" height="11" fill="' + accent + '"/>' +
      '<rect x="0"  y="17" width="14" height="15" fill="' + accent + '"/>';
  } else if (pat === 'starred') {
    patternMarkup =
      '<text x="14" y="22" text-anchor="middle" fill="' + accent +
      '" font-size="13" font-family="Georgia, serif" style="font-weight:900;">★</text>';
  }
  return (
    '<svg class="silk-svg" viewBox="0 0 28 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path fill="' + body + '" d="' + BODY_PATH + '"/>' +
      '<defs><clipPath id="' + id + '"><path d="' + BODY_PATH + '"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + ')">' + patternMarkup + '</g>' +
      '<path fill="' + accent + '" d="' + SLEEVES_PATH + '"/>' +
    '</svg>'
  );
}

// Mini jockey-cap SVG, as in experience.js. Renders a two-tone cap using the runner's
// silk colours + silk_pattern so each row's cap matches its jersey.
let lbCapCounter = 0;
function renderCapSvg(runner) {
  const body   = esc((runner && runner.silk)  || '#1A3A6B');
  const accent = esc((runner && runner.silk2) || '#FFFFFF');
  const pat    = (runner && runner.silk_pattern) || 'solid';
  const id = 'lbCap-' + (++lbCapCounter);
  let patternMarkup = '';
  if (pat === 'halved') {
    patternMarkup = '<rect x="8" y="0" width="8" height="16" fill="' + accent + '"/>';
  } else if (pat === 'hooped') {
    patternMarkup =
      '<rect x="0" y="5"  width="16" height="2" fill="' + accent + '"/>' +
      '<rect x="0" y="9"  width="16" height="2" fill="' + accent + '"/>';
  } else if (pat === 'striped') {
    patternMarkup =
      '<rect x="7" y="0" width="2" height="16" fill="' + accent + '"/>';
  } else if (pat === 'quartered') {
    patternMarkup =
      '<rect x="8" y="0" width="8" height="8" fill="' + accent + '"/>' +
      '<rect x="0" y="8" width="8" height="8" fill="' + accent + '"/>';
  } else if (pat === 'starred') {
    patternMarkup =
      '<text x="8" y="12" text-anchor="middle" font-size="11" font-weight="900" font-family="Georgia, serif" fill="' + accent + '">★</text>';
  }
  return (
    '<svg class="race-lb-cap" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><clipPath id="' + id + '"><circle cx="8" cy="8" r="7.5"/></clipPath></defs>' +
      '<circle cx="8" cy="8" r="7.5" fill="' + body + '"/>' +
      '<g clip-path="url(#' + id + ')">' + patternMarkup + '</g>' +
      '<circle cx="8" cy="8" r="7.5" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="0.6"/>' +
    '</svg>'
  );
}

