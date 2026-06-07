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
        const hasLocalPath = Boolean(model?.path || model?.resolved_path);
        this.setContextMenuItemVisible('showInfo', !isDownloadTableContext);
        this.setContextMenuItemVisible('showMore', canShowMore);
        this.setContextMenuItemVisible('openFolder', !isDownloadTableContext && hasLocalPath);
        this.setContextMenuDividerVisible('source', !isDownloadTableContext || canShowMore);
        this.setContextMenuDividerVisible('folder', !isDownloadTableContext && hasLocalPath);

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
            && ['civitai', 'civarchive'].includes(source)
            && Boolean(model.model_id || model.modelId);
    },

    getMissingByKey(key = '') {
        if (!key) return null;
        return (this.missingModels || []).find(missing => this.getMissingModelKey?.(missing) === key) || null;
    },

    async openContainingFolder(model) {
        const path = model?.path || model?.resolved_path || '';
        if (!path) {
            this.showNotification('No local file path available', 'error');
            return;
        }

        try {
            const response = await api.fetchApi('/model_resolver/open-containing-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });

            if (!response.ok) {
                throw new Error(`Open folder failed: ${response.status}`);
            }
        } catch (error) {
            console.error('Model Resolver: Open folder error:', error);
            this.showNotification('Failed to open containing folder', 'error');
        }
    },

    /**
     * Open model in CivitAI
     */
    async openInCivitAI(model) {
        if (!model) return;

        const name = model.name || model.original_path?.split(/[\/\\]/).pop() || '';
        if (!name) return;

        try {
            // Search CivitAI for this model using hash (pass resolved_path for hash lookup)
            const response = await api.fetchApi('/model_resolver/civitai-search', {
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
            console.error('Model Resolver: Error searching CivitAI:', e);
            // Fall back to direct search
            const searchName = name.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');
            const searchUrl = `https://civitai.com/search?q=${encodeURIComponent(searchName)}`;
            window.open(searchUrl, '_blank');
        }
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
    createInfoDialog(loraName, modelData) {
        const loraDisplayName = loraName.replace(/\.(safetensors|ckpt|pt|pth|bin|pkl|sft|onnx|gguf)$/i, '');

        const dialog = document.createElement('div');
        dialog.className = 'mr-info-dialog-backdrop';
        dialog._selectedTrainedWords = new Set();
        dialog.innerHTML = `
            <div class="mr-info-dialog">
                <div class="mr-info-dialog-header">
                    <h3 class="mr-info-dialog-title">${loraDisplayName}</h3>
                    <button class="mr-info-dialog-close">×</button>
                </div>
                <div class="mr-info-dialog-content">
                    <div class="mr-info-dialog-loading">Loading...</div>
                    <div class="mr-info-dialog-body mr-hidden-initial">
                        <div class="mr-info-area">
                            <span class="mr-info-tag mr-info-type"></span>
                            <span class="mr-info-tag mr-info-basemodel"></span>
                        </div>
                        <table class="mr-info-table">
                            <tbody>
                                <tr class="mr-info-file-row">
                                    <td><span>File <span class="mr-tooltip-badge" data-tooltip="The model file name found locally or returned by CivitAI.">?</span></span></td>
                                    <td><span class="mr-info-file"></span></td>
                                </tr>
                                <tr class="mr-info-hash-row">
                                    <td><span>Hash (sha256) <span class="mr-tooltip-badge" data-tooltip="Unique fingerprint of the local file. Model Resolver uses it to confirm the exact CivitAI version.">?</span></span></td>
                                    <td><span class="mr-info-hash"></span></td>
                                </tr>
                                <tr class="mr-info-civitai-row">
                                    <td><span>CivitAI <span class="mr-tooltip-badge" data-tooltip="Opens the matching CivitAI model or version page when one was found.">?</span></span></td>
                                    <td><span class="mr-info-civitai-link"></span></td>
                                </tr>
                                <tr class="mr-info-name-row">
                                    <td><span>Name <span class="mr-tooltip-badge" data-tooltip="Model name from CivitAI or local metadata.">?</span></span></td>
                                    <td><span class="mr-info-name"></span></td>
                                </tr>
                                <tr class="mr-info-basemodel-row">
                                    <td><span>Base Model <span class="mr-tooltip-badge" data-tooltip="Base model this resource was made for, for example SD1.5, SDXL or Flux.">?</span></span></td>
                                    <td><span class="mr-info-base-model"></span></td>
                                </tr>
                                <tr class="mr-info-trainedwords-row mr-hidden-initial">
                                    <td>
                                        <div class="mr-info-trained-words-label">
                                            Trained Words <span class="mr-tooltip-badge" data-tooltip="Trigger words recommended by the model author. Click the words you want, then copy them into your prompt.">?</span>
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
                                    <td><span>Clip Skip <span class="mr-tooltip-badge" data-tooltip="Recommended Clip Skip value from the model author, if one is provided.">?</span></span></td>
                                    <td><span class="mr-info-clip-skip"></span></td>
                                </tr>
                                <tr class="mr-info-description-row mr-hidden-initial">
                                    <td><span>Description <span class="mr-tooltip-badge" data-tooltip="Model description from CivitAI or local metadata. Long descriptions are shortened until you click Show more.">?</span></span></td>
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

        return [];
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

    bindInfoDialogInteractions(dialog) {
        if (!dialog || dialog.dataset.mlInfoBound === 'true') return;
        dialog.dataset.mlInfoBound = 'true';

        dialog.addEventListener('click', async (event) => {
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

            const maxWidth = Math.floor(window.innerWidth * 0.9);
            const maxHeight = Math.floor(window.innerHeight * 0.8);
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
            const response = await api.fetchApi('/model_resolver/civitai-search', {
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
            console.error('Model Resolver: Error fetching model info:', e);
            this.updateInfoDialogError(dialog, 'Error fetching info');
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

        // Update file
        const fileEl = dialog.querySelector('.mr-info-file');
        if (fileEl && data.filename) {
            fileEl.textContent = data.filename;
        }

        // Update hash
        const hashEl = dialog.querySelector('.mr-info-hash');
        if (hashEl) {
            hashEl.textContent = data.sha256 || data.hash || '';
        }

        // Update CivitAI link
        const civitaiLinkEl = dialog.querySelector('.mr-info-civitai-link');
        if (civitaiLinkEl) {
            if (data.url || data.version_url) {
                const url = data.version_url || data.url;
                civitaiLinkEl.innerHTML = `
                    <a href="${url}" target="_blank" class="mr-info-link">
                        ${getSvgIcon('civitai', 'currentColor', 'mr-info-civitai-logo')}
                        View on Civitai
                    </a>
                `;
            } else {
                const searchName = data.model_name || data.modelName || 'Unknown';
                civitaiLinkEl.innerHTML = `
                    <span class="mr-info-not-found">Model not found</span>
                    <a href="https://civitai.com/search?q=${encodeURIComponent(searchName)}" target="_blank" class="mr-info-link">
                        ${this.getSearchIconHtml()} Search on CivitAI
                    </a>
                `;
            }
        }

        // Update name
        const nameEl = dialog.querySelector('.mr-info-name');
        if (nameEl) {
            nameEl.textContent = data.model_name || data.modelName || '';
        }

        // Update base model row
        const baseModelRowEl = dialog.querySelector('.mr-info-base-model');
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
        const trainedWordsEl = dialog.querySelector('.mr-info-trained-words');
        if (trainedWordsEl) {
            const words = this.normalizeTrainedWords(data.trained_words || data.trainedWords || []);
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
        const clipSkipEl = dialog.querySelector('.mr-info-clip-skip');
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
            if (img.civitaiUrl) {
                captionParts.push(`<a href="${this.escapeHtml(img.civitaiUrl)}" target="_blank" rel="noopener noreferrer" class="mr-info-image-link">civitai</a>`);
            }
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
    },

    getInfoImagePromptTags(image = {}) {
        const prompt = String(image.positive || '').trim();
        const explicitTags = Array.isArray(image.tags)
            ? image.tags.map(tag => String(tag || '').trim()).filter(Boolean)
            : [];

        const promptTags = prompt
            ? prompt
                .split(/[,;\n]/)
                .map(tag => tag.trim())
                .filter(tag => tag && tag.length <= 64)
            : [];

        return [...new Set([...explicitTags, ...promptTags])].slice(0, 24);
    },

    getInfoImageMetadataRows(image = {}) {
        const size = image.width && image.height ? `${image.width} x ${image.height}` : '';
        const rows = [
            ['Seed', image.seed],
            ['Steps', image.steps],
            ['CFG', image.cfg],
            ['Sampler', image.sampler],
            ['Clip skip', image.clip_skip],
            ['Size', size],
            ['Model', image.model]
        ];

        return rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
    },

    getInfoImageResources(image = {}) {
        const resources = Array.isArray(image.resources) ? image.resources : [];
        return resources
            .filter(resource => resource && typeof resource === 'object')
            .map(resource => ({
                name: resource.name || resource.modelName || resource.model || resource.hash || 'Resource',
                type: resource.type || resource.modelType || resource.resourceType || '',
                weight: resource.weight || resource.strength || resource.value || ''
            }))
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
        const tags = this.getInfoImagePromptTags(image);
        const metadataRows = this.getInfoImageMetadataRows(image);
        const resources = this.getInfoImageResources(image);
        const hasPrevious = images.length > 1;
        const positionText = images.length > 1 ? `${index + 1} / ${images.length}` : '1 image';

        const tagsHtml = tags.length
            ? `<div class="mr-image-preview-tags">${tags.map(tag => `<span>${this.escapeHtml(tag)}</span>`).join('')}</div>`
            : '<div class="mr-image-preview-empty">No prompt tags available.</div>';

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
                    <strong>${this.escapeHtml(resource.name)}</strong>
                    <span>${this.escapeHtml([resource.type, resource.weight].filter(Boolean).join(' / '))}</span>
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
                                <h4>Tags</h4>
                            </div>
                            ${tagsHtml}
                        </section>
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
        const text = key === 'positive'
            ? image.positive
            : key === 'negative'
                ? image.negative
                : [
                    image.positive ? `Prompt: ${image.positive}` : '',
                    image.negative ? `Negative prompt: ${image.negative}` : '',
                    image.seed ? `Seed: ${image.seed}` : '',
                    image.steps ? `Steps: ${image.steps}` : '',
                    image.cfg ? `CFG: ${image.cfg}` : '',
                    image.sampler ? `Sampler: ${image.sampler}` : '',
                    image.model ? `Model: ${image.model}` : ''
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
            const response = await api.fetchApi('/model_resolver/model-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: model.details_source || model.source,
                    model_id: model.model_id || model.modelId,
                    version_id: model.version_id || model.versionId,
                    civitai_key: tokens.civitai_key || ''
                })
            });

            if (!response.ok) {
                throw new Error(`Details request failed: ${response.status}`);
            }

            const data = await response.json();
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
                        ${data.version_url || data.url ? `<a class="mr-model-details-action" href="${this.escapeHtml(data.version_url || data.url)}" target="_blank" rel="noopener noreferrer">${getSvgIcon('externalLink')} Open page</a>` : ''}
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

    renderSourceModelDetailsFiles(version = {}, data = {}, contextModel = {}) {
        const files = Array.isArray(version.files) ? version.files.filter(file => file?.download_url) : [];
        if (!files.length) {
            return '<div class="mr-model-details-empty">No downloadable files available for this version.</div>';
        }

        return files.map((file, index) => {
            const payload = {
                source: data.source || contextModel.details_source || contextModel.source,
                model_id: data.model_id || contextModel.model_id,
                version_id: version.id || data.version_id || contextModel.version_id,
                name: data.name || contextModel.name,
                version_name: version.name || '',
                type: data.type || contextModel.type,
                filename: file.name || contextModel.filename || data.name || 'model',
                download_url: file.download_url,
                url: version.url || data.version_url || data.url,
                size: file.size,
                base_model: version.base_model || contextModel.base_model,
                tags: data.tags || [],
                match_type: 'selected',
                confidence: 100
            };
            return `
                <div class="mr-model-details-file ${file.primary ? 'is-primary' : ''}">
                    <div>
                        <strong>${this.escapeHtml(file.name || `File ${index + 1}`)}</strong>
                        <span>${this.escapeHtml([file.type, this.formatSearchResultSize(file), file.sha256 ? `SHA256 ${String(file.sha256).slice(0, 10)}` : ''].filter(Boolean).join(' / '))}</span>
                    </div>
                    <button type="button" class="mr-btn mr-btn-primary mr-model-details-use" data-selection="${this.escapeHtml(encodeURIComponent(JSON.stringify(payload)))}">
                        Use this version
                    </button>
                </div>
            `;
        }).join('');
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
                    data.selected_version = (data.versions || []).find(version => String(version.id) === details._selectedVersionId) || data.selected_version;
                    details.innerHTML = this.renderSourceModelDetails(data, details._sourceModel || {});
                    this.bindTooltips(details);
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
            base_model: selection.base_model,
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

        this.refreshSearchUiForMissing?.(missing, state || null);
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
        this.saveInfoDialogSize(dialog);
        this.closeInfoImagePreview();

        if (dialog && dialog.parentNode) {
            dialog.parentNode.removeChild(dialog);
        }
    }
};
