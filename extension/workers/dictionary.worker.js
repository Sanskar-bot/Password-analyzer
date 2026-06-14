/**
 * dictionary.worker.js — VaultZero v2 Web Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs CUPP-inspired dictionary generation off the main thread so the UI
 * stays fully responsive.
 *
 * NOTE: Web Workers do NOT have access to chrome.* APIs.
 * Therefore this worker only generates the dictionary and posts it back.
 * The caller (profile.js or popup.js) is responsible for writing it to
 * chrome.storage.local via profileStore.js.
 *
 * Message protocol:
 *   Incoming: { type: 'GENERATE', profile, profileHash }
 *   Outgoing: { type: 'PROGRESS', percent }
 *             { type: 'RESULT',   dictionary, dictSize, profileHash }
 *             { type: 'ERROR',    message }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generatePersonalDictionary } from '../modules/personalDictionaryGenerator.js';

self.onmessage = async function (event) {
  const { type, profile, profileHash = '' } = event.data;

  if (type !== 'GENERATE') return;

  try {
    // 5% — starting
    self.postMessage({ type: 'PROGRESS', percent: 5 });

    // 1. Generate the dictionary (CPU-bound, off main thread)
    const dictionary = generatePersonalDictionary(profile);
    self.postMessage({ type: 'PROGRESS', percent: 90 });

    // 2. Return the dictionary to the caller for storage
    //    (chrome.* APIs are not available inside Workers)
    self.postMessage({ type: 'PROGRESS', percent: 100 });
    self.postMessage({
      type:        'RESULT',
      dictionary,
      dictSize:    dictionary.length,
      profileHash,
    });

  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err.message });
  }
};
