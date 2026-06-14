/**
 * profile.js — VaultZero v2 Profile Page Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles both modes:
 *   #setup  → First-time wizard (3 steps)
 *   (none)  → Profile management (view / edit / delete / regen)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  getProfile,
  saveProfile,
  deleteProfile,
  getDictMeta,
  saveDictionary,
  isDictionaryStale,
  exportProfile,
  profileHash,
} from '../modules/profileStore.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function showToast(msg, type = 'success') {
  const toast  = $('toast');
  const toastMsg = $('toast-msg');
  toastMsg.textContent = msg;
  toast.className = `toast visible ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.classList.remove('visible'); }, 3000);
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatNumber(n) {
  return typeof n === 'number' ? n.toLocaleString() : '—';
}

// ── Profile collection from wizard/edit forms ─────────────────────────────────

function collectWizardForm() {
  const kw = $('pf-customKeywords').value.trim();
  return {
    firstName:      $('pf-firstName').value.trim(),
    lastName:       $('pf-lastName').value.trim(),
    nickname:       $('pf-nickname').value.trim(),
    username:       $('pf-username').value.trim(),
    dateOfBirth:    $('pf-dob').value,
    partnerName:    $('pf-partnerName').value.trim(),
    petName:        $('pf-petName').value.trim(),
    companyName:    $('pf-companyName').value.trim(),
    favoriteNumber: $('pf-favoriteNumber').value.trim(),
    sportsTeam:     $('pf-sportsTeam').value.trim(),
    gamerTag:       $('pf-gamerTag').value.trim(),
    commonAlias:    $('pf-commonAlias').value.trim(),
    customKeywords: kw ? kw.split(',').map(s => s.trim()).filter(Boolean) : [],
  };
}

function collectEditForm() {
  const kw = $('ef-customKeywords').value.trim();
  return {
    firstName:      $('ef-firstName').value.trim(),
    lastName:       $('ef-lastName').value.trim(),
    nickname:       $('ef-nickname').value.trim(),
    username:       $('ef-username').value.trim(),
    dateOfBirth:    $('ef-dob').value,
    partnerName:    $('ef-partnerName').value.trim(),
    petName:        $('ef-petName').value.trim(),
    companyName:    $('ef-companyName').value.trim(),
    favoriteNumber: $('ef-favoriteNumber').value.trim(),
    sportsTeam:     $('ef-sportsTeam').value.trim(),
    gamerTag:       $('ef-gamerTag').value.trim(),
    commonAlias:    $('ef-commonAlias').value.trim(),
    customKeywords: kw ? kw.split(',').map(s => s.trim()).filter(Boolean) : [],
  };
}

// Convert profile to dictionary.worker.js profile shape
function profileToGeneratorShape(p) {
  return {
    name:           p.firstName      || '',
    surname:        p.lastName       || '',
    nick:           p.nickname       || '',
    username:       p.username       || '',
    dob:            p.dateOfBirth    || '',
    partner:        p.partnerName    || '',
    pet:            p.petName        || '',
    company:        p.companyName    || '',
    gamerTag:       p.gamerTag       || '',
    sportsTeam:     p.sportsTeam     || '',
    favoriteNumber: p.favoriteNumber || '',
    commonAlias:    p.commonAlias    || '',
    customKeywords: p.customKeywords || [],
  };
}

// ── Dictionary generation via Web Worker ──────────────────────────────────────
let dictWorker = null;

function spawnWorker(profile, onProgress, onDone, onError) {
  if (dictWorker) { dictWorker.terminate(); dictWorker = null; }

  const workerUrl = chrome.runtime.getURL('workers/dictionary.worker.js');
  dictWorker = new Worker(workerUrl, { type: 'module' });

  dictWorker.onmessage = async (e) => {
    const { type, percent, dictionary, dictSize, profileHash: hash, message } = e.data;
    if (type === 'PROGRESS') { onProgress(percent); return; }
    if (type === 'RESULT') {
      try {
        // Save the dictionary from the extension page context
        // (chrome.storage is NOT available inside Web Workers)
        await saveDictionary(dictionary, hash);
        onDone(dictSize, Date.now());
      } catch (err) {
        onError('Storage write failed: ' + err.message);
      }
      dictWorker = null;
      return;
    }
    if (type === 'ERROR') { onError(message); dictWorker = null; return; }
  };
  dictWorker.onerror = (err) => { onError(err.message); dictWorker = null; };

  const hash = profileHash(profile);
  dictWorker.postMessage({
    type:        'GENERATE',
    profile:     profileToGeneratorShape(profile),
    profileHash: hash,
  });
}

// ── Wizard Mode ───────────────────────────────────────────────────────────────

let wizardStep = 1;
const genStart = { time: 0 };

function setWizardStep(n) {
  // Update panels
  for (let i = 1; i <= 3; i++) {
    const panel = $(`wizard-step-${i}`);
    panel.classList.toggle('active', i === n);
  }
  // Update step indicators
  for (let i = 1; i <= 3; i++) {
    const ind = $(`step-ind-${i}`);
    ind.classList.remove('active', 'done');
    if (i < n)  ind.classList.add('done');
    if (i === n) ind.classList.add('active');
  }
  // Update connectors
  $('conn-1-2').classList.toggle('done', n > 1);
  $('conn-2-3').classList.toggle('done', n > 2);
  wizardStep = n;
}

function startGeneration(profile) {
  setWizardStep(3);
  genStart.time = Date.now();
  $('gen-in-progress').style.display = '';
  $('gen-done').style.display = 'none';

  spawnWorker(
    profile,
    (pct) => {
      $('gen-progress-fill').style.width = `${pct}%`;
      $('gen-progress-pct').textContent   = `${pct}%`;
      // Update sub-text for UX
      if (pct < 40)  $('gen-sub-text').textContent = 'Analysing name combinations…';
      else if (pct < 70) $('gen-sub-text').textContent = 'Adding birthday & year variants…';
      else if (pct < 90) $('gen-sub-text').textContent = 'Saving to secure local storage…';
      else               $('gen-sub-text').textContent = 'Finalising…';
    },
    (dictSize, generatedAt) => {
      const elapsed = ((Date.now() - genStart.time) / 1000).toFixed(1);
      $('gen-in-progress').style.display = 'none';
      $('gen-done').style.display = '';
      $('done-dict-size').textContent = formatNumber(dictSize);
      $('done-time').textContent      = `${elapsed}s`;

      // Notify background to invalidate caches
      chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED' }).catch(() => {});
    },
    (errMsg) => {
      showToast('Generation failed: ' + errMsg, 'error');
    }
  );
}

function initWizard() {
  $('wizard-view').style.display = '';
  setWizardStep(1);

  $('wizard-next-1').addEventListener('click', () => setWizardStep(2));
  $('wizard-back-2').addEventListener('click', () => setWizardStep(1));
  $('wizard-skip-2').addEventListener('click', async () => {
    // Save empty profile so we don't re-show wizard next time
    await saveProfile({});
    window.close();
  });

  $('wizard-next-2').addEventListener('click', async () => {
    const profile = collectWizardForm();
    await saveProfile(profile);
    startGeneration(profile);
  });

  $('done-close-btn').addEventListener('click', () => {
    window.close();
  });
}

// ── Management Mode ───────────────────────────────────────────────────────────

const FIELD_LABELS = {
  firstName: 'First Name', lastName: 'Last Name',   nickname: 'Nickname',
  username: 'Username',    dateOfBirth: 'Birthday',  partnerName: 'Partner',
  petName: 'Pet',          companyName: 'Company',   sportsTeam: 'Team',
  gamerTag: 'Gamer Tag',   commonAlias: 'Alias',     favoriteNumber: 'Fav. #',
  customKeywords: 'Keywords',
};

const ALL_FIELDS = Object.keys(FIELD_LABELS);

function countFilled(profile) {
  return ALL_FIELDS.filter(k => {
    const v = profile[k];
    return Array.isArray(v) ? v.length > 0 : (v && String(v).trim().length > 0);
  }).length;
}

function renderManageView(profile, meta) {
  // Avatar / name
  const initials = [profile.firstName, profile.lastName]
    .filter(Boolean).map(s => s[0].toUpperCase()).join('') || '?';
  $('mgmt-avatar').textContent = initials;
  $('mgmt-name').textContent   = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'No name set';
  $('mgmt-meta').textContent   = `Last updated: ${formatDate(profile.updatedAt)}`;
  const filled = countFilled(profile);
  $('mgmt-completeness').textContent = `${filled}/${ALL_FIELDS.length} fields`;

  // Profile fields grid
  const fieldsEl = $('mgmt-fields');
  fieldsEl.innerHTML = ALL_FIELDS.map(k => {
    const v   = profile[k];
    const val = Array.isArray(v) ? (v.join(', ') || null) : (v || null);
    return `<div class="profile-field">
      <div class="pf-key">${FIELD_LABELS[k]}</div>
      <div class="pf-value${val ? '' : ' empty'}">${val || 'not set'}</div>
    </div>`;
  }).join('');

  // Dict stats
  if (meta) {
    $('dict-has-data').style.display = '';
    $('dict-no-data').style.display  = 'none';
    $('mgmt-dict-size').textContent    = formatNumber(meta.size);
    $('mgmt-dict-date').textContent    = formatDate(meta.generatedAt);
    $('mgmt-dict-version').textContent = meta.version || '—';
  } else {
    $('dict-has-data').style.display = 'none';
    $('dict-no-data').style.display  = '';
  }

  // Stale warning
  const isStale = meta ? (meta.profileHash !== profileHash(profile)) : true;
  $('stale-warning').style.display = (isStale && filled > 0) ? '' : 'none';
}

function populateEditForm(profile) {
  $('ef-firstName').value      = profile.firstName      || '';
  $('ef-lastName').value       = profile.lastName       || '';
  $('ef-nickname').value       = profile.nickname       || '';
  $('ef-username').value       = profile.username       || '';
  $('ef-dob').value            = profile.dateOfBirth    || '';
  $('ef-favoriteNumber').value = profile.favoriteNumber || '';
  $('ef-partnerName').value    = profile.partnerName    || '';
  $('ef-petName').value        = profile.petName        || '';
  $('ef-companyName').value    = profile.companyName    || '';
  $('ef-sportsTeam').value     = profile.sportsTeam     || '';
  $('ef-gamerTag').value       = profile.gamerTag       || '';
  $('ef-commonAlias').value    = profile.commonAlias    || '';
  $('ef-customKeywords').value = (profile.customKeywords || []).join(', ');
}

function showManageSection(section) {
  $('manage-view').style.display = section === 'manage' ? '' : 'none';
  $('edit-view').style.display   = section === 'edit'   ? '' : 'none';
}

async function initManage() {
  $('manage-view').style.display = '';
  showManageSection('manage');

  const [profile, meta] = await Promise.all([getProfile(), getDictMeta()]);
  renderManageView(profile, meta);

  // ── Edit ──
  $('edit-profile-btn').addEventListener('click', () => {
    populateEditForm(profile);
    showManageSection('edit');
  });
  $('edit-cancel-btn').addEventListener('click', () => showManageSection('manage'));

  $('edit-save-btn').addEventListener('click', async () => {
    const updated = collectEditForm();
    await saveProfile(updated);
    showToast('Profile saved — regenerating attack dictionary…');

    // Trigger regen in regen section
    $('manage-view').style.display = '';
    $('edit-view').style.display   = 'none';

    triggerRegen(updated);
  });

  // ── Regen ──
  $('regen-btn').addEventListener('click', async () => {
    const p = await getProfile();
    if (p) triggerRegen(p);
  });

  // ── Export ──
  $('export-btn').addEventListener('click', async () => {
    const json = await exportProfile();
    if (!json) { showToast('No profile to export', 'error'); return; }
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'vaultzero-profile.json', saveAs: true }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
    showToast('Profile exported');
  });

  // ── Delete ──
  $('delete-btn').addEventListener('click', () => {
    $('delete-modal').classList.add('active');
  });
  $('delete-cancel').addEventListener('click', () => {
    $('delete-modal').classList.remove('active');
  });
  $('delete-confirm').addEventListener('click', async () => {
    await deleteProfile();
    chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED' }).catch(() => {});
    showToast('Profile deleted');
    $('delete-modal').classList.remove('active');
    setTimeout(() => window.location.reload(), 1200);
  });
}

function triggerRegen(profile) {
  const regenBtn  = $('regen-btn');
  const regenProg = $('regen-progress');
  regenBtn.classList.add('loading');
  regenProg.style.display = '';

  spawnWorker(
    profile,
    (pct) => {
      $('regen-progress-fill').style.width  = `${pct}%`;
      $('regen-progress-pct').textContent   = `${pct}%`;
    },
    async (dictSize) => {
      regenBtn.classList.remove('loading');
      regenProg.style.display = 'none';
      $('mgmt-dict-size').textContent = formatNumber(dictSize);
      $('mgmt-dict-date').textContent = formatDate(Date.now());
      $('dict-has-data').style.display = '';
      $('dict-no-data').style.display  = 'none';
      $('stale-warning').style.display = 'none';
      showToast(`Attack profile updated — ${formatNumber(dictSize)} candidates`);
      chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED' }).catch(() => {});
    },
    (errMsg) => {
      regenBtn.classList.remove('loading');
      regenProg.style.display = 'none';
      showToast('Regeneration failed: ' + errMsg, 'error');
    }
  );
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const isSetup   = window.location.hash === '#setup';
  const profile   = await getProfile();
  const hasProfile = profile !== null;

  if (isSetup || !hasProfile) {
    // Show wizard
    initWizard();
  } else {
    // Show management view
    initManage();
  }
}

init().catch(console.error);
