import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageMetadataMethods } from '../web/resolver/views/tabs_image_metadata_methods.js';

const modelInfoMethodsSource = readFileSync(
  new URL('../web/resolver/views/model_info_methods.js', import.meta.url),
  'utf8'
);
const imageMetadataMethodsSource = readFileSync(
  new URL('../web/resolver/views/tabs_image_metadata_methods.js', import.meta.url),
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
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return `${isAsync ? 'async ' : ''}function ${methodName}(${params}) ${source.slice(braceStart, index + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

function createTransferContext(catalogValues = ['clip.safetensors']) {
  return {
    ...imageMetadataMethods,
    getMissingAcceptedModelFileTypes: ({ node_type: nodeType, widget_name: widgetName }) => (
      nodeType === 'CLIPLoader' && widgetName === 'clip_name'
        ? catalogValues
            .map(value => {
              const match = String(value || '').match(/\.([a-z0-9]+)$/i);
              return match
                ? { extension: match[1].toLowerCase(), display: `.${match[1].toLowerCase()}` }
                : null;
            })
            .filter(Boolean)
        : []
    ),
    getModelFileTypeInfo: value => {
      const match = String(value || '').match(/\.([a-z0-9]+)$/i);
      return match ? { extension: match[1].toLowerCase() } : null;
    },
    getComfyWidgetNameByIndex: () => 'clip_name',
    getCurrentComfyCatalogValues: (nodeType, widgetName) => (
      nodeType === 'CLIPLoader' && widgetName === 'clip_name'
        ? catalogValues
        : null
    ),
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;'),
    getFilenameFromPath: value => String(value).split(/[\\/]/).pop(),
    stripModelExtension: value => String(value).replace(/\.[^.]+$/, ''),
    getContextMenuAttrs: model => model?.context_scope
        ? ` data-context-scope="${model.context_scope}"`
        : '',
    getModelPreviewTooltipAttrs: model => model?.exists === true && model?.resolved_path
        ? ` data-tooltip-image="${model.resolved_path}"`
        : '',
  };
}

function createTransferState(sourceModels) {
  const targetGroups = [{
    category: 'text_encoders',
    nodes: [{
      nodeKey: 'top:1',
      nodeId: 1,
      nodeType: 'CLIPLoader',
      refs: [{
        category: 'text_encoders',
        node_id: 1,
        node_type: 'CLIPLoader',
        widget_index: 0,
        widget_name: 'clip_name',
        original_path: 'current.safetensors',
        transferKey: 'text_encoders:top:1:0',
      }],
    }],
  }];

  return {
    loadedModels: { loaded_models: sourceModels },
    transfer: {
      mode: 'replace',
      targetGroups,
      selectedNodeKeys: new Set(['top:1']),
      sourceSelections: {},
    },
  };
}

function createLoraTransferState(sourceModels, activityScope = 'all') {
  const targetGroups = [{
    category: 'loras',
    nodes: [{
      nodeKey: 'top:2',
      nodeId: 2,
      nodeType: 'LoraLoaderV2',
      refs: [
        {
          category: 'loras',
          node_id: 2,
          node_type: 'LoraLoaderV2',
          widget_index: 2,
          original_path: 'active-current.safetensors',
          active: true,
          transferKey: 'loras:top:2:0',
        },
        {
          category: 'loras',
          node_id: 2,
          node_type: 'LoraLoaderV2',
          widget_index: 2,
          original_path: 'inactive-current.safetensors',
          active: false,
          transferKey: 'loras:top:2:1',
        },
      ],
    }],
  }];

  return {
    loadedModels: { loaded_models: sourceModels },
    transfer: {
      mode: 'replace-add',
      activityScope,
      targetGroups,
      selectedNodeKeys: new Set(['top:2']),
      sourceSelections: {},
    },
  };
}

test('metadata transfer persists only mode and activity scope preferences', () => {
  const context = createTransferContext();

  assert.deepEqual(context.getMetadataTransferPreferences(), {
    mode: 'replace',
    activityScope: 'all',
  });

  assert.equal(context.setMetadataTransferMode('merge'), 'merge');
  assert.equal(context.setMetadataTransferActivityScope('inactive'), 'inactive');
  assert.deepEqual(context.getMetadataTransferPreferences(), {
    mode: 'merge',
    activityScope: 'inactive',
  });
});

test('metadata tab reuses transfer state for the unchanged workflow', () => {
  const context = createTransferContext();
  context.getWorkflowSignature = workflow => workflow.signature;
  const state = { transfer: { workflowSignature: 'workflow-a' } };

  assert.equal(
    context.isMetadataTransferCurrentWorkflow(state, { signature: 'workflow-a' }),
    true
  );
  assert.equal(
    context.isMetadataTransferCurrentWorkflow(state, { signature: 'workflow-b' }),
    false
  );
  assert.equal(
    context.isMetadataTransferCurrentWorkflow({ transfer: { workflowSignature: '' } }, null),
    true
  );
  assert.equal(context.isMetadataTransferCurrentWorkflow(null, null), false);
});

test('metadata transfer reuses the shared Loaded Models cache for the same workflow', async () => {
  const cachedData = {
    loaded_models: [{
      category: 'text_encoders',
      node_id: 1,
      node_type: 'CLIPLoader',
      widget_index: 0,
      original_path: 'current.safetensors',
      active: true,
      connected: true,
      is_top_level: true,
    }],
    total: 1,
  };
  let fetchCount = 0;
  const context = {
    ...imageMetadataMethods,
    getCurrentWorkflow: () => ({ signature: 'workflow-a' }),
    getWorkflowSignature: workflow => workflow.signature,
    cachedLoadedModelsSignature: 'workflow-a',
    cachedLoadedModelsData: cachedData,
    getCachedLoadedModelsForSignature(signature, { force = false } = {}) {
      return !force && signature === this.cachedLoadedModelsSignature
        ? this.cachedLoadedModelsData
        : null;
    },
    fetchJson: async () => {
      fetchCount += 1;
      throw new Error('The shared cache was not used');
    },
    renderImageMetadataResult() {},
  };

  const result = await context.openMetadataTransfer();

  assert.equal(fetchCount, 0);
  assert.equal(result, cachedData);
  assert.equal(context.imageInspectorState.transfer.targetModels, cachedData);
});

test('metadata transfer stores a fresh target scan in the shared Loaded Models cache', async () => {
  const freshData = { loaded_models: [], total: 0 };
  let saveCount = 0;
  const context = {
    ...imageMetadataMethods,
    getCurrentWorkflow: () => ({ signature: 'workflow-b' }),
    getWorkflowSignature: workflow => workflow.signature,
    cachedLoadedModelsSignature: null,
    cachedLoadedModelsData: null,
    getCachedLoadedModelsForSignature() {
      return null;
    },
    fetchJson: async () => freshData,
    saveLoadedModelsCacheForActiveWorkflow() {
      saveCount += 1;
    },
    renderImageMetadataResult() {},
  };

  const result = await context.openMetadataTransfer();

  assert.equal(result, freshData);
  assert.equal(context.cachedLoadedModelsSignature, 'workflow-b');
  assert.equal(context.cachedLoadedModelsData, freshData);
  assert.equal(saveCount, 1);
});

test('metadata transfer refresh keeps the current panel visible while scanning a changed workflow', async () => {
  const oldTargetGroup = {
    category: 'text_encoders',
    nodes: [{
      nodeKey: 'top:1',
      nodeId: 1,
      nodeType: 'CLIPLoader',
      refs: [],
    }],
  };
  const sourceModel = {
    category: 'text_encoders',
    original_path: 'imported.safetensors',
  };
  let resolveFetch;
  let renderCount = 0;
  const context = {
    ...imageMetadataMethods,
    imageInspectorState: {
      requestToken: 'source-request',
      loadedModels: { loaded_models: [sourceModel] },
      transfer: {
        open: true,
        workflowSignature: 'old-workflow',
        targetModels: { loaded_models: [] },
        targetGroups: [oldTargetGroup],
        selectedNodeKeys: new Set(['top:1']),
        collapsedCategories: new Set(['text_encoders']),
        sourceSelections: {},
      },
    },
    getCurrentWorkflow: () => ({ signature: 'new-workflow' }),
    getWorkflowSignature: workflow => workflow.signature,
    syncWorkflowScopedQueue() {},
    getCachedLoadedModelsForSignature() {
      return null;
    },
    getMetadataTransferAcceptedFileTypes() {
      return [];
    },
    fetchJson: () => new Promise(resolve => {
      resolveFetch = resolve;
    }),
    saveLoadedModelsCacheForActiveWorkflow() {},
    renderImageMetadataResult() {
      renderCount += 1;
    },
  };

  const refreshPromise = context.openMetadataTransfer({ preserveContent: true });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(renderCount, 0);
  assert.equal(context.imageInspectorState.transfer.refreshing, true);
  assert.deepEqual(context.imageInspectorState.transfer.targetGroups, [oldTargetGroup]);
  assert.deepEqual(
    Array.from(context.imageInspectorState.transfer.selectedNodeKeys),
    ['top:1']
  );

  resolveFetch({
    loaded_models: [{
      category: 'text_encoders',
      node_id: 1,
      node_type: 'CLIPLoader',
      widget_index: 0,
      original_path: 'current.safetensors',
      active: true,
      connected: true,
      is_top_level: true,
    }],
    total: 1,
  });
  await refreshPromise;

  assert.equal(renderCount, 1);
  assert.equal(context.imageInspectorState.transfer.refreshing, false);
  assert.equal(context.imageInspectorState.transfer.targetGroups[0].nodes[0].nodeKey, 'top:1');
  assert.deepEqual(
    Array.from(context.imageInspectorState.transfer.selectedNodeKeys),
    ['top:1']
  );
});

test('metadata transfer uses the shared canonical category aliases', () => {
  const context = createTransferContext();
  const state = createTransferState([
    { category: 'clip_gguf', original_path: 'clip.safetensors' },
  ]);
  state.transfer.targetGroups[0].category = 'clips';
  state.transfer.targetGroups[0].nodes[0].refs[0].category = 'clips';

  const [row] = context.getMetadataTransferPreviewRows(state);

  assert.equal(row.sourceUnavailable, false);
  assert.equal(row.nextValue, 'clip.safetensors');
});

test('metadata transfer hides imported models with an unsupported file extension', () => {
  const context = createTransferContext();
  const state = createTransferState([
    { category: 'text_encoders', original_path: 'clip.gguf' },
    { category: 'text_encoders', original_path: 'clip.safetensors' },
  ]);

  const [row] = context.getMetadataTransferPreviewRows(state);

  assert.deepEqual(row.sourceOptions.map(option => option.value), ['clip.safetensors']);
  assert.equal(row.nextValue, 'clip.safetensors');
  assert.equal(row.sourceUnavailable, false);
});

test('metadata transfer blocks a selected node when no imported model matches its format', () => {
  const context = createTransferContext();
  const state = createTransferState([
    { category: 'text_encoders', original_path: 'clip.gguf' },
  ]);

  const [row] = context.getMetadataTransferPreviewRows(state);

  assert.equal(row.sourceOptions.length, 0);
  assert.equal(row.nextLabel, 'No compatible model');
  assert.equal(row.sourceUnavailable, true);
});

test('replace/add preview replaces existing LoRAs and shows remaining models as additions', () => {
  const context = createTransferContext();
  const state = createLoraTransferState([
    { category: 'loras', original_path: 'new-a.safetensors' },
    { category: 'loras', original_path: 'new-b.safetensors' },
    { category: 'loras', original_path: 'new-c.safetensors' },
  ]);

  const rows = context.getMetadataTransferPreviewRows(state);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(0, 2).map(row => row.operation), ['replace', 'replace']);
  assert.equal(rows[0].nextValue, 'new-a.safetensors');
  assert.equal(rows[1].nextValue, 'new-b.safetensors');
  assert.equal(rows[2].operation, 'add');
  assert.equal(rows[2].nextValue, 'new-c.safetensors');
});

test('metadata transfer preview adds model actions and previews only for local files', () => {
  const context = createTransferContext();
  const state = createTransferState([
    {
      category: 'text_encoders',
      original_path: 'imported.safetensors',
      exists: true,
      resolved_path: 'C:\\models\\imported.safetensors',
    },
  ]);
  state.transfer.targetGroups[0].nodes[0].refs[0] = {
    ...state.transfer.targetGroups[0].nodes[0].refs[0],
    exists: true,
    resolved_path: 'C:\\models\\current.safetensors',
  };

  const [row] = context.getMetadataTransferPreviewRows(state);
  const html = context.renderMetadataTransferPreview([row]);

  assert.equal(row.nextModel.resolved_path, 'C:\\models\\imported.safetensors');
  assert.match(html, /data-context-scope="loaded_model"/);
  assert.match(html, /data-context-scope="local_model"/);
  assert.match(html, /data-tooltip-image="C:\\models\\current\.safetensors"/);
  assert.match(html, /data-tooltip-image="C:\\models\\imported\.safetensors"/);

  state.loadedModels.loaded_models[0].exists = false;
  const [missingRow] = context.getMetadataTransferPreviewRows(state);
  const missingHtml = context.renderMetadataTransferPreview([missingRow]);

  assert.doesNotMatch(missingHtml, /data-context-scope="local_model"/);
  assert.doesNotMatch(missingHtml, /data-tooltip-image="C:\\models\\imported\.safetensors"/);
});

test('unselected target nodes keep current model actions available', () => {
  const context = createTransferContext();
  const state = createTransferState([
    { category: 'text_encoders', original_path: 'imported.safetensors' },
  ]);
  state.transfer.selectedNodeKeys = new Set();
  state.transfer.targetGroups[0].nodes[0].refs[0] = {
    ...state.transfer.targetGroups[0].nodes[0].refs[0],
    exists: true,
    resolved_path: 'C:\\models\\current.safetensors',
  };

  const html = context.renderMetadataTransferPanel(state);

  assert.match(html, /class="mr-image-transfer-change is-unselected"/);
  assert.match(html, /data-context-scope="loaded_model"/);
  assert.match(html, /data-tooltip-image="C:\\models\\current\.safetensors"/);
});

test('LoRA activity scope filters imported models but keeps all target slots eligible', () => {
  const context = createTransferContext();
  const state = createLoraTransferState([
    { category: 'loras', original_path: 'new-active.safetensors', active: true },
    { category: 'loras', original_path: 'new-inactive-a.safetensors', active: false },
    { category: 'loras', original_path: 'new-inactive-b.safetensors', active: false },
    { category: 'loras', original_path: 'new-inactive-c.safetensors', active: false },
  ], 'inactive');

  const rows = context.getMetadataTransferPreviewRows(state);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].currentValue, 'active-current.safetensors');
  assert.equal(rows[0].nextValue, 'new-inactive-a.safetensors');
  assert.equal(rows[1].currentValue, 'inactive-current.safetensors');
  assert.equal(rows[1].nextValue, 'new-inactive-b.safetensors');
  assert.equal(rows[0].operation, 'replace');
  assert.equal(rows[1].operation, 'replace');
  assert.equal(rows[2].operation, 'add');
  assert.equal(rows[2].nextValue, 'new-inactive-c.safetensors');
});

test('workflow node context keeps Locate Node but hides model info', () => {
  const contextMenu = {
    style: { display: 'none', left: '', top: '' },
    querySelector() {
      return null;
    },
    getBoundingClientRect() {
      return { right: 0, bottom: 0 };
    },
  };
  const visibility = {};
  const showContextMenu = eval(`(${extractMethod(modelInfoMethodsSource, 'showContextMenu')})`);
  const dialog = {
    contextMenu,
    hideTooltip() {},
    canShowSourceDetails() {
      return false;
    },
    getContextMenuSourceLink() {
      return null;
    },
    getContextMenuSourceLookupModel(value) {
      return value;
    },
    canSuggestDownloadSubfolderFromContextMenu() {
      return false;
    },
    setContextMenuItemVisible(action, visible) {
      visibility[action] = visible;
    },
    setContextMenuDividerVisible() {},
    updateContextMenuSourceItem() {},
    refreshContextMenuSourceLink() {},
  };

  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 1000, innerHeight: 1000 };
  try {
    showContextMenu.call(dialog, 10, 20, {
      context_scope: 'workflow_node',
      node_id: 42,
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  assert.match(imageMetadataMethodsSource, /context_scope: 'workflow_node'/);
  assert.equal(visibility.showInfo, false);
  assert.equal(visibility.locateNode, true);
});
