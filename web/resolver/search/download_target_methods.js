import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { LOG_LEVEL as DEFAULT_FRONTEND_LOG_LEVEL } from "../../log_system/config.js";
import { logger as frontendLogger } from "../../log_system/logger.js";
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
            if (directories && typeof directories === 'object') {
                this.downloadDirectories = Object.entries(directories).reduce((acc, [key, value]) => {
                    const normalizedKey = this.normalizeDownloadCategory(key);
                    if (normalizedKey && !acc[normalizedKey]) {
                        acc[normalizedKey] = value;
                    }
                    return acc;
                }, {});
            } else {
                this.downloadDirectories = {};
            }
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

    async ensureDownloadRootDirectoriesLoaded() {
        if (this.downloadRootDirectories) return this.downloadRootDirectories;
        try {
            const resp = await api.fetchApi('/model_resolver/root-directories');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.downloadRootDirectories = data && typeof data === 'object' ? data : {};
        } catch (e) {
            console.warn('Model Resolver: could not load root directories', e);
            this.downloadRootDirectories = {};
        }
        return this.downloadRootDirectories;
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

    normalizeDownloadCategory(category = '') {
        const token = String(category || '')
            .trim()
            .toLowerCase()
            .replace(/[\/\\\s-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        const categoryMap = {
            checkpoint: 'checkpoints',
            lora: 'loras',
            embedding: 'embeddings',
            upscaler: 'upscale_models',
            unet: 'diffusion_models',
            diffusion_model: 'diffusion_models',
            diffusion_models: 'diffusion_models',
            clip: 'text_encoders',
            clips: 'text_encoders',
            text_encoder: 'text_encoders',
            text_encoders: 'text_encoders',
            ip_adapter: 'ipadapter',
            'default': 'upscale_models'
        };
        return categoryMap[token] || token || 'checkpoints';
    },

    getCategoryDisplayName(category = '') {
        category = this.normalizeDownloadCategory(category);
        const displayNames = {
            'checkpoints': 'checkpoint',
            'loras': 'lora',
            'vae': 'vae',
            'controlnet': 'controlnet',
            'embeddings': 'embedding',
            'upscale_models': 'upscale_model',
            'latent_upscale_models': 'latent_upscale_model',
            'diffusion_models': 'diffusion_models',
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
        category = this.normalizeDownloadCategory(category);
        const tokenNames = {
            'checkpoints': 'checkpoint',
            'loras': 'lora',
            'vae': 'vae',
            'controlnet': 'controlnet',
            'embeddings': 'embedding',
            'upscale_models': 'upscale_model',
            'latent_upscale_models': 'latent_upscale_model',
            'diffusion_models': 'diffusion_model',
            'text_encoders': 'text_encoders',
            'clip': 'clip',
            'clip_vision': 'clip_vision',
            'hypernetworks': 'hypernetwork'
        };
        return tokenNames[category] || category || 'unknown';
    },

    getDefaultDownloadCategoryKeys() {
        return [
            'checkpoints',
            'loras',
            'diffusion_models',
            'text_encoders',
            'vae',
            'embeddings',
            'upscale_models',
            'controlnet',
            'clip_vision',
            'ipadapter',
            'sams'
        ];
    },

    getDownloadCategoryOptions(defaultCategory = 'checkpoints') {
        const directories = this.downloadDirectories || {};
        const keys = [
            ...Object.keys(directories),
            ...this.getDefaultDownloadCategoryKeys()
        ];
        const preferred = this.normalizeDownloadCategory(defaultCategory || 'checkpoints');
        const ordered = [
            preferred,
            ...keys.map(key => this.normalizeDownloadCategory(key)).filter(key => key !== preferred)
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
        return this.downloadSubfolders.get(this.normalizeDownloadCategory(category)) || [];
    },

    getSubfolderOptionValue(option) {
        return String(
            option && typeof option === 'object'
                ? option.value || ''
                : option || ''
        );
    },

    getSubfolderOptionLabel(option) {
        if (option && typeof option === 'object') {
            return String(option.label || option.value || '');
        }
        return String(option || '');
    },

    getSubfolderOptionBaseDirectory(option) {
        return String(
            option && typeof option === 'object'
                ? option.base_directory || option.baseDirectory || ''
                : ''
        );
    },

    getSubfolderOptionSearchText(option) {
        return [
            this.getSubfolderOptionValue(option),
            this.getSubfolderOptionLabel(option),
            this.getSubfolderOptionBaseDirectory(option)
        ].join(' ').toLowerCase();
    },

    getDownloadTargetBaseDirectory(category = '') {
        const normalizedCategory = this.normalizeDownloadCategory(category);
        return this.getDefaultRootForCategory(normalizedCategory)
            || this.downloadDirectories?.[normalizedCategory]
            || '';
    },

    joinLocalPath(basePath = '', relativePath = '') {
        const base = String(basePath || '').replace(/[\/\\]+$/, '');
        const relative = String(relativePath || '').replace(/^[\/\\]+/, '');
        if (!base) return relative;
        if (!relative) return base;
        const separator = base.includes('\\') ? '\\' : '/';
        return `${base}${separator}${relative}`;
    },

    getDownloadTargetFolderContext(category = '', subfolder = '', baseDirectory = '') {
        const normalizedCategory = this.normalizeDownloadCategory(category);
        const targetBaseDirectory = baseDirectory || this.getDownloadTargetBaseDirectory(normalizedCategory);
        if (!targetBaseDirectory) return null;

        const cleanSubfolder = String(subfolder || '').trim();
        const folderPath = cleanSubfolder
            ? this.joinLocalPath(targetBaseDirectory, cleanSubfolder)
            : targetBaseDirectory;
        return {
            context_scope: 'download_folder',
            name: cleanSubfolder || this.getCategoryDisplayName(normalizedCategory),
            path: folderPath,
            resolved_path: folderPath,
            folder_path: folderPath,
            download_directory: folderPath,
            category: normalizedCategory
        };
    },

    setDownloadFolderContextTarget(element, contextMenuModel = null, tooltip = 'Right-click to open this folder') {
        if (!element) return;
        if (contextMenuModel) {
            element.dataset.model = encodeURIComponent(JSON.stringify(contextMenuModel));
            element.dataset.tooltip = tooltip;
            element.classList.add('mr-download-folder-context');
            element.oncontextmenu = (event) => {
                window.MLOpenContextMenu?.(event, element);
            };
        } else {
            delete element.dataset.model;
            delete element.dataset.tooltip;
            element.classList.remove('mr-download-folder-context');
            element.oncontextmenu = null;
        }
    },

    syncDownloadTargetFolderContext(categoryEl, subfolderEl) {
        if (!categoryEl) return;
        const category = this.normalizeDownloadCategory(this.getDropdownValue(categoryEl) || 'checkpoints');
        const subfolder = (subfolderEl?.value || '').trim();
        const subfolderBaseDirectory = subfolderEl?.dataset.baseDirectory || '';

        this.setDownloadFolderContextTarget(
            categoryEl,
            this.getDownloadTargetFolderContext(category, ''),
            'Right-click to open this model folder'
        );
        this.setDownloadFolderContextTarget(
            subfolderEl,
            subfolder ? this.getDownloadTargetFolderContext(category, subfolder, subfolderBaseDirectory) : null,
            'Right-click to open this subfolder'
        );
    },

    normalizeDownloadPathMode(value = '') {
        const mode = String(value || '').trim().toLowerCase();
        return ['suggested', 'template', 'manual'].includes(mode) ? mode : 'suggested';
    },

    getDefaultDownloadPathTemplates() {
        return {
            loras: '{base_model}/{first_tag}',
            checkpoints: '{base_model}',
            embeddings: '{base_model}',
            diffusion_models: '{base_model}',
            text_encoders: '',
            controlnet: '{base_model}',
            vae: '',
            upscale_models: ''
        };
    },

    getDownloadPathTemplateCategoryDefinitions() {
        return [
            { key: 'loras', label: 'LoRAs' },
            { key: 'checkpoints', label: 'Checkpoints' },
            { key: 'embeddings', label: 'Embeddings' },
            { key: 'diffusion_models', label: 'Diffusion models' },
            { key: 'text_encoders', label: 'Text encoders' },
            { key: 'controlnet', label: 'ControlNet' },
            { key: 'vae', label: 'VAE' },
            { key: 'upscale_models', label: 'Upscale models' }
        ];
    },

    getDefaultRootCategoryDefinitions() {
        return [
            { key: 'loras', label: 'LoRA root', settingKey: 'default_lora_root', storageKey: 'ModelResolver.defaultLoraRoot' },
            { key: 'checkpoints', label: 'Checkpoint root', settingKey: 'default_checkpoint_root', storageKey: 'ModelResolver.defaultCheckpointRoot' },
            { key: 'diffusion_models', label: 'Diffusion model root', settingKey: 'default_unet_root', storageKey: 'ModelResolver.defaultUnetRoot' },
            { key: 'embeddings', label: 'Embedding root', settingKey: 'default_embedding_root', storageKey: 'ModelResolver.defaultEmbeddingRoot' },
            { key: 'text_encoders', label: 'Text encoder root', settingKey: 'default_text_encoder_root', storageKey: 'ModelResolver.defaultTextEncoderRoot' },
            { key: 'vae', label: 'VAE root', settingKey: 'default_vae_root', storageKey: 'ModelResolver.defaultVaeRoot' },
            { key: 'upscale_models', label: 'Upscale model root', settingKey: 'default_upscale_model_root', storageKey: 'ModelResolver.defaultUpscaleModelRoot' }
        ];
    },

    getDownloadPathTemplatePresetDefinitions() {
        return [
            { value: '', label: 'Flat folder' },
            { value: '{base_model}', label: 'By base model' },
            { value: '{author}', label: 'By author' },
            { value: '{first_tag}', label: 'By first tag' },
            { value: '{base_model}/{first_tag}', label: 'Base model / first tag' },
            { value: '{base_model}/{author}', label: 'Base model / author' },
            { value: '{author}/{first_tag}', label: 'Author / first tag' },
            { value: '{base_model}/{author}/{first_tag}', label: 'Base model / author / first tag' },
            { value: '{base_model}/{model_name}', label: 'Base model / model name' },
            { value: '{base_model}/{model_name}/{version_name}', label: 'Base model / model / version' }
        ];
    },

    parseJsonObjectSetting(value, fallback = {}) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return { ...value };
        }
        if (typeof value !== 'string' || !value.trim()) {
            return { ...fallback };
        }
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? { ...parsed }
                : { ...fallback };
        } catch (_error) {
            return { ...fallback };
        }
    },

    normalizeDownloadPathTemplate(template = '') {
        return String(template || '')
            .replace(/\\/g, '/')
            .split('/')
            .map(part => part.trim())
            .filter(part => part && part !== '.' && part !== '..')
            .join('/');
    },

    getDownloadPathMode() {
        return this.normalizeDownloadPathMode(localStorage.getItem('ModelResolver.downloadPathMode') || 'suggested');
    },

    getDownloadPathTemplates() {
        const defaults = this.getDefaultDownloadPathTemplates();
        const parsed = this.parseJsonObjectSetting(
            localStorage.getItem('ModelResolver.downloadPathTemplates'),
            defaults
        );
        const templates = { ...defaults };
        Object.entries(parsed).forEach(([key, value]) => {
            templates[this.normalizeDownloadCategory(key)] = this.normalizeDownloadPathTemplate(value);
        });
        return templates;
    },

    getBaseModelPathMappings() {
        const parsed = this.parseJsonObjectSetting(localStorage.getItem('ModelResolver.baseModelPathMappings'), {});
        return Object.entries(parsed).reduce((acc, [key, value]) => {
            const source = String(key || '').trim();
            const target = String(value || '').trim();
            if (source && target) acc[source] = target;
            return acc;
        }, {});
    },

    normalizeBaseModelMappingKey(value = '') {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    },

    resolveBaseModelPathMapping(baseModel = '', mappings = this.getBaseModelPathMappings()) {
        const text = String(baseModel || '');
        if (Object.prototype.hasOwnProperty.call(mappings, text)) {
            return mappings[text];
        }

        const token = this.normalizeBaseModelMappingKey(text);
        if (!token) return text;

        const normalizedEntries = Object.entries(mappings)
            .map(([key, value]) => ({
                key,
                token: this.normalizeBaseModelMappingKey(key),
                value
            }))
            .filter(entry => entry.token);
        const exact = normalizedEntries.find(entry => entry.token === token);
        if (exact) return exact.value;

        const partial = normalizedEntries
            .sort((a, b) => b.token.length - a.token.length)
            .find(entry => (
                entry.token.length >= 4 &&
                (token.startsWith(entry.token) || token.includes(entry.token) || entry.token.includes(token))
            ));
        return partial ? partial.value : text;
    },

    getDefaultRootSettings() {
        return this.getDefaultRootCategoryDefinitions().reduce((acc, item) => {
            acc[item.settingKey] = localStorage.getItem(item.storageKey) || '';
            return acc;
        }, {});
    },

    getDefaultRootForCategory(category = '') {
        const normalizedCategory = this.normalizeDownloadCategory(category);
        const definition = this.getDefaultRootCategoryDefinitions()
            .find(item => this.normalizeDownloadCategory(item.key) === normalizedCategory);
        return definition ? (localStorage.getItem(definition.storageKey) || '') : '';
    },

    formatBaseModelMappingsForInput(mappings = {}) {
        return Object.entries(mappings || {})
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
    },

    parseBaseModelMappingsInput(value = '') {
        const mappings = {};
        String(value || '').split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const separator = trimmed.includes('=>') ? '=>' : '=';
            const index = trimmed.indexOf(separator);
            if (index <= 0) return;
            const key = trimmed.slice(0, index).trim();
            const mapped = trimmed.slice(index + separator.length).trim();
            if (key && mapped) mappings[key] = mapped;
        });
        return mappings;
    },

    sanitizeDownloadPathSegment(value = '', fallback = '') {
        let text = String(value || '').trim() || fallback;
        text = text
            .replace(/[\\/]+/g, '_')
            .replace(/[<>:"|?*\x00-\x1f]+/g, '_')
            .replace(/\s+/g, ' ')
            .replace(/^[\s.]+|[\s.]+$/g, '');
        if (!text || text === '.' || text === '..') {
            text = fallback;
        }
        return String(text || '').replace(/^[\s.]+|[\s.]+$/g, '');
    },

    sanitizeDownloadPathValue(value = '', fallback = '') {
        return this.normalizeTemplateSubfolder(value)
            || this.sanitizeDownloadPathSegment(value, fallback);
    },

    normalizeTemplateSubfolder(value = '') {
        return String(value || '')
            .replace(/\\/g, '/')
            .split('/')
            .map(part => this.sanitizeDownloadPathSegment(part))
            .filter(part => part && part !== '.' && part !== '..')
            .join('/');
    },

    getPriorityDownloadTag(tags = []) {
        const list = Array.isArray(tags)
            ? tags.map(tag => String(tag || '').trim()).filter(Boolean)
            : String(tags || '').split(/[,;]+/).map(tag => tag.trim()).filter(Boolean);
        if (!list.length) return 'no tags';
        const priorityTags = ['concept', 'style', 'character', 'clothing', 'pose', 'object', 'vehicle', 'artist', 'celebrity'];
        const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        for (const priority of priorityTags) {
            const match = list.find(tag => normalize(tag) === normalize(priority));
            if (match) return match;
        }
        return list[0];
    },

    getDownloadPathMetadata(missing = {}, source = {}) {
        const sourceData = source && typeof source === 'object' ? source : {};
        const searchSuggestion = this.getCachedSearchSuggestionData(missing);
        const merged = {
            ...(missing?.civitai_info || {}),
            ...(missing?.civitai_search_result || {}),
            ...(missing?.download_source || {}),
            ...(searchSuggestion || {}),
            ...sourceData
        };
        const repoId = merged.repo_id || merged.repo || '';
        const filename = merged.downloadFilename
            || merged.filename
            || merged.file_name
            || missing.original_path?.split('/').pop()?.split('\\').pop()
            || '';
        const modelName = merged.model_name || merged.model || merged.name || filename.replace(/\.[^.]+$/, '') || '';
        const creator = merged.creator
            || (merged.creator_username ? { username: merged.creator_username } : null)
            || (merged.username ? { username: merged.username } : null)
            || null;
        const author = merged.author
            || merged.creator_username
            || merged.username
            || (repoId && String(repoId).includes('/') ? String(repoId).split('/')[0] : '');
        return {
            filename,
            name: modelName,
            model_name: modelName,
            version_name: merged.version_name || merged.versionName || merged.version || '',
            base_model: merged.base_model || merged.baseModel || '',
            tags: Array.isArray(merged.tags) ? merged.tags : [],
            creator,
            author,
            repo_id: repoId,
            category: merged.category || missing.category || ''
        };
    },

    calculateDownloadPathTemplateSubfolder(category = '', metadata = {}) {
        const templates = this.getDownloadPathTemplates();
        const normalizedCategory = this.normalizeDownloadCategory(category);
        const template = templates[normalizedCategory] || '';
        if (!template) return '';

        const mappings = this.getBaseModelPathMappings();
        const baseModel = metadata.base_model || metadata.baseModel || 'Unknown Base Model';
        const mappedBaseModel = this.resolveBaseModelPathMapping(baseModel, mappings);
        const creator = metadata.creator && typeof metadata.creator === 'object'
            ? (metadata.creator.username || metadata.creator.name || '')
            : (typeof metadata.creator === 'string' ? metadata.creator : '');
        const author = metadata.author
            || creator
            || (metadata.repo_id && String(metadata.repo_id).includes('/') ? String(metadata.repo_id).split('/')[0] : '')
            || 'Anonymous';
        const replacements = {
            '{base_model}': this.sanitizeDownloadPathValue(mappedBaseModel, 'Unknown Base Model'),
            '{author}': this.sanitizeDownloadPathSegment(author, 'Anonymous'),
            '{first_tag}': this.sanitizeDownloadPathSegment(this.getPriorityDownloadTag(metadata.tags), 'no tags'),
            '{model_name}': this.sanitizeDownloadPathSegment(metadata.model_name || metadata.name || metadata.filename?.replace(/\.[^.]+$/, '') || 'Model', 'Model'),
            '{version_name}': this.sanitizeDownloadPathSegment(metadata.version_name || metadata.versionName || metadata.version || '', '')
        };
        let formatted = template;
        Object.entries(replacements).forEach(([token, value]) => {
            formatted = formatted.split(token).join(value);
        });
        formatted = formatted.replace(/\{[^{}]+\}/g, '');
        return this.normalizeTemplateSubfolder(formatted);
    },

    isAutoFillSubfolderEnabled() {
        if (this.getDownloadPathMode() === 'manual') return false;
        return localStorage.getItem('ModelResolver.autoFillSubfolder') !== 'false';
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

    getFirstSearchResult(result) {
        return Array.isArray(result) ? (result[0] || null) : (result || null);
    },

    getCachedSearchSuggestionData(missing = {}) {
        const state = this.searchResultCache?.get(this.getMissingSearchKey?.(missing));
        const results = state?.results || {};
        const merged = {};
        for (const source of ['popular', 'model_list', 'huggingface', 'civitai', 'civarchive', 'lora_manager_archive']) {
            const result = this.getFirstSearchResult(results[source]);
            if (result && typeof result === 'object') {
                Object.assign(merged, result);
            }
        }
        return merged;
    },

    normalizeFolderToken(value = '') {
        return String(value || '')
            .toLowerCase()
            .replace(/[\/\\]+/g, ' ')
            .replace(/[^a-z0-9]+/g, '');
    },

    getFolderSuggestionEntries(folders = []) {
        return folders.map(folder => {
            const value = this.getSubfolderOptionValue(folder);
            const segments = value.split(/[\/\\]/).filter(Boolean);
            return {
                value,
                label: this.getSubfolderOptionLabel(folder),
                baseDirectory: this.getSubfolderOptionBaseDirectory(folder),
                option: folder,
                segments,
                normalizedSegments: segments.map(segment => this.normalizeFolderToken(segment))
            };
        });
    },

    getSuggestedLoraSubfolder(missing, category, folderEntries = []) {
        if (this.normalizeDownloadCategory(category) !== 'loras' || !folderEntries.length) {
            return '';
        }

        const searchSuggestion = this.getCachedSearchSuggestionData(missing);
        const civitaiData = {
            ...(missing?.civitai_info || {}),
            ...(searchSuggestion || {}),
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
                return match;
            }
        }

        return exactBase || null;
    },

    getSuggestedModelSubfolderCandidates(missing = {}) {
        const source = missing.download_source || {};
        const civitaiInfo = missing.civitai_info || {};
        const civitaiSearch = missing.civitai_search_result || {};
        const searchSuggestion = this.getCachedSearchSuggestionData(missing);
        const rawValues = [
            source.filename,
            source.name,
            source.model_name,
            source.path,
            civitaiInfo.expected_filename,
            civitaiInfo.model_name,
            civitaiSearch.filename,
            civitaiSearch.name,
            civitaiSearch.model_name,
            searchSuggestion.filename,
            searchSuggestion.name,
            searchSuggestion.model_name,
            searchSuggestion.path,
            searchSuggestion.repo_id,
            searchSuggestion.repo,
            missing.original_path,
            missing.name
        ].filter(Boolean);
        const candidates = [];
        const ignoredTokens = new Set([
            'model',
            'models',
            'checkpoint',
            'checkpoints',
            'diffusion',
            'diffusionmodel',
            'diffusionmodels',
            'unet',
            'fp8',
            'fp16',
            'bf16',
            'f16',
            'f32',
            'scaled',
            'ema',
            'pruned',
            'safetensors',
            'ckpt',
            'bin',
            'pt',
            'pth',
            'gguf'
        ]);
        const addCandidate = (value) => {
            const normalized = this.normalizeFolderToken(value);
            if (!normalized || ignoredTokens.has(normalized) || normalized.length < 3) return;
            if (!candidates.some(candidate => candidate.normalized === normalized)) {
                candidates.push({
                    value: String(value || '').trim(),
                    normalized
                });
            }
        };

        for (const value of rawValues) {
            const text = String(value || '').trim();
            if (!text) continue;
            const pathParts = text.split(/[\/\\]/).filter(Boolean);
            if (pathParts.length > 1) {
                pathParts.slice(0, -1).forEach(addCandidate);
                addCandidate(pathParts.slice(0, -1).join('/'));
            }

            const filename = pathParts[pathParts.length - 1] || text;
            const stem = filename.replace(/\.[^.]+$/, '');
            addCandidate(stem);

            const tokens = stem
                .split(/[^A-Za-z0-9]+/)
                .map(token => token.trim())
                .filter(Boolean);
            if (tokens.length) {
                addCandidate(tokens[0]);
                for (const token of tokens) {
                    const familyMatch = token.match(/^([A-Za-z]{3,})(?=\d)/);
                    if (familyMatch) {
                        addCandidate(familyMatch[1]);
                    }
                }
                if (tokens.length > 1) {
                    addCandidate(tokens.slice(0, 2).join(' '));
                }
            }

            addCandidate(text);
        }

        return candidates;
    },

    getSuggestedExistingSubfolderByModelName(missing, folderEntries = []) {
        if (!folderEntries.length) return null;
        const candidates = this.getSuggestedModelSubfolderCandidates(missing);
        if (!candidates.length) return null;

        const findMatch = (predicate) => {
            for (const candidate of candidates) {
                const match = folderEntries.find(entry => predicate(entry, candidate));
                if (match) return match;
            }
            return null;
        };

        return findMatch((entry, candidate) => this.normalizeFolderToken(entry.value) === candidate.normalized)
            || findMatch((entry, candidate) => entry.normalizedSegments[0] === candidate.normalized)
            || findMatch((entry, candidate) => entry.normalizedSegments.some(segment => segment === candidate.normalized));
    },

    getSuggestedDownloadSubfolder(missing, category, folders = []) {
        const mode = this.getDownloadPathMode();
        if (mode === 'manual') {
            return null;
        }
        if (mode === 'template') {
            const value = this.calculateDownloadPathTemplateSubfolder(
                category,
                this.getDownloadPathMetadata(missing, { category })
            );
            return value
                ? { value, label: `${value} (template)`, baseDirectory: '' }
                : null;
        }

        const folderEntries = this.getFolderSuggestionEntries(folders);
        return this.getSuggestedLoraSubfolder(missing, category, folderEntries)
            || this.getSuggestedExistingSubfolderByModelName(missing, folderEntries);
    },

    async applySuggestedDownloadSubfolder(missing, categoryEl, subfolderEl) {
        if (!this.isAutoFillSubfolderEnabled()) return;
        if (!categoryEl || !subfolderEl || subfolderEl.value.trim()) return;
        const saved = this.getSavedDownloadTargetSelection(missing);
        if (saved?.subfolderTouched) return;

        const category = this.normalizeDownloadCategory(this.getDropdownValue(categoryEl));
        await this.ensureDownloadSubfoldersLoaded(category);
        const latestSaved = this.getSavedDownloadTargetSelection(missing);
        if (latestSaved?.subfolderTouched || subfolderEl.value.trim()) return;

        const folders = this.getAvailableSubfolders(category);
        const suggestion = this.getSuggestedDownloadSubfolder(missing, category, folders);
        if (suggestion) {
            subfolderEl.value = suggestion.value || '';
            subfolderEl.dataset.baseDirectory = suggestion.baseDirectory || '';
            this.saveDownloadTargetSelection(missing, {
                category,
                subfolder: suggestion.value || '',
                subfolderBaseDirectory: suggestion.baseDirectory || '',
                subfolderTouched: false
            });
            this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
        }
    },

    async forceSuggestedDownloadSubfolder(missing, categoryEl, subfolderEl) {
        if (!categoryEl || !subfolderEl) return;

        const category = this.normalizeDownloadCategory(this.getDropdownValue(categoryEl));
        await this.ensureDownloadSubfoldersLoaded(category);
        const folders = this.getAvailableSubfolders(category);
        const suggestion = this.getSuggestedDownloadSubfolder(missing, category, folders);
        if (!suggestion) {
            this.showNotification?.('No subfolder suggestion available for this model.', 'info');
            return;
        }

        subfolderEl.value = suggestion.value || '';
        subfolderEl.dataset.baseDirectory = suggestion.baseDirectory || '';
        this.saveDownloadTargetSelection(missing, {
            category,
            subfolder: suggestion.value || '',
            subfolderBaseDirectory: suggestion.baseDirectory || '',
            subfolderTouched: true
        });
        this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
    },

    applySearchResultSuggestion(missing) {
        const categoryEl = this.contentElement?.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = this.contentElement?.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        if (!categoryEl || !subfolderEl) return;
        this.applySuggestedDownloadSubfolder(missing, categoryEl, subfolderEl);
    },

    async ensureDownloadSubfoldersLoaded(category = '') {
        const key = this.normalizeDownloadCategory(category);
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
        const selectedCategory = this.normalizeDownloadCategory(saved?.category || defaultCategory || 'checkpoints');
        const selectedSubfolder = saved ? saved.subfolder || '' : '';
        const selectedSubfolderBaseDirectory = saved ? saved.subfolderBaseDirectory || '' : '';

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
        html += `<input id="${subfolderId}" class="mr-download-target-input" type="text" placeholder="e.g. ponyxl\\styles" autocomplete="off" value="${this.escapeHtml(selectedSubfolder)}" data-base-directory="${this.escapeHtml(selectedSubfolderBaseDirectory)}">`;
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
        const category = this.normalizeDownloadCategory(this.getDropdownValue(categoryEl) || fallbackCategory || 'checkpoints');
        const subfolder = (subfolderEl?.value || '').trim();
        const subfolderBaseDirectory = subfolder ? subfolderEl?.dataset.baseDirectory || '' : '';
        this.saveDownloadTargetSelection(missing, {
            category,
            subfolder,
            subfolderBaseDirectory
        });
        return {
            category,
            subfolder,
            baseDirectory: subfolderBaseDirectory
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
                    const baseDirectory = this.getSubfolderOptionBaseDirectory(option);
                    return `<div class="mr-download-target-option" data-value="${encodeURIComponent(value)}" data-label="${encodeURIComponent(label)}" data-base-directory="${encodeURIComponent(baseDirectory)}">${this.escapeHtml(label)}</div>`;
                })
                .join('');

            targetEl.style.display = 'block';

            targetEl.querySelectorAll('.mr-download-target-option').forEach(option => {
                option.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    const value = decodeURIComponent(option.dataset.value || '');
                    const label = decodeURIComponent(option.dataset.label || option.dataset.value || '');
                    const baseDirectory = decodeURIComponent(option.dataset.baseDirectory || '');
                    onSelect(value, label, baseDirectory);
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
                    subfolderBaseDirectory: '',
                    subfolderTouched: false
                });
                subfolderEl.dataset.baseDirectory = '';
                listEl.innerHTML = '';
                listEl.style.display = 'none';
                this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
                this.applySuggestedDownloadSubfolder(missing, categoryEl, subfolderEl);
            });
        };

        const populateSubfolderOptions = async (filterText = '') => {
            const filter = (filterText || '').toLowerCase();
            const category = this.getDropdownValue(categoryEl);
            await this.ensureDownloadSubfoldersLoaded(category);
            const folders = this.getAvailableSubfolders(category);
            const filtered = filter
                ? folders.filter(folder => this.getSubfolderOptionSearchText(folder).includes(filter))
                : folders;

            renderOptions(listEl, filtered, (value, _label, baseDirectory) => {
                subfolderEl.value = value;
                subfolderEl.dataset.baseDirectory = baseDirectory || '';
                this.saveDownloadTargetSelection(missing, {
                    category: this.getDropdownValue(categoryEl),
                    subfolder: value,
                    subfolderBaseDirectory: baseDirectory || '',
                    subfolderTouched: true
                });
                this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
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
            subfolderEl.dataset.baseDirectory = '';
            this.saveDownloadTargetSelection(missing, {
                category: this.getDropdownValue(categoryEl),
                subfolder: subfolderEl.value,
                subfolderBaseDirectory: '',
                subfolderTouched: true
            });
            this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
            populateSubfolderOptions(subfolderEl.value);
        });

        subfolderEl.addEventListener('blur', () => hideList(listEl));

        if (suggestBtn && suggestBtn.dataset.mlSuggestBound !== 'true') {
            suggestBtn.dataset.mlSuggestBound = 'true';
            suggestBtn.addEventListener('click', async () => {
                suggestBtn.disabled = true;
                try {
                    await this.forceSuggestedDownloadSubfolder(missing, categoryEl, subfolderEl);
                    listEl.innerHTML = '';
                    listEl.style.display = 'none';
                } finally {
                    suggestBtn.disabled = false;
                }
            });
        }

        this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
        this.applySuggestedDownloadSubfolder(missing, categoryEl, subfolderEl);
    },

    getStoredTokens() {
        const civitaiCandidateLimitRaw = parseInt(localStorage.getItem('ModelResolver.civitaiCandidateLimit') || '5', 10);
        const civitai_candidate_limit = Number.isFinite(civitaiCandidateLimitRaw)
            ? Math.min(20, Math.max(1, civitaiCandidateLimitRaw))
            : 5;
        const search_source_enabled = this.getSearchSourceEnabledMap();
        const storedFrontendLogsEnabled = localStorage.getItem('ModelResolver.frontendLogsEnabled');
        const storedBackendLogsEnabled = localStorage.getItem('ModelResolver.backendLogsEnabled');
        const storedFrontendLogLevel = localStorage.getItem('ModelResolver.frontendLogLevel');
        const storedBackendLogLevel = localStorage.getItem('ModelResolver.backendLogLevel');

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
            auto_fill_base_model: localStorage.getItem('ModelResolver.autoFillBaseModel') !== 'false',
            auto_fill_subfolder: localStorage.getItem('ModelResolver.autoFillSubfolder') !== 'false',
            frontend_logs_enabled: storedFrontendLogsEnabled === null
                ? frontendLogger.enabled !== false
                : storedFrontendLogsEnabled !== 'false',
            backend_logs_enabled: storedBackendLogsEnabled === null
                ? true
                : storedBackendLogsEnabled !== 'false',
            frontend_log_level: storedFrontendLogLevel || DEFAULT_FRONTEND_LOG_LEVEL,
            backend_log_level: storedBackendLogLevel || 'DEBUG',
            civitai_candidate_limit,
            search_source_enabled,
            download_path_mode: this.getDownloadPathMode(),
            download_path_templates: this.getDownloadPathTemplates(),
            base_model_path_mappings: this.getBaseModelPathMappings(),
            ...this.getDefaultRootSettings()
        };
    },

    applyFrontendLoggingPreference(enabled = true, levelName = 'DEBUG') {
        frontendLogger.setEnabled(Boolean(enabled));
        frontendLogger.setGlobalAndModuleLevel(frontendLogger.normalizeLevel(levelName));
    },

    /**
     * Fetch settings saved on the server and sync them into localStorage.
     * Call this once when the dialog initialises so every browser gets the
     * same tokens without the user having to re-enter them.
     */
    async loadSettingsFromServer() {
        try {
            const resp = await api.fetchApi('/model_resolver/settings');
            if (!resp.ok) {
                const tokens = this.getStoredTokens();
                this.applyFrontendLoggingPreference(tokens.frontend_logs_enabled, tokens.frontend_log_level);
                return;
            }
            const data = await resp.json();
            if (!data || typeof data !== 'object') {
                const tokens = this.getStoredTokens();
                this.applyFrontendLoggingPreference(tokens.frontend_logs_enabled, tokens.frontend_log_level);
                return;
            }

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
            if (data.auto_fill_base_model !== undefined)
                localStorage.setItem('ModelResolver.autoFillBaseModel',      data.auto_fill_base_model ? 'true' : 'false');
            if (data.auto_fill_subfolder !== undefined)
                localStorage.setItem('ModelResolver.autoFillSubfolder',      data.auto_fill_subfolder ? 'true' : 'false');
            if (data.download_path_mode !== undefined)
                localStorage.setItem('ModelResolver.downloadPathMode',       this.normalizeDownloadPathMode(data.download_path_mode));
            if (data.download_path_templates !== undefined)
                localStorage.setItem('ModelResolver.downloadPathTemplates',  JSON.stringify(data.download_path_templates || {}));
            if (data.base_model_path_mappings !== undefined)
                localStorage.setItem('ModelResolver.baseModelPathMappings',  JSON.stringify(data.base_model_path_mappings || {}));
            this.getDefaultRootCategoryDefinitions().forEach((item) => {
                if (data[item.settingKey] !== undefined) {
                    localStorage.setItem(item.storageKey, String(data[item.settingKey] || ''));
                }
            });
            if (data.civitai_candidate_limit !== undefined)
                localStorage.setItem('ModelResolver.civitaiCandidateLimit',  `${data.civitai_candidate_limit}`);
            if (data.frontend_logs_enabled !== undefined)
                localStorage.setItem('ModelResolver.frontendLogsEnabled',    data.frontend_logs_enabled ? 'true' : 'false');
            if (data.backend_logs_enabled !== undefined)
                localStorage.setItem('ModelResolver.backendLogsEnabled',     data.backend_logs_enabled ? 'true' : 'false');
            if (data.frontend_log_level !== undefined)
                localStorage.setItem('ModelResolver.frontendLogLevel',       String(data.frontend_log_level || 'DEBUG').toUpperCase());
            if (data.backend_log_level !== undefined)
                localStorage.setItem('ModelResolver.backendLogLevel',        String(data.backend_log_level || 'DEBUG').toUpperCase());

            // Source-enabled flags stored as a nested object
            if (data.search_source_enabled && typeof data.search_source_enabled === 'object') {
                Object.entries(data.search_source_enabled).forEach(([key, val]) => {
                    if (key) localStorage.setItem(key, val ? 'true' : 'false');
                });
            }
            const tokens = this.getStoredTokens();
            this.applyFrontendLoggingPreference(tokens.frontend_logs_enabled, tokens.frontend_log_level);
        } catch (err) {
            console.warn('Model Resolver: could not load settings from server, using localStorage only.', err);
            const tokens = this.getStoredTokens();
            this.applyFrontendLoggingPreference(tokens.frontend_logs_enabled, tokens.frontend_log_level);
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
        this.workflowDownloadTargetSelectionCaches?.clear();
        this.cachedAnalysisData = null;
        this.cachedWorkflowSignature = null;
        this.cachedLoadedModelsData = null;
        this.cachedLoadedModelsSignature = null;
        this.allModels = null;
        this.downloadDirectories = null;
        this.downloadRootDirectories = null;
        this.capabilities = null;
        this.baseModels = null;
        this.downloadSubfolders.clear();
        this.downloadTargetSelections?.clear();
        this._analysisProgressToken = null;
        this._workflowDataLoadToken = null;
        this._loadedModelsLoadToken = null;

        await this.ensureCapabilitiesLoaded();
        await this.ensureBaseModelsLoaded();
        this.refreshMissingListStats?.();
        this.updateBatchFooterButtons?.();
        this.updateDownloadAllButtonState?.();

        await this.clearBackendSearchCaches({ throwOnError: true });
    }
};
