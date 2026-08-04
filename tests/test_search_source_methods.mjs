import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSourceMethods } from '../web/resolver/search/search_source_methods.js';
import { getSourceDisplayLabel } from '../web/resolver/utils/source_labels.js';

const {
  getSearchSourceLabel,
  getSearchSourceErrorMessage,
  getSearchSourceErrorTooltip,
  isSearchSourceRetryable,
  getSearchSourceDefinitions,
  getSearchResultKeysForSources,
  getHashLookupSourcesForSearchSources,
  clearSearchResultsForSources,
  isSearchSourceEnabled,
  getSearchSourceDefinition,
  getSearchSourceEnabledMap,
  getEnabledSearchSources,
  getSearchSourcesForSelection,
} = searchSourceMethods;

function installStorage(values = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem() {},
    removeItem() {},
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  };
}

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

test('shared source labels preserve search and hash comparison contexts', () => {
  assert.equal(getSourceDisplayLabel('lora_manager_archive', { context: 'search' }), 'LoRA Manager Archive');
  assert.equal(getSourceDisplayLabel('lora_manager_archive'), 'LoRA Archive');
  assert.equal(getSourceDisplayLabel('lora-archive'), 'LoRA Archive');
  assert.equal(getSourceDisplayLabel('download-source'), 'Selected source');
  assert.equal(getSourceDisplayLabel('unknown-source', { fallback: 'Fallback' }), 'Fallback');
});

test('CivArchive availability failures receive a user-facing retry message', () => {
  const dialog = { getSearchSourceLabel, getSearchSourceErrorMessage };
  const temporaryFailure = getSearchSourceErrorMessage.call(
    dialog,
    'civarchive',
    'CivArchive search failed: CivArchive search request failed (network error or timeout)'
  );

  assert.equal(
    temporaryFailure,
    'CivArchive may be overloaded or temporarily unavailable. Please try again.'
  );
  assert.equal(
    getSearchSourceErrorMessage.call(dialog, 'civarchive', 'CivArchive search failed: HTTP 502'),
    temporaryFailure
  );
  assert.equal(
    getSearchSourceErrorMessage.call(dialog, 'civarchive', 'CivArchive search failed: HTTP 400'),
    'CivArchive search failed: HTTP 400'
  );
  assert.equal(
    getSearchSourceErrorMessage.call(dialog, 'civitai', 'CivAI request timed out'),
    'CivAI request timed out'
  );
  assert.equal(
    getSearchSourceErrorTooltip.call(dialog, 'civarchive', 'CivArchive search failed: HTTP 522'),
    'CivArchive may be overloaded or temporarily unavailable. Please try again. Details: CivArchive search failed: HTTP 522'
  );
});

test('structured CivArchive status uses safe messages and HTTP details', () => {
  const dialog = { getSearchSourceLabel, getSearchSourceErrorMessage, getSearchSourceErrorTooltip };
  const status = {
    state: 'unavailable',
    code: 'provider_unavailable',
    retryable: true,
    http_status: 522,
    message: 'CivArchive may be overloaded or temporarily unavailable. Please try again.'
  };

  assert.equal(
    getSearchSourceErrorMessage.call(dialog, 'civarchive', 'CivArchive search failed: HTTP 522', status),
    status.message
  );
  assert.equal(
    getSearchSourceErrorTooltip.call(dialog, 'civarchive', '', status),
    `${status.message} Details: HTTP 522`
  );
  assert.equal(
    getSearchSourceErrorMessage.call(dialog, 'civarchive', '', {
      state: 'rate_limited',
      code: 'rate_limited',
      retryable: true
    }),
    'CivArchive rate limit was reached. Please try again later.'
  );
});

test('CivArchive transport failures are marked retryable without broadening other sources', () => {
  assert.equal(isSearchSourceRetryable('civarchive', 'CivArchive search failed: HTTP 522'), true);
  assert.equal(isSearchSourceRetryable('civarchive', 'CivArchive search failed: HTTP 400'), false);
  assert.equal(isSearchSourceRetryable('civitai', 'request timed out'), false);
  assert.equal(isSearchSourceRetryable('civarchive', '', { retryable: false }), false);
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

test('source enablement defaults to enabled and honors persisted false flags', () => {
  const restoreStorage = installStorage({
    'ModelResolver.searchSource.civitaiEnabled': 'false',
  });
  try {
    const dialog = {
      getSearchSourceDefinitions,
      getSearchSourceDefinition,
      isSearchSourceEnabled,
    };
    assert.equal(isSearchSourceEnabled.call(dialog, 'civitai'), false);
    assert.equal(isSearchSourceEnabled.call(dialog, 'huggingface'), true);
    assert.equal(isSearchSourceEnabled.call(dialog, 'all'), true);
    assert.deepEqual(getSearchSourceEnabledMap.call(dialog), {
      local: true,
      huggingface: true,
      civitai: false,
      civarchive: true,
      lora_manager_archive: true,
    });
  } finally {
    restoreStorage();
  }
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
