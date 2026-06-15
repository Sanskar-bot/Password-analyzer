import { WORD_BANK, ALL_WORDS } from './wordBank.js';
import { validateGeneratedPassword } from './generatorValidator.js';

const SYMBOLS    = '!@#$%&*?';
const MAX_ATTEMPTS = 100;

// ── Crypto-safe random helpers ─────────────────────────────────────────────

function randomInt(max) {
  if (max <= 0) return 0;
  const buf   = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % max);
  do globalThis.crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

function pick(arr) { return arr[randomInt(arr.length)]; }

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

// ── Personal anchor derivation ─────────────────────────────────────────────
// Uses profile fields INDIRECTLY — the first letter of each name/tag maps to
// a matching word from the word bank.  Raw values are never embedded.

function letterPivotPool(letter) {
  const L = letter.toUpperCase();
  return ALL_WORDS.filter(w => w.charAt(0).toUpperCase() === L);
}

/**
 * Returns a ranked pool of personal anchor words derived from the profile.
 * Each entry records its profile source so we can label it later if needed.
 */
function personalAnchorPool(profile = {}) {
  // Fields that contribute first-letter pivots (order = priority)
  const pivotSources = [
    profile.firstName  || profile.name,
    profile.lastName   || profile.surname,
    profile.nickname   || profile.nick,
    profile.petName    || profile.pet,
    profile.partnerName,
    profile.gamerTag,
    profile.commonAlias,
  ].filter(v => v && typeof v === 'string' && v.trim().length >= 2);

  const letters = [...new Set(pivotSources.map(v => v.trim().charAt(0).toUpperCase()))];

  const pool = [];
  for (const letter of letters) {
    const matches = letterPivotPool(letter);
    // Prefer longer words — more entropy, less guessable
    pool.push(...matches.sort((a, b) => b.length - a.length));
  }

  // Also incorporate first letters from custom keywords
  const custom = Array.isArray(profile.customKeywords)
    ? profile.customKeywords
    : typeof profile.customKeywords === 'string'
      ? profile.customKeywords.split(',').map(s => s.trim()).filter(Boolean)
      : [];

  for (const kw of custom.slice(0, 4)) {
    if (kw.length >= 2) {
      pool.push(...letterPivotPool(kw.charAt(0)));
    }
  }

  // Deduplicate preserving order
  return [...new Map(pool.map(w => [w.toLowerCase(), w])).values()];
}

// ── Personal numeric suffix ────────────────────────────────────────────────
// Uses the favorite number if provided, otherwise derives from DOB, otherwise random.

function personalNumber(profile = {}) {
  const fav = String(profile.favoriteNumber || '').replace(/\D/g, '');
  if (fav.length >= 1) {
    const n = parseInt(fav, 10);
    if (n >= 10 && n <= 99)  return n;           // 2-digit — use as-is
    if (n >= 100 && n <= 999) return n;           // 3-digit — use as-is
    if (n >= 1 && n <= 9)    return n * 10 + n;  // single digit → double it (7 → 77)
  }

  // Derive from DOB day (avoids exposing birth year/month directly)
  const dob = String(profile.dob || profile.dateOfBirth || '');
  if (dob) {
    const parts = dob.split(/[-\/]/);
    const day = parseInt(parts[2] || parts[0], 10);
    if (day >= 10 && day <= 31) return day;
    if (day >= 1 && day <= 9)   return day * 11; // 7 → 77
  }

  // Fallback: crypto-random 2-digit suffix
  return 10 + randomInt(90);
}

// ── Category selection seeded by profile ───────────────────────────────────

function profileSeed(profile = {}) {
  const str = [
    profile.firstName, profile.lastName, profile.nickname, profile.petName,
    profile.companyName, profile.favoriteNumber, profile.gamerTag,
    profile.sportsTeam, profile.commonAlias, profile.dob,
    ...(Array.isArray(profile.customKeywords) ? profile.customKeywords : []),
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
  const cats = ['space', 'science', 'nature', 'tech', 'fantasy', 'animals', 'general'];
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
// Word composition:
//   Slot 0 : website context keyword   (e.g. "Creative" from Instagram)
//   Slot 1 : personal anchor word      (letter-pivot from user's name/pet/etc.)
//   Slot 2+: secure random words       (profile-seeded category)
//
// All slots are shuffled before joining so the structure isn't predictable.

function makeCandidate(profile, websiteContext, options = {}) {
  const contextPool = websiteContext?.keywords?.length
    ? websiteContext.keywords
    : ['Portal', 'Account', 'Access', 'Member'];

  const anchors     = personalAnchorPool(profile);
  const memoryPool  = memoryWordPool(profile);
  const wordCount   = Math.max(3, Math.min(4, options.wordCount || 3));

  const words = [];
  const used  = new Set();

  // Slot 0 – website context
  const ctxWord = titleCase(pick(contextPool));
  words.push(ctxWord);
  used.add(ctxWord.toLowerCase());

  // Slot 1 – personal anchor (if profile has enough data)
  if (anchors.length > 0) {
    // Pick from a shuffled subset so we don't always land on the same letter-word
    const candidates = shuffle(anchors).slice(0, 20);
    for (const raw of candidates) {
      const w = titleCase(raw);
      if (w.length >= 4 && !used.has(w.toLowerCase())) {
        words.push(w);
        used.add(w.toLowerCase());
        break;
      }
    }
  }

  // Remaining slots – profile-seeded random words
  const shuffledMemory = shuffle(memoryPool);
  for (const raw of shuffledMemory) {
    if (words.length >= wordCount) break;
    const w = titleCase(raw);
    if (w.length >= 4 && !used.has(w.toLowerCase())) {
      words.push(w);
      used.add(w.toLowerCase());
    }
  }

  // Shuffle all slots so website/personal position varies
  const shuffled = shuffle(words);

  const number = String(personalNumber(profile));
  const symbol = options.symbols === false ? '' : pick(SYMBOLS);

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
  let best = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const password = makeCandidate(profile, websiteContext, options);
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
