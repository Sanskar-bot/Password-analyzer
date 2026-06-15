/**
 * content.js  VaultZero Content Script  v4
 *
 * Unified two-view widget per password field.
 *
 * STATE MACHINE
 *   States:      ANALYZER (default) | GENERATOR (user opt-in)
 *   Transitions: ONLY via explicit button clicks
 *     ANALYZER + click "✨ Generate Password" → GENERATOR
 *     GENERATOR + click "← Back to Analysis"  → ANALYZER
 *     GENERATOR + click "✓ Use Password"       → fills field → ANALYZER
 *
 * GUARANTEES
 *   - ONE host element per password input field (no competing panels)
 *   - focus / blur events NEVER change currentView
 *   - eye-icon (type=password→text mutation) NEVER affects state
 *   - Personalized score is merged directly into the Analyzer view
 *   - Generator button is hidden on login-only pages
 */

(function () {
  'use strict';

  if (window.__vaultzeroInjected) return;
  window.__vaultzeroInjected = true;

  // ── Extension context guard ──────────────────────────────────────────────
  function ctxValid() {
    try { return !!chrome.runtime?.id; }
    catch (_) { return false; }
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  let settings = {
    enableWidget:    true,
    enableGenerator: true,
    enableBadge:     true,
  };
  try {
    chrome.storage.sync.get('settings', (data) => {
      if (data.settings) settings = { ...settings, ...data.settings };
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.settings) {
        settings = { ...settings, ...changes.settings.newValue };
        if (!settings.enableWidget) removeAllWidgets();
      }
    });
  } catch (_) { /* context invalidated on stale tab */ }

  // ── Widget registry ───────────────────────────────────────────────────────
  const widgetMap = new WeakMap();
  let observerTimeout = null;

  // ── Analysis modules (lazy) ───────────────────────────────────────────────
  let analysisReady = false;
  let analyseStrength, detectPatterns, checkWordlist, checkUsername,
      computeScore, estimateCrackTimes;

  async function loadModules() {
    if (analysisReady || !ctxValid()) return;
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
      if (!String(e).includes('context invalidated'))
        console.warn('[VaultZero] Module load failed:', e);
    }
  }

  // ── Dict cache ────────────────────────────────────────────────────────────
  let vzDictLookup  = null;
  let vzDictReady   = false;
  let vzDictLoading = false;

  async function loadDictCache() {
    if (vzDictReady || vzDictLoading || !ctxValid()) return;
    vzDictLoading = true;
    try {
      const cache = await import(chrome.runtime.getURL('modules/dictCache.js'));
      await cache.warmCache();
      vzDictLookup = cache.lookup;
      vzDictReady  = true;
      if (ctxValid()) {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg.type === 'DICT_UPDATED') {
            cache.invalidate();
            vzDictReady = false;
            vzDictLoading = false;
            loadDictCache();
          }
        });
      }
    } catch (e) {
      if (!String(e).includes('context invalidated'))
        console.warn('[VaultZero] dictCache load failed:', e);
    } finally {
      vzDictLoading = false;
    }
  }

  // ── Context modules (lazy — only needed for generator) ────────────────────
  let contextModulesPromise = null;

  function getContextModules() {
    if (!ctxValid()) return Promise.reject(new Error('Extension context invalidated'));
    if (!contextModulesPromise) {
      try {
        contextModulesPromise = Promise.all([
          import(chrome.runtime.getURL('modules/contextDetector.js')),
          import(chrome.runtime.getURL('modules/websiteContext.js')),
          import(chrome.runtime.getURL('modules/profilePasswordGenerator.js')),
          import(chrome.runtime.getURL('modules/generatorValidator.js')),
          import(chrome.runtime.getURL('modules/profileStore.js')),
          import(chrome.runtime.getURL('modules/dictCache.js')),
        ]).then(([detector, website, generator, validator, profileStore, dictCache]) => ({
          detector, website, generator, validator, profileStore, dictCache,
        })).catch((err) => {
          contextModulesPromise = null;
          throw err;
        });
      } catch (err) {
        contextModulesPromise = null;
        return Promise.reject(err);
      }
    }
    return contextModulesPromise;
  }

  // URL signals for form context boost
  const SIGNUP_PATH_RE = /\/(sign[-_]?up|signup|register|registration|join|create[-_]?account|new[-_]?account|emailsignup|enroll|onboarding|welcome)/i;
  const CHANGE_PATH_RE = /\/(change[-_]?password|reset[-_]?password|update[-_]?password|forgot[-_]?password|set[-_]?password|recover|password[-_]?reset)/i;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function dispatchFieldValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function nearbyUsername(input) {
    const form = input.closest('form') || document;
    const field = form.querySelector(
      'input[type="email"],input[autocomplete="username"],' +
      'input[name*="user" i],input[name*="email" i],' +
      'input[id*="user" i],input[id*="email" i]'
    );
    return field?.value?.trim() || '';
  }

  function scoreColor(v) { return v >= 80 ? '#4ade80' : v >= 55 ? '#f59e0b' : '#f87171'; }
  function scoreClass(v) { return v >= 80 ? 'ok' : v >= 55 ? 'warn' : 'bad'; }

  // ── State machine ─────────────────────────────────────────────────────────
  // THIS is the ONLY function that changes which view is visible.
  // It MUST only be called from explicit button click handlers.
  function setView(state, view) {
    state.currentView = view;
    state.analyzerEl.style.display  = view === 'ANALYZER'  ? '' : 'none';
    state.generatorEl.style.display = view === 'GENERATOR' ? '' : 'none';
  }

  // ── Unified widget injection ───────────────────────────────────────────────
  function injectUnifiedWidget(input) {
    if (!settings.enableWidget) return;
    if (widgetMap.has(input)) return;
    // Inject once, keyed by element reference — not by type attribute.
    // This makes the widget immune to eye-icon (type=password↔text) changes.
    if (input.getAttribute('type') !== 'password' && input.type !== 'password') return;

    const host = document.createElement('div');
    host.className = '__vz-widget-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;display:none;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = getUnifiedCSS();
    shadow.appendChild(styleEl);

    const container = document.createElement('div');
    container.className = 'vz-widget';
    container.innerHTML = buildAnalyzerHTML() + buildGeneratorHTML();
    shadow.appendChild(container);

    const analyzerEl  = container.querySelector('.vz-view-analyzer');
    const generatorEl = container.querySelector('.vz-view-generator');

    // ── Widget state ──────────────────────────────────────────────────────
    const state = {
      host, shadow, input,
      analyzerEl, generatorEl,
      currentView:   'ANALYZER',  // the single source of truth
      lastPassword:  '',
      context:       null,        // null = not yet checked, false = not eligible
      genValidation: null,
      _editTimer:    null,
    };
    widgetMap.set(input, state);

    // ── Positioning ───────────────────────────────────────────────────────
    function reposition() {
      const rect = input.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      host.style.left = `${rect.left}px`;
      host.style.top  = `${rect.bottom + 6}px`;
      container.style.width = `${Math.max(rect.width, 300)}px`;
    }
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });
    reposition();

    // ── Panel visibility ──────────────────────────────────────────────────
    // Visibility follows focus ONLY.  currentView is NEVER touched here.
    function showPanel() { host.style.display = ''; reposition(); }
    function hidePanel()  { host.style.display = 'none'; }

    // Prevent the panel from stealing focus from the password input when
    // the user clicks buttons inside it — except the generator password
    // output field (vz-gen-pw) which needs focus to be editable.
    host.addEventListener('pointerdown', (e) => {
      const isGenPw = e.composedPath().some(
        el => el.classList && el.classList.contains('vz-gen-pw')
      );
      if (!isGenPw) e.preventDefault();
    });

    // Show on focus, load modules in the background.
    // NOTE: focus fires even when eye-icon changes type → we only
    //       show/hide the panel here, NEVER change currentView.
    input.addEventListener('focus', () => {
      showPanel();
      loadModules();
      loadDictCache();
      // Lazy context detection: determines if "Generate Password" button shows.
      // This is async and does NOT block the panel from appearing.
      detectContext(state);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        // Keep open if focus moved into the shadow (e.g. user editing gen-pw)
        if (shadow.activeElement || document.activeElement === host) return;
        hidePanel();
      }, 300);
    });

    // Generator password field blur: keep panel open if focus returns to input
    const genPwEl = generatorEl.querySelector('.vz-gen-pw');
    genPwEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement === input) return;
        if (!shadow.activeElement) hidePanel();
      }, 300);
    });

    // Already focused at injection time (dynamically rendered forms)
    if (document.activeElement === input) {
      showPanel();
      loadModules();
      loadDictCache();
      detectContext(state);
    }

    // ── Polling fallback (React / SPA) ────────────────────────────────────
    // React stores value in a fiber, not the DOM; listen for missed changes.
    let pollInterval = null;
    input.addEventListener('focus', () => {
      clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (input.value !== state.lastPassword) onValueChange();
      }, 250);
    });
    input.addEventListener('blur', () => {
      clearInterval(pollInterval);
      pollInterval = null;
    });

    // ── Value change → analyzer update ────────────────────────────────────
    let debounceTimer = null;
    function onValueChange() {
      reposition();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runAnalysis(input, state), 120);
    }
    input.addEventListener('input',   onValueChange);
    input.addEventListener('keyup',   onValueChange);
    input.addEventListener('keydown', onValueChange);
    input.addEventListener('change',  onValueChange);

    // ── ANALYZER: Details toggle ──────────────────────────────────────────
    const btnDetails   = analyzerEl.querySelector('.vz-toggle-btn');
    const analysisDiv  = analyzerEl.querySelector('.vz-analysis');
    const caretEl      = btnDetails.querySelector('.vz-caret');
    const btnTextEl    = btnDetails.querySelector('.vz-btn-text');
    btnDetails.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      const open = analysisDiv.style.display !== 'none';
      analysisDiv.style.display = open ? 'none' : '';
      btnTextEl.textContent     = open ? 'Details '   : 'Collapse ';
      caretEl.innerHTML         = open ? '&#9660;'    : '&#9650;';
    });

    // ── ANALYZER → GENERATOR (ONLY explicit click) ────────────────────────
    const btnGenTrigger = analyzerEl.querySelector('.btn-gen-trigger');
    btnGenTrigger.addEventListener('click', () => {
      setView(state, 'GENERATOR');   // ← ONLY state transition
      launchGenerator(state);
    });

    // ── GENERATOR → ANALYZER (ONLY explicit click) ────────────────────────
    const btnBack = generatorEl.querySelector('.btn-back');
    btnBack.addEventListener('click', () => {
      setView(state, 'ANALYZER');   // ← ONLY state transition
    });

    // ── GENERATOR: Generate / Regenerate / Copy ───────────────────────────
    generatorEl.querySelector('.btn-generate').addEventListener('click', () => doGenerate(state));
    generatorEl.querySelector('.btn-regen').addEventListener('click',    () => doGenerate(state));
    generatorEl.querySelector('.btn-copy').addEventListener('click', async () => {
      if (!genPwEl.value) return;
      await navigator.clipboard.writeText(genPwEl.value);
      const btn = generatorEl.querySelector('.btn-copy');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
    });

    // Live re-validation as user edits the generated password field
    genPwEl.addEventListener('input', () => {
      clearTimeout(state._editTimer);
      state._editTimer = setTimeout(() => revalidateGenerated(state), 180);
    });

    // ── GENERATOR: Use Password → fill field → back to ANALYZER ──────────
    generatorEl.querySelector('.btn-apply').addEventListener('click', async () => {
      if (!state.genValidation?.passed) {
        await revalidateGenerated(state);
        if (!state.genValidation?.passed) return;
      }
      dispatchFieldValue(input, genPwEl.value);
      if (state.context?.confirmationField) {
        dispatchFieldValue(state.context.confirmationField, genPwEl.value);
      }
      if (ctxValid() && state.context?.modules) {
        try {
          await state.context.modules.validator.rememberPasswordSignature(
            genPwEl.value,
            state.context.websiteCtx?.domain || ''
          );
        } catch (_) {}
      }
      setView(state, 'ANALYZER');   // ← ONLY state transition
      input.focus();
      setTimeout(() => runAnalysis(input, state), 50);
    });
  }

  // ── Context detection (async, non-blocking) ───────────────────────────────
  // Determines if the "✨ Generate Password" button should be visible.
  // NEVER changes currentView.
  async function detectContext(state) {
    if (state.context !== null) return;  // already done / in-progress guard
    state.context = false;              // mark in-progress so we don't double-call

    try {
      const modules    = await getContextModules();
      let context      = modules.detector.detectPasswordContext(document);
      const websiteCtx = modules.website.extractWebsiteContextFromDocument(document, window.location);

      // URL-path boost for SPA forms where DOM context isn't available yet
      if (!context.eligible) {
        const path     = window.location.pathname + window.location.search;
        const visiblePw = [...document.querySelectorAll('input[type="password"]')]
          .filter(el => !el.disabled && el.offsetParent !== null);
        if (visiblePw.length > 0) {
          if (SIGNUP_PATH_RE.test(path)) {
            context = { type: 'account-creation', eligible: true,
              targetField: visiblePw[0], confirmationField: visiblePw[1] || null,
              confidence: 'medium', signals: ['url-path'] };
          } else if (CHANGE_PATH_RE.test(path)) {
            context = { type: 'password-change', eligible: true,
              targetField: visiblePw[0], confirmationField: visiblePw[1] || null,
              confidence: 'medium', signals: ['url-path'] };
          }
        }
      }

      // Store resolved context
      state.context = context.eligible
        ? { ...context, websiteCtx, modules }
        : false;

      // Show or hide the Generate button based on eligibility
      const btnGenTrigger = state.analyzerEl.querySelector('.btn-gen-trigger');
      if (state.context && settings.enableGenerator) {
        btnGenTrigger.style.display = '';
      } else {
        btnGenTrigger.style.display = 'none';
      }

      // Inform background service worker
      if (ctxValid()) {
        chrome.runtime.sendMessage({
          type:          'NEW_PASSWORD_CONTEXT',
          context:       modules.detector.serializePasswordContext(context),
          isNewPassword: context.eligible,
          url:           window.location.hostname,
          websiteContext: websiteCtx,
        }).catch(() => {});
      }
    } catch (e) {
      state.context = false;
      if (!String(e).includes('context invalidated'))
        console.warn('[VaultZero] Context detection failed:', e);
    }
  }

  // ── Generator: lazy init & auto-generate on first open ───────────────────
  async function launchGenerator(state) {
    // Update the context badge in the generator header
    if (state.context && state.context.websiteCtx) {
      const wc    = state.context.websiteCtx;
      const ctxEl = state.generatorEl.querySelector('.vz-gen-ctx');
      const kind  = state.context.type === 'password-change' ? 'Change' : 'New Account';
      if (ctxEl) ctxEl.textContent = `${wc.brand || 'Account'} · ${kind}`;
    }
    // If there's already a generated password in the field, don't re-generate
    const genPwEl = state.generatorEl.querySelector('.vz-gen-pw');
    if (genPwEl.value) return;
    // Auto-generate on first open
    doGenerate(state);
  }

  // ── Generator: build opts from profile + dict cache ───────────────────────
  async function getGenOptions(state) {
    if (!state.context) return null;
    const { modules, websiteCtx } = state.context;
    try {
      const fresh   = await modules.profileStore.getProfile();
      const profile = (fresh && typeof fresh === 'object') ? fresh : {};
      await modules.dictCache.warmCache();
      return {
        profile,
        websiteContext: websiteCtx,
        username:       nearbyUsername(state.input),
        validation: {
          dictionaryLookup: modules.dictCache.lookup,
          dictionarySize:   modules.dictCache.getSize(),
        },
        modules,
      };
    } catch (_) { return null; }
  }

  // ── Generator: generate a new password ───────────────────────────────────
  async function doGenerate(state) {
    if (!state.context) {
      const reasonEl = state.generatorEl.querySelector('.vz-gen-reason');
      reasonEl.textContent = 'Generator not available on this form type.';
      reasonEl.className   = 'vz-gen-reason failed';
      return;
    }

    const btnGenerate = state.generatorEl.querySelector('.btn-generate');
    const btnRegen    = state.generatorEl.querySelector('.btn-regen');
    const reasonEl    = state.generatorEl.querySelector('.vz-gen-reason');
    const genPwEl     = state.generatorEl.querySelector('.vz-gen-pw');
    const btnApply    = state.generatorEl.querySelector('.btn-apply');
    const scoresEl    = state.generatorEl.querySelector('.vz-gen-scores');

    btnGenerate.disabled = true;
    btnRegen.disabled    = true;
    reasonEl.textContent = 'Generating locally…';
    reasonEl.className   = 'vz-gen-reason';

    try {
      const opts = await getGenOptions(state);
      if (!opts) throw new Error('Profile modules unavailable.');

      const result = await opts.modules.generator.generateContextAwarePassword({
        profile:        opts.profile,
        websiteContext: opts.websiteContext,
        username:       opts.username,
        validation:     opts.validation,
        options:        { wordCount: 3, symbols: true },
      });

      genPwEl.value = result.password;
      state.genValidation = result.validation;

      scoresEl.style.display = '';
      renderGenValidation(state, result.validation);

      // Reveal post-generate actions
      state.generatorEl.querySelector('.btn-regen').hidden = false;
      state.generatorEl.querySelector('.btn-copy').hidden  = false;
      btnApply.hidden   = false;
      btnApply.disabled = !result.validation.passed;

    } catch (error) {
      reasonEl.textContent = error.message || 'No candidate passed all checks — try again.';
      reasonEl.className   = 'vz-gen-reason failed';
    } finally {
      btnGenerate.disabled = false;
      btnRegen.disabled    = false;
    }
  }

  // ── Generator: re-validate user-edited password ───────────────────────────
  async function revalidateGenerated(state) {
    const genPwEl = state.generatorEl.querySelector('.vz-gen-pw');
    if (!genPwEl.value || !state.context) return;
    const opts = await getGenOptions(state);
    if (!opts) return;
    try {
      const result = await opts.modules.validator.validateGeneratedPassword(genPwEl.value, {
        profile:            opts.profile,
        username:           opts.username,
        domain:             opts.websiteContext?.domain || '',
        allowProfileAnchors: true,
        ...opts.validation,
      });
      state.genValidation = result;
      renderGenValidation(state, result);
    } catch (_) {}
  }

  // ── Generator: render validation result in generator view ─────────────────
  function renderGenValidation(state, result) {
    const strFill = state.generatorEl.querySelector('.str-fill');
    const strNum  = state.generatorEl.querySelector('.str-num');
    const perFill = state.generatorEl.querySelector('.per-fill');
    const perNum  = state.generatorEl.querySelector('.per-num');
    const reasonEl= state.generatorEl.querySelector('.vz-gen-reason');
    const btnApply= state.generatorEl.querySelector('.btn-apply');
    if (!strFill) return;

    const s = result.strengthScore;
    const p = result.personalizedAttackScore;

    strFill.style.width      = `${s}%`;
    strFill.style.background = scoreColor(s);
    strNum.textContent       = s;
    strNum.className         = `vz-gen-score-num ${scoreClass(s)}`;
    perFill.style.width      = `${p}%`;
    perFill.style.background = scoreColor(p);
    perNum.textContent       = p;
    perNum.className         = `vz-gen-score-num ${scoreClass(p)}`;

    const reasons = result.reasoning
      || (result.passed ? 'Password meets all security requirements.' : (result.failures || []).join(' · '));
    reasonEl.textContent = reasons;
    reasonEl.className   = `vz-gen-reason ${result.passed ? 'passed' : 'failed'}`;

    if (btnApply) {
      btnApply.hidden   = false;
      btnApply.disabled = !result.passed;
    }
  }

  // ── Analysis runner (ANALYZER view) ─────────────────────────────────────
  async function runAnalysis(input, state) {
    const password = input.value;
    if (password === state.lastPassword) return;
    state.lastPassword = password;

    const shadow = state.shadow;

    const labelEl    = shadow.querySelector('.vz-label');
    const scoreEl    = shadow.querySelector('.vz-score');
    const barFill    = shadow.querySelector('.vz-bar-fill');
    const toggleBtn  = shadow.querySelector('.vz-toggle-btn');
    const analysisEl = shadow.querySelector('.vz-analysis');
    const persRowEl  = shadow.querySelector('.vz-pers-row');

    if (password.length === 0) {
      labelEl.textContent = 'Enter password';
      labelEl.className   = 'vz-label';
      scoreEl.textContent = '';
      barFill.style.width = '0%';
      analysisEl.style.display = 'none';
      toggleBtn.style.display  = 'none';
      if (persRowEl) persRowEl.style.display = 'none';
      return;
    }

    await loadModules();
    if (!analysisReady) return;

    const username     = nearbyUsername(input);
    const strength     = analyseStrength(password);
    const patterns     = detectPatterns(password);
    const wordlist     = checkWordlist(password);
    const ucheck       = checkUsername(password, username);
    const personalResult = (vzDictReady && vzDictLookup) ? vzDictLookup(password) : null;

    const scoreRes = computeScore(strength, wordlist, patterns, ucheck, personalResult);
    const { score, category, color } = scoreRes;
    const cssClass = scoreRes.cssClass;

    // ── Header ────────────────────────────────────────────────────────────
    labelEl.textContent = category;
    labelEl.className   = `vz-label vz-${cssClass}`;
    scoreEl.textContent = `${score}/100`;
    scoreEl.style.color  = color;
    barFill.style.width      = `${score}%`;
    barFill.style.background = color;
    toggleBtn.style.display  = '';

    // ── Personalized score row (merged into analyzer) ─────────────────────
    if (persRowEl && personalResult) {
      const persScoreEl = persRowEl.querySelector('.vz-pers-score');
      const persLabelEl = persRowEl.querySelector('.vz-pers-label');
      if (personalResult.found) {
        const { rank } = personalResult;
        const [risk, cls] =
          rank <= 100  ? ['Critical Risk', 'bad']  :
          rank <= 1000 ? ['High Risk',     'bad']  :
          rank <= 5000 ? ['Medium Risk',   'warn'] :
                         ['Low Risk',      'warn'];
        persScoreEl.textContent = `🎯 Personalized: ${risk}`;
        persScoreEl.className   = `vz-pers-score ${cls}`;
        persLabelEl.textContent = `Guess #${rank.toLocaleString()}`;
      } else {
        persScoreEl.textContent = '🎯 Personalized: Resistant';
        persScoreEl.className   = 'vz-pers-score ok';
        persLabelEl.textContent = 'Not in attack profile';
      }
      persRowEl.style.display = '';
    } else if (persRowEl) {
      persRowEl.style.display = 'none';
    }

    // ── Stats ─────────────────────────────────────────────────────────────
    shadow.querySelector('.vz-entropy').textContent = `${strength.entropy} bits`;
    shadow.querySelector('.vz-length').textContent  = `${strength.length}`;
    shadow.querySelector('.vz-charset').textContent = `${strength.charsetSize}`;
    shadow.querySelector('.vz-variety').textContent = `${strength.varietyCount}/4`;

    // ── Char chips ────────────────────────────────────────────────────────
    setChip(shadow.querySelector('#chip-lower'),  strength.hasLower);
    setChip(shadow.querySelector('#chip-upper'),  strength.hasUpper);
    setChip(shadow.querySelector('#chip-digit'),  strength.hasDigit);
    setChip(shadow.querySelector('#chip-symbol'), strength.hasSymbol);

    // ── Issues — compact chip tiles with hover/tap tooltips ─────────────
    const issues        = collectAllIssues(strength, wordlist, patterns, ucheck);
    const issuesSection = shadow.querySelector('.vz-issues-section');
    const issuesList    = shadow.querySelector('.vz-issues-list');
    if (issues.length > 0) {
      const icon = { high: '⛔', medium: '⚠', low: '●' };
      const fix  = { high: 'Critical — change this immediately.', medium: 'Warning — reduces your security score.', low: 'Tip — applying this improves strength.' };
      issuesList.innerHTML = issues.map((i, idx) => `
        <button class="vz-itile vz-itile-${i.sev}" data-idx="${idx}" type="button" aria-label="${i.title}">
          <span class="vz-itile-icon" aria-hidden="true">${icon[i.sev] || '⚠'}</span>
          <span class="vz-itile-label">${i.title}</span>
          <div class="vz-itile-tip" role="tooltip">
            <div class="vz-tip-header vz-tip-${i.sev}">${i.title}</div>
            <div class="vz-tip-body">${i.reason}</div>
            <div class="vz-tip-fix">${fix[i.sev]}</div>
          </div>
        </button>`).join('');
      // Touch tap-to-toggle: close others, open tapped
      issuesList.addEventListener('click', (e) => {
        const tile = e.target.closest('.vz-itile');
        if (!tile) return;
        const isOpen = tile.hasAttribute('data-open');
        issuesList.querySelectorAll('.vz-itile[data-open]').forEach(t => t.removeAttribute('data-open'));
        if (!isOpen) tile.setAttribute('data-open', '');
      }, { once: false });
    } else {
      issuesList.innerHTML = '<div class="vz-all-good">✓ No significant issues found</div>';
    }
    issuesSection.style.display = '';

    // ── Crack time ────────────────────────────────────────────────────────
    try {
      const allCrack  = estimateCrackTimes(strength.charsetSize, strength.length);
      const crackSection = shadow.querySelector('.vz-crack-section');
      const crackList    = shadow.querySelector('.vz-crack-list');
      const ct = allCrack.find(c => c.id === 'online_throttled') || allCrack[0];
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

    // ── Personalized risk detail (inside expandable Details section) ──────
    const personalEl = shadow.querySelector('.vz-personal-risk');
    if (personalEl && personalResult) {
      const { found, rank } = personalResult;
      let badgeLabel, badgeClass, headline, riskReason;
      if (found) {
        if (rank <= 100)       { badgeLabel = 'CRITICAL'; badgeClass = 'vz-badge-critical'; headline = `Targeted Risk — guess #${rank}`; riskReason = 'This password appears within the first 100 guesses a targeted attacker would make. Score penalised by 50 pts.'; }
        else if (rank <= 1000) { badgeLabel = 'HIGH';     badgeClass = 'vz-badge-high';     headline = `Targeted Risk — guess #${rank}`; riskReason = 'An attacker with knowledge of your personal details would reach this password early. Score penalised by 35 pts.'; }
        else if (rank <= 5000) { badgeLabel = 'MEDIUM';   badgeClass = 'vz-badge-medium';   headline = `Targeted Risk — guess #${rank}`; riskReason = 'This password matches a mid-range pattern in your personalised attack profile. Score penalised by 20 pts.'; }
        else                   { badgeLabel = 'LOW';      badgeClass = 'vz-badge-low';      headline = `Targeted Risk — guess #${rank}`; riskReason = 'Found in your personalised dictionary at a low rank — still detectable by a persistent attacker. Score penalised by 10 pts.'; }
      } else {
        badgeLabel = 'RESISTANT'; badgeClass = 'vz-badge-safe';
        headline   = 'Not in personalised attack profile';
        riskReason = 'This password does not match any entry generated from your personal information.';
      }
      personalEl.innerHTML = `
        <div class="vz-risk-row">
          <span class="vz-risk-badge ${badgeClass}">${badgeLabel}</span>
          <span class="vz-risk-headline">${headline}</span>
        </div>
        <div class="vz-risk-reason">${riskReason}</div>`;
      personalEl.style.display = '';
    } else if (personalEl) {
      personalEl.style.display = 'none';
    }

    // ── Badge update ──────────────────────────────────────────────────────
    if (ctxValid()) {
      try {
        chrome.runtime.sendMessage({
          type: 'SCORE_UPDATE', score, category, color, fieldCount: 1,
        }).catch(() => {});
      } catch (_) {}
    }
  }

  // ── DOM: Analyzer view ────────────────────────────────────────────────────
  function buildAnalyzerHTML() {
    return `
    <div class="vz-view-analyzer">

      <div class="vz-header">
        <span class="vz-shield" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L3 6v6c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V6L12 2z"/>
          </svg>
        </span>
        <span class="vz-label">Enter password</span>
        <span class="vz-score"></span>
        <span class="vz-privacy">Local</span>
      </div>

      <div class="vz-bar-track">
        <div class="vz-bar-fill" style="width:0%"></div>
      </div>

      <div class="vz-pers-row" style="display:none">
        <span class="vz-pers-score"></span>
        <span class="vz-pers-label"></span>
      </div>

      <button class="vz-toggle-btn" style="display:none" aria-label="Toggle details">
        <span class="vz-btn-text">Details </span><span class="vz-caret">&#9660;</span>
      </button>

      <div class="vz-analysis" style="display:none">
        <div class="vz-stats-row">
          <div class="vz-stat"><span class="vz-stat-val vz-entropy"></span><span class="vz-stat-key">Entropy</span></div>
          <div class="vz-stat"><span class="vz-stat-val vz-length"></span><span class="vz-stat-key">Length</span></div>
          <div class="vz-stat"><span class="vz-stat-val vz-charset"></span><span class="vz-stat-key">Charset</span></div>
          <div class="vz-stat"><span class="vz-stat-val vz-variety"></span><span class="vz-stat-key">Classes</span></div>
        </div>
        <div class="vz-chips">
          <span class="vz-chip" id="chip-lower">a-z</span>
          <span class="vz-chip" id="chip-upper">A-Z</span>
          <span class="vz-chip" id="chip-digit">0-9</span>
          <span class="vz-chip" id="chip-symbol">!@#</span>
        </div>
        <div class="vz-section vz-issues-section" style="display:none">
          <div class="vz-section-title">Issues Found</div>
          <div class="vz-issues-list"></div>
        </div>
        <div class="vz-section vz-crack-section" style="display:none">
          <div class="vz-section-title">Online Login Resistance</div>
          <div class="vz-crack-list"></div>
        </div>
        <div class="vz-personal-risk" style="display:none"></div>
      </div>

      <div class="vz-gen-trigger-row">
        <button class="btn-gen-trigger" style="display:none" aria-label="Open password generator">
          ✨ Generate Password
        </button>
      </div>

    </div>`;
  }

  // ── DOM: Generator view ────────────────────────────────────────────────────
  function buildGeneratorHTML() {
    return `
    <div class="vz-view-generator" style="display:none">

      <div class="vz-gen-head">
        <button class="btn-back" aria-label="Back to analyzer">← Back to Analysis</button>
        <span class="vz-gen-ctx"></span>
      </div>

      <input class="vz-gen-pw" type="text" autocomplete="off" spellcheck="false"
             placeholder="Click Generate to create a strong password"
             aria-label="Generated password" />

      <div class="vz-gen-scores" style="display:none">
        <div class="vz-gen-score-row">
          <span class="vz-gen-score-label">Strength</span>
          <div class="vz-gen-score-bar"><div class="vz-gen-score-fill str-fill" style="width:0%"></div></div>
          <span class="vz-gen-score-num str-num">--</span>
        </div>
        <div class="vz-gen-score-row">
          <span class="vz-gen-score-label">Personalized</span>
          <div class="vz-gen-score-bar"><div class="vz-gen-score-fill per-fill" style="width:0%"></div></div>
          <span class="vz-gen-score-num per-num">--</span>
        </div>
      </div>

      <div class="vz-gen-reason">Generate a strong, memorable password for this account.</div>

      <div class="vz-gen-actions">
        <button class="btn-generate btn-primary">Generate</button>
        <button class="btn-regen" hidden>Regenerate</button>
        <button class="btn-copy"  hidden>Copy</button>
        <button class="btn-apply btn-apply-style" hidden disabled>✓ Use Password</button>
      </div>

    </div>`;
  }

  // ── Issue collector (logic unchanged from v3) ─────────────────────────────
  function collectAllIssues(strength, wordlist, patterns, ucheck) {
    const issues = [];
    // Critical
    if (wordlist.exactMatch)
      issues.push({ sev: 'high', title: 'Extremely common password', reason: 'This password is on widely-known breach lists and will be tried first by any attacker.' });
    if (wordlist.leetMatch)
      issues.push({ sev: 'high', title: 'Leet-speak variation of a common password', reason: 'Replacing letters with numbers (e.g. a→4, e→3) is a well-known trick that password crackers specifically test.' });
    if (ucheck.contains)
      issues.push({ sev: 'high', title: 'Contains your username', reason: 'Including your username makes the password trivially guessable once an attacker knows who you are.' });
    if (ucheck.variation)
      issues.push({ sev: 'high', title: 'Is a username variation', reason: 'Simple transformations of your username (reversed, capitalised, with numbers appended) are among the first guesses used in targeted attacks.' });
    if (patterns.keyboard.found)
      issues.push({ sev: 'high', title: `Keyboard walk: "${(patterns.keyboard.matches || [])[0] || ''}"`, reason: 'Keyboard sequences (qwerty, asdf, 12345) are in every password cracker\'s standard dictionary.' });
    if (strength.length < 8)
      issues.push({ sev: 'high', title: `Too short (${strength.length} characters)`, reason: 'Passwords under 8 characters can be brute-forced in seconds with modern hardware.' });
    // Medium
    if (patterns.sequential.found)
      issues.push({ sev: 'medium', title: `Sequential pattern: "${(patterns.sequential.matches || [])[0] || ''}"`, reason: 'Sequential runs of letters or numbers drastically reduce the effective search space for crackers.' });
    if (patterns.repeats.found)
      issues.push({ sev: 'medium', title: `Repeated characters: "${(patterns.repeats.matches || [])[0] || ''}"`, reason: 'Repeated characters lower entropy significantly — crackers specifically look for these patterns.' });
    if (patterns.dates && patterns.dates.found)
      issues.push({ sev: 'medium', title: `Date-like pattern: "${(patterns.dates.matches || [])[0] || ''}"`, reason: 'Dates (birthdays, anniversaries) are high-priority guesses in both generic and targeted attacks.' });
    if ((wordlist.substringMatches || []).length > 0)
      issues.push({ sev: 'medium', title: `Contains common words: "${wordlist.substringMatches.slice(0, 2).join('", "')}"`, reason: 'Dictionary words embedded in a password are easily spotted with substring cracking techniques.' });
    if (ucheck.nearMatch)
      issues.push({ sev: 'medium', title: 'Very similar to your username', reason: 'Near-matches and edit-distance variants of your username are standard in targeted wordlists.' });
    if (ucheck.reversed)
      issues.push({ sev: 'medium', title: 'Contains reversed username', reason: 'Reversing a word is one of the first transformations password crackers apply.' });
    // Low / Tips
    if (!strength.hasUpper)
      issues.push({ sev: 'low', title: 'No uppercase letters', reason: 'Adding uppercase letters multiplies the character search space by ~2×, meaningfully slowing brute-force attacks.' });
    if (!strength.hasLower)
      issues.push({ sev: 'low', title: 'No lowercase letters', reason: 'Using only a single case reduces the effective charset size.' });
    if (!strength.hasDigit)
      issues.push({ sev: 'low', title: 'No digits', reason: 'Mixing in digits expands the character pool from 52 to 62, adding meaningful entropy.' });
    if (!strength.hasSymbol)
      issues.push({ sev: 'low', title: 'No special characters', reason: 'Symbols (!, @, #, $) expand the charset to 95, greatly increasing brute-force time.' });
    if (strength.length < 12 && strength.length >= 8)
      issues.push({ sev: 'low', title: `Could be longer (${strength.length} chars)`, reason: 'Each additional character multiplies cracking difficulty. 12+ characters is recommended for sensitive accounts.' });
    return issues;
  }

  function setChip(el, active) {
    if (!el) return;
    el.className = active ? 'vz-chip vz-chip-on' : 'vz-chip vz-chip-off';
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  function removeAllWidgets() {
    document.querySelectorAll('.__vz-widget-host').forEach(el => el.remove());
  }

  // ── MutationObserver: scan for password fields ────────────────────────────
  function scanForPasswordFields() {
    const inputs = document.querySelectorAll('input[type="password"]');
    inputs.forEach(injectUnifiedWidget);
    if (inputs.length > 0 && ctxValid()) {
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

  // ── Unified CSS ────────────────────────────────────────────────────────────
  function getUnifiedCSS() {
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
        min-width: 300px;
        max-width: 420px;
      }

      /* ═══ ANALYZER VIEW ═══════════════════════════════════════════════════ */

      .vz-header {
        display: flex; align-items: center; gap: 7px; margin-bottom: 7px;
      }
      .vz-shield { display: flex; align-items: center; color: rgba(0,212,255,0.7); flex-shrink: 0; }

      .vz-label { flex: 1; font-weight: 700; font-size: 12px; color: #94a3b8; transition: color 0.3s; }
      .vz-label.vz-weak        { color: #ef4444; }
      .vz-label.vz-moderate    { color: #f59e0b; }
      .vz-label.vz-strong      { color: #84cc16; }
      .vz-label.vz-very-strong { color: #22c55e; }

      .vz-score {
        font-size: 11px; font-weight: 800;
        font-variant-numeric: tabular-nums; min-width: 44px; text-align: right;
      }
      .vz-privacy {
        font-size: 9px; color: #334155; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.4px;
        border: 1px solid rgba(255,255,255,0.06); padding: 2px 5px; border-radius: 4px;
      }

      .vz-bar-track {
        height: 3px; background: rgba(255,255,255,0.07);
        border-radius: 2px; overflow: hidden; margin-bottom: 7px;
      }
      .vz-bar-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease, background 0.3s ease; }

      /* Personalized score row — always visible after first analysis */
      .vz-pers-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 8px; margin-bottom: 6px;
        background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
        border-radius: 6px; font-size: 10px;
      }
      .vz-pers-score { font-weight: 700; }
      .vz-pers-label { color: #475569; font-size: 9px; }
      .ok   { color: #4ade80; }
      .warn { color: #f59e0b; }
      .bad  { color: #f87171; }

      /* Details toggle */
      .vz-toggle-btn {
        width: 100%; background: transparent;
        border: none; border-top: 1px solid rgba(255,255,255,0.05);
        color: #475569; font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.6px;
        padding: 5px 0 2px 0; cursor: pointer; transition: color 0.2s;
        text-align: center; font-family: inherit; outline: none;
        display: flex; align-items: center; justify-content: center; gap: 4px;
      }
      .vz-toggle-btn:hover { color: #94a3b8; }
      .vz-caret { font-size: 8px; opacity: 0.7; }

      /* Stats row */
      .vz-stats-row { display: flex; gap: 6px; margin-bottom: 7px; }
      .vz-stat {
        flex: 1; background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07); border-radius: 6px;
        padding: 5px 6px; text-align: center;
      }
      .vz-stat-val { display: block; font-size: 11px; font-weight: 800; color: rgba(0,212,255,0.9); font-variant-numeric: tabular-nums; line-height: 1.2; }
      .vz-stat-key { display: block; font-size: 9px; color: #475569; text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600; margin-top: 1px; }

      /* Char chips */
      .vz-chips { display: flex; gap: 5px; margin-bottom: 9px; }
      .vz-chip  { flex: 1; text-align: center; padding: 3px 0; border-radius: 5px; font-size: 10px; font-weight: 700; font-family: monospace; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.03); color: #334155; transition: all 0.2s; }
      .vz-chip-on  { background: rgba(34,197,94,0.1);  border-color: rgba(34,197,94,0.3);  color: #4ade80; box-shadow: 0 0 6px rgba(34,197,94,0.08); }
      .vz-chip-off { background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.15); color: rgba(239,68,68,0.5); }

      /* Sections */
      .vz-section { margin-bottom: 8px; }
      .vz-section-title { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #334155; margin-bottom: 5px; padding-bottom: 3px; border-bottom: 1px solid rgba(255,255,255,0.05); }

      /* ── Issue chip tiles ─────────────────────────────────────────────── */
      .vz-issues-list {
        display: flex; flex-wrap: wrap; gap: 5px;
        margin-bottom: 2px;
      }

      /* Individual tile */
      .vz-itile {
        position: relative;
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 8px 3px 6px;
        border-radius: 20px;
        font: 600 10px inherit;
        cursor: pointer;
        border: 1px solid transparent;
        transition: transform 0.12s, box-shadow 0.12s;
        animation: vzTileIn 0.18s ease both;
        white-space: nowrap;
        /* tooltip anchor */
        isolation: isolate;
      }
      @keyframes vzTileIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }
      .vz-itile:hover  { transform: translateY(-1px); }
      .vz-itile:active { transform: scale(0.97); }

      /* Severity colours */
      .vz-itile-high {
        background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3);
        color: #fca5a5;
      }
      .vz-itile-high:hover { box-shadow: 0 0 8px rgba(239,68,68,0.25); }
      .vz-itile-medium {
        background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.3);
        color: #fcd34d;
      }
      .vz-itile-medium:hover { box-shadow: 0 0 8px rgba(245,158,11,0.25); }
      .vz-itile-low {
        background: rgba(59,130,246,0.1); border-color: rgba(59,130,246,0.25);
        color: #93c5fd;
      }
      .vz-itile-low:hover { box-shadow: 0 0 8px rgba(59,130,246,0.2); }

      .vz-itile-icon  { font-size: 9px; flex-shrink: 0; }
      .vz-itile-label { font-size: 10px; }

      /* Tooltip — shown on :hover (desktop) or [data-open] (touch) */
      .vz-itile-tip {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        width: 200px;
        background: #0f172a;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        padding: 8px 10px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s, transform 0.15s;
        transform: translateX(-50%) translateY(4px);
        z-index: 9999;
        text-align: left;
        white-space: normal;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      }
      /* Arrow */
      .vz-itile-tip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: rgba(255,255,255,0.12);
      }

      /* Show on hover (desktop) */
      .vz-itile:hover .vz-itile-tip {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
        pointer-events: none;
      }
      /* Show on tap (touch toggle) */
      .vz-itile[data-open] .vz-itile-tip {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
        pointer-events: none;
      }

      /* Clip tooltip to widget if it would overflow left edge */
      .vz-itile:first-child .vz-itile-tip,
      .vz-itile:nth-child(2) .vz-itile-tip {
        left: 0;
        transform: translateX(0) translateY(4px);
      }
      .vz-itile:first-child:hover .vz-itile-tip,
      .vz-itile:nth-child(2):hover .vz-itile-tip,
      .vz-itile:first-child[data-open] .vz-itile-tip,
      .vz-itile:nth-child(2)[data-open] .vz-itile-tip {
        transform: translateX(0) translateY(0);
      }
      .vz-itile:first-child .vz-itile-tip::after,
      .vz-itile:nth-child(2) .vz-itile-tip::after { left: 16px; }

      /* Tooltip content */
      .vz-tip-header {
        font-size: 10px; font-weight: 800; margin-bottom: 4px;
        padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.07);
      }
      .vz-tip-header.vz-tip-high   { color: #fca5a5; }
      .vz-tip-header.vz-tip-medium { color: #fcd34d; }
      .vz-tip-header.vz-tip-low    { color: #93c5fd; }
      .vz-tip-body {
        font-size: 10px; color: #94a3b8; line-height: 1.45;
        margin-bottom: 5px;
      }
      .vz-tip-fix {
        font-size: 9px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.4px; color: #475569;
      }

      /* All-good banner */
      .vz-all-good { font-size: 11px; color: #4ade80; font-weight: 600; padding: 6px 8px; background: rgba(34,197,94,0.07); border: 1px solid rgba(34,197,94,0.2); border-radius: 6px; }

      /* Crack times */
      .vz-crack-list { display: flex; flex-direction: column; gap: 3px; }
      .vz-crack-row  { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.045); border-radius: 6px; }
      .vz-crack-scenario { display: flex; flex-direction: column; gap: 1px; flex: 1; }
      .vz-crack-name { font-size: 10px; font-weight: 700; color: #94a3b8; }
      .vz-crack-desc { font-size: 9px; color: #475569; }
      .vz-crack-time { font-size: 11px; font-weight: 800; font-family: 'SF Mono',ui-monospace,monospace; white-space: nowrap; text-align: right; }
      .vz-crack-danger   { color: #ef4444; }
      .vz-crack-warning  { color: #f59e0b; }
      .vz-crack-moderate { color: #84cc16; }
      .vz-crack-safe     { color: #22c55e; }

      /* Personalized risk detail */
      .vz-personal-risk { margin-top: 6px; border-radius: 7px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
      .vz-risk-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px 4px; }
      .vz-risk-badge { font-size: 9px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; flex-shrink: 0; }
      .vz-risk-headline { font-size: 11px; font-weight: 600; color: #94a3b8; }
      .vz-risk-reason   { font-size: 10px; color: #475569; line-height: 1.4; padding: 3px 10px 8px; }
      .vz-badge-critical { background: rgba(239,68,68,0.15);  color: #fca5a5; border: 1px solid rgba(239,68,68,0.25); }
      .vz-badge-high     { background: rgba(245,158,11,0.15); color: #fcd34d; border: 1px solid rgba(245,158,11,0.25); }
      .vz-badge-medium   { background: rgba(234,179,8,0.12);  color: #fef08a; border: 1px solid rgba(234,179,8,0.22); }
      .vz-badge-low      { background: rgba(59,130,246,0.12); color: #93c5fd; border: 1px solid rgba(59,130,246,0.22); }
      .vz-badge-safe     { background: rgba(34,197,94,0.12);  color: #86efac; border: 1px solid rgba(34,197,94,0.22); }

      /* Generate trigger */
      .vz-gen-trigger-row { margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 7px; }
      .btn-gen-trigger {
        width: 100%; padding: 6px 12px;
        background: rgba(0,212,255,0.06); border: 1px solid rgba(0,212,255,0.2);
        border-radius: 7px; color: #67e8f9; font-size: 11px; font-weight: 700;
        cursor: pointer; font-family: inherit; transition: all 0.15s; text-align: center;
      }
      .btn-gen-trigger:hover { background: rgba(0,212,255,0.12); border-color: rgba(0,212,255,0.35); color: #a5f3fc; }

      /* ═══ GENERATOR VIEW ══════════════════════════════════════════════════ */

      .vz-gen-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }

      .btn-back {
        background: transparent; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px; padding: 4px 9px; font: 600 10px inherit;
        cursor: pointer; color: #64748b; transition: all 0.15s;
      }
      .btn-back:hover { border-color: rgba(255,255,255,0.25); color: #94a3b8; }

      .vz-gen-ctx {
        font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
        background: rgba(0,212,255,0.1); border: 1px solid rgba(0,212,255,0.2);
        color: #67e8f9; text-transform: uppercase; letter-spacing: 0.5px; margin-left: auto;
      }

      .vz-gen-pw {
        width: 100%; padding: 9px 11px;
        border: 1px solid #1e293b; border-radius: 7px;
        background: #020617; color: #f8fafc;
        font: 600 13px 'SF Mono', ui-monospace, Consolas, monospace;
        outline: none; letter-spacing: 0.03em; transition: border-color 0.2s;
        margin-bottom: 9px;
      }
      .vz-gen-pw:focus { border-color: rgba(0,212,255,0.5); box-shadow: 0 0 0 2px rgba(0,212,255,0.08); }

      .vz-gen-scores   { margin-bottom: 9px; }
      .vz-gen-score-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
      .vz-gen-score-label { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; width: 80px; flex-shrink: 0; }
      .vz-gen-score-bar   { flex: 1; height: 4px; background: rgba(255,255,255,0.07); border-radius: 2px; overflow: hidden; }
      .vz-gen-score-fill  { height: 100%; border-radius: 2px; transition: width 0.5s ease, background 0.3s; }
      .vz-gen-score-num   { font-size: 11px; font-weight: 800; width: 36px; text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0; }

      .vz-gen-reason        { font-size: 11px; color: #64748b; line-height: 1.5; margin-bottom: 9px; padding: 0 1px; min-height: 14px; }
      .vz-gen-reason.passed { color: #4ade80; }
      .vz-gen-reason.failed { color: #f87171; }

      .vz-gen-actions { display: flex; gap: 6px; flex-wrap: wrap; }

      /* ═══ SHARED BUTTONS ═══════════════════════════════════════════════════ */
      button {
        border-radius: 6px; padding: 6px 11px;
        font: 600 11px inherit; cursor: pointer;
        border: 1px solid #1e293b; background: #0f172a; color: #94a3b8;
        transition: all 0.15s;
      }
      button:hover    { border-color: rgba(0,212,255,0.4); color: #e2e8f0; }
      button:disabled { opacity: 0.45; cursor: wait; }
      .btn-primary      { background: #0369a1; border-color: #0ea5e9; color: #fff; }
      .btn-primary:hover { background: #0284c7; }
      .btn-apply-style  { background: #166534; border-color: #22c55e; color: #fff; }
      .btn-apply-style:hover    { background: #15803d; }
      .btn-apply-style:disabled { background: #0f2b1a; border-color: #166534; }
    `;
  }

  // ── Popup ↔ Content Bridge ─────────────────────────────────────────────────
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
          'input[type="email"],input[type="text"][name*="user"],' +
          'input[type="text"][name*="email"],input[id*="user"],input[id*="email"]'
        );
        if (userField) username = userField.value.trim();
        sendResponse({ password, username });
        return true;
      }
      if (msg.type === 'GET_PASSWORD_CONTEXT') {
        getContextModules().then((modules) => {
          const context      = modules.detector.detectPasswordContext(document);
          const websiteContext = modules.website.extractWebsiteContextFromDocument(document, window.location);
          sendResponse({
            ...modules.detector.serializePasswordContext(context),
            url: window.location.hostname,
            websiteContext,
          });
        }).catch(() => {
          sendResponse({ type: 'unknown', eligible: false, isNewPassword: false, url: window.location.hostname });
        });
        return true;
      }
    });
  } catch (_) {}

})();
