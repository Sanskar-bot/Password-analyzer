/**
 * dictCache.js — VaultZero v2
 * ─────────────────────────────────────────────────────────────────────────────
 * In-memory singleton that holds the attack dictionary as a
 * Map<string, number>  (lowercased entry → 1-indexed rank)
 *
 * This enables O(1) lookups during every keystroke — the dictionary is read
 * from chrome.storage.local exactly ONCE per browser session (lazy, on first
 * lookup), then held in RAM for the lifetime of the tab/service-worker.
 *
 * API:
 *   warmCache()           Load dict from storage into RAM (idempotent)
 *   lookup(password)      { found: boolean, rank: number|null }
 *   isReady()             boolean — true after first successful warmCache
 *   getSize()             number — entries currently loaded
 *   invalidate()          Clear RAM cache (call after profile/dict update)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDictionary, getDictMeta } from './profileStore.js';

// ── Module-level state (singleton) ────────────────────────────────────────────
/** @type {Map<string, number>} lowercased password → 1-indexed rank */
let _dictMap    = null;
let _warming    = false;   // prevents concurrent warm calls
let _warmPromise = null;   // deduplicate concurrent warmCache() calls

// ── Leet normalisation (mirrors personalDictionaryScorer) ─────────────────────
const LEET_MAP = { a:'4', e:'3', i:'1', o:'0', s:'5', t:'7', g:'9', z:'2' };

function toLeet(str) {
  return str.toLowerCase().split('').map(c => LEET_MAP[c] ?? c).join('');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load the stored dictionary into RAM.
 * Safe to call multiple times — subsequent calls while warming are queued.
 * If already warmed, resolves immediately.
 * @returns {Promise<void>}
 */
export async function warmCache() {
  if (_dictMap !== null) return;          // already warm
  if (_warmPromise) return _warmPromise;  // already warming — join the queue

  _warmPromise = (async () => {
    try {
      const meta = await getDictMeta();
      if (!meta || meta.size === 0) {
        _dictMap = new Map(); // empty — no profile yet
        return;
      }

      const dict = await getDictionary();
      const map  = new Map();
      dict.forEach((entry, idx) => {
        // Store both the original lowercase form AND the leet form for O(1)
        // reverse-leet matching without needing a second pass at lookup time.
        const lower = entry.toLowerCase();
        const leet  = toLeet(lower);
        if (!map.has(lower)) map.set(lower, idx + 1);
        if (!map.has(leet))  map.set(leet,  idx + 1);
      });

      _dictMap = map;
    } catch (e) {
      console.warn('[VaultZero] dictCache.warmCache failed:', e);
      _dictMap = new Map();
    } finally {
      _warmPromise = null;
    }
  })();

  return _warmPromise;
}

/**
 * Look up a password in the in-memory cache.
 * Returns { found: false, rank: null } if the cache is not yet warmed.
 * Call warmCache() before the first lookup for best results.
 *
 * @param {string} password
 * @returns {{ found: boolean, rank: number|null }}
 */
export function lookup(password) {
  if (!_dictMap || _dictMap.size === 0) return { found: false, rank: null };

  const lower = password.toLowerCase();
  const leet  = toLeet(lower);

  // O(1) — Map.get is O(1) average
  const rankByLower = _dictMap.get(lower);
  if (rankByLower !== undefined) return { found: true, rank: rankByLower };

  const rankByLeet = _dictMap.get(leet);
  if (rankByLeet !== undefined) return { found: true, rank: rankByLeet };

  return { found: false, rank: null };
}

/**
 * Returns true once the cache has been successfully warmed.
 * @returns {boolean}
 */
export function isReady() {
  return _dictMap !== null;
}

/**
 * Returns the number of entries currently in RAM.
 * @returns {number}
 */
export function getSize() {
  return _dictMap ? _dictMap.size : 0;
}

/**
 * Clear the in-memory cache.
 * Call this when the profile or dictionary is updated so the next lookup
 * triggers a fresh read from storage.
 * @returns {void}
 */
export function invalidate() {
  _dictMap     = null;
  _warming     = false;
  _warmPromise = null;
}
