import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

import {
    initLoadedModelSelection,
    updateLoadedModelSelectionState,
    getVisibleModelChips,
    getSelectedModelChips,
    getSelectedModelTokens,
    clearLoadedModelSelection,
} from '../web/resolver/utils/loaded_model_selection.js';
import {
    groupLoadedModelsByCategory,
    buildLoadedModelTokenStrings,
} from '../web/resolver/utils/loaded_model_utils.js';

const getSvgIcon = () => '<svg></svg>';
void groupLoadedModelsByCategory;
void buildLoadedModelTokenStrings;
void getSvgIcon;

function setupDomEnvironment() {
    const window = new Window();
    const document = window.document;
    globalThis.window = window;
    globalThis.document = document;
    try {
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            writable: true,
            value: window.navigator,
        });
    } catch {
        // Fallback for environments where navigator cannot be redefined
    }

    window.MLSetCopyMode = function(sectionId, mode) {
        const section = document.getElementById(sectionId);
        if (!section) return;
        const normalizedMode = ['all', 'active', 'inactive', 'selected'].includes(mode) ? mode : 'all';
        if (normalizedMode !== 'selected') {
            section.dataset.mlPreviousMode = normalizedMode;
        }
        const codeEl = section.querySelector('.mr-copy-code');
        const labelEl = section.querySelector('.mr-copy-label');
        const metaEl = section.querySelector('.mr-copy-meta');
        const dataKey = normalizedMode === 'all'
            ? 'mlAll'
            : normalizedMode === 'active'
                ? 'mlActive'
                : normalizedMode === 'inactive'
                    ? 'mlInactive'
                    : 'mlSelected';
        const countKey = normalizedMode === 'all'
            ? 'mlAllCount'
            : normalizedMode === 'active'
                ? 'mlActiveCount'
                : normalizedMode === 'inactive'
                    ? 'mlInactiveCount'
                    : 'mlSelectedCount';
        const labelMap = {
            all: 'Copy all',
            active: 'Copy active',
            inactive: 'Copy inactive',
            selected: 'Copy selected'
        };

        if (codeEl) codeEl.textContent = section.dataset[dataKey] || '';
        if (labelEl) labelEl.textContent = labelMap[normalizedMode];
        if (metaEl) {
            const count = Number(section.dataset[countKey] || 0);
            metaEl.textContent = `${count} token${count === 1 ? '' : 's'}`;
        }

        section.querySelectorAll('.mr-copy-mode').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mlCopyMode === normalizedMode);
        });
    };

    window.MLSetCopyButtonFeedback = function(btn, text) {
        if (!btn) return;
        btn.textContent = text;
    };

    return { window, document };
}

function createLoadedModelsMarkup(copySectionId = 'mr-copy-test') {
    return `
        <div class="mr-loaded-models-header">
            <h3 class="mr-loaded-models-title">Loaded Models</h3>
        </div>
        <div class="mr-models-list">
            <div class="mr-model-section" data-ml-category="checkpoints">
                <div class="mr-model-group mr-model-group-active">
                    <div class="mr-model-chip-list">
                        <span class="mr-model-chip" data-ml-token="<checkpoint:base_model:1.00>" data-ml-loaded-model-key="key-ckpt-1">base_model</span>
                    </div>
                </div>
            </div>
            <div class="mr-model-section" data-ml-category="loras">
                <div class="mr-model-group mr-model-group-active">
                    <div class="mr-model-chip-list">
                        <span class="mr-model-chip" data-ml-token="<lora:lora_a:0.80>" data-ml-loaded-model-key="key-lora-1">lora_a<span class="mr-model-chip-strength">0.80</span></span>
                        <span class="mr-model-chip" data-ml-token="<lora:lora_b:1.00>" data-ml-loaded-model-key="key-lora-2">lora_b<span class="mr-model-chip-strength">1.00</span></span>
                        <span class="mr-model-chip" data-ml-token="<lora:lora_c:0.50>" data-ml-loaded-model-key="key-lora-3">lora_c<span class="mr-model-chip-strength">0.50</span></span>
                    </div>
                </div>
                <div class="mr-model-group mr-model-group-inactive">
                    <div class="mr-model-chip-list mr-model-chip-list-inactive">
                        <span class="mr-model-chip" data-ml-token="<lora:lora_d:1.00>" data-ml-loaded-model-key="key-lora-4">lora_d<span class="mr-model-chip-strength">1.00</span></span>
                    </div>
                </div>
            </div>
        </div>
        <div id="${copySectionId}" class="mr-copy-section" data-ml-active="<checkpoint:base_model:1.00> <lora:lora_a:0.80> <lora:lora_b:1.00> <lora:lora_c:0.50>" data-ml-inactive="<lora:lora_d:1.00>" data-ml-all="<checkpoint:base_model:1.00> <lora:lora_a:0.80> <lora:lora_b:1.00> <lora:lora_c:0.50> <lora:lora_d:1.00>" data-ml-selected="" data-ml-active-count="4" data-ml-inactive-count="1" data-ml-all-count="5" data-ml-selected-count="0" data-ml-previous-mode="all">
            <div class="mr-copy-toolbar">
                <div class="mr-copy-heading">
                    <div class="mr-copy-label" id="${copySectionId}-label">Copy all</div>
                    <div class="mr-copy-meta" id="${copySectionId}-meta">5 tokens</div>
                </div>
                <div class="mr-copy-actions">
                    <button type="button" class="mr-btn-filter mr-copy-mode active" data-ml-copy-mode="all" onclick="window.MLSetCopyMode('${copySectionId}', 'all', this)">All</button>
                    <button type="button" class="mr-btn-filter mr-copy-mode" data-ml-copy-mode="active" onclick="window.MLSetCopyMode('${copySectionId}', 'active', this)">Active</button>
                    <button type="button" class="mr-btn-filter mr-copy-mode" data-ml-copy-mode="inactive" onclick="window.MLSetCopyMode('${copySectionId}', 'inactive', this)">Inactive</button>
                    <button type="button" class="mr-btn-filter mr-copy-mode mr-copy-mode-selected" data-ml-copy-mode="selected" style="display: none;" onclick="window.MLSetCopyMode('${copySectionId}', 'selected', this)">Selected (<span class="mr-copy-selected-count">0</span>)</button>
                    <button class="mr-btn-filter mr-copy-main-btn" onclick="window.MLCopyCode('${copySectionId}', this)">Copy</button>
                </div>
            </div>
            <code class="mr-copy-code" id="${copySectionId}-code"><checkpoint:base_model:1.00> <lora:lora_a:0.80> <lora:lora_b:1.00> <lora:lora_c:0.50> <lora:lora_d:1.00></code>
        </div>
    `;
}

test('single click selects only clicked chip and switches copy toolbar to selected mode', () => {
    const { document } = setupDomEnvironment();
    const container = document.createElement('div');
    container.innerHTML = createLoadedModelsMarkup();
    document.body.appendChild(container);

    const cleanup = initLoadedModelSelection(container);

    const chips = container.querySelectorAll('.mr-model-chip');
    chips[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    assert.equal(chips[1].classList.contains('is-selected'), true);
    assert.equal(chips[0].classList.contains('is-selected'), false);
    assert.equal(chips[2].classList.contains('is-selected'), false);

    const copySection = container.querySelector('.mr-copy-section');
    assert.equal(copySection.dataset.mlSelected, '<lora:lora_a:0.80>');
    assert.equal(copySection.dataset.mlSelectedCount, '1');

    const selectedBtn = copySection.querySelector('.mr-copy-mode-selected');
    assert.equal(selectedBtn.style.display, '');
    assert.equal(selectedBtn.classList.contains('active'), true);

    const codeEl = copySection.querySelector('.mr-copy-code');
    assert.equal(codeEl.textContent, '<lora:lora_a:0.80>');

    cleanup();
});

test('ctrl+click adds and toggles chips in multi-selection', () => {
    const { document } = setupDomEnvironment();
    const container = document.createElement('div');
    container.innerHTML = createLoadedModelsMarkup();
    document.body.appendChild(container);

    const cleanup = initLoadedModelSelection(container);
    const chips = container.querySelectorAll('.mr-model-chip');

    // Select first chip with regular click
    chips[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(getSelectedModelTokens(container), ['<checkpoint:base_model:1.00>']);

    // Ctrl+click second chip
    chips[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert.deepEqual(getSelectedModelTokens(container), [
        '<checkpoint:base_model:1.00>',
        '<lora:lora_b:1.00>',
    ]);

    const copySection = container.querySelector('.mr-copy-section');
    assert.equal(copySection.dataset.mlSelected, '<checkpoint:base_model:1.00> <lora:lora_b:1.00>');
    assert.equal(copySection.dataset.mlSelectedCount, '2');

    // Ctrl+click to toggle off the first chip
    chips[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert.deepEqual(getSelectedModelTokens(container), ['<lora:lora_b:1.00>']);
    assert.equal(copySection.dataset.mlSelected, '<lora:lora_b:1.00>');

    cleanup();
});

test('shift+click performs range selection from previous anchor', () => {
    const { document } = setupDomEnvironment();
    const container = document.createElement('div');
    container.innerHTML = createLoadedModelsMarkup();
    document.body.appendChild(container);

    const cleanup = initLoadedModelSelection(container);
    const chips = container.querySelectorAll('.mr-model-chip');

    // Click on index 1 (lora_a) as anchor
    chips[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(getSelectedModelTokens(container), ['<lora:lora_a:0.80>']);

    // Shift+click on index 3 (lora_c) -> range 1..3 selected
    chips[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
    assert.deepEqual(getSelectedModelTokens(container), [
        '<lora:lora_a:0.80>',
        '<lora:lora_b:1.00>',
        '<lora:lora_c:0.50>',
    ]);

    // Shift+click again on index 2 (lora_b) from same anchor -> range 1..2 selected
    chips[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
    assert.deepEqual(getSelectedModelTokens(container), [
        '<lora:lora_a:0.80>',
        '<lora:lora_b:1.00>',
    ]);

    cleanup();
});

test('ctrl+shift+click expands existing selection with range', () => {
    const { document } = setupDomEnvironment();
    const container = document.createElement('div');
    container.innerHTML = createLoadedModelsMarkup();
    document.body.appendChild(container);

    const cleanup = initLoadedModelSelection(container);
    const chips = container.querySelectorAll('.mr-model-chip');

    // Select index 0 (checkpoint)
    chips[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // Click index 2 as anchor with Ctrl
    chips[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert.deepEqual(getSelectedModelTokens(container), [
        '<checkpoint:base_model:1.00>',
        '<lora:lora_b:1.00>',
    ]);

    // Ctrl+Shift+click index 4 (inactive lora_d) -> adds 2..4 to selection without removing index 0
    chips[4].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true, shiftKey: true }));
    assert.deepEqual(getSelectedModelTokens(container), [
        '<checkpoint:base_model:1.00>',
        '<lora:lora_b:1.00>',
        '<lora:lora_c:0.50>',
        '<lora:lora_d:1.00>',
    ]);

    cleanup();
});

test('clicking blank area deselects all chips and reverts copy mode', () => {
    const { document } = setupDomEnvironment();
    const container = document.createElement('div');
    container.innerHTML = createLoadedModelsMarkup();
    document.body.appendChild(container);

    const cleanup = initLoadedModelSelection(container);
    const chips = container.querySelectorAll('.mr-model-chip');

    // Select a chip
    chips[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(getSelectedModelChips(container).length, 1);

    // Click on empty list space
    const list = container.querySelector('.mr-models-list');
    list.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    assert.equal(getSelectedModelChips(container).length, 0);
    const copySection = container.querySelector('.mr-copy-section');
    assert.equal(copySection.dataset.mlSelectedCount, '0');
    assert.equal(copySection.querySelector('.mr-copy-mode-selected').style.display, 'none');

    // Reverted back to 'all'
    const activeModeBtn = copySection.querySelector('.mr-copy-mode.active');
    assert.equal(activeModeBtn.dataset.mlCopyMode, 'all');

    cleanup();
});

test('escape key clears selection', () => {
    const { document } = setupDomEnvironment();
    const container = document.createElement('div');
    container.innerHTML = createLoadedModelsMarkup();
    document.body.appendChild(container);

    const cleanup = initLoadedModelSelection(container);
    const chips = container.querySelectorAll('.mr-model-chip');

    chips[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(getSelectedModelChips(container).length, 1);

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(getSelectedModelChips(container).length, 0);

    cleanup();
});

test('ctrl+a selects all visible chips', () => {
    const { document } = setupDomEnvironment();
    const container = document.createElement('div');
    container.innerHTML = createLoadedModelsMarkup();
    document.body.appendChild(container);

    const cleanup = initLoadedModelSelection(container);
    const chips = container.querySelectorAll('.mr-model-chip');

    // Make inactive section hidden like MLFilterSwitch('active') does
    const inactiveGroup = container.querySelector('.mr-model-group-inactive');
    inactiveGroup.style.display = 'none';

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));

    const selected = getSelectedModelChips(container);
    assert.equal(selected.length, 4); // Only the 4 visible active chips
    assert.equal(chips[4].classList.contains('is-selected'), false);

    cleanup();
});

test('ctrl+c writes selected tokens to clipboard with feedback', async () => {
    const { document } = setupDomEnvironment();
    const container = document.createElement('div');
    container.innerHTML = createLoadedModelsMarkup();
    document.body.appendChild(container);

    let writtenText = '';
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: {
            clipboard: {
                writeText: async (text) => {
                    writtenText = text;
                }
            }
        }
    });

    const notifications = [];
    const dialog = {
        activeTab: 'loaded',
        showNotification: (msg, type) => notifications.push({ msg, type })
    };

    const cleanup = initLoadedModelSelection(container, dialog);
    const chips = container.querySelectorAll('.mr-model-chip');

    // Select two chips
    chips[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    chips[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));

    // Press Ctrl+C
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(writtenText, '<lora:lora_a:0.80> <lora:lora_b:1.00>');
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].msg, /Copied 2 model tokens to clipboard/);

    cleanup();
});

test('displayLoadedModels renders chips with data-ml-token and includes Selected mode button', () => {
    const { document } = setupDomEnvironment();
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const source = fs.readFileSync(path.join(__dirname, '../web/resolver/views/tabs_loaded_methods.js'), 'utf-8');

    function extractMethod(sourceCode, methodName) {
        const regex = new RegExp(`\\n\\s+${methodName}\\s*\\(([^)]*\\{[^}]*\\}|[^)]*)\\)\\s*\\{`);
        const match = regex.exec(sourceCode);
        assert.ok(match, `Could not find ${methodName}`);
        const params = match[1];
        const braceStart = match.index + match[0].length - 1;
        let depth = 0;
        for (let i = braceStart; i < sourceCode.length; i += 1) {
            if (sourceCode[i] === '{') depth += 1;
            if (sourceCode[i] === '}') depth -= 1;
            if (depth === 0) {
                return `function ${methodName}(${params}) ${sourceCode.slice(braceStart, i + 1)}`;
            }
        }
        throw new Error(`Unmatched braces for ${methodName}`);
    }

    const displayLoadedModels = eval(`(${extractMethod(source, 'displayLoadedModels')})`);
    const container = document.createElement('div');
    document.body.appendChild(container);

    const dialog = {
        getModelNameAndStrength: model => ({
            name: model.name,
            strength: model.strength !== null && model.strength !== undefined ? model.strength.toFixed(2) : null
        }),
        getFilenameFromPath: pathVal => pathVal,
        stripModelExtension: name => name,
        getCategoryTokenName: cat => cat.replace(/s$/, ''),
        getModelToken: (model, cat) => {
            const str = model.strength !== null && model.strength !== undefined ? model.strength.toFixed(2) : '1.00';
            return `<${cat.replace(/s$/, '')}:${model.name}:${str}>`;
        },
        getLoadedModelDomKey: model => model.name,
        getLoadedModelContext: model => model,
        getContextMenuAttrs: () => '',
        getModelPreviewTooltipAttrs: () => '',
        getCategoryDisplayName: cat => cat,
        escapeHtml: str => String(str),
        escapeJsString: str => JSON.stringify(str),
        bindLoadedModelSelection: () => {}
    };

    displayLoadedModels.call(dialog, container, {
        loaded_models: [
            { category: 'checkpoints', name: 'model_1', active: true, connected: true },
            { category: 'loras', name: 'lora_1', strength: 0.8, active: true, connected: true },
            { category: 'loras', name: 'lora_2', strength: 1.0, active: false, connected: true },
        ],
        total: 3
    });

    const chips = container.querySelectorAll('.mr-model-chip');
    assert.equal(chips.length, 3);
    assert.equal(chips[0].getAttribute('data-ml-token'), '<checkpoint:model_1:1.00>');
    assert.equal(chips[1].getAttribute('data-ml-token'), '<lora:lora_1:0.80>');
    assert.equal(chips[2].getAttribute('data-ml-token'), '<lora:lora_2:1.00>');

    const selectedBtn = container.querySelector('.mr-copy-mode-selected');
    assert.ok(selectedBtn, 'Selected mode button should be present in DOM');
    assert.equal(selectedBtn.getAttribute('data-ml-copy-mode'), 'selected');
});

test('ctrl+click works reliably in metadata tab even when loaded tab was previously bound', () => {
    const { document } = setupDomEnvironment();
    const contentElement = document.createElement('div');
    contentElement.id = 'mr-content-element';
    document.body.appendChild(contentElement);

    const dialog = {
        activeTab: 'loaded',
        contentElement,
        _mlSelectionCleanup: null,
        bindLoadedModelSelection(container) {
            if (typeof this._mlSelectionCleanup === 'function') {
                this._mlSelectionCleanup();
                this._mlSelectionCleanup = null;
            }
            const cleanup = initLoadedModelSelection(container, this);
            this._mlSelectionCleanup = cleanup;
            return cleanup;
        }
    };

    // 1. User was first on "Loaded Models" tab
    contentElement.innerHTML = createLoadedModelsMarkup('mr-copy-loaded');
    dialog.bindLoadedModelSelection(contentElement);

    // 2. User switches to "Metadata" tab
    dialog.activeTab = 'metadata';
    const metadataShell = document.createElement('div');
    metadataShell.className = 'mr-image-inspector';
    const metadataResult = document.createElement('div');
    metadataResult.setAttribute('data-image-inspector-result', '');
    const modelContainer = document.createElement('div');
    modelContainer.id = 'mr-image-inspector-models-12345';
    modelContainer.innerHTML = createLoadedModelsMarkup('mr-copy-metadata');
    metadataResult.appendChild(modelContainer);
    metadataShell.appendChild(metadataResult);
    contentElement.appendChild(metadataShell);

    dialog.bindLoadedModelSelection(modelContainer);

    // 3. User Ctrl+clicks chips in Metadata tab
    const metaChips = modelContainer.querySelectorAll('.mr-model-chip');
    assert.equal(metaChips.length, 5);

    // Ctrl+click first chip
    metaChips[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert.equal(metaChips[0].classList.contains('is-selected'), true, 'First chip must remain selected after Ctrl+click in metadata tab');
    assert.deepEqual(getSelectedModelTokens(modelContainer), ['<checkpoint:base_model:1.00>']);

    // Ctrl+click second chip
    metaChips[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert.equal(metaChips[1].classList.contains('is-selected'), true, 'Second chip must remain selected after Ctrl+click');
    assert.deepEqual(getSelectedModelTokens(modelContainer), [
        '<checkpoint:base_model:1.00>',
        '<lora:lora_a:0.80>'
    ]);

    // Ctrl+click first chip again to toggle it off
    metaChips[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert.equal(metaChips[0].classList.contains('is-selected'), false, 'First chip must be toggled off');
    assert.deepEqual(getSelectedModelTokens(modelContainer), ['<lora:lora_a:0.80>']);

    const copySection = modelContainer.querySelector('.mr-copy-section');
    assert.equal(copySection.dataset.mlSelected, '<lora:lora_a:0.80>');
    assert.equal(copySection.dataset.mlSelectedCount, '1');

    dialog._mlSelectionCleanup?.();
});

test('chip click event propagation is stopped to prevent parent container interference', () => {
    const { document } = setupDomEnvironment();
    const parentContainer = document.createElement('div');
    const childContainer = document.createElement('div');
    childContainer.innerHTML = createLoadedModelsMarkup('mr-copy-nested');
    parentContainer.appendChild(childContainer);
    document.body.appendChild(parentContainer);

    let parentClickFired = false;
    parentContainer.addEventListener('click', () => {
        parentClickFired = true;
    });

    const cleanup = initLoadedModelSelection(childContainer);
    const chip = childContainer.querySelector('.mr-model-chip');
    chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));

    assert.equal(chip.classList.contains('is-selected'), true);
    assert.equal(parentClickFired, false, 'Parent container should not receive click event due to stopPropagation');

    cleanup();
});

