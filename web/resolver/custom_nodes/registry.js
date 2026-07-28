import { loraManagerAdapter } from './lora_manager.js';
import { rgthreePowerLoraLoaderAdapter } from './rgthree_power_lora_loader.js';

export const CUSTOM_NODE_MODEL_ADAPTERS = Object.freeze([
    loraManagerAdapter,
    rgthreePowerLoraLoaderAdapter,
]);

function getNodeTypeCandidates(node) {
    return [
        node?.comfyClass,
        node?.type,
        node?.constructor?.comfyClass,
        node?.constructor?.ComfyClass,
    ].filter(Boolean);
}

function normalizeModelEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const identity = String(entry.identity || '').trim();
    if (!identity) return null;
    const hasStrength = (
        entry.strength !== null
        && entry.strength !== undefined
        && entry.strength !== ''
    );
    const numericStrength = hasStrength ? Number(entry.strength) : Number.NaN;
    return {
        identity,
        active: entry.active !== false,
        strength: Number.isFinite(numericStrength) ? numericStrength : null,
    };
}

export function getCustomNodeModelAdapter(node) {
    const nodeTypes = getNodeTypeCandidates(node);
    return CUSTOM_NODE_MODEL_ADAPTERS.find(
        adapter => adapter.nodeTypes.some(nodeType => nodeTypes.includes(nodeType))
    ) || null;
}

export function getCustomNodeModelCategory(nodeType = '') {
    const normalizedNodeType = String(nodeType || '').trim();
    const adapter = CUSTOM_NODE_MODEL_ADAPTERS.find(
        candidate => candidate.nodeTypes.includes(normalizedNodeType)
    );
    return adapter?.category || '';
}

export function getCustomNodeOriginalIdentity(model = {}) {
    return (
        model.custom_node_original_identity
        || model.original_lora_name
        || ''
    );
}

export function getCustomNodeModelEntries(node) {
    const adapter = getCustomNodeModelAdapter(node);
    if (!adapter) return [];
    return (adapter.getModelEntries(node) || [])
        .map(normalizeModelEntry)
        .filter(Boolean);
}

export function isCustomNodeModelWidget(node, widgetName = '') {
    return Boolean(
        getCustomNodeModelAdapter(node)?.isModelWidget?.(widgetName)
    );
}

export function getCustomNodeModelListSignature(node) {
    const entries = getCustomNodeModelEntries(node)
        .map(entry => ({
            identity: entry.identity,
            active: entry.active,
        }))
        .sort((left, right) => (
            left.identity.localeCompare(right.identity)
            || Number(left.active) - Number(right.active)
        ));
    return JSON.stringify(entries);
}

export function getCustomNodeModelStrengthSignature(node) {
    const entries = getCustomNodeModelEntries(node)
        .map(entry => ({
            identity: entry.identity,
            strength: entry.strength,
        }))
        .sort((left, right) => (
            left.identity.localeCompare(right.identity)
            || (left.strength ?? 0) - (right.strength ?? 0)
        ));
    return JSON.stringify(entries);
}
