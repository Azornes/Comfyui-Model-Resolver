import { escapeHtml, escapeJsString, getFilenameFromPath, pollBackgroundTask } from "./html_utils.js";

export const renderFormatMethods = {
    escapeHtml,
    escapeJsString,
    getFilenameFromPath,

    encodeContextMenuModel(context = null) {
        if (!context) return '';
        try {
            return encodeURIComponent(JSON.stringify(context));
        } catch (error) {
            console.warn('Model Resolver: failed to encode context menu model', error);
            return '';
        }
    },

    getContextMenuAttrs(context = null, tooltip = '') {
        const data = this.encodeContextMenuModel(context);
        if (!data) return '';
        const tooltipAttr = tooltip ? ` data-tooltip="${this.escapeHtml(tooltip)}"` : '';
        return ` data-model="${this.escapeHtml(data)}" oncontextmenu="window.MLOpenContextMenu(event, this)"${tooltipAttr}`;
    },

    getContextMenuProps(context = null, tooltip = '') {
        const data = this.encodeContextMenuModel(context);
        if (!data) return {};
        const props = {
            "data-model": data,
            oncontextmenu: (event) => {
                window.MLOpenContextMenu?.(event, event.currentTarget);
            }
        };
        if (tooltip) {
            props["data-tooltip"] = tooltip;
        }
        return props;
    },

    setContextMenuElement(element, context = null, tooltip = '') {
        if (!element) return;
        const data = this.encodeContextMenuModel(context);
        if (!data) {
            element.removeAttribute('data-model');
            element.removeAttribute('data-tooltip');
            element.oncontextmenu = null;
            return;
        }

        element.dataset.model = data;
        if (tooltip) {
            element.dataset.tooltip = tooltip;
        } else {
            element.removeAttribute('data-tooltip');
        }
        element.oncontextmenu = (event) => {
            window.MLOpenContextMenu?.(event, event.currentTarget);
        };
    },

    /**
     * Get a colored confidence badge HTML
     * @param {number} confidence - Confidence percentage (0-100)
     * @returns {string} HTML for the badge
     */
    getConfidenceBadge(confidence) {
        let badgeClass;
        if (confidence >= 95) {
            badgeClass = 'mr-badge-high';
        } else if (confidence >= 70) {
            badgeClass = 'mr-badge-medium';
        } else {
            badgeClass = 'mr-badge-low';
        }
        return `<span class="mr-badge ${badgeClass}">${confidence}%</span>`;
    },

    getStatusBadge(label, variant = 'neutral') {
        return `<span class="mr-badge mr-badge-${variant}">${label}</span>`;
    },

    /**
     * Format a filename with smart truncation
     * @param {string} path - Full path or filename
     * @param {number} maxLength - Maximum display length
     * @returns {object} { display: truncated name, full: full name }
     */
    formatFilename(path, maxLength = 50) {
        if (!path) return { display: 'Unknown', full: 'Unknown' };

        // Extract just the filename from path
        const filename = this.getFilenameFromPath(path);

        if (filename.length <= maxLength) {
            return { display: filename, full: filename };
        }

        // Smart truncation: keep extension visible
        const lastDot = filename.lastIndexOf('.');
        const ext = lastDot > 0 ? filename.slice(lastDot) : '';
        const name = lastDot > 0 ? filename.slice(0, lastDot) : filename;

        // Calculate how much of the name we can show
        const availableLength = maxLength - ext.length - 3; // 3 for "..."
        if (availableLength < 8) {
            // Too short, just truncate at the end
            return { display: filename.slice(0, maxLength - 3) + '...', full: filename };
        }

        // Truncate middle of name
        const frontLength = Math.ceil(availableLength / 2);
        const backLength = Math.floor(availableLength / 2);
        const truncated = name.slice(0, frontLength) + '...' + name.slice(-backLength) + ext;

        return { display: truncated, full: filename };
    },

    /**
     * Format a path showing directory context
     * @param {string} path - Full relative path
     * @param {number} maxLength - Maximum display length
     * @returns {object} { display: formatted path, full: full path }
     */
    formatPath(path, maxLength = 60) {
        if (!path) return { display: 'Unknown', full: 'Unknown' };

        if (path.length <= maxLength) {
            return { display: path, full: path };
        }

        // Try to show meaningful parts: first dir + filename
        const parts = path.split(/[\/\\]/);
        const filename = parts.pop() || '';
        const firstDir = parts[0] || '';

        if (parts.length === 0) {
            // Just a filename
            return this.formatFilename(path, maxLength);
        }

        // Show first directory + ... + filename
        const formatted = firstDir + '\\...' + (filename.length > 40 ? this.formatFilename(filename, 40).display : filename);

        if (formatted.length <= maxLength) {
            return { display: formatted, full: path };
        }

        // Still too long, just truncate
        return { display: path.slice(0, maxLength - 3) + '...', full: path };
    },

    /**
     * Render a status message with icon
     * @param {string} message - Message text
     * @param {string} type - 'error' | 'success' | 'info' | 'warning'
     * @returns {string} HTML for status message
     */
    renderStatusMessage(message, type = 'info', options = {}) {
        const icons = {
            error: '⚠',
            success: '✓',
            info: 'ℹ',
            warning: '⚡'
        };
        const icon = icons[type] || icons.info;
        const contextMenuModel = options?.contextMenuModel || null;
        const contextMenuTooltip = options?.contextMenuTooltip || 'Right-click to open download folder';
        const contextMenuAttrs = this.getContextMenuAttrs(contextMenuModel, contextMenuTooltip);
        const className = contextMenuAttrs
            ? `mr-status mr-status-${type} mr-download-folder-context`
            : `mr-status mr-status-${type}`;

        return `
            <div class="${className}"${contextMenuAttrs}>
                <span class="mr-status-icon">${icon}</span>
                <span>${message}</span>
            </div>
        `;
    },

    /**
     * Render a progress bar
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} leftText - Text on the left
     * @param {string} rightText - Text on the right
     * @returns {string} HTML for progress bar
     */
    renderProgressBar(percent, leftText = '', rightText = '') {
        return `
            <div class="mr-progress-container">
                <div class="mr-progress-bar">
                    <div class="mr-progress-fill" style="width: ${percent}%"></div>
                </div>
                <div class="mr-progress-text">
                    <span>${leftText}</span>
                    <span>${rightText}</span>
                </div>
            </div>
        `;
    },

    renderAnalysisProgress(progress = {}) {
        const current = Number(progress.current) || 0;
        const total = Number(progress.total) || 0;
        const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
        const message = progress.message || 'Analyzing workflow...';
        const modelName = progress.model_name ? this.escapeHtml(String(progress.model_name)) : '';
        const detail = total > 0 ? `${current} / ${total}` : 'Preparing...';

        return `
            <div class="mr-download-section">
                <div class="mr-status-inline">
                    ${this.getStatusBadge('Analyzing', 'info')}
                    <span class="mr-download-info">${message}</span>
                </div>
                ${this.renderProgressBar(percent, detail, `${percent}%`)}
                ${modelName ? `<div class="mr-download-info">${modelName}</div>` : ''}
            </div>
        `;
    },

    renderLoadedModelsProgress(progress = {}) {
        const current = Number(progress.current) || 0;
        const total = Number(progress.total) || 0;
        const explicitPercent = Number(progress.percent);
        const percent = Number.isFinite(explicitPercent)
            ? Math.max(0, Math.min(100, Math.round(explicitPercent)))
            : (total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0);
        const message = progress.message || 'Loading loaded models...';
        const detail = total > 0 ? `${current} / ${total}` : 'Preparing...';
        const nodeType = progress.node_type ? this.escapeHtml(String(progress.node_type)) : '';

        return `
            <div class="mr-download-section">
                <div class="mr-status-inline">
                    ${this.getStatusBadge('Loading', 'info')}
                    <span class="mr-download-info">${this.escapeHtml(message)}</span>
                </div>
                ${this.renderProgressBar(percent, detail, `${percent}%`)}
                ${nodeType ? `<div class="mr-download-info">${nodeType}</div>` : ''}
            </div>
        `;
    },

    async pollAnalysisProgress(analysisId, token) {
        await pollBackgroundTask({
            endpoint: `/model_resolver/analyze-progress/${analysisId}`,
            tokenCheck: () => this._analysisProgressToken === token,
            onProgress: (progress) => {
                if (this.contentElement && this.activeTab === 'missing') {
                    this.contentElement.innerHTML = this.renderAnalysisProgress(progress);
                }
            },
            isTerminal: (progress) => progress.status === 'completed' || progress.status === 'error',
            onTerminal: () => {
                if (this._analysisProgressToken === token) {
                    this._analysisProgressToken = null;
                }
            },
            onError: (error) => {
                console.warn('Model Resolver: analysis progress polling failed', error);
            },
            intervalMs: 250,
            fetchJson: this.fetchJson.bind(this)
        });
    },

    async pollLoadedModelsProgress(loadedId, token) {
        await pollBackgroundTask({
            endpoint: `/model_resolver/loaded-progress/${encodeURIComponent(loadedId)}`,
            tokenCheck: () => this._loadedModelsProgressToken === token,
            filterIgnoredStatus: (progress) => progress?.status === 'unknown',
            onProgress: (progress) => {
                if (this.contentElement && this.activeTab === 'loaded') {
                    this.contentElement.innerHTML = this.renderLoadedModelsProgress(progress);
                }
            },
            isTerminal: (progress) => progress.status === 'completed' || progress.status === 'error',
            onTerminal: () => {
                if (this._loadedModelsProgressToken === token) {
                    this._loadedModelsProgressToken = null;
                }
            },
            onError: (error) => {
                console.warn('Model Resolver: loaded models progress polling failed', error);
            },
            intervalMs: 250,
            fetchJson: this.fetchJson.bind(this)
        });
    },

    /**
     * Get display information for the best local match of a missing model
     */
    getLocalMatchDisplayInfo(missing) {
        const bestMatch = this.getBestLocalMatch?.(missing, 70) || null;
        const confidence = bestMatch ? Number(bestMatch.confidence || 0) : 0;
        const matchName = bestMatch?.model?.relative_path || bestMatch?.filename || bestMatch?.path || '';
        const matchDisplay = matchName || 'No local match';
        const matchClass = confidence === 100 ? 'exact' : (bestMatch ? 'partial' : 'none');
        return { bestMatch, confidence, matchDisplay, matchClass };
    },

    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (!Number.isFinite(value) || value <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.min(sizes.length - 1, Math.floor(Math.log(value) / Math.log(k)));
        return parseFloat((value / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    formatDuration(seconds) {
        const totalSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
        if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';

        if (totalSeconds < 60) return `${totalSeconds}s`;

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;

        if (hours > 0) {
            return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
        }

        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    },

    formatDownloadPercent(value) {
        const percent = Math.max(0, Math.min(100, Number(value) || 0));
        if (percent > 0 && percent < 0.1) return '<0.1';
        if (percent > 0 && percent < 10) {
            return percent.toFixed(1).replace(/\.0$/, '');
        }
        return String(Math.round(percent));
    },

    getDownloadDisplayProgress(progress = {}) {
        const logicalDownloaded = Math.max(0, Number(progress.downloaded) || 0);
        const logicalTotalSize = Math.max(0, Number(progress.total_size) || 0);
        const logicalPercent = Math.max(0, Math.min(100, Number(progress.progress) || 0));
        const backend = String(progress.download_backend || '').toLowerCase();
        const transferDownloaded = Math.max(0, Number(progress.transfer_downloaded) || 0);
        const transferTotalSize = Math.max(0, Number(progress.transfer_total_size) || 0);

        if (backend === 'huggingface_xet' && logicalTotalSize > 0) {
            return {
                percent: Math.max(0, Math.min(100, (transferDownloaded / logicalTotalSize) * 100)),
                downloaded: transferDownloaded,
                totalSize: logicalTotalSize,
                isTransfer: true,
                isFinalizing: transferTotalSize > 0
                    && transferDownloaded >= transferTotalSize
                    && logicalTotalSize > 0
                    && logicalDownloaded < logicalTotalSize
            };
        }

        return {
            percent: logicalPercent,
            downloaded: logicalDownloaded,
            totalSize: logicalTotalSize,
            isTransfer: false,
            isFinalizing: false
        };
    },

    getDownloadEtaText(progress = {}) {
        const backend = String(progress.download_backend || '').toLowerCase();
        const totalSize = Number(progress.total_size) || 0;
        const downloaded = backend === 'huggingface_xet'
            ? (Number(progress.transfer_downloaded) || 0)
            : (Number(progress.downloaded) || 0);
        const speed = Number(progress.speed) || 0;
        if (totalSize <= 0 || downloaded <= 0 || speed <= 0 || downloaded >= totalSize) return '';

        const duration = this.formatDuration((totalSize - downloaded) / speed);
        return duration ? `ETA ${duration}` : '';
    },

    formatDownloadProgressMeta(progress = {}) {
        const parts = [];
        const speed = Number(progress.speed) || 0;
        if (speed > 0) {
            parts.push(`${this.formatBytes(speed)}/s`);
        }

        const eta = this.getDownloadEtaText(progress);
        if (eta) {
            parts.push(eta);
        }

        return parts.join(' | ');
    },

    getBaseDirectoryLabel(baseDirectory = '') {
        const clean = String(baseDirectory || '').replace(/[\\\/]+$/, '');
        if (!clean) return 'Default root';
        return clean.split(/[\\\/]+/).filter(Boolean).pop() || clean;
    },

    estimateTextWidth(value, charPx = 6, minPx = 40, maxPx = 180) {
        const length = String(value || '').length;
        return Math.max(minPx, Math.min(maxPx, Math.ceil(length * charPx)));
    },

    normalizePathToForward(value) {
        return String(value || '').trim().replace(/\\/g, '/');
    },

    normalizePathToBackward(value) {
        return String(value || '').trim().replace(/\//g, '\\');
    },

    stripModelExtension(value) {
        return stripModelExtension(value);
    },

    hasModelExtension(value) {
        return hasModelExtension(value);
    }
};

export const MODEL_EXTENSIONS_REGEX = /\.(safetensors|ckpt|pt2?|bin|pth|pkl|sft|onnx|gguf)(?:$|[?#])/i;

export function stripModelExtension(value) {
    if (!value) return '';
    return String(value).replace(MODEL_EXTENSIONS_REGEX, '');
}

export function hasModelExtension(value) {
    if (!value) return false;
    return MODEL_EXTENSIONS_REGEX.test(value);
}

