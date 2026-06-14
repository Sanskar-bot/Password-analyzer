/**
 * strength.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates password strength based on:
 *   • Character variety (uppercase, lowercase, digits, symbols)
 *   • Effective character set size  → used for entropy & brute-force calc
 *   • Shannon entropy  H = L × log₂(C)
 *   • Length tiers
 *
 * Returns a `StrengthResult` object consumed by scorer.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Character class definitions */
const CHAR_CLASSES = {
  lowercase:  { regex: /[a-z]/, size: 26,  label: "Lowercase letters" },
  uppercase:  { regex: /[A-Z]/, size: 26,  label: "Uppercase letters" },
  digits:     { regex: /[0-9]/, size: 10,  label: "Numbers"           },
  symbols:    { regex: /[^a-zA-Z0-9]/, size: 32, label: "Symbols"    },
};

/**
 * Analyse a password's character composition and entropy.
 *
 * @param {string} password
 * @returns {{
 *   length: number,
 *   charsetSize: number,
 *   entropy: number,
 *   hasLower: boolean,
 *   hasUpper: boolean,
 *   hasDigit: boolean,
 *   hasSymbol: boolean,
 *   varietyCount: number,
 *   lengthScore: number,
 *   varietyScore: number,
 *   entropyScore: number,
 *   flags: string[]
 * }}
 */
export function analyseStrength(password) {
  const len = password.length;

  // ── 1. Detect which character classes are present ─────────────────────────
  const hasLower  = CHAR_CLASSES.lowercase.regex.test(password);
  const hasUpper  = CHAR_CLASSES.uppercase.regex.test(password);
  const hasDigit  = CHAR_CLASSES.digits.regex.test(password);
  const hasSymbol = CHAR_CLASSES.symbols.regex.test(password);

  // ── 2. Calculate effective charset size ──────────────────────────────────
  let charsetSize = 0;
  if (hasLower)  charsetSize += CHAR_CLASSES.lowercase.size;
  if (hasUpper)  charsetSize += CHAR_CLASSES.uppercase.size;
  if (hasDigit)  charsetSize += CHAR_CLASSES.digits.size;
  if (hasSymbol) charsetSize += CHAR_CLASSES.symbols.size;
  if (charsetSize === 0) charsetSize = 1; // guard against empty string

  // ── 3. Shannon entropy: H = L × log₂(C) ─────────────────────────────────
  const entropy = len > 0 ? len * Math.log2(charsetSize) : 0;

  // ── 4. Variety count (0–4) ────────────────────────────────────────────────
  const varietyCount = [hasLower, hasUpper, hasDigit, hasSymbol]
    .filter(Boolean).length;

  // ── 5. Score components ───────────────────────────────────────────────────

  // Length score (max 25 pts)
  // ≥ 16 → 25 | ≥ 12 → 20 | ≥ 10 → 15 | ≥ 8 → 10 | ≥ 6 → 5 | < 6 → 0
  let lengthScore = 0;
  if      (len >= 16) lengthScore = 25;
  else if (len >= 12) lengthScore = 20;
  else if (len >= 10) lengthScore = 15;
  else if (len >= 8)  lengthScore = 10;
  else if (len >= 6)  lengthScore = 5;

  // Variety score (max 20 pts)
  // 4 classes → 20 | 3 → 15 | 2 → 8 | 1 → 2
  const varietyScoreMap = [0, 2, 8, 15, 20];
  const varietyScore = varietyScoreMap[varietyCount];

  // Entropy score (max 20 pts)
  // ≥ 80 bits → 20 | ≥ 60 → 16 | ≥ 40 → 10 | ≥ 28 → 5 | < 28 → 0
  let entropyScore = 0;
  if      (entropy >= 80) entropyScore = 20;
  else if (entropy >= 60) entropyScore = 16;
  else if (entropy >= 40) entropyScore = 10;
  else if (entropy >= 28) entropyScore = 5;

  // ── 6. Informational flags ───────────────────────────────────────────────
  const flags = [];
  if (len < 8)          flags.push("too_short");
  if (len < 12)         flags.push("short");
  if (!hasUpper)        flags.push("no_uppercase");
  if (!hasLower)        flags.push("no_lowercase");
  if (!hasDigit)        flags.push("no_digits");
  if (!hasSymbol)       flags.push("no_symbols");
  if (varietyCount < 2) flags.push("low_variety");
  if (entropy < 28)     flags.push("low_entropy");

  return {
    length: len,
    charsetSize,
    entropy: Math.round(entropy * 10) / 10,  // 1 decimal place
    hasLower,
    hasUpper,
    hasDigit,
    hasSymbol,
    varietyCount,
    lengthScore,
    varietyScore,
    entropyScore,
    flags,
  };
}

/**
 * Returns a human-readable entropy label.
 * @param {number} bits
 * @returns {string}
 */
export function entropyLabel(bits) {
  if (bits >= 80) return "Excellent";
  if (bits >= 60) return "Good";
  if (bits >= 40) return "Moderate";
  if (bits >= 28) return "Low";
  return "Very Low";
}
