import { WORD_BANK, ALL_WORDS } from './wordBank.js';
import { validateGeneratedPassword } from './generatorValidator.js';

const SYMBOLS = '!@#$%&*?';
const MAX_ATTEMPTS = 80;

function randomInt(max) {
  if (max <= 0) return 0;
  const values = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % max);
  do globalThis.crypto.getRandomValues(values); while (values[0] >= limit);
  return values[0] % max;
}

function pick(values) {
  return values[randomInt(values.length)];
}

function titleCase(word) {
  const value = String(word || '').replace(/[^a-z]/gi, '');
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function profileSeed(profile = {}) {
  const values = [
    profile.firstName, profile.lastName, profile.nickname, profile.petName,
    profile.companyName, profile.favoriteNumber, profile.gamerTag,
    profile.sportsTeam, profile.commonAlias, profile.name, profile.surname,
    profile.nick, profile.pet, profile.company, profile.dob,
    ...(Array.isArray(profile.customKeywords) ? profile.customKeywords : []),
  ].filter(Boolean).join('|');

  let hash = 2166136261;
  for (let index = 0; index < values.length; index++) {
    hash ^= values.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function memoryWordPool(profile = {}) {
  const seed = profileSeed(profile);
  const categories = ['space', 'science', 'nature', 'tech', 'fantasy', 'animals', 'general'];
  const primary = categories[seed % categories.length];
  const secondary = categories[(seed >>> 5) % categories.length];
  return [...new Set([...(WORD_BANK[primary] || []), ...(WORD_BANK[secondary] || []), ...ALL_WORDS])];
}

function makeCandidate(profile, websiteContext, options = {}) {
  const memoryPool = memoryWordPool(profile);
  const contextPool = websiteContext?.keywords?.length
    ? websiteContext.keywords
    : ['Portal', 'Account', 'Access', 'Member'];
  const wordCount = Math.max(3, Math.min(4, options.wordCount || 3));
  const words = [titleCase(pick(contextPool))];

  while (words.length < wordCount) {
    const word = titleCase(pick(memoryPool));
    if (word.length >= 4 && !words.some(existing => existing.toLowerCase() === word.toLowerCase())) {
      words.push(word);
    }
  }

  for (let index = words.length - 1; index > 0; index--) {
    const swapIndex = randomInt(index + 1);
    [words[index], words[swapIndex]] = [words[swapIndex], words[index]];
  }

  const number = String(10 + randomInt(90));
  const symbol = options.symbols === false ? '' : pick(SYMBOLS);
  return `${words.join(options.separator || '')}${number}${symbol}`;
}

export async function generateContextAwarePassword({
  profile = {},
  websiteContext = {},
  username = '',
  validation = {},
  options = {},
} = {}) {
  let best = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const password = makeCandidate(profile, websiteContext, options);
    const result = await validateGeneratedPassword(password, {
      ...validation,
      profile,
      username,
      domain: websiteContext.domain || validation.domain || '',
    });

    if (!best || result.strengthScore > best.validation.strengthScore) {
      best = { password, validation: result, attempt };
    }
    if (result.passed) {
      return {
        password,
        validation: result,
        attempt,
        websiteContext,
      };
    }
  }

  const error = new Error(best?.validation?.reasoning || 'Unable to produce a password that passes every validation check');
  error.bestCandidate = best;
  throw error;
}

