/**
 * background.js — VaultZero v2 Service Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsibilities:
 *   • On first install: open profile setup wizard in a new tab
 *   • Manage extension badge (score / field detection)
 *   • Relay messages between content scripts and popup
 *   • Handle profile/dictionary update events from profile.js
 *   • Broadcast DICT_UPDATED to all content scripts on regen
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Default Settings ──────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  enableWidget:        true,
  enablePersonalized:  true,
  enableGenerator:     true,
  enableBadge:         true,
  widgetPosition:      'below',  // 'below' | 'beside'
  minScoreThreshold:   50,
};

// ── Tab score state (in-memory, resets on SW restart) ─────────────────────────
const tabScores = new Map(); // tabId → { score, category, color, fieldCount }

// ── Install ───────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    // Write default settings
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    console.log('[VaultZero] Installed — defaults written.');

    // Open first-time setup wizard in a new tab
    const setupUrl = chrome.runtime.getURL('pages/profile.html#setup');
    chrome.tabs.create({ url: setupUrl });
  }
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {

    // Content script reports a password field was found
    case 'FIELDS_DETECTED': {
      const prev = tabScores.get(tabId) || {};
      tabScores.set(tabId, { ...prev, fieldCount: msg.count });
      updateBadge(tabId);
      sendResponse({ ok: true });
      break;
    }

    // Content script reports a score update while user types
    case 'SCORE_UPDATE': {
      tabScores.set(tabId, {
        score:      msg.score,
        category:   msg.category,
        color:      msg.color,
        fieldCount: msg.fieldCount ?? 1,
      });
      updateBadge(tabId);
      sendResponse({ ok: true });
      break;
    }

    // Popup requests the score for a specific tab
    case 'GET_TAB_SCORE': {
      const tid = msg.tabId;
      sendResponse(tabScores.get(tid) || null);
      break;
    }

    // Profile or dictionary was updated — broadcast to all content scripts
    case 'PROFILE_UPDATED': {
      broadcastToAllTabs({ type: 'DICT_UPDATED' });
      sendResponse({ ok: true });
      break;
    }

    // Any page can request the profile + dict status
    case 'GET_PROFILE_STATUS': {
      (async () => {
        try {
          const profileData = await new Promise((res) => {
            chrome.storage.local.get('vz_profile', (d) => res(d.vz_profile ?? null));
          });
          const metaData = await new Promise((res) => {
            chrome.storage.local.get('vz_dict_meta', (d) => res(d.vz_dict_meta ?? null));
          });
          sendResponse({
            hasProfile:    profileData !== null,
            hasDictionary: metaData   !== null,
            dictSize:      metaData?.size      ?? 0,
            generatedAt:   metaData?.generatedAt ?? null,
            profileName:   profileData
              ? [profileData.firstName, profileData.lastName].filter(Boolean).join(' ')
              : null,
          });
        } catch (e) {
          sendResponse({ hasProfile: false, hasDictionary: false, dictSize: 0, generatedAt: null, profileName: null });
        }
      })();
      return true; // keep channel open for async
    }

    // Popup forwards a message to the content script of the active tab
    case 'FORWARD_TO_CONTENT': {
      chrome.tabs.sendMessage(msg.targetTabId, msg.payload)
        .then(sendResponse)
        .catch(() => sendResponse(null));
      return true;
    }

    default:
      sendResponse({ ok: false, error: 'Unknown message type' });
  }

  return false;
});

// ── Broadcast to all content script tabs ──────────────────────────────────────
function broadcastToAllTabs(payload) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  });
}

// ── Badge management ──────────────────────────────────────────────────────────

async function updateBadge(tabId) {
  if (!tabId) return;

  const { settings } = await chrome.storage.sync.get('settings');
  const cfg = settings || DEFAULT_SETTINGS;
  if (!cfg.enableBadge) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  const data = tabScores.get(tabId);
  if (!data) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  if (data.score !== undefined) {
    const score = data.score;
    let bgColor, text;

    if      (score >= 75) { bgColor = '#22c55e'; text = `${score}`; }
    else if (score >= 50) { bgColor = '#84cc16'; text = `${score}`; }
    else if (score >= 25) { bgColor = '#f59e0b'; text = `${score}`; }
    else                   { bgColor = '#ef4444'; text = `${score}`; }

    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color: bgColor, tabId });
  } else if (data.fieldCount > 0) {
    chrome.action.setBadgeText({ text: '—', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId });
  }
}

// ── Clear badge when tab navigates ───────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabScores.delete(tabId);
    chrome.action.setBadgeText({ text: '', tabId });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabScores.delete(tabId);
});
