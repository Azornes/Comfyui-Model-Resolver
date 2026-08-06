import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearchText, normalizeSearchToken } from '../web/resolver/utils/search_utils.js';
import { baseModelAliasMethods } from '../web/resolver/search/base_model_alias_methods.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const downloadTargetMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/download_target_methods.js'),
  'utf8'
);
const resolveDownloadMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/resolve_download_methods.js'),
  'utf8'
);

test('search text matching preserves raw, normalized, and empty-query behavior', () => {
  assert.equal(matchesSearchText('Checkpoints Check Points', ''), true);
  assert.equal(matchesSearchText('Flux.1 D', 'flux'), true);
  assert.equal(matchesSearchText('Flux.1 D', 'flux1d'), true);
  assert.equal(matchesSearchText('Flux.1 D', 'flux-1-d'), true);
  assert.equal(matchesSearchText('Flux.1 D', 'sdxl'), false);
  assert.equal(matchesSearchText('Flux.1 D', '---'), false);
});

test('base model token normalization uses the shared search token contract', () => {
  const dialog = { ...baseModelAliasMethods };
  for (const value of ['', ' Flux.1 D ', 'SDXL 1.0', 'Pony XL']) {
    assert.equal(dialog.normalizeBaseModelToken(value), normalizeSearchToken(value));
  }
});

test('download category and base model dropdowns use the shared matcher', () => {
  assert.match(downloadTargetMethodsSource, /matchesSearchText\(`\$\{option\.value\} \$\{option\.label\}`, filter\)/);
  assert.match(resolveDownloadMethodsSource, /matchesSearchText\(`\$\{option\.value\} \$\{option\.label\}`, filter\)/);
});
