/**
 * scorer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Aggregates outputs from all analysis modules into a single 0–100 score
 * and a category label.
 *
 * Score breakdown (max 100):
 *   Length      25 pts   (from strength.js)
 *   Variety     20 pts   (from strength.js)
 *   Entropy     20 pts   (from strength.js)
 *   Wordlist    15 pts   (from wordlist.js)
 *   Patterns    10 pts   (from patterns.js)
 *   Username    10 pts   (from username.js)
 *
 * Personalized penalty (applied on top):
 *   Rank 1–100    → −50 pts  (Critical targeted risk)
 *   Rank 101–1000 → −35 pts  (High targeted risk)
 *   Rank 1001–5000→ −20 pts  (Medium targeted risk)
 *   Rank > 5000   → −10 pts  (Low targeted risk)
 *
 * The penalty reflects that a password cracked by a targeted attacker in
 * the first few hundred guesses is fundamentally not "Very Strong",
 * regardless of its entropy or character variety.
 *
 * Categories:
 *   0–24   Weak
 *   25–49  Moderate
 *   50–74  Strong
 *   75–100 Very Strong
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const CATEGORIES = [
  { min: 75, label: 'Very Strong', color: '#22c55e', class: 'very-strong' },
  { min: 50, label: 'Strong',      color: '#84cc16', class: 'strong'      },
  { min: 25, label: 'Moderate',    color: '#f59e0b', class: 'moderate'    },
  { min: 0,  label: 'Weak',        color: '#ef4444', class: 'weak'        },
];

/**
 * Compute the overall password score and category.
 *
 * @param {{ lengthScore: number, varietyScore: number, entropyScore: number }} strengthResult
 * @param {{ wordlistScore: number }} wordlistResult
 * @param {{ patternScore:  number }} patternResult
 * @param {{ usernameScore: number }} usernameResult
 * @param {{ found: boolean, rank: number|null }|null} [personalResult]
 *   Optional personalized dictionary lookup result.
 *   When provided and found=true, applies a targeted-risk penalty to the score.
 *
 * @returns {{
 *   score:          number,    // 0–100 (includes personalized penalty if applicable)
 *   baseScore:      number,    // 0–100 (before personalized penalty)
 *   personalPenalty:number,    // penalty applied (0 if not found)
 *   personalRisk:   string,    // 'Critical'|'High'|'Medium'|'Low'|'Resistant'|'Unknown'
 *   category:       string,
 *   color:          string,
 *   cssClass:       string,
 *   breakdown:      object,
 * }}
 */
export function computeScore(strengthResult, wordlistResult, patternResult, usernameResult, personalResult = null) {
  const breakdown = {
    length:   strengthResult.lengthScore,
    variety:  strengthResult.varietyScore,
    entropy:  strengthResult.entropyScore,
    wordlist: wordlistResult.wordlistScore,
    patterns: patternResult.patternScore,
    username: usernameResult.usernameScore,
  };

  const raw = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const baseScore = Math.min(100, Math.max(0, Math.round(raw)));

  // ── Personalized penalty ────────────────────────────────────────────────────
  let personalPenalty = 0;
  let personalRisk    = 'Unknown';

  if (personalResult !== null) {
    if (!personalResult.found) {
      personalRisk    = 'Resistant';
      personalPenalty = 0;
    } else {
      const rank = personalResult.rank;
      if (rank <= 100) {
        personalPenalty = 50;
        personalRisk    = 'Critical';
      } else if (rank <= 1000) {
        personalPenalty = 35;
        personalRisk    = 'High';
      } else if (rank <= 5000) {
        personalPenalty = 20;
        personalRisk    = 'Medium';
      } else {
        personalPenalty = 10;
        personalRisk    = 'Low';
      }
    }
  }

  const score = Math.min(100, Math.max(0, baseScore - personalPenalty));
  const cat   = CATEGORIES.find(c => score >= c.min) ?? CATEGORIES[CATEGORIES.length - 1];

  return {
    score,
    baseScore,
    personalPenalty,
    personalRisk,
    category: cat.label,
    color:    cat.color,
    cssClass: cat.class,
    breakdown,
  };
}
