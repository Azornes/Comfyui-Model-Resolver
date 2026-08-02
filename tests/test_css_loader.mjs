import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loaderSource = await readFile(
  new URL('../web/utils/css_loader.js', import.meta.url),
  'utf8'
);
const filterStylesheetSource = await readFile(
  new URL('../web/css/missing-type-filter.css', import.meta.url),
  'utf8'
);

test('CSS loader registers the missing model type filter stylesheet', () => {
  assert.match(loaderSource, /['"]\.\/css\/missing-type-filter\.css['"]/);
  assert.doesNotMatch(loaderSource, /['"]\.\/resolver\/missing_type_filter\.css['"]/);
  assert.match(loaderSource, /addStylesheet\(getUrl\(file\)\)/);
  assert.match(filterStylesheetSource, /\.mr-missing-type-filter-menu/);
});
