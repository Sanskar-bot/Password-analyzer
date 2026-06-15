/**
 * app.js
 * 
 * Main orchestrator for the Password Strength Analyzer.
 *
 * Wires all analysis modules together and drives the UI:
 *   1. Listens for password / username input (debounced at 120ms)
 *   2. Runs all analysis modules
 *   3. Updates the DOM with results, score ring, crack-time table, suggestions
 *
 * Module pipeline:
 *   analyseStrength  detectPatterns  checkWordlist  checkUsername
 *      computeScore  estimateCrackTimes  generateSuggestions
 * 
 */

import { analyseStrength, entropyLabel }   from "../shared/strength.js";
import { detectPatterns }                  from "../shared/patterns.js";
import { checkWordlist }                   from "../shared/wordlist.js";
import { checkUsername }                   from "../shared/username.js";
import { estimateCrackTimes }              from "../shared/bruteforce.js";
import { computeScore, CATEGORIES }        from "../shared/scorer.js";
import { generateSuggestions }             from "../shared/suggestions.js";
import { generatePassword }                from "../shared/generator.js";
import { runPersonalizedAnalysis,
         downloadDictionary }              from "../shared/personalDictionary.js";

//  DOM References 
const passwordInput   = document.getElementById("password-input");
const usernameInput   = document.getElementById("username-input");
const toggleVisBtn    = document.getElementById("toggle-visibility");
const resultsPanel    = document.getElementById("results-panel");
const emptyState      = document.getElementById("empty-state");

// Score ring
const scoreValue      = document.getElementById("score-value");
const scoreCategory   = document.getElementById("score-category");
const scoreRingFill   = document.getElementById("score-ring-fill");

// Strength bar
const strengthBar     = document.getElementById("strength-bar");
const strengthLabel   = document.getElementById("strength-label");

// Stats
const statLength      = document.getElementById("stat-length");
const statEntropy     = document.getElementById("stat-entropy");
const statCharset     = document.getElementById("stat-charset");
const statVariety     = document.getElementById("stat-variety");

// Char class indicators
const indLower  = document.getElementById("ind-lower");
const indUpper  = document.getElementById("ind-upper");
const indDigit  = document.getElementById("ind-digit");
const indSymbol = document.getElementById("ind-symbol");

// Panels
const issuesList       = document.getElementById("issues-list");
const issuesPanel      = document.getElementById("issues-panel");
const crackTimeBody    = document.getElementById("crack-time-body");
const suggestionsList  = document.getElementById("suggestions-list");
const breakdownBars    = document.getElementById("breakdown-bars");

// Generator
const genLengthSlider  = document.getElementById("gen-length");
const genLengthDisplay = document.getElementById("gen-length-display");
const genOutput        = document.getElementById("gen-output");
const genBtn           = document.getElementById("gen-btn");
const genCopyBtn       = document.getElementById("gen-copy-btn");
const genUseBtn        = document.getElementById("gen-use-btn");
const genLower         = document.getElementById("gen-lower");
const genUpper         = document.getElementById("gen-upper");
const genDigits        = document.getElementById("gen-digits");
const genSymbols       = document.getElementById("gen-symbols");

//  Personal Attack Analysis DOM refs 
const personalSection      = document.getElementById("personal-attack-section");
const personalCtaCard      = document.getElementById("personal-cta-card");
const showPersonalFormBtn  = document.getElementById("show-personal-form-btn");
const personalFormCard     = document.getElementById("personal-form-card");
const runPersonalBtn       = document.getElementById("run-personal-analysis-btn");
const cancelPersonalBtn    = document.getElementById("cancel-personal-btn");
const personalLoadingCard  = document.getElementById("personal-loading-card");
const personalResultsCard  = document.getElementById("personal-results-card");
const rerunPersonalBtn     = document.getElementById("rerun-personal-btn");
const downloadDictBtn      = document.getElementById("download-dict-btn");

// Personal results elements
const paDictSize     = document.getElementById("pa-dict-size");
const paFound        = document.getElementById("pa-found");
const paFoundSub     = document.getElementById("pa-found-sub");
const paFoundCard    = document.getElementById("pa-found-card");
const paRank         = document.getElementById("pa-rank");
const paRankCard     = document.getElementById("pa-rank-card");
const paScoreValue   = document.getElementById("pa-score-value");
const paScoreFill    = document.getElementById("pa-score-fill");
const paRiskBadge    = document.getElementById("pa-risk-badge");
const paExplanList   = document.getElementById("pa-explanation-list");

//  State 
let debounceTimer    = null;
let passwordVisible  = false;
let lastDictionary   = [];    // holds the last generated dictionary for download
let lastProfileName  = '';    // used in the download filename

//  SVG Score Ring constants 
// The ring is a circle with r=54, so circumference  339.3
const RING_CIRCUMFERENCE = 2 * Math.PI * 54;

//  Utility 
function setRingProgress(score) {
  const progress = score / 100;
  const offset   = RING_CIRCUMFERENCE * (1 - progress);
  scoreRingFill.style.strokeDasharray  = RING_CIRCUMFERENCE;
  scoreRingFill.style.strokeDashoffset = offset;
}

function setIndicator(el, active) {
  el.classList.toggle("active",   active);
  el.classList.toggle("inactive", !active);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

//  Core analysis pipeline 
function analyse() {
  const password = passwordInput.value;
  const username = usernameInput.value.trim();

  if (password.length === 0) {
    resultsPanel.classList.add("hidden");
    emptyState.classList.remove("hidden");
    personalSection.classList.add("hidden");
    return;
  }

  resultsPanel.classList.remove("hidden");
  emptyState.classList.add("hidden");

  // 1. Run all modules
  const strength   = analyseStrength(password);
  const patterns   = detectPatterns(password);
  const wordlist   = checkWordlist(password);
  const ucheck     = checkUsername(password, username);
  const scoreRes   = computeScore(strength, wordlist, patterns, ucheck);
  const crackTimes = estimateCrackTimes(strength.charsetSize, strength.length);
  const suggestions = generateSuggestions(strength, wordlist, patterns, ucheck, scoreRes);

  // 2. Update UI
  renderScore(scoreRes);
  renderStats(strength);
  renderCharIndicators(strength);
  renderIssues(strength, wordlist, patterns, ucheck);
  renderCrackTimes(crackTimes);
  renderSuggestions(suggestions);
  renderBreakdown(scoreRes.breakdown);

  // 3. Show personalized attack section (reset to CTA state)
  showPersonalAttackSection();
}

//  Score ring 
function renderScore(scoreRes) {
  scoreValue.textContent    = scoreRes.score;
  scoreCategory.textContent = scoreRes.category;
  scoreCategory.className   = `score-category ${scoreRes.cssClass}`;
  scoreRingFill.style.stroke = scoreRes.color;
  setRingProgress(scoreRes.score);

  // Strength bar
  strengthBar.style.width      = `${scoreRes.score}%`;
  strengthBar.style.background = scoreRes.color;
  strengthLabel.textContent    = scoreRes.category;
  strengthLabel.className      = `strength-label ${scoreRes.cssClass}`;
}

//  Stat cards 
function renderStats(strength) {
  statLength.textContent  = strength.length;
  statEntropy.textContent = `${strength.entropy} bits`;
  statCharset.textContent = strength.charsetSize;
  statVariety.textContent = `${strength.varietyCount}/4 classes`;
}

//  Character class indicators 
function renderCharIndicators(strength) {
  setIndicator(indLower,  strength.hasLower);
  setIndicator(indUpper,  strength.hasUpper);
  setIndicator(indDigit,  strength.hasDigit);
  setIndicator(indSymbol, strength.hasSymbol);
}

//  Issues panel 
function renderIssues(strength, wordlist, patterns, ucheck) {
  const issues = [];

  if (strength.length < 8)       issues.push({ sev: "high",   text: "Password is too short (< 8 chars)" });
  if (wordlist.exactMatch)       issues.push({ sev: "high",   text: "Found in common password list" });
  if (wordlist.leetMatch)        issues.push({ sev: "high",   text: "Leet-speak form is a common password" });
  if (ucheck.contains)           issues.push({ sev: "high",   text: "Password contains your username" });
  if (ucheck.variation)          issues.push({ sev: "high",   text: "Password is a username variation" });
  if (ucheck.nearMatch)          issues.push({ sev: "medium", text: "Password is very similar to username" });
  if (ucheck.reversed)           issues.push({ sev: "medium", text: "Contains reversed username" });
  if (patterns.keyboard.found)   issues.push({ sev: "high",   text: `Keyboard walk: "${patterns.keyboard.matches[0]}"` });
  if (patterns.sequential.found) issues.push({ sev: "medium", text: `Sequential run: "${patterns.sequential.matches[0]}"` });
  if (patterns.repeats.found)    issues.push({ sev: "medium", text: `Repeated chars: "${patterns.repeats.matches[0]}"` });
  if (patterns.dates.found)      issues.push({ sev: "low",    text: `Date-like pattern: "${patterns.dates.matches[0]}"` });
  if (wordlist.substringMatches.length > 0) {
    issues.push({ sev: "medium", text: `Contains common words: "${wordlist.substringMatches.slice(0,2).join('", "')}"` });
  }
  if (!strength.hasUpper)  issues.push({ sev: "low", text: "No uppercase letters" });
  if (!strength.hasLower)  issues.push({ sev: "low", text: "No lowercase letters" });
  if (!strength.hasDigit)  issues.push({ sev: "low", text: "No numbers" });
  if (!strength.hasSymbol) issues.push({ sev: "low", text: "No special characters" });

  issuesPanel.classList.toggle("hidden", issues.length === 0);

  issuesList.innerHTML = issues.map(i => `
    <li class="issue issue-${i.sev}">
      <span class="issue-dot"></span>
      <span>${i.text}</span>
    </li>
  `).join("");
}

//  Crack time table 
function renderCrackTimes(crackTimes) {
  crackTimeBody.innerHTML = crackTimes.map(ct => `
    <tr>
      <td>
        <div class="scenario-name">${ct.label}</div>
        <div class="scenario-desc">${ct.desc}</div>
      </td>
      <td class="crack-time crack-${ct.severity}">${ct.display}</td>
    </tr>
  `).join("");
}

//  Suggestions 
function renderSuggestions(suggestions) {
  suggestionsList.innerHTML = suggestions.map((s, i) => `
    <div class="suggestion-card suggestion-${s.priority}" style="animation-delay:${i * 60}ms">
      <span class="suggestion-icon">${s.icon}</span>
      <span class="suggestion-text">${s.text}</span>
    </div>
  `).join("");
}

//  Score breakdown bars 
const BREAKDOWN_MAX = { length: 25, variety: 20, entropy: 20, wordlist: 15, patterns: 10, username: 10 };
const BREAKDOWN_LABELS = {
  length: "Length", variety: "Variety", entropy: "Entropy",
  wordlist: "Wordlist", patterns: "Patterns", username: "Username"
};

function renderBreakdown(breakdown) {
  breakdownBars.innerHTML = Object.entries(breakdown).map(([key, val]) => {
    const max  = BREAKDOWN_MAX[key];
    const pct  = Math.round((val / max) * 100);
    const hue  = Math.round(pct * 1.2); // 0 = red, 120 = green
    return `
      <div class="breakdown-row">
        <span class="breakdown-label">${BREAKDOWN_LABELS[key]}</span>
        <div class="breakdown-track">
          <div class="breakdown-fill" style="width:${pct}%;background:hsl(${hue},70%,50%)"></div>
        </div>
        <span class="breakdown-pts">${val}/${max}</span>
      </div>`;
  }).join("");
}

//  Generator 
function runGenerator() {
  try {
    const pw = generatePassword({
      length:    parseInt(genLengthSlider.value, 10),
      lowercase: genLower.checked,
      uppercase: genUpper.checked,
      digits:    genDigits.checked,
      symbols:   genSymbols.checked,
    });
    genOutput.value = pw;
  } catch (e) {
    genOutput.value = `Error: ${e.message}`;
  }
}

//  Personal Attack Analysis helpers 

/**
 * Reveal the personal attack section in its initial CTA state.
 * Resets all sub-panels so re-running a new password starts clean.
 */
function showPersonalAttackSection() {
  personalSection.classList.remove("hidden");
  personalFormCard.classList.add("hidden");
  personalLoadingCard.classList.add("hidden");
  personalResultsCard.classList.add("hidden");
  personalCtaCard.classList.remove("hidden");
  // Clear stale results
  lastDictionary  = [];
  lastProfileName = '';
}

/**
 * Render the personalized analysis results into the results card.
 * @param {object} results  Return value of runPersonalizedAnalysis()
 */
function renderPersonalResults(results) {
  const { dictSize, found, rank, score, riskLevel, explanation } = results;

  // Dictionary size
  paDictSize.textContent = dictSize.toLocaleString();

  // Found / not found
  paFound.textContent = found ? 'Yes' : 'No';
  paFoundSub.textContent = found ? 'password found in dictionary' : 'not found in dictionary';
  paFoundCard.className = `personal-stat-card ${found ? 'pa-danger' : 'pa-safe'}`;
  paFound.style.color   = found ? 'var(--c-danger)' : 'var(--c-safe)';

  // Rank
  if (found && rank !== null) {
    paRank.textContent = `#${rank.toLocaleString()}`;
    paRankCard.className = rank <= 1000 ? 'personal-stat-card pa-danger'
                         : rank <= 5000  ? 'personal-stat-card pa-warning'
                         : 'personal-stat-card';
  } else {
    paRank.textContent = 'N/A';
    paRank.style.color = 'var(--text-muted)';
    paRankCard.className = 'personal-stat-card pa-safe';
  }

  // Score bar
  paScoreValue.textContent = `${score}/100`;
  // Colour: red  yellow  green mapped to 0100
  const hue = Math.round(score * 1.2); // 0=red(0�), 100=green(120�)
  paScoreFill.style.width      = `${score}%`;
  paScoreFill.style.background = `hsl(${hue},70%,50%)`;

  // Risk badge
  paRiskBadge.textContent = `${riskLevel.emoji} ${riskLevel.label}`;
  paRiskBadge.className   = `personal-risk-badge ${riskLevel.cssClass}`;

  // Explanation
  paExplanList.innerHTML = explanation
    .map((e, i) => `<li style="animation-delay:${i * 50}ms">${e}</li>`)
    .join('');

  // Show results card, hide form + loading
  personalFormCard.classList.add('hidden');
  personalLoadingCard.classList.add('hidden');
  personalResultsCard.classList.remove('hidden');
}

//  Event Listeners 

// Password input with debounce
passwordInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(analyse, 120);
});

// Username input triggers re-analysis
usernameInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(analyse, 200);
});

// Show/hide password toggle
toggleVisBtn.addEventListener("click", () => {
  passwordVisible = !passwordVisible;
  passwordInput.type = passwordVisible ? "text" : "password";
  toggleVisBtn.textContent = passwordVisible ? "Hide" : "Show";
});

// Generator slider display
genLengthSlider.addEventListener("input", () => {
  genLengthDisplay.textContent = genLengthSlider.value;
});

// Generate button
genBtn.addEventListener("click", runGenerator);

// Copy generated password
genCopyBtn.addEventListener("click", () => {
  if (genOutput.value) copyToClipboard(genOutput.value, genCopyBtn);
});

// Use generated password in analyser
genUseBtn.addEventListener("click", () => {
  if (genOutput.value && !genOutput.value.startsWith("Error")) {
    passwordInput.value = genOutput.value;
    analyse();
    passwordInput.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

// Copy password from input
document.getElementById("copy-btn").addEventListener("click", () => {
  if (passwordInput.value) copyToClipboard(passwordInput.value, document.getElementById("copy-btn"));
});

//  Personal attack event listeners 

// Show profile form
showPersonalFormBtn.addEventListener("click", () => {
  personalCtaCard.classList.add("hidden");
  personalResultsCard.classList.add("hidden");
  personalLoadingCard.classList.add("hidden");
  personalFormCard.classList.remove("hidden");
  // Pre-fill username from the existing username input
  const usernameVal = usernameInput.value.trim();
  if (usernameVal && !document.getElementById("pa-username").value) {
    document.getElementById("pa-username").value = usernameVal;
  }
});

// Cancel  back to CTA
cancelPersonalBtn.addEventListener("click", () => {
  personalFormCard.classList.add("hidden");
  personalCtaCard.classList.remove("hidden");
});

// Re-run  show the form again
rerunPersonalBtn.addEventListener("click", () => {
  personalResultsCard.classList.add("hidden");
  personalCtaCard.classList.add("hidden");
  personalFormCard.classList.remove("hidden");
});

// Run analysis
runPersonalBtn.addEventListener("click", async () => {
  const password = passwordInput.value;
  if (!password) return;

  const profile = {
    name:     document.getElementById("pa-first-name").value.trim(),
    surname:  document.getElementById("pa-last-name").value.trim(),
    nick:     document.getElementById("pa-nickname").value.trim(),
    username: document.getElementById("pa-username").value.trim(),
    dob:      document.getElementById("pa-dob").value,
    partner:  document.getElementById("pa-partner").value.trim(),
    pet:      document.getElementById("pa-pet").value.trim(),
    company:  document.getElementById("pa-company").value.trim(),
  };

  // Show loading
  personalFormCard.classList.add("hidden");
  personalLoadingCard.classList.remove("hidden");

  // Disable button during run to prevent double-click
  runPersonalBtn.disabled = true;

  try {
    const results = await runPersonalizedAnalysis(password, profile);
    lastDictionary  = results.dictionary;
    lastProfileName = profile.name || 'personal';
    renderPersonalResults(results);
  } catch (err) {
    console.error('[PersonalAttack] Analysis failed:', err);
    personalLoadingCard.classList.add("hidden");
    personalCtaCard.classList.remove("hidden");
  } finally {
    runPersonalBtn.disabled = false;
  }
});

// Download dictionary
downloadDictBtn.addEventListener("click", () => {
  if (lastDictionary.length > 0) {
    downloadDictionary(lastDictionary, lastProfileName);
  }
});

//  Test cases (run in console with: runTests()) 
window.runTests = function() {
  const cases = [
    { pwd: "password",              usr: "",        expectCat: "Weak"       },
    { pwd: "P@ssw0rd",             usr: "",        expectCat: "Weak"       },
    { pwd: "qwerty123",            usr: "",        expectCat: "Weak"       },
    { pwd: "correcthorsebattery",  usr: "",        expectCat: "Strong"     },
    { pwd: "X9#mK2!pL7@qZ",       usr: "",        expectCat: "Very Strong"},
    { pwd: "john123",              usr: "john",    expectCat: "Weak"       },
    { pwd: "Tr0ub4dour&3",         usr: "alice",   expectCat: "Strong"     },
  ];

  console.group("Password Analyzer  Test Suite");
  cases.forEach(({ pwd, usr, expectCat }) => {
    const str  = analyseStrength(pwd);
    const pat  = detectPatterns(pwd);
    const wl   = checkWordlist(pwd);
    const uc   = checkUsername(pwd, usr);
    const sc   = computeScore(str, wl, pat, uc);
    const pass = sc.category === expectCat;
    console[pass ? "log" : "warn"](
      `${pass ? "" : ""} "${pwd}"  ${sc.score}/100 ${sc.category} (expected ${expectCat})`
    );
  });
  console.groupEnd();
};

//  Init 
// Pre-generate a password so the generator panel isn't empty on load
runGenerator();

// Expose personal test helper to console
window.runPersonalTests = async function() {
  const { generatePersonalDictionary } = await import('../shared/personalDictionaryGenerator.js');
  const { findPasswordInDictionary, computePersonalScore } = await import('../shared/personalDictionaryScorer.js');

  console.group(' Personal Dictionary  Test Suite');

  const cases = [
    {
      label:   'Sanskar2004@ (strong personal pattern)',
      pwd:     'Sanskar2004@',
      profile: { name: 'Sanskar', dob: '2004-01-01' },
      expectFound: true,
    },
    {
      label:   'X9#mK2!pL7@qZ (random  should not be found)',
      pwd:     'X9#mK2!pL7@qZ',
      profile: { name: 'Sanskar', dob: '2004-01-01' },
      expectFound: false,
    },
    {
      label:   'Empty profile  small dictionary',
      pwd:     'anything',
      profile: {},
      expectFound: false,
    },
  ];

  for (const tc of cases) {
    const dict = generatePersonalDictionary(tc.profile);
    const { found, rank } = findPasswordInDictionary(tc.pwd, dict);
    const score = computePersonalScore(found, rank, dict.length);
    const pass  = found === tc.expectFound;
    console[pass ? 'log' : 'warn'](
      `${pass ? '' : ''} ${tc.label}`,
      `| Dict: ${dict.length} | Found: ${found} | Rank: ${rank ?? 'N/A'} | Score: ${score}/100`
    );
  }

  console.groupEnd();
};

