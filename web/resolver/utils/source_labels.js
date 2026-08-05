const COMMON_SOURCE_LABELS = Object.freeze({
    all: 'Everything',
    local: 'Local Database',
    popular: 'Popular',
    model_list: 'Local Database',
    huggingface: 'HuggingFace',
    civitai: 'CivitAI',
    civarchive: 'CivArchive',
    lora_manager_archive: 'LoRA Archive',
    lora_archive: 'LoRA Archive',
    workflow: 'Workflow',
    online: 'Online',
    download_source: 'Selected source',
    custom: 'Custom URL',
});

const SOURCE_LABEL_CONTEXT_OVERRIDES = Object.freeze({
    search: Object.freeze({
        all: 'Everything',
        local: 'Local Database',
        lora_manager_archive: 'LoRA Manager Archive',
        custom: 'Custom URL',
    }),
});

export function normalizeSourceKey(value, { trim = true } = {}) {
    const text = String(value ?? '');
    return (trim ? text.trim() : text).toLowerCase().replace(/-/g, '_');
}

export function normalizeSourceList(sources = []) {
    return new Set(
        (Array.isArray(sources) ? sources : [sources])
            .map(source => String(source ?? '').trim())
            .filter(Boolean)
    );
}

export function getSourceDisplayLabel(
    source,
    {
        context = 'common',
        normalize = true,
        fallback = source,
    } = {}
) {
    const sourceKey = normalize
        ? normalizeSourceKey(source, { trim: false })
        : source;
    const contextLabels = SOURCE_LABEL_CONTEXT_OVERRIDES[context] || {};
    return contextLabels[sourceKey] || COMMON_SOURCE_LABELS[sourceKey] || fallback;
}
