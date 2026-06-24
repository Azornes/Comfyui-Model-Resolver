import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const workflowUpdateMethods = {
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
        const response = await api.fetchApi(`/object_info?model_resolver_refresh=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`object_info refresh failed: ${response.status}`);
        }

        return await response.json();
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
        return String(value || '').trim().replace(/\\/g, '/');
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
        if (!downloadUrl) return null;

        try {
            // HuggingFace URLs
            if (downloadUrl.includes('huggingface.co')) {
                const fileMatch = downloadUrl.match(/huggingface\.co\/([^\/]+\/[^\/]+)\/(?:resolve|blob)\/([^\/]+)\/(.+)$/);
                if (fileMatch) {
                    const repo = fileMatch[1];
                    const revision = fileMatch[2];
                    const filePath = fileMatch[3].split(/[?#]/)[0];
                    return `https://huggingface.co/${repo}/blob/${revision}/${filePath}`;
                }

                const match = downloadUrl.match(/huggingface\.co\/([^\/]+\/[^\/]+)/);
                if (match) {
                    return `https://huggingface.co/${match[1]}`;
                }
            }

            // CivitAI URLs
            if (downloadUrl.includes('civitai.com')) {
                // Format: /api/download/models/123456 or /models/123456/...
                const modelIdMatch = downloadUrl.match(/models\/(\d+)/);
                if (modelIdMatch) {
                    return `https://civitai.com/models/${modelIdMatch[1]}`;
                }
            }
        } catch (e) {
            console.error('Error parsing model card URL:', e);
        }

        return null;
    },

    /**
     * Update workflow in ComfyUI's UI/memory
     * Updates the current workflow in place instead of creating a new tab
     */
    async updateWorkflowInComfyUI(workflow) {
        if (!app || !app.graph) {
            console.warn('Model Resolver: Could not update workflow - app or app.graph not available');
            return;
        }

        try {
            // Method 1: Try to directly update the current graph using configure
            // This is the most direct way to update in place
            if (app.graph && typeof app.graph.configure === 'function') {
                app.graph.configure(workflow);
                return;
            }

            // Method 2: Try deserialize to update the graph in place
            if (app.graph && typeof app.graph.deserialize === 'function') {
                app.graph.deserialize(workflow);
                return;
            }

            // Method 3: Use loadGraphData with explicit parameters to update current tab
            // The key is to NOT create a new workflow - pass null or undefined for the workflow parameter
            // clean=false means don't clear the graph first
            // restore_view=false means don't restore the viewport
            // workflow=null means update current workflow instead of creating new one
            if (app.loadGraphData) {
                // Try with null as 4th parameter first
                await app.loadGraphData(workflow, false, false, null);
                return;
            }

            console.warn('Model Resolver: No method available to update workflow');
        } catch (error) {
            console.error('Model Resolver: Error updating workflow in ComfyUI:', error);
            // Don't throw - allow the workflow update to continue even if UI update fails
            // The backend has already updated the workflow data
        }
    }
};
