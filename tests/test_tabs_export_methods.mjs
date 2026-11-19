import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { escapeHtml, safeStorage } from '../web/resolver/utils/html_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exportMethodsFile = path.resolve(__dirname, '../web/resolver/views/tabs_export_methods.js');
const workflowStateMethodsFile = path.resolve(__dirname, '../web/resolver/shell/workflow_state_methods.js');

// Load tabsExportMethods with mocked app and api
const exportSource = fs.readFileSync(exportMethodsFile, 'utf8')
    .replace(/import\s+\{\s*escapeHtml,\s*safeStorage\s*\}\s+from\s+["'][^"']+["'];?/, '')
    .replace(/import\s+\{\s*app\s*\}\s+from\s+["'][^"']+["'];?/, 'const app = globalThis.__mockApp || {};')
    .replace(/import\s+\{\s*api\s*\}\s+from\s+["'][^"']+["'];?/, 'const api = globalThis.__mockApi || {};')
    .replace(/export\s+const\s+tabsExportMethods\s*=/, 'const tabsExportMethods =');

const moduleFn = new Function('escapeHtml', 'safeStorage', `${exportSource}; return tabsExportMethods;`);
const tabsExportMethods = moduleFn(escapeHtml, safeStorage);

// Load workflowStateMethods with mocked app and log
const workflowStateSource = fs.readFileSync(workflowStateMethodsFile, 'utf8')
    .replace(/import\s+\{\s*app\s*\}\s+from\s+["'][^"']+["'];?/, 'const app = globalThis.__mockApp || {};')
    .replace(/import\s+\{\s*createModuleLogger\s*\}\s+from\s+["'][^"']+["'];?/, 'const createModuleLogger = () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });')
    .replace(/export\s+const\s+workflowStateMethods\s*=/, 'const workflowStateMethods =');

const wfModuleFn = new Function(`${workflowStateSource}; return workflowStateMethods;`);
const workflowStateMethods = wfModuleFn();

function setupDom() {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    return window;
}

test('formatExportFilename handles short and long filenames', () => {
    const short = tabsExportMethods.formatExportFilename('sub/folder/model.safetensors');
    assert.equal(short.display, 'sub/folder/model.safetensors');
    assert.equal(short.full, 'sub/folder/model.safetensors');

    const long = tabsExportMethods.formatExportFilename('very/deeply/nested/path/to/some/excessively_long_model_name_that_exceeds_sixty_characters_in_total.safetensors', 40);
    assert.ok(long.display.startsWith('...') || long.display.endsWith('...'));
    assert.equal(long.full, 'very/deeply/nested/path/to/some/excessively_long_model_name_that_exceeds_sixty_characters_in_total.safetensors');
});

test('workflowStateMethods.getWorkflowKey generates a key for a workflow', () => {
    const ctx = {
        ...workflowStateMethods,
        activeWorkflowRouteKey: 'route-1',
        activeWorkflowSignature: 'sig-default',
        getActiveWorkflowRouteKey() {
            return 'route-1';
        },
        getWorkflowSignature(wf) {
            return JSON.stringify(wf);
        }
    };

    const key = ctx.getWorkflowKey({ test: 123 });
    assert.equal(key, 'route-1\n{"test":123}');

    const fallbackKey = ctx.getWorkflowKey(null);
    assert.equal(fallbackKey, 'route-1\nsig-default');
});

test('loadExportTab handles missing workflow gracefully', async () => {
    setupDom();
    const content = document.createElement('div');
    const dialog = {
        ...tabsExportMethods,
        contentElement: content,
        getCurrentWorkflow: () => null,
    };

    await dialog.loadExportTab(null);
    assert.ok(content.innerHTML.includes('No workflow loaded'));
});

test('loadExportTab loads from cached loaded models without getWorkflowKey error', async () => {
    setupDom();
    const content = document.createElement('div');
    const workflow = { nodes: [{ id: 1 }] };

    const dialog = {
        ...tabsExportMethods,
        ...workflowStateMethods,
        contentElement: content,
        activeTab: 'export',
        activeWorkflowRouteKey: 'main-route',
        activeWorkflowSignature: 'sig-test',
        getCurrentWorkflow: () => workflow,
        getWorkflowSignature: () => 'sig-test',
        getActiveWorkflowRouteKey: () => 'main-route',
        missingModels: [
            { original_path: 'missing_model.safetensors', category: 'checkpoints' }
        ],
        workflowLoadedModelCaches: new Map([
            ['main-route\nsig-test', {
                signature: 'sig-test',
                data: {
                    loaded_models: [
                        {
                            name: 'loaded_lora.safetensors',
                            original_path: 'loaded_lora.safetensors',
                            category: 'loras',
                            resolved_path: 'E:/models/loras/loaded_lora.safetensors'
                        }
                    ],
                    total: 1
                }
            }]
        ]),
        fetchJson: async () => ({ links: [] }),
    };

    await dialog.loadExportTab(workflow);

    assert.ok(content.querySelector('.mr-export-list'), 'Should render export list');
    const names = Array.from(content.querySelectorAll('.mr-export-name')).map(el => el.textContent);
    assert.ok(names.includes('missing_model.safetensors'), 'Includes missing model');
    assert.ok(names.includes('loaded_lora.safetensors'), 'Includes loaded model from cache');

    const hashButtons = content.querySelectorAll('[data-export-hash]');
    assert.equal(hashButtons.length, 1, 'Only model with resolved/full path gets Find by hash button');
});

test('loadExportTab fetches /model_resolver/loaded when cache is empty', async () => {
    setupDom();
    const content = document.createElement('div');
    const workflow = { nodes: [{ id: 2 }] };

    let fetchedEndpoint = null;
    const dialog = {
        ...tabsExportMethods,
        ...workflowStateMethods,
        contentElement: content,
        activeTab: 'export',
        activeWorkflowRouteKey: 'main-route',
        activeWorkflowSignature: 'sig-2',
        getCurrentWorkflow: () => workflow,
        getWorkflowSignature: () => 'sig-2',
        getActiveWorkflowRouteKey: () => 'main-route',
        missingModels: [],
        workflowLoadedModelCaches: new Map(),
        cachedLoadedModelsData: null,
        fetchJson: async (endpoint) => {
            fetchedEndpoint = endpoint;
            if (endpoint === '/model_resolver/loaded') {
                return {
                    loaded_models: [
                        {
                            original_path: 'auto_scanned.safetensors',
                            category: 'diffusion_models',
                            resolved_path: 'E:/models/diffusion_models/auto_scanned.safetensors'
                        }
                    ],
                    total: 1
                };
            }
            if (endpoint === '/model_resolver/export/lookup') {
                return {
                    links: [
                        { url: 'https://huggingface.co/example/model', source: 'huggingface' }
                    ]
                };
            }
            return {};
        },
    };

    await dialog.loadExportTab(workflow);

    assert.ok(fetchedEndpoint, 'Should have called fetchJson');
    assert.equal(dialog.cachedLoadedModelsData?.total, 1, 'Caches fetched loaded models');
    const names = Array.from(content.querySelectorAll('.mr-export-name')).map(el => el.textContent);
    assert.ok(names.includes('auto_scanned.safetensors'), 'Renders auto-scanned loaded model');
});
