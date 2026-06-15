
<div align="center">

```
██████╗  █████╗ ███████╗███████╗ ██████╗ ██╗   ██╗ █████╗ ██████╗ ██████╗
██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝ ██║   ██║██╔══██╗██╔══██╗██╔══██╗
██████╔╝███████║███████╗███████╗██║  ███╗██║   ██║███████║██████╔╝██║  ██║
██╔═══╝ ██╔══██║╚════██║╚════██║██║   ██║██║   ██║██╔══██║██╔══██╗██║  ██║
██║     ██║  ██║███████║███████║╚██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝
╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝
```

# 🔐 Password Strength Analyzer

**A blazing-fast, fully offline, browser-based password security engine.**  
No tracking. No APIs. No BS. Just pure, brutal password analysis.

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Node.js](https://img.shields.io/badge/Node.js-Server-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![HTML5](https://img.shields.io/badge/HTML5-Semantic-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-Vanilla-1572B6?style=for-the-badge&logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen?style=for-the-badge)](.)
[![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)](LICENSE)

</div>

## Browser Extension Context-Aware Generator

The browser extension shows its personalized generator only on account creation
and password-change forms. Standard login forms are excluded.

The implementation is split across:

- `extension/modules/contextDetector.js`
- `extension/modules/websiteContext.js`
- `extension/modules/profilePasswordGenerator.js`
- `extension/modules/generatorValidator.js`

Generated passwords combine a non-verbatim profile memory theme, website
context, and cryptographically secure randomness. Candidates are rejected until
strength and personalized attack scores both exceed 80, and edited passwords are
revalidated immediately.

---

## ⚡ What Makes This Different?

> Most password checkers just count characters. This one **thinks**.

- 🧠 **Entropy-based scoring** — mathematically measures unpredictability
- 🌳 **Trie-powered substring search** — finds `"dragon"` hiding inside `"myDragon99!"`
- 🔤 **Leet-speak normalization** — catches `"p@55w0rd"` same as `"password"`
- 👤 **Username similarity engine** — detects `"john2024"` when username is `"john"`
- ⚡ **120ms debounce** — real-time feedback without hammering the CPU
- 📡 **100% offline** — your passwords never leave your machine

---

## 🗂️ Project Structure

```
📦 Password-analyzer/
├── 📄 index.html               ← UI shell & layout
├── 🎨 style.css                ← All styling (dark theme, animations)
├── 🧠 app.js                   ← Main orchestrator & DOM wiring
├── 🖥️  server.js               ← Zero-dependency Node.js static server
├── 🚀 start.bat                ← One-click Windows launcher
│
├── 📁 modules/
│   ├── 💪 strength.js          ← Entropy & character-set analysis
│   ├── 🌳 wordlist.js          ← Hash-Set + Trie lookup engine
│   ├── 🔍 patterns.js          ← Keyboard walks, sequences, repeats
│   ├── 👤 username.js          ← Username similarity detection
│   ├── ⏱️  bruteforce.js       ← Crack-time estimation
│   ├── 🏆 scorer.js            ← Aggregate scoring (0–100)
│   ├── 💡 suggestions.js       ← Actionable improvement tips
│   └── 🎲 generator.js         ← Cryptographically random password gen
│
└── 📁 data/
    └── 📋 common_passwords.js  ← Top passwords + dictionary wordlist
```

---

## 🔬 Analysis Pipeline

```
User types password
        │
        ▼ (debounced 120ms)
┌───────────────────────────────────────────────────────────┐
│                    ANALYSIS PIPELINE                       │
│                                                           │
│  ┌─────────────┐   ┌─────────────┐   ┌───────────────┐  │
│  │ strength.js │   │ patterns.js │   │  wordlist.js  │  │
│  │             │   │             │   │               │  │
│  │ • Length    │   │ • Keyboard  │   │ • Hash-Set    │  │
│  │ • Entropy   │   │   walks     │   │   exact match │  │
│  │ • Char set  │   │ • Sequences │   │ • Trie        │  │
│  │ • Variety   │   │ • Repeats   │   │   substring   │  │
│  │             │   │ • Dates     │   │ • Leet-norm   │  │
│  └──────┬──────┘   └──────┬──────┘   └───────┬───────┘  │
│         │                 │                   │           │
│         ▼                 ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                   username.js                       │ │
│  │   contains? • variation? • reversed? • nearMatch?   │ │
│  └───────────────────────┬─────────────────────────────┘ │
│                          │                                │
│                          ▼                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                   scorer.js                         │ │
│  │                                                     │ │
│  │   Length   [████████░░]  25 pts                     │ │
│  │   Variety  [██████░░░░]  20 pts                     │ │
│  │   Entropy  [████████░░]  20 pts                     │ │
│  │   Wordlist [██████████]  15 pts                     │ │
│  │   Patterns [████░░░░░░]  10 pts                     │ │
│  │   Username [██████████]  10 pts                     │ │
│  │                          ─────                      │ │
│  │                   TOTAL: 100 pts                    │ │
│  └───────────────────────┬─────────────────────────────┘ │
│                          │                                │
│            ┌─────────────┼─────────────┐                 │
│            ▼             ▼             ▼                  │
│      bruteforce.js  suggestions.js   UI render            │
│      (crack times)  (fix tips)       (DOM update)         │
└───────────────────────────────────────────────────────────┘
```

---

## 🏆 Scoring System

```
Score Range │ Category    │ Color   │ Meaning
────────────┼─────────────┼─────────┼──────────────────────────────────
  75 – 100  │ Very Strong │ 🟢 Green │ Excellent — safe for any use
  50 –  74  │ Strong      │ 🟡 Lime  │ Good — minor improvements possible
  25 –  49  │ Moderate    │ 🟠 Amber │ Risky — needs strengthening
   0 –  24  │ Weak        │ 🔴 Red   │ Dangerous — change immediately
```

### Score Breakdown (Max 100 Points)

| Category | Module | Max Points | What It Measures |
|----------|--------|:-----------:|------------------|
| 📏 Length | `strength.js` | **25** | Rewards every extra character |
| 🎭 Variety | `strength.js` | **20** | Lowercase + Uppercase + Digits + Symbols |
| 🔀 Entropy | `strength.js` | **20** | `log2(charsetSize ^ length)` |
| 📖 Wordlist | `wordlist.js` | **15** | Not in top passwords / dictionary |
| 🔣 Patterns | `patterns.js` | **10** | No keyboard walks, sequences, repeats |
| 👤 Username | `username.js` | **10** | Not derived from username |

---

## 🌳 The Trie Engine

The wordlist module uses two data structures working in tandem:

```
Hash-Set Lookup (O(1)):
  "password" ──▶ TOP_PASSWORDS.has("password") ──▶ ❌ MATCH

Trie Substring Scan (O(n×k)):
  Input: "myDragon99!"
         │
         ▼ scan all start positions
  start=0  → m → my → ... no match
  start=2  → D → Dr → Dra → Drag → Drago → Dragon ✅ FOUND!
         │
         ▼ also runs on leet-normalized version
  "myDr4g0n99!" → normalize → "myDragon99!" → same match!
```

**Words shorter than 4 characters are filtered out** to reduce noise.

---

## ⚡ Crack Time Scenarios

| Scenario | Speed | Example |
|----------|-------|---------|
| 🐌 Online (throttled) | 100 /sec | Login form with rate limiting |
| 🚶 Online (unthrottled) | 10,000 /sec | Unprotected login endpoint |
| 🏃 Offline (slow hash) | 10,000,000 /sec | bcrypt/scrypt cracking |
| 🚀 Offline (fast hash) | 10,000,000,000 /sec | MD5/SHA1 GPU cracking |
| 💻 Offline (GPU cluster) | 100,000,000,000 /sec | Nation-state level attack |

---

## 🚀 How to Run — Step by Step

### ✅ Prerequisites

Before you begin, make sure you have the following installed:

**1. Check if Node.js is installed:**
```bash
node --version
```
You should see something like `v18.0.0` or higher.  
If not, download Node.js from 👉 [https://nodejs.org](https://nodejs.org) (choose the **LTS** version).

**2. Check if Git is installed (optional, for cloning):**
```bash
git --version
```

---

### 📥 Method 1 — Clone from GitHub

**Step 1:** Open a terminal (PowerShell, CMD, or Git Bash)

**Step 2:** Clone the repository
```bash
git clone https://github.com/Sanskar-bot/Password-analyzer.git
```

**Step 3:** Navigate into the project folder
```bash
cd Password-analyzer
```

**Step 4:** Start the server
```bash
node server.js
```

**Step 5:** Open your browser and visit:
```
http://localhost:5500
```

That's it. No `npm install`. No build steps. No config files. 🎉

---

### 📁 Method 2 — Download ZIP

**Step 1:** Go to [https://github.com/Sanskar-bot/Password-analyzer](https://github.com/Sanskar-bot/Password-analyzer)

**Step 2:** Click the green **`Code`** button → **`Download ZIP`**

**Step 3:** Extract the ZIP to a folder of your choice

**Step 4:** Open a terminal in that folder  
*(Right-click inside the folder → "Open in Terminal")*

**Step 5:** Run:
```bash
node server.js
```

**Step 6:** Open `http://localhost:5500` in your browser ✅

---

### 🖱️ Method 3 — Windows One-Click Launch (Easiest!)

If you're on Windows, just double-click the included batch file:

```
📄 start.bat  ←── double-click this!
```

This will:
1. Automatically find Node.js
2. Start the server
3. Open your default browser to `http://localhost:5500`

---

### 🔧 Custom Port

If port `5500` is already in use, you can specify a different one:

```bash
node server.js 8080
```
Then visit `http://localhost:8080`

---

### 🛑 Stopping the Server

In the terminal where the server is running, press:
```
Ctrl + C
```

---

## 🧪 Running the Built-in Test Suite

The analyzer includes a built-in test suite you can run directly in the browser console.

**Step 1:** Open the app in the browser (`http://localhost:5500`)

**Step 2:** Open DevTools — press `F12` or `Ctrl+Shift+I`

**Step 3:** Go to the **Console** tab

**Step 4:** Type and press Enter:
```javascript
runTests()
```

**Expected output:**
```
Password Analyzer — Test Suite
  ✅ "password"             → 12/100  Weak        (expected Weak)
  ✅ "P@ssw0rd"            → 23/100  Weak        (expected Weak)
  ✅ "qwerty123"            → 18/100  Weak        (expected Weak)
  ✅ "correcthorsebattery"  → 68/100  Strong      (expected Strong)
  ✅ "X9#mK2!pL7@qZ"       → 91/100  Very Strong (expected Very Strong)
  ✅ "john123"              → 14/100  Weak        (expected Weak)
  ✅ "Tr0ub4dour&3"         → 76/100  Strong      (expected Strong)
```

---

## 🎲 Password Generator

The built-in generator uses the **Web Crypto API** (`crypto.getRandomValues`) — the same source of randomness used by your browser for TLS. It is cryptographically secure.

### Generator Options:
| Option | Description |
|--------|-------------|
| **Length slider** | 8 – 64 characters |
| **Lowercase** | a–z |
| **Uppercase** | A–Z |
| **Digits** | 0–9 |
| **Symbols** | `!@#$%^&*()_+-=[]{}` |

Generated passwords can be:
- 📋 **Copied** to clipboard with one click
- ➡️ **Sent to the analyzer** to immediately evaluate strength

---

## 🧩 Module Reference

| Module | Exported Function | Description |
|--------|------------------|-------------|
| `strength.js` | `analyseStrength(password)` | Entropy, length, variety scoring |
| `patterns.js` | `detectPatterns(password)` | Keyboard walks, sequences, dates |
| `patterns.js` | `normalizeLeet(text)` | Converts leet-speak to plain text |
| `wordlist.js` | `checkWordlist(password)` | Hash-Set + Trie dictionary check |
| `username.js` | `checkUsername(password, user)` | Username similarity detection |
| `bruteforce.js` | `estimateCrackTimes(charset, len)` | Multi-scenario crack time estimates |
| `scorer.js` | `computeScore(str, wl, pat, uc)` | Aggregate 0–100 score |
| `suggestions.js` | `generateSuggestions(...)` | Prioritized improvement tips |
| `generator.js` | `generatePassword(options)` | Cryptographically secure generator |

---

## 🌐 Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome 80+ | ✅ Full |
| Firefox 75+ | ✅ Full |
| Edge 80+ | ✅ Full |
| Safari 14+ | ✅ Full |
| Opera 67+ | ✅ Full |

> **Note:** The app uses ES Modules (`type="module"`), which require a server to work — this is why you can't just open `index.html` directly by double-clicking it. The included `server.js` handles this.

---

## 🔒 Privacy

```
┌─────────────────────────────────────────────────┐
│                                                 │
│   Your password NEVER leaves your computer.    │
│                                                 │
│   ✓ No network requests                        │
│   ✓ No analytics                               │
│   ✓ No localStorage writes                    │
│   ✓ No cookies                                │
│   ✓ Fully offline capable                     │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 📄 License

MIT License — do whatever you want with it. Just don't use it to store weak passwords. 😄

---

<div align="center">

Made with 🔐 by [Sanskar Phougat](https://github.com/Sanskar-bot)

*If this helped you secure your passwords, give it a ⭐ on GitHub!*

</div>
