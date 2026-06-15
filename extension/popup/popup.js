/**
 * popup.js  VaultZero v2 Popup Controller
 * 
 * Orchestrates all three popup tabs:
 *   Tab 1  Analyze:  Full 7-module analysis pipeline + personal risk row
 *   Tab 2  Generate: Cryptographically secure password generator
 *                     with optional profile-aware validation
 *   Tab 3  Profile:  Read-only profile summary + dict stats + actions
 *                     (no longer a manual form  that lives in profile.html)
 * 
 */

import { analyseStrength, entropyLabel } from '../modules/strength.js';
import { detectPatterns }                from '../modules/patterns.js';
import { checkWordlist }                 from '../modules/wordlist.js';
import { checkUsername }                 from '../modules/username.js';
import { estimateCrackTimes }            from '../modules/bruteforce.js';
import { computeScore, CATEGORIES }      from '../modules/scorer.js';
import { generateSuggestions }           from '../modules/suggestions.js';
import { generateSmartPassword, scoreGeneratedPassword } from '../modules/smartGenerator.js';
import { generatePersonalPassword, checkVulnerability, explainPassword,
         isProfileFilled, countFilledFields } from '../modules/personalGenerator.js';
import { warmCache, lookup, invalidate, isReady, getSize } from '../modules/dictCache.js';
import { getProfile, getDictMeta, getHistory, addToHistory } from '../modules/profileStore.js';
import { generateContextAwarePassword } from '../modules/profilePasswordGenerator.js';
import { validateGeneratedPassword } from '../modules/generatorValidator.js';

//  Constants 
const RING_R = 50;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; //  314.16

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

//  DOM refs 
const $ = (id) => document.getElementById(id);

// Tabs
const tabBtns   = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const generateTabBtn = $('tab-generate');
if (generateTabBtn) generateTabBtn.hidden = true;

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

// ── Smart Generator DOM refs ──────────────────────────────────────────────────
const sgModeBtns    = document.querySelectorAll('.sg-mode-btn');
const sgModeHint    = $('sg-mode-hint');
const sgPwField     = $('sg-pw-field');
const sgBarWrap     = $('sg-bar-wrap');
const sgBarFill     = $('sg-bar-fill');
const sgScoreRow    = $('sg-score-row');
const sgScoreNum    = $('sg-score-num');
const sgScoreCat    = $('sg-score-cat');
const sgScoreEnt    = $('sg-score-ent');
const sgCrackHint   = $('sg-crack-hint');
const sgGenBtn      = $('sg-gen-btn');
const sgRegenBtn    = $('sg-regen-btn');
const sgCopyBtn     = $('sg-copy-btn');
const sgUseBtn      = $('sg-use-btn');
const sgCustomToggle= $('sg-custom-toggle');
const sgCustomPanel = $('sg-custom-panel');
const sgCaret       = $('sg-caret');
const sgWcSlider    = $('sg-wc');
const sgWcVal       = $('sg-wc-val');
const sgSepBtns     = document.querySelectorAll('.sg-sep-btn');
const sgUseNums     = $('sg-use-nums');
const sgUseSyms     = $('sg-use-syms');
const sgCapitalize  = $('sg-capitalize');
const sgTheme       = $('sg-theme');
const sgOptWc       = $('sg-opt-wc');
const sgOptSep      = $('sg-opt-sep');
const sgOptCaps     = $('sg-opt-caps');
const sgOptTheme    = $('sg-opt-theme');

// Personalized mode new DOM refs
const sgNewPwBanner     = $('sg-newpw-banner');
const sgWarnBadge       = $('sg-warn-badge');
const sgExplainStrip    = $('sg-explain-strip');
const sgExplainStrength = $('sg-explain-strength');
const sgExplainPersonal = $('sg-explain-personal');
const sgExplainReason   = $('sg-explain-reason');

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

//  State 
let passwordVisible = false;
let debounceTimer   = null;
let sgCurrentMode   = 'smartMemorable';
let sgSeparator     = '';
let sgLiveDebounce  = null;
let profileData     = null;
let dictMeta        = null;
let dictCacheReady  = false;
let activePasswordContext = null;
let activeWebsiteContext = null;

// Mode metadata
const SG_MODES = {
  smartMemorable: { hint: 'Title-cased words + number — easy to type, hard to crack',      showWc: true,  showSep: true,  showCaps: true,  showTheme: true  },
  passphrase:     { hint: 'Lowercase words joined by separator — high entropy through length', showWc: true,  showSep: true,  showCaps: false, showTheme: false },
  maxSecurity:    { hint: 'Cryptographically random characters — maximum entropy',            showWc: false, showSep: false, showCaps: false, showTheme: false },
  personalSecure: { hint: 'Memory anchors from your profile — memorable to you, opaque to attackers', showWc: true, showSep: false, showCaps: true, showTheme: false },
};

//  Init: load profile + dict meta + warm cache 
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

//  Tab switching 
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

//  On popup open: try to read password from the active tab 
async function initFromPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Check password field + new-password context in parallel
    const [pwResponse, ctxResponse] = await Promise.allSettled([
      chrome.tabs.sendMessage(tab.id, { type: 'GET_PASSWORD' }),
      chrome.tabs.sendMessage(tab.id, { type: 'GET_PASSWORD_CONTEXT' }),
    ]);

    // Import password if available
    const pwData = pwResponse.status === 'fulfilled' ? pwResponse.value : null;
    if (pwData?.password) {
      fromPageRow.style.display = 'flex';
      usePagePwBtn.addEventListener('click', () => {
        passwordInput.value = pwData.password;
        if (pwData.username) usernameInput.value = pwData.username;
        fromPageRow.style.display = 'none';
        analyse();
      });
    }

    // Handle account-creation/password-change context.
    const ctx = ctxResponse.status === 'fulfilled' ? ctxResponse.value : null;
    activePasswordContext = ctx;
    activeWebsiteContext = ctx?.websiteContext || null;
    if (ctx?.eligible || ctx?.isNewPassword) {
      if (generateTabBtn) generateTabBtn.hidden = false;
      const modeBar = document.querySelector('.sg-modes');
      if (modeBar) modeBar.style.display = 'none';
      if (sgModeHint) {
        const brand = activeWebsiteContext?.brand || ctx.url || 'this site';
        sgModeHint.textContent = `Personalized, validated, and unique for ${brand}`;
      }
      // Switch to Generate tab
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      const genTabBtn = document.querySelector('[data-tab="generate"]');
      if (genTabBtn) genTabBtn.classList.add('active');
      $('panel-generate').classList.add('active');

      // Show the new-password banner
      if (sgNewPwBanner) {
        const workflow = ctx.type === 'password-change' ? 'Password change' : 'Account creation';
        const brand = activeWebsiteContext?.brand || ctx.url || 'this site';
        sgNewPwBanner.textContent = `${workflow} detected for ${brand}`;
        sgNewPwBanner.hidden = false;
      }

      // If profile is filled, auto-select Personalized mode
      const mappedProfile = mapProfileToGenerator(profileData);
      if (profileData && isProfileFilled(mappedProfile)) {
        sgModeBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        const personalBtn = $('sg-mode-personal');
        if (personalBtn) { personalBtn.classList.add('active'); personalBtn.setAttribute('aria-selected', 'true'); }
        sgCurrentMode = 'personalSecure';
        sgUpdateModeUI('personalSecure');
      }
      sgGenerate();
    } else {
      if (generateTabBtn) generateTabBtn.hidden = true;
      if (sgNewPwBanner) sgNewPwBanner.hidden = true;
    }
  } catch (_) {
    // Page doesn't have content script (e.g., chrome:// pages)
  }
}

//  Analyse pipeline 
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

//  Personal risk row (Tab 1) 
function renderPersonalRisk(password) {
  if (!dictCacheReady || !isReady()) {
    personalRiskRow.style.display = 'none';
    return;
  }

  const { found, rank } = lookup(password);
  personalRiskRow.style.display = '';

  let badgeText, badgeClass;
  if (found) {
    if      (rank <= 100)  { badgeText = ` Critical  (#${rank})`;  badgeClass = 'pr-critical'; }
    else if (rank <= 1000) { badgeText = ` High  (#${rank})`;      badgeClass = 'pr-high'; }
    else if (rank <= 5000) { badgeText = ` Medium  (#${rank})`;    badgeClass = 'pr-medium'; }
    else                   { badgeText = ` Low  (#${rank})`;       badgeClass = 'pr-low'; }
  } else {
    badgeText  = ' Resistant';
    badgeClass = 'pr-safe';
  }

  personalRiskBadge.textContent = badgeText;
  personalRiskBadge.className   = `personal-risk-badge ${badgeClass}`;
}

//  Score ring 
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

//  Stats 
function renderStats(strength) {
  statEntropy.textContent = `${strength.entropy} bits`;
  statLength.textContent  = strength.length;
  statCharset.textContent = strength.charsetSize;
  statVariety.textContent = `${strength.varietyCount}/4`;
}

//  Char indicators 
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

//  Issues 
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

//  Breakdown bars 
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

//  Crack times 
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

//  Suggestions 
function renderSuggestions(suggestions) {
  suggList.innerHTML = suggestions.map((s, i) => `
    <div class="suggestion-card ${s.priority}" style="animation-delay:${i * 50}ms">
      <span class="suggestion-tag">${s.icon}</span>
      <span class="suggestion-text">${s.text}</span>
    </div>`
  ).join('');
}

//  Input event listeners 
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

// ── Smart Generator Controller ────────────────────────────────────────────────

// ── Profile field adapter ─────────────────────────────────────────────────────
// Maps profile.html / profileStore field names to personalGenerator.js shape
function mapProfileToGenerator(p) {
  if (!p) return {};
  return {
    name:           p.firstName        || '',
    surname:        p.lastName         || '',
    nick:           p.nickname         || '',
    username:       p.username         || '',
    pet:            p.petName          || '',
    partner:        p.partnerName      || '',
    company:        p.companyName      || '',
    dob:            p.dateOfBirth      || '',
    favoriteNumber: p.favoriteNumber   || '',
    gamerTag:       p.gamerTag         || '',
    sportsTeam:     p.sportsTeam       || '',
    commonAlias:    p.commonAlias      || '',
    customKeywords: Array.isArray(p.customKeywords) ? p.customKeywords : [],
  };
}

function sgGetOpts() {
  return {
    wordCount:  parseInt(sgWcSlider?.value ?? '3', 10),
    separator:  sgSeparator,
    digits:     sgUseNums?.checked ?? true,
    symbols:    sgUseSyms?.checked ?? false,
    capitalize: sgCapitalize?.checked ?? true,
    category:   sgTheme?.value || '',
  };
}

function sgUpdateModeUI(mode) {
  const meta = SG_MODES[mode] || SG_MODES.smartMemorable;
  if (sgModeHint)  sgModeHint.textContent = meta.hint;
  if (sgOptWc)   sgOptWc.style.display   = meta.showWc    ? '' : 'none';
  if (sgOptSep)  sgOptSep.style.display  = meta.showSep   ? '' : 'none';
  if (sgOptCaps) sgOptCaps.style.display = meta.showCaps  ? '' : 'none';
  if (sgOptTheme) sgOptTheme.style.display = meta.showTheme ? '' : 'none';
}

function sgRenderScore(res) {
  if (!res) return;
  sgBarFill.style.width      = `${res.score}%`;
  sgBarFill.style.background = res.color;
  sgBarWrap.style.display    = '';
  sgScoreNum.textContent     = res.score;
  sgScoreCat.textContent     = res.category;
  sgScoreCat.style.color     = res.color;
  sgScoreEnt.textContent     = res.entropy ?? '—';
  sgScoreRow.style.display   = '';
  // crack hint
  try {
    const times = estimateCrackTimes(res.charsetSize, res.length);
    const ct    = times.find(t => t.id === 'online_throttled') || times[0];
    sgCrackHint.textContent  = ct ? `Online login: ${ct.display}` : '';
    sgCrackHint.style.color  = ct?.severity === 'safe' ? '#22c55e' : ct?.severity === 'moderate' ? '#84cc16' : ct?.severity === 'warning' ? '#f59e0b' : '#ef4444';
  } catch (_) {}
  sgRegenBtn.style.display = '';
  sgCopyBtn.style.display  = '';
  sgUseBtn.style.display   = '';
}

function sgRenderContextValidation(validation) {
  const result = {
    ...validation.scoreResult,
    ...validation.strength,
  };
  sgRenderScore(result);
  if (sgExplainStrip) {
    sgExplainStrength.textContent = `${validation.strengthScore}/100`;
    sgExplainPersonal.textContent = `${validation.personalizedAttackScore}/100`;
    sgExplainReason.textContent = validation.reasoning;
    sgExplainStrip.hidden = false;
  }
  if (sgWarnBadge) {
    sgWarnBadge.textContent = validation.passed ? 'Passes every generator check' : validation.reasoning;
    sgWarnBadge.hidden = false;
  }
}

function sgGenerate() {
  sgGenBtn.textContent = 'Generating…';
  sgGenBtn.disabled    = true;
  if (sgExplainStrip) sgExplainStrip.hidden = true;
  if (sgWarnBadge)    sgWarnBadge.hidden    = true;

  setTimeout(async () => {
    try {
      if (activePasswordContext?.eligible && activeWebsiteContext) {
        if (!dictCacheReady && dictMeta?.size > 0) {
          await warmCache();
          dictCacheReady = true;
        }
        const result = await generateContextAwarePassword({
          profile: profileData || {},
          websiteContext: activeWebsiteContext,
          username: usernameInput.value.trim(),
          validation: {
            dictionaryLookup: dictCacheReady && isReady() ? lookup : null,
            dictionarySize: getSize(),
          },
          options: {
            wordCount: parseInt(sgWcSlider?.value ?? '3', 10),
            separator: sgSeparator,
            symbols: sgUseSyms?.checked ?? true,
          },
        });
        sgPwField.value = result.password;
        sgRenderContextValidation(result.validation);
      } else if (sgCurrentMode === 'personalSecure') {
        // ── Personalized mode ──
        const mappedProfile = mapProfileToGenerator(profileData);
        const result = generatePersonalPassword(mappedProfile, {
          ...sgGetOpts(),
          dictionary: null,   // fast path — dict check via checkVulnerability inside
        });
        if (result) {
          sgPwField.value = result.password;
          sgRenderScore(result);
          // Render explain strip
          if (sgExplainStrip) {
            sgExplainStrength.textContent = `${result.score}/100 — ${result.category}`;
            sgExplainPersonal.textContent = '—';   // personal dict check is async
            const { strengthLine, personalLine, reason } = explainPassword(
              result.password, mappedProfile, result, null,
              result.categories || [], result.directAnchors || []
            );
            sgExplainStrength.textContent = strengthLine;
            sgExplainReason.textContent   = reason;
            sgExplainStrip.hidden = false;
          }
        } else {
          sgPwField.placeholder = isProfileFilled(mapProfileToGenerator(profileData))
            ? 'Could not generate — try regenerating'
            : 'Fill your profile first — open Profile tab';
        }
      } else {
        // ── Standard modes ──
        const result = generateSmartPassword(sgCurrentMode, sgGetOpts());
        if (result) {
          sgPwField.value = result.password;
          sgRenderScore(result);
          if (sgExplainStrip) sgExplainStrip.hidden = true;
        } else {
          sgPwField.placeholder = 'Generation failed — try different options';
        }
      }
    } catch (e) {
      console.error('[VaultZero Generator]', e);
      sgPwField.placeholder = 'Error — check console';
    } finally {
      sgGenBtn.textContent = 'Generate';
      sgGenBtn.disabled    = false;
    }
  }, 0);
}

function sgLiveAnalyse() {
  const pw = sgPwField.value;
  if (!pw) {
    sgBarWrap.style.display  = 'none';
    sgScoreRow.style.display = 'none';
    sgCrackHint.textContent  = '';
    if (sgWarnBadge) sgWarnBadge.hidden = true;
    return;
  }
  if (activePasswordContext?.eligible && activeWebsiteContext) {
    validateGeneratedPassword(pw, {
      profile: profileData || {},
      username: usernameInput.value.trim(),
      domain: activeWebsiteContext.domain,
      dictionaryLookup: dictCacheReady && isReady() ? lookup : null,
      dictionarySize: getSize(),
    }).then(sgRenderContextValidation).catch(() => {});
    return;
  }

  const res = scoreGeneratedPassword(pw);
  sgRenderScore(res);

  // Live vulnerability check in Personalized mode
  if (sgCurrentMode === 'personalSecure' && sgWarnBadge) {
    const mappedProfile = mapProfileToGenerator(profileData);
    const { vulnerable, reason } = checkVulnerability(pw, mappedProfile, null);
    if (vulnerable) {
      sgWarnBadge.textContent = `Warning: ${reason}`;
      sgWarnBadge.hidden = false;
    } else {
      sgWarnBadge.hidden = true;
    }
  } else if (sgWarnBadge) {
    sgWarnBadge.hidden = true;
  }
}

// Mode tabs
sgModeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sgModeBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    sgCurrentMode = btn.dataset.mode;
    sgUpdateModeUI(sgCurrentMode);
  });
});

// Generate / Regen
sgGenBtn.addEventListener('click',   sgGenerate);
sgRegenBtn.addEventListener('click', sgGenerate);

// Copy
sgCopyBtn.addEventListener('click', () => {
  const pw = sgPwField.value;
  if (!pw) return;
  navigator.clipboard.writeText(pw).then(() => flashButton(sgCopyBtn, 'Copied!'));
});

// Use in Analyzer
sgUseBtn.addEventListener('click', () => {
  const pw = sgPwField.value;
  if (!pw) return;
  passwordInput.value = pw;
  tabBtns.forEach(b => b.classList.remove('active'));
  tabPanels.forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="analyze"]').classList.add('active');
  $('panel-analyze').classList.add('active');
  analyse();
});

// Live analysis while editing
sgPwField.addEventListener('input', () => {
  clearTimeout(sgLiveDebounce);
  sgLiveDebounce = setTimeout(sgLiveAnalyse, 80);
});

// Customise toggle
sgCustomToggle.addEventListener('click', () => {
  const isOpen = !sgCustomPanel.hidden;
  sgCustomPanel.hidden = isOpen;
  sgCustomToggle.setAttribute('aria-expanded', String(!isOpen));
  sgCaret.innerHTML = isOpen ? '&#9660;' : '&#9650;';
});

// Word count slider
sgWcSlider.addEventListener('input', () => { sgWcVal.textContent = sgWcSlider.value; });

// Separator buttons
sgSepBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sgSepBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sgSeparator = btn.dataset.sep;
  });
});

// Init mode UI
sgUpdateModeUI(sgCurrentMode);

//  Profile Tab (Tab 3) 

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
    : '';
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
    ppDictDate.textContent = '';
    ppDictNoData.style.display = '';
  }

  // Last analysis result
  const history = await getHistory();
  if (history.length > 0) {
    const last = history[0];
    ppLastPw.textContent   = last.password;
    ppLastRisk.textContent = last.risk || '';
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

//  Utilities 
function flashButton(btn, tempText) {
  const orig = btn.textContent;
  btn.textContent = tempText;
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// Generation starts only after an eligible account workflow is detected.

