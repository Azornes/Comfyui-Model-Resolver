import { getSvgIcon } from "../../utils/icon_utils.js";
import {
    getCustomNodeModelEntries,
    getCustomNodeOriginalIdentity,
} from "../custom_nodes/registry.js";
import { normalizePathIdentity } from "../utils/html_utils.js";
import {
    buildLoadedModelTokenStrings,
    groupLoadedModelsByCategory,
} from "../utils/loaded_model_utils.js";
import {
    initLoadedModelSelection,
    updateLoadedModelSelectionState,
} from "../utils/loaded_model_selection.js";
import {
    getLocalModelIdentity,
    renderLocalModelTreeBrowser,
} from "../utils/local_model_tree_utils.js";
export const tabsLoadedMethods = {
    getTabButton(tab) {
        return {
            missing: this.missingTab,
            loaded: this.loadedTab,
            export: this.exportTab,
            metadata: this.metadataTab,
            options: this.optionsTab
        }[tab] || null;
    },

    updateTabButtonStates() {
        ['missing', 'loaded', 'export', 'metadata', 'options'].forEach((tab) => {
            const button = this.getTabButton(tab);
            if (!button) return;
            const isActive = tab === this.activeTab;
            button.classList.toggle('mr-tab-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            button.setAttribute('aria-disabled', isActive ? 'true' : 'false');
            if (isActive) {
                button.setAttribute('aria-current', 'page');
            } else {
                button.removeAttribute('aria-current');
            }
        });
    },

    switchTab(tab, { force = false, animate = true, workflow = null } = {}) {
        const nextTab = this.getValidTab(tab);
        const nextTabButton = this.getTabButton(nextTab);
        if (
            this.activeTab === 'options'
            && nextTab !== 'options'
            && !this.confirmDiscardOptionsChanges()
        ) {
            return null;
        }
        if (!force && nextTab === this.activeTab && nextTabButton?.classList.contains('mr-tab-active')) {
            this.hideTooltip();
            this.updateQueueVisibility();
            return;
        }

        this.activeTab = nextTab;
        this.persistActiveTab(this.activeTab);
        if (this.activeTab !== 'missing') {
            this._analysisProgressToken = null;
        }
        if (this.activeTab !== 'loaded') {
            this._loadedModelsLoadToken = null;
            this._loadedModelsProgressToken = null;
        }
        if (this.activeTab !== 'loaded' && this.activeTab !== 'metadata') {
            if (typeof this._mlSelectionCleanup === 'function') {
                this._mlSelectionCleanup();
                this._mlSelectionCleanup = null;
            }
        }
        if (this.activeTab !== 'metadata') {
            if (typeof this._metadataPasteCleanup === 'function') {
                this._metadataPasteCleanup();
                this._metadataPasteCleanup = null;
            }
        }
        this.hideTooltip();
        if (animate) {
            this.animateTabContentTransition();
        }
        this.updateTabButtonStates();
        this.updateQueueVisibility();

        if (this.activeTab === 'missing') {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'auto';
            }
            this.setMissingFooterControlsVisible(true);
            return this.loadWorkflowData(workflow);
        } else if (this.activeTab === 'loaded') {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'auto';
            }
            this.setMissingFooterControlsVisible(false);
            return this.loadLoadedModels(workflow);
        } else if (this.activeTab === 'export') {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'auto';
            }
            this.setMissingFooterControlsVisible(false);
            return this.loadExportTab(workflow);
        } else if (this.activeTab === 'metadata') {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'auto';
            }
            this.setMissingFooterControlsVisible(false);
            return this.loadImageMetadata();
        } else {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'hidden';
            }
            this.setMissingFooterControlsVisible(false);
            this.displayOptions();
        }
        return null;
    },

    async loadLoadedModels(
        workflow = null,
        { force = false, preserveContent = false } = {}
    ) {
        if (!this.contentElement) return;

        this._loadedModelsLoadToken = null;
        this._loadedModelsProgressToken = null;
        let loadToken = null;
        const preservedScrollTop = preserveContent
            ? this.contentElement.scrollTop
            : null;
        const shouldRenderLoadedModels = () => (
            this.activeTab === 'loaded' &&
            loadToken &&
            this._loadedModelsLoadToken === loadToken &&
            this.contentElement
        );

        try {
            workflow = workflow || this.getCurrentWorkflow();
            if (!workflow) {
                if (shouldRenderLoadedModels()) {
                    this.contentElement.innerHTML = '<p>No workflow loaded. Please load a workflow first.</p>';
                } else if (this.activeTab === 'loaded' && this.contentElement) {
                    this.contentElement.innerHTML = '<p>No workflow loaded. Please load a workflow first.</p>';
                }
                return;
            }
            this.syncWorkflowScopedQueue(workflow);

            loadToken = `loaded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this._loadedModelsLoadToken = loadToken;

            const workflowSignature = this.getWorkflowSignature(workflow);
            const cachedLoadedModels = this.getCachedLoadedModelsForSignature?.(
                workflowSignature,
                { force },
            );
            if (cachedLoadedModels) {
                if (shouldRenderLoadedModels()) {
                    this.displayLoadedModels(this.contentElement, cachedLoadedModels);
                }
                return;
            }

            const loadedProgressId = `loaded-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this._loadedModelsProgressToken = loadedProgressId;
            if (!preserveContent && shouldRenderLoadedModels()) {
                this.patchLoadedModelsProgress(
                    this.contentElement,
                    this.renderLoadedModelsProgress({
                        status: 'starting',
                        stage: 'starting',
                        message: 'Preparing loaded model scan...',
                        percent: 0,
                        current: 0,
                        total: 0
                    })
                );
            }

            const progressPromise = preserveContent
                ? Promise.resolve()
                : this.pollLoadedModelsProgress(loadedProgressId, loadedProgressId);
            let data;
            try {
                data = await this.fetchJson('/model_resolver/loaded', {
                    method: 'POST',
                    body: JSON.stringify({ workflow, loaded_id: loadedProgressId })
                }, 'Fetch loaded models');
            } finally {
                if (this._loadedModelsProgressToken === loadedProgressId) {
                    this._loadedModelsProgressToken = null;
                }
                await progressPromise;
            }
            if (this._loadedModelsLoadToken === loadToken) {
                this.cachedLoadedModelsSignature = workflowSignature;
                this.cachedLoadedModelsData = data;
                this.saveLoadedModelsCacheForActiveWorkflow();
            }
            if (shouldRenderLoadedModels()) {
                this.displayLoadedModels(this.contentElement, data);
                if (preservedScrollTop !== null) {
                    this.contentElement.scrollTop = preservedScrollTop;
                }
            }

        } catch (error) {
            console.error('Model Resolver: Error loading loaded models:', error);
            if (!preserveContent && shouldRenderLoadedModels()) {
                this.contentElement.innerHTML = `<p class="mr-error-text">Error: ${error.message}</p>`;
            } else if (
                !preserveContent &&
                !loadToken &&
                this.activeTab === 'loaded' &&
                this.contentElement
            ) {
                this.contentElement.innerHTML = `<p class="mr-error-text">Error: ${error.message}</p>`;
            }
        }
    },

    getModelNameAndStrength(model) {
        const fullName = model.name || this.getFilenameFromPath(model.original_path) || 'Unknown';
        const name = this.stripModelExtension(fullName);
        const strength = model.strength !== null && model.strength !== undefined 
            ? model.strength.toFixed(2) 
            : null;
        return { name, strength };
    },

    getModelToken(model, category) {
        const { name, strength } = this.getModelNameAndStrength(model);
        return `<${this.getCategoryTokenName(category)}:${name}:${strength || '1.00'}>`;
    },

    getLoadedModelContext(model = {}) {
        return {
            ...model,
            context_scope: 'loaded_model'
        };
    },

    getLoadedModelDomKey(model = {}) {
        return this.getMissingModelKey(model);
    },

    updateLoadedModelCopyValues(container, loadedModels = []) {
        if (!container) return;

        const byCategory = groupLoadedModelsByCategory(loadedModels);
        const strings = buildLoadedModelTokenStrings(
            byCategory,
            (model, category) => this.getModelToken(model, category),
        );

        container.dataset.mlActiveString = strings.active;
        container.dataset.mlInactiveString = strings.inactive;
        container.dataset.mlAllString = strings.all;

        const copySection = container.querySelector?.('.mr-copy-section');
        if (copySection) {
            copySection.dataset.mlActive = strings.active;
            copySection.dataset.mlInactive = strings.inactive;
            copySection.dataset.mlAll = strings.all;
            const activeMode = copySection.querySelector?.('.mr-copy-mode.active')
                ?.dataset?.mlCopyMode || 'all';
            const copyCode = copySection.querySelector?.('.mr-copy-code');
            if (copyCode) {
                if (activeMode === 'selected') {
                    copyCode.textContent = copySection.dataset.mlSelected || '';
                } else {
                    copyCode.textContent = strings[activeMode] || strings.all;
                }
            }
        }

        const sections = container.querySelectorAll?.(
            '.mr-model-section[data-ml-category]'
        ) || [];
        for (const section of sections) {
            const category = section.dataset?.mlCategory || 'unknown';
            const categoryModels = byCategory[category];
            if (!categoryModels) continue;
            for (const filter of ['active', 'inactive']) {
                const button = section.querySelector?.(
                    `.mr-model-group-${filter} .mr-btn-copy-compact`
                );
                if (!button) continue;
                const text = categoryModels[filter]
                    .map(model => this.getModelToken(model, category))
                    .join(' ');
                button.setAttribute(
                    'onclick',
                    `window.MLCopy(${this.escapeJsString(text)}, this)`
                );
            }
        }
    },

    updateLoadedModelStrengthsFromNode(node) {
        if (
            this.activeTab !== 'loaded'
            || !this.contentElement
            || !Array.isArray(this.cachedLoadedModelsData?.loaded_models)
        ) {
            return false;
        }

        const entries = getCustomNodeModelEntries(node)
            .filter(entry => Number.isFinite(entry.strength))
            .map(entry => ({
                identity: normalizePathIdentity(entry.identity),
                strength: entry.strength,
            }));
        if (!entries.length) return false;

        const nodeId = String(node?.id ?? '');
        const modelBuckets = new Map();
        for (const model of this.cachedLoadedModelsData.loaded_models) {
            if (String(model.node_id ?? '') !== nodeId) continue;
            const identity = normalizePathIdentity(
                getCustomNodeOriginalIdentity(model)
                || model.original_path
                || model.name
                || model.filename
            );
            if (!identity) continue;
            if (!modelBuckets.has(identity)) {
                modelBuckets.set(identity, []);
            }
            modelBuckets.get(identity).push(model);
        }

        const chips = Array.from(
            this.contentElement.querySelectorAll?.('[data-ml-loaded-model-key]') || []
        );
        let updated = false;
        for (const entry of entries) {
            const model = modelBuckets.get(entry.identity)?.shift();
            if (!model || Number(model.strength) === entry.strength) continue;

            model.strength = entry.strength;
            const modelKey = this.getLoadedModelDomKey(model);
            const chip = chips.find(
                candidate => candidate.dataset?.mlLoadedModelKey === modelKey
            );
            const strengthElement = chip?.querySelector?.('.mr-model-chip-strength');
            if (strengthElement) {
                strengthElement.textContent = entry.strength.toFixed(2);
            }
            if (chip && typeof this.getModelToken === 'function') {
                chip.dataset.mlToken = this.getModelToken(model, model.category || 'unknown');
            }
            updated = true;
        }
        if (!updated) return false;

        this.updateLoadedModelCopyValues(
            this.contentElement,
            this.cachedLoadedModelsData.loaded_models
        );
        this.updateLoadedModelSelectionState?.(this.contentElement);
        const workflow = this.getCurrentWorkflow?.();
        const workflowSignature = workflow
            ? this.getWorkflowSignature?.(workflow)
            : '';
        if (workflowSignature) {
            this.cachedLoadedModelsSignature = workflowSignature;
            this.activeWorkflowSignature = workflowSignature;
        }
        this.saveLoadedModelsCacheForActiveWorkflow?.();
        return true;
    },

    displayLoadedModels(container, data, options = {}) {
        const loadedModels = data.loaded_models || [];
        const total = data.total || 0;
        const title = String(options.title || 'Loaded Models');
        const subtitle = options.subtitle ? String(options.subtitle) : '';
        const includeContextMenu = options.includeContextMenu !== false;

        if (total === 0) {
            container.innerHTML = this.renderStatusMessage('No models found in workflow.', 'info');
            return;
        }

        const byCategory = groupLoadedModelsByCategory(loadedModels);

        const activeCount = Object.values(byCategory).reduce((sum, cat) => sum + cat.active.length, 0);
        const inactiveCount = Object.values(byCategory).reduce((sum, cat) => sum + cat.inactive.length, 0);

        const {
            active: activeString,
            inactive: inactiveString,
            all: allString,
        } = buildLoadedModelTokenStrings(
            byCategory,
            (model, category) => this.getModelToken(model, category),
            { preserveEmptyCategories: true },
        );

        const copyIcon = getSvgIcon('copy', 'currentColor', 'mr-copy-btn-icon');
        const copyButtonHtml = (text, extraClass = '') => `
            <button class="mr-btn-filter mr-btn-copy-compact ${extraClass}" onclick="window.MLCopy(${this.escapeJsString(text)}, this)">
                ${copyIcon}<span>Copy</span>
            </button>`;
        const countText = (count, label) => `${count} ${label}${count === 1 ? '' : 's'}`;
        const modelContextAttrs = model => includeContextMenu
            ? this.getContextMenuAttrs(this.getLoadedModelContext(model))
            : '';
        const modelSubtitle = subtitle || `${countText(activeCount, 'active')} / ${countText(inactiveCount, 'inactive')}`;

        const isCollapsed = Boolean(options.isCollapsed);
        const tooltipText = options.tooltip || (options.collapsible && subtitle ? subtitle : '');
        const tooltipHtml = tooltipText
            ? (typeof this.getMetadataTooltipBadge === 'function'
                ? this.getMetadataTooltipBadge(tooltipText, `${title} help`)
                : `<span class="mr-tooltip-badge" data-tooltip="${this.escapeHtml(tooltipText)}" aria-label="${this.escapeHtml(title)} help">?</span>`)
            : '';

        const titleHtml = options.collapsible
            ? `
                <div class="mr-section-collapse-header-row">
                    <button type="button" class="mr-section-collapse-btn" data-image-inspector-collapse="${this.escapeHtml(options.sectionId || 'models')}" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-label="Toggle ${this.escapeHtml(title)} section">
                        <span class="mr-section-collapse-chevron" aria-hidden="true">${getSvgIcon('chevronDown')}</span>
                        <span class="mr-loaded-models-title">${this.escapeHtml(title)} <span class="mr-loaded-total">${total}</span></span>
                    </button>
                    ${tooltipHtml}
                </div>
            `
            : `<h3 class="mr-loaded-models-title">${this.escapeHtml(title)} <span class="mr-loaded-total">${total}</span>${tooltipHtml}</h3>`;

        const showSubtitle = (options.showSubtitle ?? !options.collapsible) && Boolean(modelSubtitle);
        const subtitleHtml = showSubtitle
            ? `<p class="mr-loaded-models-subtitle">${this.escapeHtml(modelSubtitle)}</p>`
            : '';

        let html = `
            <div class="mr-loaded-models-header">
                <div class="mr-loaded-title-block">
                    ${titleHtml}
                    ${subtitleHtml}
                </div>
                <div class="mr-loaded-filter-row">
                    <button class="mr-btn-filter active" id="filter-all" onclick="window.MLFilterSwitch('all', this)">All (${activeCount + inactiveCount})</button>
                    <button class="mr-btn-filter" id="filter-active" onclick="window.MLFilterSwitch('active', this)">Active (${activeCount})</button>
                    <button class="mr-btn-filter" id="filter-inactive" onclick="window.MLFilterSwitch('inactive', this)">Inactive (${inactiveCount})</button>
                </div>
            </div>
            <div class="mr-models-list mr-models-list-pad">
        `;

        for (const [category, modelsObj] of Object.entries(byCategory)) {
            const displayName = this.getCategoryDisplayName(category);
            const hasActive = modelsObj.active.length > 0;
            const hasInactive = modelsObj.inactive.length > 0;
            const sectionTotal = modelsObj.active.length + modelsObj.inactive.length;

            html += `<div class="mr-model-section" data-ml-filter="all" data-ml-category="${this.escapeHtml(category)}" data-ml-active="${hasActive}" data-ml-inactive="${hasInactive}">`;

            html += `<div class="mr-model-section-header">
                <div class="mr-model-section-heading">
                    <span class="mr-model-section-title">${this.escapeHtml(displayName.toUpperCase())}</span>
                    <span class="mr-model-section-total">${countText(sectionTotal, 'model')}</span>
                </div>
                <div class="mr-model-section-counts">
                    ${hasActive ? `<span class="mr-model-count-pill is-active">${countText(modelsObj.active.length, 'active')}</span>` : ''}
                    ${hasInactive ? `<span class="mr-model-count-pill is-inactive">${countText(modelsObj.inactive.length, 'inactive')}</span>` : ''}
                </div>
            </div>`;

            if (hasActive) {
                const activeStr = modelsObj.active.map(m => this.getModelToken(m, category)).join(' ');

                html += `<div class="mr-model-group mr-model-group-active">
                    <div class="mr-model-group-head">
                        <span class="mr-model-group-label mr-model-group-label-active"><span class="mr-model-group-dot"></span>Active <span class="mr-model-group-count">${modelsObj.active.length}</span></span>
                        ${copyButtonHtml(activeStr)}
                    </div>
                    <div class="mr-model-chip-list">`;

                for (const model of modelsObj.active) {
                    const { name, strength } = this.getModelNameAndStrength(model);
                    const fullName = model.original_path || model.name || name;
                    const modelKey = this.getLoadedModelDomKey(model);
                    const token = this.getModelToken(model, category);
                    const tooltipLabel = model.model_name && model.model_name.toLowerCase() !== name.toLowerCase()
                        ? `${model.model_name}${model.version_name ? ` (${model.version_name})` : ''} — ${fullName}`
                        : fullName;
                    html += `<span class="mr-model-chip" data-ml-token="${this.escapeHtml(token)}" data-ml-loaded-model-key="${this.escapeHtml(modelKey)}"${modelContextAttrs(model)}${this.getModelPreviewTooltipAttrs(model, tooltipLabel)}>${this.escapeHtml(name)}${strength !== null ? `<span class="mr-model-chip-strength">${this.escapeHtml(strength)}</span>` : ''}<button type="button" class="mr-model-chip-swap-btn" data-tooltip="Swap model across workflow" aria-label="Swap model across workflow">${getSvgIcon('swap')}</button></span>`;
                }
                html += `</div></div>`;
            }

            if (hasInactive) {
                const inactiveStr = modelsObj.inactive.map(m => this.getModelToken(m, category)).join(' ');

                html += `<div class="mr-model-group mr-model-group-inactive">
                    <div class="mr-model-group-head">
                        <span class="mr-model-group-label mr-model-group-label-inactive"><span class="mr-model-group-dot"></span>Inactive <span class="mr-model-group-count">${modelsObj.inactive.length}</span></span>
                        ${copyButtonHtml(inactiveStr, 'is-muted')}
                    </div>
                    <div class="mr-model-chip-list mr-model-chip-list-inactive">`;

                for (const model of modelsObj.inactive) {
                    const { name, strength } = this.getModelNameAndStrength(model);
                    const fullName = model.original_path || model.name || name;
                    const modelKey = this.getLoadedModelDomKey(model);
                    const token = this.getModelToken(model, category);
                    const tooltipLabel = model.model_name && model.model_name.toLowerCase() !== name.toLowerCase()
                        ? `${model.model_name}${model.version_name ? ` (${model.version_name})` : ''} — ${fullName}`
                        : fullName;
                    html += `<span class="mr-model-chip" data-ml-token="${this.escapeHtml(token)}" data-ml-loaded-model-key="${this.escapeHtml(modelKey)}"${modelContextAttrs(model)}${this.getModelPreviewTooltipAttrs(model, tooltipLabel)}>${this.escapeHtml(name)}${strength !== null ? `<span class="mr-model-chip-strength">${this.escapeHtml(strength)}</span>` : ''}<button type="button" class="mr-model-chip-swap-btn" data-tooltip="Swap model across workflow" aria-label="Swap model across workflow">${getSvgIcon('swap')}</button></span>`;
                }
                html += `</div></div>`;
            }

            html += `</div>`;
        }

        const copySectionId = 'mr-copy-' + Date.now();
        html += `
            </div>
            <div id="${copySectionId}" class="mr-copy-section" data-ml-active="${this.escapeHtml(activeString)}" data-ml-inactive="${this.escapeHtml(inactiveString)}" data-ml-all="${this.escapeHtml(allString)}" data-ml-selected="" data-ml-active-count="${activeCount}" data-ml-inactive-count="${inactiveCount}" data-ml-all-count="${activeCount + inactiveCount}" data-ml-selected-count="0" data-ml-previous-mode="all">
                <div class="mr-copy-toolbar">
                    <div class="mr-copy-heading">
                        <div class="mr-copy-label" id="${copySectionId}-label">Copy all</div>
                        <div class="mr-copy-meta" id="${copySectionId}-meta">${countText(activeCount + inactiveCount, 'token')}</div>
                    </div>
                    <div class="mr-copy-actions">
                        <button type="button" class="mr-btn-filter mr-copy-mode active" data-ml-copy-mode="all" onclick="window.MLSetCopyMode('${copySectionId}', 'all', this)">All</button>
                        <button type="button" class="mr-btn-filter mr-copy-mode" data-ml-copy-mode="active" onclick="window.MLSetCopyMode('${copySectionId}', 'active', this)">Active</button>
                        <button type="button" class="mr-btn-filter mr-copy-mode" data-ml-copy-mode="inactive" onclick="window.MLSetCopyMode('${copySectionId}', 'inactive', this)">Inactive</button>
                        <button type="button" class="mr-btn-filter mr-copy-mode mr-copy-mode-selected" data-ml-copy-mode="selected" style="display: none;" onclick="window.MLSetCopyMode('${copySectionId}', 'selected', this)">Selected (<span class="mr-copy-selected-count">0</span>)</button>
                        <button class="mr-btn-filter mr-copy-main-btn" onclick="window.MLCopyCode('${copySectionId}', this)">${copyIcon}<span>Copy</span></button>
                    </div>
                </div>
                <code class="mr-copy-code" id="${copySectionId}-code">${this.escapeHtml(allString)}</code>
            </div>
        `;

        container.innerHTML = html;

        // Store data on container for filter function
        container.dataset.mlActiveString = activeString;
        container.dataset.mlInactiveString = inactiveString;
        container.dataset.mlAllString = allString;

        if (typeof container?.querySelector === 'function') {
            this.bindLoadedModelSelection?.(container);
            this.bindTooltips?.(container);

            if (typeof container._mlSwapClickHandler === 'function') {
                container.removeEventListener('click', container._mlSwapClickHandler);
            }
            container._mlSwapClickHandler = (event) => {
                const swapBtn = event.target?.closest?.('.mr-model-chip-swap-btn');
                if (!swapBtn || !container.contains(swapBtn)) return;
                event.preventDefault();
                event.stopPropagation();
                const chip = swapBtn.closest('.mr-model-chip');
                const modelKey = chip?.dataset?.mlLoadedModelKey;
                const model = loadedModels.find(m => this.getLoadedModelDomKey(m) === modelKey);
                if (model) {
                    this.openModelSwapDialog(model);
                }
            };
            container.addEventListener('click', container._mlSwapClickHandler);
        }
    },

    bindLoadedModelSelection(container) {
        if (typeof this._mlSelectionCleanup === 'function') {
            this._mlSelectionCleanup();
            this._mlSelectionCleanup = null;
        }
        const cleanup = initLoadedModelSelection(container, this);
        this._mlSelectionCleanup = cleanup;
        return cleanup;
    },

    updateLoadedModelSelectionState(container) {
        return updateLoadedModelSelectionState(container);
    },

    async openModelSwapDialog(model) {
        if (!model) return;
        const loadedModels = this.cachedLoadedModelsData?.loaded_models || [];
        const currentName = model.name || this.getFilenameFromPath(model.original_path) || 'Unknown';
        const currentPath = model.original_path || model.name || '';
        const category = model.category || 'checkpoints';
        const categoryDisplayName = this.getCategoryDisplayName?.(category) || category;
        const preferredCategory = this.normalizeDownloadCategory?.(category || 'checkpoints') || 'checkpoints';

        const matchingItems = loadedModels.filter(item => {
            if (item.category && model.category && item.category !== model.category) return false;
            if (currentPath && item.original_path && item.original_path === currentPath) return true;
            if (currentName && item.name && item.name === currentName) return true;
            return false;
        });
        const occurrenceCount = matchingItems.length || 1;

        const backdrop = document.createElement('div');
        backdrop.className = 'mr-info-dialog-backdrop mr-swap-dialog-backdrop';
        backdrop.innerHTML = `
            <div class="mr-info-dialog mr-swap-dialog">
                <div class="mr-info-dialog-header">
                    <h3 class="mr-info-dialog-title">⇄ Swap Model in Workflow</h3>
                    <div class="mr-info-header-actions">
                        <button type="button" class="mr-info-dialog-close mr-swap-dialog-close" aria-label="Close dialog">×</button>
                    </div>
                </div>
                <div class="mr-swap-dialog-content">
                    <div class="mr-swap-info-bar">
                        <div class="mr-swap-target-meta">
                            <span class="mr-swap-target-label">Current:</span>
                            <strong class="mr-swap-target-name">${this.escapeHtml(currentName)}</strong>
                            <span class="mr-model-chip-category">${this.escapeHtml(categoryDisplayName)}</span>
                        </div>
                        <div class="mr-swap-occurrences-badge">
                            Found in <strong>${occurrenceCount}</strong> node${occurrenceCount === 1 ? '' : 's'} across workflow
                        </div>
                    </div>
                    <div class="mr-combo-row mr-swap-search-row">
                        <input type="text" class="mr-combo-input mr-swap-search-input" placeholder="Search or select local model..." autocomplete="off">
                        <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm mr-btn-icon-only mr-combo-refresh-btn mr-swap-refresh-btn" aria-label="Reload local model list" data-tooltip="Reload local model list">
                            <span class="mr-refresh-spin-target">${getSvgIcon('refreshCw', 'currentColor', 'mr-combo-refresh-icon')}</span>
                        </button>
                    </div>
                    <div class="mr-swap-tree-browser mr-local-model-browser">
                        <div class="mr-swap-tree-loading">Loading available models...</div>
                    </div>
                    <div class="mr-swap-dialog-footer">
                        <div class="mr-swap-selection-preview">Select a replacement model above</div>
                        <div class="mr-swap-actions">
                            <button type="button" class="mr-btn mr-btn-secondary mr-swap-cancel-btn">Cancel</button>
                            <button type="button" class="mr-btn mr-btn-primary mr-swap-apply-btn" disabled>
                                Swap Across All ${occurrenceCount} Occurrence${occurrenceCount === 1 ? '' : 's'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        const closeDialog = () => {
            backdrop.remove();
            document.removeEventListener('keydown', handleKey);
        };
        const handleKey = (e) => {
            if (e.key === 'Escape') closeDialog();
        };
        document.addEventListener('keydown', handleKey);
        backdrop.querySelector('.mr-swap-dialog-close').onclick = closeDialog;
        backdrop.querySelector('.mr-swap-cancel-btn').onclick = closeDialog;
        backdrop.onclick = (e) => {
            if (e.target === backdrop) closeDialog();
        };

        const treeContainer = backdrop.querySelector('.mr-swap-tree-browser');
        const searchInput = backdrop.querySelector('.mr-swap-search-input');
        const refreshBtn = backdrop.querySelector('.mr-swap-refresh-btn');
        const applyBtn = backdrop.querySelector('.mr-swap-apply-btn');
        const previewEl = backdrop.querySelector('.mr-swap-selection-preview');

        const expandedSet = new Set();
        let selectedTargetModel = null;
        let selectedIdentity = '';
        let currentEntries = [];

        const helpers = {
            normalizeDownloadCategory: (c) => this.normalizeDownloadCategory?.(c) || c,
            getCategoryDisplayName: (c) => this.getCategoryDisplayName?.(c) || c,
            getBaseDirectoryLabel: (d) => this.getBaseDirectoryLabel?.(d) || d,
            normalizePathToForward: (p) => this.normalizePathToForward?.(p) || p,
            getContextMenuAttrs: (ctx, tooltip) => this.getContextMenuAttrs?.(ctx, tooltip) || '',
            currentModelName: currentName,
            currentModelPath: currentPath,
        };

        const renderTree = (preserveScroll = false) => {
            const previousScrollEl = treeContainer.querySelector('.mr-local-model-browser-scroll');
            const previousScrollTop = preserveScroll && previousScrollEl ? previousScrollEl.scrollTop : 0;

            const allModels = Array.isArray(this.allModels) ? this.allModels : [];
            const result = renderLocalModelTreeBrowser({
                allModels,
                preferredCategory,
                filterText: searchInput?.value || '',
                expandedSet,
                selectedIdentity,
                helpers
            });

            currentEntries = result.allEntries;
            treeContainer.innerHTML = result.html;

            const newScrollEl = treeContainer.querySelector('.mr-local-model-browser-scroll');
            if (newScrollEl && preserveScroll) {
                newScrollEl.scrollTop = previousScrollTop;
            }

            treeContainer.querySelectorAll('[data-browser-action="toggle"]').forEach(row => {
                row.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
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
                    renderTree(true);
                });
            });

            treeContainer.querySelectorAll('[data-browser-action="select-model"]').forEach(row => {
                row.addEventListener('click', () => {
                    const idx = parseInt(row.dataset.modelIndex, 10);
                    if (Number.isNaN(idx) || idx < 0 || idx >= currentEntries.length) return;
                    const entry = currentEntries[idx];
                    if (!entry?.model) return;

                    selectedTargetModel = entry.model;
                    selectedIdentity = getLocalModelIdentity(selectedTargetModel);

                    treeContainer.querySelectorAll('.mr-local-model-row.is-selected').forEach(el => {
                        el.classList.remove('is-selected');
                    });
                    row.classList.add('is-selected');

                    const chosenName = entry.filename || entry.relativePath || entry.model.name || 'model';
                    previewEl.innerHTML = `Replace with: <strong>${this.escapeHtml(chosenName)}</strong>`;
                    applyBtn.disabled = false;
                });

                row.addEventListener('dblclick', () => {
                    const idx = parseInt(row.dataset.modelIndex, 10);
                    if (Number.isNaN(idx) || idx < 0 || idx >= currentEntries.length) return;
                    const entry = currentEntries[idx];
                    if (!entry?.model) return;
                    selectedTargetModel = entry.model;
                    applyBtn.click();
                });
            });
        };

        if (searchInput) {
            const debouncedSearch = this.debounce?.(() => renderTree(false), 150)
                || (() => renderTree(false));
            searchInput.addEventListener('input', debouncedSearch);
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                const refreshAnimation = this.startRefreshButtonAnimation?.(refreshBtn);
                try {
                    refreshBtn.disabled = true;
                    this.allModels = null;
                    await this.ensureAllModelsLoaded?.({ force: true });
                    renderTree(false);
                } catch (err) {
                    this.showNotification?.(`Failed to reload models: ${err.message}`, 'error');
                } finally {
                    refreshBtn.disabled = false;
                    refreshAnimation?.stop?.();
                }
            });
        }

        applyBtn.onclick = async () => {
            if (!selectedTargetModel) return;
            applyBtn.disabled = true;
            applyBtn.textContent = 'Swapping...';
            try {
                await this.applyModelSwap(model, selectedTargetModel, matchingItems);
                closeDialog();
            } catch (err) {
                this.showNotification(`Swap failed: ${err.message}`, 'error');
                applyBtn.disabled = false;
                applyBtn.textContent = `Swap Across All ${occurrenceCount} Occurrence${occurrenceCount === 1 ? '' : 's'}`;
            }
        };

        try {
            await this.ensureAllModelsLoaded?.();
        } catch (err) {
            console.warn('Model Resolver: could not load all models for swap dialog', err);
        }
        renderTree(false);
        setTimeout(() => searchInput?.focus(), 50);
    },

    async applyModelSwap(model, targetModel, matchingItems = null) {
        if (!matchingItems || !matchingItems.length) {
            const loadedModels = this.cachedLoadedModelsData?.loaded_models || [];
            const currentName = model.name || this.getFilenameFromPath(model.original_path) || '';
            const currentPath = model.original_path || model.name || '';
            matchingItems = loadedModels.filter(item => {
                if (item.category && model.category && item.category !== model.category) return false;
                if (currentPath && item.original_path && item.original_path === currentPath) return true;
                if (currentName && item.name && item.name === currentName) return true;
                return false;
            });
        }

        const nodeRefs = (matchingItems && matchingItems.length ? matchingItems : [model]).map(item => ({
            node_id: item.node_id,
            widget_index: item.widget_index,
            category: item.category || model.category,
            subgraph_id: item.subgraph_id,
            subgraph_name: item.subgraph_name,
            is_top_level: item.is_top_level,
            custom_node_adapter: item.custom_node_adapter,
            custom_node_original_identity: item.custom_node_original_identity || item.name || item.original_path,
            nested_key: item.nested_key,
            promoted_widget_name: item.promoted_widget_name,
            original_path: item.original_path,
            node_type: item.node_type,
        }));

        const targetPath = targetModel.path || targetModel.relative_path || targetModel.filename;
        const targetFilename = targetModel.filename || targetModel.relative_path || targetPath;

        const selection = {
            missing_key: `swap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            node_id: model.node_id,
            widget_index: model.widget_index,
            resolved_path: targetPath,
            category: model.category,
            resolved_model: targetModel,
            original_path: model.original_path,
            expected_filename: targetFilename,
            filename: targetFilename,
            subgraph_id: model.subgraph_id,
            is_top_level: model.is_top_level,
            custom_node_adapter: model.custom_node_adapter,
            custom_node_original_identity: model.custom_node_original_identity || model.name || model.original_path,
            nested_key: model.nested_key,
            promoted_widget_name: model.promoted_widget_name,
            node_refs: nodeRefs,
            node_type: model.node_type,
            node_label: model.subgraph_name || model.node_type
        };

        const result = await this.applyPendingResolutionList([selection], { clearAll: false });
        if (result) {
            const modelName = model.name || this.getFilenameFromPath(model.original_path) || 'model';
            const newName = targetModel.filename || targetModel.relative_path || 'new model';
            this.showNotification(`Successfully swapped "${modelName}" with "${newName}" across ${nodeRefs.length} occurrence${nodeRefs.length === 1 ? '' : 's'}`, 'success');
            await this.loadLoadedModels(null, { force: true });
        }
        return result;
    }
};
