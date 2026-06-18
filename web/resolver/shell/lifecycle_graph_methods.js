import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const lifecycleGraphMethods = {
    async show(workflow = null) {
        this.undockToFloating({ persist: false });
        await this.showContent(workflow, { restoreFullscreen: true });
    },

    async showDocked(container, workflow = null) {
        this.dockTo(container);
        await this.showContent(workflow, { restoreFullscreen: false });
    },

    async showContent(workflow = null, { restoreFullscreen = true } = {}) {
        this.backdrop.style.display = "none";
        this.element.style.display = "flex";
        if (!this.docked) {
            this.scheduleModalViewportClamp();
        }

        // Update button state in case there are active downloads
        this.updateDownloadAllButtonState();

        // On first open: load settings from server so tokens are available on
        // every browser without re-entering them.
        if (!this._serverSettingsLoaded) {
            this._serverSettingsLoaded = true;
            await this.loadSettingsFromServer();
        }

        // Ensure all models are loaded for dropdown
        await this.ensureCapabilitiesLoaded();
        await this.ensureBaseModelsLoaded();
        await this.ensureAllModelsLoaded();
        await this.ensureDownloadDirectoriesLoaded();

        // Restore fullscreen state if enabled
        try {
            const fs = localStorage.getItem('model_resolver_modal_fullscreen');
            if (!this.docked && restoreFullscreen && fs === '1') this.setFullScreen(true);
        } catch (e) { }

        // Attach drag handle event listener (only once)
        this.attachDragHandleIfNeeded();

        this.activeTab = this.restoreActiveTab();
        this.updateTabButtonStates();
        this.updateQueueVisibility();
        this.syncWorkflowScopedQueue(workflow || this.getCurrentWorkflow());

        if (this.activeTab === 'missing') {
            await this.loadWorkflowData(workflow);
        } else if (this.activeTab === 'loaded') {
            this.switchTab('loaded', { force: true });
        } else {
            this.switchTab('options', { force: true });
        }
    },

    // Attach topbar drag listeners while preserving the handle-based viewport clamp.
    attachDragHandleIfNeeded() {
        if (this._dragHandleAttached) return;

        const handle = document.getElementById('model-resolver-drag-handle');
        const topbar = this.element?.querySelector('.mr-dialog-topbar');
        if (!handle || !topbar) return;

        const onMouseDown = (e) => {
            if (this.fullscreen || this.docked) return; // no drag in fullscreen or docked mode
            if (e.button !== 0 || this.isTopbarDragExcluded(e.target)) return;
            topbar.classList.add('mr-is-dragging');
            this.startDrag(e);
        };
        const onMouseUp = () => { topbar.classList.remove('mr-is-dragging'); };

        topbar.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);

        this._dragHandleAttached = true;
    },

    isTopbarDragExcluded(target) {
        if (!(target instanceof Element)) return false;
        return !!target.closest([
            '.mr-tabs',
            '.mr-dialog-controls',
            'button',
            'a',
            'input',
            'select',
            'textarea',
            '[role="button"]',
            '[data-ml-no-drag]'
        ].join(','));
    },

    close({ collapseSidebar = true } = {}) {
        const wasDocked = this.docked;
        const dockContainer = this.dockContainer;
        this.rememberSidebarOpenMode(this.docked ? 'docked' : 'floating');
        this._hidePreview?.();
        this.hideTooltip();
        this.backdrop.style.display = "none";
        this.element.style.display = "none";

        if (wasDocked && collapseSidebar) {
            this.closeComfySidebar(dockContainer);
        }
    },

    /**
     * Load workflow data and display missing models
     */
    async loadWorkflowData(workflow = null, { force = false } = {}) {
        if (!this.contentElement) return;

        this._workflowDataLoadToken = null;
        let loadToken = null;
        const shouldRenderMissingModels = () => (
            this.activeTab === 'missing' &&
            loadToken &&
            this._workflowDataLoadToken === loadToken &&
            this.contentElement
        );

        // Show loading state
        try {
            // Use provided workflow, or get current workflow from ComfyUI
            if (!workflow) {
                workflow = this.getCurrentWorkflow();
            }

            if (!workflow) {
                this._analysisProgressToken = null;
                if (shouldRenderMissingModels()) {
                    this.contentElement.innerHTML = '<p>No workflow loaded. Please load a workflow first.</p>';
                } else if (this.activeTab === 'missing' && this.contentElement) {
                    this.contentElement.innerHTML = '<p>No workflow loaded. Please load a workflow first.</p>';
                }
                return;
            }
            this.syncWorkflowScopedQueue(workflow);

            loadToken = `missing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this._workflowDataLoadToken = loadToken;

            const workflowSignature = this.getWorkflowSignature(workflow);
            if (force) {
                this.invalidateLoadedModelsCacheForActiveWorkflow();
            }
            if (
                !force &&
                workflowSignature &&
                this.cachedWorkflowSignature === workflowSignature &&
                this.cachedAnalysisData
            ) {
                if (shouldRenderMissingModels()) {
                    await this.ensureDownloadDirectoriesLoaded();
                    this.displayMissingModels(this.contentElement, this.cachedAnalysisData);
                    this.reconnectActiveDownloads();
                }
                return;
            }

            const analysisId = `an-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this._analysisProgressToken = analysisId;
            if (shouldRenderMissingModels()) {
                this.contentElement.innerHTML = this.renderAnalysisProgress({
                    status: 'starting',
                    message: 'Starting analysis...',
                    current: 0,
                    total: 0
                });
            }

            // Call analyze endpoint
            const progressPromise = this.pollAnalysisProgress(analysisId, analysisId);
            const response = await api.fetchApi('/model_resolver/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow, analysis_id: analysisId })
            });
            if (this._analysisProgressToken === analysisId) {
                this._analysisProgressToken = null;
            }
            await progressPromise;

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            if (this._workflowDataLoadToken === loadToken) {
                this.cachedWorkflowSignature = workflowSignature;
                this.cachedAnalysisData = data;
                this.saveAnalysisCacheForActiveWorkflow();
            }
            if (shouldRenderMissingModels()) {
                await this.ensureDownloadDirectoriesLoaded();
                this.displayMissingModels(this.contentElement, data);

                // Reconnect any active downloads to their new progress divs
                this.reconnectActiveDownloads();
            }

        } catch (error) {
            if (!loadToken || this._workflowDataLoadToken === loadToken) {
                this._analysisProgressToken = null;
            }
            console.error('Model Resolver: Error loading workflow data:', error);
            if (shouldRenderMissingModels()) {
                this.contentElement.innerHTML = `<p class="mr-error-text">Error: ${error.message}</p>`;
            } else if (!loadToken && this.activeTab === 'missing' && this.contentElement) {
                this.contentElement.innerHTML = `<p class="mr-error-text">Error: ${error.message}</p>`;
            }
        }
    },

    /**
     * Get current workflow from ComfyUI
     */
    getCurrentWorkflow() {
        // Try to get workflow from app
        if (app?.graph) {
            try {
                // Use ComfyUI's workflow serialization
                const workflow = app.graph.serialize();
                return workflow;
            } catch (e) {
                console.warn('Model Resolver: Could not serialize workflow from graph:', e);
            }
        }
        return null;
    },

    /**
     * Locate and focus a node in the ComfyUI canvas
     */
    locateNodeInGraph(nodeId) {
        try {
            if (!app?.graph) {
                this.showNotification('Cannot locate node - graph not available', 'error');
                return;
            }

            // Find the node in the graph
            const node = app.graph.getNodeById(nodeId);
            if (!node) {
                this.showNotification(`Node #${nodeId} not found in graph`, 'error');
                return;
            }

            let locatedWithAnimation = false;

            // Focus on the node in the canvas with animated panning when possible
            if (app.canvas?.ds && app.canvas?.canvas) {
                locatedWithAnimation = this.animateCanvasToNode(node);
            }

            if (!locatedWithAnimation && app.graph._nodes && app.graph._nodes.get(nodeId)) {
                // Alternative method for older versions
                const canvasNode = app.graph._nodes.get(nodeId);
                if (canvasNode && canvasNode.setSelected && canvasNode.graph) {
                    canvasNode.setSelected(true);
                    // Scroll to node
                    app.canvas.scrollToNode(canvasNode);
                }
            } else if (!locatedWithAnimation && app.ui && app.ui.nodeGraph && typeof app.ui.nodeGraph.scrollToNode === 'function') {
                // Alternative for other versions
                app.ui.nodeGraph.scrollToNode(node);
            } else if (!locatedWithAnimation && app.canvas && typeof app.canvas.centerOnNode === 'function') {
                // Final fallback for versions where animation path is unavailable
                app.canvas.centerOnNode(node);
            }

            // Also try to flash/select the node
            // Deselect all nodes first
            if (app.graph && app.graph.nodes) {
                app.graph.nodes.forEach(n => {
                    if (n.selected) n.selected = false;
                });
            }

            // Select and highlight our node
            node.selected = true;

            this.showNotification(`Focused on Node #${nodeId} (${node.type})`, 'info');
        } catch (e) {
            console.error('Model Resolver: Error locating node:', e);
            this.showNotification('Error locating node: ' + e.message, 'error');
        }
    },

    animateCanvasToNode(node) {
        const canvas = app?.canvas;
        const ds = canvas?.ds;
        const htmlCanvas = canvas?.canvas;
        if (!canvas || !ds || !htmlCanvas) return false;

        const rect = node.boundingRect || [node.pos?.[0] || 0, node.pos?.[1] || 0, node.size?.[0] || 0, node.size?.[1] || 0];
        const centerX = rect[0] + (rect[2] || 0) / 2;
        const centerY = rect[1] + (rect[3] || 0) / 2;
        const startScale = Number.isFinite(ds.scale) && ds.scale > 0 ? ds.scale : 1;
        const locateViewport = this.getLocateViewport(htmlCanvas);
        const viewportWidth = locateViewport.width;
        const viewportHeight = locateViewport.height;

        if (!viewportWidth || !viewportHeight) return false;

        const nodeWidth = Math.max(rect[2] || 0, 1);
        const nodeHeight = Math.max(rect[3] || 0, 1);
        const paddingX = 36;
        const paddingY = 32;
        const maxLocateScale = 2.5;
        const fitScaleX = viewportWidth / (nodeWidth + (paddingX * 2));
        const fitScaleY = viewportHeight / (nodeHeight + (paddingY * 2));
        const targetScale = Math.max(0.15, Math.min(maxLocateScale, fitScaleX, fitScaleY));

        const getCenteredOffset = (scale) => {
            return {
                x: -centerX + (locateViewport.centerX / scale),
                y: -centerY + (locateViewport.centerY / scale)
            };
        };

        const startOffset = {
            x: Number.isFinite(ds.offset?.[0]) ? ds.offset[0] : getCenteredOffset(startScale).x,
            y: Number.isFinite(ds.offset?.[1]) ? ds.offset[1] : getCenteredOffset(startScale).y
        };
        const targetOffset = getCenteredOffset(targetScale);

        if (this._locateAnimationFrame) {
            cancelAnimationFrame(this._locateAnimationFrame);
            this._locateAnimationFrame = null;
        }

        const durationMs = 380;
        const startTime = performance.now();
        const easeInOutCubic = (t) => t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const tick = (now) => {
            const progress = Math.min(1, (now - startTime) / durationMs);
            const eased = easeInOutCubic(progress);

            ds.scale = startScale + ((targetScale - startScale) * eased);
            ds.offset[0] = startOffset.x + ((targetOffset.x - startOffset.x) * eased);
            ds.offset[1] = startOffset.y + ((targetOffset.y - startOffset.y) * eased);
            canvas.setDirty?.(true, true);
            app.graph?.setDirtyCanvas?.(true, true);

            if (progress < 1) {
                this._locateAnimationFrame = requestAnimationFrame(tick);
            } else {
                this._locateAnimationFrame = null;
            }
        };

        this._locateAnimationFrame = requestAnimationFrame(tick);
        return true;
    },

    getLocateViewport(htmlCanvas) {
        const canvasRect = htmlCanvas.getBoundingClientRect?.();
        const dpr = window.devicePixelRatio || 1;
        const canvasWidth = canvasRect?.width || htmlCanvas.clientWidth || ((htmlCanvas.width || 0) / dpr);
        const canvasHeight = canvasRect?.height || htmlCanvas.clientHeight || ((htmlCanvas.height || 0) / dpr);
        const viewport = {
            left: 0,
            top: 0,
            right: canvasWidth,
            bottom: canvasHeight
        };

        if (this.docked && canvasRect?.width && canvasRect?.height) {
            const obstructionElement = this.dockContainer instanceof HTMLElement
                ? this.dockContainer
                : this.element;
            const obstructionRect = obstructionElement?.getBoundingClientRect?.();
            if (obstructionRect?.width && obstructionRect?.height) {
                this.subtractDockedObstructionFromLocateViewport(viewport, canvasRect, obstructionRect);
            }
        }

        const width = Math.max(1, viewport.right - viewport.left);
        const height = Math.max(1, viewport.bottom - viewport.top);
        return {
            width,
            height,
            centerX: viewport.left + (width / 2),
            centerY: viewport.top + (height / 2)
        };
    },

    subtractDockedObstructionFromLocateViewport(viewport, canvasRect, obstructionRect) {
        const obstruction = {
            left: Math.max(0, obstructionRect.left - canvasRect.left),
            top: Math.max(0, obstructionRect.top - canvasRect.top),
            right: Math.min(canvasRect.width, obstructionRect.right - canvasRect.left),
            bottom: Math.min(canvasRect.height, obstructionRect.bottom - canvasRect.top)
        };
        const overlapWidth = obstruction.right - obstruction.left;
        const overlapHeight = obstruction.bottom - obstruction.top;
        if (overlapWidth <= 0 || overlapHeight <= 0) return;

        const coversMostHeight = overlapHeight >= canvasRect.height * 0.5;
        const coversMostWidth = overlapWidth >= canvasRect.width * 0.5;
        const edgeTolerance = 2;

        if (coversMostHeight) {
            if (obstruction.left <= edgeTolerance) {
                viewport.left = Math.min(viewport.right, Math.max(viewport.left, obstruction.right));
                return;
            }
            if (obstruction.right >= canvasRect.width - edgeTolerance) {
                viewport.right = Math.max(viewport.left, Math.min(viewport.right, obstruction.left));
                return;
            }

            const leftSpace = obstruction.left - viewport.left;
            const rightSpace = viewport.right - obstruction.right;
            if (rightSpace >= leftSpace) {
                viewport.left = Math.min(viewport.right, Math.max(viewport.left, obstruction.right));
            } else {
                viewport.right = Math.max(viewport.left, Math.min(viewport.right, obstruction.left));
            }
            return;
        }

        if (coversMostWidth) {
            if (obstruction.top <= edgeTolerance) {
                viewport.top = Math.min(viewport.bottom, Math.max(viewport.top, obstruction.bottom));
                return;
            }
            if (obstruction.bottom >= canvasRect.height - edgeTolerance) {
                viewport.bottom = Math.max(viewport.top, Math.min(viewport.bottom, obstruction.top));
            }
        }
    },

    /**
     * Reconnect active downloads to their new progress div elements after UI refresh
     */
    reconnectActiveDownloads() {
        if (!this.contentElement) return;

        for (const [downloadId, info] of Object.entries(this.activeDownloads)) {
            if (!info?.missing) continue;
            const snapshot = this.rememberDownloadUiState?.(
                downloadId,
                info,
                info.lastProgress || { status: info.lastStatus || 'starting', progress: 0 },
                { isActive: true }
            );
            this.renderDownloadSnapshot?.(downloadId, snapshot);
        }
    },

    getMissingModelKey(missing = {}) {
        const nodeId = missing.node_id ?? '';
        const widgetIndex = missing.widget_index ?? '';
        const subgraphId = missing.subgraph_id || '';
        const scope = missing.is_top_level !== false ? 'T' : 'F';
        return `${nodeId}:${widgetIndex}:${subgraphId}:${scope}`;
    }
};
