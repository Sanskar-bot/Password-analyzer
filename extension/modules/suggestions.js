/**
 * suggestions.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Rule-based suggestions engine.  Given the combined analysis results,
 * returns a prioritised list of actionable improvement tips.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Generate suggestions based on analysis results.
 *
 * @param {object} strength   from analyseStrength()
 * @param {object} wordlist   from checkWordlist()
 * @param {object} patterns   from detectPatterns()
 * @param {object} username   from checkUsername()
 * @param {object} scoreResult from computeScore()
 *
 * @returns {Array<{ priority: "high"|"medium"|"low", icon: string, text: string }>}
 */
export function generateSuggestions(strength, wordlist, patterns, username, scoreResult) {
  const tips = [];

  // ── Critical (high priority) ─────────────────────────────────────────────

  if (strength.length < 8) {
    tips.push({ priority: "high", icon: "Length",
      text: "Your password is too short. Use at least 8 characters — 12 or more is ideal." });
  } else if (strength.length < 12) {
    tips.push({ priority: "medium", icon: "Length",
      text: "Consider increasing length to 12+ characters for significantly better security." });
  } else if (strength.length < 16) {
    tips.push({ priority: "low", icon: "Length",
      text: "Length is good. Bumping to 16+ characters would make it excellent." });
  }

  if (wordlist.exactMatch) {
    tips.push({ priority: "high", icon: "Wordlist",
      text: "This password appears in common password lists. Choose something completely unique." });
  } else if (wordlist.leetMatch) {
    tips.push({ priority: "high", icon: "Wordlist",
      text: "Even with leet-speak substitutions, your password maps to a common password. Be more creative." });
  }

  if (username.contains) {
    tips.push({ priority: "high", icon: "Username",
      text: "Your password contains your username — attackers will try this first. Remove it entirely." });
  } else if (username.variation || username.nearMatch) {
    tips.push({ priority: "high", icon: "Username",
      text: "Your password is too similar to your username. Use an unrelated phrase." });
  } else if (username.reversed) {
    tips.push({ priority: "medium", icon: "Username",
      text: "Your password contains your reversed username — still easy to guess." });
  }

  // ── Character variety ────────────────────────────────────────────────────

  if (!strength.hasUpper) {
    tips.push({ priority: "medium", icon: "Variety",
      text: "Add uppercase letters (A–Z) to expand the character set." });
  }
  if (!strength.hasLower) {
    tips.push({ priority: "medium", icon: "Variety",
      text: "Add lowercase letters (a–z) — mixing cases makes passwords harder to crack." });
  }
  if (!strength.hasDigit) {
    tips.push({ priority: "medium", icon: "Variety",
      text: "Include numbers (0–9). Avoid placing them only at the end." });
  }
  if (!strength.hasSymbol) {
    tips.push({ priority: "medium", icon: "Variety",
      text: "Add special characters (!@#$%^&*) for a much larger effective charset." });
  }

  // ── Pattern warnings ─────────────────────────────────────────────────────

  if (patterns.keyboard.found) {
    tips.push({ priority: "high", icon: "Pattern",
      text: `Avoid keyboard walks like "${patterns.keyboard.matches[0]}". These are in every attacker's dictionary.` });
  }
  if (patterns.sequential.found) {
    tips.push({ priority: "medium", icon: "Pattern",
      text: `Remove sequential runs like "${patterns.sequential.matches[0]}". They reduce effective entropy.` });
  }
  if (patterns.repeats.found) {
    tips.push({ priority: "medium", icon: "Pattern",
      text: `Avoid repeating characters ("${patterns.repeats.matches[0]}"). Use varied characters instead.` });
  }
  if (patterns.dates.found) {
    tips.push({ priority: "medium", icon: "Pattern",
      text: `Date patterns (${patterns.dates.matches[0]}) are easy to guess. Remove or obscure them.` });
  }
  if (patterns.leet.found && (wordlist.leetMatch || wordlist.leetSubstrings.length > 0)) {
    tips.push({ priority: "medium", icon: "Leet",
      text: "Simple leet substitutions (@ for a, 0 for o) are well-known — attackers check these automatically." });
  }

  // ── Dictionary word warnings ─────────────────────────────────────────────

  if (wordlist.substringMatches.length > 0) {
    const words = wordlist.substringMatches.slice(0, 2).join('", "');
    tips.push({ priority: "medium", icon: "Dictionary",
      text: `Your password contains common word${wordlist.substringMatches.length > 1 ? "s" : ""} ("${words}"). Use random character sequences instead.` });
  }

  // ── Positive reinforcement ────────────────────────────────────────────────

  if (tips.length === 0) {
    tips.push({ priority: "low", icon: "Status",
      text: "Great password! To stay safe, use a unique password for every account and store it in a password manager." });
  }

  // ── General best-practice tips (always appended if score < 75) ───────────

  if (scoreResult.score < 75) {
    tips.push({ priority: "low", icon: "Tip",
      text: "Use a passphrase — four random words joined together are both memorable and strong (e.g. 'coffee-orbit-maple-7')." });
  }

  // Sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  tips.sort((a, b) => order[a.priority] - order[b.priority]);

  return tips;
}
