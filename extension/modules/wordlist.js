/**
 * wordlist.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fast password/dictionary lookup using two data structures:
 *
 *   1. Hash-Set  – O(1) exact match against TOP_PASSWORDS
 *   2. Trie      – O(k) substring scan: detects dictionary words INSIDE
 *                  a password (e.g. "dragon" inside "myDragon99!")
 *
 * Both checks are also run against the leet-normalised version of the password
 * so "p@55w0rd" is caught the same as "password".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { TOP_PASSWORDS, DICTIONARY_WORDS } from "../data/common_passwords.js";
import { normalizeLeet } from "./patterns.js";

// ── Trie Implementation ───────────────────────────────────────────────────────

class TrieNode {
  constructor() {
    this.children = {};   // char → TrieNode
    this.isEnd    = false; // marks end of a complete word
    this.word     = null;  // stores the original word at terminal nodes
  }
}

class Trie {
  constructor() { this.root = new TrieNode(); }

  /** Insert a word into the trie. */
  insert(word) {
    let node = this.root;
    for (const ch of word) {
      if (!node.children[ch]) node.children[ch] = new TrieNode();
      node = node.children[ch];
    }
    node.isEnd = true;
    node.word  = word;
  }

  /**
   * Find all dictionary words that appear as substrings in `text`.
   * Runs in O(n × k) where n = text length, k = average word length.
   *
   * @param {string} text  Already lowercased
   * @returns {string[]}  Matched words
   */
  findSubstrings(text) {
    const found = new Set();
    for (let start = 0; start < text.length; start++) {
      let node = this.root;
      for (let end = start; end < text.length; end++) {
        const ch = text[end];
        if (!node.children[ch]) break;
        node = node.children[ch];
        if (node.isEnd) found.add(node.word);
      }
    }
    // Only report words with length ≥ 4 to reduce noise
    return [...found].filter(w => w.length >= 4);
  }
}

// ── Build Trie at module load time (one-time cost) ────────────────────────────
const dictionaryTrie = new Trie();
for (const word of DICTIONARY_WORDS) {
  dictionaryTrie.insert(word.toLowerCase());
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check a password against the common-password set and dictionary trie.
 *
 * @param {string} password  Raw password
 * @returns {{
 *   exactMatch:         boolean,
 *   leetMatch:          boolean,
 *   substringMatches:   string[],
 *   leetSubstrings:     string[],
 *   wordlistScore:      number,    // 0–15 contribution to scorer
 * }}
 */
export function checkWordlist(password) {
  const lower      = password.toLowerCase();
  const normalized = normalizeLeet(lower); // leet-reversed form

  // ── Exact match in common-password set ───────────────────────────────────
  const exactMatch = TOP_PASSWORDS.has(lower);
  const leetMatch  = !exactMatch && TOP_PASSWORDS.has(normalized);

  // ── Substring match via Trie ──────────────────────────────────────────────
  const substringMatches = dictionaryTrie.findSubstrings(lower);
  const leetSubstrings   = normalized !== lower
    ? dictionaryTrie.findSubstrings(normalized).filter(w => !substringMatches.includes(w))
    : [];

  // ── Score calculation (max 15 pts) ────────────────────────────────────────
  let wordlistScore = 15;
  if (exactMatch || leetMatch)         wordlistScore -= 15; // severe
  else if (substringMatches.length > 0 || leetSubstrings.length > 0) {
    // Each matched word subtracts 3 pts, floor at 0
    const matchCount = substringMatches.length + leetSubstrings.length;
    wordlistScore = Math.max(0, 15 - matchCount * 3);
  }

  return { exactMatch, leetMatch, substringMatches, leetSubstrings, wordlistScore };
}
