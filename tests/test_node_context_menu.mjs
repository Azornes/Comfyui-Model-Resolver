import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildModelResolverNodeMenu,
  getImmediateModelsForNode,
  getModelsForSubgraphInstance,
  getResolvedModelsForNode,
  isExistingResolvedModel,
  matchesWorkflowModelReference,
  toResolverContextModel,
} from '../web/resolver/node_context_menu.js';

test('node context menu filters existing models by path and workflow scope', () => {
  const model = {
    node_id: 11,
    widget_index: 3,
    original_path: 'Folder\\Model.safetensors',
    is_top_level: false,
    subgraph_id: 'subgraph-a',
    exists: true,
  };

  assert.equal(isExistingResolvedModel({ exists: true, full_path: 'C:\\model' }), true);
  assert.equal(isExistingResolvedModel({ exists: false, full_path: 'C:\\model' }), false);
  assert.equal(isExistingResolvedModel({ exists: true }), false);
  assert.equal(matchesWorkflowModelReference(model, {
    node_id: '11',
    widget_index: 3,
    original_path: 'folder/model.safetensors',
    is_top_level: false,
    subgraph_id: 'subgraph-a',
  }), true);
  assert.equal(matchesWorkflowModelReference(model, { node_id: 12 }), false);
  assert.equal(matchesWorkflowModelReference(model, { node_id: 11, widget_index: 4 }), false);
  assert.equal(matchesWorkflowModelReference(model, { node_id: 11, is_top_level: true }), false);
  assert.equal(matchesWorkflowModelReference(model, { node_id: 11, subgraph_id: 'other' }), false);
  assert.equal(matchesWorkflowModelReference(model, { node_id: 11, original_path: 'other.safetensors' }), false);

  const models = getResolvedModelsForNode({
    resolved_models: [
      { ...model, widget_index: 2, full_path: 'C:\\b', category: 'vae' },
      { ...model, widget_index: 1, full_path: 'C:\\a', category: 'checkpoints' },
      { ...model, exists: false, widget_index: 0 },
    ],
  }, 11, { is_top_level: false, subgraph_id: 'subgraph-a' });
  assert.deepEqual(models.map(item => item.widget_index), [1, 2]);
});

test('node context menu aggregates inner models for an outer subgraph instance', () => {
  const models = getModelsForSubgraphInstance({
    resolved_models: [
      {
        node_id: 7,
        widget_index: 0,
        original_path: 'promoted.safetensors',
        full_path: 'C:\\promoted',
        is_top_level: true,
        subgraph_id: 'subgraph-a',
        promoted_inner_node_id: 10,
        promoted_inner_widget_index: 0,
        exists: true,
      },
      {
        node_id: 10,
        widget_index: 0,
        original_path: 'promoted.safetensors',
        full_path: 'C:\\promoted',
        is_top_level: false,
        subgraph_id: 'subgraph-a',
        exists: true,
      },
      {
        node_id: 11,
        widget_index: 1,
        original_path: 'hidden.safetensors',
        full_path: 'C:\\hidden',
        is_top_level: false,
        subgraph_id: 'subgraph-a',
        exists: true,
      },
      {
        node_id: 12,
        widget_index: 0,
        original_path: 'other.safetensors',
        full_path: 'C:\\other',
        is_top_level: false,
        subgraph_id: 'subgraph-b',
        exists: true,
      },
    ],
  }, 7, {
    is_top_level: true,
    subgraph_id: 'subgraph-a',
    subgraph_instance_id: 'subgraph-a',
    is_subgraph_instance: true,
  });

  assert.deepEqual(
    models.map(model => model.original_path),
    ['promoted.safetensors', 'hidden.safetensors'],
  );
});

test('node context menu resolves immediate widget selections and ignores invalid references', () => {
  const node = {
    id: 7,
    type: 'CheckpointLoader',
    widgets: [
      { value: 'object-model.safetensors', options: { values: [{ name: 'object-model.safetensors' }] } },
      { value: 'old.safetensors', options: { values: ['old.safetensors'] } },
      { value: 42, options: { values: [42] } },
      { value: 'pending.safetensors' },
    ],
  };
  const models = getImmediateModelsForNode({
    resolved_models: [
      { node_id: 7, is_top_level: true, node_type: 'CheckpointLoader', widget_index: 0, original_path: 'object-model.safetensors', exists: true, full_path: 'C:\\object' },
      { node_id: 7, is_top_level: true, node_type: 'OtherLoader', widget_index: 1, original_path: 'old.safetensors', exists: true, full_path: 'C:\\old' },
      { node_id: 7, is_top_level: true, widget_index: 1, original_path: 'old.safetensors', exists: true, full_path: 'C:\\old' },
      { node_id: 7, is_top_level: true, widget_index: 2, original_path: '42', exists: true, full_path: 'C:\\number' },
      { node_id: 7, is_top_level: true, widget_index: 3, original_path: 'other.safetensors', exists: true, full_path: 'C:\\other' },
    ],
    missing_models: [
      { node_id: 7, is_top_level: true, widget_index: 3, original_path: 'old-pending.safetensors', node_type: 'CheckpointLoader' },
    ],
  }, node, { is_top_level: true });

  assert.equal(models.length, 3);
  assert.equal(models[0].widget_index, 0);
  assert.equal(models[0].full_path, 'C:\\object');
  assert.equal(models[2].resolution_pending, true);
  assert.equal(models[2].original_path, 'pending.safetensors');
});

test('node context menu builds empty, single, and grouped menus with optional handlers', () => {
  assert.equal(buildModelResolverNodeMenu([]), null);
  assert.equal(buildModelResolverNodeMenu([{ exists: false, full_path: '' }]), null);

  const calls = [];
  const pending = { resolution_pending: true, category: 'diffusion_models', original_path: 'pending.gguf' };
  const single = buildModelResolverNodeMenu([pending], {
    showInResolver: model => calls.push(['resolver', model.original_path]),
  }, {
    formatCategory: () => 'Diffusion models',
  });
  assert.equal(single.submenu.options.length, 3);
  single.submenu.options[0].callback();
  single.submenu.options[1].callback();
  single.submenu.options[2].callback();
  assert.deepEqual(calls, [['resolver', 'pending.gguf']]);

  const grouped = buildModelResolverNodeMenu([
    { exists: true, full_path: 'C:\\a', category: 'checkpoints', name: 'a.safetensors' },
    { exists: true, full_path: 'C:\\b', category: 'vae', name: 'b.safetensors' },
  ]);
  assert.equal(grouped.submenu.options.length, 2);
  assert.equal(grouped.submenu.options[0].has_submenu, true);
  assert.equal(grouped.submenu.options[0].submenu.options.length, 3);
});

test('node context conversion prefers resolved paths and derives safe display fields', () => {
  const model = {
    original_path: 'folder/model.gguf',
    resolved_path: 'C:\\resolved\\model.gguf',
    relative_path: 'relative/model.gguf',
    category: 'diffusion_models',
  };
  const context = toResolverContextModel(model);

  assert.equal(context.name, 'model.gguf');
  assert.equal(context.filename, 'model.gguf');
  assert.equal(context.path, model.resolved_path);
  assert.equal(context.resolved_path, model.resolved_path);
  assert.equal(context.relative_path, model.relative_path);
  assert.equal(context.context_scope, 'local_model');
});

test('node context conversion derives filenames from Windows paths and fallback paths', () => {
  const context = toResolverContextModel({
    original_path: 'folder\\nested\\model.gguf',
  });
  const fallbackContext = toResolverContextModel({
    resolved_path: 'C:\\models\\fallback.safetensors',
  });

  assert.equal(context.filename, 'model.gguf');
  assert.equal(context.name, 'model.gguf');
  assert.equal(fallbackContext.filename, 'fallback.safetensors');
  assert.equal(fallbackContext.name, 'fallback.safetensors');
});
