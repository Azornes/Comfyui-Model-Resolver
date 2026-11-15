import { getSvgIcon } from '../utils/icon_utils.js';
import { escapeHtml } from './utils/html_utils.js';
import {
    getResolvedModelCategoryLabel,
    getResolvedModelFilename,
} from './node_context_menu.js';

/**
 * Builds the preview image endpoint URL for a given model if a path is present.
 * @param {Object} model Model reference or metadata object
 * @returns {string} URL to query model preview or empty string
 */
export function getModelPreviewUrl(model = {}) {
    const modelPath = String(
        model.resolved_path
        || model.path
        || model.full_path
        || model.original_path
        || ''
    ).trim();
    if (!modelPath) return '';

    const endpoint = (typeof api !== 'undefined' && typeof api?.apiURL === 'function')
        ? api.apiURL('/model_resolver/model-preview')
        : '/model_resolver/model-preview';

    return `${endpoint}?path=${encodeURIComponent(modelPath)}`;
}

/**
 * Maps a category name to the corresponding model type color token.
 * @param {string} category Model category string
 * @returns {string} Token name matching CSS type classes (e.g. 'lora', 'model', 'vae')
 */
export function getCategoryColorKey(category = '') {
    const raw = String(category || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    const mapping = {
        loras: 'lora',
        lora: 'lora',
        lycoris: 'lora',
        locon: 'lora',
        dora: 'lora',
        hypernetworks: 'lora',
        hypernetwork: 'lora',
        style_models: 'lora',
        style_model: 'lora',
        checkpoints: 'model',
        checkpoint: 'model',
        ckpt: 'model',
        diffusion_models: 'model',
        diffusion_model: 'model',
        diffusion: 'model',
        unet: 'model',
        model: 'model',
        vae: 'vae',
        vaes: 'vae',
        vae_approx: 'vae',
        taesd: 'vae',
        controlnet: 'controlnet',
        controlnets: 'controlnet',
        t2i_adapter: 'controlnet',
        t2i_adapters: 'controlnet',
        clip: 'clip',
        text_encoders: 'clip',
        text_encoder: 'clip',
        clip_vision: 'clip',
        embeddings: 'conditioning',
        embedding: 'conditioning',
        textual_inversion: 'conditioning',
        upscale_models: 'image',
        upscale_model: 'image',
    };
    return mapping[raw] || 'generic';
}

/**
 * Extracts display details for a model entry in the node popover.
 * @param {Object} model Model reference or metadata object
 * @param {Function|null} formatCategory Optional category formatter
 * @returns {Object} { filename, category, categoryKey, widgetName, subtitle, tooltip, slot, subfolder, fullPath, previewUrl }
 */
export function getModelDisplayDetails(model = {}, formatCategory = null) {
    const filename = getResolvedModelFilename(model);
    const category = getResolvedModelCategoryLabel(model, formatCategory);
    const categoryKey = getCategoryColorKey(model.category || category);
    const widgetName = String(model.widget_name || '').trim();
    const slot = widgetName ? `${category} · ${widgetName}` : category;

    const originalPath = String(model.original_path || model.path || model.full_path || '').trim();
    let subfolder = '';
    const normalized = originalPath.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash > 0) {
        subfolder = normalized.substring(0, lastSlash).replace(/\//g, '\\');
    }

    let subtitle = slot;
    if (subfolder && subfolder !== '.') {
        subtitle = `${slot} (${subfolder})`;
    }

    const fullPath = String(model.full_path || model.path || model.resolved_path || originalPath || filename);
    const tooltip = (fullPath && fullPath !== filename) ? `${filename}\n${fullPath}` : filename;
    const previewUrl = getModelPreviewUrl(model);

    return {
        filename,
        category,
        categoryKey,
        widgetName,
        subtitle,
        tooltip,
        slot,
        subfolder,
        fullPath,
        previewUrl,
    };
}

/**
 * Renders the HTML markup for the node model popover.
 * @param {Object} options Configuration object
 * @param {Object|null} options.node Canvas node reference
 * @param {Array} options.models List of model references
 * @param {Function|null} options.formatCategory Optional category formatter
 * @returns {string} HTML string
 */
export function renderNodeModelPopoverHtml({ node = null, models = [], formatCategory = null } = {}) {
    const nodeTitle = node?.title || node?.type || 'Node Models';
    const count = models.length;
    const countLabel = count === 1 ? '1 model' : `${count} models`;

    let rowsHtml;
    if (count === 0) {
        rowsHtml = `
            <div class="mr-node-popover-empty">
                <span>No models detected on this node</span>
            </div>
        `;
    } else {
        rowsHtml = models.map((model, index) => {
            const details = getModelDisplayDetails(model, formatCategory);
            return `
                <div class="mr-node-popover-row" data-model-index="${index}">
                    <div class="mr-node-popover-model" data-tooltip="${escapeHtml(details.tooltip)}"${details.previewUrl ? ` data-tooltip-image="${escapeHtml(details.previewUrl)}"` : ''}>
                        <span class="mr-node-popover-model-name">${escapeHtml(details.filename)}</span>
                        <small class="mr-node-popover-model-sub">
                            <span class="mr-node-popover-tag mr-node-popover-tag--${details.categoryKey}">${escapeHtml(details.category)}</span>
                            ${details.widgetName ? `<span class="mr-node-popover-widget-name">· ${escapeHtml(details.widgetName)}</span>` : ''}
                            ${details.subfolder ? `<span class="mr-node-popover-subfolder">(${escapeHtml(details.subfolder)})</span>` : ''}
                        </small>
                    </div>
                    <div class="mr-node-popover-actions">
                        <button type="button" class="mr-node-popover-action-btn mr-action-search"
                            data-action="search"
                            data-tooltip="Show in Model Resolver"
                            aria-label="Show in Model Resolver">${getSvgIcon('search')}</button>
                        <button type="button" class="mr-node-popover-action-btn mr-action-info"
                            data-action="info"
                            data-tooltip="Show info"
                            aria-label="Show info">${getSvgIcon('info')}</button>
                        <button type="button" class="mr-node-popover-action-btn mr-action-folder"
                            data-action="folder"
                            data-tooltip="Open containing folder"
                            aria-label="Open containing folder">${getSvgIcon('folderOpen')}</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    return `
        <div class="mr-node-popover-header">
            <div class="mr-node-popover-title-group">
                <span class="mr-node-popover-logo" aria-hidden="true">${getSvgIcon('modelResolver')}</span>
                <span class="mr-node-popover-title" title="${escapeHtml(nodeTitle)}">${escapeHtml(nodeTitle)}</span>
                <span class="mr-node-popover-count">${escapeHtml(countLabel)}</span>
            </div>
            <button type="button" class="mr-node-popover-close-btn" data-action="close"
                aria-label="Close" data-tooltip="Close">${getSvgIcon('x')}</button>
        </div>
        <div class="mr-node-popover-body">
            ${rowsHtml}
        </div>
        <div class="mr-node-popover-footer">
            <button type="button" class="mr-node-popover-open-btn" data-action="open-resolver">
                <span class="mr-node-popover-open-icon" aria-hidden="true">${getSvgIcon('modelResolver')}</span>
                <span>Open Model Resolver</span>
            </button>
        </div>
    `.trim();
}

/**
 * Controller class for managing the floating node model popover overlay.
 */
export class NodeModelPopover {
    static activeInstance = null;

    static closeActive() {
        if (NodeModelPopover.activeInstance) {
            NodeModelPopover.activeInstance.close();
        }
    }

    static toggle(options = {}) {
        if (NodeModelPopover.activeInstance) {
            const sameNode = NodeModelPopover.activeInstance.node === options.node;
            NodeModelPopover.closeActive();
            if (sameNode) {
                return null;
            }
        }
        const popover = new NodeModelPopover(options);
        popover.open();
        return popover;
    }

    constructor({
        node = null,
        models = [],
        handlers = {},
        formatCategory = null,
        anchorElement = null,
        point = null,
        owner = null,
    } = {}) {
        this.node = node;
        this.models = models || [];
        this.handlers = handlers || {};
        this.formatCategory = formatCategory;
        this.anchorElement = anchorElement;
        this.point = point;
        this.owner = owner;
        this.element = null;
        this._boundPointerDown = null;
        this._boundKeyDown = null;
        this._boundClose = null;
    }

    open() {
        if (typeof document === 'undefined') return;

        NodeModelPopover.closeActive();
        NodeModelPopover.activeInstance = this;

        const container = document.createElement('div');
        container.className = 'mr-node-popover';
        container.setAttribute('role', 'dialog');
        container.setAttribute('aria-modal', 'false');
        container.setAttribute('aria-label', 'Node Models');
        container.innerHTML = renderNodeModelPopoverHtml({
            node: this.node,
            models: this.models,
            formatCategory: this.formatCategory,
        });

        container.style.position = 'fixed';
        container.style.visibility = 'hidden';
        container.style.opacity = '0';
        container.style.top = '0px';
        container.style.left = '0px';

        document.body.appendChild(container);
        this.element = container;

        this.bindEvents();
        this.position();

        container.style.visibility = 'visible';
        container.style.opacity = '1';

        const dialog = this.owner?.dialog || (typeof window !== 'undefined' ? window.ModelResolverDialog : null);
        if (dialog?.bindTooltips) {
            dialog.bindTooltips(container);
        }
    }

    bindEvents() {
        if (!this.element) return;

        // Stop propagation of selection and context menu events so selecting or copying
        // text inside the popover is not blocked or hijacked by canvas/window event hooks.
        this.element.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });
        this.element.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });
        this.element.addEventListener('contextmenu', (event) => {
            event.stopPropagation();
        });

        this.element.addEventListener('click', (event) => {
            const target = event.target;
            const btn = target.closest('button');
            if (!btn) return;

            const action = btn.dataset.action;
            if (action === 'close') {
                this.close();
                return;
            }

            if (action === 'open-resolver') {
                this.close();
                this.handlers.openResolver?.();
                return;
            }

            const row = btn.closest('.mr-node-popover-row');
            if (!row) return;

            const index = Number(row.dataset.modelIndex);
            const model = this.models[index];
            if (!model) return;

            if (action === 'search') {
                this.close();
                this.handlers.showInResolver?.(model);
            } else if (action === 'info') {
                this.close();
                this.handlers.showInfo?.(model);
            } else if (action === 'folder') {
                this.close();
                this.handlers.openContainingFolder?.(model);
            }
        });

        this._boundKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.close();
            }
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', this._boundKeyDown, true);
        }

        this._boundPointerDown = (event) => {
            if (!this.element) return;
            if (this.element.contains(event.target)) return;
            if (this.anchorElement && this.anchorElement.contains(event.target)) return;
            this.close();
        };
        setTimeout(() => {
            if (this.element && typeof document !== 'undefined') {
                document.addEventListener('pointerdown', this._boundPointerDown, true);
            }
        }, 10);

        this._boundClose = () => this.close();
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this._boundClose, { passive: true, once: true });
        }
        if (typeof app !== 'undefined' && app?.canvas?.canvas) {
            app.canvas.canvas.addEventListener('wheel', this._boundClose, { passive: true, once: true });
        }
    }

    position() {
        if (!this.element) return;

        const margin = 10;
        const popoverWidth = this.element.offsetWidth || 380;
        const popoverHeight = this.element.offsetHeight || 160;

        let left;
        let top;

        if (this.anchorElement?.getBoundingClientRect) {
            const rect = this.anchorElement.getBoundingClientRect();
            left = rect.left;
            top = rect.bottom + 6;

            if (top + popoverHeight > window.innerHeight - margin) {
                if (rect.top - popoverHeight - 6 >= margin) {
                    top = rect.top - popoverHeight - 6;
                } else {
                    top = Math.max(margin, window.innerHeight - popoverHeight - margin);
                }
            }
        } else if (this.point && typeof this.point.x === 'number') {
            left = this.point.x;
            top = this.point.y + 6;
            if (top + popoverHeight > window.innerHeight - margin) {
                top = Math.max(margin, window.innerHeight - popoverHeight - margin);
            }
        } else {
            left = Math.round((window.innerWidth - popoverWidth) / 2);
            top = Math.round((window.innerHeight - popoverHeight) / 2);
        }

        if (left + popoverWidth > window.innerWidth - margin) {
            left = Math.max(margin, window.innerWidth - popoverWidth - margin);
        }
        if (left < margin) {
            left = margin;
        }

        this.element.style.left = `${Math.round(left)}px`;
        this.element.style.top = `${Math.round(top)}px`;
    }

    close() {
        const dialog = this.owner?.dialog || (typeof window !== 'undefined' ? window.ModelResolverDialog : null);
        dialog?.hideTooltip?.();

        if (this._boundKeyDown) {
            if (typeof document !== 'undefined') {
                document.removeEventListener('keydown', this._boundKeyDown, true);
            }
            this._boundKeyDown = null;
        }
        if (this._boundPointerDown) {
            if (typeof document !== 'undefined') {
                document.removeEventListener('pointerdown', this._boundPointerDown, true);
            }
            this._boundPointerDown = null;
        }
        if (this._boundClose) {
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', this._boundClose);
            }
            if (typeof app !== 'undefined' && app?.canvas?.canvas) {
                app.canvas.canvas.removeEventListener('wheel', this._boundClose);
            }
            this._boundClose = null;
        }

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;

        if (NodeModelPopover.activeInstance === this) {
            NodeModelPopover.activeInstance = null;
        }
    }
}
