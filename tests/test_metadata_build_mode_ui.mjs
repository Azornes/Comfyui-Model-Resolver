import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const optionsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/views/options_methods.js'),
  'utf8'
);

test('metadata builder exposes fresh and external import modes', () => {
  assert.match(
    optionsSource,
    /id="mr-options-metadata-build-mode"/
  );
  assert.match(
    optionsSource,
    /option value="calculate_fresh">Calculate SHA-256 from scratch/
  );
  assert.match(
    optionsSource,
    /option value="import_existing">Use existing plugin metadata/
  );
});

test('selected metadata mode is sent to the metadata build endpoint', () => {
  assert.match(
    optionsSource,
    /metadata_mode:\s*metadataMode/
  );
  assert.match(
    optionsSource,
    /\/model_resolver\/metadata-build\/start/
  );
  assert.match(
    optionsSource,
    /metadataBuildModeSelect\.dataset\.userEdited = 'true'/
  );
});
