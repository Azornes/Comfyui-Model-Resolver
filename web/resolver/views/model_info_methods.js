import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
import { sanitizeDescriptionHtml } from "../utils/html_utils.js";
import { getModelCardUrl } from "../utils/url_utils.js";
import { getCivitaiModelUrl } from "../globals.js";
export const modelInfoMethods = {
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
    },

    /**
     * Show context menu at the specified position
     */
    showContextMenu(x, y, model) {
        if (!this.contextMenu) return;

        this._contextMenuModel = model;
        const canShowMore = this.canShowSourceDetails(model);
        const sourceLink = this.getContextMenuSourceLink(this.getContextMenuSourceLookupModel(model));
        const showSourceLink = Boolean(sourceLink?.url);
        const isDownloadTableContext = model?.context_scope === 'download_table';
        const isDownloadFolderContext = model?.context_scope === 'download_folder';
        const isDownloadRootContext = model?.context_scope === 'download_root';
        const isDownloadQueueContext = model?.context_scope === 'download_queue';
        const isDownloadHistoryContext = model?.context_scope === 'download_history';
        const isLocalModelContext = model?.context_scope === 'local_model' || model?.context_scope === 'local_match';
        const isFolderOnlyContext = isDownloadFolderContext || isDownloadRootContext;
        const isSourceModelContext = !isDownloadTableContext && !isFolderOnlyContext && !isDownloadQueueContext && !isDownloadHistoryContext;
        const hasLocalPath = Boolean(model?.open_path || model?.folder_path || model?.download_directory || model?.directory || model?.path || model?.resolved_path);
        const showOpenFolder = !isDownloadTableContext && hasLocalPath;
        const showCompareHashes = (isLocalModelContext || isDownloadFolderContext)
            && hasLocalPath
            && Boolean(model?.missing_key || model?.missing_search_key);
        const showSwitchWorkflow = (isDownloadQueueContext || isDownloadHistoryContext) && Boolean(this.canSwitchToDownloadWorkflow?.(model));
        this.setContextMenuItemVisible('showInfo', isSourceModelContext);
        this.setContextMenuItemVisible('showMore', canShowMore);
        this.setContextMenuItemVisible('source', showSourceLink);
        this.setContextMenuItemVisible('civitai', false);
        this.setContextMenuItemVisible('switchWorkflow', showSwitchWorkflow);
        this.setContextMenuItemVisible('compareHashes', showCompareHashes);
        this.setContextMenuItemVisible('openFolder', showOpenFolder);
        this.setContextMenuDividerVisible('source', showSourceLink && (isSourceModelContext || canShowMore));
        this.setContextMenuDividerVisible('workflow', showSwitchWorkflow && (isSourceModelContext || canShowMore || showSourceLink));
        this.setContextMenuDividerVisible('folder', (showCompareHashes || showOpenFolder) && (isSourceModelContext || canShowMore || showSourceLink || showSwitchWorkflow));
        this.updateContextMenuSourceItem(sourceLink);

        const openFolderLabel = this.contextMenu.querySelector('.mr-context-menu-action-open-folder span:last-child');
        if (openFolderLabel) {
            openFolderLabel.textContent = model?.open_folder_label
                || (isDownloadRootContext ? 'Open Root Folder' : isDownloadFolderContext ? 'Open Download Folder' : 'Open Containing Folder');
        }

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

        this.refreshContextMenuSourceLink(model);
    },

    /**
     * Hide context menu
     */
    hideContextMenu() {
        if (!this.contextMenu) return;
        this.contextMenu.style.display = 'none';
        this._contextMenuModel = null;
    },

    /**
     * Handle context menu item click
     */
    handleContextMenuAction(action) {
        const model = this._contextMenuModel;
        this.hideContextMenu();

        if (!model) return;

        if (action === 'source' || action === 'civitai') {
            this.openModelSourceLink(model);
        } else if (action === 'openFolder') {
            this.openContainingFolder(model);
        } else if (action === 'compareHashes') {
            this.compareLocalModelHashesWithCurrentFinding(model);
        } else if (action === 'switchWorkflow') {
            this.switchToDownloadWorkflow(model);
        } else if (action === 'showInfo') {
            this.showModelInfo(model);
        } else if (action === 'showMore') {
            this.showSourceModelDetails(model);
        }
    },

    setContextMenuItemVisible(action, visible) {
        if (!this.contextMenu) return;
        const className = `mr-context-menu-action-${String(action).replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`;
        this.contextMenu.querySelectorAll(`[data-menu-action="${action}"], .${className}`).forEach(item => {
            item.hidden = !visible;
            item.classList.toggle('mr-context-menu-hidden', !visible);
            if (visible) {
                item.style.removeProperty('display');
            } else {
                item.style.setProperty('display', 'none', 'important');
            }
        });
    },

    setContextMenuDividerVisible(name, visible) {
        if (!this.contextMenu) return;
        this.contextMenu.querySelectorAll(`[data-menu-divider="${name}"], .mr-context-menu-divider-${name}`).forEach(item => {
            item.hidden = !visible;
            item.classList.toggle('mr-context-menu-hidden', !visible);
            if (visible) {
                item.style.removeProperty('display');
            } else {
                item.style.setProperty('display', 'none', 'important');
            }
        });
    },

    clampContextMenuToViewport() {
        if (!this.contextMenu || this.contextMenu.style.display === 'none') return;
        const rect = this.contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.contextMenu.style.left = `${Math.max(10, window.innerWidth - rect.width - 10)}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.contextMenu.style.top = `${Math.max(10, window.innerHeight - rect.height - 10)}px`;
        }
    },

    getContextMenuSourceConfig(key = '') {
        const normalized = String(key || '').toLowerCase().replace(/[-\s]+/g, '_');
        const configs = {
            civitai: { key: 'civitai', label: 'CivitAI', icon: 'civitai' },
            civarchive: { key: 'civarchive', label: 'CivArchive', icon: 'civarchive' },
            huggingface: { key: 'huggingface', label: 'HuggingFace', icon: 'huggingface' },
            lora_manager_archive: { key: 'lora_manager_archive', label: 'LoRA Archive', icon: 'loraManager' }
        };
        return configs[normalized] || { key: normalized || 'source', label: 'Source', icon: 'externalLink' };
    },

    getContextMenuSourceKeyFromText(value = '') {
        const text = String(value || '').toLowerCase();
        if (!text) return '';
        if (text.includes('huggingface') || text.includes('hugging face')) return 'huggingface';
        if (text.includes('civarchive') || text.includes('civ archive')) return 'civarchive';
        if (text.includes('civitai') || text.includes('civitai.red')) return 'civitai';
        if (text.includes('lora_manager_archive') || text.includes('lora archive')) return 'lora_manager_archive';
        return '';
    },

    getContextMenuSourceKeyFromUrl(value = '') {
        const url = String(value || '').trim();
        if (!url) return '';

        try {
            const parsed = new URL(url, window.location.origin);
            const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
            if (host === 'huggingface.co' || host.endsWith('.huggingface.co')) return 'huggingface';
            if (host === 'civarchive.com' || host.endsWith('.civarchive.com')) return 'civarchive';
            if (host === 'civitai.com' || host.endsWith('.civitai.com') || host === 'civitai.red' || host.endsWith('.civitai.red')) return 'civitai';
        } catch (error) {
            return this.getContextMenuSourceKeyFromText(url);
        }

        return this.getContextMenuSourceKeyFromText(url);
    },

    getContextMenuSourceKey(model = {}) {
        return this.getContextMenuSourceKeyFromText(model?.details_source)
            || this.getContextMenuSourceKeyFromText(model?.source)
            || this.getContextMenuSourceKeyFromText(model?.source_name)
            || this.getContextMenuSourceKeyFromText(model?.sourceName)
            || this.getContextMenuSourceKeyFromText(model?.metadata_source)
            || this.getContextMenuSourceKeyFromText(model?.metadataSource)
            || '';
    },

    getContextMenuSourceUrlCandidates(model = {}) {
        const candidates = [];
        const seen = new Set();
        const add = (value) => {
            const url = String(value || '').trim();
            if (!url || seen.has(url)) return;
            seen.add(url);
            candidates.push(url);
        };
        const addFrom = (value) => {
            if (!value || typeof value !== 'object') return;
            [
                'version_url',
                'versionUrl',
                'model_url',
                'modelUrl',
                'workflow_model_url',
                'workflowModelUrl',
                'platform_url',
                'platformUrl',
                'source_url',
                'sourceUrl',
                'page_url',
                'pageUrl',
                'html_url',
                'htmlUrl',
                'github_url',
                'githubUrl',
                'civitai_url',
                'civitaiUrl',
                'creator_url',
                'creatorUrl',
                'openUrl',
                'url'
            ].forEach(key => add(value[key]));
        };

        addFrom(model);
        [
            model?.metadata,
            model?.path_metadata || model?.pathMetadata,
            model?.download_metadata || model?.downloadMetadata,
            model?.selected_version || model?.selectedVersion,
            model?.civitai_details || model?.civitaiDetails,
            model?.version,
            model?.civitai,
            model?.civarchive,
            model?.huggingface
        ].forEach(addFrom);

        const repoId = model?.repo_id || model?.repo || model?.repository || '';
        if (repoId) {
            add(`https://huggingface.co/${repoId}`);
        }

        return candidates;
    },

    normalizeContextMenuSourceUrl(value = '', sourceKey = '') {
        const url = String(value || '').trim();
        if (!url) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (!url.startsWith('/')) return '';

        if (sourceKey === 'civarchive') return `https://civarchive.com${url}`;
        if (sourceKey === 'civitai') return `https://civitai.com${url}`;
        if (sourceKey === 'huggingface') return `https://huggingface.co${url}`;
        return '';
    },

    buildContextMenuSourceUrlFromIds(model = {}, sourceKey = '') {
        const modelId = model?.model_id || model?.modelId || model?.civitai_model_id || model?.civitaiModelId || model?.id || '';
        const versionId = model?.version_id || model?.versionId || model?.modelVersionId || model?.civitai_model_version_id || model?.civitaiModelVersionId || '';
        if (sourceKey === 'civitai' && modelId) {
            return getCivitaiModelUrl(modelId, versionId);
        }
        if (sourceKey === 'civarchive' && modelId) {
            return `https://civarchive.com/models/${modelId}${versionId ? `?modelVersionId=${versionId}` : ''}`;
        }

        const repoId = model?.repo_id || model?.repo || model?.repository || '';
        if (sourceKey === 'huggingface' && repoId) {
            return `https://huggingface.co/${repoId}`;
        }

        return '';
    },

    getContextMenuSourceLink(model = {}) {
        const fallbackKey = this.getContextMenuSourceKey(model);
        const candidates = this.getContextMenuSourceUrlCandidates(model);

        for (const candidate of candidates) {
            const candidateKey = this.getContextMenuSourceKeyFromUrl(candidate) || fallbackKey;
            const normalizedUrl = this.normalizeContextMenuSourceUrl(candidate, candidateKey);
            if (!normalizedUrl) continue;

            const cardUrl = getModelCardUrl(normalizedUrl) || normalizedUrl;
            const sourceKey = this.getContextMenuSourceKeyFromUrl(cardUrl)
                || this.getContextMenuSourceKeyFromUrl(normalizedUrl)
                || candidateKey;
            const config = this.getContextMenuSourceConfig(sourceKey);
            return {
                ...config,
                url: cardUrl
            };
        }

        const builtUrl = this.buildContextMenuSourceUrlFromIds(model, fallbackKey);
        if (builtUrl) {
            const config = this.getContextMenuSourceConfig(fallbackKey);
            return {
                ...config,
                url: builtUrl
            };
        }

        return null;
    },

    getContextMenuSourceLookupPath(model = {}) {
        return model?.open_path
            || model?.resolved_path
            || model?.file_path
            || model?.full_path
            || model?.path
            || '';
    },

    getContextMenuSourceLookupKey(model = {}) {
        const path = String(this.getContextMenuSourceLookupPath(model) || '').trim();
        return path ? this.normalizePathToForward(path).toLowerCase() : '';
    },

    getContextMenuSourceLookupModel(model = {}) {
        const key = this.getContextMenuSourceLookupKey(model);
        const cached = key && this._contextMenuSourceLookupCache instanceof Map
            ? this._contextMenuSourceLookupCache.get(key)
            : null;
        const data = cached?.data && typeof cached.data === 'object' ? cached.data : null;
        if (!data) return model;

        const merged = { ...model, metadata: data };
        Object.entries(data).forEach(([field, value]) => {
            if (value === undefined || value === null || value === '') return;
            merged[field] = value;
        });
        return merged;
    },

    rememberContextMenuSourceMetadata(data = {}) {
        if (!data || typeof data !== 'object') return;

        const paths = [
            data.open_path,
            data.openPath,
            data.resolved_path,
            data.resolvedPath,
            data.file_path,
            data.filePath,
            data.full_path,
            data.fullPath,
            data.path
        ].map(value => String(value || '').trim()).filter(Boolean);
        const keys = [...new Set(paths.map(path => this.getContextMenuSourceLookupKey({ path })).filter(Boolean))];
        if (!keys.length) return;

        if (!(this._contextMenuSourceLookupCache instanceof Map)) {
            this._contextMenuSourceLookupCache = new Map();
        }

        keys.forEach(key => {
            const existing = this._contextMenuSourceLookupCache.get(key)?.data || {};
            const merged = { ...(existing && typeof existing === 'object' ? existing : {}), ...data };
            this._contextMenuSourceLookupCache.set(key, { data: merged });
        });

        if (this.contextMenu?.style.display !== 'none' && this._contextMenuModel) {
            const activeKey = this.getContextMenuSourceLookupKey(this._contextMenuModel);
            if (keys.includes(activeKey)) {
                const sourceLink = this.getContextMenuSourceLink(this.getContextMenuSourceLookupModel(this._contextMenuModel));
                this.applyContextMenuSourceLink(this._contextMenuModel, sourceLink);
            }
        }
    },

    getContextMenuSourceLookupFilename(model = {}) {
        return model?.filename
            || model?.name
            || model?.original_path?.split(/[\/\\]/).pop()
            || String(this.getContextMenuSourceLookupPath(model) || '').split(/[\/\\]/).pop()
            || '';
    },

    canLookupContextMenuSourceMetadata(model = {}, sourceLink = null) {
        if (sourceLink?.url) return false;
        if (!this.getContextMenuSourceLookupPath(model)) return false;

        const scope = String(model?.context_scope || '').toLowerCase();
        return [
            'local_model',
            'local_match',
            'download_folder',
            'download_queue',
            'download_history',
            ''
        ].includes(scope);
    },

    applyContextMenuSourceLink(model = {}, sourceLink = null) {
        if (!this.contextMenu) return;

        const canShowMore = this.canShowSourceDetails(model);
        const isDownloadTableContext = model?.context_scope === 'download_table';
        const isDownloadFolderContext = model?.context_scope === 'download_folder';
        const isDownloadRootContext = model?.context_scope === 'download_root';
        const isDownloadQueueContext = model?.context_scope === 'download_queue';
        const isDownloadHistoryContext = model?.context_scope === 'download_history';
        const isFolderOnlyContext = isDownloadFolderContext || isDownloadRootContext;
        const isSourceModelContext = !isDownloadTableContext && !isFolderOnlyContext && !isDownloadQueueContext && !isDownloadHistoryContext;
        const hasLocalPath = Boolean(model?.open_path || model?.folder_path || model?.download_directory || model?.directory || model?.path || model?.resolved_path);
        const showOpenFolder = !isDownloadTableContext && hasLocalPath;
        const showCompareHashes = (model?.context_scope === 'local_model' || model?.context_scope === 'local_match' || isDownloadFolderContext)
            && hasLocalPath
            && Boolean(model?.missing_key || model?.missing_search_key);
        const showSwitchWorkflow = (isDownloadQueueContext || isDownloadHistoryContext) && Boolean(this.canSwitchToDownloadWorkflow?.(model));
        const showSourceLink = Boolean(sourceLink?.url);

        this.setContextMenuItemVisible('source', showSourceLink);
        this.setContextMenuItemVisible('civitai', false);
        this.setContextMenuDividerVisible('source', showSourceLink && (isSourceModelContext || canShowMore));
        this.setContextMenuDividerVisible('workflow', showSwitchWorkflow && (isSourceModelContext || canShowMore || showSourceLink));
        this.setContextMenuDividerVisible('folder', (showCompareHashes || showOpenFolder) && (isSourceModelContext || canShowMore || showSourceLink || showSwitchWorkflow));
        this.updateContextMenuSourceItem(sourceLink);
        this.clampContextMenuToViewport();
    },

    async refreshContextMenuSourceLink(model = {}) {
        const initialSourceLink = this.getContextMenuSourceLink(this.getContextMenuSourceLookupModel(model));
        if (!this.canLookupContextMenuSourceMetadata(model, initialSourceLink)) return;

        const key = this.getContextMenuSourceLookupKey(model);
        const filename = this.getContextMenuSourceLookupFilename(model);
        const path = this.getContextMenuSourceLookupPath(model);
        if (!key || !filename || !path) return;

        if (!(this._contextMenuSourceLookupCache instanceof Map)) {
            this._contextMenuSourceLookupCache = new Map();
        }

        const token = ++this._contextMenuSourceLookupToken;
        let cached = this._contextMenuSourceLookupCache.get(key);
        try {
            if (!cached?.promise && !cached?.data) {
                const promise = this.fetchJson('/model_resolver/civitai-search', {
                    method: 'POST',
                    silent: true,
                    body: JSON.stringify({
                        filename,
                        category: model.category || '',
                        resolved_path: path,
                        local_only: true
                    })
                }, 'Read local source metadata');
                cached = { promise };
                this._contextMenuSourceLookupCache.set(key, cached);
                const data = await promise;
                cached = { data };
                this._contextMenuSourceLookupCache.set(key, cached);
            } else if (cached.promise) {
                const data = await cached.promise;
                cached = { data };
                this._contextMenuSourceLookupCache.set(key, cached);
            }
        } catch (error) {
            this._contextMenuSourceLookupCache.set(key, { data: null, error });
            return;
        }

        if (token !== this._contextMenuSourceLookupToken) return;
        if (this.contextMenu?.style.display === 'none') return;
        if (this.getContextMenuSourceLookupKey(this._contextMenuModel || {}) !== key) return;

        const refreshedModel = this.getContextMenuSourceLookupModel(model);
        const sourceLink = this.getContextMenuSourceLink(refreshedModel);
        this.applyContextMenuSourceLink(model, sourceLink);
    },

    updateContextMenuSourceItem(sourceLink = null) {
        if (!this.contextMenu) return;
        const sourceItem = this.contextMenu.querySelector('.mr-context-menu-action-source, [data-menu-action="source"]');
        if (!sourceItem) return;

        const iconEl = sourceItem.querySelector('.mr-context-menu-item-icon');
        const labelEl = sourceItem.querySelector('span:last-child');
        const config = sourceLink || this.getContextMenuSourceConfig('');
        if (iconEl) {
            iconEl.innerHTML = getSvgIcon(config.icon || 'externalLink', 'currentColor', 'mr-context-menu-item-svg')
                || getSvgIcon('externalLink', 'currentColor', 'mr-context-menu-item-svg');
        }
        if (labelEl) {
            labelEl.textContent = sourceLink?.label
                ? `Open in ${sourceLink.label}`
                : 'Open Source';
        }
    },

    canShowSourceDetails(model = {}) {
        const source = String(model.details_source || model.source || '').toLowerCase();
        return model?.context_scope === 'download_table'
            && ['civitai', 'civarchive', 'lora_manager_archive'].includes(source)
            && Boolean(model.model_id || model.modelId);
    },

    getMissingByKey(key = '') {
        if (!key) return null;
        return (this.missingModels || []).find(missing => this.getMissingModelKey?.(missing) === key) || null;
    },

    getMissingForHashCompareContext(model = {}) {
        const missingKey = String(model?.missing_key || '').trim();
        if (missingKey) {
            const byMissingKey = this.getMissingByKey(missingKey);
            if (byMissingKey) return byMissingKey;
        }

        const searchKey = String(model?.missing_search_key || '').trim();
        if (searchKey && typeof this.getMissingSearchKey === 'function') {
            return (this.missingModels || []).find(missing => this.getMissingSearchKey(missing) === searchKey) || null;
        }

        return null;
    },

    normalizeSha256ForCompare(value = '') {
        let text = String(value || '').trim();
        text = text.replace(/^sha256[:=]/i, '').trim().toLowerCase();
        return /^[a-f0-9]{64}$/.test(text) ? text : '';
    },

    formatSha256Short(value = '') {
        const hash = this.normalizeSha256ForCompare(value) || String(value || '').trim();
        if (hash.length <= 18) return hash;
        return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
    },

    collectHashCandidatesForCompare(value, source = 'metadata', seen = new Set(), depth = 0) {
        const candidates = [];
        if (value === undefined || value === null || depth > 5) return candidates;

        const addHash = (rawValue, hashSource = source) => {
            const hash = this.normalizeSha256ForCompare(rawValue);
            if (!hash || seen.has(hash)) return;
            seen.add(hash);
            candidates.push({ hash, source: hashSource || source || 'metadata' });
        };

        if (typeof value === 'string' || typeof value === 'number') {
            addHash(value);
            return candidates;
        }

        if (Array.isArray(value)) {
            value.forEach(item => {
                candidates.push(...this.collectHashCandidatesForCompare(item, source, seen, depth + 1));
            });
            return candidates;
        }

        if (typeof value !== 'object') return candidates;

        [
            ['local_match_sha256', 'local match'],
            ['sha256', source],
            ['hash', source],
            ['SHA256', source],
            ['file_hash', source],
            ['fileHash', source]
        ].forEach(([key, label]) => addHash(value[key], label));

        const hashes = value.hashes;
        if (Array.isArray(hashes)) {
            candidates.push(...this.collectHashCandidatesForCompare(hashes, source, seen, depth + 1));
        } else if (hashes && typeof hashes === 'object') {
            ['SHA256', 'sha256', 'hash'].forEach(key => addHash(hashes[key], source));
        }

        [
            ['file_info', value.file_info],
            ['file', value.file],
            ['selected_file', value.selected_file],
            ['path_metadata', value.path_metadata],
            ['download_metadata', value.download_metadata],
            ['metadata', value.metadata],
            ['selected_version', value.selected_version || value.selectedVersion],
            ['version', value.version],
            ['civitai', value.civitai]
        ].forEach(([key, nestedValue]) => {
            if (nestedValue !== undefined && nestedValue !== null) {
                candidates.push(...this.collectHashCandidatesForCompare(nestedValue, `${source} ${key}`, seen, depth + 1));
            }
        });

        ['files', 'mirrors', 'download_files', 'downloadFiles', 'modelVersions', 'versions'].forEach(key => {
            if (Array.isArray(value[key])) {
                candidates.push(...this.collectHashCandidatesForCompare(value[key], `${source} ${key}`, seen, depth + 1));
            }
        });

        return candidates;
    },

    getLocalHashCandidatesForCompare(model = {}) {
        const seen = new Set();
        return this.collectHashCandidatesForCompare(model, 'local model metadata', seen);
    },

    getLocalHashComparePath(model = {}) {
        return model?.open_path
            || model?.resolved_path
            || model?.path
            || model?.file_path
            || '';
    },

    async fetchLocalHashCandidatesForCompare(model = {}) {
        const path = this.getLocalHashComparePath(model);
        if (!path) {
            return { candidates: [], data: null };
        }

        const data = await this.fetchJson('/model_resolver/local-model-hashes', {
            method: 'POST',
            silent: true,
            body: JSON.stringify({ path, model })
        }, 'Read local model hash metadata');

        return {
            data,
            candidates: this.collectHashCandidatesForCompare(data, 'local metadata', new Set())
        };
    },

    getHashCompareFilename(model = {}) {
        return model.filename
            || model.name
            || String(this.getLocalHashComparePath(model) || '').split(/[\/\\]/).pop()
            || 'Selected local model';
    },

    formatHashCompareProgressMessage(filename = '', percent = 0, message = '') {
        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
        const status = message || 'Calculating SHA256...';
        return `Calculating hash for ${filename}...\n${Math.round(safePercent)}% - ${status}`;
    },

    updateHashCompareModelMetadata(model = {}, result = {}) {
        const sha256 = this.normalizeSha256ForCompare(result?.sha256 || result?.hash || '');
        if (!sha256 || !model || typeof model !== 'object') return;

        model.sha256 = sha256;
        model.hash = sha256;
        if (!model.hashes || typeof model.hashes !== 'object' || Array.isArray(model.hashes)) {
            model.hashes = {};
        }
        model.hashes.SHA256 = sha256;
        if (result.metadata_path) {
            model.metadata_path = result.metadata_path;
        }
    },

    async pollHashCalculation(filePath, metadataPath, {
        onStart = () => {},
        onProgress = () => {},
        checkAbort = () => false,
        onAbort = () => {},
        silent = true
    } = {}) {
        const start = await this.fetchJson('/model_resolver/calculate-file-hash/start', {
            method: 'POST',
            silent,
            body: JSON.stringify({
                file_path: filePath,
                metadata_path: metadataPath
            })
        }, 'Start model hash calculation');

        const progressId = start?.progress_id;
        if (!progressId) {
            throw new Error('No progress id returned');
        }

        onStart(progressId);

        for (;;) {
            await new Promise(resolve => setTimeout(resolve, 250));
            if (checkAbort()) {
                await onAbort(progressId);
                throw new Error('Hash calculation cancelled');
            }
            const progress = await this.fetchJson(
                `/model_resolver/calculate-file-hash/progress/${encodeURIComponent(progressId)}`,
                { silent: true },
                'Get model hash progress'
            );

            onProgress(progress?.percent || 0, progress?.message || '');

            if (progress?.status === 'done') {
                return progress;
            }
            if (progress?.status === 'cancelled') {
                throw new Error('Hash calculation cancelled');
            }
            if (progress?.status === 'error') {
                throw new Error(progress.error || progress.message || 'Hash calculation failed');
            }
        }
    },

    async calculateLocalHashCandidatesForCompare(model = {}) {
        const path = this.getLocalHashComparePath(model);
        if (!path) {
            throw new Error('No local file path available');
        }

        const filename = this.getHashCompareFilename(model);
        const notification = this.showNotification?.(
            this.formatHashCompareProgressMessage(filename, 0, 'Preparing hash calculation...'),
            'info',
            { manualProgress: true }
        );

        try {
            const result = await this.pollHashCalculation(
                path,
                model.metadata_path || model.metadataPath || '',
                {
                    silent: true,
                    onProgress: (percent, message) => {
                        notification?.updateProgress?.(
                            percent,
                            this.formatHashCompareProgressMessage(filename, percent, message)
                        );
                    }
                }
            );

            if (!result) return null;

            const sha256 = this.normalizeSha256ForCompare(result?.sha256 || result?.hash || '');
            if (!sha256) {
                throw new Error('No hash returned');
            }

            this.updateHashCompareModelMetadata(model, result);
            notification?.updateProgress?.(
                100,
                result?.metadata_updated
                    ? `Hash calculated and saved for ${filename}.`
                    : `Hash calculated for ${filename}.`
            );
            window.setTimeout(() => notification?.close?.(), 900);

            return {
                data: result,
                candidates: this.collectHashCandidatesForCompare(
                    {
                        ...result,
                        sha256,
                        hash: sha256,
                        hashes: { SHA256: sha256 }
                    },
                    'calculated hash',
                    new Set()
                )
            };
        } catch (error) {
            notification?.close?.();
            if (error.message === 'Hash calculation cancelled') {
                this.showNotification?.('Hash calculation stopped.', 'info');
                return null;
            }
            throw error;
        }
    },

    getHashCompareSourceLabel(sourceKey = '', result = {}) {
        const explicitLabel = result?.sourceLabel || result?.source_label || '';
        if (explicitLabel) return String(explicitLabel);

        const rawSource = String(result?.source || result?.details_source || sourceKey || '').toLowerCase().replace(/-/g, '_');
        const sourceLabels = {
            download_source: 'Selected source',
            popular: 'Popular',
            model_list: 'Local Database',
            huggingface: 'HuggingFace',
            civitai: 'CivitAI',
            civarchive: 'CivArchive',
            lora_manager_archive: 'LoRA Archive',
            lora_archive: 'LoRA Archive',
            workflow: 'Workflow',
            online: 'Online'
        };

        return sourceLabels[rawSource]
            || sourceLabels[String(sourceKey || '').toLowerCase().replace(/-/g, '_')]
            || String(sourceKey || 'Source').replace(/[_-]+/g, ' ');
    },

    getHashCompareResultName(result = {}) {
        const primary = result?.name
            || result?.model_name
            || result?.modelName
            || result?.repo_id
            || result?.repo
            || result?.filename
            || result?.path
            || result?.model_url
            || result?.url
            || 'Model';
        const version = result?.version_name || result?.versionName || result?.version || '';
        const display = this.getVersionedModelName?.(String(primary), String(version || ''))
            || String(primary);
        return this.truncateText?.(display, 96) || display;
    },

    getHashCompareResultUrl(result = {}) {
        return String(
            result?.version_url
            || result?.model_url
            || result?.platform_url
            || result?.source_url
            || result?.openUrl
            || result?.url
            || result?.download_url
            || ''
        ).trim();
    },

    dedupeHashCompareMatches(matches = []) {
        const seen = new Set();
        const unique = [];
        matches.forEach(match => {
            if (!match) return;
            const key = [
                match.sourceLabel || match.sourceKey || '',
                match.name || '',
                match.url || '',
                match.sha256 || ''
            ].map(value => String(value || '').toLowerCase()).join('::');
            if (seen.has(key)) return;
            seen.add(key);
            unique.push(match);
        });
        return unique;
    },

    showHashCompareSuccessNotification(filename = 'Selected local model', matches = []) {
        const uniqueMatches = this.dedupeHashCompareMatches(matches);
        if (!uniqueMatches.length) return;

        const visibleMatches = uniqueMatches.slice(0, 6);
        const lines = visibleMatches.map(match => (
            `- ${match.sourceLabel || 'Source'}: ${match.name || 'Model'}`
        ));
        if (uniqueMatches.length > visibleMatches.length) {
            lines.push(`- +${uniqueMatches.length - visibleMatches.length} more`);
        }

        this.showNotification?.(
            `Hash match found for ${filename}:\n${lines.join('\n')}`,
            'success',
            { duration: 7000 }
        );
    },

    getHashCompareLocalMatchIdentity(model = {}) {
        const explicitIdentity = String(model?.local_match_identity || '').trim();
        if (explicitIdentity) return explicitIdentity;

        return this.getLocalMatchIdentity?.({ model }) || '';
    },

    markSearchResultHashBadgesForMissing(missing = {}, sha256 = '', options = {}) {
        const hash = this.normalizeSha256ForCompare(sha256);
        if (!missing || !hash) return [];

        const localMatchIdentity = String(options.localMatchIdentity || '').trim();
        const markIfMatches = (result, sourceLabel = 'result') => {
            if (!result || typeof result !== 'object') return null;
            const hashes = this.collectHashCandidatesForCompare(result, sourceLabel, new Set());
            if (!hashes.some(candidate => candidate.hash === hash)) return null;

            result.hash_verified = true;
            result.hash_verified_sha256 = hash;
            if (localMatchIdentity) {
                const identities = Array.isArray(result.hash_verified_local_match_identities)
                    ? result.hash_verified_local_match_identities
                    : [];
                if (!identities.includes(localMatchIdentity)) {
                    identities.push(localMatchIdentity);
                }
                result.hash_verified_local_match_identities = identities;
            }
            return {
                sourceKey: sourceLabel,
                sourceLabel: this.getHashCompareSourceLabel(sourceLabel, result),
                name: this.getHashCompareResultName(result),
                url: this.getHashCompareResultUrl(result),
                sha256: hash
            };
        };

        const state = this.getSearchState?.(missing)
            || this.searchResultCache?.get(this.getMissingSearchKey?.(missing));
        const results = state?.results || {};
        const sources = [
            ['download_source', missing.download_source],
            ['popular', results.popular],
            ['model_list', results.model_list],
            ['huggingface', results.huggingface],
            ['civitai', results.civitai],
            ['civarchive', results.civarchive],
            ['lora_manager_archive', results.lora_manager_archive]
        ];
        let changed = false;
        const matches = [];

        sources.forEach(([sourceKey, value]) => {
            if (Array.isArray(value)) {
                value.forEach(item => {
                    const match = markIfMatches(item, sourceKey);
                    if (match) {
                        matches.push(match);
                        changed = true;
                    }
                });
                return;
            }
            const match = markIfMatches(value, sourceKey);
            if (match) {
                matches.push(match);
                changed = true;
            }
        });

        if (changed && state) {
            const workflowKey = this.getWorkflowScopedQueueKey?.();
            this.persistSearchStateForWorkflow?.(workflowKey, missing, state);
            this.refreshSearchUiForMissing?.(missing, state, { workflowKey });
        }
        return matches;
    },

    async compareLocalModelHashesWithCurrentFinding(model = {}) {
        const missing = this.getMissingForHashCompareContext(model);
        if (!missing) {
            this.showNotification?.('Cannot find the search results for this model.', 'warning');
            return;
        }

        let localHashes = this.getLocalHashCandidatesForCompare(model);
        let metadataResult = null;
        if (!localHashes.length) {
            try {
                const lookup = await this.fetchLocalHashCandidatesForCompare(model);
                metadataResult = lookup.data;
                localHashes = lookup.candidates;
            } catch (error) {
                this.showNotification?.(`Local hash metadata lookup failed: ${error?.message || error}`, 'error');
                return;
            }
        }

        if (!localHashes.length) {
            try {
                const calculated = await this.calculateLocalHashCandidatesForCompare(model);
                if (!calculated) return;
                metadataResult = calculated.data || metadataResult;
                localHashes = calculated.candidates;
            } catch (error) {
                this.showNotification?.(`Hash calculation failed: ${error?.message || error}`, 'error');
                return;
            }
        }

        const filename = this.getHashCompareFilename(model);
        if (!localHashes.length) {
            const metadataPath = metadataResult?.metadata_path || model.metadata_path || '';
            this.showNotification?.(
                metadataPath
                    ? 'Hash calculation finished, but no completed SHA256 hash was found.'
                    : 'No local SHA256 hash found for this model.',
                'warning'
            );
            return;
        }

        const hashMatches = [];
        const localMatchIdentity = this.getHashCompareLocalMatchIdentity(model);
        localHashes.forEach(candidate => {
            hashMatches.push(
                ...this.markSearchResultHashBadgesForMissing(missing, candidate.hash, {
                    localMatchIdentity
                })
            );
        });
        if (hashMatches.length) {
            this.showHashCompareSuccessNotification(filename, hashMatches);
            return;
        }

        const localPreview = localHashes
            .map(candidate => this.formatSha256Short(candidate.hash))
            .join(', ');
        this.showNotification?.(
            `No search result hash matches ${filename} (${localPreview}).`,
            'warning'
        );
    },

    async openContainingFolder(model) {
        const path = model?.open_path || model?.folder_path || model?.download_directory || model?.directory || model?.path || model?.resolved_path || '';
        if (!path) {
            this.showNotification('No local file path available', 'error');
            return;
        }

        try {
            await this.fetchJson('/model_resolver/open-containing-folder', {
                method: 'POST',
                body: JSON.stringify({ path })
            }, 'Open containing folder');
        } catch (error) {
            // Already logged and notified inside fetchJson
        }
    },

    openModelSourceLink(model = {}) {
        const sourceLink = this.getContextMenuSourceLink(this.getContextMenuSourceLookupModel(model));
        if (!sourceLink?.url) {
            this.showNotification?.('No source page URL available for this model.', 'info');
            return;
        }

        window.open(sourceLink.url, '_blank', 'noopener,noreferrer');
    },

    /**
     * Open model in CivitAI
     */
    async openInCivitAI(model) {
        if (!model) return;

        const directUrl = this.getKnownCivitaiModelUrl(model);
        if (directUrl) {
            window.open(directUrl, '_blank');
            return;
        }

        const name = model.name || model.original_path?.split(/[\/\\]/).pop() || '';
        if (!name) return;

        try {
            // Search CivitAI for this model using hash (pass resolved_path for hash lookup)
            const data = await this.fetchJson('/model_resolver/civitai-search', {
                method: 'POST',
                body: JSON.stringify({
                    filename: name,
                    category: model.category,
                    resolved_path: model.resolved_path || ''
                })
            }, 'Search CivitAI');

            if (data && data.url) {
                window.open(data.url, '_blank');
            } else {
                throw new Error('No URL in search result');
            }
        } catch (e) {
            // Fall back to direct search
            const searchName = this.stripModelExtension(name);
            const searchUrl = `https://civitai.com/search?q=${encodeURIComponent(searchName)}`;
            window.open(searchUrl, '_blank');
        }
    },

    getKnownCivitaiModelUrl(model = {}) {
        const candidates = [
            model.model_url,
            model.workflow_model_url,
            model.openUrl,
            model.url
        ];
        for (const url of candidates) {
            const value = String(url || '');
            if (/^https:\/\/(?:www\.)?civitai\.com\/models\/\d+/i.test(value)) {
                return value;
            }
        }
        const modelId = model.model_id || model.modelId;
        const versionId = model.version_id || model.versionId;
        if (modelId) {
            return getCivitaiModelUrl(modelId, versionId);
        }
        return '';
    },

    /**
     * Show model info dialog (similar to rgthree's RgthreeLoraInfoDialog)
     */
    async showModelInfo(model) {
        if (!model) return;

        const name = model.name || model.original_path?.split(/[\/\\]/).pop() || '';
        if (!name) return;

        // Create and show the info dialog
        this.showModelInfoDialog(name, model);
    },

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
        dialog._onInfoDialogKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            if (document.querySelector('.mr-image-preview-backdrop')) return;
            event.preventDefault();
            this.closeInfoDialog(dialog);
        };
        document.addEventListener('keydown', dialog._onInfoDialogKeyDown);

        // Add close handlers
        const closeBtn = dialog.querySelector('.mr-info-dialog-close');
        const footerCloseBtn = dialog.querySelector('.mr-info-dialog-close-btn');
        const backdrop = dialog.querySelector('.mr-info-dialog-backdrop');

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

        dialog._infoDialogLookup = { loraName, modelData };
        this.fetchLocalModelInfoForDialog(loraName, modelData, dialog);
    },

    /**
     * Create the info dialog element
     */
    renderInfoFieldLabel(iconName, label, tooltip) {
        return `
            <span class="mr-info-field-label">
                ${getSvgIcon(iconName, 'currentColor', 'mr-info-label-icon')}
                <span class="mr-info-label-text">${this.escapeHtml(label)}</span>
                <span class="mr-tooltip-badge" data-tooltip="${this.escapeHtml(tooltip)}">?</span>
            </span>
        `;
    },

    createInfoDialog(loraName, modelData) {
        const loraDisplayName = this.stripModelExtension(loraName);

        const dialog = document.createElement('div');
        dialog.className = 'mr-info-dialog-backdrop';
        dialog._selectedTrainedWords = new Set();
        dialog.innerHTML = `
            <div class="mr-info-dialog">
                <div class="mr-info-dialog-header">
                    <h3 class="mr-info-dialog-title">${loraDisplayName}</h3>
                    <div class="mr-info-header-actions">
                        <span class="mr-info-civitai-link"></span>
                        <button class="mr-info-dialog-close">×</button>
                    </div>
                </div>
                <div class="mr-info-dialog-content">
                    <div class="mr-info-dialog-loading">Loading...</div>
                    <div class="mr-info-dialog-body mr-hidden-initial">
                        <div class="mr-info-area">
                            <span class="mr-info-tag mr-info-type"></span>
                            <span class="mr-info-tag mr-info-basemodel"></span>
                        </div>
                        <div class="mr-info-tags-row mr-hidden-initial">
                            <span class="mr-info-tags-label">Tags</span>
                            <div class="mr-info-tags"></div>
                        </div>
                        <table class="mr-info-table">
                            <tbody>
                                <tr class="mr-info-file-row">
                                    <td>${this.renderInfoFieldLabel('file', 'File', 'The model file name found locally or returned by CivitAI.')}</td>
                                    <td><span class="mr-info-file"></span></td>
                                </tr>
                                <tr class="mr-info-basemodel-row">
                                    <td>${this.renderInfoFieldLabel('box', 'Base Model', 'Base model this resource was made for, for example SD1.5, SDXL or Flux.')}</td>
                                    <td><span class="mr-info-base-model"></span></td>
                                </tr>
                                <tr class="mr-info-hash-row">
                                    <td>${this.renderInfoFieldLabel('hash', 'Hash (sha256)', 'Unique fingerprint of the local file. Model Resolver uses it to confirm the exact CivitAI version.')}</td>
                                    <td>
                                        <div class="mr-info-hash-control">
                                            <span class="mr-info-hash"></span>
                                            <button type="button" class="mr-info-hash-calculate mr-hidden-initial">
                                                Calculate hash
                                            </button>
                                            <div class="mr-info-hash-progress mr-hidden-initial">
                                                <div class="mr-info-hash-progress-bar">
                                                    <span></span>
                                                </div>
                                                <small>0%</small>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                                <tr class="mr-info-size-row mr-hidden-initial">
                                    <td>${this.renderInfoFieldLabel('hardDrive', 'Size', 'The local model file size, read from metadata or from the file on disk.')}</td>
                                    <td><span class="mr-info-size"></span></td>
                                </tr>
                                <tr class="mr-info-location-row mr-info-row-wide mr-hidden-initial">
                                    <td>${this.renderInfoFieldLabel('locate', 'Location', 'Folder where this local model file is stored.')}</td>
                                    <td><span class="mr-info-location"></span></td>
                                </tr>
                                <tr class="mr-info-trainedwords-row mr-hidden-initial">
                                    <td>
                                        <div class="mr-info-trained-words-label">
                                            ${this.renderInfoFieldLabel('bookType', 'Trained Words', 'Trigger words recommended by the model author. Click the words you want, then copy them into your prompt.')}
                                            <small class="mr-info-trained-words-meta">
                                                <span class="mr-info-trained-words-count">0 selected</span>
                                                <button type="button" class="mr-info-copy-trained-words" disabled>Copy</button>
                                            </small>
                                        </div>
                                    </td>
                                    <td>
                                        <div class="mr-info-trained-words-hint">Click words to select them.</div>
                                        <div class="mr-info-trained-words"></div>
                                    </td>
                                </tr>
                                <tr class="mr-info-clipskip-row mr-hidden-initial">
                                    <td>${this.renderInfoFieldLabel('wrench', 'Clip Skip', 'Recommended Clip Skip value from the model author, if one is provided.')}</td>
                                    <td><span class="mr-info-clip-skip"></span></td>
                                </tr>
                                <tr class="mr-info-description-row mr-hidden-initial">
                                    <td>${this.renderInfoFieldLabel('fileText', 'Description', 'Model description from CivitAI or local metadata. Long descriptions are shortened until you click Show more.')}</td>
                                    <td>
                                        <div class="mr-info-description-wrap">
                                            <div class="mr-info-description"></div>
                                            <div class="mr-info-description-actions mr-hidden-initial">
                                                <button type="button" class="mr-info-description-toggle">Show more</button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <div class="mr-info-images"></div>
                    </div>
                </div>
                <div class="mr-info-dialog-footer">
                    <button class="mr-btn mr-btn-secondary mr-info-dialog-close-btn">Close</button>
                </div>
            </div>
        `;

        return dialog;
    },



    truncateText(value, maxLength = 160) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
    },

    sanitizeDescriptionHtml(html) {
        return sanitizeDescriptionHtml(html);
    },

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

        if (words && typeof words === 'object') {
            return this.normalizeTrainedWords(
                words.trained_words
                    || words.trainedWords
                    || words.words
                    || words.values
                    || []
            );
        }

        return [];
    },

    formatInfoDialogLocation(data = {}) {
        let location = data.location
            || data.folder_path
            || data.folderPath
            || data.download_directory
            || data.downloadDirectory
            || data.directory
            || '';

        if (!location) {
            const fullPath = data.file_path || data.filePath || data.resolved_path || data.resolvedPath || data.full_path || data.fullPath || data.path || '';
            const normalizedFullPath = this.normalizePathToForward(fullPath);
            const lastSlash = normalizedFullPath.lastIndexOf('/');
            if (lastSlash > 0) {
                location = normalizedFullPath.slice(0, lastSlash + 1);
            }
        }

        location = this.normalizePathToForward(location);
        if (location && !location.endsWith('/')) {
            location += '/';
        }

        return location;
    },

    getInfoDialogLocationOpenPath(data = {}) {
        return data.file_path
            || data.filePath
            || data.resolved_path
            || data.resolvedPath
            || data.full_path
            || data.fullPath
            || data.path
            || data.location
            || data.folder_path
            || data.folderPath
            || data.download_directory
            || data.downloadDirectory
            || data.directory
            || '';
    },

    normalizeInfoTags(tags) {
        if (Array.isArray(tags)) {
            const seen = new Set();
            const result = [];
            for (let tag of tags) {
                if (tag && typeof tag === 'object') {
                    tag = tag.name || tag.tag || tag.text || tag.value || '';
                }
                const text = String(tag || '').trim();
                if (!text) continue;
                const key = text.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                result.push(text);
            }
            return result;
        }

        if (typeof tags === 'string') {
            return this.normalizeInfoTags(
                tags
                    .split(/[\n,|;]/)
                    .map(tag => tag.trim())
                    .filter(Boolean)
            );
        }

        if (tags && typeof tags === 'object') {
            return this.normalizeInfoTags(
                tags.tags
                    || tags.model_tags
                    || tags.modelTags
                    || tags.values
                    || []
            );
        }

        return [];
    },

    getInfoDialogTags(data = {}) {
        const sources = [
            data.tags,
            data.model_tags,
            data.modelTags,
            data.civitai?.tags,
            data.civitai?.model?.tags,
            data.model?.tags,
            data.metadata?.tags,
            data.path_metadata?.tags
        ];

        return this.normalizeInfoTags(
            sources.flatMap(source => this.normalizeInfoTags(source))
        );
    },

    formatInfoDialogSize(data = {}) {
        const rawSize = data.size
            ?? data.file_size
            ?? data.fileSize
            ?? data.size_bytes
            ?? data.sizeBytes
            ?? data.file?.size
            ?? data.file?.sizeBytes
            ?? null;

        if (rawSize === null || rawSize === undefined || rawSize === '') return '';
        if (rawSize === 0 || rawSize === '0') return '0 B';

        const numericSize = Number(rawSize);
        if (Number.isFinite(numericSize)) {
            return typeof this.formatBytes === 'function'
                ? this.formatBytes(numericSize)
                : `${numericSize} B`;
        }

        return String(rawSize);
    },

    getInfoDialogTrainedWords(data = {}) {
        const sources = [
            data.trained_words,
            data.trainedWords,
            data.civitai?.trainedWords,
            data.civitai?.trained_words,
            data.selected_version?.trainedWords,
            data.selected_version?.trained_words,
            data.modelVersion?.trainedWords,
            data.modelVersion?.trained_words,
            data.model_version?.trainedWords,
            data.model_version?.trained_words,
            data.version?.trainedWords,
            data.version?.trained_words,
            data.path_metadata?.trainedWords,
            data.path_metadata?.trained_words,
            data.metadata?.trainedWords,
            data.metadata?.trained_words
        ];

        return this.normalizeTrainedWords(
            sources.flatMap(source => this.normalizeTrainedWords(source))
        );
    },

    setInfoTableRowVisible(row, visible) {
        if (!row) return;
        row.classList.toggle('mr-hidden-initial', !visible);
        row.style.display = visible ? '' : 'none';
    },

    setInfoElementVisible(element, visible) {
        if (!element) return;
        element.classList.toggle('mr-hidden-initial', !visible);
        element.style.display = visible ? '' : 'none';
    },

    updateSelectedTrainedWordsSummary(dialog) {
        if (!dialog) return;

        const countEl = dialog.querySelector('.mr-info-trained-words-count');
        const copyBtn = dialog.querySelector('.mr-info-copy-trained-words');
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
    },

    getInfoDialogHash(data = {}) {
        return String(data.sha256 || data.hash || data.hashes?.SHA256 || data.hashes?.sha256 || '').trim();
    },

    getInfoDialogModelFilePath(data = {}) {
        return data.file_path
            || data.filePath
            || data.resolved_path
            || data.resolvedPath
            || data.full_path
            || data.fullPath
            || data.path
            || '';
    },

    updateInfoDialogHashDisplay(dialog, data = {}) {
        const hashEl = dialog.querySelector('.mr-info-hash');
        const button = dialog.querySelector('.mr-info-hash-calculate');
        const progressEl = dialog.querySelector('.mr-info-hash-progress');
        const hash = this.getInfoDialogHash(data);
        const filePath = this.getInfoDialogModelFilePath(data);

        if (hashEl) {
            hashEl.textContent = hash;
            hashEl.classList.toggle('is-empty', !hash);
        }
        if (button) {
            const canCalculate = Boolean(!hash && filePath);
            button.classList.toggle('mr-hidden-initial', !canCalculate);
            button.hidden = !canCalculate;
            button.disabled = false;
            button.textContent = 'Calculate hash';
            delete button.dataset.hashCalculating;
            delete button.dataset.progressId;
        }
        if (progressEl && hash) {
            this.hideInfoDialogHashProgress(dialog);
        }
    },

    hideInfoDialogHashProgress(dialog) {
        const progressEl = dialog.querySelector('.mr-info-hash-progress');
        if (!progressEl) return;
        const bar = progressEl.querySelector('.mr-info-hash-progress-bar span');
        const label = progressEl.querySelector('small');
        progressEl.classList.add('mr-hidden-initial');
        progressEl.hidden = true;
        if (bar) bar.style.width = '0%';
        if (label) label.textContent = '0%';
    },

    updateInfoDialogHashProgress(dialog, percent = 0, message = '') {
        const progressEl = dialog.querySelector('.mr-info-hash-progress');
        if (!progressEl) return;

        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
        const bar = progressEl.querySelector('.mr-info-hash-progress-bar span');
        const label = progressEl.querySelector('small');
        progressEl.classList.remove('mr-hidden-initial');
        progressEl.hidden = false;
        if (bar) bar.style.width = `${safePercent}%`;
        if (label) {
            label.textContent = message
                ? `${Math.round(safePercent)}% · ${message}`
                : `${Math.round(safePercent)}%`;
        }
    },

    async cancelInfoDialogHashCalculation(dialog, button) {
        const state = dialog?._hashCalculation || {};
        state.cancelRequested = true;
        dialog._hashCalculation = state;
        if (button) {
            button.disabled = true;
            button.textContent = 'Stopping...';
        }

        if (state.progressId) {
            try {
                await this.fetchJson(
                    `/model_resolver/calculate-file-hash/cancel/${encodeURIComponent(state.progressId)}`,
                    { method: 'POST', silent: true },
                    'Cancel model hash calculation'
                );
            } catch (error) {
                // Keep the UI in stopping state; polling will surface the final state if possible.
            }
        }
    },

    async calculateInfoDialogHash(dialog, button) {
        if (button?.dataset.hashCalculating === 'true') {
            await this.cancelInfoDialogHashCalculation(dialog, button);
            return null;
        }

        const data = dialog?._infoDialogData || {};
        const filePath = this.getInfoDialogModelFilePath(data);
        if (!filePath) {
            this.showNotification?.('No local file path available', 'error');
            return null;
        }

        dialog._hashCalculation = { progressId: '', cancelRequested: false };
        if (button) {
            button.disabled = false;
            button.textContent = 'Stop calculate';
            button.dataset.hashCalculating = 'true';
            delete button.dataset.progressId;
        }
        this.updateInfoDialogHashProgress(dialog, 0, 'Preparing');

        try {
            const result = await this.pollHashCalculation(
                filePath,
                data.metadata_path || data.metadataPath || '',
                {
                    silent: false,
                    onStart: (progressId) => {
                        if (!dialog._hashCalculation) {
                            dialog._hashCalculation = { progressId, cancelRequested: false };
                        }
                        dialog._hashCalculation.progressId = progressId;
                        if (button) {
                            button.dataset.progressId = progressId;
                            button.textContent = 'Stop calculate';
                            button.disabled = false;
                        }
                    },
                    onProgress: (percent, message) => {
                        this.updateInfoDialogHashProgress(dialog, percent, message);
                    },
                    checkAbort: () => {
                        return !dialog.isConnected || (dialog._hashCalculation && dialog._hashCalculation.cancelRequested);
                    },
                    onAbort: async (progressId) => {
                        await this.cancelInfoDialogHashCalculation(dialog, button);
                    }
                }
            );

            if (!result) return null;

            const sha256 = result?.sha256 || result?.hash || '';
            if (!sha256) {
                throw new Error('No hash returned');
            }

            const updatedData = {
                ...data,
                sha256,
                hash: sha256,
                metadata_path: result.metadata_path || data.metadata_path || data.metadataPath || '',
                metadata_saved: Boolean(result.metadata_updated || data.metadata_saved)
            };
            dialog._infoDialogData = updatedData;
            dialog._hashCalculation = null;
            this.updateInfoDialogHashDisplay(dialog, updatedData);
            this.showNotification?.(
                result.metadata_updated ? 'Hash calculated and saved to metadata.' : 'Hash calculated.',
                'success'
            );
            return updatedData;
        } catch (error) {
            if (error.message === 'Hash calculation cancelled') {
                this.hideInfoDialogHashProgress(dialog);
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Calculate hash';
                    delete button.dataset.hashCalculating;
                    delete button.dataset.progressId;
                }
                dialog._hashCalculation = null;
                this.showNotification?.('Hash calculation stopped.', 'info');
                return null;
            }
            dialog._hashCalculation = null;
            if (button) {
                button.disabled = false;
                button.textContent = 'Calculate hash';
                delete button.dataset.hashCalculating;
                delete button.dataset.progressId;
            }
            this.hideInfoDialogHashProgress(dialog);
            this.showNotification?.(`Hash calculation failed: ${error?.message || error}`, 'error');
            return null;
        }
    },

    bindInfoDialogInteractions(dialog) {
        if (!dialog || dialog.dataset.mlInfoBound === 'true') return;
        dialog.dataset.mlInfoBound = 'true';

        dialog.addEventListener('click', async (event) => {
            const fetchCivitaiButton = event.target.closest('.mr-info-fetch-civitai');
            if (fetchCivitaiButton && dialog.contains(fetchCivitaiButton)) {
                await this.fetchCivitaiModelInfoForDialog(dialog, fetchCivitaiButton);
                return;
            }

            const hashButton = event.target.closest('.mr-info-hash-calculate');
            if (hashButton && dialog.contains(hashButton)) {
                await this.calculateInfoDialogHash(dialog, hashButton);
                return;
            }

            const locationBtn = event.target.closest('.mr-info-location-button');
            if (locationBtn && dialog.contains(locationBtn)) {
                const path = locationBtn.dataset.path || '';
                if (path) {
                    await this.openContainingFolder({ path, resolved_path: path });
                }
                return;
            }

            const wordBtn = event.target.closest('.mr-info-trained-word');
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

            const copyBtn = event.target.closest('.mr-info-copy-trained-words');
            if (copyBtn && dialog.contains(copyBtn)) {
                const words = dialog._selectedTrainedWords instanceof Set
                    ? Array.from(dialog._selectedTrainedWords)
                    : [];

                if (!words.length) return;

                try {
                    await navigator.clipboard.writeText(words.join(', '));
                    copyBtn.textContent = 'Copied';
                } catch (error) {
                    console.error('Model Resolver: Failed to copy trained words:', error);
                    copyBtn.textContent = 'Failed';
                }

                setTimeout(() => {
                    if (copyBtn.isConnected) {
                        copyBtn.textContent = 'Copy';
                    }
                }, 1200);
                return;
            }

            const descToggleBtn = event.target.closest('.mr-info-description-toggle');
            if (descToggleBtn && dialog.contains(descToggleBtn)) {
                const descEl = dialog.querySelector('.mr-info-description');
                if (!descEl) return;

                const isExpanded = descEl.classList.toggle('is-expanded');
                descToggleBtn.textContent = isExpanded ? 'Show less' : 'Show more';
            }
        });
    },

    getInfoDialogElement(dialog) {
        return dialog?.querySelector?.('.mr-info-dialog') || null;
    },

    restoreInfoDialogSize(dialog) {
        const panel = this.getInfoDialogElement(dialog);
        if (!panel) return;

        try {
            const saved = JSON.parse(localStorage.getItem('model_resolver_info_dialog_size') || 'null');
            if (!saved || typeof saved !== 'object') return;

            const width = Number(saved.w);
            const height = Number(saved.h);
            if (!Number.isFinite(width) || !Number.isFinite(height)) return;

            const maxWidth = Math.floor(window.innerWidth * 0.92);
            const maxHeight = Math.max(320, window.innerHeight - 16);
            const clampedWidth = Math.max(420, Math.min(width, maxWidth));
            const clampedHeight = Math.max(320, Math.min(height, maxHeight));

            panel.style.width = `${clampedWidth}px`;
            panel.style.height = `${clampedHeight}px`;
        } catch (error) {
            console.warn('Model Resolver: Failed to restore info dialog size:', error);
        }
    },

    saveInfoDialogSize(dialog) {
        const panel = this.getInfoDialogElement(dialog);
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (!width || !height) return;

        try {
            localStorage.setItem('model_resolver_info_dialog_size', JSON.stringify({ w: width, h: height }));
        } catch (error) {
            console.warn('Model Resolver: Failed to save info dialog size:', error);
        }
    },

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
    },

    getModelInfoResolvedPath(modelData = {}) {
        return modelData?.resolved_path
            || modelData?.path
            || modelData?.full_path
            || modelData?.folder_path
            || modelData?.download_directory
            || '';
    },

    buildLocalInfoDialogData(loraName, modelData = {}) {
        const filename = loraName || modelData?.filename || modelData?.name || '';
        const modelName = this.stripModelExtension(filename);
        const resolvedPath = this.getModelInfoResolvedPath(modelData);
        const categoryTypeMap = {
            checkpoints: 'checkpoint',
            loras: 'lora',
            vae: 'vae',
            text_encoders: 'text_encoder',
            clip: 'clip',
            clip_vision: 'clip_vision',
            controlnet: 'controlnet',
            upscale_models: 'upscale',
            diffusion_models: 'diffusion_model'
        };
        const rawType = modelData?.model_type || modelData?.modelType || modelData?.type || modelData?.category || '';
        const normalizedType = String(rawType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        return {
            filename,
            category: modelData?.category || '',
            file_path: resolvedPath,
            resolved_path: resolvedPath,
            location: resolvedPath ? this.formatInfoDialogLocation({ file_path: resolvedPath }) : '',
            model_name: modelData?.model_name || modelData?.modelName || modelName,
            model_type: categoryTypeMap[normalizedType] || rawType,
            sha256: modelData?.sha256 || modelData?.hash || modelData?.hashes?.SHA256 || '',
            size: modelData?.size || modelData?.file_size || modelData?.fileSize || '',
            base_model: modelData?.base_model || modelData?.baseModel || '',
            tags: modelData?.tags || [],
            trained_words: modelData?.trained_words || modelData?.trainedWords || [],
            local_only: true,
            civitai_checked: false
        };
    },

    /**
     * Fetch local model info and update the dialog without querying CivitAI.
     */
    async fetchLocalModelInfoForDialog(loraName, modelData, dialog) {
        const requestId = `${Date.now()}_${Math.random()}`;
        dialog._localInfoRequestId = requestId;
        const fallbackData = this.buildLocalInfoDialogData(loraName, modelData);
        this.updateInfoDialogWithData(dialog, fallbackData);

        try {
            const data = await this.fetchJson('/model_resolver/civitai-search', {
                method: 'POST',
                body: JSON.stringify({
                    filename: loraName,
                    category: modelData?.category || '',
                    resolved_path: this.getModelInfoResolvedPath(modelData),
                    local_only: true
                })
            }, 'Fetch local model info');
            if (
                dialog._localInfoRequestId !== requestId
                || dialog._infoDialogCivitaiFetchStarted
                || dialog._infoDialogData?.civitai_checked
                || dialog._infoDialogData?.version_url
                || dialog._infoDialogData?.url
            ) {
                return;
            }
            const localData = { ...fallbackData, ...data, civitai_checked: false };
            this.rememberContextMenuSourceMetadata(localData);
            this.updateInfoDialogWithData(dialog, localData);
        } catch (e) {
            if (dialog._localInfoRequestId !== requestId || dialog._infoDialogCivitaiFetchStarted) {
                return;
            }
            this.rememberContextMenuSourceMetadata(fallbackData);
            this.updateInfoDialogWithData(dialog, fallbackData);
        }
    },

    async fetchCivitaiModelInfoForDialog(dialog, button = null) {
        if (!dialog) return;
        if (button?.dataset.fetchingCivitai === 'true') return;

        const forceRefresh = button?.dataset.forceRefresh === 'true';
        const lookup = dialog._infoDialogLookup || {};
        let data = dialog._infoDialogData || {};
        const filename = data.filename || lookup.loraName || '';
        const category = data.category || lookup.modelData?.category || '';
        const resolvedPath = this.getInfoDialogModelFilePath(data)
            || this.getModelInfoResolvedPath(lookup.modelData || {});

        if (!filename) {
            this.showNotification?.('No model filename available', 'error');
            return;
        }

        dialog._infoDialogCivitaiFetchStarted = true;
        const defaultLabel = forceRefresh ? 'Refetch metadata' : 'Fetch metadata';
        const setFetchingState = (isFetching, label = defaultLabel) => {
            if (!button) return;
            button.dataset.fetchingCivitai = isFetching ? 'true' : 'false';
            button.disabled = isFetching;
            button.innerHTML = isFetching
                ? `${getSvgIcon('globe', 'currentColor', 'mr-info-external-link-icon')} Fetching...`
                : `${getSvgIcon('globe', 'currentColor', 'mr-info-external-link-icon')} ${this.escapeHtml(label)}`;
        };

        setFetchingState(true);

        try {
            let hash = this.getInfoDialogHash(data);
            if (!hash) {
                const hashButton = dialog.querySelector('.mr-info-hash-calculate');
                const hashResult = await this.calculateInfoDialogHash(dialog, hashButton);
                if (!hashResult) {
                    setFetchingState(false);
                    return;
                }
                data = dialog._infoDialogData || data;
                hash = this.getInfoDialogHash(data);
            }

            if (!hash) {
                throw new Error('No SHA256 hash available');
            }

            const tokens = this.getStoredTokens?.() || {};
            const result = await this.fetchJson('/model_resolver/civitai-search', {
                method: 'POST',
                body: JSON.stringify({
                    filename,
                    category,
                    resolved_path: resolvedPath,
                    sha256: hash,
                    force_refresh: forceRefresh,
                    hf_token: tokens.hf_token || '',
                    brave_search_api_key: tokens.brave_search_api_key || '',
                    hf_use_brave_fallback: tokens.hf_use_brave_fallback !== false
                })
            }, 'Fetch model metadata');

            const merged = {
                ...data,
                ...result,
                filename,
                category,
                file_path: result.file_path || data.file_path || resolvedPath,
                resolved_path: result.resolved_path || data.resolved_path || resolvedPath,
                sha256: result.sha256 || hash,
                metadata_checked: true,
                civitai_checked: true
            };
            dialog._infoDialogData = merged;
            this.rememberContextMenuSourceMetadata(merged);
            this.updateInfoDialogWithData(dialog, merged);
            if (merged.url || merged.version_url) {
                this.showNotification?.(
                    forceRefresh ? 'Metadata refreshed.' : 'Metadata loaded.',
                    'success'
                );
            } else {
                this.showNotification?.('No exact remote metadata match found.', 'info');
            }
        } catch (error) {
            this.showNotification?.(`Metadata fetch failed: ${error?.message || error}`, 'error');
            const failedData = {
                ...(dialog._infoDialogData || data),
                metadata_checked: true,
                civitai_checked: true
            };
            this.rememberContextMenuSourceMetadata(failedData);
            this.updateInfoDialogWithData(dialog, failedData);
        } finally {
            setFetchingState(false);
        }
    },

    getInfoMetadataSourceKey(data = {}) {
        const sourceKey = this.getContextMenuSourceKey(data);
        if (sourceKey) return sourceKey;
        for (const url of this.getContextMenuSourceUrlCandidates(data)) {
            const key = this.getContextMenuSourceKeyFromUrl(url);
            if (key) return key;
        }
        return 'metadata';
    },

    getInfoMetadataSourceLabel(data = {}) {
        const key = this.getInfoMetadataSourceKey(data);
        if (key === 'huggingface') return 'HuggingFace';
        if (key === 'civarchive') return 'CivArchive';
        if (key === 'civitai') return 'CivitAI';
        if (key === 'lora_manager_archive') return 'LoRA Archive';
        return 'metadata source';
    },

    getInfoMetadataSourceIcon(data = {}) {
        const key = this.getInfoMetadataSourceKey(data);
        if (key === 'huggingface') return getSvgIcon('huggingface', 'currentColor', 'mr-info-external-link-icon');
        if (key === 'civarchive') return getSvgIcon('civarchive', 'currentColor', 'mr-info-external-link-icon');
        if (key === 'civitai') return getSvgIcon('civitai', 'currentColor', 'mr-info-external-link-icon');
        if (key === 'lora_manager_archive') return getSvgIcon('loraManager', 'currentColor', 'mr-info-external-link-icon');
        return getSvgIcon('externalLink', 'currentColor', 'mr-info-external-link-icon');
    },

    hasInfoMetadataBeenChecked(data = {}) {
        return Boolean(data.metadata_checked || data.metadataChecked || data.civitai_checked || data.civitaiChecked);
    },

    /**
     * Update the info dialog with data
     */
    updateInfoDialogWithData(dialog, data) {
        const loadingDiv = dialog.querySelector('.mr-info-dialog-loading');
        const bodyDiv = dialog.querySelector('.mr-info-dialog-body');
        this.bindInfoDialogInteractions(dialog);

        if (loadingDiv) loadingDiv.style.display = 'none';
        if (bodyDiv) bodyDiv.style.display = 'block';

        if (!data) {
            this.updateInfoDialogError(dialog, 'No data received');
            return;
        }
        dialog._infoDialogData = { ...(dialog._infoDialogData || {}), ...data };
        this.rememberContextMenuSourceMetadata(dialog._infoDialogData);

        // Update title
        const titleEl = dialog.querySelector('.mr-info-dialog-title');
        if (titleEl) {
            const modelName = data.model_name || data.modelName || data.name || data.filename || 'Unknown Model';
            const versionName = data.version_name || data.versionName || '';
            titleEl.innerHTML = this.renderVersionedModelNameHtml(modelName, versionName) || this.escapeHtml(modelName);
        }

        // Update type tag
        const typeTag = dialog.querySelector('.mr-info-type');
        if (typeTag) {
            const modelType = data.model_type || data.modelType || '';
            typeTag.textContent = modelType.toUpperCase();
            typeTag.className = `mr-info-tag mr-info-type ${this.getModelTypeColorClass(modelType)}`;
        }

        // Update base model tag
        const baseModelTag = dialog.querySelector('.mr-info-basemodel');
        if (baseModelTag) {
            const baseModel = data.base_model || data.baseModel || '';
            baseModelTag.textContent = baseModel || '';
            if (baseModel) {
                baseModelTag.style.display = '';
                baseModelTag.className = `mr-info-tag mr-info-basemodel -basemodel-${baseModel.toLowerCase().replace(/\s+/g, '-')}`;
            } else {
                baseModelTag.style.display = 'none';
            }
        }

        // Update top tags
        const tagsRowEl = dialog.querySelector('.mr-info-tags-row');
        const tagsEl = dialog.querySelector('.mr-info-tags');
        if (tagsRowEl && tagsEl) {
            const tags = this.getInfoDialogTags(data);
            if (tags.length > 0) {
                tagsEl.innerHTML = tags.map(tag => `
                    <span class="mr-info-tag mr-info-model-tag" data-tooltip="${this.escapeHtml(tag)}">
                        ${this.escapeHtml(tag)}
                    </span>
                `).join('');
                this.setInfoElementVisible(tagsRowEl, true);
                this.bindTooltips(tagsEl);
            } else {
                tagsEl.innerHTML = '';
                this.setInfoElementVisible(tagsRowEl, false);
            }
        }

        // Update file
        const fileEl = dialog.querySelector('.mr-info-file');
        if (fileEl && data.filename) {
            fileEl.textContent = data.filename;
        }

        // Update location
        const locationEl = dialog.querySelector('.mr-info-location');
        if (locationEl) {
            const location = this.formatInfoDialogLocation(data);
            const openPath = this.getInfoDialogLocationOpenPath(data) || location;
            locationEl.innerHTML = location ? `
                <button
                    type="button"
                    class="mr-info-location-button"
                    data-path="${this.escapeHtml(openPath)}"
                    data-tooltip="Open containing folder"
                    aria-label="Open containing folder and select this model file"
                >
                    <span>${this.escapeHtml(location)}</span>
                    ${getSvgIcon('folderOpen', 'currentColor', 'mr-info-location-icon')}
                </button>
            ` : '';
            this.setInfoTableRowVisible(locationEl.closest('tr'), Boolean(location));
            if (location) this.bindTooltips(locationEl);
        }

        // Update hash
        this.updateInfoDialogHashDisplay(dialog, data);

        // Update CivitAI link
        const civitaiLinkEl = dialog.querySelector('.mr-info-civitai-link');
        if (civitaiLinkEl) {
            const hasLocalFile = Boolean(this.getInfoDialogModelFilePath(data));
            if (data.url || data.version_url) {
                const url = data.version_url || data.url;
                const sourceLabel = this.getInfoMetadataSourceLabel(data);
                civitaiLinkEl.innerHTML = `
                    <a href="${this.escapeHtml(url)}" target="_blank" class="mr-info-link">
                        View on ${this.escapeHtml(sourceLabel)}
                        ${this.getInfoMetadataSourceIcon(data)}
                    </a>
                    ${hasLocalFile ? `
                        <button type="button" class="mr-info-link mr-info-fetch-civitai" data-force-refresh="true">
                            ${getSvgIcon('globe', 'currentColor', 'mr-info-external-link-icon')}
                            Refetch metadata
                        </button>
                    ` : ''}
                `;
            } else if (this.hasInfoMetadataBeenChecked(data)) {
                civitaiLinkEl.innerHTML = `
                    <span class="mr-info-not-found">No exact metadata match</span>
                    ${hasLocalFile ? `
                        <button type="button" class="mr-info-link mr-info-fetch-civitai" data-force-refresh="true">
                            ${getSvgIcon('globe', 'currentColor', 'mr-info-external-link-icon')}
                            Refetch metadata
                        </button>
                    ` : ''}
                `;
            } else if (hasLocalFile) {
                civitaiLinkEl.innerHTML = `
                    <button type="button" class="mr-info-link mr-info-fetch-civitai">
                        ${getSvgIcon('globe', 'currentColor', 'mr-info-external-link-icon')}
                        Fetch metadata
                    </button>
                `;
            } else {
                civitaiLinkEl.innerHTML = '';
            }
        }

        // Update base model row
        const baseModelRowEl = dialog.querySelector('.mr-info-base-model');
        if (baseModelRowEl) {
            const baseModel = data.base_model || data.baseModel || '';
            baseModelRowEl.textContent = baseModel;
            const row = baseModelRowEl.closest('tr');
            this.setInfoTableRowVisible(row, Boolean(baseModel));
        }

        // Update file size row
        const sizeEl = dialog.querySelector('.mr-info-size');
        if (sizeEl) {
            const sizeLabel = this.formatInfoDialogSize(data);
            sizeEl.textContent = sizeLabel;
            this.setInfoTableRowVisible(sizeEl.closest('tr'), Boolean(sizeLabel));
        }

        // Update trained words
        const trainedWordsEl = dialog.querySelector('.mr-info-trained-words');
        if (trainedWordsEl) {
            const words = this.getInfoDialogTrainedWords(data);
            const row = trainedWordsEl.closest('tr');
            if (words.length > 0) {
                dialog._selectedTrainedWords = new Set();
                trainedWordsEl.innerHTML = `<div class="mr-info-trained-words-list">${words.map(word => `
                    <button
                        type="button"
                        class="mr-info-trained-word"
                        data-word="${this.escapeHtml(word)}"
                        data-tooltip="${this.escapeHtml(word)}"
                        aria-pressed="false"
                    >
                        ${this.escapeHtml(word)}
                    </button>
                `).join('')}</div>`;
                this.setInfoTableRowVisible(row, true);
                this.bindTooltips(trainedWordsEl);
                this.updateSelectedTrainedWordsSummary(dialog);
            } else {
                this.setInfoTableRowVisible(row, false);
            }
        }

        // Update clip skip
        const clipSkipEl = dialog.querySelector('.mr-info-clip-skip');
        if (clipSkipEl) {
            const clipSkip = data.clip_skip || data.clipSkip;
            const row = clipSkipEl.closest('tr');
            if (clipSkip && clipSkip !== 'None') {
                clipSkipEl.textContent = clipSkip;
                this.setInfoTableRowVisible(row, true);
            } else {
                this.setInfoTableRowVisible(row, false);
            }
        }

        // Update description
        const descEl = dialog.querySelector('.mr-info-description');
        if (descEl) {
            const desc = data.description || data.model_description || data.modelDescription || '';
            if (desc) {
                const actionsEl = dialog.querySelector('.mr-info-description-actions');
                const toggleBtn = dialog.querySelector('.mr-info-description-toggle');

                let sanitizedHtml = '';
                try {
                    sanitizedHtml = this.sanitizeDescriptionHtml(desc);
                } catch (error) {
                    console.error('Model Resolver: Failed to sanitize description HTML:', error);
                }

                const fallbackText = this.escapeHtml(String(desc).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
                const finalHtml = sanitizedHtml && sanitizedHtml.trim() ? sanitizedHtml : `<p>${fallbackText}</p>`;
                const textOnly = finalHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

                descEl.innerHTML = finalHtml;
                descEl.classList.remove('is-expanded');

                const shouldCollapse = textOnly.length > 520 || finalHtml.length > 900;
                this.setInfoElementVisible(actionsEl, shouldCollapse);
                if (toggleBtn) {
                    toggleBtn.textContent = 'Show more';
                }
                if (!shouldCollapse) {
                    descEl.classList.add('is-expanded');
                }

                const row = descEl.closest('tr');
                this.setInfoTableRowVisible(row, true);
            } else {
                const row = descEl.closest('tr');
                this.setInfoTableRowVisible(row, false);
            }
        }

        // Update images
        this.updateInfoDialogImages(dialog, data.images || data.modelImages || []);
    },

    /**
     * Update images in the info dialog
     */
    updateInfoDialogImages(dialog, images) {
        const imagesContainer = dialog.querySelector('.mr-info-images');
        if (!imagesContainer) return;
        if (!Array.isArray(images) || !images.length) {
            dialog._infoImages = [];
            imagesContainer.innerHTML = '';
            return;
        }

        const visibleImages = images.slice(0, 8).filter(img => img?.url);
        dialog._infoImages = visibleImages;

        const renderImageCard = (img, index) => {
            const captionParts = [];
            if (img.seed) captionParts.push(`<span><label>seed</label> ${this.escapeHtml(img.seed)}</span>`);
            if (img.steps) captionParts.push(`<span><label>steps</label> ${this.escapeHtml(img.steps)}</span>`);
            if (img.cfg) captionParts.push(`<span><label>cfg</label> ${this.escapeHtml(img.cfg)}</span>`);
            if (img.sampler) captionParts.push(`<span><label>sampler</label> ${this.escapeHtml(img.sampler)}</span>`);
            if (img.model) captionParts.push(`<span><label>model</label> ${this.escapeHtml(this.truncateText(img.model, 72))}</span>`);
            if (img.positive) captionParts.push(`<span><label>positive</label> ${this.escapeHtml(this.truncateText(img.positive, 180))}</span>`);
            if (img.negative) captionParts.push(`<span><label>negative</label> ${this.escapeHtml(this.truncateText(img.negative, 180))}</span>`);

            return `
                <div class="mr-info-image-item">
                    <figure>
                        ${img.civitaiUrl ? `
                            <a href="${this.escapeHtml(img.civitaiUrl)}" target="_blank" rel="noopener noreferrer" class="mr-info-image-civitai-badge" data-tooltip="Open image on CivitAI">
                                ${getSvgIcon('civitai', 'currentColor', 'mr-info-image-civitai-icon')}
                                CivitAI
                            </a>
                        ` : ''}
                        <button type="button" class="mr-info-image-preview-btn" data-image-index="${index}" aria-label="Preview example image ${index + 1}">
                        <img src="${this.escapeHtml(img.url)}" alt="Example" loading="lazy" />
                        <span class="mr-info-image-preview-label">${getSvgIcon('eye')} Preview</span>
                        </button>
                        <figcaption>${captionParts.join('')}</figcaption>
                    </figure>
                </div>
            `;
        };

        let imagesHtml = '<div class="mr-info-images-header">Example Images</div><div class="mr-info-images-layout">';
        imagesHtml += visibleImages.map(renderImageCard).join('');
        imagesHtml += '</div>';
        imagesContainer.innerHTML = imagesHtml;

        imagesContainer.querySelectorAll('.mr-info-image-preview-btn').forEach(button => {
            button.addEventListener('click', () => {
                const index = parseInt(button.dataset.imageIndex || '0', 10);
                this.openInfoImagePreview(visibleImages, Number.isNaN(index) ? 0 : index);
            });
        });
        this.bindTooltips(imagesContainer);
    },

    getInfoImageMetadataRows(image = {}) {
        const metadata = image.metadata && typeof image.metadata === 'object' ? image.metadata : {};
        const width = image.width || metadata.width || '';
        const height = image.height || metadata.height || '';
        const cfg = image.cfg || image.cfgScale || metadata.cfg || metadata.cfgScale || '';
        const denoise = image.denoise || metadata.denoise || '';
        const scheduler = image.scheduler || metadata.scheduler || '';
        const rows = [
            ['Seed', image.seed],
            ['Steps', image.steps],
            ['Width', width],
            ['Height', height],
            ['CFG Scale', cfg],
            ['Denoise', denoise],
            ['Sampler', image.sampler],
            ['Scheduler', scheduler],
            ['Clip skip', image.clip_skip],
            ['Model', image.model]
        ];

        return rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
    },

    getInfoImageResources(image = {}) {
        const metadata = image.metadata && typeof image.metadata === 'object' ? image.metadata : {};
        const resources = Array.isArray(image.resources)
            ? image.resources
            : Array.isArray(image.additionalResources)
                ? image.additionalResources
                : Array.isArray(metadata.additionalResources)
                    ? metadata.additionalResources
                    : Array.isArray(metadata.resources)
                        ? metadata.resources
                        : [];
        return resources
            .filter(resource => resource && typeof resource === 'object')
            .map(resource => {
                const modelId = resource.modelId || resource.model_id;
                const versionId = resource.modelVersionId || resource.versionId || resource.model_version_id;
                const url = resource.url
                    || resource.modelUrl
                    || getCivitaiModelUrl(modelId, versionId);
                return {
                    name: resource.name || resource.modelName || resource.model || resource.hash || 'Resource',
                    version: resource.versionName || resource.modelVersionName || resource.version || '',
                    type: resource.type || resource.modelType || resource.resourceType || '',
                    weight: resource.weight || resource.strength || resource.value || '',
                    url
                };
            })
            .filter(resource => resource.name);
    },

    renderInfoImagePreviewPrompt(label, value, copyKey) {
        const text = String(value || '').trim();
        if (!text) return '';

        return `
            <section class="mr-image-preview-card">
                <div class="mr-image-preview-card-head">
                    <h4>${this.escapeHtml(label)}</h4>
                    <button type="button" class="mr-image-preview-copy" data-copy-key="${copyKey}">
                        ${getSvgIcon('copy')} Copy
                    </button>
                </div>
                <p>${this.escapeHtml(text)}</p>
            </section>
        `;
    },

    renderInfoImagePreviewContent(preview) {
        const images = Array.isArray(preview?._images) ? preview._images : [];
        const index = Math.max(0, Math.min(images.length - 1, preview?._imageIndex || 0));
        const image = images[index] || {};
        const metadataRows = this.getInfoImageMetadataRows(image);
        const resources = this.getInfoImageResources(image);
        const hasPrevious = images.length > 1;
        const positionText = images.length > 1 ? `${index + 1} / ${images.length}` : '1 image';

        const metadataHtml = metadataRows.length
            ? metadataRows.map(([label, value]) => `
                <div class="mr-image-preview-data-row">
                    <span>${this.escapeHtml(label)}</span>
                    <strong>${this.escapeHtml(value)}</strong>
                </div>
            `).join('')
            : '<div class="mr-image-preview-empty">No generation metadata available.</div>';
        const resourcesHtml = resources.length
            ? resources.map(resource => `
                <div class="mr-image-preview-resource">
                    <div class="mr-image-preview-resource-main">
                        ${resource.url
                            ? `<a href="${this.escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer" class="mr-image-preview-resource-name">${this.escapeHtml(resource.name)}</a>`
                            : `<strong class="mr-image-preview-resource-name">${this.escapeHtml(resource.name)}</strong>`
                        }
                        <div class="mr-image-preview-resource-badges">
                            ${resource.type ? `<span>${this.escapeHtml(resource.type)}</span>` : ''}
                            ${resource.weight !== '' ? `<span>${this.escapeHtml(resource.weight)}</span>` : ''}
                        </div>
                    </div>
                    ${resource.version
                        ? (resource.url
                            ? `<a href="${this.escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer" class="mr-image-preview-resource-version">${this.escapeHtml(resource.version)}</a>`
                            : `<div class="mr-image-preview-resource-version">${this.escapeHtml(resource.version)}</div>`
                        )
                        : ''}
                </div>
            `).join('')
            : '';

        return `
            <div class="mr-image-preview-shell" role="dialog" aria-modal="true" aria-label="Image preview">
                <div class="mr-image-preview-topbar">
                    <button type="button" class="mr-image-preview-icon-btn" data-action="close" aria-label="Close preview">${getSvgIcon('x')}</button>
                    <div class="mr-image-preview-counter">${this.escapeHtml(positionText)}</div>
                    <div class="mr-image-preview-actions">
                        ${image.civitaiUrl ? `<a class="mr-image-preview-action" href="${this.escapeHtml(image.civitaiUrl)}" target="_blank" rel="noopener noreferrer">${getSvgIcon('externalLink')} Open CivitAI</a>` : ''}
                    </div>
                </div>
                <main class="mr-image-preview-main">
                    <section class="mr-image-preview-stage">
                        ${hasPrevious ? `<button type="button" class="mr-image-preview-nav is-left" data-action="previous" aria-label="Previous image">&lsaquo;</button>` : ''}
                        <img src="${this.escapeHtml(image.url || '')}" alt="Preview image">
                        ${hasPrevious ? `<button type="button" class="mr-image-preview-nav is-right" data-action="next" aria-label="Next image">&rsaquo;</button>` : ''}
                    </section>
                    <aside class="mr-image-preview-panel">
                        <section class="mr-image-preview-card">
                            <div class="mr-image-preview-card-head">
                                <h4>Generation data</h4>
                                ${(image.positive || image.negative) ? `<button type="button" class="mr-image-preview-copy" data-copy-key="all">${getSvgIcon('copy')} Copy all</button>` : ''}
                            </div>
                            <div class="mr-image-preview-data">
                                ${metadataHtml}
                            </div>
                        </section>
                        ${resources.length ? `
                            <section class="mr-image-preview-card">
                                <div class="mr-image-preview-card-head">
                                    <h4>Resources used</h4>
                                </div>
                                <div class="mr-image-preview-resources">${resourcesHtml}</div>
                            </section>
                        ` : ''}
                        ${this.renderInfoImagePreviewPrompt('Prompt', image.positive, 'positive')}
                        ${this.renderInfoImagePreviewPrompt('Negative prompt', image.negative, 'negative')}
                    </aside>
                </main>
            </div>
        `;
    },

    openInfoImagePreview(images, startIndex = 0) {
        const imageList = (Array.isArray(images) ? images : []).filter(img => img?.url);
        if (!imageList.length) return;

        this.closeInfoImagePreview();

        const preview = document.createElement('div');
        preview.className = 'mr-image-preview-backdrop';
        preview._images = imageList;
        preview._imageIndex = Math.max(0, Math.min(imageList.length - 1, startIndex));
        preview._onKeyDown = (event) => {
            if (event.key === 'Escape') {
                this.closeInfoImagePreview(preview);
            } else if (event.key === 'ArrowLeft') {
                this.showInfoImagePreviewAt(preview, preview._imageIndex - 1);
            } else if (event.key === 'ArrowRight') {
                this.showInfoImagePreviewAt(preview, preview._imageIndex + 1);
            }
        };

        preview.addEventListener('click', async (event) => {
            if (event.target === preview) {
                this.closeInfoImagePreview(preview);
                return;
            }

            const actionEl = event.target.closest('[data-action]');
            if (actionEl && preview.contains(actionEl)) {
                const action = actionEl.dataset.action;
                if (action === 'close') {
                    this.closeInfoImagePreview(preview);
                } else if (action === 'previous') {
                    this.showInfoImagePreviewAt(preview, preview._imageIndex - 1);
                } else if (action === 'next') {
                    this.showInfoImagePreviewAt(preview, preview._imageIndex + 1);
                }
                return;
            }

            const copyBtn = event.target.closest('.mr-image-preview-copy');
            if (copyBtn && preview.contains(copyBtn)) {
                await this.copyInfoImagePreviewText(preview, copyBtn);
            }
        });

        document.body.appendChild(preview);
        document.addEventListener('keydown', preview._onKeyDown);
        this.updateInfoImagePreview(preview);
    },

    showInfoImagePreviewAt(preview, index) {
        const images = Array.isArray(preview?._images) ? preview._images : [];
        if (!preview || !images.length) return;

        preview._imageIndex = (index + images.length) % images.length;
        this.updateInfoImagePreview(preview);
    },

    updateInfoImagePreview(preview) {
        if (!preview) return;
        preview.innerHTML = this.renderInfoImagePreviewContent(preview);
        this.bindTooltips(preview);
    },

    async copyInfoImagePreviewText(preview, button) {
        const images = Array.isArray(preview?._images) ? preview._images : [];
        const image = images[preview?._imageIndex || 0] || {};
        const key = button?.dataset?.copyKey || '';
        const metadataRows = this.getInfoImageMetadataRows(image);
        const resources = this.getInfoImageResources(image);
        const text = key === 'positive'
            ? image.positive
            : key === 'negative'
                ? image.negative
                : [
                    image.positive ? `Prompt: ${image.positive}` : '',
                    image.negative ? `Negative prompt: ${image.negative}` : '',
                    ...metadataRows.map(([label, value]) => `${label}: ${value}`),
                    ...resources.map(resource => `Resource: ${[
                        resource.name,
                        resource.version,
                        resource.type,
                        resource.weight !== '' ? `strength ${resource.weight}` : ''
                    ].filter(Boolean).join(' / ')}`)
                ].filter(Boolean).join('\n');

        if (!text) return;

        try {
            await navigator.clipboard.writeText(String(text));
            button.classList.add('is-copied');
            button.innerHTML = `${getSvgIcon('copy')} Copied`;
        } catch (error) {
            console.error('Model Resolver: Failed to copy image metadata:', error);
            button.innerHTML = `${getSvgIcon('copy')} Failed`;
        }

        setTimeout(() => {
            if (button.isConnected) {
                button.classList.remove('is-copied');
                button.innerHTML = `${getSvgIcon('copy')} Copy${key === 'all' ? ' all' : ''}`;
            }
        }, 1200);
    },

    closeInfoImagePreview(preview = null) {
        const target = preview || document.querySelector('.mr-image-preview-backdrop');
        if (!target) return;

        if (target._onKeyDown) {
            document.removeEventListener('keydown', target._onKeyDown);
            target._onKeyDown = null;
        }

        target.remove();
    },

    async showSourceModelDetails(model = {}) {
        if (!this.canShowSourceDetails(model)) {
            this.showNotification?.('No detailed source page is available for this model.', 'info');
            return;
        }

        this.closeSourceModelDetails();

        const details = document.createElement('div');
        details.className = 'mr-model-details-backdrop';
        details._sourceModel = model;
        details.innerHTML = this.renderSourceModelDetailsLoading(model);
        document.body.appendChild(details);
        this.bindSourceModelDetailsEvents(details);

        try {
            const tokens = this.getStoredTokens?.() || {};
            const data = await this.fetchJson('/model_resolver/model-details', {
                method: 'POST',
                body: JSON.stringify({
                    source: model.details_source || model.source,
                    model_id: model.model_id || model.modelId,
                    version_id: model.version_id || model.versionId,
                    civitai_key: tokens.civitai_key || ''
                })
            }, 'Fetch model details');
            details._detailsData = data;
            details._selectedVersionId = String(data.selected_version?.id || data.version_id || '');
            details.innerHTML = this.renderSourceModelDetails(data, model);
            this.bindSourceModelDetailsEvents(details);
            this.bindTooltips(details);
        } catch (error) {
            console.error('Model Resolver: model details error:', error);
            details.innerHTML = this.renderSourceModelDetailsError(error);
            this.bindSourceModelDetailsEvents(details);
        }
    },

    closeSourceModelDetails() {
        document.querySelectorAll('.mr-model-details-backdrop').forEach(element => element.remove());
    },

    renderSourceModelDetailsLoading(model = {}) {
        const title = model.name || model.model_name || model.filename || 'Model details';
        return `
            <div class="mr-model-details-shell">
                <div class="mr-model-details-topbar">
                    <button type="button" class="mr-model-details-icon-btn" data-action="close" aria-label="Close">${getSvgIcon('x')}</button>
                    <div class="mr-model-details-title">
                        <h2>${this.escapeHtml(title)}</h2>
                        <span>${this.escapeHtml(model.details_source || model.source || '')}</span>
                    </div>
                </div>
                <div class="mr-model-details-loading">Loading model details...</div>
            </div>
        `;
    },

    renderSourceModelDetailsError(error) {
        return `
            <div class="mr-model-details-shell">
                <div class="mr-model-details-topbar">
                    <button type="button" class="mr-model-details-icon-btn" data-action="close" aria-label="Close">${getSvgIcon('x')}</button>
                    <div class="mr-model-details-title">
                        <h2>Model details</h2>
                        <span>Error</span>
                    </div>
                </div>
                <div class="mr-model-details-loading mr-model-details-error">
                    ${this.escapeHtml(error?.message || 'Failed to load model details.')}
                </div>
            </div>
        `;
    },

    async fetchSourceModelDetailsVersion(details, versionId) {
        if (!details?._detailsData || !versionId) return;

        try {
            const data = details._detailsData;
            const tokens = this.getStoredTokens?.() || {};
            const fresh = await this.fetchJson('/model_resolver/model-details', {
                method: 'POST',
                body: JSON.stringify({
                    source: data.source || details._sourceModel?.details_source || details._sourceModel?.source,
                    model_id: data.model_id || details._sourceModel?.model_id || details._sourceModel?.modelId,
                    version_id: versionId,
                    civitai_key: tokens.civitai_key || ''
                })
            }, 'Fetch model version details');
            const freshVersion = fresh.selected_version;
            if (!freshVersion?.id) return;

            data.versions = (data.versions || []).map(version =>
                String(version.id) === String(freshVersion.id)
                    ? { ...version, ...freshVersion }
                    : version
            );
            data.selected_version = data.versions.find(version => String(version.id) === String(freshVersion.id)) || freshVersion;
            if (String(details._selectedVersionId || '') !== String(freshVersion.id)) return;

            details.innerHTML = this.renderSourceModelDetails(data, details._sourceModel || {});
            this.bindTooltips(details);
        } catch (error) {
            console.error('Model Resolver: failed to fetch source model version details:', error);
            this.showNotification?.('Failed to load this model version.', 'error');
        }
    },

    renderSourceModelDetails(data = {}, contextModel = {}) {
        const versions = Array.isArray(data.versions) ? data.versions : [];
        const selectedVersionId = String(data.selected_version?.id || data.version_id || versions[0]?.id || '');
        const selectedVersion = versions.find(version => String(version.id) === selectedVersionId) || data.selected_version || versions[0] || {};
        const images = (Array.isArray(selectedVersion.images) && selectedVersion.images.length ? selectedVersion.images : data.images || []).filter(img => img?.url).slice(0, 12);
        const stats = data.stats || {};
        const versionStats = selectedVersion.stats || {};
        const tags = Array.isArray(data.tags) ? data.tags.slice(0, 12) : [];
        const trainedWords = this.normalizeTrainedWords(selectedVersion.trained_words || []);
        const description = data.description || selectedVersion.description || '';
        const sanitizedDescription = description ? this.sanitizeDescriptionHtml(description) : '';
        const source = data.source || contextModel.details_source || contextModel.source || '';
        const creator = data.creator || {};
        const creatorName = creator.username || creator.name || '';
        const pageUrl = data.version_url || data.url || '';
        const civitaiUrl = this.getSourceModelCivitaiUrl(data, selectedVersion, contextModel);
        const showCivitaiAction = civitaiUrl && civitaiUrl !== pageUrl;

        const statItems = [
            ['Downloads', stats.downloadCount || stats.downloads || versionStats.downloadCount || versionStats.downloads],
            ['Thumbs Up', stats.thumbsUpCount || versionStats.thumbsUpCount],
            ['Rating', stats.rating || versionStats.rating],
            ['Published', selectedVersion.published_at ? this.formatDetailsDate(selectedVersion.published_at) : '']
        ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');

        return `
            <div class="mr-model-details-shell">
                <div class="mr-model-details-topbar">
                    <button type="button" class="mr-model-details-icon-btn" data-action="close" aria-label="Close">${getSvgIcon('x')}</button>
                    <div class="mr-model-details-title">
                        <h2>${this.escapeHtml(data.name || contextModel.name || 'Model')}</h2>
                        <span>${this.escapeHtml([source, data.type, creatorName].filter(Boolean).join(' / '))}</span>
                    </div>
                    <div class="mr-model-details-actions">
                        ${showCivitaiAction ? `<a class="mr-model-details-action" href="${this.escapeHtml(civitaiUrl)}" target="_blank" rel="noopener noreferrer">${getSvgIcon('civitai')} View on CivitAI</a>` : ''}
                        ${pageUrl ? `<a class="mr-model-details-action" href="${this.escapeHtml(pageUrl)}" target="_blank" rel="noopener noreferrer">${getSvgIcon('externalLink')} Open page</a>` : ''}
                    </div>
                </div>
                <div class="mr-model-details-main">
                    <section class="mr-model-details-content">
                        <div class="mr-model-details-version-tabs">
                            ${versions.map(version => `
                                <button type="button" class="mr-model-details-version-tab ${String(version.id) === selectedVersionId ? 'is-active' : ''}" data-version-id="${this.escapeHtml(version.id)}">
                                    <span>${this.escapeHtml(version.name || `Version ${version.id || ''}`)}</span>
                                    ${version.base_model ? `<small>${this.escapeHtml(version.base_model)}</small>` : ''}
                                </button>
                            `).join('')}
                        </div>
                        <div class="mr-model-details-gallery ${images.length === 1 ? 'is-single' : ''}">
                            ${images.length > 1 ? `<button type="button" class="mr-model-details-gallery-nav is-left" data-gallery-direction="-1" aria-label="Previous images">&lsaquo;</button>` : ''}
                            <div class="mr-model-details-gallery-strip">
                                ${images.length ? images.map((image, index) => `
                                    <button type="button" class="mr-model-details-image" style="${this.getSourceModelImageSizingStyle(image)}" data-image-index="${index}">
                                        <img src="${this.escapeHtml(image.url)}" alt="Example image" loading="lazy" draggable="false">
                                        ${this.renderSourceModelImageMeta(image)}
                                    </button>
                                `).join('') : '<div class="mr-model-details-empty">No example images available.</div>'}
                            </div>
                            ${images.length > 1 ? `<button type="button" class="mr-model-details-gallery-nav is-right" data-gallery-direction="1" aria-label="Next images">&rsaquo;</button>` : ''}
                        </div>
                        <div class="mr-model-details-description">
                            <h3>About</h3>
                            ${sanitizedDescription ? sanitizedDescription : '<p>No description available.</p>'}
                        </div>
                    </section>
                    <aside class="mr-model-details-side">
                        <section class="mr-model-details-panel">
                            <h3>Details</h3>
                            <div class="mr-model-details-kv">
                                <div><span>Type</span><strong>${this.escapeHtml(data.type || '-')}</strong></div>
                                <div><span>Base Model</span><strong>${this.escapeHtml(selectedVersion.base_model || '-')}</strong></div>
                                <div><span>Version</span><strong>${this.escapeHtml(selectedVersion.name || selectedVersion.id || '-')}</strong></div>
                                ${statItems.map(([label, value]) => `<div><span>${this.escapeHtml(label)}</span><strong>${this.escapeHtml(value)}</strong></div>`).join('')}
                            </div>
                            ${tags.length ? `<div class="mr-model-details-tags">${tags.map(tag => `<span>${this.escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                        </section>
                        ${trainedWords.length ? `
                            <section class="mr-model-details-panel">
                                <h3>Trained Words</h3>
                                <div class="mr-model-details-tags">${trainedWords.map(word => `<span>${this.escapeHtml(word)}</span>`).join('')}</div>
                            </section>
                        ` : ''}
                        <section class="mr-model-details-panel">
                            <h3>Download Variants</h3>
                            <div class="mr-model-details-files">
                                ${this.renderSourceModelDetailsFiles(selectedVersion, data, contextModel)}
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        `;
    },

    getSourceModelCivitaiUrl(data = {}, selectedVersion = {}, contextModel = {}) {
        const modelId = selectedVersion.civitai_model_id
            || selectedVersion.civitaiModelId
            || data.civitai_model_id
            || data.civitaiModelId
            || contextModel.civitai_model_id
            || contextModel.civitaiModelId;
        const versionId = selectedVersion.civitai_model_version_id
            || selectedVersion.civitaiModelVersionId
            || data.civitai_model_version_id
            || data.civitaiModelVersionId
            || contextModel.civitai_model_version_id
            || contextModel.civitaiModelVersionId;

        if (modelId) {
            return getCivitaiModelUrl(modelId, versionId);
        }

        const explicitUrl = selectedVersion.platform_url
            || selectedVersion.platformUrl
            || data.platform_url
            || data.platformUrl
            || contextModel.platform_url
            || contextModel.platformUrl;
        const value = String(explicitUrl || '').trim();
        if (!/^https?:\/\//i.test(value)) return '';

        try {
            const url = new URL(value);
            const host = url.hostname.toLowerCase().replace(/^www\./, '');
            if (host !== 'civitai.com' && host !== 'civitai.red') return '';
            url.hostname = 'civitai.com';
            return url.toString();
        } catch (error) {
            return /civitai\.(?:com|red)\//i.test(value)
                ? value.replace('civitai.red', 'civitai.com')
                : '';
        }
    },

    renderSourceModelDetailsFiles(version = {}, data = {}, contextModel = {}) {
        const files = Array.isArray(version.files) ? version.files.filter(file => file?.download_url) : [];
        if (!files.length) {
            return '<div class="mr-model-details-empty">No downloadable files available for this version.</div>';
        }

        const targetIndex = files.findIndex(file => this.isSourceModelDetailsTargetFile(file, contextModel));
        const orderedFiles = targetIndex > 0
            ? [files[targetIndex], ...files.filter((_, index) => index !== targetIndex)]
            : files;

        return orderedFiles.map((file, index) => {
            const isTarget = this.isSourceModelDetailsTargetFile(file, contextModel);
            const fileMeta = this.getSourceModelFileMeta(file);
            const mirrors = this.getSourceModelMirrors(file);
            const preferredMirror = this.getSourceModelPreferredMirror(file, contextModel, mirrors);
            const preferredDownloadUrl = preferredMirror?.url || file.download_url;
            const preferredFilename = preferredMirror?.filename || file.name || contextModel.filename || data.name || 'model';
            const fileHash = this.getSourceModelFileHash(file);
            const fileHashes = file.hashes && typeof file.hashes === 'object'
                ? { ...file.hashes }
                : (fileHash ? { SHA256: fileHash } : {});
            const selectedFile = {
                ...file,
                name: preferredFilename,
                filename: preferredFilename,
                download_url: preferredDownloadUrl
            };
            if (fileHash) {
                selectedFile.sha256 = selectedFile.sha256 || fileHash;
                selectedFile.hash = selectedFile.hash || fileHash;
            }
            if (Object.keys(fileHashes).length) {
                selectedFile.hashes = { ...fileHashes };
            }
            const selectedVersion = {
                id: version.id || data.version_id || contextModel.version_id,
                name: version.name || '',
                base_model: version.base_model || contextModel.base_model || '',
                trained_words: version.trained_words || version.trainedWords || [],
                files: [selectedFile]
            };
            const payload = {
                source: data.source || contextModel.details_source || contextModel.source,
                model_id: data.model_id || contextModel.model_id,
                version_id: version.id || data.version_id || contextModel.version_id,
                name: data.name || contextModel.name,
                version_name: version.name || '',
                type: data.type || contextModel.type,
                filename: preferredFilename,
                download_url: preferredDownloadUrl,
                url: version.url || data.version_url || data.url,
                size: file.size,
                sha256: fileHash,
                hash: fileHash,
                hashes: Object.keys(fileHashes).length ? fileHashes : undefined,
                file_info: selectedFile,
                file: selectedFile,
                selected_file: selectedFile,
                selected_version: selectedVersion,
                base_model: version.base_model || contextModel.base_model,
                tags: data.tags || [],
                match_type: 'selected',
                confidence: 100
            };
            const mirrorList = mirrors.length > 1
                ? this.renderSourceModelMirrors(mirrors, payload)
                : '';
            const summaryBadges = [
                isTarget ? 'Matched' : '',
                file.primary ? 'Primary' : '',
                mirrors.length ? `${mirrors.length} mirrors` : ''
            ].filter(Boolean);
            const openAttr = index === 0 ? ' open' : '';
            return `
                <details class="mr-model-details-file ${file.primary ? 'is-primary' : ''} ${isTarget ? 'is-target' : ''}"${openAttr}>
                    <summary class="mr-model-details-file-summary">
                        <span class="mr-model-details-file-chevron" aria-hidden="true"></span>
                        <span class="mr-model-details-file-heading">
                            <strong>${this.escapeHtml(file.name || `File ${index + 1}`)}</strong>
                            <span>${this.escapeHtml(fileMeta.summary)}</span>
                        </span>
                        ${summaryBadges.length ? `<span class="mr-model-details-file-summary-badges">${summaryBadges.map(badge => `<span>${this.escapeHtml(badge)}</span>`).join('')}</span>` : ''}
                    </summary>
                    <div class="mr-model-details-file-body">
                        ${fileMeta.badges.length ? `<div class="mr-model-details-file-badges">${fileMeta.badges.map(badge => `<span>${this.escapeHtml(badge)}</span>`).join('')}</div>` : ''}
                        <button type="button" class="mr-btn mr-btn-primary mr-model-details-use" data-selection="${this.escapeHtml(encodeURIComponent(JSON.stringify(payload)))}">
                            ${isTarget ? 'Use matched file' : 'Use this file'}
                        </button>
                        ${mirrorList}
                    </div>
                </details>
            `;
        }).join('');
    },

    isSourceModelDetailsTargetFile(file = {}, contextModel = {}) {
        const targetFilename = this.getSourceModelComparableFilename(contextModel.filename || contextModel.original_path || '');
        const targetUrl = String(contextModel.download_url || contextModel.url || '').trim();
        const targetHash = String(contextModel.sha256 || contextModel.hash || '').trim().toLowerCase();
        const fileHash = this.getSourceModelFileHash(file);
        if (targetHash && fileHash && targetHash === fileHash) return true;

        const urls = this.getSourceModelFileUrls(file);
        if (targetUrl && urls.some(url => url === targetUrl)) return true;

        if (!targetFilename) return false;
        return this.getSourceModelFileNames(file).some(name => (
            this.getSourceModelComparableFilename(name) === targetFilename
        ));
    },

    getSourceModelPreferredMirror(file = {}, contextModel = {}, mirrors = null) {
        const candidates = Array.isArray(mirrors) ? mirrors : this.getSourceModelMirrors(file);
        const targetUrl = String(contextModel.download_url || contextModel.url || '').trim();
        if (targetUrl) {
            const byUrl = candidates.find(mirror => String(mirror.url || '') === targetUrl);
            if (byUrl) return byUrl;
        }

        const targetFilename = this.getSourceModelComparableFilename(contextModel.filename || contextModel.original_path || '');
        if (targetFilename) {
            const byName = candidates.find(mirror => (
                this.getSourceModelComparableFilename(mirror.filename || mirror.name || '') === targetFilename
            ));
            if (byName) return byName;
        }

        return null;
    },

    getSourceModelComparableFilename(value = '') {
        return String(value || '')
            .split(/[\\/]+/)
            .pop()
            .trim()
            .toLowerCase();
    },

    getSourceModelFileHash(file = {}) {
        const hashes = file.hashes && typeof file.hashes === 'object' ? file.hashes : {};
        return String(file.sha256 || file.hash || hashes.SHA256 || hashes.sha256 || '').trim().toLowerCase();
    },

    getSourceModelFileNames(file = {}) {
        const names = new Set();
        [file.name, file.filename].forEach(name => {
            if (name) names.add(String(name));
        });
        const mirrors = Array.isArray(file.mirrors) ? file.mirrors : [];
        mirrors.forEach(mirror => {
            if (mirror?.filename) names.add(String(mirror.filename));
            if (mirror?.name) names.add(String(mirror.name));
        });
        return Array.from(names);
    },

    getSourceModelFileUrls(file = {}) {
        const urls = new Set();
        [file.download_url, file.downloadUrl, file.url].forEach(url => {
            if (url) urls.add(String(url));
        });
        const downloadUrls = Array.isArray(file.download_urls) ? file.download_urls : [];
        downloadUrls.forEach(url => {
            if (url) urls.add(String(url));
        });
        const mirrors = Array.isArray(file.mirrors) ? file.mirrors : [];
        mirrors.forEach(mirror => {
            if (mirror?.url) urls.add(String(mirror.url));
        });
        return Array.from(urls);
    },

    getSourceModelMirrors(file = {}) {
        const mirrors = Array.isArray(file.mirrors)
            ? file.mirrors.filter(mirror => mirror?.url)
            : [];
        const downloadUrls = Array.isArray(file.download_urls) ? file.download_urls.filter(Boolean) : [];
        const seen = new Set();
        const normalized = [];

        for (const mirror of mirrors) {
            const url = String(mirror.url || '');
            if (!url || seen.has(url)) continue;
            seen.add(url);
            normalized.push({
                ...mirror,
                url,
                filename: mirror.filename || file.name,
                is_dead: Boolean(mirror.is_dead || mirror.isDead || mirror.deleted_at || mirror.deletedAt)
            });
        }

        for (const url of downloadUrls) {
            const value = String(url || '');
            if (!value || seen.has(value)) continue;
            seen.add(value);
            normalized.push({
                url: value,
                filename: file.name,
                source: this.getSourceModelMirrorHost(value),
                is_dead: false
            });
        }

        return normalized;
    },

    renderSourceModelMirrors(mirrors = [], basePayload = {}) {
        if (!mirrors.length) return '';
        const groups = this.groupSourceModelMirrors(mirrors);
        return `
            <div class="mr-model-details-mirrors">
                <div class="mr-model-details-mirrors-title">Mirrors</div>
                ${groups.map(group => `
                    <div class="mr-model-details-mirror-group">
                        <div class="mr-model-details-mirror-group-title">
                            <span class="mr-model-details-mirror-platform-icon">${this.getSourceModelMirrorIcon(group.label)}</span>
                            <span>${this.escapeHtml(group.label)} (${group.items.length} ${group.items.length === 1 ? 'mirror' : 'mirrors'})</span>
                        </div>
                        <div class="mr-model-details-mirror-list">
                            ${group.items.map((mirror) => {
                                const mirrorHash = this.getSourceModelFileHash(mirror) || basePayload.sha256 || basePayload.hash || '';
                                const mirrorHashes = mirror.hashes && typeof mirror.hashes === 'object'
                                    ? { ...mirror.hashes }
                                    : (
                                        basePayload.hashes && typeof basePayload.hashes === 'object'
                                            ? { ...basePayload.hashes }
                                            : (mirrorHash ? { SHA256: mirrorHash } : {})
                                    );
                                const mirrorFilename = mirror.filename || basePayload.filename || 'Download mirror';
                                const mirrorFileInfo = {
                                    ...(basePayload.file_info && typeof basePayload.file_info === 'object' ? basePayload.file_info : {}),
                                    ...mirror,
                                    name: mirrorFilename,
                                    filename: mirrorFilename,
                                    download_url: mirror.url,
                                    url: mirror.url
                                };
                                if (mirrorHash) {
                                    mirrorFileInfo.sha256 = mirrorFileInfo.sha256 || mirrorHash;
                                    mirrorFileInfo.hash = mirrorFileInfo.hash || mirrorHash;
                                }
                                if (Object.keys(mirrorHashes).length) {
                                    mirrorFileInfo.hashes = { ...mirrorHashes };
                                }
                                const mirrorSelectedVersion = basePayload.selected_version && typeof basePayload.selected_version === 'object'
                                    ? {
                                        ...basePayload.selected_version,
                                        files: [mirrorFileInfo]
                                    }
                                    : undefined;
                                const payload = {
                                    ...basePayload,
                                    download_url: mirror.url,
                                    filename: mirrorFilename,
                                    mirror_source: mirror.source || this.getSourceModelMirrorHost(mirror.url),
                                    mirror_index: mirror._index,
                                    sha256: mirrorHash,
                                    hash: mirrorHash,
                                    hashes: Object.keys(mirrorHashes).length ? mirrorHashes : undefined,
                                    file_info: mirrorFileInfo,
                                    file: mirrorFileInfo,
                                    selected_file: mirrorFileInfo,
                                    selected_version: mirrorSelectedVersion
                                };
                                const meta = this.getSourceModelMirrorMeta(mirror, mirror._index === 0);
                                const isDead = this.isSourceModelMirrorDead(mirror);
                                const isGated = this.isSourceModelMirrorGated(mirror);
                                const title = isDead ? 'Likely dead link' : (isGated ? 'Gated Download' : 'Download file');
                                const actionIcon = getSvgIcon(isDead ? 'skull' : (isGated ? 'shield' : 'download'));
                                const rowClass = [
                                    isDead ? 'is-dead' : '',
                                    isGated && !isDead ? 'is-gated' : ''
                                ].filter(Boolean).map(value => ` ${value}`).join('');
                                const payloadData = this.escapeHtml(encodeURIComponent(JSON.stringify(payload)));
                                return `
                                    <button type="button"
                                        class="mr-model-details-mirror${rowClass} mr-model-details-use"
                                        title="${this.escapeHtml(title)}"
                                        data-tooltip="${this.escapeHtml(title)}"
                                        data-selection="${payloadData}">
                                        <div class="mr-model-details-mirror-info">
                                            <strong>${this.escapeHtml(mirror.filename || basePayload.filename || 'Download mirror')}</strong>
                                            ${meta ? `<small>${this.escapeHtml(meta)}</small>` : ''}
                                        </div>
                                        <span class="mr-model-details-mirror-action" aria-hidden="true">${actionIcon}</span>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    groupSourceModelMirrors(mirrors = []) {
        const groups = new Map();
        mirrors.forEach((mirror, index) => {
            const label = this.getSourceModelMirrorSourceLabel(mirror, index);
            if (!groups.has(label)) {
                groups.set(label, { label, items: [] });
            }
            groups.get(label).items.push({ ...mirror, _index: index });
        });
        return Array.from(groups.values());
    },

    getSourceModelMirrorIcon(label = '') {
        const normalized = String(label || '').toLowerCase();
        if (normalized.includes('huggingface')) return getSvgIcon('huggingface');
        if (normalized.includes('civitai')) return getSvgIcon('civitai');
        return getSvgIcon('globe');
    },

    isSourceModelMirrorDead(mirror = {}) {
        return Boolean(mirror.is_dead || mirror.isDead || mirror.deleted_at || mirror.deletedAt);
    },

    isSourceModelMirrorGated(mirror = {}) {
        return Boolean(mirror.is_gated || mirror.isGated || mirror.gated);
    },

    getSourceModelMirrorHost(url = '') {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (error) {
            return '';
        }
    },

    getSourceModelMirrorSourceLabel(mirror = {}, index = 0) {
        const source = String(mirror.source || '').trim();
        if (source) return source;
        const host = this.getSourceModelMirrorHost(mirror.url || '');
        if (host.includes('huggingface.co')) return 'HuggingFace';
        if (host.includes('civitai.com')) return 'CivitAI';
        return host || `Mirror ${index + 1}`;
    },

    getSourceModelMirrorMeta(mirror = {}, isDefault = false) {
        const host = this.getSourceModelMirrorHost(mirror.url || '');
        const mirrorHash = this.getSourceModelDisplayHash(mirror);
        const meta = [
            isDefault ? 'Default' : '',
            this.isSourceModelMirrorDead(mirror) ? 'Likely dead' : '',
            host,
            this.isSourceModelMirrorGated(mirror) ? 'Gated' : '',
            mirror.is_paid ? 'Paid' : '',
            mirrorHash ? `SHA256 ${mirrorHash}` : ''
        ].filter(Boolean);
        return meta.join(' / ');
    },

    getSourceModelFileMeta(file = {}) {
        const metadata = file.metadata && typeof file.metadata === 'object' ? file.metadata : {};
        const mirrorCount = Array.isArray(file.mirrors) && file.mirrors.length
            ? file.mirrors.length
            : file.mirror_count;
        const badges = [
            file.primary ? 'Primary' : '',
            file.type || '',
            metadata.format || '',
            metadata.size || '',
            metadata.fp || '',
            mirrorCount ? `${mirrorCount} mirrors` : '',
            file.id ? `ID ${file.id}` : ''
        ].filter(Boolean);
        const fileHash = this.getSourceModelDisplayHash(file);
        const summary = [
            this.formatSearchResultSize(file),
            fileHash ? `SHA256 ${fileHash}` : ''
        ].filter(Boolean).join(' / ') || 'Downloadable file';

        return { badges, summary };
    },

    getSourceModelDisplayHash(value = {}) {
        const hashes = value.hashes && typeof value.hashes === 'object' ? value.hashes : {};
        return String(value.sha256 || value.hash || hashes.SHA256 || hashes.sha256 || '').trim();
    },

    renderSourceModelImageMeta(image = {}) {
        const stats = image.stats || {};
        const metaItems = [
            ['Like', image.likeCount || image.likes || stats.likeCount || stats.likes],
            ['Love', image.heartCount || image.reactions || stats.heartCount],
            ['Comments', image.commentCount || stats.commentCount],
            ['Buzz', image.buzzCount || stats.buzzCount]
        ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');

        if (!metaItems.length) return '';

        return `
            <span class="mr-model-details-image-meta">
                ${metaItems.map(([label, value]) => `<span>${this.escapeHtml(label)} ${this.escapeHtml(value)}</span>`).join('')}
            </span>
        `;
    },

    getSourceModelImageSizingStyle(image = {}) {
        const width = Number(image.width || image.metadata?.width || 0);
        const height = Number(image.height || image.metadata?.height || 0);
        const ratio = width > 0 && height > 0 ? width / height : 0.72;
        const clampedRatio = Math.max(0.48, Math.min(1.85, ratio));
        const preferredHeight = Math.max(
            320,
            Math.min(
                560,
                Math.round(430 + Math.max(0, 1 - clampedRatio) * 150 - Math.max(0, clampedRatio - 1) * 70)
            )
        );
        let preferredWidth = Math.round(preferredHeight * clampedRatio);
        if (preferredWidth < 220) {
            preferredWidth = 220;
        } else if (preferredWidth > 640) {
            preferredWidth = 640;
        }
        const adjustedHeight = Math.round(preferredWidth / clampedRatio);
        return `--mr-image-ratio:${clampedRatio.toFixed(3)}; --mr-image-width:${preferredWidth}px; --mr-image-height:${adjustedHeight}px;`;
    },

    bindSourceModelDetailsEvents(details) {
        if (!details) return;
        if (details.dataset.modelDetailsBound === 'true') return;
        details.dataset.modelDetailsBound = 'true';
        details.addEventListener('click', (event) => {
            if (event.target === details) {
                this.closeSourceModelDetails();
                return;
            }

            const actionEl = event.target.closest('[data-action]');
            if (actionEl?.dataset.action === 'close') {
                this.closeSourceModelDetails();
                return;
            }

            const versionTab = event.target.closest('.mr-model-details-version-tab');
            if (versionTab && details.contains(versionTab)) {
                details._selectedVersionId = String(versionTab.dataset.versionId || '');
                const data = details._detailsData;
                if (data) {
                    const selected = (data.versions || []).find(version => String(version.id) === details._selectedVersionId) || data.selected_version;
                    data.selected_version = selected;
                    details.innerHTML = this.renderSourceModelDetails(data, details._sourceModel || {});
                    this.bindTooltips(details);

                    if (selected?.id && (!Array.isArray(selected.files) || !selected.files.length)) {
                        this.fetchSourceModelDetailsVersion(details, selected.id);
                    }
                }
                return;
            }

            const galleryNav = event.target.closest('.mr-model-details-gallery-nav');
            if (galleryNav && details.contains(galleryNav)) {
                const strip = galleryNav.closest('.mr-model-details-gallery')?.querySelector('.mr-model-details-gallery-strip');
                if (!strip) return;
                const direction = Number(galleryNav.dataset.galleryDirection || 1);
                strip.scrollBy({
                    left: direction * Math.max(260, Math.round(strip.clientWidth * 0.82)),
                    behavior: 'smooth'
                });
                return;
            }

            const imageBtn = event.target.closest('.mr-model-details-image');
            if (imageBtn && details.contains(imageBtn)) {
                if (details._detailsGalleryDraggedUntil && Date.now() < details._detailsGalleryDraggedUntil) {
                    return;
                }
                const data = details._detailsData || {};
                const version = data.selected_version || {};
                const images = (Array.isArray(version.images) && version.images.length ? version.images : data.images || []).filter(img => img?.url);
                const index = parseInt(imageBtn.dataset.imageIndex || '0', 10);
                this.openInfoImagePreview(images, Number.isNaN(index) ? 0 : index);
                return;
            }

            const useBtn = event.target.closest('.mr-model-details-use');
            if (useBtn && details.contains(useBtn)) {
                try {
                    const selection = JSON.parse(decodeURIComponent(useBtn.dataset.selection || ''));
                    this.applySourceModelDetailsSelection(selection, details._sourceModel || {});
                    this.closeSourceModelDetails();
                } catch (error) {
                    console.error('Model Resolver: failed to apply model detail selection:', error);
                    this.showNotification?.('Failed to select this model version.', 'error');
                }
            }
        });

        details.addEventListener('pointerdown', (event) => {
            const strip = event.target.closest?.('.mr-model-details-gallery-strip');
            if (!strip || !details.contains(strip) || event.button > 0) return;

            const startX = event.clientX;
            const startScrollLeft = strip.scrollLeft;
            let moved = false;
            strip.classList.add('is-dragging');
            strip.setPointerCapture?.(event.pointerId);

            const onPointerMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                if (Math.abs(delta) > 4) {
                    moved = true;
                    details._detailsGalleryDraggedUntil = Date.now() + 250;
                }
                strip.scrollLeft = startScrollLeft - delta;
            };

            const finishDrag = () => {
                strip.classList.remove('is-dragging');
                strip.removeEventListener('pointermove', onPointerMove);
                strip.removeEventListener('pointerup', finishDrag);
                strip.removeEventListener('pointercancel', finishDrag);
                if (moved) {
                    details._detailsGalleryDraggedUntil = Date.now() + 250;
                }
            };

            strip.addEventListener('pointermove', onPointerMove);
            strip.addEventListener('pointerup', finishDrag, { once: true });
            strip.addEventListener('pointercancel', finishDrag, { once: true });
        });
    },

    applySourceModelDetailsSelection(selection = {}, contextModel = {}) {
        const missing = this.getMissingByKey(contextModel.missing_key || contextModel.missingKey || '');
        if (!missing || !selection.download_url) {
            this.showNotification?.('Cannot apply this version to the current missing model.', 'error');
            return;
        }

        const sourceKey = String(selection.source || contextModel.details_source || contextModel.source || '').toLowerCase();
        const selectedBaseModel = selection.base_model || contextModel.base_model || '';
        const selectionHashes = selection.hashes && typeof selection.hashes === 'object' ? selection.hashes : {};
        const selectionFile = selection.file_info || selection.selected_file || selection.file || null;
        const selectionFileHashes = selectionFile?.hashes && typeof selectionFile.hashes === 'object' ? selectionFile.hashes : {};
        const selectionSha256 = this.getSourceModelFileHash?.(selection)
            || this.getSourceModelFileHash?.(selectionFile || {})
            || String(selection.sha256 || selection.hash || selectionHashes.SHA256 || selectionHashes.sha256 || selectionFileHashes.SHA256 || selectionFileHashes.sha256 || '').trim();
        const selectionSelectedVersion = selection.selected_version || selection.selectedVersion || null;
        const sourceResult = {
            source: sourceKey,
            model_id: selection.model_id,
            version_id: selection.version_id,
            name: selection.name,
            version_name: selection.version_name,
            type: selection.type,
            filename: selection.filename,
            url: selection.url,
            download_url: selection.download_url,
            size: selection.size,
            base_model: selectedBaseModel,
            sha256: selectionSha256,
            hash: selectionSha256,
            tags: selection.tags || [],
            match_type: selection.match_type || 'selected',
            confidence: selection.confidence || 100,
            searchedAt: new Date().toISOString()
        };
        if (Object.keys(selectionHashes).length) sourceResult.hashes = selectionHashes;
        if (selectionFile && typeof selectionFile === 'object') {
            sourceResult.file_info = selectionFile;
            sourceResult.file = selectionFile;
            sourceResult.selected_file = selectionFile;
        }
        if (selectionSelectedVersion && typeof selectionSelectedVersion === 'object') {
            sourceResult.selected_version = selectionSelectedVersion;
        }

        missing.download_source = {
            ...sourceResult,
            url: sourceResult.download_url,
            model_url: sourceResult.url,
            directory: missing.category || 'checkpoints'
        };

        const state = this.getSearchState?.(missing);
        if (state?.results && sourceKey) {
            state.results[sourceKey] = sourceResult;
        }
        missing.civitai_info = {
            ...(missing.civitai_info || {}),
            model_name: selection.name || missing.civitai_info?.model_name,
            version_name: selection.version_name || missing.civitai_info?.version_name,
            expected_filename: selection.filename || missing.civitai_info?.expected_filename,
            base_model: selectedBaseModel || missing.civitai_info?.base_model,
            tags: selection.tags || missing.civitai_info?.tags || []
        };
        if (selectedBaseModel) {
            const canonicalBaseModel = this.resolveBaseModelAlias?.(selectedBaseModel) || selectedBaseModel;
            if (state) {
                state.selectedBaseModel = canonicalBaseModel;
                state.lastAttemptBaseModelContext = canonicalBaseModel;
            }
        }

        this.refreshSearchUiForMissing?.(missing, state || null);
        this.refreshSearchBaseModelLabels?.();
        this.updateBatchFooterButtons?.();
        this.persistSearchStateForActiveWorkflow?.();
        this.syncRemoteHashMatchesForResult?.(missing, sourceResult, { sourceKey })
            ?.catch?.(error => {
                console.warn('Model Resolver: failed to sync selected model hash:', error);
            });
        this.showNotification?.(`Selected ${selection.filename || selection.name || 'model version'}.`, 'success');
    },

    formatDetailsDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },

    /**
     * Update the info dialog with error
     */
    updateInfoDialogError(dialog, message) {
        const civitaiLink = dialog.querySelector('.mr-info-civitai-link');
        if (civitaiLink) {
            civitaiLink.innerHTML = `<span class="mr-info-error">${message}</span>`;
        }
    },

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
        if (dialog?._onInfoDialogKeyDown) {
            document.removeEventListener('keydown', dialog._onInfoDialogKeyDown);
            dialog._onInfoDialogKeyDown = null;
        }
        this.saveInfoDialogSize(dialog);
        this.closeInfoImagePreview();

        if (dialog && dialog.parentNode) {
            dialog.parentNode.removeChild(dialog);
        }
    }
};
