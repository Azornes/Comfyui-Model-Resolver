import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
import { createFloatingTreePicker } from "../utils/tree_picker.js";
export const missingBrowserMethods = {
    getMissingFilename(missing = {}) {
        return missing.original_path?.split('/').pop()?.split('\\').pop() || missing.name || 'Missing model';
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
        const text = hasCustomNodeTitle
            ? `${nodeLabel} #${nodeId} · ${customNodeTitle}`
            : `${nodeLabel} #${nodeId}`;

        return {
            label: nodeLabel,
            text,
            canLocate: nodeId !== '',
            locateTarget,
            locateTooltip: missing.locate_via_promoted_widget
                ? 'Center this subgraph node in the ComfyUI graph.'
                : locateTarget.isTopLevel === false
                ? 'Open this subgraph and center the node in the ComfyUI graph.'
                : 'Center this node in the ComfyUI graph.'
        };
    },

    getBestLocalMatch(missing = {}, minConfidence = 0) {
        const matches = Array.isArray(missing.matches) ? missing.matches : [];
        return matches
            .filter(match => Number(match.confidence) >= minConfidence)
            .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0] || null;
    },

    getMissingModelSummaryStats(missingModels = []) {
        return missingModels.reduce((stats, missing) => {
            const best = this.getBestLocalMatch(missing, 70);
            if (best?.confidence === 100) {
                stats.exact += 1;
            } else if (best) {
                stats.partial += 1;
            } else {
                stats.none += 1;
            }
            return stats;
        }, { exact: 0, partial: 0, none: 0 });
    },

    getMissingSourceStatus(missing = {}, source = '') {
        const state = this.searchResultCache.get(this.getMissingSearchKey(missing));
        const progress = state?.sourceProgress?.[source];
        const resultStatus = this.getMissingSourceResultStatus(missing, source, state);
        if (progress?.status === 'found') return resultStatus || 'found';
        if (progress?.status) return progress.status;

        if (resultStatus) return resultStatus;

        return 'idle';
    },

    getMissingSourceResultStatus(missing = {}, source = '', state = null) {
        const results = state?.results || {};
        const candidates = [];

        if (source === 'local') {
            candidates.push(results.model_list, results.popular);
            const bestLocalMatch = this.getBestLocalMatch(missing, 70);
            if (bestLocalMatch) {
                candidates.push({
                    source: 'local_match',
                    confidence: Number(bestLocalMatch.confidence || 0),
                    match_type: Number(bestLocalMatch.confidence || 0) >= 100 ? 'exact' : 'similar'
                });
            }
        } else if (source === 'huggingface') {
            candidates.push(results.huggingface);
        } else if (source === 'civitai') {
            candidates.push(results.civitai);
        } else if (source === 'civarchive') {
            candidates.push(results.civarchive);
        } else if (source === 'lora_manager_archive') {
            candidates.push(results.lora_manager_archive);
        }

        const downloadSource = missing.download_source || {};
        const mappedDownloadSource = {
            model_list: 'local',
            popular: 'local',
            workflow: 'civitai'
        }[downloadSource.source] || downloadSource.source;
        if (mappedDownloadSource === source && downloadSource.url) {
            candidates.push(downloadSource);
        }

        return this.getSearchResultStatusLevel(candidates);
    },

    getSearchResultStatusLevel(resultOrResults) {
        const results = Array.isArray(resultOrResults)
            ? resultOrResults.flatMap(result => Array.isArray(result) ? result : [result])
            : [resultOrResults];
        let hasPartial = false;
        let hasUnknownFound = false;

        for (const result of results) {
            if (!result) continue;

            const confidence = Number(result.confidence);
            const hasConfidence = Number.isFinite(confidence);
            const matchType = String(result.match_type || '').toLowerCase();

            if (hasConfidence) {
                if (confidence >= 100) return 'exact';
                if (confidence > 0) {
                    hasPartial = true;
                    continue;
                }
            }

            if (matchType === 'exact' || result.source === 'popular') {
                return 'exact';
            }
            if (matchType === 'partial' || matchType === 'fuzzy' || matchType === 'similar') {
                hasPartial = true;
                continue;
            }
            if (result.url || result.download_url) {
                hasUnknownFound = true;
            }
        }

        if (hasPartial) return 'partial';
        if (hasUnknownFound) return 'found';
        return '';
    },

    renderMissingSourcesSummary(missing = {}) {
        const sourceItems = this.getEnabledSearchSources().map(source => ({ source }));

        return sourceItems.map(item => {
            const status = this.getMissingSourceStatus(missing, item.source);
            const statusClass = String(status || 'idle').replace(/[^a-z0-9_-]/gi, '');
            const label = this.getSearchSourceLabel(item.source);
            const statusLabels = {
                pending: 'Queued',
                running: 'Searching',
                exact: 'Exact match',
                partial: 'Partial match',
                found: 'Found',
                none: 'No match',
                error: 'Error',
                idle: 'Not searched'
            };
            const title = `${label}: ${statusLabels[status] || status}`;
            const iconName = this.getSearchSourceIconName(item.source);
            const iconHtml = getSvgIcon(iconName, 'currentColor', 'mr-missing-source-icon');
            return `<span class="mr-missing-source-dot mr-missing-source-${statusClass}" data-tooltip="${this.escapeHtml(title)}" aria-label="${this.escapeHtml(title)}">${iconHtml}</span>`;
        }).join('');
    },

    hasRenderableSearchState(state = {}) {
        return Boolean(
            (state.lastAttemptSources || []).length
            || Object.keys(state.sourceProgress || {}).length
            || this.hasSearchResults(state.results || {})
            || state.lastAttemptError
        );
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

    isMissingModelResolved(missing = {}) {
        if (!missing) return false;
        return Boolean(missing.__isExistingResolved);
    },

    getResolvedWorkflowModels(data = {}) {
        return (data.resolved_models || []).map(model => this.normalizeResolvedWorkflowModel(model));
    },

    normalizeResolvedWorkflowModel(model = {}) {
        const originalPath = model.original_path || model.name || model.filename || '';
        const filename = originalPath.split('/').pop()?.split('\\').pop() || originalPath || 'Resolved model';
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

    getVisibleMissingModels(missingModels = []) {
        if (this.showResolvedModels) return missingModels;
        return missingModels.filter(missing => !this.isMissingModelResolved(missing));
    },

    getResolvedMissingCount(missingModels = []) {
        return missingModels.reduce((count, missing) => (
            count + (this.isMissingModelResolved(missing) ? 1 : 0)
        ), 0);
    },

    refreshMissingModelsBrowserFromCache() {
        if (this.activeTab !== 'missing' || !this.contentElement || !this.cachedAnalysisData) return;
        this.displayMissingModels(this.contentElement, this.cachedAnalysisData);
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

    renderMissingModelsBrowser(missingModels, selectedKey, totalMissing, activeCount, hasAny100Match, options = {}) {
        const hiddenResolvedCount = Number(options.hiddenResolvedCount || 0);
        const resolvedCount = Number(options.resolvedCount || 0);
        const rawMissingCount = Number(options.rawMissingCount ?? totalMissing);
        const missingCount = Number(options.missingCount ?? rawMissingCount);
        const resolvedToggleCount = this.showResolvedModels ? resolvedCount : hiddenResolvedCount;
        const stats = this.getMissingModelSummaryStats(missingModels);
        const detailIndex = missingModels.findIndex(missing => this.getMissingModelKey(missing) === selectedKey);
        const detailMissing = detailIndex >= 0 ? missingModels[detailIndex] : null;
        const activeHint = activeCount > 0
            ? `${activeCount} downloading`
            : hiddenResolvedCount > 0
            ? `${hiddenResolvedCount} resolved hidden`
            : (hasAny100Match ? 'Auto-link ready for exact matches' : 'Review matches or search online');
        const listLayout = this.getMissingModelsListLayout(missingModels);
        let savedDetailWidth = null;
        try {
            savedDetailWidth = parseInt(localStorage.getItem(this.missingBrowserSplitStorageKey) || '', 10);
        } catch (e) {}
        const splitStyle = Number.isFinite(savedDetailWidth) && savedDetailWidth > 0
            ? `--mr-missing-detail-track:${savedDetailWidth}px;`
            : '';
        const listStyle = `--mr-missing-model-col:${listLayout.modelPx}px;--mr-missing-type-col:${listLayout.typePx}px;`;
        const titleText = this.showResolvedModels && resolvedCount > 0
            ? `${totalMissing} shown (${missingCount} missing / ${resolvedCount} resolved)`
            : `${totalMissing} missing model${totalMissing === 1 ? '' : 's'}`;

        let html = `
            <div class="mr-missing-browser" style="${listStyle}">
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
                            <button id="mr-refresh-missing-analysis" type="button" class="mr-btn mr-btn-secondary mr-btn-sm mr-missing-refresh-btn" data-tooltip="Re-analyze workflow and refresh local matches">
                                <span class="mr-refresh-spin-target">${getSvgIcon('refreshCw')}</span> Refresh
                            </button>
                        </div>
                    </div>
                    <div class="mr-missing-list-head">
                        <span class="mr-missing-head-select">
                            <input type="checkbox" class="mr-missing-select-all-check" aria-label="Select or deselect all missing models">
                        </span>
                        <span>#</span>
                        <span>Missing Model</span>
                        <span>Type</span>
                        <span>Best Local Match</span>
                        <span>Match</span>
                        <span>Sources</span>
                    </div>
                    <div class="mr-missing-list">
        `;

        missingModels.forEach((missing, index) => {
            const key = this.getMissingModelKey(missing);
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

            html += `
                <div role="button" tabindex="0"
                    class="mr-missing-list-row ${isSelected ? 'is-selected' : ''} ${isBatchSelected ? 'is-batch-selected' : ''} ${isResolved ? 'is-resolved' : ''}"
                    data-missing-key="${this.escapeHtml(key)}">
                    <span class="mr-missing-row-select">
                        <input type="checkbox" class="mr-missing-row-check" data-ml-no-drag="1" aria-label="Select ${this.escapeHtml(filename)}" ${isBatchSelected ? 'checked' : ''}>
                    </span>
                    <span class="mr-missing-row-index">${index + 1}</span>
                    <span class="mr-missing-row-model">
                        <span class="mr-missing-row-name" data-tooltip="${this.escapeHtml(filename)}">${this.escapeHtml(filename)}</span>
                        ${isResolved ? '<span class="mr-missing-row-resolved-pill">Resolved</span>' : ''}
                        ${rowNodeHtml}
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
        });

        html += `
                    </div>
                </section>
                <div class="mr-missing-browser-splitter" role="separator" aria-orientation="vertical" aria-label="Resize missing model panes" tabindex="0"></div>
                <section class="mr-missing-detail-pane" aria-label="Missing model details" style="${splitStyle}">
                    ${detailMissing ? this.renderMissingModel(detailMissing, detailIndex) : this.renderStatusMessage('Select a missing model to inspect details.', 'info')}
                </section>
            </div>
        `;
        return html;
    },

    wireMissingModelsBrowser(container, data, sortedMissingModels) {
        this.wireMissingBrowserSplitter(container);

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
                    localStorage.setItem(this.showResolvedModelsStorageKey, this.showResolvedModels ? '1' : '0');
                } catch (e) {}
                this.displayMissingModels(container, data);
            });
        }

        const selectRow = (row) => {
            const key = row.dataset.missingKey;
            if (!key || key === this.selectedMissingModelKey) return;
            this.selectedMissingModelKey = key;
            this.displayMissingModels(container, data);
        };

        const selectAllCheckbox = container.querySelector('.mr-missing-select-all-check');
        if (selectAllCheckbox) {
            this.updateBatchSelectAllCheckbox();
            selectAllCheckbox.addEventListener('click', (event) => {
                event.stopPropagation();
            });
            selectAllCheckbox.addEventListener('change', () => {
                const shouldSelectAll = selectAllCheckbox.checked;
                this.batchSelectedMissingKeys = shouldSelectAll
                    ? new Set((sortedMissingModels || []).map(missing => this.getMissingModelKey(missing)))
                    : new Set();
                this.lastBatchSelectedMissingKey = null;
                this.refreshBatchSelectionUi();
                this.updateBatchFooterButtons();
            });
        }

        container.querySelectorAll('.mr-missing-list-row').forEach(row => {
            const checkbox = row.querySelector('.mr-missing-row-check');
            if (checkbox) {
                checkbox.addEventListener('click', (event) => {
                    event.stopPropagation();
                    checkbox.dataset.shiftClick = event.shiftKey ? '1' : '0';
                });
                checkbox.addEventListener('change', (event) => {
                    const key = row.dataset.missingKey;
                    if (!key) return;
                    const selected = checkbox.checked;
                    const isShiftRange = event.shiftKey || checkbox.dataset.shiftClick === '1';

                    if (isShiftRange && this.lastBatchSelectedMissingKey) {
                        this.applyBatchSelectionRange(
                            sortedMissingModels,
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

        container.querySelectorAll('.mr-missing-row-locate').forEach(button => {
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

        const selectedMissing = sortedMissingModels.find(missing => this.getMissingModelKey(missing) === this.selectedMissingModelKey);
        if (!selectedMissing) return;

        const selectedIndex = sortedMissingModels.indexOf(selectedMissing);
        this.wireMissingModelDetail(container, selectedMissing, selectedIndex);
    },

    wireMissingBrowserSplitter(container) {
        const browser = container.querySelector('.mr-missing-browser');
        const splitter = browser?.querySelector('.mr-missing-browser-splitter');
        if (!(browser instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;

        this.restoreMissingBrowserSplitWidth(browser);

        splitter.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            this.startMissingBrowserSplitDrag(event, browser);
        });

        splitter.addEventListener('dblclick', () => {
            browser.querySelector('.mr-missing-detail-pane')?.style.removeProperty('--mr-missing-detail-track');
            try {
                localStorage.removeItem(this.missingBrowserSplitStorageKey);
            } catch (e) {}
        });

        splitter.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            this.resizeMissingBrowserDetailBy(browser, event.key === 'ArrowLeft' ? 32 : -32);
        });

        this._missingBrowserResizeObserver?.disconnect?.();
        if (typeof ResizeObserver === 'function') {
            this._missingBrowserResizeObserver = new ResizeObserver(() => {
                if (!this._missingBrowserSplitDragging) {
                    this.restoreMissingBrowserSplitWidth(browser);
                }
            });
            this._missingBrowserResizeObserver.observe(browser);
        }
    },

    restoreMissingBrowserSplitWidth(browser) {
        try {
            const savedWidth = parseInt(localStorage.getItem(this.missingBrowserSplitStorageKey) || '', 10);
            if (Number.isFinite(savedWidth) && savedWidth > 0) {
                this.setMissingBrowserDetailWidth(browser, savedWidth, { persist: false });
            }
        } catch (e) {}
    },

    startMissingBrowserSplitDrag(event, browser) {
        if (!(browser instanceof HTMLElement)) return;

        const detailPane = browser.querySelector('.mr-missing-detail-pane');
        if (!(detailPane instanceof HTMLElement)) return;

        event.preventDefault();
        this._missingBrowserSplitDragging = true;
        this._missingBrowserSplitStart = {
            x: event.clientX,
            width: detailPane.getBoundingClientRect().width,
            bounds: this.getMissingBrowserSplitBounds(browser)
        };
        this._appliedMissingBrowserSplitWidth = Math.round(this._missingBrowserSplitStart.width);
        this._lastMissingBrowserSplitApply = 0;
        this._missingBrowserSplitBrowser = browser;
        this._missingBrowserSplitDetailPane = detailPane;
        this._missingBrowserPrevUserSelect = document.body.style.userSelect;
        this._missingBrowserPrevCursor = document.body.style.cursor;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        browser.classList.add('is-resizing');

        this._onMissingBrowserSplitMove = (moveEvent) => this.onMissingBrowserSplitDrag(moveEvent);
        this._onMissingBrowserSplitUp = () => this.endMissingBrowserSplitDrag();
        document.addEventListener('mousemove', this._onMissingBrowserSplitMove);
        document.addEventListener('mouseup', this._onMissingBrowserSplitUp, { once: true });
    },

    onMissingBrowserSplitDrag(event) {
        if (!this._missingBrowserSplitDragging || !this._missingBrowserSplitStart || !this._missingBrowserSplitBrowser) return;

        const nextWidth = this._missingBrowserSplitStart.width - (event.clientX - this._missingBrowserSplitStart.x);
        const bounds = this._missingBrowserSplitStart.bounds;
        this._pendingMissingBrowserSplitWidth = Math.round(Math.max(bounds.min, Math.min(bounds.max, nextWidth)));
        if (this._pendingMissingBrowserSplitWidth === this._appliedMissingBrowserSplitWidth) return;
        const now = performance.now();
        if (this._lastMissingBrowserSplitApply && now - this._lastMissingBrowserSplitApply < 33) return;
        this._lastMissingBrowserSplitApply = now;
        if (this._missingBrowserSplitFrame) return;
        this._missingBrowserSplitFrame = requestAnimationFrame(() => {
            this._missingBrowserSplitFrame = null;
            const nextWidth = this._pendingMissingBrowserSplitWidth;
            if (!this._missingBrowserSplitDragging || !this._missingBrowserSplitDetailPane || !nextWidth) return;
            if (nextWidth === this._appliedMissingBrowserSplitWidth) return;
            this._missingBrowserSplitDetailPane.style.setProperty('--mr-missing-detail-track', `${nextWidth}px`);
            this._appliedMissingBrowserSplitWidth = nextWidth;
        });
    },

    endMissingBrowserSplitDrag() {
        if (!this._missingBrowserSplitDragging) return;

        this._missingBrowserSplitDragging = false;
        document.removeEventListener('mousemove', this._onMissingBrowserSplitMove);
        if (this._missingBrowserSplitFrame) {
            cancelAnimationFrame(this._missingBrowserSplitFrame);
            this._missingBrowserSplitFrame = null;
        }
        if (this._missingBrowserSplitDetailPane && this._pendingMissingBrowserSplitWidth) {
            if (this._pendingMissingBrowserSplitWidth !== this._appliedMissingBrowserSplitWidth) {
                this._missingBrowserSplitDetailPane.style.setProperty('--mr-missing-detail-track', `${this._pendingMissingBrowserSplitWidth}px`);
                this._appliedMissingBrowserSplitWidth = this._pendingMissingBrowserSplitWidth;
            }
            try {
                localStorage.setItem(this.missingBrowserSplitStorageKey, String(this._pendingMissingBrowserSplitWidth));
            } catch (e) {}
        }
        this._missingBrowserSplitBrowser?.classList.remove('is-resizing');
        this._missingBrowserSplitBrowser = null;
        this._missingBrowserSplitDetailPane = null;
        this._missingBrowserSplitStart = null;
        this._pendingMissingBrowserSplitWidth = null;
        this._appliedMissingBrowserSplitWidth = null;
        this._lastMissingBrowserSplitApply = 0;
        try {
            document.body.style.userSelect = this._missingBrowserPrevUserSelect || '';
            document.body.style.cursor = this._missingBrowserPrevCursor || '';
        } catch (e) {}
    },

    resizeMissingBrowserDetailBy(browser, delta) {
        const detailPane = browser.querySelector('.mr-missing-detail-pane');
        if (!(detailPane instanceof HTMLElement)) return;

        this.setMissingBrowserDetailWidth(browser, detailPane.getBoundingClientRect().width + delta);
    },

    setMissingBrowserDetailWidth(browser, width, { persist = true } = {}) {
        const bounds = this.getMissingBrowserSplitBounds(browser);
        const nextWidth = Math.round(Math.max(bounds.min, Math.min(bounds.max, width)));
        const detailPane = browser.querySelector('.mr-missing-detail-pane');
        const target = detailPane instanceof HTMLElement ? detailPane : browser;
        target.style.setProperty('--mr-missing-detail-track', `${nextWidth}px`);

        if (persist) {
            try {
                localStorage.setItem(this.missingBrowserSplitStorageKey, String(nextWidth));
            } catch (e) {}
        }
    },

    getMissingBrowserSplitBounds(browser) {
        const browserRect = browser.getBoundingClientRect();
        const splitter = browser.querySelector('.mr-missing-browser-splitter');
        const splitterWidth = splitter instanceof HTMLElement
            ? splitter.getBoundingClientRect().width
            : 10;
        const available = Math.max(1, browserRect.width - splitterWidth);
        const minListWidth = Math.min(360, Math.max(240, Math.floor(available * 0.28)));
        const max = Math.max(1, available - minListWidth);
        const min = Math.min(max, Math.min(420, Math.max(300, Math.floor(available * 0.3))));

        return { min, max };
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
        const normalizeModelPath = (value = '') => String(value || '')
            .replace(/\//g, '\\')
            .split('\\')
            .map(part => part.trim())
            .filter(Boolean)
            .join('\\');
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
                return path.replace(/[\\/]+/g, '/').toLowerCase();
            }
            return [
                entry.baseDirectory || '',
                entry.relativePath || entry.model?.relative_path || entry.model?.filename || ''
            ].map(value => String(value || '').trim().replace(/[\\/]+/g, '/').toLowerCase()).join('::');
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
            const base = String(basePath || '').replace(/[\/\\]+$/, '');
            const relative = String(relativePath || '').replace(/^[\/\\]+/, '');
            if (!base) return relative;
            if (!relative) return base;
            return `${base}${base.includes('\\') ? '\\' : '/'}${relative}`;
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
            const pathParts = relativePath.split('\\').filter(Boolean);
            const filename = pathParts.pop() || model.filename || relativePath || 'model';
            const folderPath = pathParts.join('\\');
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
                const folderParts = entry.folderPath.split('\\').filter(Boolean);
                let current = root;
                let currentPath = '';
                folderParts.forEach(part => {
                    currentPath = currentPath ? `${currentPath}\\${part}` : part;
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
                                ${renderModelTreeNodes(folder, group, expandedSet, filter, selectedIdentity)}
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
                                ${renderModelTreeNodes(tree, group, expandedSet, filter, selectedIdentity)}
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

        if (comboList) {
            ensureLocalModelsThenPopulate('');
        }

        if (comboInput) {
            const debouncedFilter = this.debounce(() => {
                ensureLocalModelsThenPopulate(comboInput.value);
            }, 200);
            comboInput.addEventListener('input', debouncedFilter);
            comboInput.addEventListener('focus', () => {
                showComboList();
                ensureLocalModelsThenPopulate(comboInput.value);
            });
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
    displayMissingModels(container, data) {
        const listScrollSnapshot = this.getMissingListScrollSnapshot(container);
        const missingModels = (data.missing_models || []).map(missing => {
            let restored = this.restoreDownloadedLocalMatchesForMissing?.(missing) || missing;
            restored = this.restoreSearchLocalHashMatchesForMissing?.(restored) || restored;
            return restored;
        });
        const resolvedModels = this.getResolvedWorkflowModels(data);
        const allModelsForDisplay = [...missingModels, ...resolvedModels];
        const rawMissingCount = data.total_missing ?? missingModels.length;
        const resolvedMissingCount = this.getResolvedMissingCount(missingModels);
        const resolvedCount = resolvedMissingCount + resolvedModels.length;
        const unresolvedMissingCount = Math.max(0, rawMissingCount - resolvedMissingCount);
        const hiddenResolvedCount = this.showResolvedModels ? 0 : resolvedCount;
        const visibleMissingModels = this.getVisibleMissingModels(allModelsForDisplay);
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
            container.innerHTML = this.renderStatusMessage('All models are available! No missing models found.', 'success');
            return;
        }

        // If no missing models but downloads are active, show a waiting message
        if (rawMissingCount === 0 && activeCount > 0 && !resolvedModels.length) {
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

        if (!this.downloadDirectories) {
            const renderToken = `download-dirs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this._downloadDirectoriesRenderToken = renderToken;
            container.innerHTML = this.renderStatusMessage('Loading download folders...', 'info');
            this.ensureDownloadDirectoriesLoaded?.().then(() => {
                if (
                    this._downloadDirectoriesRenderToken === renderToken &&
                    this.activeTab === 'missing' &&
                    container.isConnected
                ) {
                    this.displayMissingModels(container, data);
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
        container.innerHTML = this.renderMissingModelsBrowser(
            sortedMissingModels,
            this.selectedMissingModelKey,
            sortedMissingModels.length,
            activeCount,
            hasAny100Match,
            { hiddenResolvedCount, resolvedCount, rawMissingCount, missingCount: unresolvedMissingCount }
        );
        this.wireMissingModelsBrowser(container, data, sortedMissingModels);
        this.restoreMissingListScroll(container, listScrollSnapshot);
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
        const hasMatches = filteredMatches.length > 0;

        // Calculate 100% matches upfront (needed for download section)
        const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
        const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);

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
        const modelUrl = missing.is_urn && modelId ? `https://civitai.com/models/${modelId}${versionId ? '?modelVersionId=' + versionId : ''}` : '';
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
        html += `<span id="${locateId}" class="${nodeChipClasses}"${nodeChipTitle ? ` data-tooltip="${this.escapeHtml(nodeChipTitle)}"` : ''}>`;
        if (nodeDisplay.canLocate) {
            html += this.getLocateIconHtml();
        }
        html += `${nodeChipText}</span>`;
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

        const filename = missing.original_path?.split('/').pop()?.split('\\').pop() || '';
        const downloadSource = missing.download_source;
        const urnDownloadId = `urn-download-${missing.node_id}-${missing.widget_index}`;

        if (downloadSource && downloadSource.url) {
            html += this.renderKnownDownloadPanel(missing, downloadSource);
        } else if (perfectMatches.length > 0) {
            // Has perfect local match - download not needed, but allow online re-check.
            html += `<div class="mr-download-section">`;
            html += this.renderSearchControls(missing, {
                buttonText: this.hasSearchResultsForMissing(missing) ? 'Search Again' : 'Search Online'
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

    /**
     * Show a notification banner (similar to ComfyUI's "Reconnecting" banner)
     */
    showNotification(message, type = 'success', options = {}) {
        // Build children array, filtering out nulls
        const children = [];
        const contextMenuModel = options?.contextMenuModel || null;
        const notificationProps = {
            className: `mr-notification mr-notification--${type}${contextMenuModel ? ' mr-download-folder-context' : ''}`
        };

        if (contextMenuModel) {
            Object.assign(notificationProps, this.getContextMenuProps?.(contextMenuModel) || {});
        }

        if (type === 'success') {
            children.push($el("span", {
                textContent: "✓",
                className: "mr-notification-icon"
            }));
        } else if (type === 'error') {
            children.push($el("span", {
                textContent: "×",
                className: "mr-notification-icon"
            }));
        } else if (type === 'info') {
            children.push($el("span", {
                textContent: "ℹ",
                className: "mr-notification-icon"
            }));
        }

        // Create notification banner
        const notification = $el("div", notificationProps, [
            ...children,
            $el("span", {
                textContent: message
            }),
            $el("button", {
                className: "mr-notification-close",
                textContent: "×",
                onclick: () => {
                    if (notification.parentNode) {
                        notification.style.opacity = "0";
                        notification.style.transform = "translateX(-50%) translateY(-100%)";
                        setTimeout(() => {
                            if (notification.parentNode) {
                                notification.parentNode.removeChild(notification);
                            }
                        }, 300);
                    }
                }
            })
        ]);

        document.body.appendChild(notification);

        // Auto-dismiss after 4 seconds for success, 6 seconds for errors
        const dismissTime = type === 'success' ? 4000 : 6000;
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = "0";
                notification.style.transform = "translateX(-50%) translateY(-100%)";
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, dismissTime);
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
            sourcesEl.innerHTML = this.renderMissingSourcesSummary(missing);
        }

        this.refreshMissingListStats?.();
        if (options.refreshBaseModels) {
            this.refreshSearchBaseModelLabels?.();
        }
    }
};
