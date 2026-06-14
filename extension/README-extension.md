# VaultZero — Password Intelligence Extension

> **Production-quality Manifest V3 Chrome extension** for real-time password analysis on any login page. 100% local — your passwords never leave your browser.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔴 Real-Time Widget | Inline strength indicator beside every `<input type="password">` |
| 📊 Full Analysis | Entropy, patterns, dictionary, username similarity, crack times |
| 🎯 Attack Simulator | CUPP-inspired 10,000–15,000 personalized targeted guesses |
| ⚡ Password Generator | Cryptographically secure (3 modes: Maximum / Memorable / Passphrase) |
| ⬇ Dictionary Export | Download your personalized attack dictionary as `.txt` |
| 🔒 Privacy-First | Zero network requests, zero data collection, zero storage of passwords |
| 🏷 Badge Score | Extension badge shows live score while you type |

---

## 🚀 Installation (Load Unpacked)

1. Open Chrome → navigate to `chrome://extensions/`
2. Enable **Developer Mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder inside this project:
   ```
   s:\Personal Projects\extension for Password\extension\
   ```
5. The VaultZero shield icon will appear in your toolbar.
6. **Pin it** by clicking the puzzle piece icon → pin VaultZero.

---

## 📁 Extension Structure

```
extension/
├── manifest.json                   MV3 manifest
├── background.js                   Service worker (badge, tab tracking)
│
├── content/
│   └── content.js                  Injection + MutationObserver + widget
│
├── popup/
│   ├── popup.html                  3-tab dashboard UI
│   ├── popup.js                    Full analysis pipeline controller
│   └── popup.css                   Dark cybersecurity theme
│
├── workers/
│   └── dictionary.worker.js        Web Worker for dictionary generation
│
├── modules/                        All reused from original web app
│   ├── strength.js                 Entropy & charset analysis
│   ├── patterns.js                 Keyboard walks, sequences, repeats
│   ├── scorer.js                   0–100 aggregate score
│   ├── bruteforce.js               Crack time estimation
│   ├── suggestions.js              Rule-based improvement tips
│   ├── username.js                 Username similarity detection
│   ├── wordlist.js                 Trie-based dictionary lookup
│   ├── generator.js                Cryptographically secure generator
│   ├── personalDictionary.js       Public API for personalized analysis
│   ├── personalDictionaryGenerator.js  CUPP-inspired word generation
│   └── personalDictionaryScorer.js     Rank, score, and risk calculation
│
├── data/
│   └── common_passwords.js         ~500 top passwords + 800 dictionary words
│
├── pages/
│   ├── settings.html / .js / .css  Settings page
│   └── about.html / .css           About & attribution
│
└── assets/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🎮 How to Use

### Real-Time Widget
1. Visit any login page (e.g., `https://accounts.google.com`)
2. Click into the password field
3. Start typing — the VaultZero widget appears below the field showing live score, entropy, issues, and a link to the full popup

### Full Analysis (Popup)
1. Click the VaultZero shield in your toolbar
2. If you were typing in a password field, click **"Use it"** to pull it in automatically
3. View score ring, crack times, breakdown, and recommendations

### Personalized Attack Simulation
1. Open popup → click **Attack Sim** tab
2. Click **Start Analysis**
3. Fill in any personal information (all optional)
4. Click **Run Attack Simulation**
5. The Web Worker generates 10,000–15,000 targeted guesses and checks if your password is in them

### Password Generator
1. Open popup → **Generate** tab
2. Choose mode: Maximum Security / Memorable / Passphrase
3. Adjust length and character options
4. Click **Generate** → **Copy** or **Use in Analyzer**

---

## 🔒 Privacy Architecture

| Data | Processing | Stored | Sent to Server |
|---|---|---|---|
| Passwords | Content script (local) | ❌ Never | ❌ Never |
| Analysis results | Popup JS (local) | ❌ Never | ❌ Never |
| Personal profile | Web Worker (local) | ❌ Never | ❌ Never |
| Generated dictionary | Web Worker (local) | ❌ Never | ❌ Never |
| Settings | chrome.storage.sync | ✅ Local device | ❌ Never |

**The extension makes zero network requests.**

---

## 🔧 Development

No build step required — pure ES Modules.

To make changes:
1. Edit files in `extension/`
2. Go to `chrome://extensions/` → click the **refresh icon** on the VaultZero card
3. Changes are live immediately (reload the target page for content script changes)

---

## 📚 Acknowledgements

- **CUPP** (Common User Passwords Profiler) by Mebus/j0rgan — inspiration for the personalized attack module. The JS implementation is a clean-room rewrite; no original Python code is used.
- **SecLists** — common password data reference
- **zxcvbn** — conceptual inspiration for multi-factor scoring

---

## 📋 Score Breakdown

| Component | Max | What it measures |
|---|---|---|
| Length | 25 | ≥ 16 chars = full marks |
| Variety | 20 | 4 character classes = full marks |
| Entropy | 20 | ≥ 80 Shannon bits = full marks |
| Wordlist | 15 | Not in top-500 common passwords |
| Patterns | 10 | No keyboard walks or sequences |
| Username | 10 | Not similar to your username |
| **Total** | **100** | |

**Categories:** 0–24 Weak · 25–49 Moderate · 50–74 Strong · 75–100 Very Strong

---

## 🌐 Browser Support

| Browser | Status |
|---|---|
| Chrome 109+ | ✅ Primary target |
| Edge 109+ | ✅ Fully compatible (same engine) |
| Firefox | 🔜 Ready for adaptation (swap `chrome.*` → `browser.*`) |
| Safari | 🔜 Possible with Xcode extension packaging |
