/**
 * ComfyUI Model Linker Extension - Frontend
 * 
 * Provides a menu button and dialog interface for relinking missing models in workflows.
 */

// Import ComfyUI APIs
// These paths are relative to the ComfyUI web directory
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { $el, ComfyDialog } from "../../../scripts/ui.js";
import { loadStylesWhenNeeded } from "./utils/css_loader.js";
import { getSvgIcon } from "./utils/icon_utils.js";

class LinkerManagerDialog extends ComfyDialog {
    constructor() {
        super();
        this.currentWorkflow = null;
        this.missingModels = [];
        this.allModels = null; // list of all available models for dropdown
        this.downloadDirectories = null;
        this.capabilities = null;
        this.downloadSubfolders = new Map();
        this.pendingResolutions = [];
        this.pendingIndex = new Map(); // key -> index in pendingResolutions
        this.activeDownloads = {};  // Track active downloads
        this.searchResultCache = new Map();
        this.searchProgressTimers = new Map();
        this.cachedAnalysisData = null;
        this.cachedWorkflowSignature = null;
        this.selectedMissingModelKey = null;
        this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
        this.activeTabStorageKey = 'model_linker_active_tab';
        this.activeTab = this.restoreActiveTab();  // Default tab
        this.fullscreen = false;
        this.docked = false;
        this.dockContainer = null;
        this.lastDockContainer = null;
        this.pendingDockToSidebar = false;
        this.sidebarTabId = "comfyui-model-linker";
        this.sidebarOpenModeStorageKey = "model_linker_sidebar_open_mode";
        this.dockButton = null;
        this.undockButton = null;
        this._floatingRectBeforeDock = null;
        this._dragging = false;
        this._dragStart = null;
        this._analysisProgressToken = null;
        this._locateAnimationFrame = null;
        this._viewportClampFrame = null;
        this._boundHandleViewportResize = () => this.scheduleModalViewportClamp(true);
        
        // Create backdrop overlay for click-outside-to-close
        this.backdrop = $el("div.model-linker-backdrop", {
            parent: document.body
        });
        
        // Create context menu for model chips
        this.contextMenu = $el("div.ml-context-menu", {
            parent: document.body
        }, [
            $el("div.ml-context-menu-item", {
                onclick: () => this.handleContextMenuAction('showInfo')
            }, [
                $el("span.ml-context-menu-item-icon", { textContent: "ℹ" }),
                $el("span", { textContent: "Show Info" })
            ]),
            $el("div.ml-context-menu-divider"),
            $el("div.ml-context-menu-item", {
                onclick: () => this.handleContextMenuAction('civitai')
            }, [
                $el("span.ml-context-menu-item-icon", { textContent: "🌐" }),
                $el("span", { textContent: "Open in CivitAI" })
            ]),
            $el("div.ml-context-menu-divider"),
            $el("div.ml-context-menu-item", {
                onclick: () => this.handleContextMenuAction('openFolder')
            }, [
                $el("span.ml-context-menu-item-icon", { textContent: "📁" }),
                $el("span", { textContent: "Open Containing Folder" })
            ])
        ]);

        this.tooltipElement = $el("div.ml-global-tooltip", { parent: document.body });
        
        // Selected model for context menu
        this._contextMenuModel = null;
        
        // Create dialog element using $el
        this.element = $el("div.comfy-modal.model-linker-modal", {
            id: "model-linker-modal",
            parent: document.body
        }, [
            this.createHeader(),
            this.createContent(),
            this.createFooter()
        ]);

        this.tooltipObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.bindTooltips(node);
                    }
                }
            }
        });
        this.tooltipObserver.observe(this.element, {
            childList: true,
            subtree: true
        });
        this.bindTooltips(this.element);
        
        // Add click listener to hide context menu when clicking outside
        this.boundHandleContextMenuClick = (e) => this.handleContextMenuOutsideClick(e);
        document.addEventListener('click', this.boundHandleContextMenuClick);
        window.addEventListener('resize', this._boundHandleViewportResize);
    }
    
    /**
     * Build stable cache key for a missing model entry
     */
    getMissingSearchKey(missing) {
        return `${missing.node_id}:${missing.widget_index}`;
    }

    /**
     * Get or initialize search state for a missing model entry
     */
    getSearchState(missing) {
        const key = this.getMissingSearchKey(missing);
        if (!this.searchResultCache.has(key)) {
            this.searchResultCache.set(key, {
                selectedSource: 'all',
                results: {
                    popular: null,
                    model_list: null,
                    huggingface: null,
                    civitai: null,
                    lora_manager_archive: null
                },
                lastAttemptSources: [],
                lastAttemptFound: null,
                lastAttemptError: null,
                sourceProgress: {},
                activeSearchRunId: null
            });
        }
        return this.searchResultCache.get(key);
    }

    /**
     * Merge new search results into cached per-source results.
     * Empty responses do not delete previously found results.
     */
    mergeSearchResults(existingResults = {}, newResults = {}) {
        return {
            popular: newResults.popular || existingResults.popular || null,
            model_list: newResults.model_list || existingResults.model_list || null,
            huggingface: newResults.huggingface || existingResults.huggingface || null,
            civitai: newResults.civitai || existingResults.civitai || null,
            lora_manager_archive: newResults.lora_manager_archive || existingResults.lora_manager_archive || null
        };
    }

    getSearchIconHtml() {
        return `<span class="ml-btn-icon" aria-hidden="true">${getSvgIcon('search')}</span>`;
    }

    getLocateIconHtml() {
        return `<span class="ml-node-chip-icon" aria-hidden="true">${getSvgIcon('locate')}</span>`;
    }

    showTooltip(target) {
        if (!target || !this.tooltipElement) return;
        this.normalizeTooltipTarget(target);
        const text = target.getAttribute('data-tooltip');
        if (!text) return;

        this.tooltipElement.textContent = text;
        this.tooltipElement.style.display = 'block';

        const rect = target.getBoundingClientRect();
        const tooltipRect = this.tooltipElement.getBoundingClientRect();
        const margin = 12;
        const maxLeft = Math.max(margin, window.innerWidth - tooltipRect.width - margin);
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        left = Math.min(Math.max(margin, left), maxLeft);

        let top = rect.top - tooltipRect.height - 10;
        if (top < margin) {
            top = Math.min(window.innerHeight - tooltipRect.height - margin, rect.bottom + 10);
        }
        top = Math.max(margin, top);

        this.tooltipElement.style.left = `${Math.round(left)}px`;
        this.tooltipElement.style.top = `${Math.round(top)}px`;
        this.tooltipElement.setAttribute('data-visible', 'true');
    }

    hideTooltip() {
        if (!this.tooltipElement) return;
        this.tooltipElement.style.display = 'none';
        this.tooltipElement.removeAttribute('data-visible');
    }

    normalizeTooltipTarget(target) {
        if (!target || !target.getAttribute) return;

        const title = target.getAttribute('title');
        if (title && !target.getAttribute('data-tooltip')) {
            target.setAttribute('data-tooltip', title);
        }
        if (target.hasAttribute('title')) {
            target.removeAttribute('title');
        }
        if (target.classList?.contains('ml-tooltip-badge') && !target.hasAttribute('tabindex')) {
            target.setAttribute('tabindex', '0');
        }
    }

    setTooltip(target, text) {
        if (!target || !text) return;
        target.setAttribute('data-tooltip', text);
        if (target.hasAttribute('title')) {
            target.removeAttribute('title');
        }
        this.bindTooltips(target);
    }

    bindTooltips(container) {
        if (!container) return;

        const selector = '[data-tooltip], [title]';
        const targets = [];
        if (container.matches?.(selector)) {
            targets.push(container);
        }
        if (container.querySelectorAll) {
            targets.push(...container.querySelectorAll(selector));
        }

        targets.forEach((target) => {
            this.normalizeTooltipTarget(target);
            if (!target.dataset) return;
            if (target.dataset.mlTooltipBound === '1') return;
            target.dataset.mlTooltipBound = '1';
            target.addEventListener('mouseenter', () => this.showTooltip(target));
            target.addEventListener('focus', () => this.showTooltip(target));
            target.addEventListener('mouseleave', () => this.hideTooltip());
            target.addEventListener('blur', () => this.hideTooltip());
        });
    }

    getValidTab(tab) {
        return ['missing', 'loaded', 'options'].includes(tab) ? tab : 'missing';
    }

    restoreActiveTab() {
        try {
            return this.getValidTab(localStorage.getItem(this.activeTabStorageKey));
        } catch (error) {
            console.warn('Model Linker: Failed to restore active tab:', error);
            return 'missing';
        }
    }

    persistActiveTab(tab) {
        try {
            localStorage.setItem(this.activeTabStorageKey, this.getValidTab(tab));
        } catch (error) {
            console.warn('Model Linker: Failed to persist active tab:', error);
        }
    }

    /**
     * Return true when at least one downloadable source was found
     */
    hasSearchResults(data = {}) {
        return !!(data.popular || data.model_list || data.huggingface || data.civitai || data.lora_manager_archive);
    }

    /**
     * Convert source ids to readable labels
     */
    getSearchSourceLabel(source) {
        const labels = {
            all: 'Everything',
            local: 'Local Database',
            huggingface: 'HuggingFace',
            civitai: 'CivitAI',
            lora_manager_archive: 'LoRA Manager Archive'
        };
        return labels[source] || source;
    }

    getSearchSourcesForSelection(selectedSource, missing = {}) {
        if (selectedSource !== 'all') {
            return this.isSourceAvailable(selectedSource) ? [selectedSource] : [];
        }

        const sources = ['local', 'huggingface', 'civitai'];
        if (this.isSourceAvailable('lora_manager_archive')) {
            sources.push('lora_manager_archive');
        }
        return sources;
    }

    setSourceProgress(state, source, patch = {}, missing = null) {
        state.sourceProgress = {
            ...(state.sourceProgress || {}),
            [source]: {
                ...(state.sourceProgress?.[source] || {}),
                ...patch
            }
        };
        if (missing) {
            this.refreshMissingSourcesSummary(missing);
        }
    }

    refreshMissingSourcesSummary(missing = {}) {
        if (!this.contentElement || !missing) return;

        const key = this.getMissingModelKey(missing);
        const rows = this.contentElement.querySelectorAll('.ml-missing-list-row');
        for (const row of rows) {
            if (row.getAttribute('data-missing-key') !== key) continue;

            const sourcesEl = row.querySelector('.ml-missing-row-sources');
            if (sourcesEl) {
                sourcesEl.innerHTML = this.renderMissingSourcesSummary(missing);
            }
        }
    }

    getSearchSourceEstimateMs(source, isUrn = false) {
        if (isUrn && source === 'civitai') return 5000;

        const estimates = {
            local: 1400,
            lora_manager_archive: 3200,
            huggingface: 18000,
            civitai: 22000
        };
        return estimates[source] || 8000;
    }

    getEstimatedSearchProgressPercent(elapsedMs, estimateMs) {
        const safeEstimate = Math.max(1000, Number(estimateMs) || 8000);
        const elapsed = Math.max(0, Number(elapsedMs) || 0);

        if (elapsed <= safeEstimate) {
            const normalized = Math.min(1, elapsed / safeEstimate);
            const eased = 1 - Math.pow(1 - normalized, 2.1);
            return 6 + eased * 78;
        }

        const overtime = elapsed - safeEstimate;
        const slowTail = 1 - Math.exp(-overtime / (safeEstimate * 1.6));
        return Math.min(94, 84 + slowTail * 10);
    }

    getSearchProgressTimerKey(runId, source) {
        return `${runId || 'search'}:${source}`;
    }

    clearSearchProgressTimer(runId, source) {
        const key = this.getSearchProgressTimerKey(runId, source);
        const timer = this.searchProgressTimers.get(key);
        if (timer) {
            clearInterval(timer);
            this.searchProgressTimers.delete(key);
        }
    }

    clearSearchProgressTimers(runId) {
        if (!runId) return;
        const prefix = `${runId}:`;
        for (const [key, timer] of this.searchProgressTimers.entries()) {
            if (key.startsWith(prefix)) {
                clearInterval(timer);
                this.searchProgressTimers.delete(key);
            }
        }
    }

    startEstimatedSearchProgress(state, missing, container, source, runId) {
        this.clearSearchProgressTimer(runId, source);

        const tick = () => {
            if (state.activeSearchRunId !== runId) {
                this.clearSearchProgressTimer(runId, source);
                return;
            }

            const progress = state.sourceProgress?.[source];
            if (!progress || progress.status !== 'running') {
                this.clearSearchProgressTimer(runId, source);
                return;
            }

            const elapsedMs = Date.now() - (progress.startedAt || Date.now());
            const percent = this.getEstimatedSearchProgressPercent(
                elapsedMs,
                progress.estimateMs
            );

            if (percent > (Number(progress.percent) || 0) + 0.2) {
                this.setSourceProgress(state, source, { percent });
                this.displaySearchResults(missing, state, container);
            }
        };

        tick();
        const timer = setInterval(tick, 450);
        this.searchProgressTimers.set(
            this.getSearchProgressTimerKey(runId, source),
            timer
        );
    }

    hasActiveSearchProgress(state = {}) {
        return Object.values(state.sourceProgress || {}).some(progress => (
            progress?.status === 'pending' || progress?.status === 'running'
        ));
    }

    renderSearchProgress(state = {}) {
        const progressEntries = Object.entries(state.sourceProgress || {});
        if (!progressEntries.length) return '';
        const isCompact = !this.hasActiveSearchProgress(state);

        const statusLabels = {
            pending: 'Queued',
            running: 'Searching...',
            found: 'Found',
            none: 'No match',
            error: 'Error'
        };

        if (isCompact) {
            let html = '<div class="ml-search-progress-list ml-search-progress-list-compact">';
            for (const [source, progress] of progressEntries) {
                const status = progress?.status || 'pending';
                const statusClass = String(status).replace(/[^a-z0-9_-]/gi, '');
                const label = this.getSearchSourceLabel(source);
                const statusLabel = progress?.message || statusLabels[status] || status;
                const title = `${label}: ${statusLabel}`;
                html += `
                    <div class="ml-search-progress-item ml-search-progress-${statusClass}" data-tooltip="${this.escapeHtml(title)}">
                        <span class="ml-search-progress-source">${this.escapeHtml(label)}</span>
                        <span class="ml-search-progress-status">${this.escapeHtml(statusLabel)}</span>
                    </div>
                `;
            }
            html += '</div>';
            return html;
        }

        let html = '<div class="ml-search-progress-list">';
        for (const [source, progress] of progressEntries) {
            const status = progress?.status || 'pending';
            const statusClass = String(status).replace(/[^a-z0-9_-]/gi, '');
            const label = this.getSearchSourceLabel(source);
            const percent = status === 'pending'
                ? 0
                : (status === 'running' ? progress?.percent : 100);
            const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
            const statusLabel = status === 'running'
                ? `Searching... ${Math.round(safePercent)}%`
                : (progress?.message || statusLabels[status] || status);
            html += `
                <div class="ml-search-progress-item ml-search-progress-${statusClass}">
                    <div class="ml-search-progress-head">
                        <span>${this.escapeHtml(label)}</span>
                        <span>${this.escapeHtml(statusLabel)}</span>
                    </div>
                    <div class="ml-search-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${safePercent}">
                        <div class="ml-search-progress-fill" style="width: ${safePercent}%;"></div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    }

    /**
     * Update source selector buttons and helper text for one card
     */
    syncSearchSourceUi(missing, container) {
        if (!container) return;

        const state = this.getSearchState(missing);
        const selectEl = container.querySelector(`#search-source-select-${missing.node_id}-${missing.widget_index}`);
        if (selectEl) {
            this.setDropdownValue(selectEl, state.selectedSource, this.getSearchSourceLabel(state.selectedSource));
        }
    }

    /**
     * Set current search source for one card
     */
    setSearchSource(missing, source, container) {
        const state = this.getSearchState(missing);
        state.selectedSource = source || 'all';
        this.syncSearchSourceUi(missing, container);
    }

    getDropdownValue(el) {
        return el?.dataset?.value || el?.value || '';
    }

    setDropdownValue(el, value, label = value) {
        if (!el) return;
        el.dataset.value = value || '';
        el.value = label || value || '';
    }

    normalizeVersionName(versionName) {
        return String(versionName || '').trim().replace(/^v{2,}(?=\d)/i, 'v');
    }

    getModelVersionParts(modelName, versionName) {
        const name = String(modelName || '').trim();
        const version = this.normalizeVersionName(versionName);
        if (!version || version === name) {
            return { name: name || version, version: '' };
        }
        if (name && name.toLowerCase().includes(version.toLowerCase())) {
            return { name, version: '' };
        }
        return { name, version };
    }

    getVersionedModelName(modelName, versionName) {
        const parts = this.getModelVersionParts(modelName, versionName);
        if (!parts.version) return parts.name;
        return parts.name ? `${parts.name} ${parts.version}` : parts.version;
    }

    renderVersionedModelNameHtml(modelName, versionName) {
        const parts = this.getModelVersionParts(modelName, versionName);
        const nameHtml = parts.name ? this.escapeHtml(parts.name) : '';
        const versionHtml = parts.version
            ? `<em class="ml-model-version">${this.escapeHtml(parts.version)}</em>`
            : '';
        return [nameHtml, versionHtml].filter(Boolean).join(' ');
    }

    getSearchSourceIconName(sourceKey) {
        const icons = {
            popular: 'star',
            'model-list': 'database',
            huggingface: 'huggingface',
            civitai: 'civitai',
            'lora-archive': 'loraManager',
            lora_manager_archive: 'loraManager',
            'lora-manager-archive': 'loraManager',
            local: 'database',
            'workflow-url': 'link',
            workflow: 'link',
            online: 'globe'
        };
        return icons[sourceKey] || 'globe';
    }

    renderSearchSourcePill(sourceKey, sourceLabel) {
        const iconName = this.getSearchSourceIconName(sourceKey);
        const iconHtml = getSvgIcon(iconName, 'currentColor', 'ml-search-source-icon');
        return `
            <span class="ml-search-source-pill ml-search-source-${sourceKey}" data-tooltip="${this.escapeHtml(sourceLabel)}">
                ${iconHtml}
                <span>${this.escapeHtml(sourceLabel)}</span>
            </span>
        `;
    }

    getSearchResultsTableLayout(rows = []) {
        const textWidth = (value, charPx = 6, minPx = 40, maxPx = 180) => {
            const length = String(value || '').length;
            return Math.max(minPx, Math.min(maxPx, Math.ceil(length * charPx)));
        };

        const maxSourceLabel = rows.reduce(
            (max, row) => Math.max(max, String(row.sourceLabel || row.sourceKey || '').length),
            'Source'.length
        );
        const maxMatchLabel = rows.reduce(
            (max, row) => Math.max(max, String(row.match?.label || '').length),
            'Match'.length
        );
        const maxSizeLabel = rows.reduce(
            (max, row) => Math.max(max, String(row.size || '-').length),
            'Size'.length
        );
        const maxActions = rows.reduce((max, row) => {
            const count = (row.downloadUrl ? 1 : 0) + (row.openUrl ? 1 : 0);
            return Math.max(max, count);
        }, 1);

        const sourcePx = textWidth('x'.repeat(maxSourceLabel), 6, 34, 100) + 52;
        const matchPx = textWidth('x'.repeat(maxMatchLabel), 7, 34, 76) + 22;
        const sizePx = textWidth('x'.repeat(maxSizeLabel), 6.5, 28, 72) + 22;
        const actionsPx = Math.max(60, (maxActions * 24) + (Math.max(0, maxActions - 1) * 6) + 22);
        const modelMinPx = 210;
        const tableMinPx = Math.ceil(sourcePx + matchPx + sizePx + actionsPx + modelMinPx);

        return { sourcePx, matchPx, sizePx, actionsPx, tableMinPx };
    }

    formatSearchResultSize(result = {}) {
        if (result.size === 0) return '0 B';
        if (!result.size) return '';
        return typeof result.size === 'number' ? this.formatBytes(result.size) : String(result.size);
    }

    getSearchResultMatchDisplay(result = {}, fallbackLabel = 'Match', fallbackClass = 'neutral') {
        const matchType = String(result.match_type || '').toLowerCase();
        if (matchType === 'exact') {
            return { label: 'Exact', className: 'strong' };
        }

        const confidence = Number(result.confidence);
        if (Number.isFinite(confidence) && confidence > 0) {
            const className = confidence >= 95 ? 'strong' : (confidence >= 70 ? 'medium' : 'weak');
            return { label: `${Math.round(confidence)}%`, className };
        }

        if (matchType === 'partial') {
            return { label: 'Partial', className: 'medium' };
        }
        if (matchType === 'fuzzy' || matchType === 'similar') {
            return { label: matchType === 'fuzzy' ? 'Fuzzy' : 'Similar', className: 'medium' };
        }

        return { label: fallbackLabel, className: fallbackClass };
    }

    getDownloadSourceTableRow(missing, downloadSource = {}) {
        if (!downloadSource?.url) return null;

        const originalFilename = missing.original_path?.split('/').pop()?.split('\\').pop() || '';
        const downloadFilename = downloadSource.filename || originalFilename || 'model';
        const isFromWorkflow = downloadSource.url_source === 'workflow';
        const source = downloadSource.source || (isFromWorkflow ? 'workflow' : 'online');
        const sourceLabels = {
            popular: 'Popular',
            model_list: 'Local Database',
            huggingface: 'HuggingFace',
            civitai: 'CivitAI',
            lora_manager_archive: 'LoRA Archive',
            workflow: 'Workflow',
            online: 'Online'
        };
        const sourceLabel = isFromWorkflow ? 'Workflow URL' : (sourceLabels[source] || source);
        const sourceKey = isFromWorkflow
            ? 'workflow-url'
            : String(source).replace(/_/g, '-');
        const sourceSecondary = isFromWorkflow && sourceLabels[source] && source !== 'workflow'
            ? sourceLabels[source]
            : '';
        const modelUrl = downloadSource.model_url
            || downloadSource.workflow_model_url
            || this.getModelCardUrl(downloadSource.url);
        const versionName = downloadSource.version_name || missing.civitai_info?.version_name || '';
        const modelParts = this.getModelVersionParts(
            downloadSource.name || missing.civitai_info?.model_name || '',
            versionName
        );
        const modelName = modelParts.name || downloadFilename;
        const fullModelName = this.getVersionedModelName(modelName, modelParts.version);

        return {
            sourceKey,
            sourceLabel,
            model: modelName,
            version: modelParts.version,
            filename: downloadFilename,
            secondary: sourceSecondary || (fullModelName && fullModelName !== downloadFilename ? downloadFilename : ''),
            match: isFromWorkflow
                ? { label: 'Provided', className: 'strong' }
                : this.getSearchResultMatchDisplay(downloadSource, 'Known', 'strong'),
            size: this.formatSearchResultSize(downloadSource),
            downloadUrl: downloadSource.url,
            downloadFilename,
            category: downloadSource.directory || downloadSource.category || missing.category || 'checkpoints',
            openUrl: modelUrl
        };
    }

    renderKnownDownloadPanel(missing, downloadSource) {
        let html = `<div class="ml-download-section">`;
        html += this.renderSearchControls(missing, { buttonText: 'Search Again' });
        html += this.renderDownloadTargetControls(
            missing,
            downloadSource.directory || downloadSource.category || missing.category || 'checkpoints'
        );
        html += `</div>`;

        const downloadSourceRow = this.getDownloadSourceTableRow(missing, downloadSource);
        html += `<div id="search-results-${missing.node_id}-${missing.widget_index}" class="ml-search-results ml-is-visible">`;
        html += this.renderSearchResultsTable(downloadSourceRow ? [downloadSourceRow] : []);
        html += `</div>`;
        return html;
    }

    renderSearchResultsTable(rows = []) {
        if (!rows.length) return '';
        const layout = this.getSearchResultsTableLayout(rows);
        const tableStyle = [
            `--ml-source-col:${layout.sourcePx}px`,
            `--ml-match-col:${layout.matchPx}px`,
            `--ml-size-col:${layout.sizePx}px`,
            `--ml-actions-col:${layout.actionsPx}px`,
            `--ml-table-min:${layout.tableMinPx}px`
        ].join(';');

        let html = `
            <div class="ml-search-results-table-wrap">
                <table class="ml-search-results-table" style="${tableStyle}">
                    <colgroup>
                        <col class="ml-search-col-source">
                        <col class="ml-search-col-model">
                        <col class="ml-search-col-match">
                        <col class="ml-search-col-size">
                        <col class="ml-search-col-actions">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Source</th>
                            <th>Model</th>
                            <th>Match</th>
                            <th>Size</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (const row of rows) {
            const sourceKey = String(row.sourceKey || '').replace(/[^a-z0-9_-]/gi, '');
            const sourceLabel = row.sourceLabel || row.sourceKey || 'Source';
            const sourcePill = this.renderSearchSourcePill(sourceKey, sourceLabel);
            const rawModel = row.model || row.filename || 'Model';
            const rawVersion = row.version || '';
            const model = this.escapeHtml(rawModel);
            const modelTitle = this.escapeHtml(this.getVersionedModelName(rawModel, rawVersion) || rawModel);
            const modelHtml = this.renderVersionedModelNameHtml(rawModel, rawVersion) || model;
            const secondary = row.secondary ? this.escapeHtml(row.secondary) : '';
            const filename = row.filename && row.filename !== row.model ? this.escapeHtml(row.filename) : '';
            const match = row.match || { label: 'Match', className: 'neutral' };
            const matchClass = String(match.className || 'neutral').replace(/[^a-z0-9_-]/gi, '');
            const size = this.escapeHtml(row.size || '-');
            const downloadUrl = row.downloadUrl || '';
            const openUrl = row.openUrl || '';
            const downloadFilename = row.downloadFilename || row.filename || row.model || 'model';
            const category = row.category || '';

            let actions = '';
            if (downloadUrl) {
                actions += `
                    <button type="button" class="search-download-btn ml-search-result-action-btn"
                        data-tooltip="Download"
                        aria-label="Download ${this.escapeHtml(downloadFilename)}"
                        data-url="${this.escapeHtml(downloadUrl)}"
                        data-filename="${this.escapeHtml(downloadFilename)}"
                        data-category="${this.escapeHtml(category)}">${getSvgIcon('download')}</button>
                `;
            }
            if (openUrl) {
                actions += `
                    <button type="button"
                        class="search-open-page-btn ml-search-result-action-btn"
                        data-tooltip="Open model page"
                        aria-label="Open model page"
                        data-url="${this.escapeHtml(openUrl)}">${getSvgIcon('externalLink')}</button>
                `;
            }
            if (!actions) {
                actions = '<span class="ml-search-result-empty">-</span>';
            }

            html += `
                <tr>
                    <td>${sourcePill}</td>
                    <td>
                        <div class="ml-search-result-model" data-tooltip="${modelTitle}">
                            <span>${modelHtml}</span>
                            ${secondary || filename ? `<small>${secondary || filename}</small>` : ''}
                        </div>
                    </td>
                    <td><span class="ml-search-match ml-search-match-${matchClass}">${this.escapeHtml(match.label)}</span></td>
                    <td class="ml-search-size">${size}</td>
                    <td><div class="ml-search-result-actions">${actions}</div></td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;
        return html;
    }

    renderSearchControls(missing, options = {}) {
        const searchSourcesId = `search-sources-${missing.node_id}-${missing.widget_index}`;
        const searchSourceSelectId = `search-source-select-${missing.node_id}-${missing.widget_index}`;
        const searchSourceListId = `search-source-list-${missing.node_id}-${missing.widget_index}`;
        const buttonText = options.buttonText || 'Search';
        const state = this.getSearchState(missing);
        const selectedSource = state.selectedSource || 'all';

        let html = `<div id="${searchSourcesId}" class="ml-search-source-bar">`;
        html += `<button id="search-${missing.node_id}-${missing.widget_index}" class="ml-btn ml-btn-link">`;
        html += `${this.getSearchIconHtml()} ${buttonText}`;
        html += `</button>`;
        html += `<div class="ml-search-source-picker">`;
        html += `<label class="ml-search-source-picker-label" for="${searchSourceSelectId}">Source</label>`;
        html += `<div class="ml-download-target-wrap">`;
        html += `<input id="${searchSourceSelectId}" class="ml-download-target-input ml-search-source-select" type="text" readonly autocomplete="off" data-value="${this.escapeHtml(selectedSource)}" value="${this.escapeHtml(this.getSearchSourceLabel(selectedSource))}">`;
        html += `<div id="${searchSourceListId}" class="ml-download-target-list ml-search-source-list"></div>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    renderProgressWithAction({
        percent = 0,
        leftText = '',
        rightText = '',
        actionClass = '',
        actionText = '',
        actionDataAttr = ''
    } = {}) {
        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
        const actionAttr = actionDataAttr ? ` ${actionDataAttr}` : '';
        return `
            <div class="ml-progress-container">
                <div class="ml-progress-row">
                    <div class="ml-progress-bar ml-progress-bar-grow">
                        <div class="ml-progress-fill" style="width: ${safePercent}%;"></div>
                    </div>
                    <button class="${actionClass}"${actionAttr}>${actionText}</button>
                </div>
                <div class="ml-progress-text">
                    <span>${leftText}</span>
                    <span>${rightText}</span>
                </div>
            </div>
        `;
    }

    buildContextMenuModelData(model = {}, fallbackName = '') {
        const resolvedPath = model.path || model.resolved_path || '';
        const filename = model.filename || fallbackName || resolvedPath.split(/[\/\\]/).pop() || '';
        return {
            ...model,
            name: model.name || filename,
            original_path: model.original_path || filename,
            resolved_path: resolvedPath,
            category: model.category || ''
        };
    }

    renderLocalMatchesContent(missing, missingIndex = 0) {
        const allMatches = missing.matches || [];
        const filteredMatches = allMatches.filter(m => m.confidence >= 70);
        const hasMatches = filteredMatches.length > 0;
        const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
        const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);

        let html = '';

        if (hasMatches) {
            const matchesToShow = perfectMatches.length > 0
                ? perfectMatches
                : otherMatches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);

            const sortedMatches = matchesToShow.sort((a, b) => {
                if (a.confidence === 100 && b.confidence !== 100) return -1;
                if (a.confidence !== 100 && b.confidence === 100) return 1;
                return b.confidence - a.confidence;
            });

            for (let matchIndex = 0; matchIndex < sortedMatches.length; matchIndex++) {
                const match = sortedMatches[matchIndex];
                const buttonId = `resolve-${missingIndex}-${missing.node_id}-${missing.widget_index}-${matchIndex}`;
                const matchPath = match.model?.relative_path || match.model?.path || match.path || match.filename || '';
                const isBestMatch = matchIndex === 0 && match.confidence >= 95;
                const contextModel = this.buildContextMenuModelData(match.model || {}, match.filename || '');
                const modelData = encodeURIComponent(JSON.stringify(contextModel));

                html += `<div class="ml-match-row ${isBestMatch ? 'ml-best-match' : ''}" data-model="${modelData}" oncontextmenu="window.MLOpenContextMenu(event, this)">`;
                html += this.getConfidenceBadge(match.confidence);
                html += `<span class="ml-match-filename" data-tooltip="${this.escapeHtml(matchPath)}">${this.escapeHtml(matchPath)}</span>`;
                html += `<span class="ml-match-status ${match.confidence === 100 ? 'ml-match-status-exact' : 'ml-match-status-partial'}">${match.confidence === 100 ? 'Exact' : 'Partial'}</span>`;
                html += `<button id="${buttonId}" class="ml-btn ml-btn-secondary ml-btn-sm ml-btn-icon-only ml-local-link-btn" data-tooltip="Link this local match" aria-label="Link this local match">`;
                html += getSvgIcon('link');
                html += `</button>`;
                html += `</div>`;
            }

            if (perfectMatches.length > 0 && otherMatches.length > 0) {
                const matchId = `more-matches-${missing.node_id}-${missing.widget_index}`;
                const altLabel = `Alternatives (${otherMatches.length})`;
                html += `<button type="button" class="ml-local-alternatives-toggle" aria-expanded="true" onclick="window.MLToggleHidden('${matchId}', this, '${altLabel}', '${altLabel}')">`;
                html += `<span class="ml-local-alternatives-label">${altLabel}</span>`;
                html += `<span class="ml-local-alternatives-state">Hide</span>`;
                html += `<span class="ml-local-alternatives-chevron" aria-hidden="true"></span>`;
                html += `</button>`;
                html += `<div id="${matchId}" class="ml-stack-sm">`;
                for (let mIdx = 0; mIdx < otherMatches.length; mIdx++) {
                    const match = otherMatches[mIdx];
                    const altBtnId = `resolve-alt-${missingIndex}-${missing.node_id}-${missing.widget_index}-${mIdx}`;
                    const contextModel = this.buildContextMenuModelData(match.model || {}, match.filename || '');
                    const modelData = encodeURIComponent(JSON.stringify(contextModel));
                    const matchPath = match.model?.relative_path || match.model?.path || match.path || match.filename || '';
                    html += `<div class="ml-match-row" data-model="${modelData}" oncontextmenu="window.MLOpenContextMenu(event, this)">`;
                    html += this.getConfidenceBadge(match.confidence);
                    html += `<span class="ml-match-filename" data-tooltip="${this.escapeHtml(matchPath)}">${this.escapeHtml(matchPath)}</span>`;
                    html += `<span class="ml-match-status ml-match-status-partial">Partial</span>`;
                    html += `<button id="${altBtnId}" class="ml-btn ml-btn-secondary ml-btn-sm ml-btn-icon-only ml-local-link-btn" data-tooltip="Link this local match" aria-label="Link this local match">${getSvgIcon('link')}</button>`;
                    html += `</div>`;
                }
                html += `</div>`;
            }
        } else if (missing.is_urn && !missing.civitai_info) {
            html += `<div class="ml-no-matches">Waiting for CivitAI filename to search local models...</div>`;
        } else if (allMatches.length > 0 && filteredMatches.length === 0) {
            html += `<div class="ml-no-matches">No matches above 70% confidence</div>`;
        } else {
            html += `<div class="ml-no-matches">No local matches found</div>`;
        }

        return html;
    }

    wireLocalMatchButtons(container, missing, missingIndex = 0) {
        const allMatches = missing.matches || [];
        const filteredMatches = allMatches.filter(m => m.confidence >= 70);
        const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
        const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);
        const matchesToShow = perfectMatches.length > 0
            ? perfectMatches
            : otherMatches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);

        const sortedMatches = matchesToShow.sort((a, b) => {
            if (a.confidence === 100 && b.confidence !== 100) return -1;
            if (a.confidence !== 100 && b.confidence === 100) return 1;
            return b.confidence - a.confidence;
        });

        sortedMatches.forEach((match, matchIndex) => {
            const buttonId = `resolve-${missingIndex}-${missing.node_id}-${missing.widget_index}-${matchIndex}`;
            const resolveButton = container.querySelector(`#${buttonId}`);
            if (resolveButton) {
                resolveButton.onclick = null;
                resolveButton.addEventListener('click', () => {
                    this.queueResolution(missing, match.model);
                });
            }
        });

        if (otherMatches && otherMatches.length > 0) {
            for (let mIdx = 0; mIdx < otherMatches.length; mIdx++) {
                const match = otherMatches[mIdx];
                const altBtnId = `resolve-alt-${missingIndex}-${missing.node_id}-${missing.widget_index}-${mIdx}`;
                const altBtn = container.querySelector(`#${altBtnId}`);
                if (altBtn) {
                    altBtn.addEventListener('click', () => {
                        this.queueResolution(missing, match.model);
                    });
                }
            }
        }
    }

    async refreshUrnLocalMatches(missing) {
        if (!missing?.civitai_info?.expected_filename || !this.contentElement) return;

        const bodyId = `local-matches-body-${missing.node_id}-${missing.widget_index}`;
        const container = this.contentElement.querySelector(`#${bodyId}`);
        if (!container) return;

        container.innerHTML = `<div class="ml-no-matches">Searching local matches for "${missing.civitai_info.expected_filename}"...</div>`;

        try {
            const response = await api.fetchApi('/model_linker/local-matches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: missing.civitai_info.expected_filename,
                    category: missing.category || ''
                })
            });

            if (!response.ok) {
                throw new Error(`Local match search failed: ${response.status}`);
            }

            const data = await response.json();
            missing.matches = Array.isArray(data.matches) ? data.matches : [];
            container.innerHTML = this.renderLocalMatchesContent(missing, missing.__displayIndex || 0);
            this.wireLocalMatchButtons(this.contentElement, missing, missing.__displayIndex || 0);
        } catch (error) {
            console.error('Model Linker: URN local match refresh error:', error);
            container.innerHTML = `<div class="ml-no-matches">Failed to refresh local matches.</div>`;
        }
    }

    /**
     * Handle click outside context menu to hide it
     */
    handleContextMenuOutsideClick(e) {
        if (!this.contextMenu) return;
        if (this.contextMenu.style.display === 'none') return;
        
        // Check if click is outside the context menu
        if (!this.contextMenu.contains(e.target)) {
            this.hideContextMenu();
        }
    }
    
    /**
     * Show context menu at the specified position
     */
    showContextMenu(x, y, model) {
        if (!this.contextMenu) return;
        
        this._contextMenuModel = model;
        
        // Position the menu
        this.contextMenu.style.left = `${x}px`;
        this.contextMenu.style.top = `${y}px`;
        this.contextMenu.style.display = 'block';
        
        // Adjust position if menu would go off screen
        const rect = this.contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    }
    
    /**
     * Hide context menu
     */
    hideContextMenu() {
        if (!this.contextMenu) return;
        this.contextMenu.style.display = 'none';
        this._contextMenuModel = null;
    }
    
    /**
     * Handle context menu item click
     */
    handleContextMenuAction(action) {
        const model = this._contextMenuModel;
        this.hideContextMenu();
        
        if (!model) return;
        
        if (action === 'civitai') {
            this.openInCivitAI(model);
        } else if (action === 'openFolder') {
            this.openContainingFolder(model);
        } else if (action === 'showInfo') {
            this.showModelInfo(model);
        }
    }

    async openContainingFolder(model) {
        const path = model?.path || model?.resolved_path || '';
        if (!path) {
            this.showNotification('No local file path available', 'error');
            return;
        }

        try {
            const response = await api.fetchApi('/model_linker/open-containing-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });

            if (!response.ok) {
                throw new Error(`Open folder failed: ${response.status}`);
            }
        } catch (error) {
            console.error('Model Linker: Open folder error:', error);
            this.showNotification('Failed to open containing folder', 'error');
        }
    }
    
    /**
     * Open model in CivitAI
     */
    async openInCivitAI(model) {
        if (!model) return;
        
        const name = model.name || model.original_path?.split(/[\/\\]/).pop() || '';
        if (!name) return;
        
        try {
            // Search CivitAI for this model using hash (pass resolved_path for hash lookup)
            const response = await api.fetchApi('/model_linker/civitai-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    filename: name, 
                    category: model.category,
                    resolved_path: model.resolved_path || ''
                })
            });
            
            if (!response.ok) {
                this.showNotification('Nie znaleziono modelu na CivitAI', 'error');
                return;
            }
            
            const data = await response.json();
            if (data.url) {
                window.open(data.url, '_blank');
            } else {
                // Try direct search on CivitAI
                const searchName = name.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
                const searchUrl = `https://civitai.com/search?q=${encodeURIComponent(searchName)}`;
                window.open(searchUrl, '_blank');
            }
        } catch (e) {
            console.error('Model Linker: Error searching CivitAI:', e);
            // Fall back to direct search
            const searchName = name.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
            const searchUrl = `https://civitai.com/search?q=${encodeURIComponent(searchName)}`;
            window.open(searchUrl, '_blank');
        }
    }
    
    /**
     * Show model info dialog (similar to rgthree's RgthreeLoraInfoDialog)
     */
    async showModelInfo(model) {
        if (!model) return;
        
        const name = model.name || model.original_path?.split(/[\/\\]/).pop() || '';
        if (!name) return;
        
        // Create and show the info dialog
        this.showModelInfoDialog(name, model);
    }
    
    /**
     * Show the model info dialog
     */
    showModelInfoDialog(loraName, modelData) {
        // Create info dialog element
        const dialog = this.createInfoDialog(loraName, modelData);
        this.restoreInfoDialogSize(dialog);
        
        // Show the dialog
        document.body.appendChild(dialog);
        this.bindTooltips(dialog);
        this.bindInfoDialogResizePersistence(dialog);
        
        // Add close handlers
        const closeBtn = dialog.querySelector('.ml-info-dialog-close');
        const footerCloseBtn = dialog.querySelector('.ml-info-dialog-close-btn');
        const backdrop = dialog.querySelector('.ml-info-dialog-backdrop');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeInfoDialog(dialog));
        }
        if (footerCloseBtn) {
            footerCloseBtn.addEventListener('click', () => this.closeInfoDialog(dialog));
        }
        if (backdrop) {
            backdrop.addEventListener('click', (e) => {
                // Only close if clicking backdrop itself, not its children
                if (e.target === backdrop) {
                    this.closeInfoDialog(dialog);
                }
            });
        }
        
        // Fetch CivitAI info
        this.fetchModelInfoForDialog(loraName, modelData, dialog);
    }
    
    /**
     * Create the info dialog element
     */
    createInfoDialog(loraName, modelData) {
        const loraDisplayName = loraName.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
        
        const dialog = document.createElement('div');
        dialog.className = 'ml-info-dialog-backdrop';
        dialog._selectedTrainedWords = new Set();
        dialog.innerHTML = `
            <div class="ml-info-dialog">
                <div class="ml-info-dialog-header">
                    <h3 class="ml-info-dialog-title">${loraDisplayName}</h3>
                    <button class="ml-info-dialog-close">×</button>
                </div>
                <div class="ml-info-dialog-content">
                    <div class="ml-info-dialog-loading">Loading...</div>
                    <div class="ml-info-dialog-body ml-hidden-initial">
                        <div class="ml-info-area">
                            <span class="ml-info-tag ml-info-type"></span>
                            <span class="ml-info-tag ml-info-basemodel"></span>
                        </div>
                        <table class="ml-info-table">
                            <tbody>
                                <tr class="ml-info-file-row">
                                    <td><span>File <span class="ml-tooltip-badge" data-tooltip="The model file name found locally or returned by CivitAI.">?</span></span></td>
                                    <td><span class="ml-info-file"></span></td>
                                </tr>
                                <tr class="ml-info-hash-row">
                                    <td><span>Hash (sha256) <span class="ml-tooltip-badge" data-tooltip="Unique fingerprint of the local file. Model Linker uses it to confirm the exact CivitAI version.">?</span></span></td>
                                    <td><span class="ml-info-hash"></span></td>
                                </tr>
                                <tr class="ml-info-civitai-row">
                                    <td><span>CivitAI <span class="ml-tooltip-badge" data-tooltip="Opens the matching CivitAI model or version page when one was found.">?</span></span></td>
                                    <td><span class="ml-info-civitai-link"></span></td>
                                </tr>
                                <tr class="ml-info-name-row">
                                    <td><span>Name <span class="ml-tooltip-badge" data-tooltip="Model name from CivitAI or local metadata.">?</span></span></td>
                                    <td><span class="ml-info-name"></span></td>
                                </tr>
                                <tr class="ml-info-basemodel-row">
                                    <td><span>Base Model <span class="ml-tooltip-badge" data-tooltip="Base model this resource was made for, for example SD1.5, SDXL or Flux.">?</span></span></td>
                                    <td><span class="ml-info-base-model"></span></td>
                                </tr>
                                <tr class="ml-info-trainedwords-row ml-hidden-initial">
                                    <td>
                                        <div class="ml-info-trained-words-label">
                                            Trained Words <span class="ml-tooltip-badge" data-tooltip="Trigger words recommended by the model author. Click the words you want, then copy them into your prompt.">?</span>
                                            <small class="ml-info-trained-words-meta">
                                                <span class="ml-info-trained-words-count">0 selected</span>
                                                <button type="button" class="ml-info-copy-trained-words" disabled>Copy</button>
                                            </small>
                                        </div>
                                    </td>
                                    <td>
                                        <div class="ml-info-trained-words-hint">Click words to select them.</div>
                                        <div class="ml-info-trained-words"></div>
                                    </td>
                                </tr>
                                <tr class="ml-info-clipskip-row ml-hidden-initial">
                                    <td><span>Clip Skip <span class="ml-tooltip-badge" data-tooltip="Recommended Clip Skip value from the model author, if one is provided.">?</span></span></td>
                                    <td><span class="ml-info-clip-skip"></span></td>
                                </tr>
                                <tr class="ml-info-description-row ml-hidden-initial">
                                    <td><span>Description <span class="ml-tooltip-badge" data-tooltip="Model description from CivitAI or local metadata. Long descriptions are shortened until you click Show more.">?</span></span></td>
                                    <td>
                                        <div class="ml-info-description-wrap">
                                            <div class="ml-info-description"></div>
                                            <div class="ml-info-description-actions ml-hidden-initial">
                                                <button type="button" class="ml-info-description-toggle">Show more</button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <div class="ml-info-images"></div>
                    </div>
                </div>
                <div class="ml-info-dialog-footer">
                    <button class="ml-btn ml-btn-secondary ml-info-dialog-close-btn">Close</button>
                </div>
            </div>
        `;
        
        return dialog;
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    truncateText(value, maxLength = 160) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
    }

    sanitizeDescriptionHtml(html) {
        const raw = String(html ?? '').trim();
        if (!raw) return '';

        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${raw}</div>`, 'text/html');
        const root = doc.body.firstElementChild;
        if (!root) return this.escapeHtml(raw);

        const allowedTags = new Set([
            'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
            'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'a', 'span'
        ]);
        const allowedStyles = new Set(['color']);

        const sanitizeNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return;
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                node.remove();
                return;
            }

            const tag = node.tagName.toLowerCase();
            if (!allowedTags.has(tag)) {
                const parent = node.parentNode;
                if (!parent) {
                    node.remove();
                    return;
                }

                while (node.firstChild) {
                    parent.insertBefore(node.firstChild, node);
                }
                parent.removeChild(node);
                return;
            }

            const attrs = Array.from(node.attributes);
            for (const attr of attrs) {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || name === 'id' || name === 'class' || name.startsWith('data-')) {
                    node.removeAttribute(attr.name);
                    continue;
                }

                if (name === 'href' && tag === 'a') {
                    const href = node.getAttribute('href') || '';
                    if (!/^https?:\/\//i.test(href)) {
                        node.removeAttribute('href');
                    } else {
                        node.setAttribute('target', '_blank');
                        node.setAttribute('rel', 'noopener noreferrer');
                    }
                    continue;
                }

                if (name === 'style') {
                    const safeStyles = [];
                    const styleValue = node.getAttribute('style') || '';
                    for (const part of styleValue.split(';')) {
                        const [prop, value] = part.split(':').map(v => v?.trim());
                        if (!prop || !value) continue;
                        if (allowedStyles.has(prop.toLowerCase())) {
                            safeStyles.push(`${prop}: ${value}`);
                        }
                    }
                    if (safeStyles.length) {
                        node.setAttribute('style', safeStyles.join('; '));
                    } else {
                        node.removeAttribute('style');
                    }
                    continue;
                }

                if (!(tag === 'a' && (name === 'target' || name === 'rel')) ) {
                    node.removeAttribute(attr.name);
                }
            }

            Array.from(node.childNodes).forEach(child => sanitizeNode(child));
        };

        Array.from(root.childNodes).forEach(child => sanitizeNode(child));
        return root.innerHTML;
    }

    normalizeTrainedWords(words) {
        if (Array.isArray(words)) {
            return [...new Set(words.map(word => String(word || '').trim()).filter(Boolean))];
        }

        if (typeof words === 'string') {
            return [...new Set(
                words
                    .split(/[\n,|;]/)
                    .map(word => word.trim())
                    .filter(Boolean)
            )];
        }

        return [];
    }

    updateSelectedTrainedWordsSummary(dialog) {
        if (!dialog) return;

        const countEl = dialog.querySelector('.ml-info-trained-words-count');
        const copyBtn = dialog.querySelector('.ml-info-copy-trained-words');
        const selected = dialog._selectedTrainedWords instanceof Set
            ? Array.from(dialog._selectedTrainedWords)
            : [];

        if (countEl) {
            countEl.textContent = `${selected.length} selected`;
        }
        if (copyBtn) {
            copyBtn.disabled = selected.length === 0;
            copyBtn.textContent = 'Copy';
        }
    }

    bindInfoDialogInteractions(dialog) {
        if (!dialog || dialog.dataset.mlInfoBound === 'true') return;
        dialog.dataset.mlInfoBound = 'true';

        dialog.addEventListener('click', async (event) => {
            const wordBtn = event.target.closest('.ml-info-trained-word');
            if (wordBtn && dialog.contains(wordBtn)) {
                const word = wordBtn.dataset.word || '';
                if (word) {
                    if (!(dialog._selectedTrainedWords instanceof Set)) {
                        dialog._selectedTrainedWords = new Set();
                    }

                    if (dialog._selectedTrainedWords.has(word)) {
                        dialog._selectedTrainedWords.delete(word);
                        wordBtn.classList.remove('is-selected');
                        wordBtn.setAttribute('aria-pressed', 'false');
                    } else {
                        dialog._selectedTrainedWords.add(word);
                        wordBtn.classList.add('is-selected');
                        wordBtn.setAttribute('aria-pressed', 'true');
                    }

                    this.updateSelectedTrainedWordsSummary(dialog);
                }
                return;
            }

            const copyBtn = event.target.closest('.ml-info-copy-trained-words');
            if (copyBtn && dialog.contains(copyBtn)) {
                const words = dialog._selectedTrainedWords instanceof Set
                    ? Array.from(dialog._selectedTrainedWords)
                    : [];

                if (!words.length) return;

                try {
                    await navigator.clipboard.writeText(words.join(', '));
                    copyBtn.textContent = 'Copied';
                } catch (error) {
                    console.error('Model Linker: Failed to copy trained words:', error);
                    copyBtn.textContent = 'Failed';
                }

                setTimeout(() => {
                    if (copyBtn.isConnected) {
                        copyBtn.textContent = 'Copy';
                    }
                }, 1200);
                return;
            }

            const descToggleBtn = event.target.closest('.ml-info-description-toggle');
            if (descToggleBtn && dialog.contains(descToggleBtn)) {
                const descEl = dialog.querySelector('.ml-info-description');
                if (!descEl) return;

                const isExpanded = descEl.classList.toggle('is-expanded');
                descToggleBtn.textContent = isExpanded ? 'Show less' : 'Show more';
            }
        });
    }

    getInfoDialogElement(dialog) {
        return dialog?.querySelector?.('.ml-info-dialog') || null;
    }

    restoreInfoDialogSize(dialog) {
        const panel = this.getInfoDialogElement(dialog);
        if (!panel) return;

        try {
            const saved = JSON.parse(localStorage.getItem('model_linker_info_dialog_size') || 'null');
            if (!saved || typeof saved !== 'object') return;

            const width = Number(saved.w);
            const height = Number(saved.h);
            if (!Number.isFinite(width) || !Number.isFinite(height)) return;

            const maxWidth = Math.floor(window.innerWidth * 0.9);
            const maxHeight = Math.floor(window.innerHeight * 0.8);
            const clampedWidth = Math.max(420, Math.min(width, maxWidth));
            const clampedHeight = Math.max(320, Math.min(height, maxHeight));

            panel.style.width = `${clampedWidth}px`;
            panel.style.height = `${clampedHeight}px`;
        } catch (error) {
            console.warn('Model Linker: Failed to restore info dialog size:', error);
        }
    }

    saveInfoDialogSize(dialog) {
        const panel = this.getInfoDialogElement(dialog);
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (!width || !height) return;

        try {
            localStorage.setItem('model_linker_info_dialog_size', JSON.stringify({ w: width, h: height }));
        } catch (error) {
            console.warn('Model Linker: Failed to save info dialog size:', error);
        }
    }

    bindInfoDialogResizePersistence(dialog) {
        const panel = this.getInfoDialogElement(dialog);
        if (!panel || typeof ResizeObserver === 'undefined') return;
        if (dialog._infoDialogResizeObserver) return;

        let resizeSaveTimer = null;
        const observer = new ResizeObserver(() => {
            clearTimeout(resizeSaveTimer);
            resizeSaveTimer = setTimeout(() => this.saveInfoDialogSize(dialog), 180);
            dialog._infoDialogResizeSaveTimer = resizeSaveTimer;
        });

        observer.observe(panel);
        dialog._infoDialogResizeObserver = observer;
        dialog._infoDialogResizeSaveTimer = resizeSaveTimer;
    }
    
    /**
     * Fetch model info and update the dialog
     */
    async fetchModelInfoForDialog(loraName, modelData, dialog) {
        try {
            const response = await api.fetchApi('/model_linker/civitai-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    filename: loraName,
                    category: modelData?.category || '',
                    resolved_path: modelData?.resolved_path || ''
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.updateInfoDialogWithData(dialog, data);
            } else {
                this.updateInfoDialogError(dialog, 'Model not found on CivitAI');
            }
        } catch (e) {
            console.error('Model Linker: Error fetching model info:', e);
            this.updateInfoDialogError(dialog, 'Error fetching info');
        }
    }
    
    /**
     * Update the info dialog with data
     */
    updateInfoDialogWithData(dialog, data) {
        const loadingDiv = dialog.querySelector('.ml-info-dialog-loading');
        const bodyDiv = dialog.querySelector('.ml-info-dialog-body');
        this.bindInfoDialogInteractions(dialog);
        
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (bodyDiv) bodyDiv.style.display = 'block';
        
        if (!data) {
            this.updateInfoDialogError(dialog, 'No data received');
            return;
        }
        
        // Update title
        const titleEl = dialog.querySelector('.ml-info-dialog-title');
        if (titleEl) {
            const modelName = data.model_name || data.modelName || 'Unknown Model';
            const versionName = data.version_name || data.versionName || '';
            titleEl.innerHTML = this.renderVersionedModelNameHtml(modelName, versionName) || this.escapeHtml(modelName);
        }
        
        // Update type tag
        const typeTag = dialog.querySelector('.ml-info-type');
        if (typeTag) {
            const modelType = data.model_type || data.modelType || '';
            typeTag.textContent = modelType.toUpperCase();
            typeTag.className = `ml-info-tag ml-info-type ${this.getModelTypeColorClass(modelType)}`;
        }
        
        // Update base model tag
        const baseModelTag = dialog.querySelector('.ml-info-basemodel');
        if (baseModelTag) {
            const baseModel = data.base_model || data.baseModel || '';
            baseModelTag.textContent = baseModel || '';
            if (baseModel) {
                baseModelTag.style.display = '';
                baseModelTag.className = `ml-info-tag ml-info-basemodel -basemodel-${baseModel.toLowerCase().replace(/\s+/g, '-')}`;
            } else {
                baseModelTag.style.display = 'none';
            }
        }
        
        // Update file
        const fileEl = dialog.querySelector('.ml-info-file');
        if (fileEl && data.filename) {
            fileEl.textContent = data.filename;
        }
        
        // Update hash
        const hashEl = dialog.querySelector('.ml-info-hash');
        if (hashEl) {
            hashEl.textContent = data.sha256 || data.hash || '';
        }
        
        // Update CivitAI link
        const civitaiLinkEl = dialog.querySelector('.ml-info-civitai-link');
        if (civitaiLinkEl) {
            if (data.url || data.version_url) {
                const url = data.version_url || data.url;
                civitaiLinkEl.innerHTML = `
                    <a href="${url}" target="_blank" class="ml-info-link">
                        ${getSvgIcon('civitai', 'currentColor', 'ml-info-civitai-logo')}
                        View on Civitai
                    </a>
                `;
            } else {
                const searchName = data.model_name || data.modelName || 'Unknown';
                civitaiLinkEl.innerHTML = `
                    <span class="ml-info-not-found">Model not found</span>
                    <a href="https://civitai.com/search?q=${encodeURIComponent(searchName)}" target="_blank" class="ml-info-link">
                        ${this.getSearchIconHtml()} Search on CivitAI
                    </a>
                `;
            }
        }
        
        // Update name
        const nameEl = dialog.querySelector('.ml-info-name');
        if (nameEl) {
            nameEl.textContent = data.model_name || data.modelName || '';
        }
        
        // Update base model row
        const baseModelRowEl = dialog.querySelector('.ml-info-base-model');
        if (baseModelRowEl) {
            const baseModel = data.base_model || data.baseModel || '';
            baseModelRowEl.textContent = baseModel;
            const row = baseModelRowEl.closest('tr');
            if (row && baseModel) {
                row.style.display = '';
            } else if (row) {
                row.style.display = 'none';
            }
        }
        
        // Update trained words
        const trainedWordsEl = dialog.querySelector('.ml-info-trained-words');
        if (trainedWordsEl) {
            const words = this.normalizeTrainedWords(data.trained_words || data.trainedWords || []);
            if (words.length > 0) {
                dialog._selectedTrainedWords = new Set();
                trainedWordsEl.innerHTML = `<div class="ml-info-trained-words-list">${words.map(word => `
                    <button
                        type="button"
                        class="ml-info-trained-word"
                        data-word="${this.escapeHtml(word)}"
                        data-tooltip="${this.escapeHtml(word)}"
                        aria-pressed="false"
                    >
                        ${this.escapeHtml(word)}
                    </button>
                `).join('')}</div>`;
                const row = trainedWordsEl.closest('tr');
                if (row) row.style.display = '';
                this.bindTooltips(trainedWordsEl);
                this.updateSelectedTrainedWordsSummary(dialog);
            } else {
                const row = trainedWordsEl.closest('tr');
                if (row) row.style.display = 'none';
            }
        }
        
        // Update clip skip
        const clipSkipEl = dialog.querySelector('.ml-info-clip-skip');
        if (clipSkipEl) {
            const clipSkip = data.clip_skip || data.clipSkip;
            if (clipSkip && clipSkip !== 'None') {
                clipSkipEl.textContent = clipSkip;
                const row = clipSkipEl.closest('tr');
                if (row) row.style.display = '';
            } else {
                const row = clipSkipEl.closest('tr');
                if (row) row.style.display = 'none';
            }
        }
        
        // Update description
        const descEl = dialog.querySelector('.ml-info-description');
        if (descEl) {
            const desc = data.description || data.model_description || data.modelDescription || '';
            if (desc) {
                const actionsEl = dialog.querySelector('.ml-info-description-actions');
                const toggleBtn = dialog.querySelector('.ml-info-description-toggle');

                let sanitizedHtml = '';
                try {
                    sanitizedHtml = this.sanitizeDescriptionHtml(desc);
                } catch (error) {
                    console.error('Model Linker: Failed to sanitize description HTML:', error);
                }

                const fallbackText = this.escapeHtml(String(desc).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
                const finalHtml = sanitizedHtml && sanitizedHtml.trim() ? sanitizedHtml : `<p>${fallbackText}</p>`;
                const textOnly = finalHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

                descEl.innerHTML = finalHtml;
                descEl.classList.remove('is-expanded');

                const shouldCollapse = textOnly.length > 520 || finalHtml.length > 900;
                if (actionsEl) {
                    actionsEl.style.display = shouldCollapse ? '' : 'none';
                }
                if (toggleBtn) {
                    toggleBtn.textContent = 'Show more';
                }
                if (!shouldCollapse) {
                    descEl.classList.add('is-expanded');
                }

                const row = descEl.closest('tr');
                if (row) row.style.display = '';
            } else {
                const row = descEl.closest('tr');
                if (row) row.style.display = 'none';
            }
        }
        
        // Update images
        this.updateInfoDialogImages(dialog, data.images || data.modelImages || []);
    }
    
    /**
     * Update images in the info dialog
     */
    updateInfoDialogImages(dialog, images) {
        const imagesContainer = dialog.querySelector('.ml-info-images');
        if (!imagesContainer) return;
        if (!images.length) {
            imagesContainer.innerHTML = '';
            return;
        }

        const visibleImages = images.slice(0, 8).filter(img => img?.url);

        const renderImageCard = (img) => {
            const captionParts = [];
            if (img.civitaiUrl) {
                captionParts.push(`<a href="${this.escapeHtml(img.civitaiUrl)}" target="_blank" rel="noopener noreferrer" class="ml-info-image-link">civitai</a>`);
            }
            if (img.seed) captionParts.push(`<span><label>seed</label> ${this.escapeHtml(img.seed)}</span>`);
            if (img.steps) captionParts.push(`<span><label>steps</label> ${this.escapeHtml(img.steps)}</span>`);
            if (img.cfg) captionParts.push(`<span><label>cfg</label> ${this.escapeHtml(img.cfg)}</span>`);
            if (img.sampler) captionParts.push(`<span><label>sampler</label> ${this.escapeHtml(img.sampler)}</span>`);
            if (img.model) captionParts.push(`<span><label>model</label> ${this.escapeHtml(this.truncateText(img.model, 72))}</span>`);
            if (img.positive) captionParts.push(`<span><label>positive</label> ${this.escapeHtml(this.truncateText(img.positive, 180))}</span>`);
            if (img.negative) captionParts.push(`<span><label>negative</label> ${this.escapeHtml(this.truncateText(img.negative, 180))}</span>`);

            return `
                <div class="ml-info-image-item">
                    <figure>
                        <img src="${this.escapeHtml(img.url)}" alt="Example" loading="lazy" />
                        <figcaption>${captionParts.join('')}</figcaption>
                    </figure>
                </div>
            `;
        };

        let imagesHtml = '<div class="ml-info-images-header">Example Images</div><div class="ml-info-images-layout">';
        imagesHtml += visibleImages.map(renderImageCard).join('');
        imagesHtml += '</div>';
        imagesContainer.innerHTML = imagesHtml;
    }
    
    /**
     * Update the info dialog with error
     */
    updateInfoDialogError(dialog, message) {
        const civitaiLink = dialog.querySelector('.ml-info-civitai-link');
        if (civitaiLink) {
            civitaiLink.innerHTML = `<span class="ml-info-error">${message}</span>`;
        }
    }
    
    /**
     * Close the info dialog
     */
    closeInfoDialog(dialog) {
        if (dialog?._infoDialogResizeObserver) {
            dialog._infoDialogResizeObserver.disconnect();
            dialog._infoDialogResizeObserver = null;
        }
        if (dialog?._infoDialogResizeSaveTimer) {
            clearTimeout(dialog._infoDialogResizeSaveTimer);
            dialog._infoDialogResizeSaveTimer = null;
        }
        this.saveInfoDialogSize(dialog);

        if (dialog && dialog.parentNode) {
            dialog.parentNode.removeChild(dialog);
        }
    }

    /**
     * Get a colored confidence badge HTML
     * @param {number} confidence - Confidence percentage (0-100)
     * @returns {string} HTML for the badge
     */
    getConfidenceBadge(confidence) {
        let badgeClass;
        if (confidence >= 95) {
            badgeClass = 'ml-badge-high';
        } else if (confidence >= 70) {
            badgeClass = 'ml-badge-medium';
        } else {
            badgeClass = 'ml-badge-low';
        }
        return `<span class="ml-badge ${badgeClass}">${confidence}%</span>`;
    }

    getStatusBadge(label, variant = 'neutral') {
        return `<span class="ml-badge ml-badge-${variant}">${label}</span>`;
    }
    
    /**
     * Format a filename with smart truncation
     * @param {string} path - Full path or filename
     * @param {number} maxLength - Maximum display length
     * @returns {object} { display: truncated name, full: full name }
     */
    formatFilename(path, maxLength = 50) {
        if (!path) return { display: 'Unknown', full: 'Unknown' };
        
        // Extract just the filename from path
        const filename = path.split(/[\/\\]/).pop() || path;
        
        if (filename.length <= maxLength) {
            return { display: filename, full: filename };
        }
        
        // Smart truncation: keep extension visible
        const lastDot = filename.lastIndexOf('.');
        const ext = lastDot > 0 ? filename.slice(lastDot) : '';
        const name = lastDot > 0 ? filename.slice(0, lastDot) : filename;
        
        // Calculate how much of the name we can show
        const availableLength = maxLength - ext.length - 3; // 3 for "..."
        if (availableLength < 8) {
            // Too short, just truncate at the end
            return { display: filename.slice(0, maxLength - 3) + '...', full: filename };
        }
        
        // Truncate middle of name
        const frontLength = Math.ceil(availableLength / 2);
        const backLength = Math.floor(availableLength / 2);
        const truncated = name.slice(0, frontLength) + '...' + name.slice(-backLength) + ext;
        
        return { display: truncated, full: filename };
    }
    
    /**
     * Format a path showing directory context
     * @param {string} path - Full relative path
     * @param {number} maxLength - Maximum display length
     * @returns {object} { display: formatted path, full: full path }
     */
    formatPath(path, maxLength = 60) {
        if (!path) return { display: 'Unknown', full: 'Unknown' };
        
        if (path.length <= maxLength) {
            return { display: path, full: path };
        }
        
        // Try to show meaningful parts: first dir + filename
        const parts = path.split(/[\/\\]/);
        const filename = parts.pop() || '';
        const firstDir = parts[0] || '';
        
        if (parts.length === 0) {
            // Just a filename
            return this.formatFilename(path, maxLength);
        }
        
        // Show first directory + ... + filename
        const formatted = firstDir + '\\...' + (filename.length > 40 ? this.formatFilename(filename, 40).display : filename);
        
        if (formatted.length <= maxLength) {
            return { display: formatted, full: path };
        }
        
        // Still too long, just truncate
        return { display: path.slice(0, maxLength - 3) + '...', full: path };
    }
    
    /**
     * Render a status message with icon
     * @param {string} message - Message text
     * @param {string} type - 'error' | 'success' | 'info' | 'warning'
     * @returns {string} HTML for status message
     */
    renderStatusMessage(message, type = 'info') {
        const icons = {
            error: '⚠',
            success: '✓',
            info: 'ℹ',
            warning: '⚡'
        };
        const icon = icons[type] || icons.info;
        
        return `
            <div class="ml-status ml-status-${type}">
                <span class="ml-status-icon">${icon}</span>
                <span>${message}</span>
            </div>
        `;
    }
    
    /**
     * Render a progress bar
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} leftText - Text on the left
     * @param {string} rightText - Text on the right
     * @returns {string} HTML for progress bar
     */
    renderProgressBar(percent, leftText = '', rightText = '') {
        return `
            <div class="ml-progress-container">
                <div class="ml-progress-bar">
                    <div class="ml-progress-fill" style="width: ${percent}%"></div>
                </div>
                <div class="ml-progress-text">
                    <span>${leftText}</span>
                    <span>${rightText}</span>
                </div>
            </div>
        `;
    }

    renderAnalysisProgress(progress = {}) {
        const current = Number(progress.current) || 0;
        const total = Number(progress.total) || 0;
        const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
        const message = progress.message || 'Analyzing workflow...';
        const modelName = progress.model_name ? this.escapeHtml(String(progress.model_name)) : '';
        const detail = total > 0 ? `${current} / ${total}` : 'Preparing...';

        return `
            <div class="ml-download-section">
                <div class="ml-status-inline">
                    ${this.getStatusBadge('Analyzing', 'info')}
                    <span class="ml-download-info">${message}</span>
                </div>
                ${this.renderProgressBar(percent, detail, `${percent}%`)}
                ${modelName ? `<div class="ml-download-info">${modelName}</div>` : ''}
            </div>
        `;
    }

    async pollAnalysisProgress(analysisId, token) {
        while (this._analysisProgressToken === token) {
            try {
                const response = await api.fetchApi(`/model_linker/analyze-progress/${analysisId}`);
                if (response.ok && this.contentElement && this._analysisProgressToken === token) {
                    const progress = await response.json();
                    this.contentElement.innerHTML = this.renderAnalysisProgress(progress);
                    if (progress.status === 'completed' || progress.status === 'error') {
                        return;
                    }
                }
            } catch (error) {
                console.warn('Model Linker: analysis progress polling failed', error);
            }

            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }

    getWorkflowSignature(workflow) {
        if (!workflow) return null;
        try {
            return JSON.stringify(workflow);
        } catch (error) {
            console.warn('Model Linker: workflow signature generation failed', error);
            return null;
        }
    }
    
    /**
     * Handle clicks outside the dialog
     */
    handleOutsideClick(e) {
        // Close if click is on the backdrop (not on the dialog itself)
        if (e.target === this.backdrop) {
            this.close();
        }
    }
    
    createHeader() {
        // Create tabs
        this.missingTab = $el("button.ml-tab.ml-tab-active", {
            onclick: () => this.switchTab('missing')
        }, [$el("span.ml-tab-label", { textContent: "Missing Models" })]);
        
        this.loadedTab = $el("button.ml-tab", {
            onclick: () => this.switchTab('loaded')
        }, [$el("span.ml-tab-label", { textContent: "Loaded Models" })]);

        this.optionsTab = $el("button.ml-tab", {
            onclick: () => this.switchTab('options')
        }, [$el("span.ml-tab-label", { textContent: "Options" })]);
        if (this.activeTab === 'missing') {
            this.updateTabButtonStates();
        }

        const dragHandle = $el("div", {
            id: "model-linker-drag-handle",
            ondragstart: (e) => e.preventDefault()
        }, [
            $el("span", { textContent: "⠿" })
        ]);
        this.setTooltip(dragHandle, "Drag window");

        const fullscreenButton = $el("button", {
            id: "model-linker-fullscreen-toggle",
            className: "ml-window-btn ml-window-btn--fullscreen",
            innerHTML: getSvgIcon('windowMaximize', 'currentColor', 'ml-window-btn-icon'),
            ariaLabel: "Toggle full screen",
            onclick: () => this.toggleFullScreen()
        });
        this.setTooltip(fullscreenButton, "Toggle full screen");

        this.dockButton = $el("button", {
            id: "model-linker-dock-toggle",
            className: "ml-window-btn ml-window-btn--dock",
            innerHTML: getSvgIcon('internalLink', 'currentColor', 'ml-window-btn-icon'),
            ariaLabel: "Dock Model Linker to sidebar",
            onclick: () => this.dockToSidebar()
        });
        this.setTooltip(this.dockButton, "Dock to sidebar");

        this.undockButton = $el("button", {
            id: "model-linker-undock-toggle",
            className: "ml-window-btn ml-window-btn--undock",
            innerHTML: getSvgIcon('externalLink', 'currentColor', 'ml-window-btn-icon'),
            ariaLabel: "Undock Model Linker",
            onclick: () => this.undockToFloating()
        });
        this.setTooltip(this.undockButton, "Undock to floating window");
        
        return $el("div.ml-dialog-shell", {}, [
            $el("div.ml-dialog-topbar", {}, [
                $el("div.ml-dialog-brand", {}, [
                    dragHandle,
                    $el("div.ml-tabs", {}, [
                        this.missingTab,
                        this.loadedTab,
                        this.optionsTab
                    ])
                ]),
                $el("div.ml-dialog-controls", {}, [
                    this.dockButton,
                    this.undockButton,
                    fullscreenButton,
                    $el("button", {
                        className: "ml-window-btn ml-window-btn--close",
                        innerHTML: getSvgIcon('x', 'currentColor', 'ml-window-btn-icon'),
                        ariaLabel: "Close Model Linker",
                        onclick: () => this.close()
                    })
                ])
            ])
        ]);
    }

    captureFloatingRect() {
        if (!this.element || this.docked || getComputedStyle(this.element).display === 'none') return;

        const rect = this.element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        this._floatingRectBeforeDock = {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        };
    }

    clearModalPlacementStyles() {
        if (!this.element) return;

        [
            'position',
            'top',
            'left',
            'right',
            'bottom',
            'inset',
            'transform',
            'width',
            'height',
            'maxWidth',
            'maxHeight',
            'minWidth',
            'minHeight',
            'borderRadius',
            'resize'
        ].forEach((property) => {
            this.element.style[property] = '';
        });
    }

    restoreFloatingGeometry() {
        const el = this.element;
        if (!el) return;

        el.style.width = '1100px';
        el.style.height = '700px';
        el.style.maxWidth = '100vw';
        el.style.maxHeight = '100vh';
        el.style.minWidth = '640px';
        el.style.minHeight = '420px';
        el.style.resize = 'both';
        el.style.borderRadius = '7px';

        const rect = this._floatingRectBeforeDock;
        if (rect?.width && rect?.height) {
            el.style.width = `${rect.width}px`;
            el.style.height = `${rect.height}px`;
            el.style.top = `${rect.top}px`;
            el.style.left = `${rect.left}px`;
            el.style.transform = 'none';
            return;
        }

        try {
            const wh = JSON.parse(localStorage.getItem('model_linker_modal_size_before_fs') || 'null');
            if (wh?.w && wh?.h) {
                el.style.width = `${wh.w}px`;
                el.style.height = `${wh.h}px`;
            }

            const pos = JSON.parse(localStorage.getItem('model_linker_modal_pos') || 'null');
            if (pos && Number.isFinite(pos.top) && Number.isFinite(pos.left)) {
                el.style.top = `${pos.top}px`;
                el.style.left = `${pos.left}px`;
                el.style.transform = 'none';
                return;
            }
        } catch (e) {
            // Fall back to centered floating geometry below.
        }

        el.style.top = '50%';
        el.style.left = '50%';
        el.style.transform = 'translate(-50%, -50%)';
    }

    rememberSidebarOpenMode(mode) {
        try {
            localStorage.setItem(this.sidebarOpenModeStorageKey, mode === 'floating' ? 'floating' : 'docked');
        } catch (e) {}
    }

    shouldOpenFromSidebarFloating() {
        try {
            return localStorage.getItem(this.sidebarOpenModeStorageKey) === 'floating';
        } catch (e) {
            return false;
        }
    }

    isVisible() {
        if (!this.element?.isConnected) return false;
        return getComputedStyle(this.element).display !== 'none';
    }

    dockTo(container) {
        if (!container || !this.element) return;

        if (!this.docked) {
            this.captureFloatingRect();
        }

        if (this.fullscreen) {
            this.setFullScreen(false);
        }

        this.docked = true;
        this.dockContainer = container;
        this.lastDockContainer = container;
        this.pendingDockToSidebar = false;
        this.rememberSidebarOpenMode('docked');
        this.backdrop.style.display = 'none';
        container.classList.add('ml-sidebar-dock-panel');
        this.element.classList.add('ml-is-docked');
        this.clearModalPlacementStyles();
        this.element.style.display = 'flex';

        if (this.element.parentNode !== container) {
            container.appendChild(this.element);
        }
    }

    dockToSidebar() {
        if (this.docked) return;

        this.rememberSidebarOpenMode('docked');
        this.pendingDockToSidebar = true;

        if (this.isUsableDockContainer(this.lastDockContainer)) {
            this.dockTo(this.lastDockContainer);
            return;
        }

        this.tryOpenComfySidebarState();

        requestAnimationFrame(() => {
            if (!this.pendingDockToSidebar || this.docked) return;

            const button = document.querySelector(`.${this.sidebarTabId}-tab-button`);
            if (button instanceof HTMLElement) {
                const isActive = button.matches([
                    '[aria-pressed="true"]',
                    '[aria-selected="true"]',
                    '[data-active="true"]',
                    '[data-selected="true"]',
                    '.active',
                    '.is-active',
                    '.selected',
                    '.p-highlight'
                ].join(','));

                if (!isActive) {
                    button.click();
                }
            }
        });
    }

    isUsableDockContainer(container) {
        if (!(container instanceof HTMLElement) || !container.isConnected) return false;

        const style = getComputedStyle(container);
        if (style.display === 'none' || style.visibility === 'hidden') return false;

        const rect = container.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    trySetSidebarStateProperty(target, property, value) {
        try {
            if (!(property in target)) return false;
            return Reflect.set(target, property, value);
        } catch (error) {
            return false;
        }
    }

    tryOpenComfySidebarState() {
        const extensionManager = app.extensionManager;
        let opened = false;
        const candidates = [
            extensionManager?.sidebarTab,
            extensionManager?.sidebarTabs,
            extensionManager?.sidebar,
            extensionManager
        ].filter(Boolean);

        for (const candidate of candidates) {
            try {
                if (typeof candidate.openSidebar === 'function') {
                    candidate.openSidebar(this.sidebarTabId);
                    opened = true;
                }
                if (typeof candidate.openSidebarTab === 'function') {
                    candidate.openSidebarTab(this.sidebarTabId);
                    opened = true;
                }
                if (typeof candidate.setActiveSidebarTab === 'function') {
                    candidate.setActiveSidebarTab(this.sidebarTabId);
                    opened = true;
                }
                if (typeof candidate.setActiveSidebarTabId === 'function') {
                    candidate.setActiveSidebarTabId(this.sidebarTabId);
                    opened = true;
                }
                if (this.trySetSidebarStateProperty(candidate, 'activeSidebarTabId', this.sidebarTabId)) {
                    opened = true;
                }
            } catch (error) {
                // Sidebar internals differ between ComfyUI versions; unsupported state APIs are ignored.
            }
        }

        return opened;
    }

    undockToFloating({ persist = true, closeSidebar = true } = {}) {
        if (!this.element) return;

        const wasDocked = this.docked;
        const dockContainer = this.dockContainer;
        this.docked = false;
        this.dockContainer = null;
        this.element.classList.remove('ml-is-docked');
        this.clearModalPlacementStyles();

        if (this.element.parentNode !== document.body) {
            document.body.appendChild(this.element);
        }

        this.element.style.display = 'flex';
        this.restoreFloatingGeometry();
        this.ensureModalHandleInViewport({ persist });

        if (wasDocked && closeSidebar) {
            this.closeComfySidebar(dockContainer);
        }
    }

    closeComfySidebar(dockContainer = null) {
        const closedByState = this.tryCloseComfySidebarState();

        requestAnimationFrame(() => {
            if (dockContainer && !dockContainer.isConnected) return;

            const button = document.querySelector(`.${this.sidebarTabId}-tab-button`);
            if (!(button instanceof HTMLElement)) return;

            const isActive = button.matches([
                '[aria-pressed="true"]',
                '[aria-selected="true"]',
                '[data-active="true"]',
                '[data-selected="true"]',
                '.active',
                '.is-active',
                '.selected',
                '.p-highlight'
            ].join(','));

            if (!closedByState || isActive) {
                button.click();
            }
        });
    }

    tryCloseComfySidebarState() {
        const extensionManager = app.extensionManager;
        let closed = false;
        const candidates = [
            extensionManager?.sidebarTab,
            extensionManager?.sidebarTabs,
            extensionManager?.sidebar,
            extensionManager
        ].filter(Boolean);

        for (const candidate of candidates) {
            try {
                if (typeof candidate.closeSidebar === 'function') {
                    candidate.closeSidebar();
                    closed = true;
                }
                if (typeof candidate.closeSidebarTab === 'function') {
                    candidate.closeSidebarTab(this.sidebarTabId);
                    closed = true;
                }
                if (typeof candidate.setActiveSidebarTab === 'function') {
                    candidate.setActiveSidebarTab(null);
                    closed = true;
                }
                if (typeof candidate.setActiveSidebarTabId === 'function') {
                    candidate.setActiveSidebarTabId(null);
                    closed = true;
                }
                if (
                    this.trySetSidebarStateProperty(candidate, 'activeSidebarTabId', null) ||
                    this.trySetSidebarStateProperty(candidate, 'activeSidebarTab', null)
                ) {
                    closed = true;
                }
            } catch (error) {
                // Sidebar internals differ between ComfyUI versions; unsupported state APIs are ignored.
            }
        }

        return closed;
    }
    
    // Toggle full screen mode for the dialog
    toggleFullScreen() {
        this.setFullScreen(!this.fullscreen);
    }

    setFullScreen(enable) {
        if (enable && this.docked) {
            this.undockToFloating({ persist: false });
        }

        this.fullscreen = !!enable;
        const el = this.element;
        if (!el) return;
        const btn = document.getElementById('model-linker-fullscreen-toggle');
        if (enable) {
            // Save current size
            try {
                const rect = el.getBoundingClientRect();
                localStorage.setItem('model_linker_modal_size_before_fs', JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) }));
            } catch (e) {}
            el.style.top = '0';
            el.style.left = '0';
            el.style.transform = 'none';
            el.style.width = '100vw';
            el.style.height = '100vh';
            el.style.maxWidth = '100vw';
            el.style.maxHeight = '100vh';
            el.style.borderRadius = '0';
            el.style.resize = 'none';
            if (btn) {
                btn.innerHTML = getSvgIcon('windowRestore', 'currentColor', 'ml-window-btn-icon');
                btn.setAttribute('aria-label', 'Exit full screen');
                this.setTooltip(btn, 'Exit full screen');
            }
            try { localStorage.setItem('model_linker_modal_fullscreen', '1'); } catch (e) {}
        } else {
            // Restore centered sizing
            el.style.maxWidth = '100vw';
            el.style.maxHeight = '100vh';
            el.style.borderRadius = '8px';
            el.style.resize = 'both';
            // Restore saved pre-FS size if available
            let wh = null;
            try { wh = JSON.parse(localStorage.getItem('model_linker_modal_size_before_fs') || 'null'); } catch (e) {}
            if (wh && wh.w && wh.h) {
                el.style.width = `${wh.w}px`;
                el.style.height = `${wh.h}px`;
            } else {
                el.style.width = '1100px';
                el.style.height = '700px';
            }
            // Restore last known position if available, else center
            try {
                const pos = JSON.parse(localStorage.getItem('model_linker_modal_pos') || 'null');
                if (pos && Number.isFinite(pos.top) && Number.isFinite(pos.left)) {
                    el.style.top = `${pos.top}px`;
                    el.style.left = `${pos.left}px`;
                    el.style.transform = 'none';
                } else {
                    el.style.top = '50%';
                    el.style.left = '50%';
                    el.style.transform = 'translate(-50%, -50%)';
                }
            } catch (e) {
                el.style.top = '50%';
                el.style.left = '50%';
                el.style.transform = 'translate(-50%, -50%)';
            }
            if (btn) {
                btn.innerHTML = getSvgIcon('windowMaximize', 'currentColor', 'ml-window-btn-icon');
                btn.setAttribute('aria-label', 'Enter full screen');
                this.setTooltip(btn, 'Enter full screen');
            }
            this.ensureModalHandleInViewport({ persist: true });
            try { localStorage.setItem('model_linker_modal_fullscreen', '0'); } catch (e) {}
        }
    }

    getViewportClampedModalPosition(top, left) {
        const el = this.element;
        if (!el) return { top, left };

        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const pad = 4;
        const handle = document.getElementById('model-linker-drag-handle');

        if (handle) {
            const elRect = el.getBoundingClientRect();
            const handleRect = handle.getBoundingClientRect();
            const handleOffsetLeft = handleRect.left - elRect.left;
            const handleOffsetTop = handleRect.top - elRect.top;
            const handleWidth = handleRect.width || handle.offsetWidth;
            const handleHeight = handleRect.height || handle.offsetHeight;
            const minLeft = pad - handleOffsetLeft;
            const maxLeft = vw - pad - handleOffsetLeft - handleWidth;
            const minTop = pad - handleOffsetTop;
            const maxTop = vh - pad - handleOffsetTop - handleHeight;

            left = Math.max(minLeft, Math.min(maxLeft, left));
            top = Math.max(minTop, Math.min(maxTop, top));
        } else {
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            left = Math.max(-w + pad, Math.min(vw - pad, left));
            top = Math.max(-h + pad, Math.min(vh - pad, top));
        }

        return { top, left };
    }

    saveModalPosition() {
        if (this.docked) return;

        try {
            const el = this.element;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            localStorage.setItem('model_linker_modal_pos', JSON.stringify({ top: Math.round(rect.top), left: Math.round(rect.left) }));
        } catch (e) { /* ignore */ }
    }

    ensureModalHandleInViewport({ persist = false } = {}) {
        if (this.docked) return;
        if (this.fullscreen) return;
        const el = this.element;
        if (!el || getComputedStyle(el).display === 'none') return;

        const rect = el.getBoundingClientRect();
        const { top, left } = this.getViewportClampedModalPosition(rect.top, rect.left);
        const nextTop = Math.round(top);
        const nextLeft = Math.round(left);

        if (Math.round(rect.top) === nextTop && Math.round(rect.left) === nextLeft) return;

        el.style.top = `${nextTop}px`;
        el.style.left = `${nextLeft}px`;
        el.style.transform = 'none';

        if (persist) this.saveModalPosition();
    }

    scheduleModalViewportClamp(persist = false) {
        if (this._viewportClampFrame) {
            cancelAnimationFrame(this._viewportClampFrame);
        }

        this._viewportClampFrame = requestAnimationFrame(() => {
            this._viewportClampFrame = null;
            this.ensureModalHandleInViewport({ persist });
        });
    }

    // Begin window drag
    startDrag(e) {
        if (this.docked) return;

        try {
            const el = this.element;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            // Switch to absolute top/left (no transform) before dragging
            el.style.top = `${rect.top}px`;
            el.style.left = `${rect.left}px`;
            el.style.transform = 'none';
            this._dragging = true;
            this._dragStart = {
                x: e.clientX,
                y: e.clientY,
                top: rect.top,
                left: rect.left
            };
            // Prevent text selection while dragging
            this._prevUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            // Attach listeners
            this._onMouseMove = (ev) => this.onDrag(ev);
            this._onMouseUp = () => this.endDrag();
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('mouseup', this._onMouseUp, { once: true });
        } catch (err) { /* ignore */ }
    }

    onDrag(e) {
        if (!this._dragging || !this._dragStart) return;
        const el = this.element;
        if (!el) return;
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        let top = this._dragStart.top + dy;
        let left = this._dragStart.left + dx;
        ({ top, left } = this.getViewportClampedModalPosition(top, left));
        el.style.top = `${Math.round(top)}px`;
        el.style.left = `${Math.round(left)}px`;
    }

    endDrag() {
        if (!this._dragging) return;
        this._dragging = false;
        document.removeEventListener('mousemove', this._onMouseMove);
        // Persist position
        this.saveModalPosition();
        // Restore selection
        try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) {}
    }

    /**
     * Simple debounce helper
     */
    debounce(callback, wait = 250) {
        let t = null;
        return (...args) => {
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                callback.apply(this, args);
            }, wait);
        };
    }

    /**
     * Ensure all models are loaded for the dropdown.
     */
    async ensureAllModelsLoaded() {
        if (this.allModels && this.allModels.length) return;
        try {
            const resp = await api.fetchApi('/model_linker/models');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const models = await resp.json();
            const list = Array.isArray(models) ? models : [];
            // Build labels and sort alphabetically
            this.allModels = list.map((m) => ({
                ...m,
                __label: `${m.category ? m.category + ': ' : ''}${m.relative_path || m.filename || ''}`
            })).sort((a, b) => (a.__label || '').localeCompare(b.__label || ''));
        } catch (e) {
            console.warn('Model Linker: could not load all models', e);
            this.allModels = [];
        }
    }

    async ensureDownloadDirectoriesLoaded() {
        if (this.downloadDirectories) return;
        try {
            const resp = await api.fetchApi('/model_linker/directories');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const directories = await resp.json();
            this.downloadDirectories = directories && typeof directories === 'object' ? directories : {};
        } catch (e) {
            console.warn('Model Linker: could not load download directories', e);
            this.downloadDirectories = {};
        }
    }

    async ensureCapabilitiesLoaded() {
        if (this.capabilities) return;
        try {
            const resp = await api.fetchApi('/model_linker/capabilities');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.capabilities = data && typeof data === 'object' ? data : { sources: {} };
        } catch (e) {
            console.warn('Model Linker: could not load capabilities', e);
            this.capabilities = { sources: {} };
        }
    }

    isSourceAvailable(source) {
        if (!source || ['all', 'local', 'huggingface', 'civitai'].includes(source)) {
            return true;
        }
        return Boolean(this.capabilities?.sources?.[source]);
    }

    getCategoryDisplayName(category = '') {
        const displayNames = {
            'checkpoints': 'checkpoint',
            'loras': 'lora',
            'vae': 'vae',
            'controlnet': 'controlnet',
            'embeddings': 'embedding',
            'upscale_models': 'upscale_model',
            'latent_upscale_models': 'latent_upscale_model',
            'diffusion_models': 'unet',
            'text_encoders': 'text encoders',
            'clip': 'clip',
            'clip_vision': 'clip_vision',
            'hypernetworks': 'hypernetwork'
        };
        return displayNames[category] || category || 'unknown';
    }

    getModelTypeColorClass(value = '') {
        const token = String(value || '')
            .trim()
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .toLowerCase()
            .replace(/[\s./\\-]+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        const colorNames = {
            checkpoints: 'model',
            checkpoint: 'model',
            ckpt: 'model',
            model: 'model',
            diffusion_models: 'model',
            diffusion_model: 'model',
            unet: 'model',
            loras: 'lora',
            lora: 'lora',
            locon: 'lora',
            lycoris: 'lora',
            dora: 'lora',
            hypernetworks: 'lora',
            hypernetwork: 'lora',
            style_models: 'style-model',
            style_model: 'style-model',
            vae: 'vae',
            vaes: 'vae',
            vae_approx: 'taesd',
            taesd: 'taesd',
            controlnet: 'controlnet',
            control_net: 'controlnet',
            controlnets: 'controlnet',
            control_nets: 'controlnet',
            t2i_adapter: 'controlnet',
            t2i_adapters: 'controlnet',
            embeddings: 'conditioning',
            embedding: 'conditioning',
            textualinversion: 'conditioning',
            textual_inversion: 'conditioning',
            aesthetic_gradient: 'conditioning',
            text_encoders: 'clip',
            text_encoder: 'clip',
            clip: 'clip',
            clips: 'clip',
            clip_vision: 'clip-vision',
            clipvision: 'clip-vision',
            clip_vision_output: 'clip-vision-output',
            upscale_models: 'image',
            upscale_model: 'image',
            upscaler: 'image',
            upscalers: 'image',
            latent_upscale_models: 'latent',
            latent_upscale_model: 'latent',
            latent: 'latent',
            image: 'image',
            images: 'image',
            mask: 'mask',
            masks: 'mask',
            noise: 'noise',
            sampler: 'sampler',
            samplers: 'sampler',
            sigmas: 'sigmas',
            guider: 'guider',
            guiders: 'guider'
        };
        return `ml-type-chip ml-type-chip--${colorNames[token] || 'generic'}`;
    }

    getCategoryTokenName(category = '') {
        const tokenNames = {
            'checkpoints': 'checkpoint',
            'loras': 'lora',
            'vae': 'vae',
            'controlnet': 'controlnet',
            'embeddings': 'embedding',
            'upscale_models': 'upscale_model',
            'latent_upscale_models': 'latent_upscale_model',
            'diffusion_models': 'unet',
            'text_encoders': 'text_encoders',
            'clip': 'clip',
            'clip_vision': 'clip_vision',
            'hypernetworks': 'hypernetwork'
        };
        return tokenNames[category] || category || 'unknown';
    }

    getDownloadCategoryOptions(defaultCategory = 'checkpoints') {
        const directories = this.downloadDirectories || {};
        const keys = Object.keys(directories);
        const preferred = defaultCategory || 'checkpoints';
        const ordered = [
            preferred,
            ...keys.filter(key => key !== preferred)
        ].filter((value, index, arr) => value && arr.indexOf(value) === index);

        return ordered.length > 0 ? ordered : [preferred];
    }

    getSearchSourceOptions() {
        const sources = ['all', 'local', 'huggingface', 'civitai'];
        if (this.isSourceAvailable('lora_manager_archive')) {
            sources.push('lora_manager_archive');
        }
        return sources.map(source => ({
            value: source,
            label: this.getSearchSourceLabel(source)
        }));
    }

    getAvailableSubfolders(category = '') {
        return this.downloadSubfolders.get((category || '').toLowerCase()) || [];
    }

    normalizeFolderToken(value = '') {
        return String(value || '')
            .toLowerCase()
            .replace(/[\/\\]+/g, ' ')
            .replace(/[^a-z0-9]+/g, '');
    }

    getSuggestedCivitaiSubfolder(missing, category, folders = []) {
        if ((category || '').toLowerCase() !== 'loras' || !folders.length) {
            return '';
        }

        const civitaiData = {
            ...(missing?.civitai_info || {}),
            ...(missing?.civitai_search_result || {}),
            ...(missing?.download_source || {})
        };
        const baseModel = civitaiData.base_model || '';
        const tags = Array.isArray(civitaiData.tags) ? civitaiData.tags.filter(Boolean) : [];
        if (!baseModel) return '';

        const priorityTags = [
            'concept',
            'style',
            'character',
            'clothing',
            'pose',
            'object',
            'vehicle',
            'artist',
            'celebrity'
        ];
        const normalizedBase = this.normalizeFolderToken(baseModel);
        if (!normalizedBase) return '';

        const folderEntries = folders.map(folder => {
            const segments = String(folder || '').split(/[\/\\]/).filter(Boolean);
            return {
                value: folder,
                segments,
                normalizedSegments: segments.map(segment => this.normalizeFolderToken(segment))
            };
        });

        const baseMatches = folderEntries.filter(entry => entry.normalizedSegments[0] === normalizedBase);
        if (!baseMatches.length) return '';

        const exactBase = baseMatches.find(entry => entry.segments.length === 1);
        const orderedTags = [
            ...priorityTags.filter(tag => tags.some(value => this.normalizeFolderToken(value) === this.normalizeFolderToken(tag))),
            ...tags
        ].filter((value, index, arr) => value && arr.findIndex(other => this.normalizeFolderToken(other) === this.normalizeFolderToken(value)) === index);

        for (const tag of orderedTags) {
            const normalizedTag = this.normalizeFolderToken(tag);
            if (!normalizedTag) continue;
            const match = baseMatches.find(entry => entry.normalizedSegments[1] === normalizedTag);
            if (match) {
                return match.value;
            }
        }

        return exactBase?.value || '';
    }

    async applySuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl) {
        if (!categoryEl || !subfolderEl || subfolderEl.value.trim()) return;

        const category = this.getDropdownValue(categoryEl);
        await this.ensureDownloadSubfoldersLoaded(category);
        const folders = this.getAvailableSubfolders(category);
        const suggestion = this.getSuggestedCivitaiSubfolder(missing, category, folders);
        if (suggestion) {
            subfolderEl.value = suggestion;
        }
    }

    applySearchResultSuggestion(missing) {
        const categoryEl = this.contentElement?.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = this.contentElement?.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        if (!categoryEl || !subfolderEl) return;
        this.applySuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl);
    }

    async ensureDownloadSubfoldersLoaded(category = '') {
        const key = (category || '').trim().toLowerCase();
        if (!key) return [];
        if (key === 'unknown') {
            this.downloadSubfolders.set(key, []);
            return [];
        }
        if (this.downloadSubfolders.has(key)) {
            return this.downloadSubfolders.get(key) || [];
        }

        try {
            const resp = await api.fetchApi(`/model_linker/subfolders/${encodeURIComponent(key)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const subfolders = await resp.json();
            const list = Array.isArray(subfolders) ? subfolders : [];
            this.downloadSubfolders.set(key, list);
            return list;
        } catch (e) {
            console.warn(`Model Linker: could not load subfolders for ${key}`, e);
            this.downloadSubfolders.set(key, []);
            return [];
        }
    }

    renderDownloadTargetControls(missing, defaultCategory = 'checkpoints') {
        const selectId = `download-category-${missing.node_id}-${missing.widget_index}`;
        const subfolderId = `download-subfolder-${missing.node_id}-${missing.widget_index}`;
        const categoryListId = `download-category-list-${missing.node_id}-${missing.widget_index}`;
        const subfolderListId = `download-subfolder-list-${missing.node_id}-${missing.widget_index}`;
        const selectedCategory = defaultCategory || 'checkpoints';

        let html = `<div class="ml-download-target">`;
        html += `<div class="ml-download-target-grid">`;
        html += `<label class="ml-download-target-label" for="${selectId}">Folder</label>`;
        html += `<label class="ml-download-target-label" for="${subfolderId}">Subfolder (optional)</label>`;
        html += `<div class="ml-download-target-wrap">`;
        html += `<input id="${selectId}" class="ml-download-target-input ml-download-target-select" type="text" readonly autocomplete="off" data-value="${this.escapeHtml(selectedCategory)}" value="${this.escapeHtml(this.getCategoryDisplayName(selectedCategory))}">`;
        html += `<div id="${categoryListId}" class="ml-download-target-list"></div>`;
        html += `</div>`;
        html += `<div class="ml-download-target-wrap">`;
        html += `<input id="${subfolderId}" class="ml-download-target-input" type="text" placeholder="e.g. ponyxl\\styles" autocomplete="off">`;
        html += `<div id="${subfolderListId}" class="ml-download-target-list"></div>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    }

    getDownloadTargetSelection(missing, fallbackCategory = 'checkpoints') {
        const categoryEl = this.contentElement?.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = this.contentElement?.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        return {
            category: this.getDropdownValue(categoryEl) || fallbackCategory || 'checkpoints',
            subfolder: (subfolderEl?.value || '').trim()
        };
    }

    enableWheelScrollChaining(scrollEl) {
        if (!scrollEl || scrollEl.dataset.mlWheelChainBound === 'true') return;
        scrollEl.dataset.mlWheelChainBound = 'true';

        scrollEl.addEventListener('wheel', (event) => {
            const deltaY = event.deltaY;
            if (!deltaY) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
            if (maxScrollTop <= 0) {
                return;
            }

            const nextScrollTop = Math.min(
                maxScrollTop,
                Math.max(0, scrollEl.scrollTop + deltaY)
            );

            scrollEl.scrollTop = nextScrollTop;
        }, { passive: false });
    }

    wireDownloadTargetAutocomplete(container, missing) {
        const categoryEl = container.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = container.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        const categoryListEl = container.querySelector(`#download-category-list-${missing.node_id}-${missing.widget_index}`);
        const listEl = container.querySelector(`#download-subfolder-list-${missing.node_id}-${missing.widget_index}`);
        if (!categoryEl || !subfolderEl || !listEl) return;

        this.enableWheelScrollChaining(listEl);
        if (categoryListEl) {
            this.enableWheelScrollChaining(categoryListEl);
        }

        const renderOptions = (targetEl, values, onSelect) => {
            const options = values.map(value => (
                typeof value === 'object'
                    ? value
                    : { value, label: value }
            ));
            if (!options.length) {
                targetEl.innerHTML = '';
                targetEl.style.display = 'none';
                return;
            }

            targetEl.innerHTML = options
                .slice(0, 50)
                .map(option => {
                    const value = String(option.value || '');
                    const label = String(option.label || value);
                    return `<div class="ml-download-target-option" data-value="${encodeURIComponent(value)}" data-label="${encodeURIComponent(label)}">${this.escapeHtml(label)}</div>`;
                })
                .join('');

            targetEl.style.display = 'block';

            targetEl.querySelectorAll('.ml-download-target-option').forEach(option => {
                option.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    const value = decodeURIComponent(option.dataset.value || '');
                    const label = decodeURIComponent(option.dataset.label || option.dataset.value || '');
                    onSelect(value, label);
                    targetEl.style.display = 'none';
                });
            });
        };

        const populateCategoryOptions = () => {
            if (!categoryListEl) return;
            const options = this.getDownloadCategoryOptions(this.getDropdownValue(categoryEl) || 'checkpoints')
                .map(category => ({
                    value: category,
                    label: this.getCategoryDisplayName(category)
                }));
            renderOptions(categoryListEl, options, (value, label) => {
                this.setDropdownValue(categoryEl, value, label);
                subfolderEl.value = '';
                listEl.innerHTML = '';
                listEl.style.display = 'none';
                this.applySuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl);
            });
        };

        const populateSubfolderOptions = async (filterText = '') => {
            const filter = (filterText || '').toLowerCase();
            const category = this.getDropdownValue(categoryEl);
            await this.ensureDownloadSubfoldersLoaded(category);
            const folders = this.getAvailableSubfolders(category);
            const filtered = filter
                ? folders.filter(folder => folder.toLowerCase().includes(filter))
                : folders;

            renderOptions(listEl, filtered, (value) => {
                subfolderEl.value = value;
            });
        };

        const hideList = (targetEl) => {
            setTimeout(() => {
                targetEl.style.display = 'none';
            }, 150);
        };

        if (categoryListEl && categoryEl.dataset.mlCategoryBound !== 'true') {
            categoryEl.dataset.mlCategoryBound = 'true';
            categoryEl.addEventListener('focus', () => populateCategoryOptions());
            categoryEl.addEventListener('click', () => populateCategoryOptions());
            categoryEl.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    populateCategoryOptions();
                }
            });
            categoryEl.addEventListener('blur', () => hideList(categoryListEl));
        }

        subfolderEl.addEventListener('focus', () => {
            populateSubfolderOptions(subfolderEl.value);
        });

        subfolderEl.addEventListener('input', () => {
            populateSubfolderOptions(subfolderEl.value);
        });

        subfolderEl.addEventListener('blur', () => hideList(listEl));
        this.applySuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl);
    }

    getStoredTokens() {
        const civitaiCandidateLimitRaw = parseInt(localStorage.getItem('modelLinker.civitaiCandidateLimit') || '5', 10);
        const civitai_candidate_limit = Number.isFinite(civitaiCandidateLimitRaw)
            ? Math.min(20, Math.max(1, civitaiCandidateLimitRaw))
            : 5;

        return {
            civitai_key: localStorage.getItem('modelLinker.civitaiApiKey') || '',
            civitai_session_token: localStorage.getItem('modelLinker.civitaiSessionToken') || '',
            hf_token: localStorage.getItem('modelLinker.huggingFaceToken') || '',
            brave_search_api_key: localStorage.getItem('modelLinker.braveSearchApiKey') || '',
            civitai_use_trpc_search: localStorage.getItem('modelLinker.civitaiUseTrpcSearch') !== 'false',
            civitai_use_html_fallback: localStorage.getItem('modelLinker.civitaiUseHtmlFallback') !== 'false',
            hf_use_api_search: localStorage.getItem('modelLinker.hfUseApiSearch') !== 'false',
            hf_use_comfy_org_fallback: localStorage.getItem('modelLinker.hfUseComfyOrgFallback') !== 'false',
            hf_use_brave_fallback: localStorage.getItem('modelLinker.hfUseBraveFallback') !== 'false',
            civitai_candidate_limit
        };
    }

    async clearSearchCaches() {
        this.searchResultCache.clear();
        try {
            const response = await api.fetchApi('/model_linker/clear-search-cache', {
                method: 'POST'
            });
            if (!response.ok) {
                throw new Error('Failed to clear backend search cache');
            }
        } catch (error) {
            console.error('Model Linker: Clear search cache error:', error);
        }
    }

    displayOptions() {
        if (!this.contentElement) return;
        this.contentElement.style.overflowY = 'hidden';

        const tokens = this.getStoredTokens();
        this.contentElement.innerHTML = `
            <div class="ml-options-wrap">
                <div class="ml-options-shell">
                    <aside class="ml-options-sidebar">
                        <div class="ml-options-sidebar-group">
                            <h3 class="ml-options-sidebar-title">Settings</h3>
                        </div>
                        <div class="ml-options-sidebar-group">
                            <div class="ml-options-sidebar-label">Providers</div>
                            <div class="ml-options-nav">
                                <button type="button" class="ml-options-nav-btn is-active" data-target="ml-options-section-civitai">
                                    <span>CivitAI</span>
                                    <span class="ml-options-nav-meta">01</span>
                                </button>
                                <button type="button" class="ml-options-nav-btn" data-target="ml-options-section-hf">
                                    <span>HuggingFace</span>
                                    <span class="ml-options-nav-meta">02</span>
                                </button>
                            </div>
                        </div>
                        <div class="ml-options-actions">
                            <div id="ml-options-status" class="ml-options-status">Saved only on this machine.</div>
                            <button id="ml-options-save" class="ml-btn ml-btn-primary ml-footer-btn">Save</button>
                        </div>
                    </aside>
                    <div class="ml-options-main">
                        <section id="ml-options-section-civitai" class="ml-options-card ml-options-section">
                            <div class="ml-options-section-head">
                                <h4 class="ml-options-section-title">CivitAI</h4>
                            </div>
                            <div class="ml-options-grid">
                                <div class="ml-options-panel">
                                    <div class="ml-options-stack">
                                        <div class="ml-options-field">
                                            <div class="ml-options-input-row">
                                                <label for="ml-options-civitai" class="ml-options-label">CivitAI API Key <a href="https://civitai.com/user/account" target="_blank" rel="noopener noreferrer" class="ml-options-inline-link">Get key</a> <span class="ml-tooltip-badge" data-tooltip="Optional. Used when downloading from CivitAI requires your account. Add this if CivitAI downloads fail or need access to models available to your account.">?</span></label>
                                                <input id="ml-options-civitai" class="ml-options-input" type="password" placeholder="Paste CivitAI API key" value="${tokens.civitai_key}">
                                                <button id="ml-options-civitai-toggle" type="button" class="ml-options-visibility-btn" aria-label="Toggle visibility for saved CivitAI API key" data-tooltip="Show saved value">
                                                    ${getSvgIcon('eye')}
                                                </button>
                                            </div>
                                        </div>
                                        <div class="ml-options-field">
                                            <div class="ml-options-input-row">
                                                <label for="ml-options-civitai-session" class="ml-options-label">CivitAI Session Token <span class="ml-tooltip-badge" data-tooltip="Optional. Makes CivitAI search use your logged-in session, so results can match what you see in the browser. Useful for NSFW or account-visible results.">?</span></label>
                                                <input id="ml-options-civitai-session" class="ml-options-input" type="password" placeholder="Paste __Secure-civitai-token" value="${tokens.civitai_session_token}">
                                                <button id="ml-options-civitai-session-toggle" type="button" class="ml-options-visibility-btn" aria-label="Toggle visibility for saved CivitAI session token" data-tooltip="Show saved value">
                                                    ${getSvgIcon('eye')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="ml-options-panel">
                                    <div class="ml-options-toggle-list">
                                        <label class="ml-options-toggle-row">
                                            <div class="ml-options-toggle-copy">
                                                <span class="ml-options-toggle-title">Use CivitAI tRPC search <span class="ml-tooltip-badge" data-tooltip="Main CivitAI search method. Keep this enabled unless CivitAI search stops working.">?</span></span>
                                            </div>
                                            <span class="ml-options-toggle-control">
                                                <input id="ml-options-civitai-use-trpc-search" class="ml-options-switch-input" type="checkbox" ${tokens.civitai_use_trpc_search ? 'checked' : ''}>
                                                <span class="ml-options-switch"></span>
                                            </span>
                                        </label>
                                        <label class="ml-options-toggle-row">
                                            <div class="ml-options-toggle-copy">
                                                <span class="ml-options-toggle-title">Use CivitAI HTML fallback <span class="ml-tooltip-badge" data-tooltip="Backup CivitAI search. Leave this enabled to try the regular CivitAI page when the main search does not find enough results.">?</span></span>
                                            </div>
                                            <span class="ml-options-toggle-control">
                                                <input id="ml-options-civitai-use-html-fallback" class="ml-options-switch-input" type="checkbox" ${tokens.civitai_use_html_fallback ? 'checked' : ''}>
                                                <span class="ml-options-switch"></span>
                                            </span>
                                        </label>
                                        <div class="ml-options-number-row">
                                            <div class="ml-options-number-copy">
                                                <span class="ml-options-label">CivitAI Models To Inspect <span class="ml-tooltip-badge" data-tooltip="How many CivitAI results to check for the exact file. Higher values may find more matches, but searches can take longer. Range: 1-20.">?</span></span>
                                            </div>
                                            <input id="ml-options-civitai-limit" class="ml-options-input" type="number" min="1" max="20" step="1" value="${tokens.civitai_candidate_limit}">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section id="ml-options-section-hf" class="ml-options-card ml-options-section">
                            <div class="ml-options-section-head">
                                <h4 class="ml-options-section-title">HuggingFace</h4>
                            </div>
                            <div class="ml-options-grid">
                                <div class="ml-options-panel">
                                    <div class="ml-options-stack">
                                        <div class="ml-options-field">
                                            <div class="ml-options-input-row">
                                                <label for="ml-options-hf" class="ml-options-label">HuggingFace Token <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" class="ml-options-inline-link">Get key</a> <span class="ml-tooltip-badge" data-tooltip="Optional. Used to search and download files from Hugging Face repos your account can access, including gated repos. A read-only token is enough.">?</span></label>
                                                <input id="ml-options-hf" class="ml-options-input" type="password" placeholder="Paste HuggingFace token" value="${tokens.hf_token}">
                                                <button id="ml-options-hf-toggle" type="button" class="ml-options-visibility-btn" aria-label="Toggle visibility for saved HuggingFace token" data-tooltip="Show saved value">
                                                    ${getSvgIcon('eye')}
                                                </button>
                                            </div>
                                        </div>
                                        <div class="ml-options-field">
                                            <div class="ml-options-input-row">
                                                <label for="ml-options-brave" class="ml-options-label">Brave Search API Key <a href="https://api-dashboard.search.brave.com/app/keys" target="_blank" rel="noopener noreferrer" class="ml-options-inline-link">Get key</a> <span class="ml-tooltip-badge" data-tooltip="Optional. Used only by the Brave fallback. It helps find Hugging Face files when Hugging Face search does not show the right repo.">?</span></label>
                                                <input id="ml-options-brave" class="ml-options-input" type="password" placeholder="Paste Brave Search API key" value="${tokens.brave_search_api_key}">
                                                <button id="ml-options-brave-toggle" type="button" class="ml-options-visibility-btn" aria-label="Toggle visibility for saved Brave Search API key" data-tooltip="Show saved value">
                                                    ${getSvgIcon('eye')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="ml-options-panel">
                                    <div class="ml-options-toggle-list">
                                        <label class="ml-options-toggle-row">
                                            <div class="ml-options-toggle-copy">
                                                <span class="ml-options-toggle-title">Use HuggingFace API repo search <span class="ml-tooltip-badge" data-tooltip="Main Hugging Face search method. It searches by filename, then checks matching repos for the actual file.">?</span></span>
                                            </div>
                                            <span class="ml-options-toggle-control">
                                                <input id="ml-options-hf-use-api-search" class="ml-options-switch-input" type="checkbox" ${tokens.hf_use_api_search ? 'checked' : ''}>
                                                <span class="ml-options-switch"></span>
                                            </span>
                                        </label>
                                        <label class="ml-options-toggle-row">
                                            <div class="ml-options-toggle-copy">
                                                <span class="ml-options-toggle-title">Use Comfy-Org fallback <span class="ml-tooltip-badge" data-tooltip="Checks Comfy-Org repositories directly. Useful for ComfyUI model packs that normal Hugging Face search may miss.">?</span></span>
                                            </div>
                                            <span class="ml-options-toggle-control">
                                                <input id="ml-options-hf-use-comfy-org-fallback" class="ml-options-switch-input" type="checkbox" ${tokens.hf_use_comfy_org_fallback ? 'checked' : ''}>
                                                <span class="ml-options-switch"></span>
                                            </span>
                                        </label>
                                        <label class="ml-options-toggle-row">
                                            <div class="ml-options-toggle-copy">
                                                <span class="ml-options-toggle-title">Use Brave fallback <span class="ml-tooltip-badge" data-tooltip="Last-resort web search for the exact filename on huggingface.co. Results are still checked before Model Linker offers them.">?</span></span>
                                            </div>
                                            <span class="ml-options-toggle-control">
                                                <input id="ml-options-hf-use-brave-fallback" class="ml-options-switch-input" type="checkbox" ${tokens.hf_use_brave_fallback ? 'checked' : ''}>
                                                <span class="ml-options-switch"></span>
                                            </span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        `;

        const civitaiInput = this.contentElement.querySelector('#ml-options-civitai');
        const civitaiSessionInput = this.contentElement.querySelector('#ml-options-civitai-session');
        const hfInput = this.contentElement.querySelector('#ml-options-hf');
        const braveInput = this.contentElement.querySelector('#ml-options-brave');
        const civitaiToggle = this.contentElement.querySelector('#ml-options-civitai-toggle');
        const civitaiSessionToggle = this.contentElement.querySelector('#ml-options-civitai-session-toggle');
        const hfToggle = this.contentElement.querySelector('#ml-options-hf-toggle');
        const braveToggle = this.contentElement.querySelector('#ml-options-brave-toggle');
        const civitaiLimitInput = this.contentElement.querySelector('#ml-options-civitai-limit');
        const civitaiUseTrpcSearchInput = this.contentElement.querySelector('#ml-options-civitai-use-trpc-search');
        const civitaiUseHtmlFallbackInput = this.contentElement.querySelector('#ml-options-civitai-use-html-fallback');
        const hfUseApiSearchInput = this.contentElement.querySelector('#ml-options-hf-use-api-search');
        const hfUseComfyOrgFallbackInput = this.contentElement.querySelector('#ml-options-hf-use-comfy-org-fallback');
        const hfUseBraveFallbackInput = this.contentElement.querySelector('#ml-options-hf-use-brave-fallback');
        const status = this.contentElement.querySelector('#ml-options-status');
        const saveBtn = this.contentElement.querySelector('#ml-options-save');
        const navButtons = Array.from(this.contentElement.querySelectorAll('.ml-options-nav-btn'));
        const optionSections = Array.from(this.contentElement.querySelectorAll('.ml-options-section'));
        const trackedInputs = [
            civitaiInput,
            civitaiSessionInput,
            hfInput,
            braveInput,
            civitaiLimitInput,
            civitaiUseTrpcSearchInput,
            civitaiUseHtmlFallbackInput,
            hfUseApiSearchInput,
            hfUseComfyOrgFallbackInput,
            hfUseBraveFallbackInput,
        ].filter(Boolean);

        const setStatus = (text, mode = '') => {
            if (!status) return;
            status.textContent = text;
            status.classList.remove('is-dirty', 'is-saved');
            if (mode) status.classList.add(mode);
        };

        const setActiveNav = (targetId) => {
            navButtons.forEach((btn) => {
                btn.classList.toggle('is-active', btn.dataset.target === targetId);
            });
        };

        const setVisibleSection = (targetId) => {
            optionSections.forEach((section) => {
                section.classList.toggle('is-hidden', section.id !== targetId);
            });
            setActiveNav(targetId);
        };

        const getVisibilityIcon = (visible) => visible
            ? getSvgIcon('eye')
            : getSvgIcon('eyeOff');

        const syncVisibilityToggle = (input, button) => {
            if (!input || !button) return;
            const visible = input.type === 'text';
            button.innerHTML = getVisibilityIcon(visible);
            button.classList.toggle('ml-is-active-text', visible);
            button.classList.toggle('ml-is-muted', !visible);
            button.setAttribute('aria-pressed', visible ? 'true' : 'false');
            this.setTooltip(button, visible ? 'Hide saved value' : 'Show saved value');
        };

        const bindVisibilityToggle = (input, button) => {
            if (!input || !button) return;
            syncVisibilityToggle(input, button);
            button.addEventListener('click', () => {
                input.type = input.type === 'password' ? 'text' : 'password';
                syncVisibilityToggle(input, button);
            });
        };

        bindVisibilityToggle(civitaiInput, civitaiToggle);
        bindVisibilityToggle(civitaiSessionInput, civitaiSessionToggle);
        bindVisibilityToggle(hfInput, hfToggle);
        bindVisibilityToggle(braveInput, braveToggle);
        setStatus('Saved only on this machine.');
        setVisibleSection('ml-options-section-civitai');

        trackedInputs.forEach((input) => {
            const eventName = input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(eventName, () => {
                setStatus('You have unsaved changes.', 'is-dirty');
            });
        });

        this.bindTooltips(this.contentElement);

        navButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.target;
                if (!targetId) return;
                setVisibleSection(targetId);
            });
        });

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const civitaiCandidateLimitRaw = parseInt(civitaiLimitInput?.value || `${tokens.civitai_candidate_limit}`, 10);
                const civitaiCandidateLimit = Number.isFinite(civitaiCandidateLimitRaw)
                    ? Math.min(20, Math.max(1, civitaiCandidateLimitRaw))
                    : 5;
                localStorage.setItem('modelLinker.civitaiApiKey', civitaiInput?.value || '');
                localStorage.setItem('modelLinker.civitaiSessionToken', civitaiSessionInput?.value || '');
                localStorage.setItem('modelLinker.civitaiUseTrpcSearch', civitaiUseTrpcSearchInput?.checked ? 'true' : 'false');
                localStorage.setItem('modelLinker.civitaiUseHtmlFallback', civitaiUseHtmlFallbackInput?.checked ? 'true' : 'false');
                localStorage.setItem('modelLinker.huggingFaceToken', hfInput?.value || '');
                localStorage.setItem('modelLinker.braveSearchApiKey', braveInput?.value || '');
                localStorage.setItem('modelLinker.hfUseApiSearch', hfUseApiSearchInput?.checked ? 'true' : 'false');
                localStorage.setItem('modelLinker.hfUseComfyOrgFallback', hfUseComfyOrgFallbackInput?.checked ? 'true' : 'false');
                localStorage.setItem('modelLinker.hfUseBraveFallback', hfUseBraveFallbackInput?.checked ? 'true' : 'false');
                localStorage.setItem('modelLinker.civitaiCandidateLimit', `${civitaiCandidateLimit}`);
                if (civitaiLimitInput) {
                    civitaiLimitInput.value = `${civitaiCandidateLimit}`;
                }
                await this.clearSearchCaches();
                setStatus('Options saved locally.', 'is-saved');
                this.showNotification('Options saved and search cache cleared', 'success');
            });
        }

    }

    getTabButton(tab) {
        return {
            missing: this.missingTab,
            loaded: this.loadedTab,
            options: this.optionsTab
        }[tab] || null;
    }

    updateTabButtonStates() {
        ['missing', 'loaded', 'options'].forEach((tab) => {
            const button = this.getTabButton(tab);
            if (!button) return;
            const isActive = tab === this.activeTab;
            button.classList.toggle('ml-tab-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            button.setAttribute('aria-disabled', isActive ? 'true' : 'false');
            if (isActive) {
                button.setAttribute('aria-current', 'page');
            } else {
                button.removeAttribute('aria-current');
            }
        });
    }

    switchTab(tab) {
        const nextTab = this.getValidTab(tab);
        const nextTabButton = this.getTabButton(nextTab);
        if (nextTab === this.activeTab && nextTabButton?.classList.contains('ml-tab-active')) {
            this.hideTooltip();
            return;
        }

        this.activeTab = nextTab;
        this.persistActiveTab(this.activeTab);
        this.hideTooltip();
        this.animateTabContentTransition();
        this.updateTabButtonStates();

        if (this.activeTab === 'missing') {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'auto';
            }
            this.downloadAllButton.style.display = 'inline-flex';
            this.autoResolveButton.style.display = 'inline-flex';
            this.applyPendingBtn.style.display = 'inline-flex';
            // Show queue panel
            if (this.queueElement && !this.queueCollapsed) {
                this.queueElement.style.display = '';
            }
            if (this.splitterElement) {
                this.splitterElement.style.display = '';
            }
            this.loadWorkflowData();
        } else if (this.activeTab === 'loaded') {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'auto';
            }
            this.downloadAllButton.style.display = 'none';
            this.autoResolveButton.style.display = 'none';
            this.applyPendingBtn.style.display = 'none';
            // Hide queue panel in loaded models tab
            if (this.queueElement) {
                this.queueElement.style.display = 'none';
            }
            if (this.splitterElement) {
                this.splitterElement.style.display = 'none';
            }
            this.loadLoadedModels();
        } else {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'hidden';
            }
            this.downloadAllButton.style.display = 'none';
            this.autoResolveButton.style.display = 'none';
            this.applyPendingBtn.style.display = 'none';
            if (this.queueElement) {
                this.queueElement.style.display = 'none';
            }
            if (this.splitterElement) {
                this.splitterElement.style.display = 'none';
            }
            this.displayOptions();
        }
    }

    async loadLoadedModels() {
        if (!this.contentElement) return;

        this.contentElement.innerHTML = '<p>Loading loaded models...</p>';

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.contentElement.innerHTML = '<p>No workflow loaded. Please load a workflow first.</p>';
                return;
            }

            const response = await api.fetchApi('/model_linker/loaded', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            this.displayLoadedModels(this.contentElement, data);

        } catch (error) {
            console.error('Model Linker: Error loading loaded models:', error);
            if (this.contentElement) {
                this.contentElement.innerHTML = `<p class="ml-error-text">Error: ${error.message}</p>`;
            }
        }
    }

    displayLoadedModels(container, data) {
        const loadedModels = data.loaded_models || [];
        const total = data.total || 0;

        if (total === 0) {
            container.innerHTML = this.renderStatusMessage('No models found in workflow.', 'info');
            return;
        }

        const byCategory = {};
        
        for (const model of loadedModels) {
            const cat = model.category || 'unknown';
            if (!byCategory[cat]) {
                byCategory[cat] = { active: [], inactive: [] };
            }
            
            // Determine if model is active or inactive
            // For LoraLoaderV2/LoraManager: check model.active field
            // For other nodes: check model.connected field (false means not connected or bypassed)
            let isActive = true;
            if (model.is_lora_v2) {
                // For text-based lora loaders, check both active flag AND connected status
                isActive = model.active !== false && model.connected !== false;
            } else {
                // For regular nodes, check connected status
                isActive = model.connected !== false;
            }
            
            if (isActive) {
                byCategory[cat].active.push(model);
            } else {
                byCategory[cat].inactive.push(model);
            }
        }

        const activeCount = Object.values(byCategory).reduce((sum, cat) => sum + cat.active.length, 0);
        const inactiveCount = Object.values(byCategory).reduce((sum, cat) => sum + cat.inactive.length, 0);

        const buildCategoryStrings = (filter) => {
            const result = {};
            for (const [category, modelsObj] of Object.entries(byCategory)) {
                const displayCat = this.getCategoryTokenName(category);
                const models = filter === 'active' ? modelsObj.active : filter === 'inactive' ? modelsObj.inactive : [...modelsObj.active, ...modelsObj.inactive];
                const parts = models.map(model => {
                    const fullName = model.name || model.original_path?.split(/[\/\\]/).pop() || 'Unknown';
                    let name = fullName;
                    if (fullName.match(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i)) {
                        name = fullName.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
                    }
                    const strength = model.strength !== null && model.strength !== undefined 
                        ? model.strength.toFixed(2) 
                        : '1.00';
                    return `<${displayCat}:${name}:${strength}>`;
                });
                result[category] = parts.join(' ');
            }
            return Object.values(result).join(' ');
        };

        const activeString = buildCategoryStrings('active');
        const inactiveString = buildCategoryStrings('inactive');
        const allString = buildCategoryStrings('all');

        const self = this;
        
        let html = `
            <div class="ml-loaded-models-header">
                <h3 class="ml-loaded-models-title">${total} Model${total > 1 ? 's' : ''} in Workflow</h3>
                <p class="ml-loaded-models-subtitle">LoraManager / LoraLoaderV2 nodes distinguish active/inactive</p>
            </div>
            <div class="ml-loaded-filters">
                <div class="ml-loaded-filter-row">
                    <button class="ml-btn-filter active" id="filter-all" onclick="window.MLFilterSwitch('all')">All (${activeCount + inactiveCount})</button>
                    <button class="ml-btn-filter" id="filter-active" onclick="window.MLFilterSwitch('active')">Active (${activeCount})</button>
                    <button class="ml-btn-filter" id="filter-inactive" onclick="window.MLFilterSwitch('inactive')">Inactive (${inactiveCount})</button>
                </div>
            </div>
            <div class="ml-models-list ml-models-list-pad">
        `;

        for (const [category, modelsObj] of Object.entries(byCategory)) {
            const displayName = this.getCategoryDisplayName(category);
            const hasActive = modelsObj.active.length > 0;
            const hasInactive = modelsObj.inactive.length > 0;
            
            html += `<div class="ml-model-section" data-ml-filter="all" data-ml-active="${hasActive}" data-ml-inactive="${hasInactive}">`;
            
            // Add category header
            html += `<div class="ml-model-section-header">
                <span class="ml-model-section-title">${displayName.toUpperCase()}</span>
            </div>`;
            
            if (hasActive) {
                const activeStr = modelsObj.active.map(m => {
                    const fullName = m.name || m.original_path?.split(/[\/\\]/).pop() || 'Unknown';
                    let name = fullName.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
                    const strength = m.strength !== null && m.strength !== undefined ? m.strength.toFixed(2) : '1.00';
                    return `<${this.getCategoryTokenName(category)}:${name}:${strength}>`;
                }).join(' ');
                
                html += `<div class="ml-model-group">
                    <div class="ml-model-group-head">
                        <span class="ml-model-group-label ml-model-group-label-active">● ACTIVE</span>
                        <button class="ml-btn ml-btn-sm ml-btn-copy-compact" onclick="window.MLCopy('${activeStr.replace(/'/g, "\\'")}', this)">Copy</button>
                    </div>
                    <div class="ml-model-chip-list">`;
                
                for (const model of modelsObj.active) {
                    const fullName = model.name || model.original_path?.split(/[\/\\]/).pop() || 'Unknown';
                    const name = fullName.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
                    const strength = model.strength !== null && model.strength !== undefined ? model.strength.toFixed(2) : null;
                    const modelData = encodeURIComponent(JSON.stringify(model));
                    html += `<span class="ml-model-chip" data-model="${modelData}" oncontextmenu="window.MLOpenContextMenu(event, this)">${name}${strength !== null ? `<span class="ml-model-chip-strength">${strength}</span>` : ''}</span>`;
                }
                html += `</div></div>`;
            }
            
            if (hasInactive) {
                const inactiveStr = modelsObj.inactive.map(m => {
                    const fullName = m.name || m.original_path?.split(/[\/\\]/).pop() || 'Unknown';
                    let name = fullName.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
                    const strength = m.strength !== null && m.strength !== undefined ? m.strength.toFixed(2) : '1.00';
                    return `<${this.getCategoryTokenName(category)}:${name}:${strength}>`;
                }).join(' ');
                
                html += `<div>
                    <div class="ml-model-group-head">
                        <span class="ml-model-group-label ml-model-group-label-inactive">○ INACTIVE</span>
                        <button class="ml-btn ml-btn-sm ml-btn-copy-compact is-muted" onclick="window.MLCopy('${inactiveStr.replace(/'/g, "\\'")}', this)">Copy</button>
                    </div>
                    <div class="ml-model-chip-list ml-model-chip-list-inactive">`;
                
                for (const model of modelsObj.inactive) {
                    const fullName = model.name || model.original_path?.split(/[\/\\]/).pop() || 'Unknown';
                    const name = fullName.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
                    const strength = model.strength !== null && model.strength !== undefined ? model.strength.toFixed(2) : null;
                    const modelData = encodeURIComponent(JSON.stringify(model));
                    html += `<span class="ml-model-chip" data-model="${modelData}" oncontextmenu="window.MLOpenContextMenu(event, this)">${name}${strength !== null ? `<span class="ml-model-chip-strength">${strength}</span>` : ''}</span>`;
                }
                html += `</div></div>`;
            }
            
            html += `</div>`;
        }

        const copySectionId = 'ml-copy-' + Date.now();
        html += `
            </div>
            <div id="${copySectionId}" class="ml-copy-section" data-ml-active="${activeString.replace(/'/g, "\\'")}" data-ml-inactive="${inactiveString.replace(/'/g, "\\'")}" data-ml-all="${allString.replace(/'/g, "\\'")}">
                <div class="ml-copy-label" id="${copySectionId}-label">Copy all:</div>
                <div class="ml-copy-row">
                    <code class="ml-copy-code" id="${copySectionId}-code">${allString}</code>
                    <button class="ml-btn ml-btn-secondary" onclick="window.MLCopyCode('${copySectionId}', this)">Copy</button>
                </div>
            </div>
        `;

        container.innerHTML = html;
        
        // Store data on container for filter function
        container.dataset.mlActiveString = activeString;
        container.dataset.mlInactiveString = inactiveString;
        container.dataset.mlAllString = allString;
    }
    
    createContent() {
        // Wrap the body in a two-column layout: left = items, right = queued panel
        const body = $el("div", {
            id: "model-linker-body"
        });

        this.contentElement = $el("div.ml-scrollable", {
            id: "model-linker-content"
        });

        this.queueElement = $el("div", {
            id: "model-linker-queue"
        }, [
            this.createQueuePanel()
        ]);

        // Splitter between content and queue
        this.splitterElement = $el("div", {
            id: "model-linker-splitter",
            ondragstart: (e) => e.preventDefault()
        });
        this.setTooltip(this.splitterElement, "Drag to resize panels");

        body.appendChild(this.contentElement);
        body.appendChild(this.splitterElement);
        body.appendChild(this.queueElement);

        // Restore saved queue width and wire splitter
        try {
            const savedSplit = localStorage.getItem('model_linker_split_w');
            if (savedSplit) {
                const w = parseInt(savedSplit, 10);
                if (!isNaN(w) && w > 0) {
                    this.queueElement.style.width = `${w}px`;
                }
            }
        } catch (e) { }

        try {
            const onSplitMouseDown = (e) => this.startSplitDrag(e);
            this.splitterElement.addEventListener('mousedown', onSplitMouseDown);
            this._splitterMouseDown = onSplitMouseDown;
        } catch (e) { }
        
        // Toggle icon always visible
        try {
            this.queueToggleIcon = $el("button", {
                id: "queue-toggle-icon",
                onclick: () => this.toggleQueueCollapsed()
            }, [document.createTextNode('⮜')]);
            body.appendChild(this.queueToggleIcon);
            this.updateQueueToggleIcon();
        } catch (e) { }
        
        // Restore queue collapsed state
        try {
            const col = localStorage.getItem('model_linker_queue_collapsed');
            if (col === '1') this.setQueueCollapsed(true);
        } catch (e) { }
        
        return body;
    }
    
    createQueuePanel() {
        // Header row with title and clear button
        this.queueHeader = $el("div.ml-queue-header", {}, [
            $el("div#queue-title.ml-queue-title", { textContent: "Queued Selections (0)" }),
            $el("div.ml-queue-actions", {}, [
                $el("button", {
                    id: "queue-toggle",
                    className: "ml-btn ml-btn-secondary ml-btn-sm",
                    textContent: "Collapse",
                    onclick: () => this.toggleQueueCollapsed()
                }),
                $el("button", {
                    id: "queue-clear",
                    className: "ml-btn ml-btn-secondary ml-btn-sm",
                    textContent: "Clear All",
                    onclick: () => this.clearAllQueued()
                })
            ])
        ]);

        // Scrollable list
        this.queueList = $el("div#queue-list.ml-queue-list");

        const panel = $el("div.ml-queue-panel", {}, [
            $el("div.ml-queue-stack", {}, [this.queueHeader, this.queueList])
        ]);
        return panel;
    }

    updateQueuePanel() {
        if (!this.queueList || !this.queueHeader) return;
        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        // Update title count
        const title = this.queueHeader.querySelector('#queue-title');
        if (title) title.textContent = `Queued Selections (${list.length})`;
        const toggleBtn = this.queueHeader.querySelector('#queue-toggle');
        if (toggleBtn) toggleBtn.textContent = this.queueCollapsed ? 'Expand' : 'Collapse';

        if (!list.length) {
            this.queueList.innerHTML = '<div class="ml-queue-empty">No selections queued.</div>';
            return;
        }

        let html = '<div class="ml-queue-items">';
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const label = (r.resolved_model?.relative_path || r.resolved_model?.filename || r.resolved_path || '').toString();
            const nodeLabel = r.node_label || r.node_type || (r.subgraph_id ? 'Subgraph' : 'Node');
            const orig = (r.original_path || '').toString();
            const rmId = `queue-remove-${i}`;
            html += `<div class="ml-queue-item">`;
            html += `<div class="ml-queue-item-title">${nodeLabel} #${r.node_id}</div>`;
            html += `<div class="ml-queue-item-meta">Original: <code>${orig}</code></div>`;
            html += `<div class="ml-queue-item-selection">Selected: <code>${label}</code></div>`;
            html += `<div class="ml-queue-item-actions"><button id="${rmId}" class="ml-btn ml-btn-secondary ml-btn-sm">Remove</button></div>`;
        }
        html += '</div>';
        this.queueList.innerHTML = html;

        // Wire remove buttons
        for (let i = 0; i < list.length; i++) {
            const rmId = `queue-remove-${i}`;
            const btn = this.queueList.querySelector(`#${rmId}`);
            if (btn) {
                btn.addEventListener('click', () => this.removeQueuedByIndex(i));
            }
        }
    }

    // Remove queued by index
    removeQueuedByIndex(i) {
        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        if (i < 0 || i >= list.length) return;
        const r = list[i];
        // Remove
        this.pendingResolutions.splice(i, 1);
        this.rebuildPendingIndex();
        // Update per-item selected bar
        const m = { node_id: r.node_id, widget_index: r.widget_index, subgraph_id: r.subgraph_id, is_top_level: r.is_top_level };
        this.updateSelectedBarForMissing?.(m);
        this.updateApplyPendingButton?.();
        this.updateQueuePanel();
    }

    // Clear all queued selections
    clearAllQueued() {
        this.pendingResolutions = [];
        this.pendingIndex = new Map();
        this.updateApplyPendingButton?.();
        this.updateQueuePanel();
        try {
            document.querySelectorAll('.model-linker-selected').forEach(el => { el.style.display = 'none'; el.innerHTML = ''; });
        } catch (e) { /* ignore */ }
    }

    // Update selected bar for a specific missing model slot
    updateSelectedBarForMissing(missing) {
        if (!missing) return;
        const nodeId = missing.node_id;
        const widgetIndex = missing.widget_index;
        const subgraphId = missing.subgraph_id || '';
        const isTopLevel = missing.is_top_level !== false;
        const key = `${nodeId}:${widgetIndex}:${subgraphId}:${isTopLevel ? 'T' : 'F'}`;
        
        const selectedBar = document.getElementById(`selected-bar-${nodeId}-${widgetIndex}`);
        if (!selectedBar) return;
        
        // Find selection for this slot
        let selection = null;
        let selectionIdx = -1;
        if (this.pendingIndex.has(key)) {
            const idx = this.pendingIndex.get(key);
            if (idx >= 0 && idx < this.pendingResolutions.length) {
                selection = this.pendingResolutions[idx];
                selectionIdx = idx;
            }
        }
        
        if (!selection) {
            selectedBar.style.display = 'none';
            selectedBar.innerHTML = '';
            return;
        }
        
        // Build selected bar content
        const label = selection.resolved_model?.relative_path || selection.resolved_model?.filename || selection.resolved_path || '';
        const resolveBtnId = `selected-remove-${nodeId}-${widgetIndex}`;
        
        selectedBar.innerHTML = `<div class="ml-selected-bar-inner">`;
        selectedBar.innerHTML += `<span class="ml-selected-label">✓ Selected:</span>`;
        selectedBar.innerHTML += `<code class="ml-selected-code">${label}</code>`;
        selectedBar.innerHTML += `<button id="${resolveBtnId}" class="ml-btn ml-btn-secondary ml-btn-sm">Remove</button>`;
        selectedBar.innerHTML += `</div>`;
        selectedBar.style.display = 'block';
        
        // Wire remove button - use key-based removal
        const removeBtn = selectedBar.querySelector(`#${resolveBtnId}`);
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                this.removeQueuedByKey(key);
            });
        }
    }

    // Remove queued by key (more reliable than index)
    removeQueuedByKey(key) {
        if (!key || !this.pendingIndex.has(key)) return;
        
        // Find and remove the item with this key
        const idx = this.pendingIndex.get(key);
        if (idx >= 0 && idx < this.pendingResolutions.length) {
            const r = this.pendingResolutions[idx];
            // Update the selected bar before removing
            const m = { node_id: r.node_id, widget_index: r.widget_index, subgraph_id: r.subgraph_id, is_top_level: r.is_top_level };
            
            // Remove from array
            this.pendingResolutions.splice(idx, 1);
            this.rebuildPendingIndex();
            this.updateSelectedBarForMissing(m);
            this.updateApplyPendingButton?.();
            this.updateQueuePanel();
        }
    }

    // Rebuild pending index after modification
    rebuildPendingIndex() {
        this.pendingIndex = new Map();
        for (let i = 0; i < this.pendingResolutions.length; i++) {
            const r = this.pendingResolutions[i];
            const key = `${r.node_id}:${r.widget_index}:${r.subgraph_id || ''}:${r.is_top_level ? 'T' : 'F'}`;
            this.pendingIndex.set(key, i);
        }
    }

    // Collapse/expand queue panel
    toggleQueueCollapsed() {
        this.setQueueCollapsed(!this.queueCollapsed);
    }

    setQueueCollapsed(collapsed) {
        this.queueCollapsed = !!collapsed;
        if (!this.queueElement || !this.splitterElement) return;
        if (this.queueCollapsed) {
            this.queueElement.style.display = 'none';
            this.splitterElement.style.display = 'none';
            try { localStorage.setItem('model_linker_queue_collapsed', '1'); } catch (e) { }
        } else {
            this.queueElement.style.display = '';
            this.splitterElement.style.display = '';
            try { localStorage.setItem('model_linker_queue_collapsed', '0'); } catch (e) { }
        }
        this.updateQueuePanel();
        this.updateQueueToggleIcon();
    }

    updateQueueToggleIcon() {
        if (!this.queueToggleIcon) return;
        if (this.queueCollapsed) {
            this.queueToggleIcon.textContent = '⮞';
            this.setTooltip(this.queueToggleIcon, 'Show queued selections');
        } else {
            this.queueToggleIcon.textContent = '⮜';
            this.setTooltip(this.queueToggleIcon, 'Hide queued selections');
        }
    }

    // Begin split drag for resizable panels
    startSplitDrag(e) {
        try {
            if (!this.queueElement) return;
            const rect = this.queueElement.getBoundingClientRect();
            const body = document.getElementById('model-linker-body');
            const bodyRect = body ? body.getBoundingClientRect() : { width: window.innerWidth };
            this._splitDragging = true;
            this._splitStart = {
                x: e.clientX,
                startWidth: rect.width,
                containerWidth: bodyRect.width
            };
            this._prevUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            this._onSplitMove = (ev) => this.onSplitDrag(ev);
            this._onSplitUp = () => this.endSplitDrag();
            document.addEventListener('mousemove', this._onSplitMove);
            document.addEventListener('mouseup', this._onSplitUp, { once: true });
        } catch (err) { /* ignore */ }
    }

    onSplitDrag(e) {
        if (!this._splitDragging || !this._splitStart || !this.queueElement) return;
        const dx = e.clientX - this._splitStart.x;
        let newW = this._splitStart.startWidth - dx;
        const minW = 240;
        const maxW = Math.max(minW, Math.floor(this._splitStart.containerWidth - 360));
        if (newW < minW) newW = minW;
        if (newW > maxW) newW = maxW;
        this.queueElement.style.width = `${Math.round(newW)}px`;
    }

    endSplitDrag() {
        if (!this._splitDragging) return;
        this._splitDragging = false;
        document.removeEventListener('mousemove', this._onSplitMove);
        try {
            const rect = this.queueElement.getBoundingClientRect();
            localStorage.setItem('model_linker_split_w', String(Math.round(rect.width)));
        } catch (e) { }
        try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
    }

    /**
     * Queue a resolution for later batch apply
     */
    queueResolution(missing, resolvedModel) {
        if (!resolvedModel) {
            this.showNotification('No model selected', 'error');
            return;
        }

        const resolution = {
            node_id: missing.node_id,
            widget_index: missing.widget_index,
            resolved_path: resolvedModel.path,
            category: missing.category,
            resolved_model: resolvedModel,
            original_path: missing.original_path,
            subgraph_id: missing.subgraph_id,
            is_top_level: missing.is_top_level,
            node_type: missing.node_type,
            node_label: missing.subgraph_name || missing.node_type
        };

        const key = `${resolution.node_id}:${resolution.widget_index}:${resolution.subgraph_id || ''}:${resolution.is_top_level ? 'T' : 'F'}`;
        if (this.pendingIndex.has(key)) {
            // replace existing selection for this slot
            const idx = this.pendingIndex.get(key);
            this.pendingResolutions[idx] = resolution;
        } else {
            this.pendingIndex.set(key, this.pendingResolutions.length);
            this.pendingResolutions.push(resolution);
        }

        // Update selected bar UI
        this.updateSelectedBarForMissing?.(missing);
        this.updateQueuePanel();
        this.updateApplyPendingButton();
    }

    /**
     * Apply all pending resolutions in batch
     */
    async applyPendingResolutions() {
        const list = this.pendingResolutions || [];
        if (!list.length) {
            this.showNotification('No selections queued', 'error');
            return;
        }

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            const response = await api.fetchApi('/model_linker/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow, resolutions: list })
            });

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            const data = await response.json();
            if (data.success) {
                await this.updateWorkflowInComfyUI(data.workflow);
                this.showNotification(`✓ Linked ${list.length} selection${list.length>1?'s':''}`, 'success');
                // Clear queue and refresh analysis
                this.pendingResolutions = [];
                this.pendingIndex = new Map();
                this.updateApplyPendingButton();
                this.updateQueuePanel();
                await this.loadWorkflowData(data.workflow);
            } else {
                this.showNotification('Failed to apply selections: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (e) {
            console.error('Model Linker: applyPendingResolutions error', e);
            this.showNotification('Error applying selections: ' + e.message, 'error');
        }
    }

    updateApplyPendingButton() {
        if (!this.applyPendingBtn) return;
        const count = this.pendingResolutions?.length || 0;
        this.applyPendingBtn.textContent = `Apply Selected (${count})`;
        this.applyPendingBtn.disabled = count === 0;
    }
    
    createFooter() {
        // Store reference to download all button so we can update its text
        this.downloadAllButton = $el("button.ml-btn.ml-btn-download.ml-footer-btn", {
            onclick: () => this.handleDownloadAllClick()
        }, [
            $el("span.ml-btn-icon", { textContent: "☁" }),
            $el("span", { textContent: " Download All Missing" })
        ]);
        
        // Auto-resolve button (secondary style)
        this.autoResolveButton = $el("button.ml-btn.ml-btn-secondary.ml-footer-btn", {
            onclick: () => this.autoResolve100Percent()
        }, [
            $el("span.ml-btn-icon", { textContent: "🔗" }),
            $el("span", { textContent: " Auto-Link 100%" })
        ]);
        
        // Apply pending resolutions button
        this.applyPendingBtn = $el("button.ml-btn.ml-btn-primary.ml-footer-btn", {
            id: "apply-pending-resolutions",
            textContent: "Apply Selected (0)",
            onclick: () => this.applyPendingResolutions()
        });
        
        return $el("div.ml-footer", {}, [
            this.autoResolveButton,
            this.applyPendingBtn,
            this.downloadAllButton
        ]);
    }

    animateTabContentTransition() {
        if (!this.contentElement?.animate) return;

        try {
            this.contentElement.animate(
                [
                    { opacity: 0.72, transform: 'translateY(7px)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ],
                {
                    duration: 180,
                    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
                }
            );
        } catch (error) {
            console.warn('Model Linker: tab content animation failed', error);
        }
    }
    
    /**
     * Handle click on Download All / Cancel All button
     */
    handleDownloadAllClick() {
        if (Object.keys(this.activeDownloads).length > 0) {
            // Cancel all active downloads
            this.cancelAllDownloads();
        } else {
            // Start downloading all missing
            this.downloadAllMissing();
        }
    }
    
    /**
     * Cancel all active downloads
     */
    async cancelAllDownloads() {
        const downloadIds = Object.keys(this.activeDownloads);
        if (downloadIds.length === 0) return;
        
        this.showNotification(`Cancelling ${downloadIds.length} download${downloadIds.length > 1 ? 's' : ''}...`, 'info');
        
        for (const downloadId of downloadIds) {
            try {
                await api.fetchApi(`/model_linker/cancel/${downloadId}`, {
                    method: 'POST'
                });
            } catch (error) {
                console.error('Model Linker: Error cancelling download:', error);
            }
        }
    }
    
    /**
     * Update the Download All button state based on active downloads
     */
    updateDownloadAllButtonState() {
        if (!this.downloadAllButton) return;
        
        const activeCount = Object.keys(this.activeDownloads).length;
        if (activeCount > 0) {
            this.downloadAllButton.innerHTML = `<span class="ml-btn-icon">✕</span> Cancel All (${activeCount})`;
            this.downloadAllButton.classList.remove('ml-btn-download');
            this.downloadAllButton.classList.add('ml-btn-danger');
        } else {
            this.downloadAllButton.innerHTML = `<span class="ml-btn-icon">☁</span> Download All Missing`;
            this.downloadAllButton.classList.remove('ml-btn-danger');
            this.downloadAllButton.classList.add('ml-btn-download');
        }
    }
    
    async show(workflow = null) {
        this.undockToFloating({ persist: false });
        await this.showContent(workflow, { restoreFullscreen: true });
    }

    async showDocked(container, workflow = null) {
        this.dockTo(container);
        await this.showContent(workflow, { restoreFullscreen: false });
    }

    async showContent(workflow = null, { restoreFullscreen = true } = {}) {
        this.backdrop.style.display = "none";
        this.element.style.display = "flex";
        if (!this.docked) {
            this.scheduleModalViewportClamp();
        }
        
        // Update button state in case there are active downloads
        this.updateDownloadAllButtonState();
        
        // Ensure all models are loaded for dropdown
        await this.ensureCapabilitiesLoaded();
        await this.ensureAllModelsLoaded();
        await this.ensureDownloadDirectoriesLoaded();
        
        // Restore fullscreen state if enabled
        try {
            const fs = localStorage.getItem('model_linker_modal_fullscreen');
            if (!this.docked && restoreFullscreen && fs === '1') this.setFullScreen(true);
        } catch (e) { }
        
        // Attach drag handle event listener (only once)
        this.attachDragHandleIfNeeded();

        this.activeTab = this.restoreActiveTab();

        if (this.activeTab === 'missing') {
            await this.loadWorkflowData(workflow);
        } else if (this.activeTab === 'loaded') {
            this.switchTab('loaded');
        } else {
            this.switchTab('options');
        }
    }
    
    // Attach topbar drag listeners while preserving the handle-based viewport clamp.
    attachDragHandleIfNeeded() {
        if (this._dragHandleAttached) return;
        
        const handle = document.getElementById('model-linker-drag-handle');
        const topbar = this.element?.querySelector('.ml-dialog-topbar');
        if (!handle || !topbar) return;
        
        const onMouseDown = (e) => {
            if (this.fullscreen || this.docked) return; // no drag in fullscreen or docked mode
            if (e.button !== 0 || this.isTopbarDragExcluded(e.target)) return;
            topbar.classList.add('ml-is-dragging');
            this.startDrag(e);
        };
        const onMouseUp = () => { topbar.classList.remove('ml-is-dragging'); };
        
        topbar.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        
        this._dragHandleAttached = true;
    }

    isTopbarDragExcluded(target) {
        if (!(target instanceof Element)) return false;
        return !!target.closest([
            '.ml-tabs',
            '.ml-dialog-controls',
            'button',
            'a',
            'input',
            'select',
            'textarea',
            '[role="button"]',
            '[data-ml-no-drag]'
        ].join(','));
    }
    
    close() {
        this.rememberSidebarOpenMode(this.docked ? 'docked' : 'floating');
        this._hidePreview?.();
        this.hideTooltip();
        this.backdrop.style.display = "none";
        this.element.style.display = "none";
    }

    /**
     * Load workflow data and display missing models
     */
    async loadWorkflowData(workflow = null) {
        if (!this.contentElement) return;

        // Show loading state
        try {
            // Use provided workflow, or get current workflow from ComfyUI
            if (!workflow) {
                workflow = this.getCurrentWorkflow();
            }
            
            if (!workflow) {
                this._analysisProgressToken = null;
                this.contentElement.innerHTML = '<p>No workflow loaded. Please load a workflow first.</p>';
                return;
            }

            const workflowSignature = this.getWorkflowSignature(workflow);
            if (
                workflowSignature &&
                this.cachedWorkflowSignature === workflowSignature &&
                this.cachedAnalysisData
            ) {
                this.displayMissingModels(this.contentElement, this.cachedAnalysisData);
                this.reconnectActiveDownloads();
                return;
            }

            const analysisId = `an-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this._analysisProgressToken = analysisId;
            this.contentElement.innerHTML = this.renderAnalysisProgress({
                status: 'starting',
                message: 'Starting analysis...',
                current: 0,
                total: 0
            });

            // Call analyze endpoint
            const progressPromise = this.pollAnalysisProgress(analysisId, analysisId);
            const response = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow, analysis_id: analysisId })
            });
            this._analysisProgressToken = null;
            await progressPromise;

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            this.cachedWorkflowSignature = workflowSignature;
            this.cachedAnalysisData = data;
            this.searchResultCache.clear();
            this.displayMissingModels(this.contentElement, data);
            
            // Reconnect any active downloads to their new progress divs
            this.reconnectActiveDownloads();

        } catch (error) {
            this._analysisProgressToken = null;
            console.error('Model Linker: Error loading workflow data:', error);
            if (this.contentElement) {
                this.contentElement.innerHTML = `<p class="ml-error-text">Error: ${error.message}</p>`;
            }
        }
    }

    /**
     * Get current workflow from ComfyUI
     */
    getCurrentWorkflow() {
        // Try to get workflow from app
        if (app?.graph) {
            try {
                // Use ComfyUI's workflow serialization
                const workflow = app.graph.serialize();
                return workflow;
            } catch (e) {
                console.warn('Model Linker: Could not serialize workflow from graph:', e);
            }
        }
        return null;
    }

    /**
     * Locate and focus a node in the ComfyUI canvas
     */
    locateNodeInGraph(nodeId) {
        try {
            if (!app?.graph) {
                this.showNotification('Cannot locate node - graph not available', 'error');
                return;
            }
            
            // Find the node in the graph
            const node = app.graph.getNodeById(nodeId);
            if (!node) {
                this.showNotification(`Node #${nodeId} not found in graph`, 'error');
                return;
            }
            
            let locatedWithAnimation = false;

            // Focus on the node in the canvas with animated panning when possible
            if (app.canvas?.ds && app.canvas?.canvas) {
                locatedWithAnimation = this.animateCanvasToNode(node);
            }

            if (!locatedWithAnimation && app.graph._nodes && app.graph._nodes.get(nodeId)) {
                // Alternative method for older versions
                const canvasNode = app.graph._nodes.get(nodeId);
                if (canvasNode && canvasNode.setSelected && canvasNode.graph) {
                    canvasNode.setSelected(true);
                    // Scroll to node
                    app.canvas.scrollToNode(canvasNode);
                }
            } else if (!locatedWithAnimation && app.ui && app.ui.nodeGraph && typeof app.ui.nodeGraph.scrollToNode === 'function') {
                // Alternative for other versions
                app.ui.nodeGraph.scrollToNode(node);
            } else if (!locatedWithAnimation && app.canvas && typeof app.canvas.centerOnNode === 'function') {
                // Final fallback for versions where animation path is unavailable
                app.canvas.centerOnNode(node);
            }
            
            // Also try to flash/select the node
            // Deselect all nodes first
            if (app.graph && app.graph.nodes) {
                app.graph.nodes.forEach(n => {
                    if (n.selected) n.selected = false;
                });
            }
            
            // Select and highlight our node
            node.selected = true;
            
            this.showNotification(`Focused on Node #${nodeId} (${node.type})`, 'info');
        } catch (e) {
            console.error('Model Linker: Error locating node:', e);
            this.showNotification('Error locating node: ' + e.message, 'error');
        }
    }

    animateCanvasToNode(node) {
        const canvas = app?.canvas;
        const ds = canvas?.ds;
        const htmlCanvas = canvas?.canvas;
        if (!canvas || !ds || !htmlCanvas) return false;

        const rect = node.boundingRect || [node.pos?.[0] || 0, node.pos?.[1] || 0, node.size?.[0] || 0, node.size?.[1] || 0];
        const centerX = rect[0] + (rect[2] || 0) / 2;
        const centerY = rect[1] + (rect[3] || 0) / 2;
        const startScale = Number.isFinite(ds.scale) && ds.scale > 0 ? ds.scale : 1;
        const locateViewport = this.getLocateViewport(htmlCanvas);
        const viewportWidth = locateViewport.width;
        const viewportHeight = locateViewport.height;

        if (!viewportWidth || !viewportHeight) return false;

        const nodeWidth = Math.max(rect[2] || 0, 1);
        const nodeHeight = Math.max(rect[3] || 0, 1);
        const paddingX = 36;
        const paddingY = 32;
        const maxLocateScale = 2.5;
        const fitScaleX = viewportWidth / (nodeWidth + (paddingX * 2));
        const fitScaleY = viewportHeight / (nodeHeight + (paddingY * 2));
        const targetScale = Math.max(0.15, Math.min(maxLocateScale, fitScaleX, fitScaleY));

        const getCenteredOffset = (scale) => {
            return {
                x: -centerX + (locateViewport.centerX / scale),
                y: -centerY + (locateViewport.centerY / scale)
            };
        };

        const startOffset = {
            x: Number.isFinite(ds.offset?.[0]) ? ds.offset[0] : getCenteredOffset(startScale).x,
            y: Number.isFinite(ds.offset?.[1]) ? ds.offset[1] : getCenteredOffset(startScale).y
        };
        const targetOffset = getCenteredOffset(targetScale);

        if (this._locateAnimationFrame) {
            cancelAnimationFrame(this._locateAnimationFrame);
            this._locateAnimationFrame = null;
        }

        const durationMs = 380;
        const startTime = performance.now();
        const easeInOutCubic = (t) => t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const tick = (now) => {
            const progress = Math.min(1, (now - startTime) / durationMs);
            const eased = easeInOutCubic(progress);

            ds.scale = startScale + ((targetScale - startScale) * eased);
            ds.offset[0] = startOffset.x + ((targetOffset.x - startOffset.x) * eased);
            ds.offset[1] = startOffset.y + ((targetOffset.y - startOffset.y) * eased);
            canvas.setDirty?.(true, true);
            app.graph?.setDirtyCanvas?.(true, true);

            if (progress < 1) {
                this._locateAnimationFrame = requestAnimationFrame(tick);
            } else {
                this._locateAnimationFrame = null;
            }
        };

        this._locateAnimationFrame = requestAnimationFrame(tick);
        return true;
    }

    getLocateViewport(htmlCanvas) {
        const canvasRect = htmlCanvas.getBoundingClientRect?.();
        const dpr = window.devicePixelRatio || 1;
        const canvasWidth = canvasRect?.width || htmlCanvas.clientWidth || ((htmlCanvas.width || 0) / dpr);
        const canvasHeight = canvasRect?.height || htmlCanvas.clientHeight || ((htmlCanvas.height || 0) / dpr);
        const viewport = {
            left: 0,
            top: 0,
            right: canvasWidth,
            bottom: canvasHeight
        };

        if (this.docked && canvasRect?.width && canvasRect?.height) {
            const obstructionElement = this.dockContainer instanceof HTMLElement
                ? this.dockContainer
                : this.element;
            const obstructionRect = obstructionElement?.getBoundingClientRect?.();
            if (obstructionRect?.width && obstructionRect?.height) {
                this.subtractDockedObstructionFromLocateViewport(viewport, canvasRect, obstructionRect);
            }
        }

        const width = Math.max(1, viewport.right - viewport.left);
        const height = Math.max(1, viewport.bottom - viewport.top);
        return {
            width,
            height,
            centerX: viewport.left + (width / 2),
            centerY: viewport.top + (height / 2)
        };
    }

    subtractDockedObstructionFromLocateViewport(viewport, canvasRect, obstructionRect) {
        const obstruction = {
            left: Math.max(0, obstructionRect.left - canvasRect.left),
            top: Math.max(0, obstructionRect.top - canvasRect.top),
            right: Math.min(canvasRect.width, obstructionRect.right - canvasRect.left),
            bottom: Math.min(canvasRect.height, obstructionRect.bottom - canvasRect.top)
        };
        const overlapWidth = obstruction.right - obstruction.left;
        const overlapHeight = obstruction.bottom - obstruction.top;
        if (overlapWidth <= 0 || overlapHeight <= 0) return;

        const coversMostHeight = overlapHeight >= canvasRect.height * 0.5;
        const coversMostWidth = overlapWidth >= canvasRect.width * 0.5;
        const edgeTolerance = 2;

        if (coversMostHeight) {
            if (obstruction.left <= edgeTolerance) {
                viewport.left = Math.min(viewport.right, Math.max(viewport.left, obstruction.right));
                return;
            }
            if (obstruction.right >= canvasRect.width - edgeTolerance) {
                viewport.right = Math.max(viewport.left, Math.min(viewport.right, obstruction.left));
                return;
            }

            const leftSpace = obstruction.left - viewport.left;
            const rightSpace = viewport.right - obstruction.right;
            if (rightSpace >= leftSpace) {
                viewport.left = Math.min(viewport.right, Math.max(viewport.left, obstruction.right));
            } else {
                viewport.right = Math.max(viewport.left, Math.min(viewport.right, obstruction.left));
            }
            return;
        }

        if (coversMostWidth) {
            if (obstruction.top <= edgeTolerance) {
                viewport.top = Math.min(viewport.bottom, Math.max(viewport.top, obstruction.bottom));
                return;
            }
            if (obstruction.bottom >= canvasRect.height - edgeTolerance) {
                viewport.bottom = Math.max(viewport.top, Math.min(viewport.bottom, obstruction.top));
            }
        }
    }

    /**
     * Reconnect active downloads to their new progress div elements after UI refresh
     */
    reconnectActiveDownloads() {
        if (!this.contentElement) return;
        
        for (const [downloadId, info] of Object.entries(this.activeDownloads)) {
            const { missing } = info;
            if (!missing) continue;
            
            // Find the new progress div by ID
            const progressId = `download-progress-${missing.node_id}-${missing.widget_index}`;
            const newProgressDiv = this.contentElement.querySelector(`#${progressId}`);
            const newDownloadBtn = this.contentElement.querySelector(`#download-${missing.node_id}-${missing.widget_index}`);
            
            if (newProgressDiv) {
                // Update the reference
                info.progressDiv = newProgressDiv;
                info.downloadBtn = newDownloadBtn;
                
                // Show that download is in progress
                newProgressDiv.classList.remove('ml-is-hidden');
                newProgressDiv.classList.add('ml-is-visible');
                newProgressDiv.innerHTML = this.renderProgressWithAction({
                    percent: 0,
                    leftText: '<span class="ml-info-accent-text">Downloading...</span>',
                    rightText: '',
                    actionClass: 'cancel-download-btn ml-btn ml-btn-danger ml-btn-sm',
                    actionText: 'Cancel',
                    actionDataAttr: `data-download-id="${downloadId}"`
                });
                
                // Attach cancel handler
                const cancelBtn = newProgressDiv.querySelector('.cancel-download-btn');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
                }
                
                // Update download button if exists
                if (newDownloadBtn) {
                    newDownloadBtn.disabled = true;
                    newDownloadBtn.textContent = 'Downloading...';
                }
            }
        }
    }

    getMissingModelKey(missing = {}) {
        const nodeId = missing.node_id ?? '';
        const widgetIndex = missing.widget_index ?? '';
        const subgraphId = missing.subgraph_id || '';
        const scope = missing.is_top_level !== false ? 'T' : 'F';
        return `${nodeId}:${widgetIndex}:${subgraphId}:${scope}`;
    }

    getMissingFilename(missing = {}) {
        return missing.original_path?.split('/').pop()?.split('\\').pop() || missing.name || 'Missing model';
    }

    getMissingNodeDisplay(missing = {}) {
        const isSubgraphNode = missing.node_type && missing.node_type.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        let nodeLabel;
        if (missing.subgraph_name) {
            nodeLabel = missing.subgraph_name;
        } else if (isSubgraphNode) {
            nodeLabel = 'Subgraph';
        } else {
            nodeLabel = missing.node_type || 'Node';
        }

        const nodeId = missing.node_id ?? '';
        const customNodeTitle = String(missing.node_title || '').trim();
        const hasCustomNodeTitle = customNodeTitle && customNodeTitle !== nodeLabel;
        const text = hasCustomNodeTitle
            ? `${nodeLabel} #${nodeId} · ${customNodeTitle}`
            : `${nodeLabel} #${nodeId}`;

        return {
            label: nodeLabel,
            text,
            canLocate: missing.is_top_level !== false && nodeId !== ''
        };
    }

    getBestLocalMatch(missing = {}, minConfidence = 0) {
        const matches = Array.isArray(missing.matches) ? missing.matches : [];
        return matches
            .filter(match => Number(match.confidence) >= minConfidence)
            .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0] || null;
    }

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
    }

    getMissingSourceStatus(missing = {}, source = '') {
        const state = this.searchResultCache.get(this.getMissingSearchKey(missing));
        const progress = state?.sourceProgress?.[source];
        const resultStatus = this.getMissingSourceResultStatus(missing, source, state);
        if (progress?.status === 'found') return resultStatus || 'found';
        if (progress?.status) return progress.status;

        if (resultStatus) return resultStatus;

        return 'idle';
    }

    getMissingSourceResultStatus(missing = {}, source = '', state = null) {
        const results = state?.results || {};
        const candidates = [];

        if (source === 'local') {
            candidates.push(results.model_list, results.popular);
        } else if (source === 'huggingface') {
            candidates.push(results.huggingface);
        } else if (source === 'civitai') {
            candidates.push(results.civitai);
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
    }

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
    }

    renderMissingSourcesSummary(missing = {}) {
        const sourceItems = [
            { source: 'local' },
            { source: 'huggingface' },
            { source: 'civitai' }
        ];
        if (this.isSourceAvailable('lora_manager_archive')) {
            sourceItems.push({ source: 'lora_manager_archive' });
        }

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
            const iconHtml = getSvgIcon(iconName, 'currentColor', 'ml-missing-source-icon');
            return `<span class="ml-missing-source-dot ml-missing-source-${statusClass}" data-tooltip="${this.escapeHtml(title)}" aria-label="${this.escapeHtml(title)}">${iconHtml}</span>`;
        }).join('');
    }

    hasRenderableSearchState(state = {}) {
        return Boolean(
            (state.lastAttemptSources || []).length
            || Object.keys(state.sourceProgress || {}).length
            || this.hasSearchResults(state.results || {})
            || state.lastAttemptError
        );
    }

    getMissingModelsListLayout(missingModels = []) {
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const textWidth = (value, charPx) => Math.ceil(String(value || '').length * charPx);

        let modelPx = 180;
        let typePx = 66;
        for (const missing of missingModels) {
            const filename = this.getMissingFilename(missing);
            const nodeLabel = this.getMissingNodeDisplay(missing).text;
            const typeLabel = missing.category ? this.getCategoryDisplayName(missing.category) : 'unknown';
            modelPx = Math.max(
                modelPx,
                textWidth(filename, 7.2) + 12,
                textWidth(nodeLabel, 5.5) + 34
            );
            typePx = Math.max(typePx, textWidth(typeLabel, 5.8) + 18);
        }

        return {
            modelPx: clamp(modelPx, 180, 430),
            typePx: clamp(typePx, 66, 120)
        };
    }

    renderMissingModelsBrowser(missingModels, selectedKey, totalMissing, activeCount, hasAny100Match) {
        const stats = this.getMissingModelSummaryStats(missingModels);
        const detailIndex = missingModels.findIndex(missing => this.getMissingModelKey(missing) === selectedKey);
        const detailMissing = detailIndex >= 0 ? missingModels[detailIndex] : null;
        const activeHint = activeCount > 0
            ? `${activeCount} downloading`
            : (hasAny100Match ? 'Auto-link ready for exact matches' : 'Review matches or search online');
        const listLayout = this.getMissingModelsListLayout(missingModels);
        const listStyle = `--ml-missing-model-col:${listLayout.modelPx}px;--ml-missing-type-col:${listLayout.typePx}px;`;

        let html = `
            <div class="ml-missing-browser" style="${listStyle}">
                <section class="ml-missing-list-pane" aria-label="Missing model list">
                    <div class="ml-missing-list-toolbar">
                        <div>
                            <div class="ml-missing-list-title">${totalMissing} missing model${totalMissing === 1 ? '' : 's'}</div>
                            <div class="ml-missing-list-meta">${this.escapeHtml(activeHint)}</div>
                        </div>
                        <div class="ml-missing-list-stats">
                            <span class="ml-missing-stat ml-missing-stat-exact">${stats.exact} exact</span>
                            <span class="ml-missing-stat ml-missing-stat-partial">${stats.partial} partial</span>
                            <span class="ml-missing-stat ml-missing-stat-none">${stats.none} no match</span>
                        </div>
                    </div>
                    <div class="ml-missing-list-head">
                        <span>#</span>
                        <span>Missing Model</span>
                        <span>Type</span>
                        <span>Best Local Match</span>
                        <span>Match</span>
                        <span>Sources</span>
                    </div>
                    <div class="ml-missing-list">
        `;

        missingModels.forEach((missing, index) => {
            const key = this.getMissingModelKey(missing);
            const isSelected = key === selectedKey;
            const filename = this.getMissingFilename(missing);
            const formattedFilename = this.formatFilename(filename, 46);
            const bestMatch = this.getBestLocalMatch(missing, 70);
            const confidence = bestMatch ? Number(bestMatch.confidence || 0) : 0;
            const matchName = bestMatch?.model?.relative_path || bestMatch?.filename || bestMatch?.path || '';
            const matchDisplay = matchName || 'No local match';
            const matchClass = confidence === 100 ? 'exact' : (bestMatch ? 'partial' : 'none');
            const typeLabel = missing.category ? this.getCategoryDisplayName(missing.category) : 'unknown';
            const typeColorClass = this.getModelTypeColorClass(missing.category || typeLabel);
            const nodeDisplay = this.getMissingNodeDisplay(missing);
            const nodeId = missing.node_id ?? '';
            const rowNodeHtml = nodeDisplay.canLocate
                ? `<button type="button" class="ml-node-chip is-locatable ml-missing-row-node ml-missing-row-locate" data-node-id="${this.escapeHtml(String(nodeId))}" data-tooltip="Center this node in the ComfyUI graph." aria-label="Center ${this.escapeHtml(nodeDisplay.text)} in the ComfyUI graph">${this.getLocateIconHtml()}<span class="ml-missing-row-node-label">${this.escapeHtml(nodeDisplay.text)}</span></button>`
                : `<span class="ml-missing-row-node">${this.escapeHtml(nodeDisplay.text)}</span>`;

            html += `
                <div role="button" tabindex="0"
                    class="ml-missing-list-row ${isSelected ? 'is-selected' : ''}"
                    data-missing-key="${this.escapeHtml(key)}">
                    <span class="ml-missing-row-index">${index + 1}</span>
                    <span class="ml-missing-row-model">
                        <span class="ml-missing-row-name" data-tooltip="${this.escapeHtml(filename)}">${this.escapeHtml(formattedFilename.display)}</span>
                        ${rowNodeHtml}
                    </span>
                    <span class="ml-missing-row-type ${typeColorClass}">${this.escapeHtml(typeLabel)}</span>
                    <span class="ml-missing-row-best" data-tooltip="${this.escapeHtml(matchDisplay)}">
                        ${bestMatch ? this.escapeHtml(matchDisplay) : '<span class="ml-missing-row-none">-- No local match</span>'}
                    </span>
                    <span class="ml-missing-row-match ml-missing-row-match-${matchClass}">
                        <strong>${bestMatch ? `${confidence.toFixed(confidence % 1 ? 1 : 0)}%` : '--'}</strong>
                    </span>
                    <span class="ml-missing-row-sources">${this.renderMissingSourcesSummary(missing)}</span>
                </div>
            `;
        });

        html += `
                    </div>
                </section>
                <section class="ml-missing-detail-pane" aria-label="Missing model details">
                    ${detailMissing ? this.renderMissingModel(detailMissing, detailIndex) : this.renderStatusMessage('Select a missing model to inspect details.', 'info')}
                </section>
            </div>
        `;
        return html;
    }

    wireMissingModelsBrowser(container, data, sortedMissingModels) {
        const selectRow = (row) => {
            const key = row.dataset.missingKey;
            if (!key || key === this.selectedMissingModelKey) return;
            this.selectedMissingModelKey = key;
            this.displayMissingModels(container, data);
        };

        container.querySelectorAll('.ml-missing-list-row').forEach(row => {
            row.addEventListener('click', (event) => {
                const clickedLocate = event.target instanceof Element && event.target.closest('.ml-missing-row-locate');
                if (clickedLocate) return;
                selectRow(row);
            });

            row.addEventListener('keydown', (event) => {
                if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                selectRow(row);
            });
        });

        container.querySelectorAll('.ml-missing-row-locate').forEach(button => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const rawNodeId = button.dataset.nodeId;
                const numericNodeId = Number(rawNodeId);
                this.locateNodeInGraph(Number.isNaN(numericNodeId) ? rawNodeId : numericNodeId);
            });
        });

        const selectedMissing = sortedMissingModels.find(missing => this.getMissingModelKey(missing) === this.selectedMissingModelKey);
        if (!selectedMissing) return;

        const selectedIndex = sortedMissingModels.indexOf(selectedMissing);
        this.wireMissingModelDetail(container, selectedMissing, selectedIndex);
    }

    wireMissingModelDetail(container, missing, missingIndex) {
        this.wireLocalMatchButtons(container, missing, missingIndex);
        this.wireDownloadSearchPanel(container, missing);
        this.updateSelectedBarForMissing(missing);

        const locateId = `locate-${missing.node_id}-${missing.widget_index}`;
        const locateBtn = container.querySelector(`#${locateId}`);
        if (locateBtn && missing.is_top_level !== false) {
            locateBtn.addEventListener('click', () => {
                this.locateNodeInGraph(missing.node_id);
            });
        }

        const comboId = `combo-${missing.node_id}-${missing.widget_index}`;
        const comboInput = container.querySelector(`#combo-input-${comboId}`);
        const comboList = container.querySelector(`#combo-list-${comboId}`);
        const comboRefresh = container.querySelector(`#combo-refresh-${comboId}`);

        if (comboList) {
            this.enableWheelScrollChaining(comboList);
        }

        const allModels = Array.isArray(this.allModels) ? this.allModels : [];
        const buildLabel = (m) => `${m.category ? m.category + ': ' : ''}${m.relative_path || m.filename || ''}`;
        const getFolder = (m) => m.path || m.base_directory || '';

        const populateComboOptions = (filterText, highlightIdx = -1) => {
            if (!comboList) return;
            const f = (filterText || '').toLowerCase();
            const filtered = f
                ? allModels.filter(m => buildLabel(m).toLowerCase().includes(f))
                : allModels.slice();

            let html = '';
            for (let i = 0; i < filtered.length; i++) {
                const m = filtered[i];
                const label = buildLabel(m);
                const folder = getFolder(m);
                const isHighlighted = i === highlightIdx;
                const folderDisplay = folder ? folder.replace(/\\/g, '/').replace(/:/, '') : '';
                html += `<div data-idx="${allModels.indexOf(m)}" class="ml-combo-option ${isHighlighted ? 'is-highlighted' : ''}">`;
                html += `<div class="ml-combo-option-row">`;
                html += `<code>${this.escapeHtml(label)}</code>`;
                html += `</div>`;
                if (folderDisplay) {
                    html += `<div class="ml-combo-folder" data-tooltip="${this.escapeHtml(folderDisplay)}">Folder ${this.escapeHtml(folderDisplay)}</div>`;
                }
                html += `</div>`;
            }
            comboList.innerHTML = html;

            comboList.querySelectorAll('div[data-idx]').forEach(el => {
                el.addEventListener('click', () => {
                    const idx = parseInt(el.dataset.idx, 10);
                    if (!Number.isNaN(idx) && idx >= 0 && idx < allModels.length) {
                        const chosenModel = allModels[idx];
                        if (chosenModel) {
                            this.queueResolution(missing, chosenModel);
                        }
                    }
                });
            });
        };

        if (comboList) {
            populateComboOptions('');
        }

        if (comboInput) {
            const debouncedFilter = this.debounce(() => {
                populateComboOptions(comboInput.value);
            }, 200);
            comboInput.addEventListener('input', debouncedFilter);
            comboInput.addEventListener('focus', () => {
                if (comboList) {
                    comboList.classList.remove('ml-is-hidden');
                    comboList.classList.add('ml-is-visible');
                }
                populateComboOptions(comboInput.value);
            });
            comboInput.addEventListener('blur', () => {
                setTimeout(() => {
                    if (comboList) {
                        comboList.classList.remove('ml-is-visible');
                        comboList.classList.add('ml-is-hidden');
                    }
                }, 200);
            });
        }

        if (comboRefresh) {
            comboRefresh.addEventListener('click', async () => {
                this.allModels = null;
                await this.ensureAllModelsLoaded();
                populateComboOptions(comboInput?.value || '');
            });
        }

        const state = this.searchResultCache.get(this.getMissingSearchKey(missing));
        const searchResultsDiv = container.querySelector(`#search-results-${missing.node_id}-${missing.widget_index}`);
        if (state && searchResultsDiv && this.hasRenderableSearchState(state)) {
            searchResultsDiv.classList.remove('ml-is-hidden');
            searchResultsDiv.classList.add('ml-is-visible');
            this.displaySearchResults(missing, state, searchResultsDiv);
        }
    }

    /**
     * Display missing models in the dialog
     */
    displayMissingModels(container, data) {
        const missingModels = data.missing_models || [];
        const totalMissing = data.total_missing || 0;
        this.missingModels = missingModels;
        
        // Check if there are active downloads
        const activeCount = Object.keys(this.activeDownloads).length;
        
        // Check if any model has a 100% confidence match
        const hasAny100Match = missingModels.some(m => 
            (m.matches || []).some(match => match.confidence === 100)
        );
        
        // Show/hide Auto-Link button based on whether 100% matches exist
        if (this.autoResolveButton) {
            this.autoResolveButton.style.display = hasAny100Match ? 'inline-flex' : 'none';
        }
        
        // Hide download all button if no missing models
        if (this.downloadAllButton) {
            this.downloadAllButton.style.display = totalMissing > 0 ? 'inline-flex' : 'none';
        }

        if (totalMissing === 0 && activeCount === 0) {
            container.innerHTML = this.renderStatusMessage('All models are available! No missing models found.', 'success');
            return;
        }
        
        // If no missing models but downloads are active, show a waiting message
        if (totalMissing === 0 && activeCount > 0) {
            container.innerHTML = this.renderStatusMessage(
                `${activeCount} download${activeCount > 1 ? 's' : ''} in progress. Models will be auto-linked when complete.`,
                'info'
            );
            return;
        }

        // Skip rendering if active tab is not "missing"
        if (this.activeTab !== 'missing') {
            container.innerHTML = '';
            return;
        }

        // Sort missing models: those with 100% confidence matches first, then others
        const sortedMissingModels = [...missingModels].sort((a, b) => {
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
            totalMissing,
            activeCount,
            hasAny100Match
        );
        this.wireMissingModelsBrowser(container, data, sortedMissingModels);
    }

    renderMissingModel(missing, missingIndex = 0) {
        const allMatches = missing.matches || [];
        
        // Filter out matches below 70% confidence threshold
        const filteredMatches = allMatches.filter(m => m.confidence >= 70);
        const hasMatches = filteredMatches.length > 0;
        
        // Calculate 100% matches upfront (needed for download section)
        const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
        const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);
        
        // Format the missing filename for display
        const missingFilename = this.formatFilename(missing.original_path, 60);
        
        // Determine node info for the chip
        const nodeDisplay = this.getMissingNodeDisplay(missing);
        const nodeChipText = this.escapeHtml(nodeDisplay.text);
        
        // Start card
        let html = `<div class="ml-card">`;
        
        // Card Header: Filename as headline + node chip
        html += `<div class="ml-card-header">`;
        html += `<div class="ml-card-title-wrap">`;
        
        const titleMetaParts = [];
        let titlePrimaryHtml = `<span class="ml-card-title-primary" data-tooltip="${this.escapeHtml(missingFilename.full)}">${missingFilename.display}</span>`;
        let titleSecondaryHtml = '';
        
        const modelId = missing.urn_model_id || missing.urn?.model_id;
        const versionId = missing.urn_version_id || missing.urn?.version_id;
        const modelUrl = missing.is_urn && modelId ? `https://civitai.com/models/${modelId}${versionId ? '?modelVersionId=' + versionId : ''}` : '';
        const urnLoadingId = `urn-loading-${missing.node_id}-${missing.widget_index}`;

        if (missing.is_urn) {
            titleMetaParts.push(`<span class="ml-card-title-eyebrow" data-tooltip="${this.escapeHtml(missingFilename.full)}">${missingFilename.display}</span>`);
        }
        
        if (missing.is_urn && !missing.civitai_info) {
            // URN without info - show Loading and fetch async in background
            titlePrimaryHtml = `<span class="ml-card-title-primary" id="${urnLoadingId}">Resolving CivitAI model...</span>`;
            setTimeout(() => this.resolveUrnAsync(modelId, versionId, urnLoadingId, modelUrl), 10);
        } else if (missing.is_urn && missing.civitai_info) {
            // URN with resolved info - show model name/version
            const civitaiInfo = missing.civitai_info;
            const civitaiLabelHtml = this.renderVersionedModelNameHtml(civitaiInfo.model_name, civitaiInfo.version_name);
            if (civitaiLabelHtml) {
                const linkHtml = modelUrl ? `<a href="${modelUrl}" target="_blank" class="ml-inline-civitai-link">${civitaiLabelHtml}</a>` : `<span class="ml-inline-civitai-link">${civitaiLabelHtml}</span>`;
                titlePrimaryHtml = `<span class="ml-card-title-primary">${linkHtml}</span>`;
            }
            if (civitaiInfo.expected_filename) {
                titleSecondaryHtml = `<span class="ml-card-title-secondary">Expected file: ${civitaiInfo.expected_filename}</span>`;
            }
        }
        
        html += `<div class="ml-card-title-meta">`;
        html += titleMetaParts.join('');
        html += `<h3 class="ml-card-title">${titlePrimaryHtml}</h3>`;
        if (titleSecondaryHtml) {
            html += titleSecondaryHtml;
        }
        html += `</div>`;
        const locateId = `locate-${missing.node_id}-${missing.widget_index}`;
        const nodeChipClasses = missing.is_top_level !== false ? 'ml-node-chip is-locatable' : 'ml-node-chip';
        const nodeChipTitle = missing.is_top_level !== false ? 'Center this node in the ComfyUI graph.' : '';

        html += `<div class="ml-card-subtitle">`;
        if (missing.category) {
            html += `<span class="ml-category-chip ${this.getModelTypeColorClass(missing.category)}" data-tooltip="${this.escapeHtml(missing.category)}">${this.getCategoryDisplayName(missing.category)}</span>`;
        }
        html += `<span id="${locateId}" class="${nodeChipClasses}"${nodeChipTitle ? ` data-tooltip="${this.escapeHtml(nodeChipTitle)}"` : ''}>`;
        if (missing.is_top_level !== false) {
            html += this.getLocateIconHtml();
        }
        html += `${nodeChipText}</span>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        
        // Selected bar - shows if this slot has a queued selection (BELOW card header)
        const selectedBarId = `selected-bar-${missing.node_id}-${missing.widget_index}`;
        html += `<div id="${selectedBarId}" class="model-linker-selected"></div>`;
        
        // Two-column layout
        html += `<div class="ml-columns">`;
        
        // LEFT COLUMN: Local Matches
        html += `<div class="ml-column">`;
        html += `<div class="ml-column-header">Local Matches</div>`;
        html += `<div id="local-matches-body-${missing.node_id}-${missing.widget_index}">`;
        html += this.renderLocalMatchesContent(missing, missingIndex);
        html += `</div>`;
        
        // Add all-models search picker - combo-style dropdown
        const comboId = `combo-${missing.node_id}-${missing.widget_index}`;
        html += `<div class="ml-combo-section">`;
        html += `<div class="ml-combo-row">`;
        html += `<label class="ml-combo-label">Model</label>`;
        html += `<input id="combo-input-${comboId}" class="ml-combo-input" type="text" placeholder="Type to filter local models...">`;
        html += `<button id="combo-refresh-${comboId}" type="button" aria-label="Reload local model list" data-tooltip="Reload local model list" class="ml-btn ml-btn-secondary ml-btn-sm ml-btn-icon-only ml-combo-refresh-btn">${getSvgIcon('refreshCw', 'currentColor', 'ml-combo-refresh-icon')}</button>`;
        html += `</div>`;
        html += `<div id="combo-list-${comboId}" class="ml-combo-list"></div>`;
        html += `</div>`;
        
        html += `</div>`; // End left column
        
        // RIGHT COLUMN: Download Option
        html += `<div class="ml-column">`;
        html += `<div class="ml-column-header">Download</div>`;
        
        const filename = missing.original_path?.split('/').pop()?.split('\\').pop() || '';
        const downloadSource = missing.download_source;
        const urnDownloadId = `urn-download-${missing.node_id}-${missing.widget_index}`;
        
        if (perfectMatches.length > 0) {
            // Has perfect local match - download not needed, but allow online re-check.
            html += `<div class="ml-download-section">`;
            html += this.renderSearchControls(missing, { buttonText: 'Search Online' });
            html += this.renderDownloadTargetControls(missing, missing.category || 'checkpoints');
            html += `</div>`;
            html += `<div id="search-results-${missing.node_id}-${missing.widget_index}" class="ml-search-results"></div>`;
        } else if (downloadSource && downloadSource.url) {
            html += this.renderKnownDownloadPanel(missing, downloadSource);
        } else if (missing.is_urn) {
            html += `<div id="${urnDownloadId}" class="ml-download-section">`;
            html += `<div class="ml-download-info">Resolving CivitAI download for this URN...</div>`;
            html += `</div>`;
        } else {
            // No known download - offer search
            html += `<div class="ml-download-section">`;
            html += this.renderSearchControls(missing);
            html += this.renderDownloadTargetControls(missing, missing.category || 'checkpoints');
            html += `</div>`;
            html += `<div id="search-results-${missing.node_id}-${missing.widget_index}" class="ml-search-results"></div>`;
        }
        
        // Progress container (for downloads)
        html += `<div id="download-progress-${missing.node_id}-${missing.widget_index}" class="ml-download-progress-slot"></div>`;
        
        html += `</div>`; // End right column
        html += `</div>`; // End columns
        
        html += `</div>`; // End card
        return html;
    }

    /**
     * Show a notification banner (similar to ComfyUI's "Reconnecting" banner)
     */
    showNotification(message, type = 'success') {
        // Build children array, filtering out nulls
        const children = [];
        
        if (type === 'success') {
            children.push($el("span", {
                textContent: "✓",
                className: "ml-notification-icon"
            }));
        } else if (type === 'error') {
            children.push($el("span", {
                textContent: "×",
                className: "ml-notification-icon"
            }));
        } else if (type === 'info') {
            children.push($el("span", {
                textContent: "ℹ",
                className: "ml-notification-icon"
            }));
        }
        
        // Create notification banner
        const notification = $el("div", {
            className: `ml-notification ml-notification--${type}`
        }, [
            ...children,
            $el("span", {
                textContent: message
            }),
            $el("button", {
                className: "ml-notification-close",
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
    }

    /**
     * Resolve a model - resolves ALL nodes that reference this model
     */
    async resolveModel(missing, resolvedModel) {
        console.log('resolveModel called:', missing?.original_path, '->', resolvedModel?.filename);
        
        if (!resolvedModel) {
            this.showNotification('No resolved model selected', 'error');
            return;
        }

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            // Resolve ALL nodes that need this model (all_node_refs contains deduplicated refs)
            const nodeRefs = missing.all_node_refs || [missing];
            console.log('nodeRefs count:', nodeRefs?.length, 'is_lora_v2:', nodeRefs?.[0]?.is_lora_v2);
            
            const resolutions = nodeRefs.map(ref => ({
                node_id: ref.node_id,
                widget_index: ref.widget_index,
                resolved_path: resolvedModel.path,
                category: ref.category,
                resolved_model: resolvedModel,
                subgraph_id: ref.subgraph_id,
                is_top_level: ref.is_top_level,
                is_lora_v2: ref.is_lora_v2,
                original_lora_name: ref.name || ref.original_path
            }));

            const response = await api.fetchApi('/model_linker/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow,
                    resolutions: resolutions
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            console.log('Resolve response: success=', data.success, ' missing count:', data.workflow?.nodes?.length);
            
            if (data.success) {
                // Update workflow in ComfyUI
                await this.updateWorkflowInComfyUI(data.workflow);
                
                // Show success notification
                const modelName = resolvedModel.relative_path || resolvedModel.filename || 'model';
                const count = resolutions.length;
                const refText = count > 1 ? ` (${count} references)` : '';
                this.showNotification(`✓ Model linked successfully: ${modelName}${refText}`, 'success');
                
                // Reload dialog using the updated workflow from API response
                // This ensures we're analyzing the correct updated workflow
                await this.loadWorkflowData(data.workflow);
            } else {
                this.showNotification('Failed to resolve model: ' + (data.error || 'Unknown error'), 'error');
            }

        } catch (error) {
            console.error('Model Linker: Error resolving model:', error);
            this.showNotification('Error resolving model: ' + error.message, 'error');
        }
    }

    /**
     * Auto-resolve all 100% confidence matches
     * @returns {object|null} The updated workflow if successful, null otherwise
     */
    async autoResolve100Percent() {
        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return null;
            }

            // Analyze workflow first
            const analyzeResponse = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!analyzeResponse.ok) {
                throw new Error(`API error: ${analyzeResponse.status}`);
            }

            const analyzeData = await analyzeResponse.json();
            const missingModels = analyzeData.missing_models || [];

            // Collect all 100% matches
            const resolutions = [];
            for (const missing of missingModels) {
                const matches = missing.matches || [];
                const perfectMatch = matches.find((m) => m.confidence === 100);
                
                if (perfectMatch && perfectMatch.model) {
                    resolutions.push({
                        node_id: missing.node_id,
                        widget_index: missing.widget_index,
                        resolved_path: perfectMatch.model.path,
                        category: missing.category,
                        resolved_model: perfectMatch.model,
                        subgraph_id: missing.subgraph_id,  // Include subgraph_id for subgraph nodes
                        is_top_level: missing.is_top_level,  // True for top-level nodes, False for nodes in subgraph definitions
                        is_lora_v2: missing.is_lora_v2,
                        original_lora_name: missing.name || missing.original_path
                    });
                }
            }

            if (resolutions.length === 0) {
                this.showNotification('No 100% confidence matches found to auto-resolve.', 'error');
                return null;
            }

            // Apply resolutions
            const resolveResponse = await api.fetchApi('/model_linker/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow,
                    resolutions
                })
            });

            if (!resolveResponse.ok) {
                throw new Error(`API error: ${resolveResponse.status}`);
            }

            const resolveData = await resolveResponse.json();
            
            if (resolveData.success) {
                // Update workflow in ComfyUI
                await this.updateWorkflowInComfyUI(resolveData.workflow);
                
                // Show success notification
                this.showNotification(
                    `✓ Successfully linked ${resolutions.length} model${resolutions.length > 1 ? 's' : ''}!`,
                    'success'
                );
                
                // Reload dialog using the updated workflow from API response (if dialog is visible)
                if (this.contentElement) {
                    await this.loadWorkflowData(resolveData.workflow);
                }
                
                // Return the updated workflow for callers who need it
                return resolveData.workflow;
            } else {
                this.showNotification('Failed to resolve models: ' + (resolveData.error || 'Unknown error'), 'error');
                return null;
            }

        } catch (error) {
            console.error('Model Linker: Error auto-resolving:', error);
            this.showNotification('Error auto-resolving: ' + error.message, 'error');
            return null;
        }
    }

    /**
     * Download all missing models that have download sources but no 100% local match
     */
    async downloadAllMissing() {
        if (!this.contentElement) return;

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            // Analyze workflow first
            const analyzeResponse = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!analyzeResponse.ok) {
                throw new Error(`API error: ${analyzeResponse.status}`);
            }

            const analyzeData = await analyzeResponse.json();
            const missingModels = analyzeData.missing_models || [];

            // Collect models that need downloading:
            // - Have a download_source with valid URL
            // - Do NOT have any 100% confidence local matches
            const toDownload = [];
            for (const missing of missingModels) {
                const perfectMatches = (missing.matches || []).filter(m => m.confidence === 100);
                
                // Skip if has 100% local match or no download source
                if (perfectMatches.length > 0 || !missing.download_source?.url) {
                    continue;
                }
                
                toDownload.push(missing);
            }

            if (toDownload.length === 0) {
                this.showNotification('No models available for download (all have local matches or no download URLs).', 'info');
                return;
            }

            // Start all downloads
            this.showNotification(`Starting ${toDownload.length} download${toDownload.length > 1 ? 's' : ''}...`, 'info');
            
            for (const missing of toDownload) {
                // Use downloadModel which handles progress tracking
                this.downloadModel(missing);
            }
            
            // Update button state to show Cancel All
            this.updateDownloadAllButtonState();

        } catch (error) {
            console.error('Model Linker: Error in downloadAllMissing:', error);
            this.showNotification('Error starting downloads: ' + error.message, 'error');
        }
    }

    /**
     * Auto-resolve a model after download completes
     * Reloads the workflow analysis and resolves if the downloaded model is found
     */
    async autoResolveAfterDownload(missing, downloadedFilename) {
        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                // Just reload the UI to show updated state
                await this.loadWorkflowData();
                return;
            }

            // Re-analyze workflow to find the newly downloaded model
            const analyzeResponse = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!analyzeResponse.ok) {
                // Just reload UI
                await this.loadWorkflowData();
                return;
            }

            const analyzeData = await analyzeResponse.json();
            const missingModels = analyzeData.missing_models || [];

            // Find the missing model entry that matches our download by filename
            const targetMissing = missingModels.find(m => {
                const missingFilename = m.original_path?.split('/').pop()?.split('\\').pop() || '';
                return missingFilename.toLowerCase() === downloadedFilename.toLowerCase();
            });

            if (!targetMissing) {
                // Model no longer missing - already resolved or workflow changed
                await this.loadWorkflowData();
                return;
            }

            // Look for a 100% match with the downloaded filename
            const matches = targetMissing.matches || [];
            const perfectMatch = matches.find(m => {
                const matchFilename = m.filename || m.model?.filename || '';
                // Check for exact match or 100% confidence
                return m.confidence === 100 || 
                       matchFilename.toLowerCase() === downloadedFilename.toLowerCase();
            });

            if (perfectMatch && perfectMatch.model) {
                // Auto-resolve ALL nodes that need this model
                // all_node_refs contains all nodes referencing this model (deduplicated)
                const nodeRefs = targetMissing.all_node_refs || [targetMissing];
                const resolutions = nodeRefs.map(ref => ({
                    node_id: ref.node_id,
                    widget_index: ref.widget_index,
                    resolved_path: perfectMatch.model.path,
                    category: ref.category,
                    resolved_model: perfectMatch.model,
                    subgraph_id: ref.subgraph_id,
                    is_top_level: ref.is_top_level,
                    is_lora_v2: ref.is_lora_v2,
                    original_lora_name: ref.name || ref.original_path
                }));

                const resolveResponse = await api.fetchApi('/model_linker/resolve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        workflow,
                        resolutions: resolutions
                    })
                });

                if (resolveResponse.ok) {
                    const resolveData = await resolveResponse.json();
                    if (resolveData.success) {
                        await this.updateWorkflowInComfyUI(resolveData.workflow);
                        const count = resolutions.length;
                        this.showNotification(`✓ Auto-resolved: ${downloadedFilename} (${count} reference${count > 1 ? 's' : ''})`, 'success');
                        await this.loadWorkflowData(resolveData.workflow);
                        return;
                    }
                }
            }

            // If we couldn't auto-resolve, just reload the UI
            await this.loadWorkflowData();

        } catch (error) {
            console.error('Model Linker: Error auto-resolving after download:', error);
            // Still reload UI even on error
            await this.loadWorkflowData();
        }
    }

    /**
     * Download a model from a known source
     */
    async downloadModel(missing) {
        const source = missing.download_source;
        if (!source || !source.url) {
            this.showNotification('No download URL available', 'error');
            return;
        }

        // Use filename from download source if available (may be different from original)
        const originalFilename = missing.original_path?.split('/').pop()?.split('\\').pop() || 'model.safetensors';
        const filename = source.filename || originalFilename;
        const targetSelection = this.getDownloadTargetSelection(missing, source.directory || missing.category || 'checkpoints');
        const category = targetSelection.category;
        const subfolder = targetSelection.subfolder;
        const progressId = `download-progress-${missing.node_id}-${missing.widget_index}`;
        const progressDiv = this.contentElement?.querySelector(`#${progressId}`);
        const downloadBtn = this.contentElement?.querySelector(`#download-${missing.node_id}-${missing.widget_index}`);
        const tokens = this.getStoredTokens();

        try {
            // Disable button and show progress with cancel button immediately
            if (downloadBtn) {
                downloadBtn.disabled = true;
                downloadBtn.classList.remove('ml-is-success-action', 'ml-btn-primary');
                downloadBtn.textContent = 'Starting...';
            }
            if (progressDiv) {
                progressDiv.classList.remove('ml-is-hidden');
                progressDiv.classList.add('ml-is-visible');
                // Show progress bar with cancel button immediately
                progressDiv.innerHTML = this.renderProgressWithAction({
                    percent: 0,
                    leftText: '<span class="ml-info-accent-text">Connecting...</span>',
                    rightText: '',
                    actionClass: 'cancel-download-btn-pending ml-btn ml-btn-danger ml-btn-sm',
                    actionText: 'Cancel'
                });
            }

            // Start download
            const response = await api.fetchApi('/model_linker/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: source.url,
                    filename: filename,
                    category: category,
                    subfolder: subfolder,
                    hf_token: tokens.hf_token,
                    civitai_key: tokens.civitai_key
                })
            });

            if (!response.ok) {
                throw new Error(`Download failed: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Download failed');
            }

            // Track download and poll for progress
            const downloadId = data.download_id;
            this.activeDownloads[downloadId] = { missing, progressDiv, downloadBtn };
            
            // Update the Download All button state
            this.updateDownloadAllButtonState();
            
            // Attach cancel handler to pending button (before polling replaces it)
            const pendingCancelBtn = progressDiv?.querySelector('.cancel-download-btn-pending');
            if (pendingCancelBtn) {
                pendingCancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
            }
            
            this.pollDownloadProgress(downloadId);

        } catch (error) {
            console.error('Model Linker: Download error:', error);
            if (progressDiv) {
                progressDiv.innerHTML = this.renderStatusMessage(error.message, 'error');
            }
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.classList.remove('ml-is-success-action', 'ml-btn-primary');
                downloadBtn.innerHTML = '<span class="ml-btn-icon">☁</span> Retry';
            }
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }

    /**
     * Poll download progress
     */
    async pollDownloadProgress(downloadId) {
        const info = this.activeDownloads[downloadId];
        if (!info) return;

        try {
            const response = await api.fetchApi(`/model_linker/progress/${downloadId}`);
            if (!response.ok) {
                throw new Error('Failed to get progress');
            }

            const progress = await response.json();
            const { progressDiv, downloadBtn, missing } = info;

            if (progress.status === 'downloading' || progress.status === 'starting') {
                const percent = progress.progress || 0;
                const downloaded = this.formatBytes(progress.downloaded || 0);
                const total = this.formatBytes(progress.total_size || 0);
                const speed = progress.speed ? this.formatBytes(progress.speed) + '/s' : '';
                
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderProgressWithAction({
                        percent,
                        leftText: `${downloaded} / ${total} (${percent}%)`,
                        rightText: speed,
                        actionClass: 'cancel-download-btn ml-btn ml-btn-danger ml-btn-sm',
                        actionText: 'Cancel',
                        actionDataAttr: `data-download-id="${downloadId}"`
                    });
                    // Attach cancel handler
                    const cancelBtn = progressDiv.querySelector('.cancel-download-btn');
                    if (cancelBtn && !cancelBtn._hasListener) {
                        cancelBtn._hasListener = true;
                        cancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
                    }
                }
                if (downloadBtn) {
                    downloadBtn.textContent = `${percent}%`;
                }

                // Continue polling
                setTimeout(() => this.pollDownloadProgress(downloadId), 1000);

            } else if (progress.status === 'completed') {
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderStatusMessage('Download complete! Auto-linking...', 'success');
                }
                if (downloadBtn) {
                    downloadBtn.textContent = '✓ Done';
                    downloadBtn.classList.remove('ml-is-success-action');
                    downloadBtn.classList.add('ml-btn-primary');
                }
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();
                this.showNotification(`Downloaded: ${progress.filename}`, 'success');
                
                // Auto-resolve: Reload workflow data and try to resolve the downloaded model
                // Small delay to ensure file system is updated
                setTimeout(async () => {
                    await this.autoResolveAfterDownload(missing, progress.filename);
                }, 500);

            } else if (progress.status === 'error') {
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderStatusMessage(progress.error || 'Download failed', 'error');
                }
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.classList.remove('ml-is-success-action', 'ml-btn-primary');
                    downloadBtn.textContent = 'Retry';
                }
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();

            } else if (progress.status === 'cancelled') {
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderStatusMessage('Download cancelled - incomplete file removed', 'warning');
                }
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.classList.remove('ml-is-success-action', 'ml-btn-primary');
                    downloadBtn.innerHTML = '<span class="ml-btn-icon">☁</span> Download';
                }
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();
                this.showNotification('Download cancelled', 'info');

            } else {
                // Unknown status, keep polling
                setTimeout(() => this.pollDownloadProgress(downloadId), 500);
            }

        } catch (error) {
            console.error('Model Linker: Progress poll error:', error);
            const info = this.activeDownloads[downloadId];
            // Update UI to show error state instead of just disappearing
            if (info) {
                const { progressDiv, downloadBtn } = info;
                if (progressDiv) {
                    progressDiv.innerHTML = this.renderStatusMessage('Connection lost - download may have failed', 'error');
                }
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = 'Retry';
                    downloadBtn.classList.remove('ml-btn-primary');
                    downloadBtn.classList.add('ml-is-success-action');
                }
            }
            delete this.activeDownloads[downloadId];
            this.updateDownloadAllButtonState();
        }
    }

    /**
     * Cancel an active download
     */
    async cancelDownload(downloadId) {
        try {
            const response = await api.fetchApi(`/model_linker/cancel/${downloadId}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error('Failed to cancel download');
            }
            
            const info = this.activeDownloads[downloadId];
            if (info?.progressDiv) {
                info.progressDiv.innerHTML = this.renderStatusMessage('Cancelling download...', 'info');
            }
            
        } catch (error) {
            console.error('Model Linker: Cancel error:', error);
            this.showNotification('Failed to cancel download', 'error');
        }
    }

    /**
     * Search online for a model
     */
    async searchOnline(missing) {
        let filename = missing.original_path?.split('/').pop()?.split('\\').pop() || '';
        let category = missing.category || '';
        const state = this.getSearchState(missing);
        const selectedSource = state.selectedSource || 'all';
        const selectedSourceLabel = this.getSearchSourceLabel(selectedSource);
        const sourceIds = this.getSearchSourcesForSelection(selectedSource, missing);
        
        // For URNs, use the resolved file/model name for searching instead of the URN itself
        // and pass the URN type as category (CivitAI expects specific type names)
        if (missing.is_urn) {
            const urnSearchName = missing.civitai_info?.expected_filename
                || missing.download_source?.filename
                || missing.civitai_info?.model_name;
            if (urnSearchName) {
                filename = urnSearchName;
            }
            // Pass URN type directly - CivitAPI expects types like 'Upscaler', 'Checkpoint'
            const urnType = missing.urn_type || '';
            if (urnType) {
                // Map URN types to CivitAI type names
                const typeMap = {
                    'checkpoint': 'Checkpoint',
                    'lora': 'LORA',
                    'vae': 'VAE',
                    'upscaler': 'Upscaler',
                    'upscale_model': 'Upscaler',
                    'embedding': 'TextualInversion',
                    'controlnet': 'Controlnet'
                };
                const civitaiType = typeMap[urnType.toLowerCase()];
                if (civitaiType) {
                    category = civitaiType;
                }
            }
        }
        
        const isUrn = missing.is_urn || false;
        const resultsId = `search-results-${missing.node_id}-${missing.widget_index}`;
        const resultsDiv = this.contentElement?.querySelector(`#${resultsId}`);
        const searchBtn = this.contentElement?.querySelector(`#search-${missing.node_id}-${missing.widget_index}`);
        let searchRunId = null;

        try {
            if (!sourceIds.length) {
                throw new Error(`${selectedSourceLabel} is not available in this install`);
            }

            this.clearSearchProgressTimers(state.activeSearchRunId);
            searchRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            state.activeSearchRunId = searchRunId;
            state.lastAttemptSources = sourceIds;
            state.lastAttemptFound = null;
            state.lastAttemptError = null;
            state.sourceProgress = {};
            for (const source of sourceIds) {
                this.setSourceProgress(state, source, {
                    status: 'running',
                    percent: 6,
                    startedAt: Date.now(),
                    estimateMs: this.getSearchSourceEstimateMs(source, isUrn)
                }, missing);
            }

            if (searchBtn) {
                searchBtn.disabled = true;
                searchBtn.innerHTML = `${this.getSearchIconHtml()} Searching ${selectedSourceLabel}...`;
            }
            if (resultsDiv) {
                resultsDiv.classList.remove('ml-is-hidden');
                resultsDiv.classList.add('ml-is-visible');
                this.displaySearchResults(missing, state, resultsDiv);
            }
            for (const source of sourceIds) {
                this.startEstimatedSearchProgress(
                    state,
                    missing,
                    resultsDiv,
                    source,
                    searchRunId
                );
            }

            // For URNs, include model_id and version_id for direct download
            const tokens = this.getStoredTokens();
            const baseSearchData = {
                filename,
                category,
                is_urn: isUrn,
                civitai_session_token: tokens.civitai_session_token,
                civitai_candidate_limit: tokens.civitai_candidate_limit,
                civitai_use_trpc_search: tokens.civitai_use_trpc_search,
                civitai_use_html_fallback: tokens.civitai_use_html_fallback,
                hf_token: tokens.hf_token,
                brave_search_api_key: tokens.brave_search_api_key,
                hf_use_api_search: tokens.hf_use_api_search,
                hf_use_comfy_org_fallback: tokens.hf_use_comfy_org_fallback,
                hf_use_brave_fallback: tokens.hf_use_brave_fallback
            };
            if (isUrn && missing.urn) {
                baseSearchData.model_id = missing.urn.model_id;
                baseSearchData.version_id = missing.urn.version_id;
            }

            const attemptedSources = new Set();
            let anyFound = false;
            let hadError = false;

            const searchPromises = sourceIds.map(async (source) => {
                const sourceIsUrn = isUrn && source !== 'lora_manager_archive';
                const searchData = {
                    ...baseSearchData,
                    is_urn: sourceIsUrn,
                    sources: [source]
                };

                try {
                    console.log('Model Linker: Search request:', JSON.stringify(searchData));

                    const response = await api.fetchApi('/model_linker/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(searchData)
                    });

                    if (!response.ok) {
                        throw new Error(`Search failed: ${response.status}`);
                    }

                    const data = await response.json();
                    console.log('Model Linker: Search response:', JSON.stringify(data));

                    if (state.activeSearchRunId !== searchRunId) {
                        return { source, stale: true };
                    }

                    const responseSources = Array.isArray(data.searched_sources) && data.searched_sources.length
                        ? data.searched_sources
                        : [source];
                    responseSources.forEach(responseSource => attemptedSources.add(responseSource));

                    const found = this.hasSearchResults(data);
                    anyFound = anyFound || found;
                    state.results = this.mergeSearchResults(state.results, data);
                    state.lastAttemptSources = Array.from(attemptedSources);
                    state.lastAttemptFound = anyFound;
                    this.clearSearchProgressTimer(searchRunId, source);
                    this.setSourceProgress(state, source, {
                        status: found ? 'found' : 'none',
                        percent: 100,
                        message: found ? 'Found' : 'No match'
                    }, missing);

                    if (data.civitai) {
                        missing.civitai_search_result = {
                            base_model: data.civitai.base_model,
                            tags: data.civitai.tags || [],
                            trained_words: data.civitai.trained_words || [],
                            filename: data.civitai.filename,
                            name: data.civitai.name,
                            type: data.civitai.type
                        };
                    }

                    this.displaySearchResults(missing, state, resultsDiv);
                    this.applySearchResultSuggestion(missing);
                    return { source, data };
                } catch (error) {
                    console.error(`Model Linker: Search error for ${source}:`, error);
                    if (state.activeSearchRunId !== searchRunId) {
                        return { source, stale: true, error };
                    }

                    hadError = true;
                    attemptedSources.add(source);
                    state.lastAttemptSources = Array.from(attemptedSources);
                    state.lastAttemptFound = anyFound;
                    this.clearSearchProgressTimer(searchRunId, source);
                    this.setSourceProgress(state, source, {
                        status: 'error',
                        percent: 100,
                        message: error.message || 'Error'
                    }, missing);
                    this.displaySearchResults(missing, state, resultsDiv);
                    return { source, error };
                }
            });

            await Promise.all(searchPromises);
            this.clearSearchProgressTimers(searchRunId);

            if (state.activeSearchRunId === searchRunId) {
                state.activeSearchRunId = null;
                state.lastAttemptSources = attemptedSources.size ? Array.from(attemptedSources) : sourceIds;
                state.lastAttemptFound = anyFound;
                state.lastAttemptError = hadError && !anyFound
                    ? 'Search finished with errors. Check source statuses above.'
                    : null;
                this.displaySearchResults(missing, state, resultsDiv);
            }

        } catch (error) {
            console.error('Model Linker: Search error:', error);
            this.clearSearchProgressTimers(searchRunId);
            state.lastAttemptError = error.message;
            if (resultsDiv) {
                resultsDiv.innerHTML = this.renderStatusMessage(`Search failed: ${error.message}`, 'error');
            }
        } finally {
            if (!searchRunId || state.activeSearchRunId === searchRunId) {
                this.clearSearchProgressTimers(searchRunId);
                state.activeSearchRunId = null;
            }
            if (searchBtn) {
                searchBtn.disabled = false;
                searchBtn.innerHTML = `${this.getSearchIconHtml()} Search Again`;
            }
        }
    }

    /**
     * Resolve URN asynchronously - fetch CivitAI info and update UI
     */
    async resolveUrnAsync(modelId, versionId, loadingElementId, modelUrl) {
        console.log('resolveUrnAsync called:', modelId, versionId);
        if (!modelId || !versionId) {
            console.log('resolveUrnAsync: missing modelId or versionId');
            return;
        }
        
        try {
            const tokens = this.getStoredTokens();
            const payload = {
                filename: modelId + '_' + versionId,
                category: '',
                is_urn: true,
                sources: ['civitai'],
                model_id: modelId,
                version_id: versionId,
                civitai_candidate_limit: tokens.civitai_candidate_limit
            };
            console.log('resolveUrnAsync payload:', JSON.stringify(payload));
            
            const response = await api.fetchApi('/model_linker/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            console.log('resolveUrnAsync response status:', response.status);
            
            if (response.ok) {
                const data = await response.json();
                const loadingEl = document.getElementById(loadingElementId);
                if (loadingEl && data.civitai) {
                    loadingEl.classList.remove('ml-is-muted', 'ml-is-error');
                    const civitai = data.civitai;
                    const labelHtml = this.renderVersionedModelNameHtml(civitai.name, civitai.version_name)
                        || this.escapeHtml(civitai.filename || 'Model');
                    const url = modelUrl || `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`;
                    loadingEl.innerHTML = `<a href="${url}" target="_blank" class="ml-inline-civitai-link">${labelHtml}</a>`;
                } else if (loadingEl) {
                    loadingEl.textContent = 'Not found';
                    loadingEl.classList.remove('ml-is-error');
                    loadingEl.classList.add('ml-is-muted');
                }

                const downloadContainerId = loadingElementId.replace('urn-loading-', 'urn-download-');
                const downloadEl = document.getElementById(downloadContainerId);
                if (downloadEl && data.civitai?.download_url) {
                    const missing = this.missingModels.find(m =>
                        `urn-download-${m.node_id}-${m.widget_index}` === downloadContainerId
                    );
                    if (missing) {
                        missing.civitai_info = {
                            model_name: data.civitai.name,
                            version_name: data.civitai.version_name,
                            expected_filename: data.civitai.filename,
                            base_model: data.civitai.base_model,
                            tags: data.civitai.tags || []
                        };
                        missing.download_source = {
                            source: 'civitai',
                            url: data.civitai.download_url,
                            filename: data.civitai.filename,
                            name: data.civitai.name,
                            version_name: data.civitai.version_name,
                            type: data.civitai.type,
                            directory: missing.category || 'checkpoints',
                            match_type: 'exact',
                            size: data.civitai.size,
                            model_id: data.civitai.model_id || modelId,
                            version_id: data.civitai.version_id || versionId,
                            model_url: data.civitai.url || `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`,
                            base_model: data.civitai.base_model,
                            tags: data.civitai.tags || []
                        };
                        const downloadParent = downloadEl.parentElement;
                        downloadEl.outerHTML = this.renderKnownDownloadPanel(missing, missing.download_source);
                        this.wireDownloadSearchPanel(downloadParent || this.contentElement, missing);
                        this.refreshUrnLocalMatches(missing);
                    }
                } else if (downloadEl) {
                    downloadEl.innerHTML = `<div class="ml-download-info">Unable to resolve direct download for this URN.</div>`;
                }
            } else {
                const loadingEl = document.getElementById(loadingElementId);
                if (loadingEl) {
                    loadingEl.textContent = 'Error';
                    loadingEl.classList.remove('ml-is-muted');
                    loadingEl.classList.add('ml-is-error');
                }
                const downloadContainerId = loadingElementId.replace('urn-loading-', 'urn-download-');
                const downloadEl = document.getElementById(downloadContainerId);
                if (downloadEl) {
                    downloadEl.innerHTML = `<div class="ml-download-info">Failed to resolve URN download.</div>`;
                }
            }
        } catch (error) {
            console.error('Model Linker: URN resolve error:', error);
            const loadingEl = document.getElementById(loadingElementId);
            if (loadingEl) {
                loadingEl.textContent = 'Error';
                loadingEl.classList.remove('ml-is-muted');
                loadingEl.classList.add('ml-is-error');
            }
            const downloadContainerId = loadingElementId.replace('urn-loading-', 'urn-download-');
            const downloadEl = document.getElementById(downloadContainerId);
            if (downloadEl) {
                downloadEl.innerHTML = `<div class="ml-download-info">Failed to resolve URN download.</div>`;
            }
        }
    }

    wireSearchDownloadButtons(container, missing) {
        if (!container) return;

        const downloadBtns = container.querySelectorAll('.search-download-btn');
        downloadBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                const filename = btn.dataset.filename;
                const category = btn.dataset.category;
                this.downloadFromSearch(missing, url, filename, category, btn);
            });
        });

        const openPageBtns = container.querySelectorAll('.search-open-page-btn');
        openPageBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                if (!url) return;

                const opened = window.open(url, '_blank', 'noopener,noreferrer');
                if (opened) {
                    opened.opener = null;
                }
            });
        });
    }

    wireDownloadSearchPanel(container, missing) {
        if (!container) return;

        const searchResultsId = `search-results-${missing.node_id}-${missing.widget_index}`;
        const searchResultsDiv = container.querySelector(`#${searchResultsId}`);
        if (searchResultsDiv) {
            this.wireSearchDownloadButtons(searchResultsDiv, missing);
        }

        const searchBtn = container.querySelector(`#search-${missing.node_id}-${missing.widget_index}`);
        if (searchBtn && searchBtn.dataset.mlSearchBound !== 'true') {
            searchBtn.dataset.mlSearchBound = 'true';
            searchBtn.addEventListener('click', () => {
                this.searchOnline(missing);
            });
        }

        const sourceSelect = container.querySelector(`#search-source-select-${missing.node_id}-${missing.widget_index}`);
        const sourceList = container.querySelector(`#search-source-list-${missing.node_id}-${missing.widget_index}`);
        if (sourceSelect && sourceList && sourceSelect.dataset.mlSearchSourceBound !== 'true') {
            sourceSelect.dataset.mlSearchSourceBound = 'true';

            const renderSourceOptions = () => {
                const options = this.getSearchSourceOptions();
                sourceList.innerHTML = options
                    .map(option => `<div class="ml-download-target-option" data-value="${encodeURIComponent(option.value)}" data-label="${encodeURIComponent(option.label)}">${this.escapeHtml(option.label)}</div>`)
                    .join('');
                sourceList.style.display = 'block';
                sourceList.querySelectorAll('.ml-download-target-option').forEach(optionEl => {
                    optionEl.addEventListener('mousedown', (event) => {
                        event.preventDefault();
                        const value = decodeURIComponent(optionEl.dataset.value || '');
                        const label = decodeURIComponent(optionEl.dataset.label || optionEl.dataset.value || '');
                        this.setDropdownValue(sourceSelect, value, label);
                        this.setSearchSource(missing, value, container);
                        sourceList.style.display = 'none';
                    });
                });
            };

            const hideSourceList = () => {
                setTimeout(() => {
                    sourceList.style.display = 'none';
                }, 150);
            };

            this.enableWheelScrollChaining(sourceList);
            sourceSelect.addEventListener('focus', () => renderSourceOptions());
            sourceSelect.addEventListener('click', () => renderSourceOptions());
            sourceSelect.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    renderSourceOptions();
                }
            });
            sourceSelect.addEventListener('blur', hideSourceList);
            this.syncSearchSourceUi(missing, container);
        }

        this.wireDownloadTargetAutocomplete(container, missing);
    }

    /**
     * Display search results
     */
    displaySearchResults(missing, state, container) {
        if (!container) return;

        const results = state?.results || {};
        const popular = results.popular;
        const modelListResult = results.model_list;
        const hfResult = results.huggingface ? (Array.isArray(results.huggingface) ? results.huggingface[0] : results.huggingface) : null;
        const civitaiResult = results.civitai ? (Array.isArray(results.civitai) ? results.civitai[0] : results.civitai) : null;
        const loraManagerArchiveResult = results.lora_manager_archive ? (Array.isArray(results.lora_manager_archive) ? results.lora_manager_archive[0] : results.lora_manager_archive) : null;
        const knownDownloadRow = this.getDownloadSourceTableRow(missing, missing.download_source);
        const hasResults = knownDownloadRow || popular || modelListResult || hfResult || civitaiResult || loraManagerArchiveResult;
        const progressHtml = this.renderSearchProgress(state);
        const hasActiveProgress = this.hasActiveSearchProgress(state);

        if (!hasResults) {
            if (hasActiveProgress) {
                container.innerHTML = progressHtml;
                return;
            }

            if (state?.lastAttemptError) {
                container.innerHTML = `${progressHtml}${this.renderStatusMessage(state.lastAttemptError, 'error')}`;
                return;
            }

            container.innerHTML = progressHtml || this.renderStatusMessage(
                'No matches found online for this model.',
                'warning'
            );
            return;
        }

        const rows = [];
        const rowKeys = new Set();
        const addRow = (row) => {
            if (!row) return;
            const rowKey = row.downloadUrl || row.openUrl || `${row.sourceKey}:${row.model}:${row.filename}`;
            if (rowKeys.has(rowKey)) return;
            rowKeys.add(rowKey);
            rows.push(row);
        };

        let statusHtml = '';
        if (!hasActiveProgress && state?.lastAttemptError) {
            statusHtml += this.renderStatusMessage(state.lastAttemptError, 'error');
        }

        addRow(knownDownloadRow);

        if (popular) {
            const popularFilename = popular.filename || missing.original_path?.split('/').pop()?.split('\\').pop() || '';
            addRow({
                sourceKey: 'popular',
                sourceLabel: 'Popular',
                model: popular.name || popularFilename,
                filename: popularFilename,
                secondary: popular.name && popular.name !== popularFilename ? popularFilename : '',
                match: this.getSearchResultMatchDisplay(popular, 'Known', 'strong'),
                size: this.formatSearchResultSize(popular),
                downloadUrl: popular.url,
                downloadFilename: popularFilename,
                category: popular.directory || missing.category,
                openUrl: this.getModelCardUrl(popular.url)
            });
        }

        if (modelListResult && modelListResult.url) {
            addRow({
                sourceKey: 'model-list',
                sourceLabel: 'Local Database',
                model: modelListResult.name || modelListResult.filename,
                filename: modelListResult.filename,
                secondary: modelListResult.name && modelListResult.name !== modelListResult.filename ? modelListResult.filename : '',
                match: this.getSearchResultMatchDisplay(modelListResult),
                size: this.formatSearchResultSize(modelListResult),
                downloadUrl: modelListResult.url,
                downloadFilename: modelListResult.filename,
                category: modelListResult.directory || missing.category,
                openUrl: this.getModelCardUrl(modelListResult.url)
            });
        }

        if (hfResult && hfResult.url) {
            const hfRepo = hfResult.repo_id || hfResult.repo || '';
            const hfModelUrl = hfRepo ? `https://huggingface.co/${hfRepo}` : this.getModelCardUrl(hfResult.url);
            addRow({
                sourceKey: 'huggingface',
                sourceLabel: 'HuggingFace',
                model: hfRepo || hfResult.filename,
                filename: hfResult.filename,
                secondary: hfResult.path && hfResult.path !== hfResult.filename ? hfResult.path : '',
                match: this.getSearchResultMatchDisplay(hfResult),
                size: this.formatSearchResultSize(hfResult),
                downloadUrl: hfResult.url,
                downloadFilename: hfResult.filename,
                category: missing.category,
                openUrl: hfModelUrl
            });
        }

        if (loraManagerArchiveResult && loraManagerArchiveResult.url) {
            const archiveFilename = loraManagerArchiveResult.filename || missing.original_path?.split('/').pop()?.split('\\').pop() || '';
            const archiveName = loraManagerArchiveResult.name || archiveFilename;
            addRow({
                sourceKey: 'lora-archive',
                sourceLabel: 'LoRA Archive',
                model: archiveName,
                version: loraManagerArchiveResult.version_name || '',
                filename: archiveFilename,
                secondary: archiveName && archiveName !== archiveFilename ? archiveFilename : '',
                match: this.getSearchResultMatchDisplay(loraManagerArchiveResult),
                size: this.formatSearchResultSize(loraManagerArchiveResult),
                downloadUrl: loraManagerArchiveResult.download_url || '',
                downloadFilename: archiveFilename,
                category: missing.category,
                openUrl: loraManagerArchiveResult.url
            });
        }

        if (civitaiResult && civitaiResult.download_url) {
            const modelUrl = civitaiResult.url || (civitaiResult.model_id ? `https://civitai.com/models/${civitaiResult.model_id}${civitaiResult.version_id ? `?modelVersionId=${civitaiResult.version_id}` : ''}` : '');
            const downloadFilename = missing.civitai_info?.expected_filename || civitaiResult.filename || civitaiResult.name;
            const modelName = missing.civitai_info?.model_name || civitaiResult.name || downloadFilename || 'Model';
            addRow({
                sourceKey: 'civitai',
                sourceLabel: 'CivitAI',
                model: modelName,
                version: missing.civitai_info?.version_name || civitaiResult.version_name || '',
                filename: downloadFilename,
                secondary: civitaiResult.type || civitaiResult.base_model || '',
                match: this.getSearchResultMatchDisplay(civitaiResult),
                size: this.formatSearchResultSize(civitaiResult),
                downloadUrl: civitaiResult.download_url,
                downloadFilename,
                category: missing.category,
                openUrl: modelUrl
            });
        }

        const html = `${progressHtml}${statusHtml}${this.renderSearchResultsTable(rows)}`;
        container.innerHTML = html;

        this.wireSearchDownloadButtons(container, missing);
    }

    /**
     * Download from search results
     */
    async downloadFromSearch(missing, url, filename, category, btn) {
        const progressId = `download-progress-${missing.node_id}-${missing.widget_index}`;
        const progressDiv = this.contentElement?.querySelector(`#${progressId}`);
        const tokens = this.getStoredTokens();
        const targetSelection = this.getDownloadTargetSelection(missing, category || missing.category || 'checkpoints');

        try {
            btn.disabled = true;
            btn.classList.remove('ml-is-success-action', 'ml-btn-primary');
            btn.textContent = 'Starting...';
            
            if (progressDiv) {
                progressDiv.classList.remove('ml-is-hidden');
                progressDiv.classList.add('ml-is-visible');
                // Show progress bar with cancel button immediately
                progressDiv.innerHTML = this.renderProgressWithAction({
                    percent: 0,
                    leftText: '<span class="ml-info-accent-text">Connecting...</span>',
                    rightText: '',
                    actionClass: 'cancel-download-btn-pending ml-btn ml-btn-danger ml-btn-sm',
                    actionText: 'Cancel'
                });
            }

            const response = await api.fetchApi('/model_linker/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    filename,
                    category: targetSelection.category,
                    subfolder: targetSelection.subfolder,
                    hf_token: tokens.hf_token,
                    civitai_key: tokens.civitai_key
                })
            });

            if (!response.ok) {
                throw new Error(`Download failed: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Download failed');
            }

            // Track and poll
            const downloadId = data.download_id;
            this.activeDownloads[downloadId] = { missing, progressDiv, downloadBtn: btn };
            
            // Update the Download All button state
            this.updateDownloadAllButtonState();
            
            // Attach cancel handler to pending button (before polling replaces it)
            const pendingCancelBtn = progressDiv?.querySelector('.cancel-download-btn-pending');
            if (pendingCancelBtn) {
                pendingCancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
            }
            
            this.pollDownloadProgress(downloadId);

        } catch (error) {
            console.error('Model Linker: Download error:', error);
            if (progressDiv) {
                progressDiv.innerHTML = this.renderStatusMessage(error.message, 'error');
            }
            btn.disabled = false;
            btn.classList.remove('ml-is-success-action', 'ml-btn-primary');
            btn.textContent = 'Retry';
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }

    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Extract model card URL from a download URL
     * HuggingFace: https://huggingface.co/Owner/Repo/resolve/main/file.safetensors -> https://huggingface.co/Owner/Repo
     * CivitAI: https://civitai.com/api/download/models/123?type=Model -> https://civitai.com/models/123
     */
    getModelCardUrl(downloadUrl) {
        if (!downloadUrl) return null;
        
        try {
            // HuggingFace URLs
            if (downloadUrl.includes('huggingface.co')) {
                // Extract owner/repo from URL
                const match = downloadUrl.match(/huggingface\.co\/([^\/]+\/[^\/]+)/);
                if (match) {
                    return `https://huggingface.co/${match[1]}`;
                }
            }
            
            // CivitAI URLs
            if (downloadUrl.includes('civitai.com')) {
                // Format: /api/download/models/123456 or /models/123456/...
                const modelIdMatch = downloadUrl.match(/models\/(\d+)/);
                if (modelIdMatch) {
                    return `https://civitai.com/models/${modelIdMatch[1]}`;
                }
            }
        } catch (e) {
            console.error('Error parsing model card URL:', e);
        }
        
        return null;
    }

    /**
     * Update workflow in ComfyUI's UI/memory
     * Updates the current workflow in place instead of creating a new tab
     */
    async updateWorkflowInComfyUI(workflow) {
        if (!app || !app.graph) {
            console.warn('Model Linker: Could not update workflow - app or app.graph not available');
            return;
        }

        try {
            // Method 1: Try to directly update the current graph using configure
            // This is the most direct way to update in place
            if (app.graph && typeof app.graph.configure === 'function') {
                app.graph.configure(workflow);
                return;
            }

            // Method 2: Try deserialize to update the graph in place
            if (app.graph && typeof app.graph.deserialize === 'function') {
                app.graph.deserialize(workflow);
                return;
            }

            // Method 3: Use loadGraphData with explicit parameters to update current tab
            // The key is to NOT create a new workflow - pass null or undefined for the workflow parameter
            // clean=false means don't clear the graph first
            // restore_view=false means don't restore the viewport
            // workflow=null means update current workflow instead of creating new one
            if (app.loadGraphData) {
                // Try with null as 4th parameter first
                await app.loadGraphData(workflow, false, false, null);
                return;
            }

            console.warn('Model Linker: No method available to update workflow');
        } catch (error) {
            console.error('Model Linker: Error updating workflow in ComfyUI:', error);
            // Don't throw - allow the workflow update to continue even if UI update fails
            // The backend has already updated the workflow data
        }
    }
}

// Main extension class
class ModelLinker {
    constructor() {
        this.linkerButton = null;
        this.buttonGroup = null;
        this.buttonId = "model-linker-button";
        this.sidebarTabId = "comfyui-model-linker";
        this.sidebarRegistered = false;
        this.openTooltip = "Open Model Linker to find or download missing workflow models. Shortcut: Ctrl+Shift+L.";
        this.dialog = null;
        this.isCheckingMissing = false;  // Prevent multiple simultaneous checks
        this.lastCheckedWorkflow = null;  // Track to avoid duplicate checks
    }

    setup = async () => {
        loadStylesWhenNeeded();

        // Remove any existing button
        this.removeExistingButton();

        // Create dialog instance
        if (!this.dialog) {
            this.dialog = new LinkerManagerDialog();
            window.modelLinkerDialog = this.dialog;
        }

        // Register keyboard shortcut (Ctrl+Shift+L)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                this.openLinkerManager();
            }
        });

        // Listen for workflow load events to auto-check for missing models
        this.setupAutoOpenOnMissingModels();

        const sidebarRegistered = this.registerSidebarButton();
        if (!sidebarRegistered) {
            await this.registerTopbarButton();
        } else {
            this.attachSidebarButtonToggleHandler();
        }
    }

    registerSidebarButton() {
        const registerSidebarTab = app.extensionManager?.registerSidebarTab;
        if (typeof registerSidebarTab !== "function") {
            return false;
        }

        if (this.sidebarRegistered || window.__modelLinkerSidebarRegistered) {
            this.sidebarRegistered = true;
            return true;
        }

        try {
            registerSidebarTab.call(app.extensionManager, {
                id: this.sidebarTabId,
                icon: "mdi mdi-link-variant",
                title: "Model Linker",
                tooltip: this.openTooltip,
                type: "custom",
                render: (element) => this.renderSidebarPanel(element),
            });
            this.sidebarRegistered = true;
            window.__modelLinkerSidebarRegistered = true;
            return true;
        } catch (error) {
            console.warn("Model Linker: Sidebar tab registration failed, falling back to top menu button.", error);
            return false;
        }
    }

    attachSidebarButtonToggleHandler() {
        window.__modelLinkerSidebarToggleOwner = this;
        if (window.__modelLinkerSidebarToggleHandlerAttached) return;

        window.__modelLinkerSidebarToggleHandlerAttached = true;
        window.__modelLinkerSidebarToggleHandler = (event) => {
            window.__modelLinkerSidebarToggleOwner?.handleSidebarButtonClick(event);
        };
        document.addEventListener('click', window.__modelLinkerSidebarToggleHandler, true);
    }

    handleSidebarButtonClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest(`.${this.sidebarTabId}-tab-button`);
        if (!(button instanceof HTMLElement)) return;
        if (!this.dialog?.isVisible()) return;

        const wasDocked = this.dialog.docked;
        this.dialog.close();

        if (!wasDocked) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();

            requestAnimationFrame(() => {
                if (this.isSidebarButtonActive(button)) {
                    button.click();
                }
            });
        }
    }

    isSidebarButtonActive(button) {
        return button.matches([
            '[aria-pressed="true"]',
            '[aria-selected="true"]',
            '[data-active="true"]',
            '[data-selected="true"]',
            '.active',
            '.is-active',
            '.selected',
            '.p-highlight'
        ].join(','));
    }

    renderSidebarPanel(element) {
        element.style.height = "100%";
        element.classList.add("ml-sidebar-dock-panel");

        if (!this.dialog) {
            this.dialog = new LinkerManagerDialog();
            window.modelLinkerDialog = this.dialog;
        }

        if (this.dialog.shouldOpenFromSidebarFloating()) {
            if (this.dialog.isVisible() && !this.dialog.docked) {
                this.dialog.close();
                this.dialog.closeComfySidebar(element);
                return;
            }

            this.openLinkerManager({
                forceFloating: true,
                closeSidebarContainer: element,
            });
            return;
        }

        element.replaceChildren();
        this.openLinkerManager({ dockContainer: element });
    }

    async registerTopbarButton() {
        // Try to use new ComfyUI button system (like ComfyUI Manager does)
        try {
            // Dynamic imports for ComfyUI's button components
            const { ComfyButtonGroup } = await import("../../../scripts/ui/components/buttonGroup.js");
            const { ComfyButton } = await import("../../../scripts/ui/components/button.js");

            // Create button group with Model Linker button
            const modelLinkerButton = new ComfyButton({
                icon: "link-variant",
                action: () => this.openLinkerManager(),
                content: "Model Linker",
                classList: "comfyui-button comfyui-menu-mobile-collapse"
            }).element;
            modelLinkerButton.id = this.buttonId;
            this.dialog.setTooltip(modelLinkerButton, this.openTooltip);
            this.buttonGroup = new ComfyButtonGroup(
                modelLinkerButton
            );

            // Insert before settings group in the menu
            app.menu?.settingsGroup.element.before(this.buttonGroup.element);
        } catch (e) {
            // Fallback for older ComfyUI versions without the new button system
            console.log('Model Linker: New button system not available, using floating button fallback.');
            this.createFloatingButton();
        }
    }

    /**
     * Setup auto-open functionality when workflow is loaded with missing models
     */
    setupAutoOpenOnMissingModels() {
        // Watch for ComfyUI's Missing Models popup and inject our button
        this.setupMissingModelsPopupObserver();

        console.log('Model Linker: Missing models popup button injection enabled');
    }

    /**
     * Setup MutationObserver to detect ComfyUI's Missing Models popup and inject our button
     */
    setupMissingModelsPopupObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.checkAndInjectButton(node);
                    }
                }
            }
        });

        // Observe the entire document for added nodes
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Check if a node is the Missing Models popup and inject our buttons
     */
    checkAndInjectButton(node) {
        // Look for the Missing Models popup by finding elements with "Missing Models" text
        const findMissingModelsDialog = (element) => {
            // Check if this element or its children contain "Missing Models" heading
            const headings = element.querySelectorAll ? element.querySelectorAll('h2, h3, [class*="title"], [class*="header"]') : [];
            for (const heading of headings) {
                if (heading.textContent?.includes('Missing Models')) {
                    return element;
                }
            }
            // Also check text content directly
            if (element.textContent?.includes('Missing Models') && 
                element.textContent?.includes('following models were not found')) {
                return element;
            }
            return null;
        };

        const dialog = findMissingModelsDialog(node);
        if (!dialog) return;

        // Check if we already injected buttons
        if (dialog.querySelector('#model-linker-btn-container')) return;

        // Find a suitable place to inject the button
        const injectButtons = () => {
            // Auto-resolve button (green)
            const autoResolveBtn = document.createElement('button');
            autoResolveBtn.id = 'model-linker-btn-container'; // Use this ID to prevent duplicate injection
            autoResolveBtn.className = 'ml-popup-auto-resolve-btn';
            autoResolveBtn.textContent = '🔗 Auto-resolve 100%';
            this.dialog?.setTooltip(autoResolveBtn, 'Link every missing model that already has an exact local match, then open Model Linker for the rest.');
            autoResolveBtn.addEventListener('click', async () => {
                await this.handleAutoResolveInPopup(dialog, autoResolveBtn);
            });

            // Find the "Don't show this again" checkbox row and add button next to it
            const checkbox = dialog.querySelector('input[type="checkbox"]');
            if (checkbox) {
                const checkboxRow = checkbox.closest('label') || checkbox.parentElement;
                if (checkboxRow && checkboxRow.parentElement) {
                    // Make the parent a flex container to align checkbox and button
                    checkboxRow.parentElement.classList.add('ml-popup-inline-actions');
                    // Insert button at the beginning (left side)
                    checkboxRow.parentElement.insertBefore(autoResolveBtn, checkboxRow);
                    return;
                }
            }

            // Fallback: Find the list of models and insert before it
            const modelList = dialog.querySelector('[style*="overflow"]') || 
                             dialog.querySelector('[class*="list"]') ||
                             dialog.querySelector('[class*="content"]');
            
            if (modelList) {
                // Create a wrapper and insert before the model list
                const wrapper = document.createElement('div');
                wrapper.className = 'ml-popup-actions-wrap';
                wrapper.appendChild(autoResolveBtn);
                modelList.parentElement?.insertBefore(wrapper, modelList);
            } else {
                // Find after the description text
                const allElements = dialog.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.textContent?.includes('following models were not found') && 
                        el.children.length === 0) {
                        el.parentElement?.insertBefore(btnContainer, el.nextSibling);
                        break;
                    }
                }
            }
            
            console.log('Model Linker: Injected buttons into Missing Models popup');
        };

        // Small delay to ensure popup is fully rendered
        setTimeout(injectButtons, 100);
    }

    /**
     * Handle auto-resolve in the popup - resolve 100% matches and open Model Linker for remaining
     */
    async handleAutoResolveInPopup(dialog, button) {
        button.textContent = '⏳ Resolving...';
        button.disabled = true;

        // Close the popup first
        const closeBtn = dialog.querySelector('button[class*="close"]') || 
                        dialog.querySelector('svg')?.closest('button') ||
                        Array.from(dialog.querySelectorAll('button')).find(b => 
                            b.textContent === '×' || b.innerHTML.includes('×') || b.innerHTML.includes('close'));
        
        if (closeBtn) {
            closeBtn.click();
        }

        // Small delay to let popup close
        await new Promise(r => setTimeout(r, 200));

// Create dialog if needed
        if (!this.dialog) {
            this.dialog = new LinkerManagerDialog();
            window.modelLinkerDialog = this.dialog;
        }
        
        // Run auto-resolve for 100% matches - returns the updated workflow
        const updatedWorkflow = await this.dialog.autoResolve100Percent();
        
        // Always open Model Linker to show remaining unresolved models
        // Pass the updated workflow if available to avoid race condition
        this.dialog.show(updatedWorkflow || null);
    }

    /**
     * Mark resolved model items in the popup as linked (green) and hide download buttons
     */
    removeResolvedFromPopup(dialog, resolvedFilenames) {
        console.log('Model Linker: Looking for resolved filenames:', resolvedFilenames);
        
        // Strategy: For each filename, find text nodes containing it, 
        // then find the nearest Download button and mark that row
        for (const filename of resolvedFilenames) {
            // Get all text in the dialog and find elements containing our filename
            const walker = document.createTreeWalker(
                dialog,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent?.toLowerCase().includes(filename)) {
                    // Found text containing filename - now find parent with Download button
                    let parent = node.parentElement;
                    let attempts = 0;
                    
                    while (parent && parent !== dialog && attempts < 10) {
                        // Look for Download button at this level
                        const downloadBtn = Array.from(parent.querySelectorAll('button'))
                            .find(btn => btn.textContent?.includes('Download') && 
                                        !btn.id?.includes('model-linker'));
                        
                        if (downloadBtn) {
                            console.log('Model Linker: Found entry for', filename);
                            this.markEntryAsResolved(parent, downloadBtn);
                            break;
                        }
                        
                        parent = parent.parentElement;
                        attempts++;
                    }
                    
                    // Only process first match for this filename
                    break;
                }
            }
        }
    }

    /**
     * Mark a model entry as resolved with visual feedback
     */
    markEntryAsResolved(container, downloadBtn) {
        // Already marked?
        if (container.dataset.resolved === 'true') return;
        container.dataset.resolved = 'true';
        
        console.log('Model Linker: Marking entry as resolved', container);
        
        // Add green background/styling to the container
        container.classList.add('ml-resolved-entry');
        
        // Hide the Download button and replace with badge
        if (downloadBtn) {
            // Create badge
            const badge = document.createElement('span');
            badge.className = 'ml-resolved-badge';
            badge.textContent = '✓ Linked';
            
            // Replace download button with badge
            downloadBtn.style.display = 'none';
            downloadBtn.parentElement?.insertBefore(badge, downloadBtn);
        }
        
        // Find and hide Copy URL button
        const allBtns = container.querySelectorAll('button');
        for (const btn of allBtns) {
            if (btn.textContent?.includes('Copy URL')) {
                btn.style.display = 'none';
            }
        }
    }

    /**
     * Count remaining model items in the popup
     */
    countRemainingItems(dialog) {
        // Count elements that look like model entries (have Download buttons)
        const downloadButtons = dialog.querySelectorAll('button');
        let count = 0;
        for (const btn of downloadButtons) {
            if (btn.textContent?.includes('Download') && !btn.id?.includes('model-linker')) {
                count++;
            }
        }
        return count;
    }

    /**
     * Update nodes directly in the graph without triggering a full workflow reload
     * This prevents the Missing Models popup from closing
     */
    updateNodesDirectly(resolutions) {
        if (!app?.graph) {
            console.warn('Model Linker: Cannot update nodes - graph not available');
            return;
        }

        for (const resolution of resolutions) {
            const nodeId = resolution.node_id;
            const widgetIndex = resolution.widget_index;
            const resolvedPath = resolution.resolved_path;

            // Find the node in the graph
            const node = app.graph.getNodeById(nodeId);
            if (!node) {
                console.warn(`Model Linker: Node ${nodeId} not found in graph`);
                continue;
            }

            // Update the widget value
            if (node.widgets && node.widgets[widgetIndex]) {
                const widget = node.widgets[widgetIndex];
                widget.value = resolvedPath;
                
                // Trigger widget callback if it exists
                if (widget.callback) {
                    widget.callback(resolvedPath, app.graph, node, null, null);
                }
                
                console.log(`Model Linker: Updated node ${nodeId} widget ${widgetIndex} to ${resolvedPath}`);
            } else if (node.widgets_values) {
                // Fallback: update widgets_values array directly
                node.widgets_values[widgetIndex] = resolvedPath;
                console.log(`Model Linker: Updated node ${nodeId} widgets_values[${widgetIndex}] to ${resolvedPath}`);
            }

            // Mark node as dirty to trigger redraw
            if (node.setDirtyCanvas) {
                node.setDirtyCanvas(true, true);
            }
        }

        // Trigger canvas redraw
        if (app.graph.setDirtyCanvas) {
            app.graph.setDirtyCanvas(true, true);
        }
    }

    /**
     * Check if auto-open is enabled in user settings
     */
    isAutoOpenEnabled() {
        return localStorage.getItem('modelLinker.autoOpenOnMissing') !== 'false';
    }

    /**
     * Set auto-open preference
     */
    setAutoOpenEnabled(enabled) {
        localStorage.setItem('modelLinker.autoOpenOnMissing', enabled ? 'true' : 'false');
    }

    /**
     * Check for missing models and auto-open dialog if any are found
     */
    async checkAndOpenForMissingModels() {
        // Check if auto-open is enabled
        if (!this.isAutoOpenEnabled()) {
            return;
        }

        // Prevent multiple simultaneous checks
        if (this.isCheckingMissing) {
            return;
        }

        this.isCheckingMissing = true;

        try {
            // Small delay to let workflow fully load
            await new Promise(r => setTimeout(r, 500));

            // Get current workflow
            const workflow = app?.graph?.serialize();
            if (!workflow) {
                return;
            }

            // Create a simple hash to detect if workflow changed
            const workflowHash = JSON.stringify(workflow.nodes?.map(n => n.type + ':' + JSON.stringify(n.widgets_values || [])));
            
            // Skip if we already checked this exact workflow
            if (this.lastCheckedWorkflow === workflowHash) {
                return;
            }
            this.lastCheckedWorkflow = workflowHash;

            // Call analyze endpoint to check for missing models
            const response = await api.fetchApi('/model_linker/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow })
            });

            if (!response.ok) {
                console.warn('Model Linker: Failed to analyze workflow for missing models');
                return;
            }

            const data = await response.json();
            
            // Auto-open dialog if there are missing models
            if (data.total_missing > 0) {
                console.log(`Model Linker: Found ${data.total_missing} missing model(s), opening dialog...`);
                this.openLinkerManager();
            }

        } catch (error) {
            console.error('Model Linker: Error checking for missing models:', error);
        } finally {
            this.isCheckingMissing = false;
        }
    }

    removeExistingButton() {
        // Remove any existing button by ID
        const existingButton = document.getElementById(this.buttonId);
        if (existingButton) {
            existingButton.remove();
        }

        document.querySelectorAll('.comfyui-button-group button.comfyui-button').forEach((button) => {
            const label = button.querySelector('span')?.textContent?.trim() || button.textContent?.trim();
            if (label === 'Model Linker') {
                button.closest('.comfyui-button-group')?.remove();
            }
        });

        // Remove button group if it exists
        if (this.buttonGroup?.element?.parentNode) {
            this.buttonGroup.element.remove();
            this.buttonGroup = null;
        }

        // Also remove the stored reference if it exists
        if (this.linkerButton && this.linkerButton.parentNode) {
            this.linkerButton.remove();
            this.linkerButton = null;
        }
    }

    createFloatingButton() {
        // Create a floating button as fallback for legacy ComfyUI versions
        this.linkerButton = $el("button", {
            id: this.buttonId,
            textContent: "🔗 Model Linker",
            onclick: () => {
                this.openLinkerManager();
            },
            className: "model-linker-floating-button"
        });

        document.body.appendChild(this.linkerButton);
        this.dialog?.setTooltip(this.linkerButton, "Open Model Linker to find or download missing workflow models. Shortcut: Ctrl+Shift+L.");
    }

    async openLinkerManager(options = {}) {
        try {
            if (!this.dialog) {
                this.dialog = new LinkerManagerDialog();
                window.modelLinkerDialog = this.dialog;
            }
            if (options.dockContainer && !options.forceFloating) {
                await this.dialog.showDocked(options.dockContainer, options.workflow || null);
                return;
            }

            const wasDocked = this.dialog.docked;
            const showPromise = this.dialog.show(options.workflow || null);

            if (options.closeSidebarContainer && !wasDocked) {
                this.dialog.closeComfySidebar(options.closeSidebarContainer);
            }

            await showPromise;
        } catch (error) {
            console.error("🔗 Model Linker: Error creating/showing dialog:", error);
            alert("Error opening Model Linker: " + error.message);
        }
    }

    static switchFilter(filter) {
        document.querySelectorAll('.ml-btn-filter').forEach(b => b.classList.remove('active'));
        document.getElementById('filter-' + filter).classList.add('active');
        
        document.querySelectorAll('.ml-model-section').forEach(s => {
            const hasActive = s.dataset.mlActive === 'true';
            const hasInactive = s.dataset.mlInactive === 'true';
            
            if (filter === 'all') {
                s.style.display = 'block';
            } else if (filter === 'active') {
                s.style.display = hasActive ? 'block' : 'none';
            } else if (filter === 'inactive') {
                s.style.display = hasInactive ? 'block' : 'none';
            }
        });
        
        const copySection = document.querySelector('[id^="ml-copy-"]');
        if (copySection) {
            const codeEl = copySection.querySelector('code');
            const labelEl = copySection.querySelector('div');
            
            if (filter === 'all') {
                codeEl.textContent = copySection.dataset.mlAll;
                labelEl.textContent = 'Copy all:';
            } else if (filter === 'active') {
                codeEl.textContent = copySection.dataset.mlActive;
                labelEl.textContent = 'Copy active:';
            } else if (filter === 'inactive') {
                codeEl.textContent = copySection.dataset.mlInactive;
                labelEl.textContent = 'Copy inactive:';
            }
        }
    }

    static copyToClipboard(text, btn) {
        navigator.clipboard.writeText(text).then(() => {
            const orig = btn.textContent;
            btn.textContent = '✓';
            setTimeout(() => btn.textContent = orig, 1500);
        });
    }

    static copyFromCode(sectionId, btn) {
        const section = document.getElementById(sectionId);
        const codeEl = section.querySelector('code');
        navigator.clipboard.writeText(codeEl.textContent).then(() => {
            const orig = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(() => btn.textContent = orig, 1500);
        });
    }
}

const modelLinker = new ModelLinker();

// Register the extension
app.registerExtension({
    name: "Model Linker",
    setup: modelLinker.setup
});

// Global helper functions for inline onclick handlers
window.MLToggleHidden = function(id, trigger, collapsedText, expandedText) {
    const element = document.getElementById(id);
    if (!element) return;

    const isHidden = element.classList.toggle('ml-hidden');
    if (trigger) {
        trigger.setAttribute('aria-expanded', String(!isHidden));
        const label = trigger.querySelector?.('.ml-local-alternatives-label');
        const state = trigger.querySelector?.('.ml-local-alternatives-state');
        if (label || state) {
            if (label) label.textContent = isHidden ? collapsedText : expandedText;
            if (state) state.textContent = isHidden ? 'Show' : 'Hide';
        } else {
            trigger.textContent = isHidden ? collapsedText : expandedText;
        }
    }
};

window.MLFilterSwitch = function(filter) {
    const filterBtn = document.getElementById('filter-' + filter);
    if (!filterBtn) return;
    
    // Update button states
    document.querySelectorAll('.ml-btn-filter').forEach(b => b.classList.remove('active'));
    filterBtn.classList.add('active');
    
    // Filter model sections
    document.querySelectorAll('.ml-model-section').forEach(s => {
        const hasActive = s.getAttribute('data-ml-active') === 'true';
        const hasInactive = s.getAttribute('data-ml-inactive') === 'true';
        
        // Get child divs: category header, active section, inactive section
        const childDivs = Array.from(s.children).filter(c => c.tagName === 'DIV');
        const activeSection = childDivs[1];
        const inactiveSection = childDivs[2];
        
        if (filter === 'all') {
            s.style.display = 'block';
            if (activeSection) activeSection.style.display = 'block';
            if (inactiveSection) inactiveSection.style.display = 'block';
        } else if (filter === 'active') {
            s.style.display = hasActive ? 'block' : 'none';
            if (activeSection) activeSection.style.display = hasActive ? 'block' : 'none';
            if (inactiveSection) inactiveSection.style.display = 'none';
        } else if (filter === 'inactive') {
            s.style.display = hasInactive ? 'block' : 'none';
            if (activeSection) activeSection.style.display = 'none';
            if (inactiveSection) inactiveSection.style.display = hasInactive ? 'block' : 'none';
        }
    });
    
    const copySection = document.querySelector('[id^="ml-copy-"]');
    if (copySection) {
        const codeEl = copySection.querySelector('code');
        const labelEl = copySection.querySelector('div');
        
        if (filter === 'all') {
            codeEl.textContent = copySection.dataset.mlAll;
            labelEl.textContent = 'Copy all:';
        } else if (filter === 'active') {
            codeEl.textContent = copySection.dataset.mlActive;
            labelEl.textContent = 'Copy active:';
        } else if (filter === 'inactive') {
            codeEl.textContent = copySection.dataset.mlInactive;
            labelEl.textContent = 'Copy inactive:';
        }
    }
};

window.MLCopy = function(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = orig, 1500);
    });
};

window.MLCopyCode = function(sectionId, btn) {
    const section = document.getElementById(sectionId);
    const codeEl = section.querySelector('code');
    navigator.clipboard.writeText(codeEl.textContent).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => btn.textContent = orig, 1500);
    });
};

window.MLOpenContextMenu = function(event, element) {
    event.preventDefault();
    event.stopPropagation();
    
    try {
        const modelData = element.getAttribute('data-model');
        if (!modelData) return;
        
        const model = JSON.parse(decodeURIComponent(modelData));
        
        // Get dialog instance
        const dialog = window.modelLinkerDialog;
        if (dialog && dialog.showContextMenu) {
            dialog.showContextMenu(event.clientX, event.clientY, model);
        }
    } catch (e) {
        console.error('Model Linker: Error opening context menu:', e);
    }
};


