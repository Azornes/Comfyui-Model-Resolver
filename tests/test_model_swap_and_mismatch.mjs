import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLocalMatches } from '../web/resolver/utils/local_match_utils.js';
import { resolveDownloadMethods } from '../web/resolver/actions/resolve_download_methods.js';
import { tabsLoadedMethods } from '../web/resolver/views/tabs_loaded_methods.js';

test('classifyLocalMatches excludes category_mismatch from perfectMatches', () => {
  const matches = [
    { confidence: 100, category_mismatch: false, model: { path: '/models/checkpoints/a.safetensors' } },
    { confidence: 100, category_mismatch: true, model: { path: '/models/loras/a.safetensors' } },
    { confidence: 80, category_mismatch: false, model: { path: '/models/checkpoints/b.safetensors' } },
  ];

  const result = classifyLocalMatches(matches);
  assert.equal(result.perfectMatches.length, 1);
  assert.equal(result.perfectMatches[0].category_mismatch, false);
  assert.equal(result.otherMatches.length, 2);
  assert.equal(result.otherMatches[0].category_mismatch, true);
});

test('getExactLocalMatchSelections skips category_mismatch matches and bad folder warnings', () => {
  const dialog = {
    ...resolveDownloadMethods,
    getBestLocalMatch(missing, minConfidence, { excludeMismatch = false } = {}) {
      const matches = missing.matches || [];
      return matches.find(m => m.confidence >= minConfidence && (!excludeMismatch || !m.category_mismatch)) || null;
    },
    getLocalMatchBadFolderWarning(missing, match) {
      return match.has_bad_folder_warning ? { targetCategory: 'checkpoints' } : null;
    },
    buildResolutionSelection(missing, model) {
      return { node_id: missing.node_id, resolved_path: model.path };
    },
    getResolutionQueueKey(selection) {
      return `${selection.node_id}:${selection.resolved_path}`;
    }
  };

  const missingModels = [
    // 1: Has 100% match with category_mismatch -> should be skipped
    { node_id: 1, matches: [{ confidence: 100, category_mismatch: true, model: { path: '/loras/x.safetensors' } }] },
    // 2: Has 100% match without category_mismatch but has bad folder warning -> should be skipped
    { node_id: 2, matches: [{ confidence: 100, category_mismatch: false, has_bad_folder_warning: true, model: { path: '/vae/y.safetensors' } }] },
    // 3: Has 100% valid match -> should be included
    { node_id: 3, matches: [{ confidence: 100, category_mismatch: false, model: { path: '/checkpoints/z.safetensors' } }] },
  ];

  const selections = dialog.getExactLocalMatchSelections(missingModels);
  assert.equal(selections.length, 1);
  assert.equal(selections[0].node_id, 3);
  assert.equal(selections[0].resolved_path, '/checkpoints/z.safetensors');
});

test('applyModelSwap constructs multi-node resolution with node_refs across workflow', async () => {
  let appliedResolutions = null;
  let notifications = [];

  const dialog = {
    ...tabsLoadedMethods,
    cachedLoadedModelsData: {
      loaded_models: [
        {
          node_id: 10,
          widget_index: 0,
          category: 'checkpoints',
          name: 'v1-5-pruned.safetensors',
          original_path: 'v1-5-pruned.safetensors',
          is_top_level: true,
          node_type: 'CheckpointLoaderSimple'
        },
        {
          node_id: 25,
          widget_index: 0,
          category: 'checkpoints',
          name: 'v1-5-pruned.safetensors',
          original_path: 'v1-5-pruned.safetensors',
          subgraph_id: 'sub-1',
          is_top_level: false,
          node_type: 'CheckpointLoaderSimple'
        },
        {
          node_id: 30,
          widget_index: 0,
          category: 'loras',
          name: 'detail_tweaker.safetensors',
          original_path: 'detail_tweaker.safetensors',
          is_top_level: true,
          node_type: 'LoraLoader'
        }
      ]
    },
    getFilenameFromPath: (p) => p ? p.split('/').pop() : '',
    applyPendingResolutionList: async (list) => {
      appliedResolutions = list;
      return { success: true };
    },
    showNotification: (msg, type) => {
      notifications.push({ msg, type });
    },
    loadLoadedModels: async () => {}
  };

  const modelToSwap = dialog.cachedLoadedModelsData.loaded_models[0];
  const targetReplacement = {
    filename: 'v1-5-pruned-emaonly.safetensors',
    path: '/models/checkpoints/v1-5-pruned-emaonly.safetensors',
    relative_path: 'v1-5-pruned-emaonly.safetensors',
    category: 'checkpoints'
  };

  await dialog.applyModelSwap(modelToSwap, targetReplacement);

  assert.ok(appliedResolutions, 'applyPendingResolutionList should be called');
  assert.equal(appliedResolutions.length, 1);
  const selection = appliedResolutions[0];
  assert.equal(selection.resolved_path, '/models/checkpoints/v1-5-pruned-emaonly.safetensors');
  assert.equal(selection.expected_filename, 'v1-5-pruned-emaonly.safetensors');
  assert.equal(selection.node_refs.length, 2, 'Should group both occurrences (top-level and subgraph)');
  assert.equal(selection.node_refs[0].node_id, 10);
  assert.equal(selection.node_refs[1].node_id, 25);
  assert.equal(selection.node_refs[1].subgraph_id, 'sub-1');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'success');
  assert.match(notifications[0].msg, /swapped "v1-5-pruned\.safetensors" with "v1-5-pruned-emaonly\.safetensors" across 2 occurrences/);
});
