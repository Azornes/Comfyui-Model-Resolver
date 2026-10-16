import test from 'node:test';
import assert from 'node:assert/strict';
import { imageMetadataMethods, extractCivitaiImageId } from '../web/resolver/views/tabs_image_metadata_methods.js';
import { tabsLoadedMethods } from '../web/resolver/views/tabs_loaded_methods.js';

globalThis.window = globalThis;

function createMockContext() {
    const memory = new Map();
    const mockStorage = {
        getItem: (k) => (memory.has(k) ? memory.get(k) : null),
        setItem: (k, v) => memory.set(k, String(v)),
        removeItem: (k) => memory.delete(k),
    };
    return {
        ...imageMetadataMethods,
        ...tabsLoadedMethods,
        escapeHtml: (s) => String(s ?? ''),
        escapeJsString: (s) => JSON.stringify(s),
        getMetadataTooltipBadge: (help, label) => `<span class="mr-tooltip-badge" data-tooltip="${help}" aria-label="${label}">?</span>`,
        getCategoryDisplayName: (cat) => cat,
        getModelToken: (model) => model.name || '',
        getContextMenuAttrs: () => '',
        stripModelExtension: (name) => String(name || '').replace(/\.[^/.]+$/, ''),
        getMissingModelKey: (model) => model.name || 'key',
        getModelPreviewTooltipAttrs: () => '',
        bindLoadedModelSelection: () => {},
        renderStatusMessage: (msg, type = 'info') => `<div class="mr-status-message ${type}">${msg}</div>`,
        storage: mockStorage,
    };
}

test('image metadata sections default to expanded', () => {
    const ctx = createMockContext();
    assert.strictEqual(ctx.isImageInspectorSectionCollapsed('tools'), false);
    assert.strictEqual(ctx.isImageInspectorSectionCollapsed('summary'), false);
    assert.strictEqual(ctx.isImageInspectorSectionCollapsed('prompt-transfer'), false);
    assert.strictEqual(ctx.isImageInspectorSectionCollapsed('model-transfer'), false);
    assert.strictEqual(ctx.isImageInspectorSectionCollapsed('models'), false);
});

test('toggling section marks it collapsed and persists state', () => {
    const ctx = createMockContext();
    const state = {};
    ctx.toggleImageInspectorSection('prompt-transfer');
    assert.strictEqual(ctx.isImageInspectorSectionCollapsed('prompt-transfer'), true);
    assert.strictEqual(ctx.isImageInspectorSectionCollapsed('model-transfer'), false);

    ctx.toggleImageInspectorSection('prompt-transfer');
    assert.strictEqual(ctx.isImageInspectorSectionCollapsed('prompt-transfer'), false);
});

test('renderMetadataPromptTransferPanel renders collapse button with chevron and aria-expanded', () => {
    const ctx = createMockContext();
    const state = {
        promptTransfer: {
            loading: false,
            applying: false,
            error: '',
            pairs: {},
            prompts: { source: [], target: [] },
        },
    };
    const expandedHtml = ctx.renderMetadataPromptTransferPanel(state);
    assert.ok(expandedHtml.includes('data-image-inspector-collapse="prompt-transfer"'));
    assert.ok(expandedHtml.includes('aria-expanded="true"'));
    assert.ok(!expandedHtml.includes('mr-image-prompt-transfer is-collapsed'));

    ctx.toggleImageInspectorSection('prompt-transfer');
    const collapsedHtml = ctx.renderMetadataPromptTransferPanel(state);
    assert.ok(collapsedHtml.includes('aria-expanded="false"'));
    assert.ok(collapsedHtml.includes('mr-image-prompt-transfer is-collapsed'));
});

test('renderMetadataTransferPanel renders collapse button with chevron and aria-expanded', () => {
    const ctx = createMockContext();
    const state = {
        transfer: {
            loading: false,
            refreshing: false,
            applying: false,
            undoing: false,
            error: '',
            targetGroups: [],
            selectedNodeKeys: new Set(),
        },
    };
    const expandedHtml = ctx.renderMetadataTransferPanel(state);
    assert.ok(expandedHtml.includes('data-image-inspector-collapse="model-transfer"'));
    assert.ok(expandedHtml.includes('aria-expanded="true"'));
    assert.ok(!expandedHtml.includes('mr-image-transfer is-collapsed'));

    ctx.toggleImageInspectorSection('model-transfer');
    const collapsedHtml = ctx.renderMetadataTransferPanel(state);
    assert.ok(collapsedHtml.includes('aria-expanded="false"'));
    assert.ok(collapsedHtml.includes('mr-image-transfer is-collapsed'));
});

test('displayLoadedModels renders collapse button and tooltip badge, hiding subtitle when collapsible', () => {
    const ctx = createMockContext();
    const container = { innerHTML: '', dataset: {} };
    const data = {
        total: 1,
        loaded_models: [
            { name: 'model.safetensors', category: 'checkpoints', active: true }
        ],
    };

    // Non-collapsible (Loaded Models tab) - shows subtitle, no tooltip badge
    ctx.displayLoadedModels(container, data, { collapsible: false });
    assert.ok(!container.innerHTML.includes('data-image-inspector-collapse'));
    assert.ok(container.innerHTML.includes('<h3 class="mr-loaded-models-title">Loaded Models'));
    assert.ok(container.innerHTML.includes('class="mr-loaded-models-subtitle"'));

    // Collapsible (Metadata tab) - shows tooltip badge, hides subtitle paragraph
    ctx.displayLoadedModels(container, data, {
        collapsible: true,
        isCollapsed: false,
        sectionId: 'models',
        title: 'Referenced Models',
        tooltip: 'Models reported by embedded Civitai metadata.',
    });
    assert.ok(container.innerHTML.includes('data-image-inspector-collapse="models"'));
    assert.ok(container.innerHTML.includes('aria-expanded="true"'));
    assert.ok(container.innerHTML.includes('Referenced Models'));
    assert.ok(container.innerHTML.includes('class="mr-tooltip-badge"'));
    assert.ok(container.innerHTML.includes('Models reported by embedded Civitai metadata.'));
    assert.ok(!container.innerHTML.includes('class="mr-loaded-models-subtitle"'));

    // Collapsible and collapsed
    ctx.displayLoadedModels(container, data, {
        collapsible: true,
        isCollapsed: true,
        sectionId: 'models',
        title: 'Referenced Models',
        tooltip: 'Models reported by embedded Civitai metadata.',
    });
    assert.ok(container.innerHTML.includes('data-image-inspector-collapse="models"'));
    assert.ok(container.innerHTML.includes('aria-expanded="false"'));
});

test('renderImageMetadataResult renders Extracted Metadata with tooltip badge and no subtitle paragraph', () => {
    const ctx = createMockContext();
    const resultEl = {
        innerHTML: '',
        querySelector: () => ({ innerHTML: '', dataset: {} }),
    };
    ctx.contentElement = {
        querySelector: (sel) => {
            if (sel === '[data-image-inspector-result]') {
                return resultEl;
            }
            return null;
        },
    };
    ctx.imageInspectorState = {
        metadata: {
            filename: 'test.png',
            image: { width: 512, height: 512, format: 'PNG' },
        },
        loadedModels: null,
        loading: false,
        error: '',
    };
    ctx.renderMetadataPromptTransferPanel = () => '';
    ctx.renderMetadataTransferPanel = () => '';

    ctx.renderImageMetadataResult();
    assert.ok(resultEl.innerHTML.includes('Extracted Metadata'));
    assert.ok(resultEl.innerHTML.includes('data-image-inspector-collapse="summary"'));
    assert.ok(resultEl.innerHTML.includes('Read-only information from the selected source.'));
    assert.ok(resultEl.innerHTML.includes('class="mr-tooltip-badge"'));
    assert.ok(!resultEl.innerHTML.includes('class="mr-loaded-models-subtitle"'));
});

test('renderImageMetadataResult without metadata renders prompt transfer panel first', () => {
    const ctx = createMockContext();
    const resultEl = {
        innerHTML: '',
        querySelector: () => null,
    };
    ctx.contentElement = {
        querySelector: (sel) => (sel === '[data-image-inspector-result]' ? resultEl : null),
    };
    ctx.imageInspectorState = {
        metadata: null,
        loadedModels: null,
        loading: false,
        error: '',
    };
    ctx.renderMetadataPromptTransferPanel = () => '<section class="mr-image-prompt-transfer is-collapsed"></section>';
    ctx.renderMetadataTransferPanel = () => '<section class="mr-image-transfer is-collapsed"></section>';

    ctx.renderImageMetadataResult();
    assert.ok(resultEl.innerHTML.startsWith('<section class="mr-image-prompt-transfer'));
    assert.ok(!resultEl.innerHTML.includes('Extracted Metadata'));
});

function createMockPasteTarget(ctx) {
    const textarea = {
        id: 'mr-image-inspector-json-text',
        classList: { contains: (cls) => cls === 'mr-image-inspector-textarea' },
        value: '',
        dispatchEvent: () => {},
    };
    const root = {
        classList: { contains: () => false },
        contains: (node) => node === root || node === textarea,
        querySelector: (sel) => (sel === '.mr-image-inspector-textarea' ? textarea : null),
        matches: () => false,
    };
    ctx.contentElement = {
        contains: (node) => node === root || node === textarea,
        querySelector: (sel) => (sel === '.mr-image-inspector' ? root : null),
        matches: () => false,
    };
    ctx.activeTab = 'metadata';
    ctx._isMouseOverMetadata = true;
    return { root, textarea };
}

test('handleImageMetadataPaste ignores event when tab is not metadata', () => {
    const ctx = createMockContext();
    createMockPasteTarget(ctx);
    ctx.activeTab = 'loaded';
    let inspected = false;
    ctx.inspectImageFile = () => { inspected = true; };
    const event = {
        preventDefault: () => {},
        stopPropagation: () => {},
        clipboardData: { files: [{ name: 'test.png', type: 'image/png' }] },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), false);
    assert.strictEqual(inspected, false);
});

test('handleImageMetadataPaste ignores event when active element is external input', () => {
    const ctx = createMockContext();
    createMockPasteTarget(ctx);
    const externalInput = { tagName: 'INPUT', isContentEditable: false };
    globalThis.document = { activeElement: externalInput };
    let inspected = false;
    ctx.inspectImageFile = () => { inspected = true; };
    const event = {
        target: externalInput,
        preventDefault: () => {},
        stopPropagation: () => {},
        clipboardData: { files: [{ name: 'test.png', type: 'image/png' }] },
    };
    try {
        assert.strictEqual(ctx.handleImageMetadataPaste(event), false);
        assert.strictEqual(inspected, false);
    } finally {
        delete globalThis.document;
    }
});

test('handleImageMetadataPaste inspects image file from clipboard files', () => {
    const ctx = createMockContext();
    const { root } = createMockPasteTarget(ctx);
    let inspectedFile = null;
    let defaultPrevented = false;
    let propagationStopped = false;
    ctx.inspectImageFile = (file) => { inspectedFile = file; };
    const imageFile = { name: 'workflow_output.png', type: 'image/png', size: 1024 };
    const event = {
        target: root,
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => { propagationStopped = true; },
        clipboardData: { files: [imageFile], items: [] },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), true);
    assert.strictEqual(inspectedFile, imageFile);
    assert.strictEqual(defaultPrevented, true);
    assert.strictEqual(propagationStopped, true);
});

test('handleImageMetadataPaste inspects image file from clipboard items', () => {
    const ctx = createMockContext();
    const { root } = createMockPasteTarget(ctx);
    let inspectedFile = null;
    ctx.inspectImageFile = (file) => { inspectedFile = file; };
    const blobFile = { name: '', type: 'image/webp', size: 2048 };
    const item = { kind: 'file', type: 'image/webp', getAsFile: () => blobFile };
    const event = {
        target: root,
        preventDefault: () => {},
        stopPropagation: () => {},
        clipboardData: { files: [], items: [item] },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), true);
    assert.strictEqual(inspectedFile, blobFile);
});

test('handleImageMetadataPaste inspects workflow JSON file from clipboard', () => {
    const ctx = createMockContext();
    const { root } = createMockPasteTarget(ctx);
    let inspectedWorkflowFile = null;
    ctx.inspectWorkflowFile = (file) => { inspectedWorkflowFile = file; };
    const jsonFile = { name: 'my_workflow.json', type: 'application/json', size: 512 };
    const event = {
        target: root,
        preventDefault: () => {},
        stopPropagation: () => {},
        clipboardData: { files: [jsonFile], items: [] },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), true);
    assert.strictEqual(inspectedWorkflowFile, jsonFile);
});

test('handleImageMetadataPaste inspects workflow JSON text from clipboard', () => {
    const ctx = createMockContext();
    const { root, textarea } = createMockPasteTarget(ctx);
    let inspectedText = null;
    ctx.inspectPastedWorkflow = (text) => { inspectedText = text; };
    const workflowJson = JSON.stringify({ nodes: [{ id: 1, type: 'KSampler' }] });
    const event = {
        target: root,
        preventDefault: () => {},
        stopPropagation: () => {},
        clipboardData: {
            files: [],
            items: [],
            getData: (type) => (type === 'text/plain' ? workflowJson : ''),
        },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), true);
    assert.strictEqual(inspectedText, workflowJson);
    assert.strictEqual(textarea.value, workflowJson);
});

test('handleImageMetadataPaste inspects image data URL from clipboard text', () => {
    const ctx = createMockContext();
    const { root } = createMockPasteTarget(ctx);
    let inspectedPayload = null;
    ctx.runImageMetadataInspection = (payload) => { inspectedPayload = payload; };
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const event = {
        target: root,
        preventDefault: () => {},
        stopPropagation: () => {},
        clipboardData: {
            files: [],
            items: [],
            getData: (type) => (type === 'text/plain' ? dataUrl : ''),
        },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), true);
    assert.strictEqual(inspectedPayload?.source_type, 'image');
    assert.strictEqual(inspectedPayload?.data_url, dataUrl);
});

test('handleImageMetadataPaste allows native paste when pasting non-json text into textarea', () => {
    const ctx = createMockContext();
    const { textarea } = createMockPasteTarget(ctx);
    let defaultPrevented = false;
    const event = {
        target: textarea,
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => {},
        clipboardData: {
            files: [],
            items: [],
            getData: (type) => (type === 'text/plain' ? 'some notes or query' : ''),
        },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), false);
    assert.strictEqual(defaultPrevented, false);
});

test('handleImageMetadataPaste shows warning notification for invalid clipboard data on panel', () => {
    const ctx = createMockContext();
    const { root } = createMockPasteTarget(ctx);
    let notification = null;
    ctx.showNotification = (msg, type) => { notification = { msg, type }; };
    let defaultPrevented = false;
    let propagationStopped = false;
    const event = {
        target: root,
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => { propagationStopped = true; },
        clipboardData: {
            files: [],
            items: [],
            getData: () => 'random string',
        },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), true);
    assert.strictEqual(defaultPrevented, true);
    assert.strictEqual(propagationStopped, true);
    assert.strictEqual(notification?.type, 'warning');
    assert.ok(notification?.msg.includes('image, Civitai link, or valid workflow JSON'));
});

test('extractCivitaiImageId extracts image IDs from URLs, HTML snippets, and image paths', () => {
    assert.strictEqual(extractCivitaiImageId('https://civitai.com/images/145110824'), 145110824);
    assert.strictEqual(extractCivitaiImageId('https://civitai.red/images/145110824'), 145110824);
    assert.strictEqual(extractCivitaiImageId('https://civitai.com/images/145110824?period=AllTime&sort=Most+Reactions'), 145110824);
    assert.strictEqual(extractCivitaiImageId('<a href="/images/145110824" class="mantine-Text-root">link</a>'), 145110824);
    assert.strictEqual(extractCivitaiImageId('<a href="https://civitai.red/images/145110824">photo</a>'), 145110824);
    assert.strictEqual(
        extractCivitaiImageId('<img src="https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/c9945cb9-897b-40aa-a035-71714b1d615e/width=450/145110824.jpeg" />'),
        145110824,
    );
    assert.strictEqual(extractCivitaiImageId('<div data-image-id="145110824"></div>'), 145110824);
    assert.strictEqual(extractCivitaiImageId('https://example.com/foo.png'), null);
    assert.strictEqual(extractCivitaiImageId('just some text'), null);
    assert.strictEqual(extractCivitaiImageId(''), null);
    assert.strictEqual(extractCivitaiImageId(null), null);
});

test('handleImageMetadataPaste inspects Civitai URL from plain text clipboard', () => {
    const ctx = createMockContext();
    const { root, textarea } = createMockPasteTarget(ctx);
    let civitaiImageId = null;
    let civitaiSourceUrl = null;
    ctx.inspectCivitaiImage = (id, url) => {
        civitaiImageId = id;
        civitaiSourceUrl = url;
    };
    let defaultPrevented = false;
    let propagationStopped = false;
    const civitaiUrl = 'https://civitai.red/images/145110824';
    const event = {
        target: root,
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => { propagationStopped = true; },
        clipboardData: {
            files: [],
            items: [],
            getData: (type) => (type === 'text/plain' ? civitaiUrl : ''),
        },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), true);
    assert.strictEqual(defaultPrevented, true);
    assert.strictEqual(propagationStopped, true);
    assert.strictEqual(civitaiImageId, 145110824);
    assert.strictEqual(civitaiSourceUrl, civitaiUrl);
    assert.strictEqual(textarea.value, civitaiUrl);
});

test('handleImageMetadataPaste inspects Civitai image from HTML clipboard', () => {
    const ctx = createMockContext();
    const { root, textarea } = createMockPasteTarget(ctx);
    let civitaiImageId = null;
    let civitaiSourceUrl = null;
    ctx.inspectCivitaiImage = (id, url) => {
        civitaiImageId = id;
        civitaiSourceUrl = url;
    };
    let defaultPrevented = false;
    const htmlSnippet = '<a href="/images/145110824"><img src="https://image.civitai.com/.../145110824.jpeg" /></a>';
    const event = {
        target: root,
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => {},
        clipboardData: {
            files: [],
            items: [],
            getData: (type) => (type === 'text/html' ? htmlSnippet : (type === 'text/plain' ? 'Civitai Image' : '')),
        },
    };
    assert.strictEqual(ctx.handleImageMetadataPaste(event), true);
    assert.strictEqual(defaultPrevented, true);
    assert.strictEqual(civitaiImageId, 145110824);
    assert.ok(civitaiSourceUrl.includes('145110824'));
    assert.ok(textarea.value.includes('145110824'));
});

test('inspectPastedWorkflow delegates to inspectCivitaiImage when input is a Civitai URL', () => {
    const ctx = createMockContext();
    let civitaiImageId = null;
    let civitaiSourceUrl = null;
    ctx.inspectCivitaiImage = (id, url) => {
        civitaiImageId = id;
        civitaiSourceUrl = url;
    };
    const civitaiUrl = 'https://civitai.com/images/145110824';
    ctx.inspectPastedWorkflow(civitaiUrl);
    assert.strictEqual(civitaiImageId, 145110824);
    assert.strictEqual(civitaiSourceUrl, civitaiUrl);
});

test('getMetadataPromptTransferData falls back to civitai_metadata when workflow prompts are empty', () => {
    const ctx = createMockContext();
    const state = {
        workflow: null,
        metadata: {
            civitai_metadata: {
                prompt: 'a cinematic portrait of an astronaut',
                negativePrompt: 'blurry, bad quality',
            },
        },
    };
    const transferData = ctx.getMetadataPromptTransferData(state);
    assert.strictEqual(transferData.sourcePrompts.length, 2);
    assert.strictEqual(transferData.sourcePrompts[0].role, 'positive');
    assert.strictEqual(transferData.sourcePrompts[0].text, 'a cinematic portrait of an astronaut');
    assert.strictEqual(transferData.sourcePrompts[1].role, 'negative');
    assert.strictEqual(transferData.sourcePrompts[1].text, 'blurry, bad quality');
});

test('getMetadataTransferSourceModels includes models with name and category even when original_path is empty', () => {
    const ctx = createMockContext();
    const loadedModels = {
        loaded_models: [
            {
                name: 'SDXL Base 1.0',
                category: 'checkpoints',
                original_path: '',
                source: 'civitai_metadata',
            },
            {
                name: 'Detail Tweaker LoRA',
                category: 'loras',
                original_path: '',
                source: 'civitai_metadata',
            },
            {
                name: '',
                category: 'checkpoints',
                original_path: '',
            },
            {
                name: 'URN model',
                category: 'checkpoints',
                is_urn: true,
                original_path: 'urn:air:sdxl:...',
            },
        ],
    };
    const sourceEntries = ctx.getMetadataTransferSourceModels(loadedModels);
    assert.strictEqual(sourceEntries.length, 2);
    assert.strictEqual(sourceEntries[0].model.name, 'SDXL Base 1.0');
    assert.strictEqual(sourceEntries[1].model.name, 'Detail Tweaker LoRA');
});

test('getMetadataTransferModelLabel appends friendly model name in brackets when available', () => {
    const ctx = createMockContext();
    const modelWithFriendly = {
        name: 'Cinematic_Krea2_krea2_3283603_epoch_10.safetensors',
        original_path: 'Cinematic_Krea2_krea2_3283603_epoch_10.safetensors',
        model_name: 'Cinematic Krea2',
    };
    const label = ctx.getMetadataTransferModelLabel(modelWithFriendly);
    assert.strictEqual(label, 'Cinematic_Krea2_krea2_3283603_epoch_10 (Cinematic Krea2)');

    const modelSameName = {
        name: 'Cinematic Krea2.safetensors',
        original_path: 'Cinematic Krea2.safetensors',
        model_name: 'Cinematic Krea2',
    };
    assert.strictEqual(ctx.getMetadataTransferModelLabel(modelSameName), 'Cinematic Krea2');
});




