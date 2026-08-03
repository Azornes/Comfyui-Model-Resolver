const FALLBACK_DOWNLOAD_CATEGORY_ALIASES = Object.freeze({
    checkpoint: 'checkpoints',
    lora: 'loras',
    embedding: 'embeddings',
    textualinversion: 'embeddings',
    textual_inversion: 'embeddings',
    upscaler: 'upscale_models',
    unet: 'diffusion_models',
    unet_gguf: 'diffusion_models',
    model_gguf: 'diffusion_models',
    select_safetensors: 'diffusion_models',
    diffusion_model: 'diffusion_models',
    diffusion_models: 'diffusion_models',
    clip: 'text_encoders',
    clips: 'text_encoders',
    clip_gguf: 'text_encoders',
    text_encoder: 'text_encoders',
    text_encoders: 'text_encoders',
    ip_adapter: 'ipadapter',
    upscale_model: 'upscale_models',
    latent_upscale_model: 'latent_upscale_models',
    style_model: 'style_models',
    audio_encoder: 'audio_encoders',
    model_patch: 'model_patches',
    sam: 'sams',
    sam_model: 'sams',
    sam_models: 'sams',
    ultralytics_bbox: 'ultralytics',
    ultralytics_segm: 'ultralytics',
    yolo: 'ultralytics',
    background_removal_model: 'background_removal',
    frame_interpolation_model: 'frame_interpolation',
    geometry_estimation_model: 'geometry_estimation',
    optical_flow_model: 'optical_flow',
    default: 'upscale_models',
});

function normalizeCategoryToken(category) {
    return String(category || '')
        .trim()
        .toLowerCase()
        .replace(/[/\\\s-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

export function normalizeDownloadCategoryValue(
    category = '',
    aliases = FALLBACK_DOWNLOAD_CATEGORY_ALIASES,
) {
    const token = normalizeCategoryToken(category);
    const categoryAliases = aliases && typeof aliases === 'object'
        ? aliases
        : FALLBACK_DOWNLOAD_CATEGORY_ALIASES;
    return categoryAliases[token] || token || 'checkpoints';
}
