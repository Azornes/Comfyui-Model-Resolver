import test from 'node:test';
import assert from 'node:assert/strict';
import { modelHashCompareMethods } from '../web/resolver/views/model_hash_compare_methods.js';

const methods = modelHashCompareMethods;

function createDialog() {
  return {
    ...methods,
    getFilenameFromPath: value => String(value || '').split(/[\\/]/).pop() || '',
    getVersionedModelName: (name, version) => version ? `${name} ${version}` : name,
    truncateText: value => value,
    getLocalMatchIdentity: () => 'local-identity',
  };
}

test('hash comparison normalizes and formats SHA-256 values', () => {
  const dialog = createDialog();
  const hash = 'A'.repeat(64);

  assert.equal(dialog.normalizeSha256ForCompare(`sha256:${hash}`), hash.toLowerCase());
  assert.equal(dialog.normalizeSha256ForCompare('not-a-hash'), '');
  assert.equal(dialog.formatSha256Short(hash), 'aaaaaaaa...aaaaaaaa');
});

test('hash candidates are collected recursively with source labels and deduplicated', () => {
  const dialog = createDialog();
  const first = 'a'.repeat(64);
  const second = 'b'.repeat(64);
  const candidates = dialog.collectHashCandidatesForCompare({
    sha256: first,
    hashes: { SHA256: first },
    file_info: { hash: second },
    files: [{ fileHash: second }],
  });

  assert.deepEqual(candidates.map(candidate => candidate.hash), [first, second]);
  assert.equal(candidates[0].source, 'metadata');
  assert.match(candidates[1].source, /file_info/);
  assert.deepEqual(dialog.getLocalHashCandidatesForCompare({ sha256: first }), [{
    hash: first,
    source: 'local model metadata',
  }]);
});

test('local hash compare metadata resolves path, filename, labels, and URLs', () => {
  const dialog = createDialog();
  const model = { path: 'models/checkpoints/example.safetensors' };

  assert.equal(dialog.getLocalHashComparePath(model), model.path);
  assert.equal(dialog.getHashCompareFilename(model), 'example.safetensors');
  assert.equal(dialog.getHashCompareSourceLabel('civitai'), 'CivitAI');
  assert.equal(dialog.getHashCompareSourceLabel('unknown_source'), 'unknown source');
  assert.equal(dialog.getHashCompareResultName({ name: 'Model', version_name: 'v2' }), 'Model v2');
  assert.equal(dialog.getHashCompareResultUrl({ version_url: 'https://example.test/version' }), 'https://example.test/version');
});

test('hash compare matches are deduplicated and local identity prefers explicit values', () => {
  const dialog = createDialog();
  const matches = [
    { sourceLabel: 'CivitAI', name: 'Model', url: 'https://example.test', sha256: 'a'.repeat(64) },
    { sourceLabel: 'CivitAI', name: 'Model', url: 'https://example.test', sha256: 'a'.repeat(64) },
    { sourceLabel: 'HuggingFace', name: 'Model', url: 'https://example.test', sha256: 'b'.repeat(64) },
  ];

  assert.equal(dialog.dedupeHashCompareMatches(matches).length, 2);
  assert.equal(dialog.getHashCompareLocalMatchIdentity({ local_match_identity: 'explicit' }), 'explicit');
  assert.equal(dialog.getHashCompareLocalMatchIdentity({}), 'local-identity');
});

test('hash compare metadata update stores normalized SHA-256 fields', () => {
  const dialog = createDialog();
  const model = {};

  dialog.updateHashCompareModelMetadata(model, {
    sha256: `sha256:${'c'.repeat(64)}`,
    metadata_path: 'model.json',
  });

  assert.equal(model.sha256, 'c'.repeat(64));
  assert.equal(model.hash, 'c'.repeat(64));
  assert.equal(model.hashes.SHA256, 'c'.repeat(64));
  assert.equal(model.metadata_path, 'model.json');
});

test('hash candidate collection handles primitive, array, null, and deeply nested metadata', () => {
  const dialog = createDialog();
  const hash = 'd'.repeat(64);
  const nested = { sha256: hash };
  for (let depth = 0; depth < 7; depth += 1) {
    Object.assign(nested, { metadata: { sha256: hash } });
  }

  assert.deepEqual(dialog.collectHashCandidatesForCompare(hash, 'direct'), [{ hash, source: 'direct' }]);
  assert.deepEqual(dialog.collectHashCandidatesForCompare([hash, null, 12], 'array'), [{ hash, source: 'array' }]);
  assert.deepEqual(dialog.collectHashCandidatesForCompare(null), []);
  assert.deepEqual(dialog.collectHashCandidatesForCompare(true), []);
  assert.equal(dialog.collectHashCandidatesForCompare(nested).length, 1);
});

test('hash compare metadata uses path and filename fallbacks', () => {
  const dialog = createDialog();

  assert.equal(dialog.getLocalHashComparePath({ open_path: 'open/model.safetensors', path: 'path/model.safetensors' }), 'open/model.safetensors');
  assert.equal(dialog.getLocalHashComparePath({ resolved_path: 'resolved/model.safetensors' }), 'resolved/model.safetensors');
  assert.equal(dialog.getLocalHashComparePath({ file_path: 'file/model.safetensors' }), 'file/model.safetensors');
  assert.equal(dialog.getLocalHashComparePath({}), '');
  assert.equal(dialog.getHashCompareFilename({ filename: 'explicit.safetensors', path: 'ignored.safetensors' }), 'explicit.safetensors');
  assert.equal(dialog.getHashCompareFilename({ name: 'named-model' }), 'named-model');
  assert.equal(dialog.getHashCompareFilename({}), 'Selected local model');
});

test('hash compare source labels cover explicit, known, and unknown providers', () => {
  const dialog = createDialog();

  assert.equal(dialog.getHashCompareSourceLabel('ignored', { sourceLabel: 'Custom source' }), 'Custom source');
  assert.equal(dialog.getHashCompareSourceLabel('download-source'), 'Selected source');
  assert.equal(dialog.getHashCompareSourceLabel('model-list'), 'Local Database');
  assert.equal(dialog.getHashCompareSourceLabel('huggingface'), 'HuggingFace');
  assert.equal(dialog.getHashCompareSourceLabel('lora-archive'), 'LoRA Archive');
  assert.equal(dialog.getHashCompareSourceLabel('unknown-source'), 'unknown source');
  assert.equal(dialog.getHashCompareSourceLabel('', {}), 'Source');
});

test('hash compare result names and URLs use ordered fallbacks and truncation', () => {
  const dialog = createDialog();
  dialog.truncateText = value => value.slice(0, 5);

  assert.equal(dialog.getHashCompareResultName({ model_name: 'Model', version: 'v1' }), 'Model');
  assert.equal(dialog.getHashCompareResultName({ repo_id: 'owner/repo' }), 'owner');
  assert.equal(dialog.getHashCompareResultName({}), 'Model');
  assert.equal(dialog.getHashCompareResultUrl({ model_url: 'https://model.test' }), 'https://model.test');
  assert.equal(dialog.getHashCompareResultUrl({ download_url: 'https://download.test' }), 'https://download.test');
  assert.equal(dialog.getHashCompareResultUrl({}), '');
});

test('hash compare metadata update ignores invalid values and normalizes hash containers', () => {
  const dialog = createDialog();
  const model = { hashes: ['invalid'] };

  dialog.updateHashCompareModelMetadata(model, { sha256: 'invalid' });
  assert.deepEqual(model, { hashes: ['invalid'] });

  dialog.updateHashCompareModelMetadata(model, { hash: 'e'.repeat(64) });
  assert.deepEqual(model.hashes, { SHA256: 'e'.repeat(64) });
  assert.equal(model.metadata_path, undefined);
  dialog.updateHashCompareModelMetadata(null, { sha256: 'f'.repeat(64) });
});

test('hash compare deduplication and local identity handle empty and missing values', () => {
  const dialog = createDialog();
  dialog.getLocalMatchIdentity = () => '';

  assert.deepEqual(dialog.dedupeHashCompareMatches([null, undefined, {}]), [{}]);
  assert.equal(dialog.getHashCompareLocalMatchIdentity({}), '');
});
