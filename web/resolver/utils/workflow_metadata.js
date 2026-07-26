const WORKFLOW_CONTAINER_KEYS = new Set([
    'comfy',
    'comfyui',
    'extra_metadata',
    'extra_pnginfo',
    'workflow'
]);

function normalizeNonFiniteJsonNumbers(text) {
    let normalized = '';
    let inString = false;
    let escaped = false;
    const tokens = ['-Infinity', '+Infinity', 'Infinity', 'NaN'];

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (inString) {
            normalized += character;
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
            normalized += character;
            continue;
        }

        const token = tokens.find(candidate => text.startsWith(candidate, index));
        if (token) {
            const previous = index > 0 ? text[index - 1] : '';
            const next = text[index + token.length] || '';
            const validPrevious = !previous || /[\s[{:;,]/.test(previous);
            const validNext = !next || /[\s\]},;]/.test(next);
            if (validPrevious && validNext) {
                normalized += 'null';
                index += token.length - 1;
                continue;
            }
        }

        normalized += character;
    }

    return normalized;
}

function parseJsonStrings(value) {
    let parsed = value;
    for (let attempt = 0; attempt < 3 && typeof parsed === 'string'; attempt += 1) {
        const text = parsed.trim();
        if (!text) return null;
        try {
            parsed = JSON.parse(text);
        } catch {
            const normalizedText = normalizeNonFiniteJsonNumbers(text);
            if (normalizedText === text) return null;
            try {
                parsed = JSON.parse(normalizedText);
            } catch {
                return null;
            }
        }
    }
    return parsed;
}

function findWorkflow(value, seen, depth = 0) {
    if (depth > 6) return null;

    const parsed = parseJsonStrings(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    if (seen.has(parsed)) return null;
    seen.add(parsed);

    if (Array.isArray(parsed.nodes)) {
        return parsed;
    }

    for (const [key, nestedValue] of Object.entries(parsed)) {
        if (!WORKFLOW_CONTAINER_KEYS.has(String(key).toLowerCase())) continue;
        const workflow = findWorkflow(nestedValue, seen, depth + 1);
        if (workflow) return workflow;
    }

    return null;
}

/**
 * Extract a pasteable ComfyUI editor workflow from CivitAI image metadata.
 */
export function extractComfyWorkflow(image = {}) {
    const candidates = [
        image.workflow,
        image.comfy,
        image.meta,
        image.metadata,
        image.extra_metadata,
        image.extra_pnginfo
    ];

    for (const candidate of candidates) {
        const workflow = findWorkflow(candidate, new WeakSet());
        if (!workflow) continue;

        return {
            workflow,
            nodeCount: workflow.nodes.length,
            text: JSON.stringify(workflow)
        };
    }

    return null;
}
