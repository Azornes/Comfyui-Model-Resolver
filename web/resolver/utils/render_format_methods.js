import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const renderFormatMethods = {
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
        const filename = path.split(/[\/\\]/).pop() || path;

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
        const contextMenuData = contextMenuModel
            ? this.escapeHtml(encodeURIComponent(JSON.stringify(contextMenuModel)))
            : '';
        const contextMenuAttrs = contextMenuData
            ? ` data-model="${contextMenuData}" oncontextmenu="window.MLOpenContextMenu(event, this)" data-tooltip="${this.escapeHtml(contextMenuTooltip)}"`
            : '';
        const className = contextMenuData
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

    async pollAnalysisProgress(analysisId, token) {
        while (this._analysisProgressToken === token) {
            try {
                const response = await api.fetchApi(`/model_resolver/analyze-progress/${analysisId}`);
                if (
                    response.ok &&
                    this.contentElement &&
                    this._analysisProgressToken === token &&
                    this.activeTab === 'missing'
                ) {
                    const progress = await response.json();
                    this.contentElement.innerHTML = this.renderAnalysisProgress(progress);
                    if (progress.status === 'completed' || progress.status === 'error') {
                        if (this._analysisProgressToken === token) {
                            this._analysisProgressToken = null;
                        }
                        return;
                    }
                }
            } catch (error) {
                console.warn('Model Resolver: analysis progress polling failed', error);
            }

            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
};
