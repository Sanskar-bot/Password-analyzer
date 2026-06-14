/**
 * settings.js — VaultZero Settings Controller
 * Loads, displays, and saves extension settings via chrome.storage.sync
 */

const DEFAULT_SETTINGS = {
  enableWidget:       true,
  enablePersonalized: true,
  enableGenerator:    true,
  enableBadge:        true,
  widgetPosition:     'below',
  minScoreThreshold:  50,
};

const $ = (id) => document.getElementById(id);

// ── Load settings on page open ────────────────────────────────────────────────
chrome.storage.sync.get('settings', (data) => {
  const s = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };

  $('setting-widget').checked    = s.enableWidget;
  $('setting-personal').checked  = s.enablePersonalized;
  $('setting-generator').checked = s.enableGenerator;
  $('setting-badge').checked     = s.enableBadge;
  $('setting-position').value    = s.widgetPosition;
  $('setting-threshold').value   = s.minScoreThreshold;
  $('threshold-display').textContent = s.minScoreThreshold;
});

// ── Live slider display ───────────────────────────────────────────────────────
$('setting-threshold').addEventListener('input', () => {
  $('threshold-display').textContent = $('setting-threshold').value;
});

// ── Save ──────────────────────────────────────────────────────────────────────
$('save-btn').addEventListener('click', () => {
  const settings = {
    enableWidget:       $('setting-widget').checked,
    enablePersonalized: $('setting-personal').checked,
    enableGenerator:    $('setting-generator').checked,
    enableBadge:        $('setting-badge').checked,
    widgetPosition:     $('setting-position').value,
    minScoreThreshold:  parseInt($('setting-threshold').value, 10),
  };

  chrome.storage.sync.set({ settings }, () => {
    const status = $('save-status');
    status.textContent = 'Settings saved';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2500);
  });
});
