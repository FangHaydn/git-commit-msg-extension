const assert = require('node:assert');
const { loadConventionalPattern } = require('../dist/conventional.js');

const pattern = loadConventionalPattern({
  types: ['feat', 'fix', 'docs'],
  scopeRequired: false,
});

const requiredScopePattern = loadConventionalPattern({
  types: ['feat', 'fix', 'docs'],
  scopeRequired: true,
});

for (const header of ['feat: add button', 'fix(api): handle error', 'docs!: update api']) {
  assert.ok(pattern.test(header), `should pass: ${header}`);
}

for (const header of ['feature: bad', 'feat:', 'feat(no-scope', 'random message']) {
  assert.ok(!pattern.test(header), `should fail: ${header}`);
}

assert.ok(requiredScopePattern.test('fix(api): handle error'));
assert.ok(!requiredScopePattern.test('fix: handle error'));

console.log('conventional header tests passed');
