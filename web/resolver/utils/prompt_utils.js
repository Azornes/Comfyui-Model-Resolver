const PROMPT_WIDGET_NAMES = new Set([
    'text',
    'prompt',
    'positive',
    'negative',
    'positive_prompt',
    'negative_prompt',
    'prompt_positive',
    'prompt_negative',
    'text_positive',
    'text_negative',
    'text_a',
    'text_b',
    'text_c',
    'text_d',
    'text_g',
    'text_l',
    'text_1',
    'text_2',
    'string_a',
    'string_b',
    'string_c',
    'string_d',
    'string_g',
    'string_l',
    'string_1',
    'string_2',
    'string_positive',
    'string_negative',
    'value',
    'clip_l',
    'clip_g',
    't5xxl',
    't5',
]);

const PROMPT_NODE_TYPE_PATTERN = /(?:clip.*text|text.*encode|primitive.*string|string.*multiline|text.*multiline|multiline.*text|conditioning.*text|textinput|string.*concat|text.*concat|string.*combine|text.*combine|string.*format|text.*format)/i;
const PROMPT_NODE_TYPE_SCORE_RULES = [
    { pattern: /(?:clip.*text|text.*encode)/i, score: 500 },
    { pattern: /conditioning.*text/i, score: 420 },
    { pattern: /(?:primitive.*string|string.*multiline|text.*multiline|multiline.*text|textinput|string.*concat|text.*concat|string.*combine|text.*combine|string.*format|text.*format)/i, score: 320 },
];
const SCALAR_WIDGET_TYPES = new Set(['STRING', 'INT', 'FLOAT', 'BOOLEAN']);
const PROMPT_INPUT_NAMES = new Set(['text', 'prompt', 'text_input', 'string', 'value']);
const TEXT_WIDGET_TYPES = new Set(['STRING', 'TEXT']);
const NON_TEXT_WIDGET_TYPES = new Set([
    'BOOLEAN',
    'COMBO',
    'DROPDOWN',
    'ENUM',
    'FLOAT',
    'INT',
    'LIST',
    'NUMBER',
    'SELECT',
    'SLIDER',
]);
const NON_PROMPT_WIDGET_NAME_PATTERN = /^(?:after_generate|batch(?:_size)?|cfg|checkpoint_name|ckpt_name|clip_name|control_after_generate|counter|delimiter|denoise|device|extension|filename(?:_prefix)?|folder|format|height|list|lora_name|mode|model_name|output(?:_name|_path)?|path|prefix|sampler|scheduler|seed|sep|separator|steps|suffix|unet_name|vae_name|weight_dtype|width)$/i;

function normalizePromptName(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getInputName(input = {}) {
    if (typeof input === 'string') return input.trim();
    return String(
        input?.name
        || input?.widget_name
        || input?.widgetName
        || input?.widget?.name
        || input?.widget?.widget
        || ''
    ).trim();
}

function getRoleFromLabel(value) {
    const token = normalizePromptName(value);
    if (!token) return '';

    const parts = new Set(token.split('_').filter(Boolean));
    if (parts.has('negative') || parts.has('neg') || parts.has('uncond') || parts.has('unconditional')) {
        return 'negative';
    }
    if (parts.has('positive') || parts.has('pos') || parts.has('cond') || parts.has('conditional')) {
        return 'positive';
    }
    return '';
}

function isPromptInputName(value) {
    const token = normalizePromptName(value);
    return PROMPT_WIDGET_NAMES.has(token)
        || PROMPT_INPUT_NAMES.has(token)
        || token.includes('prompt')
        || token.startsWith('text_')
        || token.endsWith('_text')
        || token.startsWith('string_')
        || token.endsWith('_string');
}

function isWidgetInput(input = {}) {
    if (!input || typeof input !== 'object') return false;
    if (
        input.widget !== undefined
        || input.widget_name !== undefined
        || input.widgetName !== undefined
        || input.isWidget === true
    ) return true;

    const type = String(input.type || '').trim().toUpperCase();
    return input.link == null && SCALAR_WIDGET_TYPES.has(type);
}

function getWidgetInputs(node = {}) {
    const inputs = Array.isArray(node.inputs) ? node.inputs : [];
    return inputs.filter(isWidgetInput);
}

function getWidgetNames(node = {}, valueCount = 0) {
    const names = Array.from({ length: valueCount }, () => '');
    const setName = (index, value) => {
        if (index < 0 || index >= names.length || names[index]) return;
        const name = getInputName(value);
        if (name) names[index] = name;
    };

    const widgets = Array.isArray(node.widgets) ? node.widgets : [];
    widgets.forEach((widget, index) => setName(index, widget));

    const widgetInputs = getWidgetInputs(node);
    widgetInputs.forEach((input, index) => setName(index, input));

    if (node.widgets_values_named && typeof node.widgets_values_named === 'object') {
        const namedKeys = Object.keys(node.widgets_values_named);
        namedKeys.forEach((key, index) => setName(index, key));
    }

    const scalarInputs = (Array.isArray(node.inputs) ? node.inputs : [])
        .filter(input => input && input.link == null && (
            isWidgetInput(input)
            || SCALAR_WIDGET_TYPES.has(String(input.type || '').trim().toUpperCase())
        ));
    scalarInputs.forEach((input, index) => setName(index, input));

    return names;
}

function getWidgetInput(node = {}, widgetIndex = -1, widgetName = '') {
    const inputs = Array.isArray(node.inputs) ? node.inputs : [];
    const normalizedName = normalizePromptName(widgetName);
    if (normalizedName) {
        const named = inputs.find(input => normalizePromptName(getInputName(input)) === normalizedName);
        if (named) return named;
    }

    const widgetInputs = getWidgetInputs(node);
    return widgetInputs[widgetIndex]
        || inputs.filter(input => input && input.link == null)[widgetIndex]
        || null;
}

function getWidgetDescriptors(node = {}) {
    const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
    const names = getWidgetNames(node, values.length);
    const widgets = Array.isArray(node.widgets) ? node.widgets : [];
    const namedValues = node.widgets_values_named && typeof node.widgets_values_named === 'object'
        ? node.widgets_values_named
        : {};

    return Array.from({ length: values.length }, (_, index) => {
        const value = values[index];
        const name = names[index] || '';
        const namedValue = name && Object.prototype.hasOwnProperty.call(namedValues, name)
            ? namedValues[name]
            : value;
        return {
            index,
            name,
            value: namedValue,
            input: getWidgetInput(node, index, name),
            widget: widgets[index] || null,
        };
    });
}

function collectWorkflowNodeEntries(workflow = {}) {
    const entries = [];
    if (!workflow || typeof workflow !== 'object') return entries;

    const appendNodes = (nodes, {
        graphKey,
        isTopLevel,
        subgraphId = '',
        subgraphName = '',
    }) => {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
            if (!node || typeof node !== 'object' || node.id == null) continue;
            entries.push({
                node,
                graphKey,
                isTopLevel,
                subgraphId,
                subgraphName,
                nodeKey: `${graphKey}:${String(node.id)}`,
            });
        }
    };

    appendNodes(workflow.nodes, { graphKey: 'top', isTopLevel: true });
    const subgraphs = workflow.definitions?.subgraphs;
    if (Array.isArray(subgraphs)) {
        subgraphs.forEach((subgraph, index) => {
            if (!subgraph || typeof subgraph !== 'object') return;
            const subgraphId = String(subgraph.id ?? `index-${index}`);
            appendNodes(subgraph.nodes, {
                graphKey: `sub:${subgraphId}`,
                isTopLevel: false,
                subgraphId,
                subgraphName: String(subgraph.name || subgraph.title || '').trim(),
            });
        });
    }

    return entries;
}

function getOutputLinks(node = {}) {
    const links = [];
    for (const output of Array.isArray(node.outputs) ? node.outputs : []) {
        const values = Array.isArray(output?.links)
            ? output.links
            : output?.link != null
                ? [output.link]
                : [];
        for (const link of values) {
            if (link != null && link !== '') links.push(String(link));
        }
    }
    return links;
}

function getSerializedLinkSource(link) {
    const values = Array.isArray(link)
        ? link
        : [
            link?.id ?? link?.link_id,
            link?.origin_id ?? link?.originId ?? link?.source_id ?? link?.sourceId,
        ];
    const linkId = values[0];
    const originNodeId = values[1];
    if (linkId == null || linkId === '' || originNodeId == null || originNodeId === '') return null;
    return { linkId: String(linkId), originNodeId: String(originNodeId) };
}

function buildGraphConnections(entries, workflow = {}) {
    const sourcesByLink = new Map();
    for (const entry of entries) {
        for (const link of getOutputLinks(entry.node)) {
            sourcesByLink.set(`${entry.graphKey}:${link}`, entry.nodeKey);
        }
    }

    const entriesByNodeKey = new Map(entries.map(entry => [entry.nodeKey, entry]));
    const addSerializedLinks = (links, graphKey) => {
        for (const link of Array.isArray(links) ? links : []) {
            const serialized = getSerializedLinkSource(link);
            if (!serialized) continue;
            const sourceNodeKey = `${graphKey}:${serialized.originNodeId}`;
            if (!entriesByNodeKey.has(sourceNodeKey)) continue;
            const linkKey = `${graphKey}:${serialized.linkId}`;
            if (!sourcesByLink.has(linkKey)) sourcesByLink.set(linkKey, sourceNodeKey);
        }
    };

    addSerializedLinks(workflow.links, 'top');
    const subgraphs = Array.isArray(workflow.definitions?.subgraphs)
        ? workflow.definitions.subgraphs
        : [];
    for (const [index, subgraph] of subgraphs.entries()) {
        if (!subgraph || typeof subgraph !== 'object') continue;
        const subgraphId = String(subgraph.id ?? `index-${index}`);
        addSerializedLinks(subgraph.links, `sub:${subgraphId}`);
    }

    return { sourcesByLink };
}

function resolveRole(roleCandidates) {
    const candidates = Array.from(new Set(roleCandidates)).filter(Boolean);
    return {
        role: candidates.length === 1 ? candidates[0] : 'unknown',
        roleCandidates: candidates,
    };
}

function getNodeRoleCandidates(entry) {
    const node = entry.node;
    const candidates = [];
    for (const label of [
        node.title,
        node.name,
        node.properties?.['Node name for S&R'],
        node.properties?.node_name,
        node.properties?.nodeName,
        node.type,
    ]) {
        const role = getRoleFromLabel(label);
        if (role) candidates.push(role);
    }

    return candidates;
}

function isDedicatedTextNode(node = {}) {
    const nodeType = String(node.type || node.comfyClass || '').trim();
    return PROMPT_NODE_TYPE_PATTERN.test(nodeType);
}

function isPromptPathInput(entry, input = {}) {
    const name = normalizePromptName(getInputName(input));
    const type = normalizeWidgetType(input.type);
    if (!name && !type) return false;
    if (NON_PROMPT_WIDGET_NAME_PATTERN.test(name)) return false;
    if (
        type === 'INT'
        || type === 'FLOAT'
        || type === 'BOOLEAN'
        || type === 'COMBO'
        || type === 'DROPDOWN'
        || type === 'ENUM'
        || type === 'LIST'
        || type === 'NUMBER'
        || type === 'SELECT'
        || type === 'SLIDER'
        || type === 'CLIP'
        || type === 'MODEL'
        || type === 'VAE'
        || type === 'IMAGE'
        || type === 'LATENT'
        || type === 'MASK'
        || type === 'CONTROL_NET'
        || type === 'NOISE'
        || type === 'SIGMAS'
        || type === 'SAMPLER'
        || type === 'GUIDER'
    ) {
        return false;
    }

    return Boolean(
        getRoleFromLabel(name)
        || isPromptInputName(name)
        || name.includes('conditioning')
        || type === 'STRING'
        || type === 'TEXT'
        || type.includes('STRING')
        || type.includes('TEXT')
        || type.includes('CONDITIONING')
        || (isDedicatedTextNode(entry.node) && Boolean(name))
    );
}

function addRoleCandidate(roleCandidatesByNodeKey, nodeKey, role) {
    if (!role) return;
    const candidates = roleCandidatesByNodeKey.get(nodeKey) || [];
    if (!candidates.includes(role)) candidates.push(role);
    roleCandidatesByNodeKey.set(nodeKey, candidates);
}

function buildRoleCandidatesFromGraph(entries, sourcesByLink) {
    const roleCandidatesByNodeKey = new Map();
    for (const entry of entries) {
        roleCandidatesByNodeKey.set(entry.nodeKey, getNodeRoleCandidates(entry));
    }

    const entriesByNodeKey = new Map(entries.map(entry => [entry.nodeKey, entry]));
    const visitUpstream = (startEntry, role) => {
        const queue = [startEntry];
        const visited = new Set();
        while (queue.length) {
            const entry = queue.shift();
            if (!entry || visited.has(entry.nodeKey)) continue;
            visited.add(entry.nodeKey);
            addRoleCandidate(roleCandidatesByNodeKey, entry.nodeKey, role);

            for (const input of Array.isArray(entry.node.inputs) ? entry.node.inputs : []) {
                if (input?.link == null || input.link === '' || !isPromptPathInput(entry, input)) continue;
                const sourceNodeKey = sourcesByLink.get(`${entry.graphKey}:${String(input.link)}`);
                const sourceEntry = entriesByNodeKey.get(sourceNodeKey);
                if (sourceEntry && !visited.has(sourceEntry.nodeKey)) queue.push(sourceEntry);
            }
        }
    };

    for (const entry of entries) {
        for (const input of Array.isArray(entry.node.inputs) ? entry.node.inputs : []) {
            const role = getRoleFromLabel(getInputName(input));
            if (!role || input?.link == null || input.link === '') continue;
            const sourceNodeKey = sourcesByLink.get(`${entry.graphKey}:${String(input.link)}`);
            const sourceEntry = entriesByNodeKey.get(sourceNodeKey);
            if (sourceEntry) visitUpstream(sourceEntry, role);
        }
    }

    return roleCandidatesByNodeKey;
}

function normalizeWidgetType(value) {
    const rawValue = Array.isArray(value) ? value[0] : value;
    return String(rawValue ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_');
}

function getDescriptorWidgetType(descriptor = {}) {
    return normalizeWidgetType(
        descriptor.input?.type
        || descriptor.widget?.type
        || descriptor.input?.widget?.type
        || descriptor.input?.widget?.widget_type
        || descriptor.input?.widget?.widgetType
    );
}

function hasWidgetChoices(descriptor = {}) {
    return [descriptor.input, descriptor.widget, descriptor.input?.widget]
        .some(source => Array.isArray(source?.options) && source.options.length > 0);
}

function isNonTextWidgetType(type) {
    return NON_TEXT_WIDGET_TYPES.has(type)
        || type.includes('COMBO')
        || type.includes('DROPDOWN')
        || type.includes('ENUM')
        || type.includes('LIST')
        || type.includes('SELECT')
        || type.includes('SLIDER');
}

function isTextLikeDescriptor(descriptor = {}) {
    const type = getDescriptorWidgetType(descriptor);
    return TEXT_WIDGET_TYPES.has(type)
        || type.includes('STRING')
        || type.includes('TEXT')
        || (!type && typeof descriptor.value === 'string');
}

function isPromptTextDescriptor(descriptor = {}, { node = {}, hasGraphPromptRole = false } = {}) {
    const name = normalizePromptName(descriptor.name);
    const type = getDescriptorWidgetType(descriptor);
    const hasExplicitPromptName = Boolean(
        getRoleFromLabel(descriptor.name)
        || PROMPT_WIDGET_NAMES.has(name)
        || PROMPT_INPUT_NAMES.has(name)
        || name.includes('prompt')
        || name.startsWith('text_')
        || name.endsWith('_text')
        || name.startsWith('string_')
        || name.endsWith('_string')
    );
    if (isNonTextWidgetType(type) || hasWidgetChoices(descriptor)) return false;
    if (NON_PROMPT_WIDGET_NAME_PATTERN.test(name)) return false;

    return hasExplicitPromptName
        || (isTextLikeDescriptor(descriptor) && (
            isDedicatedTextNode(node)
            || hasGraphPromptRole
        ));
}

function getPromptLabelScore(value, role = '') {
    const label = String(value ?? '').trim();
    const token = normalizePromptName(label);
    if (!token) return 0;

    let score = 0;
    if (role && getRoleFromLabel(label) === role) score += 180;
    if (token.includes('prompt')) score += 110;
    if (token === 'text' || token.includes('text') || token === 'string' || token.includes('string')) score += 35;
    return score;
}

function getPromptNodeTypeScore(value) {
    const nodeType = String(value ?? '').trim();
    return PROMPT_NODE_TYPE_SCORE_RULES.find(rule => rule.pattern.test(nodeType))?.score || 0;
}

export function getPromptCandidateScore(prompt = {}, role = '') {
    const requestedRole = String(role || '').trim();
    const roleCandidates = Array.isArray(prompt.role_candidates)
        ? prompt.role_candidates
        : [];
    let score = 0;

    if (requestedRole && prompt.role === requestedRole) score += 1000;
    else if (requestedRole && roleCandidates.includes(requestedRole)) score += 650;

    score += getPromptNodeTypeScore(prompt.node_type);
    score += getPromptLabelScore(prompt.node_title, requestedRole);
    score += getPromptLabelScore(prompt.widget_name, requestedRole);
    return score;
}

export function sortPromptCandidates(prompts = [], role = '') {
    if (!Array.isArray(prompts)) return [];

    return prompts
        .map((prompt, index) => ({
            prompt,
            index,
            score: getPromptCandidateScore(prompt, role),
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ prompt }) => prompt);
}

function promptIdentity(entry, descriptor) {
    return `${entry.graphKey}:${String(entry.node.id)}:${descriptor.index}:${normalizePromptName(descriptor.name)}`;
}

function findWorkflowNodeForPrompt(workflow = {}, prompt = {}) {
    const nodeId = String(prompt.node_id ?? '');
    if (!nodeId) return null;

    if (prompt.is_top_level !== false) {
        return (workflow.nodes || []).find(node => String(node?.id) === nodeId) || null;
    }

    const subgraphId = String(prompt.subgraph_id || '');
    const subgraphs = Array.isArray(workflow.definitions?.subgraphs)
        ? workflow.definitions.subgraphs
        : [];
    return subgraphs
        .find(subgraph => String(subgraph?.id ?? '') === subgraphId)
        ?.nodes?.find(node => String(node?.id) === nodeId) || null;
}

function getNodeWidgetValue(node = {}, name = '', index = -1) {
    if (name && node.widgets_values_named && typeof node.widgets_values_named === 'object') {
        if (Object.prototype.hasOwnProperty.call(node.widgets_values_named, name)) {
            const v = node.widgets_values_named[name];
            if (v != null) return String(v);
        }
    }
    if (Array.isArray(node.widgets_values) && index >= 0 && index < node.widgets_values.length) {
        const v = node.widgets_values[index];
        if (v != null) return String(v);
    }
    return '';
}

function resolveUpstreamPromptText(entry, linkId, entriesByNodeKey, sourcesByLink, visited = new Set(), depth = 0) {
    if (!linkId || depth > 10) return '';
    const sourceNodeKey = sourcesByLink.get(`${entry.graphKey}:${String(linkId)}`);
    if (!sourceNodeKey || visited.has(sourceNodeKey)) return '';
    visited.add(sourceNodeKey);

    const sourceEntry = entriesByNodeKey.get(sourceNodeKey);
    if (!sourceEntry) return '';
    const node = sourceEntry.node;
    if (!node || typeof node !== 'object') return '';

    const nodeType = String(node.type || node.comfyClass || '').trim();

    // StringConcatenate / text concat / combine nodes
    if (/(?:string|text).*(?:concat|combine)/i.test(nodeType)) {
        const inputA = (node.inputs || []).find(i => /^(?:string|text)[_-]?a$/i.test(getInputName(i)));
        const stringA = (inputA && inputA.link != null && inputA.link !== '')
            ? resolveUpstreamPromptText(sourceEntry, inputA.link, entriesByNodeKey, sourcesByLink, visited, depth + 1)
            : getNodeWidgetValue(node, 'string_a', 0);

        const inputB = (node.inputs || []).find(i => /^(?:string|text)[_-]?b$/i.test(getInputName(i)));
        const stringB = (inputB && inputB.link != null && inputB.link !== '')
            ? resolveUpstreamPromptText(sourceEntry, inputB.link, entriesByNodeKey, sourcesByLink, visited, depth + 1)
            : getNodeWidgetValue(node, 'string_b', 1);

        const delimiter = getNodeWidgetValue(node, 'delimiter', 2);
        if (stringA && stringB) return `${stringA}${delimiter}${stringB}`;
        return stringA || stringB || '';
    }

    // Generic text/string nodes
    for (const key of ['text', 'string', 'value', 'prompt']) {
        const inputKey = (node.inputs || []).find(i => normalizePromptName(getInputName(i)) === key);
        if (inputKey && inputKey.link != null && inputKey.link !== '') {
            const resolved = resolveUpstreamPromptText(sourceEntry, inputKey.link, entriesByNodeKey, sourcesByLink, visited, depth + 1);
            if (resolved) return resolved;
        }
        const val = getNodeWidgetValue(node, key, 0);
        if (val && String(val).trim()) return String(val);
    }

    if (Array.isArray(node.widgets_values)) {
        for (let i = 0; i < node.widgets_values.length; i++) {
            const v = node.widgets_values[i];
            if (typeof v === 'string' && v.trim()) return v;
        }
    }

    return '';
}

export function extractWorkflowPrompts(workflow = {}) {
    const entries = collectWorkflowNodeEntries(workflow);
    if (!entries.length) return [];

    const { sourcesByLink } = buildGraphConnections(entries, workflow);
    const roleCandidatesByNodeKey = buildRoleCandidatesFromGraph(entries, sourcesByLink);
    const entriesByNodeKey = new Map(entries.map(e => [e.nodeKey, e]));

    const prompts = [];
    for (const entry of entries) {
        const node = entry.node;
        const descriptors = getWidgetDescriptors(node);
        const nodeRoleCandidates = roleCandidatesByNodeKey.get(entry.nodeKey) || [];
        const stringDescriptorCount = descriptors.filter(descriptor => (
            descriptor && typeof descriptor.value === 'string'
        )).length;

        for (const descriptor of descriptors) {
            if (!descriptor || typeof descriptor.value !== 'string') continue;
            const text = descriptor.value;

            const isUnnamedTextFallback = !descriptor.name
                && !descriptor.input
                && (isDedicatedTextNode(node) || (stringDescriptorCount === 1 && nodeRoleCandidates.length === 1));
            const candidate = Boolean(
                isPromptTextDescriptor(descriptor, {
                    node,
                    hasGraphPromptRole: nodeRoleCandidates.length > 0,
                })
                || isUnnamedTextFallback
            );
            if (!candidate) continue;

            const combinedRole = resolveRole([
                ...nodeRoleCandidates,
                getRoleFromLabel(descriptor.name),
            ]);
            const widgetInput = descriptor.input || getWidgetInput(node, descriptor.index, descriptor.name);
            const isLinked = Boolean(
                widgetInput
                && widgetInput.link != null
                && widgetInput.link !== ''
            );
            const resolvedText = isLinked
                ? resolveUpstreamPromptText(entry, widgetInput.link, entriesByNodeKey, sourcesByLink)
                : '';
            const finalPromptText = (text && text.trim()) ? text : (resolvedText || text);

            prompts.push({
                id: promptIdentity(entry, descriptor),
                node_id: node.id,
                node_type: String(node.type || node.comfyClass || '').trim(),
                node_title: String(node.title || '').trim(),
                widget_index: descriptor.index,
                widget_name: descriptor.name,
                text: finalPromptText,
                role: combinedRole.role,
                role_candidates: combinedRole.roleCandidates,
                is_top_level: entry.isTopLevel,
                subgraph_id: entry.subgraphId,
                subgraph_name: entry.subgraphName,
                linked: isLinked,
                has_resolved_text: Boolean(resolvedText),
            });
        }
    }

    return prompts;
}

export function updateWorkflowPromptValue(workflow, prompt = {}, value = '') {
    if (!workflow || !prompt || prompt.linked) return false;

    const node = findWorkflowNodeForPrompt(workflow, prompt);
    const widgetIndex = Number(prompt.widget_index);
    if (!node || !Array.isArray(node.widgets_values) || !Number.isInteger(widgetIndex) || widgetIndex < 0) {
        return false;
    }

    const widgetInput = getWidgetInput(node, widgetIndex, prompt.widget_name);
    if (widgetInput && widgetInput.link != null && widgetInput.link !== '') return false;

    const nextValue = String(value ?? '');
    node.widgets_values[widgetIndex] = nextValue;
    if (
        prompt.widget_name
        && node.widgets_values_named
        && typeof node.widgets_values_named === 'object'
        && Object.prototype.hasOwnProperty.call(node.widgets_values_named, prompt.widget_name)
    ) {
        node.widgets_values_named[prompt.widget_name] = nextValue;
    }
    return true;
}

export function getPromptRoleLabel(role) {
    if (role === 'positive') return 'Positive prompt';
    if (role === 'negative') return 'Negative prompt';
    return 'Unclassified prompt';
}
