import { getFilenameFromPath, normalizePathIdentity } from './utils/html_utils.js';

function getResolvedModelPath(model = {}) {
    return String(model.full_path || model.path || model.resolved_path || '').trim();
}

function getResolvedModelFilename(model = {}) {
    const source = String(
        model.name
        || model.filename
        || model.original_path
        || model.relative_path
        || getResolvedModelPath(model)
        || 'Resolved model'
    );
    return getFilenameFromPath(source) || source;
}

function getResolvedModelCategoryLabel(model = {}, formatCategory = null) {
    const category = String(model.category || 'unknown').trim() || 'unknown';
    const formatted = typeof formatCategory === 'function'
        ? formatCategory(category)
        : category.replaceAll('_', ' ');
    return String(formatted || category).toUpperCase();
}

function getResolvedModelMenuLabel(model = {}, formatCategory = null) {
    const category = getResolvedModelCategoryLabel(model, formatCategory);
    const widgetName = String(model.widget_name || '').trim();
    const filename = getResolvedModelFilename(model);
    const slot = widgetName ? `${category} · ${widgetName}` : category;
    return `${slot} — ${filename}`;
}

function getWidgetChoiceValue(choice) {
    if (choice && typeof choice === 'object') {
        return choice.value ?? choice.name ?? choice.label ?? '';
    }
    return choice;
}

function isCurrentWidgetSelection(widget, value) {
    const normalizedValue = normalizePathIdentity(value);
    if (!normalizedValue || ['none', 'null', 'undefined'].includes(normalizedValue)) {
        return false;
    }

    const choices = widget?.options?.values;
    if (!Array.isArray(choices) || !choices.length) {
        return true;
    }
    return choices.some(choice => (
        normalizePathIdentity(getWidgetChoiceValue(choice)) === normalizedValue
    ));
}

function createModelActions(model, handlers = {}) {
    return [
        {
            content: 'Show in Model Resolver',
            callback: () => handlers.showInResolver?.(model),
        },
        {
            content: 'Show info',
            callback: () => handlers.showInfo?.(model),
        },
        {
            content: 'Open containing folder',
            callback: () => handlers.openContainingFolder?.(model),
        },
    ];
}

export function isExistingResolvedModel(model = {}) {
    return model.exists === true && Boolean(getResolvedModelPath(model));
}

export function matchesWorkflowModelReference(model = {}, reference = {}) {
    if (String(model.node_id ?? '') !== String(reference.node_id ?? '')) {
        return false;
    }

    if (
        reference.widget_index !== undefined
        && reference.widget_index !== null
        && String(model.widget_index ?? '') !== String(reference.widget_index)
    ) {
        return false;
    }

    if (
        reference.is_top_level !== undefined
        && reference.is_top_level !== null
        && Boolean(model.is_top_level) !== Boolean(reference.is_top_level)
    ) {
        return false;
    }

    if (
        reference.subgraph_id
        && String(model.subgraph_id || '') !== String(reference.subgraph_id)
    ) {
        return false;
    }

    if (reference.original_path) {
        return normalizePathIdentity(model.original_path) === normalizePathIdentity(reference.original_path);
    }

    return true;
}

export function getResolvedModelsForNode(data = {}, nodeId, scope = {}) {
    const nodeReference = {
        node_id: nodeId,
        is_top_level: scope.is_top_level,
        subgraph_id: scope.subgraph_id,
    };

    const directModels = (data.resolved_models || [])
        .filter(isExistingResolvedModel)
        .filter(model => matchesWorkflowModelReference(model, nodeReference))
    if (!scope.is_subgraph_instance) {
        return sortResolvedModels(directModels);
    }

    return getModelsForSubgraphInstance(data, nodeId, scope, {
        directModels,
    });
}

export function getImmediateModelsForNode(data = {}, node = {}, scope = {}) {
    if (scope.is_subgraph_instance) {
        return getModelsForSubgraphInstance(data, node?.id, scope, {
            includeMissing: true,
        });
    }

    const references = [
        ...(data.resolved_models || []),
        ...(data.missing_models || []),
    ].filter(model => (
        (!model.node_type || !node?.type || model.node_type === node.type)
        && matchesWorkflowModelReference(model, {
            node_id: node?.id,
            is_top_level: scope.is_top_level,
            subgraph_id: scope.subgraph_id,
        })
    ));
    const modelsByWidget = new Map();

    for (const reference of references) {
        const widgetIndex = Number(reference.widget_index);
        if (!Number.isInteger(widgetIndex) || modelsByWidget.has(widgetIndex)) continue;

        const widget = node?.widgets?.[widgetIndex];
        const currentValue = widget?.value;
        if (typeof currentValue !== 'string') continue;
        if (!isCurrentWidgetSelection(widget, currentValue)) continue;

        if (normalizePathIdentity(currentValue) === normalizePathIdentity(reference.original_path)) {
            if (isExistingResolvedModel(reference)) {
                modelsByWidget.set(widgetIndex, reference);
            }
            continue;
        }

        modelsByWidget.set(widgetIndex, {
            ...reference,
            name: String(currentValue),
            filename: getResolvedModelFilename({ original_path: currentValue }),
            original_path: String(currentValue),
            full_path: '',
            path: '',
            resolved_path: '',
            exists: false,
            resolution_pending: true,
        });
    }

    return [...modelsByWidget.values()].sort((left, right) => (
        Number(left.widget_index ?? 0) - Number(right.widget_index ?? 0)
    ));
}

function sortResolvedModels(models = []) {
    return [...models].sort((left, right) => {
        const widgetOrder = Number(left.widget_index ?? 0) - Number(right.widget_index ?? 0);
        if (widgetOrder) return widgetOrder;
        return getResolvedModelMenuLabel(left).localeCompare(getResolvedModelMenuLabel(right));
    });
}

function getSubgraphModelReferenceKey(model = {}) {
    return [
        model.is_top_level !== false ? 'top' : 'nested',
        model.subgraph_id || '',
        model.node_id ?? '',
        model.widget_index ?? '',
        normalizePathIdentity(model.original_path || model.name || ''),
    ].join('|');
}

function getMissingModelReferences(data = {}) {
    const references = [];
    for (const missing of data.missing_models || []) {
        const nodeReferences = Array.isArray(missing?.all_node_refs)
            && missing.all_node_refs.length
            ? missing.all_node_refs
            : [missing];
        for (const reference of nodeReferences) {
            references.push({
                ...missing,
                ...reference,
                full_path: '',
                path: '',
                resolved_path: '',
                exists: false,
                resolution_pending: true,
            });
        }
    }
    return references;
}

export function getModelsForSubgraphInstance(
    data = {},
    nodeId,
    scope = {},
    { directModels = null, includeMissing = false } = {},
) {
    const instanceSubgraphId = String(scope.subgraph_instance_id || '').trim();
    if (!instanceSubgraphId) return [];

    const direct = directModels || (data.resolved_models || [])
        .filter(isExistingResolvedModel)
        .filter(model => matchesWorkflowModelReference(model, {
            node_id: nodeId,
            is_top_level: scope.is_top_level,
            subgraph_id: scope.subgraph_id,
        }));
    const directPromotedInnerKeys = new Set(
        direct
            .filter(model => model.promoted_inner_node_id !== undefined)
            .map(model => [
                instanceSubgraphId,
                model.promoted_inner_node_id,
                model.promoted_inner_widget_index,
            ].join('|'))
    );
    const nested = (data.resolved_models || [])
        .filter(isExistingResolvedModel)
        .filter(model => (
            model.is_top_level === false
            && String(model.subgraph_id || '') === instanceSubgraphId
            && !directPromotedInnerKeys.has([
                instanceSubgraphId,
                model.node_id,
                model.widget_index,
            ].join('|'))
        ));

    const models = [...direct, ...nested];
    if (includeMissing) {
        const missing = getMissingModelReferences(data).filter(model => {
            const isDirect = (
                String(model.node_id ?? '') === String(nodeId ?? '')
                && Boolean(model.is_top_level !== false) === Boolean(scope.is_top_level)
                && String(model.subgraph_id || '') === String(scope.subgraph_id || '')
            );
            const isNested = (
                model.is_top_level === false
                && String(model.subgraph_id || '') === instanceSubgraphId
            );
            return isDirect || isNested;
        });
        models.push(...missing);
    }

    const uniqueModels = [];
    const seen = new Set();
    for (const model of models) {
        const key = getSubgraphModelReferenceKey(model);
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueModels.push(model);
    }
    return sortResolvedModels(uniqueModels);
}

export function buildModelResolverNodeMenu(models = [], handlers = {}, options = {}) {
    const resolvedModels = models.filter(model => (
        isExistingResolvedModel(model) || model.resolution_pending === true
    ));
    if (!resolvedModels.length) return null;

    const submenuOptions = resolvedModels.length === 1
        ? createModelActions(resolvedModels[0], handlers)
        : resolvedModels.map(model => ({
            title: getResolvedModelMenuLabel(model, options.formatCategory),
            has_submenu: true,
            submenu: {
                options: createModelActions(model, handlers),
            },
        }));

    return {
        title: 'Model Resolver',
        className: 'mdi mdi-link-variant mr-model-resolver-node-menu',
        has_submenu: true,
        submenu: {
            options: submenuOptions,
        },
    };
}

export function toResolverContextModel(model = {}) {
    const path = getResolvedModelPath(model);
    const filename = getResolvedModelFilename(model);
    return {
        ...model,
        name: model.name || filename,
        filename,
        path,
        resolved_path: path,
        relative_path: model.relative_path || model.original_path || filename,
        context_scope: 'local_model',
    };
}
