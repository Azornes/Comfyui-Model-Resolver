import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(import.meta.dirname, '..');
const searchPanelMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/search_panel.js'),
  'utf8'
);

function extractMethod(source, methodName, paramsPattern = '[^)]*') {
  const signatureRegex = new RegExp(`\\n\\s+(async\\s+)?${methodName}\\s*\\(${paramsPattern}\\)\\s*\\{`);
  const match = signatureRegex.exec(source);
  assert.ok(match, `Could not find ${methodName}`);
  const isAsync = Boolean(match[1]);

  const parenStart = source.indexOf('(', match.index);
  const parenEnd = source.indexOf(')', parenStart);
  const params = source.slice(parenStart + 1, parenEnd);
  const braceStart = source.indexOf('{', parenEnd);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return `${isAsync ? 'async ' : ''}function ${methodName}(${params}) ${source.slice(braceStart, i + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

const getSearchSourceLabel = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchSourceLabel')})`);
const getSearchSourceDefinitions = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchSourceDefinitions')})`);
const getSearchResultKeysForSources = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchResultKeysForSources')})`);
const getHashLookupSourcesForSearchSources = eval(`(${extractMethod(searchPanelMethodsSource, 'getHashLookupSourcesForSearchSources')})`);
const clearSearchResultsForSources = eval(`(${extractMethod(searchPanelMethodsSource, 'clearSearchResultsForSources')})`);
const getEnabledSearchSources = eval(`(${extractMethod(searchPanelMethodsSource, 'getEnabledSearchSources')})`);
const getSearchSourcesForSelection = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchSourcesForSelection')})`);

test('search source labels and definitions remain stable', () => {
  const dialog = {};

  assert.equal(getSearchSourceLabel.call(dialog, 'all'), 'Everything');
  assert.equal(getSearchSourceLabel.call(dialog, 'lora_manager_archive'), 'LoRA Manager Archive');
  assert.equal(getSearchSourceLabel.call(dialog, 'unknown'), 'unknown');
  assert.deepEqual(
    getSearchSourceDefinitions.call(dialog).map(({ source, storageKey }) => ({ source, storageKey })),
    [
      { source: 'local', storageKey: 'ModelResolver.searchSource.localEnabled' },
      { source: 'huggingface', storageKey: 'ModelResolver.searchSource.huggingFaceEnabled' },
      { source: 'civitai', storageKey: 'ModelResolver.searchSource.civitaiEnabled' },
      { source: 'civarchive', storageKey: 'ModelResolver.searchSource.civArchiveEnabled' },
      { source: 'lora_manager_archive', storageKey: 'ModelResolver.searchSource.loraManagerArchiveEnabled' },
    ]
  );
});

test('search source selection maps source ids to result and hash keys', () => {
  assert.deepEqual(
    getSearchResultKeysForSources('local'),
    ['popular', 'model_list']
  );
  assert.deepEqual(
    getSearchResultKeysForSources('all'),
    ['popular', 'model_list', 'huggingface', 'civitai', 'civarchive', 'lora_manager_archive']
  );
  assert.deepEqual(
    [...getHashLookupSourcesForSearchSources(['civitai', 'custom'])],
    ['civitai']
  );
  assert.deepEqual(
    [...getHashLookupSourcesForSearchSources('all')],
    ['huggingface', 'civitai', 'civarchive']
  );
});

test('clearing selected search sources preserves unrelated results and hash matches', () => {
  const results = {
    popular: { items: ['popular'] },
    model_list: { items: ['local'] },
    huggingface: { items: ['hf'] },
    civitai: { items: ['civitai'] },
    civarchive: { items: ['archive'] },
    lora_manager_archive: { items: ['lora'] },
    custom: [{ url: 'https://example.test/model' }],
    local_hash_matches: [
      { hash_lookup_source: 'civitai', id: 'remove' },
      { hash_lookup_source: 'civarchive', id: 'keep' },
    ],
  };

  assert.deepEqual(clearSearchResultsForSources.call({
    getSearchResultKeysForSources,
    getHashLookupSourcesForSearchSources,
  }, results, 'civitai'), {
    popular: results.popular,
    model_list: results.model_list,
    huggingface: results.huggingface,
    civitai: null,
    civarchive: results.civarchive,
    lora_manager_archive: results.lora_manager_archive,
    custom: results.custom,
    local_hash_matches: [{ hash_lookup_source: 'civarchive', id: 'keep' }],
  });
});

test('enabled source selection falls back to local and respects available sources', () => {
  const dialog = {
    getSearchSourceDefinitions,
    getEnabledSearchSources,
    isSearchSourceUsable: source => source !== 'civitai',
  };

  assert.deepEqual(getEnabledSearchSources.call(dialog), [
    'local',
    'huggingface',
    'civarchive',
    'lora_manager_archive',
  ]);
  assert.deepEqual(getSearchSourcesForSelection.call(dialog, 'all'), [
    'local',
    'huggingface',
    'civarchive',
    'lora_manager_archive',
  ]);
  assert.deepEqual(getSearchSourcesForSelection.call(dialog, 'civitai'), []);

  const noSourcesDialog = {
    getSearchSourceDefinitions,
    getEnabledSearchSources,
    isSearchSourceUsable: () => false,
  };
  assert.deepEqual(getEnabledSearchSources.call(noSourcesDialog), ['local']);
});
