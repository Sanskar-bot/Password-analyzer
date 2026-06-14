/**
 * personalDictionaryScorer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates a password against a generated personal dictionary.
 *
 * Responsibilities:
 *   • Find the password in the dictionary and return its rank
 *   • Compute a Personalized Attack Resistance score (0–100)
 *   • Determine a Risk Level (Critical / High / Medium / Low / Safe)
 *   • Generate a human-readable explanation of why the password is at risk
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Leet substitution map (for reverse-leet checking) ────────────────────────
const LEET_MAP = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', g: '9', z: '2' };

/**
 * Convert a string to full leetspeak (lowercase base).
 * Used to normalise both the password and dictionary entries during matching.
 * @param {string} str
 * @returns {string}
 */
function toLeet(str) {
  return str.toLowerCase().split('').map(c => LEET_MAP[c] ?? c).join('');
}

// ── Dictionary search ─────────────────────────────────────────────────────────

/**
 * Find a password in the dictionary. Matching is case-insensitive.
 * Also checks the leetspeak-normalised form (so "P4ssw0rd" matches "password").
 *
 * @param {string}   password
 * @param {string[]} dictionary   Ordered list (index 0 = most likely)
 * @returns {{ found: boolean, rank: number|null }}
 *   rank is 1-indexed (first entry = rank 1). null if not found.
 */
export function findPasswordInDictionary(password, dictionary) {
  if (!password || !dictionary.length) return { found: false, rank: null };

  const pwdLower = password.toLowerCase();
  const pwdLeet  = toLeet(password);

  for (let i = 0; i < dictionary.length; i++) {
    const entry = dictionary[i].toLowerCase();
    if (entry === pwdLower || entry === pwdLeet || toLeet(entry) === pwdLower) {
      return { found: true, rank: i + 1 };
    }
  }

  return { found: false, rank: null };
}

/**
 * O(1) lookup using a pre-built Map from dictCache.js.
 * The map stores both the lowercase original and leet-normalised form,
 * so no per-call computation is needed.
 *
 * @param {string}           password
 * @param {Map<string,number>} dictMap   lowercased-entry → 1-indexed rank
 * @returns {{ found: boolean, rank: number|null }}
 */
export function findPasswordInSet(password, dictMap) {
  if (!password || !dictMap || dictMap.size === 0) return { found: false, rank: null };

  const lower = password.toLowerCase();
  const leet  = toLeet(lower);

  const rankByLower = dictMap.get(lower);
  if (rankByLower !== undefined) return { found: true, rank: rankByLower };

  const rankByLeet = dictMap.get(leet);
  if (rankByLeet !== undefined) return { found: true, rank: rankByLeet };

  return { found: false, rank: null };
}

// ── Score computation ─────────────────────────────────────────────────────────

/**
 * Compute Personalized Attack Resistance score (0–100).
 *
 * Scale (per spec):
 *   Rank ≤ 100        → 0–20   (critical)
 *   Rank ≤ 1,000      → 20–40  (high)
 *   Rank ≤ 5,000      → 40–60  (elevated)
 *   Rank ≤ 15,000     → 60–79  (moderate)
 *   Not found         → 80–100 (resistant)
 *
 * @param {boolean}     found
 * @param {number|null} rank     1-indexed position in dictionary
 * @param {number}      dictSize Total dictionary size
 * @returns {number}    0–100
 */
export function computePersonalScore(found, rank, dictSize) {
  if (!found || rank === null) {
    // Not found — high resistance; scale within 80–100 based on dict size
    const safeBonus = Math.min(20, Math.round((dictSize / 15000) * 20));
    return 80 + safeBonus;
  }

  if (rank <= 100)   return Math.round(rank / 100 * 20);           // 0–20
  if (rank <= 1000)  return 20 + Math.round((rank - 100) / 900 * 20);  // 20–40
  if (rank <= 5000)  return 40 + Math.round((rank - 1000) / 4000 * 20); // 40–60
  return 60 + Math.round((rank - 5000) / 10000 * 19);               // 60–79
}

// ── Risk level ────────────────────────────────────────────────────────────────

/**
 * Map a score and found state to a risk level label + CSS class.
 *
 * @param {boolean}     found
 * @param {number|null} rank
 * @returns {{ label: string, cssClass: string, emoji: string }}
 */
export function computeRiskLevel(found, rank) {
  if (!found)          return { label: 'Safe',     cssClass: 'risk-safe'     };
  if (rank <= 100)     return { label: 'Critical',  cssClass: 'risk-critical' };
  if (rank <= 1000)    return { label: 'High',      cssClass: 'risk-high'     };
  if (rank <= 5000)    return { label: 'Medium',    cssClass: 'risk-medium'   };
  return                      { label: 'Low',       cssClass: 'risk-low'      };
}

// ── Explanation engine ────────────────────────────────────────────────────────

/**
 * Analyse the password against the profile and return a list of human-readable
 * risk reasons. Does not depend on the dictionary itself — analyses the raw
 * password for personal patterns.
 *
 * @param {string} password
 * @param {object} profile
 * @param {boolean} found
 * @param {number|null} rank
 * @returns {string[]}  Array of explanation strings (bullet points)
 */
export function generateRiskExplanation(password, profile, found, rank) {
  const reasons = [];
  const pwd = password.toLowerCase();

  // Helper: check if password contains a given token (min 3 chars)
  const contains = (token) => {
    if (!token || token.length < 3) return false;
    return pwd.includes(token.toLowerCase());
  };

  // Name presence
  if (profile.name && contains(profile.name)) {
    reasons.push(`Contains your first name ("${profile.name}")`);
  }
  if (profile.surname && contains(profile.surname)) {
    reasons.push(`Contains your last name ("${profile.surname}")`);
  }
  if (profile.nick && contains(profile.nick)) {
    reasons.push(`Contains your nickname ("${profile.nick}")`);
  }
  if (profile.username && contains(profile.username)) {
    reasons.push(`Contains your username ("${profile.username}")`);
  }
  if (profile.partner && contains(profile.partner)) {
    reasons.push(`Contains your partner's name ("${profile.partner}")`);
  }
  if (profile.pet && contains(profile.pet)) {
    reasons.push(`Contains your pet's name ("${profile.pet}")`);
  }
  if (profile.company && contains(profile.company)) {
    reasons.push(`Contains your company name ("${profile.company}")`);
  }

  // Birthday / year detection
  if (profile.dob) {
    const dobParts = profile.dob.split('-');
    const yyyy = dobParts[0] || '';
    const mm   = dobParts[1] || '';
    const dd   = dobParts[2] || '';
    const yy   = yyyy.slice(-2);

    if (yyyy && pwd.includes(yyyy))       reasons.push(`Contains your birth year (${yyyy})`);
    else if (yy && pwd.includes(yy))      reasons.push(`Contains your 2-digit birth year (${yy})`);
    if (mm && dd && pwd.includes(dd + mm)) reasons.push(`Contains your day+month (${dd}${mm})`);
    if (mm && dd && pwd.includes(mm + dd)) reasons.push(`Contains your month+day (${mm}${dd})`);
  }

  // Common number pattern at end
  if (/\d{1,6}$/.test(password)) {
    const numSuffix = password.match(/\d{1,6}$/)[0];
    if (['123', '1234', '12345', '123456'].includes(numSuffix)) {
      reasons.push(`Ends with a very common number sequence ("${numSuffix}")`);
    }
  }

  // Special character patterns
  if (/@\d+$/.test(password)) {
    reasons.push('Uses a common @number suffix pattern');
  }

  // Dictionary hit annotation
  if (found && rank !== null) {
    reasons.push(`Appears at rank #${rank.toLocaleString()} in the personalised attack dictionary`);
  }

  // Leet detection
  const LEET_MAP_LOCAL = { '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't', '9': 'g', '2': 'z' };
  const hasLeet = password.split('').some(c => LEET_MAP_LOCAL[c]);
  if (hasLeet) {
    reasons.push('Uses leetspeak substitutions (e.g. 4→a, 3→e) — easily reversed by attackers');
  }

  // No personal info at all
  if (reasons.length === 0 && !found) {
    reasons.push('No obvious personal patterns detected — good resistance to targeted attacks');
  }

  return reasons;
}
