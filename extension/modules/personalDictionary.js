/**
 * personalDictionary.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Public API for the Personalized Attack Analysis module.
 *
 * Orchestrates:
 *   1. generatePersonalDictionary()  — builds the word list
 *   2. findPasswordInDictionary()    — checks if password is in list
 *   3. computePersonalScore()        — 0–100 resistance score
 *   4. computeRiskLevel()            — Critical / High / Medium / Low / Safe
 *   5. generateRiskExplanation()     — human-readable bullet points
 *
 * This is the only module that app.js needs to import.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generatePersonalDictionary }  from './personalDictionaryGenerator.js';
import {
  findPasswordInDictionary,
  computePersonalScore,
  computeRiskLevel,
  generateRiskExplanation,
} from './personalDictionaryScorer.js';

/**
 * Run the full personalized attack analysis pipeline.
 *
 * Designed for lazy execution — call this only when the user explicitly
 * requests it (button click). Never run on keystrokes.
 *
 * @param {string} password   The password being tested
 * @param {object} profile    User-provided personal information (all optional)
 * @param {string} [profile.name]
 * @param {string} [profile.surname]
 * @param {string} [profile.nick]
 * @param {string} [profile.username]
 * @param {string} [profile.dob]        HTML date input: "YYYY-MM-DD"
 * @param {string} [profile.partner]
 * @param {string} [profile.pet]
 * @param {string} [profile.company]
 *
 * @returns {Promise<{
 *   dictionary:   string[],
 *   dictSize:     number,
 *   found:        boolean,
 *   rank:         number|null,
 *   score:        number,
 *   riskLevel:    { label: string, cssClass: string, emoji: string },
 *   explanation:  string[],
 * }>}
 */
export async function runPersonalizedAnalysis(password, profile) {
  // Yield to the UI thread so the loading state renders before we block
  await new Promise(resolve => setTimeout(resolve, 20));

  // 1. Generate the dictionary
  const dictionary = generatePersonalDictionary(profile);

  // 2. Search for the password
  const { found, rank } = findPasswordInDictionary(password, dictionary);

  // 3. Score
  const score = computePersonalScore(found, rank, dictionary.length);

  // 4. Risk level
  const riskLevel = computeRiskLevel(found, rank);

  // 5. Human-readable explanation
  const explanation = generateRiskExplanation(password, profile, found, rank);

  return {
    dictionary,
    dictSize: dictionary.length,
    found,
    rank,
    score,
    riskLevel,
    explanation,
  };
}

/**
 * Trigger a browser download of the personalized dictionary as a .txt file.
 * Works in both extension pages (uses chrome.downloads) and plain web pages
 * (uses anchor-click fallback).
 *
 * @param {string[]} dictionary   The generated password list
 * @param {string}   [name]       Optional: used in the filename
 */
export function downloadDictionary(dictionary, name = '') {
  const content  = dictionary.join('\n');
  const blob     = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url      = URL.createObjectURL(blob);
  const filename = name
    ? `${name.toLowerCase().replace(/\s+/g, '_')}_dictionary.txt`
    : 'personal_dictionary.txt';

  // Extension context: use chrome.downloads API
  if (typeof chrome !== 'undefined' && chrome.downloads) {
    chrome.downloads.download({ url, filename, saveAs: false }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
    return;
  }

  // Web page fallback: anchor click
  const anchor = document.createElement('a');
  anchor.href     = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
