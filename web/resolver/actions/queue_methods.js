import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const queueMethods = {
    createContent() {
        // Wrap the body in a two-column layout: left = items, right = queued panel
        const body = $el("div", {
            id: "model-resolver-body"
        });

        this.contentElement = $el("div.mr-scrollable", {
            id: "model-resolver-content"
        });

        this.queueElement = $el("div", {
            id: "model-resolver-queue"
        }, [
            this.createQueuePanel()
        ]);

        // Splitter between content and queue
        this.splitterElement = $el("div", {
            id: "model-resolver-splitter",
            ondragstart: (e) => e.preventDefault()
        });

        body.appendChild(this.contentElement);
        body.appendChild(this.splitterElement);
        body.appendChild(this.queueElement);

        // Restore saved queue width and wire splitter
        try {
            const savedSplit = localStorage.getItem('model_resolver_split_w');
            if (savedSplit) {
                const w = parseInt(savedSplit, 10);
                if (!isNaN(w) && w > 0) {
                    this.queueElement.style.width = `${w}px`;
                }
            }
        } catch (e) { }

        try {
            const onSplitMouseDown = (e) => this.startSplitDrag(e);
            this.splitterElement.addEventListener('mousedown', onSplitMouseDown);
            this._splitterMouseDown = onSplitMouseDown;
        } catch (e) { }

        // Toggle icon always visible
        try {
            this.queueToggleIcon = $el("button", {
                id: "queue-toggle-icon",
                type: "button",
                "aria-label": "Toggle queued selections",
                onclick: (event) => this.onQueueEdgeClick(event),
                onmousedown: (event) => this.startQueueEdgeDrag(event)
            });
            body.appendChild(this.queueToggleIcon);
            this.updateQueueToggleIcon();
        } catch (e) { }

        // Restore queue collapsed state
        try {
            const col = localStorage.getItem('model_resolver_queue_collapsed');
            if (col === '1') this.setQueueCollapsed(true);
        } catch (e) { }

        return body;
    },

    createQueuePanel() {
        // Header row with title and clear button
        this.queueHeader = $el("div.mr-queue-header", {}, [
            $el("div#queue-title.mr-queue-title", { textContent: "Queued Selections (0)" }),
            $el("div.mr-queue-actions", {}, [
                $el("button", {
                    id: "queue-toggle",
                    className: "mr-btn mr-btn-secondary mr-btn-sm",
                    textContent: "Collapse",
                    onclick: () => this.toggleQueueCollapsed()
                }),
                $el("button", {
                    id: "queue-clear",
                    className: "mr-btn mr-btn-secondary mr-btn-sm",
                    textContent: "Clear All",
                    onclick: () => this.clearAllQueued()
                })
            ])
        ]);

        // Scrollable list
        this.queueList = $el("div#queue-list.mr-queue-list");

        const panel = $el("div.mr-queue-panel", {}, [
            $el("div.mr-queue-stack", {}, [this.queueHeader, this.queueList])
        ]);
        return panel;
    },

    updateQueuePanel() {
        if (!this.queueList || !this.queueHeader) return;
        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        // Update title count
        const title = this.queueHeader.querySelector('#queue-title');
        if (title) title.textContent = `Queued Selections (${list.length})`;
        const toggleBtn = this.queueHeader.querySelector('#queue-toggle');
        if (toggleBtn) toggleBtn.textContent = this.queueCollapsed ? 'Expand' : 'Collapse';

        if (!list.length) {
            this.queueList.innerHTML = '<div class="mr-queue-empty">No selections queued.</div>';
            return;
        }

        let html = '<div class="mr-queue-items">';
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const label = (r.resolved_model?.relative_path || r.resolved_model?.filename || r.resolved_path || '').toString();
            const nodeLabel = r.node_label || r.node_type || (r.subgraph_id ? 'Subgraph' : 'Node');
            const orig = (r.original_path || '').toString();
            const rmId = `queue-remove-${i}`;
            html += `<div class="mr-queue-item">`;
            html += `<div class="mr-queue-item-title">${this.escapeHtml(nodeLabel)} #${this.escapeHtml(String(r.node_id))}</div>`;
            html += `<div class="mr-queue-item-meta"><span>Original</span><code>${this.escapeHtml(orig)}</code></div>`;
            html += `<div class="mr-queue-item-selection"><span>Selected</span><code>${this.escapeHtml(label)}</code></div>`;
            html += `<div class="mr-queue-item-actions"><button id="${rmId}" class="mr-btn mr-btn-secondary mr-btn-sm">Remove</button></div>`;
            html += `</div>`;
        }
        html += '</div>';
        this.queueList.innerHTML = html;

        // Wire remove buttons
        for (let i = 0; i < list.length; i++) {
            const rmId = `queue-remove-${i}`;
            const btn = this.queueList.querySelector(`#${rmId}`);
            if (btn) {
                btn.addEventListener('click', () => this.removeQueuedByIndex(i));
            }
        }
    },

    // Remove queued by index
    removeQueuedByIndex(i) {
        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        if (i < 0 || i >= list.length) return;
        const r = list[i];
        // Remove
        this.pendingResolutions.splice(i, 1);
        this.rebuildPendingIndex();
        this.savePendingQueueForActiveWorkflow();
        // Update per-item selected bar
        const m = { node_id: r.node_id, widget_index: r.widget_index, subgraph_id: r.subgraph_id, is_top_level: r.is_top_level };
        this.updateSelectedBarForMissing?.(m);
        this.updateApplyPendingButton?.();
        this.updateQueuePanel();
    },

    // Clear all queued selections
    clearAllQueued() {
        this.pendingResolutions = [];
        this.pendingIndex = new Map();
        this.savePendingQueueForActiveWorkflow();
        this.updateApplyPendingButton?.();
        this.updateQueuePanel();
        try {
            document.querySelectorAll('.model-resolver-selected').forEach(el => { el.style.display = 'none'; el.innerHTML = ''; });
        } catch (e) { /* ignore */ }
    },

    // Update selected bar for a specific missing model slot
    updateSelectedBarForMissing(missing) {
        if (!missing) return;
        const nodeId = missing.node_id;
        const widgetIndex = missing.widget_index;
        const subgraphId = missing.subgraph_id || '';
        const isTopLevel = missing.is_top_level !== false;
        const key = `${nodeId}:${widgetIndex}:${subgraphId}:${isTopLevel ? 'T' : 'F'}`;

        const selectedBar = document.getElementById(`selected-bar-${nodeId}-${widgetIndex}`);
        if (!selectedBar) return;

        // Find selection for this slot
        let selection = null;
        let selectionIdx = -1;
        if (this.pendingIndex.has(key)) {
            const idx = this.pendingIndex.get(key);
            if (idx >= 0 && idx < this.pendingResolutions.length) {
                selection = this.pendingResolutions[idx];
                selectionIdx = idx;
            }
        }

        if (!selection) {
            selectedBar.style.display = 'none';
            selectedBar.innerHTML = '';
            return;
        }

        // Build selected bar content
        const label = selection.resolved_model?.relative_path || selection.resolved_model?.filename || selection.resolved_path || '';
        const resolveBtnId = `selected-remove-${nodeId}-${widgetIndex}`;

        selectedBar.innerHTML = `<div class="mr-selected-bar-inner">`;
        selectedBar.innerHTML += `<span class="mr-selected-label">✓ Selected:</span>`;
        selectedBar.innerHTML += `<code class="mr-selected-code">${label}</code>`;
        selectedBar.innerHTML += `<button id="${resolveBtnId}" class="mr-btn mr-btn-secondary mr-btn-sm">Remove</button>`;
        selectedBar.innerHTML += `</div>`;
        selectedBar.style.display = 'block';

        // Wire remove button - use key-based removal
        const removeBtn = selectedBar.querySelector(`#${resolveBtnId}`);
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                this.removeQueuedByKey(key);
            });
        }
    },

    // Remove queued by key (more reliable than index)
    removeQueuedByKey(key) {
        if (!key || !this.pendingIndex.has(key)) return;

        // Find and remove the item with this key
        const idx = this.pendingIndex.get(key);
        if (idx >= 0 && idx < this.pendingResolutions.length) {
            const r = this.pendingResolutions[idx];
            // Update the selected bar before removing
            const m = { node_id: r.node_id, widget_index: r.widget_index, subgraph_id: r.subgraph_id, is_top_level: r.is_top_level };

            // Remove from array
            this.pendingResolutions.splice(idx, 1);
            this.rebuildPendingIndex();
            this.savePendingQueueForActiveWorkflow();
            this.updateSelectedBarForMissing(m);
            this.updateApplyPendingButton?.();
            this.updateQueuePanel();
        }
    },

    // Rebuild pending index after modification
    rebuildPendingIndex() {
        this.pendingIndex = new Map();
        for (let i = 0; i < this.pendingResolutions.length; i++) {
            const r = this.pendingResolutions[i];
            const key = `${r.node_id}:${r.widget_index}:${r.subgraph_id || ''}:${r.is_top_level ? 'T' : 'F'}`;
            this.pendingIndex.set(key, i);
        }
    },

    // Collapse/expand queue panel
    toggleQueueCollapsed() {
        this.setQueueCollapsed(!this.queueCollapsed);
    },

    setQueueCollapsed(collapsed) {
        this.queueCollapsed = !!collapsed;
        if (this.queueCollapsed) {
            try { localStorage.setItem('model_resolver_queue_collapsed', '1'); } catch (e) { }
        } else {
            try { localStorage.setItem('model_resolver_queue_collapsed', '0'); } catch (e) { }
        }
        this.updateQueueVisibility();
        this.updateQueuePanel();
    },

    updateQueueVisibility() {
        const isMissingTab = this.activeTab === 'missing';
        const showQueuePanel = isMissingTab && !this.queueCollapsed;

        if (this.queueElement) {
            this.queueElement.style.display = showQueuePanel ? '' : 'none';
        }
        if (this.splitterElement) {
            this.splitterElement.style.display = showQueuePanel ? '' : 'none';
        }
        if (this.queueToggleIcon) {
            this.queueToggleIcon.style.display = isMissingTab ? '' : 'none';
        }

        this.updateQueueToggleIcon();
    },

    updateQueueToggleIcon() {
        if (!this.queueToggleIcon) return;
        this.queueToggleIcon.style.display = this.activeTab === 'missing' ? '' : 'none';
        this.queueToggleIcon.textContent = '';
        this.queueToggleIcon.removeAttribute('data-tooltip');
        this.queueToggleIcon.removeAttribute('title');
        if (this.queueCollapsed) {
            this.queueToggleIcon.classList.add('is-collapsed');
            this.queueToggleIcon.setAttribute('aria-label', 'Show queued selections');
        } else {
            this.queueToggleIcon.classList.remove('is-collapsed');
            this.queueToggleIcon.setAttribute('aria-label', 'Hide queued selections');
        }
    },

    onQueueEdgeClick(event) {
        if (this._suppressQueueEdgeClick) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            this._suppressQueueEdgeClick = false;
            return;
        }
        this.toggleQueueCollapsed();
    },

    startQueueEdgeDrag(event) {
        if (event.button !== 0 || !this.queueCollapsed || !this.queueElement) return;

        const startX = event.clientX;
        const previousCursor = document.body.style.cursor;
        event.preventDefault();
        document.body.style.cursor = 'col-resize';
        this._suppressQueueEdgeClick = true;
        this.splitterElement.style.display = '';
        document.getElementById('model-resolver-body')?.classList.add('mr-queue-preview-collapsed');
        this.queueElement.style.display = 'none';
        this.queueElement.style.width = '0px';
        this.startSplitDrag(
            { clientX: startX, preventDefault: () => {} },
            { startWidth: 0, edgeOpen: true, previousCursor, startCollapsedPreview: true }
        );
    },

    // Begin split drag for resizable panels
    startSplitDrag(e, { startWidth = null, edgeOpen = false, previousCursor = null, startCollapsedPreview = false } = {}) {
        try {
            e?.preventDefault?.();
            if (!this.queueElement) return;
            const rect = this.queueElement.getBoundingClientRect();
            const body = document.getElementById('model-resolver-body');
            const bodyRect = body ? body.getBoundingClientRect() : { width: window.innerWidth };
            this._splitDragging = true;
            body?.classList.add('mr-is-resizing-queue');
            this._splitStart = {
                x: e.clientX,
                startWidth: Number.isFinite(startWidth) ? startWidth : rect.width,
                containerWidth: bodyRect.width
            };
            this._lastSplitDragApply = 0;
            this._splitPreviewCollapsed = !!startCollapsedPreview;
            this._splitEdgeOpen = !!edgeOpen;
            this._splitEdgeOpenedPastThreshold = false;
            this._splitPreviousCursor = previousCursor;
            this._prevUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            this._onSplitMove = (ev) => this.onSplitDrag(ev);
            this._onSplitUp = () => this.endSplitDrag();
            document.addEventListener('mousemove', this._onSplitMove);
            document.addEventListener('mouseup', this._onSplitUp, { once: true });
        } catch (err) { /* ignore */ }
    },

    onSplitDrag(e) {
        if (!this._splitDragging || !this._splitStart || !this.queueElement) return;
        const dx = e.clientX - this._splitStart.x;
        let newW = this._splitStart.startWidth - dx;
        const minW = this._splitEdgeOpen ? 0 : 56;
        const maxW = Math.max(minW, Math.floor(this._splitStart.containerWidth - 360));
        if (newW < minW) newW = minW;
        if (newW > maxW) newW = maxW;
        this._pendingSplitWidth = Math.round(newW);
        if (this._splitEdgeOpen && this._pendingSplitWidth > 140) {
            this._splitEdgeOpenedPastThreshold = true;
            if (this.queueCollapsed) {
                this.queueCollapsed = false;
                try { localStorage.setItem('model_resolver_queue_collapsed', '0'); } catch (error) { }
                this.updateQueueToggleIcon();
                this.updateQueuePanel();
            }
        }
        const previewCollapsed = this._splitEdgeOpen
            ? (!this._splitEdgeOpenedPastThreshold || this._pendingSplitWidth <= 140)
            : this._pendingSplitWidth <= 140;
        if (previewCollapsed !== this._splitPreviewCollapsed) {
            this._splitPreviewCollapsed = previewCollapsed;
            const body = document.getElementById('model-resolver-body');
            body?.classList.toggle('mr-queue-preview-collapsed', previewCollapsed);
            this.queueElement.style.display = previewCollapsed ? 'none' : '';
        }
        const now = performance.now();
        if (this._lastSplitDragApply && now - this._lastSplitDragApply < 33) return;
        this._lastSplitDragApply = now;
        if (this._splitDragFrame) return;
        this._splitDragFrame = requestAnimationFrame(() => {
            this._splitDragFrame = null;
            if (!this._splitDragging || !this.queueElement || !this._pendingSplitWidth || this._splitPreviewCollapsed) return;
            this.queueElement.style.width = `${this._pendingSplitWidth}px`;
        });
    },

    endSplitDrag() {
        if (!this._splitDragging) return;
        this._splitDragging = false;
        if (this._splitDragFrame) {
            cancelAnimationFrame(this._splitDragFrame);
            this._splitDragFrame = null;
        }
        if (this.queueElement && this._pendingSplitWidth && !this._splitPreviewCollapsed) {
            this.queueElement.style.width = `${this._pendingSplitWidth}px`;
        }
        const body = document.getElementById('model-resolver-body');
        body?.classList.remove('mr-is-resizing-queue');
        body?.classList.remove('mr-queue-preview-collapsed');
        document.removeEventListener('mousemove', this._onSplitMove);
        if (this._splitEdgeOpen && !this._pendingSplitWidth) {
            try {
                const restoreWidth = Math.max(240, Math.round(this._splitStart?.startWidth || 320));
                this.queueElement.style.width = `${restoreWidth}px`;
                this.queueElement.style.display = '';
                if (this.splitterElement) this.splitterElement.style.display = '';
                localStorage.setItem('model_resolver_split_w', String(restoreWidth));
            } catch (e) { }
            this.queueCollapsed = false;
            try { localStorage.setItem('model_resolver_queue_collapsed', '0'); } catch (e) { }
            this.updateQueueVisibility();
            this.updateQueuePanel();
            this._splitEdgeOpen = false;
            this._pendingSplitWidth = null;
            this._lastSplitDragApply = 0;
            this._splitPreviewCollapsed = false;
            try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
            try { document.body.style.cursor = this._splitPreviousCursor || ''; } catch (e) { }
            this._splitPreviousCursor = null;
            this._splitEdgeOpenedPastThreshold = false;
            setTimeout(() => { this._suppressQueueEdgeClick = false; }, 0);
            return;
        }
        const shouldCollapse = !!this._splitPreviewCollapsed;
        if (shouldCollapse) {
            try {
                const restoreWidth = Math.max(240, Math.round(this._splitStart?.startWidth || 320));
                this.queueElement.style.width = `${restoreWidth}px`;
                this.queueElement.style.display = '';
                localStorage.setItem('model_resolver_split_w', String(restoreWidth));
            } catch (e) { }
            this._pendingSplitWidth = null;
            this._lastSplitDragApply = 0;
            this._splitPreviewCollapsed = false;
            this._splitEdgeOpen = false;
            this._splitEdgeOpenedPastThreshold = false;
            try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
            try { document.body.style.cursor = this._splitPreviousCursor || ''; } catch (e) { }
            this._splitPreviousCursor = null;
            this.setQueueCollapsed(true);
            setTimeout(() => { this._suppressQueueEdgeClick = false; }, 0);
            return;
        }
        if (this.queueElement) this.queueElement.style.display = '';
        try {
            const rect = this.queueElement.getBoundingClientRect();
            localStorage.setItem('model_resolver_split_w', String(Math.round(rect.width)));
        } catch (e) { }
        this._pendingSplitWidth = null;
        this._lastSplitDragApply = 0;
        this._splitPreviewCollapsed = false;
        this._splitEdgeOpen = false;
        this._splitEdgeOpenedPastThreshold = false;
        try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
        if (this._splitPreviousCursor !== null) {
            try { document.body.style.cursor = this._splitPreviousCursor || ''; } catch (e) { }
            this._splitPreviousCursor = null;
        }
        setTimeout(() => { this._suppressQueueEdgeClick = false; }, 0);
    },

    /**
     * Queue a resolution for later batch apply
     */
    queueResolution(missing, resolvedModel) {
        if (!resolvedModel) {
            this.showNotification('No model selected', 'error');
            return;
        }

        const resolution = {
            node_id: missing.node_id,
            widget_index: missing.widget_index,
            resolved_path: resolvedModel.path,
            category: missing.category,
            resolved_model: resolvedModel,
            original_path: missing.original_path,
            subgraph_id: missing.subgraph_id,
            is_top_level: missing.is_top_level,
            node_type: missing.node_type,
            node_label: missing.subgraph_name || missing.node_type
        };

        const key = `${resolution.node_id}:${resolution.widget_index}:${resolution.subgraph_id || ''}:${resolution.is_top_level ? 'T' : 'F'}`;
        if (this.pendingIndex.has(key)) {
            // replace existing selection for this slot
            const idx = this.pendingIndex.get(key);
            this.pendingResolutions[idx] = resolution;
        } else {
            this.pendingIndex.set(key, this.pendingResolutions.length);
            this.pendingResolutions.push(resolution);
        }
        this.savePendingQueueForActiveWorkflow();

        // Update selected bar UI
        this.updateSelectedBarForMissing?.(missing);
        this.updateQueuePanel();
        this.updateApplyPendingButton();
    },

    /**
     * Apply all pending resolutions in batch
     */
    async applyPendingResolutions() {
        const list = this.pendingResolutions || [];
        if (!list.length) {
            this.showNotification('No selections queued', 'error');
            return;
        }

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            const response = await api.fetchApi('/model_resolver/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow, resolutions: list })
            });

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            const data = await response.json();
            if (data.success) {
                await this.updateWorkflowInComfyUI(data.workflow);
                this.showNotification(`✓ Linked ${list.length} selection${list.length>1?'s':''}`, 'success');
                // Clear queue and refresh analysis
                this.pendingResolutions = [];
                this.pendingIndex = new Map();
                this.savePendingQueueForActiveWorkflow();
                this.updateApplyPendingButton();
                this.updateQueuePanel();
                await this.loadWorkflowData(data.workflow, { force: true });
            } else {
                this.showNotification('Failed to apply selections: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (e) {
            console.error('Model Resolver: applyPendingResolutions error', e);
            this.showNotification('Error applying selections: ' + e.message, 'error');
        }
    },

    updateApplyPendingButton() {
        if (!this.applyPendingBtn) return;
        const count = this.pendingResolutions?.length || 0;
        const isEmpty = count === 0;
        const tooltip = count > 0
            ? `Apply ${count} queued model link${count > 1 ? 's' : ''} to the current workflow.`
            : 'Apply the model links you selected from local matches or search results.';
        this.applyPendingBtn.textContent = `Apply Selected (${count})`;
        this.setTooltip(this.applyPendingBtn, tooltip);
        this.applyPendingBtn.setAttribute('aria-disabled', String(isEmpty));
        this.applyPendingBtn.classList.toggle('mr-btn-is-disabled', isEmpty);
        this.updateBatchFooterButtons();
    },

    updateBatchFooterButtons() {
        const missingModels = this.missingModels || [];
        const selectedCount = this.getSelectedMissingModels().length;
        const totalCount = missingModels.length;
        const pendingCount = this.pendingResolutions?.length || 0;
        const activeCount = Object.keys(this.activeDownloads || {}).length;
        const downloadableSelected = this.getMissingWithDownloadSources(this.getSelectedMissingModels()).length;
        const downloadableAll = this.getMissingWithDownloadSources(missingModels).length;

        if (this.selectMenuButton) {
            this.selectMenuButton.textContent = `Select (${selectedCount}/${totalCount})`;
            this.selectMenuButton.classList.toggle('mr-btn-is-disabled', totalCount === 0);
        }
        if (this.searchMenuButton) {
            this.searchMenuButton.textContent = this.batchSearchRunning ? 'Searching...' : 'Search';
            this.searchMenuButton.classList.toggle('mr-btn-is-disabled', totalCount === 0 || this.batchSearchRunning);
        }
        if (this.downloadMenuButton) {
            const label = activeCount > 0 ? `Cancel Downloads (${activeCount})` : 'Download';
            this.downloadMenuButton.textContent = label;
            this.downloadMenuButton.classList.toggle('mr-btn-danger', activeCount > 0);
            this.downloadMenuButton.classList.toggle('mr-btn-download', activeCount === 0);
            this.downloadMenuButton.classList.toggle('mr-btn-is-disabled', activeCount === 0 && downloadableAll === 0);
            this.setTooltip(
                this.downloadMenuButton,
                activeCount > 0
                    ? `Cancel ${activeCount} active download${activeCount > 1 ? 's' : ''}.`
                    : `${downloadableSelected || downloadableAll} missing model${(downloadableSelected || downloadableAll) === 1 ? '' : 's'} currently have download sources.`
            );
        }
        if (this.applyPendingBtn) {
            this.applyPendingBtn.textContent = `Apply Selected (${pendingCount})`;
        }
    },

    createFooterMenu(name, label, items = [], buttonClass = 'mr-btn-secondary') {
        const button = $el(`button.mr-btn.${buttonClass}.mr-footer-btn.mr-footer-menu-button`, {
            type: 'button',
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            onclick: (event) => {
                event.stopPropagation();
                if (button.classList.contains('mr-btn-is-disabled')) {
                    if (name === 'search' && this.batchSearchRunning) {
                        this.showNotification('Batch search is already running.', 'info');
                    } else if (name === 'download') {
                        this.showNotification('No missing models have downloadable sources yet.', 'info');
                    } else {
                        this.showNotification('No missing models available.', 'info');
                    }
                    return;
                }
                this.toggleFooterMenu(name);
            }
        }, [$el("span", { textContent: label })]);

        const menu = $el("div.mr-footer-menu", { role: 'menu' }, items.map(item => (
            item === 'divider'
                ? $el("div.mr-footer-menu-divider", {})
                : $el("button.mr-footer-menu-item", {
                    type: 'button',
                    role: 'menuitem',
                    onclick: (event) => {
                        event.stopPropagation();
                        item.action();
                    }
                }, [$el("span", { textContent: item.label })])
        )));

        this.footerMenuButtons.set(name, button);
        this.footerMenus.set(name, menu);

        return $el("div.mr-footer-menu-wrap", {}, [button, menu]);
    },

    createFooter() {
        this.footerMenus = new Map();
        this.footerMenuButtons = new Map();

        const selectMenu = this.createFooterMenu('select', 'Select (0/0)', [
            { label: 'Select All', action: () => this.selectBatchMissingModels('all') },
            { label: 'Select None', action: () => this.selectBatchMissingModels('none') },
            { label: 'Invert Selection', action: () => this.selectBatchMissingModels('invert') },
            'divider',
            { label: 'Select Exact Local', action: () => this.selectBatchMissingModels('exact') },
            { label: 'Select No Exact Local', action: () => this.selectBatchMissingModels('no_exact') },
            { label: 'Select Partial Local', action: () => this.selectBatchMissingModels('partial') },
            { label: 'Select No Local Match', action: () => this.selectBatchMissingModels('no_local') },
            'divider',
            { label: 'Select With Download Source', action: () => this.selectBatchMissingModels('downloadable') },
            { label: 'Select Without Download Source', action: () => this.selectBatchMissingModels('no_download') },
            'divider',
            { label: 'Select Searched', action: () => this.selectBatchMissingModels('searched') },
            { label: 'Select Unsearched', action: () => this.selectBatchMissingModels('unsearched') }
        ]);
        this.selectMenuButton = this.footerMenuButtons.get('select');
        this.selectMenuWrap = selectMenu;

        const searchMenu = this.createFooterMenu('search', 'Search', [
            { label: 'Search Selected', action: () => this.searchMissingBatch('selected', 'all') },
            { label: 'Search All Missing', action: () => this.searchMissingBatch('all', 'all') },
            { label: 'Search Unsearched', action: () => this.searchMissingBatch('unsearched', 'all') },
            'divider',
            { label: 'Selected: CivitAI', action: () => this.searchMissingBatch('selected', 'civitai') },
            { label: 'Selected: HuggingFace', action: () => this.searchMissingBatch('selected', 'huggingface') }
        ]);
        this.searchMenuButton = this.footerMenuButtons.get('search');
        this.searchMenuWrap = searchMenu;

        // Store reference to download all button so we can update its text
        this.downloadAllButton = $el("button.mr-btn.mr-btn-download.mr-footer-btn", {
            "data-tooltip": "Download every missing model that has a known download source.",
            "aria-label": "Download all missing models",
            onclick: () => this.handleDownloadAllClick()
        }, [
            $el("span.mr-btn-icon", { textContent: "☁" }),
            $el("span", { textContent: " Download All Missing" })
        ]);

        // Auto-resolve button (secondary style)
        this.autoResolveButton = $el("button.mr-btn.mr-btn-secondary.mr-footer-btn", {
            "data-tooltip": "Automatically link all missing models with a 100% local match.",
            "aria-label": "Auto-link all 100 percent local matches",
            onclick: () => this.autoResolve100Percent()
        }, [
            $el("span.mr-btn-icon", { textContent: "🔗" }),
            $el("span", { textContent: " Auto-Link 100%" })
        ]);
        this.queueExactButton = $el("button.mr-btn.mr-btn-secondary.mr-footer-btn", {
            type: 'button',
            onclick: () => this.queueExactLocalMatchesBatch('selected')
        }, [
            $el("span", { textContent: "Queue Exact" })
        ]);

        // Apply pending resolutions button
        this.applyPendingBtn = $el("button.mr-btn.mr-btn-primary.mr-footer-btn", {
            id: "apply-pending-resolutions",
            "data-tooltip": "Apply the model links you selected from local matches or search results.",
            "aria-label": "Apply selected model links",
            "aria-disabled": "true",
            textContent: "Apply Selected (0)",
            onclick: () => {
                if ((this.pendingResolutions?.length || 0) === 0) return;
                this.applyPendingResolutions();
            }
        });
        this.applyPendingBtn.classList.add('mr-btn-is-disabled');
        this.downloadAllButton.setAttribute('aria-label', 'Download all missing models');
        this.autoResolveButton.setAttribute('aria-label', 'Auto-link all 100 percent local matches');
        this.queueExactButton.setAttribute('aria-label', 'Queue exact local matches');
        this.applyPendingBtn.setAttribute('aria-label', 'Apply selected model links');
        this.applyPendingBtn.setAttribute('aria-disabled', 'true');

        this.setTooltip(this.downloadAllButton, 'Download every missing model that has a known download source.');
        this.setTooltip(this.autoResolveButton, 'Automatically link all missing models with a 100% local match.');
        this.setTooltip(this.queueExactButton, 'Queue exact local matches for the selected rows, or all exact matches if nothing is selected.');
        this.setTooltip(this.applyPendingBtn, 'Apply the model links you selected from local matches or search results.');

        const downloadMenu = this.createFooterMenu('download', 'Download', [
            { label: 'Download Selected', action: () => this.downloadMissingBatch('selected') },
            { label: 'Download All With Sources', action: () => this.downloadMissingBatch('all') },
            'divider',
            { label: 'Cancel Downloads', action: () => { this.closeFooterMenus(); this.cancelAllDownloads(); } }
        ], 'mr-btn-download');
        this.downloadMenuButton = this.footerMenuButtons.get('download');
        this.downloadMenuWrap = downloadMenu;
        this.downloadAllButton = this.downloadMenuButton;
        this.downloadAllButton.setAttribute('aria-label', 'Download missing models');
        this.setTooltip(this.downloadAllButton, 'Download selected models or all missing models with known download sources.');

        return $el("div.mr-footer", {}, [
            selectMenu,
            searchMenu,
            this.queueExactButton,
            this.applyPendingBtn,
            this.autoResolveButton,
            downloadMenu
        ]);
    },

    animateTabContentTransition() {
        if (!this.contentElement?.animate) return;

        try {
            this.contentElement.animate(
                [
                    { opacity: 0.72, transform: 'translateY(7px)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ],
                {
                    duration: 180,
                    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
                }
            );
        } catch (error) {
            console.warn('Model Resolver: tab content animation failed', error);
        }
    },

    /**
     * Handle click on Download All / Cancel All button
     */
    handleDownloadAllClick() {
        if (Object.keys(this.activeDownloads).length > 0) {
            // Cancel all active downloads
            this.cancelAllDownloads();
        } else {
            // Start downloading all missing
            this.downloadAllMissing();
        }
    },

    /**
     * Cancel all active downloads
     */
    async cancelAllDownloads() {
        const downloadIds = Object.keys(this.activeDownloads);
        if (downloadIds.length === 0) return;

        this.showNotification(`Cancelling ${downloadIds.length} download${downloadIds.length > 1 ? 's' : ''}...`, 'info');

        for (const downloadId of downloadIds) {
            try {
                await api.fetchApi(`/model_resolver/cancel/${downloadId}`, {
                    method: 'POST'
                });
            } catch (error) {
                console.error('Model Resolver: Error cancelling download:', error);
            }
        }
    },

    /**
     * Update the Download All button state based on active downloads
     */
    updateDownloadAllButtonState() {
        if (!this.downloadAllButton) return;
        if (this.downloadMenuButton && this.downloadAllButton === this.downloadMenuButton) {
            this.updateBatchFooterButtons();
            return;
        }

        const activeCount = Object.keys(this.activeDownloads).length;
        if (activeCount > 0) {
            this.downloadAllButton.innerHTML = `<span class="mr-btn-icon">✕</span> Cancel All (${activeCount})`;
            this.downloadAllButton.setAttribute(
                'data-tooltip',
                `Cancel ${activeCount} active download${activeCount > 1 ? 's' : ''}.`
            );
            this.downloadAllButton.setAttribute('aria-label', 'Cancel all active downloads');
            this.downloadAllButton.classList.remove('mr-btn-download');
            this.downloadAllButton.classList.add('mr-btn-danger');
        } else {
            this.downloadAllButton.innerHTML = `<span class="mr-btn-icon">☁</span> Download All Missing`;
            this.downloadAllButton.setAttribute(
                'data-tooltip',
                'Download every missing model that has a known download source.'
            );
            this.downloadAllButton.setAttribute('aria-label', 'Download all missing models');
            this.downloadAllButton.classList.remove('mr-btn-danger');
            this.downloadAllButton.classList.add('mr-btn-download');
        }
    }
};
