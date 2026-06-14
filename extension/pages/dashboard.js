/**
 * dashboard.js — VaultZero Security Dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads profile, dict meta, and analysis history from chrome.storage.local
 * and renders the Security Dashboard UI.
 *
 * Responsibilities:
 *   • Hero stat cards (profile status, dict size, last generated, last analysis)
 *   • Profile details section (avatar, completion bar, field grid)
 *   • Dictionary status section (size, chunks, generated date)
 *   • Analysis history table (last 5, masked passwords)
 *
 * All data is read-only here — edits happen in profile.html.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getProfile, getDictMeta, getHistory } from '../modules/profileStore.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Hero cards
const hcProfileVal  = $('hc-profile-val');
const hcProfileSub  = $('hc-profile-sub');
const hcProfileBadge= $('hc-profile-badge');
const hcDictVal     = $('hc-dict-val');
const hcDictSub     = $('hc-dict-sub');
const hcDictBadge   = $('hc-dict-badge');
const hcDateVal     = $('hc-date-val');
const hcDateSub     = $('hc-date-sub');
const hcScoreVal    = $('hc-score-val');
const hcScoreSub    = $('hc-score-sub');
const hcScoreRisk   = $('hc-score-risk');

// Profile section
const noProfileBlock   = $('no-profile-block');
const profileBlock     = $('profile-block');
const profileAvatar    = $('profile-avatar');
const profileName      = $('profile-name');
const completionFill   = $('completion-fill');
const completionLabel  = $('completion-label');
const profileDates     = $('profile-dates');
const profileFieldsGrid= $('profile-fields-grid');

// Dict section
const dictStatusRow = $('dict-status-row');

// History section
const historyEmpty     = $('history-empty');
const historyTableWrap = $('history-table-wrap');
const historyTbody     = $('history-tbody');

// ── Profile field definitions ─────────────────────────────────────────────────
const PROFILE_FIELD_DEFS = [
  { key: 'firstName',      label: 'First Name' },
  { key: 'lastName',       label: 'Last Name' },
  { key: 'nickname',       label: 'Nickname' },
  { key: 'username',       label: 'Username' },
  { key: 'dateOfBirth',    label: 'Date of Birth' },
  { key: 'partnerName',    label: 'Partner Name' },
  { key: 'petName',        label: 'Pet Name' },
  { key: 'companyName',    label: 'Company' },
  { key: 'favoriteNumber', label: 'Fav. Number' },
  { key: 'sportsTeam',     label: 'Sports Team' },
  { key: 'gamerTag',       label: 'Gamer Tag' },
  { key: 'commonAlias',    label: 'Common Alias' },
  { key: 'customKeywords', label: 'Custom Keywords' },
];

// ── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
  const [profile, meta, history] = await Promise.all([
    getProfile(),
    getDictMeta(),
    getHistory(),
  ]);

  renderHeroCards(profile, meta, history);
  renderProfileSection(profile);
  renderDictSection(meta, profile);
  renderHistorySection(history);
})();

// Listen for dict/profile updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DICT_UPDATED') {
    // Soft refresh
    Promise.all([getProfile(), getDictMeta(), getHistory()]).then(([p, m, h]) => {
      renderHeroCards(p, m, h);
      renderProfileSection(p);
      renderDictSection(m, p);
      renderHistorySection(h);
    });
  }
});

// ── Hero Cards ────────────────────────────────────────────────────────────────
function renderHeroCards(profile, meta, history) {
  // 1. Profile status
  if (profile) {
    const filled = countFilledFields(profile);
    hcProfileVal.textContent = `${filled}/${PROFILE_FIELD_DEFS.length}`;
    hcProfileSub.textContent = 'fields configured';
    hcProfileBadge.textContent = 'Active';
    hcProfileBadge.className   = 'hero-card-badge badge-active';
  } else {
    hcProfileVal.textContent = 'None';
    hcProfileSub.textContent = 'not configured';
    hcProfileBadge.textContent = 'Setup Required';
    hcProfileBadge.className   = 'hero-card-badge badge-inactive';
  }

  // 2. Dict size
  if (meta && meta.size > 0) {
    hcDictVal.textContent  = meta.size.toLocaleString();
    hcDictSub.textContent  = 'attack candidates';
    hcDictBadge.textContent = 'Ready';
    hcDictBadge.className   = 'hero-card-badge badge-ready';
  } else {
    hcDictVal.textContent  = '0';
    hcDictSub.textContent  = 'no dictionary yet';
    hcDictBadge.textContent = 'Not Built';
    hcDictBadge.className   = 'hero-card-badge badge-missing';
  }

  // 3. Last generated date
  if (meta && meta.generatedAt) {
    const d = new Date(meta.generatedAt);
    hcDateVal.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    hcDateSub.textContent = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } else {
    hcDateVal.textContent = '—';
    hcDateSub.textContent = 'Never generated';
  }

  // 4. Last analysis
  if (history.length > 0) {
    const last = history[0];
    hcScoreVal.textContent = last.score !== undefined ? `${last.score}/100` : '—';
    hcScoreSub.textContent = timeAgo(last.ts);
    if (last.risk) {
      const cls = riskClass(last.risk);
      hcScoreRisk.textContent = last.risk;
      hcScoreRisk.className   = `hero-card-risk risk-chip ${cls}`;
    }
  } else {
    hcScoreVal.textContent = '—';
    hcScoreSub.textContent = 'No history yet';
  }
}

// ── Profile Section ───────────────────────────────────────────────────────────
function renderProfileSection(profile) {
  if (!profile) {
    noProfileBlock.style.display = '';
    profileBlock.style.display   = 'none';
    return;
  }

  noProfileBlock.style.display = 'none';
  profileBlock.style.display   = '';

  // Avatar initials
  const first = profile.firstName?.trim() || '';
  const last  = profile.lastName?.trim()  || '';
  profileAvatar.textContent = ((first[0] || '') + (last[0] || '')).toUpperCase() || '?';

  // Name
  const displayName = [first, last].filter(Boolean).join(' ')
    || profile.nickname || profile.username || 'Anonymous';
  profileName.textContent = displayName;

  // Completion bar
  const filled = countFilledFields(profile);
  const pct    = Math.round((filled / PROFILE_FIELD_DEFS.length) * 100);
  completionFill.style.width   = `${pct}%`;
  completionLabel.textContent  = `${filled}/${PROFILE_FIELD_DEFS.length} fields`;

  // Dates
  const created = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const updated = profile.updatedAt ? new Date(profile.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  profileDates.innerHTML = `
    <div class="profile-date-item"><span class="profile-date-key">Created:</span> ${created}</div>
    <div class="profile-date-item"><span class="profile-date-key">Updated:</span> ${updated}</div>
  `;

  // Fields grid
  profileFieldsGrid.innerHTML = PROFILE_FIELD_DEFS.map(def => {
    const raw = profile[def.key];
    let val = '';
    if (Array.isArray(raw)) val = raw.filter(Boolean).join(', ');
    else if (raw) val = String(raw).trim();
    const filled = val.length > 0;
    return `
      <div class="profile-field-item ${filled ? 'filled' : ''}">
        <span class="profile-field-key">${def.label}</span>
        ${filled
          ? `<span class="profile-field-val" title="${esc(val)}">${esc(val)}</span>`
          : `<span class="profile-field-empty">not set</span>`
        }
      </div>`;
  }).join('');
}

// ── Dictionary Section ────────────────────────────────────────────────────────
function renderDictSection(meta, profile) {
  if (!meta || meta.size === 0) {
    dictStatusRow.innerHTML = `
      <div class="dict-no-dict">
        <p>${profile ? 'Your profile is ready but the attack dictionary hasn\'t been generated yet.' : 'Set up your profile first, then generate the attack dictionary.'}</p>
        <a href="../pages/profile.html" class="setup-btn" style="font-size:13px;padding:10px 22px;">
          ${profile ? 'Generate Dictionary →' : 'Set Up Profile →'}
        </a>
      </div>`;
    return;
  }

  const generatedDate = meta.generatedAt
    ? new Date(meta.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  dictStatusRow.innerHTML = `
    <div class="dict-stat">
      <span class="dict-stat-val">${meta.size.toLocaleString()}</span>
      <span class="dict-stat-key">Total Candidates</span>
      <span class="dict-stat-sub">CUPP-style personal entries</span>
    </div>
    <div class="dict-stat">
      <span class="dict-stat-val">${meta.chunks || '—'}</span>
      <span class="dict-stat-key">Storage Chunks</span>
      <span class="dict-stat-sub">~${Math.round(meta.size / (meta.chunks || 1)).toLocaleString()} entries each</span>
    </div>
    <div class="dict-stat">
      <span class="dict-stat-val" style="font-size:16px;font-weight:700">${generatedDate}</span>
      <span class="dict-stat-key">Generated</span>
      <span class="dict-stat-sub">v${meta.version || '2.0'}</span>
    </div>
  `;
}

// ── History Section ───────────────────────────────────────────────────────────
function renderHistorySection(history) {
  if (!history || history.length === 0) {
    historyEmpty.style.display     = '';
    historyTableWrap.style.display = 'none';
    return;
  }

  historyEmpty.style.display     = 'none';
  historyTableWrap.style.display = '';

  historyTbody.innerHTML = history.map((entry, i) => {
    const scoreClass = scoreLevel(entry.score);
    const gRiskCls   = riskClass(entry.risk || '');
    const pRiskCls   = entry.found !== undefined
      ? (entry.found ? riskClass(entry.personalRisk || 'high') : 'risk-resistant')
      : 'risk-none';
    const rank  = entry.found && entry.rank !== null ? `#${Number(entry.rank).toLocaleString()}` : '—';
    const ts    = timeAgo(entry.ts);
    const pRiskLabel = entry.found !== undefined
      ? (entry.found ? (entry.personalRisk || 'Found') : 'Resistant')
      : '—';

    return `
      <tr style="animation-delay:${i * 60}ms">
        <td><span class="hist-pw">${esc(entry.password || '***')}</span></td>
        <td><span class="hist-score ${scoreClass}">${entry.score !== undefined ? entry.score : '—'}</span></td>
        <td><span class="risk-chip ${gRiskCls}">${esc(entry.risk || '—')}</span></td>
        <td><span class="risk-chip ${pRiskCls}">${pRiskLabel}</span></td>
        <td><span class="hist-rank">${rank}</span></td>
        <td><span class="hist-time">${ts}</span></td>
      </tr>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function countFilledFields(profile) {
  return PROFILE_FIELD_DEFS.filter(def => {
    const v = profile[def.key];
    if (!v) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim().length > 0;
  }).length;
}

function riskClass(risk) {
  const r = (risk || '').toLowerCase();
  if (r.includes('critical'))  return 'risk-critical';
  if (r.includes('high'))      return 'risk-high';
  if (r.includes('medium'))    return 'risk-medium';
  if (r.includes('low'))       return 'risk-low';
  if (r.includes('resistant') || r.includes('safe')) return 'risk-safe';
  return 'risk-none';
}

function scoreLevel(score) {
  if (score === undefined || score === null) return '';
  if (score < 25)  return 'score-critical';
  if (score < 50)  return 'score-high';
  if (score < 75)  return 'score-medium';
  return 'score-safe';
}

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
