import { getSvgIcon } from "../../utils/icon_utils.js";
import { createFloatingTreePicker } from "../utils/tree_picker.js";
import { startSplitterDrag } from "../utils/splitter_drag.js";
import { getCivitaiModelUrl } from "../globals.js";
import { safeStorage, normalizePathIdentity } from "../utils/html_utils.js";
import { matchesWorkflowModelReference } from "../node_context_menu.js";

const MISSING_ROW_FALLBACK_HEIGHT = 70;
const MISSING_VIRTUAL_INITIAL_ROWS = 24;
const MISSING_VIRTUAL_OVERSCAN_ROWS = 6;

export const missingBrowserMethods = {
    getMissingFilename(missing = {}) {
        return this.getFilenameFromPath(missing.original_path) || missing.name || 'Missing model';
    },

    renderMissingModelFormatBadges(missing = {}) {
        const acceptedTypes = this.getMissingAcceptedModelFileTypes?.(missing) || [];
        return acceptedTypes.map(type => {
            const label = String(type?.label || type?.extension || '').trim();
            if (!label) return '';
            const display = String(type?.display || label).trim();
            const tooltip = `Accepted file format for this node: ${display}.`;
            return `<span class="mr-category-chip mr-model-format-chip" data-tooltip="${this.escapeHtml(tooltip)}">${this.escapeHtml(label)}</span>`;
        }).join('');
    },

    getMissingLocateTarget(missing = {}) {
        const hasLocateNode = missing.locate_node_id !== undefined
            && missing.locate_node_id !== null
            && missing.locate_node_id !== '';
        const nodeId = hasLocateNode ? missing.locate_node_id : missing.node_id;
        return {
            nodeId: nodeId ?? '',
            nodeType: hasLocateNode ? (missing.locate_node_type || missing.node_type || '') : (missing.node_type || ''),
            nodeTitle: hasLocateNode ? (missing.locate_node_title || '') : (missing.node_title || ''),
            subgraphId: hasLocateNode ? (missing.locate_subgraph_id || '') : (missing.subgraph_id || ''),
            subgraphName: hasLocateNode ? (missing.locate_subgraph_name || missing.subgraph_name || '') : (missing.subgraph_name || ''),
            isTopLevel: hasLocateNode ? missing.locate_is_top_level !== false : missing.is_top_level !== false
        };
    },

    getMissingReferenceCount(missing = {}) {
        if (Array.isArray(missing.all_node_refs) && missing.all_node_refs.length > 0) {
            return missing.all_node_refs.length;
        }

        const count = Number(missing.reference_count || 0);
        return Number.isFinite(count) && count > 0 ? count : 1;
    },

    getMissingNodeDisplay(missing = {}) {
        const locateTarget = this.getMissingLocateTarget(missing);
        const isSubgraphNode = locateTarget.nodeType && locateTarget.nodeType.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        let nodeLabel;
        if (locateTarget.subgraphName) {
            nodeLabel = locateTarget.subgraphName;
        } else if (isSubgraphNode) {
            nodeLabel = 'Subgraph';
        } else {
            nodeLabel = locateTarget.nodeType || 'Node';
        }

        const nodeId = locateTarget.nodeId ?? '';
        const promotedDetail = missing.locate_via_promoted_widget
            ? (missing.node_title || missing.node_type || '')
            : (missing.promoted_inner_node_title || missing.promoted_inner_node_type || '');
        const customNodeTitle = String(promotedDetail || locateTarget.nodeTitle || missing.node_title || '').trim();
        const hasCustomNodeTitle = customNodeTitle && customNodeTitle !== nodeLabel;
        const baseText = hasCustomNodeTitle
            ? `${nodeLabel} #${nodeId} · ${customNodeTitle}`
            : `${nodeLabel} #${nodeId}`;
        const referenceCount = this.getMissingReferenceCount(missing);
        const extraReferenceCount = Math.max(0, referenceCount - 1);
        const text = extraReferenceCount > 0
            ? `${baseText} + ${extraReferenceCount} ref${extraReferenceCount === 1 ? '' : 's'}`
            : baseText;
        const locateTooltip = missing.locate_via_promoted_widget
            ? 'Center this subgraph node in the ComfyUI graph.'
            : locateTarget.isTopLevel === false
            ? 'Open this subgraph and center the node in the ComfyUI graph.'
            : 'Center this node in the ComfyUI graph.';

        return {
            label: nodeLabel,
            text,
            canLocate: nodeId !== '',
            locateTarget,
            referenceCount,
            locateTooltip: extraReferenceCount > 0
                ? `${locateTooltip} This missing model is used by ${referenceCount} workflow references; this centers the first one.`
                : locateTooltip
        };
    },

    getMissingSupportedFolderCategories(missing = {}) {
        const categories = [];
        const addCategory = (value) => {
            if (value === undefined || value === null || String(value).trim() === '') return;
            if (Array.isArray(value)) {
                value.forEach(addCategory);
                return;
            }
            String(value).split(/[,|;]/).forEach(part => {
                const normalized = this.normalizeDownloadCategory?.(part) || String(part || '').trim();
                if (
                    normalized
                    && normalized !== 'unknown'
                    && !categories.includes(normalized)
                ) {
                    categories.push(normalized);
                }
            });
        };

        addCategory(this.getMissingSupportedDownloadCategories?.(missing) || []);
        if (!categories.length) {
            addCategory(missing.category_hints);
            addCategory(missing.categoryHints);
            addCategory(missing.model_widget_category_hints);
            addCategory(missing.modelWidgetCategoryHints);
            addCategory(missing.supported_categories);
            addCategory(missing.supportedCategories);
            addCategory(missing.category);
        }
        return categories;
    },

    getMissingSupportedFolderKeys(missing = {}) {
        const keys = [];
        const addKey = (value) => {
            if (value === undefined || value === null || String(value).trim() === '') return;
            if (Array.isArray(value)) {
                value.forEach(addKey);
                return;
            }
            String(value).split(/[,|;]/).forEach(part => {
                const key = String(part || '').trim();
                if (key && key !== 'unknown' && !keys.includes(key)) {
                    keys.push(key);
                }
            });
        };

        addKey(missing.folder_key_hints);
        addKey(missing.folderKeyHints);
        addKey(missing.model_widget_folder_key_hints);
        addKey(missing.modelWidgetFolderKeyHints);

        if (keys.length) {
            const nodeCategory = this.getMissingNodeTypeDownloadCategory?.(missing) || '';
            if (nodeCategory) {
                const filteredKeys = keys.filter(key => (
                    (this.normalizeDownloadCategory?.(key) || key) === nodeCategory
                ));
                if (filteredKeys.length) return filteredKeys;
            }
            return keys;
        }

        return this.getMissingSupportedFolderCategories(missing);
    },

    normalizeMissingFolderRootPath(folderKey = '', path = '') {
        const cleanPath = String(path || '').trim();
        if (!cleanPath) return '';

        const normalizedCategory = this.normalizeDownloadCategory?.(folderKey) || folderKey;
        const rawKey = String(folderKey || '').trim();
        if (!normalizedCategory || normalizedCategory === rawKey) {
            return cleanPath;
        }

        const usesBackslash = cleanPath.includes('\\');
        const normalizedPath = this.normalizePathToForward(cleanPath).replace(/\/+$/g, '');
        const parts = normalizedPath.split('/').filter(Boolean);
        const leaf = (parts[parts.length - 1] || '').toLowerCase();
        const parent = (parts[parts.length - 2] || '').toLowerCase();
        const canonicalLeaf = String(normalizedCategory || '').toLowerCase();
        const rawSuffix = rawKey.toLowerCase().startsWith(`${canonicalLeaf}_`)
            ? rawKey.slice(canonicalLeaf.length + 1).toLowerCase()
            : '';

        if (rawSuffix && leaf === rawSuffix && parent === canonicalLeaf) {
            const parentPath = parts.slice(0, -1).join('/');
            return usesBackslash ? this.normalizePathToBackward(parentPath) : parentPath;
        }
        return cleanPath;
    },

    getMissingSupportedFolderDetails(missing = {}) {
        const folderKeys = this.getMissingSupportedFolderKeys(missing);
        const seenPaths = new Set();
        const details = [];

        // Uses imported normalizePathIdentity from html_utils.js

        folderKeys.forEach(folderKey => {
            const normalizedCategory = this.normalizeDownloadCategory?.(folderKey) || folderKey;
            const label = this.getCategoryDisplayName?.(normalizedCategory) || folderKey;
            const roots = this.downloadRootDirectories?.[folderKey]
                || this.downloadRootDirectories?.[normalizedCategory];
            const paths = Array.isArray(roots)
                ? roots
                : (roots ? [roots] : []);

            if (!paths.length) {
                details.push({
                    category: normalizedCategory,
                    folderKey,
                    label,
                    path: '',
                    display: label && label !== folderKey ? `${label} (${folderKey})` : folderKey
                });
                return;
            }

            paths.forEach(path => {
                const cleanPath = this.normalizeMissingFolderRootPath(folderKey, path);
                if (!cleanPath) return;
                const identity = `${normalizedCategory}::${normalizePathIdentity(cleanPath)}`;
                if (seenPaths.has(identity)) return;
                seenPaths.add(identity);
                details.push({
                    category: normalizedCategory,
                    folderKey,
                    label,
                    path: cleanPath,
                    display: `${label}: ${cleanPath}`
                });
            });
        });

        return details;
    },

    renderMissingNodeFolderBadge(missing = {}) {
        const details = this.getMissingSupportedFolderDetails(missing);
        if (!details.length) return '';

        const folderCount = details.length;
        const tooltip = folderCount === 1
            ? `This node reads models from 1 folder:\n${details[0].display}`
            : `This node reads models from ${folderCount} folders:\n${details.map(detail => detail.display).join('\n')}`;
        const ariaLabel = folderCount === 1
            ? `This node reads models from 1 folder`
            : `This node reads models from ${folderCount} folders`;

        return `<span class="mr-node-folder-count-badge" data-tooltip="${this.escapeHtml(tooltip)}" tabindex="0" aria-label="${this.escapeHtml(ariaLabel)}">${this.escapeHtml(String(folderCount))}</span>`;
    },

    renderMissingAutoDownloadBadge(missing = {}, options = {}) {
        if (!missing?.auto_download_capable && !missing?.auto_download_candidate) return '';

        const source = String(missing.input_choice_source || '').toLowerCase();
        const sourceLabel = source === 'hybrid'
            ? 'hybrid preset/folder list'
            : source === 'workflow_schema'
                ? 'workflow model widget'
                : 'preset list';
        const isCandidate = Boolean(missing.auto_download_candidate);
        const tooltip = isCandidate
            ? `This value comes from the custom node ${sourceLabel}, but the file was not found in local model folders.\nThe node may download it automatically when the workflow runs.`
            : `This value comes from a custom node ${sourceLabel} that can download selected models automatically.\nThe file is already available locally.`;
        const compact = Boolean(options.compact);
        const content = compact
            ? getSvgIcon('cloudDownload', 'currentColor', 'mr-auto-download-badge-icon')
            : 'Auto download';
        const classes = compact
            ? 'mr-auto-download-badge is-compact'
            : 'mr-auto-download-badge';
        return `<span class="${classes}" data-tooltip="${this.escapeHtml(tooltip)}" tabindex="0" aria-label="Auto download capable">${content}</span>`;
    },

    renderMissingSourcesSummary(missing = {}) {
        const sourceItems = this.getEnabledSearchSources().map(source => ({ source }));

        return sourceItems.map(item => {
            const status = this.getMissingSourceStatus(missing, item.source);
            const sourceProgress = this.searchResultCache
                ?.get(this.getMissingSearchKey(missing))
                ?.sourceProgress?.[item.source];
            const statusClass = String(status || 'idle').replace(/[^a-z0-9_-]/gi, '');
            const label = this.getSearchSourceLabel(item.source);
            const statusLabels = {
                pending: 'Queued',
                running: 'Searching',
                exact: 'Exact match',
                partial: 'Partial match',
                found: 'Found',
                none: 'No match',
                unavailable: 'Temporarily unavailable',
                rate_limited: 'Rate limited',
                not_found: 'Provider page not found',
                error: 'Error',
                idle: 'Not searched'
            };
            const statusMessage = sourceProgress?.status === 'error' && (sourceProgress.providerMessage || sourceProgress.message)
                ? (sourceProgress.providerMessage || sourceProgress.message)
                : (statusLabels[status] || status);
            const title = `${label}: ${statusMessage}`;
            const iconName = this.getSearchSourceIconName(item.source);
            const iconHtml = getSvgIcon(iconName, 'currentColor', 'mr-missing-source-icon');
            return `<span class="mr-missing-source-dot mr-missing-source-${statusClass}" data-tooltip="${this.escapeHtml(title)}" aria-label="${this.escapeHtml(title)}">${iconHtml}</span>`;
        }).join('');
    },

    getMissingModelsListLayout(missingModels = []) {
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

        let modelPx = 180;
        let typePx = 66;
        for (const missing of missingModels) {
            const filename = this.getMissingFilename(missing);
            const nodeLabel = this.getMissingNodeDisplay(missing).text;
            const typeLabel = missing.category ? this.getCategoryDisplayName(missing.category) : 'unknown';
            modelPx = Math.max(
                modelPx,
                this.estimateTextWidth(filename, 7.2, 0, 1000) + 12,
                this.estimateTextWidth(nodeLabel, 5.5, 0, 1000) + 34
            );
            typePx = Math.max(typePx, this.estimateTextWidth(typeLabel, 5.8, 0, 1000) + 18);
        }

        return {
            modelPx: clamp(modelPx, 180, 820),
            typePx: clamp(typePx, 66, 120)
        };
    },

    getResolvedWorkflowModels(data = {}) {
        return (data.resolved_models || []).map(model => this.normalizeResolvedWorkflowModel(model));
    },

    normalizeResolvedWorkflowModel(model = {}) {
        const originalPath = model.original_path || model.name || model.filename || '';
        const filename = this.getFilenameFromPath(originalPath) || originalPath || 'Resolved model';
        const fullPath = model.full_path || model.path || '';
        const relativePath = model.relative_path || originalPath || filename;
        const category = model.category || 'unknown';
        const resolvedModel = {
            path: fullPath,
            relative_path: relativePath,
            filename,
            category,
            resolved_path: fullPath
        };
        const fallbackMatch = {
            confidence: 100,
            match_type: 'exact',
            filename,
            path: fullPath,
            model: resolvedModel
        };
        const backendMatches = Array.isArray(model.matches) ? model.matches : [];
        const hasResolvedMatch = backendMatches.some(match => {
            const matchPath = match.model?.path || match.model?.resolved_path || match.path || '';
            const matchRelativePath = match.model?.relative_path || '';
            return (fullPath && matchPath === fullPath)
                || (relativePath && matchRelativePath === relativePath);
        });

        return {
            ...model,
            __isExistingResolved: true,
            name: model.name || filename,
            original_path: originalPath || filename,
            category,
            matches: backendMatches.length
                ? (hasResolvedMatch ? backendMatches : [fallbackMatch, ...backendMatches])
                : [fallbackMatch]
        };
    },

    queueWorkflowModelReferenceSelection(reference = {}) {
        if (this.pendingWorkflowModelSelection?.status === 'pending') {
            this.pendingWorkflowModelSelection.status = 'superseded';
        }

        const request = {
            id: `workflow-model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            reference: { ...reference },
            status: 'pending',
            selected: null
        };
        this.pendingWorkflowModelSelection = request;
        return request;
    },

    applyPendingWorkflowModelSelection(data = this.cachedAnalysisData || {}) {
        const request = this.pendingWorkflowModelSelection;
        if (!request || request.status !== 'pending') return null;

        const selected = this.selectWorkflowModelReference(request.reference, data);
        if (!selected) return null;

        request.status = 'selected';
        request.selected = selected;
        if (this.pendingWorkflowModelSelection === request) {
            this.pendingWorkflowModelSelection = null;
        }
        return selected;
    },

    selectWorkflowModelReference(
        reference = {},
        data = this.cachedAnalysisData || {},
        options = {}
    ) {
        const selected = this.getResolvedWorkflowModels(data)
            .find(model => matchesWorkflowModelReference(model, reference));
        if (!selected || !this.contentElement) return null;

        const selectedKey = this.getMissingModelKey(selected);
        const selectionChanged = selectedKey !== this.selectedMissingModelKey;
        const existingRow = Array.from(
            this.contentElement.querySelectorAll?.('.mr-missing-list-row') || []
        ).find(item => item.dataset.missingKey === selectedKey);
        const reuseExistingBrowser = Boolean(
            options.preferExistingBrowser && existingRow
        );
        this.selectedMissingModelKey = selectedKey;

        if (reuseExistingBrowser) {
            if (selectionChanged) {
                this.displayMissingModels(
                    this.contentElement,
                    data,
                    { selectionOnly: true }
                );
            }
        } else {
            this.showResolvedModels = true;
            this.missingModelsTypeFilter = 'all';
            this.missingModelsTypeFilterMenuOpen = false;
            safeStorage.setItem(this.showResolvedModelsStorageKey, '1');
            this.displayMissingModels(this.contentElement, data);
        }

        requestAnimationFrame(() => {
            let row = Array.from(
                this.contentElement?.querySelectorAll?.('.mr-missing-list-row') || []
            ).find(item => item.dataset.missingKey === this.selectedMissingModelKey);
            if (!row) {
                row = this.scrollMissingModelIntoView(this.selectedMissingModelKey);
            }
            row?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        });
        return selected;
    },

    refreshMissingModelsBrowserFromCache() {
        if (this.activeTab !== 'missing' || !this.contentElement || !this.cachedAnalysisData) return;
        this.displayMissingModels(
            this.contentElement,
            this.cachedAnalysisData,
            { preserveBrowser: true }
        );
    },

    getMissingBrowserDetailWidthForRerender(browser = null) {
        if (!(browser instanceof HTMLElement)) return null;

        const detailPane = browser.querySelector('.mr-missing-detail-pane');
        if (!(detailPane instanceof HTMLElement)) return null;

        const explicitWidth = this.getMissingBrowserDetailTrackWidth(detailPane);
        if (Number.isFinite(explicitWidth) && explicitWidth > 0) return explicitWidth;

        const browserTrack = String(
            browser.style.getPropertyValue('--mr-missing-detail-track') || ''
        ).trim();
        if (browserTrack.endsWith('px')) {
            const browserWidth = parseFloat(browserTrack);
            if (Number.isFinite(browserWidth) && browserWidth > 0) return browserWidth;
        }

        const rect = detailPane.getBoundingClientRect?.();
        const rectWidth = Number(rect?.width);
        if (Number.isFinite(rectWidth) && rectWidth > 0) return rectWidth;

        const clientWidth = Number(detailPane.clientWidth || detailPane.offsetWidth);
        return Number.isFinite(clientWidth) && clientWidth > 0 ? clientWidth : null;
    },

    getMissingListScrollSnapshot(container) {
        const list = container?.querySelector?.('.mr-missing-list');
        if (!(list instanceof HTMLElement)) return null;
        return {
            top: list.scrollTop,
            left: list.scrollLeft
        };
    },

    restoreMissingListScroll(container, snapshot = null) {
        if (!snapshot) return;
        const list = container?.querySelector?.('.mr-missing-list');
        if (!(list instanceof HTMLElement)) return;

        const applyScroll = () => {
            if (!list.isConnected) return;
            const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
            const maxLeft = Math.max(0, list.scrollWidth - list.clientWidth);
            list.scrollTop = Math.min(Number(snapshot.top) || 0, maxTop);
            list.scrollLeft = Math.min(Number(snapshot.left) || 0, maxLeft);
        };

        applyScroll();
        requestAnimationFrame(applyScroll);
    },

    refreshMissingModelsVirtualizer(container, force = false) {
        const list = container?.querySelector?.('.mr-missing-list');
        list?._mrMissingVirtualState?.update?.(force);
    },

    destroyMissingModelsVirtualizer(container) {
        const list = container?.matches?.('.mr-missing-list')
            ? container
            : container?.querySelector?.('.mr-missing-list');
        const state = list?._mrMissingVirtualState;
        if (!state) return false;

        if (state.onScroll) {
            list.removeEventListener('scroll', state.onScroll);
        }
        state.resizeObserver?.disconnect?.();
        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }
        state.destroyed = true;
        list._mrMissingVirtualState = null;
        return true;
    },

    getMissingBrowserVirtualRowHeight(list = null) {
        const target = list instanceof HTMLElement
            ? list
            : this.contentElement?.querySelector?.('.mr-missing-list');
        if (target instanceof HTMLElement && typeof getComputedStyle === 'function') {
            const rawHeight = getComputedStyle(target)
                .getPropertyValue('--mr-missing-row-height')
                .trim();
            const parsedHeight = Number.parseFloat(rawHeight);
            if (Number.isFinite(parsedHeight) && parsedHeight > 0) return parsedHeight;
        }
        return MISSING_ROW_FALLBACK_HEIGHT;
    },

    getMissingModelRowSlotKeys(missing = {}) {
        const knownKeys = this.getMissingModelWorkflowSlotKeys?.(missing);
        if (Array.isArray(knownKeys) && knownKeys.length) return knownKeys;

        const references = [
            missing,
            ...(Array.isArray(missing.all_node_refs) ? missing.all_node_refs : [])
        ];
        return references
            .filter(reference => reference?.node_id !== undefined && reference?.node_id !== null)
            .map(reference => [
                reference.is_top_level !== false ? 'T' : 'F',
                reference.subgraph_id || '',
                reference.node_id,
                reference.widget_index ?? '',
                reference.nested_key || ''
            ].map(value => encodeURIComponent(String(value))).join(':'));
    },

    renderMissingModelListRow(missing, index, totalCount, selectedKey) {
        const key = this.getMissingModelKey(missing);
        const slotKeys = this.getMissingModelRowSlotKeys(missing);
        const isSelected = key === selectedKey;
        const isBatchSelected = this.batchSelectedMissingKeys?.has(key);
        const isResolved = this.isMissingModelResolved(missing);
        const filename = this.getMissingFilename(missing);
        const { bestMatch, confidence, matchDisplay, matchClass } = this.getLocalMatchDisplayInfo(missing);
        const typeLabel = missing.category ? this.getCategoryDisplayName(missing.category) : 'unknown';
        const typeColorClass = this.getModelTypeColorClass(missing.category || typeLabel);
        const nodeDisplay = this.getMissingNodeDisplay(missing);
        const locateTarget = nodeDisplay.locateTarget || this.getMissingLocateTarget(missing);
        const nodeId = locateTarget.nodeId ?? '';
        const rowNodeHtml = nodeDisplay.canLocate
            ? `<button type="button" class="mr-node-chip is-locatable mr-missing-row-node mr-missing-row-locate" data-node-id="${this.escapeHtml(String(nodeId))}" data-subgraph-id="${this.escapeHtml(String(locateTarget.subgraphId || ''))}" data-is-top-level="${locateTarget.isTopLevel ? 'true' : 'false'}" data-tooltip="${this.escapeHtml(nodeDisplay.locateTooltip)}" aria-label="Center ${this.escapeHtml(nodeDisplay.text)} in the ComfyUI graph">${this.getLocateIconHtml()}<span class="mr-missing-row-node-label">${this.escapeHtml(nodeDisplay.text)}</span></button>`
            : `<span class="mr-missing-row-node">${this.escapeHtml(nodeDisplay.text)}</span>`;

        return `
            <div role="button" tabindex="0"
                class="mr-missing-list-row ${isSelected ? 'is-selected' : ''} ${isBatchSelected ? 'is-batch-selected' : ''} ${isResolved ? 'is-resolved' : ''}"
                data-missing-key="${this.escapeHtml(key)}"
                data-missing-slot-keys="${this.escapeHtml(slotKeys.join('|'))}"
                data-missing-index="${index}"
                aria-posinset="${index + 1}"
                aria-setsize="${totalCount}">
                <span class="mr-missing-row-select">
                    <input type="checkbox" class="mr-missing-row-check" data-ml-no-drag="1" aria-label="Select ${this.escapeHtml(filename)}" ${isBatchSelected ? 'checked' : ''}>
                </span>
                <span class="mr-missing-row-index">${index + 1}</span>
                <span class="mr-missing-row-model ${isResolved ? 'is-resolved' : ''}">
                    ${isResolved ? `<span class="mr-missing-row-resolved-icon" data-tooltip="Model resolved">${getSvgIcon('circleCheckBig')}</span>` : ''}
                    <span class="mr-missing-row-model-details">
                        <span class="mr-missing-row-name" data-tooltip="${this.escapeHtml(filename)}">${this.escapeHtml(filename)}</span>
                        <span class="mr-missing-row-meta-line">
                            ${rowNodeHtml}
                            ${this.renderMissingAutoDownloadBadge(missing, { compact: true })}
                        </span>
                    </span>
                </span>
                <span class="mr-missing-row-type ${typeColorClass}">${this.escapeHtml(typeLabel)}</span>
                <span class="mr-missing-row-best" data-tooltip="${this.escapeHtml(matchDisplay)}">
                    ${bestMatch ? this.escapeHtml(matchDisplay) : '<span class="mr-missing-row-none">-- No local match</span>'}
                </span>
                <span class="mr-missing-row-match mr-missing-row-match-${matchClass}">
                    <strong>${bestMatch ? `${confidence.toFixed(confidence % 1 ? 1 : 0)}%` : '--'}</strong>
                </span>
                <span class="mr-missing-row-sources">${this.renderMissingSourcesSummary(missing)}</span>
            </div>
        `;
    },

    setupMissingModelsVirtualizer(container, data, sortedMissingModels) {
        const list = container?.querySelector?.('.mr-missing-list');
        const virtualScroll = list?.querySelector?.('.mr-missing-list-virtual-scroll');
        const rowsHost = virtualScroll?.querySelector?.('.mr-missing-list-virtual-rows');
        if (!(list instanceof HTMLElement) || !(virtualScroll instanceof HTMLElement) || !(rowsHost instanceof HTMLElement)) {
            return;
        }

        const existingState = list._mrMissingVirtualState;
        if (existingState && existingState.rowsHost !== rowsHost) {
            this.destroyMissingModelsVirtualizer(list);
        }
        const state = existingState && existingState.rowsHost === rowsHost
            ? existingState
            : {
                list,
                virtualScroll,
                rowsHost,
                models: sortedMissingModels,
                data,
                rowHeight: this.getMissingBrowserVirtualRowHeight(list),
                start: -1,
                end: -1,
                resizeObserver: null,
                onScroll: null,
                animationFrame: null,
                destroyed: false,
                update: null
            };

        state.models = sortedMissingModels;
        state.data = data;
        state.rowHeight = this.getMissingBrowserVirtualRowHeight(list);
        state.virtualScroll.style.height = `${Math.max(0, sortedMissingModels.length * state.rowHeight)}px`;

        state.update = (force = false) => {
            if (state.destroyed || !list.isConnected || !rowsHost.isConnected) return;

            const rowHeight = state.rowHeight || MISSING_ROW_FALLBACK_HEIGHT;
            const header = list.querySelector('.mr-missing-list-head');
            const headerHeight = Number(header?.offsetHeight) || 0;
            const viewportHeight = Math.max(
                rowHeight,
                Number(list.clientHeight) || MISSING_VIRTUAL_INITIAL_ROWS * rowHeight
            );
            const viewportTop = Math.max(0, Number(list.scrollTop) - headerHeight);
            const viewportBottom = Math.max(viewportTop, Number(list.scrollTop) + viewportHeight - headerHeight);
            const nextStart = Math.max(
                0,
                Math.floor(viewportTop / rowHeight) - MISSING_VIRTUAL_OVERSCAN_ROWS
            );
            const nextEnd = Math.min(
                state.models.length,
                Math.max(
                    nextStart,
                    Math.ceil(viewportBottom / rowHeight) + MISSING_VIRTUAL_OVERSCAN_ROWS
                )
            );

            if (!force && nextStart === state.start && nextEnd === state.end) return;

            state.start = nextStart;
            state.end = nextEnd;
            rowsHost.style.transform = `translateY(${Math.round(nextStart * rowHeight)}px)`;
            const nextRowsTemplate = document.createElement('template');
            nextRowsTemplate.innerHTML = state.models
                .slice(nextStart, nextEnd)
                .map((missing, offset) => this.renderMissingModelListRow(
                    missing,
                    nextStart + offset,
                    state.models.length,
                    this.selectedMissingModelKey
                ))
                .join('');
            const nextRows = Array.from(
                nextRowsTemplate.content.querySelectorAll('.mr-missing-list-row')
            );

            this.reconcileMissingModelRows(rowsHost, nextRows);
            this.wireVisibleMissingModelRows(container, state.data, state.models);
        };

        if (!existingState) {
            state.onScroll = () => state.update(false);
            list.addEventListener('scroll', state.onScroll, { passive: true });
            if (typeof ResizeObserver === 'function') {
                state.resizeObserver = new ResizeObserver(() => state.update(false));
                state.resizeObserver.observe(list);
            }
            list._mrMissingVirtualState = state;
        }

        state.update(true);
    },

    scrollMissingModelIntoView(missingKey) {
        const list = this.contentElement?.querySelector?.('.mr-missing-list');
        const state = list?._mrMissingVirtualState;
        if (!(list instanceof HTMLElement) || !state) return null;

        const index = state.models.findIndex(missing => this.getMissingModelKey(missing) === missingKey);
        if (index < 0) return null;

        const header = list.querySelector('.mr-missing-list-head');
        const headerHeight = Number(header?.offsetHeight) || 0;
        const rowHeight = state.rowHeight || MISSING_ROW_FALLBACK_HEIGHT;
        const targetTop = headerHeight + index * rowHeight;
        const targetScrollTop = targetTop - Math.max(0, (list.clientHeight - rowHeight) / 2);
        list.scrollTop = Math.max(0, targetScrollTop);
        state.update(true);
        return Array.from(list.querySelectorAll('.mr-missing-list-row'))
            .find(row => row.dataset.missingKey === missingKey) || null;
    },

    renderMissingModelsBrowser(missingModels, selectedKey, totalMissing, activeCount, hasAny100Match, options = {}) {
        const hiddenResolvedCount = Number(options.hiddenResolvedCount || 0);
        const hiddenAutoDownloadCount = Number(options.hiddenAutoDownloadCount || 0);
        const hiddenInactiveCount = Number(options.hiddenInactiveCount || 0);
        const autoDownloadCount = Number(options.autoDownloadCount || 0);
        const inactiveCount = Number(options.inactiveCount || 0);
        const resolvedCount = Number(options.resolvedCount || 0);
        const rawMissingCount = Number(options.rawMissingCount ?? totalMissing);
        const missingCount = Number(options.missingCount ?? rawMissingCount);
        const typeFilterOptions = Array.isArray(options.typeFilterOptions) ? options.typeFilterOptions : [];
        const activeTypeFilter = String(options.activeTypeFilter || 'all');
        const activeTypeOption = typeFilterOptions.find(option => option.value === activeTypeFilter);
        const activeTypeLabel = activeTypeOption?.label || 'All';
        const typeFilterMenuOpen = Boolean(this.missingModelsTypeFilterMenuOpen);
        const resolvedToggleCount = this.showResolvedModels ? resolvedCount : hiddenResolvedCount;
        const autoDownloadToggleCount = this.showAutoDownloadModels ? autoDownloadCount : hiddenAutoDownloadCount;
        const inactiveToggleCount = this.showInactiveModels ? inactiveCount : hiddenInactiveCount;
        const stats = this.getMissingModelSummaryStats(missingModels);
        const detailIndex = missingModels.findIndex(missing => this.getMissingModelKey(missing) === selectedKey);
        const detailMissing = detailIndex >= 0 ? missingModels[detailIndex] : null;
        const activeHint = activeCount > 0
            ? `${activeCount} downloading`
            : hiddenResolvedCount > 0
            ? `${hiddenResolvedCount} resolved hidden`
            : hiddenAutoDownloadCount > 0
            ? `${hiddenAutoDownloadCount} auto-download hidden`
            : hiddenInactiveCount > 0
            ? `${hiddenInactiveCount} inactive hidden`
            : (hasAny100Match ? 'Auto-link ready for exact matches' : 'Review matches or search online');
        const listLayout = this.getMissingModelsListLayout(missingModels);
        const requestedDetailWidth = Number(options.detailWidth);
        const savedDetailWidth = Number.isFinite(requestedDetailWidth) && requestedDetailWidth > 0
            ? Math.round(requestedDetailWidth)
            : this.getStoredMissingBrowserSplitWidth();
        const splitStyle = Number.isFinite(savedDetailWidth) && savedDetailWidth > 0
            ? `--mr-missing-detail-track:${savedDetailWidth}px;`
            : '';
        const listStyle = `--mr-missing-model-col:${listLayout.modelPx}px;--mr-missing-type-col:${listLayout.typePx}px;`;
        const browserStyle = `${listStyle}${splitStyle}`;
        const typeFilterTotal = Number(typeFilterOptions.find(option => option.value === 'all')?.count || totalMissing);
        const titleText = activeTypeFilter !== 'all'
            ? `${totalMissing} shown of ${typeFilterTotal}`
            : this.showResolvedModels && resolvedCount > 0
            ? `${totalMissing} shown (${missingCount} missing / ${resolvedCount} resolved)`
            : `${totalMissing} missing model${totalMissing === 1 ? '' : 's'}`;
        const typeFilterMenuOptions = typeFilterOptions.map((option) => {
            const isActive = option.value === activeTypeFilter;
            const labelClass = option.colorClass
                ? `mr-missing-type-filter-option-label ${option.colorClass}`
                : 'mr-missing-type-filter-option-label';
            return `
                <button type="button" class="mr-missing-type-filter-option ${isActive ? 'is-active' : ''}" data-missing-type-filter-option="${this.escapeHtml(option.value)}" role="menuitemradio" aria-checked="${isActive ? 'true' : 'false'}">
                    <span class="${this.escapeHtml(labelClass)}">${this.escapeHtml(option.label)}</span>
                    <strong>${Number(option.count || 0).toLocaleString()}</strong>
                </button>
            `;
        }).join('');

        let html = `
            <div class="mr-missing-browser" style="${browserStyle}">
                <section class="mr-missing-list-pane" aria-label="Missing model list">
                    <div class="mr-missing-list-toolbar">
                        <div>
                            <div class="mr-missing-list-title">${this.escapeHtml(titleText)}</div>
                            <div class="mr-missing-list-meta">${this.escapeHtml(activeHint)}</div>
                        </div>
                        <div class="mr-missing-list-tools">
                            <div class="mr-missing-list-stats">
                                <span class="mr-missing-stat mr-missing-stat-exact">${stats.exact} exact</span>
                                <span class="mr-missing-stat mr-missing-stat-partial">${stats.partial} partial</span>
                                <span class="mr-missing-stat mr-missing-stat-none">${stats.none} no match</span>
                            </div>
                            <label class="mr-missing-resolved-toggle" data-tooltip="Show resolved models, including models that were already available when the workflow loaded.">
                                <input id="mr-show-resolved-models" type="checkbox" ${this.showResolvedModels ? 'checked' : ''}>
                                <span>Show resolved</span>
                                ${resolvedToggleCount > 0 ? `<em>${resolvedToggleCount}</em>` : ''}
                            </label>
                            <label class="mr-missing-resolved-toggle" data-tooltip="Show models selected from custom nodes that can download models automatically.">
                                <input id="mr-show-auto-download-models" type="checkbox" ${this.showAutoDownloadModels ? 'checked' : ''}>
                                <span>Show auto-download</span>
                                ${autoDownloadToggleCount > 0 ? `<em>${autoDownloadToggleCount}</em>` : ''}
                            </label>
                            <label class="mr-missing-resolved-toggle" data-tooltip="Show unresolved models from bypassed, disabled, or disconnected workflow nodes.">
                                <input id="mr-show-inactive-models" type="checkbox" ${this.showInactiveModels ? 'checked' : ''}>
                                <span>Show inactive</span>
                                ${inactiveToggleCount > 0 ? `<em>${inactiveToggleCount}</em>` : ''}
                            </label>
                            <button id="mr-refresh-missing-analysis" type="button" class="mr-btn mr-btn-secondary mr-btn-sm mr-missing-refresh-btn" data-tooltip="Re-analyze workflow and refresh local matches">
                                <span class="mr-refresh-spin-target">${getSvgIcon('refreshCw')}</span> Refresh
                            </button>
                        </div>
                    </div>
                    <div class="mr-missing-list">
                        <div class="mr-missing-list-head">
                            <span class="mr-missing-head-select">
                                <input type="checkbox" class="mr-missing-select-all-check" aria-label="Select or deselect all missing models">
                            </span>
                            <span>#</span>
                            <span>Missing Model</span>
                            <span class="mr-missing-type-filter-cell">
                                <span class="mr-missing-type-filter-wrap">
                                    <button type="button" class="mr-missing-type-filter-button ${activeTypeFilter !== 'all' ? 'is-filtered' : ''}" data-missing-type-filter-toggle aria-haspopup="menu" aria-expanded="${typeFilterMenuOpen ? 'true' : 'false'}" title="Filter by type">
                                        <span>Type</span>
                                        <span class="mr-missing-type-filter-chip" ${activeTypeFilter !== 'all' ? '' : 'hidden'}>${this.escapeHtml(activeTypeLabel)}</span>
                                    </button>
                                    <span class="mr-missing-type-filter-menu" role="menu" ${typeFilterMenuOpen ? '' : 'hidden'}>
                                        ${typeFilterMenuOptions}
                                    </span>
                                </span>
                            </span>
                            <span>Best Local Match</span>
                            <span>Match</span>
                            <span>Sources</span>
                        </div>
        `;

        const initialRowCount = Math.min(missingModels.length, MISSING_VIRTUAL_INITIAL_ROWS);
        const initialRowsHtml = missingModels
            .slice(0, initialRowCount)
            .map((missing, index) => this.renderMissingModelListRow(
                missing,
                index,
                missingModels.length,
                selectedKey
            ))
            .join('');
        html += `
                    <div class="mr-missing-list-virtual-scroll" data-mr-missing-virtual-scroll style="height:${Math.max(0, missingModels.length * MISSING_ROW_FALLBACK_HEIGHT)}px">
                        <div class="mr-missing-list-virtual-rows" data-mr-missing-virtual-rows>
                            ${initialRowsHtml}
                        </div>
                    </div>
        `;

        html += `
                    </div>
                </section>
                <div class="mr-missing-browser-splitter" role="separator" aria-orientation="vertical" aria-label="Resize missing model panes" tabindex="0"></div>
                <section class="mr-missing-detail-pane" aria-label="Missing model details">
                    ${detailMissing ? this.renderMissingModel(detailMissing, detailIndex) : this.renderStatusMessage('Select a missing model to inspect details.', 'info')}
                </section>
            </div>
        `;
        return html;
    },

    reconcileMissingModelRows(currentRowsHost, nextRows, appendTarget = currentRowsHost) {
        const currentRows = new Map(
            Array.from(currentRowsHost.querySelectorAll('.mr-missing-list-row'))
                .map(row => [row.dataset.missingKey || '', row])
                .filter(([key]) => key)
        );
        const currentRowsBySlot = new Map();
        const currentRowsByIndex = new Map();
        currentRows.forEach((row) => {
            const index = row.dataset.missingIndex || '';
            if (index && !currentRowsByIndex.has(index)) currentRowsByIndex.set(index, row);
            String(row.dataset.missingSlotKeys || '')
                .split('|')
                .filter(Boolean)
                .forEach(slotKey => {
                    if (!currentRowsBySlot.has(slotKey)) currentRowsBySlot.set(slotKey, row);
                });
        });
        const retainedRows = new Set();
        const findCurrentRow = (nextRow) => {
            const byKey = currentRows.get(nextRow.dataset.missingKey || '');
            if (byKey && !retainedRows.has(byKey)) return byKey;

            const bySlot = String(nextRow.dataset.missingSlotKeys || '')
                .split('|')
                .map(slotKey => currentRowsBySlot.get(slotKey))
                .find(row => row && !retainedRows.has(row));
            if (bySlot) return bySlot;

            const byIndex = currentRowsByIndex.get(nextRow.dataset.missingIndex || '');
            return byIndex && !retainedRows.has(byIndex) ? byIndex : null;
        };

        nextRows.forEach((nextRow) => {
            const currentRow = findCurrentRow(nextRow);
            const row = currentRow
                ? this.patchMissingModelRowElement(currentRow, nextRow)
                : nextRow;
            retainedRows.add(row);
            appendTarget.appendChild(row);
        });
        currentRows.forEach((row) => {
            if (!retainedRows.has(row)) row.remove();
        });
    },

    patchMissingModelsBrowserElement(container, html) {
        const currentBrowser = container?.querySelector?.('.mr-missing-browser');
        if (!currentBrowser || typeof document === 'undefined') return false;

        const template = document.createElement('template');
        template.innerHTML = String(html || '').trim();
        const nextBrowser = template.content.firstElementChild;
        const currentList = currentBrowser.querySelector('.mr-missing-list');
        const nextList = nextBrowser?.querySelector?.('.mr-missing-list');
        if (!nextBrowser || !currentList || !nextList) return false;

        currentBrowser.style.cssText = nextBrowser.style.cssText;
        const currentToolbar = currentBrowser.querySelector('.mr-missing-list-toolbar');
        const nextToolbar = nextBrowser.querySelector('.mr-missing-list-toolbar');
        if (currentToolbar && nextToolbar) {
            currentToolbar.replaceWith(nextToolbar);
        }

        const currentHead = currentList.querySelector('.mr-missing-list-head');
        const nextHead = nextList.querySelector('.mr-missing-list-head');
        if (currentHead && nextHead) {
            currentHead.replaceWith(nextHead);
        }

        const currentVirtualScroll = currentList.querySelector('.mr-missing-list-virtual-scroll');
        const nextVirtualScroll = nextList.querySelector('.mr-missing-list-virtual-scroll');
        if (currentVirtualScroll && nextVirtualScroll) {
            currentVirtualScroll.style.height = nextVirtualScroll.style.height;
        }
        const currentRowsHost = currentVirtualScroll?.querySelector('.mr-missing-list-virtual-rows') || currentList;
        const nextRowsHost = nextVirtualScroll?.querySelector('.mr-missing-list-virtual-rows') || nextList;
        this.reconcileMissingModelRows(
            currentRowsHost,
            Array.from(nextRowsHost.querySelectorAll('.mr-missing-list-row')),
            currentRowsHost === currentList ? currentList : currentRowsHost
        );

        const currentSplitter = currentBrowser.querySelector('.mr-missing-browser-splitter');
        const nextSplitter = nextBrowser.querySelector('.mr-missing-browser-splitter');
        if (currentSplitter && nextSplitter) {
            currentSplitter.replaceWith(nextSplitter);
        }

        const currentDetail = currentBrowser.querySelector('.mr-missing-detail-pane');
        const nextDetail = nextBrowser.querySelector('.mr-missing-detail-pane');
        this._missingBrowserDetailPreserved = Boolean(
            currentDetail
            && nextDetail
            && currentDetail.outerHTML === nextDetail.outerHTML
        );
        if (currentDetail && nextDetail && !this._missingBrowserDetailPreserved) {
            currentDetail.innerHTML = nextDetail.innerHTML;
        }
        return true;
    },

    patchMissingModelRowElement(currentRow, nextRow) {
        if (!currentRow || !nextRow || currentRow === nextRow) return currentRow || nextRow;
        if (currentRow.outerHTML === nextRow.outerHTML) return currentRow;

        const nextAttributeNames = new Set(
            Array.from(nextRow.attributes || [], attribute => attribute.name)
        );
        for (const attribute of Array.from(nextRow.attributes || [])) {
            if (currentRow.getAttribute(attribute.name) !== attribute.value) {
                currentRow.setAttribute(attribute.name, attribute.value);
            }
        }
        for (const attribute of Array.from(currentRow.attributes || [])) {
            if (!nextAttributeNames.has(attribute.name)) {
                currentRow.removeAttribute(attribute.name);
            }
        }

        currentRow.innerHTML = nextRow.innerHTML;
        this._wiredMissingModelRows?.delete?.(currentRow);
        return currentRow;
    },

    wireVisibleMissingModelRows(container, data, sortedMissingModels) {
        const getCurrentData = () => this.cachedAnalysisData || data;
        const getCurrentMissingModels = () => (
            Array.isArray(this.missingModels)
                ? this.missingModels
                : sortedMissingModels
        );
        const selectRow = (row) => {
            const key = row.dataset.missingKey;
            if (!key || key === this.selectedMissingModelKey) return;
            this.selectedMissingModelKey = key;
            this.displayMissingModels(
                container,
                getCurrentData(),
                { selectionOnly: true }
            );
        };

        container.querySelectorAll('.mr-missing-list-row').forEach((row) => {
            if (this._wiredMissingModelRows.has(row)) return;
            this._wiredMissingModelRows.add(row);
            const checkbox = row.querySelector('.mr-missing-row-check');
            if (checkbox) {
                checkbox.addEventListener('click', (event) => {
                    event.stopPropagation();
                    checkbox._missingShiftClick = event.shiftKey;
                });
                checkbox.addEventListener('change', (event) => {
                    const key = row.dataset.missingKey;
                    if (!key) return;
                    const selected = checkbox.checked;
                    const isShiftRange = event.shiftKey || checkbox._missingShiftClick === true;
                    const currentMissingModels = getCurrentMissingModels();

                    if (isShiftRange && this.lastBatchSelectedMissingKey) {
                        this.applyBatchSelectionRange(
                            currentMissingModels,
                            this.lastBatchSelectedMissingKey,
                            key,
                            selected
                        );
                    } else {
                        this.setBatchSelectionForKey(key, selected);
                    }

                    this.lastBatchSelectedMissingKey = key;
                    this.refreshBatchSelectionUi();
                    this.updateBatchFooterButtons();
                });
            }

            row.addEventListener('click', (event) => {
                const clickedLocate = event.target instanceof Element && event.target.closest('.mr-missing-row-locate');
                if (clickedLocate) return;
                selectRow(row);
            });

            row.addEventListener('keydown', (event) => {
                if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                selectRow(row);
            });
        });

        container.querySelectorAll('.mr-missing-row-locate').forEach((button) => {
            if (this._wiredMissingLocateButtons.has(button)) return;
            this._wiredMissingLocateButtons.add(button);
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const rawNodeId = button.dataset.nodeId;
                const numericNodeId = Number(rawNodeId);
                this.locateNodeInGraph(Number.isNaN(numericNodeId) ? rawNodeId : numericNodeId, {
                    subgraphId: button.dataset.subgraphId || '',
                    isTopLevel: button.dataset.isTopLevel !== 'false'
                });
            });
        });
    },

    wireMissingModelsBrowser(container, data, sortedMissingModels) {
        this.wireMissingBrowserSplitter(container);

        const browser = container.querySelector('.mr-missing-browser');
        if (!(this._wiredMissingModelRows instanceof WeakSet)) {
            this._wiredMissingModelRows = new WeakSet();
        }
        if (!(this._wiredMissingLocateButtons instanceof WeakSet)) {
            this._wiredMissingLocateButtons = new WeakSet();
        }
        if (!(this._wiredMissingBrowsers instanceof WeakSet)) {
            this._wiredMissingBrowsers = new WeakSet();
        }
        const typeFilterToggle = browser?.querySelector('[data-missing-type-filter-toggle]');
        const setTypeFilterMenuOpen = (open) => {
            this.missingModelsTypeFilterMenuOpen = Boolean(open);
            const activeMenu = browser?.querySelector('.mr-missing-type-filter-menu');
            const activeToggle = browser?.querySelector('[data-missing-type-filter-toggle]');
            if (activeMenu) {
                activeMenu.hidden = !this.missingModelsTypeFilterMenuOpen;
            }
            if (activeToggle) {
                activeToggle.setAttribute(
                    'aria-expanded',
                    this.missingModelsTypeFilterMenuOpen ? 'true' : 'false'
                );
            }
        };

        typeFilterToggle?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setTypeFilterMenuOpen(!this.missingModelsTypeFilterMenuOpen);
        });

        browser?.querySelectorAll('[data-missing-type-filter-option]').forEach((option) => {
            option.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.missingModelsTypeFilter = option.dataset.missingTypeFilterOption || 'all';
                this.missingModelsTypeFilterMenuOpen = false;
                this.displayMissingModels(container, data);
            });
        });

        if (browser && !this._wiredMissingBrowsers.has(browser)) {
            this._wiredMissingBrowsers.add(browser);
            browser.addEventListener('click', (event) => {
                if (!this.missingModelsTypeFilterMenuOpen) return;
                if (
                    event.target instanceof Element
                    && event.target.closest('.mr-missing-type-filter-wrap')
                ) {
                    return;
                }
                setTypeFilterMenuOpen(false);
            });

            browser.addEventListener('keydown', (event) => {
                if (
                    event.key !== 'Escape'
                    || !this.missingModelsTypeFilterMenuOpen
                ) {
                    return;
                }
                event.preventDefault();
                setTypeFilterMenuOpen(false);
                browser.querySelector('[data-missing-type-filter-toggle]')?.focus();
            });
        }

        const refreshBtn = container.querySelector('#mr-refresh-missing-analysis');
        if (refreshBtn && refreshBtn.dataset.mlRefreshBound !== 'true') {
            refreshBtn.dataset.mlRefreshBound = 'true';
            refreshBtn.addEventListener('click', () => this.refreshMissingAnalysis(refreshBtn));
        }

        const showResolvedToggle = container.querySelector('#mr-show-resolved-models');
        if (showResolvedToggle && showResolvedToggle.dataset.mlResolvedBound !== 'true') {
            showResolvedToggle.dataset.mlResolvedBound = 'true';
            showResolvedToggle.addEventListener('change', () => {
                this.showResolvedModels = Boolean(showResolvedToggle.checked);
                try {
                    safeStorage.setItem(this.showResolvedModelsStorageKey, this.showResolvedModels ? '1' : '0');
                } catch (_e) {}
                this.displayMissingModels(container, data, { preserveBrowser: true });
            });
        }

        const showAutoDownloadToggle = container.querySelector('#mr-show-auto-download-models');
        if (showAutoDownloadToggle && showAutoDownloadToggle.dataset.mlAutoDownloadBound !== 'true') {
            showAutoDownloadToggle.dataset.mlAutoDownloadBound = 'true';
            showAutoDownloadToggle.addEventListener('change', () => {
                this.showAutoDownloadModels = Boolean(showAutoDownloadToggle.checked);
                try {
                    safeStorage.setItem(this.showAutoDownloadModelsStorageKey, this.showAutoDownloadModels ? '1' : '0');
                } catch (_e) {}
                this.displayMissingModels(container, data, { preserveBrowser: true });
            });
        }

        const showInactiveToggle = container.querySelector('#mr-show-inactive-models');
        if (showInactiveToggle && showInactiveToggle.dataset.mlInactiveBound !== 'true') {
            showInactiveToggle.dataset.mlInactiveBound = 'true';
            showInactiveToggle.addEventListener('change', () => {
                this.showInactiveModels = Boolean(showInactiveToggle.checked);
                try {
                    safeStorage.setItem(this.showInactiveModelsStorageKey, this.showInactiveModels ? '1' : '0');
                } catch (_e) {}
                this.displayMissingModels(container, data, { preserveBrowser: true });
            });
        }

        const getCurrentMissingModels = () => (
            Array.isArray(this.missingModels)
                ? this.missingModels
                : sortedMissingModels
        );
        const selectAllCheckbox = container.querySelector('.mr-missing-select-all-check');
        if (selectAllCheckbox && selectAllCheckbox.dataset.mlSelectAllBound !== 'true') {
            selectAllCheckbox.dataset.mlSelectAllBound = 'true';
            this.updateBatchSelectAllCheckbox();
            selectAllCheckbox.addEventListener('click', (event) => {
                event.stopPropagation();
            });
            selectAllCheckbox.addEventListener('change', () => {
                const shouldSelectAll = selectAllCheckbox.checked;
                this.batchSelectedMissingKeys = shouldSelectAll
                    ? new Set(getCurrentMissingModels().map(missing => this.getMissingModelKey(missing)))
                    : new Set();
                this.lastBatchSelectedMissingKey = null;
                this.refreshBatchSelectionUi();
                this.updateBatchFooterButtons();
            });
        }

        this.wireVisibleMissingModelRows(container, data, sortedMissingModels);
        this.setupMissingModelsVirtualizer(container, data, sortedMissingModels);

        const selectedMissing = sortedMissingModels.find(missing => this.getMissingModelKey(missing) === this.selectedMissingModelKey);
        const detailPreserved = this._missingBrowserDetailPreserved === true;
        this._missingBrowserDetailPreserved = false;
        if (!selectedMissing || detailPreserved) return;

        const selectedIndex = sortedMissingModels.indexOf(selectedMissing);
        this.wireMissingModelDetail(container, selectedMissing, selectedIndex);
    },

    wireMissingBrowserSplitter(container) {
        const browser = container.querySelector('.mr-missing-browser');
        const splitter = browser?.querySelector('.mr-missing-browser-splitter');
        if (!(browser instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;
        const listPane = browser.querySelector('.mr-missing-list-pane');
        const detailPane = browser.querySelector('.mr-missing-detail-pane');
        if (!(listPane instanceof HTMLElement) || !(detailPane instanceof HTMLElement)) return;

        const startSplitDrag = (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            this.startMissingBrowserSplitDrag(event, browser, splitter, { listPane, detailPane });
        };
        if (typeof PointerEvent === 'function') {
            splitter.addEventListener('pointerdown', startSplitDrag);
        } else {
            splitter.addEventListener('mousedown', startSplitDrag);
        }

        splitter.addEventListener('dblclick', () => {
            this.clearMissingBrowserSplitStyles(browser);
            this._pendingMissingBrowserRestoreBrowser = null;
            this._pendingMissingBrowserRestoreWidth = null;
            this._pendingMissingBrowserRestoreUseDefault = false;
            this._missingBrowserStoredSplitWidth = null;
            this._missingBrowserStoredSplitWidthLoaded = true;
            this._missingBrowserLastDetailWidth = null;
            this.cancelMissingBrowserSplitWidthPersist();
            try {
                safeStorage.removeItem(this.missingBrowserSplitStorageKey);
            } catch (_e) {}
        });

        splitter.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            this.resizeMissingBrowserDetailBy(browser, event.key === 'ArrowLeft' ? 32 : -32);
        });

        this.cancelMissingBrowserExternalResizeRestore();
        this._missingBrowserResizeObserver?.disconnect?.();
        if (typeof ResizeObserver === 'function') {
            const resizeHost = browser.parentElement instanceof HTMLElement
                ? browser.parentElement
                : browser;
            this._missingBrowserObservedHostWidth = null;
            this._missingBrowserResizeObserver = new ResizeObserver((entries) => {
                const observedWidth = Number(entries?.[0]?.contentRect?.width);
                if (!Number.isFinite(observedWidth) || observedWidth <= 0) return;

                const previousHostWidth = Number(this._missingBrowserObservedHostWidth);
                this._missingBrowserObservedHostWidth = observedWidth;
                this.rememberMissingBrowserWidth(observedWidth);

                if (!Number.isFinite(previousHostWidth) || previousHostWidth <= 0) {
                    this.scheduleMissingBrowserSplitRestore(browser, observedWidth, { useDefault: false });
                    return;
                }
                if (Math.abs(previousHostWidth - observedWidth) < 0.5) return;

                const settlingUntil = Number(this._missingBrowserSplitSettlingUntil || 0);
                const isSettling = typeof performance === 'object'
                    && typeof performance.now === 'function'
                    && performance.now() < settlingUntil;
                if (
                    !this._missingBrowserSplitDragging
                    && !isSettling
                ) {
                    this.scheduleMissingBrowserExternalResizeRestore(browser, observedWidth);
                }
            });
            this._missingBrowserResizeObserver.observe(resizeHost);
        } else {
            this.cancelMissingBrowserPrewarmFrame();
            this._missingBrowserPrewarmFrame = requestAnimationFrame(() => {
                this._missingBrowserPrewarmFrame = null;
                if (!browser.isConnected) return;
                if (this._missingBrowserSplitDragging) return;
                const measuredWidth = Number(browser.clientWidth || browser.getBoundingClientRect().width);
                this.rememberMissingBrowserWidth(measuredWidth);
                this.scheduleMissingBrowserSplitRestore(browser, measuredWidth, { useDefault: false });
            });
        }
    },

    cancelMissingBrowserPrewarmFrame() {
        if (!this._missingBrowserPrewarmFrame) return;
        cancelAnimationFrame(this._missingBrowserPrewarmFrame);
        this._missingBrowserPrewarmFrame = null;
    },

    cancelMissingBrowserExternalResizeRestore() {
        if (this._missingBrowserExternalResizeFrame) {
            cancelAnimationFrame(this._missingBrowserExternalResizeFrame);
        }
        this._missingBrowserExternalResizeFrame = null;
        this._pendingMissingBrowserExternalResizeBrowser = null;
        this._pendingMissingBrowserExternalResizeWidth = null;
    },

    scheduleMissingBrowserExternalResizeRestore(browser, browserWidth) {
        if (!(browser instanceof HTMLElement)) return;

        this._pendingMissingBrowserExternalResizeBrowser = browser;
        this._pendingMissingBrowserExternalResizeWidth = Number(browserWidth) || null;
        if (this._missingBrowserExternalResizeFrame) return;

        this._missingBrowserExternalResizeFrame = requestAnimationFrame(() => {
            this._missingBrowserExternalResizeFrame = null;
            const targetBrowser = this._pendingMissingBrowserExternalResizeBrowser;
            const targetWidth = this._pendingMissingBrowserExternalResizeWidth;
            this._pendingMissingBrowserExternalResizeBrowser = null;
            this._pendingMissingBrowserExternalResizeWidth = null;

            if (
                !targetBrowser?.isConnected
                || this._missingBrowserSplitDragging
            ) {
                return;
            }
            this.restoreMissingBrowserSplitWidth(targetBrowser, {
                browserWidth: targetWidth,
                useDefault: false
            });
        });
    },

    getStoredMissingBrowserSplitWidth() {
        if (this._missingBrowserStoredSplitWidthLoaded) {
            return this._missingBrowserStoredSplitWidth || null;
        }

        let savedWidth = null;
        try {
            const storedWidth = parseInt(safeStorage.getItem(this.missingBrowserSplitStorageKey) || '', 10);
            savedWidth = Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : null;
        } catch (_e) {}

        this._missingBrowserStoredSplitWidth = savedWidth;
        this._missingBrowserStoredSplitWidthLoaded = true;
        return savedWidth;
    },

    rememberMissingBrowserWidth(width) {
        const observedWidth = Number(width);
        if (!Number.isFinite(observedWidth) || observedWidth <= 0) return null;
        this._missingBrowserObservedWidth = observedWidth;
        this._missingBrowserLastBrowserWidth = observedWidth;
        if (!this._missingBrowserLastDetailWidth) {
            this._missingBrowserLastDetailWidth = this.getDefaultMissingBrowserDetailWidth(observedWidth);
        }
        return observedWidth;
    },

    getFastMissingBrowserWidthEstimate(browser = null, { allowMeasure = false } = {}) {
        const observedWidth = Number(this._missingBrowserObservedWidth);
        if (Number.isFinite(observedWidth) && observedWidth > 0) return observedWidth;

        const lastWidth = Number(this._missingBrowserLastBrowserWidth);
        if (Number.isFinite(lastWidth) && lastWidth > 0) return lastWidth;

        if (allowMeasure && browser instanceof HTMLElement) {
            const clientWidth = Number(browser.clientWidth || browser.offsetWidth);
            if (Number.isFinite(clientWidth) && clientWidth > 0) {
                this.rememberMissingBrowserWidth(clientWidth);
                return clientWidth;
            }
        }

        const fallbackWidth = Number(this._queueSplitLastContainerWidth || window.innerWidth || 720);
        return Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : 720;
    },

    getMissingBrowserSplitBoundsForWidth(width) {
        const safeWidth = Math.max(1, Number(width) || 1);
        const available = Math.max(1, safeWidth - 10);
        const minListWidth = Math.min(340, available);
        const max = Math.max(1, available - minListWidth);
        const min = Math.min(max, Math.min(420, Math.max(300, Math.floor(available * 0.3))));

        return { min, max, available };
    },

    getDefaultMissingBrowserDetailWidth(browserWidth = null) {
        const width = Number(browserWidth) > 0
            ? Number(browserWidth)
            : this.getFastMissingBrowserWidthEstimate();
        const bounds = this.getMissingBrowserSplitBoundsForWidth(width);
        const preferred = Math.round(width * 0.42);
        return Math.round(Math.max(bounds.min, Math.min(bounds.max, preferred)));
    },

    scheduleMissingBrowserSplitRestore(browser, browserWidth = null, { useDefault = false } = {}) {
        if (!(browser instanceof HTMLElement)) return;

        this._pendingMissingBrowserRestoreBrowser = browser;
        this._pendingMissingBrowserRestoreWidth = Number.isFinite(Number(browserWidth)) && Number(browserWidth) > 0
            ? Number(browserWidth)
            : null;
        this._pendingMissingBrowserRestoreUseDefault = Boolean(useDefault);

        if (this._missingBrowserRestoreFrame) return;
        this._missingBrowserRestoreFrame = requestAnimationFrame(() => {
            this._missingBrowserRestoreFrame = null;
            const targetBrowser = this._pendingMissingBrowserRestoreBrowser;
            const targetWidth = this._pendingMissingBrowserRestoreWidth;
            const targetUseDefault = this._pendingMissingBrowserRestoreUseDefault;
            this._pendingMissingBrowserRestoreBrowser = null;
            this._pendingMissingBrowserRestoreWidth = null;
            this._pendingMissingBrowserRestoreUseDefault = false;

            if (!this._missingBrowserSplitDragging && targetBrowser?.isConnected) {
                this.restoreMissingBrowserSplitWidth(targetBrowser, {
                    browserWidth: targetWidth,
                    useDefault: targetUseDefault
                });
            }
        });
    },

    restoreMissingBrowserSplitWidth(browser, { browserWidth = null, useDefault = false } = {}) {
        const savedWidth = this.getStoredMissingBrowserSplitWidth();
        const targetWidth = savedWidth || (useDefault ? this.getDefaultMissingBrowserDetailWidth(browserWidth) : null);
        if (!targetWidth) return;

        this.setMissingBrowserDetailWidth(browser, targetWidth, {
            persist: false,
            browserWidth,
            skipIfUnchanged: true
        });
    },

    startMissingBrowserSplitDrag(event, browser, splitter = null, panes = {}) {
        if (!(browser instanceof HTMLElement)) return;

        event.preventDefault();
        event.stopPropagation?.();
        this.cancelMissingBrowserPrewarmFrame();

        const detailPane = panes.detailPane instanceof HTMLElement
            ? panes.detailPane
            : browser.querySelector('.mr-missing-detail-pane');
        const listPane = panes.listPane instanceof HTMLElement
            ? panes.listPane
            : browser.querySelector('.mr-missing-list-pane');
        if (!(detailPane instanceof HTMLElement) || !(listPane instanceof HTMLElement)) return;
        const browserWidth = this.getFastMissingBrowserWidthEstimate(browser);
        const bounds = this.getMissingBrowserSplitBoundsForWidth(browserWidth);
        const savedWidth = this.getStoredMissingBrowserSplitWidth();
        const detailWidth = Math.round(Math.max(bounds.min, Math.min(bounds.max, this.getMissingBrowserDetailTrackWidth(detailPane)
            || this._missingBrowserLastDetailWidth
            || savedWidth
            || this.getDefaultMissingBrowserDetailWidth(browserWidth))));

        if (this._missingBrowserRestoreFrame) {
            cancelAnimationFrame(this._missingBrowserRestoreFrame);
            this._missingBrowserRestoreFrame = null;
        }
        this._pendingMissingBrowserRestoreBrowser = null;
        this._pendingMissingBrowserRestoreWidth = null;
        this._pendingMissingBrowserRestoreUseDefault = false;
        this.cancelMissingBrowserSplitWidthPersist();

        const releaseSplitter = splitter instanceof HTMLElement
            ? splitter
            : browser.querySelector('.mr-missing-browser-splitter');

        this._missingBrowserSplitBrowser = browser;
        this._missingBrowserSplitListPane = listPane;
        this._missingBrowserSplitDetailPane = detailPane;
        this._missingBrowserSplitSplitter = releaseSplitter;
        this._missingBrowserSplitDragging = true;
        this._missingBrowserSplitStart = {
            x: event.clientX,
            width: detailWidth,
            bounds,
            browserWidth,
            availableWidth: bounds.available
        };
        this._appliedMissingBrowserSplitWidth = detailWidth;
        this._pendingMissingBrowserSplitWidth = detailWidth;
        this._missingBrowserSplitUiActive = false;

        this._missingBrowserSplitInteraction = startSplitterDrag(event, {
            anchor: 'right',
            startWidth: detailWidth,
            bounds,
            dragThreshold: 4,
            layoutFrameStride: 1,
            onPreview: (pendingWidth) => {
                this._pendingMissingBrowserSplitWidth = pendingWidth;
                this.activateMissingBrowserSplitUi();
            },
            onDrag: (width) => {
                this._pendingMissingBrowserSplitWidth = width;
                this.activateMissingBrowserSplitUi();
                this.applyMissingBrowserDetailWidth(detailPane, width, {
                    browserWidth,
                    availableWidth: bounds.available,
                    splitBounds: bounds,
                    skipIfUnchanged: true
                });
                this._appliedMissingBrowserSplitWidth = width;
            },
            onEnd: (finalWidth, { didDrag = false } = {}) => {
                this._missingBrowserSplitDragging = false;

                if (didDrag) {
                    const settlingNow = typeof performance === 'object' && typeof performance.now === 'function'
                        ? performance.now()
                        : Date.now();
                    this._missingBrowserSplitSettlingUntil = settlingNow + 350;
                }

                if (didDrag && detailPane && finalWidth) {
                    this.applyMissingBrowserDetailWidth(detailPane, finalWidth, {
                        browserWidth,
                        availableWidth: bounds.available,
                        splitBounds: bounds
                    });
                    this._appliedMissingBrowserSplitWidth = finalWidth;
                }
                if (didDrag && finalWidth) {
                    this.persistMissingBrowserSplitWidth(finalWidth, { delay: 600 });
                }
                this.applyMissingBrowserSplitReleaseCleanup({
                    browser,
                    splitter: releaseSplitter
                });

                this._missingBrowserSplitBrowser = null;
                this._missingBrowserSplitListPane = null;
                this._missingBrowserSplitDetailPane = null;
                this._missingBrowserSplitSplitter = null;
                this._missingBrowserSplitStart = null;
                this._missingBrowserSplitUiActive = false;
                this._pendingMissingBrowserSplitWidth = null;
                this._appliedMissingBrowserSplitWidth = null;
                this._missingBrowserSplitInteraction = null;
            }
        });
    },

    activateMissingBrowserSplitUi() {
        if (this._missingBrowserSplitUiActive) return;
        this._missingBrowserSplitUiActive = true;
        this._missingBrowserSplitBrowser?.classList?.add('is-resizing');
        this._missingBrowserSplitSplitter?.classList?.add('is-resizing');
    },

    applyMissingBrowserSplitReleaseCleanup(cleanup) {
        if (!cleanup) return;
        cleanup.browser?.classList?.remove('is-resizing');
        cleanup.splitter?.classList?.remove('is-resizing');
        if (cleanup.splitter?.style) {
            cleanup.splitter.style.transform = '';
            cleanup.splitter.style.willChange = '';
        }
    },

    resizeMissingBrowserDetailBy(browser, delta) {
        const detailPane = browser.querySelector('.mr-missing-detail-pane');
        if (!(detailPane instanceof HTMLElement)) return;

        const currentWidth = this.getMissingBrowserDetailTrackWidth(detailPane)
            || detailPane.getBoundingClientRect().width;
        this.setMissingBrowserDetailWidth(browser, currentWidth + delta);
    },

    applyMissingBrowserDetailWidth(target, width, { skipIfUnchanged = false, browserWidth = null, splitBounds = null } = {}) {
        const detailPane = target instanceof HTMLElement && target.classList.contains('mr-missing-detail-pane')
            ? target
            : target?.querySelector?.('.mr-missing-detail-pane');
        const browser = detailPane instanceof HTMLElement
            ? detailPane.closest('.mr-missing-browser')
            : (target instanceof HTMLElement && target.classList.contains('mr-missing-browser') ? target : null);
        if (!(browser instanceof HTMLElement) || !(detailPane instanceof HTMLElement)) return false;

        const listPane = this._missingBrowserSplitListPane instanceof HTMLElement && this._missingBrowserSplitListPane.isConnected
            ? this._missingBrowserSplitListPane
            : browser.querySelector('.mr-missing-list-pane');
        const measuredWidth = Number(browserWidth);
        const bounds = splitBounds && Number.isFinite(Number(splitBounds.min)) && Number.isFinite(Number(splitBounds.max))
            ? splitBounds
            : Number.isFinite(measuredWidth) && measuredWidth > 0
            ? this.getMissingBrowserSplitBoundsForWidth(measuredWidth)
            : this.getMissingBrowserSplitBounds(browser);
        const requestedWidth = Number.isFinite(Number(width)) ? Number(width) : bounds.min;
        const nextWidth = Math.round(Math.max(bounds.min, Math.min(bounds.max, requestedWidth)));
        const shouldPinList = requestedWidth > bounds.max;
        const wasListPinned = browser.classList.contains('is-list-pinned');
        browser.classList.toggle('is-list-pinned', shouldPinList);
        const detailValue = `${Math.round(shouldPinList ? requestedWidth : nextWidth)}px`;
        const listValue = '0px';

        if (
            skipIfUnchanged
            && detailPane.style.flexBasis === detailValue
            && (!(listPane instanceof HTMLElement) || (
                listPane.style.flexBasis === listValue
                && listPane.style.flexGrow === '1'
                && listPane.style.flexShrink === '1'
            ))
        ) {
            return wasListPinned !== shouldPinList;
        }

        if (listPane instanceof HTMLElement) {
            if (listPane.style.flexBasis !== listValue) listPane.style.flexBasis = listValue;
            if (listPane.style.flexGrow !== '1') listPane.style.flexGrow = '1';
            if (listPane.style.flexShrink !== '1') listPane.style.flexShrink = '1';
        }
        if (detailPane.style.flexBasis !== detailValue) detailPane.style.flexBasis = detailValue;
        if (detailPane.style.flexGrow !== '0') detailPane.style.flexGrow = '0';
        if (detailPane.style.flexShrink !== '0') detailPane.style.flexShrink = '0';
        this._missingBrowserLastDetailWidth = nextWidth;
        return true;
    },

    clearMissingBrowserSplitStyles(browser) {
        if (!(browser instanceof HTMLElement)) return;

        const listPane = browser.querySelector('.mr-missing-list-pane');
        const detailPane = browser.querySelector('.mr-missing-detail-pane');
        [listPane, detailPane].forEach((pane) => {
            if (!(pane instanceof HTMLElement)) return;
            pane.style.removeProperty('flex-basis');
            pane.style.removeProperty('flex-grow');
            pane.style.removeProperty('flex-shrink');
        });
        browser.classList.remove('is-list-pinned');
        detailPane?.style?.removeProperty('--mr-missing-detail-track');
    },

    getMissingBrowserDetailTrackWidth(detailPane) {
        if (!(detailPane instanceof HTMLElement)) return null;

        const inlineBasis = String(detailPane.style.flexBasis || '').trim();
        if (inlineBasis.endsWith('px')) {
            const basisWidth = parseFloat(inlineBasis);
            if (Number.isFinite(basisWidth) && basisWidth > 0) return basisWidth;
        }

        const raw = String(detailPane.style.getPropertyValue('--mr-missing-detail-track') || '').trim();
        if (!raw.endsWith('px')) return null;

        const width = parseFloat(raw);
        return Number.isFinite(width) && width > 0 ? width : null;
    },

    cancelMissingBrowserSplitWidthPersist() {
        if (this._missingBrowserSplitPersistIdle && typeof cancelIdleCallback === 'function') {
            try {
                cancelIdleCallback(this._missingBrowserSplitPersistIdle);
            } catch (_e) {}
        }
        if (this._missingBrowserSplitPersistTimer) {
            clearTimeout(this._missingBrowserSplitPersistTimer);
        }
        this._missingBrowserSplitPersistIdle = null;
        this._missingBrowserSplitPersistTimer = null;
    },

    persistMissingBrowserSplitWidth(width, { delay = 180 } = {}) {
        const nextWidth = Math.round(Number(width));
        if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;

        this._missingBrowserStoredSplitWidth = nextWidth;
        this._missingBrowserStoredSplitWidthLoaded = true;
        this._missingBrowserLastDetailWidth = nextWidth;
        this.cancelMissingBrowserSplitWidthPersist();

        const writeWidth = () => {
            this._missingBrowserSplitPersistIdle = null;
            this._missingBrowserSplitPersistTimer = null;
            try {
                safeStorage.setItem(this.missingBrowserSplitStorageKey, String(nextWidth));
            } catch (_e) {}
        };

        const writeDelay = Math.max(0, Number(delay) || 0);
        this._missingBrowserSplitPersistTimer = setTimeout(writeWidth, writeDelay);
    },

    setMissingBrowserDetailWidth(browser, width, { persist = true, browserWidth = null, skipIfUnchanged = false } = {}) {
        const bounds = this.getMissingBrowserSplitBounds(browser, browserWidth);
        const nextWidth = Math.round(Math.max(bounds.min, Math.min(bounds.max, width)));
        const detailPane = browser.querySelector('.mr-missing-detail-pane');
        const target = detailPane instanceof HTMLElement ? detailPane : browser;
        this.applyMissingBrowserDetailWidth(target, width, {
            browserWidth: Number.isFinite(Number(browserWidth)) && Number(browserWidth) > 0
                ? Number(browserWidth)
                : null,
            availableWidth: bounds.available,
            splitBounds: bounds,
            skipIfUnchanged
        });

        if (persist) {
            this.persistMissingBrowserSplitWidth(nextWidth);
        }
    },

    getMissingBrowserSplitBounds(browser, browserWidth = null, { allowMeasure = false } = {}) {
        const measuredWidth = Number(browserWidth);
        const width = Number.isFinite(measuredWidth) && measuredWidth > 0
            ? measuredWidth
            : this.getFastMissingBrowserWidthEstimate(browser, { allowMeasure });
        if (Number.isFinite(width) && width > 0) {
            this.rememberMissingBrowserWidth(width);
        }
        return this.getMissingBrowserSplitBoundsForWidth(width);
    },

    wireMissingModelDetail(container, missing, missingIndex) {
        this.wireLocalMatchButtons(container, missing, missingIndex);
        this.wireDownloadSearchPanel(container, missing);
        this.updateSelectedBarForMissing(missing);

        const detailDomKey = this.getMissingModelDomKey(missing);
        const localRefreshId = `local-matches-refresh-${detailDomKey}`;
        const localRefreshBtn = container.querySelector(`#${localRefreshId}`);
        if (localRefreshBtn) {
            localRefreshBtn.addEventListener('click', () => this.refreshLocalMatchesForMissing?.(missing, {
                button: localRefreshBtn
            }));
        }

        const locateId = `locate-${detailDomKey}`;
        const locateBtn = container.querySelector(`#${locateId}`);
        const locateTarget = this.getMissingLocateTarget(missing);
        if (locateBtn && locateTarget.nodeId !== undefined && locateTarget.nodeId !== null && locateTarget.nodeId !== '') {
            locateBtn.addEventListener('click', () => {
                this.locateNodeInGraph(locateTarget.nodeId, {
                    subgraphId: locateTarget.subgraphId || '',
                    isTopLevel: locateTarget.isTopLevel
                });
            });
        }

        const comboId = `combo-${detailDomKey}`;
        const comboInput = container.querySelector(`#combo-input-${comboId}`);
        const comboList = container.querySelector(`#combo-list-${comboId}`);
        const comboRefresh = container.querySelector(`#combo-refresh-${comboId}`);

        const getAllModels = () => Array.isArray(this.allModels) ? this.allModels : [];
        let localModelLoadToken = 0;
        const normalizeModelPath = (value = '') => this.normalizePathToForward(value)
            .split('/')
            .map(part => part.trim())
            .filter(Boolean)
            .join('/');
        const getModelCategory = (model = {}) => this.normalizeDownloadCategory(model.category || 'unknown') || 'unknown';
        const getDownloadCategoryElement = () => container.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`)
            || this.contentElement?.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const getPreferredModelCategory = () => {
            const categoryEl = getDownloadCategoryElement();
            const selectedCategory = this.normalizeDownloadCategory(this.getDropdownValue?.(categoryEl) || categoryEl?.value || '');
            const savedCategory = this.normalizeDownloadCategory(this.getSavedDownloadTargetSelection?.(missing)?.category || '');
            const inferredCategory = this.normalizeDownloadCategory(
                missing.category || this.getMissingDownloadCategory?.(missing, 'unknown') || 'unknown'
            );
            return selectedCategory || savedCategory || inferredCategory || 'unknown';
        };
        const getLocalModelExpandedSet = (preferredCategory = getPreferredModelCategory()) => {
            if (!this.localModelBrowserExpandedGroups) {
                this.localModelBrowserExpandedGroups = new Map();
            }
            const key = preferredCategory || 'all';
            if (!this.localModelBrowserExpandedGroups.has(key)) {
                this.localModelBrowserExpandedGroups.set(key, new Set());
            }
            return this.localModelBrowserExpandedGroups.get(key);
        };
        const getCurrentQueuedModelIdentity = () => {
            const key = this.getMissingModelKey(missing);
            const idx = this.pendingIndex?.get?.(key);
            const selection = Number.isInteger(idx) ? this.pendingResolutions?.[idx] : null;
            const model = selection?.resolved_model || {};
            return [
                model.path || selection?.resolved_path || '',
                model.relative_path || '',
                model.filename || '',
                model.category || selection?.category || ''
            ].map(value => String(value || '').trim().toLowerCase()).join('::');
        };
        const getModelIdentity = (model = {}) => [
            model.path || '',
            model.relative_path || '',
            model.filename || '',
            model.category || ''
        ].map(value => String(value || '').trim().toLowerCase()).join('::');
        const getLocalModelDedupeIdentity = (entry = {}) => {
            const path = String(entry.fullPath || entry.model?.path || '').trim();
            if (path) {
                return normalizePathIdentity(path);
            }
            return [
                entry.baseDirectory || '',
                entry.relativePath || entry.model?.relative_path || entry.model?.filename || ''
            ].map(normalizePathIdentity).join('::');
        };
        const getLocalModelCategoryRank = (category = '', preferredCategory = '') => {
            const normalized = this.normalizeDownloadCategory(category || '');
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
        };
        const dedupeLocalModelEntries = (entries = [], preferredCategory = '') => {
            const byIdentity = new Map();
            entries.forEach(entry => {
                const identity = getLocalModelDedupeIdentity(entry);
                if (!identity) return;
                const previous = byIdentity.get(identity);
                if (!previous) {
                    byIdentity.set(identity, entry);
                    return;
                }
                const currentRank = getLocalModelCategoryRank(entry.category, preferredCategory);
                const previousRank = getLocalModelCategoryRank(previous.category, preferredCategory);
                if (
                    currentRank < previousRank
                    || (currentRank === previousRank && String(entry.category || '').localeCompare(String(previous.category || '')) < 0)
                ) {
                    byIdentity.set(identity, entry);
                }
            });
            return Array.from(byIdentity.values());
        };

        const joinLocalModelPath = (basePath = '', relativePath = '') => {
            if (typeof this.joinLocalPath === 'function') {
                return this.joinLocalPath(basePath, relativePath);
            }
            const rawBase = String(basePath || '');
            const relative = String(relativePath || '').replace(/^[/\\]+/, '');
            const usesBackslash = /^[A-Za-z]:\\/.test(rawBase)
                || /^\\\\/.test(rawBase)
                || (!rawBase.includes('/') && rawBase.includes('\\'));
            const separator = usesBackslash ? '\\' : '/';
            const base = rawBase.replace(usesBackslash ? /[/\\]+$/ : /\/+$/, '')
                || (usesBackslash ? (/^\\+$/.test(rawBase) ? '\\' : '') : (/^\/+$/.test(rawBase) ? '/' : ''));
            if (!base) return relative;
            if (!relative) return base;
            const joiner = base.endsWith(separator) ? '' : separator;
            return `${base}${joiner}${relative.replace(/[/\\]+/g, separator)}`;
        };
        const buildLocalFolderContext = (folderPath = '', name = 'Folder', category = '') => {
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
        };
        const buildLocalModelContext = (entry = {}) => {
            const model = entry.model || {};
            const path = entry.fullPath || model.path || model.resolved_path || '';
            if (!path) return null;
            const directory = entry.folderPath
                ? joinLocalModelPath(entry.baseDirectory, entry.folderPath)
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
        };
        const getLocalPathContextAttrs = (context, tooltip = 'Right-click for options') => {
            return this.getContextMenuAttrs(context, tooltip);
        };
        const makeModelEntry = (model, index, preferredCategory = getPreferredModelCategory()) => {
            const category = getModelCategory(model);
            const categoryLabel = this.getCategoryDisplayName(category);
            const relativePath = normalizeModelPath(model.relative_path || model.filename || '');
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
                baseLabel: this.getBaseDirectoryLabel(baseDirectory),
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
        };
        const localModelTreePicker = createFloatingTreePicker({
            listEl: comboList,
            anchorEl: comboInput,
            duplicateSelector: '.mr-combo-list[data-ml-floating-portal="true"]',
            floatingClass: 'mr-download-target-floating',
            browserClass: 'mr-local-model-browser',
            scrollSelector: '.mr-local-model-browser-scroll',
            minAvailableWidth: 280,
            minPopupWidth: 520,
            maxPopupWidth: 760,
            openAboveThreshold: 280,
            minAvailableHeight: 180,
            minScrollHeight: 120,
            roundValues: true
        });
        const showComboList = () => localModelTreePicker.show();
        const hideComboList = () => localModelTreePicker.hide();
        const positionComboList = () => localModelTreePicker.position();
        if (comboList) {
            this.bindDropdownOutsideDismiss?.(comboList, [comboInput, comboRefresh], hideComboList);
            this.enableWheelScrollChaining(comboList);
        }
        const buildModelTree = (entries = []) => {
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
        };
        const countTreeModels = (node) => {
            let count = node.models?.length || 0;
            node.folders?.forEach(child => {
                count += countTreeModels(child);
            });
            return count;
        };
        const renderModelRows = (entries = [], selectedIdentity = '') => entries
            .sort((a, b) => a.filename.localeCompare(b.filename))
            .map(entry => {
                const selected = getModelIdentity(entry.model) === selectedIdentity;
                const folderText = entry.folderPath || entry.baseLabel || '';
                const context = buildLocalModelContext(entry);
                const contextAttrs = getLocalPathContextAttrs(context, entry.fullPath || entry.relativePath);
                return `
                    <div class="mr-folder-browser-row mr-local-model-row ${selected ? 'is-selected' : ''}" data-browser-action="select-model" data-model-index="${entry.index}"${contextAttrs}>
                        <span class="mr-folder-browser-toggle mr-folder-browser-toggle-empty"></span>
                        <span class="mr-folder-browser-folder-icon mr-local-model-file-icon">${getSvgIcon('file', 'currentColor', 'mr-folder-browser-svg')}</span>
                        <span class="mr-folder-browser-name">${this.escapeHtml(entry.filename)}</span>
                        ${folderText ? `<span class="mr-local-model-folder-tag">${this.escapeHtml(folderText)}</span>` : ''}
                    </div>
                `;
            })
            .join('');
        const renderModelTreeNodes = (node, group, expandedSet, filter, selectedIdentity) => {
            const folderHtml = Array.from(node.folders.values())
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(folder => {
                    const stateKey = `node:${group.key}:${folder.path.toLowerCase()}`;
                    const modelCount = countTreeModels(folder);
                    const shouldExpand = Boolean(filter) || expandedSet.has(stateKey);
                    const folderFullPath = group.baseDirectory
                        ? joinLocalModelPath(group.baseDirectory, folder.path)
                        : '';
                    const context = buildLocalFolderContext(folderFullPath, folder.path, group.category);
                    const contextAttrs = getLocalPathContextAttrs(context, folderFullPath);
                    return `
                        <div class="mr-folder-browser-node">
                            <div class="mr-folder-browser-row is-expandable mr-local-model-folder-row" data-browser-action="toggle" data-state-key="${encodeURIComponent(stateKey)}"${contextAttrs}>
                                <button class="mr-folder-browser-toggle ${shouldExpand ? 'is-expanded' : ''}" type="button" aria-label="${shouldExpand ? 'Collapse folder' : 'Expand folder'}"><span class="mr-folder-browser-chevron"></span></button>
                                <span class="mr-folder-browser-folder-icon">${getSvgIcon('folderOpen', 'currentColor', 'mr-folder-browser-svg')}</span>
                                <span class="mr-folder-browser-name">${this.escapeHtml(folder.name)}</span>
                                <span class="mr-folder-browser-count">${modelCount}</span>
                            </div>
                            <div class="mr-folder-browser-children ${shouldExpand ? 'is-expanded' : ''}">
                                ${shouldExpand ? renderModelTreeNodes(folder, group, expandedSet, filter, selectedIdentity) : ''}
                            </div>
                        </div>
                    `;
                })
                .join('');
            return `${renderModelRows(node.models || [], selectedIdentity)}${folderHtml}`;
        };
        const renderLocalModelLoadingState = (message = 'Loading local models...') => {
            if (!comboList) return;
            comboList.innerHTML = `
                <div class="mr-local-model-browser-scroll">
                    <div class="mr-folder-browser-empty">${this.escapeHtml(message)}</div>
                </div>
            `;
            positionComboList();
        };
        const populateComboOptions = (filterText, options = {}) => {
            if (!comboList) return;
            const previousScrollEl = comboList.querySelector('.mr-local-model-browser-scroll');
            const previousScrollTop = options.preserveScroll && previousScrollEl ? previousScrollEl.scrollTop : 0;
            const allModels = getAllModels();
            const activePreferredCategory = getPreferredModelCategory();
            const allEntries = dedupeLocalModelEntries(
                allModels.map((model, index) => makeModelEntry(model, index, activePreferredCategory)),
                activePreferredCategory
            );
            const rawFilter = String(filterText || '').trim();
            const filter = rawFilter.toLowerCase();
            const tokens = filter.split(/\s+/).filter(Boolean);
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
                        isPreferred: entry.category === activePreferredCategory,
                        entries: []
                    });
                }
                grouped.get(groupKey).entries.push(entry);
            });
            const expandedSet = getLocalModelExpandedSet(activePreferredCategory);
            const selectedIdentity = getCurrentQueuedModelIdentity();
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
                    const rootContext = buildLocalFolderContext(
                        group.baseDirectory,
                        `${group.label} root`,
                        group.category
                    );
                    const rootContextAttrs = getLocalPathContextAttrs(rootContext, group.baseDirectory || group.label);
                    return `
                        <div class="mr-folder-browser-root ${group.isPreferred ? 'is-preferred' : ''}">
                            <button class="mr-folder-browser-root-head ${isExpanded ? 'is-expanded' : ''}" type="button" data-browser-action="toggle" data-state-key="${encodeURIComponent(stateKey)}"${rootContextAttrs}>
                                <span class="mr-folder-browser-chevron"></span>
                                <span class="mr-folder-browser-root-title">${this.escapeHtml(group.label)}${group.isPreferred ? ' · recommended' : ''}</span>
                                <span class="mr-folder-browser-root-count">${group.entries.length}</span>
                            </button>
                            ${group.baseDirectory ? `<div class="mr-folder-browser-root-path">${this.escapeHtml(group.baseDirectory)}</div>` : ''}
                            <div class="mr-folder-browser-tree ${isExpanded ? 'is-expanded' : ''}">
                                ${isExpanded ? renderModelTreeNodes(tree, group, expandedSet, filter, selectedIdentity) : ''}
                            </div>
                        </div>
                    `;
                })
                .join('');
            const emptyHtml = tokens.length
                ? `<div class="mr-folder-browser-empty">No local models match this filter.</div>`
                : `<div class="mr-folder-browser-empty">No local models in the enabled categories.</div>`;

            comboList.innerHTML = `
                <div class="mr-local-model-browser-scroll">
                    ${groupsHtml || emptyHtml}
                </div>
            `;

            comboList.querySelectorAll('[data-browser-action="toggle"]').forEach(row => {
                row.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const scrollElBefore = comboList.querySelector('.mr-local-model-browser-scroll');
                    const scrollTop = scrollElBefore ? scrollElBefore.scrollTop : 0;
                    const stateKey = decodeURIComponent(row.dataset.stateKey || '');
                    if (!stateKey) return;
                    const collapsedStateKey = `collapsed:${stateKey}`;
                    const isExpanded = row.classList.contains('is-expanded')
                        || Boolean(row.querySelector('.mr-folder-browser-toggle.is-expanded'));
                    if (isExpanded) {
                        expandedSet.delete(stateKey);
                        expandedSet.add(collapsedStateKey);
                    } else {
                        expandedSet.add(stateKey);
                        expandedSet.delete(collapsedStateKey);
                    }
                    populateComboOptions(comboInput?.value || '', { preserveScroll: true });
                    const scrollEl = comboList.querySelector('.mr-local-model-browser-scroll');
                    if (scrollEl) scrollEl.scrollTop = scrollTop;
                    positionComboList();
                });
            });
            comboList.querySelectorAll('[data-browser-action="select-model"]').forEach(el => {
                el.addEventListener('click', () => {
                    const idx = parseInt(el.dataset.modelIndex, 10);
                    if (!Number.isNaN(idx) && idx >= 0 && idx < allModels.length) {
                        const chosenModel = allModels[idx];
                        if (chosenModel) {
                            this.queueResolution(missing, chosenModel);
                            hideComboList();
                        }
                    }
                });
            });
            const scrollEl = comboList.querySelector('.mr-local-model-browser-scroll');
            if (scrollEl) {
                this.enableWheelScrollChaining(scrollEl);
                scrollEl.scrollTop = previousScrollTop;
            }
            positionComboList();
        };
        const ensureLocalModelsThenPopulate = async (filterText = '', options = {}) => {
            if (Array.isArray(this.allModels) && this.allModels.length > 0) {
                populateComboOptions(filterText, options);
                return;
            }

            const token = ++localModelLoadToken;
            renderLocalModelLoadingState();
            try {
                await this.ensureAllModelsLoaded?.();
            } catch (error) {
                console.warn('Model Resolver: could not load local models for picker', error);
            }
            if (token !== localModelLoadToken) return;
            populateComboOptions(filterText, options);
        };

        if (comboInput) {
            const debouncedFilter = this.debounce(() => {
                ensureLocalModelsThenPopulate(comboInput.value);
            }, 200);
            comboInput.addEventListener('input', debouncedFilter);
            const focusOrClick = () => {
                showComboList();
                ensureLocalModelsThenPopulate(comboInput.value);
            };
            comboInput.addEventListener('focus', focusOrClick);
            comboInput.addEventListener('click', focusOrClick);
        }

        const categoryPriorityEl = getDownloadCategoryElement();
        if (categoryPriorityEl && categoryPriorityEl.dataset.mlLocalModelPriorityBound !== 'true') {
            categoryPriorityEl.dataset.mlLocalModelPriorityBound = 'true';
            let lastPriorityCategory = getPreferredModelCategory();
            const refreshLocalModelPriority = () => {
                const nextPriorityCategory = getPreferredModelCategory();
                if (nextPriorityCategory === lastPriorityCategory && comboList?.style.display === 'none') {
                    return;
                }
                lastPriorityCategory = nextPriorityCategory;
                ensureLocalModelsThenPopulate(comboInput?.value || '', { preserveScroll: true });
            };
            categoryPriorityEl.addEventListener('input', refreshLocalModelPriority);
            categoryPriorityEl.addEventListener('change', refreshLocalModelPriority);
            categoryPriorityEl.addEventListener('blur', () => setTimeout(refreshLocalModelPriority, 0));
            categoryPriorityEl.addEventListener('mr-download-category-change', refreshLocalModelPriority);
        }

        if (comboRefresh) {
            comboRefresh.addEventListener('click', async () => {
                const minRefreshFeedback = new Promise(resolve => setTimeout(resolve, 420));
                const refreshAnimation = this.startRefreshButtonAnimation(comboRefresh);
                try {
                    comboRefresh.disabled = true;
                    comboRefresh.classList.add('mr-btn-is-disabled', 'mr-is-refreshing');
                    this.allModels = null;
                    await this.ensureAllModelsLoaded({ force: true });
                    await minRefreshFeedback;
                    populateComboOptions(comboInput?.value || '');
                } catch (error) {
                    await minRefreshFeedback;
                    console.warn('Model Resolver: could not refresh local model list', error);
                    this.showNotification('Failed to refresh local model list', 'error');
                } finally {
                    refreshAnimation?.cancel();
                    comboRefresh.disabled = false;
                    comboRefresh.classList.remove('mr-btn-is-disabled', 'mr-is-refreshing');
                }
            });
        }

        const state = this.searchResultCache.get(this.getMissingSearchKey(missing));
        const searchResultsDiv = container.querySelector(`#search-results-${missing.node_id}-${missing.widget_index}`);
        if (state && searchResultsDiv && this.hasRenderableSearchState(state)) {
            searchResultsDiv.classList.remove('mr-is-hidden');
            searchResultsDiv.classList.add('mr-is-visible');
            this.displaySearchResults(missing, state, searchResultsDiv);
        }

        this.restoreDownloadProgressForMissing?.(missing);
    },

    startRefreshButtonAnimation(button) {
        if (!button) return null;

        const target = button.querySelector('.mr-refresh-spin-target') || button.querySelector('svg');
        if (!target || typeof target.animate !== 'function') return null;

        const existing = target.getAnimations?.() || [];
        existing.forEach(animation => animation.cancel());
        target.style.transformOrigin = 'center';

        return target.animate(
            [
                { transform: 'rotate(0deg)' },
                { transform: 'rotate(360deg)' }
            ],
            {
                duration: 620,
                easing: 'linear',
                iterations: Infinity
            }
        );
    },

    /**
     * Display missing models in the dialog
     */
    displayMissingModels(container, data, options = {}) {
        const selectionOnly = !!options.selectionOnly;
        const preserveBrowser = !!options.preserveBrowser;
        const listScrollSnapshot = this.getMissingListScrollSnapshot(container);
        const previousMissingModels = Array.isArray(this.missingModels)
            ? [...this.missingModels]
            : [];
        const previousSelectedMissingModelKey = this.selectedMissingModelKey || '';
        const previousBatchSelectedMissingKeys = new Set(this.batchSelectedMissingKeys || []);
        const previousLastBatchSelectedMissingKey = this.lastBatchSelectedMissingKey || '';
        // Resolving the download state used to serialize the whole workflow for
        // every missing model. Keep the scope stable for this render pass.
        const downloadWorkflowScope = this.getCurrentDownloadWorkflowScopeIdentity?.() || '';
        const missingModels = (data.missing_models || []).map(missing => {
            let restored = this.restoreDownloadedLocalMatchesForMissing?.(missing, downloadWorkflowScope) || missing;
            restored = this.restoreSearchLocalHashMatchesForMissing?.(restored) || restored;
            restored.matches = this.preserveActiveDownloadLocalMatches?.(
                restored,
                restored.matches || [],
                downloadWorkflowScope
            ) || restored.matches || [];
            return restored;
        });
        const resolvedModels = this.getResolvedWorkflowModels(data);
        const allModelsForDisplay = [...missingModels, ...resolvedModels];
        const rawMissingCount = data.total_missing ?? missingModels.length;
        const resolvedMissingCount = this.getResolvedMissingCount(missingModels);
        const resolvedCount = resolvedMissingCount + resolvedModels.length;
        const unresolvedMissingCount = Math.max(0, rawMissingCount - resolvedMissingCount);
        const hiddenResolvedCount = this.showResolvedModels ? 0 : resolvedCount;
        const resolvedFilteredModels = this.showResolvedModels
            ? allModelsForDisplay
            : allModelsForDisplay.filter(missing => !this.isMissingModelResolved(missing));
        const isInactiveUnresolvedModel = missing => (
            !this.isMissingModelResolved(missing) && this.isMissingModelInactive(missing)
        );
        const inactiveCount = resolvedFilteredModels.reduce((count, missing) => (
            count + (isInactiveUnresolvedModel(missing) ? 1 : 0)
        ), 0);
        const hiddenInactiveCount = this.showInactiveModels ? 0 : inactiveCount;
        const inactiveFilteredModels = this.showInactiveModels
            ? resolvedFilteredModels
            : resolvedFilteredModels.filter(missing => !isInactiveUnresolvedModel(missing));
        const autoDownloadCount = resolvedFilteredModels.reduce((count, missing) => (
            count + (this.isAutoDownloadModel(missing) ? 1 : 0)
        ), 0);
        const hiddenAutoDownloadCount = this.showAutoDownloadModels ? 0 : autoDownloadCount;
        const typeFilterSourceModels = this.showAutoDownloadModels
            ? inactiveFilteredModels
            : inactiveFilteredModels.filter(missing => !this.isAutoDownloadModel(missing));
        const getTypeFilterValue = missing => String(missing?.category || 'unknown').trim().toLowerCase() || 'unknown';
        const typeFilterCounts = new Map();
        const typeFilterLabels = new Map();
        typeFilterSourceModels.forEach((missing) => {
            const value = getTypeFilterValue(missing);
            typeFilterCounts.set(value, (typeFilterCounts.get(value) || 0) + 1);
            if (!typeFilterLabels.has(value)) {
                typeFilterLabels.set(
                    value,
                    missing.category ? this.getCategoryDisplayName(missing.category) : 'Unknown'
                );
            }
        });
        let activeTypeFilter = String(this.missingModelsTypeFilter || 'all').toLowerCase();
        if (activeTypeFilter !== 'all' && !typeFilterCounts.has(activeTypeFilter)) {
            activeTypeFilter = 'all';
            this.missingModelsTypeFilter = 'all';
            this.missingModelsTypeFilterMenuOpen = false;
        }
        const typeFilterOptions = [
            { value: 'all', label: 'All', count: typeFilterSourceModels.length },
            ...Array.from(typeFilterCounts, ([value, count]) => ({
                value,
                label: typeFilterLabels.get(value) || value,
                count,
                colorClass: this.getModelTypeColorClass(value)
            })).sort((left, right) => left.label.localeCompare(right.label))
        ];
        const visibleMissingModels = activeTypeFilter === 'all'
            ? typeFilterSourceModels
            : typeFilterSourceModels.filter(missing => getTypeFilterValue(missing) === activeTypeFilter);
        const currentModelKeys = new Set(
            allModelsForDisplay.map(missing => this.getMissingModelKey(missing))
        );
        const resolveSelectionKey = (previousKey) => {
            if (!previousKey) return '';
            if (currentModelKeys.has(previousKey)) {
                return visibleMissingModels.some(
                    missing => this.getMissingModelKey(missing) === previousKey
                ) ? previousKey : '';
            }
            return this.resolvePreservedMissingModelKey(
                visibleMissingModels,
                previousMissingModels,
                previousKey
            );
        };
        this.selectedMissingModelKey = resolveSelectionKey(previousSelectedMissingModelKey)
            || (visibleMissingModels.length ? this.getMissingModelKey(visibleMissingModels[0]) : null);
        this.batchSelectedMissingKeys = this.remapMissingModelKeys(
            visibleMissingModels,
            previousMissingModels,
            previousBatchSelectedMissingKeys,
            allModelsForDisplay
        );
        this.lastBatchSelectedMissingKey = resolveSelectionKey(previousLastBatchSelectedMissingKey) || null;
        this.missingModels = visibleMissingModels;
        this.syncBatchSelectionForMissingModels(visibleMissingModels);

        // Check if there are active downloads
        const activeCount = Object.keys(this.activeDownloads).length;
        const hasAny100Match = visibleMissingModels.some(missing =>
            (missing.matches || []).some(match => match.confidence === 100)
        );
        const hasAnyModelsToDisplay = rawMissingCount > 0 || resolvedModels.length > 0;

        this.setMissingFooterControlsVisible(hasAnyModelsToDisplay || activeCount > 0);

        // Hide download all button if no missing models
        if (this.downloadAllButton) {
            this.downloadAllButton.style.display = (rawMissingCount > 0 || activeCount > 0) ? 'inline-flex' : 'none';
        }

        if (!hasAnyModelsToDisplay && activeCount === 0) {
            this.destroyMissingModelsVirtualizer(container);
            container.innerHTML = this.renderStatusMessage('All models are available! No missing models found.', 'success');
            return;
        }

        // If no missing models but downloads are active, show a waiting message
        if (rawMissingCount === 0 && activeCount > 0 && !resolvedModels.length) {
            this.destroyMissingModelsVirtualizer(container);
            container.innerHTML = this.renderStatusMessage(
                `${activeCount} download${activeCount > 1 ? 's' : ''} in progress. Local matches will refresh when complete.`,
                'info'
            );
            return;
        }

        // Skip rendering if active tab is not "missing"
        if (this.activeTab !== 'missing') {
            return;
        }

        const needsDownloadDirectories = !this.downloadDirectories;
        const needsDownloadRootDirectories = !this.downloadRootDirectories
            && typeof this.ensureDownloadRootDirectoriesLoaded === 'function';
        if (needsDownloadDirectories || needsDownloadRootDirectories) {
            const renderToken = `download-dirs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this._downloadDirectoriesRenderToken = renderToken;
            const keepCurrentBrowser = preserveBrowser
                && Boolean(container.querySelector('.mr-missing-browser'));
            if (!keepCurrentBrowser) {
                this.destroyMissingModelsVirtualizer(container);
                container.innerHTML = this.renderStatusMessage('Loading model folders...', 'info');
            }

            const loaders = [];
            if (needsDownloadDirectories) {
                loaders.push(this.ensureDownloadDirectoriesLoaded?.());
            }
            if (needsDownloadRootDirectories) {
                loaders.push(this.ensureDownloadRootDirectoriesLoaded());
            }

            Promise.allSettled(loaders).then(() => {
                if (
                    this._downloadDirectoriesRenderToken === renderToken &&
                    this.activeTab === 'missing' &&
                    container.isConnected
                ) {
                    this.displayMissingModels(container, data, {
                        preserveBrowser: keepCurrentBrowser
                    });
                }
            });
            return;
        }

        // Sort missing models: those with 100% confidence matches first, then others
        const sortedMissingModels = [...visibleMissingModels].sort((a, b) => {
            const aMatches = a.matches || [];
            const bMatches = b.matches || [];

            // Filter to 70%+ confidence
            const aFiltered = aMatches.filter(m => m.confidence >= 70);
            const bFiltered = bMatches.filter(m => m.confidence >= 70);

            // Check if they have 100% matches
            const aHas100 = aFiltered.some(m => m.confidence === 100);
            const bHas100 = bFiltered.some(m => m.confidence === 100);

            // If one has 100% and the other doesn't, prioritize the one with 100%
            if (aHas100 && !bHas100) return -1;
            if (!aHas100 && bHas100) return 1;

            // If both have 100% or neither has 100%, sort by best confidence
            const aBestConf = aFiltered.length > 0 ? Math.max(...aFiltered.map(m => m.confidence)) : 0;
            const bBestConf = bFiltered.length > 0 ? Math.max(...bFiltered.map(m => m.confidence)) : 0;

            return bBestConf - aBestConf; // Higher confidence first
        });

        for (let mi = 0; mi < sortedMissingModels.length; mi++) {
            sortedMissingModels[mi].__displayIndex = mi;
        }

        const selectedStillExists = sortedMissingModels.some(missing => (
            this.getMissingModelKey(missing) === this.selectedMissingModelKey
        ));
        if (!selectedStillExists) {
            this.selectedMissingModelKey = sortedMissingModels.length
                ? this.getMissingModelKey(sortedMissingModels[0])
                : null;
        }

        this.missingModels = sortedMissingModels;

        const existingBrowser = container.querySelector('.mr-missing-browser');
        const detailPane = existingBrowser?.querySelector('.mr-missing-detail-pane');
        const listContainer = existingBrowser?.querySelector('.mr-missing-list');
        const preservedDetailWidth = this.getMissingBrowserDetailWidthForRerender(existingBrowser);

        if (selectionOnly && existingBrowser && detailPane && listContainer) {
            const rows = listContainer.querySelectorAll('.mr-missing-list-row');
            rows.forEach(row => {
                const rowKey = row.dataset.missingKey;
                const shouldBeSelected = rowKey === this.selectedMissingModelKey;
                if (row.classList.contains('is-selected') !== shouldBeSelected) {
                    row.classList.toggle('is-selected', shouldBeSelected);
                }
            });

            const selectedMissing = sortedMissingModels.find(missing => this.getMissingModelKey(missing) === this.selectedMissingModelKey);
            const detailIndex = sortedMissingModels.indexOf(selectedMissing);

            detailPane.innerHTML = selectedMissing
                ? this.renderMissingModel(selectedMissing, detailIndex)
                : this.renderStatusMessage('Select a missing model to inspect details.', 'info');

            if (selectedMissing) {
                this.wireMissingModelDetail(container, selectedMissing, detailIndex);
            }

            this.reconnectActiveSearchProgress(sortedMissingModels);
            this.updateBatchFooterButtons();
            return;
        }

        const browserHtml = this.renderMissingModelsBrowser(
            sortedMissingModels,
            this.selectedMissingModelKey,
            sortedMissingModels.length,
            activeCount,
            hasAny100Match,
            {
                hiddenResolvedCount,
                hiddenAutoDownloadCount,
                hiddenInactiveCount,
                autoDownloadCount,
                inactiveCount,
                resolvedCount,
                rawMissingCount,
                missingCount: unresolvedMissingCount,
                typeFilterOptions,
                activeTypeFilter,
                detailWidth: preservedDetailWidth,
            }
        );
        this._missingBrowserDetailPreserved = false;
        const browserPatched = options.preserveBrowser
            && this.patchMissingModelsBrowserElement(container, browserHtml);
        if (!browserPatched) {
            this.destroyMissingModelsVirtualizer(container);
            container.innerHTML = browserHtml;
        }
        this.wireMissingModelsBrowser(container, data, sortedMissingModels);
        this.restoreMissingListScroll(container, listScrollSnapshot);
        this.refreshMissingModelsVirtualizer(container, true);
        this.scheduleInitialUrnLocalMatchRefresh(sortedMissingModels, container, data);
        this.reconnectActiveSearchProgress(sortedMissingModels);
        this.updateBatchFooterButtons();
    },

    async refreshMissingAnalysis(button = null) {
        if (button?.disabled) return;

        const minRefreshFeedback = new Promise(resolve => setTimeout(resolve, 420));
        const refreshAnimation = this.startRefreshButtonAnimation(button);
        try {
            if (button) {
                button.disabled = true;
                button.classList.add('mr-btn-is-disabled', 'mr-is-refreshing');
            }

            this.showNotification('Refreshing missing models and local matches...', 'info');
            this.allModels = null;
            this.invalidateLoadedModelsCacheForActiveWorkflow?.();
            await minRefreshFeedback;
            await this.loadWorkflowData(null, { force: true });
        } catch (error) {
            console.error('Model Resolver: missing analysis refresh failed:', error);
            this.showNotification('Refresh failed: ' + error.message, 'error');
        } finally {
            if (button) {
                refreshAnimation?.cancel();
                button.disabled = false;
                button.classList.remove('mr-btn-is-disabled', 'mr-is-refreshing');
            }
        }
    },

    renderMissingModel(missing, missingIndex = 0) {
        const allMatches = missing.matches || [];

        // Filter out matches below 70% confidence threshold
        const filteredMatches = allMatches.filter(m => m.confidence >= 70);

        // Calculate 100% matches upfront (needed for download section)
        const perfectMatches = filteredMatches.filter(m => m.confidence === 100);

        const missingFilename = this.getMissingFilename(missing);

        // Determine node info for the chip
        const nodeDisplay = this.getMissingNodeDisplay(missing);
        const nodeChipText = this.escapeHtml(nodeDisplay.text);

        // Start card
        let html = `<div class="mr-card">`;

        // Card Header: Filename as headline + node chip
        html += `<div class="mr-card-header">`;
        html += `<div class="mr-card-title-wrap">`;

        const titleMetaParts = [];
        let titlePrimaryHtml = `<span class="mr-card-title-primary" data-tooltip="${this.escapeHtml(missingFilename)}">${this.escapeHtml(missingFilename)}</span>`;
        let titleSecondaryHtml = '';

        const modelId = missing.urn_model_id || missing.urn?.model_id;
        const versionId = missing.urn_version_id || missing.urn?.version_id;
        const modelUrl = missing.is_urn && modelId ? getCivitaiModelUrl(modelId, versionId) : '';
        const urnLoadingId = `urn-loading-${missing.node_id}-${missing.widget_index}`;

        if (missing.is_urn) {
            titleMetaParts.push(`<span class="mr-card-title-eyebrow" data-tooltip="${this.escapeHtml(missingFilename)}">${this.escapeHtml(missingFilename)}</span>`);
        }

        if (missing.is_urn && !missing.civitai_info) {
            // URN without info - show Loading and fetch async in background
            titlePrimaryHtml = `<span class="mr-card-title-primary" id="${urnLoadingId}">Resolving CivitAI model...</span>`;
            setTimeout(() => this.resolveUrnAsync(modelId, versionId, urnLoadingId, modelUrl), 10);
        } else if (missing.is_urn && missing.civitai_info) {
            // URN with resolved info - show model name/version
            const civitaiInfo = missing.civitai_info;
            const civitaiLabelHtml = this.renderVersionedModelNameHtml(civitaiInfo.model_name, civitaiInfo.version_name);
            if (civitaiLabelHtml) {
                const linkHtml = modelUrl ? `<a href="${modelUrl}" target="_blank" class="mr-inline-civitai-link">${civitaiLabelHtml}</a>` : `<span class="mr-inline-civitai-link">${civitaiLabelHtml}</span>`;
                titlePrimaryHtml = `<span class="mr-card-title-primary">${linkHtml}</span>`;
            }
            if (civitaiInfo.expected_filename) {
                titleSecondaryHtml = `<span class="mr-card-title-secondary">Expected file: ${civitaiInfo.expected_filename}</span>`;
            }
        }

        html += `<div class="mr-card-title-meta">`;
        html += titleMetaParts.join('');
        html += `<h3 class="mr-card-title">${titlePrimaryHtml}</h3>`;
        if (titleSecondaryHtml) {
            html += titleSecondaryHtml;
        }
        html += `</div>`;
        const detailDomKey = this.getMissingModelDomKey(missing);
        const locateId = `locate-${detailDomKey}`;
        const nodeChipClasses = nodeDisplay.canLocate ? 'mr-node-chip is-locatable' : 'mr-node-chip';
        const nodeChipTitle = nodeDisplay.canLocate ? nodeDisplay.locateTooltip : '';

        html += `<div class="mr-card-subtitle">`;
        if (missing.category) {
            html += `<span class="mr-category-chip ${this.getModelTypeColorClass(missing.category)}" data-tooltip="${this.escapeHtml(missing.category)}">${this.getCategoryDisplayName(missing.category)}</span>`;
        }
        html += this.renderMissingModelFormatBadges(missing);
        html += `<span id="${locateId}" class="${nodeChipClasses}"${nodeChipTitle ? ` data-tooltip="${this.escapeHtml(nodeChipTitle)}"` : ''}>`;
        if (nodeDisplay.canLocate) {
            html += this.getLocateIconHtml();
        }
        html += `${nodeChipText}</span>`;
        html += this.renderMissingNodeFolderBadge(missing);
        html += this.renderMissingAutoDownloadBadge(missing);
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;

        // Selected bar - shows if this slot has a queued selection (BELOW card header)
        const selectedBarId = `selected-bar-${detailDomKey}`;
        html += `<div id="${selectedBarId}" class="model-resolver-selected"></div>`;

        // Two-column layout
        html += `<div class="mr-columns">`;

        // LEFT COLUMN: Local Matches
        html += `<div class="mr-column">`;
        const localRefreshId = `local-matches-refresh-${detailDomKey}`;
        html += `<div class="mr-column-header mr-local-matches-header">`;
        html += `<span>Local Matches</span>`;
        html += `<button id="${localRefreshId}" type="button" aria-label="Refresh local matches" data-tooltip="Rescan local model folders and refresh matches for this model" class="mr-btn mr-btn-secondary mr-btn-sm mr-btn-icon-only mr-local-matches-refresh-btn"><span class="mr-refresh-spin-target">${getSvgIcon('refreshCw', 'currentColor', 'mr-combo-refresh-icon')}</span></button>`;
        html += `</div>`;
        html += `<div id="local-matches-body-${detailDomKey}">`;
        html += this.renderLocalMatchesContent(missing, missingIndex);
        html += `</div>`;

        // Add all-models search picker - combo-style dropdown
        const comboId = `combo-${detailDomKey}`;
        html += `<div class="mr-combo-section">`;
        html += `<div class="mr-combo-row">`;
        html += `<label class="mr-combo-label">Model</label>`;
        html += `<input id="combo-input-${comboId}" class="mr-combo-input" type="text" placeholder="Type to filter local models...">`;
        html += `<button id="combo-refresh-${comboId}" type="button" aria-label="Reload local model list" data-tooltip="Reload local model list" class="mr-btn mr-btn-secondary mr-btn-sm mr-btn-icon-only mr-combo-refresh-btn"><span class="mr-refresh-spin-target">${getSvgIcon('refreshCw', 'currentColor', 'mr-combo-refresh-icon')}</span></button>`;
        html += `</div>`;
        html += `<div id="combo-list-${comboId}" class="mr-combo-list"></div>`;
        html += `</div>`;

        html += `</div>`; // End left column

        // RIGHT COLUMN: Download Option
        html += `<div class="mr-column">`;
        html += `<div class="mr-column-header">Download</div>`;

        const downloadSource = missing.download_source;
        const urnDownloadId = `urn-download-${missing.node_id}-${missing.widget_index}`;

        if (this.shouldDisplayKnownDownloadSource(missing, downloadSource)) {
            html += this.renderKnownDownloadPanel(missing, downloadSource);
        } else if (perfectMatches.length > 0) {
            // Has perfect local match - download not needed, but allow online re-check.
            html += `<div class="mr-download-section">`;
            html += this.renderSearchControls(missing, {
                buttonText: this.hasSearchAttemptForMissing?.(missing) ? 'Search Again' : 'Search Online'
            });
            html += this.renderDownloadTargetControls(missing, missing.category || 'checkpoints');
            html += `</div>`;
            html += `<div id="search-results-${missing.node_id}-${missing.widget_index}" class="mr-search-results"></div>`;
        } else if (missing.is_urn) {
            html += `<div id="${urnDownloadId}" class="mr-download-section">`;
            html += `<div class="mr-download-info">Resolving CivitAI download for this URN...</div>`;
            html += `</div>`;
        } else {
            // No known download - offer search
            html += `<div class="mr-download-section">`;
            html += this.renderSearchControls(missing);
            html += this.renderDownloadTargetControls(missing, missing.category || 'checkpoints');
            html += `</div>`;
            html += `<div id="search-results-${missing.node_id}-${missing.widget_index}" class="mr-search-results"></div>`;
        }

        // Progress container (for downloads)
        html += `<div id="download-progress-${missing.node_id}-${missing.widget_index}" class="mr-download-progress-slot"></div>`;

        html += `</div>`; // End right column
        html += `</div>`; // End columns

        html += `</div>`; // End card
        return html;
    },



    refreshMissingListRow(missing, options = {}) {
        if (!missing || !this.contentElement) return;

        const missingKey = this.getMissingModelKey(missing);
        const row = Array.from(this.contentElement.querySelectorAll('.mr-missing-list-row'))
            .find(item => item.dataset.missingKey === missingKey);
        if (!row) return;

        const { bestMatch, confidence, matchDisplay, matchClass } = this.getLocalMatchDisplayInfo(missing);

        const bestEl = row.querySelector('.mr-missing-row-best');
        if (bestEl) {
            bestEl.setAttribute('data-tooltip', matchDisplay);
            bestEl.innerHTML = bestMatch
                ? this.escapeHtml(matchDisplay)
                : '<span class="mr-missing-row-none">-- No local match</span>';
        }

        const matchEl = row.querySelector('.mr-missing-row-match');
        if (matchEl) {
            matchEl.className = `mr-missing-row-match mr-missing-row-match-${matchClass}`;
            const valueEl = matchEl.querySelector('strong');
            if (valueEl) {
                valueEl.textContent = bestMatch ? `${confidence.toFixed(confidence % 1 ? 1 : 0)}%` : '--';
            } else {
                matchEl.innerHTML = `<strong>${bestMatch ? `${confidence.toFixed(confidence % 1 ? 1 : 0)}%` : '--'}</strong>`;
            }
        }

        const sourcesEl = row.querySelector('.mr-missing-row-sources');
        if (sourcesEl) {
            const renderedSources = this.renderMissingSourcesSummary(missing);
            if (sourcesEl.innerHTML !== renderedSources) {
                sourcesEl.innerHTML = renderedSources;
            }
        }

        this.refreshMissingListStats?.();
        if (options.refreshBaseModels) {
            this.refreshSearchBaseModelLabels?.();
        }
    }
};
