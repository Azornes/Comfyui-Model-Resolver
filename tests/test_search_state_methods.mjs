import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSourceMethods } from '../web/resolver/search/search_source_methods.js';

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

const searchStateMethods = Object.fromEntries([
  'getMissingSearchKey',
  'getSearchState',
  'createEmptySearchState',
  'getBackgroundSearchJobKey',
  'getBackgroundSearchJob',
  'hasBackgroundSearchJob',
  'isBackgroundSearchRunActive',
  'isSearchSourceCancelled',
  'getWorkflowSearchCache',
  'getSearchStateForWorkflow',
  'persistSearchStateForWorkflow',
  'mergeSearchResults',
  'getSearchResultSignature',
  'areSearchResultsSame',
  'withSearchResultTimestamp',
].map(methodName => [
  methodName,
  eval(`(${extractMethod(searchPanelMethodsSource, methodName)})`),
]));

function createDialog() {
  return {
    ...searchSourceMethods,
    ...searchStateMethods,
    searchResultCache: new Map(),
    workflowSearchResultCaches: new Map(),
    backgroundSearchJobs: new Map(),
    getDefaultSearchBaseModel: () => 'auto',
    getMissingModelKey: missing => missing.key || 'missing-key',
    getWorkflowScopedQueueKey: () => 'active-workflow',
    getSearchResultTimestamp: result => result?.searchedAt || result?.searched_at || null,
    mergeLocalMatches: (existing, incoming) => [...existing, ...incoming],
    cloneSearchState: state => JSON.parse(JSON.stringify(state)),
  };
}

test('search state initializes a stable per-model cache entry', () => {
  const dialog = createDialog();
  const missing = { key: 'missing-key' };

  const first = dialog.getSearchState(missing);
  const second = dialog.getSearchState(missing);

  assert.equal(first, second);
  assert.equal(first.selectedSource, 'all');
  assert.equal(first.selectedBaseModel, 'auto');
  assert.deepEqual(first.results, {
    popular: null,
    model_list: null,
    huggingface: null,
    civitai: null,
    civarchive: null,
    lora_manager_archive: null,
    custom: [],
    local_hash_matches: [],
  });
  assert.deepEqual(first.sourceProgress, {});
  assert.equal(first.activeSearchRunId, null);
});

test('background search jobs are scoped by workflow and missing-model key', () => {
  const dialog = createDialog();
  dialog.backgroundSearchJobs.set(
    dialog.getBackgroundSearchJobKey('workflow-a', 'missing-a'),
    { runId: 'run-1', cancelledSources: new Set(['civitai']) }
  );

  assert.equal(dialog.hasBackgroundSearchJob('workflow-a', 'missing-a'), true);
  assert.equal(dialog.hasBackgroundSearchJob('workflow-a', 'missing-a', 'run-1'), true);
  assert.equal(dialog.hasBackgroundSearchJob('workflow-a', 'missing-a', 'run-2'), false);
  assert.equal(dialog.isBackgroundSearchRunActive('workflow-a', 'missing-a', 'run-1'), true);
  assert.equal(dialog.isSearchSourceCancelled('workflow-a', 'missing-a', 'run-1', 'civitai'), true);
  assert.equal(dialog.isSearchSourceCancelled('workflow-a', 'missing-a', 'run-1', 'huggingface'), false);
});

test('workflow search cache separates non-active workflow state', () => {
  const dialog = createDialog();
  const missing = { key: 'missing-key' };

  const state = dialog.getSearchStateForWorkflow('workflow-a', missing);
  state.selectedSource = 'civitai';
  dialog.persistSearchStateForWorkflow('workflow-a', missing, state);

  assert.equal(dialog.getSearchStateForWorkflow('workflow-a', missing).selectedSource, 'civitai');
  assert.equal(dialog.getSearchStateForWorkflow('active-workflow', missing).selectedSource, 'all');
});

test('mergeSearchResults preserves unchanged timestamps and clears only forced sources', () => {
  const dialog = createDialog();
  const existing = {
    popular: { url: 'old-popular', searchedAt: 'old-time' },
    model_list: { url: 'local-model', searchedAt: 'old-local' },
    huggingface: { url: 'hf', searchedAt: 'hf-time' },
    civitai: { url: 'same-civitai', searchedAt: 'original-time' },
    civarchive: null,
    lora_manager_archive: null,
    custom: [{ url: 'custom' }],
    local_hash_matches: [{ id: 'existing' }],
  };
  const newResults = {
    searched_sources: ['local', 'civitai'],
    popular: { url: 'new-popular' },
    model_list: null,
    civitai: { url: 'same-civitai' },
    local_hash_matches: [{ id: 'new' }],
  };

  const merged = dialog.mergeSearchResults(existing, newResults, { searchedAt: 'new-time' });
  assert.equal(merged.popular.searchedAt, 'new-time');
  assert.equal(merged.civitai.searchedAt, 'original-time');
  assert.equal(merged.model_list.url, 'local-model');
  assert.deepEqual(merged.local_hash_matches, [{ id: 'existing' }, { id: 'new' }]);
  assert.deepEqual(merged.custom, existing.custom);

  const refreshed = dialog.mergeSearchResults(existing, {
    searched_sources: ['local', 'civitai'],
    local_hash_matches: [],
  }, { forceRefresh: true });
  assert.equal(refreshed.popular, null);
  assert.equal(refreshed.model_list, null);
  assert.equal(refreshed.civitai, null);
  assert.equal(refreshed.huggingface.url, 'hf');
});

test('search result signatures and timestamps are deterministic', () => {
  const dialog = createDialog();
  const result = { url: 'https://example.test/model', filename: 'model.safetensors' };

  assert.equal(
    dialog.getSearchResultSignature([result]),
    'https://example.test/model::model.safetensors::::::::'
  );
  assert.equal(dialog.areSearchResultsSame(result, { ...result }), true);
  assert.deepEqual(
    dialog.withSearchResultTimestamp([result], '2026-08-02T12:00:00Z'),
    [{ ...result, searchedAt: '2026-08-02T12:00:00Z' }]
  );
});
