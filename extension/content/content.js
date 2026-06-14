/**
 * content.js  VaultZero Content Script
 * 
 * Injects a full-analysis strength widget next to every password input.
 *
 * Features (always expanded, no button required):
 *    Score ring + strength bar
 *    Entropy / length / charset stats
 *    All detected issues with explanations
 *    Crack time estimate
 *    Personalized targeted-risk badge (when dict cache is ready)
 *
 * Uses Shadow DOM so styles never leak into the host page.
 * 
 */

(function () {
  'use strict';

  if (window.__vaultzeroInjected) return;
  window.__vaultzeroInjected = true;

  //  Settings 
  let settings = {
    enableWidget:       true,
    enablePersonalized: true,
    enableBadge:        true,
    widgetPosition:     'below',
  };
  chrome.storage.sync.get('settings', (data) => {
    if (data.settings) settings = { ...settings, ...data.settings };
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = { ...settings, ...changes.settings.newValue };
      if (!settings.enableWidget) removeAllWidgets();
    }
  });

  //  State 
  const widgetMap = new WeakMap();
  let observerTimeout = null;

  //  Analysis modules 
  let analysisReady = false;
  let analyseStrength, detectPatterns, checkWordlist, checkUsername,
      computeScore, estimateCrackTimes;

  //  Dict cache 
  let vzDictLookup  = null;
  let vzDictReady   = false;
  let vzDictLoading = false;

  async function loadDictCache() {
    if (vzDictReady || vzDictLoading) return;
    vzDictLoading = true;
    try {
      const cache = await import(chrome.runtime.getURL('modules/dictCache.js'));
      await cache.warmCache();
      vzDictLookup = cache.lookup;
      vzDictReady  = true;
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'DICT_UPDATED') {
          cache.invalidate();
          vzDictReady = false; vzDictLoading = false;
          loadDictCache();
        }
      });
    } catch (e) {
      console.warn('[VaultZero] dictCache load failed:', e);
    } finally {
      vzDictLoading = false;
    }
  }

  async function loadModules() {
    if (analysisReady) return;
    try {
      const [strength, patterns, wordlist, username, bruteforce, scorer] = await Promise.all([
        import(chrome.runtime.getURL('modules/strength.js')),
        import(chrome.runtime.getURL('modules/patterns.js')),
        import(chrome.runtime.getURL('modules/wordlist.js')),
        import(chrome.runtime.getURL('modules/username.js')),
        import(chrome.runtime.getURL('modules/bruteforce.js')),
        import(chrome.runtime.getURL('modules/scorer.js')),
      ]);
      analyseStrength    = strength.analyseStrength;
      detectPatterns     = patterns.detectPatterns;
      checkWordlist      = wordlist.checkWordlist;
      checkUsername      = username.checkUsername;
      estimateCrackTimes = bruteforce.estimateCrackTimes;
      computeScore       = scorer.computeScore;
      analysisReady      = true;
    } catch (e) {
      console.warn('[VaultZero] Module load failed:', e);
    }
  }

  //  Widget injection 
  function injectWidget(input) {
    if (!settings.enableWidget) return;
    if (widgetMap.has(input)) return;
    if (input.type !== 'password') return;

    const host = document.createElement('div');
    host.className = '__vz-widget-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;display:none;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = getWidgetCSS();
    shadow.appendChild(styleEl);

    const widget = buildWidgetDOM();
    shadow.appendChild(widget);

    function repositionWidget() {
      const rect = input.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      host.style.left = `${rect.left}px`;
      host.style.top  = `${rect.bottom + 6}px`;
      const inner = shadow.querySelector('.vz-widget');
      if (inner) inner.style.width = `${Math.max(rect.width, 280)}px`;
    }

    function showWidget() {
      host.style.display = '';
      repositionWidget();
    }

    function hideWidget() {
      host.style.display = 'none';
    }

    repositionWidget();
    window.addEventListener('scroll', repositionWidget, { passive: true });
    window.addEventListener('resize', repositionWidget, { passive: true });

    const state = { host, shadow, widget, repositionWidget, lastPassword: '' };
    widgetMap.set(input, state);

    let debounceTimer = null;

    // ── New-password context detection ─────────────────────────────────────
    // Fired once when the user focuses the input so popup can auto-switch to
    // the Generate tab and pre-select Personalized mode.
    function detectNewPasswordContext() {
      try {
        const isNewPwAttr = input.autocomplete === 'new-password' ||
                            input.getAttribute('autocomplete') === 'new-password';

        // Two password fields on the same form → registration pattern
        const form = input.closest('form') || document;
        const allPwFields = [...form.querySelectorAll('input[type="password"]')];
        const twoFields   = allPwFields.length >= 2;

        // Registration keywords anywhere on the page
        const pageText = (document.title + ' ' + document.body.innerText).toLowerCase().slice(0, 3000);
        const regKeywords = ['sign up','register','create account','new account','join','get started'];
        const hasRegKw = regKeywords.some(kw => pageText.includes(kw));

        const isNewPassword = isNewPwAttr || twoFields || hasRegKw;

        chrome.runtime.sendMessage({
          type:          'NEW_PASSWORD_CONTEXT',
          isNewPassword,
          url:           window.location.hostname,
        }).catch(() => {});
      } catch (_) {}
    }

    // BUG FIX: React/SPA sites (Instagram, Gmail, etc.) fire synthetic events
    // that bypass the native DOM "input" event. Listen to multiple event types.

    function onValueChange() {
      if (!settings.enableWidget) return;
      repositionWidget();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runAnalysis(input, state), 120);
    }

    input.addEventListener('input',   onValueChange);
    input.addEventListener('keyup',   onValueChange);
    input.addEventListener('keydown', onValueChange);
    input.addEventListener('change',  onValueChange);

    // BUG FIX: Polling fallback  React keeps value in a fiber, not DOM.
    // Poll every 250 ms while the field is focused to catch any missed changes.
    let pollInterval = null;

    input.addEventListener('focus', () => {
      showWidget();
      loadDictCache();
      detectNewPasswordContext();   // ← tell popup if this is a new-password field
      clearInterval(pollInterval);

      pollInterval = setInterval(() => {
        if (input.value !== state.lastPassword) onValueChange();
      }, 250);
    });

    input.addEventListener('blur', () => {
      clearInterval(pollInterval);
      pollInterval = null;
      setTimeout(() => {
        if (document.activeElement !== input) hideWidget();
      }, 300);
    });

    // BUG FIX: If the field is already focused when the widget is injected
    // (e.g. user clicked the password field before page fully loaded),
    // show the widget and start polling immediately.
    if (document.activeElement === input) {
      showWidget();
      loadDictCache();
      clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (input.value !== state.lastPassword) onValueChange();
      }, 250);
    }
  }

  //  Widget DOM 
  function buildWidgetDOM() {
    const widget = document.createElement('div');
    widget.className = 'vz-widget';
    widget.innerHTML = `
      <!-- Header: score + label -->
      <div class="vz-header">
        <span class="vz-shield" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L3 6v6c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V6L12 2z"/>
          </svg>
        </span>
        <span class="vz-label" id="vz-label">Enter password</span>
        <span class="vz-score" id="vz-score"></span>
        <span class="vz-privacy">Local</span>
      </div>

      <!-- Strength bar -->
      <div class="vz-bar-track">
        <div class="vz-bar-fill" id="vz-bar" style="width:0%"></div>
      </div>

      <button class="vz-toggle-btn" id="vz-toggle-btn" style="display:none">Details <span class="vz-caret">&#9660;</span></button>

      <!-- Full analysis (hidden by default) -->
      <div class="vz-analysis" id="vz-analysis" style="display:none">

        <!-- Stats row -->
        <div class="vz-stats-row">
          <div class="vz-stat">
            <span class="vz-stat-val" id="vz-entropy"></span>
            <span class="vz-stat-key">Entropy</span>
          </div>
          <div class="vz-stat">
            <span class="vz-stat-val" id="vz-length"></span>
            <span class="vz-stat-key">Length</span>
          </div>
          <div class="vz-stat">
            <span class="vz-stat-val" id="vz-charset"></span>
            <span class="vz-stat-key">Charset</span>
          </div>
          <div class="vz-stat">
            <span class="vz-stat-val" id="vz-variety"></span>
            <span class="vz-stat-key">Classes</span>
          </div>
        </div>

        <!-- Char class chips -->
        <div class="vz-chips" id="vz-chips">
          <span class="vz-chip" id="chip-lower">a-z</span>
          <span class="vz-chip" id="chip-upper">A-Z</span>
          <span class="vz-chip" id="chip-digit">0-9</span>
          <span class="vz-chip" id="chip-symbol">!@#</span>
        </div>

        <!-- All issues with explanations -->
        <div class="vz-section" id="vz-issues-section" style="display:none">
          <div class="vz-section-title">Issues Found</div>
          <div class="vz-issues-list" id="vz-issues-list"></div>
        </div>

        <!-- Crack time -->
        <div class="vz-section" id="vz-crack-section" style="display:none">
          <div class="vz-section-title">Online Login Resistance</div>
          <div class="vz-crack-list" id="vz-crack-list"></div>
        </div>

        <!-- Personalized risk -->
        <div class="vz-personal-risk" id="vz-personal-risk" style="display:none"></div>

      </div>
    `;

    // Toggle logic
    const toggleBtn = widget.querySelector('#vz-toggle-btn');
    const analysis  = widget.querySelector('#vz-analysis');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isExpanded = analysis.style.display !== 'none';
      const caret = toggleBtn.querySelector('.vz-caret');
      if (isExpanded) {
        analysis.style.display = 'none';
        toggleBtn.firstChild.textContent = 'Details ';
        if (caret) caret.innerHTML = '&#9660;';
      } else {
        analysis.style.display = '';
        toggleBtn.firstChild.textContent = 'Collapse ';
        if (caret) caret.innerHTML = '&#9650;';
      }
    });

    return widget;
  }

  //  Run analysis 
  async function runAnalysis(input, state) {
    const password = input.value;
    if (password === state.lastPassword) return;
    state.lastPassword = password;

    const { shadow } = state;
    const label      = shadow.getElementById('vz-label');
    const scoreEl    = shadow.getElementById('vz-score');
    const bar        = shadow.getElementById('vz-bar');
    const analysis   = shadow.getElementById('vz-analysis');
    const toggleBtn  = shadow.getElementById('vz-toggle-btn');

    if (password.length === 0) {
      label.textContent   = 'Enter password';
      label.className     = 'vz-label';
      scoreEl.textContent = '';
      bar.style.width     = '0%';
      // Reset expansion state
      analysis.style.display = 'none';
      toggleBtn.style.display = 'none';
      toggleBtn.textContent = 'View more ';
      return;
    }

    await loadModules();
    if (!analysisReady) return;

    const username = findNearbyUsername(input);
    const strength = analyseStrength(password);
    const patterns = detectPatterns(password);
    const wordlist = checkWordlist(password);
    const ucheck   = checkUsername(password, username);

    // Get personal risk BEFORE scoring
    let personalResult = null;
    if (vzDictReady && vzDictLookup) {
      personalResult = vzDictLookup(password);
    }

    const scoreRes = computeScore(strength, wordlist, patterns, ucheck, personalResult);

    const { score, category, color, baseScore, personalPenalty } = scoreRes;

    //  Header 
    label.textContent = category;
    label.className   = `vz-label vz-${scoreRes.cssClass}`;
    scoreEl.textContent = `${score}/100`;
    scoreEl.style.color = color;
    bar.style.width      = `${score}%`;
    bar.style.background = color;

    toggleBtn.style.display = '';
    // We do NOT change analysis.style.display here; it stays however the user left it (or hidden by default)

    //  Stats 
    shadow.getElementById('vz-entropy').textContent = `${strength.entropy} bits`;
    shadow.getElementById('vz-length').textContent  = `${strength.length}`;
    shadow.getElementById('vz-charset').textContent = `${strength.charsetSize}`;
    shadow.getElementById('vz-variety').textContent = `${strength.varietyCount}/4`;

    //  Char chips 
    setChip(shadow.getElementById('chip-lower'),  strength.hasLower);
    setChip(shadow.getElementById('chip-upper'),  strength.hasUpper);
    setChip(shadow.getElementById('chip-digit'),  strength.hasDigit);
    setChip(shadow.getElementById('chip-symbol'), strength.hasSymbol);

    //  All issues with explanations 
    const issues = collectAllIssues(strength, wordlist, patterns, ucheck);
    const issuesSection = shadow.getElementById('vz-issues-section');
    const issuesList    = shadow.getElementById('vz-issues-list');
    if (issues.length > 0) {
      issuesList.innerHTML = issues.map(i => `
        <div class="vz-issue vz-issue-${i.sev}">
          <span class="vz-issue-dot"></span>
          <div class="vz-issue-body">
            <span class="vz-issue-title">${i.title}</span>
            <span class="vz-issue-reason">${i.reason}</span>
          </div>
        </div>`).join('');
      issuesSection.style.display = '';
    } else {
      issuesList.innerHTML = '<div class="vz-all-good"> No significant issues found</div>';
      issuesSection.style.display = '';
    }

    //  Crack times — only show the scenario relevant to THIS context (web login)
    try {
      const allCrackTimes  = estimateCrackTimes(strength.charsetSize, strength.length);
      const crackSection   = shadow.getElementById('vz-crack-section');
      const crackList      = shadow.getElementById('vz-crack-list');
      // For a web login widget, only Online (throttled) is relevant.
      // Offline GPU cracking applies to data breach scenarios, not website logins.
      const ct = allCrackTimes.find(c => c.id === 'online_throttled') || allCrackTimes[0];
      if (ct) {
        crackList.innerHTML = `
          <div class="vz-crack-row">
            <div class="vz-crack-scenario">
              <span class="vz-crack-name">${ct.label}</span>
              <span class="vz-crack-desc">${ct.desc || ''}</span>
            </div>
            <span class="vz-crack-time vz-crack-${ct.severity}">${ct.display}</span>
          </div>`;
        crackSection.style.display = '';
      }
    } catch (_) { /* bruteforce module optional */ }

    //  Personalized risk
    const personalEl = shadow.getElementById('vz-personal-risk');
    if (personalResult) {
      const { found, rank } = personalResult;
      let badgeLabel, badgeClass, headline, riskReason;
      if (found) {
        if (rank <= 100) {
          badgeLabel = 'CRITICAL';  badgeClass = 'vz-badge-critical';
          headline   = `Targeted Risk — guess #${rank}`;
          riskReason = 'This password appears within the first 100 guesses a targeted attacker would make. Score penalised by 50 pts.';
        } else if (rank <= 1000) {
          badgeLabel = 'HIGH';      badgeClass = 'vz-badge-high';
          headline   = `Targeted Risk — guess #${rank}`;
          riskReason = 'An attacker with knowledge of your personal details would reach this password early. Score penalised by 35 pts.';
        } else if (rank <= 5000) {
          badgeLabel = 'MEDIUM';    badgeClass = 'vz-badge-medium';
          headline   = `Targeted Risk — guess #${rank}`;
          riskReason = 'This password matches a mid-range pattern in your personalised attack profile. Score penalised by 20 pts.';
        } else {
          badgeLabel = 'LOW';       badgeClass = 'vz-badge-low';
          headline   = `Targeted Risk — guess #${rank}`;
          riskReason = 'Found in your personalised dictionary at a low rank — still detectable by a persistent attacker. Score penalised by 10 pts.';
        }
      } else {
        badgeLabel = 'RESISTANT';  badgeClass = 'vz-badge-safe';
        headline   = 'Not in personalised attack profile';
        riskReason = 'This password does not match any entry generated from your personal information.';
      }
      personalEl.innerHTML = `
        <div class="vz-risk-row">
          <span class="vz-risk-badge ${badgeClass}">${badgeLabel}</span>
          <span class="vz-risk-headline">${headline}</span>
        </div>
        <div class="vz-risk-reason">${riskReason}</div>
      `;
      personalEl.style.display = '';
    } else {
      personalEl.style.display = 'none';
    }

    //  Background badge update 
    try {
      chrome.runtime.sendMessage({
        type: 'SCORE_UPDATE', score, category, color, fieldCount: 1,
      }).catch(() => {});
    } catch (_) {}
  }

  //  Issue collector (all issues with reasons) 
  function collectAllIssues(strength, wordlist, patterns, ucheck) {
    const issues = [];

    // Critical
    if (wordlist.exactMatch)
      issues.push({ sev: 'high', title: 'Extremely common password',
        reason: 'This password is on widely-known breach lists and will be tried first by any attacker.' });
    if (wordlist.leetMatch)
      issues.push({ sev: 'high', title: 'Leet-speak variation of a common password',
        reason: 'Replacing letters with numbers (e.g. a4, e3) is a well-known trick that password crackers specifically test.' });
    if (ucheck.contains)
      issues.push({ sev: 'high', title: 'Contains your username',
        reason: 'Including your username makes the password trivially guessable once an attacker knows who you are.' });
    if (ucheck.variation)
      issues.push({ sev: 'high', title: 'Is a username variation',
        reason: 'Simple transformations of your username (reversed, capitalised, with numbers appended) are among the first guesses used in targeted attacks.' });
    if (patterns.keyboard.found)
      issues.push({ sev: 'high', title: `Keyboard walk: "${(patterns.keyboard.matches || [])[0] || ''}"`,
        reason: 'Keyboard sequences (qwerty, asdf, 12345) are in every password cracker\'s standard dictionary.' });
    if (strength.length < 8)
      issues.push({ sev: 'high', title: `Too short (${strength.length} characters)`,
        reason: 'Passwords under 8 characters can be brute-forced in seconds with modern hardware.' });

    // Medium
    if (patterns.sequential.found)
      issues.push({ sev: 'medium', title: `Sequential pattern: "${(patterns.sequential.matches || [])[0] || ''}"`,
        reason: 'Sequential runs of letters or numbers drastically reduce the effective search space for crackers.' });
    if (patterns.repeats.found)
      issues.push({ sev: 'medium', title: `Repeated characters: "${(patterns.repeats.matches || [])[0] || ''}"`,
        reason: 'Repeated characters lower entropy significantly  crackers specifically look for these patterns.' });
    if (patterns.dates && patterns.dates.found)
      issues.push({ sev: 'medium', title: `Date-like pattern: "${(patterns.dates.matches || [])[0] || ''}"`,
        reason: 'Dates (birthdays, anniversaries) are high-priority guesses in both generic and targeted attacks.' });
    if ((wordlist.substringMatches || []).length > 0)
      issues.push({ sev: 'medium', title: `Contains common words: "${wordlist.substringMatches.slice(0, 2).join('", "')}"`,
        reason: 'Dictionary words embedded in a password are easily spotted with substring cracking techniques.' });
    if (ucheck.nearMatch)
      issues.push({ sev: 'medium', title: 'Very similar to your username',
        reason: 'Near-matches and edit-distance variants of your username are standard in targeted wordlists.' });
    if (ucheck.reversed)
      issues.push({ sev: 'medium', title: 'Contains reversed username',
        reason: 'Reversing a word is one of the first transformations password crackers apply.' });

    // Low / Tips
    if (!strength.hasUpper)
      issues.push({ sev: 'low', title: 'No uppercase letters',
        reason: 'Adding uppercase letters multiplies the character search space by ~2×, meaningfully slowing brute-force attacks.' });
    if (!strength.hasLower)
      issues.push({ sev: 'low', title: 'No lowercase letters',
        reason: 'Using only a single case reduces the effective charset size.' });
    if (!strength.hasDigit)
      issues.push({ sev: 'low', title: 'No digits',
        reason: 'Mixing in digits expands the character pool from 52 to 62, adding meaningful entropy.' });
    if (!strength.hasSymbol)
      issues.push({ sev: 'low', title: 'No special characters',
        reason: 'Symbols (!, @, #, $) expand the charset to 95, greatly increasing brute-force time.' });
    if (strength.length < 12 && strength.length >= 8)
      issues.push({ sev: 'low', title: `Could be longer (${strength.length} chars)`,
        reason: 'Each additional character multiplies cracking difficulty. 12+ characters is recommended for sensitive accounts.' });

    return issues;
  }

  function setChip(el, active) {
    if (!el) return;
    el.className = active ? 'vz-chip vz-chip-on' : 'vz-chip vz-chip-off';
  }

  function findNearbyUsername(passwordInput) {
    const form = passwordInput.closest('form') || document;
    const sel  = 'input[type="text"],input[type="email"],input[name*="user"],input[name*="email"],input[id*="user"],input[id*="email"]';
    const candidates = form.querySelectorAll(sel);
    if (candidates.length > 0) return candidates[0].value.trim();
    return '';
  }

  function removeAllWidgets() {
    document.querySelectorAll('.__vz-widget-host').forEach(el => el.remove());
  }

  //  MutationObserver 
  function scanForPasswordFields() {
    const inputs = document.querySelectorAll('input[type="password"]');
    inputs.forEach(injectWidget);
    if (inputs.length > 0) {
      try {
        chrome.runtime.sendMessage({ type: 'FIELDS_DETECTED', count: inputs.length }).catch(() => {});
      } catch (_) {}
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observerTimeout);
    observerTimeout = setTimeout(scanForPasswordFields, 100);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', scanForPasswordFields);
  else
    scanForPasswordFields();

  //  Widget CSS 
  function getWidgetCSS() {
    return `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      .vz-widget {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 12px;
        background: rgba(8, 12, 24, 0.98);
        border: 1px solid rgba(0, 212, 255, 0.28);
        border-radius: 10px;
        padding: 10px 12px;
        color: #e2e8f0;
        backdrop-filter: blur(16px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,212,255,0.08) inset;
        pointer-events: all;
        min-width: 280px;
        max-width: 420px;
        transition: all 0.2s ease;
      }

      /*  Header  */
      .vz-header {
        display: flex; align-items: center; gap: 7px;
        margin-bottom: 7px;
      }
      .vz-shield { display: flex; align-items: center; color: rgba(0,212,255,0.7); flex-shrink: 0; }

      .vz-label { flex: 1; font-weight: 700; font-size: 12px; color: #94a3b8; transition: color 0.3s; }
      .vz-label.vz-weak        { color: #ef4444; }
      .vz-label.vz-moderate    { color: #f59e0b; }
      .vz-label.vz-strong      { color: #84cc16; }
      .vz-label.vz-very-strong { color: #22c55e; }

      .vz-score {
        font-size: 11px; font-weight: 800;
        font-variant-numeric: tabular-nums;
        min-width: 44px; text-align: right;
      }
      .vz-privacy {
        font-size: 9px; color: #334155; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.4px;
        border: 1px solid rgba(255,255,255,0.06);
        padding: 2px 5px; border-radius: 4px;
      }

      /*  Bar  */
      .vz-bar-track {
        height: 3px; background: rgba(255,255,255,0.07);
        border-radius: 2px; overflow: hidden; margin-bottom: 9px;
      }
      .vz-bar-fill {
        height: 100%; border-radius: 2px;
        transition: width 0.4s ease, background 0.3s ease;
      }

      /* ── Toggle Button ── */
      .vz-toggle-btn {
        width: 100%;
        background: transparent;
        border: none;
        border-top: 1px solid rgba(255,255,255,0.05);
        color: #475569;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        padding: 5px 0 2px 0;
        cursor: pointer;
        transition: color 0.2s;
        text-align: center;
        font-family: inherit;
        outline: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
      }
      .vz-toggle-btn:hover { color: #94a3b8; }
      .vz-caret { font-size: 8px; opacity: 0.7; }

      /* ── Stats row ── */
      .vz-stats-row {
        display: flex; gap: 6px; margin-bottom: 7px;
      }
      .vz-stat {
        flex: 1; background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 6px; padding: 5px 6px;
        text-align: center;
      }
      .vz-stat-val {
        display: block; font-size: 11px; font-weight: 800;
        color: rgba(0,212,255,0.9);
        font-variant-numeric: tabular-nums;
        line-height: 1.2;
      }
      .vz-stat-key {
        display: block; font-size: 9px; color: #475569;
        text-transform: uppercase; letter-spacing: 0.3px;
        font-weight: 600; margin-top: 1px;
      }

      /* ── Char chips ── */
      .vz-chips { display: flex; gap: 5px; margin-bottom: 9px; }
      .vz-chip {
        flex: 1; text-align: center; padding: 3px 0;
        border-radius: 5px; font-size: 10px; font-weight: 700;
        font-family: monospace;
        border: 1px solid rgba(255,255,255,0.06);
        background: rgba(255,255,255,0.03);
        color: #334155;
        transition: all 0.2s;
      }
      .vz-chip-on  {
        background: rgba(34,197,94,0.1); border-color: rgba(34,197,94,0.3);
        color: #4ade80; box-shadow: 0 0 6px rgba(34,197,94,0.08);
      }
      .vz-chip-off {
        background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.15);
        color: rgba(239,68,68,0.5);
      }

      /* ── Sections ── */
      .vz-section { margin-bottom: 8px; }
      .vz-section-title {
        font-size: 9px; font-weight: 800; text-transform: uppercase;
        letter-spacing: 0.6px; color: #334155;
        margin-bottom: 5px; padding-bottom: 3px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }

      /* ── Issues list ── */
      .vz-issues-list { display: flex; flex-direction: column; gap: 4px; }

      .vz-issue {
        display: flex; align-items: flex-start; gap: 7px;
        padding: 6px 8px; border-radius: 6px;
        border: 1px solid transparent;
        animation: vzSlide 0.2s ease both;
      }
      @keyframes vzSlide { from { opacity:0; transform:translateX(-4px); } to { opacity:1; transform:none; } }

      .vz-issue-high   { background: rgba(239,68,68,0.07);  border-color: rgba(239,68,68,0.2); }
      .vz-issue-medium { background: rgba(245,158,11,0.07); border-color: rgba(245,158,11,0.2); }
      .vz-issue-low    { background: rgba(59,130,246,0.06); border-color: rgba(59,130,246,0.15); }

      .vz-issue-dot {
        width: 5px; height: 5px; border-radius: 50%;
        flex-shrink: 0; margin-top: 4px;
      }
      .vz-issue-high   .vz-issue-dot { background: #ef4444; box-shadow: 0 0 5px rgba(239,68,68,0.7); }
      .vz-issue-medium .vz-issue-dot { background: #f59e0b; box-shadow: 0 0 5px rgba(245,158,11,0.7); }
      .vz-issue-low    .vz-issue-dot { background: #3b82f6; box-shadow: 0 0 5px rgba(59,130,246,0.7); }

      .vz-issue-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
      .vz-issue-title  { font-size: 11px; font-weight: 700; color: #e2e8f0; line-height: 1.3; }
      .vz-issue-reason { font-size: 10px; color: #64748b; line-height: 1.4; }

      .vz-issue-high   .vz-issue-title { color: #fca5a5; }
      .vz-issue-medium .vz-issue-title { color: #fcd34d; }
      .vz-issue-low    .vz-issue-title { color: #93c5fd; }

      .vz-all-good {
        font-size: 11px; color: #4ade80; font-weight: 600;
        padding: 6px 8px; background: rgba(34,197,94,0.07);
        border: 1px solid rgba(34,197,94,0.2); border-radius: 6px;
      }

      /* ── Crack times ── */
      .vz-crack-list { display: flex; flex-direction: column; gap: 3px; }
      .vz-crack-row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 6px 8px;
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.045);
        border-radius: 6px;
      }
      .vz-crack-scenario { display: flex; flex-direction: column; gap: 1px; flex: 1; }
      .vz-crack-name   { font-size: 10px; font-weight: 700; color: #94a3b8; }
      .vz-crack-desc   { font-size: 9px; color: #475569; }
      .vz-crack-time   { font-size: 11px; font-weight: 800; font-family: 'SF Mono',ui-monospace,monospace;
                          white-space: nowrap; text-align: right; }
      .vz-crack-danger   { color: #ef4444; }
      .vz-crack-warning  { color: #f59e0b; }
      .vz-crack-moderate { color: #84cc16; }
      .vz-crack-safe     { color: #22c55e; }

      /* ── Personalized risk — badge pill system ── */
      .vz-personal-risk {
        margin-top: 6px;
        border-radius: 7px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.02);
      }
      .vz-risk-row {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 10px 4px;
      }
      .vz-risk-badge {
        font-size: 9px; font-weight: 800;
        letter-spacing: 0.8px; text-transform: uppercase;
        padding: 2px 7px; border-radius: 4px;
        flex-shrink: 0;
      }
      .vz-risk-headline {
        font-size: 11px; font-weight: 600; color: #94a3b8;
      }
      .vz-risk-reason {
        font-size: 10px; color: #475569; line-height: 1.4;
        padding: 3px 10px 8px;
      }
      /* Badge colour variants */
      .vz-badge-critical { background: rgba(239,68,68,0.15);  color: #fca5a5; border: 1px solid rgba(239,68,68,0.25); }
      .vz-badge-high     { background: rgba(245,158,11,0.15); color: #fcd34d; border: 1px solid rgba(245,158,11,0.25); }
      .vz-badge-medium   { background: rgba(234,179,8,0.12);  color: #fef08a; border: 1px solid rgba(234,179,8,0.22); }
      .vz-badge-low      { background: rgba(59,130,246,0.12); color: #93c5fd; border: 1px solid rgba(59,130,246,0.22); }
      .vz-badge-safe     { background: rgba(34,197,94,0.12);  color: #86efac; border: 1px solid rgba(34,197,94,0.22); }
    `;
  }

  //  Popup  Content Bridge (INSIDE IIFE  has access to all scoped vars) 
  // BUG FIX: Was previously outside the IIFE, so chrome.runtime.onMessage
  // callback had no access to IIFE-scoped variables like loadDictCache,
  // vzDictReady, etc.  caused ReferenceErrors on every message.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'GET_PASSWORD') {
        let password = '', username = '';
        const focused = document.activeElement;
        if (focused && focused.type === 'password') {
          password = focused.value;
        } else {
          const pwFields = document.querySelectorAll('input[type="password"]');
          if (pwFields.length > 0) password = pwFields[0].value;
        }
        const context   = (focused && focused.closest('form')) || document;
        const userField = context.querySelector(
          'input[type="email"],input[type="text"][name*="user"],input[type="text"][name*="email"],input[id*="user"],input[id*="email"]'
        );
        if (userField) username = userField.value.trim();
        sendResponse({ password, username });
        return true;
      }
    });
  } catch (_) {}

})();

