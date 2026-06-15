/**
 * smartGeneratorUI.js
 * -----------------------------------------------------------------------------
 * UI controller for the Smart Password Generator section.
 *
 * Modes
 * -----
 *  smartMemorable � Title-cased words + number
 *  passphrase     � lowercase words joined by separator
 *  maxSecurity    � maximum-entropy character pool
 *  personalSecure � [NEW] themed anchors from user profile
 *
 * All business logic lives in shared/smartGenerator.js and
 * shared/personalGenerator.js. This file contains UI wiring only.
 * -----------------------------------------------------------------------------
 */

import { generateSmartPassword, scoreGeneratedPassword } from '../shared/smartGenerator.js';
import { estimateCrackTimes }   from '../shared/bruteforce.js';
import {
  generatePersonalPassword,
  checkVulnerability,
  explainPassword,
  loadSavedProfile,
  saveProfile,
  isProfileFilled,
  countFilledFields,
} from '../shared/personalGenerator.js';
import { runPersonalizedAnalysis } from '../shared/personalDictionary.js';

// -- DOM refs ---------------------------------------------------------------
const pwInput       = document.getElementById('sg-password');
const generateBtn   = document.getElementById('sg-generate-btn');
const regenBtn      = document.getElementById('sg-regen-btn');
const copyBtn       = document.getElementById('sg-copy-btn');
const analyseBtn    = document.getElementById('sg-analyse-btn');
const scoreCard     = document.getElementById('sg-score-card');
const barTrack      = document.getElementById('sg-bar-track');
const barFill       = document.getElementById('sg-bar-fill');
const ringFill      = document.getElementById('sg-ring-fill');
const scoreVal      = document.getElementById('sg-score-val');
const scoreCat      = document.getElementById('sg-score-cat');
const entropyEl     = document.getElementById('sg-entropy');
const lengthEl      = document.getElementById('sg-length');
const crackLine     = document.getElementById('sg-crack-line');
const modeDesc      = document.getElementById('sg-mode-desc');
const tabs          = document.querySelectorAll('.sg-tab');
const customToggle  = document.getElementById('sg-custom-toggle');
const customPanel   = document.getElementById('sg-custom-panel');
const customCaret   = document.getElementById('sg-custom-caret');
const wcField       = document.getElementById('sg-wc-field');
const sepField      = document.getElementById('sg-sep-field');
const capsField     = document.getElementById('sg-caps-field');
const catField      = document.getElementById('sg-cat-field');
const wcSlider      = document.getElementById('sg-word-count');
const wcVal         = document.getElementById('sg-wc-val');
const useNums       = document.getElementById('sg-use-nums');
const useSyms       = document.getElementById('sg-use-syms');
const capitalize    = document.getElementById('sg-capitalize');
const categoryEl    = document.getElementById('sg-category');
const sepBtns       = document.querySelectorAll('.sg-sep-btn');

// Personalized-mode specific DOM
const profilePill      = document.getElementById('sg-profile-pill');
const explainPanel     = document.getElementById('sg-explain-panel');
const explainStrength  = document.getElementById('sg-explain-strength');
const explainPersonal  = document.getElementById('sg-explain-personal');
const explainReason    = document.getElementById('sg-explain-reason');
const personalForm     = document.getElementById('sg-personal-form');
const pfFirstName      = document.getElementById('sgp-first-name');
const pfLastName       = document.getElementById('sgp-last-name');
const pfNickname       = document.getElementById('sgp-nickname');
const pfPet            = document.getElementById('sgp-pet');
const pfPartner        = document.getElementById('sgp-partner');
const pfCompany        = document.getElementById('sgp-company');
const pfDob            = document.getElementById('sgp-dob');
const pfFavNum         = document.getElementById('sgp-fav-num');
const pfKeywords       = document.getElementById('sgp-keywords');
const pfSaveBtn        = document.getElementById('sgp-save-btn');
const pfClearBtn       = document.getElementById('sgp-clear-btn');
const warningBadge     = document.getElementById('sg-warning-badge');

// -- State ------------------------------------------------------------------
let currentMode    = 'smartMemorable';
let separator      = '';
let liveDebounce   = null;
let currentProfile = {};
let personalDict   = null;  // cached personal dictionary for fast rejection

const RING_CIRC = 2 * Math.PI * 50;

const MODE_META = {
  smartMemorable: {
    desc: 'Title-cased words + number suffix \u2014 easy to type, hard to crack',
    showWc: true, showSep: true, showCaps: true, showCat: true, showPersonal: false,
  },
  passphrase: {
    desc: 'Multiple lowercase words joined by a separator \u2014 high entropy through length',
    showWc: true, showSep: true, showCaps: false, showCat: false, showPersonal: false,
  },
  maxSecurity: {
    desc: 'Maximum entropy character-pool password \u2014 highest security, hardest to memorise',
    showWc: false, showSep: false, showCaps: false, showCat: false, showPersonal: false,
  },
  personalSecure: {
    desc: 'Memory anchors derived from your profile \u2014 memorable to you, opaque to attackers',
    showWc: true, showSep: false, showCaps: true, showCat: false, showPersonal: true,
  },
};

// -- Profile helpers --------------------------------------------------------

function readFormProfile() {
  return {
    name:           (pfFirstName?.value  || '').trim(),
    surname:        (pfLastName?.value   || '').trim(),
    nick:           (pfNickname?.value   || '').trim(),
    pet:            (pfPet?.value        || '').trim(),
    partner:        (pfPartner?.value    || '').trim(),
    company:        (pfCompany?.value    || '').trim(),
    dob:            (pfDob?.value        || ''),
    favoriteNumber: (pfFavNum?.value     || '').trim(),
    customKeywords: (pfKeywords?.value   || '').split(',').map(k => k.trim()).filter(Boolean),
  };
}

function populateForm(profile) {
  if (pfFirstName) pfFirstName.value = profile.name          || '';
  if (pfLastName)  pfLastName.value  = profile.surname       || '';
  if (pfNickname)  pfNickname.value  = profile.nick          || '';
  if (pfPet)       pfPet.value       = profile.pet           || '';
  if (pfPartner)   pfPartner.value   = profile.partner       || '';
  if (pfCompany)   pfCompany.value   = profile.company       || '';
  if (pfDob)       pfDob.value       = profile.dob           || '';
  if (pfFavNum)    pfFavNum.value    = profile.favoriteNumber|| '';
  if (pfKeywords)  pfKeywords.value  = (profile.customKeywords || []).join(', ');
}

function updateProfilePill(profile) {
  if (!profilePill) return;
  if (isProfileFilled(profile)) {
    const count = countFilledFields(profile);
    profilePill.textContent = `Profile: ${count} field${count !== 1 ? 's' : ''} active`;
    profilePill.classList.add('active');
    profilePill.hidden = false;
  } else {
    profilePill.textContent = 'No profile � using general mode';
    profilePill.classList.remove('active');
    profilePill.hidden = false;
  }
}

// -- Options builder --------------------------------------------------------

function getOpts() {
  return {
    wordCount:  parseInt(wcSlider.value, 10),
    separator,
    digits:     useNums.checked,
    symbols:    useSyms.checked,
    capitalize: capitalize.checked,
    category:   categoryEl?.value || undefined,
    dictionary: personalDict,
  };
}

// -- Action buttons ---------------------------------------------------------

function showActionButtons() {
  regenBtn.style.display   = '';
  copyBtn.style.display    = '';
  analyseBtn.style.display = '';
}

// -- Mode UI toggle ---------------------------------------------------------

function updateModeUI(mode) {
  const meta = MODE_META[mode];
  modeDesc.textContent = meta.desc;
  wcField.style.display    = meta.showWc  ? '' : 'none';
  sepField.style.display   = meta.showSep ? '' : 'none';
  capsField.style.display  = meta.showCaps? '' : 'none';
  catField.style.display   = meta.showCat ? '' : 'none';

  // Show / hide profile form and pill
  if (personalForm) personalForm.hidden = !meta.showPersonal;
  if (profilePill)  profilePill.hidden  = !meta.showPersonal;
  if (explainPanel) explainPanel.hidden = true; // reset on mode switch
  if (warningBadge) warningBadge.hidden = true;
}

// -- Score ring renderer ----------------------------------------------------

function renderScore(res) {
  if (!res) return;

  // Ring
  const offset = RING_CIRC * (1 - res.score / 100);
  ringFill.style.strokeDasharray  = RING_CIRC;
  ringFill.style.strokeDashoffset = offset;
  ringFill.style.stroke           = res.color;

  // Labels
  scoreVal.textContent = res.score;
  scoreCat.textContent = res.category;
  scoreCat.style.color = res.color;
  entropyEl.textContent = res.entropy   ?? '\u2014';
  lengthEl.textContent  = res.length    ?? 0;

  // Crack time (online throttled)
  try {
    const times = estimateCrackTimes(res.charsetSize, res.length);
    const ct    = times.find(t => t.id === 'online_throttled') || times[0];
    crackLine.textContent = ct ? `Online login: ${ct.display}` : '';
    crackLine.style.color = ct?.severity === 'safe'     ? '#22c55e'
                          : ct?.severity === 'moderate' ? '#84cc16'
                          : ct?.severity === 'warning'  ? '#f59e0b'
                          : '#ef4444';
  } catch (_) {}

  // Bar + panels
  barFill.style.width      = `${res.score}%`;
  barFill.style.background = res.color;
  scoreCard.style.display  = '';
  barTrack.style.display   = '';
}

// -- Explainability panel ---------------------------------------------------

function renderExplanation(scoreRes, personalRes, usedCategories, directAnchors) {
  if (!explainPanel) return;
  const { strengthLine, personalLine, reason } =
    explainPassword(pwInput.value, currentProfile, scoreRes, personalRes,
                    usedCategories || [], directAnchors || []);


  explainStrength.textContent = strengthLine;
  explainPersonal.textContent = personalLine;
  explainReason.textContent   = reason;
  explainPanel.hidden = false;
}

// -- Warning badge (live edit check) ---------------------------------------

function checkWarning(pw) {
  if (!warningBadge) return;
  if (currentMode !== 'personalSecure') { warningBadge.hidden = true; return; }
  if (!pw || !isProfileFilled(currentProfile)) { warningBadge.hidden = true; return; }

  const { vulnerable, reason } = checkVulnerability(pw, currentProfile, personalDict);
  if (vulnerable) {
    warningBadge.textContent = `Warning: ${reason}`;
    warningBadge.hidden = false;
  } else {
    warningBadge.hidden = true;
  }
}

// -- Core: generate ---------------------------------------------------------

async function generate() {
  generateBtn.textContent = 'Generating\u2026';
  generateBtn.disabled    = true;
  if (explainPanel) explainPanel.hidden = true;
  if (warningBadge) warningBadge.hidden = true;

  setTimeout(async () => {
    try {
      if (currentMode === 'personalSecure') {
        currentProfile = readFormProfile();
        updateProfilePill(currentProfile);

        // Build personal dictionary once per profile for fast rejection
        const { generatePersonalDictionary } = await import('../shared/personalDictionaryGenerator.js');
        personalDict = generatePersonalDictionary(currentProfile);

        const result = generatePersonalPassword(currentProfile, { ...getOpts(), dictionary: personalDict });
        if (result) {
          pwInput.value = result.password;
          renderScore(result);
          showActionButtons();

          // Run full personal analysis for the explain panel (async, non-blocking UX)
          if (isProfileFilled(currentProfile)) {
            runPersonalizedAnalysis(result.password, currentProfile)
              .then(personalRes => renderExplanation(result, personalRes, result.categories, result.directAnchors))
              .catch(() => renderExplanation(result, null, result.categories || [], result.directAnchors || []));
          } else {
            renderExplanation(result, null, result.categories || [], result.directAnchors || []);
          }
        } else {
          pwInput.value       = '';
          pwInput.placeholder = 'No profile data � add at least one field';
        }

      } else {
        const result = generateSmartPassword(currentMode, getOpts());
        if (result) {
          pwInput.value = result.password;
          renderScore(result);
          showActionButtons();
        }
      }
    } catch (e) {
      console.error('[SmartGenerator]', e);
      pwInput.value       = '';
      pwInput.placeholder = 'Generation failed � check console';
    } finally {
      generateBtn.disabled    = false;
      generateBtn.textContent = 'Generate';
    }
  }, 0);
}

// -- Core: live analyse -----------------------------------------------------

function liveAnalyse() {
  const pw = pwInput.value;
  if (!pw) {
    scoreCard.style.display = 'none';
    barTrack.style.display  = 'none';
    if (warningBadge) warningBadge.hidden = true;
    return;
  }
  const res = scoreGeneratedPassword(pw);
  renderScore(res);
  showActionButtons();
  checkWarning(pw);
}

// -- Event wiring -----------------------------------------------------------

// Mode tabs
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    currentMode = tab.dataset.mode;
    updateModeUI(currentMode);
  });
});

// Generate / Regen
generateBtn.addEventListener('click', generate);
regenBtn.addEventListener('click', generate);

// Copy
copyBtn.addEventListener('click', () => {
  const pw = pwInput.value;
  if (!pw) return;
  navigator.clipboard.writeText(pw).then(() => {
    const orig = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = orig; }, 1500);
  });
});

// Send to main analyser
analyseBtn.addEventListener('click', () => {
  const mainInput = document.getElementById('password-input');
  if (!mainInput || !pwInput.value) return;
  mainInput.value = pwInput.value;
  mainInput.dispatchEvent(new Event('input', { bubbles: true }));
  mainInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Live analysis while editing
pwInput.addEventListener('input', () => {
  clearTimeout(liveDebounce);
  liveDebounce = setTimeout(liveAnalyse, 80);
});

// Customisation toggle
customToggle.addEventListener('click', () => {
  const isOpen = !customPanel.hidden;
  customPanel.hidden = isOpen;
  customToggle.setAttribute('aria-expanded', String(!isOpen));
  customCaret.innerHTML = isOpen ? '&#9660;' : '&#9650;';
});

// Word count slider
wcSlider.addEventListener('input', () => { wcVal.textContent = wcSlider.value; });

// Separator buttons
sepBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sepBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    separator = btn.dataset.sep;
  });
});

// Profile save button
if (pfSaveBtn) {
  pfSaveBtn.addEventListener('click', () => {
    const profile = readFormProfile();
    saveProfile(profile);
    updateProfilePill(profile);
    pfSaveBtn.textContent = 'Saved!';
    setTimeout(() => { pfSaveBtn.textContent = 'Save Profile'; }, 1500);
  });
}

// Profile clear button
if (pfClearBtn) {
  pfClearBtn.addEventListener('click', () => {
    if (pfFirstName) pfFirstName.value = '';
    if (pfLastName)  pfLastName.value  = '';
    if (pfNickname)  pfNickname.value  = '';
    if (pfPet)       pfPet.value       = '';
    if (pfPartner)   pfPartner.value   = '';
    if (pfCompany)   pfCompany.value   = '';
    if (pfDob)       pfDob.value       = '';
    if (pfFavNum)    pfFavNum.value    = '';
    if (pfKeywords)  pfKeywords.value  = '';
    saveProfile({});
    updateProfilePill({});
    personalDict = null;
  });
}

// -- Init -------------------------------------------------------------------

// Load saved profile and pre-fill form
currentProfile = loadSavedProfile();
populateForm(currentProfile);
updateModeUI(currentMode);

// Auto-generate a password on load
generate();
