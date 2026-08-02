import test from 'node:test';
import assert from 'node:assert/strict';
import { missingModelStateMethods } from '../web/resolver/views/missing_model_state_methods.js';

const methods = missingModelStateMethods;

function createDialog() {
  return {
    ...methods,
    searchResultCache: new Map(),
    getMissingSearchKey: missing => missing.key || 'missing-key',
    hasSearchResults: results => Boolean(results?.popular || results?.civitai),
  };
}

test('best local match and summary stats use confidence thresholds', () => {
  const dialog = createDialog();
  const missingModels = [
    { matches: [{ confidence: 72 }, { confidence: 100 }] },
    { matches: [{ confidence: 85 }] },
    { matches: [{ confidence: 40 }] },
  ];

  assert.equal(dialog.getBestLocalMatch(missingModels[0], 70).confidence, 100);
  assert.equal(dialog.getBestLocalMatch(missingModels[2], 70), null);
  assert.deepEqual(dialog.getMissingModelSummaryStats(missingModels), {
    exact: 1,
    partial: 1,
    none: 1,
  });
});

test('source statuses distinguish exact, partial, found, and idle results', () => {
  const dialog = createDialog();
  const missing = { key: 'missing-key' };
  dialog.searchResultCache.set('missing-key', {
    explicitSearchSources: ['civitai'],
    sourceProgress: { civitai: { status: 'found' } },
    results: {
      civitai: { confidence: 100 },
      huggingface: { url: 'https://example.test/hf' },
    },
  });

  assert.equal(dialog.getMissingSourceStatus(missing, 'civitai'), 'exact');
  assert.equal(dialog.getMissingSourceStatus(missing, 'huggingface'), 'found');
  assert.equal(dialog.getMissingSourceStatus(missing, 'civarchive'), 'idle');
  assert.equal(dialog.hasMissingSourceSearchAttempt(missing, 'civitai'), true);
  assert.equal(dialog.hasMissingSourceSearchAttempt(missing, 'huggingface'), false);
});

test('known local download sources are hidden until local search was attempted', () => {
  const dialog = createDialog();
  const source = { source: 'model_list', url: 'https://example.test/model' };
  const state = { explicitSearchSources: [] };

  assert.equal(dialog.isLocalDatabaseDownloadSource(source), true);
  assert.equal(dialog.shouldDisplayKnownDownloadSource({}, source, state), false);
  assert.equal(
    dialog.shouldDisplayKnownDownloadSource({}, source, { explicitSearchSources: ['local'] }),
    true
  );
  assert.equal(
    dialog.shouldDisplayKnownDownloadSource({}, { source: 'civitai', url: source.url }, state),
    true
  );
});

test('search result status and missing model counters expose stable state', () => {
  const dialog = createDialog();

  assert.equal(dialog.getSearchResultStatusLevel([{ confidence: 100 }]), 'exact');
  assert.equal(dialog.getSearchResultStatusLevel([{ match_type: 'similar' }]), 'partial');
  assert.equal(dialog.getSearchResultStatusLevel([{ url: 'https://example.test/model' }]), 'found');
  assert.equal(dialog.getSearchResultStatusLevel([]), '');
  assert.equal(dialog.hasRenderableSearchState({ results: { popular: { url: 'x' } } }), true);
  assert.equal(dialog.hasRenderableSearchState({}), false);

  const resolved = { __isExistingResolved: true };
  assert.equal(dialog.isMissingModelResolved(resolved), true);
  assert.equal(dialog.isAutoDownloadModel({ auto_download_candidate: true }), true);
  assert.equal(dialog.getResolvedMissingCount([resolved, {}, { __isExistingResolved: true }]), 2);
});
