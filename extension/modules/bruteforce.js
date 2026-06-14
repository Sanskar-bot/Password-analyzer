/**
 * bruteforce.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Estimates how long it would take an attacker to crack a password under
 * four realistic attack scenarios, based on:
 *
 *   combinations = charsetSize ^ length
 *   avgTime      = combinations / (2 × guessesPerSecond)
 *
 * The character-set size comes from strength.js (analyseStrength).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Attack scenario definitions.
 * Guesses-per-second values are conservative real-world estimates.
 */
export const ATTACK_SCENARIOS = [
  {
    id:    "online_throttled",
    label: "Online (throttled)",
    desc:  "Rate-limited web login — ~10 attempts/sec",
    gps:   10,           // guesses per second
  },
  {
    id:    "online_fast",
    label: "Online (no limit)",
    desc:  "Unthrottled online attack — ~1,000/sec",
    gps:   1_000,
  },
  {
    id:    "offline_slow",
    label: "Offline (bcrypt)",
    desc:  "Offline attack on bcrypt hashes — ~10K/sec",
    gps:   10_000,
  },
  {
    id:    "offline_fast",
    label: "Offline (MD5/GPU)",
    desc:  "GPU-accelerated MD5 cracking — ~10B/sec",
    gps:   10_000_000_000,
  },
];

/**
 * Convert a number of seconds into a human-readable string.
 *
 * @param {number} seconds
 * @returns {string}
 */
function humanizeTime(seconds) {
  if (!isFinite(seconds) || seconds > 1e30) return "Centuries+";

  const MINUTE = 60;
  const HOUR   = 3600;
  const DAY    = 86400;
  const WEEK   = 604800;
  const MONTH  = 2592000;   // 30 days
  const YEAR   = 31536000;  // 365 days
  const DECADE = YEAR * 10;
  const CENT   = YEAR * 100;
  const MILL   = YEAR * 1_000_000;

  if (seconds < 1)         return "< 1 second";
  if (seconds < MINUTE)    return `${Math.round(seconds)} second${seconds < 2 ? "" : "s"}`;
  if (seconds < HOUR)      return `${Math.round(seconds / MINUTE)} minute${Math.round(seconds/MINUTE)<2?"":"s"}`;
  if (seconds < DAY)       return `${Math.round(seconds / HOUR)} hour${Math.round(seconds/HOUR)<2?"":"s"}`;
  if (seconds < WEEK)      return `${Math.round(seconds / DAY)} day${Math.round(seconds/DAY)<2?"":"s"}`;
  if (seconds < MONTH)     return `${Math.round(seconds / WEEK)} week${Math.round(seconds/WEEK)<2?"":"s"}`;
  if (seconds < YEAR)      return `${Math.round(seconds / MONTH)} month${Math.round(seconds/MONTH)<2?"":"s"}`;
  if (seconds < DECADE)    return `${Math.round(seconds / YEAR)} year${Math.round(seconds/YEAR)<2?"":"s"}`;
  if (seconds < CENT)      return `${Math.round(seconds / DECADE)} decade${Math.round(seconds/DECADE)<2?"":"s"}`;
  if (seconds < MILL)      return `${Math.round(seconds / CENT)} centur${Math.round(seconds/CENT)===1?"y":"ies"}`;
  return "Millions of years";
}

/**
 * Determine the severity colour class for a crack time string.
 * @param {number} seconds
 * @returns {"danger"|"warning"|"moderate"|"safe"}
 */
export function timeSeverity(seconds) {
  if (seconds < 3600)         return "danger";    // < 1 hour
  if (seconds < 86400 * 7)    return "warning";   // < 1 week
  if (seconds < 86400 * 365)  return "moderate";  // < 1 year
  return "safe";
}

/**
 * Estimate crack times for all attack scenarios.
 *
 * @param {number} charsetSize  From analyseStrength()
 * @param {number} length       Password length
 * @returns {Array<{
 *   id: string, label: string, desc: string,
 *   seconds: number, display: string, severity: string
 * }>}
 */
export function estimateCrackTimes(charsetSize, length) {
  // Total number of possible combinations
  // Use Math.pow; for very large numbers JavaScript returns Infinity which
  // humanizeTime handles gracefully.
  const combinations = Math.pow(charsetSize, length);

  return ATTACK_SCENARIOS.map(scenario => {
    // Average case: attacker finds it halfway through keyspace
    const seconds = combinations / (2 * scenario.gps);
    return {
      ...scenario,
      seconds,
      display:  humanizeTime(seconds),
      severity: timeSeverity(seconds),
    };
  });
}
