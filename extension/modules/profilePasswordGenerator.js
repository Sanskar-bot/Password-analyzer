import { WORD_BANK, ALL_WORDS } from './wordBank.js';
import { validateGeneratedPassword } from './generatorValidator.js';

const SYMBOLS    = '!@#$%&*?';
const MAX_ATTEMPTS = 120;

// ── Crypto-safe random helpers ─────────────────────────────────────────────

function randomInt(max) {
  if (max <= 0) return 0;
  const buf   = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % max);
  do globalThis.crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

function pick(arr)   { return arr[randomInt(arr.length)]; }
function coinFlip()  { return randomInt(2) === 0; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function titleCase(word) {
  const v = String(word || '').replace(/[^a-z]/gi, '');
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

// ── Parse custom keywords ──────────────────────────────────────────────────

function parseCustomKeywords(profile) {
  const raw = profile.customKeywords;
  if (Array.isArray(raw))         return raw.map(s => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string')    return raw.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

// ── Personal NUMBER pool ───────────────────────────────────────────────────
// Builds every numeric value that has personal meaning, then picks ONE
// randomly each call — so the same password is never generated twice.

function buildPersonalNumberPool(profile = {}) {
  const pool = new Set();

  // ── Favorite number ──────────────────────────────────────────────────────
  const favRaw = String(profile.favoriteNumber || '').replace(/\D/g, '');
  if (favRaw.length >= 1) {
    const n = parseInt(favRaw, 10);
    if (n >= 1 && n <= 9) {
      // Single digit: offer several memorable forms so every Generate is different
      pool.add(n * 10 + n);         // 7 → 77
      pool.add(10 + n);             // 7 → 17
      pool.add(20 + n);             // 7 → 27
      pool.add(30 + n);             // 7 → 37
      pool.add(n * 7);              // 7 → 49  (n×7 is memorable)
      pool.add(n * 9);              // 7 → 63
    } else if (n >= 10 && n <= 99) {
      pool.add(n);                  // use as-is
      pool.add(n + 1);              // one above
      pool.add(n % 10 === 0 ? n + 7 : n - (n % 10));  // round variation
    } else if (n >= 100) {
      pool.add(n % 100);            // last two digits only
      pool.add(Math.floor(n / 10) % 100);
    }
  }

  // ── Date of Birth ────────────────────────────────────────────────────────
  const dob = String(profile.dob || profile.dateOfBirth || '');
  if (dob) {
    const parts = dob.split(/[-\/]/);
    // Format YYYY-MM-DD or DD-MM-YYYY
    const year  = parseInt(parts[0].length === 4 ? parts[0] : parts[2], 10);
    const month = parseInt(parts[0].length === 4 ? parts[1] : parts[1], 10);
    const day   = parseInt(parts[0].length === 4 ? parts[2] : parts[0], 10);

    if (!isNaN(day) && day >= 1 && day <= 31) {
      pool.add(day < 10 ? day * 11 : day);           // 7 → 77, 26 → 26
    }
    if (!isNaN(month) && month >= 1 && month <= 12) {
      pool.add(month < 10 ? month * 11 : month);     // month form
      if (!isNaN(day))
        pool.add(month * 10 + (day % 10));            // combined (e.g. May 26 → 56)
    }
    if (!isNaN(year) && year > 1900) {
      pool.add(year % 100);                           // e.g. 2004 → 04 → store as 44 if <10
      const yy = year % 100;
      if (yy < 10) pool.add(yy * 11); else pool.add(yy);
    }
  }

  // ── Custom keyword lengths (unexpected personal anchors) ─────────────────
  for (const kw of parseCustomKeywords(profile).slice(0, 3)) {
    const n = kw.length;
    if (n >= 2 && n <= 9) pool.add(n * 10 + n);
  }

  // Remove single-digit values and 0
  const filtered = [...pool].filter(n => n >= 10 && n <= 999);

  // Always have at least a random fallback
  if (filtered.length === 0) filtered.push(10 + randomInt(90));

  return filtered;
}

function personalNumber(profile = {}) {
  const pool = buildPersonalNumberPool(profile);
  return String(pick(pool));
}

// ── Letter-pivot word pool ─────────────────────────────────────────────────
// Maps a first letter → all word-bank words starting with that letter.

function letterPool(letter) {
  const L = letter.toUpperCase();
  return ALL_WORDS.filter(w => w.charAt(0).toUpperCase() === L);
}

// ── Per-field anchor sources ───────────────────────────────────────────────
// Each profile field becomes an independent pool.  On every Generate call
// we pick a RANDOM field and a RANDOM word from it — full entropy across
// the whole profile, not just one predetermined letter.

function buildFieldAnchorSources(profile = {}) {
  const sources = [];

  const nameFields = [
    { key: 'firstName',   val: profile.firstName   || profile.name    },
    { key: 'lastName',    val: profile.lastName    || profile.surname  },
    { key: 'nickname',    val: profile.nickname    || profile.nick     },
    { key: 'petName',     val: profile.petName     || profile.pet      },
    { key: 'partnerName', val: profile.partnerName                     },
    { key: 'gamerTag',    val: profile.gamerTag                        },
    { key: 'commonAlias', val: profile.commonAlias                     },
    { key: 'companyName', val: profile.companyName || profile.company  },
    { key: 'sportsTeam',  val: profile.sportsTeam                      },
  ];

  for (const { key, val } of nameFields) {
    if (!val || typeof val !== 'string' || val.trim().length < 2) continue;
    const pool = letterPool(val.trim().charAt(0));
    if (pool.length > 0) sources.push({ key, val: val.trim(), pool });
  }

  // Custom keywords each get their own source
  for (const kw of parseCustomKeywords(profile).slice(0, 5)) {
    if (kw.length < 2) continue;
    const pool = letterPool(kw.charAt(0));
    if (pool.length > 0) sources.push({ key: 'custom', val: kw, pool });
  }

  return sources;
}

/**
 * Pick ONE personal anchor word from a randomly chosen profile field.
 * Returns the word or null if no anchors available.
 */
function pickAnchorWord(anchorSources, used) {
  if (anchorSources.length === 0) return null;

  // Shuffle sources so every call picks a different field
  const shuffledSources = shuffle(anchorSources);

  for (const { pool } of shuffledSources) {
    const words = shuffle(pool);
    for (const raw of words) {
      const w = titleCase(raw);
      if (w.length >= 4 && !used.has(w.toLowerCase())) return w;
    }
  }
  return null;
}

// ── Profile-seeded background word pool ───────────────────────────────────

function profileSeed(profile = {}) {
  const str = [
    profile.firstName, profile.lastName, profile.nickname, profile.petName,
    profile.companyName, profile.favoriteNumber, profile.gamerTag,
    profile.sportsTeam, profile.commonAlias, profile.dob,
    ...parseCustomKeywords(profile),
  ].filter(Boolean).join('|');

  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h  = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function memoryWordPool(profile = {}) {
  const seed = profileSeed(profile);
  const cats  = ['space', 'science', 'nature', 'tech', 'fantasy', 'animals', 'general'];
  const primary   = cats[seed % cats.length];
  const secondary = cats[(seed >>> 5) % cats.length];
  return [
    ...new Set([
      ...(WORD_BANK[primary]   || []),
      ...(WORD_BANK[secondary] || []),
      ...ALL_WORDS,
    ]),
  ];
}

// ── Candidate builder ──────────────────────────────────────────────────────
//
// Word composition (all slots are shuffled before joining):
//   • 1 website-context keyword  (brand-specific — e.g. "Creative" for Instagram)
//   • 1-2 personal anchor words  (from a RANDOMLY chosen profile field each time)
//   • remaining slots: profile-seeded random words for extra entropy

function makeCandidate(profile, websiteContext, anchorSources, options = {}) {
  const contextPool = websiteContext?.keywords?.length
    ? websiteContext.keywords
    : ['Portal', 'Account', 'Access', 'Member'];

  const memoryPool = shuffle(memoryWordPool(profile));
  const wordCount  = Math.max(3, Math.min(4, options.wordCount || 3));

  const words = [];
  const used  = new Set();

  // Slot 0 – website context keyword
  const ctxWord = titleCase(pick(contextPool));
  words.push(ctxWord);
  used.add(ctxWord.toLowerCase());

  // Slot 1 – personal anchor (random profile field each call)
  const anchor1 = pickAnchorWord(anchorSources, used);
  if (anchor1) {
    words.push(anchor1);
    used.add(anchor1.toLowerCase());
  }

  // Slot 2 (optional for 4-word passwords) – second anchor from a DIFFERENT field
  // or a memory word; coin-flip decides
  if (wordCount >= 4 && anchorSources.length >= 2 && coinFlip()) {
    const anchor2 = pickAnchorWord(anchorSources, used);
    if (anchor2) {
      words.push(anchor2);
      used.add(anchor2.toLowerCase());
    }
  }

  // Remaining slots – background memory words
  for (const raw of memoryPool) {
    if (words.length >= wordCount) break;
    const w = titleCase(raw);
    if (w.length >= 4 && !used.has(w.toLowerCase())) {
      words.push(w);
      used.add(w.toLowerCase());
    }
  }

  // Shuffle all word slots so position is unpredictable
  const shuffled = shuffle(words);
  const number   = personalNumber(profile);
  const symbol   = options.symbols === false ? '' : pick(SYMBOLS);

  return `${shuffled.join(options.separator || '')}${number}${symbol}`;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function generateContextAwarePassword({
  profile        = {},
  websiteContext = {},
  username       = '',
  validation     = {},
  options        = {},
} = {}) {
  // Build anchor sources once per generation session
  const anchorSources = buildFieldAnchorSources(profile);

  let best = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const password = makeCandidate(profile, websiteContext, anchorSources, options);
    const result   = await validateGeneratedPassword(password, {
      ...validation,
      profile,
      username,
      domain: websiteContext.domain || validation.domain || '',
    });

    if (!best || result.strengthScore > best.validation.strengthScore) {
      best = { password, validation: result, attempt };
    }
    if (result.passed) {
      return { password, validation: result, attempt, websiteContext };
    }
  }

  const error = new Error(
    best?.validation?.reasoning ||
    'Unable to produce a password that passes every validation check.'
  );
  error.bestCandidate = best;
  throw error;
}
