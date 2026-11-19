import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assignModelPathToNode,
    addModelLoaderToCanvas,
} from '../web/resolver/utils/canvas_node_utils.js';
import { renderNodeModelPopoverHtml } from '../web/resolver/node_popover.js';

test('assignModelPathToNode prefers exact relative path, strips absolute fallback, and triggers callbacks', () => {
    const callbackCalls = [];
    const changedCalls = [];

    const node = {
        pos: [10, 20],
        onWidgetChanged: (name, next, prev) => changedCalls.push([name, next, prev]),
        widgets: [
            {
                name: 'lora_name',
                value: '',
                options: {
                    values: ['SD15/style.safetensors', 'SDXL/style.safetensors'],
                },
                callback: (val) => callbackCalls.push(val),
            },
        ],
    };

    // Exact relative path selects the right subfolder (not the first basename match)
    assert.equal(assignModelPathToNode(node, 'SDXL\\style.safetensors', 'lora_name'), true);
    assert.equal(node.widgets[0].value, 'SDXL/style.safetensors');
    assert.deepEqual(callbackCalls, ['SDXL/style.safetensors']);
    assert.deepEqual(changedCalls, [['lora_name', 'SDXL/style.safetensors', '']]);

    // When combo values do not include a freshly downloaded model and an absolute path is passed,
    // never write the OS absolute path into the widget.
    const freshNode = {
        widgets: [{ name: 'ckpt_name', value: '', options: { values: ['other.safetensors'] } }],
    };
    assert.equal(assignModelPathToNode(freshNode, 'C:\\ComfyUI\\models\\checkpoints\\brand_new.safetensors', 'ckpt_name'), true);
    assert.equal(freshNode.widgets[0].value, 'brand_new.safetensors');
});

test('addModelLoaderToCanvas adds to active subgraph and prefers relative_path over full_path', async () => {
    const rootAdded = [];
    const subAdded = [];
    const mockLiteGraph = {
        registered_node_types: { LoraLoader: {} },
        createNode: (type) => ({
            type,
            pos: [0, 0],
            widgets: [{ name: 'lora_name', value: '', options: { values: [] } }],
        }),
    };

    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    const prevLiteGraph = globalThis.LiteGraph;
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCaf = globalThis.cancelAnimationFrame;
    globalThis.LiteGraph = mockLiteGraph;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.document = {
        getElementById: () => null,
        querySelector: () => null,
        createElement: () => ({
            style: {},
            classList: { add() {}, remove() {} },
            setAttribute() {},
            appendChild() {},
            addEventListener() {},
            remove() {},
        }),
        body: { appendChild() {} },
        head: { appendChild() {} },
    };
    globalThis.window = {
        LiteGraph: mockLiteGraph,
        setTimeout: () => 1,
        clearTimeout: () => {},
        app: {
            graph: { add: (n) => rootAdded.push(n), setDirtyCanvas: () => {} },
            canvas: {
                graph: { add: (n) => subAdded.push(n), setDirtyCanvas: () => {} },
                canvas: { width: 1000, height: 800 },
                ds: { scale: 1, offset: [0, 0] },
                selectNode: () => {},
                centerOnNode: () => {},
                setDirty: () => {},
            },
        },
    };

    try {
        const node = await addModelLoaderToCanvas({
            full_path: '/home/user/ComfyUI/models/loras/SDXL/my_lora.safetensors',
            relative_path: 'SDXL/my_lora.safetensors',
            category: 'loras',
        });
        assert.ok(node);
        assert.equal(rootAdded.length, 0);
        assert.equal(subAdded.length, 1);
        assert.equal(node.widgets[0].value, 'SDXL/my_lora.safetensors');
    } finally {
        globalThis.window = prevWindow;
        globalThis.document = prevDocument;
        globalThis.LiteGraph = prevLiteGraph;
        globalThis.requestAnimationFrame = prevRaf;
        globalThis.cancelAnimationFrame = prevCaf;
    }
});

test('renderNodeModelPopoverHtml hides local-only actions for missing or pending models', () => {
    const html = renderNodeModelPopoverHtml({
        node: { id: 1, title: 'Loader' },
        models: [
            { original_path: 'missing.safetensors', category: 'checkpoints', exists: false },
            { original_path: 'pending.safetensors', category: 'loras', resolution_pending: true },
        ],
    });

    assert.match(html, /data-action="search"/);
    assert.match(html, /data-action="info"/);
    assert.doesNotMatch(html, /data-action="use"/);
    assert.doesNotMatch(html, /data-action="folder"/);
});
