<div align="center">

![PassGuard Banner](docs/images/banner.png)

```
██████╗  █████╗ ███████╗███████╗ ██████╗ ██╗   ██╗ █████╗ ██████╗ ██████╗
██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝ ██║   ██║██╔══██╗██╔══██╗██╔══██╗
██████╔╝███████║███████╗███████╗██║  ███╗██║   ██║███████║██████╔╝██║  ██║
██╔═══╝ ██╔══██║╚════██║╚════██║██║   ██║██║   ██║██╔══██║██╔══██╗██║  ██║
██║     ██║  ██║███████║███████║╚██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝
╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝
```

# 🔐 PassGuard — Unified Password Security Platform

**A blazing-fast, fully offline, browser-based password security engine and Chrome Extension.**  
No tracking. No APIs. No BS. Just pure, brutal password analysis combined with advanced personalized attack resistance.

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/)
[![Web Workers](https://img.shields.io/badge/Web_Workers-Async-ff69b4?style=for-the-badge)](#)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen?style=for-the-badge)](.)
[![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)](LICENSE)

</div>

---

## ⚡ What Makes This Different?

> Most password checkers just count characters. This one **thinks like a hacker.**

PassGuard goes beyond traditional entropy analysis by introducing a **Targeted Attack Simulator**. By generating a personalized dictionary based on user traits (names, pets, birth years, companies), PassGuard models how a real-world, targeted spear-phishing or doxxing attack would crack your passwords.

- 🧠 **Advanced Personalized Attack Simulator** — Generates 20,000+ targeted permutations locally.
- 🚀 **Web Worker Offloading** — Dictionary generation runs entirely in the background. Zero UI freezing.
- 🌳 **Trie-powered substring search** — Finds `"dragon"` hiding inside `"myDr4g0n99!"`.
- 🔤 **Leet-speak normalization** — Automatically catches typical hacker character substitutions.
- 🧩 **Unified Architecture** — Same powerful analysis engine powers both the standalone Web App and the inline Chrome Extension.
- 📡 **100% Offline** — Your passwords and personal profile data NEVER leave your machine.

---

## 🗂️ Unified Platform Architecture

PassGuard recently migrated to a highly modular, decoupled architecture, separating the core analysis engine from the presentation layers (Web App vs. Browser Extension).

```text
📦 Password-analyzer/
├── 📁 shared/                  ← CORE ANALYSIS ENGINE (The Brains)
│   ├── 🧠 strength.js          ← Entropy & character-set analysis
│   ├── 🌳 wordlist.js          ← Hash-Set + Trie lookup engine
│   ├── 🎯 personalDictionaryGenerator.js ← CUPP-inspired targeted permutation engine
│   ├── 🏆 scorer.js            ← Aggregate scoring and risk penalties
│   └── 💾 dictCache.js         ← O(1) in-memory lookup system
│
├── 📁 app/                     ← WEB APPLICATION (The Playground)
│   ├── 📄 index.html           ← Standalone UI dashboard
│   ├── 🎨 style.css            ← Glassmorphism design system
│   └── ⚙️ app.js               ← DOM wiring and module orchestrator
│
├── 📁 extension/               ← CHROME EXTENSION (The Sentinel)
│   ├── 📄 manifest.json        ← MV3 Extension Manifest
│   ├── 🤖 background.js        ← Service worker event orchestrator
│   ├── 💉 content/content.js   ← Injects real-time UI widget into password fields
│   ├── ⚙️ workers/             ← Background Web Workers for dictionary gen
│   └── 🪟 popup/               ← Extension popup interface
│
├── 🖥️ server.js                ← Zero-dependency Node.js static server
└── 🚀 start.bat                ← One-click Windows launcher
```

---

## 🔬 Advanced Analysis Pipeline

The pipeline runs in less than 50ms, evaluating your password across multiple dimensions before returning a final weighted score.

```mermaid
graph TD
    A[Password Input] --> B(Debounce 120ms)
    B --> C{Core Analysis Layer}
    
    subgraph Shared Engine
    C --> D[Strength / Entropy]
    C --> E[Pattern Detection]
    C --> F[Wordlist / Trie Scan]
    C --> G[Username Similarity]
    end
    
    subgraph Personalized Attack Simulation
    H[(Local Profile Store)] --> I(Web Worker: Generator)
    I -->|20,000+ permutations| J[(Targeted Dictionary Cache)]
    J --> K{O(1) Exact/Substring Lookup}
    end
    
    F --> K
    
    K --> L[Scoring Module]
    L -->|Penalty applied if targeted| M[Final Score 0-100]
    
    M --> N[Brute-Force Estimator]
    M --> O[Suggestion Engine]
    
    N --> P((UI Render))
    O --> P
```

---

## 🎯 Personalized Attack Resistance (CUPP Integration)

PassGuard implements a highly optimized, JavaScript-native version of the Common User Passwords Profiler (CUPP) logic.

When a user enters a few basic personal details (Partner's name, Pet's name, Company, Year of birth), PassGuard's Web Worker silently generates a custom targeted attack dictionary.

### **Generation Priorities**
1. **Tier 1 (Highest Risk):** Exact names, Names + `123`, Names + Birth Year.
2. **Tier 2:** Nicknames and Partner Names + Suffixes.
3. **Tier 3:** Leet-speak mutations (`a -> 4`, `e -> 3`, `i -> 1`, `o -> 0`, `s -> 5`).
4. **Tier 4:** Common corporate password formats (e.g., `Company2025!`).

### **Dynamic Penalty Scoring**
If your password scores an otherwise perfect `100/100` (e.g., `Sanskar2004@!`), but the Personalized Engine detects it at rank `#183` in the targeted dictionary, **the Scoring Module aggressively penalizes the score by up to 50 points**, downgrading it to a "Moderate" or "Weak" risk.

---

## 🏆 Scoring System & Risk Levels

```text
Score Range │ Category    │ Color   │ Meaning
────────────┼─────────────┼─────────┼──────────────────────────────────
  75 – 100  │ Very Strong │ 🟢 Green │ Excellent — safe against standard & targeted attacks
  50 –  74  │ Strong      │ 🟡 Lime  │ Good — minor improvements possible
  25 –  49  │ Moderate    │ 🟠 Amber │ Risky — vulnerable to targeted guessing
   0 –  24  │ Weak        │ 🔴 Red   │ Dangerous — change immediately
```

---

## 🚀 How to Run — Standalone Web App

**Method 1: Windows One-Click (Recommended)**
Simply double-click the `start.bat` file. It will automatically boot the Node.js server and open your default browser.

**Method 2: Command Line**
1. Ensure Node.js is installed.
2. Clone the repo or download the ZIP.
3. Run `node server.js`
4. Open your browser to `http://localhost:5500`

---

## 🧩 How to Install — Chrome Extension

The PassGuard extension brings the exact same offline power directly to your browsing experience, injecting a real-time analysis widget under any password field you type into.

1. Open Google Chrome and navigate to `chrome://extensions/`
2. Enable **"Developer mode"** in the top right corner.
3. Click **"Load unpacked"** in the top left.
4. Select the `Password-analyzer/` (Root) folder.
5. Pin the extension to your toolbar!

> **Note:** The extension is entirely offline and requests NO external network permissions. Your profile and password telemetry stay isolated in your local browser sandbox.

---

## 🔒 Privacy Guarantee

```text
┌─────────────────────────────────────────────────┐
│                                                 │
│   Your password NEVER leaves your computer.    │
│                                                 │
│   ✓ No backend servers                         │
│   ✓ No network requests                        │
│   ✓ No telemetry or tracking                   │
│   ✓ Fully offline capable                      │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 📄 License

MIT License — do whatever you want with it. Just don't use it to store weak passwords. 😄

<div align="center">

Made with 🔐 by [Sanskar Phougat](https://github.com/Sanskar-bot)

*If this helped you secure your passwords, give it a ⭐ on GitHub!*

</div>
