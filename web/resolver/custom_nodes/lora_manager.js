const LORA_MANAGER_NODE_TYPES = Object.freeze([
    'LoraLoaderV2',
    'Lora Loader (LoraManager)',
    'Lora Stacker (LoraManager)',
]);
const LORA_MANAGER_WIDGET_NAMES = new Set(['text', 'loras']);

function getLoraManagerEntries(node) {
    const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
    const lorasWidget = widgets.find(widget => widget?.name === 'loras');
    const loras = Array.isArray(lorasWidget?.value) ? lorasWidget.value : [];
    return loras.map((lora) => {
        if (lora && typeof lora === 'object') {
            return {
                identity: lora.name || lora.filename || lora.path || '',
                active: lora.active !== false,
                strength: lora.strength,
            };
        }
        return {
            identity: lora,
            active: true,
            strength: null,
        };
    });
}

function observeLoraManager(node, notify) {
    for (const widget of node.widgets || []) {
        if (!LORA_MANAGER_WIDGET_NAMES.has(widget?.name)) continue;
        if (widget.callback?.__modelResolverCustomNodeAdapter) continue;

        const originalCallback = widget.callback;
        const wrappedCallback = function() {
            const result = originalCallback?.apply(this, arguments);
            notify();
            return result;
        };
        wrappedCallback.__modelResolverCustomNodeAdapter = true;
        widget.callback = wrappedCallback;
    }
}

export const loraManagerAdapter = Object.freeze({
    id: 'lora-manager',
    nodeTypes: LORA_MANAGER_NODE_TYPES,
    category: 'loras',
    isModelWidget: widgetName => LORA_MANAGER_WIDGET_NAMES.has(widgetName),
    getModelEntries: getLoraManagerEntries,
    observe: observeLoraManager,
});
