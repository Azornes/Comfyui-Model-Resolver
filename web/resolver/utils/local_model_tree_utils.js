import { getSvgIcon } from "../../utils/icon_utils.js";
import { escapeHtml, normalizePathIdentity } from "./html_utils.js";
import { joinPathPreservingStyle } from "./path_utils.js";

/**
 * Normalizes model path to use forward slashes and trims empty segments.
 */
export function normalizeModelPath(value = '', normalizePathToForward = null) {
    const forward = typeof normalizePathToForward === 'function'
        ? normalizePathToForward(value)
        : String(value || '').replace(/\\/g, '/');
    return forward
        .split('/')
        .map(part => part.trim())
        .filter(Boolean)
        .join('/');
}

/**
 * Computes deduplication identity for local model entries.
 */
export function getLocalModelDedupeIdentity(entry = {}) {
    const path = String(entry.fullPath || entry.model?.path || '').trim();
    if (path) {
        return normalizePathIdentity(path);
    }
    return [
        entry.baseDirectory || '',
        entry.relativePath || entry.model?.relative_path || entry.model?.filename || ''
    ].map(normalizePathIdentity).join('::');
}

/**
 * Ranks category priority (preferred category gets rank 0).
 */
export function getLocalModelCategoryRank(category = '', preferredCategory = '', normalizeDownloadCategory = (c => c)) {
    const normalized = normalizeDownloadCategory(category || '');
    if (normalized && normalized === preferredCategory) return 0;
    const ranks = {
        checkpoints: 10,
        loras: 10,
        vae: 10,
        diffusion_models: 10,
        text_encoders: 10,
        controlnet: 10,
        clip: 20,
        clip_gguf: 30
    };
    return ranks[normalized] ?? 40;
}

/**
 * Deduplicates local model entries across multiple directories or categories.
 */
export function dedupeLocalModelEntries(entries = [], preferredCategory = '', helpers = {}) {
    const normalizeDownloadCategory = helpers.normalizeDownloadCategory || (c => c);
    const byIdentity = new Map();
    entries.forEach(entry => {
        const identity = getLocalModelDedupeIdentity(entry);
        if (!identity) return;
        const previous = byIdentity.get(identity);
        if (!previous) {
            byIdentity.set(identity, entry);
            return;
        }
        const currentRank = getLocalModelCategoryRank(entry.category, preferredCategory, normalizeDownloadCategory);
        const previousRank = getLocalModelCategoryRank(previous.category, preferredCategory, normalizeDownloadCategory);
        if (
            currentRank < previousRank
            || (currentRank === previousRank && String(entry.category || '').localeCompare(String(previous.category || '')) < 0)
        ) {
            byIdentity.set(identity, entry);
        }
    });
    return Array.from(byIdentity.values());
}

/**
 * Transforms a raw model object into a structured entry for the tree picker.
 */
export function makeModelEntry(model, index, preferredCategory = '', helpers = {}) {
    const normalizeDownloadCategory = helpers.normalizeDownloadCategory || (c => c);
    const getCategoryDisplayName = helpers.getCategoryDisplayName || (c => c);
    const getBaseDirectoryLabel = helpers.getBaseDirectoryLabel || (d => d);
    const normalizePathToForward = helpers.normalizePathToForward;

    const rawCategory = model.category || 'unknown';
    const category = normalizeDownloadCategory(rawCategory) || 'unknown';
    const categoryLabel = getCategoryDisplayName(category);
    const relativePath = normalizeModelPath(model.relative_path || model.filename || '', normalizePathToForward);
    const pathParts = relativePath.split('/').filter(Boolean);
    const filename = pathParts.pop() || model.filename || relativePath || 'model';
    const folderPath = pathParts.join('/');
    const baseDirectory = String(model.base_directory || '');
    const fullPath = String(model.path || '');
    return {
        index,
        model,
        category,
        categoryLabel,
        relativePath: relativePath || filename,
        filename,
        folderPath,
        baseDirectory,
        baseLabel: getBaseDirectoryLabel(baseDirectory),
        fullPath,
        isPreferred: category === preferredCategory,
        searchText: [
            category,
            categoryLabel,
            relativePath,
            filename,
            folderPath,
            baseDirectory,
            fullPath
        ].join(' ').toLowerCase()
    };
}

/**
 * Builds nested folder hierarchy from a flat list of model entries.
 */
export function buildModelTree(entries = []) {
    const root = { folders: new Map(), models: [] };
    entries.forEach(entry => {
        const folderParts = entry.folderPath.split('/').filter(Boolean);
        let current = root;
        let currentPath = '';
        folderParts.forEach(part => {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            if (!current.folders.has(part)) {
                current.folders.set(part, {
                    name: part,
                    path: currentPath,
                    folders: new Map(),
                    models: []
                });
            }
            current = current.folders.get(part);
        });
        current.models.push(entry);
    });
    return root;
}

/**
 * Recursively counts models in a tree node and its descendants.
 */
export function countTreeModels(node) {
    let count = node.models?.length || 0;
    node.folders?.forEach(child => {
        count += countTreeModels(child);
    });
    return count;
}

/**
 * Returns a stable string identity for comparing model selections.
 */
export function getLocalModelIdentity(model = {}) {
    return [
        model.path || '',
        model.relative_path || '',
        model.filename || '',
        model.category || ''
    ].map(value => String(value || '').trim().toLowerCase()).join('::');
}

/**
 * Builds context object for right-click menus on folder rows.
 */
export function buildLocalFolderContext(folderPath = '', name = 'Folder', category = '') {
    const path = String(folderPath || '').trim();
    if (!path) return null;
    return {
        context_scope: 'download_folder',
        open_folder_label: 'Open Folder',
        name,
        path,
        resolved_path: path,
        open_path: path,
        folder_path: path,
        download_directory: path,
        category
    };
}

/**
 * Builds context object for right-click menus on model rows.
 */
export function buildLocalModelContext(entry = {}) {
    const model = entry.model || {};
    const path = entry.fullPath || model.path || model.resolved_path || '';
    if (!path) return null;
    const directory = entry.folderPath
        ? joinPathPreservingStyle(entry.baseDirectory, entry.folderPath)
        : entry.baseDirectory;
    return {
        ...model,
        context_scope: model.context_scope || 'local_model',
        open_folder_label: 'Containing Folder',
        name: entry.filename || model.filename || entry.relativePath || path,
        path,
        resolved_path: path,
        open_path: path,
        folder_path: directory || path,
        directory: directory || '',
        category: entry.category || model.category || ''
    };
}

/**
 * Renders individual model rows inside a folder.
 */
export function renderModelRows(entries = [], selectedIdentity = '', helpers = {}) {
    const getContextMenuAttrs = helpers.getContextMenuAttrs;
    const currentModelName = String(helpers.currentModelName || '').toLowerCase();
    const currentModelPath = String(helpers.currentModelPath || '').toLowerCase();

    return entries
        .sort((a, b) => a.filename.localeCompare(b.filename))
        .map(entry => {
            const entryIdentity = getLocalModelIdentity(entry.model);
            const selected = Boolean(selectedIdentity) && entryIdentity === selectedIdentity;
            const folderText = entry.folderPath || entry.baseLabel || '';
            const isCurrent = (currentModelName && entry.filename.toLowerCase() === currentModelName)
                || (currentModelPath && (entry.fullPath.toLowerCase() === currentModelPath || entry.relativePath.toLowerCase() === currentModelPath));

            let contextAttrs = '';
            if (typeof getContextMenuAttrs === 'function') {
                const context = buildLocalModelContext(entry);
                contextAttrs = getContextMenuAttrs(context, entry.fullPath || entry.relativePath);
            }

            return `
                <div class="mr-folder-browser-row mr-local-model-row ${selected ? 'is-selected' : ''}${isCurrent ? ' is-current' : ''}" data-browser-action="select-model" data-model-index="${entry.index}" data-model-path="${escapeHtml(entry.fullPath || entry.relativePath)}" data-model-filename="${escapeHtml(entry.filename)}"${contextAttrs}>
                    <span class="mr-folder-browser-toggle mr-folder-browser-toggle-empty"></span>
                    <span class="mr-folder-browser-folder-icon mr-local-model-file-icon">${getSvgIcon('file', 'currentColor', 'mr-folder-browser-svg')}</span>
                    <span class="mr-folder-browser-name">${escapeHtml(entry.filename)}</span>
                    ${isCurrent ? '<span class="mr-swap-current-badge">Current</span>' : ''}
                    ${folderText ? `<span class="mr-local-model-folder-tag">${escapeHtml(folderText)}</span>` : ''}
                </div>
            `;
        })
        .join('');
}

/**
 * Recursively renders tree nodes (folders and their files).
 */
export function renderModelTreeNodes(node, group, expandedSet, filter, selectedIdentity, helpers = {}) {
    const getContextMenuAttrs = helpers.getContextMenuAttrs;

    const folderHtml = Array.from(node.folders.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(folder => {
            const stateKey = `node:${group.key.toLowerCase()}:${folder.path.toLowerCase()}`;
            const modelCount = countTreeModels(folder);
            const shouldExpand = Boolean(filter) || expandedSet.has(stateKey);
            const folderFullPath = group.baseDirectory
                ? joinPathPreservingStyle(group.baseDirectory, folder.path)
                : '';

            let contextAttrs = '';
            if (typeof getContextMenuAttrs === 'function') {
                const context = buildLocalFolderContext(folderFullPath, folder.path, group.category);
                contextAttrs = getContextMenuAttrs(context, folderFullPath);
            }

            return `
                <div class="mr-folder-browser-node">
                    <div class="mr-folder-browser-row is-expandable mr-local-model-folder-row" data-browser-action="toggle" data-state-key="${encodeURIComponent(stateKey)}"${contextAttrs}>
                        <button class="mr-folder-browser-toggle ${shouldExpand ? 'is-expanded' : ''}" type="button" aria-label="${shouldExpand ? 'Collapse folder' : 'Expand folder'}"><span class="mr-folder-browser-chevron"></span></button>
                        <span class="mr-folder-browser-folder-icon">${getSvgIcon('folderOpen', 'currentColor', 'mr-folder-browser-svg')}</span>
                        <span class="mr-folder-browser-name">${escapeHtml(folder.name)}</span>
                        <span class="mr-folder-browser-count">${modelCount}</span>
                    </div>
                    <div class="mr-folder-browser-children ${shouldExpand ? 'is-expanded' : ''}">
                        ${shouldExpand ? renderModelTreeNodes(folder, group, expandedSet, filter, selectedIdentity, helpers) : ''}
                    </div>
                </div>
            `;
        })
        .join('');
    return `${renderModelRows(node.models || [], selectedIdentity, helpers)}${folderHtml}`;
}

/**
 * Builds the full folder browser HTML grouped by category/root directories.
 */
export function renderLocalModelTreeBrowser({
    allModels = [],
    preferredCategory = '',
    filterText = '',
    expandedSet = new Set(),
    selectedIdentity = '',
    helpers = {}
}) {
    const rawFilter = String(filterText || '').trim();
    const filter = rawFilter.toLowerCase();
    const tokens = filter.split(/\s+/).filter(Boolean);

    const allEntries = dedupeLocalModelEntries(
        allModels.map((model, index) => makeModelEntry(model, index, preferredCategory, helpers)),
        preferredCategory,
        helpers
    );

    const filteredEntries = allEntries.filter(entry => {
        if (!tokens.length) return true;
        return tokens.every(token => entry.searchText.includes(token));
    });

    const grouped = new Map();
    filteredEntries.forEach(entry => {
        const groupKey = `${entry.category}::${entry.baseDirectory || ''}`;
        if (!grouped.has(groupKey)) {
            grouped.set(groupKey, {
                key: groupKey,
                category: entry.category,
                label: entry.categoryLabel,
                baseDirectory: entry.baseDirectory,
                baseLabel: entry.baseLabel,
                isPreferred: entry.category === preferredCategory,
                entries: []
            });
        }
        grouped.get(groupKey).entries.push(entry);
    });

    const getContextMenuAttrs = helpers.getContextMenuAttrs;

    const groupsHtml = Array.from(grouped.values())
        .sort((a, b) => {
            if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
            const labelCompare = a.label.localeCompare(b.label);
            if (labelCompare !== 0) return labelCompare;
            return (a.baseLabel || '').localeCompare(b.baseLabel || '');
        })
        .map(group => {
            const stateKey = `root:${group.key.toLowerCase()}`;
            const collapsedStateKey = `collapsed:${stateKey}`;
            const isExpanded = Boolean(filter)
                || expandedSet.has(stateKey)
                || (group.isPreferred && !expandedSet.has(collapsedStateKey));
            const tree = buildModelTree(group.entries);

            let rootContextAttrs = '';
            if (typeof getContextMenuAttrs === 'function') {
                const rootContext = buildLocalFolderContext(
                    group.baseDirectory,
                    `${group.label} root`,
                    group.category
                );
                rootContextAttrs = getContextMenuAttrs(rootContext, group.baseDirectory || group.label);
            }

            return `
                <div class="mr-folder-browser-root ${group.isPreferred ? 'is-preferred' : ''}">
                    <button class="mr-folder-browser-root-head ${isExpanded ? 'is-expanded' : ''}" type="button" data-browser-action="toggle" data-state-key="${encodeURIComponent(stateKey)}"${rootContextAttrs}>
                        <span class="mr-folder-browser-chevron"></span>
                        <span class="mr-folder-browser-root-title">${escapeHtml(group.label)}${group.isPreferred ? ' · recommended' : ''}</span>
                        <span class="mr-folder-browser-root-count">${group.entries.length}</span>
                    </button>
                    ${group.baseDirectory ? `<div class="mr-folder-browser-root-path">${escapeHtml(group.baseDirectory)}</div>` : ''}
                    <div class="mr-folder-browser-tree ${isExpanded ? 'is-expanded' : ''}">
                        ${isExpanded ? renderModelTreeNodes(tree, group, expandedSet, filter, selectedIdentity, helpers) : ''}
                    </div>
                </div>
            `;
        })
        .join('');

    const emptyHtml = tokens.length
        ? `<div class="mr-folder-browser-empty">No local models match this filter.</div>`
        : `<div class="mr-folder-browser-empty">No local models available.</div>`;

    return {
        html: `
            <div class="mr-local-model-browser-scroll">
                ${groupsHtml || emptyHtml}
            </div>
        `,
        allEntries,
        filteredEntries
    };
}
