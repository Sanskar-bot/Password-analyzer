# VaultZero — Password Intelligence Extension

> **Production-quality Manifest V3 Chrome extension** for real-time password analysis on any login page. 100% local  your passwords never leave your browser.

---

##  Features

| Feature | Description |
|---|---|
|  Real-Time Widget | Inline strength indicator beside every `<input type="password">` |
|  Full Analysis | Entropy, patterns, dictionary, username similarity, crack times |
|  Attack Simulator | CUPP-inspired 10,00015,000 personalized targeted guesses |
| Context-Aware Generator | Personalized passwords shown only for account creation and password changes |
| ⬇ Dictionary Export | Download your personalized attack dictionary as `.txt` |
|  Privacy-First | Zero network requests, zero data collection, zero storage of passwords |
|  Badge Score | Extension badge shows live score while you type |

---

##  Installation (Load Unpacked)

1. Open Chrome  navigate to `chrome://extensions/`
2. Enable **Developer Mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder inside this project:
   ```
   s:\Personal Projects\extension for Password\extension\
   ```
5. The VaultZero shield icon will appear in your toolbar.
6. **Pin it** by clicking the puzzle piece icon  pin VaultZero.

---

##  Extension Structure

```
extension/
 manifest.json                   MV3 manifest
 background.js                   Service worker (badge, tab tracking)

 content/
    content.js                  Injection + MutationObserver + widget

 popup/
    popup.html                  3-tab dashboard UI
    popup.js                    Full analysis pipeline controller
    popup.css                   Dark cybersecurity theme

 workers/
    dictionary.worker.js        Web Worker for dictionary generation

 modules/                        All reused from original web app
    contextDetector.js           Signup/change/login form classification
    websiteContext.js            Domain, brand, and context keyword extraction
    profilePasswordGenerator.js  Context-aware candidate generation
    generatorValidator.js        Full acceptance and reuse validation pipeline
    strength.js                 Entropy & charset analysis
    patterns.js                 Keyboard walks, sequences, repeats
    scorer.js                   0100 aggregate score
    bruteforce.js               Crack time estimation
    suggestions.js              Rule-based improvement tips
    username.js                 Username similarity detection
    wordlist.js                 Trie-based dictionary lookup
    generator.js                Cryptographically secure generator
    personalDictionary.js       Public API for personalized analysis
    personalDictionaryGenerator.js  CUPP-inspired word generation
    personalDictionaryScorer.js     Rank, score, and risk calculation

 data/
    common_passwords.js         ~500 top passwords + 800 dictionary words

 pages/
    settings.html / .js / .css  Settings page
    about.html / .css           About & attribution

 assets/
     icon16.png
     icon48.png
     icon128.png
```

---

##  How to Use

### Real-Time Widget
1. Visit any login page (e.g., `https://accounts.google.com`)
2. Click into the password field
3. Start typing  the VaultZero widget appears below the field showing live score, entropy, issues, and a link to the full popup

### Full Analysis (Popup)
1. Click the VaultZero shield in your toolbar
2. If you were typing in a password field, click **"Use it"** to pull it in automatically
3. View score ring, crack times, breakdown, and recommendations

### Personalized Attack Simulation
1. Open popup  click **Attack Sim** tab
2. Click **Start Analysis**
3. Fill in any personal information (all optional)
4. Click **Run Attack Simulation**
5. The Web Worker generates 10,00015,000 targeted guesses and checks if your password is in them

### Context-Aware Password Generator
1. Open an account creation or password change form.
2. VaultZero classifies the form locally. Standard login forms are explicitly excluded.
3. Use the inline **Generate Password** panel or open the extension popup.
4. Edit the generated password freely. Strength and personalized attack scores update immediately.
5. Click **Use Password** in the inline panel to fill the new-password and confirmation fields.

The generator combines a profile-derived memory theme, website context, and
cryptographically secure random components. Raw profile values such as names,
nicknames, pet names, custom keywords, and dates are never copied into generated
passwords.

Every candidate must pass:

- Strength score greater than 80
- Personalized attack score greater than 80
- Common-password and predictable-pattern checks
- Personalized dictionary lookup
- Raw profile and date exposure checks
- Cross-account reuse similarity checks

Reuse protection stores only SHA-256-based signatures and hashed similarity
features in `chrome.storage.local`; plaintext generated passwords are not stored.

Known domains such as GitHub, LinkedIn, Amazon, and Netflix use curated context
keywords. Unknown domains use conservative brand and form metadata inference.

---

##  Privacy Architecture

| Data | Processing | Stored | Sent to Server |
|---|---|---|---|
| Passwords | Content script (local) |  Never |  Never |
| Analysis results | Popup JS (local) |  Never |  Never |
| Personal profile | Extension modules (local) | chrome.storage.local | Never |
| Generated dictionary | Web Worker / extension modules | chrome.storage.local | Never |
| Reuse signatures | Extension modules | Hashed locally | Never |
| Settings | chrome.storage.sync |  Local device |  Never |

**The extension makes zero network requests.**

---

##  Development

No build step required  pure ES Modules.

To make changes:
1. Edit files in `extension/`
2. Go to `chrome://extensions/`  click the **refresh icon** on the VaultZero card
3. Changes are live immediately (reload the target page for content script changes)

---

##  Acknowledgements

- **CUPP** (Common User Passwords Profiler) by Mebus/j0rgan  inspiration for the personalized attack module. The JS implementation is a clean-room rewrite; no original Python code is used.
- **SecLists**  common password data reference
- **zxcvbn**  conceptual inspiration for multi-factor scoring

---

##  Score Breakdown

| Component | Max | What it measures |
|---|---|---|
| Length | 25 |  16 chars = full marks |
| Variety | 20 | 4 character classes = full marks |
| Entropy | 20 |  80 Shannon bits = full marks |
| Wordlist | 15 | Not in top-500 common passwords |
| Patterns | 10 | No keyboard walks or sequences |
| Username | 10 | Not similar to your username |
| **Total** | **100** | |

**Categories:** 024 Weak · 2549 Moderate · 5074 Strong · 75100 Very Strong

---

##  Browser Support

| Browser | Status |
|---|---|
| Chrome 109+ |  Primary target |
| Edge 109+ |  Fully compatible (same engine) |
| Firefox |  Ready for adaptation (swap `chrome.*`  `browser.*`) |
| Safari |  Possible with Xcode extension packaging |
