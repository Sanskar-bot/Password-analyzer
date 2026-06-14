/**
 * patterns.js
 * Detects predictable patterns: sequential runs, keyboard walks,
 * repeated chars, date-like strings, and leet-speak normalization.
 */

const KEYBOARD_SEQUENCES = [
  "qwertyuiop", "poiuytrewq",
  "asdfghjkl",  "lkjhgfdsa",
  "zxcvbnm",    "mnbvcxz",
  "1234567890", "0987654321",
  "qweasdzxc",  "cxzdsaewq",
  "!@#$%^&*()", ")(*&^%$#@!",
];

const LEET_MAP = {
  "0":"o","1":"i","3":"e","4":"a","5":"s","6":"g",
  "7":"t","8":"b","@":"a","$":"s","!":"i","+":"t",
};

export function normalizeLeet(password) {
  return password.toLowerCase().split("").map(ch => LEET_MAP[ch] ?? ch).join("");
}

function detectSequentialRuns(str, minLen = 3) {
  const matches = [];
  let run = str[0] ?? "";
  for (let i = 1; i < str.length; i++) {
    const diff = str.charCodeAt(i) - str.charCodeAt(i - 1);
    if (diff === 1 || diff === -1) { run += str[i]; }
    else { if (run.length >= minLen) matches.push(run); run = str[i]; }
  }
  if (run.length >= minLen) matches.push(run);
  return { found: matches.length > 0, matches };
}

function detectKeyboardWalks(lower, minLen = 4) {
  const found_set = new Set();
  for (const seq of KEYBOARD_SEQUENCES) {
    for (let s = 0; s <= seq.length - minLen; s++) {
      const sub = seq.slice(s, s + minLen);
      if (lower.includes(sub)) found_set.add(sub);
    }
  }
  const matches = [...found_set];
  return { found: matches.length > 0, matches };
}

function detectRepeats(lower, minLen = 3) {
  const matches = [];
  const re = new RegExp(`(.)\\1{${minLen - 1},}`, "g");
  let m;
  while ((m = re.exec(lower)) !== null) matches.push(m[0]);
  return { found: matches.length > 0, matches };
}

function detectDatePatterns(password) {
  const patterns = [/19\d{2}/, /20[0-2]\d/];
  const matches = [];
  for (const re of patterns) { const m = password.match(re); if (m) matches.push(m[0]); }
  return { found: matches.length > 0, matches };
}

export function detectPatterns(password) {
  const lower = password.toLowerCase();
  const normalized = normalizeLeet(lower);
  const sequential = detectSequentialRuns(lower);
  const keyboard   = detectKeyboardWalks(lower);
  const repeats    = detectRepeats(lower);
  const dates      = detectDatePatterns(password);
  const leet       = { found: normalized !== lower, normalized };

  let totalPenalty = 0;
  if (sequential.found) totalPenalty += sequential.matches.length * 2;
  if (keyboard.found)   totalPenalty += keyboard.matches.length   * 3;
  if (repeats.found)    totalPenalty += repeats.matches.length    * 2;
  if (dates.found)      totalPenalty += 2;

  const patternScore = Math.max(0, 10 - totalPenalty);
  return { sequential, keyboard, repeats, dates, leet, totalPenalty, patternScore };
}
