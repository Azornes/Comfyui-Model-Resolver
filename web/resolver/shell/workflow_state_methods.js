import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const workflowStateMethods = {
    getWorkflowSignature(workflow) {
        if (!workflow) return null;
        try {
            return JSON.stringify(this.getWorkflowSignatureData(workflow));
        } catch (error) {
            console.warn('Model Resolver: workflow signature generation failed', error);
            return null;
        }
    },

    getWorkflowSignatureData(workflow) {
        const modelExtensionPattern = /\.(ckpt|pt2?|bin|pth|safetensors|pkl|sft|onnx|gguf)(?:$|[?#])/i;
        const urnPattern = /^urn:air:[^:]+:[^:]+:[^:]+:\d+@\d+$/i;
        const urlPattern = /^https?:\/\//i;
        const loraTokenPattern = /<lora:[^>]+>/i;
        const modelReferenceKeys = new Set([
            'lora',
            'ckpt_name',
            'checkpoint',
            'vae_name',
            'clip_name',
            'clip_name1',
            'clip_name2',
            'control_net_name',
            'model_name',
            'unet_name',
            'upscale_model_name'
        ]);
        const modelMetadataKeys = new Set([
            'name',
            'filename',
            'file_name',
            'path',
            'url',
            'model_url',
            'directory',
            'base_model',
            'model_id',
            'modelid',
            'version_id',
            'versionid',
            'strength',
            'active',
            'on'
        ]);
        const loraStrengthNodeTypes = new Set(['LoraLoader', 'LoraLoaderModelOnly']);

        const normalizeKey = (key = '') => String(key).replace(/[-\s]/g, '_').toLowerCase();
        const isRelevantString = (value = '', key = '') => {
            const text = String(value).trim();
            if (!text) return false;

            const normalizedKey = normalizeKey(key);
            return modelReferenceKeys.has(normalizedKey)
                || modelMetadataKeys.has(normalizedKey)
                || modelExtensionPattern.test(text)
                || urnPattern.test(text)
                || urlPattern.test(text)
                || loraTokenPattern.test(text);
        };
        const isRelevantScalarKey = (key = '') => ['strength', 'active', 'on', 'model_id', 'modelid', 'version_id', 'versionid'].includes(normalizeKey(key));
        const normalizeRelevantValue = (value, key = '') => {
            if (value == null) return null;

            if (typeof value === 'string') {
                const text = value.trim();
                return isRelevantString(text, key) ? text : null;
            }

            if (typeof value === 'number' || typeof value === 'boolean') {
                return isRelevantScalarKey(key) ? value : null;
            }

            if (Array.isArray(value)) {
                const items = value
                    .map(item => normalizeRelevantValue(item, key))
                    .filter(item => item !== null);
                return items.length ? items : null;
            }

            if (typeof value === 'object') {
                const entries = Object.entries(value)
                    .map(([entryKey, entryValue]) => [entryKey, normalizeRelevantValue(entryValue, entryKey)])
                    .filter(([, entryValue]) => entryValue !== null)
                    .sort(([a], [b]) => String(a).localeCompare(String(b)));
                return entries.length ? Object.fromEntries(entries) : null;
            }

            return null;
        };
        const normalizeWidgetValues = (node = {}) => {
            const widgetsValues = Array.isArray(node.widgets_values) ? node.widgets_values : [];
            const nodeType = node.type || '';
            const widgetValueKey = (index) => {
                for (const key of ['widgets', 'inputs']) {
                    const items = Array.isArray(node[key]) ? node[key] : [];
                    const item = items[index];
                    if (!item || typeof item !== 'object') continue;
                    const name = item.name || item.widget || item.label;
                    if (name) return name;
                }
                return '';
            };
            return widgetsValues
                .map((value, index) => {
                    const key = widgetValueKey(index);
                    let normalized = normalizeRelevantValue(value, key);

                    if (
                        normalized === null
                        && loraStrengthNodeTypes.has(nodeType)
                        && (
                            normalizeRelevantValue(widgetsValues[index - 1], widgetValueKey(index - 1)) !== null
                            || normalizeRelevantValue(widgetsValues[index - 2], widgetValueKey(index - 2)) !== null
                        )
                        && (typeof value === 'number' || typeof value === 'string')
                    ) {
                        normalized = String(value).trim();
                    }

                    return normalized === null ? null : { index, value: normalized };
                })
                .filter(Boolean);
        };
        const normalizeWidgets = (widgets = []) => Array.isArray(widgets)
            ? widgets.map((widget = {}) => ({
                name: widget.name,
                widget: widget.widget,
                label: widget.label,
                type: widget.type
            })).filter(widget => Object.values(widget).some(value => value != null && value !== ''))
            : [];
        const normalizeLinks = (links = []) => Array.isArray(links)
            ? links.map(link => Array.isArray(link) ? link : [
                link?.id,
                link?.origin_id,
                link?.origin_slot,
                link?.target_id,
                link?.target_slot,
                link?.type
            ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
            : [];
        const normalizeNode = (node = {}) => ({
            id: node.id,
            type: node.type,
            title: node.title || '',
            bypassed: node.mode === 4,
            inputs: Array.isArray(node.inputs)
                ? node.inputs.map(input => ({
                    name: input?.name,
                    widget: input?.widget,
                    label: input?.label,
                    type: input?.type,
                    link: input?.link
                }))
                : [],
            outputs: Array.isArray(node.outputs)
                ? node.outputs.map(output => ({
                    name: output?.name,
                    type: output?.type,
                    links: Array.isArray(output?.links) ? [...output.links].sort((a, b) => String(a).localeCompare(String(b))) : []
                }))
                : [],
            widgets: normalizeWidgets(node.widgets),
            widgets_values: normalizeWidgetValues(node),
            properties: normalizeRelevantValue(node.properties) || {}
        });

        const normalizeDefinition = (definition = {}) => ({
            nodes: Array.isArray(definition.nodes)
                ? definition.nodes.map(normalizeNode).sort((a, b) => String(a.id).localeCompare(String(b.id)))
                : [],
            links: normalizeLinks(definition.links)
        });

        const normalizeDefinitions = (definitions = {}) => {
            if (!definitions || typeof definitions !== 'object') return {};

            const normalized = {};
            if (Array.isArray(definitions.subgraphs)) {
                normalized.subgraphs = definitions.subgraphs
                    .map(subgraph => ({
                        id: subgraph?.id,
                        name: subgraph?.name,
                        ...normalizeDefinition(subgraph)
                    }))
                    .sort((a, b) => String(a.id || a.name || '').localeCompare(String(b.id || b.name || '')));
            }

            for (const [key, definition] of Object.entries(definitions)) {
                if (key === 'subgraphs' || !definition || typeof definition !== 'object' || Array.isArray(definition)) continue;
                if (!Array.isArray(definition.nodes) && !Array.isArray(definition.links)) continue;
                normalized[key] = normalizeDefinition(definition);
            }

            return Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => String(a).localeCompare(String(b))));
        };

        return {
            nodes: Array.isArray(workflow.nodes)
                ? workflow.nodes.map(normalizeNode).sort((a, b) => String(a.id).localeCompare(String(b.id)))
                : [],
            links: normalizeLinks(workflow.links),
            definitions: normalizeDefinitions(workflow.definitions)
        };
    },

    getActiveWorkflowRouteKey() {
        try {
            return window.location?.hash || '';
        } catch (error) {
            return '';
        }
    },

    rememberActiveWorkflow(workflow = null) {
        const currentWorkflow = workflow || this.getCurrentWorkflow();
        this.activeWorkflowRouteKey = this.getActiveWorkflowRouteKey();
        this.activeWorkflowSignature = this.getWorkflowSignature(currentWorkflow);
    },

    getWorkflowScopedQueueKey(route = this.activeWorkflowRouteKey, signature = this.activeWorkflowSignature) {
        if (route && signature) return `${route}\n${signature}`;
        return route || signature || null;
    },

    clonePendingResolutions(list = this.pendingResolutions) {
        try {
            return JSON.parse(JSON.stringify(Array.isArray(list) ? list : []));
        } catch (error) {
            console.warn('Model Resolver: failed to clone queued selections', error);
            return Array.isArray(list) ? list.map(item => ({ ...item })) : [];
        }
    },

    savePendingQueueForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        if (!key) return;

        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        if (list.length) {
            this.workflowPendingSelections.set(key, this.clonePendingResolutions(list));
        } else {
            this.workflowPendingSelections.delete(key);
        }
    },

    restorePendingQueueForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        const saved = key ? this.workflowPendingSelections.get(key) : null;
        this.pendingResolutions = saved ? this.clonePendingResolutions(saved) : [];
        this.rebuildPendingIndex();
        this.updateApplyPendingButton?.();
        this.updateQueuePanel?.();
        this.updateQueueVisibility?.();
    },

    cloneAnalysisData(data = null) {
        if (!data) return null;
        try {
            return JSON.parse(JSON.stringify(data));
        } catch (error) {
            console.warn('Model Resolver: failed to clone analysis data', error);
            return data;
        }
    },

    saveAnalysisCacheForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        if (!key) return;

        if (this.cachedWorkflowSignature && this.cachedAnalysisData) {
            this.workflowAnalysisCaches.set(key, {
                signature: this.cachedWorkflowSignature,
                data: this.cloneAnalysisData(this.cachedAnalysisData)
            });
        } else {
            this.workflowAnalysisCaches.delete(key);
        }
    },

    restoreAnalysisCacheForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        const saved = key ? this.workflowAnalysisCaches.get(key) : null;
        this.cachedWorkflowSignature = saved?.signature || null;
        this.cachedAnalysisData = saved?.data
            ? this.cloneAnalysisData(saved.data)
            : null;
    },

    saveLoadedModelsCacheForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        if (!key) return;

        if (this.cachedLoadedModelsSignature && this.cachedLoadedModelsData) {
            this.workflowLoadedModelCaches.set(key, {
                signature: this.cachedLoadedModelsSignature,
                data: this.cloneAnalysisData(this.cachedLoadedModelsData)
            });
        } else {
            this.workflowLoadedModelCaches.delete(key);
        }
    },

    restoreLoadedModelsCacheForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        const saved = key ? this.workflowLoadedModelCaches.get(key) : null;
        this.cachedLoadedModelsSignature = saved?.signature || null;
        this.cachedLoadedModelsData = saved?.data
            ? this.cloneAnalysisData(saved.data)
            : null;
    },

    invalidateLoadedModelsCacheForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        this.cachedLoadedModelsSignature = null;
        this.cachedLoadedModelsData = null;
        if (key) {
            this.workflowLoadedModelCaches.delete(key);
        }
    },

    cloneSearchState(state = {}, { preserveActive = false } = {}) {
        let clone = {};
        try {
            clone = JSON.parse(JSON.stringify(state || {}));
        } catch (error) {
            console.warn('Model Resolver: failed to clone search state', error);
            clone = { ...state };
        }

        clone.selectedSource = clone.selectedSource || 'all';
        clone.selectedBaseModel = clone.selectedBaseModel || this.getDefaultSearchBaseModel?.() || 'auto';
        clone.results = this.mergeSearchResults({}, clone.results || {});
        clone.lastAttemptSources = Array.isArray(clone.lastAttemptSources)
            ? clone.lastAttemptSources
            : [];
        clone.lastAttemptBaseModelContext = clone.lastAttemptBaseModelContext || '';
        clone.lastAttemptFound = clone.lastAttemptFound ?? null;
        clone.lastAttemptError = clone.lastAttemptError || null;
        clone.sourceProgress = clone.sourceProgress || {};
        clone.activeSearchRunId = preserveActive ? (clone.activeSearchRunId || null) : null;

        if (!preserveActive) {
            for (const progress of Object.values(clone.sourceProgress)) {
                if (!progress || (progress.status !== 'pending' && progress.status !== 'running')) continue;
                progress.status = 'error';
                progress.percent = 100;
                progress.message = 'Search interrupted';
            }
        }

        return clone;
    },

    cloneSearchResultCache(cache = this.searchResultCache, { preserveActive = false, workflowKey = null } = {}) {
        const cloned = new Map();
        for (const [missingSearchKey, state] of cache.entries()) {
            if (!this.isPersistableSearchState(state)) {
                continue;
            }
            const preserveEntryActive = Boolean(
                preserveActive
                && workflowKey
                && state?.activeSearchRunId
                && this.hasBackgroundSearchJob?.(workflowKey, missingSearchKey, state.activeSearchRunId)
            );
            cloned.set(
                missingSearchKey,
                this.cloneSearchState(state, { preserveActive: preserveEntryActive })
            );
        }
        return cloned;
    },

    isPersistableSearchState(state = {}) {
        if ((state?.selectedSource || 'all') !== 'all') return true;
        const defaultBaseModel = this.getDefaultSearchBaseModel?.() || 'auto';
        if ((state?.selectedBaseModel || defaultBaseModel) !== defaultBaseModel) return true;
        if (state?.lastAttemptError) return true;
        if (this.hasSearchResults(state?.results || {})) return true;

        const progressEntries = Object.values(state?.sourceProgress || {});
        return Boolean(state?.activeSearchRunId) || progressEntries.some(progress => progress?.status);
    },

    saveSearchCacheForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        if (!key) return;

        const cloned = this.cloneSearchResultCache(this.searchResultCache, {
            preserveActive: true,
            workflowKey: key
        });
        if (cloned.size) {
            this.workflowSearchResultCaches.set(key, cloned);
        } else {
            this.workflowSearchResultCaches.delete(key);
        }
    },

    restoreSearchCacheForActiveWorkflow() {
        const key = this.getWorkflowScopedQueueKey();
        const saved = key ? this.workflowSearchResultCaches.get(key) : null;
        this.searchResultCache = saved
            ? this.cloneSearchResultCache(saved, { preserveActive: true, workflowKey: key })
            : new Map();
    },

    persistSearchStateForActiveWorkflow() {
        this.saveSearchCacheForActiveWorkflow();
    },

    clearAllSearchProgressTimers() {
        for (const timer of this.searchProgressTimers.values()) {
            clearInterval(timer);
        }
        this.searchProgressTimers.clear();
    },

    syncWorkflowScopedQueue(workflow = null) {
        const currentWorkflow = workflow || this.getCurrentWorkflow();
        const nextRoute = this.getActiveWorkflowRouteKey();
        const nextSignature = this.getWorkflowSignature(currentWorkflow);
        const previousKey = this.getWorkflowScopedQueueKey();
        const nextKey = this.getWorkflowScopedQueueKey(nextRoute, nextSignature);

        if (!nextKey || nextKey === previousKey) {
            this.activeWorkflowRouteKey = nextRoute;
            this.activeWorkflowSignature = nextSignature;
            return;
        }

        this.savePendingQueueForActiveWorkflow();
        this.saveAnalysisCacheForActiveWorkflow();
        this.saveLoadedModelsCacheForActiveWorkflow();
        this.saveSearchCacheForActiveWorkflow();
        this.clearWorkflowScopedState();
        this.activeWorkflowRouteKey = nextRoute;
        this.activeWorkflowSignature = nextSignature;
        this.restorePendingQueueForActiveWorkflow();
        this.restoreAnalysisCacheForActiveWorkflow();
        this.restoreLoadedModelsCacheForActiveWorkflow();
        this.restoreSearchCacheForActiveWorkflow();
    },

    clearWorkflowScopedState() {
        const key = this.getWorkflowScopedQueueKey();
        this.cachedWorkflowSignature = null;
        this.cachedAnalysisData = null;
        this.cachedLoadedModelsSignature = null;
        this.cachedLoadedModelsData = null;
        this._analysisProgressToken = null;
        this._workflowDataLoadToken = null;
        this._loadedModelsLoadToken = null;
        for (const [missingSearchKey, state] of this.searchResultCache.entries()) {
            if (!this.hasBackgroundSearchJob?.(key, missingSearchKey, state.activeSearchRunId)) {
                state.activeSearchRunId = null;
            }
        }
        this.clearAllSearchProgressTimers();
        this.searchResultCache.clear();
        this.urnResolvePromises.clear();
        this.urnLocalMatchPromises.clear();
        this.downloadTargetSelections?.clear();
        this.pendingResolutions = [];
        this.rebuildPendingIndex();
        this.updateApplyPendingButton?.();
        this.updateQueuePanel?.();
        this.updateQueueVisibility();
    },

    scheduleActiveWorkflowRefresh(reason = 'workflow-change') {
        if (!this.isVisible()) return;

        const generation = (this._workflowRefreshGeneration || 0) + 1;
        this._workflowRefreshGeneration = generation;
        this._workflowRefreshExpectedRoute = this.getActiveWorkflowRouteKey();
        this._workflowRefreshPreviousSignature = this.activeWorkflowSignature;

        if (this._workflowRefreshTimer) {
            clearTimeout(this._workflowRefreshTimer);
        }
        if (this._workflowRefreshRetryTimer) {
            clearTimeout(this._workflowRefreshRetryTimer);
            this._workflowRefreshRetryTimer = null;
        }

        this._workflowRefreshTimer = setTimeout(() => {
            if (generation !== this._workflowRefreshGeneration) return;
            this._workflowRefreshTimer = null;
            this.refreshForActiveWorkflowChange({
                reason,
                expectedRoute: this._workflowRefreshExpectedRoute,
                previousSignature: this._workflowRefreshPreviousSignature,
                attempt: 0,
                generation
            });
        }, 180);
    },

    async refreshForActiveWorkflowChange({
        reason = 'workflow-change',
        expectedRoute = '',
        previousSignature = null,
        attempt = 0,
        generation = this._workflowRefreshGeneration,
        candidateRoute = null,
        candidateSignature = null
    } = {}) {
        if (!this.isVisible()) return;
        if (generation !== this._workflowRefreshGeneration) return;

        const currentRoute = this.getActiveWorkflowRouteKey();
        if (expectedRoute && currentRoute !== expectedRoute) {
            this.scheduleActiveWorkflowRefresh(reason);
            return;
        }

        const workflow = this.getCurrentWorkflow();
        const signature = this.getWorkflowSignature(workflow);
        const routeChanged = currentRoute !== this.activeWorkflowRouteKey;
        const signatureChanged = signature && signature !== this.activeWorkflowSignature;
        const graphStillLooksOld = routeChanged && previousSignature && signature === previousSignature;

        if ((!signature || graphStillLooksOld) && attempt < 8) {
            this._workflowRefreshRetryTimer = setTimeout(() => {
                if (generation !== this._workflowRefreshGeneration) return;
                this._workflowRefreshRetryTimer = null;
                this.refreshForActiveWorkflowChange({
                    reason,
                    expectedRoute,
                    previousSignature,
                    attempt: attempt + 1,
                    generation,
                    candidateRoute,
                    candidateSignature
                });
            }, 180 + (attempt * 120));
            return;
        }

        if (!routeChanged && !signatureChanged) return;

        if ((candidateRoute !== currentRoute || candidateSignature !== signature) && attempt < 8) {
            this._workflowRefreshRetryTimer = setTimeout(() => {
                if (generation !== this._workflowRefreshGeneration) return;
                this._workflowRefreshRetryTimer = null;
                this.refreshForActiveWorkflowChange({
                    reason,
                    expectedRoute,
                    previousSignature,
                    attempt: attempt + 1,
                    generation,
                    candidateRoute: currentRoute,
                    candidateSignature: signature
                });
            }, 450);
            return;
        }

        console.log('Model Resolver: active workflow changed, refreshing current tab', {
            reason,
            route: currentRoute,
            tab: this.activeTab
        });

        this.savePendingQueueForActiveWorkflow();
        this.saveAnalysisCacheForActiveWorkflow();
        this.saveLoadedModelsCacheForActiveWorkflow();
        this.saveSearchCacheForActiveWorkflow();
        this.clearWorkflowScopedState();
        this.activeWorkflowRouteKey = currentRoute;
        this.activeWorkflowSignature = signature;
        this.restorePendingQueueForActiveWorkflow();
        this.restoreAnalysisCacheForActiveWorkflow();
        this.restoreLoadedModelsCacheForActiveWorkflow();
        this.restoreSearchCacheForActiveWorkflow();

        if (this.activeTab === 'missing') {
            if (this.contentElement) this.contentElement.style.overflowY = 'auto';
            await this.loadWorkflowData(workflow);
        } else if (this.activeTab === 'loaded') {
            if (this.contentElement) this.contentElement.style.overflowY = 'auto';
            await this.loadLoadedModels(workflow);
        }
    }
};
