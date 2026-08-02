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
