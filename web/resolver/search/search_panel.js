import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const searchPanelMethods = {
    /**
     * Build stable cache key for a missing model entry
     */
    getMissingSearchKey(missing) {
        const nodeId = missing?.node_id ?? '';
        const widgetIndex = missing?.widget_index ?? '';
        const subgraphId = missing?.subgraph_id ?? '';
        const category = missing?.category ?? '';
        const modelPath = missing?.original_path || missing?.name || missing?.filename || missing?.urn_string || '';
        return [nodeId, widgetIndex, subgraphId, category, modelPath].map(value => String(value)).join(':');
    },

    /**
     * Get or initialize search state for a missing model entry
     */
    getSearchState(missing) {
        const key = this.getMissingSearchKey(missing);
        if (!this.searchResultCache.has(key)) {
            this.searchResultCache.set(key, this.createEmptySearchState());
        }
        return this.searchResultCache.get(key);
    },

    createEmptySearchState() {
        return {
            selectedSource: 'all',
            selectedBaseModel: this.getDefaultSearchBaseModel(),
            results: {
                popular: null,
                model_list: null,
                huggingface: null,
                civitai: null,
                civarchive: null,
                lora_manager_archive: null
            },
            lastAttemptSources: [],
            lastAttemptBaseModelContext: '',
            lastAttemptFound: null,
            lastAttemptError: null,
            sourceProgress: {},
            activeSearchRunId: null
        };
    },

    isAutoFillBaseModelEnabled() {
        return localStorage.getItem('ModelResolver.autoFillBaseModel') !== 'false';
    },

    getDefaultSearchBaseModel() {
        return this.isAutoFillBaseModelEnabled() ? 'auto' : 'none';
    },

    getKnownBaseModelOptions() {
        const baseModelsList = this.baseModels?.base_models;
        if (Array.isArray(baseModelsList) && baseModelsList.length > 0) {
            return [
                { value: 'auto', label: 'Auto' },
                { value: 'none', label: 'Any model' },
                ...baseModelsList.map(m => ({ value: m.name, label: m.name }))
            ];
        }
        // Fallback to hardcoded list
        return [
            { value: 'auto', label: 'Auto' },
            { value: 'none', label: 'Any model' },
            { value: 'Z-Image', label: 'Z-Image' },
            { value: 'Pony', label: 'Pony' },
            { value: 'Illustrious', label: 'Illustrious' },
            { value: 'SDXL 1.0', label: 'SDXL 1.0' },
            { value: 'SD 1.5', label: 'SD 1.5' },
            { value: 'Flux.1 D', label: 'Flux.1 D' },
            { value: 'Flux.1 S', label: 'Flux.1 S' },
            { value: 'Qwen Image', label: 'Qwen Image' },
            { value: 'Hunyuan 1', label: 'Hunyuan 1' },
            { value: 'WAN Video', label: 'WAN Video' },
            { value: 'NoobAI', label: 'NoobAI' },
            { value: 'HiDream', label: 'HiDream' }
        ];
    },

    normalizeBaseModelToken(value = '') {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    },

    resolveBaseModelAlias(value = '') {
        const token = this.normalizeBaseModelToken(value);
        if (!token) return '';
        for (const entry of this.getBaseModelAliases()) {
            const aliases = [entry.value, ...(entry.aliases || [])];
            if (aliases.some(alias => this.normalizeBaseModelToken(alias) === token)) {
                return entry.value;
            }
        }
        for (const entry of this.getBaseModelAliases()) {
            const aliases = [entry.value, ...(entry.aliases || [])];
            if (aliases.some(alias => {
                const aliasToken = this.normalizeBaseModelToken(alias);
                return aliasToken && (aliasToken.includes(token) || token.includes(aliasToken));
            })) {
                return entry.value;
            }
        }
        return '';
    },

    resolveBaseModelAliasFromPath(path = '') {
        const text = String(path || '').trim();
        if (!text) return '';

        const parts = text
            .split(/[\\/]+/)
            .map(part => part.trim())
            .filter(Boolean);
        const directoryParts = parts.filter(part => !/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i.test(part));

        for (const part of directoryParts.slice(0, 3)) {
            const exact = this.resolveBaseModelAlias(part);
            if (exact) return exact;
        }

        return '';
    },

    getBaseModelAliases() {
        const baseModelsList = this.baseModels?.base_models;
        if (Array.isArray(baseModelsList) && baseModelsList.length > 0) {
            return baseModelsList.map(m => ({ value: m.name, aliases: m.aliases || [] }));
        }
        // Fallback to hardcoded list
        return [
            { value: 'Z-Image', aliases: ['zimage', 'z image', 'z-image', 'z_image', 'zImageTurbo', 'z image turbo'] },
            { value: 'Pony', aliases: ['pony', 'ponyxl', 'pony diffusion', 'pony realism'] },
            { value: 'Illustrious', aliases: ['illustrious', 'illustriousxl', 'illustrious xl'] },
            { value: 'SDXL 1.0', aliases: ['sdxl', 'sdxl10', 'sdxl 1.0', 'stable diffusion xl'] },
            { value: 'SD 1.5', aliases: ['sd15', 'sd 1.5', 'sd1.5', 'stable diffusion 1.5'] },
            { value: 'Flux.1 D', aliases: ['flux', 'flux1', 'flux.1', 'flux dev', 'flux.1 d', 'flux1d'] },
            { value: 'Flux.1 S', aliases: ['flux schnell', 'flux.1 s', 'flux1s'] },
            { value: 'Qwen Image', aliases: ['qwen image', 'qwenimage', 'qwen-image'] },
            { value: 'Hunyuan 1', aliases: ['hunyuan', 'hunyuan1'] },
            { value: 'WAN Video', aliases: ['wan', 'wan video', 'wanvideo'] },
            { value: 'NoobAI', aliases: ['noobai', 'noob ai'] },
            { value: 'HiDream', aliases: ['hidream', 'hi dream'] }
        ];
    },

    getWorkflowModelReferenceText() {
        const workflow = this.getCurrentWorkflow?.();
        if (!workflow) return '';
        const values = [];
        const visit = (value, key = '') => {
            if (typeof value === 'string') {
                if (/^urn:/i.test(value.trim())) {
                    return;
                }
                if (/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)\b/i.test(value) || /model|checkpoint|unet|diffusion/i.test(key)) {
                    values.push(value);
                }
                return;
            }
            if (Array.isArray(value)) {
                value.forEach(item => visit(item, key));
                return;
            }
            if (value && typeof value === 'object') {
                Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
            }
        };
        visit(workflow);
        return values.join(' ');
    },

    getMissingBaseModelWeight(missing = {}) {
        const category = String(missing.category || '').toLowerCase();
        const nodeType = String(missing.node_type || '').toLowerCase();
        if (
            category.includes('checkpoint')
            || category.includes('diffusion')
            || category.includes('unet')
            || nodeType.includes('checkpoint')
            || nodeType.includes('unet')
        ) {
            return 8;
        }
        if (category.includes('lora') || nodeType.includes('lora')) {
            return 2;
        }
        return 1;
    },

    getResolvedWorkflowBaseModelScores() {
        const primaryScores = new Map();
        const secondaryScores = new Map();
        for (const missing of this.missingModels || []) {
            const baseModel = missing?.civitai_info?.base_model || '';
            const bestMatch = this.getBestLocalMatch?.(missing, 95);
            const matchPath = bestMatch?.model?.relative_path
                || bestMatch?.model?.path
                || bestMatch?.path
                || bestMatch?.filename
                || '';
            const localBaseModel = this.resolveBaseModelAliasFromPath(matchPath);
            const canonical = this.resolveBaseModelAlias(baseModel)
                || localBaseModel
                || this.resolveBaseModelAlias(missing?.download_source?.base_model || '');
            if (!canonical) continue;
            const confidence = Number(bestMatch?.confidence || 0);
            const localMatchBoost = confidence >= 100 ? 1 : 0;
            const weight = this.getMissingBaseModelWeight(missing) + localMatchBoost;
            const scores = weight >= 8 ? primaryScores : secondaryScores;
            scores.set(canonical, (scores.get(canonical) || 0) + weight);
        }
        return primaryScores.size ? primaryScores : secondaryScores;
    },

    getDominantWorkflowBaseModel() {
        const resolvedScores = this.getResolvedWorkflowBaseModelScores();
        if (resolvedScores.size) {
            let bestResolved = null;
            for (const [value, score] of resolvedScores.entries()) {
                if (!bestResolved || score > bestResolved.score) {
                    bestResolved = { value, score };
                }
            }
            if (bestResolved) return bestResolved.value;
        }

        const text = this.getWorkflowModelReferenceText();
        if (!text) return '';
        const normalizedText = this.normalizeBaseModelToken(text);
        let best = null;
        for (const entry of this.getBaseModelAliases()) {
            const score = entry.aliases.reduce((count, alias) => {
                const token = this.normalizeBaseModelToken(alias);
                return token && normalizedText.includes(token) ? count + 1 : count;
            }, 0);
            if (score > 0 && (!best || score > best.score)) {
                best = { value: entry.value, score };
            }
        }
        return best?.value || '';
    },

    getSearchBaseModelLabel(value = 'auto') {
        if (value === 'auto') {
            const detected = this.getDominantWorkflowBaseModel();
            return detected ? `Auto (${detected})` : 'Auto';
        }
        const option = this.getKnownBaseModelOptions().find(item => item.value === value);
        return option?.label || value || 'Auto';
    },

    getSearchBaseModelContext(missing = {}) {
        const state = this.getSearchState(missing);
        const selected = state.selectedBaseModel || this.getDefaultSearchBaseModel();
        if (selected === 'none') return '';
        if (selected === 'auto') return this.getDominantWorkflowBaseModel();
        return selected;
    },

    getBackgroundSearchJobKey(workflowKey, missingSearchKey) {
        return `${workflowKey || 'workflow'}\n${missingSearchKey || 'missing'}`;
    },

    hasBackgroundSearchJob(workflowKey, missingSearchKey, runId = null) {
        const job = this.backgroundSearchJobs?.get(
            this.getBackgroundSearchJobKey(workflowKey, missingSearchKey)
        );
        if (!job) return false;
        return !runId || job.runId === runId;
    },

    isBackgroundSearchRunActive(workflowKey, missingSearchKey, runId) {
        return this.hasBackgroundSearchJob(workflowKey, missingSearchKey, runId);
    },

    getWorkflowSearchCache(workflowKey, { create = false } = {}) {
        if (!workflowKey) return null;
        let cache = this.workflowSearchResultCaches.get(workflowKey);
        if (!cache && create) {
            cache = new Map();
            this.workflowSearchResultCaches.set(workflowKey, cache);
        }
        return cache || null;
    },

    getSearchStateForWorkflow(workflowKey, missing) {
        if (!workflowKey || workflowKey === this.getWorkflowScopedQueueKey()) {
            return this.getSearchState(missing);
        }

        const missingSearchKey = this.getMissingSearchKey(missing);
        const cache = this.getWorkflowSearchCache(workflowKey, { create: true });
        if (!cache.has(missingSearchKey)) {
            cache.set(missingSearchKey, this.createEmptySearchState());
        }
        return cache.get(missingSearchKey);
    },

    persistSearchStateForWorkflow(workflowKey, missing, state) {
        const missingSearchKey = this.getMissingSearchKey(missing);
        if (!workflowKey || !missingSearchKey || !state) return;

        const cache = this.getWorkflowSearchCache(workflowKey, { create: true });
        cache.set(
            missingSearchKey,
            this.cloneSearchState(state, {
                preserveActive: this.hasBackgroundSearchJob(
                    workflowKey,
                    missingSearchKey,
                    state.activeSearchRunId
                )
            })
        );

        if (workflowKey === this.getWorkflowScopedQueueKey()) {
            this.searchResultCache.set(missingSearchKey, state);
        }
    },

    refreshSearchUiForMissing(missing, state = null, { workflowKey = this.getWorkflowScopedQueueKey() } = {}) {
        if (!missing) return;
        if (workflowKey && workflowKey !== this.getWorkflowScopedQueueKey()) return;

        const currentState = state || this.searchResultCache.get(this.getMissingSearchKey(missing));
        this.refreshMissingSourcesSummary(missing);
        this.updateBatchFooterButtons?.();

        if (!this.contentElement || this.activeTab !== 'missing') return;

        const resultsId = `search-results-${missing.node_id}-${missing.widget_index}`;
        const resultsDiv = this.contentElement.querySelector(`#${resultsId}`);
        if (resultsDiv && currentState && this.hasRenderableSearchState(currentState)) {
            resultsDiv.classList.remove('mr-is-hidden');
            resultsDiv.classList.add('mr-is-visible');
            this.displaySearchResults(missing, currentState, resultsDiv);
        }

        const searchBtn = this.contentElement.querySelector(`#search-${missing.node_id}-${missing.widget_index}`);
        if (searchBtn && currentState) {
            const isRunning = Boolean(currentState.activeSearchRunId);
            searchBtn.disabled = isRunning;
            searchBtn.innerHTML = isRunning
                ? `${this.getSearchIconHtml()} Searching...`
                : `${this.getSearchIconHtml()} Search Again`;
        }
    },

    /**
     * Merge new search results into cached per-source results.
     * Empty normal responses do not delete previous results; forced refreshes do.
     */
    mergeSearchResults(existingResults = {}, newResults = {}, { searchedAt = null, forceRefresh = false } = {}) {
        const searchedSources = new Set(Array.isArray(newResults.searched_sources) ? newResults.searched_sources : []);
        const sourceErrors = newResults.source_errors && typeof newResults.source_errors === 'object'
            ? newResults.source_errors
            : {};
        const pickResult = (source) => {
            if (newResults[source]) {
                const existingTimestamp = this.getSearchResultTimestamp(existingResults[source]);
                const resultTimestamp = !forceRefresh && this.areSearchResultsSame(existingResults[source], newResults[source])
                    ? existingTimestamp
                    : null;
                return this.withSearchResultTimestamp(
                    newResults[source],
                    resultTimestamp || searchedAt
                );
            }
            const sourceWasSearched = searchedSources.has(source)
                || (searchedSources.has('local') && (source === 'popular' || source === 'model_list'));
            const sourceHadError = sourceErrors[source]
                || (sourceErrors.local && (source === 'popular' || source === 'model_list'));
            if (forceRefresh && sourceWasSearched && !sourceHadError) {
                return null;
            }
            return existingResults[source] || null;
        };

        return {
            popular: pickResult('popular'),
            model_list: pickResult('model_list'),
            huggingface: pickResult('huggingface'),
            civitai: pickResult('civitai'),
            civarchive: pickResult('civarchive'),
            lora_manager_archive: pickResult('lora_manager_archive')
        };
    },

    getSearchResultSignature(result) {
        if (Array.isArray(result)) {
            return result.map(item => this.getSearchResultSignature(item)).join('|');
        }
        if (!result || typeof result !== 'object') return '';

        return [
            result.download_url || result.url || result.model_url || '',
            result.filename || result.path || '',
            result.repo_id || result.repo || '',
            result.model_id || '',
            result.version_id || '',
            result.name || ''
        ].map(value => String(value || '').trim()).join('::');
    },

    areSearchResultsSame(previousResult, nextResult) {
        const previousSignature = this.getSearchResultSignature(previousResult);
        const nextSignature = this.getSearchResultSignature(nextResult);
        return Boolean(previousSignature && nextSignature && previousSignature === nextSignature);
    },

    withSearchResultTimestamp(result, searchedAt = null) {
        if (!result || !searchedAt) return result;
        if (Array.isArray(result)) {
            return result.map(item => this.withSearchResultTimestamp(item, searchedAt));
        }
        if (typeof result !== 'object') return result;
        return {
            ...result,
            searchedAt: result.searchedAt || result.searched_at || searchedAt
        };
    },

    getSearchIconHtml() {
        return `<span class="mr-btn-icon" aria-hidden="true">${getSvgIcon('search')}</span>`;
    },

    getLocateIconHtml() {
        return `<span class="mr-node-chip-icon" aria-hidden="true">${getSvgIcon('locate')}</span>`;
    },

    showTooltip(target) {
        if (!target || !this.tooltipElement) return;
        this.normalizeTooltipTarget(target);
        if (target.matches?.('.mr-footer-menu-button[aria-expanded="true"]')) {
            this.hideTooltip();
            return;
        }
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
    },

    hideTooltip() {
        if (!this.tooltipElement) return;
        this.tooltipElement.style.display = 'none';
        this.tooltipElement.removeAttribute('data-visible');
    },

    normalizeTooltipTarget(target) {
        if (!target || !target.getAttribute) return;

        const title = target.getAttribute('title');
        if (title && !target.getAttribute('data-tooltip')) {
            target.setAttribute('data-tooltip', title);
        }
        if (target.hasAttribute('title')) {
            target.removeAttribute('title');
        }
        if (target.classList?.contains('mr-tooltip-badge') && !target.hasAttribute('tabindex')) {
            target.setAttribute('tabindex', '0');
        }
    },

    setTooltip(target, text) {
        if (!target || !text) return;
        target.setAttribute('data-tooltip', text);
        if (target.hasAttribute('title')) {
            target.removeAttribute('title');
        }
        this.bindTooltips(target);
    },

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
    },

    getValidTab(tab) {
        return ['missing', 'loaded', 'options'].includes(tab) ? tab : 'missing';
    },

    restoreActiveTab() {
        try {
            return this.getValidTab(localStorage.getItem(this.activeTabStorageKey));
        } catch (error) {
            console.warn('Model Resolver: Failed to restore active tab:', error);
            return 'missing';
        }
    },

    persistActiveTab(tab) {
        try {
            localStorage.setItem(this.activeTabStorageKey, this.getValidTab(tab));
        } catch (error) {
            console.warn('Model Resolver: Failed to persist active tab:', error);
        }
    },

    /**
     * Return true when at least one downloadable source was found
     */
    hasSearchResults(data = {}) {
        return !!(data.popular || data.model_list || data.huggingface || data.civitai || data.civarchive || data.lora_manager_archive);
    },

    hasSearchResultsForMissing(missing = {}) {
        if (missing?.download_source?.url) return true;
        const state = this.searchResultCache?.get(this.getMissingSearchKey(missing));
        return this.hasSearchResults(state?.results || {});
    },

    /**
     * Convert source ids to readable labels
     */
    getSearchSourceLabel(source) {
        const labels = {
            all: 'Everything',
            local: 'Local Database',
            huggingface: 'HuggingFace',
            civitai: 'CivitAI',
            civarchive: 'CivArchive',
            lora_manager_archive: 'LoRA Manager Archive'
        };
        return labels[source] || source;
    },

    getSearchSourceDefinitions() {
        return [
            {
                source: 'local',
                storageKey: 'ModelResolver.searchSource.localEnabled',
                tooltip: 'Searches bundled known-model data before online providers.'
            },
            {
                source: 'huggingface',
                storageKey: 'ModelResolver.searchSource.huggingFaceEnabled',
                tooltip: 'Searches Hugging Face when Everything is selected.'
            },
            {
                source: 'civitai',
                storageKey: 'ModelResolver.searchSource.civitaiEnabled',
                tooltip: 'Searches CivitAI when Everything is selected.'
            },
            {
                source: 'civarchive',
                storageKey: 'ModelResolver.searchSource.civArchiveEnabled',
                tooltip: 'Searches CivArchive when Everything is selected.'
            },
            {
                source: 'lora_manager_archive',
                storageKey: 'ModelResolver.searchSource.loraManagerArchiveEnabled',
                tooltip: 'Searches the local LoRA Manager archive when Everything is selected.'
            }
        ];
    },

    getSearchSourceDefinition(source) {
        return this.getSearchSourceDefinitions().find(def => def.source === source) || null;
    },

    isSearchSourceEnabled(source) {
        if (!source || source === 'all') return true;
        const definition = this.getSearchSourceDefinition(source);
        if (!definition) return true;
        return localStorage.getItem(definition.storageKey) !== 'false';
    },

    isSearchSourceUsable(source) {
        return this.isSourceAvailable(source) && this.isSearchSourceEnabled(source);
    },

    getEnabledSearchSources() {
        const sources = this.getSearchSourceDefinitions()
            .filter(def => this.isSearchSourceUsable(def.source))
            .map(def => def.source);
        return sources.length ? sources : ['local'];
    },

    getSearchSourceEnabledMap() {
        return this.getSearchSourceDefinitions().reduce((enabled, def) => {
            enabled[def.source] = this.isSearchSourceEnabled(def.source);
            return enabled;
        }, {});
    },

    getSearchSourcesForSelection(selectedSource, missing = {}) {
        if (selectedSource !== 'all') {
            return this.isSearchSourceUsable(selectedSource) ? [selectedSource] : [];
        }

        return this.getEnabledSearchSources();
    },

    setSourceProgress(state, source, patch = {}, missing = null, { workflowKey = this.getWorkflowScopedQueueKey() } = {}) {
        state.sourceProgress = {
            ...(state.sourceProgress || {}),
            [source]: {
                ...(state.sourceProgress?.[source] || {}),
                ...patch
            }
        };
        if (missing && workflowKey === this.getWorkflowScopedQueueKey()) {
            this.refreshMissingSourcesSummary(missing);
        }
    },

    refreshMissingSourcesSummary(missing = {}) {
        if (!this.contentElement || !missing) return;

        const key = this.getMissingModelKey(missing);
        const rows = this.contentElement.querySelectorAll('.mr-missing-list-row');
        for (const row of rows) {
            if (row.getAttribute('data-missing-key') !== key) continue;

            const sourcesEl = row.querySelector('.mr-missing-row-sources');
            if (sourcesEl) {
                sourcesEl.innerHTML = this.renderMissingSourcesSummary(missing);
            }
        }
    },

    getSearchSourceEstimateMs(source, isUrn = false) {
        if (isUrn && source === 'civitai') return 5000;
        if (isUrn && source === 'civarchive') return 6000;

        const estimates = {
            local: 1400,
            lora_manager_archive: 3200,
            civarchive: 10000,
            huggingface: 18000,
            civitai: 22000
        };
        return estimates[source] || 8000;
    },

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
    },

    getSearchProgressTimerKey(runId, source) {
        return `${runId || 'search'}:${source}`;
    },

    clearSearchProgressTimer(runId, source) {
        const key = this.getSearchProgressTimerKey(runId, source);
        const timer = this.searchProgressTimers.get(key);
        if (timer) {
            clearInterval(timer);
            this.searchProgressTimers.delete(key);
        }
    },

    clearSearchProgressTimers(runId) {
        if (!runId) return;
        const prefix = `${runId}:`;
        for (const [key, timer] of this.searchProgressTimers.entries()) {
            if (key.startsWith(prefix)) {
                clearInterval(timer);
                this.searchProgressTimers.delete(key);
            }
        }
    },

    startEstimatedSearchProgress(state, missing, container, source, runId, { workflowKey = this.getWorkflowScopedQueueKey() } = {}) {
        this.clearSearchProgressTimer(runId, source);

        const tick = () => {
            const missingSearchKey = this.getMissingSearchKey(missing);
            if (
                state.activeSearchRunId !== runId
                && !this.isBackgroundSearchRunActive(workflowKey, missingSearchKey, runId)
            ) {
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
                this.setSourceProgress(state, source, { percent }, missing, { workflowKey });
                this.persistSearchStateForWorkflow(workflowKey, missing, state);
                this.refreshSearchUiForMissing(missing, state, { workflowKey });
            }
        };

        tick();
        const timer = setInterval(tick, 450);
        this.searchProgressTimers.set(
            this.getSearchProgressTimerKey(runId, source),
            timer
        );
    },

    reconnectActiveSearchProgress(missingModels = this.missingModels || []) {
        for (const missing of missingModels || []) {
            const state = this.searchResultCache.get(this.getMissingSearchKey(missing));
            const runId = state?.activeSearchRunId;
            if (!runId) continue;

            for (const [source, progress] of Object.entries(state.sourceProgress || {})) {
                if (progress?.status !== 'running') continue;
                const timerKey = this.getSearchProgressTimerKey(runId, source);
                if (!this.searchProgressTimers.has(timerKey)) {
                    this.startEstimatedSearchProgress(state, missing, null, source, runId);
                }
            }
            this.refreshSearchUiForMissing(missing, state);
        }
    },

    hasActiveSearchProgress(state = {}) {
        return Object.values(state.sourceProgress || {}).some(progress => (
            progress?.status === 'pending' || progress?.status === 'running'
        ));
    },

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
            let html = '<div class="mr-search-progress-list mr-search-progress-list-compact">';
            for (const [source, progress] of progressEntries) {
                const status = progress?.status || 'pending';
                const statusClass = String(status).replace(/[^a-z0-9_-]/gi, '');
                const label = this.getSearchSourceLabel(source);
                const statusLabel = progress?.message || statusLabels[status] || status;
                const title = `${label}: ${progress?.error || statusLabel}`;
                html += `
                    <div class="mr-search-progress-item mr-search-progress-${statusClass}" data-tooltip="${this.escapeHtml(title)}">
                        <span class="mr-search-progress-source">${this.escapeHtml(label)}</span>
                        <span class="mr-search-progress-status">${this.escapeHtml(statusLabel)}</span>
                    </div>
                `;
            }
            html += '</div>';
            return html;
        }

        let html = '<div class="mr-search-progress-list">';
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
            const title = progress?.error ? ` data-tooltip="${this.escapeHtml(`${label}: ${progress.error}`)}"` : '';
            html += `
                <div class="mr-search-progress-item mr-search-progress-${statusClass}"${title}>
                    <div class="mr-search-progress-head">
                        <span>${this.escapeHtml(label)}</span>
                        <span>${this.escapeHtml(statusLabel)}</span>
                    </div>
                    <div class="mr-search-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${safePercent}">
                        <div class="mr-search-progress-fill" style="width: ${safePercent}%;"></div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    },

    /**
     * Update source selector buttons and helper text for one card
     */
    syncSearchSourceUi(missing, container) {
        if (!container) return;

        const state = this.getSearchState(missing);
        const selectEl = container.querySelector(`#search-source-select-${missing.node_id}-${missing.widget_index}`);
        if (selectEl) {
            const options = this.getSearchSourceOptions();
            if (!options.some(option => option.value === state.selectedSource)) {
                state.selectedSource = 'all';
            }
            this.setDropdownValue(selectEl, state.selectedSource, this.getSearchSourceLabel(state.selectedSource));
        }

        const baseEl = container.querySelector(`#search-base-select-${missing.node_id}-${missing.widget_index}`);
        if (baseEl) {
            const options = this.getKnownBaseModelOptions();
            if (!options.some(option => option.value === state.selectedBaseModel)) {
                state.selectedBaseModel = this.getDefaultSearchBaseModel();
            }
            this.setDropdownValue(baseEl, state.selectedBaseModel, this.getSearchBaseModelLabel(state.selectedBaseModel));
        }
    },

    /**
     * Set current search source for one card
     */
    setSearchSource(missing, source, container) {
        const state = this.getSearchState(missing);
        state.selectedSource = source || 'all';
        this.persistSearchStateForActiveWorkflow();
        this.syncSearchSourceUi(missing, container);
    },

    setSearchBaseModel(missing, baseModel, container) {
        const state = this.getSearchState(missing);
        const nextBaseModel = baseModel || this.getDefaultSearchBaseModel();
        const changed = (state.selectedBaseModel || this.getDefaultSearchBaseModel()) !== nextBaseModel;
        if (changed) {
            this.clearSearchProgressTimers(state.activeSearchRunId);
            state.results = this.createEmptySearchState().results;
            state.lastAttemptSources = [];
            state.lastAttemptBaseModelContext = '';
            state.lastAttemptFound = null;
            state.lastAttemptError = null;
            state.sourceProgress = {};
            state.activeSearchRunId = null;
            const resultsDiv = container?.querySelector?.(`#search-results-${missing.node_id}-${missing.widget_index}`);
            if (resultsDiv) {
                resultsDiv.classList.remove('mr-is-visible');
                resultsDiv.classList.add('mr-is-hidden');
                resultsDiv.innerHTML = '';
            }
            const searchBtn = container?.querySelector?.(`#search-${missing.node_id}-${missing.widget_index}`);
            if (searchBtn) {
                searchBtn.disabled = false;
                searchBtn.innerHTML = `${this.getSearchIconHtml()} ${this.hasSearchResultsForMissing(missing) ? 'Search Again' : 'Search'}`;
            }
        }
        state.selectedBaseModel = nextBaseModel;
        this.persistSearchStateForActiveWorkflow();
        this.syncSearchSourceUi(missing, container);
        this.refreshSearchUiForMissing?.(missing, state);
    },

    getDropdownValue(el) {
        return el?.dataset?.value || el?.value || '';
    },

    setDropdownValue(el, value, label = value) {
        if (!el) return;
        el.dataset.value = value || '';
        el.value = label || value || '';
    },

    refreshSearchBaseModelLabels(container = this.contentElement) {
        if (!container) return;
        container.querySelectorAll?.('.mr-search-base-select').forEach((baseEl) => {
            const value = baseEl.dataset?.value || 'auto';
            if (value === 'auto') {
                this.setDropdownValue(baseEl, value, this.getSearchBaseModelLabel(value));
            }
        });
    },

    normalizeVersionName(versionName) {
        return String(versionName || '').trim().replace(/^v{2,}(?=\d)/i, 'v');
    },

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
    },

    getVersionedModelName(modelName, versionName) {
        const parts = this.getModelVersionParts(modelName, versionName);
        if (!parts.version) return parts.name;
        return parts.name ? `${parts.name} ${parts.version}` : parts.version;
    },

    renderVersionedModelNameHtml(modelName, versionName) {
        const parts = this.getModelVersionParts(modelName, versionName);
        const nameHtml = parts.name ? this.escapeHtml(parts.name) : '';
        const versionHtml = parts.version
            ? `<em class="mr-model-version">${this.escapeHtml(parts.version)}</em>`
            : '';
        return [nameHtml, versionHtml].filter(Boolean).join(' ');
    },

    getSearchSourceIconName(sourceKey) {
        const icons = {
            popular: 'star',
            'model-list': 'comfyui',
            huggingface: 'huggingface',
            civitai: 'civitai',
            civarchive: 'civarchive',
            'lora-archive': 'loraManager',
            lora_manager_archive: 'loraManager',
            'lora-manager-archive': 'loraManager',
            local: 'comfyui',
            'workflow-url': 'link',
            workflow: 'link',
            online: 'globe'
        };
        return icons[sourceKey] || 'globe';
    },

    getSearchResultTimestamp(result = {}) {
        if (Array.isArray(result)) {
            return this.getSearchResultTimestamp(result[0] || {});
        }
        return result?.searchedAt
            || result?.searched_at
            || result?.cachedAt
            || result?.cached_at
            || result?.updatedAt
            || result?.updated_at
            || '';
    },

    formatSearchResultTimestamp(value, { compact = false } = {}) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);

        const monthNames = compact
            ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const pad = (number) => String(number).padStart(2, '0');
        const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

        return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${time}`;
    },

    renderSearchSourcePill(sourceKey, sourceLabel, searchedAt = '') {
        const iconName = this.getSearchSourceIconName(sourceKey);
        const iconHtml = getSvgIcon(iconName, 'currentColor', 'mr-search-source-icon');
        const sourceDate = this.formatSearchResultTimestamp(searchedAt, { compact: true });
        const sourceDateTitle = this.formatSearchResultTimestamp(searchedAt);
        return `
            <div class="mr-search-source-cell">
                <span class="mr-search-source-pill mr-search-source-${sourceKey}" data-tooltip="${this.escapeHtml(sourceLabel)}">
                    ${iconHtml}
                    <span>${this.escapeHtml(sourceLabel)}</span>
                </span>
                ${sourceDate ? `<small class="mr-search-source-date" data-tooltip="Result saved ${this.escapeHtml(sourceDateTitle)}">${this.escapeHtml(sourceDate)}</small>` : ''}
            </div>
        `;
    },

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
            const count = (row.detailsContext ? 1 : 0) + (row.downloadUrl ? 1 : 0) + (row.openUrl ? 1 : 0);
            return Math.max(max, count);
        }, 1);

        const sourcePx = Math.max(118, textWidth('x'.repeat(maxSourceLabel), 6, 34, 100) + 52);
        const matchPx = textWidth('x'.repeat(maxMatchLabel), 7, 34, 76) + 22;
        const sizePx = textWidth('x'.repeat(maxSizeLabel), 6.5, 42, 88) + 30;
        const actionsPx = Math.max(96, (maxActions * 28) + (Math.max(0, maxActions - 1) * 8) + 26);
        const modelMinPx = 210;
        const tableMinPx = Math.ceil(sourcePx + matchPx + sizePx + actionsPx + modelMinPx);

        return { sourcePx, matchPx, sizePx, actionsPx, tableMinPx };
    },

    formatSearchResultSize(result = {}) {
        if (result.size === 0) return '0 B';
        if (!result.size) return '';
        return typeof result.size === 'number' ? this.formatBytes(result.size) : String(result.size);
    },

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
    },

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
            civarchive: 'CivArchive',
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
        const rawModelUrl = downloadSource.model_url
            || downloadSource.workflow_model_url
            || downloadSource.url;
        const modelUrl = this.getModelCardUrl(rawModelUrl) || rawModelUrl;
        const versionName = downloadSource.version_name || missing.civitai_info?.version_name || '';
        const modelParts = this.getModelVersionParts(
            downloadSource.name || missing.civitai_info?.model_name || '',
            versionName
        );
        const modelName = modelParts.name || downloadFilename;
        const fullModelName = this.getVersionedModelName(modelName, modelParts.version);
        const baseModel = downloadSource.base_model || missing.civitai_info?.base_model || '';
        const secondaryParts = [
            sourceSecondary,
            fullModelName && fullModelName !== downloadFilename ? downloadFilename : '',
            baseModel
        ].filter(Boolean);

        return {
            sourceKey,
            sourceLabel,
            model: modelName,
            version: modelParts.version,
            filename: downloadFilename,
            secondary: secondaryParts.join(' / '),
            match: isFromWorkflow
                ? { label: 'Provided', className: 'strong' }
                : this.getSearchResultMatchDisplay(downloadSource, 'Known', 'strong'),
            size: this.formatSearchResultSize(downloadSource),
            downloadUrl: downloadSource.url,
            downloadFilename,
            category: downloadSource.directory || downloadSource.category || missing.category || 'checkpoints',
            openUrl: modelUrl,
            searchedAt: this.getSearchResultTimestamp(downloadSource),
            detailsContext: ['civitai', 'civarchive'].includes(String(source).toLowerCase())
                ? {
                    ...downloadSource,
                    source,
                    details_source: String(source).toLowerCase(),
                    model_id: downloadSource.model_id,
                    version_id: downloadSource.version_id,
                    name: modelName,
                    filename: downloadFilename,
                    missing_key: this.getMissingModelKey(missing),
                    category: missing.category
                }
                : null
        };
    },

    renderKnownDownloadPanel(missing, downloadSource) {
        let html = `<div class="mr-download-section">`;
        html += this.renderSearchControls(missing, { buttonText: 'Search Again' });
        html += this.renderDownloadTargetControls(
            missing,
            downloadSource.directory || downloadSource.category || missing.category || 'checkpoints'
        );
        html += `</div>`;

        const downloadSourceRow = this.getDownloadSourceTableRow(missing, downloadSource);
        html += `<div id="search-results-${missing.node_id}-${missing.widget_index}" class="mr-search-results mr-is-visible">`;
        html += this.renderSearchResultsTable(downloadSourceRow ? [downloadSourceRow] : []);
        html += `</div>`;
        return html;
    },

    renderSearchResultsTable(rows = []) {
        if (!rows.length) return '';
        const layout = this.getSearchResultsTableLayout(rows);
        const tableStyle = [
            `--mr-source-col:${layout.sourcePx}px`,
            `--mr-match-col:${layout.matchPx}px`,
            `--mr-size-col:${layout.sizePx}px`,
            `--mr-actions-col:${layout.actionsPx}px`,
            `--mr-table-min:${layout.tableMinPx}px`
        ].join(';');

        let html = `
            <div class="mr-search-results-table-wrap">
                <table class="mr-search-results-table" style="${tableStyle}">
                    <colgroup>
                        <col class="mr-search-col-source">
                        <col class="mr-search-col-model">
                        <col class="mr-search-col-match">
                        <col class="mr-search-col-size">
                        <col class="mr-search-col-actions">
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
            const sourcePill = this.renderSearchSourcePill(sourceKey, sourceLabel, row.searchedAt || row.sourceDate || '');
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
            const detailsContext = row.detailsContext && (row.detailsContext.model_id || row.detailsContext.modelId)
                ? {
                    ...row.detailsContext,
                    model_id: row.detailsContext.model_id || row.detailsContext.modelId,
                    version_id: row.detailsContext.version_id || row.detailsContext.versionId,
                    name: row.detailsContext.name || rawModel,
                    filename: row.detailsContext.filename || downloadFilename,
                    category: row.detailsContext.category || category,
                    context_scope: 'download_table'
                }
                : null;
            const detailsData = detailsContext
                ? encodeURIComponent(JSON.stringify(detailsContext))
                : '';

            let actions = '';
            if (detailsContext) {
                actions += `
                    <button type="button"
                        class="search-show-details-btn mr-search-result-action-btn"
                        data-tooltip="Show more"
                        aria-label="Show more details"
                        data-model="${this.escapeHtml(detailsData)}">${getSvgIcon('moreCircle')}</button>
                `;
            }
            if (downloadUrl) {
                actions += `
                    <button type="button" class="search-download-btn mr-search-result-action-btn"
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
                        class="search-open-page-btn mr-search-result-action-btn"
                        data-tooltip="Open model page"
                        aria-label="Open model page"
                        data-url="${this.escapeHtml(openUrl)}">${getSvgIcon('globe')}</button>
                `;
            }
            if (!actions) {
                actions = '<span class="mr-search-result-empty">-</span>';
            }

            html += `
                <tr>
                    <td>${sourcePill}</td>
                    <td>
                        <div class="mr-search-result-model" data-tooltip="${modelTitle}" ${detailsData ? `data-model="${this.escapeHtml(detailsData)}" oncontextmenu="window.MLOpenContextMenu(event, this)"` : ''}>
                            <span>${modelHtml}</span>
                            ${secondary || filename ? `<small>${secondary || filename}</small>` : ''}
                        </div>
                    </td>
                    <td><span class="mr-search-match mr-search-match-${matchClass}">${this.escapeHtml(match.label)}</span></td>
                    <td class="mr-search-size">${size}</td>
                    <td><div class="mr-search-result-actions">${actions}</div></td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;
        return html;
    },

    renderSearchControls(missing, options = {}) {
        const searchSourcesId = `search-sources-${missing.node_id}-${missing.widget_index}`;
        const searchSourceSelectId = `search-source-select-${missing.node_id}-${missing.widget_index}`;
        const searchSourceListId = `search-source-list-${missing.node_id}-${missing.widget_index}`;
        const searchBaseSelectId = `search-base-select-${missing.node_id}-${missing.widget_index}`;
        const searchBaseListId = `search-base-list-${missing.node_id}-${missing.widget_index}`;
        const state = this.getSearchState(missing);
        const selectedSource = state.selectedSource || 'all';
        const selectedBaseModel = state.selectedBaseModel || this.getDefaultSearchBaseModel();
        const buttonText = options.buttonText
            || (this.hasSearchResultsForMissing(missing) ? 'Search Again' : 'Search');

        let html = `<div id="${searchSourcesId}" class="mr-search-source-bar">`;
        html += `<button id="search-${missing.node_id}-${missing.widget_index}" class="mr-btn mr-btn-link">`;
        html += `${this.getSearchIconHtml()} ${buttonText}`;
        html += `</button>`;
        html += `<div class="mr-search-source-picker">`;
        html += `<label class="mr-search-source-picker-label" for="${searchSourceSelectId}">Source</label>`;
        html += `<div class="mr-download-target-wrap">`;
        html += `<input id="${searchSourceSelectId}" class="mr-download-target-input mr-search-source-select" type="text" readonly autocomplete="off" data-value="${this.escapeHtml(selectedSource)}" value="${this.escapeHtml(this.getSearchSourceLabel(selectedSource))}">`;
        html += `<div id="${searchSourceListId}" class="mr-download-target-list mr-search-source-list"></div>`;
        html += `</div>`;
        html += `</div>`;
        html += `<div class="mr-search-source-picker mr-search-base-picker">`;
        html += `<label class="mr-search-source-picker-label" for="${searchBaseSelectId}">Model</label>`;
        html += `<div class="mr-download-target-wrap">`;
        html += `<input id="${searchBaseSelectId}" class="mr-download-target-input mr-search-base-select" type="text" readonly autocomplete="off" data-value="${this.escapeHtml(selectedBaseModel)}" value="${this.escapeHtml(this.getSearchBaseModelLabel(selectedBaseModel))}">`;
        html += `<div id="${searchBaseListId}" class="mr-download-target-list mr-search-base-list"></div>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    },

    renderProgressWithAction({
        percent = 0,
        leftText = '',
        rightText = '',
        actionClass = '',
        actionText = '',
        actionDataAttr = '',
        contextMenuModel = null,
        contextMenuTooltip = 'Right-click to open download folder'
    } = {}) {
        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
        const actionAttr = actionDataAttr ? ` ${actionDataAttr}` : '';
        const contextMenuData = contextMenuModel
            ? this.escapeHtml(encodeURIComponent(JSON.stringify(contextMenuModel)))
            : '';
        const contextMenuAttrs = contextMenuData
            ? ` data-model="${contextMenuData}" oncontextmenu="window.MLOpenContextMenu(event, this)" data-tooltip="${this.escapeHtml(contextMenuTooltip)}"`
            : '';
        const containerClass = contextMenuData
            ? 'mr-progress-container mr-download-folder-context'
            : 'mr-progress-container';
        const actionHtml = actionClass || actionText
            ? `<button class="${actionClass}"${actionAttr}>${actionText}</button>`
            : '';
        return `
            <div class="${containerClass}"${contextMenuAttrs}>
                <div class="mr-progress-row">
                    <div class="mr-progress-bar mr-progress-bar-grow">
                        <div class="mr-progress-fill" style="width: ${safePercent}%;"></div>
                    </div>
                    ${actionHtml}
                </div>
                <div class="mr-progress-text">
                    <span>${leftText}</span>
                    <span>${rightText}</span>
                </div>
            </div>
        `;
    },

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
    },

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

                html += `<div class="mr-match-row ${isBestMatch ? 'mr-best-match' : ''}" data-model="${modelData}" oncontextmenu="window.MLOpenContextMenu(event, this)">`;
                html += this.getConfidenceBadge(match.confidence);
                html += `<span class="mr-match-filename" data-tooltip="${this.escapeHtml(matchPath)}">${this.escapeHtml(matchPath)}</span>`;
                html += `<span class="mr-match-status ${match.confidence === 100 ? 'mr-match-status-exact' : 'mr-match-status-partial'}">${match.confidence === 100 ? 'Exact' : 'Partial'}</span>`;
                html += `<button id="${buttonId}" class="mr-btn mr-btn-secondary mr-btn-sm mr-btn-icon-only mr-local-link-btn" data-tooltip="Link this local match" aria-label="Link this local match">`;
                html += getSvgIcon('link');
                html += `</button>`;
                html += `</div>`;
            }

            if (perfectMatches.length > 0 && otherMatches.length > 0) {
                const matchId = `more-matches-${missing.node_id}-${missing.widget_index}`;
                const altLabel = `Alternatives (${otherMatches.length})`;
                html += `<button type="button" class="mr-local-alternatives-toggle" aria-expanded="true" onclick="window.MLToggleHidden('${matchId}', this, '${altLabel}', '${altLabel}')">`;
                html += `<span class="mr-local-alternatives-label">${altLabel}</span>`;
                html += `<span class="mr-local-alternatives-state">Hide</span>`;
                html += `<span class="mr-local-alternatives-chevron" aria-hidden="true"></span>`;
                html += `</button>`;
                html += `<div id="${matchId}" class="mr-stack-sm">`;
                for (let mIdx = 0; mIdx < otherMatches.length; mIdx++) {
                    const match = otherMatches[mIdx];
                    const altBtnId = `resolve-alt-${missingIndex}-${missing.node_id}-${missing.widget_index}-${mIdx}`;
                    const contextModel = this.buildContextMenuModelData(match.model || {}, match.filename || '');
                    const modelData = encodeURIComponent(JSON.stringify(contextModel));
                    const matchPath = match.model?.relative_path || match.model?.path || match.path || match.filename || '';
                    html += `<div class="mr-match-row" data-model="${modelData}" oncontextmenu="window.MLOpenContextMenu(event, this)">`;
                    html += this.getConfidenceBadge(match.confidence);
                    html += `<span class="mr-match-filename" data-tooltip="${this.escapeHtml(matchPath)}">${this.escapeHtml(matchPath)}</span>`;
                    html += `<span class="mr-match-status mr-match-status-partial">Partial</span>`;
                    html += `<button id="${altBtnId}" class="mr-btn mr-btn-secondary mr-btn-sm mr-btn-icon-only mr-local-link-btn" data-tooltip="Link this local match" aria-label="Link this local match">${getSvgIcon('link')}</button>`;
                    html += `</div>`;
                }
                html += `</div>`;
            }
        } else if (missing.is_urn && !missing.civitai_info) {
            html += `<div class="mr-no-matches">Waiting for CivitAI filename to search local models...</div>`;
        } else if (allMatches.length > 0 && filteredMatches.length === 0) {
            html += `<div class="mr-no-matches">No matches above 70% confidence</div>`;
        } else {
            html += `<div class="mr-no-matches">No local matches found</div>`;
        }

        return html;
    },

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
    },

    getUrnIds(missing = {}) {
        return {
            modelId: missing.urn_model_id || missing.urn?.model_id,
            versionId: missing.urn_version_id || missing.urn?.version_id
        };
    },

    getUrnResolveKey(missing = {}) {
        const ids = this.getUrnIds(missing);
        return `${ids.modelId || ''}:${ids.versionId || ''}:${this.getMissingModelKey(missing)}`;
    },

    getCivitaiResultFromMissing(missing = {}) {
        if (!missing.civitai_info?.expected_filename && !missing.download_source?.url) return null;
        const ids = this.getUrnIds(missing);
        return {
            name: missing.civitai_info?.model_name || missing.download_source?.name,
            version_name: missing.civitai_info?.version_name || missing.download_source?.version_name,
            filename: missing.civitai_info?.expected_filename || missing.download_source?.filename,
            download_url: missing.download_source?.url,
            url: missing.download_source?.model_url,
            type: missing.download_source?.type || missing.category,
            size: missing.download_source?.size,
            model_id: missing.download_source?.model_id || ids.modelId,
            version_id: missing.download_source?.version_id || ids.versionId,
            base_model: missing.civitai_info?.base_model || missing.download_source?.base_model,
            tags: missing.civitai_info?.tags || missing.download_source?.tags || [],
            searchedAt: missing.download_source?.searchedAt || missing.download_source?.searched_at
        };
    },

    applyCivitaiUrnResult(missing, civitai = {}) {
        if (!missing || !civitai) return;
        const ids = this.getUrnIds(missing);
        const searchedAt = civitai.searchedAt || civitai.searched_at || new Date().toISOString();
        missing.civitai_info = {
            model_name: civitai.name,
            version_name: civitai.version_name,
            expected_filename: civitai.filename,
            base_model: civitai.base_model,
            tags: civitai.tags || []
        };
        missing.download_source = {
            source: 'civitai',
            url: civitai.download_url,
            filename: civitai.filename,
            name: civitai.name,
            version_name: civitai.version_name,
            type: civitai.type,
            directory: missing.category || 'checkpoints',
            match_type: 'exact',
            size: civitai.size,
            model_id: civitai.model_id || ids.modelId,
            version_id: civitai.version_id || ids.versionId,
            model_url: civitai.url || `https://civitai.com/models/${ids.modelId}?modelVersionId=${ids.versionId}`,
            base_model: civitai.base_model,
            tags: civitai.tags || [],
            searchedAt
        };
    },

    async resolveUrnDataForMissing(missing) {
        if (!missing?.is_urn) return null;

        const existing = this.getCivitaiResultFromMissing(missing);
        if (existing?.filename) {
            return { civitai: existing };
        }

        const ids = this.getUrnIds(missing);
        if (!ids.modelId || !ids.versionId) return null;

        const key = this.getUrnResolveKey(missing);
        if (this.urnResolvePromises.has(key)) {
            return this.urnResolvePromises.get(key);
        }

        const promise = (async () => {
            const tokens = this.getStoredTokens();
            const payload = {
                filename: `${ids.modelId}_${ids.versionId}`,
                category: '',
                is_urn: true,
                sources: ['civitai'],
                model_id: ids.modelId,
                version_id: ids.versionId,
                civitai_candidate_limit: tokens.civitai_candidate_limit
            };

            const response = await api.fetchApi('/model_resolver/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`URN resolve failed: ${response.status}`);
            }

            const data = await response.json();
            if (data.civitai) {
                this.applyCivitaiUrnResult(missing, data.civitai);
            }
            return data;
        })().finally(() => {
            this.urnResolvePromises.delete(key);
        });

        this.urnResolvePromises.set(key, promise);
        return promise;
    },

    refreshMissingListStats() {
        if (!this.contentElement) return;
        const statsEl = this.contentElement.querySelector('.mr-missing-list-stats');
        if (!statsEl) return;

        const stats = this.getMissingModelSummaryStats(this.missingModels || []);
        statsEl.innerHTML = `
            <span class="mr-missing-stat mr-missing-stat-exact">${stats.exact} exact</span>
            <span class="mr-missing-stat mr-missing-stat-partial">${stats.partial} partial</span>
            <span class="mr-missing-stat mr-missing-stat-none">${stats.none} no match</span>
        `;
    },

    refreshMissingListRowLocalMatch(missing = {}) {
        if (!this.contentElement) return;

        const key = this.getMissingModelKey(missing);
        const rows = this.contentElement.querySelectorAll('.mr-missing-list-row');
        for (const row of rows) {
            if (row.getAttribute('data-missing-key') !== key) continue;

            const bestMatch = this.getBestLocalMatch(missing, 70);
            const confidence = bestMatch ? Number(bestMatch.confidence || 0) : 0;
            const matchName = bestMatch?.model?.relative_path || bestMatch?.filename || bestMatch?.path || '';
            const matchDisplay = matchName || 'No local match';
            const matchClass = confidence === 100 ? 'exact' : (bestMatch ? 'partial' : 'none');

            const bestEl = row.querySelector('.mr-missing-row-best');
            if (bestEl) {
                bestEl.setAttribute('data-tooltip', matchDisplay);
                bestEl.innerHTML = bestMatch
                    ? this.escapeHtml(matchDisplay)
                    : '<span class="mr-missing-row-none">-- No local match</span>';
            }

            const matchEl = row.querySelector('.mr-missing-row-match');
            if (matchEl) {
                matchEl.classList.remove(
                    'mr-missing-row-match-exact',
                    'mr-missing-row-match-partial',
                    'mr-missing-row-match-none'
                );
                matchEl.classList.add(`mr-missing-row-match-${matchClass}`);
                const valueEl = matchEl.querySelector('strong');
                if (valueEl) {
                    valueEl.textContent = bestMatch
                        ? `${confidence.toFixed(confidence % 1 ? 1 : 0)}%`
                        : '--';
                }
            }
        }

        this.refreshMissingListStats();
    },

    async fetchUrnLocalMatches(missing) {
        if (!missing?.civitai_info?.expected_filename) return [];

        const filename = missing.civitai_info.expected_filename;
        if (missing.__urnLocalMatchesFilename === filename && Array.isArray(missing.matches)) {
            return missing.matches;
        }

        const key = this.getUrnResolveKey(missing);
        if (this.urnLocalMatchPromises.has(key)) {
            return this.urnLocalMatchPromises.get(key);
        }

        const promise = (async () => {
            const response = await api.fetchApi('/model_resolver/local-matches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    category: missing.category || ''
                })
            });

            if (!response.ok) {
                throw new Error(`Local match search failed: ${response.status}`);
            }

            const data = await response.json();
            missing.matches = Array.isArray(data.matches) ? data.matches : [];
            missing.__urnLocalMatchesFilename = filename;
            return missing.matches;
        })().finally(() => {
            this.urnLocalMatchPromises.delete(key);
        });

        this.urnLocalMatchPromises.set(key, promise);
        return promise;
    },

    async refreshUrnLocalMatches(missing) {
        if (!missing?.civitai_info?.expected_filename || !this.contentElement) return;

        const bodyId = `local-matches-body-${missing.node_id}-${missing.widget_index}`;
        const container = this.contentElement.querySelector(`#${bodyId}`);
        if (container) {
            container.innerHTML = `<div class="mr-no-matches">Searching local matches for "${missing.civitai_info.expected_filename}"...</div>`;
        }

        try {
            await this.fetchUrnLocalMatches(missing);
            if (container) {
                container.innerHTML = this.renderLocalMatchesContent(missing, missing.__displayIndex || 0);
                this.wireLocalMatchButtons(this.contentElement, missing, missing.__displayIndex || 0);
            }
            this.refreshMissingListRowLocalMatch(missing);
        } catch (error) {
            console.error('Model Resolver: URN local match refresh error:', error);
            if (container) {
                container.innerHTML = `<div class="mr-no-matches">Failed to refresh local matches.</div>`;
            }
        }
    },

    scheduleInitialUrnLocalMatchRefresh(missingModels = [], container = null, data = null) {
        const refreshTasks = [];

        missingModels.forEach((missing) => {
            if (!missing?.is_urn || missing.__urnLocalRefreshQueued) return;
            if (this.getBestLocalMatch(missing, 70)) return;

            missing.__urnLocalRefreshQueued = true;
            const task = (async () => {
                try {
                    await this.resolveUrnDataForMissing(missing);
                    await this.refreshUrnLocalMatches(missing);
                } catch (error) {
                    missing.__urnLocalRefreshFailed = true;
                    console.error('Model Resolver: initial URN local match refresh error:', error);
                }
            })();
            refreshTasks.push(task);
        });

        if (!refreshTasks.length || !container || !data) return;

        Promise.allSettled(refreshTasks).then(() => {
            if (!container.isConnected || this.activeTab !== 'missing') return;
            this.displayMissingModels(container, data);
        });
    }
};
