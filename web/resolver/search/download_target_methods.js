import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
import { createFloatingTreePicker } from "../utils/tree_picker.js";
import { safeStorage } from "../utils/html_utils.js";
const localStorage = safeStorage;
const invalidWindowsPathCharacters = new RegExp(
    `[<>:"|?*${Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join('')}]+`,
    'g'
);
export const downloadTargetMethods = {
    /**
     * Ensure all models are loaded for the dropdown.
     */
    async ensureAllModelsLoaded(options = {}) {
        const force = options === true || Boolean(options?.force);
        if (!force && this.allModels && this.allModels.length) return;
        try {
            const models = await this.fetchJson(`/model_resolver/models${force ? '?force=1' : ''}`, {}, 'Load all models');
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
            const directories = await this.fetchJson('/model_resolver/directories', {}, 'Load download directories');
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
            const data = await this.fetchJson('/model_resolver/capabilities', {}, 'Load capabilities');
            this.capabilities = data && typeof data === 'object' ? data : { sources: {} };
        } catch (e) {
            console.warn('Model Resolver: could not load capabilities', e);
            this.capabilities = { sources: {} };
        }
    },

    async ensureDownloadRootDirectoriesLoaded() {
        if (this.downloadRootDirectories) return this.downloadRootDirectories;
        try {
            const data = await this.fetchJson('/model_resolver/root-directories', {}, 'Load root directories');
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
            const data = await this.fetchJson('/model_resolver/base-models', {}, 'Load base models config');
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
            textualinversion: 'embeddings',
            textual_inversion: 'embeddings',
            upscaler: 'upscale_models',
            unet: 'diffusion_models',
            unet_gguf: 'diffusion_models',
            model_gguf: 'diffusion_models',
            select_safetensors: 'diffusion_models',
            diffusion_model: 'diffusion_models',
            diffusion_models: 'diffusion_models',
            clip: 'text_encoders',
            clips: 'text_encoders',
            clip_gguf: 'text_encoders',
            text_encoder: 'text_encoders',
            text_encoders: 'text_encoders',
            ip_adapter: 'ipadapter',
            upscale_model: 'upscale_models',
            latent_upscale_model: 'latent_upscale_models',
            style_model: 'style_models',
            audio_encoder: 'audio_encoders',
            model_patch: 'model_patches',
            sam: 'sams',
            sam_model: 'sams',
            sam_models: 'sams',
            ultralytics_bbox: 'ultralytics',
            ultralytics_segm: 'ultralytics',
            yolo: 'ultralytics',
            background_removal_model: 'background_removal',
            frame_interpolation_model: 'frame_interpolation',
            geometry_estimation_model: 'geometry_estimation',
            optical_flow_model: 'optical_flow',
            'default': 'upscale_models'
        };
        return categoryMap[token] || token || 'checkpoints';
    },

    getKnownDownloadCategorySet() {
        const directories = this.downloadDirectories || {};
        return new Set([
            ...Object.keys(directories),
            ...this.getDefaultDownloadCategoryKeys()
        ].map(key => this.normalizeDownloadCategory(key)).filter(Boolean));
    },

    getMissingSupportedDownloadCategories(missing = {}) {
        const knownCategories = this.getKnownDownloadCategorySet();
        const collectCategories = (...values) => {
            const categories = [];
            const addCategory = (value) => {
                if (value === undefined || value === null || String(value).trim() === '') return;
                if (Array.isArray(value)) {
                    value.forEach(addCategory);
                    return;
                }
                String(value).split(/[,|;]/).forEach(part => {
                    const normalized = this.normalizeDownloadCategory(part);
                    if (normalized && knownCategories.has(normalized) && !categories.includes(normalized)) {
                        categories.push(normalized);
                    }
                });
            };
            values.forEach(addCategory);
            return categories;
        };
        const chooseSupported = (supported = []) => {
            if (!supported.length) return [];
            const nodeCategory = this.getMissingNodeTypeDownloadCategory(missing);
            if (nodeCategory && supported.includes(nodeCategory)) {
                return [nodeCategory];
            }
            return supported;
        };

        const widgetSupported = collectCategories(
            missing.folder_key_hints,
            missing.folderKeyHints,
            missing.model_widget_folder_key_hints,
            missing.modelWidgetFolderKeyHints,
            missing.model_widget_category_hints,
            missing.modelWidgetCategoryHints
        );
        if (widgetSupported.length) {
            return chooseSupported(widgetSupported);
        }

        const supported = collectCategories(
            missing.category_hints,
            missing.categoryHints,
            missing.supported_categories,
            missing.supportedCategories
        );
        if (supported.length) {
            return chooseSupported(supported);
        }

        const fallbackSupported = [];
        const addCategory = (value) => {
            if (value === undefined || value === null || String(value).trim() === '') return;
            if (Array.isArray(value)) {
                value.forEach(addCategory);
                return;
            }
            String(value).split(/[,|;]/).forEach(part => {
                const normalized = this.normalizeDownloadCategory(part);
                if (normalized && knownCategories.has(normalized) && !fallbackSupported.includes(normalized)) {
                    fallbackSupported.push(normalized);
                }
            });
        };

        addCategory(this.getMissingNodeTypeDownloadCategory(missing));
        if (fallbackSupported.length) {
            return fallbackSupported;
        }

        addCategory(missing.category);
        addCategory(missing.directory);

        return fallbackSupported;
    },

    getSourceResultDownloadCategory(source = {}, fallbackCategory = '', missing = null) {
        const sourceData = source && typeof source === 'object' ? source : {};
        const knownCategories = this.getKnownDownloadCategorySet();
        const fallback = this.normalizeDownloadCategory(fallbackCategory || '');
        const supportedCategories = missing
            ? this.getMissingSupportedDownloadCategories(missing)
            : [];
        const sourceCandidates = [
            sourceData.model_type,
            sourceData.modelType,
            sourceData.type,
            sourceData.category,
            sourceData.directory
        ];

        for (const candidate of sourceCandidates) {
            if (candidate === undefined || candidate === null || String(candidate).trim() === '') continue;
            const normalized = this.normalizeDownloadCategory(candidate);
            if (
                normalized
                && knownCategories.has(normalized)
                && supportedCategories.includes(normalized)
            ) {
                return normalized;
            }
        }

        if (
            fallback
            && knownCategories.has(fallback)
            && (!supportedCategories.length || supportedCategories.includes(fallback))
        ) {
            return fallback;
        }

        if (supportedCategories.length) {
            return supportedCategories[0];
        }

        if (fallback && knownCategories.has(fallback)) {
            return fallback;
        }

        for (const candidate of sourceCandidates) {
            if (candidate === undefined || candidate === null || String(candidate).trim() === '') continue;
            const normalized = this.normalizeDownloadCategory(candidate);
            if (normalized && knownCategories.has(normalized)) {
                return normalized;
            }
        }

        const defaultCategory = this.normalizeDownloadCategory('checkpoints');
        return knownCategories.has(defaultCategory)
            ? defaultCategory
            : this.normalizeDownloadCategory(fallbackCategory || 'checkpoints');
    },

    getExactNodeTypeDownloadCategory(nodeType = '') {
        const normalizedNodeType = String(nodeType || '').trim();
        const dynamicRules = this.capabilities?.node_rules;
        if (dynamicRules && typeof dynamicRules === 'object' && dynamicRules[normalizedNodeType]) {
            const widgetsMap = dynamicRules[normalizedNodeType];
            if (widgetsMap && typeof widgetsMap === 'object') {
                const indices = Object.keys(widgetsMap).map(k => parseInt(k, 10)).sort((a, b) => a - b);
                if (indices.length > 0) {
                    return widgetsMap[indices[0]] || '';
                }
            }
        }
        const exactMap = {
            CheckpointLoaderSimple: 'checkpoints',
            CheckpointLoader: 'checkpoints',
            UNETLoader: 'diffusion_models',
            UNETLoaderAdvanced: 'diffusion_models',
            LoaderGGUF: 'diffusion_models',
            LoaderGGUFAdvanced: 'diffusion_models',
            UnetLoaderGGUF: 'diffusion_models',
            UnetLoaderGGUFAdvanced: 'diffusion_models',
            VAELoader: 'vae',
            VAELoaderKJ: 'vae',
            LoraLoader: 'loras',
            LoraLoaderModelOnly: 'loras',
            LoraLoaderBypass: 'loras',
            LoraLoaderBypassModelOnly: 'loras',
            LoraLoaderV2: 'loras',
            ControlNetLoader: 'controlnet',
            CLIPLoader: 'text_encoders',
            DualCLIPLoader: 'text_encoders',
            TripleCLIPLoader: 'text_encoders',
            CLIPLoaderGGUF: 'text_encoders',
            ClipLoaderGGUF: 'text_encoders',
            DualCLIPLoaderGGUF: 'text_encoders',
            DualClipLoaderGGUF: 'text_encoders',
            TripleCLIPLoaderGGUF: 'text_encoders',
            TripleClipLoaderGGUF: 'text_encoders',
            QuadrupleCLIPLoader: 'text_encoders',
            QuadrupleClipLoader: 'text_encoders',
            QuadrupleCLIPLoaderGGUF: 'text_encoders',
            QuadrupleClipLoaderGGUF: 'text_encoders',
            UpscaleModelLoader: 'upscale_models',
            LTXVAudioVAELoader: 'checkpoints',
            LowVRAMAudioVAELoader: 'checkpoints'
        };
        return exactMap[normalizedNodeType] || '';
    },

    getNodeTypeDownloadCategory(nodeType = '') {
        const normalizedNodeType = String(nodeType || '').trim();
        const exactCategory = this.getExactNodeTypeDownloadCategory(normalizedNodeType);
        if (exactCategory) return exactCategory;

        const tokenCategory = this.getNodeTypeDownloadCategoryFromTokens(normalizedNodeType);
        if (tokenCategory) return tokenCategory;

        const token = normalizedNodeType.toLowerCase();
        if (!token) return '';
        if (token.includes('lora')) return 'loras';
        if (token.includes('vae')) return 'vae';
        if (token.includes('checkpoint')) return 'checkpoints';
        if (token.includes('unet') || token.includes('diffusion')) return 'diffusion_models';
        if (token.includes('controlnet')) return 'controlnet';
        if (token.includes('upscale')) return 'upscale_models';
        if (token.includes('embedding') || token.includes('textualinversion')) return 'embeddings';
        if (token.includes('clip')) return 'text_encoders';
        return '';
    },

    normalizeNodeCategoryToken(value = '') {
        return String(value || '')
            .trim()
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    },

    getNodeTypeDownloadCategoryFromTokens(nodeType = '') {
        const nodeToken = this.normalizeNodeCategoryToken(nodeType);
        if (!nodeToken) return '';

        const ignoredTokens = new Set(['model', 'models', 'loader', 'provider']);
        const candidates = [];
        const seen = new Set();
        const addCandidate = (category, tokenValue) => {
            const token = this.normalizeNodeCategoryToken(tokenValue);
            if (!token || token.length < 3 || ignoredTokens.has(token)) return;
            const key = `${category}:${token}`;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push({ category, token });
        };
        const addTokenParts = (category, tokenValue) => {
            String(tokenValue || '').split(/[_\s-]+/).forEach(part => addCandidate(category, part));
        };

        this.getDefaultDownloadCategoryKeys().forEach(rawCategory => {
            const category = this.normalizeDownloadCategory(rawCategory);
            if (!category) return;
            const tokenName = this.getCategoryTokenName(category);
            addCandidate(category, category);
            addCandidate(category, category.replace(/s$/, ''));
            addCandidate(category, tokenName);
            addTokenParts(category, category);
            addTokenParts(category, tokenName);
        });

        candidates.sort((a, b) => b.token.length - a.token.length);
        const match = candidates.find(candidate => (
            candidate.token.length <= 3
                ? nodeToken.startsWith(candidate.token)
                : nodeToken.includes(candidate.token)
        ));
        return match?.category || '';
    },

    getMissingNodeTypeDownloadCategory(missing = {}) {
        return this.getNodeTypeDownloadCategory(missing.locate_node_type)
            || this.getNodeTypeDownloadCategory(missing.promoted_inner_node_type)
            || this.getNodeTypeDownloadCategory(missing.node_type)
            || '';
    },

    shouldPreserveSavedDownloadCategory(missing = {}, saved = {}, inferredCategory = '') {
        if (!saved?.categoryTouched) return false;
        if (saved.category === undefined || saved.category === null || String(saved.category).trim() === '') return false;
        const savedCategory = this.normalizeDownloadCategory(saved.category || '');
        if (!savedCategory) return false;

        const nodeCategory = this.getMissingNodeTypeDownloadCategory(missing);
        const rawMissingCategory = missing.category || missing.directory || '';
        const missingCategory = rawMissingCategory ? this.normalizeDownloadCategory(rawMissingCategory) : '';
        const strongInferredCategory = nodeCategory || (missingCategory && missingCategory !== 'checkpoints' ? missingCategory : '');
        const inferred = this.normalizeDownloadCategory(inferredCategory || nodeCategory || '');
        if (
            savedCategory === 'checkpoints'
            && inferred
            && inferred !== 'checkpoints'
            && strongInferredCategory
        ) {
            return false;
        }
        return true;
    },

    getMissingDownloadCategory(missing = {}, fallbackCategory = 'checkpoints') {
        const knownCategories = this.getKnownDownloadCategorySet();
        const supportedCategories = this.getMissingSupportedDownloadCategories?.(missing) || [];
        const candidates = [
            ...supportedCategories,
            this.getMissingNodeTypeDownloadCategory(missing),
            missing.category,
            missing.directory,
            fallbackCategory
        ];

        for (const candidate of candidates) {
            if (candidate === undefined || candidate === null || String(candidate).trim() === '') continue;
            const normalized = this.normalizeDownloadCategory(candidate);
            if (normalized && knownCategories.has(normalized)) {
                return normalized;
            }
        }

        return this.normalizeDownloadCategory(fallbackCategory || 'checkpoints');
    },

    getDownloadCategoryTooltip(missing = {}, selectedCategory = '', options = {}) {
        const formatFolderTooltip = (heading, value, reason, action = 'Choose another option in the Folder field.') => (
            `${heading}: ${value}\n\nWhy: ${reason}\n\nTo change: ${action}`
        );
        const category = this.normalizeDownloadCategory(selectedCategory || 'checkpoints');
        const label = this.getCategoryDisplayName(category);
        const saved = options.saved || this.getSavedDownloadTargetSelection(missing);
        const inferredCategory = options.inferredCategory || this.getMissingDownloadCategory(missing, options.defaultCategory || 'checkpoints');
        const preserveSavedCategory = options.preserveSavedCategory ?? this.shouldPreserveSavedDownloadCategory(missing, saved, inferredCategory);

        if (preserveSavedCategory) {
            return formatFolderTooltip(
                'Selected manually',
                label,
                'You changed this folder earlier, so Model Resolver kept your choice for this workflow.'
            );
        }

        const nodeCategory = this.getMissingNodeTypeDownloadCategory(missing);
        if (nodeCategory && this.normalizeDownloadCategory(nodeCategory) === category) {
            const nodeType = missing.locate_node_type || missing.promoted_inner_node_type || missing.node_type || 'this node';
            return formatFolderTooltip(
                'Selected automatically',
                label,
                `The workflow node “${nodeType}” uses this type of model.`
            );
        }

        const rawMissingCategory = missing.category || missing.directory || '';
        const missingCategory = rawMissingCategory ? this.normalizeDownloadCategory(rawMissingCategory) : '';
        if (missingCategory && missingCategory === category) {
            return formatFolderTooltip(
                'Selected automatically',
                label,
                `The workflow identifies this as a ${this.getCategoryDisplayName(missingCategory)} model.`
            );
        }

        const defaultCategory = this.normalizeDownloadCategory(options.defaultCategory || 'checkpoints');
        if (defaultCategory && defaultCategory === category) {
            return formatFolderTooltip(
                'Selected automatically',
                label,
                'This is the folder recommended by the selected download source or your default settings.'
            );
        }

        return formatFolderTooltip(
            'Selected automatically',
            label,
            'This is the closest matching download folder available for this model.'
        );
    },

    getSubfolderSuggestionTrackingPatch(suggestion = null, appliedBy = '') {
        if (!suggestion || typeof suggestion !== 'object') {
            return {
                subfolderSuggestionSource: '',
                subfolderSuggestionAppliedBy: '',
                subfolderSuggestionTemplate: '',
                subfolderSuggestionMatchedBaseModel: '',
                subfolderSuggestionMatchedTag: '',
                subfolderSuggestionMatchedCandidate: ''
            };
        }

        return {
            subfolderSuggestionSource: suggestion.suggestionSource || '',
            subfolderSuggestionAppliedBy: appliedBy || '',
            subfolderSuggestionTemplate: suggestion.template || '',
            subfolderSuggestionMatchedBaseModel: suggestion.matchedBaseModel || '',
            subfolderSuggestionMatchedTag: suggestion.matchedTag || '',
            subfolderSuggestionMatchedCandidate: suggestion.matchedCandidate || ''
        };
    },

    getDownloadSubfolderSuggestionReason(suggestion = {}, missing = {}) {
        const source = suggestion?.suggestionSource || '';
        if (source === 'template') {
            const template = suggestion.template ? ` “${suggestion.template}”` : '';
            return `Your saved folder rule${template} produced this subfolder from the available model information.`;
        }
        if (source === 'lora_metadata') {
            const baseModel = suggestion.matchedBaseModel || '';
            const tag = suggestion.matchedTag || '';
            if (baseModel && tag) {
                return `The LoRA is identified as ${baseModel} and tagged “${tag}”; an existing folder matches both.`;
            }
            if (baseModel) {
                return `The LoRA is identified as ${baseModel}, and an existing folder has the same name.`;
            }
            return `The available LoRA information matches an existing folder.`;
        }
        if (source === 'model_name') {
            const candidate = suggestion.matchedCandidate || '';
            const candidateToken = this.normalizeFolderToken(candidate);
            const workflowPathParts = String(missing?.original_path || '')
                .split(/[/\\]+/)
                .map(part => part.trim())
                .filter(Boolean);
            const workflowDirectoryParts = workflowPathParts.slice(0, -1);
            const matchingWorkflowDirectory = workflowDirectoryParts.find(part => (
                candidateToken && this.normalizeFolderToken(part) === candidateToken
            ));
            if (matchingWorkflowDirectory) {
                return `The model path saved in this workflow already contains the folder “${matchingWorkflowDirectory}”, and the same download folder exists on this computer.`;
            }
            return candidate
                ? `Part of the model name, “${candidate}”, matches an existing download folder.`
                : `The model name matches an existing download folder.`;
        }
        return '';
    },

    getSavedDownloadSubfolderSuggestion(saved = {}, subfolder = '', baseDirectory = '') {
        if (!saved?.subfolderSuggestionSource) return null;
        const selectedValue = this.normalizeDownloadSubfolderPath(subfolder);
        const savedValue = this.normalizeDownloadSubfolderPath(saved.subfolder || '');
        if (!selectedValue || selectedValue !== savedValue) return null;
        if (String(baseDirectory || '') !== String(saved.subfolderBaseDirectory || '')) return null;

        return {
            value: saved.subfolder || selectedValue,
            baseDirectory: saved.subfolderBaseDirectory || '',
            suggestionSource: saved.subfolderSuggestionSource || '',
            template: saved.subfolderSuggestionTemplate || '',
            matchedBaseModel: saved.subfolderSuggestionMatchedBaseModel || '',
            matchedTag: saved.subfolderSuggestionMatchedTag || '',
            matchedCandidate: saved.subfolderSuggestionMatchedCandidate || ''
        };
    },

    getCurrentDownloadSubfolderSuggestion(missing = {}, category = '', subfolder = '', baseDirectory = '') {
        const selectedValue = this.normalizeDownloadSubfolderPath(subfolder);
        if (!selectedValue) return null;

        const folders = this.getAvailableSubfolders(category);
        const suggestion = this.getSuggestedDownloadSubfolder(missing, category, folders);
        if (!suggestion || typeof suggestion !== 'object') return null;

        const suggestionValue = this.normalizeDownloadSubfolderPath(suggestion.value || '');
        if (suggestionValue !== selectedValue) return null;

        const suggestionBaseDirectory = String(suggestion.baseDirectory || '');
        if (suggestionBaseDirectory && suggestionBaseDirectory !== String(baseDirectory || '')) {
            return null;
        }
        return suggestion;
    },

    getDownloadSubfolderTooltip(missing = {}, selectedCategory = '', selectedSubfolder = '', options = {}) {
        const formatSubfolderTooltip = (heading, value, reason, finalLabel = 'To change', finalText = 'Type or choose another subfolder.') => (
            `${heading}: ${value}\n\nWhy: ${reason}\n\n${finalLabel}: ${finalText}`
        );
        const category = this.normalizeDownloadCategory(selectedCategory || 'checkpoints');
        const categoryLabel = this.getCategoryDisplayName(category);
        const saved = options.saved || this.getSavedDownloadTargetSelection(missing);
        const subfolder = this.normalizeDownloadSubfolderPath(selectedSubfolder || '');
        const baseDirectory = options.baseDirectory || '';
        const mode = this.getDownloadPathMode();
        const savedSuggestion = this.getSavedDownloadSubfolderSuggestion(saved, subfolder, baseDirectory);
        const currentSuggestion = savedSuggestion || this.getCurrentDownloadSubfolderSuggestion(missing, category, subfolder, baseDirectory);
        const suggestionReason = this.getDownloadSubfolderSuggestionReason(currentSuggestion, missing);

        if (saved?.subfolderTouched) {
            if (!subfolder) {
                return formatSubfolderTooltip(
                    'Subfolder',
                    'None',
                    'You cleared this field manually, so Model Resolver kept it empty.',
                    'Save location',
                    `The file will be saved directly in the ${categoryLabel} folder.`
                );
            }
            if (saved?.subfolderSuggestionAppliedBy === 'button' && suggestionReason) {
                return formatSubfolderTooltip(
                    'Selected with Suggest',
                    subfolder,
                    suggestionReason
                );
            }
            return formatSubfolderTooltip(
                'Selected manually',
                subfolder,
                'You changed this subfolder earlier, so Model Resolver kept your choice for this workflow.'
            );
        }

        if (subfolder) {
            return formatSubfolderTooltip(
                'Suggested subfolder',
                subfolder,
                suggestionReason || 'This is the closest matching existing folder for the available model information.'
            );
        }

        if (mode === 'manual') {
            return formatSubfolderTooltip(
                'Subfolder',
                'None',
                'Automatic subfolder suggestions are set to Manual in Options.',
                'To add one',
                'Type a subfolder or click Suggest.'
            );
        }

        if (!this.isAutoFillSubfolderEnabled()) {
            return formatSubfolderTooltip(
                'Subfolder',
                'None',
                'Automatic subfolder suggestions are disabled in Options.',
                'To add one',
                'Type a subfolder or click Suggest.'
            );
        }

        return formatSubfolderTooltip(
            'Subfolder',
            'None',
            'Model Resolver did not find enough reliable information to choose one.',
            'Save location',
            `The file will be saved directly in the ${categoryLabel} folder.`
        );
    },

    refreshDownloadTargetHelp(container, missing, categoryEl = null, subfolderEl = null) {
        if (!container || !missing) return;
        const resolvedCategoryEl = categoryEl
            || container.querySelector?.(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const resolvedSubfolderEl = subfolderEl
            || container.querySelector?.(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        if (!resolvedCategoryEl) return;

        const saved = this.getSavedDownloadTargetSelection(missing);
        const defaultCategory = resolvedCategoryEl.dataset.defaultCategory || 'checkpoints';
        const selectedCategory = this.getDropdownValue(resolvedCategoryEl)
            || this.getMissingDownloadCategory(missing, defaultCategory);
        const inferredCategory = this.getMissingDownloadCategory(missing, defaultCategory);
        const folderHelpEl = container.querySelector?.('.mr-download-folder-help');
        if (folderHelpEl) {
            folderHelpEl.setAttribute('data-tooltip', this.getDownloadCategoryTooltip(missing, selectedCategory, {
                saved,
                inferredCategory,
                preserveSavedCategory: this.shouldPreserveSavedDownloadCategory(missing, saved, inferredCategory),
                defaultCategory
            }));
        }

        const subfolderHelpEl = container.querySelector?.('.mr-download-subfolder-help');
        if (subfolderHelpEl) {
            subfolderHelpEl.setAttribute('data-tooltip', this.getDownloadSubfolderTooltip(
                missing,
                selectedCategory,
                resolvedSubfolderEl?.value || '',
                {
                    saved,
                    defaultCategory,
                    baseDirectory: resolvedSubfolderEl?.dataset.baseDirectory || ''
                }
            ));
        }
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
            'hypernetworks': 'hypernetwork',
            'style_models': 'style model',
            'gligen': 'GLIGEN',
            'diffusers': 'Diffusers',
            'vae_approx': 'TAESD / VAE approx',
            'audio_encoders': 'audio encoder',
            'background_removal': 'background removal',
            'frame_interpolation': 'frame interpolation',
            'geometry_estimation': 'geometry estimation',
            'detection': 'detection',
            'model_patches': 'model patch',
            'photomaker': 'PhotoMaker',
            'optical_flow': 'optical flow',
            'sams': 'SAM',
            'ultralytics': 'Ultralytics'
        };
        return displayNames[category] || category || 'unknown';
    },

    getModelTypeColorClass(value = '') {
        const rawToken = String(value || '')
            .trim()
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .toLowerCase()
            .replace(/[\s./\\-]+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        const token = rawToken
            ? (this.normalizeDownloadCategory?.(rawToken) || rawToken)
            : '';
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
            clip_gguf: 'clip',
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
            gligen: 'conditioning',
            diffusers: 'model',
            audio_encoders: 'clip',
            audio_encoder: 'clip',
            background_removal: 'image',
            frame_interpolation: 'image',
            geometry_estimation: 'image',
            detection: 'controlnet',
            model_patches: 'model',
            model_patch: 'model',
            photomaker: 'clip-vision',
            optical_flow: 'image',
            sams: 'controlnet',
            sam: 'controlnet',
            sam_model: 'controlnet',
            ultralytics: 'controlnet',
            ultralytics_bbox: 'controlnet',
            ultralytics_segm: 'controlnet',
            yolo: 'controlnet',
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
            'hypernetworks': 'hypernetwork',
            'style_models': 'style_model',
            'gligen': 'gligen',
            'diffusers': 'diffusers',
            'vae_approx': 'vae_approx',
            'audio_encoders': 'audio_encoder',
            'background_removal': 'background_removal',
            'frame_interpolation': 'frame_interpolation',
            'geometry_estimation': 'geometry_estimation',
            'detection': 'detection',
            'model_patches': 'model_patch',
            'photomaker': 'photomaker',
            'optical_flow': 'optical_flow',
            'sams': 'sam_model',
            'ultralytics': 'ultralytics'
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
            'style_models',
            'gligen',
            'diffusers',
            'latent_upscale_models',
            'audio_encoders',
            'background_removal',
            'frame_interpolation',
            'geometry_estimation',
            'detection',
            'model_patches',
            'photomaker',
            'optical_flow',
            'ipadapter',
            'sams',
            'ultralytics'
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

    normalizeDownloadSubfolderPath(value = '') {
        return this.normalizePathToBackward(value)
            .split('\\')
            .map(part => part.trim())
            .filter(part => part && part !== '.' && part !== '..')
            .join('\\');
    },

    getDownloadSubfolderPrefixes(value = '') {
        const parts = this.normalizeDownloadSubfolderPath(value).split('\\').filter(Boolean);
        const prefixes = [];
        let current = '';
        parts.forEach(part => {
            current = current ? `${current}\\${part}` : part;
            prefixes.push(current);
        });
        return prefixes;
    },

    rememberDownloadedSubfolder(category = '', subfolder = '', baseDirectory = '') {
        const key = this.normalizeDownloadCategory(category);
        if (!key || key === 'unknown') return;

        const prefixes = this.getDownloadSubfolderPrefixes(subfolder);
        if (!prefixes.length) return;

        const cached = this.downloadSubfolders.get(key);
        if (!Array.isArray(cached)) {
            this.downloadSubfolders.delete(key);
            return;
        }

        const targetBaseDirectory = String(baseDirectory || this.getDownloadTargetBaseDirectory(key) || '');
        const normalizeBase = (value = '') => String(value || '')
            .replace(/[\\/]+/g, '/')
            .replace(/\/+$/g, '')
            .toLowerCase();
        const normalizeValue = (value = '') => this.normalizeDownloadSubfolderPath(value).toLowerCase();
        const makeIdentity = (value = '', base = '') => `${normalizeValue(value)}::${normalizeBase(base)}`;
        const known = new Set(cached.map(option => makeIdentity(
            this.getSubfolderOptionValue(option),
            this.getSubfolderOptionBaseDirectory(option)
        )));
        const next = [...cached];

        prefixes.forEach(prefix => {
            const identity = makeIdentity(prefix, targetBaseDirectory);
            if (known.has(identity)) return;
            known.add(identity);
            next.push({
                value: prefix,
                label: prefix,
                base_directory: targetBaseDirectory
            });
        });

        next.sort((a, b) => {
            const valueCompare = this.getSubfolderOptionValue(a)
                .localeCompare(this.getSubfolderOptionValue(b), undefined, { sensitivity: 'base' });
            if (valueCompare !== 0) return valueCompare;
            return this.getSubfolderOptionBaseDirectory(a)
                .localeCompare(this.getSubfolderOptionBaseDirectory(b), undefined, { sensitivity: 'base' });
        });
        this.downloadSubfolders.set(key, next);
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
            this.setContextMenuElement(element, contextMenuModel, tooltip);
            element.classList.add('mr-download-folder-context');
        } else {
            this.setContextMenuElement(element, null);
            element.classList.remove('mr-download-folder-context');
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
        return this.normalizePathToForward(template)
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

    isBaseModelPathMappingCompatible(baseModel = '', mappedPath = '') {
        const sourceCanonical = this.resolveBaseModelAliasExact?.(baseModel)
            || this.resolveBaseModelAlias?.(baseModel)
            || String(baseModel || '').trim();
        if (!sourceCanonical) return true;

        const pathLabel = String(mappedPath || '')
            .replace(/[\\/]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!pathLabel) return true;

        const pathCanonical = this.resolveBaseModelAliasExact?.(pathLabel) || '';
        return !pathCanonical || pathCanonical === sourceCanonical;
    },

    resolveBaseModelPathMapping(baseModel = '', mappings = null) {
        const text = String(baseModel || '');
        const activeMappings = mappings || this.getBaseModelPathMappings();
        if (Object.prototype.hasOwnProperty.call(activeMappings, text)) {
            const mapped = activeMappings[text];
            return this.isBaseModelPathMappingCompatible(text, mapped) ? mapped : text;
        }

        const token = this.normalizeBaseModelToken(text);
        if (!token) return text;

        const normalizedEntries = Object.entries(activeMappings)
            .map(([key, value]) => ({
                key,
                token: this.normalizeBaseModelToken(key),
                value
            }))
            .filter(entry => entry.token);
        const exact = normalizedEntries.find(entry => entry.token === token);
        if (exact) {
            return this.isBaseModelPathMappingCompatible(text, exact.value)
                ? exact.value
                : text;
        }

        const partial = normalizedEntries
            .sort((a, b) => b.token.length - a.token.length)
            .find(entry => (
                entry.token.length >= 4 &&
                (token.startsWith(entry.token) || token.includes(entry.token) || entry.token.includes(token))
            ));
        if (!partial) return text;
        return this.isBaseModelPathMappingCompatible(text, partial.value)
            ? partial.value
            : text;
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

    sanitizeDownloadPathSegment(value = '', fallback = '') {
        let text = String(value || '').trim() || fallback;
        text = text
            .replace(/[\\/]+/g, '_')
            .replace(invalidWindowsPathCharacters, '_')
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
        return this.normalizePathToForward(value)
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
        const compatibleCivitaiSearch = this.getCompatibleCivitaiSearchResult?.(missing) || {};
        const merged = {
            ...(missing?.civitai_info || {}),
            ...compatibleCivitaiSearch,
            ...(missing?.download_source || {}),
            ...(searchSuggestion || {}),
            ...sourceData
        };
        const repoId = merged.repo_id || merged.repo || '';
        const filename = merged.downloadFilename
            || merged.filename
            || merged.file_name
            || this.getFilenameFromPath(missing.original_path);
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

    getDownloadMetadata(missing = {}, source = {}, options = {}) {
        const sourceData = source && typeof source === 'object' ? source : {};
        const isProvidedUrl = Boolean(
            sourceData.custom_url
            || sourceData.url_source === 'custom'
            || sourceData.match_type === 'custom_url'
            || sourceData.provided_url
        );
        // A URL explicitly selected by the user is an authoritative provenance
        // boundary. Never fill its hash, provider IDs, or file details from an
        // earlier fuzzy search result belonging to another provider.
        const searchSuggestion = isProvidedUrl ? null : this.getCachedSearchSuggestionData(missing);
        const compatibleCivitaiSearch = isProvidedUrl
            ? {}
            : (this.getCompatibleCivitaiSearchResult?.(missing) || {});
        const inheritedDownloadSource = isProvidedUrl ? {} : (missing?.download_source || {});
        const inheritedCivitaiInfo = isProvidedUrl ? {} : (missing?.civitai_info || {});
        const merged = {
            ...inheritedCivitaiInfo,
            ...compatibleCivitaiSearch,
            ...inheritedDownloadSource,
            ...(searchSuggestion || {}),
            ...sourceData
        };
        const sourceHasIdentity = Boolean(
            sourceData.model_id
            || sourceData.modelId
            || sourceData.version_id
            || sourceData.versionId
            || sourceData.details_source
            || sourceData.source
            || sourceData.sourceKey
        );
        const idSource = sourceHasIdentity ? sourceData : inheritedDownloadSource;
        const selectedVersion = merged.selected_version || merged.selectedVersion || null;
        const pathMetadata = options.pathMetadata || this.getDownloadPathMetadata(missing, sourceData);
        const toList = (value) => {
            if (Array.isArray(value)) return value.filter(item => item !== undefined && item !== null && item !== '');
            if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
            return [];
        };
        const filename = options.filename
            || merged.downloadFilename
            || merged.filename
            || merged.file_name
            || pathMetadata.filename
            || this.getFilenameFromPath(missing.original_path);
        const modelName = merged.model_name
            || merged.model
            || merged.name
            || pathMetadata.model_name
            || filename.replace(/\.[^.]+$/, '')
            || '';
        const versionName = merged.version_name
            || merged.versionName
            || merged.version
            || selectedVersion?.name
            || pathMetadata.version_name
            || '';
        const repoId = merged.repo_id || merged.repo || pathMetadata.repo_id || '';
        const creator = merged.creator
            || pathMetadata.creator
            || (merged.creator_username ? { username: merged.creator_username } : null)
            || (merged.username ? { username: merged.username } : null)
            || null;
        const sourceName = sourceData.details_source
            || sourceData.source
            || sourceData.sourceKey
            || missing?.download_source?.details_source
            || missing?.download_source?.source
            || merged.details_source
            || merged.source
            || '';
        const sourcePageCandidates = [
            options.openUrl,
            sourceData.version_url,
            sourceData.versionUrl,
            sourceData.model_url,
            sourceData.modelUrl,
            sourceData.page_url,
            sourceData.pageUrl,
            sourceData.url,
            merged.model_url,
            merged.page_url,
            merged.version_url,
            merged.url
        ].filter(Boolean);
        let sourcePageUrl = sourcePageCandidates[0] || '';
        const isCivArchiveSource = String(sourceName).toLowerCase().replace(/[-\s]+/g, '_') === 'civarchive';
        if (isCivArchiveSource) {
            const civarchivePageUrl = sourcePageCandidates.find(value => {
                try {
                    const host = new URL(String(value), 'https://civarchive.com').hostname.toLowerCase();
                    return host === 'civarchive.com' || host.endsWith('.civarchive.com');
                } catch {
                    return false;
                }
            });
            const sourceModelId = idSource.model_id || idSource.modelId || '';
            const sourceVersionId = idSource.version_id || idSource.versionId || '';
            sourcePageUrl = civarchivePageUrl || (
                sourceModelId
                    ? `https://civarchive.com/models/${sourceModelId}${sourceVersionId ? `?modelVersionId=${sourceVersionId}` : ''}`
                    : ''
            );
        }
        const metadata = {
            source: sourceName,
            details_source: sourceData.details_source || sourceData.source || sourceName,
            filename,
            category: options.category || merged.category || missing.category || '',
            name: modelName,
            model_name: modelName,
            version_name: versionName,
            model_id: idSource.model_id || idSource.modelId || '',
            version_id: idSource.version_id || idSource.versionId || '',
            type: merged.type || merged.model_type || '',
            model_type: merged.model_type || merged.type || '',
            base_model: merged.base_model || merged.baseModel || pathMetadata.base_model || '',
            tags: toList(merged.tags || pathMetadata.tags),
            trained_words: toList(merged.trained_words || merged.trainedWords || selectedVersion?.trained_words || selectedVersion?.trainedWords),
            images: toList(merged.images || selectedVersion?.images),
            creator,
            author: merged.author || pathMetadata.author || '',
            repo_id: repoId,
            url: sourcePageUrl,
            version_url: isCivArchiveSource ? sourcePageUrl : (sourceData.version_url || sourceData.versionUrl || sourcePageUrl),
            page_url: isCivArchiveSource ? sourcePageUrl : (sourceData.page_url || sourceData.pageUrl || sourcePageUrl),
            model_url: isCivArchiveSource ? sourcePageUrl : (sourceData.model_url || sourceData.modelUrl || sourcePageUrl),
            platform_url: sourceData.platform_url || sourceData.platformUrl || merged.platform_url || merged.platformUrl || '',
            download_url: options.url || merged.download_url || merged.downloadUrl || merged.url || '',
            size: merged.size || merged.size_bytes || '',
            sha256: merged.sha256 || merged.hash || merged.hashes?.SHA256 || merged.hashes?.sha256 || '',
            path_metadata: pathMetadata
        };

        if (merged.hashes && typeof merged.hashes === 'object') metadata.hashes = merged.hashes;
        if (merged.file_info && typeof merged.file_info === 'object') metadata.file_info = merged.file_info;
        if (merged.file && typeof merged.file === 'object') metadata.file = merged.file;
        if (merged.selected_file && typeof merged.selected_file === 'object') metadata.selected_file = merged.selected_file;
        if (merged.selectedFile && typeof merged.selectedFile === 'object') metadata.selected_file = merged.selectedFile;
        if (Array.isArray(merged.files)) metadata.files = merged.files;
        if (selectedVersion && typeof selectedVersion === 'object') metadata.selected_version = selectedVersion;
        if (merged.civitai && typeof merged.civitai === 'object') metadata.civitai = merged.civitai;
        if (merged.metadata_source) metadata.metadata_source = merged.metadata_source;
        if (merged.is_deleted !== undefined) metadata.is_deleted = Boolean(merged.is_deleted);
        if (merged.civitai_deleted !== undefined) metadata.civitai_deleted = Boolean(merged.civitai_deleted);
        if (isProvidedUrl) {
            metadata.custom_url = true;
            metadata.url_source = 'custom';
            metadata.provided_url = sourceData.provided_url
                || sourceData.version_url
                || sourceData.page_url
                || sourceData.url
                || '';
        }

        return metadata;
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
        const baseKey = this.getMissingModelKey?.(missing)
            || `${missing.node_id}:${missing.widget_index}:${missing.subgraph_id || ''}:${missing.is_top_level !== false ? 'T' : 'F'}`;
        const modelIdentity = [
            missing.original_path,
            missing.expected_filename,
            missing.name,
            missing.workflow_url
        ].find(value => value !== undefined && value !== null && String(value).trim());
        if (!modelIdentity) {
            return baseKey;
        }
        const identityKey = encodeURIComponent(String(modelIdentity).trim()).slice(0, 240);
        return `${baseKey}:${identityKey}`;
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

    getSearchSuggestionPreferredBaseModel(missing = {}) {
        const state = this.searchResultCache?.get(this.getMissingSearchKey?.(missing));
        const selectedBaseModel = state?.selectedBaseModel || '';
        const candidates = [];
        const addCandidate = (value) => {
            if (value !== undefined && value !== null && String(value).trim()) {
                candidates.push(value);
            }
        };

        if (selectedBaseModel && selectedBaseModel !== 'auto' && selectedBaseModel !== 'none') {
            addCandidate(selectedBaseModel);
        }
        addCandidate(missing?.download_source?.base_model);
        addCandidate(missing?.download_source?.baseModel);
        addCandidate(missing?.civitai_info?.base_model);
        addCandidate(missing?.civitai_info?.baseModel);
        addCandidate(this.getMissingLocalBaseModel?.(missing, 70));
        const savedTarget = this.getSavedDownloadTargetSelection?.(missing) || {};
        if (savedTarget.subfolderTouched) {
            addCandidate(this.resolveBaseModelAliasFromPath?.(savedTarget.subfolder));
        }
        addCandidate(this.resolveBaseModelAliasFromPath?.(missing?.original_path));
        addCandidate(this.resolveBaseModelAliasFromPath?.(missing?.name));

        for (const candidate of candidates) {
            const canonical = this.resolveBaseModelAlias?.(candidate)
                || this.resolveBaseModelAliasExact?.(candidate)
                || String(candidate || '').trim();
            if (canonical) return canonical;
        }
        return '';
    },

    baseModelMatchesSearchSuggestionPreference(resultBaseModel = '', preferredBaseModel = '') {
        const preferred = String(preferredBaseModel || '').trim();
        const resultValue = String(resultBaseModel || '').trim();
        if (!preferred || !resultValue) return false;

        const normalize = this.normalizeBaseModelToken?.bind(this)
            || ((value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
        const preferredCanonical = this.resolveBaseModelAlias?.(preferred)
            || this.resolveBaseModelAliasExact?.(preferred)
            || preferred;
        const resultCanonical = this.resolveBaseModelAlias?.(resultValue)
            || this.resolveBaseModelAliasExact?.(resultValue)
            || resultValue;
        const preferredToken = normalize(preferredCanonical);
        const resultToken = normalize(resultCanonical);

        return Boolean(preferredToken && resultToken && preferredToken === resultToken);
    },

    getCompatibleCivitaiSearchResult(missing = {}) {
        const result = missing?.civitai_search_result;
        if (!result || typeof result !== 'object') return {};

        const preferredBaseModel = this.getSearchSuggestionPreferredBaseModel(missing);
        const resultBaseModel = result.base_model || result.baseModel || '';
        if (
            preferredBaseModel
            && resultBaseModel
            && !this.baseModelMatchesSearchSuggestionPreference(resultBaseModel, preferredBaseModel)
        ) {
            return {};
        }
        return result;
    },

    getSearchSuggestionResultScore(source = '', result = {}, preferredBaseModel = '') {
        if (!result || typeof result !== 'object') return -Infinity;

        const sourceScores = {
            custom: 110,
            huggingface: 85,
            civitai: 80,
            civarchive: 80,
            model_list: 65,
            popular: 60,
            lora_manager_archive: 45
        };
        let score = sourceScores[source] ?? 40;
        const matchType = String(result.match_type || '').toLowerCase();
        const confidence = Number(result.confidence);
        const baseModel = result.base_model || result.baseModel || '';

        if (result.hash_verified || result.hash_verified_sha256 || matchType === 'hash') {
            score += 140;
        }
        if (matchType === 'exact') {
            score += 120;
        } else if (matchType === 'custom_url') {
            score += 110;
        } else if (matchType === 'model_title') {
            score += 45;
        } else if (matchType === 'similar' || matchType === 'fuzzy' || matchType === 'partial') {
            score += 20;
        }
        if (Number.isFinite(confidence) && confidence > 0) {
            score += Math.min(100, Math.max(0, confidence));
        }
        if (preferredBaseModel && baseModel) {
            score += this.baseModelMatchesSearchSuggestionPreference(baseModel, preferredBaseModel)
                ? 90
                : -90;
        }
        if (result.any_model_match || result.base_model_fallback) {
            score -= 25;
        }
        return score;
    },

    getCachedSearchSuggestionData(missing = {}) {
        const state = this.searchResultCache?.get(this.getMissingSearchKey?.(missing));
        const results = state?.results || {};
        const merged = {};
        const hasObjectValues = (value) => (
            value
            && typeof value === 'object'
            && !Array.isArray(value)
            && Object.keys(value).length > 0
        );
        const hasMergedValue = (key) => {
            const current = merged[key];
            if (current === undefined || current === null || current === '') return false;
            if (Array.isArray(current)) return current.length > 0;
            if (typeof current === 'object') return hasObjectValues(current);
            return true;
        };
        const mergeSuggestionValue = (key, value) => {
            if (value === undefined || value === null || value === '') return;
            if (hasMergedValue(key)) return;
            if (Array.isArray(value)) {
                if (value.length > 0) {
                    merged[key] = value;
                }
                return;
            }
            if (typeof value === 'object') {
                if (hasObjectValues(value)) {
                    merged[key] = value;
                }
                return;
            }
            merged[key] = value;
        };
        const preferredBaseModel = this.getSearchSuggestionPreferredBaseModel(missing);
        const candidates = ['popular', 'model_list', 'huggingface', 'civitai', 'civarchive', 'lora_manager_archive']
            .map((source, index) => ({
                source,
                index,
                result: this.getFirstSearchResult(results[source])
            }))
            .filter(candidate => candidate.result && typeof candidate.result === 'object')
            .filter(candidate => {
                if (!preferredBaseModel) return true;
                const resultBaseModel = candidate.result.base_model || candidate.result.baseModel || '';
                return !resultBaseModel
                    || this.baseModelMatchesSearchSuggestionPreference(resultBaseModel, preferredBaseModel);
            })
            .map(candidate => ({
                ...candidate,
                score: this.getSearchSuggestionResultScore(candidate.source, candidate.result, preferredBaseModel)
            }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.index - b.index;
            });

        for (const { result } of candidates) {
            Object.entries(result).forEach(([key, value]) => {
                mergeSuggestionValue(key, value);
            });
            if (!hasMergedValue('category')) {
                merged.category = this.getSourceResultDownloadCategory(
                    result,
                    missing.category || '',
                    missing
                );
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
        const compatibleCivitaiSearch = this.getCompatibleCivitaiSearchResult?.(missing) || {};
        const civitaiData = {
            ...(missing?.civitai_info || {}),
            ...(searchSuggestion || {}),
            ...compatibleCivitaiSearch,
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
                return {
                    ...match,
                    suggestionSource: 'lora_metadata',
                    matchedBaseModel: baseModel,
                    matchedTag: tag
                };
            }
        }

        return exactBase
            ? {
                ...exactBase,
                suggestionSource: 'lora_metadata',
                matchedBaseModel: baseModel
            }
            : null;
    },

    getSuggestedModelSubfolderCandidates(missing = {}) {
        const source = missing.download_source || {};
        const civitaiInfo = missing.civitai_info || {};
        const civitaiSearch = this.getCompatibleCivitaiSearchResult?.(missing) || {};
        const searchSuggestion = this.getCachedSearchSuggestionData(missing);
        const localMatches = Array.isArray(missing.matches) ? missing.matches : [];
        const bestLocalMatch = this.getBestLocalMatch?.(missing, 70) || localMatches
            .filter(match => (
                match
                && typeof match === 'object'
                && Number(match.confidence) >= 70
            ))
            .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0] || null;
        const bestLocalModel = bestLocalMatch?.model || {};
        const bestLocalPath = bestLocalModel.relative_path
            || bestLocalModel.path
            || bestLocalMatch?.path
            || '';
        const bestLocalFilename = bestLocalModel.filename
            || bestLocalMatch?.filename
            || '';
        const rawValues = [
            bestLocalPath,
            bestLocalFilename,
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
                if (match) {
                    return {
                        ...match,
                        suggestionSource: 'model_name',
                        matchedCandidate: candidate.value || ''
                    };
                }
            }
            return null;
        };

        return findMatch((entry, candidate) => this.normalizeFolderToken(entry.value) === candidate.normalized)
            || findMatch((entry, candidate) => entry.normalizedSegments[0] === candidate.normalized)
            || findMatch((entry, candidate) => entry.normalizedSegments.some(segment => segment === candidate.normalized));
    },

    getTemplateSubfolderSuggestionFromMetadata(missing = {}, category = '') {
        const normalizedCategory = this.normalizeDownloadCategory(category);
        const template = this.getDownloadPathTemplates()[normalizedCategory] || '';
        if (!template) return null;

        const metadata = this.getDownloadPathMetadata(missing, { category: normalizedCategory });
        const tags = Array.isArray(metadata.tags)
            ? metadata.tags.filter(Boolean)
            : String(metadata.tags || '').split(/[,;]+/).map(tag => tag.trim()).filter(Boolean);
        const creator = metadata.creator && typeof metadata.creator === 'object'
            ? (metadata.creator.username || metadata.creator.name || '')
            : (typeof metadata.creator === 'string' ? metadata.creator : '');
        const author = metadata.author
            || creator
            || (metadata.repo_id && String(metadata.repo_id).includes('/') ? String(metadata.repo_id).split('/')[0] : '');
        const modelName = metadata.model_name
            || metadata.name
            || metadata.filename?.replace(/\.[^.]+$/, '')
            || '';
        const versionName = metadata.version_name || metadata.versionName || metadata.version || '';

        const requirements = [
            [template.includes('{base_model}'), Boolean(metadata.base_model || metadata.baseModel)],
            [template.includes('{first_tag}'), tags.length > 0],
            [template.includes('{author}'), Boolean(author)],
            [template.includes('{model_name}'), Boolean(modelName)],
            [template.includes('{version_name}'), Boolean(versionName)]
        ];
        if (requirements.some(([required, available]) => required && !available)) {
            return null;
        }

        const value = this.calculateDownloadPathTemplateSubfolder(normalizedCategory, metadata);
        return value
            ? {
                value,
                label: `${value} (metadata)`,
                baseDirectory: '',
                suggestionSource: 'template',
                template
            }
            : null;
    },

    getSuggestedDownloadCategory(missing = {}, fallbackCategory = 'checkpoints') {
        const searchSuggestion = this.getCachedSearchSuggestionData(missing);
        return this.getSourceResultDownloadCategory(
            searchSuggestion || {},
            this.getMissingDownloadCategory(missing, fallbackCategory || 'checkpoints'),
            missing
        );
    },

    getSuggestedDownloadSubfolder(missing, category, folders = [], options = {}) {
        const mode = this.getDownloadPathMode();
        if (mode === 'manual') {
            return null;
        }

        const folderEntries = this.getFolderSuggestionEntries(folders);
        if (options.preferTemplate) {
            return this.getTemplateSubfolderSuggestionFromMetadata(missing, category)
                || this.getSuggestedLoraSubfolder(missing, category, folderEntries)
                || this.getSuggestedExistingSubfolderByModelName(missing, folderEntries);
        }

        if (mode === 'template') {
            return this.getTemplateSubfolderSuggestionFromMetadata(missing, category)
                || this.getSuggestedLoraSubfolder(missing, category, folderEntries)
                || this.getSuggestedExistingSubfolderByModelName(missing, folderEntries);
        }

        return this.getSuggestedLoraSubfolder(missing, category, folderEntries)
            || this.getSuggestedExistingSubfolderByModelName(missing, folderEntries)
            || this.getTemplateSubfolderSuggestionFromMetadata(missing, category);
    },

    async applySuggestedDownloadSubfolder(missing, categoryEl, subfolderEl, options = {}) {
        if (!this.isAutoFillSubfolderEnabled()) return;
        if (!categoryEl || !subfolderEl) return;
        const saved = this.getSavedDownloadTargetSelection(missing);
        const canRefreshPreviousSuggestion = Boolean(
            options.allowSuggestedRefresh
            && saved?.subfolderTouched
            && saved?.subfolderSuggestionAppliedBy
        );
        if (saved?.subfolderTouched && !canRefreshPreviousSuggestion) return;

        let category = this.normalizeDownloadCategory(this.getDropdownValue(categoryEl));
        const suggestedCategory = this.getSuggestedDownloadCategory(missing, category);
        const preserveSavedCategory = this.shouldPreserveSavedDownloadCategory(missing, saved, category);
        if (suggestedCategory && suggestedCategory !== category && !preserveSavedCategory) {
            category = suggestedCategory;
            this.setDropdownValue(categoryEl, category, this.getCategoryDisplayName(category));
            subfolderEl.value = '';
            subfolderEl.dataset.baseDirectory = '';
            this.saveDownloadTargetSelection(missing, {
                category,
                subfolder: '',
                subfolderBaseDirectory: '',
                categoryTouched: false,
                subfolderTouched: false,
                ...this.getSubfolderSuggestionTrackingPatch(null)
            });
            this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
        }
        await this.ensureDownloadSubfoldersLoaded(category);
        const latestSaved = this.getSavedDownloadTargetSelection(missing);
        const canRefreshLatestSuggestion = Boolean(
            options.allowSuggestedRefresh
            && latestSaved?.subfolderTouched
            && latestSaved?.subfolderSuggestionAppliedBy
        );
        if (latestSaved?.subfolderTouched && !canRefreshLatestSuggestion) return;

        const folders = this.getAvailableSubfolders(category);
        const suggestion = this.getSuggestedDownloadSubfolder(missing, category, folders, {
            preferTemplate: Boolean(options.preferTemplate)
        });
        if (suggestion) {
            subfolderEl.value = suggestion.value || '';
            subfolderEl.dataset.baseDirectory = suggestion.baseDirectory || '';
            this.saveDownloadTargetSelection(missing, {
                category,
                subfolder: suggestion.value || '',
                subfolderBaseDirectory: suggestion.baseDirectory || '',
                subfolderTouched: false,
                ...this.getSubfolderSuggestionTrackingPatch(suggestion, 'auto')
            });
            this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
        }
    },

    async forceSuggestedDownloadSubfolder(missing, categoryEl, subfolderEl) {
        if (!categoryEl || !subfolderEl) return;

        const saved = this.getSavedDownloadTargetSelection(missing);
        const originalCategory = this.normalizeDownloadCategory(this.getDropdownValue(categoryEl));
        let category = originalCategory;
        const suggestedCategory = this.getSuggestedDownloadCategory(missing, category);
        const preserveSavedCategory = this.shouldPreserveSavedDownloadCategory(missing, saved, originalCategory);
        if (suggestedCategory && suggestedCategory !== category && !preserveSavedCategory) {
            category = suggestedCategory;
        }
        await this.ensureDownloadSubfoldersLoaded(category);
        let folders = this.getAvailableSubfolders(category);
        let suggestion = this.getSuggestedDownloadSubfolder(missing, category, folders);

        if (!suggestion && suggestedCategory && suggestedCategory !== category) {
            category = suggestedCategory;
            await this.ensureDownloadSubfoldersLoaded(category);
            folders = this.getAvailableSubfolders(category);
            suggestion = this.getSuggestedDownloadSubfolder(missing, category, folders);
        }

        if (!suggestion) {
            this.showNotification?.('No subfolder suggestion available for this model.', 'info');
            return;
        }

        this.setDropdownValue(categoryEl, category, this.getCategoryDisplayName(category));
        subfolderEl.value = suggestion.value || '';
        subfolderEl.dataset.baseDirectory = suggestion.baseDirectory || '';
        this.saveDownloadTargetSelection(missing, {
            category,
            subfolder: suggestion.value || '',
            subfolderBaseDirectory: suggestion.baseDirectory || '',
            categoryTouched: Boolean(preserveSavedCategory && category === originalCategory),
            subfolderTouched: true,
            ...this.getSubfolderSuggestionTrackingPatch(suggestion, 'button')
        });
        this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
    },

    applySearchResultSuggestion(missing) {
        const categoryEl = this.contentElement?.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = this.contentElement?.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        if (!categoryEl || !subfolderEl) return;
        Promise.resolve(this.applySuggestedDownloadSubfolder(missing, categoryEl, subfolderEl, {
            allowSuggestedRefresh: true,
            preferTemplate: true
        }))
            .then(() => {
                const container = categoryEl.closest?.('.mr-download-target') || this.contentElement;
                this.refreshDownloadTargetHelp(container, missing, categoryEl, subfolderEl);
            })
            .catch(() => {
                const container = categoryEl.closest?.('.mr-download-target') || this.contentElement;
                this.refreshDownloadTargetHelp(container, missing, categoryEl, subfolderEl);
            });
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
            const subfolders = await this.fetchJson(`/model_resolver/subfolders/${encodeURIComponent(key)}`, {}, 'Load subfolders');
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
        const inferredCategory = this.getMissingDownloadCategory(missing, defaultCategory || 'checkpoints');
        const preserveSavedCategory = this.shouldPreserveSavedDownloadCategory(missing, saved, inferredCategory);
        const selectedCategory = this.normalizeDownloadCategory(
            preserveSavedCategory ? (saved.category || inferredCategory) : inferredCategory
        );
        const categoryTooltip = this.getDownloadCategoryTooltip(missing, selectedCategory, {
            saved,
            inferredCategory,
            preserveSavedCategory,
            defaultCategory
        });
        const preserveSavedSubfolder = Boolean(saved?.subfolderTouched);
        const selectedSubfolder = preserveSavedSubfolder ? saved.subfolder || '' : '';
        const selectedSubfolderBaseDirectory = preserveSavedSubfolder ? saved.subfolderBaseDirectory || '' : '';
        const subfolderTooltip = this.getDownloadSubfolderTooltip(missing, selectedCategory, selectedSubfolder, {
            saved,
            defaultCategory,
            baseDirectory: selectedSubfolderBaseDirectory
        });

        let html = `<div class="mr-download-target">`;
        html += `<div class="mr-download-target-grid">`;
        html += `<label class="mr-download-target-label mr-download-target-label-folder" for="${selectId}">Folder <span class="mr-tooltip-badge mr-download-folder-help" data-tooltip="${this.escapeHtml(categoryTooltip)}" tabindex="0">?</span></label>`;
        html += `<label class="mr-download-target-label mr-download-target-label-subfolder" for="${subfolderId}">Subfolder (optional) <span class="mr-tooltip-badge mr-download-subfolder-help" data-tooltip="${this.escapeHtml(subfolderTooltip)}" tabindex="0">?</span></label>`;
        html += `<label class="mr-download-target-label mr-download-target-label-suggest" for="${suggestId}">Suggest</label>`;
        html += `<div class="mr-download-target-wrap mr-download-target-folder-wrap">`;
        html += `<input id="${selectId}" class="mr-download-target-input mr-download-target-select" type="text" autocomplete="off" data-value="${this.escapeHtml(selectedCategory)}" data-default-category="${this.escapeHtml(defaultCategory || 'checkpoints')}" value="${this.escapeHtml(this.getCategoryDisplayName(selectedCategory))}">`;
        html += `<div id="${categoryListId}" class="mr-download-target-list"></div>`;
        html += `</div>`;
        html += `<div class="mr-download-target-wrap mr-download-target-subfolder-wrap">`;
        html += `<input id="${subfolderId}" class="mr-download-target-input" type="text" placeholder="e.g. ponyxl\\styles" autocomplete="off" value="${this.escapeHtml(selectedSubfolder)}" data-base-directory="${this.escapeHtml(selectedSubfolderBaseDirectory)}">`;
        html += `<div id="${subfolderListId}" class="mr-download-target-list"></div>`;
        html += `</div>`;
        html += `<button id="${suggestId}" class="mr-btn mr-btn-secondary mr-btn-sm mr-download-suggest-btn" type="button" data-tooltip="Apply suggested subfolder" aria-label="Apply suggested subfolder">${getSvgIcon('lightbulb', 'currentColor', 'mr-download-suggest-icon')}</button>`;
        html += `</div>`;
        html += `</div>`;
        return html;
    },

    getDownloadTargetSelection(missing, fallbackCategory = 'checkpoints') {
        const categoryEl = this.contentElement?.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = this.contentElement?.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        const category = this.normalizeDownloadCategory(
            this.getDropdownValue(categoryEl)
            || this.getMissingDownloadCategory(missing, fallbackCategory || 'checkpoints')
        );
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

    bindDropdownListPointerGuard(listEl) {
        if (!listEl || listEl.dataset.mlPointerGuardBound === 'true') return;
        listEl.dataset.mlPointerGuardBound = 'true';

        let releaseTimer = null;
        const clearPointerActive = () => {
            if (releaseTimer) {
                window.clearTimeout(releaseTimer);
                releaseTimer = null;
            }
            listEl.dataset.mlPointerActive = 'false';
        };
        const markPointerActive = () => {
            if (releaseTimer) {
                window.clearTimeout(releaseTimer);
                releaseTimer = null;
            }
            listEl.dataset.mlPointerActive = 'true';
        };
        const releasePointerActive = () => {
            if (releaseTimer) {
                window.clearTimeout(releaseTimer);
            }
            releaseTimer = window.setTimeout(() => {
                clearPointerActive();
            }, 250);
        };
        const isPointerInsideList = (event) => (
            event?.target instanceof Node && listEl.contains(event.target)
        ) || this.isPointerEventInsideElementBounds(event, listEl, 24);
        const clearPointerActiveIfOutside = (event) => {
            if (isPointerInsideList(event)) {
                markPointerActive();
                return;
            }
            clearPointerActive();
        };

        window.addEventListener('pointerdown', clearPointerActiveIfOutside, true);
        window.addEventListener('mousedown', clearPointerActiveIfOutside, true);
        listEl.addEventListener('pointerdown', markPointerActive, true);
        listEl.addEventListener('mousedown', markPointerActive, true);
        window.addEventListener('pointerup', releasePointerActive, true);
        window.addEventListener('mouseup', releasePointerActive, true);
        window.addEventListener('blur', clearPointerActive, true);
    },

    isPointerEventInsideElementBounds(event, element, tolerance = 0) {
        if (!event || !element || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') {
            return false;
        }
        const rect = element.getBoundingClientRect();
        return event.clientX >= rect.left - tolerance
            && event.clientX <= rect.right + tolerance
            && event.clientY >= rect.top - tolerance
            && event.clientY <= rect.bottom + tolerance;
    },

    bindDropdownOutsideDismiss(listEl, anchorEls = [], onDismiss = null) {
        if (!listEl || listEl.dataset.mlOutsideDismissBound === 'true') return;
        listEl.dataset.mlOutsideDismissBound = 'true';

        const anchors = Array.isArray(anchorEls)
            ? anchorEls.filter(Boolean)
            : [anchorEls].filter(Boolean);
        const dismiss = () => {
            if (typeof onDismiss === 'function') {
                onDismiss();
            } else {
                this.hideDropdownList(listEl);
            }
        };
        const handleOutsidePointer = (event) => {
            if (listEl.style.display === 'none') return;
            const target = event?.target;
            if (!(target instanceof Node)) return;
            const isInsideList = listEl.contains(target)
                || this.isPointerEventInsideElementBounds(event, listEl, 24);
            const isInsideAnchor = anchors.some(anchor => (
                anchor.contains(target)
                || this.isPointerEventInsideElementBounds(event, anchor)
            ));
            if (isInsideList || isInsideAnchor) {
                return;
            }
            listEl.dataset.mlPointerActive = 'false';
            dismiss();
        };

        window.addEventListener('pointerdown', handleOutsidePointer, true);
        window.addEventListener('mousedown', handleOutsidePointer, true);
    },

    hideDropdownList(listEl) {
        if (!listEl) return;
        if (listEl._mlTreePicker) {
            listEl._mlTreePicker.hide();
        } else {
            listEl.style.display = 'none';
        }
    },

    showDropdownList(listEl, anchorEl = null) {
        if (!listEl) return;
        const anchor = anchorEl
            || listEl.previousElementSibling
            || listEl.parentElement?.querySelector?.('.mr-download-target-input')
            || listEl.parentElement?.querySelector?.('.mr-download-target-select');
        if (!anchor) {
            listEl.style.display = 'block';
            return;
        }

        if (listEl._mlTreePicker) {
            listEl._mlTreePicker.cleanup();
        }

        listEl._mlTreePicker = createFloatingTreePicker({
            listEl,
            anchorEl: anchor,
            duplicateSelector: '.mr-download-target-list[data-ml-floating-portal="true"], .mr-combo-list[data-ml-floating-portal="true"]',
            floatingClass: 'mr-download-target-floating',
            viewportPadding: 12,
            gap: 4,
            setMinWidth: true,
            minPopupWidth: 0,
            maxPopupWidth: 560
        });

        listEl._mlTreePicker.show();
    },

    enableWheelScrollChaining(scrollEl) {
        if (!scrollEl) return;
        this.bindDropdownListPointerGuard(scrollEl);
        if (scrollEl.dataset.mlWheelChainBound === 'true') return;
        scrollEl.dataset.mlWheelChainBound = 'true';

        scrollEl.addEventListener('wheel', (event) => {
            const deltaY = event.deltaY;
            if (!deltaY) {
                return;
            }

            const nestedScrollEl = event.target?.closest?.('.mr-folder-browser-scroll');
            const targetScrollEl = nestedScrollEl && scrollEl.contains(nestedScrollEl)
                ? nestedScrollEl
                : scrollEl;

            const maxScrollTop = Math.max(0, targetScrollEl.scrollHeight - targetScrollEl.clientHeight);
            if (maxScrollTop <= 0) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const nextScrollTop = Math.min(
                maxScrollTop,
                Math.max(0, targetScrollEl.scrollTop + deltaY)
            );

            targetScrollEl.scrollTop = nextScrollTop;
        }, { passive: false });
    },

    wireDownloadTargetAutocomplete(container, missing) {
        const categoryEl = container.querySelector(`#download-category-${missing.node_id}-${missing.widget_index}`);
        const subfolderEl = container.querySelector(`#download-subfolder-${missing.node_id}-${missing.widget_index}`);
        const suggestBtn = container.querySelector(`#download-subfolder-suggest-${missing.node_id}-${missing.widget_index}`);
        const categoryListEl = container.querySelector(`#download-category-list-${missing.node_id}-${missing.widget_index}`);
        const listEl = container.querySelector(`#download-subfolder-list-${missing.node_id}-${missing.widget_index}`)
            || document.getElementById(`download-subfolder-list-${missing.node_id}-${missing.widget_index}`);
        if (!categoryEl || !subfolderEl || !listEl) return;

        const refreshCategoryTooltip = () => {
            this.refreshDownloadTargetHelp(container, missing, categoryEl, subfolderEl);
        };

        this.enableWheelScrollChaining(listEl);
        if (categoryListEl) {
            this.enableWheelScrollChaining(categoryListEl);
        }
        if (listEl.dataset.mlBrowserMouseBound !== 'true') {
            listEl.dataset.mlBrowserMouseBound = 'true';
            listEl.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });
        }
        const subfolderTreePicker = createFloatingTreePicker({
            listEl,
            anchorEl: subfolderEl,
            duplicateSelector: '.mr-download-target-list[data-ml-floating-portal="true"]',
            floatingClass: 'mr-download-target-floating',
            scrollSelector: '.mr-folder-browser-scroll',
            minAvailableWidth: 260,
            minPopupWidth: 420,
            maxPopupWidth: 560,
            openAboveThreshold: 260,
            minAvailableHeight: 0,
            minScrollHeight: 0,
            setMinWidth: true
        });
        const hideFloatingSubfolderList = () => subfolderTreePicker.hide();
        const showFloatingSubfolderList = () => subfolderTreePicker.show();
        this.bindDropdownOutsideDismiss(listEl, [subfolderEl], hideFloatingSubfolderList);

        const renderOptions = (targetEl, values, onSelect, anchorEl = null) => {
            const options = values.map(value => (
                typeof value === 'object'
                    ? value
                    : { value, label: value }
            ));
            if (!options.length) {
                targetEl.innerHTML = '';
                this.hideDropdownList(targetEl);
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

            this.showDropdownList(targetEl, anchorEl);

            targetEl.querySelectorAll('.mr-download-target-option').forEach(option => {
                option.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    const value = decodeURIComponent(option.dataset.value || '');
                    const label = decodeURIComponent(option.dataset.label || option.dataset.value || '');
                    const baseDirectory = decodeURIComponent(option.dataset.baseDirectory || '');
                    onSelect(value, label, baseDirectory);
                    this.hideDropdownList(targetEl);
                });
            });
        };

        const normalizeSubfolderPath = (value = '') => this.normalizePathToBackward(value)
            .split('\\')
            .map(part => part.trim())
            .filter(part => part && part !== '.')
            .join('\\');

        const getFolderBrowserExpandedSet = (category = '') => {
            if (!this.downloadFolderBrowserExpandedGroups) {
                this.downloadFolderBrowserExpandedGroups = new Map();
            }
            const key = this.normalizeDownloadCategory(category || 'unknown');
            if (!this.downloadFolderBrowserExpandedGroups.has(key)) {
                this.downloadFolderBrowserExpandedGroups.set(key, new Set());
            }
            return this.downloadFolderBrowserExpandedGroups.get(key);
        };


        const getFolderBrowserContextAttrs = (category = '', subfolder = '', baseDirectory = '', tooltip = 'Right-click to open this folder') => {
            const context = this.getDownloadTargetFolderContext(category, subfolder, baseDirectory);
            if (!context) return '';
            const menuContext = {
                ...context,
                open_folder_label: 'Open Folder'
            };
            return this.getContextMenuAttrs(menuContext, tooltip);
        };

        const buildFolderTree = (entries = []) => {
            const root = new Map();
            entries.forEach(entry => {
                const value = normalizeSubfolderPath(entry.value);
                if (!value) return;

                const parts = value.split('\\').filter(Boolean);
                let current = root;
                let currentPath = '';
                parts.forEach((part, index) => {
                    currentPath = currentPath ? `${currentPath}\\${part}` : part;
                    if (!current.has(part)) {
                        current.set(part, {
                            name: part,
                            path: currentPath,
                            children: new Map(),
                            entry: null
                        });
                    }
                    const node = current.get(part);
                    if (index === parts.length - 1) {
                        node.entry = entry;
                    }
                    current = node.children;
                });
            });
            return root;
        };

        const countTreeNodes = (nodeMap) => {
            let count = 0;
            nodeMap.forEach(node => {
                count += 1 + countTreeNodes(node.children);
            });
            return count;
        };

        const renderFolderTreeNodes = (
            nodeMap,
            rootGroup,
            category,
            expandedSet,
            filter,
            selectedValue,
            selectedBaseDirectory
        ) => {
            return Array.from(nodeMap.values())
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(node => {
                    const hasChildren = node.children.size > 0;
                    const stateKey = `node:${rootGroup.key}:${node.path.toLowerCase()}`;
                    const childCount = countTreeNodes(node.children);
                    const nodeValue = node.entry?.value || node.path;
                    const nodeBaseDirectory = node.entry?.baseDirectory || rootGroup.baseDirectory || '';
                    const contextAttrs = getFolderBrowserContextAttrs(category, nodeValue, nodeBaseDirectory);
                    const isSelected = normalizeSubfolderPath(nodeValue).toLowerCase() === selectedValue.toLowerCase()
                        && String(nodeBaseDirectory || '') === String(selectedBaseDirectory || '');
                    const shouldExpand = hasChildren && (
                        Boolean(filter)
                        || expandedSet.has(stateKey)
                        || selectedValue.toLowerCase().startsWith(`${node.path.toLowerCase()}\\`)
                    );
                    const toggle = hasChildren
                        ? `<button class="mr-folder-browser-toggle ${shouldExpand ? 'is-expanded' : ''}" type="button" data-browser-action="toggle" data-state-key="${encodeURIComponent(stateKey)}" aria-label="${shouldExpand ? 'Collapse folder' : 'Expand folder'}"><span class="mr-folder-browser-chevron"></span></button>`
                        : `<span class="mr-folder-browser-toggle mr-folder-browser-toggle-empty"></span>`;
                    const children = hasChildren
                        ? `<div class="mr-folder-browser-children ${shouldExpand ? 'is-expanded' : ''}">${renderFolderTreeNodes(node.children, rootGroup, category, expandedSet, filter, selectedValue, selectedBaseDirectory)}</div>`
                        : '';
                    const rowClass = [
                        'mr-folder-browser-row',
                        isSelected ? 'is-selected' : '',
                        hasChildren ? 'is-expandable' : ''
                    ].filter(Boolean).join(' ');
                    const rowStateAttribute = hasChildren
                        ? ` data-state-key="${encodeURIComponent(stateKey)}"`
                        : '';

                    return `
                        <div class="mr-folder-browser-node">
                            <div class="${rowClass}" data-browser-action="select" data-value="${encodeURIComponent(nodeValue)}" data-base-directory="${encodeURIComponent(nodeBaseDirectory)}"${rowStateAttribute}${contextAttrs}>
                                ${toggle}
                                <span class="mr-folder-browser-folder-icon">${getSvgIcon('folderOpen', 'currentColor', 'mr-folder-browser-svg')}</span>
                                <span class="mr-folder-browser-name">${this.escapeHtml(node.name)}</span>
                                ${childCount ? `<span class="mr-folder-browser-count">${childCount}</span>` : ''}
                            </div>
                            ${children}
                        </div>
                    `;
                })
                .join('');
        };

        const renderDownloadFolderBrowser = (targetEl, folders, filterText, onSelect, options = {}) => {
            const previousScrollEl = options.preserveScroll
                ? targetEl.querySelector('.mr-folder-browser-scroll')
                : null;
            const previousScrollTop = previousScrollEl ? previousScrollEl.scrollTop : 0;
            const rawFilter = String(filterText || '').trim();
            const filter = rawFilter.toLowerCase();
            const normalizedFilter = filter.replace(/[\/]+/g, '\\');
            const category = this.getDropdownValue(categoryEl);
            const expandedSet = getFolderBrowserExpandedSet(category);
            const selectedValue = normalizeSubfolderPath(subfolderEl.value || '');
            const selectedBaseDirectory = subfolderEl.dataset.baseDirectory || '';
            const folderEntries = folders.map(folder => ({
                value: normalizeSubfolderPath(this.getSubfolderOptionValue(folder)),
                label: this.getSubfolderOptionLabel(folder),
                baseDirectory: this.getSubfolderOptionBaseDirectory(folder),
                searchText: this.getSubfolderOptionSearchText(folder)
            })).filter(entry => entry.value);
            const filteredEntries = normalizedFilter
                ? folderEntries.filter(entry => (
                    entry.searchText.includes(filter)
                    || entry.value.toLowerCase().includes(normalizedFilter)
                    || entry.label.toLowerCase().includes(filter)
                ))
                : folderEntries;
            const rootGroupsMap = new Map();
            filteredEntries.forEach(entry => {
                const baseDirectory = entry.baseDirectory || '';
                const key = baseDirectory || '__default__';
                if (!rootGroupsMap.has(key)) {
                    rootGroupsMap.set(key, {
                        key,
                        baseDirectory,
                        label: this.getBaseDirectoryLabel(baseDirectory),
                        entries: []
                    });
                }
                rootGroupsMap.get(key).entries.push(entry);
            });
            const rootGroups = Array.from(rootGroupsMap.values())
                .sort((a, b) => a.label.localeCompare(b.label));
            const selectedContext = this.getDownloadTargetFolderContext(
                category,
                selectedValue,
                selectedBaseDirectory
            );
            const previewPath = selectedContext?.download_directory
                || selectedContext?.folder_path
                || selectedValue
                || this.getDownloadTargetBaseDirectory(category)
                || '';
            const rootHtml = rootGroups.map(group => {
                const tree = buildFolderTree(group.entries);
                const stateKey = `root:${group.key}`;
                const isExpanded = Boolean(normalizedFilter)
                    || rootGroups.length === 1
                    || expandedSet.has(stateKey)
                    || (selectedBaseDirectory && selectedBaseDirectory === group.baseDirectory);
                const treeHtml = renderFolderTreeNodes(
                    tree,
                    group,
                    category,
                    expandedSet,
                    normalizedFilter,
                    selectedValue,
                    selectedBaseDirectory
                );
                const rootContextAttrs = getFolderBrowserContextAttrs(category, '', group.baseDirectory);

                return `
                    <div class="mr-folder-browser-root">
                        <button class="mr-folder-browser-root-head ${isExpanded ? 'is-expanded' : ''}" type="button" data-browser-action="toggle" data-state-key="${encodeURIComponent(stateKey)}"${rootContextAttrs}>
                            <span class="mr-folder-browser-chevron"></span>
                            <span class="mr-folder-browser-root-title">${this.escapeHtml(group.label)}</span>
                            <span class="mr-folder-browser-root-count">${group.entries.length}</span>
                        </button>
                        ${group.baseDirectory ? `<div class="mr-folder-browser-root-path">${this.escapeHtml(group.baseDirectory)}</div>` : ''}
                        <div class="mr-folder-browser-tree ${isExpanded ? 'is-expanded' : ''}">${treeHtml}</div>
                    </div>
                `;
            }).join('');
            const typedFolderPath = normalizeSubfolderPath(rawFilter) || rawFilter;
            const emptyHtml = typedFolderPath
                ? `
                    <div class="mr-folder-browser-empty mr-folder-browser-empty-create">
                        <span>No existing folders match this filter.</span>
                        <span>During download, this folder path will be created:</span>
                        <span class="mr-folder-browser-empty-path">${this.escapeHtml(typedFolderPath)}</span>
                    </div>
                `
                : `<div class="mr-folder-browser-empty">No folders match this filter.</div>`;

            targetEl.classList.add('mr-download-folder-browser');
            targetEl.innerHTML = `
                <div class="mr-folder-browser-preview">
                    <span class="mr-folder-browser-preview-label">Target folder path</span>
                    <span class="mr-folder-browser-preview-path">${this.escapeHtml(previewPath)}</span>
                </div>
                <div class="mr-folder-browser-scroll">
                    ${rootHtml || emptyHtml}
                </div>
            `;
            showFloatingSubfolderList();
            if (options.preserveScroll) {
                const restoreScrollPosition = () => {
                    const scrollEl = targetEl.querySelector('.mr-folder-browser-scroll');
                    if (!scrollEl) return;
                    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
                    scrollEl.scrollTop = Math.min(previousScrollTop, maxScrollTop);
                };
                restoreScrollPosition();
                requestAnimationFrame(restoreScrollPosition);
            }

            const toggleFolderBrowserState = (encodedStateKey) => {
                const stateKey = decodeURIComponent(encodedStateKey || '');
                if (!stateKey) return;
                if (expandedSet.has(stateKey)) {
                    expandedSet.delete(stateKey);
                } else {
                    expandedSet.add(stateKey);
                }
                renderDownloadFolderBrowser(targetEl, folders, filterText, onSelect, {
                    preserveScroll: true
                });
            };

            const isFolderBrowserToggleZoneClick = (event, row) => {
                if (!row?.dataset?.stateKey) return false;
                const rowRect = row.getBoundingClientRect();
                const toggleEl = row.querySelector('.mr-folder-browser-toggle:not(.mr-folder-browser-toggle-empty)');
                const folderIconEl = row.querySelector('.mr-folder-browser-folder-icon');
                const toggleRect = toggleEl?.getBoundingClientRect();
                const iconRect = folderIconEl?.getBoundingClientRect();
                const toggleZoneRight = Math.max(
                    toggleRect?.right || rowRect.left,
                    iconRect?.left || rowRect.left
                );
                return event.clientX >= rowRect.left && event.clientX <= toggleZoneRight;
            };

            targetEl.querySelectorAll('[data-browser-action="toggle"]').forEach(button => {
                button.addEventListener('mousedown', (event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    toggleFolderBrowserState(button.dataset.stateKey || '');
                });
            });

            targetEl.querySelectorAll('[data-browser-action="select"]').forEach(row => {
                row.addEventListener('mousedown', (event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (isFolderBrowserToggleZoneClick(event, row)) {
                        toggleFolderBrowserState(row.dataset.stateKey || '');
                        return;
                    }
                    const value = decodeURIComponent(row.dataset.value || '');
                    const baseDirectory = decodeURIComponent(row.dataset.baseDirectory || '');
                    onSelect(value, '', baseDirectory);
                    hideFloatingSubfolderList();
                });
            });
        };

        const populateCategoryOptions = (filterText = '') => {
            if (!categoryListEl) return;
            const filter = String(filterText || '').trim().toLowerCase();
            const normalizedFilter = filter.replace(/[^a-z0-9]+/g, '');
            const options = this.getDownloadCategoryOptions(this.getDropdownValue(categoryEl) || 'checkpoints')
                .map(category => ({
                    value: category,
                    label: this.getCategoryDisplayName(category)
                }))
                .filter(option => {
                    if (!filter) return true;
                    const searchText = `${option.value} ${option.label}`.toLowerCase();
                    const normalizedSearchText = searchText.replace(/[^a-z0-9]+/g, '');
                    return searchText.includes(filter)
                        || (normalizedFilter && normalizedSearchText.includes(normalizedFilter));
                });
            renderOptions(categoryListEl, options, (value, label) => {
                this.setDropdownValue(categoryEl, value, label);
                subfolderEl.value = '';
                this.saveDownloadTargetSelection(missing, {
                    category: value,
                    subfolder: '',
                    subfolderBaseDirectory: '',
                    categoryTouched: true,
                    subfolderTouched: false,
                    ...this.getSubfolderSuggestionTrackingPatch(null)
                });
                subfolderEl.dataset.baseDirectory = '';
                listEl.innerHTML = '';
                hideFloatingSubfolderList();
                this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
                refreshCategoryTooltip();
                Promise.resolve(this.applySuggestedDownloadSubfolder(missing, categoryEl, subfolderEl))
                    .then(refreshCategoryTooltip)
                    .catch(() => refreshCategoryTooltip());
                categoryEl.dispatchEvent(new CustomEvent('mr-download-category-change', {
                    bubbles: true,
                    detail: { category: value }
                }));
            }, categoryEl);
        };

        const populateSubfolderOptions = async (filterText = '') => {
            const category = this.getDropdownValue(categoryEl);
            await this.ensureDownloadSubfoldersLoaded(category);
            const folders = this.getAvailableSubfolders(category);

            renderDownloadFolderBrowser(listEl, folders, filterText, (value, _label, baseDirectory) => {
                subfolderEl.value = value;
                subfolderEl.dataset.baseDirectory = baseDirectory || '';
                this.saveDownloadTargetSelection(missing, {
                    category: this.getDropdownValue(categoryEl),
                    subfolder: value,
                    subfolderBaseDirectory: baseDirectory || '',
                    subfolderTouched: true,
                    ...this.getSubfolderSuggestionTrackingPatch(null)
                });
                this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
                refreshCategoryTooltip();
            });
        };

        if (categoryListEl && categoryEl.dataset.mlCategoryBound !== 'true') {
            categoryEl.dataset.mlCategoryBound = 'true';
            categoryEl.addEventListener('focus', () => populateCategoryOptions(''));
            categoryEl.addEventListener('click', () => populateCategoryOptions(''));
            categoryEl.addEventListener('input', () => {
                const typed = categoryEl.value.trim();
                const category = typed ? this.normalizeDownloadCategory(typed) : '';
                const previousCategory = this.getDropdownValue(categoryEl);
                categoryEl.dataset.value = category;
                if (category !== previousCategory) {
                    subfolderEl.value = '';
                    subfolderEl.dataset.baseDirectory = '';
                    listEl.innerHTML = '';
                    hideFloatingSubfolderList();
                }
                this.saveDownloadTargetSelection(missing, {
                    category,
                    subfolder: subfolderEl.value || '',
                    subfolderBaseDirectory: subfolderEl.dataset.baseDirectory || '',
                    categoryTouched: true,
                    subfolderTouched: Boolean(subfolderEl.value),
                    ...this.getSubfolderSuggestionTrackingPatch(null)
                });
                this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
                refreshCategoryTooltip();
                if (category !== previousCategory) {
                    categoryEl.dispatchEvent(new CustomEvent('mr-download-category-change', {
                        bubbles: true,
                        detail: { category }
                    }));
                }
                populateCategoryOptions(typed);
            });
            categoryEl.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    populateCategoryOptions(categoryEl.value);
                }
            });
            const normalizeCategoryInput = () => {
                const category = this.getDropdownValue(categoryEl);
                const knownCategories = this.getKnownDownloadCategorySet();
                if (category && knownCategories.has(this.normalizeDownloadCategory(category))) {
                    this.setDropdownValue(categoryEl, category, this.getCategoryDisplayName(category));
                }
                refreshCategoryTooltip();
            };
            this.bindDropdownOutsideDismiss(categoryListEl, [categoryEl], () => {
                normalizeCategoryInput();
                this.hideDropdownList(categoryListEl);
            });
            categoryEl.addEventListener('blur', () => {
                normalizeCategoryInput();
            });
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
                subfolderTouched: true,
                ...this.getSubfolderSuggestionTrackingPatch(null)
            });
            this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
            refreshCategoryTooltip();
            populateSubfolderOptions(subfolderEl.value);
        });

        if (suggestBtn && suggestBtn.dataset.mlSuggestBound !== 'true') {
            suggestBtn.dataset.mlSuggestBound = 'true';
            suggestBtn.addEventListener('click', async () => {
                const suggestAnimationMs = 700;
                suggestBtn.classList.remove('mr-is-suggesting');
                void suggestBtn.offsetWidth;
                suggestBtn.classList.add('mr-is-suggesting');
                suggestBtn.disabled = true;
                const animationDone = new Promise((resolve) => window.setTimeout(resolve, suggestAnimationMs));
                try {
                    await this.forceSuggestedDownloadSubfolder(missing, categoryEl, subfolderEl);
                    refreshCategoryTooltip();
                    listEl.innerHTML = '';
                    hideFloatingSubfolderList();
                } finally {
                    await animationDone;
                    suggestBtn.classList.remove('mr-is-suggesting');
                    suggestBtn.disabled = false;
                }
            });
        }

        this.syncDownloadTargetFolderContext(categoryEl, subfolderEl);
        Promise.resolve(this.applySuggestedDownloadSubfolder(missing, categoryEl, subfolderEl))
            .then(refreshCategoryTooltip)
            .catch(() => refreshCategoryTooltip());
    },

    clearFrontendSearchCaches() {
        for (const state of this.searchResultCache.values()) {
            state.activeSearchRunId = null;
        }
        this.clearAllSearchProgressTimers();
        for (const job of this.backgroundSearchJobs?.values?.() || []) {
            for (const progressId of job.sourceProgressIds?.values?.() || []) {
                this.cancelBackendSearchProgress?.(progressId);
            }
            for (const controller of job.sourceControllers?.values?.() || []) {
                try {
                    controller.abort();
                } catch (error) { /* ignore abort cleanup failures */ }
            }
        }
        this.backgroundSearchJobs?.clear();
        this.searchResultCache.clear();
        this.workflowSearchResultCaches.clear();
        this.urnResolvePromises.clear();
        this.urnLocalMatchPromises.clear();
    },

    async clearBackendSearchCaches({ throwOnError = false } = {}) {
        try {
            await this.fetchJson('/model_resolver/clear-search-cache', {
                method: 'POST'
            }, 'Clear search cache');
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
        this._loadedModelsProgressToken = null;

        await this.ensureCapabilitiesLoaded();
        await this.ensureBaseModelsLoaded();
        this.refreshMissingListStats?.();
        this.updateBatchFooterButtons?.();
        this.updateDownloadAllButtonState?.();

        await this.clearBackendSearchCaches({ throwOnError: true });
    }
};
