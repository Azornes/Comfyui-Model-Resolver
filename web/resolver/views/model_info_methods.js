import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
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
        const isDownloadTableContext = model?.context_scope === 'download_table';
        const isDownloadFolderContext = model?.context_scope === 'download_folder';
        const isDownloadRootContext = model?.context_scope === 'download_root';
        const isDownloadQueueContext = model?.context_scope === 'download_queue';
        const isDownloadHistoryContext = model?.context_scope === 'download_history';
        const isFolderOnlyContext = isDownloadFolderContext || isDownloadRootContext;
        const isSourceModelContext = !isDownloadTableContext && !isFolderOnlyContext && !isDownloadQueueContext && !isDownloadHistoryContext;
        const hasLocalPath = Boolean(model?.open_path || model?.folder_path || model?.download_directory || model?.directory || model?.path || model?.resolved_path);
        const showOpenFolder = !isDownloadTableContext && hasLocalPath;
        const showSwitchWorkflow = (isDownloadQueueContext || isDownloadHistoryContext) && Boolean(this.canSwitchToDownloadWorkflow?.(model));
        this.setContextMenuItemVisible('showInfo', isSourceModelContext);
        this.setContextMenuItemVisible('showMore', canShowMore);
        this.setContextMenuItemVisible('civitai', isSourceModelContext);
        this.setContextMenuItemVisible('switchWorkflow', showSwitchWorkflow);
        this.setContextMenuItemVisible('openFolder', showOpenFolder);
        this.setContextMenuDividerVisible('source', isSourceModelContext || canShowMore);
        this.setContextMenuDividerVisible('workflow', showSwitchWorkflow && (isSourceModelContext || canShowMore));
        this.setContextMenuDividerVisible('folder', showOpenFolder && (isSourceModelContext || canShowMore || showSwitchWorkflow));

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

        if (action === 'civitai') {
            this.openInCivitAI(model);
        } else if (action === 'openFolder') {
            this.openContainingFolder(model);
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
            const searchName = name.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
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
            return `https://civitai.com/models/${modelId}${versionId ? `?modelVersionId=${versionId}` : ''}`;
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

        // Fetch CivitAI info
        this.fetchModelInfoForDialog(loraName, modelData, dialog);
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
        const loraDisplayName = loraName.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');

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

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    escapeJsString(value) {
        return this.escapeHtml(JSON.stringify(String(value ?? '')));
    },

    truncateText(value, maxLength = 160) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
    },

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
            const normalizedFullPath = String(fullPath || '').replace(/\\/g, '/');
            const lastSlash = normalizedFullPath.lastIndexOf('/');
            if (lastSlash > 0) {
                location = normalizedFullPath.slice(0, lastSlash + 1);
            }
        }

        location = String(location || '').trim().replace(/\\/g, '/');
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
            return;
        }

        const data = dialog?._infoDialogData || {};
        const filePath = this.getInfoDialogModelFilePath(data);
        if (!filePath) {
            this.showNotification?.('No local file path available', 'error');
            return;
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
            const start = await this.fetchJson('/model_resolver/calculate-file-hash/start', {
                method: 'POST',
                body: JSON.stringify({
                    file_path: filePath,
                    metadata_path: data.metadata_path || data.metadataPath || ''
                })
            }, 'Start model hash calculation');
            const progressId = start?.progress_id;
            if (!progressId) {
                throw new Error('No progress id returned');
            }
            if (!dialog._hashCalculation) {
                dialog._hashCalculation = { progressId, cancelRequested: false };
            }
            dialog._hashCalculation.progressId = progressId;
            if (button) {
                button.dataset.progressId = progressId;
                button.textContent = 'Stop calculate';
                button.disabled = false;
            }
            if (dialog._hashCalculation.cancelRequested) {
                await this.cancelInfoDialogHashCalculation(dialog, button);
            }

            let result = null;
            for (;;) {
                await new Promise(resolve => setTimeout(resolve, 250));
                if (!dialog.isConnected) {
                    await this.cancelInfoDialogHashCalculation(dialog, button);
                    return;
                }
                const progress = await this.fetchJson(
                    `/model_resolver/calculate-file-hash/progress/${encodeURIComponent(progressId)}`,
                    { silent: true },
                    'Get model hash progress'
                );
                this.updateInfoDialogHashProgress(
                    dialog,
                    progress?.percent || 0,
                    progress?.message || ''
                );

                if (progress?.status === 'done') {
                    result = progress;
                    break;
                }
                if (progress?.status === 'cancelled') {
                    this.hideInfoDialogHashProgress(dialog);
                    if (button) {
                        button.disabled = false;
                        button.textContent = 'Calculate hash';
                        delete button.dataset.hashCalculating;
                        delete button.dataset.progressId;
                    }
                    dialog._hashCalculation = null;
                    this.showNotification?.('Hash calculation stopped.', 'info');
                    return;
                }
                if (progress?.status === 'error') {
                    throw new Error(progress.error || progress.message || 'Hash calculation failed');
                }
            }

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
        } catch (error) {
            dialog._hashCalculation = null;
            if (button) {
                button.disabled = false;
                button.textContent = 'Calculate hash';
                delete button.dataset.hashCalculating;
                delete button.dataset.progressId;
            }
            this.hideInfoDialogHashProgress(dialog);
            this.showNotification?.(`Hash calculation failed: ${error?.message || error}`, 'error');
        }
    },

    bindInfoDialogInteractions(dialog) {
        if (!dialog || dialog.dataset.mlInfoBound === 'true') return;
        dialog.dataset.mlInfoBound = 'true';

        dialog.addEventListener('click', async (event) => {
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

    /**
     * Fetch model info and update the dialog
     */
    async fetchModelInfoForDialog(loraName, modelData, dialog) {
        try {
            const resolvedPath = modelData?.resolved_path
                || modelData?.path
                || modelData?.full_path
                || modelData?.folder_path
                || modelData?.download_directory
                || '';
            const data = await this.fetchJson('/model_resolver/civitai-search', {
                method: 'POST',
                body: JSON.stringify({
                    filename: loraName,
                    category: modelData?.category || '',
                    resolved_path: resolvedPath
                })
            }, 'Fetch CivitAI model info');
            this.updateInfoDialogWithData(dialog, data);
        } catch (e) {
            this.updateInfoDialogError(dialog, 'Error fetching info from CivitAI');
        }
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

        // Update title
        const titleEl = dialog.querySelector('.mr-info-dialog-title');
        if (titleEl) {
            const modelName = data.model_name || data.modelName || 'Unknown Model';
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
            if (data.url || data.version_url) {
                const url = data.version_url || data.url;
                civitaiLinkEl.innerHTML = `
                    <a href="${url}" target="_blank" class="mr-info-link">
                        View on Civitai
                        ${getSvgIcon('externalLink', 'currentColor', 'mr-info-external-link-icon')}
                    </a>
                `;
            } else {
                const searchName = data.model_name || data.modelName || 'Unknown';
                civitaiLinkEl.innerHTML = `
                    <span class="mr-info-not-found">Model not found</span>
                    <a href="https://civitai.com/search?q=${encodeURIComponent(searchName)}" target="_blank" class="mr-info-link">
                        Search on CivitAI
                        ${getSvgIcon('externalLink', 'currentColor', 'mr-info-external-link-icon')}
                    </a>
                `;
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
                    || (modelId ? `https://civitai.com/models/${modelId}${versionId ? `?modelVersionId=${versionId}` : ''}` : '');
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
            return `https://civitai.com/models/${encodeURIComponent(modelId)}${versionId ? `?modelVersionId=${encodeURIComponent(versionId)}` : ''}`;
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
                                const payload = {
                                    ...basePayload,
                                    download_url: mirror.url,
                                    filename: mirror.filename || basePayload.filename,
                                    mirror_source: mirror.source || this.getSourceModelMirrorHost(mirror.url),
                                    mirror_index: mirror._index
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
            tags: selection.tags || [],
            match_type: selection.match_type || 'selected',
            confidence: selection.confidence || 100,
            searchedAt: new Date().toISOString()
        };

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
