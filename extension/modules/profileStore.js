/**
 * profileStore.js — VaultZero v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for reading and writing:
 *   • The user's Personal Security Profile (vz_profile)
 *   • The pre-computed CUPP attack dictionary (vz_dict_chunk_N + vz_dict_meta)
 *
 * All data lives in chrome.storage.local ONLY. Never synced, never transmitted.
 *
 * Dictionary chunking strategy:
 *   chrome.storage.local limits a single set() call to 5MB serialised.
 *   A 15,000-entry dictionary is ~750KB — safe in one chunk, but we split
 *   into CHUNK_SIZE=3,000 entries per key for headroom and fast partial reads.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PROFILE_KEY    = 'vz_profile';
const DICT_META_KEY  = 'vz_dict_meta';
const DICT_CHUNK_KEY = (n) => `vz_dict_chunk_${n}`;
const HISTORY_KEY    = 'vz_history';
const CHUNK_SIZE     = 3000;
const STORE_VERSION  = '2.0';
const MAX_HISTORY    = 5;

// ── Profile ───────────────────────────────────────────────────────────────────

/**
 * Read the stored profile. Returns null if none exists.
 * @returns {Promise<object|null>}
 */
export async function getProfile() {
  return new Promise((resolve) => {
    chrome.storage.local.get(PROFILE_KEY, (data) => {
      resolve(data[PROFILE_KEY] ?? null);
    });
  });
}

/**
 * Persist a profile. Automatically stamps updatedAt.
 * @param {object} profile
 * @returns {Promise<void>}
 */
export async function saveProfile(profile) {
  const now = Date.now();
  const existing = await getProfile();
  const merged = {
    createdAt: existing?.createdAt ?? now,
    ...profile,
    updatedAt: now,
  };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PROFILE_KEY]: merged }, resolve);
  });
}

/**
 * Erase the profile (and dictionary) from local storage.
 * @returns {Promise<void>}
 */
export async function deleteProfile() {
  const meta = await getDictMeta();
  const chunkKeys = meta
    ? Array.from({ length: meta.chunks }, (_, i) => DICT_CHUNK_KEY(i))
    : [];

  return new Promise((resolve) => {
    chrome.storage.local.remove(
      [PROFILE_KEY, DICT_META_KEY, HISTORY_KEY, ...chunkKeys],
      resolve
    );
  });
}

// ── Dictionary metadata ───────────────────────────────────────────────────────

/**
 * Read the dictionary metadata record.
 * @returns {Promise<{size:number, chunks:number, generatedAt:number, profileHash:string, version:string}|null>}
 */
export async function getDictMeta() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DICT_META_KEY, (data) => {
      resolve(data[DICT_META_KEY] ?? null);
    });
  });
}

// ── Dictionary read ───────────────────────────────────────────────────────────

/**
 * Reassemble the full dictionary from all chunks.
 * Returns an empty array if no dictionary is stored.
 * @returns {Promise<string[]>}
 */
export async function getDictionary() {
  const meta = await getDictMeta();
  if (!meta || meta.chunks === 0) return [];

  const keys = Array.from({ length: meta.chunks }, (_, i) => DICT_CHUNK_KEY(i));
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => {
      const dict = [];
      for (let i = 0; i < meta.chunks; i++) {
        const chunk = data[DICT_CHUNK_KEY(i)];
        if (Array.isArray(chunk)) dict.push(...chunk);
      }
      resolve(dict);
    });
  });
}

// ── Dictionary write ──────────────────────────────────────────────────────────

/**
 * Split the dictionary into chunks and persist them alongside metadata.
 * Also computes and stores a profileHash so callers can detect staleness.
 *
 * @param {string[]} dictionary   Ordered list of attack candidates
 * @param {string}   profileHash  SHA-256-hex of the profile JSON (or any hash)
 * @returns {Promise<void>}
 */
export async function saveDictionary(dictionary, profileHash = '') {
  // Split into chunks
  const chunks = [];
  for (let i = 0; i < dictionary.length; i += CHUNK_SIZE) {
    chunks.push(dictionary.slice(i, i + CHUNK_SIZE));
  }

  const meta = {
    size:        dictionary.length,
    chunks:      chunks.length,
    generatedAt: Date.now(),
    profileHash,
    version:     STORE_VERSION,
  };

  // Build the storage object: all chunks + meta in one set call
  const storageObj = { [DICT_META_KEY]: meta };
  chunks.forEach((chunk, i) => {
    storageObj[DICT_CHUNK_KEY(i)] = chunk;
  });

  return new Promise((resolve) => {
    chrome.storage.local.set(storageObj, resolve);
  });
}

/**
 * Remove the stored dictionary (chunks + meta) without touching the profile.
 * @returns {Promise<void>}
 */
export async function clearDictionary() {
  const meta = await getDictMeta();
  if (!meta) return;
  const chunkKeys = Array.from({ length: meta.chunks }, (_, i) => DICT_CHUNK_KEY(i));
  return new Promise((resolve) => {
    chrome.storage.local.remove([DICT_META_KEY, ...chunkKeys], resolve);
  });
}

// ── Staleness check ───────────────────────────────────────────────────────────

/**
 * Compute a lightweight hash of the profile to detect changes.
 * Uses a simple djb2 string hash (fast, no crypto API needed).
 * @param {object} profile
 * @returns {string}
 */
export function profileHash(profile) {
  const str = JSON.stringify(profile ?? {});
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // keep as unsigned 32-bit
  }
  return h.toString(16);
}

/**
 * Returns true if the stored dictionary was generated from a different
 * profile than the one currently saved (or if there is no dictionary).
 * @param {object} currentProfile
 * @returns {Promise<boolean>}
 */
export async function isDictionaryStale(currentProfile) {
  const meta = await getDictMeta();
  if (!meta) return true;
  return meta.profileHash !== profileHash(currentProfile);
}

// ── Analysis history ──────────────────────────────────────────────────────────

/**
 * Prepend a new analysis result to the history (capped at MAX_HISTORY).
 * @param {{ password:string, score:number, risk:string, personalScore:number, personalRisk:string, rank:number|null, found:boolean, ts:number }} entry
 * @returns {Promise<void>}
 */
export async function addToHistory(entry) {
  const history = await getHistory();
  // Truncate password for display (store only first 3 + stars)
  const masked = entry.password
    ? entry.password.slice(0, 3) + '*'.repeat(Math.max(0, entry.password.length - 3))
    : '***';
  const record = { ...entry, password: masked, ts: Date.now() };
  const updated = [record, ...history].slice(0, MAX_HISTORY);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [HISTORY_KEY]: updated }, resolve);
  });
}

/**
 * Retrieve stored analysis history (most recent first).
 * @returns {Promise<object[]>}
 */
export async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(HISTORY_KEY, (data) => {
      resolve(data[HISTORY_KEY] ?? []);
    });
  });
}

/**
 * Export the profile as a JSON string (for the Export Profile button).
 * Strips internal metadata (createdAt, updatedAt) for cleanliness.
 * @returns {Promise<string>}
 */
export async function exportProfile() {
  const profile = await getProfile();
  if (!profile) return '';
  const { createdAt, updatedAt, ...userFields } = profile;
  return JSON.stringify(userFields, null, 2);
}
