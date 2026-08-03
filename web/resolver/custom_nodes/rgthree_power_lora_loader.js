const POWER_LORA_LOADER_NODE_TYPE = 'Power Lora Loader (rgthree)';
const POWER_LORA_WIDGET_PATTERN = /^lora_\d+$/;

function getPowerLoraEntries(node) {
    const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
    return widgets
        .filter(widget => (
            POWER_LORA_WIDGET_PATTERN.test(widget?.name)
            && widget?.value?.lora
        ))
        .map(widget => ({
            identity: widget.value.lora,
            active: widget.value.on !== false,
            strength: widget.value.strength,
        }));
}

function observePowerLoraLoader(node, notify) {
    const queueInspection = (() => {
        let inspectionQueued = false;
        return () => {
            if (inspectionQueued) return;
            inspectionQueued = true;
            queueMicrotask(() => {
                inspectionQueued = false;
                notify();
            });
        };
    })();

    if (
        typeof node.setDirtyCanvas !== 'function'
        || node.setDirtyCanvas.__modelResolverCustomNodeAdapter
    ) {
        if (!Array.isArray(node.widgets)) return;
    } else {
        const originalSetDirtyCanvas = node.setDirtyCanvas;
        const wrappedSetDirtyCanvas = function() {
            const result = originalSetDirtyCanvas.apply(this, arguments);
            queueInspection();
            return result;
        };
        wrappedSetDirtyCanvas.__modelResolverCustomNodeAdapter = true;
        node.setDirtyCanvas = wrappedSetDirtyCanvas;
    }

    if (
        typeof node.widgets.splice === 'function'
        && !node.widgets.splice.__modelResolverCustomNodeAdapter
    ) {
        const originalSplice = node.widgets.splice;
        const wrappedSplice = function() {
            const result = originalSplice.apply(this, arguments);
            queueInspection();
            return result;
        };
        wrappedSplice.__modelResolverCustomNodeAdapter = true;
        node.widgets.splice = wrappedSplice;
    }
}

export const rgthreePowerLoraLoaderAdapter = Object.freeze({
    id: 'rgthree-power-lora-loader',
    nodeTypes: Object.freeze([POWER_LORA_LOADER_NODE_TYPE]),
    category: 'loras',
    isModelWidget: widgetName => POWER_LORA_WIDGET_PATTERN.test(widgetName),
    getModelEntries: getPowerLoraEntries,
    observe: observePowerLoraLoader,
});
