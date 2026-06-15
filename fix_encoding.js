/**
 * fix_encoding.js
 * Replaces mojibake sequences and raw Unicode special chars
 * with HTML entities (in HTML files) or ASCII equivalents (in JS files).
 * Run once: node fix_encoding.js
 */
const fs   = require('fs');
const path = require('path');

const APP  = path.join(__dirname, 'app');

// ---------------------------------------------------------------------------
// Known mojibake -> correct HTML entity (for HTML files)
// ---------------------------------------------------------------------------
const HTML_FIXES = [
  // em dash variants
  ['\u00c2\u20ac\u201d', '&mdash;'],   // Â€" triple (3-byte double-encode)
  ['\u00e2\u20ac\u201d', '&mdash;'],   // â€" triple (common 1st-pass mojibake)
  ['\u2014',             '&mdash;'],   // — actual em dash (safe passthrough)

  // en dash variants
  ['\u00e2\u20ac\u201c', '&ndash;'],   // â€" for en dash
  ['\u2013',             '&ndash;'],   // – actual en dash

  // right single quote / apostrophe
  ['\u00e2\u20ac\u2122', '&rsquo;'],   // â€™ (â€™)
  ['\u2019',             '&rsquo;'],   // '

  // left single quote
  ['\u00e2\u20ac\u02dc', '&lsquo;'],   // â€˜
  ['\u2018',             '&lsquo;'],   // '

  // left double quote
  ['\u00e2\u20ac\u0153', '&ldquo;'],   // â€œ
  ['\u201c',             '&ldquo;'],   // "

  // right double quote
  ['\u00e2\u20ac\u009d', '&rdquo;'],   // â€
  ['\u201d',             '&rdquo;'],   // "

  // right arrow
  ['\u00e2\u2020\u2019', '&rarr;'],    // â†' mojibake for →
  ['\u2192',             '&rarr;'],    // →

  // per-mille sign used as separator (mojibake renders as â€°)
  ['\u00e2\u20ac\u00b0', '&rarr;'],    // â€° → treat as arrow
  ['\u2030',             '&rarr;'],    // ‰ per mille → arrow

  // bullet
  ['\u00e2\u20ac\u00a2', '&bull;'],    // â€¢ mojibake
  ['\u2022',             '&bull;'],    // •

  // single right-angle quote used as separator (›)
  ['\u00e2\u20ac\u00ba', '&rsaquo;'],  // â€º mojibake
  ['\u203a',             '&rsaquo;'],  // ›

  // ellipsis
  ['\u00e2\u20ac\u00a6', '&hellip;'],  // â€¦ mojibake
  ['\u2026',             '&hellip;'],  // …

  // middle dot / interpunct
  ['\u00c2\u00b7',       '&middot;'],  // Â· mojibake
  ['\u00b7',             '&middot;'],  // ·

  // non-breaking space artefacts
  ['\u00c2\u00a0',       '&nbsp;'],    // Â (NBSP mojibake)
];

// ---------------------------------------------------------------------------
// For JS files: use ASCII/escape equivalents instead of HTML entities
// ---------------------------------------------------------------------------
const JS_FIXES = [
  ['\u00e2\u20ac\u201d', '\u2014'],  // restore em dash in JS
  ['\u00e2\u20ac\u201c', '\u2013'],  // restore en dash in JS
  ['\u00e2\u20ac\u2122', '\u2019'],  // restore right single quote
  ['\u2014', '\u2014'],
  ['\u2013', '\u2013'],
  ['\u2019', '\''],
  ['\u2018', '\''],
  ['\u201c', '"'],
  ['\u201d', '"'],
  ['\u2192', '->'],
  ['\u2030', '->'],
  ['\u2022', '-'],
  ['\u203a', '>'],
  ['\u2026', '...'],
];

function applyFixes(content, fixes) {
  for (const [from, to] of fixes) {
    // Replace all occurrences
    while (content.includes(from)) {
      content = content.split(from).join(to);
    }
  }
  return content;
}

// Process all .html and .js files in /app
const files = fs.readdirSync(APP);
let changed = 0;

for (const name of files) {
  const ext = path.extname(name).toLowerCase();
  if (ext !== '.html' && ext !== '.js') continue;

  const file    = path.join(APP, name);
  const before  = fs.readFileSync(file, 'utf8');
  const fixes   = ext === '.html' ? HTML_FIXES : JS_FIXES;
  const after   = applyFixes(before, fixes);

  if (before !== after) {
    fs.writeFileSync(file, after, 'utf8');
    console.log('Fixed:', name);
    changed++;
  } else {
    console.log('Clean:', name);
  }
}

console.log('\nDone. Changed', changed, 'files.');
