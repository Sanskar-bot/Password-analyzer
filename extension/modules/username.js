/**
 * username.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects when a password is suspiciously similar to the user's username via:
 *
 *   1. Direct containment  — password contains username as substring
 *   2. Levenshtein distance ≤ 2 between password and username
 *   3. Common suffix/prefix variations: username + "123", "!", "@", year
 *   4. Reversed username check
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 * Uses the standard Wagner-Fischer DP algorithm in O(m×n) time.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Common suffixes/prefixes attackers append to usernames. */
const COMMON_AFFIXES = [
  "1","12","123","1234","12345","!","@","#","$","1!","1@","123!",
  "2020","2021","2022","2023","2024","2025","99","007","000","69",
  "pass","pwd","password","login","secure","me","you",
];

/**
 * Check whether a password is dangerously similar to the given username.
 *
 * @param {string} password
 * @param {string} username  May be empty — function no-ops if so
 * @returns {{
 *   checked:      boolean,
 *   contains:     boolean,   // password contains username as substring
 *   nearMatch:    boolean,   // edit distance ≤ 2
 *   variation:    boolean,   // username ± common affix
 *   reversed:     boolean,   // password contains reversed username
 *   usernameScore: number,   // 0–10 contribution
 * }}
 */
export function checkUsername(password, username) {
  if (!username || username.trim() === "") {
    return { checked: false, contains: false, nearMatch: false,
             variation: false, reversed: false, usernameScore: 10 };
  }

  const pwd   = password.toLowerCase();
  const uname = username.toLowerCase().trim();
  const rev   = uname.split("").reverse().join("");

  // 1. Direct substring
  const contains = uname.length >= 2 && pwd.includes(uname);

  // 2. Levenshtein (skip if username much longer than password)
  let nearMatch = false;
  if (Math.abs(pwd.length - uname.length) <= 3) {
    nearMatch = levenshtein(pwd, uname) <= 2;
  }

  // 3. Variation: username + affix or affix + username
  let variation = false;
  if (!contains && !nearMatch) {
    for (const affix of COMMON_AFFIXES) {
      if (pwd === uname + affix || pwd === affix + uname ||
          pwd.startsWith(uname) || pwd.endsWith(uname)) {
        variation = true;
        break;
      }
    }
  }

  // 4. Reversed username
  const reversed = rev.length >= 3 && pwd.includes(rev);

  // ── Score ─────────────────────────────────────────────────────────────────
  let usernameScore = 10;
  if (contains)  usernameScore -= 10;
  else if (nearMatch || variation) usernameScore -= 7;
  else if (reversed) usernameScore -= 4;
  usernameScore = Math.max(0, usernameScore);

  return { checked: true, contains, nearMatch, variation, reversed, usernameScore };
}
