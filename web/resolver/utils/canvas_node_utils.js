import { showNotification } from "../../utils/notification_utils.js";

export const FALLBACK_LOADER_NODES_BY_CATEGORY = Object.freeze({
    checkpoints: { nodeType: "CheckpointLoaderSimple", key: "ckpt_name", displayName: "Load Checkpoint" },
    diffusion_models: { nodeType: "UNETLoader", key: "unet_name", displayName: "Load Diffusion Model" },
    unet: { nodeType: "UNETLoader", key: "unet_name", displayName: "Load Diffusion Model" },
    vae: { nodeType: "VAELoader", key: "vae_name", displayName: "Load VAE" },
    loras: { nodeType: "LoraLoader", key: "lora_name", displayName: "Load LoRA" },
    lora: { nodeType: "LoraLoader", key: "lora_name", displayName: "Load LoRA" },
    controlnet: { nodeType: "ControlNetLoader", key: "control_net_name", displayName: "Load ControlNet Model" },
    text_encoders: { nodeType: "CLIPLoader", key: "clip_name", displayName: "Load CLIP" },
    clip_vision: { nodeType: "CLIPVisionLoader", key: "clip_name", displayName: "Load CLIP Vision" },
    upscale_models: { nodeType: "UpscaleModelLoader", key: "model_name", displayName: "Load Upscale Model" },
    latent_upscale_models: { nodeType: "LatentUpscaleModelLoader", key: "model_name", displayName: "Load Latent Upscale Model" },
    gligen: { nodeType: "GLIGENLoader", key: "gligen_name", displayName: "Load GLIGEN" },
    style_models: { nodeType: "StyleModelLoader", key: "style_model_name", displayName: "Load Style Model" },
    embeddings: { nodeType: "EmbeddingLoader", key: "embedding_name", displayName: "Load Embedding" },
    audio_encoders: { nodeType: "AudioEncoderLoader", key: "audio_encoder_name", displayName: "Load Audio Encoder" },
});

export const GGUF_LOADER_CANDIDATES_BY_CATEGORY = Object.freeze({
    diffusion_models: [
        { nodeType: "UNETLoaderGGUF", key: "unet_name" },
        { nodeType: "UnetLoaderGGUF", key: "unet_name" },
    ],
    checkpoints: [
        { nodeType: "UNETLoaderGGUF", key: "unet_name" },
        { nodeType: "UnetLoaderGGUF", key: "unet_name" },
    ],
    text_encoders: [
        { nodeType: "CLIPLoaderGGUF", key: "clip_name" },
        { nodeType: "ClipLoaderGGUF", key: "clip_name" },
        { nodeType: "DualCLIPLoaderGGUF", key: "clip_name1" },
    ],
});

export function isGgufModel(modelPath = "") {
    return String(modelPath || "").trim().toLowerCase().endsWith(".gguf");
}

export function calculateCanvasCenterPosition(canvas = null) {
    const targetCanvas = canvas || (typeof window !== "undefined" ? window.app?.canvas : null);
    if (!targetCanvas) return [100, 100];
    try {
        const width = Number(targetCanvas?.canvas?.width || 1600);
        const height = Number(targetCanvas?.canvas?.height || 900);
        const scale = Number(targetCanvas?.ds?.scale || 1);
        const offset = Array.isArray(targetCanvas?.ds?.offset) ? targetCanvas.ds.offset : [0, 0];
        return [
            Math.round(width / (2 * scale) - Number(offset[0] || 0)),
            Math.round(height / (2 * scale) - Number(offset[1] || 0)),
        ];
    } catch {
        return [100, 100];
    }
}

export function assignModelPathToNode(node, modelPath, preferredKey = null) {
    if (!node || !Array.isArray(node.widgets)) return false;

    const normalizedPath = String(modelPath || "").trim().replace(/\\/g, "/");
    if (!normalizedPath) return false;
    const isAbsolutePath = /^([a-zA-Z]:\/|\/)/.test(normalizedPath);
    const basename = normalizedPath.split("/").pop() || normalizedPath;
    const fallbackValue = isAbsolutePath ? basename : normalizedPath;

    const findWidget = (key) =>
        node.widgets.find((w) => String(w?.name || "").trim().toLowerCase() === key.toLowerCase());

    const applyWidgetValue = (widget, nextValue) => {
        const prevValue = widget.value;
        widget.value = nextValue;
        try {
            const canvas = typeof window !== "undefined" ? window.app?.canvas : null;
            widget.callback?.(nextValue, canvas, node, node.pos, null);
        } catch {
            // Ignore widget callback errors from third-party nodes
        }
        try {
            node.onWidgetChanged?.(widget.name, nextValue, prevValue, widget);
        } catch {
            // Ignore node change hook errors
        }
    };

    const trySetWidget = (widget) => {
        if (!widget) return false;
        const values = widget.options?.values;
        if (Array.isArray(values) && values.length) {
            const getOptionText = (v) => String(v?.value ?? v?.name ?? v ?? "").replace(/\\/g, "/");
            // 1. Exact relative path match (case-sensitive, then case-insensitive)
            let match = values.find((v) => getOptionText(v) === normalizedPath);
            if (match === undefined) {
                const lowerNorm = normalizedPath.toLowerCase();
                match = values.find((v) => getOptionText(v).toLowerCase() === lowerNorm);
            }
            // 2. Suffix path match when full absolute path was provided
            if (match === undefined && isAbsolutePath) {
                const lowerNorm = normalizedPath.toLowerCase();
                match = values.find((v) => {
                    const opt = getOptionText(v).toLowerCase();
                    return opt && lowerNorm.endsWith("/" + opt);
                });
            }
            // 3. Basename fallback only when unambiguous (or exact basename)
            if (match === undefined) {
                const lowerBase = basename.toLowerCase();
                const baseMatches = values.filter(
                    (v) => (getOptionText(v).split("/").pop() || "").toLowerCase() === lowerBase
                );
                if (baseMatches.length === 1) {
                    match = baseMatches[0];
                }
            }
            if (match !== undefined) {
                applyWidgetValue(widget, match?.value ?? match?.name ?? match);
                return true;
            }
        }
        applyWidgetValue(widget, fallbackValue);
        return true;
    };

    if (preferredKey) {
        const preferredWidget = findWidget(preferredKey);
        if (preferredWidget && trySetWidget(preferredWidget)) {
            return true;
        }
    }

    const fallbackKeys = [
        "unet_name",
        "ckpt_name",
        "model_name",
        "clip_name",
        "clip_name1",
        "vae_name",
        "lora_name",
        "control_net_name",
        "style_model_name",
        "gligen_name",
    ];
    for (const key of fallbackKeys) {
        const w = findWidget(key);
        if (w && trySetWidget(w)) {
            return true;
        }
    }

    const firstCombo = node.widgets.find((w) => w?.type === "combo");
    if (firstCombo) {
        return trySetWidget(firstCombo);
    }
    return false;
}

const resolveModelToNodeStore = async () => {
    const candidates = [
        "../../../stores/modelToNodeStore.js",
        "/stores/modelToNodeStore.js",
        "../../../scripts/stores/modelToNodeStore.js",
        "/scripts/stores/modelToNodeStore.js",
    ];
    for (const path of candidates) {
        try {
            const mod = await import(path);
            if (typeof mod?.useModelToNodeStore === "function") {
                return mod.useModelToNodeStore();
            }
        } catch {
            // Continue searching candidates
        }
    }
    return null;
};

export async function addModelLoaderToCanvas(modelOrInfo, options = {}) {
    const graph = window.app?.canvas?.graph || window.app?.graph;
    const liteGraph = window.LiteGraph || globalThis.LiteGraph;
    if (!graph || typeof liteGraph?.createNode !== "function") {
        showNotification("LiteGraph is not available on this canvas.", "error");
        return null;
    }

    const modelPath = typeof modelOrInfo === "string"
        ? modelOrInfo
        : (
            modelOrInfo?.relative_path
            || modelOrInfo?.original_path
            || modelOrInfo?.filename
            || modelOrInfo?.name
            || modelOrInfo?.full_path
            || modelOrInfo?.path
            || modelOrInfo?.resolved_path
            || ""
        );
    const rawCategory = typeof modelOrInfo === "string"
        ? (options.category || "checkpoints")
        : (modelOrInfo?.category || options.category || "checkpoints");
    const category = String(rawCategory || "checkpoints").trim().toLowerCase().replace(/[\s-]+/g, "_");

    const isGguf = Boolean(options.isGguf) || isGgufModel(modelPath);

    const candidateList = [];
    if (isGguf && GGUF_LOADER_CANDIDATES_BY_CATEGORY[category]) {
        candidateList.push(...GGUF_LOADER_CANDIDATES_BY_CATEGORY[category]);
    }

    try {
        const store = await resolveModelToNodeStore();
        if (store?.getNodeProvider) {
            const provider = store.getNodeProvider(category);
            if (provider) {
                const nodeType = provider.nodeDef?.name || provider.nodeType;
                if (nodeType) {
                    candidateList.push({
                        nodeType,
                        key: provider.key || null,
                        displayName: provider.nodeDef?.display_name || null,
                    });
                }
            }
        }
    } catch {
        // Ignore store resolution errors and use fallbacks
    }

    const fallback = FALLBACK_LOADER_NODES_BY_CATEGORY[category];
    if (fallback) {
        candidateList.push(fallback);
    }

    if (!candidateList.length) {
        showNotification(`No loader node registered for category "${category}".`, "warning");
        return null;
    }

    let chosenNode = null;
    let chosenCandidate = null;
    const registeredTypes = liteGraph.registered_node_types || {};

    for (const candidate of candidateList) {
        if (candidate.nodeType in registeredTypes || typeof liteGraph.createNode === "function") {
            try {
                const node = liteGraph.createNode(candidate.nodeType, candidate.displayName || undefined);
                if (node) {
                    chosenNode = node;
                    chosenCandidate = candidate;
                    break;
                }
            } catch {
                // Try next candidate loader
            }
        }
    }

    if (!chosenNode) {
        showNotification(`Could not create loader node for "${category}". Required custom node may not be installed.`, "error");
        return null;
    }

    const pos = options.pos || calculateCanvasCenterPosition(window.app?.canvas);
    chosenNode.pos = [pos[0], pos[1]];

    assignModelPathToNode(chosenNode, modelPath, chosenCandidate?.key);

    graph.add(chosenNode);
    window.app?.canvas?.selectNode?.(chosenNode);
    window.app?.canvas?.centerOnNode?.(chosenNode);
    graph.setDirtyCanvas?.(true, true);
    window.app?.canvas?.setDirty?.(true, true);

    const filename = String(modelPath).replace(/\\/g, "/").split("/").pop() || modelPath;
    showNotification(`Added ${chosenCandidate.nodeType} for "${filename}" to canvas.`, "success");
    return chosenNode;
}
