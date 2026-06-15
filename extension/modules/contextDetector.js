const SIGNUP_TERMS = [
  'sign up', 'signup', 'register', 'registration', 'create account',
  'new account', 'join now', 'join us', 'become a member', 'get started',
];
const CHANGE_TERMS = [
  'change password', 'reset password', 'update password', 'new password',
  'confirm new password', 'set password', 'forgot password',
];
const LOGIN_TERMS = ['log in', 'login', 'sign in', 'signin', 'welcome back'];
const CURRENT_TERMS = ['current password', 'old password', 'existing password'];
const CONFIRM_TERMS = ['confirm password', 'repeat password', 'retype password', 'password confirmation'];

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function fieldText(input) {
  const labels = input.labels ? [...input.labels].map(label => label.textContent).join(' ') : '';
  return compactText([
    labels,
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label'),
    input.getAttribute('autocomplete'),
  ].filter(Boolean).join(' '));
}

function containsAny(text, terms) {
  return terms.some(term => text.includes(term));
}

function surroundingText(input) {
  const form = input.closest('form');
  const container = form || input.closest('[role="dialog"], main, section, article') || input.parentElement;
  const heading = container?.querySelector?.('h1,h2,h3,[role="heading"]')?.textContent || '';
  const buttons = [...(container?.querySelectorAll?.('button,input[type="submit"],a') || [])]
    .slice(0, 12)
    .map(element => element.textContent || element.value || '')
    .join(' ');
  return compactText(`${heading} ${buttons} ${container?.getAttribute?.('aria-label') || ''}`);
}

function visiblePasswordFields(scope) {
  return [...scope.querySelectorAll('input[type="password"]')]
    .filter(input => !input.disabled && input.getAttribute('aria-hidden') !== 'true');
}

export function classifyPasswordField(input) {
  if (!input || input.type !== 'password') {
    return { type: 'unknown', eligible: false, confidence: 0, reasons: [] };
  }

  const form = input.closest('form') || input.ownerDocument;
  const fields = visiblePasswordFields(form);
  const text = compactText(`${surroundingText(input)} ${fieldText(input)}`);
  const autocomplete = compactText(input.getAttribute('autocomplete'));
  const allFieldText = fields.map(fieldText);
  const hasCurrentField = fields.some(field =>
    compactText(field.getAttribute('autocomplete')) === 'current-password' ||
    containsAny(fieldText(field), CURRENT_TERMS)
  );
  const newFields = fields.filter(field =>
    compactText(field.getAttribute('autocomplete')) === 'new-password' ||
    containsAny(fieldText(field), ['new password', ...CONFIRM_TERMS])
  );

  let signup = 0;
  let change = 0;
  let login = 0;
  const reasons = [];

  if (autocomplete === 'new-password') {
    signup += 5;
    change += 3;
    reasons.push('new-password autocomplete');
  }
  if (autocomplete === 'current-password') {
    login += 7;
    reasons.push('current-password autocomplete');
  }
  if (containsAny(text, SIGNUP_TERMS)) {
    signup += 5;
    reasons.push('account creation language');
  }
  if (containsAny(text, CHANGE_TERMS)) {
    change += 6;
    reasons.push('password change language');
  }
  if (containsAny(text, LOGIN_TERMS)) {
    login += 5;
    reasons.push('login language');
  }
  if (hasCurrentField && newFields.length > 0) {
    change += 8;
    reasons.push('current and new password fields');
  }
  if (fields.length >= 2 && allFieldText.some(value => containsAny(value, CONFIRM_TERMS))) {
    signup += 4;
    change += 3;
    reasons.push('password confirmation field');
  }
  if (fields.length === 1 && !containsAny(text, SIGNUP_TERMS) && !containsAny(text, CHANGE_TERMS)) {
    login += 2;
  }

  let type = 'unknown';
  let confidence = 0;
  if (change >= 6 && change > login && change >= signup) {
    type = 'password-change';
    confidence = change;
  } else if (signup >= 5 && signup > login) {
    type = 'account-creation';
    confidence = signup;
  } else if (login >= 4) {
    type = 'login';
    confidence = login;
  }

  const isConfirmation = containsAny(fieldText(input), CONFIRM_TERMS);
  const isCurrent = autocomplete === 'current-password' || containsAny(fieldText(input), CURRENT_TERMS);
  const targetField = (isConfirmation || isCurrent)
    ? fields.find(field => field !== input && !containsAny(fieldText(field), CURRENT_TERMS) && !containsAny(fieldText(field), CONFIRM_TERMS))
    : input;
  const confirmationField = fields.find(field => field !== targetField && containsAny(fieldText(field), CONFIRM_TERMS)) || null;

  return {
    type,
    eligible: type === 'account-creation' || type === 'password-change',
    confidence,
    reasons: [...new Set(reasons)],
    targetField: targetField || input,
    confirmationField,
  };
}

export function detectPasswordContext(doc = document) {
  const fields = visiblePasswordFields(doc);
  const results = fields.map(classifyPasswordField);
  const eligible = results
    .filter(result => result.eligible)
    .sort((a, b) => b.confidence - a.confidence)[0];
  const login = results
    .filter(result => result.type === 'login')
    .sort((a, b) => b.confidence - a.confidence)[0];
  const best = eligible || login || results[0] || {
    type: 'unknown', eligible: false, confidence: 0, reasons: [],
    targetField: null, confirmationField: null,
  };

  return {
    ...best,
    fieldCount: fields.length,
  };
}

export function serializePasswordContext(context) {
  return {
    type: context?.type || 'unknown',
    eligible: Boolean(context?.eligible),
    isNewPassword: Boolean(context?.eligible),
    confidence: context?.confidence || 0,
    reasons: context?.reasons || [],
    fieldCount: context?.fieldCount || 0,
  };
}
