/**
 * strip_emojis.js
 * Removes emoji characters from JS/HTML/CSS files in this project.
 */
const fs = require('fs');
const path = require('path');

const EMOJI_RE =
  /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|\u{231A}|\u{231B}|\u{23E9}|\u{23F3}|\u{25FE}|\u{2614}|\u{2615}|\u{2648}|\u{26A0}/gu;

const REPLACEMENTS = [
  [/CRITICAL\s*/g, 'CRITICAL '],
  [/HIGH\s*/g, 'HIGH '],
  [/MED\s*/g, 'MED '],
  [/SAFE\s*/g, 'SAFE '],
];

const EXTS = new Set(['.js', '.html', '.css']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'cupp-master']);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
      continue;
    }

    if (!EXTS.has(path.extname(entry.name).toLowerCase())) continue;

    const src = fs.readFileSync(full, 'utf8');
    let out = src;

    for (const [pattern, replacement] of REPLACEMENTS) {
      out = out.replace(pattern, replacement);
    }
    out = out.replace(EMOJI_RE, '');

    if (out !== src) {
      fs.writeFileSync(full, out, 'utf8');
      console.log('Cleaned:', full.replace(process.cwd() + path.sep, ''));
    }
  }
}

walk(path.join(__dirname));
console.log('Done.');
