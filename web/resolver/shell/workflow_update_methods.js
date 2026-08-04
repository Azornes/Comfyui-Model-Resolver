import { app } from "../../../../../scripts/app.js";
import { getModelCardUrl } from "../utils/url_utils.js";
export const workflowUpdateMethods = {
    isWorkflowRefreshSuppressed() {
        return Number(this._workflowRefreshSuppressionDepth || 0) > 0;
    },

    async runWithWorkflowRefreshSuppressed(callback) {
        this._workflowRefreshSuppressionDepth = Number(this._workflowRefreshSuppressionDepth || 0) + 1;
        try {
            return await callback();
        } finally {
            this._workflowRefreshSuppressionDepth = Math.max(
                0,
                Number(this._workflowRefreshSuppressionDepth || 0) - 1
            );
        }
    },

    scheduleComfyModelCatalogRefreshAfterApply(workflow = null, resolutions = []) {
        setTimeout(() => {
            this.runWithWorkflowRefreshSuppressed(
                () => this.refreshComfyModelCatalogAfterApply(workflow, resolutions)
            ).then(refreshed => {
                const workflowSignature = this.getMissingWorkflowSignature?.(workflow);
                const hasCurrentAnalysis = Boolean(
                    workflowSignature
                    && this.cachedWorkflowSignature === workflowSignature
                    && this.cachedAnalysisData
                );
                if (refreshed && !hasCurrentAnalysis) {
                    this.scheduleActiveWorkflowRefresh?.('node-widget-change');
                }
            }).catch(error => {
                console.warn('Model Resolver: deferred ComfyUI model catalog refresh failed:', error);
            });
        }, 0);
    },

    async refreshComfyModelCatalogAfterApply(workflow = null, resolutions = []) {
        if (!this.isAutoRefreshComfyModelsAfterApplyEnabled()) {
            return false;
        }

        if (!this.shouldRefreshComfyModelCatalogForApply(workflow, resolutions)) {
            return false;
        }

        if (this._comfyModelCatalogRefreshPromise) {
            return this._comfyModelCatalogRefreshPromise;
        }

        this._comfyModelCatalogRefreshPromise = (async () => {
            try {
                if (typeof app?.refreshComboInNodes === 'function') {
                    await app.refreshComboInNodes();
                    return true;
                }

                const nodeDefs = await this.fetchComfyNodeDefs();
                this.applyComfyNodeDefs(nodeDefs);
                this.refreshGraphComboWidgetsFromNodeDefs(nodeDefs);
                app?.graph?.setDirtyCanvas?.(true, true);
                return true;
            } catch (error) {
                console.warn('Model Resolver: could not refresh ComfyUI model catalog:', error);
                return false;
            } finally {
                this._comfyModelCatalogRefreshPromise = null;
            }
        })();

        return this._comfyModelCatalogRefreshPromise;
    },

    isAutoRefreshComfyModelsAfterApplyEnabled() {
        const tokens = this.getStoredTokens?.();
        return tokens?.auto_refresh_comfy_models_after_apply !== false;
    },

    async fetchComfyNodeDefs() {
        return await this.fetchJson(`/object_info?model_resolver_refresh=${Date.now()}`, {}, 'Fetch ComfyUI node definitions');
    },

    shouldRefreshComfyModelCatalogForApply(workflow = null, resolutions = []) {
        const targets = this.getComfyCatalogApplyTargets(workflow, resolutions);
        if (!targets.length) return false;

        return targets.some(target => !this.isComfyCatalogTargetAvailable(target));
    },

    getComfyCatalogApplyTargets(workflow = null, resolutions = []) {
        if (!workflow || !Array.isArray(resolutions) || !resolutions.length) return [];

        const targets = [];
        for (const resolution of resolutions) {
            const node = this.findWorkflowNodeForResolution(workflow, resolution);
            if (!node) continue;

            const widgetIndex = Number(resolution?.widget_index);
            if (!Number.isInteger(widgetIndex)) continue;

            const value = this.getAppliedWidgetValueFromNode(node, widgetIndex, resolution);
            if (!value) continue;

            const nodeType = node.comfyClass || node.type || resolution.node_type || '';
            const widgetName = this.getWorkflowNodeWidgetName(node, widgetIndex)
                || this.getGraphNodeWidgetName(node, widgetIndex, resolution)
                || this.getComfyWidgetNameByIndex(nodeType, widgetIndex);
            if (!nodeType || !widgetName) continue;

            targets.push({ nodeType, widgetName, value });
        }

        return targets;
    },

    findWorkflowNodeForResolution(workflow = {}, resolution = {}) {
        const nodeId = String(resolution?.node_id ?? '');
        if (!nodeId) return null;

        const isTopLevel = resolution?.is_top_level !== false;
        if (isTopLevel) {
            return (workflow.nodes || []).find(node => String(node?.id) === nodeId) || null;
        }

        const subgraphId = String(resolution?.subgraph_id || '');
        const subgraphs = workflow.definitions?.subgraphs || [];
        for (const subgraph of subgraphs) {
            if (subgraphId && String(subgraph?.id) !== subgraphId) continue;
            const node = (subgraph?.nodes || []).find(item => String(item?.id) === nodeId);
            if (node) return node;
        }

        return null;
    },

    getAppliedWidgetValueFromNode(node = {}, widgetIndex = -1, resolution = {}) {
        const widgetsValues = Array.isArray(node.widgets_values) ? node.widgets_values : [];
        const rawValue = widgetsValues[widgetIndex];
        const nestedKey = resolution?.nested_key;
        if (nestedKey && rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
            return String(rawValue[nestedKey] || '').trim();
        }

        if (typeof rawValue === 'string') return rawValue.trim();
        return '';
    },

    getWorkflowNodeWidgetName(node = {}, widgetIndex = -1) {
        const widget = Array.isArray(node.widgets) ? node.widgets[widgetIndex] : null;
        return String(widget?.name || widget?.label || widget?.widget || '').trim();
    },

    getGraphNodeWidgetName(workflowNode = {}, widgetIndex = -1, resolution = {}) {
        if (resolution?.is_top_level === false) return '';

        const nodeId = String(resolution?.node_id ?? workflowNode?.id ?? '');
        const graphNode = (app?.graph?.nodes || []).find(node => String(node?.id) === nodeId);
        const widget = graphNode?.widgets?.[widgetIndex];
        return String(widget?.name || widget?.label || '').trim();
    },

    getComfyWidgetNameByIndex(nodeType = '', widgetIndex = -1) {
        const nodeDef = this.getCurrentComfyNodeDef(nodeType);
        if (!nodeDef || widgetIndex < 0) return '';

        const names = [];
        const input = nodeDef.input || {};
        for (const sectionName of ['required', 'optional']) {
            const section = input[sectionName];
            if (!section || typeof section !== 'object') continue;
            for (const [name, spec] of Object.entries(section)) {
                if (this.isComfyWidgetInputSpec(spec)) {
                    names.push(name);
                }
            }
        }

        return names[widgetIndex] || '';
    },

    getCurrentComfyNodeDef(nodeType = '') {
        if (!nodeType) return null;

        return app?.nodeDefs?.[nodeType]
            || globalThis?.LiteGraph?.registered_node_types?.[nodeType]?.nodeData
            || globalThis?.LiteGraph?.registered_node_types?.[nodeType]?.prototype?.nodeData
            || null;
    },

    isComfyWidgetInputSpec(inputSpec) {
        if (!Array.isArray(inputSpec)) return false;
        if (Array.isArray(inputSpec[0])) return true;
        const type = String(inputSpec[0] || '').toUpperCase();
        return ['STRING', 'INT', 'FLOAT', 'BOOLEAN'].includes(type);
    },

    isComfyCatalogTargetAvailable(target = {}) {
        const values = this.getCurrentComfyCatalogValues(target.nodeType, target.widgetName);
        if (!values) return true;

        const wanted = this.normalizeComfyCatalogValue(target.value);
        return values.some(value => this.normalizeComfyCatalogValue(value) === wanted);
    },

    getCurrentComfyCatalogValues(nodeType = '', widgetName = '') {
        const nodeDef = this.getCurrentComfyNodeDef(nodeType);
        const values = this.getComfyComboValuesFromSpec(
            this.getComfyWidgetInputSpec(nodeDef, widgetName)
        );
        if (values) return values;

        const graphNodes = app?.graph?.nodes || [];
        for (const node of graphNodes) {
            const type = node?.comfyClass || node?.type;
            if (type !== nodeType || !Array.isArray(node.widgets)) continue;

            const widget = node.widgets.find(item => item?.name === widgetName);
            const widgetValues = widget?.options?.values;
            if (Array.isArray(widgetValues)) return widgetValues;
        }

        return null;
    },

    normalizeComfyCatalogValue(value = '') {
        return this.normalizePathToForward(value);
    },

    applyComfyNodeDefs(nodeDefs = {}) {
        if (!nodeDefs || typeof nodeDefs !== 'object') return;

        try {
            if (app && typeof app === 'object') {
                if (!app.nodeDefs || typeof app.nodeDefs !== 'object') {
                    app.nodeDefs = {};
                }
                Object.assign(app.nodeDefs, nodeDefs);
            }
        } catch (error) {
            console.warn('Model Resolver: could not update app.nodeDefs:', error);
        }

        const registeredTypes = globalThis?.LiteGraph?.registered_node_types;
        if (!registeredTypes || typeof registeredTypes !== 'object') return;

        for (const [nodeType, nodeDef] of Object.entries(nodeDefs)) {
            const registered = registeredTypes[nodeType];
            if (!registered) continue;

            try {
                registered.nodeData = nodeDef;
                registered.prototype.nodeData = nodeDef;
            } catch (error) {
                console.warn(`Model Resolver: could not update node definition for ${nodeType}:`, error);
            }
        }
    },

    getComfyWidgetInputSpec(nodeDef = {}, widgetName = '') {
        const input = nodeDef?.input;
        if (!input || !widgetName) return null;

        return input.required?.[widgetName]
            || input.optional?.[widgetName]
            || input.hidden?.[widgetName]
            || null;
    },

    getComfyComboValuesFromSpec(inputSpec) {
        if (!Array.isArray(inputSpec)) return null;

        const values = inputSpec[0];
        return Array.isArray(values) ? values : null;
    },

    refreshGraphComboWidgetsFromNodeDefs(nodeDefs = {}) {
        const graphNodes = app?.graph?.nodes;
        if (!Array.isArray(graphNodes) || !nodeDefs || typeof nodeDefs !== 'object') return;

        for (const node of graphNodes) {
            const nodeType = node?.comfyClass || node?.type;
            const nodeDef = nodeDefs[nodeType];
            if (!nodeDef || !Array.isArray(node.widgets)) continue;

            for (const widget of node.widgets) {
                const values = this.getComfyComboValuesFromSpec(
                    this.getComfyWidgetInputSpec(nodeDef, widget?.name)
                );
                if (!values) continue;

                if (!widget.options || typeof widget.options !== 'object') {
                    widget.options = {};
                }
                widget.options.values = values;
            }
        }
    },

    /**
     * Extract model page URL from a download URL
     * HuggingFace file: https://huggingface.co/Owner/Repo/resolve/main/file.safetensors -> https://huggingface.co/Owner/Repo/blob/main/file.safetensors
     * CivitAI: https://civitai.com/api/download/models/123?type=Model -> https://civitai.com/models/123
     */
    getModelCardUrl(downloadUrl) {
        return getModelCardUrl(downloadUrl);
    },

    /**
     * Update workflow in ComfyUI's UI/memory
     * Updates the current workflow in place instead of creating a new tab
     */
    cloneWorkflowWidgetValue(value) {
        if (!value || typeof value !== 'object') return value;

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch {
                // Fall back to JSON for plain serialized workflow values.
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return value;
        }
    },

    applyWorkflowResolutionValuesToGraph(workflow, resolutions = []) {
        const graph = app?.graph;
        if (!graph || !workflow || !Array.isArray(resolutions) || !resolutions.length) {
            return false;
        }

        const graphNodes = Array.isArray(graph.nodes)
            ? graph.nodes
            : (Array.isArray(graph._nodes) ? graph._nodes : []);
        const updates = new Map();

        for (const resolution of resolutions) {
            if (resolution?.is_top_level === false) return false;

            const nodeId = String(resolution?.node_id ?? '');
            const widgetIndex = Number(resolution?.widget_index);
            if (!nodeId || !Number.isInteger(widgetIndex) || widgetIndex < 0) return false;

            const workflowNode = this.findWorkflowNodeForResolution(workflow, resolution);
            const graphNode = graph.getNodeById?.(resolution.node_id)
                || graphNodes.find(node => String(node?.id) === nodeId);
            const widget = graphNode?.widgets?.[widgetIndex];
            if (!workflowNode || !graphNode || !widget || !Array.isArray(workflowNode.widgets_values)) {
                return false;
            }

            updates.set(`${nodeId}:${widgetIndex}`, {
                graphNode,
                widget,
                widgetIndex,
                value: workflowNode.widgets_values[widgetIndex]
            });
        }

        if (!updates.size) return false;

        graph.beforeChange?.();
        try {
            for (const { graphNode, widget, widgetIndex, value } of updates.values()) {
                const oldValue = widget.value;
                const nextValue = this.cloneWorkflowWidgetValue(value);
                widget.value = nextValue;

                if (Array.isArray(graphNode.widgets_values)) {
                    graphNode.widgets_values[widgetIndex] = this.cloneWorkflowWidgetValue(value);
                }

                try {
                    graphNode.onWidgetChanged?.(widget.name, nextValue, oldValue, widget);
                } catch (error) {
                    console.warn('Model Resolver: node rejected a linked widget update:', error);
                }
            }
        } finally {
            graph.afterChange?.();
        }

        graph.setDirtyCanvas?.(true, true);
        return true;
    },

    async updateWorkflowInComfyUI(workflow, resolutions = []) {
        if (!app || !app.graph) {
            console.warn('Model Resolver: Could not update workflow - app or app.graph not available');
            return false;
        }

        return await this.runWithWorkflowRefreshSuppressed(async () => {
            try {
                if (this.applyWorkflowResolutionValuesToGraph(workflow, resolutions)) {
                    return true;
                }

                if (typeof app.graph.configure === 'function') {
                    app.graph.configure(workflow);
                    return true;
                }

                if (typeof app.graph.deserialize === 'function') {
                    app.graph.deserialize(workflow);
                    return true;
                }

                if (app.loadGraphData) {
                    await app.loadGraphData(workflow, false, false, null);
                    return true;
                }

                console.warn('Model Resolver: No method available to update workflow');
                return false;
            } catch (error) {
                console.error('Model Resolver: Error updating workflow in ComfyUI:', error);
                return false;
            }
        });
    }
};
