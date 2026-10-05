import test from 'node:test';
import assert from 'node:assert/strict';
import { imageMetadataMethods } from '../web/resolver/views/tabs_image_metadata_methods.js';
import {
  extractWorkflowPrompts,
  getPromptCandidateScore,
  sortPromptCandidates,
  updateWorkflowPromptValue,
} from '../web/resolver/utils/prompt_utils.js';

function clipTextNode(id, text, outputLink, { title = '', textLink = null } = {}) {
  return {
    id,
    type: 'CLIPTextEncode',
    title,
    widgets_values: [text],
    inputs: [
      { name: 'clip', type: 'CLIP', link: 1 },
      { name: 'text', type: 'STRING', widget: { name: 'text' }, link: textLink },
    ],
    outputs: [{ links: [outputLink] }],
  };
}

function createRoleWorkflow(positiveText = 'positive source', negativeText = 'negative source') {
  return {
    nodes: [
      clipTextNode(1, positiveText, 11),
      clipTextNode(2, negativeText, 12),
      {
        id: 3,
        type: 'KSampler',
        inputs: [
          { name: 'positive', type: 'CONDITIONING', link: 11 },
          { name: 'negative', type: 'CONDITIONING', link: 12 },
        ],
      },
    ],
  };
}

function createContext(sourceWorkflow, currentWorkflow) {
  const state = {
    metadata: { workflow: sourceWorkflow },
    promptTransfer: null,
  };
  const notifications = [];
  let workflow = currentWorkflow;
  return {
    ...imageMetadataMethods,
    imageInspectorState: state,
    getCurrentWorkflow: () => workflow,
    getWorkflowSignature: value => JSON.stringify(value),
    updateWorkflowInComfyUI: async value => {
      workflow = value;
      return true;
    },
    openMetadataTransfer() {},
    renderMetadataPromptTransferPanelInPlace() {},
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;'),
    showNotification(message, type) {
      notifications.push({ message, type });
    },
    getWorkflow() {
      return workflow;
    },
    notifications,
  };
}

test('live prompt preview detects positive and negative text changes without changing imported metadata', () => {
  const source = createRoleWorkflow('imported positive', 'imported negative');
  const current = createRoleWorkflow('current positive', 'current negative');
  const dialog = createContext(source, current);
  let refreshes = 0;
  dialog.renderMetadataPromptTransferPanelInPlace = () => {
    refreshes += 1;
    dialog.renderMetadataPromptTransferPanel(dialog.imageInspectorState);
    return true;
  };
  dialog.renderMetadataPromptTransferPanel(dialog.imageInspectorState);
  assert.equal(dialog.refreshMetadataPromptPreview(current), false);
  current.nodes[0].widgets_values[0] = 'edited positive';
  assert.equal(dialog.refreshMetadataPromptPreview(current), true);
  assert.match(dialog.renderMetadataPromptTransferPanel(dialog.imageInspectorState), /edited positive/);
  current.nodes[1].widgets_values[0] = 'edited negative';
  assert.equal(dialog.refreshMetadataPromptPreview(current), true);
  assert.equal(dialog.refreshMetadataPromptPreview(current), false);
  assert.equal(refreshes, 2);
  assert.equal(source.nodes[0].widgets_values[0], 'imported positive');
});

test('workflow prompt extraction distinguishes positive and negative CLIP text nodes', () => {
  const prompts = extractWorkflowPrompts(createRoleWorkflow());

  assert.deepEqual(
    prompts.map(prompt => [prompt.node_id, prompt.text, prompt.role, prompt.widget_name]),
    [
      [1, 'positive source', 'positive', 'text'],
      [2, 'negative source', 'negative', 'text'],
    ],
  );
});

test('prompt candidates are ranked by role and prompt-specific node type', () => {
  const candidates = [
    {
      id: 'generic',
      node_type: 'PrimitiveStringMultiline',
      node_title: 'Text value',
      widget_name: 'value',
      role: 'unknown',
      role_candidates: [],
    },
    {
      id: 'clip',
      node_type: 'CLIPTextEncode',
      node_title: '',
      widget_name: 'text',
      role: 'positive',
      role_candidates: ['positive'],
    },
  ];

  assert.ok(getPromptCandidateScore(candidates[1], 'positive') > getPromptCandidateScore(candidates[0], 'positive'));
  assert.deepEqual(
    sortPromptCandidates(candidates, 'positive').map(candidate => candidate.id),
    ['clip', 'generic'],
  );
});

test('workflow prompt extraction inherits a role for a plain text node feeding CLIPTextEncode', () => {
  const workflow = {
    nodes: [
      {
        id: 10,
        type: 'PrimitiveStringMultiline',
        widgets_values: ['plain positive'],
        outputs: [{ links: [20] }],
      },
      clipTextNode(11, 'stale value', 30, { textLink: 20 }),
      {
        id: 12,
        type: 'KSampler',
        inputs: [{ name: 'positive', type: 'CONDITIONING', link: 30 }],
      },
    ],
  };

  const prompts = extractWorkflowPrompts(workflow);

  assert.equal(prompts.find(prompt => prompt.node_id === 10)?.role, 'positive');
  assert.equal(prompts.find(prompt => prompt.node_id === 10)?.text, 'plain positive');
  assert.equal(prompts.find(prompt => prompt.node_id === 11)?.linked, true);
});

test('workflow prompt extraction recognizes generic text nodes through prompt-node links', () => {
  const workflow = {
    nodes: [
      {
        id: 20,
        type: 'StringLiteral',
        widgets_values: ['generic positive'],
        outputs: [{ links: [40] }],
      },
      {
        id: 21,
        type: 'CLIPTextEncodeSD3',
        widgets_values: ['stale value'],
        inputs: [{ name: 'clip_l', type: 'STRING', widget: { name: 'clip_l' }, link: 40 }],
        outputs: [{ links: [41] }],
      },
      {
        id: 22,
        type: 'KSampler',
        inputs: [{ name: 'positive', type: 'CONDITIONING', link: 41 }],
      },
    ],
  };

  const prompt = extractWorkflowPrompts(workflow).find(item => item.node_id === 20);

  assert.equal(prompt?.text, 'generic positive');
  assert.equal(prompt?.role, 'positive');
});

test('workflow prompt extraction ignores list and control widgets on prompt-named nodes', () => {
  const workflow = {
    nodes: [
      {
        id: 30,
        type: 'Prompt enhancement seed',
        title: 'Prompt enhancement seed (if used)',
        widgets: [
          { name: 'value', type: 'INT' },
          { name: 'control_after_generate', type: 'COMBO', options: ['fixed', 'increment'] },
        ],
        widgets_values: [1, 'fixed'],
        inputs: [
          { name: 'value', type: 'INT' },
          { name: 'control_after_generate', type: 'COMBO', options: ['fixed', 'increment'] },
        ],
      },
      {
        id: 31,
        type: 'Prompt enhancement seed',
        title: 'Prompt enhancement seed (if used)',
        widgets_values: [1, 'fixed'],
      },
    ],
  };

  assert.deepEqual(extractWorkflowPrompts(workflow), []);
});

test('workflow prompt extraction ignores filename fields on image output nodes', () => {
  const workflow = {
    nodes: [
      {
        id: 371,
        type: 'CLIPTextEncode',
        title: 'Prompt',
        widgets_values: ['This is prompt positive'],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [584] }],
      },
      {
        id: 594,
        type: 'SaveImage',
        title: 'Almost done',
        widgets: [{ name: 'filename_prefix', type: 'STRING', value: 'ComfyUI' }],
        widgets_values: ['ComfyUI'],
        inputs: [{ name: 'images', type: 'IMAGE', link: 942 }],
        outputs: [{ name: 'images', type: 'IMAGE', links: null }],
      },
      {
        id: 596,
        type: 'SaveImage',
        title: 'Your Porn',
        widgets: [{ name: 'filename_prefix', type: 'STRING', value: 'ComfyUI' }],
        widgets_values: ['ComfyUI'],
        inputs: [{ name: 'images', type: 'IMAGE', link: 945 }],
        outputs: [{ name: 'images', type: 'IMAGE', links: null }],
      },
    ],
  };

  assert.deepEqual(
    extractWorkflowPrompts(workflow).map(prompt => prompt.node_id),
    [371],
  );
});

test('workflow prompt extraction tolerates sparse widget value arrays', () => {
  const widgetsValues = new Array(2);
  widgetsValues[1] = 'sparse prompt';
  const workflow = {
    nodes: [{
      id: 32,
      type: 'PrimitiveStringMultiline',
      widgets_values: widgetsValues,
    }],
  };

  assert.deepEqual(
    extractWorkflowPrompts(workflow).map(prompt => [prompt.node_id, prompt.widget_index, prompt.text]),
    [[32, 1, 'sparse prompt']],
  );
});

test('workflow prompt extraction follows serialized positive links and leaves negative optional', () => {
  const workflow = {
    nodes: [
      {
        id: 40,
        type: 'PrimitiveStringMultiline',
        widgets_values: ['serialized positive'],
      },
      {
        id: 41,
        type: 'CLIPTextEncode',
        widgets_values: ['stale value'],
        inputs: [{ name: 'text', type: 'STRING', widget: { name: 'text' }, link: 401 }],
      },
      {
        id: 42,
        type: 'KSampler',
        inputs: [{ name: 'positive', type: 'CONDITIONING', link: 402 }],
      },
    ],
    links: [
      [401, 40, 0, 41, 0, 'STRING'],
      [402, 41, 0, 42, 0, 'CONDITIONING'],
    ],
  };

  const prompts = extractWorkflowPrompts(workflow);

  assert.equal(prompts.find(prompt => prompt.node_id === 40)?.role, 'positive');
  assert.equal(prompts.some(prompt => prompt.role === 'negative'), false);
});

test('workflow prompt traversal follows text inputs and skips unrelated seed branches', () => {
  const workflow = {
    nodes: [
      {
        id: 50,
        type: 'StringLiteral',
        widgets_values: ['connected positive'],
        outputs: [{ links: [501] }],
      },
      {
        id: 51,
        type: 'PromptEnhancer',
        widgets: [
          { name: 'text', type: 'STRING' },
          { name: 'control_after_generate', type: 'COMBO', options: ['fixed', 'increment'] },
        ],
        widgets_values: ['enhanced positive', 'fixed'],
        inputs: [
          { name: 'text', type: 'STRING', link: 501 },
          { name: 'seed', type: 'INT', link: 502 },
        ],
        outputs: [{ links: [503] }],
      },
      {
        id: 52,
        type: 'Prompt enhancement seed',
        widgets: [
          { name: 'value', type: 'INT' },
          { name: 'control_after_generate', type: 'COMBO', options: ['fixed', 'increment'] },
        ],
        widgets_values: [1, 'fixed'],
        outputs: [{ links: [502] }],
      },
      {
        id: 53,
        type: 'KSampler',
        inputs: [{ name: 'positive', type: 'CONDITIONING', link: 503 }],
      },
    ],
  };

  const prompts = extractWorkflowPrompts(workflow);

  assert.deepEqual(
    prompts.map(prompt => [prompt.node_id, prompt.text, prompt.role]),
    [
      [50, 'connected positive', 'positive'],
      [51, 'enhanced positive', 'positive'],
    ],
  );
});

test('workflow prompt replacement updates the serialized text widget and named value', () => {
  const workflow = createRoleWorkflow();
  workflow.nodes[0].widgets_values_named = { text: 'positive source' };
  const prompt = extractWorkflowPrompts(workflow).find(item => item.role === 'positive');

  assert.equal(updateWorkflowPromptValue(workflow, prompt, 'replacement'), true);
  assert.equal(workflow.nodes[0].widgets_values[0], 'replacement');
  assert.equal(workflow.nodes[0].widgets_values_named.text, 'replacement');
});

test('linked prompt inputs are not treated as replaceable text fields', () => {
  const workflow = createRoleWorkflow('linked value');
  workflow.nodes[0].inputs[1].link = 99;
  const prompt = extractWorkflowPrompts(workflow).find(item => item.node_id === 1);

  assert.equal(prompt.linked, true);
  assert.equal(updateWorkflowPromptValue(workflow, prompt, 'replacement'), false);
  assert.equal(workflow.nodes[0].widgets_values[0], 'linked value');
});

test('metadata prompt panel renders separate positive and negative transfer rows', () => {
  const context = createContext(createRoleWorkflow(), createRoleWorkflow('current positive', 'current negative'));
  const contextMenuCalls = [];
  context.getContextMenuAttrs = (model, tooltip) => {
    contextMenuCalls.push({ model, tooltip });
    return ` data-context-scope="${model.context_scope}" data-node-id="${model.node_id}"`;
  };
  const rows = context.getMetadataPromptTransferRows(context.imageInspectorState);
  const html = context.renderMetadataPromptTransferPanel(context.imageInspectorState);

  assert.deepEqual(rows.map(row => row.role), ['positive', 'negative']);
  assert.equal(rows[0].source.text, 'positive source');
  assert.equal(rows[1].source.text, 'negative source');
  assert.match(html, /Positive prompt/);
  assert.match(html, /Negative prompt/);
  assert.match(html, /data-image-prompt-source="positive"/);
  assert.match(html, /data-image-prompt-target="negative"/);
  assert.match(html, /data-image-prompt-role-selection="positive"[^>]*checked/);
  assert.match(html, /data-image-prompt-role-selection="negative"[^>]*checked/);
  assert.equal((html.match(/data-image-prompt-copy/g) || []).length, 4);
  assert.match(html, /class="mr-btn mr-btn-secondary mr-btn-sm mr-image-prompt-copy"[^>]*data-image-prompt-copy/);
  assert.match(html, /data-tooltip="["]*Positive\/negative role detected from workflow connections\./);
  assert.doesNotMatch(html, /class="mr-image-prompt-meta"/);
  assert.match(html, /class="mr-tooltip-badge"[^>]*data-tooltip="[\s\S]*Select which prompt roles to replace/);
  assert.doesNotMatch(html, /class="mr-image-prompt-note"/);
  const positiveTargetIndex = html.indexOf('data-image-prompt-target="positive"');
  const positiveSourceIndex = html.indexOf('data-image-prompt-source="positive"');
  assert.ok(positiveTargetIndex >= 0 && positiveTargetIndex < positiveSourceIndex);
  assert.deepEqual(
    contextMenuCalls.map(call => [call.model.context_scope, call.model.node_id]),
    [['workflow_node', 1], ['workflow_node', 2]],
  );
  assert.match(html, /class="mr-image-prompt-side is-context-menu" data-context-scope="workflow_node" data-node-id="1"/);
  assert.match(html, /Replace prompts/);
});

test('metadata prompt copy uses the visible prompt preview text', async () => {
  const context = createContext(null, createRoleWorkflow());
  const copied = [];
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        async writeText(value) {
          copied.push(value);
        },
      },
    },
    writable: true,
  });
  const button = {
    innerHTML: '<svg></svg> Copy',
    isConnected: false,
    classList: {
      add() {},
      remove() {},
    },
    closest(selector) {
      assert.equal(selector, '.mr-image-prompt-side');
      return {
        querySelector(query) {
          assert.equal(query, '.mr-image-prompt-text');
          return { textContent: 'visible prompt preview' };
        },
      };
    },
  };

  try {
    assert.equal(await context.copyMetadataPromptText(button), true);
    assert.deepEqual(copied, ['visible prompt preview']);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});

test('metadata prompt selectors put the most likely prompt node first', () => {
  const currentWorkflow = {
    nodes: [
      {
        id: 90,
        type: 'PrimitiveStringMultiline',
        widgets_values: ['generic text field'],
      },
      clipTextNode(371, 'actual prompt', 11),
      {
        id: 3,
        type: 'KSampler',
        inputs: [{ name: 'positive', type: 'CONDITIONING', link: 11 }],
      },
    ],
  };
  const context = createContext(createRoleWorkflow(), currentWorkflow);
  const positiveRow = context.getMetadataPromptTransferRows(context.imageInspectorState)
    .find(row => row.role === 'positive');

  assert.deepEqual(
    positiveRow.targetOptions.map(prompt => prompt.node_id),
    [371, 90],
  );
});

test('metadata prompt role checkboxes stay selectable without an imported workflow', () => {
  const context = createContext(null, createRoleWorkflow('current positive', 'current negative'));
  context.imageInspectorState.metadata = null;

  const html = context.renderMetadataPromptTransferPanel(context.imageInspectorState);

  for (const role of ['positive', 'negative']) {
    const checkbox = html.match(new RegExp(`<input type="checkbox" data-image-prompt-role-selection="${role}"[^>]*>`))?.[0] || '';
    assert.match(checkbox, /type="checkbox"/);
    assert.doesNotMatch(checkbox, /disabled/);
  }
});

test('metadata prompt role selection survives importing a source workflow', async () => {
  const context = createContext(null, createRoleWorkflow('current positive', 'current negative'));
  const promptTransfer = context.getMetadataPromptTransferState(context.imageInspectorState);
  promptTransfer.selectedRoles = new Set(['positive']);
  promptTransfer.sourceSelections = { positive: 'old-source' };
  context.fetchJson = async (_endpoint, options) => {
    const payload = JSON.parse(options.body);
    if (payload.source_type === 'workflow') {
      return { workflow: createRoleWorkflow('imported positive', 'imported negative') };
    }
    return { loaded_models: [], total: 0 };
  };
  context.renderImageMetadataResult = () => {};

  await context.runImageMetadataInspection({
    source_type: 'workflow',
    filename: 'source.json',
  });

  assert.deepEqual(Array.from(context.imageInspectorState.promptTransfer.selectedRoles), ['positive']);
  assert.deepEqual(context.imageInspectorState.promptTransfer.sourceSelections, {});
});

test('metadata prompt transfer applies only the selected prompt role', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  try {
    for (const [selectedRole, replacedNodeIndex, untouchedNodeIndex] of [
      ['positive', 0, 1],
      ['negative', 1, 0],
    ]) {
      const context = createContext(
        createRoleWorkflow('imported positive', 'imported negative'),
        createRoleWorkflow('current positive', 'current negative'),
      );
      const state = context.getMetadataPromptTransferState(context.imageInspectorState);
      state.selectedRoles = new Set([selectedRole]);
      const html = context.renderMetadataPromptTransferPanel(context.imageInspectorState);
      const selectedCheckbox = html.match(new RegExp(`<input type="checkbox" data-image-prompt-role-selection="${selectedRole}"[^>]*>`))?.[0] || '';
      const otherRole = selectedRole === 'positive' ? 'negative' : 'positive';
      const otherCheckbox = html.match(new RegExp(`<input type="checkbox" data-image-prompt-role-selection="${otherRole}"[^>]*>`))?.[0] || '';

      assert.match(selectedCheckbox, /checked/);
      assert.doesNotMatch(otherCheckbox, /checked/);

      const result = await context.applyMetadataPromptTransfer();
      const workflow = context.getWorkflow();

      assert.equal(result.updated, 1);
      assert.equal(workflow.nodes[replacedNodeIndex].widgets_values[0], `imported ${selectedRole}`);
      assert.equal(
        workflow.nodes[untouchedNodeIndex].widgets_values[0],
        `current ${otherRole}`,
      );
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('metadata prompt transfer keeps empty current text fields selectable', () => {
  const context = createContext(createRoleWorkflow(), createRoleWorkflow('', ''));
  const rows = context.getMetadataPromptTransferRows(context.imageInspectorState);

  assert.equal(rows[0].target.node_id, 1);
  assert.equal(rows[0].target.text, '');
  assert.equal(rows[1].target.node_id, 2);
  assert.equal(rows[1].target.text, '');
});

test('metadata prompt transfer avoids selecting one unknown target for both roles', () => {
  const source = {
    nodes: [
      { id: 1, type: 'PrimitiveStringMultiline', widgets_values: ['first'] },
      { id: 2, type: 'PrimitiveStringMultiline', widgets_values: ['second'] },
    ],
  };
  const current = {
    nodes: [
      { id: 10, type: 'PrimitiveStringMultiline', widgets_values: ['target one'] },
      { id: 11, type: 'PrimitiveStringMultiline', widgets_values: ['target two'] },
    ],
  };
  const context = createContext(source, current);
  const rows = context.getMetadataPromptTransferRows(context.imageInspectorState);

  assert.notEqual(rows[0].target.id, rows[1].target.id);
});

test('metadata prompt transfer replaces both selected prompt fields in the current workflow', async () => {
  const context = createContext(
    createRoleWorkflow('imported positive', 'imported negative'),
    createRoleWorkflow('current positive', 'current negative'),
  );
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };

  try {
    const result = await context.applyMetadataPromptTransfer();
    const workflow = context.getWorkflow();

    assert.equal(result.updated, 2);
    assert.equal(workflow.nodes[0].widgets_values[0], 'imported positive');
    assert.equal(workflow.nodes[1].widgets_values[0], 'imported negative');
    assert.deepEqual(context.notifications, [{
      message: 'Replaced 2 prompt fields in the current workflow.',
      type: 'success',
    }]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
