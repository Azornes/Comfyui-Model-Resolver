import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const domWindow = new Window();
globalThis.window = domWindow;
globalThis.document = domWindow.document;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const {
    isGgufModel,
    calculateCanvasCenterPosition,
    assignModelPathToNode,
    addModelLoaderToCanvas,
} = await import('../web/resolver/utils/canvas_node_utils.js');

test('isGgufModel identifies GGUF files', () => {
    assert.equal(isGgufModel('flux1-dev-Q4_K_M.gguf'), true);
    assert.equal(isGgufModel('path/to/model.GGUF '), true);
    assert.equal(isGgufModel('model.safetensors'), false);
    assert.equal(isGgufModel(''), false);
    assert.equal(isGgufModel(null), false);
});

test('calculateCanvasCenterPosition calculates center coordinates', () => {
    const mockCanvas = {
        canvas: { width: 1920, height: 1080 },
        ds: { scale: 1.5, offset: [100, 50] },
    };
    const [x, y] = calculateCanvasCenterPosition(mockCanvas);
    assert.equal(x, 540);
    assert.equal(y, 310);

    // Fallback when canvas is missing
    const fallback = calculateCanvasCenterPosition(null);
    assert.deepEqual(fallback, [100, 100]);
});

test('assignModelPathToNode assigns path to preferred widget or fallback combo', () => {
    const node = {
        widgets: [
            { name: 'ckpt_name', value: '', options: { values: ['sd15.safetensors', 'flux.safetensors'] } },
            { name: 'vae_name', value: '' },
        ],
    };

    // Match preferred key
    const success1 = assignModelPathToNode(node, 'models/checkpoints/flux.safetensors', 'ckpt_name');
    assert.equal(success1, true);
    assert.equal(node.widgets[0].value, 'flux.safetensors');

    // Fallback when preferred key not provided
    const node2 = {
        widgets: [
            { name: 'other_thing', value: '' },
            { name: 'unet_name', value: '', options: { values: ['flux-dev.safetensors'] } },
        ],
    };
    const success2 = assignModelPathToNode(node2, 'flux-dev.safetensors');
    assert.equal(success2, true);
    assert.equal(node2.widgets[1].value, 'flux-dev.safetensors');

    // First combo widget fallback
    const node3 = {
        widgets: [
            { name: 'custom_picker', type: 'combo', value: '' },
        ],
    };
    const success3 = assignModelPathToNode(node3, 'custom_model.safetensors');
    assert.equal(success3, true);
    assert.equal(node3.widgets[0].value, 'custom_model.safetensors');
});

test('addModelLoaderToCanvas creates and adds node to graph', async () => {
    const createdNodes = [];
    const addedNodes = [];

    const mockLiteGraph = {
        registered_node_types: {
            CheckpointLoaderSimple: {},
            LoraLoader: {},
            UNETLoaderGGUF: {},
        },
        createNode: (type) => {
            const node = {
                type,
                pos: [0, 0],
                widgets: [
                    { name: type === 'LoraLoader' ? 'lora_name' : (type === 'UNETLoaderGGUF' ? 'unet_name' : 'ckpt_name'), value: '' },
                ],
            };
            createdNodes.push(node);
            return node;
        },
    };

    const mockGraph = {
        add: (node) => addedNodes.push(node),
        setDirtyCanvas: () => {},
    };

    globalThis.LiteGraph = mockLiteGraph;
    domWindow.LiteGraph = mockLiteGraph;
    domWindow.app = {
        graph: mockGraph,
        canvas: {
            canvas: { width: 1000, height: 800 },
            ds: { scale: 1, offset: [0, 0] },
            selectNode: () => {},
            centerOnNode: () => {},
            setDirty: () => {},
        },
    };

    // 1. Standard checkpoint loader
    const node1 = await addModelLoaderToCanvas({
        name: 'sd_xl_base.safetensors',
        category: 'checkpoints',
    });
    assert.ok(node1);
    assert.equal(node1.type, 'CheckpointLoaderSimple');
    assert.equal(node1.widgets[0].value, 'sd_xl_base.safetensors');
    assert.equal(addedNodes.length, 1);

    // 2. GGUF model loader
    const node2 = await addModelLoaderToCanvas({
        name: 'flux_unet_q4.gguf',
        category: 'diffusion_models',
    });
    assert.ok(node2);
    assert.equal(node2.type, 'UNETLoaderGGUF');
    assert.equal(node2.widgets[0].value, 'flux_unet_q4.gguf');
    assert.equal(addedNodes.length, 2);

    // 3. LoRA model loader
    const node3 = await addModelLoaderToCanvas({
        name: 'detail_slider.safetensors',
        category: 'loras',
    });
    assert.ok(node3);
    assert.equal(node3.type, 'LoraLoader');
    assert.equal(node3.widgets[0].value, 'detail_slider.safetensors');
    assert.equal(addedNodes.length, 3);
});
