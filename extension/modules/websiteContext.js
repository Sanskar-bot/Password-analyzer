const KNOWN_SITES = {
  'github.com':   { brand: 'GitHub',   keywords: ['Git', 'Code', 'Developer', 'Repository'] },
  'linkedin.com': { brand: 'LinkedIn', keywords: ['Career', 'Professional', 'Network', 'Connect'] },
  'netflix.com':  { brand: 'Netflix',  keywords: ['Cinema', 'Movie', 'Streaming', 'Screen'] },
  'amazon.com':   { brand: 'Amazon',   keywords: ['Shop', 'Store', 'Market', 'Cart'] },
  'google.com':   { brand: 'Google',   keywords: ['Search', 'Cloud', 'Workspace', 'Account'] },
  'microsoft.com':{ brand: 'Microsoft',keywords: ['Windows', 'Cloud', 'Office', 'Account'] },
  'apple.com':    { brand: 'Apple',    keywords: ['Device', 'Cloud', 'App', 'Account'] },
  'facebook.com': { brand: 'Facebook', keywords: ['Social', 'Friends', 'Connect', 'Network'] },
  'instagram.com':{ brand: 'Instagram',keywords: ['Photo', 'Social', 'Story', 'Connect'] },
};

const GENERIC_CONTEXT_WORDS = ['Portal', 'Account', 'Access', 'Member'];
const IGNORED_LABELS = new Set(['www', 'com', 'net', 'org', 'co', 'io', 'app', 'login', 'account', 'accounts']);

function titleCase(value) {
  return String(value || '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export function normalizeHostname(hostname = '') {
  return String(hostname)
    .trim()
    .toLowerCase()
    .replace(/^\w+:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^www\./, '');
}

function findKnownSite(hostname) {
  return Object.entries(KNOWN_SITES)
    .find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function inferBrand(hostname, title = '') {
  const titleBrand = String(title).split(/[|\-–—:]/)[0].trim();
  if (titleBrand && titleBrand.length >= 2 && titleBrand.length <= 30) {
    return titleCase(titleBrand);
  }

  const labels = hostname.split('.').filter(label => label && !IGNORED_LABELS.has(label));
  return titleCase(labels.at(-1) || labels[0] || 'Website');
}

function inferKeywords(hostname, brand, text = '') {
  const words = `${hostname} ${text}`
    .toLowerCase()
    .match(/[a-z]{4,14}/g) || [];
  const candidates = words
    .filter(word => !IGNORED_LABELS.has(word))
    .filter(word => word !== brand.toLowerCase());

  return [...new Set(candidates.map(titleCase))]
    .slice(0, 2)
    .concat(GENERIC_CONTEXT_WORDS)
    .slice(0, 4);
}

export function extractWebsiteContext({
  hostname = '',
  title = '',
  description = '',
  formText = '',
} = {}) {
  const domain = normalizeHostname(hostname);
  const known = findKnownSite(domain);

  if (known) {
    return {
      domain,
      brand: known[1].brand,
      keywords: [...known[1].keywords],
      source: 'known-site',
    };
  }

  const brand = inferBrand(domain, title);
  return {
    domain,
    brand,
    keywords: inferKeywords(domain, brand, `${description} ${formText}`),
    source: 'inferred',
  };
}

export function extractWebsiteContextFromDocument(doc = document, locationLike = window.location) {
  const description = doc.querySelector('meta[name="description"]')?.content || '';
  const focusedForm = doc.activeElement?.closest?.('form');
  const formText = focusedForm?.innerText || '';

  return extractWebsiteContext({
    hostname: locationLike.hostname,
    title: doc.title,
    description,
    formText: formText.slice(0, 1000),
  });
}

