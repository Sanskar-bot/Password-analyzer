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

  // ── Extension context guard ────────────────────────────────────────────────
  // After the extension is reloaded/updated, the old content script survives
  // on existing tabs but chrome.runtime becomes invalid. Every chrome.* call
  // will throw "Extension context invalidated". We check runtime.id first and
  // silently abort any work that requires a live extension context.
  function ctxValid() {
    try { return !!chrome.runtime?.id; }
    catch (_) { return false; }
  }

  //  Settings 
  let settings = {
    enableWidget:       true,
    enablePersonalized: true,
    enableGenerator:    true,
    enableBadge:        true,
    widgetPosition:     'below',
  };
  try {
    chrome.storage.sync.get('settings', (data) => {
      if (data.settings) settings = { ...settings, ...data.settings };
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.settings) {
        settings = { ...settings, ...changes.settings.newValue };
        if (!settings.enableWidget)    removeAllWidgets();
        if (!settings.enableGenerator) removeAllGeneratorHosts();
      }
    });
  } catch (_) { /* context already invalidated on this tab */ }

  //  State 
  const widgetMap = new WeakMap();
  let generatorMap = new WeakMap();
  let observerTimeout = null;
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
          // Clear so the next focus attempt retries the import chain
          contextModulesPromise = null;
          throw err;
        });
      } catch (err) {
        // chrome.runtime.getURL() itself threw (context invalidated)
        contextModulesPromise = null;
        return Promise.reject(err);
      }
    }
    return contextModulesPromise;
  }

  function dispatchFieldValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    );
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function nearbyUsername(input) {
    const form = input.closest('form') || document;
    const field = form.querySelector(
      'input[type="email"],input[autocomplete="username"],input[name*="user" i],input[name*="email" i],input[id*="user" i],input[id*="email" i]'
    );
    return field?.value?.trim() || '';
  }

  function generatorCSS() {
    return `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      .vz-gen {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
        background: rgba(8, 12, 24, 0.98);
        border: 1px solid rgba(0, 212, 255, 0.28);
        border-radius: 12px;
        padding: 12px 14px 10px;
        color: #e2e8f0;
        backdrop-filter: blur(20px);
        box-shadow: 0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,212,255,0.06) inset;
        min-width: 320px;
        transition: all 0.2s ease;
      }

      /* Header */
      .vz-gen-head {
        display: flex; align-items: center; gap: 8px;
        margin-bottom: 10px;
      }
      .vz-gen-icon { color: rgba(0,212,255,0.75); flex-shrink: 0; display: flex; align-items: center; }
      .vz-gen-title { flex: 1; font-weight: 750; font-size: 13px; color: #f1f5f9; }
      .vz-gen-ctx {
        font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px;
        background: rgba(0,212,255,0.1); border: 1px solid rgba(0,212,255,0.2);
        color: #67e8f9; text-transform: uppercase; letter-spacing: 0.5px;
      }
      .vz-gen-ctx.change { background: rgba(139,92,246,0.12); border-color: rgba(139,92,246,0.25); color: #c4b5fd; }

      /* Password field */
      .vz-gen-pw {
        width: 100%; padding: 9px 11px;
        border: 1px solid #1e293b; border-radius: 7px;
        background: #020617; color: #f8fafc;
        font: 600 13px 'SF Mono', ui-monospace, Consolas, monospace;
        outline: none; letter-spacing: 0.03em;
        transition: border-color 0.2s;
        margin-bottom: 9px;
      }
      .vz-gen-pw:focus { border-color: rgba(0,212,255,0.5); box-shadow: 0 0 0 2px rgba(0,212,255,0.08); }

      /* Score bars */
      .vz-gen-scores { display: none; margin-bottom: 9px; }
      .vz-gen-scores.show { display: block; }
      .vz-gen-score-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
      .vz-gen-score-label { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase;
                             letter-spacing: 0.4px; width: 80px; flex-shrink: 0; }
      .vz-gen-score-bar { flex: 1; height: 4px; background: rgba(255,255,255,0.07); border-radius: 2px; overflow: hidden; }
      .vz-gen-score-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease, background 0.3s; }
      .vz-gen-score-num { font-size: 11px; font-weight: 800; width: 36px; text-align: right;
                           font-variant-numeric: tabular-nums; flex-shrink: 0; }
      .ok  { color: #4ade80; }
      .warn{ color: #f59e0b; }
      .bad { color: #f87171; }

      /* Reasoning */
      .vz-gen-reason {
        font-size: 11px; color: #64748b; line-height: 1.5;
        margin-bottom: 9px; padding: 0 1px;
        min-height: 14px;
      }
      .vz-gen-reason.passed { color: #4ade80; }
      .vz-gen-reason.failed { color: #f87171; }

      /* Actions */
      .vz-gen-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      button {
        border-radius: 6px; padding: 6px 11px;
        font: 600 11px inherit; cursor: pointer;
        border: 1px solid #1e293b; background: #0f172a; color: #94a3b8;
        transition: all 0.15s;
      }
      button:hover { border-color: rgba(0,212,255,0.4); color: #e2e8f0; }
      button:disabled { opacity: 0.45; cursor: wait; }
      .btn-primary { background: #0369a1; border-color: #0ea5e9; color: #fff; }
      .btn-primary:hover { background: #0284c7; }
      .btn-apply { background: #166534; border-color: #22c55e; color: #fff; }
      .btn-apply:hover { background: #15803d; }
      .btn-apply:disabled { background: #0f2b1a; border-color: #166534; }
    `;
  }

  function buildGeneratorHost(input, context, websiteContext, modules) {
    if (generatorMap.has(context.targetField)) return;

    const target = context.targetField;
    const isChange = context.type === 'password-change';

    // Use fixed positioning — never clipped by host-page overflow:hidden containers.
    const host = document.createElement('div');
    host.className = '__vz-generator-host';
    host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:all;left:0;top:0;display:none;';
    document.body.appendChild(host);

    function repositionGenerator() {
      const rect = target.getBoundingClientRect();
      if (rect.width === 0) return;
      host.style.left = `${rect.left}px`;
      host.style.top  = `${rect.bottom + 6}px`;
      const card = shadow.querySelector('.vz-gen');
      if (card) card.style.width = `${Math.max(rect.width, 340)}px`;
    }
    window.addEventListener('scroll', repositionGenerator, { passive: true });
    window.addEventListener('resize', repositionGenerator, { passive: true });

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${generatorCSS()}</style>
      <div class="vz-gen" role="complementary" aria-label="VaultZero password generator">
        <div class="vz-gen-head">
          <span class="vz-gen-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </span>
          <span class="vz-gen-title">Generate Password</span>
          <span class="vz-gen-ctx ${isChange ? 'change' : ''}">${websiteContext.brand || 'New'} · ${isChange ? 'Password change' : 'New account'}</span>
        </div>

        <input class="vz-gen-pw" type="text" autocomplete="off" spellcheck="false"
               placeholder="Click Generate to create a strong password"
               aria-label="Generated password" />

        <div class="vz-gen-scores" aria-live="polite">
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

        <div class="vz-gen-reason">Generate a unique password for ${websiteContext.brand || 'this account'}.</div>

        <div class="vz-gen-actions">
          <button class="btn-primary btn-generate">Generate</button>
          <button class="btn-regen" hidden>Regenerate</button>
          <button class="btn-copy" hidden>Copy</button>
          <button class="btn-analyze" hidden>Analyze</button>
          <button class="btn-apply" hidden disabled>Use Password</button>
        </div>
      </div>`;

    const el = {
      pw:      shadow.querySelector('.vz-gen-pw'),
      scores:  shadow.querySelector('.vz-gen-scores'),
      strFill: shadow.querySelector('.str-fill'),
      strNum:  shadow.querySelector('.str-num'),
      perFill: shadow.querySelector('.per-fill'),
      perNum:  shadow.querySelector('.per-num'),
      reason:  shadow.querySelector('.vz-gen-reason'),
      generate:shadow.querySelector('.btn-generate'),
      regen:   shadow.querySelector('.btn-regen'),
      copy:    shadow.querySelector('.btn-copy'),
      analyze: shadow.querySelector('.btn-analyze'),
      apply:   shadow.querySelector('.btn-apply'),
    };

    const state = { host, shadow, target, confirmation: context.confirmationField,
                    websiteContext, modules, el, validation: null, repositionGenerator };
    generatorMap.set(target, state);

    // ── Hide the strength widget while generator is open (they share the same position) ──
    // The generator already shows live strength + personalized scores.
    function suppressStrengthWidget(hide) {
      const ws = widgetMap.get(target);
      if (ws) ws.host.style.display = hide ? 'none' : '';
    }

    // Show/hide with the field's focus state.
    // CRITICAL: use a mousedown flag on the host so that clicking any button
    // inside the shadow panel does NOT trigger the blur → hide path.
    // (document.activeElement becomes the shadow HOST when focus moves inside
    //  the shadow, so shadow.contains(document.activeElement) is always false.)
    let panelMouseDown = false;
    host.addEventListener('mousedown', () => { panelMouseDown = true; });
    host.addEventListener('mouseup',   () => { panelMouseDown = false; });

    target.addEventListener('focus', () => {
      host.style.display = '';
      repositionGenerator();
      suppressStrengthWidget(true);
    });
    target.addEventListener('blur', () => {
      setTimeout(() => {
        // Keep panel open if:
        //   a) user is clicking something inside the panel (panelMouseDown)
        //   b) focus moved into the shadow DOM (shadow.activeElement is set)
        //   c) focus returned to the host element itself
        if (panelMouseDown || shadow.activeElement || document.activeElement === host) return;
        host.style.display = 'none';
        suppressStrengthWidget(false);
      }, 300);
    });
    if (document.activeElement === target) {
      host.style.display = '';
      repositionGenerator();
      suppressStrengthWidget(true);
    }

    // ── Score rendering ──────────────────────────────────────────────────────
    function scoreColor(v) {
      return v >= 80 ? '#4ade80' : v >= 55 ? '#f59e0b' : '#f87171';
    }
    function scoreClass(v) {
      return v >= 80 ? 'ok' : v >= 55 ? 'warn' : 'bad';
    }
    function renderValidation(result) {
      state.validation = result;
      const s = result.strengthScore;
      const p = result.personalizedAttackScore;
      el.strFill.style.width      = `${s}%`;
      el.strFill.style.background = scoreColor(s);
      el.strNum.textContent       = s;
      el.strNum.className         = `vz-gen-score-num ${scoreClass(s)}`;
      el.perFill.style.width      = `${p}%`;
      el.perFill.style.background = scoreColor(p);
      el.perNum.textContent       = p;
      el.perNum.className         = `vz-gen-score-num ${scoreClass(p)}`;
      el.scores.classList.add('show');
      el.reason.textContent       = result.reasoning;
      el.reason.className         = `vz-gen-reason ${result.passed ? 'passed' : 'failed'}`;
      el.apply.hidden   = false;
      el.apply.disabled = !result.passed;
      for (const b of [el.regen, el.copy, el.analyze]) b.hidden = false;
    }

    // ── Profile pre-load ─────────────────────────────────────────────────────
    // Load the user profile ONCE when the panel is first created so it is
    // always available by the time the user clicks Generate.
    let cachedProfile = {};
    modules.profileStore.getProfile().then(p => {
      if (p && typeof p === 'object') cachedProfile = p;
    }).catch(() => {});

    // ── Helpers ──────────────────────────────────────────────────────────────
    async function validationOptions() {
      // Refresh profile in case it was updated since panel was shown
      try {
        const fresh = await modules.profileStore.getProfile();
        if (fresh && typeof fresh === 'object') cachedProfile = fresh;
      } catch (_) {}
      const profile = cachedProfile;
      await modules.dictCache.warmCache();
      return {
        profile,
        username: nearbyUsername(target),
        validation: {
          dictionaryLookup: modules.dictCache.lookup,
          dictionarySize:   modules.dictCache.getSize(),
        },
      };
    }

    async function analyzeCurrent() {
      const { profile, username, validation } = await validationOptions();
      const result = await modules.validator.validateGeneratedPassword(el.pw.value, {
        profile, username,
        domain: websiteContext.domain,
        ...validation,
      });
      renderValidation(result);
    }

    async function generate() {
      el.generate.disabled = true;
      el.regen.disabled    = true;
      el.reason.textContent = 'Generating and validating locally…';
      el.reason.className  = 'vz-gen-reason';
      try {
        const { profile, username, validation } = await validationOptions();
        const result = await modules.generator.generateContextAwarePassword({
          profile, websiteContext, username, validation,
          options: { wordCount: 3, symbols: true },
        });
        el.pw.value = result.password;
        renderValidation(result.validation);
      } catch (error) {
        el.reason.textContent = error.message || 'No candidate passed all checks — try again.';
        el.reason.className   = 'vz-gen-reason failed';
      } finally {
        el.generate.disabled = false;
        el.regen.disabled    = false;
      }
    }

    // ── Event wiring ─────────────────────────────────────────────────────────
    let editTimer = null;
    el.pw.addEventListener('input', () => {
      clearTimeout(editTimer);
      editTimer = setTimeout(analyzeCurrent, 150);
    });
    el.generate.addEventListener('click', generate);
    el.regen.addEventListener('click', generate);
    el.analyze.addEventListener('click', analyzeCurrent);
    el.copy.addEventListener('click', async () => {
      if (!el.pw.value) return;
      await navigator.clipboard.writeText(el.pw.value);
      el.copy.textContent = 'Copied!';
      setTimeout(() => { el.copy.textContent = 'Copy'; }, 1400);
    });
    el.apply.addEventListener('click', async () => {
      if (!state.validation?.passed) {
        await analyzeCurrent();
        if (!state.validation?.passed) return;
      }
      dispatchFieldValue(target, el.pw.value);
      if (state.confirmation) dispatchFieldValue(state.confirmation, el.pw.value);
      if (ctxValid()) await modules.validator.rememberPasswordSignature(el.pw.value, websiteContext.domain);
      target.focus();
    });
  }

  // URL-path keywords that strongly indicate account creation / password reset.
  // Used as a fallback when SPA frameworks haven't rendered form text into DOM yet.
  const SIGNUP_PATH_RE = /\/(sign[-_]?up|signup|register|registration|join|create[-_]?account|new[-_]?account|emailsignup|enroll|onboarding|welcome)/i;
  const CHANGE_PATH_RE = /\/(change[-_]?password|reset[-_]?password|update[-_]?password|forgot[-_]?password|set[-_]?password|recover|password[-_]?reset)/i;

  async function scanForContextualGenerators() {
    if (!ctxValid()) return;
    try {
      const modules = await getContextModules();
      let context = modules.detector.detectPasswordContext(document);
      const websiteContext = modules.website.extractWebsiteContextFromDocument(document, window.location);

      // Boost: if the URL path is a strong signup/change signal but DOM scan missed it,
      // promote the first visible password field to eligible.
      if (!context.eligible) {
        const path = window.location.pathname + window.location.search;
        const allPw = [...document.querySelectorAll('input[type="password"]')]
          .filter(el => !el.disabled && el.offsetParent !== null);
        if (allPw.length > 0) {
          if (SIGNUP_PATH_RE.test(path)) {
            context = { type: 'account-creation', eligible: true, targetField: allPw[0],
              confirmationField: allPw[1] || null, confidence: 'medium', signals: ['url-path'] };
          } else if (CHANGE_PATH_RE.test(path)) {
            context = { type: 'password-change', eligible: true, targetField: allPw[0],
              confirmationField: allPw[1] || null, confidence: 'medium', signals: ['url-path'] };
          }
        }
      }

      if (ctxValid()) {
        chrome.runtime.sendMessage({
          type: 'NEW_PASSWORD_CONTEXT',
          context: modules.detector.serializePasswordContext(context),
          isNewPassword: context.eligible,
          url: window.location.hostname,
          websiteContext,
        }).catch(() => {});
      }

      if (!settings.enableGenerator || !context.eligible || !context.targetField) {
        removeAllGeneratorHosts();
        return;
      }
      buildGeneratorHost(context.targetField, context, websiteContext, modules);
    } catch (error) {
      if (!String(error).includes('context invalidated'))
        console.warn('[VaultZero] Context generator failed:', error);
    }
  }

  //  Analysis modules 
  let analysisReady = false;
  let analyseStrength, detectPatterns, checkWordlist, checkUsername,
      computeScore, estimateCrackTimes;

  //  Dict cache 
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
            vzDictReady = false; vzDictLoading = false;
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

    // React/SPA sites fire synthetic events that bypass native DOM "input" events.
    // Listen to multiple event types to catch any missed changes.

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
      // Suppress strength widget when generator panel is covering this field
      if (generatorMap.has(input)) {
        const gs = generatorMap.get(input);
        gs.host.style.display = '';
        gs.repositionGenerator();
        return; // don't show strength widget — generator handles live analysis
      }
      showWidget();
      loadDictCache();
      scanForContextualGenerators();
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

    const username = nearbyUsername(input);
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
    if (ctxValid()) {
      try {
        chrome.runtime.sendMessage({
          type: 'SCORE_UPDATE', score, category, color, fieldCount: 1,
        }).catch(() => {});
      } catch (_) {}
    }
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


  function removeAllWidgets() {
    document.querySelectorAll('.__vz-widget-host').forEach(el => el.remove());
  }

  function removeAllGeneratorHosts() {
    document.querySelectorAll('.__vz-generator-host').forEach(el => el.remove());
    generatorMap = new WeakMap();
  }

  //  MutationObserver 
  function scanForPasswordFields() {
    const inputs = document.querySelectorAll('input[type="password"]');
    inputs.forEach(injectWidget);
    scanForContextualGenerators();
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
      if (msg.type === 'GET_PASSWORD_CONTEXT') {
        getContextModules().then((modules) => {
          const context = modules.detector.detectPasswordContext(document);
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

