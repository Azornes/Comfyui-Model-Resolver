import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL(
  '../web/resolver/views/model_info_methods.js',
  import.meta.url
);
const source = await readFile(sourceUrl, 'utf8');

test('Show info keeps model description separate from version notes', () => {
  assert.match(source, /'Version notes'/);
  assert.match(
    source,
    /class="mr-info-description-row mr-info-version-description-row mr-hidden-initial"/
  );
  assert.ok(
    source.indexOf("'Version notes'") < source.indexOf("'Description'"),
    'Version notes should be rendered above Description'
  );
  assert.match(
    source,
    /const modelDescription = data\.model_description\s*\|\|\s*data\.modelDescription\s*\|\|\s*data\.description/
  );
  assert.match(
    source,
    /const versionDescription = data\.version_description\s*\|\|\s*data\.versionDescription/
  );
  assert.match(source, /contentSelector: '\.mr-info-version-description'/);
});

test('Refetch maps the response into stable model and version fields', () => {
  assert.match(
    source,
    /description: modelDescription,\s*model_description: modelDescription,\s*version_description: result\.version_description/
  );
  assert.match(
    source,
    /data-description-target="\.mr-info-version-description"/
  );
});
