/**
 * popup.js — VaultZero v2 Popup Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates all three popup tabs:
 *   Tab 1 – Analyze:  Full 7-module analysis pipeline + personal risk row
 *   Tab 2 – Generate: Cryptographically secure password generator
 *                     with optional profile-aware validation
 *   Tab 3 – Profile:  Read-only profile summary + dict stats + actions
 *                     (no longer a manual form — that lives in profile.html)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { analyseStrength, entropyLabel } from '../modules/strength.js';
import { detectPatterns }                from '../modules/patterns.js';
import { checkWordlist }                 from '../modules/wordlist.js';
import { checkUsername }                 from '../modules/username.js';
import { estimateCrackTimes }            from '../modules/bruteforce.js';
import { computeScore, CATEGORIES }      from '../modules/scorer.js';
import { generateSuggestions }           from '../modules/suggestions.js';
import { generatePassword }              from '../modules/generator.js';
import { warmCache, lookup, invalidate, isReady } from '../modules/dictCache.js';
import { getProfile, getDictMeta, getHistory, addToHistory } from '../modules/profileStore.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const RING_R = 50;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; // ≈ 314.16

const BREAKDOWN_MAX = {
  length: 25, variety: 20, entropy: 20,
  wordlist: 15, patterns: 10, username: 10,
};
const BREAKDOWN_LABELS = {
  length: 'Length', variety: 'Variety', entropy: 'Entropy',
  wordlist: 'Wordlist', patterns: 'Patterns', username: 'Username',
};

const PROFILE_FIELDS = [
  'firstName','lastName','nickname','username','dateOfBirth',
  'partnerName','petName','companyName','favoriteNumber',
  'sportsTeam','gamerTag','commonAlias','customKeywords',
];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Tabs
const tabBtns   = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// Analyze
const passwordInput  = $('popup-password');
const usernameInput  = $('popup-username');
const toggleVisBtn   = $('toggle-vis');
const copyBtn        = $('copy-btn');
const fromPageRow    = $('from-page-row');
const usePagePwBtn   = $('use-page-pw');
const emptyState     = $('empty-state');
const resultsEl      = $('results');

// Score
const ringFill       = $('ring-fill');
const scoreNumber    = $('score-number');
const scoreLabel     = $('score-label');
const strengthFill   = $('strength-fill');
const strengthLabel  = $('strength-label');

// Stats
const statEntropy    = $('stat-entropy');
const statLength     = $('stat-length');
const statCharset    = $('stat-charset');
const statVariety    = $('stat-variety');

// Char chips
const indLower   = $('ind-lower');
const indUpper   = $('ind-upper');
const indDigit   = $('ind-digit');
const indSymbol  = $('ind-symbol');

// Panels
const issuesPanel   = $('issues-panel');
const issuesList    = $('issues-list');
const breakdownList = $('breakdown-list');
const crackBody     = $('crack-body');
const suggList      = $('suggestions-list');

// Personal risk row (Tab 1)
const personalRiskRow   = $('personal-risk-row');
const personalRiskBadge = $('personal-risk-badge');

// Generator
const modeBtns        = document.querySelectorAll('.mode-btn');
const genOutput       = $('gen-output');
const genCopyBtn      = $('gen-copy');
const genUseBtn       = $('gen-use');
const genLengthSlider = $('gen-length');
const genLengthDisp   = $('gen-length-display');
const genLower        = $('gen-lower');
const genUpper        = $('gen-upper');
const genDigits       = $('gen-digits');
const genSymbols      = $('gen-symbols');
const genBtn          = $('gen-btn');
const genOptions      = $('gen-options');
const genAnalysis     = $('gen-analysis');
const genMiniBar      = $('gen-mini-bar');
const genMiniLabel    = $('gen-mini-label');
const genProfileCheck = $('gen-profile-check');
const genRejectToggle = $('gen-reject-personal');
const genPersonalBadge = $('gen-personal-badge');

// Profile tab (Tab 3)
const ppNoProfile = $('pp-no-profile');
const ppProfile   = $('pp-profile');
const ppAvatar    = $('pp-avatar');
const ppName      = $('pp-name');
const ppMeta      = $('pp-meta');
const ppDictSize  = $('pp-dict-size');
const ppDictDate  = $('pp-dict-date');
const ppDictCard  = $('pp-dict-card');
const ppDictNoData = $('pp-dict-no-data');
const ppLastAnalysis = $('pp-last-analysis');
const ppLastPw    = $('pp-last-pw');
const ppLastRisk  = $('pp-last-risk');
const ppLastRank  = $('pp-last-rank');

// ── State ─────────────────────────────────────────────────────────────────────
let passwordVisible = false;
let debounceTimer   = null;
let currentMode     = 'secure';
let profileData     = null;
let dictMeta        = null;
let dictCacheReady  = false;

// ── Init: load profile + dict meta + warm cache ───────────────────────────────
(async function init() {
  [profileData, dictMeta] = await Promise.all([getProfile(), getDictMeta()]);

  // Warm the cache (idempotent, fast if already warm)
  if (dictMeta && dictMeta.size > 0) {
    warmCache().then(() => {
      dictCacheReady = true;
      // Re-run analysis to show personal risk if password already typed
      if (passwordInput.value.length > 0) analyse();
    });
  }

  // Show profile-aware generator option
  if (profileData && dictMeta) {
    genProfileCheck.style.display = '';
  }

  // Init popup from current page's password field
  initFromPage();
})();

// Listen for profile changes from other pages
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DICT_UPDATED') {
    invalidate();
    dictCacheReady = false;
    // Reload state
    Promise.all([getProfile(), getDictMeta()]).then(([p, m]) => {
      profileData = p;
      dictMeta = m;
      if (m && m.size > 0) {
        warmCache().then(() => { dictCacheReady = true; if (passwordInput.value) analyse(); });
      }
      if (document.querySelector('[data-tab="personal"]')?.classList.contains('active')) {
        renderProfileTab();
      }
    });
  }
});

// ── Tab switching ─────────────────────────────────────────────────────────────
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`panel-${btn.dataset.tab}`).classList.add('active');

    // Render profile tab on switch to it
    if (btn.dataset.tab === 'personal') renderProfileTab();
  });
});

// ── On popup open: try to read password from the active tab ───────────────────
async function initFromPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PASSWORD' });
    if (response?.password) {
      fromPageRow.style.display = 'flex';
      usePagePwBtn.addEventListener('click', () => {
        passwordInput.value = response.password;
        if (response.username) usernameInput.value = response.username;
        fromPageRow.style.display = 'none';
        analyse();
      });
    }
  } catch (_) {
    // Page doesn't have content script (e.g., chrome:// pages)
  }
}

// ── Analyse pipeline ──────────────────────────────────────────────────────────
function analyse() {
  const password = passwordInput.value;
  const username = usernameInput.value.trim();

  if (password.length === 0) {
    emptyState.style.display = '';
    resultsEl.style.display  = 'none';
    personalRiskRow.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  resultsEl.style.display  = '';

  // Run modules
  const strength    = analyseStrength(password);
  const patterns    = detectPatterns(password);
  const wordlist    = checkWordlist(password);
  const ucheck      = checkUsername(password, username);
  const personalResult = dictCacheReady && isReady() ? lookup(password) : { found: false, rank: null };
  
  const scoreRes    = computeScore(strength, wordlist, patterns, ucheck, personalResult);
  const crackTimes  = estimateCrackTimes(strength.charsetSize, strength.length);
  const suggestions = generateSuggestions(strength, wordlist, patterns, ucheck, scoreRes);

  renderScore(scoreRes);
  renderStats(strength);
  renderCharIndicators(strength);
  renderIssues(strength, wordlist, patterns, ucheck);
  renderBreakdown(scoreRes.breakdown);
  renderCrackTimes(crackTimes);
  renderSuggestions(suggestions);
  renderPersonalRisk(password);

  // Record in history (fire-and-forget; non-blocking)
  if (password.length >= 4) {
    addToHistory({
      password,
      score:         scoreRes.score,
      risk:          scoreRes.category,
      personalScore: null,
      personalRisk:  personalResult.found ? (
        personalResult.rank <= 100  ? 'Critical' :
        personalResult.rank <= 1000 ? 'High'     :
        personalResult.rank <= 5000 ? 'Medium'   : 'Low'
      ) : 'Resistant',
      rank:  personalResult.rank,
      found: personalResult.found,
      ts:    Date.now(),
    }).catch(() => {});
  }
}

// ── Personal risk row (Tab 1) ─────────────────────────────────────────────────
function renderPersonalRisk(password) {
  if (!dictCacheReady || !isReady()) {
    personalRiskRow.style.display = 'none';
    return;
  }

  const { found, rank } = lookup(password);
  personalRiskRow.style.display = '';

  let badgeText, badgeClass;
  if (found) {
    if      (rank <= 100)  { badgeText = `🔴 Critical  (#${rank})`;  badgeClass = 'pr-critical'; }
    else if (rank <= 1000) { badgeText = `🟠 High  (#${rank})`;      badgeClass = 'pr-high'; }
    else if (rank <= 5000) { badgeText = `🟡 Medium  (#${rank})`;    badgeClass = 'pr-medium'; }
    else                   { badgeText = `🟡 Low  (#${rank})`;       badgeClass = 'pr-low'; }
  } else {
    badgeText  = '🟢 Resistant';
    badgeClass = 'pr-safe';
  }

  personalRiskBadge.textContent = badgeText;
  personalRiskBadge.className   = `personal-risk-badge ${badgeClass}`;
}

// ── Score ring ────────────────────────────────────────────────────────────────
function renderScore(scoreRes) {
  const { score, category, color, cssClass } = scoreRes;

  scoreNumber.textContent = score;
  scoreLabel.textContent  = category;
  scoreLabel.style.color  = color;
  scoreNumber.style.color = color;

  const offset = RING_CIRCUMFERENCE * (1 - score / 100);
  ringFill.style.strokeDashoffset = offset;
  ringFill.style.stroke           = color;

  strengthFill.style.width      = `${score}%`;
  strengthFill.style.background = color;
  strengthLabel.textContent     = category;
  strengthLabel.className       = `strength-label ${cssClass}`;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function renderStats(strength) {
  statEntropy.textContent = `${strength.entropy} bits`;
  statLength.textContent  = strength.length;
  statCharset.textContent = strength.charsetSize;
  statVariety.textContent = `${strength.varietyCount}/4`;
}

// ── Char indicators ───────────────────────────────────────────────────────────
function renderCharIndicators(strength) {
  const setChip = (el, active) => {
    el.classList.toggle('active',   active);
    el.classList.toggle('inactive', !active);
  };
  setChip(indLower,  strength.hasLower);
  setChip(indUpper,  strength.hasUpper);
  setChip(indDigit,  strength.hasDigit);
  setChip(indSymbol, strength.hasSymbol);
}

// ── Issues ────────────────────────────────────────────────────────────────────
function renderIssues(strength, wordlist, patterns, ucheck) {
  const issues = [];
  if (strength.length < 8)       issues.push({ sev: 'high',   text: 'Password is too short (< 8 characters)' });
  if (wordlist.exactMatch)       issues.push({ sev: 'high',   text: 'Found in common password list' });
  if (wordlist.leetMatch)        issues.push({ sev: 'high',   text: 'Leet-speak form is a common password' });
  if (ucheck.contains)           issues.push({ sev: 'high',   text: 'Password contains your username' });
  if (ucheck.variation)          issues.push({ sev: 'high',   text: 'Password is a username variation' });
  if (ucheck.nearMatch)          issues.push({ sev: 'medium', text: 'Password is very similar to username' });
  if (ucheck.reversed)           issues.push({ sev: 'medium', text: 'Contains reversed username' });
  if (patterns.keyboard.found)   issues.push({ sev: 'high',   text: `Keyboard walk: "${patterns.keyboard.matches[0]}"` });
  if (patterns.sequential.found) issues.push({ sev: 'medium', text: `Sequential run: "${patterns.sequential.matches[0]}"` });
  if (patterns.repeats.found)    issues.push({ sev: 'medium', text: `Repeated chars: "${patterns.repeats.matches[0]}"` });
  if (patterns.dates.found)      issues.push({ sev: 'low',    text: `Date-like pattern: "${patterns.dates.matches[0]}"` });
  if (wordlist.substringMatches.length > 0) {
    issues.push({ sev: 'medium', text: `Contains common words: "${wordlist.substringMatches.slice(0, 2).join('", "')}"` });
  }
  if (!strength.hasUpper)  issues.push({ sev: 'low', text: 'No uppercase letters' });
  if (!strength.hasLower)  issues.push({ sev: 'low', text: 'No lowercase letters' });
  if (!strength.hasDigit)  issues.push({ sev: 'low', text: 'No numbers' });
  if (!strength.hasSymbol) issues.push({ sev: 'low', text: 'No special characters' });

  issuesPanel.style.display = issues.length ? '' : 'none';
  issuesList.innerHTML = issues.map(i =>
    `<li class="issue-item ${i.sev}">
       <span class="issue-dot"></span>
       <span>${i.text}</span>
     </li>`
  ).join('');
}

// ── Breakdown bars ────────────────────────────────────────────────────────────
function renderBreakdown(breakdown) {
  breakdownList.innerHTML = Object.entries(breakdown).map(([key, val]) => {
    const max = BREAKDOWN_MAX[key];
    const pct = Math.round((val / max) * 100);
    const hue = Math.round(pct * 1.2);
    return `
      <div class="breakdown-row">
        <span class="breakdown-label">${BREAKDOWN_LABELS[key]}</span>
        <div class="breakdown-track">
          <div class="breakdown-fill" style="width:${pct}%;background:hsl(${hue},70%,50%)"></div>
        </div>
        <span class="breakdown-pts">${val}/${max}</span>
      </div>`;
  }).join('');
}

// ── Crack times ───────────────────────────────────────────────────────────────
function renderCrackTimes(crackTimes) {
  crackBody.innerHTML = crackTimes.map(ct => `
    <tr>
      <td>
        <div class="scenario-name">${ct.label}</div>
        <div class="scenario-desc">${ct.desc}</div>
      </td>
      <td class="crack-time crack-${ct.severity}">${ct.display}</td>
    </tr>`
  ).join('');
}

// ── Suggestions ───────────────────────────────────────────────────────────────
function renderSuggestions(suggestions) {
  suggList.innerHTML = suggestions.map((s, i) => `
    <div class="suggestion-card ${s.priority}" style="animation-delay:${i * 50}ms">
      <span class="suggestion-tag">${s.icon}</span>
      <span class="suggestion-text">${s.text}</span>
    </div>`
  ).join('');
}

// ── Input event listeners ─────────────────────────────────────────────────────
passwordInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(analyse, 120);
});

usernameInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(analyse, 200);
});

toggleVisBtn.addEventListener('click', () => {
  passwordVisible = !passwordVisible;
  passwordInput.type = passwordVisible ? 'text' : 'password';
  toggleVisBtn.title = passwordVisible ? 'Hide password' : 'Show password';
});

copyBtn.addEventListener('click', () => {
  if (passwordInput.value) {
    navigator.clipboard.writeText(passwordInput.value)
      .then(() => flashButton(copyBtn, 'Copied'));
  }
});

// ── Generator ─────────────────────────────────────────────────────────────────
const PASSPHRASES = [
  ['coral','orbit','maple','seven'],['signal','frost','ember','quick'],
  ['noble','storm','lunar','brave'],['cobalt','river','prism','echo'],
  ['sonic','flash','delta','tiger'],['amber','cloud','nexus','flame'],
];

function getPassphrase() {
  const words = PASSPHRASES[Math.floor(Math.random() * PASSPHRASES.length)];
  return words.join('-');
}

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    genOptions.style.display = currentMode === 'secure' ? '' : 'none';
  });
});

genLengthSlider.addEventListener('input', () => {
  genLengthDisp.textContent = genLengthSlider.value;
});

genBtn.addEventListener('click', runGenerator);

function runGenerator() {
  try {
    let pw;
    const rejectPersonal = genRejectToggle?.checked && dictCacheReady && isReady();
    let attempts = 0;

    do {
      attempts++;
      if (currentMode === 'passphrase') {
        pw = getPassphrase();
      } else if (currentMode === 'memorable') {
        pw = generatePassword({ length: 16, lowercase: true, uppercase: true, digits: true, symbols: false });
      } else {
        pw = generatePassword({
          length:    parseInt(genLengthSlider.value, 10),
          lowercase: genLower.checked,
          uppercase: genUpper.checked,
          digits:    genDigits.checked,
          symbols:   genSymbols.checked,
        });
      }
    } while (rejectPersonal && lookup(pw).found && attempts < 20);

    genOutput.textContent = pw;

    // Quick quality check
    const str = analyseStrength(pw);
    const pat = detectPatterns(pw);
    const wl  = checkWordlist(pw);
    const uc  = checkUsername(pw, '');
    const sc  = computeScore(str, wl, pat, uc);

    genMiniBar.style.width      = `${sc.score}%`;
    genMiniBar.style.background = sc.color;
    genMiniLabel.textContent    = `${sc.category} (${sc.score}/100)`;
    genMiniLabel.style.color    = sc.color;
    genAnalysis.style.display   = '';

    // Profile-aware badge
    if (rejectPersonal && genPersonalBadge) {
      const { found } = lookup(pw);
      genPersonalBadge.textContent  = found ? '⚠ In attack profile' : '✓ Not in attack profile';
      genPersonalBadge.style.color  = found ? '#fca5a5' : '#86efac';
      genPersonalBadge.style.display = '';
    }

  } catch (e) {
    genOutput.innerHTML = `<span style="color:var(--accent-red);font-family:var(--font-main);font-size:12px;">${e.message}</span>`;
  }
}

genCopyBtn.addEventListener('click', () => {
  const pw = genOutput.textContent.trim();
  if (pw && !pw.startsWith('Error') && !pw.startsWith('Select')) {
    navigator.clipboard.writeText(pw).then(() => flashButton(genCopyBtn, 'Copied'));
  }
});

genUseBtn.addEventListener('click', () => {
  const pw = genOutput.textContent.trim();
  if (pw && !pw.startsWith('Error')) {
    passwordInput.value = pw;
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="analyze"]').classList.add('active');
    $('panel-analyze').classList.add('active');
    analyse();
  }
});

// ── Profile Tab (Tab 3) ───────────────────────────────────────────────────────

async function renderProfileTab() {
  // Refresh from storage in case profile was updated in another tab
  [profileData, dictMeta] = await Promise.all([getProfile(), getDictMeta()]);

  if (!profileData) {
    ppNoProfile.style.display = '';
    ppProfile.style.display   = 'none';
    return;
  }

  ppNoProfile.style.display = 'none';
  ppProfile.style.display   = '';

  // Avatar initials
  const first = profileData.firstName?.trim() || '';
  const last  = profileData.lastName?.trim()  || '';
  ppAvatar.textContent = ((first[0] || '') + (last[0] || '')).toUpperCase() || '?';

  // Name
  const displayName = [first, last].filter(Boolean).join(' ') || profileData.nickname || profileData.username || 'Anonymous';
  ppName.textContent = displayName;

  // Field completion count
  const filledCount = PROFILE_FIELDS.filter(k => {
    const v = profileData[k];
    if (!v) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim().length > 0;
  }).length;
  const lastUpdated = profileData.updatedAt
    ? new Date(profileData.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  ppMeta.textContent = `${filledCount}/${PROFILE_FIELDS.length} fields · Updated ${lastUpdated}`;

  // Dict stats
  if (dictMeta && dictMeta.size > 0) {
    ppDictSize.textContent = dictMeta.size.toLocaleString();
    ppDictDate.textContent = new Date(dictMeta.generatedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    ppDictCard.style.display    = '';
    ppDictNoData.style.display  = 'none';
  } else {
    ppDictSize.textContent = '0';
    ppDictDate.textContent = '—';
    ppDictNoData.style.display = '';
  }

  // Last analysis result
  const history = await getHistory();
  if (history.length > 0) {
    const last = history[0];
    ppLastPw.textContent   = last.password;
    ppLastRisk.textContent = last.risk || '—';
    ppLastRisk.style.color = riskColor(last.risk);
    ppLastRank.textContent = last.found && last.rank !== null ? `#${last.rank.toLocaleString()}` : 'Not in dict';
    ppLastAnalysis.style.display = '';
  } else {
    ppLastAnalysis.style.display = 'none';
  }
}

function riskColor(risk) {
  const r = (risk || '').toLowerCase();
  if (r.includes('critical')) return '#fca5a5';
  if (r.includes('high'))     return '#fcd34d';
  if (r.includes('medium'))   return '#fde68a';
  if (r.includes('low'))      return '#93c5fd';
  return '#86efac';
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function flashButton(btn, tempText) {
  const orig = btn.textContent;
  btn.textContent = tempText;
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
runGenerator();
