import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
import { getModelCardUrl } from "../utils/url_utils.js";
import { getCivitaiModelUrl } from "../globals.js";
import { safeStorage, normalizePathIdentity } from "../utils/html_utils.js";
const localStorage = safeStorage;
export const searchPanelMethods = {
    /**
     * Build stable cache key for a missing model entry
     */
    getMissingSearchKey(missing) {
        if (missing?.missing_search_key) {
            return String(missing.missing_search_key);
        }
        if (missing?.search_key) {
            return String(missing.search_key);
        }
        return this.getMissingModelKey(missing);
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
                lora_manager_archive: null,
                custom: [],
                local_hash_matches: []
            },
            explicitSearchSources: [],
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

    getBaseModelTokenVariants(value = '') {
        const text = String(value || '').trim();
        if (!text) return new Set();
        const variants = [
            text,
            text.replace(/(\d+)(?:[\s._-]+0)+(?!\d)/g, '$1')
        ];
        const normalized = this.normalizeBaseModelToken(text);
        if (normalized.startsWith('flux1') && normalized.length > 'flux1'.length) {
            variants.push(`flux${normalized.slice('flux1'.length)}`);
        }
        return new Set(
            variants
                .map(item => this.normalizeBaseModelToken(item))
                .filter(Boolean)
        );
    },

    resolveBaseModelAliasExact(value = '') {
        const tokens = this.getBaseModelTokenVariants(value);
        if (!tokens.size) return '';
        for (const entry of this.getBaseModelAliases()) {
            const aliases = [entry.value, ...(entry.aliases || [])];
            if (aliases.some(alias => {
                const aliasTokens = this.getBaseModelTokenVariants(alias);
                return [...aliasTokens].some(aliasToken => tokens.has(aliasToken));
            })) {
                return entry.value;
            }
        }
        return '';
    },

    resolveBaseModelAlias(value = '') {
        const tokens = this.getBaseModelTokenVariants(value);
        if (!tokens.size) return '';
        const exact = this.resolveBaseModelAliasExact(value);
        if (exact) return exact;

        for (const entry of this.getBaseModelAliases()) {
            const aliases = [entry.value, ...(entry.aliases || [])];
            if (aliases.some(alias => {
                const aliasTokens = this.getBaseModelTokenVariants(alias);
                return [...aliasTokens].some(aliasToken => (
                    aliasToken && [...tokens].some(token => (
                        aliasToken.includes(token) || token.includes(aliasToken)
                    ))
                ));
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
        const directoryParts = parts.filter(part => !this.hasModelExtension(part));

        for (const part of directoryParts) {
            const exact = this.resolveBaseModelAliasExact(part);
            if (exact) return exact;
        }

        return '';
    },

    getMissingLocalBaseModel(missing = {}, minConfidence = 70) {
        const bestMatch = this.getBestLocalMatch?.(missing, minConfidence);
        const matchModel = bestMatch?.model || {};
        const pathCandidates = [
            matchModel.relative_path,
            matchModel.path,
            bestMatch?.path,
            bestMatch?.filename
        ];

        for (const path of pathCandidates) {
            const canonical = this.resolveBaseModelAliasFromPath(path);
            if (canonical) return canonical;
        }
        return '';
    },

    getMissingAutoBaseModel(missing = {}) {
        return this.getMissingAutoBaseModelInfo(missing).value;
    },

    getBaseModelIndependentSearchType(missing = {}) {
        const normalizeType = (value) => String(value || '')
            .trim()
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const typeLabels = {
            sam: 'SAM',
            sams: 'SAM',
            sam_model: 'SAM',
            sam_models: 'SAM',
            ultralytics: 'Ultralytics',
            ultralytics_bbox: 'Ultralytics',
            ultralytics_segm: 'Ultralytics',
            yolo: 'Ultralytics'
        };
        const candidates = [
            missing?.category,
            missing?.model_type,
            missing?.urn_type
        ];
        for (const candidate of candidates) {
            const label = typeLabels[normalizeType(candidate)];
            if (label) return label;
        }

        const nodeType = normalizeType(missing?.node_type);
        if (nodeType === 'samloader' || nodeType === 'sam_loader') return 'SAM';
        if (nodeType === 'ultralyticsdetectorprovider' || nodeType === 'ultralytics_detector_provider') {
            return 'Ultralytics';
        }
        return '';
    },

    getMissingAutoBaseModelInfo(missing = {}) {
        const formatAutoMessage = (selected, reason, action = 'Choose a different option in the Model field.') => (
            `Selected automatically: ${selected}\n\nWhy: ${reason}\n\nTo change: ${action}`
        );
        const independentType = this.getBaseModelIndependentSearchType(missing);
        if (independentType) {
            return {
                value: '',
                source: 'independent model type',
                usesAnyModel: true,
                message: formatAutoMessage(
                    'Any model',
                    `${independentType} models are not tied to one base model, so no model filter is needed.`
                )
            };
        }

        const searchSuggestion = this.getCachedSearchSuggestionData?.(missing) || {};
        const directCandidates = [
            { value: missing?.download_source?.base_model, source: 'selected download source' },
            { value: missing?.download_source?.baseModel, source: 'selected download source' },
            { value: missing?.civitai_info?.base_model, source: 'model metadata' },
            { value: missing?.civitai_info?.baseModel, source: 'model metadata' }
        ];

        for (const { value, source } of directCandidates) {
            const canonical = this.resolveBaseModelAlias(value);
            if (canonical) {
                return {
                    value: canonical,
                    source,
                    message: formatAutoMessage(
                        canonical,
                        source === 'selected download source'
                            ? `The download source you selected identifies this model as ${canonical}.`
                            : `The model information saved with this workflow identifies it as ${canonical}.`
                    )
                };
            }
        }

        const savedTarget = this.getSavedDownloadTargetSelection?.(missing) || {};
        const explicitlySelectedSubfolder = savedTarget.subfolderTouched
            ? savedTarget.subfolder
            : '';
        const pathCandidates = [
            { value: this.getMissingLocalBaseModel(missing, 70), source: 'best local match' },
            { value: explicitlySelectedSubfolder, source: 'selected subfolder' }
        ];

        for (const { value, source } of pathCandidates) {
            const canonical = this.resolveBaseModelAliasFromPath(value)
                || this.resolveBaseModelAliasExact(value);
            if (canonical) {
                return {
                    value: canonical,
                    source,
                    message: formatAutoMessage(
                        canonical,
                        source === 'best local match'
                            ? `A reliable local match is stored in a folder associated with ${canonical}.`
                            : `The subfolder you selected is associated with ${canonical}.`
                    )
                };
            }
        }

        const fallbackPathCandidates = [
            { value: missing?.original_path, source: 'missing model path' },
            { value: missing?.name, source: 'missing model name' },
            { value: searchSuggestion.path, source: 'cached search path' }
        ];
        for (const { value, source } of fallbackPathCandidates) {
            const canonical = this.resolveBaseModelAliasFromPath(value);
            if (canonical) {
                return {
                    value: canonical,
                    source,
                    message: formatAutoMessage(
                        canonical,
                        source === 'missing model path'
                            ? `The model path saved in this workflow points to a folder associated with ${canonical}.`
                            : source === 'missing model name'
                                ? `The model name saved in this workflow contains a name associated with ${canonical}.`
                                : `A previously found model path points to a folder associated with ${canonical}.`
                    )
                };
            }
        }

        const cachedCandidates = [
            { value: searchSuggestion.base_model, source: 'cached search result' },
            { value: searchSuggestion.baseModel, source: 'cached search result' }
        ];
        for (const { value, source } of cachedCandidates) {
            const canonical = this.resolveBaseModelAlias(value);
            if (canonical) {
                return {
                    value: canonical,
                    source,
                    message: formatAutoMessage(
                        canonical,
                        `A compatible search result identifies this model as ${canonical}.`
                    )
                };
            }
        }

        const workflowFallback = this.getDominantWorkflowBaseModel();
        if (workflowFallback) {
            return {
                value: workflowFallback,
                source: 'workflow fallback',
                message: formatAutoMessage(
                    workflowFallback,
                    `This model could not be identified directly, so Model Resolver used the most common model type in this workflow.`,
                    'Choose another model here, or update the Base Models list in Options.'
                )
            };
        }

        return {
            value: '',
            source: 'none',
            message: formatAutoMessage(
                'No model filter',
                'There is not enough reliable information to identify the model type.',
                'Choose a model here, or update the Base Models list in Options.'
            )
        };
    },

    getSearchBaseModelTooltip(missing = {}) {
        const state = this.getSearchState(missing);
        const selected = state.selectedBaseModel || this.getDefaultSearchBaseModel();
        if (selected === 'none') {
            return 'Selected: Any model\n\nWhy: Searches will not be limited to one model type.\n\nTo change: Choose Auto or a specific model.';
        }
        if (selected && selected !== 'auto') {
            return `Selected manually: ${selected}\n\nWhy: Searches are limited to this model type.\n\nTo change: Choose Auto, Any model, or another model.`;
        }
        return this.getMissingAutoBaseModelInfo(missing).message;
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
                if (this.hasModelExtension(value) || /model|checkpoint|unet|diffusion/i.test(key)) {
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

    getSearchBaseModelLabel(value = 'auto', missing = {}) {
        if (value === 'auto') {
            const autoInfo = missing ? this.getMissingAutoBaseModelInfo(missing) : null;
            if (autoInfo?.usesAnyModel) return 'Auto (Any model)';
            const detected = autoInfo ? autoInfo.value : this.getDominantWorkflowBaseModel();
            return detected ? `Auto (${detected})` : 'Auto';
        }
        const option = this.getKnownBaseModelOptions().find(item => item.value === value);
        return option?.label || value || 'Auto';
    },

    getSearchBaseModelInputValue(text = '', missing = {}) {
        const raw = String(text || '').trim();
        if (!raw) return 'none';
        const normalized = this.normalizeBaseModelToken(raw);
        for (const option of this.getKnownBaseModelOptions()) {
            const label = option.value === 'auto'
                ? this.getSearchBaseModelLabel('auto', missing)
                : option.label;
            const optionTokens = [
                option.value,
                label
            ].flatMap(value => [...this.getBaseModelTokenVariants(value)]);
            if (optionTokens.some(token => token === normalized)) {
                return option.value;
            }
        }
        return this.resolveBaseModelAliasExact(raw) || raw;
    },

    getSearchBaseModelContext(missing = {}) {
        const state = this.getSearchState(missing);
        const selected = state.selectedBaseModel || this.getDefaultSearchBaseModel();
        if (selected === 'none') return '';
        if (selected === 'auto') return this.getMissingAutoBaseModel(missing);
        return selected;
    },

    getSearchButtonLabelLines(text = '') {
        const label = String(text || '').replace(/\s+/g, ' ').trim() || 'Search Online';
        const normalized = label.toLowerCase();
        if (normalized === 'search' || normalized === 'search online') {
            return ['Online'];
        }
        if (normalized === 'search again') {
            return ['Again'];
        }
        const searchingMatch = label.match(/^Searching(?:\s+(.+?))?\.{0,3}$/i);
        if (searchingMatch) {
            return ['Searching'];
        }
        return label.split(' ');
    },

    renderSearchButtonContent(text = '') {
        const lines = this.getSearchButtonLabelLines(text);
        const labelHtml = lines
            .map(line => `<span class="mr-search-btn-line">${this.escapeHtml(line)}</span>`)
            .join('');
        return `${this.getSearchIconHtml()} <span class="mr-search-btn-text">${labelHtml}</span>`;
    },

    renderCustomUrlButtonContent(text = 'Add') {
        return `<span class="mr-btn-icon" aria-hidden="true">${getSvgIcon('link')}</span><span>${this.escapeHtml(text)}</span>`;
    },

    getBackgroundSearchJobKey(workflowKey, missingSearchKey) {
        return `${workflowKey || 'workflow'}\n${missingSearchKey || 'missing'}`;
    },

    getBackgroundSearchJob(workflowKey, missingSearchKey) {
        return this.backgroundSearchJobs?.get(
            this.getBackgroundSearchJobKey(workflowKey, missingSearchKey)
        ) || null;
    },

    hasBackgroundSearchJob(workflowKey, missingSearchKey, runId = null) {
        const job = this.getBackgroundSearchJob(workflowKey, missingSearchKey);
        if (!job) return false;
        return !runId || job.runId === runId;
    },

    isBackgroundSearchRunActive(workflowKey, missingSearchKey, runId) {
        return this.hasBackgroundSearchJob(workflowKey, missingSearchKey, runId);
    },

    isSearchSourceCancelled(workflowKey, missingSearchKey, runId, source) {
        const job = this.getBackgroundSearchJob(workflowKey, missingSearchKey);
        return Boolean(job?.runId === runId && job.cancelledSources?.has(source));
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
            return;
        }

        const activeWorkflowKey = this.getWorkflowScopedQueueKey();
        const activeState = this.searchResultCache?.get(missingSearchKey);
        const runId = state.activeSearchRunId || activeState?.activeSearchRunId;
        const mirrorsActiveSearch = Boolean(
            activeState === state
            || (
                runId
                && activeState?.activeSearchRunId === runId
                && this.hasBackgroundSearchJob(activeWorkflowKey, missingSearchKey, runId)
            )
        );
        if (mirrorsActiveSearch) {
            this.searchResultCache.set(missingSearchKey, state);
            this.saveSearchCacheForActiveWorkflow?.();
        }
    },

    refreshSearchUiForMissing(missing, state = null, { workflowKey = this.getWorkflowScopedQueueKey() } = {}) {
        if (!missing) return;
        const activeWorkflowKey = this.getWorkflowScopedQueueKey();
        const missingSearchKey = this.getMissingSearchKey(missing);
        let currentState = state || this.searchResultCache.get(missingSearchKey);
        if (workflowKey && workflowKey !== activeWorkflowKey) {
            const activeState = this.searchResultCache.get(missingSearchKey);
            const runId = currentState?.activeSearchRunId || activeState?.activeSearchRunId;
            const mirrorsActiveSearch = Boolean(
                activeState === currentState
                || (
                    runId
                    && activeState?.activeSearchRunId === runId
                    && this.hasBackgroundSearchJob(activeWorkflowKey, missingSearchKey, runId)
                )
            );
            if (!mirrorsActiveSearch) return;
            currentState = activeState || currentState;
        }
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
            const hasSearchAttempt = this.hasRenderableSearchState(currentState);
            searchBtn.disabled = isRunning;
            searchBtn.innerHTML = isRunning
                ? this.renderSearchButtonContent('Searching...')
                : this.renderSearchButtonContent(hasSearchAttempt ? 'Search Again' : 'Search Online');
        }
    },

    /**
     * Merge new search results into cached per-source results.
     * Empty normal responses do not delete previous results; forced refreshes do.
     */
    mergeSearchResults(existingResults = {}, newResults = {}, { searchedAt = null, forceRefresh = false } = {}) {
        const searchedSources = new Set(Array.isArray(newResults.searched_sources) ? newResults.searched_sources : []);
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
            if (forceRefresh && sourceWasSearched) {
                return null;
            }
            return existingResults[source] || null;
        };
        const hashSourcesToClear = forceRefresh
            ? this.getHashLookupSourcesForSearchSources(Array.from(searchedSources))
            : new Set();
        const existingHashMatches = Array.isArray(existingResults.local_hash_matches)
            ? existingResults.local_hash_matches.filter(match => {
                if (!hashSourcesToClear.size) return true;
                const source = String(match?.hash_lookup_source || '').trim();
                return source && !hashSourcesToClear.has(source);
            })
            : [];
        const localHashMatches = this.mergeLocalMatches
            ? this.mergeLocalMatches(
                existingHashMatches,
                Array.isArray(newResults.local_hash_matches) ? newResults.local_hash_matches : []
            )
            : [
                ...existingHashMatches,
                ...(Array.isArray(newResults.local_hash_matches) ? newResults.local_hash_matches : [])
            ];

        return {
            popular: pickResult('popular'),
            model_list: pickResult('model_list'),
            huggingface: pickResult('huggingface'),
            civitai: pickResult('civitai'),
            civarchive: pickResult('civarchive'),
            lora_manager_archive: pickResult('lora_manager_archive'),
            custom: Array.isArray(newResults.custom)
                ? newResults.custom
                : (Array.isArray(existingResults.custom) ? existingResults.custom : []),
            local_hash_matches: localHashMatches
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
        return !!(
            data.popular
            || data.model_list
            || data.huggingface
            || data.civitai
            || data.civarchive
            || data.lora_manager_archive
            || (Array.isArray(data.custom) && data.custom.length)
        );
    },

    isAnyModelSearchResult(result) {
        if (Array.isArray(result)) {
            return result.some(item => this.isAnyModelSearchResult(item));
        }
        return Boolean(result && typeof result === 'object' && (result.any_model_match || result.base_model_fallback));
    },

    hasSearchResultsForMissing(missing = {}) {
        if (missing?.download_source?.url) return true;
        const state = this.searchResultCache?.get(this.getMissingSearchKey(missing));
        return this.hasSearchResults(state?.results || {});
    },

    hasSearchAttemptForMissing(missing = {}) {
        if (missing?.download_source?.url) return true;
        const state = this.searchResultCache?.get(this.getMissingSearchKey(missing));
        return this.hasRenderableSearchState?.(state || {}) || this.hasSearchResults(state?.results || {});
    },

    getSearchResultKeysForSources(sources = []) {
        const normalized = new Set((Array.isArray(sources) ? sources : [sources])
            .map(source => String(source || '').trim())
            .filter(Boolean));
        if (normalized.has('all')) {
            return ['popular', 'model_list', 'huggingface', 'civitai', 'civarchive', 'lora_manager_archive'];
        }

        const keys = new Set();
        for (const source of normalized) {
            if (source === 'local') {
                keys.add('popular');
                keys.add('model_list');
            } else if (source) {
                keys.add(source);
            }
        }
        return Array.from(keys);
    },

    getHashLookupSourcesForSearchSources(sources = []) {
        const normalized = new Set((Array.isArray(sources) ? sources : [sources])
            .map(source => String(source || '').trim())
            .filter(Boolean));
        const hashSources = ['huggingface', 'civitai', 'civarchive'];
        if (normalized.has('all')) return new Set(hashSources);
        return new Set(hashSources.filter(source => normalized.has(source)));
    },

    clearSearchResultsForSources(results = {}, sources = []) {
        const nextResults = {
            popular: results.popular || null,
            model_list: results.model_list || null,
            huggingface: results.huggingface || null,
            civitai: results.civitai || null,
            civarchive: results.civarchive || null,
            lora_manager_archive: results.lora_manager_archive || null,
            custom: Array.isArray(results.custom) ? results.custom : [],
            local_hash_matches: Array.isArray(results.local_hash_matches) ? results.local_hash_matches : []
        };
        for (const key of this.getSearchResultKeysForSources(sources)) {
            if (key in nextResults) nextResults[key] = null;
        }

        const hashSourcesToClear = this.getHashLookupSourcesForSearchSources(sources);
        if (hashSourcesToClear.size) {
            nextResults.local_hash_matches = nextResults.local_hash_matches.filter(match => {
                const source = String(match?.hash_lookup_source || '').trim();
                return source && !hashSourcesToClear.has(source);
            });
        }
        return nextResults;
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
            lora_manager_archive: 'LoRA Manager Archive',
            custom: 'Custom URL'
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

    getBackendSearchProgressTimerKey(runId, source) {
        return `${runId || 'search'}:${source}:backend`;
    },

    clearBackendSearchProgressTimer(runId, source) {
        const key = this.getBackendSearchProgressTimerKey(runId, source);
        const timer = this.backendSearchProgressTimers?.get(key);
        if (timer) {
            clearInterval(timer.interval);
            this.backendSearchProgressTimers.delete(key);
        }
    },

    clearBackendSearchProgressTimers(runId) {
        if (!runId || !this.backendSearchProgressTimers) return;
        const prefix = `${runId}:`;
        for (const [key, timer] of this.backendSearchProgressTimers.entries()) {
            if (key.startsWith(prefix)) {
                clearInterval(timer.interval);
                this.backendSearchProgressTimers.delete(key);
            }
        }
    },

    startBackendSearchProgressPolling(state, missing, source, runId, progressId, { workflowKey = this.getWorkflowScopedQueueKey() } = {}) {
        if (!progressId || !source || !runId) return;
        if (!(this.backendSearchProgressTimers instanceof Map)) {
            this.backendSearchProgressTimers = new Map();
        }

        this.clearBackendSearchProgressTimer(runId, source);
        const key = this.getBackendSearchProgressTimerKey(runId, source);
        const timerRecord = { interval: null, inFlight: false };

        const tick = async () => {
            const missingSearchKey = this.getMissingSearchKey(missing);
            if (
                state.activeSearchRunId !== runId
                && !this.isBackgroundSearchRunActive(workflowKey, missingSearchKey, runId)
            ) {
                this.clearBackendSearchProgressTimer(runId, source);
                return;
            }

            const currentProgress = state.sourceProgress?.[source];
            if (!currentProgress || (currentProgress.status !== 'pending' && currentProgress.status !== 'running')) {
                this.clearBackendSearchProgressTimer(runId, source);
                return;
            }
            if (timerRecord.inFlight) return;

            timerRecord.inFlight = true;
            try {
                const progress = await this.fetchJson(`/model_resolver/search-progress/${encodeURIComponent(progressId)}`, {
                    silent: true
                }, 'Poll search progress');
                if (!progress) return;
                if (!progress?.exists) return;
                const latestProgress = state.sourceProgress?.[source];
                if (!latestProgress || (latestProgress.status !== 'pending' && latestProgress.status !== 'running')) {
                    this.clearBackendSearchProgressTimer(runId, source);
                    return;
                }

                if (progress.status === 'error') {
                    this.setSourceProgress(state, source, {
                        status: 'error',
                        percent: 100,
                        message: progress.message || 'Error',
                        error: progress.message || 'Error',
                        backendStage: progress.stage || ''
                    }, missing, { workflowKey });
                    this.persistSearchStateForWorkflow(workflowKey, missing, state);
                    this.refreshSearchUiForMissing(missing, state, { workflowKey });
                    this.clearBackendSearchProgressTimer(runId, source);
                    return;
                }

                if (progress.status === 'completed') {
                    this.clearBackendSearchProgressTimer(runId, source);
                    return;
                }

                const nextPercent = Math.max(
                    Number(currentProgress.percent) || 0,
                    Number(progress.percent) || 0
                );
                this.setSourceProgress(state, source, {
                    status: 'running',
                    percent: nextPercent,
                    message: progress.message || currentProgress.message || 'Searching...',
                    backendStage: progress.stage || currentProgress.backendStage || ''
                }, missing, { workflowKey });
                this.persistSearchStateForWorkflow(workflowKey, missing, state);
                this.refreshSearchUiForMissing(missing, state, { workflowKey });
            } catch (error) {
                this.clearBackendSearchProgressTimer(runId, source);
            } finally {
                timerRecord.inFlight = false;
            }
        };

        timerRecord.interval = setInterval(tick, 550);
        this.backendSearchProgressTimers.set(key, timerRecord);
        tick();
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

    settleInactiveSearchProgress(missing, state = null, {
        workflowKey = this.getWorkflowScopedQueueKey(),
        message = 'Search interrupted',
        persist = true,
        refresh = true
    } = {}) {
        if (!missing || !state) return false;

        const runId = state.activeSearchRunId;
        const missingSearchKey = this.getMissingSearchKey(missing);
        const hasActiveJob = Boolean(
            runId && this.hasBackgroundSearchJob(workflowKey, missingSearchKey, runId)
        );
        if (hasActiveJob) return false;

        let changed = false;
        let markedError = false;
        let markedFound = false;

        if (runId) {
            this.clearSearchProgressTimers(runId);
            state.activeSearchRunId = null;
            changed = true;
        }

        for (const [source, progress] of Object.entries(state.sourceProgress || {})) {
            if (!progress || (progress.status !== 'pending' && progress.status !== 'running')) continue;

            const resultStatus = this.getMissingSourceResultStatus?.(missing, source, state) || '';
            const hasResult = resultStatus === 'exact'
                || resultStatus === 'partial'
                || resultStatus === 'found';

            state.sourceProgress[source] = {
                ...progress,
                status: hasResult ? 'found' : 'error',
                percent: 100,
                message: hasResult ? 'Found' : message,
                error: hasResult ? null : (progress.error || message)
            };
            markedFound = markedFound || hasResult;
            markedError = markedError || !hasResult;
            changed = true;
        }

        if (!changed) return false;

        if (markedFound) {
            state.lastAttemptFound = true;
        }
        if (markedError && !state.lastAttemptError) {
            state.lastAttemptError = message;
        }

        if (persist) {
            this.persistSearchStateForWorkflow(workflowKey, missing, state);
        }
        if (refresh) {
            this.refreshSearchUiForMissing(missing, state, { workflowKey });
        }
        return true;
    },

    syncSearchProgressAfterResume(missingModels = this.missingModels || [], { workflowKey = this.getWorkflowScopedQueueKey() } = {}) {
        for (const missing of missingModels || []) {
            const missingSearchKey = this.getMissingSearchKey(missing);
            const state = workflowKey === this.getWorkflowScopedQueueKey()
                ? this.searchResultCache.get(missingSearchKey)
                : this.getWorkflowSearchCache(workflowKey)?.get(missingSearchKey);
            if (!state) continue;

            if (this.settleInactiveSearchProgress(missing, state, { workflowKey })) {
                continue;
            }

            const runId = state.activeSearchRunId;
            if (!runId || !this.hasBackgroundSearchJob(workflowKey, missingSearchKey, runId)) continue;

            const job = this.getBackgroundSearchJob(workflowKey, missingSearchKey);
            for (const [source, progress] of Object.entries(state.sourceProgress || {})) {
                if (progress?.status !== 'running') continue;
                const progressId = job?.sourceProgressIds?.get?.(source);
                if (progressId) {
                    this.startBackendSearchProgressPolling?.(state, missing, source, runId, progressId, { workflowKey });
                }
                this.startEstimatedSearchProgress(state, missing, null, source, runId, { workflowKey });
            }
            this.refreshSearchUiForMissing(missing, state, { workflowKey });
        }
    },

    reconnectActiveSearchProgress(missingModels = this.missingModels || []) {
        this.syncSearchProgressAfterResume(missingModels);
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
            error: 'Error',
            cancelled: 'Cancelled'
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
            const canCancel = state.activeSearchRunId && (status === 'pending' || status === 'running');
            const percent = status === 'pending'
                ? 0
                : (status === 'running' ? progress?.percent : 100);
            const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
            const runningMessage = progress?.message || 'Searching...';
            const statusLabel = status === 'running'
                ? `${runningMessage} ${Math.round(safePercent)}%`
                : (progress?.message || statusLabels[status] || status);
            const title = progress?.error ? ` data-tooltip="${this.escapeHtml(`${label}: ${progress.error}`)}"` : '';
            const cancelButton = canCancel
                ? `<button type="button" class="mr-search-result-action-btn mr-search-progress-cancel" data-source="${this.escapeHtml(source)}" data-run-id="${this.escapeHtml(state.activeSearchRunId)}" data-tooltip="Cancel ${this.escapeHtml(label)} search" aria-label="Cancel ${this.escapeHtml(label)} search">${getSvgIcon('x')}</button>`
                : '';
            html += `
                <div class="mr-search-progress-item mr-search-progress-${statusClass}"${title}>
                    <div class="mr-search-progress-head">
                        <span class="mr-search-progress-source">${this.escapeHtml(label)}</span>
                        <span class="mr-search-progress-status">${this.escapeHtml(statusLabel)}</span>
                        ${cancelButton}
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

    wireSearchProgressCancelButtons(container, missing, state = null, { workflowKey = this.getWorkflowScopedQueueKey() } = {}) {
        if (!container || !missing) return;
        container.querySelectorAll?.('.mr-search-progress-cancel').forEach(button => {
            if (button.dataset.mlCancelSearchBound === '1') return;
            button.dataset.mlCancelSearchBound = '1';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const source = button.dataset.source || '';
                const runId = button.dataset.runId || state?.activeSearchRunId || '';
                this.cancelSearchSource(missing, source, runId, { workflowKey });
            });
        });
    },

    cancelBackendSearchProgress(progressId = '') {
        const id = String(progressId || '').trim();
        if (!id) return;
        this.fetchJson(`/model_resolver/search-cancel/${encodeURIComponent(id)}`, {
            method: 'POST',
            silent: true
        }, 'Cancel search').catch(error => {
            console.warn('Model Resolver: backend search cancel failed', error);
        });
    },

    cancelSearchSource(missing, source, runId = '', { workflowKey = this.getWorkflowScopedQueueKey() } = {}) {
        if (!missing || !source || !runId) return false;

        const missingSearchKey = this.getMissingSearchKey(missing);
        const state = this.getSearchStateForWorkflow(workflowKey, missing);
        const job = this.getBackgroundSearchJob(workflowKey, missingSearchKey);
        if (!state || state.activeSearchRunId !== runId || !job || job.runId !== runId) return false;

        job.cancelledSources = job.cancelledSources || new Set();
        job.cancelledSources.add(source);
        const progressId = job.sourceProgressIds?.get(source) || '';
        this.cancelBackendSearchProgress(progressId);
        const controller = job.sourceControllers?.get(source);
        if (controller && !controller.signal?.aborted) {
            controller.abort();
        }

        this.clearSearchProgressTimer(runId, source);
        this.setSourceProgress(state, source, {
            status: 'cancelled',
            percent: 100,
            message: 'Cancelled',
            error: null
        }, missing, { workflowKey });

        const hasRunningSources = Object.entries(state.sourceProgress || {}).some(([entrySource, progress]) => (
            entrySource !== source
            && (progress?.status === 'pending' || progress?.status === 'running')
            && !job.cancelledSources?.has(entrySource)
        ));

        if (!hasRunningSources) {
            state.activeSearchRunId = null;
            this.clearSearchProgressTimers(runId);
            this.backgroundSearchJobs?.delete(this.getBackgroundSearchJobKey(workflowKey, missingSearchKey));
        }

        this.persistSearchStateForWorkflow(workflowKey, missing, state);
        this.refreshSearchUiForMissing(missing, state, { workflowKey });
        return true;
    },

    cancelBackgroundSearchJob(job = null) {
        if (!job?.missing || !job.runId) return false;
        const sources = new Set([
            ...Array.from(job.sourceControllers?.keys?.() || []),
            ...Array.from(job.sourceProgressIds?.keys?.() || []),
            ...Object.keys(this.getSearchStateForWorkflow(job.workflowKey, job.missing)?.sourceProgress || {})
        ]);
        let cancelled = false;
        for (const source of sources) {
            cancelled = this.cancelSearchSource(job.missing, source, job.runId, {
                workflowKey: job.workflowKey || this.getWorkflowScopedQueueKey()
            }) || cancelled;
        }
        return cancelled;
    },

    /**
     * Update source selector buttons and helper text for one card
     */
    updateSearchBaseModelHelp(container, missing) {
        if (!container || !missing) return;
        const baseId = `search-base-select-${missing.node_id}-${missing.widget_index}`;
        const labelEl = container.querySelector(`label[for="${baseId}"]`);
        const helpEl = labelEl?.querySelector('.mr-search-model-help');
        if (helpEl) {
            helpEl.setAttribute('data-tooltip', this.getSearchBaseModelTooltip(missing));
        }
    },

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
            this.setDropdownValue(baseEl, state.selectedBaseModel, this.getSearchBaseModelLabel(state.selectedBaseModel, missing));
            this.updateSearchBaseModelHelp(container, missing);
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

    setSearchBaseModel(missing, baseModel, container, options = {}) {
        const { sync = true } = options || {};
        const state = this.getSearchState(missing);
        const nextBaseModel = baseModel || this.getDefaultSearchBaseModel();
        state.selectedBaseModel = nextBaseModel;
        this.persistSearchStateForActiveWorkflow();
        if (sync) {
            this.syncSearchSourceUi(missing, container);
        } else {
            this.updateSearchBaseModelHelp(container, missing);
        }
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
                const missingKey = baseEl.dataset?.missingSearchKey || '';
                const missing = (this.missingModels || []).find(item => this.getMissingSearchKey(item) === missingKey) || {};
                this.setDropdownValue(baseEl, value, this.getSearchBaseModelLabel(value, missing));
                this.updateSearchBaseModelHelp(container, missing);
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
            custom: 'link',
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

        const sourcePx = Math.max(118, this.estimateTextWidth('x'.repeat(maxSourceLabel), 6, 34, 100) + 52);
        const matchPx = this.estimateTextWidth('x'.repeat(maxMatchLabel), 7, 34, 76) + 22;
        const sizePx = this.estimateTextWidth('x'.repeat(maxSizeLabel), 6.5, 42, 88) + 30;
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

    getSearchResultMatchDisplay(result = {}, fallbackLabel = 'Match', fallbackClass = 'neutral', hashLabel = '') {
        const matchType = String(result.match_type || '').toLowerCase();
        const resolvedHashLabel = String(hashLabel || result.hash_match_label || result.hashLabel || '').trim();
        if (resolvedHashLabel || result.hash_verified || result.hash_verified_sha256 || matchType === 'hash') {
            return { label: resolvedHashLabel || 'Hash', className: 'hash' };
        }

        if (matchType === 'exact') {
            return { label: 'Exact', className: 'strong' };
        }
        if (matchType === 'model_title') {
            return { label: 'Title', className: 'strong' };
        }
        if (matchType === 'custom_url' || result.custom_url || result.url_source === 'custom') {
            return { label: 'Provided', className: 'strong' };
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

    normalizeSearchResultSha256(value = '') {
        let text = String(value || '').trim();
        text = text.replace(/^sha256[:=]/i, '').trim().toLowerCase();
        return /^[a-f0-9]{64}$/.test(text) ? text : '';
    },

    getSearchResultSha256(result = {}) {
        if (!result || typeof result !== 'object') return '';

        const hashes = result.hashes && typeof result.hashes === 'object' ? result.hashes : {};
        const fileInfo = result.file_info && typeof result.file_info === 'object' ? result.file_info : {};
        const fileHashes = fileInfo.hashes && typeof fileInfo.hashes === 'object' ? fileInfo.hashes : {};
        const candidates = [
            result.hash_verified_sha256,
            result.sha256,
            result.hash,
            hashes.SHA256,
            hashes.sha256,
            fileInfo.sha256,
            fileInfo.hash,
            fileHashes.SHA256,
            fileHashes.sha256
        ];

        for (const candidate of candidates) {
            const hash = this.normalizeSearchResultSha256(candidate);
            if (hash) return hash;
        }
        return '';
    },

    collectHashLabelMapHashes(missing = {}, results = null) {
        const hashes = [];
        const seen = new Set();
        const addHash = (value) => {
            const hash = this.normalizeSearchResultSha256?.(value)
                || String(value || '').trim().toLowerCase();
            if (!hash || !/^[a-f0-9]{64}$/.test(hash) || seen.has(hash)) return;
            seen.add(hash);
            hashes.push(hash);
        };
        const addMatch = (match) => {
            if (!match || typeof match !== 'object') return;
            if (!(match.hash_match || match.match_type === 'hash' || match.hash_lookup_source)) return;
            addHash(this.getLocalMatchHash?.(match) || match.sha256 || match.hash);
        };
        const addResult = (result) => {
            if (Array.isArray(result)) {
                result.forEach(addResult);
                return;
            }
            if (!result || typeof result !== 'object') return;
            const matchType = String(result.match_type || '').toLowerCase();
            if (!(result.hash_verified || result.hash_verified_sha256 || matchType === 'hash')) return;
            addHash(this.getSearchResultSha256?.(result) || result.sha256 || result.hash);
        };

        (Array.isArray(missing.matches) ? missing.matches : []).forEach(addMatch);

        const stateResults = results
            || this.getSearchState?.(missing)?.results
            || this.searchResultCache?.get?.(this.getMissingSearchKey?.(missing))?.results
            || {};
        (Array.isArray(stateResults.local_hash_matches) ? stateResults.local_hash_matches : []).forEach(addMatch);

        [
            missing.download_source,
            stateResults.popular,
            stateResults.model_list,
            stateResults.huggingface,
            stateResults.civitai,
            stateResults.civarchive,
            stateResults.lora_manager_archive,
            ...(Array.isArray(stateResults.custom) ? stateResults.custom : [])
        ].forEach(addResult);

        return hashes;
    },

    getHashMatchLabelMap(missing = {}, results = null) {
        const hashes = this.collectHashLabelMapHashes?.(missing, results) || [];
        const labelMap = new Map();
        if (!hashes.length) return labelMap;

        const useNumbers = hashes.length > 1;
        hashes.forEach((hash, index) => {
            labelMap.set(hash, useNumbers ? `Hash ${index + 1}` : 'Hash');
        });
        return labelMap;
    },

    getHashMatchLabelForSearchResult(result = {}, hashLabelMap = null, identities = []) {
        const hash = this.getSearchResultSha256?.(result) || '';
        const label = hash && hashLabelMap?.get?.(hash) ? hashLabelMap.get(hash) : '';
        if (!label) return '';

        const matchType = String(result.match_type || '').toLowerCase();
        const hasLinkedLocalMatch = Array.isArray(identities) && identities.length > 0;
        return (hasLinkedLocalMatch || result.hash_verified || result.hash_verified_sha256 || matchType === 'hash')
            ? label
            : '';
    },

    normalizeHashLookupSourceKey(source = '') {
        return String(source || '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_');
    },

    getLocalHashMatchIdentitiesForResult(hashMatches = [], sourceKey = '', sourceResult = {}) {
        const identities = [];
        const seen = new Set();
        const addIdentity = (identity) => {
            const normalized = String(identity || '').trim();
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            identities.push(normalized);
        };

        if (Array.isArray(sourceResult?.hash_verified_local_match_identities)) {
            sourceResult.hash_verified_local_match_identities.forEach(addIdentity);
        }

        const normalizedSource = this.normalizeHashLookupSourceKey(sourceKey);
        const sourceHash = this.getSearchResultSha256(sourceResult);
        if (!Array.isArray(hashMatches) || !hashMatches.length || !normalizedSource) {
            return identities;
        }

        hashMatches.forEach(match => {
            if (!match || typeof match !== 'object') return;

            const matchSource = this.normalizeHashLookupSourceKey(match.hash_lookup_source || '');
            const matchHash = this.normalizeSearchResultSha256(this.getLocalMatchHash(match));
            if (sourceHash) {
                if (matchHash !== sourceHash) return;
            } else if (!matchSource || matchSource !== normalizedSource) {
                return;
            }

            addIdentity(this.getLocalMatchIdentity?.(match) || '');
        });

        return identities;
    },

    getDownloadSourceTableRow(missing, downloadSource = {}, hashLabelMap = null) {
        if (!downloadSource?.url) return null;

        const originalFilename = this.getFilenameFromPath(missing.original_path);
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
        const modelUrl = getModelCardUrl(rawModelUrl) || rawModelUrl;
        const versionName = downloadSource.version_name || missing.civitai_info?.version_name || '';
        const modelParts = this.getModelVersionParts(
            downloadSource.name || missing.civitai_info?.model_name || '',
            versionName
        );
        const modelName = modelParts.name || downloadFilename;
        const fullModelName = this.getVersionedModelName(modelName, modelParts.version);
        const baseModel = downloadSource.base_model || missing.civitai_info?.base_model || '';
        const rowCategory = this.getSourceResultDownloadCategory?.(
            downloadSource,
            downloadSource.directory || downloadSource.category || this.getMissingDownloadCategory?.(missing, 'checkpoints') || 'checkpoints',
            missing
        ) || downloadSource.directory || downloadSource.category || this.getMissingDownloadCategory?.(missing, 'checkpoints') || 'checkpoints';
        const secondaryParts = [
            sourceSecondary,
            fullModelName && fullModelName !== downloadFilename ? downloadFilename : '',
            baseModel
        ].filter(Boolean);
        const rowPathMetadata = this.getDownloadPathMetadata(missing, {
            ...downloadSource,
            filename: downloadFilename,
            model: modelName,
            version: modelParts.version,
            category: rowCategory
        });
        const rowDetailsContext = ['civitai', 'civarchive'].includes(String(source).toLowerCase())
            ? {
                ...downloadSource,
                source,
                details_source: String(source).toLowerCase(),
                model_id: downloadSource.model_id,
                version_id: downloadSource.version_id,
                name: modelName,
                filename: downloadFilename,
                missing_key: this.getMissingModelKey(missing),
                category: rowCategory
            }
            : null;
        const localHashMatches = Array.isArray(missing.matches)
            ? missing.matches.filter(match => match?.hash_lookup_source)
            : [];
        const localHashMatchIdentities = this.getLocalHashMatchIdentitiesForResult?.(
            localHashMatches,
            source,
            downloadSource
        ) || [];
        const resolvedHashLabelMap = hashLabelMap || this.getHashMatchLabelMap?.(missing) || null;
        const hashMatchLabel = this.getHashMatchLabelForSearchResult?.(
            downloadSource,
            resolvedHashLabelMap,
            localHashMatchIdentities
        ) || '';

        return {
            sourceKey,
            sourceLabel,
            model: modelName,
            version: modelParts.version,
            filename: downloadFilename,
            secondary: secondaryParts.join(' / '),
            size: this.formatSearchResultSize(downloadSource),
            downloadUrl: downloadSource.url,
            downloadFilename,
            category: rowCategory,
            openUrl: modelUrl,
            searchedAt: this.getSearchResultTimestamp(downloadSource),
            localHashMatchIdentities,
            pathMetadata: rowPathMetadata,
            downloadMetadata: this.getDownloadMetadata(missing, rowDetailsContext || {
                ...downloadSource,
                filename: downloadFilename,
                model: modelName,
                version: modelParts.version,
                category: rowCategory
            }, {
                filename: downloadFilename,
                category: rowCategory,
                url: downloadSource.url,
                openUrl: modelUrl,
                pathMetadata: rowPathMetadata
            }),
            detailsContext: rowDetailsContext,
            match: isFromWorkflow
                ? { label: 'Provided', className: 'strong' }
                : this.getSearchResultMatchDisplay(downloadSource, 'Known', 'strong', hashMatchLabel)
        };
    },

    getCustomUrlResultTableRow(missing, result = {}, hashLabelMap = null, localHashMatches = []) {
        if (!result || typeof result !== 'object') return null;

        const source = String(result.source || result.details_source || 'custom').toLowerCase().replace(/-/g, '_');
        const sourceLabels = {
            huggingface: 'HuggingFace',
            civitai: 'CivitAI',
            civarchive: 'CivArchive',
            custom: 'Custom URL'
        };
        const sourceKeys = {
            huggingface: 'huggingface',
            civitai: 'civitai',
            civarchive: 'civarchive',
            custom: 'custom'
        };
        const downloadUrl = result.download_url || result.downloadUrl || result.url || '';
        if (!downloadUrl) return null;

        const originalFilename = this.getFilenameFromPath(missing.original_path);
        const filename = result.filename || this.getFilenameFromPath(result.path || downloadUrl) || originalFilename || 'model';
        const modelName = result.name || result.model_name || result.repo_id || result.repo || filename;
        const category = this.getSourceResultDownloadCategory?.(
            result,
            this.getMissingDownloadCategory?.(missing, 'checkpoints') || missing.category || 'checkpoints',
            missing
        ) || this.getMissingDownloadCategory?.(missing, 'checkpoints') || missing.category || 'checkpoints';
        const openUrl = source === 'huggingface'
            ? (result.page_url || result.version_url || getModelCardUrl(downloadUrl) || result.url)
            : (result.version_url || result.url || result.platform_url || getModelCardUrl(downloadUrl));
        const version = result.version_name || '';
        const secondary = source === 'huggingface'
            ? [result.path && result.path !== filename ? result.path : ''].filter(Boolean).join(' / ')
            : [
                modelName && modelName !== filename ? filename : '',
                result.type || '',
                result.base_model || ''
            ].filter(Boolean).join(' / ');
        const detailsContext = {
            ...result,
            source,
            details_source: source,
            custom_url: true,
            url_source: 'custom',
            model_id: result.model_id || result.modelId,
            version_id: result.version_id || result.versionId,
            name: modelName,
            filename,
            missing_key: this.getMissingModelKey(missing),
            category
        };
        const localHashMatchIdentities = this.getLocalHashMatchIdentitiesForResult?.(
            localHashMatches,
            source,
            result
        ) || [];
        const hashMatchLabel = this.getHashMatchLabelForSearchResult?.(
            result,
            hashLabelMap,
            localHashMatchIdentities
        ) || '';

        return {
            sourceKey: sourceKeys[source] || 'custom',
            sourceLabel: sourceLabels[source] || 'Custom URL',
            model: modelName,
            version,
            filename,
            secondary,
            match: this.getSearchResultMatchDisplay(result, 'Provided', 'strong', hashMatchLabel),
            size: this.formatSearchResultSize(result),
            downloadUrl,
            downloadFilename: filename,
            category,
            openUrl,
            searchedAt: this.getSearchResultTimestamp(result),
            localHashMatchIdentities,
            detailsContext
        };
    },

    renderKnownDownloadPanel(missing, downloadSource) {
        let html = `<div class="mr-download-section">`;
        html += this.renderSearchControls(missing, { buttonText: 'Search Again' });
        html += this.renderDownloadTargetControls(
            missing,
            downloadSource.directory || downloadSource.category || this.getMissingDownloadCategory?.(missing, 'checkpoints') || 'checkpoints'
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
            const localHashMatchIdentities = Array.isArray(row.localHashMatchIdentities)
                ? row.localHashMatchIdentities.filter(Boolean)
                : [];
            const hashMatchTargetData = localHashMatchIdentities.length
                ? encodeURIComponent(JSON.stringify(localHashMatchIdentities))
                : '';
            const hashMatchTargetClass = hashMatchTargetData ? ' mr-search-match-has-local-target' : '';
            const hashMatchTargetAttrs = hashMatchTargetData
                ? ` data-local-match-identities="${this.escapeHtml(hashMatchTargetData)}" tabindex="0"`
                : '';
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
            const pathMetadata = row.pathMetadata
                ? encodeURIComponent(JSON.stringify(row.pathMetadata))
                : '';
            const downloadMetadata = row.downloadMetadata
                ? encodeURIComponent(JSON.stringify(row.downloadMetadata))
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
                        data-category="${this.escapeHtml(category)}"
                        data-path-metadata="${this.escapeHtml(pathMetadata)}"
                        data-download-metadata="${this.escapeHtml(downloadMetadata)}">${getSvgIcon('download')}</button>
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
                        <div class="mr-search-result-model" data-tooltip="${modelTitle}"${this.getContextMenuAttrs(detailsContext)}>
                            <span>${modelHtml}</span>
                            ${secondary || filename ? `<small>${secondary || filename}</small>` : ''}
                        </div>
                    </td>
                    <td><span class="mr-search-match mr-search-match-${matchClass}${hashMatchTargetClass}"${hashMatchTargetAttrs}>${this.escapeHtml(match.label)}</span></td>
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
        const customUrlAddId = `custom-url-add-${missing.node_id}-${missing.widget_index}`;
        const customUrlInputId = `custom-url-${missing.node_id}-${missing.widget_index}`;
        const state = this.getSearchState(missing);
        const selectedSource = state.selectedSource || 'all';
        const selectedBaseModel = state.selectedBaseModel || this.getDefaultSearchBaseModel();
        const baseModelTooltip = this.getSearchBaseModelTooltip(missing);
        const buttonText = options.buttonText
            || (this.hasRenderableSearchState(state) ? 'Search Again' : 'Search Online');

        let html = `<div id="${searchSourcesId}" class="mr-search-source-bar">`;
        html += `<div class="mr-search-source-picker mr-search-button-picker">`;
        html += `<label class="mr-search-source-picker-label" for="search-${missing.node_id}-${missing.widget_index}">Search</label>`;
        html += `<button id="search-${missing.node_id}-${missing.widget_index}" class="mr-btn mr-btn-link">`;
        html += this.renderSearchButtonContent(buttonText);
        html += `</button>`;
        html += `</div>`;
        html += `<div class="mr-search-source-picker">`;
        html += `<label class="mr-search-source-picker-label" for="${searchSourceSelectId}">Source</label>`;
        html += `<div class="mr-download-target-wrap">`;
        html += `<input id="${searchSourceSelectId}" class="mr-download-target-input mr-search-source-select" type="text" readonly autocomplete="off" data-value="${this.escapeHtml(selectedSource)}" value="${this.escapeHtml(this.getSearchSourceLabel(selectedSource))}">`;
        html += `<div id="${searchSourceListId}" class="mr-download-target-list mr-search-source-list"></div>`;
        html += `</div>`;
        html += `</div>`;
        html += `<div class="mr-search-source-picker mr-search-base-picker">`;
        html += `<label class="mr-search-source-picker-label" for="${searchBaseSelectId}">Model <span class="mr-tooltip-badge mr-search-model-help" data-tooltip="${this.escapeHtml(baseModelTooltip)}" tabindex="0">?</span></label>`;
        html += `<div class="mr-download-target-wrap">`;
        html += `<input id="${searchBaseSelectId}" class="mr-download-target-input mr-search-base-select" type="text" autocomplete="off" data-value="${this.escapeHtml(selectedBaseModel)}" data-missing-search-key="${this.escapeHtml(this.getMissingSearchKey(missing))}" value="${this.escapeHtml(this.getSearchBaseModelLabel(selectedBaseModel, missing))}">`;
        html += `<div id="${searchBaseListId}" class="mr-download-target-list mr-search-base-list"></div>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        html += `<div class="mr-custom-url-bar">`;
        html += `<div class="mr-search-source-picker mr-custom-url-button-picker">`;
        html += `<label class="mr-search-source-picker-label" for="${customUrlAddId}">Link</label>`;
        html += `<button id="${customUrlAddId}" class="mr-btn mr-btn-link mr-custom-url-add-btn" type="button">`;
        html += this.renderCustomUrlButtonContent('Add');
        html += `</button>`;
        html += `</div>`;
        html += `<div class="mr-search-source-picker mr-custom-url-input-picker">`;
        html += `<label class="mr-search-source-picker-label" for="${customUrlInputId}">URL</label>`;
        html += `<input id="${customUrlInputId}" class="mr-download-target-input mr-custom-url-input" type="text" autocomplete="off" spellcheck="false" placeholder="https://...">`;
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
        actionsHtml = '',
        contextMenuModel = null,
        contextMenuTooltip = 'Right-click to open download folder'
    } = {}) {
        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
        const actionAttr = actionDataAttr ? ` ${actionDataAttr}` : '';
        const contextMenuAttrs = this.getContextMenuAttrs(contextMenuModel, contextMenuTooltip);
        const containerClass = contextMenuAttrs
            ? 'mr-progress-container mr-download-folder-context'
            : 'mr-progress-container';
        const actionHtml = actionsHtml || (actionClass || actionText
            ? `<button class="${actionClass}"${actionAttr}>${actionText}</button>`
            : '');
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

    buildContextMenuModelData(model = {}, fallbackName = '', extra = {}) {
        const merged = {
            ...model,
            ...(extra && typeof extra === 'object' ? extra : {})
        };
        const resolvedPath = merged.path || merged.resolved_path || '';
        const filename = merged.filename || fallbackName || resolvedPath.split(/[\/\\]/).pop() || '';
        return {
            ...merged,
            name: merged.name || filename,
            original_path: merged.original_path || filename,
            resolved_path: resolvedPath,
            category: merged.category || ''
        };
    },

    getLocalMatchHash(match = {}) {
        const model = match.model || {};
        const hashes = model.hashes && typeof model.hashes === 'object' ? model.hashes : {};
        return String(
            match.sha256
            || match.hash
            || model.sha256
            || model.hash
            || hashes.SHA256
            || hashes.sha256
            || ''
        ).trim();
    },

    getLocalMatchContextData(missing = {}, match = {}) {
        const hash = this.getLocalMatchHash(match);
        const metadataPath = match.metadata_path || match.model?.metadata_path || '';
        const identity = this.getLocalMatchIdentity?.(match) || '';
        return {
            context_scope: 'local_match',
            missing_key: this.getMissingModelKey?.(missing) || '',
            missing_search_key: this.getMissingSearchKey?.(missing) || '',
            local_match_identity: identity,
            local_match_confidence: match.confidence || 0,
            local_match_sha256: hash,
            sha256: hash || match.model?.sha256 || '',
            hash: hash || match.model?.hash || '',
            hash_match: Boolean(match.hash_match || match.match_type === 'hash'),
            metadata_path: metadataPath
        };
    },

    renderLocalMatchStatus(match = {}, hashLabelMap = null) {
        const confidence = Number(match.confidence || 0);
        const isHashMatch = Boolean(match.hash_match || match.match_type === 'hash');
        const model = match.model || {};
        const hashes = model.hashes && typeof model.hashes === 'object' ? model.hashes : {};
        const normalizedHash = String(
            match.sha256
            || match.hash
            || model.sha256
            || model.hash
            || hashes.SHA256
            || hashes.sha256
            || ''
        ).trim().toLowerCase();
        const hashLabel = normalizedHash && hashLabelMap?.get?.(normalizedHash)
            ? hashLabelMap.get(normalizedHash)
            : '';
        const label = isHashMatch ? (hashLabel || 'Hash') : (confidence === 100 ? 'Exact' : 'Partial');
        const className = isHashMatch
            ? 'mr-match-status-hash'
            : (confidence === 100 ? 'mr-match-status-exact' : 'mr-match-status-partial');
        const attrs = isHashMatch ? ' tabindex="0"' : '';
        return `<span class="mr-match-status ${className}"${attrs}>${label}</span>`;
    },

    getLocalMatchCategory(match = {}) {
        const model = match.model && typeof match.model === 'object' ? match.model : {};
        const candidates = [
            model.category,
            match.category,
            model.directory,
            match.directory
        ];
        for (const candidate of candidates) {
            const raw = String(candidate || '').trim();
            if (!raw || /[\/\\]/.test(raw) || /^[a-z]:/i.test(raw)) continue;
            const normalized = this.normalizeDownloadCategory?.(raw) || raw;
            if (normalized && normalized !== 'unknown') return normalized;
        }
        return '';
    },

    getLocalMatchBadFolderWarning(missing = {}, match = {}) {
        const matchCategory = this.getLocalMatchCategory?.(match) || '';
        if (!matchCategory) return null;

        const supportedCategories = (this.getMissingSupportedDownloadCategories?.(missing) || [])
            .map(category => this.normalizeDownloadCategory?.(category) || String(category || '').trim())
            .filter(category => category && category !== 'unknown');
        const supported = Array.from(new Set(supportedCategories));
        if (!supported.length || supported.includes(matchCategory)) return null;

        const matchLabel = this.getCategoryDisplayName?.(matchCategory) || matchCategory;
        const supportedLabels = supported.map(category => this.getCategoryDisplayName?.(category) || category);
        const supportedText = supportedLabels.length === 1
            ? supportedLabels[0]
            : `one of: ${supportedLabels.join(', ')}`;

        return {
            matchCategory,
            supportedCategories: supported,
            tooltip: `This local file is in ${matchLabel}, but this node likely accepts ${supportedText}. Linking it may leave the model missing; move or copy the file to a supported model folder.`
        };
    },

    renderLocalMatchBadFolderBadge(missing = {}, match = {}) {
        const warning = this.getLocalMatchBadFolderWarning?.(missing, match);
        if (!warning) return '';
        return `<span class="mr-match-status mr-match-status-bad-folder" tabindex="0" data-tooltip="${this.escapeHtml(warning.tooltip)}">Bad folder</span>`;
    },

    getModelFileTypeInfo(value = '') {
        const match = String(value || '').trim().match(/\.([a-z0-9]+)(?:$|[?#])/i);
        if (!match) return null;

        const extension = match[1].toLowerCase();
        const labels = {
            safetensors: 'Safetensors',
            gguf: 'GGUF',
            ckpt: 'Checkpoint',
            pt: 'PyTorch',
            pt2: 'PyTorch',
            pth: 'PyTorch',
            bin: 'Binary model',
            onnx: 'ONNX',
            pkl: 'Pickle',
            sft: 'SFT'
        };
        if (!labels[extension]) return null;

        return {
            extension,
            label: labels[extension],
            display: `${labels[extension]} (.${extension})`
        };
    },

    getMissingAcceptedModelFileTypes(missing = {}) {
        const explicitExtensions = missing.accepted_extensions
            || missing.allowed_extensions
            || missing.accepted_model_extensions;
        let acceptedValues = Array.isArray(explicitExtensions) ? explicitExtensions : [];

        if (!acceptedValues.length) {
            const widgetName = missing.widget_name
                || this.getComfyWidgetNameByIndex?.(missing.node_type || '', Number(missing.widget_index))
                || '';
            acceptedValues = this.getCurrentComfyCatalogValues?.(
                missing.node_type || '',
                widgetName
            ) || [];
        }

        const byExtension = new Map();
        for (const value of acceptedValues) {
            const typeInfo = this.getModelFileTypeInfo?.(value);
            if (typeInfo && !byExtension.has(typeInfo.extension)) {
                byExtension.set(typeInfo.extension, typeInfo);
            }
        }
        return Array.from(byExtension.values());
    },

    getLocalMatchBadTypeWarning(missing = {}, match = {}) {
        const model = match.model && typeof match.model === 'object' ? match.model : {};
        const matchValue = model.relative_path
            || model.path
            || match.relative_path
            || match.path
            || model.filename
            || match.filename
            || model.name
            || match.name
            || '';
        const matchType = this.getModelFileTypeInfo?.(matchValue);
        if (!matchType) return null;

        const acceptedTypes = this.getMissingAcceptedModelFileTypes?.(missing) || [];
        if (!acceptedTypes.length || acceptedTypes.some(type => type.extension === matchType.extension)) {
            return null;
        }

        const acceptedText = acceptedTypes.length === 1
            ? acceptedTypes[0].display
            : acceptedTypes.map(type => type.display).join(', ');
        const nodeLabel = String(missing.node_title || missing.node_type || 'this node').trim();

        return {
            matchType,
            acceptedTypes,
            tooltip: `This file is ${matchType.display}, but ${nodeLabel} only lists ${acceptedText} files.\n\nLinking it may not work. Choose a supported file type or use a loader made for ${matchType.label} models.`
        };
    },

    renderLocalMatchBadTypeBadge(missing = {}, match = {}) {
        const warning = this.getLocalMatchBadTypeWarning?.(missing, match);
        if (!warning) return '';
        return `<span class="mr-match-status mr-match-status-bad-type" tabindex="0" data-tooltip="${this.escapeHtml(warning.tooltip)}">Bad type</span>`;
    },

    getActiveDownloadInfoForLocalMatch(match = {}) {
        const model = match.model || {};
        const normalizePath = (value = '') => normalizePathIdentity(value);
        const joinPath = (...parts) => normalizePath(parts.filter(Boolean).join('/'));
        const activeStatuses = new Set(['starting', 'downloading', 'paused', 'cancelling']);
        const matchAbsolutePaths = [
            model.path,
            model.resolved_path,
            match.path,
            match.resolved_path
        ].map(normalizePath).filter(Boolean);
        const matchRelativePaths = [
            model.relative_path,
            match.relative_path
        ].map(normalizePath).filter(Boolean);
        const matchFilename = normalizePath(model.filename || match.filename || '');

        for (const [downloadId, info] of Object.entries(this.activeDownloads || {})) {
            const progress = info?.lastProgress || info?.statusSnapshot?.progress || {};
            const status = String(progress.status || info?.lastStatus || info?.statusSnapshot?.status || 'starting').trim().toLowerCase();
            if (!activeStatuses.has(status)) continue;

            const filename = progress.filename || info?.filename || '';
            const absoluteCandidates = [
                progress.path,
                info?.downloadPath,
                info?.statusSnapshot?.downloadPath,
                joinPath(progress.directory || '', filename),
                joinPath(info?.downloadDirectory || '', filename),
                joinPath(info?.statusSnapshot?.downloadDirectory || '', filename)
            ].map(normalizePath).filter(Boolean);
            const relativeCandidates = [
                info?.subfolder && filename ? joinPath(info.subfolder, filename) : '',
                progress.relative_path,
                info?.relativePath
            ].map(normalizePath).filter(Boolean);

            const absoluteMatch = absoluteCandidates.some(activePath => (
                matchAbsolutePaths.includes(activePath)
                || matchRelativePaths.some(relativePath => activePath.endsWith(`/${relativePath}`))
            ));
            const relativeMatch = relativeCandidates.some(activeRelative => (
                matchRelativePaths.includes(activeRelative)
                || matchAbsolutePaths.some(matchPath => matchPath.endsWith(`/${activeRelative}`))
            ));
            if (!absoluteMatch && !relativeMatch) continue;

            return {
                download_id: downloadId,
                download_status: status,
                download_progress: progress.progress,
                downloaded: progress.downloaded,
                total_size: progress.total_size,
                filename: filename || matchFilename,
                is_downloading: true,
                downloading: true
            };
        }

        return null;
    },

    renderLocalMatchDownloadingBadge(match = {}) {
        const model = match.model || {};
        const activeDownloadInfo = this.getActiveDownloadInfoForLocalMatch?.(match) || null;
        const isDownloading = Boolean(
            match.is_downloading
            || match.downloading
            || model.is_downloading
            || model.downloading
            || activeDownloadInfo
        );
        if (!isDownloading) return '';

        const status = String(activeDownloadInfo?.download_status || match.download_status || model.download_status || '').trim().toLowerCase();
        const progress = Number(activeDownloadInfo?.download_progress ?? match.download_progress ?? model.download_progress);
        const progressLabel = Number.isFinite(progress) && progress > 0 && progress < 100
            ? ` (${Math.round(progress)}%)`
            : '';
        const statusLabel = status === 'paused'
            ? 'paused'
            : (status === 'starting' ? 'starting' : 'still downloading');
        const tooltip = `The download for this local file is ${statusLabel}${progressLabel}. It may be incomplete until the download finishes.`;
        return `<span class="mr-match-status mr-match-status-downloading" tabindex="0" data-tooltip="${this.escapeHtml(tooltip)}">Downloading</span>`;
    },

    renderLocalMatchStatusGroup(missing = {}, match = {}, hashLabelMap = null) {
        const badTypeBadge = this.renderLocalMatchBadTypeBadge?.(missing, match) || '';
        return `<span class="mr-match-status-group">${this.renderLocalMatchStatus(match, hashLabelMap)}${this.renderLocalMatchDownloadingBadge(match)}${this.renderLocalMatchBadFolderBadge(missing, match)}${badTypeBadge}</span>`;
    },

    areLocalMatchAlternativesCollapsed() {
        if (typeof this.localMatchAlternativesCollapsed === 'boolean') {
            return this.localMatchAlternativesCollapsed;
        }

        try {
            this.localMatchAlternativesCollapsed = localStorage.getItem(this.localMatchAlternativesCollapsedStorageKey) === '1';
        } catch (e) {
            this.localMatchAlternativesCollapsed = false;
        }

        return this.localMatchAlternativesCollapsed;
    },

    setLocalMatchAlternativesCollapsed(collapsed) {
        this.localMatchAlternativesCollapsed = Boolean(collapsed);
        try {
            localStorage.setItem(
                this.localMatchAlternativesCollapsedStorageKey,
                this.localMatchAlternativesCollapsed ? '1' : '0'
            );
        } catch (e) {}
    },

    renderLocalMatchesContent(missing, missingIndex = 0) {
        const allMatches = missing.matches || [];
        const filteredMatches = allMatches.filter(m => m.confidence >= 70);
        const hasMatches = filteredMatches.length > 0;
        const perfectMatches = filteredMatches.filter(m => m.confidence === 100);
        const otherMatches = filteredMatches.filter(m => m.confidence < 100 && m.confidence >= 70);
        const hashLabelMap = this.getHashMatchLabelMap?.(missing) || null;

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
                const contextModel = this.buildContextMenuModelData(
                    match.model || {},
                    match.filename || '',
                    this.getLocalMatchContextData(missing, match)
                );
                const localMatchIdentity = this.getLocalMatchIdentity?.(match) || '';
                const identityAttr = localMatchIdentity
                    ? ` data-local-match-identity="${this.escapeHtml(localMatchIdentity)}"`
                    : '';
                const rowClass = `mr-match-row${isBestMatch ? ' mr-best-match' : ''}`;

                html += `<div class="${rowClass}"${identityAttr}${this.getContextMenuAttrs(contextModel)}>`;
                html += this.getConfidenceBadge(match.confidence);
                html += `<span class="mr-match-filename" data-tooltip="${this.escapeHtml(matchPath)}">${this.escapeHtml(matchPath)}</span>`;
                html += this.renderLocalMatchStatusGroup(missing, match, hashLabelMap);
                html += `<button id="${buttonId}" class="mr-btn mr-btn-secondary mr-btn-sm mr-btn-icon-only mr-local-link-btn" data-tooltip="Link this local match" aria-label="Link this local match">`;
                html += getSvgIcon('link');
                html += `</button>`;
                html += `</div>`;
            }

            if (perfectMatches.length > 0 && otherMatches.length > 0) {
                const matchId = `more-matches-${missing.node_id}-${missing.widget_index}`;
                const altLabel = `Alternatives (${otherMatches.length})`;
                const alternativesCollapsed = this.areLocalMatchAlternativesCollapsed();
                html += `<button type="button" class="mr-local-alternatives-toggle" data-ml-preference="local-match-alternatives" aria-expanded="${alternativesCollapsed ? 'false' : 'true'}" onclick="window.MLToggleHidden('${matchId}', this, '${altLabel}', '${altLabel}')">`;
                html += `<span class="mr-local-alternatives-label">${altLabel}</span>`;
                html += `<span class="mr-local-alternatives-state">${alternativesCollapsed ? 'Show' : 'Hide'}</span>`;
                html += `<span class="mr-local-alternatives-chevron" aria-hidden="true"></span>`;
                html += `</button>`;
                html += `<div id="${matchId}" class="mr-stack-sm ${alternativesCollapsed ? 'mr-hidden' : ''}">`;
                for (let mIdx = 0; mIdx < otherMatches.length; mIdx++) {
                    const match = otherMatches[mIdx];
                    const altBtnId = `resolve-alt-${missingIndex}-${missing.node_id}-${missing.widget_index}-${mIdx}`;
                    const contextModel = this.buildContextMenuModelData(
                        match.model || {},
                        match.filename || '',
                        this.getLocalMatchContextData(missing, match)
                    );
                    const matchPath = match.model?.relative_path || match.model?.path || match.path || match.filename || '';
                    const localMatchIdentity = this.getLocalMatchIdentity?.(match) || '';
                    const identityAttr = localMatchIdentity
                        ? ` data-local-match-identity="${this.escapeHtml(localMatchIdentity)}"`
                        : '';
                    html += `<div class="mr-match-row"${identityAttr}${this.getContextMenuAttrs(contextModel)}>`;
                    html += this.getConfidenceBadge(match.confidence);
                    html += `<span class="mr-match-filename" data-tooltip="${this.escapeHtml(matchPath)}">${this.escapeHtml(matchPath)}</span>`;
                    html += this.renderLocalMatchStatusGroup(missing, match, hashLabelMap);
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

        this.wireLocalHashMatchResultHighlights?.(container);
        this.bindTooltips?.(container);
    },

    decodeLocalMatchIdentityList(value = '') {
        try {
            const decoded = decodeURIComponent(String(value || ''));
            const parsed = JSON.parse(decoded);
            return Array.isArray(parsed)
                ? parsed.map(item => String(item || '').trim()).filter(Boolean)
                : [];
        } catch (_error) {
            return [];
        }
    },

    setLocalHashMatchHighlight(container, identities = [], highlighted = false) {
        if (!container || !Array.isArray(identities) || !identities.length) return;

        const identitySet = new Set(identities);
        const scope = container.closest?.('.mr-columns')
            || container.closest?.('.mr-missing-detail-pane')
            || this.contentElement
            || document;

        scope.querySelectorAll('.mr-match-row[data-local-match-identity]').forEach(row => {
            const identity = row.dataset.localMatchIdentity || '';
            if (identitySet.has(identity)) {
                row.classList.toggle('mr-local-match-hash-highlight', highlighted);
            }
        });
    },

    setSearchHashResultHighlight(container, identity = '', highlighted = false) {
        const normalizedIdentity = String(identity || '').trim();
        if (!container || !normalizedIdentity) return;

        const scope = container.closest?.('.mr-columns')
            || container.closest?.('.mr-missing-detail-pane')
            || this.contentElement
            || document;

        scope.querySelectorAll('.mr-search-match[data-local-match-identities]').forEach(badge => {
            const identities = this.decodeLocalMatchIdentityList(badge.dataset.localMatchIdentities || '');
            if (!identities.includes(normalizedIdentity)) return;

            badge.classList.toggle('mr-search-match-linked-highlight', highlighted);
            const row = badge.closest('tr');
            if (row) {
                row.classList.toggle('mr-search-result-hash-highlight', highlighted);
            }
        });
    },

    wireLocalHashMatchResultHighlights(container) {
        if (!container) return;

        container.querySelectorAll('.mr-match-row[data-local-match-identity] .mr-match-status-hash').forEach(badge => {
            if (badge.dataset.searchResultHoverBound === 'true') return;
            badge.dataset.searchResultHoverBound = 'true';

            const getIdentity = () => badge.closest('.mr-match-row')?.dataset.localMatchIdentity || '';
            const showHighlight = () => this.setSearchHashResultHighlight(container, getIdentity(), true);
            const hideHighlight = () => this.setSearchHashResultHighlight(container, getIdentity(), false);

            badge.addEventListener('mouseenter', showHighlight);
            badge.addEventListener('mouseleave', hideHighlight);
            badge.addEventListener('focus', showHighlight);
            badge.addEventListener('blur', hideHighlight);
        });
    },

    wireSearchHashMatchHighlights(container) {
        if (!container) return;

        container.querySelectorAll('.mr-search-match[data-local-match-identities]').forEach(badge => {
            if (badge.dataset.localMatchHoverBound === 'true') return;
            badge.dataset.localMatchHoverBound = 'true';

            const getIdentities = () => this.decodeLocalMatchIdentityList(badge.dataset.localMatchIdentities || '');
            const showHighlight = () => this.setLocalHashMatchHighlight(container, getIdentities(), true);
            const hideHighlight = () => this.setLocalHashMatchHighlight(container, getIdentities(), false);

            badge.addEventListener('mouseenter', showHighlight);
            badge.addEventListener('mouseleave', hideHighlight);
            badge.addEventListener('focus', showHighlight);
            badge.addEventListener('blur', hideHighlight);
        });
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
            model_url: civitai.url || getCivitaiModelUrl(ids.modelId, ids.versionId),
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

            const data = await this.fetchJson('/model_resolver/search', {
                method: 'POST',
                body: JSON.stringify(payload)
            }, 'Resolve URN');
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
            const data = await this.fetchLocalMatches(filename, missing.category || '', false);
            const matches = Array.isArray(data.matches) ? data.matches : [];
            missing.matches = this.preserveActiveDownloadLocalMatches?.(missing, matches) || matches;
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

        const bodyId = `local-matches-body-${this.getMissingModelDomKey(missing)}`;
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
            this.refreshMissingListRow(missing, { refreshBaseModels: true });
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
