import assert from 'node:assert/strict';
import test from 'node:test';

import { getModelCardUrl, parseHuggingFaceFileUrl } from '../web/resolver/utils/url_utils.js';

test('Hugging Face file URLs expose repository, revision, path, and filename', () => {
  assert.deepEqual(
    parseHuggingFaceFileUrl('https://www.huggingface.co/owner/repo/blob/main/folder/model%20file.safetensors'),
    {
      repo: 'owner/repo',
      revision: 'main',
      path: 'folder/model file.safetensors',
      filename: 'model file.safetensors',
    }
  );
  assert.deepEqual(
    parseHuggingFaceFileUrl('https://huggingface.co/owner/repo/resolve/v1.0/model.safetensors'),
    {
      repo: 'owner/repo',
      revision: 'v1.0',
      path: 'model.safetensors',
      filename: 'model.safetensors',
    }
  );
});

test('Hugging Face URL parsing rejects unsupported and malformed URLs', () => {
  assert.equal(parseHuggingFaceFileUrl(''), null);
  assert.equal(parseHuggingFaceFileUrl('https://example.com/owner/repo/blob/main/file'), null);
  assert.equal(parseHuggingFaceFileUrl('https://huggingface.co/owner/repo/tree/main/file'), null);
  assert.equal(parseHuggingFaceFileUrl('https://huggingface.co/owner/repo/blob/main'), null);
  assert.equal(parseHuggingFaceFileUrl('https://huggingface.co/%E0%A4%A/owner/blob/main/file'), null);
  assert.equal(parseHuggingFaceFileUrl('not a URL'), null);
});

test('model card URLs reconstruct direct Hugging Face downloads', () => {
  assert.equal(
    getModelCardUrl('https://huggingface.co/owner/repo/resolve/main/folder/model.safetensors'),
    'https://huggingface.co/owner/repo/blob/main/folder/model.safetensors'
  );
  assert.equal(
    getModelCardUrl('https://huggingface.co/owner/repo/resolve/v1.0/folder/model file.safetensors'),
    'https://huggingface.co/owner/repo/blob/v1.0/folder/model%20file.safetensors'
  );
});

test('model card URLs fall back to repository pages for generic Hugging Face URLs', () => {
  assert.equal(
    getModelCardUrl('https://huggingface.co/owner/repo'),
    'https://huggingface.co/owner/repo'
  );
  assert.equal(
    getModelCardUrl('https://huggingface.co/owner/repo/resolve/main'),
    'https://huggingface.co/owner/repo'
  );
});

test('model card URLs convert CivitAI download links to model pages', () => {
  assert.equal(
    getModelCardUrl('https://civitai.com/api/download/models/123456'),
    'https://civitai.com/models/123456'
  );
  assert.equal(
    getModelCardUrl('https://civitai.com/models/987654/version/2'),
    'https://civitai.com/models/987654'
  );
});

test('model card URL parsing returns null for unsupported or incomplete links', () => {
  assert.equal(getModelCardUrl(null), null);
  assert.equal(getModelCardUrl('https://example.com/model.safetensors'), null);
  assert.equal(getModelCardUrl('https://civitai.com/api/download/models/no-id'), null);
  assert.equal(getModelCardUrl('https://huggingface.co/not-a-repository'), null);
});
