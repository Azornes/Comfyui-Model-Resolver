import test from 'node:test';
import assert from 'node:assert/strict';
import { imageMetadataMethods } from '../web/resolver/views/tabs_image_metadata_methods.js';
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

