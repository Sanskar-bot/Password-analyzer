/**
 * generator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cryptographically secure password generator.
 *
 * Uses window.crypto.getRandomValues() — NOT Math.random() — so outputs
 * are suitable for real security use.
 *
 * Guarantees:
 *   • At least one character from each enabled class
 *   • Characters drawn uniformly from the combined pool (no modulo bias
 *     by using rejection sampling)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CHAR_SETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits:    "0123456789",
  symbols:   "!@#$%^&*()-_=+[]{}|;:,.<>?",
};

/**
 * Draw a cryptographically random integer in [0, max).
 * Uses rejection sampling to eliminate modulo bias.
 *
 * @param {number} max
 * @returns {number}
 */
function secureRandom(max) {
  const arr   = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % max); // rejection threshold
  let val;
  do {
    globalThis.crypto.getRandomValues(arr);
    val = arr[0];
  } while (val >= limit);
  return val % max;
}

/**
 * Shuffle an array in-place using the Fisher-Yates algorithm with
 * cryptographic randomness.
 *
 * @param {any[]} arr
 */
function secureShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandom(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Generate a secure random password.
 *
 * @param {{
 *   length:    number,   // Total character count (default 16)
 *   lowercase: boolean,  // Include a–z
 *   uppercase: boolean,  // Include A–Z
 *   digits:    boolean,  // Include 0–9
 *   symbols:   boolean,  // Include special chars
 * }} options
 *
 * @returns {string}  Generated password
 * @throws  {Error}   If no character class is selected
 */
export function generatePassword(options = {}) {
  const config = {
    length:    options.length    ?? 16,
    lowercase: options.lowercase ?? true,
    uppercase: options.uppercase ?? true,
    digits:    options.digits    ?? true,
    symbols:   options.symbols   ?? true,
  };

  // Build pool and required-character list
  let pool     = "";
  const required = [];   // guarantees at least one of each selected class

  for (const [key, chars] of Object.entries(CHAR_SETS)) {
    if (config[key]) {
      pool += chars;
      // Pick one guaranteed character from this class
      required.push(chars[secureRandom(chars.length)]);
    }
  }

  if (pool.length === 0) throw new Error("Select at least one character class.");
  if (config.length < required.length) {
    throw new Error(`Length must be at least ${required.length} to satisfy all selected classes.`);
  }

  // Fill remaining slots from full pool
  const remaining = config.length - required.length;
  const chars = [...required];
  for (let i = 0; i < remaining; i++) {
    chars.push(pool[secureRandom(pool.length)]);
  }

  // Shuffle to avoid predictable placement of required chars at the start
  secureShuffle(chars);

  return chars.join("");
}
