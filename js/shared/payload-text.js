// Payload text — horse, jockey and trainer names, prices, silk colours
// and image URLs — goes into markup through esc(). It is data, and data
// does not get to write HTML. Ordinary names come out unchanged.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

