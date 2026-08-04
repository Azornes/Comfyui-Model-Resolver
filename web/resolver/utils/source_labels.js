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

export function getSourceDisplayLabel(
    source,
    {
        context = 'common',
        normalize = true,
        fallback = source,
    } = {}
) {
    const sourceKey = normalize
        ? String(source ?? '').toLowerCase().replace(/-/g, '_')
        : source;
    const contextLabels = SOURCE_LABEL_CONTEXT_OVERRIDES[context] || {};
    return contextLabels[sourceKey] || COMMON_SOURCE_LABELS[sourceKey] || fallback;
}
