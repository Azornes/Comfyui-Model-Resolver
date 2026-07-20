import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
import { escapeHtml } from "../utils/html_utils.js";
export const tabsLoadedMethods = {
    escapeHtml(value) {
        return escapeHtml(value);
    },
    getTabButton(tab) {
        return {
            missing: this.missingTab,
            loaded: this.loadedTab,
            options: this.optionsTab
        }[tab] || null;
    },

    updateTabButtonStates() {
        ['missing', 'loaded', 'options'].forEach((tab) => {
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

    switchTab(tab, { force = false } = {}) {
        const nextTab = this.getValidTab(tab);
        const nextTabButton = this.getTabButton(nextTab);
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
        this.hideTooltip();
        this.animateTabContentTransition();
        this.updateTabButtonStates();
        this.updateQueueVisibility();

        if (this.activeTab === 'missing') {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'auto';
            }
            this.setMissingFooterControlsVisible(true);
            this.loadWorkflowData();
        } else if (this.activeTab === 'loaded') {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'auto';
            }
            this.setMissingFooterControlsVisible(false);
            this.loadLoadedModels();
        } else {
            if (this.contentElement) {
                this.contentElement.style.overflowY = 'hidden';
            }
            this.setMissingFooterControlsVisible(false);
            this.displayOptions();
        }
    },

    async loadLoadedModels(workflow = null, { force = false } = {}) {
        if (!this.contentElement) return;

        this._loadedModelsLoadToken = null;
        this._loadedModelsProgressToken = null;
        let loadToken = null;
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
            if (
                !force &&
                workflowSignature &&
                this.cachedLoadedModelsSignature === workflowSignature &&
                this.cachedLoadedModelsData
            ) {
                if (shouldRenderLoadedModels()) {
                    this.displayLoadedModels(this.contentElement, this.cachedLoadedModelsData);
                }
                return;
            }

            const loadedProgressId = `loaded-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this._loadedModelsProgressToken = loadedProgressId;
            if (shouldRenderLoadedModels()) {
                this.contentElement.innerHTML = this.renderLoadedModelsProgress({
                    status: 'starting',
                    stage: 'starting',
                    message: 'Preparing loaded model scan...',
                    percent: 0,
                    current: 0,
                    total: 0
                });
            }

            const progressPromise = this.pollLoadedModelsProgress(loadedProgressId, loadedProgressId);
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
            }

        } catch (error) {
            console.error('Model Resolver: Error loading loaded models:', error);
            if (shouldRenderLoadedModels()) {
                this.contentElement.innerHTML = `<p class="mr-error-text">Error: ${error.message}</p>`;
            } else if (!loadToken && this.activeTab === 'loaded' && this.contentElement) {
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

            // Some loaders expose per-model enablement, e.g. LoraManager's
            // active flag and rgthree Power Lora Loader's on flag.
            const isActive = model.active !== false && model.connected !== false;

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
                const models = filter === 'active' ? modelsObj.active : filter === 'inactive' ? modelsObj.inactive : [...modelsObj.active, ...modelsObj.inactive];
                const parts = models.map(model => this.getModelToken(model, category));
                result[category] = parts.join(' ');
            }
            return Object.values(result).join(' ');
        };

        const activeString = buildCategoryStrings('active');
        const inactiveString = buildCategoryStrings('inactive');
        const allString = buildCategoryStrings('all');

        const copyIcon = getSvgIcon('copy', 'currentColor', 'mr-copy-btn-icon');
        const copyButtonHtml = (text, extraClass = '') => `
            <button class="mr-btn-filter mr-btn-copy-compact ${extraClass}" onclick="window.MLCopy(${this.escapeJsString(text)}, this)">
                ${copyIcon}<span>Copy</span>
            </button>`;
        const countText = (count, label) => `${count} ${label}${count === 1 ? '' : 's'}`;

        let html = `
            <div class="mr-loaded-models-header">
                <div class="mr-loaded-title-block">
                    <h3 class="mr-loaded-models-title">Loaded Models <span class="mr-loaded-total">${total}</span></h3>
                    <p class="mr-loaded-models-subtitle">${countText(activeCount, 'active')} / ${countText(inactiveCount, 'inactive')}</p>
                </div>
                <div class="mr-loaded-filter-row">
                    <button class="mr-btn-filter active" id="filter-all" onclick="window.MLFilterSwitch('all')">All (${activeCount + inactiveCount})</button>
                    <button class="mr-btn-filter" id="filter-active" onclick="window.MLFilterSwitch('active')">Active (${activeCount})</button>
                    <button class="mr-btn-filter" id="filter-inactive" onclick="window.MLFilterSwitch('inactive')">Inactive (${inactiveCount})</button>
                </div>
            </div>
            <div class="mr-models-list mr-models-list-pad">
        `;

        for (const [category, modelsObj] of Object.entries(byCategory)) {
            const displayName = this.getCategoryDisplayName(category);
            const hasActive = modelsObj.active.length > 0;
            const hasInactive = modelsObj.inactive.length > 0;
            const sectionTotal = modelsObj.active.length + modelsObj.inactive.length;

            html += `<div class="mr-model-section" data-ml-filter="all" data-ml-active="${hasActive}" data-ml-inactive="${hasInactive}">`;

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
                    html += `<span class="mr-model-chip"${this.getContextMenuAttrs(model)}>${this.escapeHtml(name)}${strength !== null ? `<span class="mr-model-chip-strength">${this.escapeHtml(strength)}</span>` : ''}</span>`;
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
                    html += `<span class="mr-model-chip"${this.getContextMenuAttrs(model)}>${this.escapeHtml(name)}${strength !== null ? `<span class="mr-model-chip-strength">${this.escapeHtml(strength)}</span>` : ''}</span>`;
                }
                html += `</div></div>`;
            }

            html += `</div>`;
        }

        const copySectionId = 'mr-copy-' + Date.now();
        html += `
            </div>
            <div id="${copySectionId}" class="mr-copy-section" data-ml-active="${this.escapeHtml(activeString)}" data-ml-inactive="${this.escapeHtml(inactiveString)}" data-ml-all="${this.escapeHtml(allString)}" data-ml-active-count="${activeCount}" data-ml-inactive-count="${inactiveCount}" data-ml-all-count="${activeCount + inactiveCount}">
                <div class="mr-copy-toolbar">
                    <div class="mr-copy-heading">
                        <div class="mr-copy-label" id="${copySectionId}-label">Copy all</div>
                        <div class="mr-copy-meta" id="${copySectionId}-meta">${countText(activeCount + inactiveCount, 'token')}</div>
                    </div>
                    <div class="mr-copy-actions">
                        <button type="button" class="mr-btn-filter mr-copy-mode active" data-ml-copy-mode="all" onclick="window.MLSetCopyMode('${copySectionId}', 'all', this)">All</button>
                        <button type="button" class="mr-btn-filter mr-copy-mode" data-ml-copy-mode="active" onclick="window.MLSetCopyMode('${copySectionId}', 'active', this)">Active</button>
                        <button type="button" class="mr-btn-filter mr-copy-mode" data-ml-copy-mode="inactive" onclick="window.MLSetCopyMode('${copySectionId}', 'inactive', this)">Inactive</button>
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
    }
};
