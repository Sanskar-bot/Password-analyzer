/**
 * personalDictionaryGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CUPP-inspired personalized password dictionary generator.
 *
 * Source intelligence extracted from cupp.py (Mebus / j0rgan), re-implemented
 * cleanly in JavaScript for browser use. All CLI, file I/O, download, and
 * interactive-terminal logic from the original CUPP has been discarded.
 *
 * What is retained from CUPP:
 *   • generate_wordlist_from_profile() — core combination engine
 *   • make_leet()                      — character substitution
 *   • komb() helper                    — Cartesian word+suffix concat
 *   • concats() helper                 — numeric suffix ranges
 *   • Birthday decomposition           — yy / yyy / yyyy / dd / mm variants
 *   • Name casing variants             — lower / Title / UPPER / reversed
 *
 * What is NOT here:
 *   interactive(), print_to_file(), print_cow(), read_config(),
 *   improve_dictionary(), download_http(), alectodb_download(),
 *   download_wordlist(), get_parser(), main(), argparse, urllib, gzip, csv
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Configuration (replaces cupp.cfg) ────────────────────────────────────────

/** Years most commonly embedded in passwords (most probable first). */
const YEARS = [
  '2004','2003','2005','2002','2001','2000','1999','1998','1997','1996',
  '2006','2007','2008','2009','2010','2011','2012','2013','2014','2015',
  '2016','2017','2018','2019','2020','2021','2022','2023','2024','2025','2026',
];

/** Special character suffixes appended to base words. */
const SPECIAL_SUFFIXES = [
  '!', '@', '#', '$', '.',
  '123', '1234', '12345', '123456',
  '@123', '@1234', '@12345',
  '@2024', '@2025', '@2026', '@2023',
  '!123', '#123',
];

/** Common vanity/identity words humans append to personalised passwords. */
const VANITY_WORDS = [
  'king', 'boss', 'gaming', 'pro', 'official', 'legend', 'hero',
  'god', 'master', 'ninja', 'elite', 'prime', 'next', 'cool', 'real',
  'the', 'its', 'im', 'iam', 'my', 'live', 'star', 'fire',
];

/** Simple numeric suffixes: 0–99 and common 3/4-digit numbers. */
const NUM_SUFFIXES = (() => {
  const nums = [];
  for (let i = 0; i <= 99; i++) nums.push(String(i).padStart(2, '0'));
  for (let i = 100; i <= 999; i++) nums.push(String(i));
  return nums;
})();

/** Leetspeak substitution map (extracted from cupp.cfg). */
const LEET_MAP = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', g: '9', z: '2' };

/** Minimum / maximum realistic password lengths to include in output. */
const MIN_LEN = 6;
const MAX_LEN = 24;

/** Hard cap on final dictionary size. */
const DICT_CAP = 20000;

// ── Core helpers (adapted from CUPP's komb / concats / make_leet) ─────────────

/**
 * Cartesian concatenation: for each `word` in `words`, yield `word + sep + suffix`
 * for each `suffix` in `suffixes`. Equivalent to CUPP's `komb()`.
 *
 * @param {string[]} words
 * @param {string[]} suffixes
 * @param {string}   sep       separator (default "")
 * @returns {string[]}
 */
function komb(words, suffixes, sep = '') {
  const out = [];
  for (const w of words) {
    if (!w) continue;
    for (const s of suffixes) {
      if (!s) continue;
      out.push(w + sep + s);
    }
  }
  return out;
}

/**
 * Append numeric range to each word. Equivalent to CUPP's `concats()`.
 * @param {string[]} words
 * @param {number}   from
 * @param {number}   to    (exclusive)
 * @returns {string[]}
 */
function concats(words, from, to) {
  const out = [];
  for (const w of words) {
    if (!w) continue;
    for (let n = from; n < to; n++) out.push(w + n);
  }
  return out;
}

/**
 * Convert a string to leetspeak. Equivalent to CUPP's `make_leet()`.
 * Only replaces lowercase characters to avoid double-transformations.
 * @param {string} str
 * @returns {string}
 */
function makeLeet(str) {
  return str
    .toLowerCase()
    .split('')
    .map(c => LEET_MAP[c] ?? c)
    .join('');
}

/**
 * Produce realistic leetspeak variants of a word.
 * We generate: fully leet + partially leet (preserve first char casing).
 * This avoids exploding the dictionary with every permutation.
 * @param {string} word
 * @returns {string[]}
 */
function leetVariants(word) {
  if (!word || word.length < 3) return [];
  const lower = word.toLowerCase();
  const full  = makeLeet(lower);
  if (full === lower) return []; // no substitution occurred
  const variants = [full];
  // Title-cased leet: first char uppercased
  variants.push(full[0].toUpperCase() + full.slice(1));
  return variants;
}

// ── Birthday decomposition (adapted from CUPP lines 395–417) ─────────────────

/**
 * Break a date string (YYYY-MM-DD from HTML date input) into all sub-parts
 * that humans typically embed in passwords.
 *
 * @param {string} dateStr  e.g. "2004-01-15"
 * @returns {string[]}      unique non-empty date fragments
 */
function decomposeBirthday(dateStr) {
  if (!dateStr || dateStr.length < 8) return [];

  // Parse YYYY-MM-DD (HTML date input format)
  const parts = dateStr.split('-');
  if (parts.length < 3) return [];

  const yyyy = parts[0];                  // "2004"
  const mm   = parts[1];                  // "01"
  const dd   = parts[2];                  // "15"
  const yy   = yyyy.slice(-2);            // "04"
  const yyy  = yyyy.slice(-3);            // "004"
  const xm   = mm.replace(/^0/, '');      // "1"  (single-digit month)
  const xd   = dd.replace(/^0/, '');      // "15" (single-digit day)

  // CUPP also generates DDMMYYYY-style strings
  const ddmm = dd + mm;
  const mmdd = mm + dd;
  const ddmmyyyy = dd + mm + yyyy;
  const mmddyyyy = mm + dd + yyyy;
  const ddmmyy   = dd + mm + yy;
  const yyyymmdd = yyyy + mm + dd;

  const atoms = [yy, yyy, yyyy, xd, xm, dd, mm, ddmm, mmdd, ddmmyyyy, mmddyyyy, ddmmyy, yyyymmdd];

  // Pairwise combinations of atoms (matches CUPP's bdss generation)
  const pairs = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = 0; j < atoms.length; j++) {
      if (i !== j) pairs.push(atoms[i] + atoms[j]);
    }
  }

  const all = [...atoms, ...pairs];
  // Deduplicate and remove empties
  return [...new Set(all.filter(Boolean))];
}

// ── Name variant generation ───────────────────────────────────────────────────

/**
 * Generate all casing/reversal variants of a name token.
 * Equivalent to CUPP's nameup / rev_name / etc. variables.
 *
 * @param {string} name
 * @returns {string[]}  [lower, Title, UPPER, reversed-lower, reversed-Title]
 */
function nameVariants(name) {
  if (!name) return [];
  const lower   = name.toLowerCase();
  const title   = lower[0].toUpperCase() + lower.slice(1);
  const upper   = lower.toUpperCase();
  const revLow  = lower.split('').reverse().join('');
  const revTit  = title.split('').reverse().join('');
  return [...new Set([lower, title, upper, revLow, revTit].filter(Boolean))];
}

/**
 * Generate pair combinations of two token sets (names with names).
 * Adapted from CUPP's `kombinaa` / `kombinaaw` generation block.
 *
 * @param {string[]} setA
 * @param {string[]} setB
 * @returns {string[]}
 */
function pairCombinations(setA, setB) {
  const out = [];
  for (const a of setA) {
    for (const b of setB) {
      if (a && b && a !== b) out.push(a + b);
    }
  }
  return out;
}

// ── Priority-aware entry builder ──────────────────────────────────────────────

/**
 * Build the ordered list of password candidates from a profile.
 * Entries are added in priority order so that rank-by-index is meaningful.
 *
 * Priority tiers (match the spec):
 *   P1: Name-based combinations (highest probability)
 *   P2: Nickname combinations
 *   P3: Pet name combinations
 *   P4: Partner name combinations
 *   P5: Company name combinations
 *
 * Within each tier, order is:
 *   bare → + common nums → + year → + birthday → + special → + vanity → leet
 *
 * @param {object}   profile
 * @param {string}   [profile.name]           First name
 * @param {string}   [profile.surname]        Last name
 * @param {string}   [profile.nick]           Nickname
 * @param {string}   [profile.username]       Online username
 * @param {string}   [profile.dob]            HTML date: "YYYY-MM-DD"
 * @param {string}   [profile.partner]        Partner name
 * @param {string}   [profile.pet]            Pet name
 * @param {string}   [profile.company]        Company / school
 * @param {string}   [profile.gamerTag]       Gaming handle / alias
 * @param {string}   [profile.sportsTeam]     Favourite sports team
 * @param {string}   [profile.favoriteNumber] Lucky / favourite number
 * @param {string}   [profile.commonAlias]    Common alias / handle
 * @param {string[]} [profile.customKeywords] Extra keywords (array)
 * @returns {string[]}  Ordered candidates (before dedup + cap)
 */
function buildCandidates(profile) {
  const candidates = [];

  // Helper to push a batch in order
  const push = (...batches) => {
    for (const batch of batches) {
      for (const entry of batch) candidates.push(entry);
    }
  };

  // ── Parse personal data ─────────────────────────────────────────────────────
  const nameVars     = nameVariants(profile.name         || '');
  const surnameVars  = nameVariants(profile.surname      || '');
  const nickVars     = nameVariants(profile.nick         || '');
  const usernameVars = nameVariants(profile.username     || '');
  const partnerVars  = nameVariants(profile.partner      || '');
  const petVars      = nameVariants(profile.pet          || '');
  const companyVars  = nameVariants(profile.company      || '');
  const gamerTagVars = nameVariants(profile.gamerTag     || '');
  const teamVars     = nameVariants(profile.sportsTeam   || '');
  const aliasVars    = nameVariants(profile.commonAlias  || '');
  const dobFrags     = decomposeBirthday(profile.dob || '');

  // Favourite number — used as a suffix/prefix token
  const favNum  = profile.favoriteNumber ? String(profile.favoriteNumber).trim() : '';
  const numTokens = favNum ? [favNum, favNum + favNum] : [];

  // Custom keywords — each word gets the nameVariants treatment
  const rawKeywords = Array.isArray(profile.customKeywords)
    ? profile.customKeywords.filter(k => k && String(k).trim().length > 0)
    : [];
  const keywordVarSets = rawKeywords.map(k => nameVariants(String(k).trim()));
  const allKeywordVars = [...new Set(keywordVarSets.flat())];

  // Birth year (4-digit) and last 2 digits — highest probability
  const dobYear = profile.dob ? profile.dob.split('-')[0] : '';
  const dobYY   = dobYear.slice(-2);

  // All name tokens combined (name + surname) — mirrors CUPP's kombina list
  const primaryVars    = [...new Set([...nameVars, ...surnameVars])].filter(Boolean);
  const fullNamePairs  = pairCombinations(nameVars, surnameVars);
  const allPrimaryVars = [...new Set([...primaryVars, ...fullNamePairs])];

  // ── PRIORITY 0: Custom keywords (highest priority — user explicitly added these)
  // These are inserted FIRST so they always survive the DICT_CAP cut.
  // The raw string itself is always included (exact match).
  if (rawKeywords.length) {
    // Raw keywords exactly as entered (these ARE the most important entries)
    push(rawKeywords);
    // All casing/reversal variants
    push(allKeywordVars);
    // Keyword + common number suffixes
    push(komb(rawKeywords, ['123', '1234', '12345', '@123', '@1234']));
    push(komb(allKeywordVars, ['123', '1234', '12345', '@123', '@1234']));
    // Keyword + special suffixes
    push(komb(rawKeywords, SPECIAL_SUFFIXES));
    push(komb(allKeywordVars, SPECIAL_SUFFIXES));
    // Keyword + birth year
    if (dobYear) {
      push(komb(rawKeywords, [dobYear, dobYY]));
      push(komb(allKeywordVars, [dobYear, dobYY]));
    }
    // Keyword + all years
    push(komb(rawKeywords, YEARS));
    push(komb(allKeywordVars, YEARS));
    // Keyword + numbers 1-99
    push(concats(rawKeywords, 1, 100));
    push(concats(allKeywordVars, 1, 100));
    // Keyword + favourite number
    if (numTokens.length) {
      push(komb(rawKeywords, numTokens));
      push(komb(allKeywordVars, numTokens));
    }
    // Keyword ↔ name combinations
    if (nameVars.length) {
      push(pairCombinations(rawKeywords, nameVars));
      push(pairCombinations(nameVars, rawKeywords));
    }
    // Leet variants of each raw keyword
    for (const kw of rawKeywords) {
      push(leetVariants(kw));
    }
  }

  // ── PRIORITY 1: Name-based ──────────────────────────────────────────────────

  // Spec tier 1 patterns first (exact patterns from requirements)
  if (nameVars.length) {
    push(
      nameVars,                                               // {Name}
      komb(nameVars, ['123', '1234', '12345', '123456']),    // {Name}123
      komb(nameVars, ['@123', '@1234', '@12345']),           // {Name}@123
      dobYear ? komb(nameVars, [dobYear])            : [],   // {Name}{BirthYear}
      dobYear ? komb(nameVars, [dobYear], '_')       : [],   // {Name}_{BirthYear}
      dobYY   ? komb(nameVars, [dobYY])              : [],   // {Name}{YY}
      dobFrags.length ? komb(nameVars, dobFrags)     : [],   // {Name}{DOB}
      dobFrags.length ? komb(nameVars, dobFrags, '_'): [],   // {Name}_{DOB}
    );
  }

  // Name + surname pairs with date/year
  if (allPrimaryVars.length) {
    push(
      allPrimaryVars,
      komb(allPrimaryVars, YEARS),
      komb(allPrimaryVars, YEARS, '_'),
      dobFrags.length ? komb(allPrimaryVars, dobFrags)     : [],
      dobFrags.length ? komb(allPrimaryVars, dobFrags, '_'): [],
      komb(allPrimaryVars, SPECIAL_SUFFIXES),
      komb(allPrimaryVars, ['!', '@', '#', '$']),
    );
  }

  // Name + vanity words (SanskarKing, SanskarBoss etc.)
  if (nameVars.length) {
    push(
      komb(nameVars, VANITY_WORDS),
      komb(nameVars, VANITY_WORDS.map(v => v[0].toUpperCase() + v.slice(1))),
      komb(VANITY_WORDS, nameVars),
      komb(allPrimaryVars, VANITY_WORDS),
    );
  }

  // Name + numeric concats (1–999)
  if (nameVars.length) {
    push(concats(nameVars, 1, 100));
    if (candidates.length < DICT_CAP * 0.4) {
      push(concats(nameVars, 100, 1000));
    }
  }

  // Name + all years (broader set)
  if (nameVars.length) {
    push(
      komb(nameVars, YEARS),
      komb(nameVars, YEARS, '_'),
      komb(nameVars, YEARS, '@'),
    );

    // {Name}{Year}@ and {Name}{Year}! — very common human pattern
    // e.g. Sanskar2004@ / Sanskar2004!
    const yearSuffixCombos = [];
    for (const name of nameVars) {
      for (const year of YEARS) {
        yearSuffixCombos.push(name + year + '@');
        yearSuffixCombos.push(name + year + '!');
        yearSuffixCombos.push(name + year + '#');
        yearSuffixCombos.push(name + year + '$');
        yearSuffixCombos.push(name + year + '.');
      }
    }
    // Also {Name}{YY}@ pattern
    if (dobYear) {
      for (const name of nameVars) {
        yearSuffixCombos.push(name + dobYY + '@');
        yearSuffixCombos.push(name + dobYear + '@');
        yearSuffixCombos.push(name + dobYear + '!');
        yearSuffixCombos.push(name + dobYear + '#');
      }
    }
    push(yearSuffixCombos);
  }

  // ── PRIORITY 2: Username combinations ──────────────────────────────────────
  if (usernameVars.length) {
    push(
      usernameVars,
      komb(usernameVars, ['123', '1234', '@123', '@1234']),
      dobYear ? komb(usernameVars, [dobYear]) : [],
      komb(usernameVars, YEARS),
      komb(usernameVars, SPECIAL_SUFFIXES),
      komb(usernameVars, VANITY_WORDS),
      concats(usernameVars, 1, 100),
    );
  }

  // ── PRIORITY 3: Nickname combinations ──────────────────────────────────────
  if (nickVars.length) {
    push(
      nickVars,
      komb(nickVars, ['123', '1234', '@123', '@1234']),
      dobYear ? komb(nickVars, [dobYear]) : [],
      dobFrags.length ? komb(nickVars, dobFrags) : [],
      komb(nickVars, YEARS),
      komb(nickVars, SPECIAL_SUFFIXES),
      komb(nickVars, VANITY_WORDS),
      pairCombinations(nameVars, nickVars),
      pairCombinations(nickVars, nameVars),
      concats(nickVars, 1, 100),
    );
  }

  // ── PRIORITY 4: Pet name combinations ──────────────────────────────────────
  if (petVars.length) {
    push(
      petVars,
      komb(petVars, ['123', '1234', '@123']),
      dobYear ? komb(petVars, [dobYear]) : [],
      komb(petVars, YEARS),
      komb(petVars, SPECIAL_SUFFIXES),
      pairCombinations(nameVars, petVars),
      pairCombinations(petVars, nameVars),
    );
  }

  // ── PRIORITY 5: Partner name combinations ──────────────────────────────────
  if (partnerVars.length) {
    push(
      partnerVars,
      komb(partnerVars, ['123', '1234', '@123']),
      komb(partnerVars, YEARS),
      komb(partnerVars, SPECIAL_SUFFIXES),
      pairCombinations(nameVars, partnerVars),
      pairCombinations(partnerVars, nameVars),
    );
  }

  // ── PRIORITY 6: Company name combinations ──────────────────────────────────
  if (companyVars.length) {
    push(
      companyVars,
      komb(companyVars, ['123', '1234', '@123']),
      komb(companyVars, YEARS),
      komb(companyVars, SPECIAL_SUFFIXES),
    );
  }

  // ── PRIORITY 7: Gamer tag combinations ─────────────────────────────────────
  if (gamerTagVars.length) {
    push(
      gamerTagVars,
      komb(gamerTagVars, ['123', '1234', '@123', '@1234']),
      dobYear ? komb(gamerTagVars, [dobYear])     : [],
      komb(gamerTagVars, YEARS),
      komb(gamerTagVars, SPECIAL_SUFFIXES),
      komb(gamerTagVars, VANITY_WORDS),
      pairCombinations(nameVars, gamerTagVars),
      concats(gamerTagVars, 1, 100),
    );
  }

  // ── PRIORITY 8: Sports team combinations ───────────────────────────────────
  if (teamVars.length) {
    push(
      teamVars,
      komb(teamVars, ['123', '1234', '@123']),
      dobYear ? komb(teamVars, [dobYear]) : [],
      komb(teamVars, YEARS),
      komb(teamVars, SPECIAL_SUFFIXES),
      pairCombinations(nameVars, teamVars),
    );
  }

  // ── PRIORITY 9: Common alias combinations ──────────────────────────────────
  if (aliasVars.length) {
    push(
      aliasVars,
      komb(aliasVars, ['123', '1234', '@123']),
      dobYear ? komb(aliasVars, [dobYear]) : [],
      komb(aliasVars, YEARS),
      komb(aliasVars, SPECIAL_SUFFIXES),
      pairCombinations(nameVars, aliasVars),
      pairCombinations(aliasVars, nameVars),
    );
  }

  // ── PRIORITY 10: Custom keywords (additional combinations — main block is Priority 0)
  // Only add cross-combinations here that weren't covered above.
  if (allKeywordVars.length) {
    push(
      komb(allKeywordVars, VANITY_WORDS),
      pairCombinations(allKeywordVars, surnameVars),
      pairCombinations(allKeywordVars, nickVars),
      dobFrags.length ? komb(allKeywordVars, dobFrags) : [],
    );
  }

  // ── PRIORITY 11: Favourite number as suffix/prefix ──────────────────────────
  if (numTokens.length && allPrimaryVars.length) {
    push(
      komb(allPrimaryVars, numTokens),
      komb(numTokens, allPrimaryVars),
      nameVars.length ? komb(nameVars, numTokens) : [],
    );
  }

  return candidates;
}

// ── Leetspeak augmentation ────────────────────────────────────────────────────

/**
 * Add leet variants for the top portion of the base list.
 * We only leet the first N entries to prevent size explosion.
 * @param {string[]} base
 * @param {number}   limit  max entries to leet-ify
 * @returns {string[]}
 */
function addLeetVariants(base, limit = 3000) {
  const leet = [];
  const sample = base.slice(0, limit);
  for (const word of sample) {
    const variants = leetVariants(word);
    for (const v of variants) leet.push(v);
  }
  return leet;
}

// ── Main public export ────────────────────────────────────────────────────────

/**
 * Generate a personalized password dictionary from a user profile.
 *
 * @param {object}   profile
 * @param {string}   [profile.name]           First name
 * @param {string}   [profile.surname]        Last name
 * @param {string}   [profile.nick]           Nickname
 * @param {string}   [profile.username]       Online username
 * @param {string}   [profile.dob]            Date of birth (HTML format: "YYYY-MM-DD")
 * @param {string}   [profile.partner]        Partner's name
 * @param {string}   [profile.pet]            Pet's name
 * @param {string}   [profile.company]        Company / organisation
 * @param {string}   [profile.gamerTag]       Gaming tag / alias
 * @param {string}   [profile.sportsTeam]     Favourite sports team
 * @param {string}   [profile.favoriteNumber] Lucky / favourite number
 * @param {string}   [profile.commonAlias]    Common alias
 * @param {string[]} [profile.customKeywords] Additional keywords
 *
 * @returns {string[]}
 *   Ordered, deduplicated list of password candidates.
 *   Index = 0 is the highest-probability guess.
 *   Length is at most DICT_CAP (15,000) entries.
 *   All entries are filtered to MIN_LEN–MAX_LEN characters.
 */
export function generatePersonalDictionary(profile) {
  // Guard: at least one token is needed to generate meaningful passwords
  const hasAnyToken = Object.values(profile).some(v => v && String(v).trim().length > 0);
  if (!hasAnyToken) return [];

  // 1. Build base candidates in priority order
  const base = buildCandidates(profile);

  // 2. Add leet variants (appended after base, lower priority)
  const leet = addLeetVariants(base, 2500);

  // 3. Merge, deduplicate (preserving first-seen order = priority order)
  const combined = [...base, ...leet];
  const seen = new Set();
  const unique = [];
  for (const entry of combined) {
    const key = entry.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }

  // 4. Filter by realistic password length
  const filtered = unique.filter(e => e.length >= MIN_LEN && e.length <= MAX_LEN);

  // 5. Cap at DICT_CAP
  return filtered.slice(0, DICT_CAP);
}
