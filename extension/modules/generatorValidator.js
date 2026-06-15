import { analyseStrength } from './strength.js';
import { detectPatterns } from './patterns.js';
import { checkWordlist } from './wordlist.js';
import { checkUsername } from './username.js';
import { computeScore } from './scorer.js';
import { computePersonalScore, findPasswordInDictionary } from './personalDictionaryScorer.js';
import { generatePersonalDictionary } from './personalDictionaryGenerator.js';

const REUSE_KEY = 'vz_password_reuse_signatures';
const MAX_REUSE_RECORDS = 50;
const generatedDictionaryCache = new Map();

function normalizeDictionaryProfile(profile = {}) {
  return {
    name: profile.name || profile.firstName || '',
    surname: profile.surname || profile.lastName || '',
    nick: profile.nick || profile.nickname || '',
    username: profile.username || '',
    pet: profile.pet || profile.petName || '',
    partner: profile.partner || profile.partnerName || '',
    company: profile.company || profile.companyName || '',
    dob: profile.dob || profile.dateOfBirth || '',
    favoriteNumber: profile.favoriteNumber || '',
    gamerTag: profile.gamerTag || '',
    sportsTeam: profile.sportsTeam || '',
    commonAlias: profile.commonAlias || '',
    customKeywords: Array.isArray(profile.customKeywords) ? profile.customKeywords : [],
  };
}

function dictionaryForProfile(profile) {
  const normalized = normalizeDictionaryProfile(profile);
  const key = JSON.stringify(normalized);
  if (!generatedDictionaryCache.has(key)) {
    generatedDictionaryCache.set(key, generatePersonalDictionary(normalized));
  }
  return generatedDictionaryCache.get(key);
}

function profileTokens(profile = {}) {
  const scalarFields = [
    'firstName', 'lastName', 'nickname', 'username', 'petName', 'partnerName',
    'companyName', 'favoriteNumber', 'gamerTag', 'sportsTeam', 'commonAlias',
    'name', 'surname', 'nick', 'pet', 'partner', 'company', 'dob',
  ];
  const values = scalarFields.map(key => profile[key]);
  if (Array.isArray(profile.customKeywords)) values.push(...profile.customKeywords);
  return values
    .flatMap(value => String(value || '').toLowerCase().split(/[^a-z0-9]+/))
    .filter(token => token.length >= 3);
}

function dateTokens(profile = {}) {
  const dob = String(profile.dateOfBirth || profile.dob || '');
  if (!dob) return [];
  const [year, month, day] = dob.split('-');
  return [year, year?.slice(-2), `${day}${month}`, `${month}${day}`].filter(Boolean);
}

function hasDirectProfileExposure(password, profile) {
  const lower = password.toLowerCase();
  const exposedToken = profileTokens(profile).find(token => lower.includes(token));
  if (exposedToken) return 'Contains a raw personal profile value';
  if (dateTokens(profile).some(token => token.length >= 2 && lower.includes(token))) {
    return 'Contains a date derived from the personal profile';
  }
  return '';
}

function hasCommonPattern(patterns) {
  return patterns.keyboard.found ||
    patterns.sequential.found ||
    patterns.repeats.found ||
    patterns.dates.found;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalize(password) {
  return password.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function ngrams(value, size = 3) {
  if (value.length <= size) return value ? [value] : [];
  return Array.from({ length: value.length - size + 1 }, (_, index) => value.slice(index, index + size));
}

export async function createReuseSignature(password) {
  const canonical = canonicalize(password);
  const exactHash = await sha256(canonical);
  const featureHashes = await Promise.all(
    [...new Set(ngrams(canonical))].map(value => sha256(value))
  );
  return { exactHash, featureHashes };
}

function similarity(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap++;
  return overlap / Math.max(a.size, b.size);
}

async function getReuseRecords() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  return new Promise(resolve => {
    chrome.storage.local.get(REUSE_KEY, data => resolve(data[REUSE_KEY] || []));
  });
}

export async function checkReuseSimilarity(password, domain = '', records = null) {
  const signature = await createReuseSignature(password);
  const stored = records || await getReuseRecords();
  let highestSimilarity = 0;
  let exactReuse = false;

  for (const record of stored) {
    if (record.domain === domain) continue;
    if (record.exactHash === signature.exactHash) exactReuse = true;
    highestSimilarity = Math.max(highestSimilarity, similarity(signature.featureHashes, record.featureHashes));
  }

  return {
    exactReuse,
    highestSimilarity,
    passed: !exactReuse && highestSimilarity < 0.72,
    signature,
  };
}

export async function rememberPasswordSignature(password, domain = '') {
  if (!password || typeof chrome === 'undefined' || !chrome.storage?.local) return;
  const signature = await createReuseSignature(password);
  const records = await getReuseRecords();
  const next = [
    { domain, ...signature, createdAt: Date.now() },
    ...records.filter(record => record.exactHash !== signature.exactHash),
  ].slice(0, MAX_REUSE_RECORDS);

  await new Promise(resolve => chrome.storage.local.set({ [REUSE_KEY]: next }, resolve));
}

export async function validateGeneratedPassword(password, {
  profile = {},
  username = '',
  domain = '',
  dictionary = null,
  dictionaryLookup = null,
  dictionarySize = 0,
  reuseRecords = null,
} = {}) {
  const strength = analyseStrength(password);
  const patterns = detectPatterns(password);
  const wordlist = checkWordlist(password);
  const usernameResult = checkUsername(password, username);
  const hasProfile = profileTokens(profile).length > 0 || dateTokens(profile).length > 0;

  if (!dictionaryLookup && (!Array.isArray(dictionary) || dictionary.length === 0) && hasProfile) {
    dictionary = dictionaryForProfile(profile);
    dictionarySize = dictionary.length;
  }

  let personalResult = { found: false, rank: null };
  if (dictionaryLookup) personalResult = dictionaryLookup(password);
  else if (Array.isArray(dictionary) && dictionary.length) {
    personalResult = findPasswordInDictionary(password, dictionary);
    dictionarySize = dictionary.length;
  }

  const scoreResult = computeScore(strength, wordlist, patterns, usernameResult, personalResult);
  const personalScore = personalResult.found
    ? computePersonalScore(true, personalResult.rank, dictionarySize)
    : (hasProfile ? Math.max(81, computePersonalScore(false, null, dictionarySize)) : 100);
  const exposureReason = hasDirectProfileExposure(password, profile);
  const reuse = await checkReuseSimilarity(password, domain, reuseRecords);
  const failures = [];

  if (scoreResult.score <= 80) failures.push(`Strength score is ${scoreResult.score}; it must exceed 80`);
  if (personalScore <= 80) failures.push(`Personalized attack score is ${personalScore}; it must exceed 80`);
  if (personalResult.found) failures.push('Found in the personalized attack dictionary');
  if (exposureReason) failures.push(exposureReason);
  if (wordlist.exactMatch || wordlist.leetMatch) failures.push('Matches a common password');
  if (hasCommonPattern(patterns)) failures.push('Contains a common password pattern');
  if (!reuse.passed) failures.push(reuse.exactReuse ? 'Reuses a password from another account' : 'Too similar to a password used on another account');

  const passed = failures.length === 0;
  const reasoning = passed
    ? `Strong, unique for ${domain || 'this account'}, free of raw profile values, and resistant to the personalized attack dictionary.`
    : failures[0];

  return {
    passed,
    password,
    strengthScore: scoreResult.score,
    personalizedAttackScore: personalScore,
    personalResult,
    reasoning,
    failures,
    strength,
    patterns,
    wordlist,
    reuse,
    scoreResult,
  };
}
