function normalizeIdentity(value) {
    return String(value ?? '').trim().replaceAll('\\', '/').toLowerCase();
}

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
    return source.split(/[\\/]/).pop() || source;
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
        return normalizeIdentity(model.original_path) === normalizeIdentity(reference.original_path);
    }

    return true;
}

export function getResolvedModelsForNode(data = {}, nodeId, scope = {}) {
    const nodeReference = {
        node_id: nodeId,
        is_top_level: scope.is_top_level,
        subgraph_id: scope.subgraph_id,
    };

    return (data.resolved_models || [])
        .filter(isExistingResolvedModel)
        .filter(model => matchesWorkflowModelReference(model, nodeReference))
        .sort((left, right) => {
            const widgetOrder = Number(left.widget_index ?? 0) - Number(right.widget_index ?? 0);
            if (widgetOrder) return widgetOrder;
            return getResolvedModelMenuLabel(left).localeCompare(getResolvedModelMenuLabel(right));
        });
}

export function buildModelResolverNodeMenu(models = [], handlers = {}, options = {}) {
    const resolvedModels = models.filter(isExistingResolvedModel);
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
