import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const STORAGE_MODULES = [
  'web/resolver/model_resolver.js',
  'web/resolver/actions/queue_storage_methods.js',
  'web/resolver/actions/queue_methods.js',
];

test('resolver storage modules use safeStorage instead of direct localStorage access', async () => {
  for (const relativePath of STORAGE_MODULES) {
    const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
    assert.match(source, /safeStorage\.(?:getItem|setItem|removeItem)/, relativePath);
    assert.doesNotMatch(source, /\blocalStorage\s*\./, relativePath);
  }
});
