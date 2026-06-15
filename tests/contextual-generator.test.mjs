import test from 'node:test';
import assert from 'node:assert/strict';

import { extractWebsiteContext } from '../extension/modules/websiteContext.js';
import { classifyPasswordField } from '../extension/modules/contextDetector.js';
import {
  createReuseSignature,
  validateGeneratedPassword,
} from '../extension/modules/generatorValidator.js';
import { generateContextAwarePassword } from '../extension/modules/profilePasswordGenerator.js';

function makeField({
  autocomplete = '',
  label = '',
  formText = '',
  fieldCount = 1,
} = {}) {
  const fields = [];
  const form = {
    innerText: formText,
    getAttribute: () => '',
    querySelector: () => ({ textContent: formText }),
    querySelectorAll(selector) {
      if (selector === 'input[type="password"]') return fields;
      return [];
    },
  };

  for (let index = 0; index < fieldCount; index++) {
    fields.push({
      type: 'password',
      disabled: false,
      name: '',
      id: '',
      placeholder: index === 1 ? 'Confirm password' : label,
      labels: [],
      ownerDocument: form,
      closest: selector => selector === 'form' ? form : null,
      getAttribute(name) {
        if (name === 'autocomplete') return index === 0 ? autocomplete : 'new-password';
        if (name === 'aria-hidden') return null;
        if (name === 'aria-label') return index === 0 ? label : 'Confirm password';
        return '';
      },
    });
  }
  return fields[0];
}

test('known domains receive curated website context', () => {
  const context = extractWebsiteContext({ hostname: 'www.github.com' });
  assert.equal(context.brand, 'GitHub');
  assert.ok(context.keywords.includes('Repository'));
});

test('standard login fields are not generator eligible', () => {
  const result = classifyPasswordField(makeField({
    autocomplete: 'current-password',
    label: 'Password',
    formText: 'Sign in',
  }));
  assert.equal(result.type, 'login');
  assert.equal(result.eligible, false);
});

test('account creation fields are generator eligible', () => {
  const result = classifyPasswordField(makeField({
    autocomplete: 'new-password',
    label: 'Create password',
    formText: 'Create account',
    fieldCount: 2,
  }));
  assert.equal(result.type, 'account-creation');
  assert.equal(result.eligible, true);
});

test('password change forms are distinguished from signup forms', () => {
  const result = classifyPasswordField(makeField({
    autocomplete: 'new-password',
    label: 'New password',
    formText: 'Reset password',
  }));
  assert.equal(result.type, 'password-change');
  assert.equal(result.eligible, true);
});

test('password change context targets the new password field', () => {
  const fields = [];
  const form = {
    getAttribute: () => '',
    querySelector: () => ({ textContent: 'Change password' }),
    querySelectorAll: selector => selector === 'input[type="password"]' ? fields : [],
  };
  const makePassword = (autocomplete, label) => ({
    type: 'password',
    disabled: false,
    name: '',
    id: '',
    placeholder: label,
    labels: [],
    ownerDocument: form,
    closest: selector => selector === 'form' ? form : null,
    getAttribute(name) {
      if (name === 'autocomplete') return autocomplete;
      if (name === 'aria-hidden') return null;
      if (name === 'aria-label') return label;
      return '';
    },
  });
  const current = makePassword('current-password', 'Current password');
  const next = makePassword('new-password', 'New password');
  fields.push(current, next);

  const result = classifyPasswordField(current);
  assert.equal(result.type, 'password-change');
  assert.equal(result.targetField, next);
});

test('validator rejects direct profile exposure', async () => {
  const result = await validateGeneratedPassword('SanskarQuantumGit88!', {
    profile: { firstName: 'Sanskar' },
    domain: 'github.com',
    reuseRecords: [],
  });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(reason => reason.includes('raw personal')));
});

test('validator rejects reuse from another domain', async () => {
  const password = 'CipherOrbitGit88!';
  const signature = await createReuseSignature(password);
  const result = await validateGeneratedPassword(password, {
    domain: 'github.com',
    reuseRecords: [{ domain: 'linkedin.com', ...signature }],
  });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(reason => reason.includes('Reuses')));
});

test('context-aware generator passes the complete validation pipeline', async () => {
  const websiteContext = extractWebsiteContext({ hostname: 'github.com' });
  const result = await generateContextAwarePassword({
    profile: {
      firstName: 'Sanskar',
      nickname: 'Sanu',
      petName: 'Bruno',
      dateOfBirth: '2004-05-17',
      customKeywords: ['coding'],
    },
    websiteContext,
    validation: { reuseRecords: [] },
  });

  assert.equal(result.validation.passed, true);
  assert.ok(result.validation.strengthScore > 80);
  assert.ok(result.validation.personalizedAttackScore > 80);
  assert.equal(/sanskar|sanu|bruno|2004|coding/i.test(result.password), false);
  assert.ok(websiteContext.keywords.some(keyword => result.password.includes(keyword)));
});
