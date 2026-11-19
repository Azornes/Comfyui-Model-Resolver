import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeModelPath,
    makeModelEntry,
    buildModelTree,
    countTreeModels,
    getLocalModelIdentity,
    renderLocalModelTreeBrowser
} from '../web/resolver/utils/local_model_tree_utils.js';

test('normalizeModelPath handles Windows backslashes and redundant slashes', () => {
    assert.equal(normalizeModelPath('loras\\subfolder\\model.safetensors'), 'loras/subfolder/model.safetensors');
    assert.equal(normalizeModelPath('  checkpoints///sub/model.ckpt  '), 'checkpoints/sub/model.ckpt');
    assert.equal(normalizeModelPath(''), '');
});

test('makeModelEntry extracts filename, folderPath, and search text', () => {
    const raw = {
        name: 'model.safetensors',
        relative_path: 'Anima\\model.safetensors',
        path: 'E:\\models\\loras\\Anima\\model.safetensors',
        category: 'loras',
        base_directory: 'E:\\models\\loras'
    };
    const entry = makeModelEntry(raw, 0, 'loras');
    assert.equal(entry.filename, 'model.safetensors');
    assert.equal(entry.folderPath, 'Anima');
    assert.equal(entry.category, 'loras');
    assert.equal(entry.isPreferred, true);
    assert.ok(entry.searchText.includes('anima'));
    assert.ok(entry.searchText.includes('model.safetensors'));
});

test('buildModelTree and countTreeModels create correct nested hierarchy', () => {
    const entries = [
        { folderPath: '', filename: 'root_model.safetensors' },
        { folderPath: 'Anima', filename: 'anima_1.safetensors' },
        { folderPath: 'Anima', filename: 'anima_2.safetensors' },
        { folderPath: 'Anima/V2', filename: 'anima_v2.safetensors' },
        { folderPath: 'SDXL', filename: 'sdxl.safetensors' },
    ];
    const tree = buildModelTree(entries);

    assert.equal(tree.models.length, 1);
    assert.equal(tree.models[0].filename, 'root_model.safetensors');
    assert.ok(tree.folders.has('Anima'));
    assert.ok(tree.folders.has('SDXL'));

    const animaNode = tree.folders.get('Anima');
    assert.equal(animaNode.models.length, 2);
    assert.ok(animaNode.folders.has('V2'));
    assert.equal(animaNode.folders.get('V2').models.length, 1);

    // Total models under Anima should be 2 + 1 = 3
    assert.equal(countTreeModels(animaNode), 3);
    // Total models in the entire tree should be 5
    assert.equal(countTreeModels(tree), 5);
});

test('renderLocalModelTreeBrowser generates tree HTML matching Missing Models folder browser', () => {
    const allModels = [
        {
            filename: 'root_lora.safetensors',
            relative_path: 'root_lora.safetensors',
            path: 'E:\\models\\loras\\root_lora.safetensors',
            category: 'loras',
            base_directory: 'E:\\models\\loras'
        },
        {
            filename: 'anima_one.safetensors',
            relative_path: 'Anima/anima_one.safetensors',
            path: 'E:\\models\\loras\\Anima\\anima_one.safetensors',
            category: 'loras',
            base_directory: 'E:\\models\\loras'
        },
        {
            filename: 'anima_two.safetensors',
            relative_path: 'Anima/anima_two.safetensors',
            path: 'E:\\models\\loras\\Anima\\anima_two.safetensors',
            category: 'loras',
            base_directory: 'E:\\models\\loras'
        },
        {
            filename: 'v1-5-pruned.safetensors',
            relative_path: 'v1-5-pruned.safetensors',
            path: 'E:\\models\\checkpoints\\v1-5-pruned.safetensors',
            category: 'checkpoints',
            base_directory: 'E:\\models\\checkpoints'
        }
    ];

    const selectedIdentity = getLocalModelIdentity(allModels[0]);
    // Expand Anima subfolder so its nested rows are rendered
    const expandedSet = new Set(['node:loras::e:\\models\\loras:anima']);

    const { html } = renderLocalModelTreeBrowser({
        allModels,
        preferredCategory: 'loras',
        filterText: '',
        expandedSet,
        selectedIdentity,
        helpers: {
            currentModelName: 'root_lora.safetensors',
            currentModelPath: 'E:\\models\\loras\\root_lora.safetensors',
            getCategoryDisplayName: (c) => c
        }
    });

    // Preferred category should be marked with .is-preferred and · recommended
    assert.ok(html.includes('mr-folder-browser-root is-preferred'), 'Preferred root should have is-preferred class');
    assert.ok(html.includes('loras · recommended'), 'Preferred root header should have recommended label');

    // Should contain folder browser classes
    assert.ok(html.includes('mr-local-model-browser-scroll'), 'Should include scroll container');
    assert.ok(html.includes('mr-folder-browser-root-head'), 'Should include root heads');
    assert.ok(html.includes('mr-folder-browser-node'), 'Should include tree nodes');
    assert.ok(html.includes('Anima'), 'Should include Anima folder name');

    // Model row classes
    assert.ok(html.includes('mr-local-model-row'), 'Should include model rows');
    assert.ok(html.includes('anima_one.safetensors'), 'Should include model filename');

    // Selection class
    assert.ok(html.includes('is-selected'), 'Selected model row should have is-selected');

    // Current model tag
    assert.ok(html.includes('mr-swap-current-badge'), 'Current active model should have Current badge');
});

test('renderLocalModelTreeBrowser auto-expands on search filter match', () => {
    const allModels = [
        {
            filename: 'deep_model.safetensors',
            relative_path: 'Deep/Folder/deep_model.safetensors',
            path: 'E:\\models\\loras\\Deep\\Folder\\deep_model.safetensors',
            category: 'loras',
            base_directory: 'E:\\models\\loras'
        },
        {
            filename: 'other.safetensors',
            relative_path: 'Other/other.safetensors',
            path: 'E:\\models\\loras\\Other\\other.safetensors',
            category: 'loras',
            base_directory: 'E:\\models\\loras'
        }
    ];

    const { html, filteredEntries } = renderLocalModelTreeBrowser({
        allModels,
        preferredCategory: 'loras',
        filterText: 'deep',
        expandedSet: new Set(),
        helpers: {
            getCategoryDisplayName: (c) => c
        }
    });

    assert.equal(filteredEntries.length, 1);
    assert.equal(filteredEntries[0].filename, 'deep_model.safetensors');
    // Folders with matches should have is-expanded in class list
    assert.ok(html.includes('mr-folder-browser-children is-expanded'), 'Matching branch should be auto-expanded');
    assert.ok(!html.includes('other.safetensors'), 'Non-matching models should be filtered out');
});
