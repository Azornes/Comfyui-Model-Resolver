import assert from 'node:assert/strict';
import test from 'node:test';

import { searchHashMethods } from '../web/resolver/search/search_hash_methods.js';
import { getSha256Field, normalizeSha256 } from '../web/resolver/utils/hash_utils.js';
import { normalizeSourceKey } from '../web/resolver/utils/source_labels.js';

function createDialog(overrides = {}) {
  return { ...searchHashMethods, ...overrides };
}

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

test('shared SHA-256 field extraction preserves precedence and optional casing', () => {
  const value = {
    sha256: '  DirectHash  ',
    hash: 'FallbackHash',
    hashes: { SHA256: 'NestedHash' },
  };

  assert.equal(getSha256Field(value), 'DirectHash');
  assert.equal(getSha256Field(value, { lowercase: true }), 'directhash');
  assert.equal(getSha256Field({ hashes: { sha256: ' NestedHash ' } }), 'NestedHash');
  assert.equal(getSha256Field({}), '');
});

test('shared SHA-256 normalization preserves the accepted input contract', () => {
  assert.equal(normalizeSha256(`sha256:${hashA.toUpperCase()}`), hashA);
  assert.equal(normalizeSha256('SHA256=' + hashB), hashB);
  assert.equal(normalizeSha256('short'), '');
  assert.equal(normalizeSha256(hashA + 'x'), '');
  assert.equal(normalizeSha256(null), '');
});

test('search hash normalization accepts SHA-256 prefixes and rejects invalid values', () => {
  const dialog = createDialog();
  assert.equal(normalizeSha256(`sha256:${hashA.toUpperCase()}`), hashA);
  assert.equal(normalizeSha256(`SHA256=${hashB}`), hashB);
  assert.equal(normalizeSha256(hashA), hashA);
  assert.equal(normalizeSha256('short'), '');
  assert.equal(normalizeSha256(`${hashA}x`), '');
  assert.equal(dialog.getSearchResultSha256(null), '');
  assert.equal(dialog.getSearchResultSha256({}), '');
});

test('search hash extraction checks result and nested provider fields in priority order', () => {
  const dialog = createDialog();
  assert.equal(dialog.getSearchResultSha256({ hash: 'invalid', file_info: { hash: hashB } }), hashB);
  assert.equal(dialog.getSearchResultSha256({ hashes: { SHA256: hashA }, sha256: hashB }), hashB);
  assert.equal(dialog.getSearchResultSha256({ file_info: { hashes: { sha256: hashA } } }), hashA);
  assert.equal(dialog.getSearchResultSha256({ hashes: null, file_info: null }), '');
});

test('hash label collection merges verified matches from missing data, state, and all providers', () => {
  const dialog = createDialog({
    getLocalMatchHash: match => match.localHash || match.sha256 || '',
    getSearchResultSha256: result => result.sha256 || '',
  });
  const missing = {
    matches: [
      { hash_match: true, localHash: hashA },
      { match_type: 'hash', sha256: hashA },
      { confidence: 100, sha256: hashB },
    ],
    download_source: { hash_verified: true, sha256: hashB },
  };
  const results = {
    local_hash_matches: [{ hash_lookup_source: 'local', sha256: hashA }],
    popular: [{ hash_verified: true, sha256: hashB }],
    model_list: [{ hash_verified_sha256: hashA }],
    huggingface: [{ match_type: 'hash', sha256: hashB }],
    civitai: [{ sha256: hashA }],
    civarchive: [{ hash_verified: true, sha256: hashB }],
    lora_manager_archive: [{ hash_verified: true, sha256: hashA }],
    custom: [[{ hash_verified: true, sha256: hashB }]],
  };

  assert.deepEqual(dialog.collectHashLabelMapHashes(missing, results), [hashA, hashB]);
  assert.deepEqual([...dialog.getHashMatchLabelMap(missing, results).entries()], [
    [hashA, 'Hash 1'],
    [hashB, 'Hash 2'],
  ]);
});

test('hash label collection can read search state and labels verified results', () => {
  const state = { results: { popular: [{ hash_verified: true, sha256: hashA }] } };
  const dialog = createDialog({
    getSearchState: () => state,
    getHashMatchLabelMap: searchHashMethods.getHashMatchLabelMap,
  });
  const labelMap = dialog.getHashMatchLabelMap({});

  assert.equal(labelMap.get(hashA), 'Hash');
  assert.equal(dialog.getHashMatchLabelForSearchResult({ sha256: hashA, hash_verified: true }, labelMap, []), 'Hash');
  assert.equal(dialog.getHashMatchLabelForSearchResult({ sha256: hashA }, labelMap, ['local-id']), 'Hash');
  assert.equal(dialog.getHashMatchLabelForSearchResult({ sha256: hashA, match_type: 'exact' }, labelMap, []), '');
  assert.equal(dialog.getHashMatchLabelForSearchResult({ sha256: hashB }, labelMap, []), '');
});

test('hash source keys and local identities match by hash or normalized source', () => {
  const dialog = createDialog({
    getLocalMatchIdentity: match => match.identity || '',
  });
  const matches = [
    { hash_lookup_source: 'Civit-AI', sha256: hashA, identity: 'local-a' },
    { hash_lookup_source: 'huggingface', identity: 'local-hf' },
    { hash_lookup_source: 'civitai', sha256: hashB, identity: 'local-b' },
    null,
  ];

  assert.equal(normalizeSourceKey(' Civit-AI '), 'civit_ai');
  assert.deepEqual(
    dialog.getLocalHashMatchIdentitiesForResult(matches, 'civit-ai', { sha256: hashA }),
    ['local-a']
  );
  assert.deepEqual(
    dialog.getLocalHashMatchIdentitiesForResult(matches, 'hugging-face', {}),
    []
  );
  assert.deepEqual(
    dialog.getLocalHashMatchIdentitiesForResult(
      [{ hash_lookup_source: 'hugging-face', identity: 'local-hf' }],
      'hugging-face',
      { hash_verified_local_match_identities: ['saved-id'] }
    ),
    ['saved-id', 'local-hf']
  );
});

test('local hash extraction checks direct, model, and nested hash fields', () => {
  const dialog = createDialog();
  assert.equal(dialog.getLocalMatchHash({ sha256: hashA, model: { sha256: hashB } }), hashA);
  assert.equal(dialog.getLocalMatchHash({ model: { hash: hashB } }), hashB);
  assert.equal(dialog.getLocalMatchHash({ model: { hashes: { SHA256: hashA } } }), hashA);
  assert.equal(dialog.getLocalMatchHash({}), '');
});
