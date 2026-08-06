import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionMethods } from '../web/resolver/actions/selection_methods.js';

function createDialog(missingModels) {
  return {
    missingModels,
    getBestLocalMatch(model, minConfidence) {
      return model.localConfidence >= minConfidence
        ? { confidence: model.localConfidence }
        : null;
    },
    getBestDownloadSourceForMissing(model) {
      return model.hasDownloadSource ? { url: `https://example.test/${model.id}` } : null;
    },
    getSearchState(model) {
      return { searched: model.searched };
    },
    hasRenderableSearchState(state) {
      return state.searched;
    },
  };
}

const missingModels = [
  { id: 'exact', localConfidence: 100, hasDownloadSource: true, searched: true },
  { id: 'partial', localConfidence: 80, hasDownloadSource: true, searched: true },
  { id: 'weak', localConfidence: 60, hasDownloadSource: false, searched: false },
  { id: 'none', localConfidence: 0, hasDownloadSource: false, searched: false },
];

function ids(models) {
  return models.map(model => model.id);
}

test('missing model selection methods preserve all classification partitions', () => {
  const dialog = { ...selectionMethods, ...createDialog(missingModels) };

  assert.deepEqual(ids(selectionMethods.getMissingWithExactLocalMatches.call(dialog)), ['exact']);
  assert.deepEqual(
    ids(selectionMethods.getMissingWithoutExactLocalMatches.call(dialog)),
    ['partial', 'weak', 'none'],
  );
  assert.deepEqual(ids(selectionMethods.getMissingWithPartialLocalMatches.call(dialog)), ['partial']);
  assert.deepEqual(
    ids(selectionMethods.getMissingWithoutLocalMatches.call(dialog)),
    ['weak', 'none'],
  );
  assert.deepEqual(
    ids(selectionMethods.getMissingWithDownloadSources.call(dialog)),
    ['exact', 'partial'],
  );
  assert.deepEqual(
    ids(selectionMethods.getMissingWithoutDownloadSources.call(dialog)),
    ['weak', 'none'],
  );
  assert.deepEqual(ids(selectionMethods.getSearchedMissingModels.call(dialog)), ['exact', 'partial']);
  assert.deepEqual(
    ids(selectionMethods.getUnsearchedMissingModels.call(dialog)),
    ['weak', 'none'],
  );
});

test('missing model selection methods honor explicit arrays and do not mutate them', () => {
  const dialog = { ...selectionMethods, ...createDialog(missingModels) };
  const selectedModels = [missingModels[2], missingModels[0], missingModels[3]];
  const before = [...selectedModels];

  assert.deepEqual(
    ids(selectionMethods.getMissingWithoutExactLocalMatches.call(dialog, selectedModels)),
    ['weak', 'none'],
  );
  assert.deepEqual(selectedModels, before);
});
