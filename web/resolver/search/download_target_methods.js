import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const downloadTargetMethods = {
    /**
     * Ensure all models are loaded for the dropdown.
     */
    async ensureAllModelsLoaded() {
        if (this.allModels && this.allModels.length) return;
        try {
            const resp = await api.fetchApi('/model_resolver/models');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const models = await resp.json();
            const list = Array.isArray(models) ? models : [];
            // Build labels and sort alphabetically
            this.allModels = list.map((m) => ({
                ...m,
                __label: `${m.category ? m.category + ': ' : ''}${m.relative_path || m.filename || ''}`
            })).sort((a, b) => (a.__label || '').localeCompare(b.__label || ''));
        } catch (e) {
            console.warn('Model Resolver: could not load all models', e);
            this.allModels = [];
        }
    },

    async ensureDownloadDirectoriesLoaded() {
        if (this.downloadDirectories) return;
        try {
            const resp = await api.fetchApi('/model_resolver/directories');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const directories = await resp.json();
            this.downloadDirectories = directories && typeof directories === 'object' ? directories : {};
        } catch (e) {
            console.warn('Model Resolver: could not load download directories', e);
            this.downloadDirectories = {};
        }
    },

    async ensureCapabilitiesLoaded() {
        if (this.capabilities) return;
        try {
            const resp = await api.fetchApi('/model_resolver/capabilities');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.capabilities = data && typeof data === 'object' ? data : { sources: {} };
        } catch (e) {
            console.warn('Model Resolver: could not load capabilities', e);
            this.capabilities = { sources: {} };
        }
    },

    async ensureBaseModelsLoaded() {
        if (this.baseModels) return;
        try {
            const resp = await api.fetchApi('/model_resolver/base-models');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.baseModels = data && typeof data === 'object' ? data : {};
        } catch (e) {
            console.warn('Model Resolver: could not load base-models config', e);
            this.baseModels = {};
        }
    },

    isSourceAvailable(source) {

        if (!source || ['all', 'local', 'huggingface', 'civitai', 'civarchive'].includes(source)) {
            return true;
        }
        return Boolean(this.capabilities?.sources?.[source]);
    },

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
    },

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
        return `mr-type-chip mr-type-chip--${colorNames[token] || 'generic'}`;
    },

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
    },

    getDownloadCategoryOptions(defaultCategory = 'checkpoints') {
        const directories = this.downloadDirectories || {};
        const keys = Object.keys(directories);
        const preferred = defaultCategory || 'checkpoints';
        const ordered = [
            preferred,
            ...keys.filter(key => key !== preferred)
        ].filter((value, index, arr) => value && arr.indexOf(value) === index);

        return ordered.length > 0 ? ordered : [preferred];
    },

    getSearchSourceOptions() {
        const sources = ['all', ...this.getEnabledSearchSources()];
        return sources.map(source => ({
            value: source,
            label: this.getSearchSourceLabel(source)
        }));
    },

    getAvailableSubfolders(category = '') {
        return this.downloadSubfolders.get((category || '').toLowerCase()) || [];
    },

    getDownloadTargetKey(missing = {}) {
        return this.getMissingModelKey?.(missing)
            || `${missing.node_id}:${missing.widget_index}:${missing.subgraph_id || ''}:${missing.is_top_level !== false ? 'T' : 'F'}`;
    },

    getSavedDownloadTargetSelection(missing = {}) {
        const key = this.getDownloadTargetKey(missing);
        return this.downloadTargetSelections?.get(key) || null;
    },

    saveDownloadTargetSelection(missing = {}, patch = {}) {
        if (!this.downloadTargetSelections) {
            this.downloadTargetSelections = new Map();
        }
        const key = this.getDownloadTargetKey(missing);
        const current = this.downloadTargetSelections.get(key) || {};
        this.downloadTargetSelections.set(key, {
            ...current,
            ...patch
        });
    },

    normalizeFolderToken(value = '') {
        return String(value || '')
            .toLowerCase()
            .replace(/[\/\\]+/g, ' ')
            .replace(/[^a-z0-9]+/g, '');
    },

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
    },

    async applySuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl) {
        if (!categoryEl || !subfolderEl || subfolderEl.value.trim()) return;
        const saved = this.getSavedDownloadTargetSelection(missing);
        if (saved?.subfolderTouched) return;

        const category = this.getDropdownValue(categoryEl);
        await this.ensureDownloadSubfoldersLoaded(category);
        const latestSaved = this.getSavedDownloadTargetSelection(missing);
        if (latestSaved?.subfolderTouched || subfolderEl.value.trim()) return;

        const folders = this.getAvailableSubfolders(category);
        const suggestion = this.getSuggestedCivitaiSubfolder(missing, category, folders);
        if (suggestion) {
            subfolderEl.value = suggestion;
            this.saveDownloadTargetSelection(missing, {
                category,
                subfolder: suggestion,
                subfolderTouched: false
            });
        }
    },

    async forceSuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl) {
        if (!categoryEl || !subfolderEl) return;

        const category = this.getDropdownValue(categoryEl);
        await this.ensureDownloadSubfoldersLoaded(category);
        const folders = this.getAvailableSubfolders(category);
        const suggestion = this.getSuggestedCivitaiSubfolder(missing, category, folders);
        if (!suggestion) {
            this.showNotification?.('No subfolder suggestion available for this model.', 'info');
            return;
        }

        subfolderEl.value = suggestion;
        this.saveDownloadTargetSelection(missing, {
            category,
            subfolder: suggestion,
            subfolderTouched: true
        });
    },

    applySearchResultSuggestion(missing) {
        const categoryEl = this.contentElement?.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = this.contentElement?.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        if (!categoryEl || !subfolderEl) return;
        this.applySuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl);
    },

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
            const resp = await api.fetchApi(`/model_resolver/subfolders/${encodeURIComponent(key)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const subfolders = await resp.json();
            const list = Array.isArray(subfolders) ? subfolders : [];
            this.downloadSubfolders.set(key, list);
            return list;
        } catch (e) {
            console.warn(`Model Resolver: could not load subfolders for ${key}`, e);
            this.downloadSubfolders.set(key, []);
            return [];
        }
    },

    renderDownloadTargetControls(missing, defaultCategory = 'checkpoints') {
        const selectId = `download-category-${missing.node_id}-${missing.widget_index}`;
        const subfolderId = `download-subfolder-${missing.node_id}-${missing.widget_index}`;
        const suggestId = `download-subfolder-suggest-${missing.node_id}-${missing.widget_index}`;
        const categoryListId = `download-category-list-${missing.node_id}-${missing.widget_index}`;
        const subfolderListId = `download-subfolder-list-${missing.node_id}-${missing.widget_index}`;
        const saved = this.getSavedDownloadTargetSelection(missing);
        const selectedCategory = saved?.category || defaultCategory || 'checkpoints';
        const selectedSubfolder = saved ? saved.subfolder || '' : '';

        let html = `<div class="mr-download-target">`;
        html += `<div class="mr-download-target-grid">`;
        html += `<label class="mr-download-target-label" for="${selectId}">Folder</label>`;
        html += `<label class="mr-download-target-label" for="${subfolderId}">Subfolder (optional)</label>`;
        html += `<div class="mr-download-target-wrap">`;
        html += `<input id="${selectId}" class="mr-download-target-input mr-download-target-select" type="text" readonly autocomplete="off" data-value="${this.escapeHtml(selectedCategory)}" value="${this.escapeHtml(this.getCategoryDisplayName(selectedCategory))}">`;
        html += `<div id="${categoryListId}" class="mr-download-target-list"></div>`;
        html += `</div>`;
        html += `<div class="mr-download-target-wrap">`;
        html += `<div class="mr-download-subfolder-control">`;
        html += `<input id="${subfolderId}" class="mr-download-target-input" type="text" placeholder="e.g. ponyxl\\styles" autocomplete="off" value="${this.escapeHtml(selectedSubfolder)}">`;
        html += `<button id="${suggestId}" class="mr-btn mr-btn-secondary mr-btn-sm mr-download-suggest-btn" type="button" data-tooltip="Apply suggested subfolder">Suggest</button>`;
        html += `</div>`;
        html += `<div id="${subfolderListId}" class="mr-download-target-list"></div>`;
        html += `</div>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    },

    getDownloadTargetSelection(missing, fallbackCategory = 'checkpoints') {
        const categoryEl = this.contentElement?.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = this.contentElement?.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        const category = this.getDropdownValue(categoryEl) || fallbackCategory || 'checkpoints';
        const subfolder = (subfolderEl?.value || '').trim();
        this.saveDownloadTargetSelection(missing, {
            category,
            subfolder
        });
        return {
            category,
            subfolder
        };
    },

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
    },

    wireDownloadTargetAutocomplete(container, missing) {
        const categoryEl = container.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = container.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        const suggestBtn = container.querySelector(`#download-subfolder-suggest-${missing.node_id}-${missing.widget_index}`);
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
                    return `<div class="mr-download-target-option" data-value="${encodeURIComponent(value)}" data-label="${encodeURIComponent(label)}">${this.escapeHtml(label)}</div>`;
                })
                .join('');

            targetEl.style.display = 'block';

            targetEl.querySelectorAll('.mr-download-target-option').forEach(option => {
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
                this.saveDownloadTargetSelection(missing, {
                    category: value,
                    subfolder: '',
                    subfolderTouched: false
                });
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
                this.saveDownloadTargetSelection(missing, {
                    category: this.getDropdownValue(categoryEl),
                    subfolder: value,
                    subfolderTouched: true
                });
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
            this.saveDownloadTargetSelection(missing, {
                category: this.getDropdownValue(categoryEl),
                subfolder: subfolderEl.value,
                subfolderTouched: true
            });
            populateSubfolderOptions(subfolderEl.value);
        });

        subfolderEl.addEventListener('blur', () => hideList(listEl));

        if (suggestBtn && suggestBtn.dataset.mlSuggestBound !== 'true') {
            suggestBtn.dataset.mlSuggestBound = 'true';
            suggestBtn.addEventListener('click', async () => {
                suggestBtn.disabled = true;
                try {
                    await this.forceSuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl);
                    listEl.innerHTML = '';
                    listEl.style.display = 'none';
                } finally {
                    suggestBtn.disabled = false;
                }
            });
        }

        this.applySuggestedCivitaiSubfolder(missing, categoryEl, subfolderEl);
    },

    getStoredTokens() {
        const civitaiCandidateLimitRaw = parseInt(localStorage.getItem('ModelResolver.civitaiCandidateLimit') || '5', 10);
        const civitai_candidate_limit = Number.isFinite(civitaiCandidateLimitRaw)
            ? Math.min(20, Math.max(1, civitaiCandidateLimitRaw))
            : 5;
        const search_source_enabled = this.getSearchSourceEnabledMap();

        return {
            civitai_key: localStorage.getItem('ModelResolver.civitaiApiKey') || '',
            civitai_session_token: localStorage.getItem('ModelResolver.civitaiSessionToken') || '',
            hf_token: localStorage.getItem('ModelResolver.huggingFaceToken') || '',
            brave_search_api_key: localStorage.getItem('ModelResolver.braveSearchApiKey') || '',
            civitai_use_trpc_search: localStorage.getItem('ModelResolver.civitaiUseTrpcSearch') !== 'false',
            civitai_use_html_fallback: localStorage.getItem('ModelResolver.civitaiUseHtmlFallback') !== 'false',
            hf_use_api_search: localStorage.getItem('ModelResolver.hfUseApiSearch') !== 'false',
            hf_use_comfy_org_fallback: localStorage.getItem('ModelResolver.hfUseComfyOrgFallback') !== 'false',
            hf_use_brave_fallback: localStorage.getItem('ModelResolver.hfUseBraveFallback') !== 'false',
            civitai_candidate_limit,
            search_source_enabled
        };
    },

    /**
     * Fetch settings saved on the server and sync them into localStorage.
     * Call this once when the dialog initialises so every browser gets the
     * same tokens without the user having to re-enter them.
     */
    async loadSettingsFromServer() {
        try {
            const resp = await api.fetchApi('/model_resolver/settings');
            if (!resp.ok) return;
            const data = await resp.json();
            if (!data || typeof data !== 'object') return;

            // Helper: write to localStorage only when the value from server is
            // non-empty, so we don't overwrite a key the user already has locally.
            const sync = (localKey, serverValue) => {
                if (serverValue !== undefined && serverValue !== null && serverValue !== '') {
                    localStorage.setItem(localKey, serverValue);
                }
            };

            sync('ModelResolver.civitaiApiKey',          data.civitai_key);
            sync('ModelResolver.civitaiSessionToken',    data.civitai_session_token);
            sync('ModelResolver.huggingFaceToken',       data.hf_token);
            sync('ModelResolver.braveSearchApiKey',      data.brave_search_api_key);

            if (data.civitai_use_trpc_search !== undefined)
                localStorage.setItem('ModelResolver.civitaiUseTrpcSearch',   data.civitai_use_trpc_search ? 'true' : 'false');
            if (data.civitai_use_html_fallback !== undefined)
                localStorage.setItem('ModelResolver.civitaiUseHtmlFallback', data.civitai_use_html_fallback ? 'true' : 'false');
            if (data.hf_use_api_search !== undefined)
                localStorage.setItem('ModelResolver.hfUseApiSearch',         data.hf_use_api_search ? 'true' : 'false');
            if (data.hf_use_comfy_org_fallback !== undefined)
                localStorage.setItem('ModelResolver.hfUseComfyOrgFallback',  data.hf_use_comfy_org_fallback ? 'true' : 'false');
            if (data.hf_use_brave_fallback !== undefined)
                localStorage.setItem('ModelResolver.hfUseBraveFallback',     data.hf_use_brave_fallback ? 'true' : 'false');
            if (data.civitai_candidate_limit !== undefined)
                localStorage.setItem('ModelResolver.civitaiCandidateLimit',  `${data.civitai_candidate_limit}`);

            // Source-enabled flags stored as a nested object
            if (data.search_source_enabled && typeof data.search_source_enabled === 'object') {
                Object.entries(data.search_source_enabled).forEach(([key, val]) => {
                    if (key) localStorage.setItem(key, val ? 'true' : 'false');
                });
            }
        } catch (err) {
            console.warn('Model Resolver: could not load settings from server, using localStorage only.', err);
        }
    },

    clearFrontendSearchCaches() {
        for (const state of this.searchResultCache.values()) {
            state.activeSearchRunId = null;
        }
        this.clearAllSearchProgressTimers();
        this.backgroundSearchJobs?.clear();
        this.searchResultCache.clear();
        this.workflowSearchResultCaches.clear();
        this.urnResolvePromises.clear();
        this.urnLocalMatchPromises.clear();
    },

    async clearBackendSearchCaches({ throwOnError = false } = {}) {
        try {
            const response = await api.fetchApi('/model_resolver/clear-search-cache', {
                method: 'POST'
            });
            if (!response.ok) {
                throw new Error('Failed to clear backend search cache');
            }
            return true;
        } catch (error) {
            console.error('Model Resolver: Clear search cache error:', error);
            if (throwOnError) {
                throw error;
            }
            return false;
        }
    },

    async clearSearchCaches() {
        this.clearFrontendSearchCaches();
        await this.clearBackendSearchCaches();
    },

    async clearAllResolverCaches() {
        this.clearFrontendSearchCaches();

        this.workflowAnalysisCaches.clear();
        this.workflowLoadedModelCaches.clear();
        this.cachedAnalysisData = null;
        this.cachedWorkflowSignature = null;
        this.cachedLoadedModelsData = null;
        this.cachedLoadedModelsSignature = null;
        this.allModels = null;
        this.downloadDirectories = null;
        this.capabilities = null;
        this.baseModels = null;
        this.downloadSubfolders.clear();
        this.downloadTargetSelections?.clear();
        this._analysisProgressToken = null;

        await this.ensureCapabilitiesLoaded();
        await this.ensureBaseModelsLoaded();
        this.refreshMissingListStats?.();
        this.updateBatchFooterButtons?.();
        this.updateDownloadAllButtonState?.();

        await this.clearBackendSearchCaches({ throwOnError: true });
    }
};
