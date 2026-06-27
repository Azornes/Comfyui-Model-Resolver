import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { createModuleLogger } from "../../log_system/log_funcs.js";
import { getSvgIcon } from "../../utils/icon_utils.js";

const log = createModuleLogger('resolve_download_methods');

export const resolveDownloadMethods = {
    /**
     * Resolve a model - resolves ALL nodes that reference this model
     */
    async resolveModel(missing, resolvedModel) {
        log.debug('resolveModel called:', missing?.original_path, '->', resolvedModel?.filename);

        if (!resolvedModel) {
            this.showNotification('No resolved model selected', 'error');
            return;
        }

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            // Resolve ALL nodes that need this model (all_node_refs contains deduplicated refs)
            const nodeRefs = missing.all_node_refs || [missing];
            log.debug('nodeRefs count:', nodeRefs?.length, 'is_lora_v2:', nodeRefs?.[0]?.is_lora_v2);

            const resolutions = nodeRefs.map(ref => ({
                node_id: ref.node_id,
                widget_index: ref.widget_index,
                resolved_path: resolvedModel.path,
                category: ref.category,
                resolved_model: resolvedModel,
                subgraph_id: ref.subgraph_id,
                is_top_level: ref.is_top_level,
                is_lora_v2: ref.is_lora_v2,
                original_lora_name: ref.name || ref.original_path
            }));

            const data = await this.fetchJson('/model_resolver/resolve', {
                method: 'POST',
                body: JSON.stringify({
                    workflow,
                    resolutions: resolutions
                })
            }, 'Resolve model');
            log.debug('Resolve response: success=', data.success, ' missing count:', data.workflow?.nodes?.length);

            if (data.success) {
                await this.refreshComfyModelCatalogAfterApply?.(data.workflow, resolutions);

                // Update workflow in ComfyUI
                await this.updateWorkflowInComfyUI(data.workflow);

                // Show success notification
                const modelName = resolvedModel.relative_path || resolvedModel.filename || 'model';
                const count = resolutions.length;
                const refText = count > 1 ? ` (${count} references)` : '';
                this.showNotification(`✓ Model linked successfully: ${modelName}${refText}`, 'success');

                // Reload dialog using the updated workflow from API response
                // This ensures we're analyzing the correct updated workflow
                await this.loadWorkflowData(data.workflow, { force: true });
            } else {
                this.showNotification('Failed to resolve model: ' + (data.error || 'Unknown error'), 'error');
            }

        } catch (error) {
            console.error('Model Resolver: Error resolving model:', error);
            this.showNotification('Error resolving model: ' + error.message, 'error');
        }
    },

    /**
     * Auto-resolve all 100% confidence matches
     * @returns {object|null} The updated workflow if successful, null otherwise
     */
    async autoResolve100Percent() {
        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return null;
            }

            // Analyze workflow first
            const analyzeData = await this.fetchJson('/model_resolver/analyze', {
                method: 'POST',
                body: JSON.stringify({ workflow })
            }, 'Analyze workflow');
            const missingModels = analyzeData.missing_models || [];

            // Collect all 100% matches
            const resolutions = [];
            for (const missing of missingModels) {
                const matches = missing.matches || [];
                const perfectMatch = matches.find((m) => m.confidence === 100);

                if (perfectMatch && perfectMatch.model) {
                    resolutions.push({
                        node_id: missing.node_id,
                        widget_index: missing.widget_index,
                        resolved_path: perfectMatch.model.path,
                        category: missing.category,
                        resolved_model: perfectMatch.model,
                        subgraph_id: missing.subgraph_id,  // Include subgraph_id for subgraph nodes
                        is_top_level: missing.is_top_level,  // True for top-level nodes, False for nodes in subgraph definitions
                        is_lora_v2: missing.is_lora_v2,
                        original_lora_name: missing.name || missing.original_path
                    });
                }
            }

            if (resolutions.length === 0) {
                this.showNotification('No 100% confidence matches found to auto-resolve.', 'error');
                return null;
            }

            // Apply resolutions
            const resolveData = await this.fetchJson('/model_resolver/resolve', {
                method: 'POST',
                body: JSON.stringify({
                    workflow,
                    resolutions
                })
            }, 'Resolve models');

            if (resolveData.success) {
                await this.refreshComfyModelCatalogAfterApply?.(resolveData.workflow, resolutions);

                // Update workflow in ComfyUI
                await this.updateWorkflowInComfyUI(resolveData.workflow);

                // Show success notification
                this.showNotification(
                    `✓ Successfully linked ${resolutions.length} model${resolutions.length > 1 ? 's' : ''}!`,
                    'success'
                );

                // Reload dialog using the updated workflow from API response (if dialog is visible)
                if (this.contentElement) {
                    await this.loadWorkflowData(resolveData.workflow, { force: true });
                }

                // Return the updated workflow for callers who need it
                return resolveData.workflow;
            } else {
                this.showNotification('Failed to resolve models: ' + (resolveData.error || 'Unknown error'), 'error');
                return null;
            }

        } catch (error) {
            console.error('Model Resolver: Error auto-resolving:', error);
            this.showNotification('Error auto-resolving: ' + error.message, 'error');
            return null;
        }
    },

    /**
     * Download all missing models that have download sources but no 100% local match
     */
    async downloadAllMissing() {
        if (!this.contentElement) return;

        try {
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            // Analyze workflow first
            const analyzeData = await this.fetchJson('/model_resolver/analyze', {
                method: 'POST',
                body: JSON.stringify({ workflow })
            }, 'Analyze workflow');
            const missingModels = analyzeData.missing_models || [];

            // Collect models that need downloading:
            // - Have a download_source with valid URL
            // - Do NOT have any 100% confidence local matches
            const toDownload = [];
            for (const missing of missingModels) {
                const perfectMatches = (missing.matches || []).filter(m => m.confidence === 100);

                // Skip if has 100% local match or no download source
                if (perfectMatches.length > 0 || !missing.download_source?.url) {
                    continue;
                }

                toDownload.push(missing);
            }

            if (toDownload.length === 0) {
                this.showNotification('No models available for download (all have local matches or no download URLs).', 'info');
                return;
            }

            // Start all downloads
            this.showNotification(`Starting ${toDownload.length} download${toDownload.length > 1 ? 's' : ''}...`, 'info');

            for (const missing of toDownload) {
                // Use downloadModel which handles progress tracking
                this.downloadModel(missing);
            }

            // Update button state to show Cancel All
            this.updateDownloadAllButtonState();

        } catch (error) {
            console.error('Model Resolver: Error in downloadAllMissing:', error);
            this.showNotification('Error starting downloads: ' + error.message, 'error');
        }
    },

    getBestDownloadSourceForMissing(missing) {
        if (!missing) return null;

        if (missing.download_source?.url) {
            return {
                ...missing.download_source,
                directory: missing.download_source.directory || missing.download_source.category || missing.category || 'checkpoints'
            };
        }

        const state = this.searchResultCache.get(this.getMissingSearchKey(missing));
        const results = state?.results || {};
        const filename = missing.original_path?.split('/').pop()?.split('\\').pop() || '';
        const first = (value) => Array.isArray(value) ? value[0] : value;
        const candidates = [
            {
                source: 'popular',
                result: first(results.popular),
                urlKey: 'url',
                filenameKey: 'filename',
                categoryKey: 'directory'
            },
            {
                source: 'model_list',
                result: first(results.model_list),
                urlKey: 'url',
                filenameKey: 'filename',
                categoryKey: 'directory'
            },
            {
                source: 'huggingface',
                result: first(results.huggingface),
                urlKey: 'url',
                filenameKey: 'filename'
            },
            {
                source: 'civarchive',
                result: first(results.civarchive),
                urlKey: 'download_url',
                filenameKey: 'filename'
            },
            {
                source: 'lora_manager_archive',
                result: first(results.lora_manager_archive),
                urlKey: 'download_url',
                filenameKey: 'filename'
            },
            {
                source: 'civitai',
                result: first(results.civitai),
                urlKey: 'download_url',
                filenameKey: 'filename'
            }
        ];

        for (const candidate of candidates) {
            const result = candidate.result;
            const url = result?.[candidate.urlKey];
            if (!url) continue;
            const rawModelUrl = result.model_url || result.url || url;

            return {
                source: candidate.source,
                url,
                filename: result[candidate.filenameKey] || missing.civitai_info?.expected_filename || filename,
                directory: result[candidate.categoryKey] || result.directory || result.category || missing.category || 'checkpoints',
                model_url: this.getModelCardUrl(rawModelUrl) || rawModelUrl,
                name: result.name || result.repo_id || result.repo || result.filename || filename,
                size: result.size,
                type: result.type || missing.category
            };
        }

        return null;
    },

    getBatchSearchTargets(mode) {
        const missingModels = this.missingModels || [];
        if (mode === 'selected') {
            return this.getSelectedMissingModels();
        }
        if (mode === 'unsearched') {
            return missingModels.filter(missing => !this.hasRenderableSearchState(this.getSearchState(missing)));
        }
        return missingModels;
    },

    async searchMissingBatch(mode = 'selected', source = 'all', { forceSearch = false } = {}) {
        if (this.batchSearchRunning) {
            this.stopBatchSearch();
            return;
        }

        const targets = this.getBatchSearchTargets(mode);
        if (!targets.length) {
            this.showNotification(mode === 'selected' ? 'No missing models selected.' : 'No missing models to search.', 'info');
            this.closeFooterMenus();
            return;
        }

        this.batchSearchRunning = true;
        this.batchSearchCancelRequested = false;
        this.updateBatchFooterButtons();
        this.closeFooterMenus();
        this.showNotification(`Searching ${targets.length} missing model${targets.length > 1 ? 's' : ''}...`, 'info');

        const batchWorkflowKey = this.getWorkflowScopedQueueKey();
        let completed = 0;
        let failed = 0;
        try {
            for (const missing of targets) {
                if (this.batchSearchCancelRequested) {
                    break;
                }
                const state = this.getSearchStateForWorkflow(batchWorkflowKey, missing);
                state.selectedSource = source || 'all';
                try {
                    await this.searchOnline(missing, { workflowKey: batchWorkflowKey, forceSearch });
                } catch (error) {
                    failed += 1;
                    console.error('Model Resolver: batch search item failed:', error);
                }
                completed += 1;
                this.updateBatchFooterButtons();
            }
        } finally {
            const cancelled = this.batchSearchCancelRequested;
            this.batchSearchRunning = false;
            this.batchSearchCancelRequested = false;
            this.persistSearchStateForActiveWorkflow();
            this.updateBatchFooterButtons();
            const suffix = failed ? `, ${failed} failed` : '';
            if (cancelled) {
                this.showNotification(`Stopped search after ${completed} of ${targets.length} model${targets.length === 1 ? '' : 's'}${suffix}.`, 'info');
                return;
            }
        }

        const suffix = failed ? `, ${failed} failed` : '';
        this.showNotification(`Finished search for ${completed} model${completed === 1 ? '' : 's'}${suffix}.`, failed ? 'error' : 'success');
    },

    stopBatchSearch() {
        if (!this.batchSearchRunning) {
            this.closeFooterMenus();
            return;
        }

        this.batchSearchCancelRequested = true;
        for (const job of Array.from(this.backgroundSearchJobs?.values?.() || [])) {
            this.cancelBackgroundSearchJob?.(job);
        }
        this.closeFooterMenus();
        this.updateBatchFooterButtons();
        this.showNotification('Stopping active search...', 'info');
    },

    async downloadMissingBatch(mode = 'selected') {
        const targets = mode === 'selected'
            ? this.getSelectedMissingModels()
            : (this.missingModels || []);

        if (!targets.length) {
            this.showNotification(mode === 'selected' ? 'No missing models selected.' : 'No missing models to download.', 'info');
            this.closeFooterMenus();
            return;
        }

        const toDownload = [];
        for (const missing of targets) {
            if (this.getBestLocalMatch(missing, 100)) continue;
            const source = this.getBestDownloadSourceForMissing(missing);
            if (!source?.url) continue;
            missing.download_source = source;
            toDownload.push(missing);
        }

        if (!toDownload.length) {
            this.showNotification('No selected models have downloadable sources.', 'info');
            this.closeFooterMenus();
            return;
        }

        this.closeFooterMenus();
        this.showNotification(`Starting ${toDownload.length} download${toDownload.length > 1 ? 's' : ''}...`, 'info');
        for (const missing of toDownload) {
            await this.downloadModel(missing);
        }
        this.updateDownloadAllButtonState();
        this.updateBatchFooterButtons();
    },

    queueExactLocalMatchesBatch(mode = 'selected') {
        const selected = this.getSelectedMissingModels();
        const targets = mode === 'selected' && selected.length ? selected : (this.missingModels || []);
        let queued = 0;

        for (const missing of targets) {
            const match = this.getBestLocalMatch(missing, 100);
            if (!match?.model) continue;
            this.queueResolution(missing, match.model);
            queued += 1;
        }

        this.closeFooterMenus();
        if (!queued) {
            this.showNotification('No exact local matches found to queue.', 'info');
            return;
        }
        this.showNotification(`Queued ${queued} exact local match${queued === 1 ? '' : 'es'}.`, 'success');
        this.updateBatchFooterButtons();
    },

    /**
     * Refresh local matches after a download completes.
     */
    getDownloadedLocalMatchTarget(missing = {}, downloadedFilename = '') {
        return downloadedFilename
            || missing.civitai_info?.expected_filename
            || missing.download_source?.filename
            || missing.original_path?.split('/').pop()?.split('\\').pop()
            || '';
    },

    getDownloadFolderContext(progress = {}, info = {}) {
        const directory = progress?.directory || info?.downloadDirectory || '';
        const filePath = progress?.path || info?.downloadPath || '';
        const targetPath = directory || filePath;
        if (!targetPath) return null;

        return {
            context_scope: 'download_folder',
            name: progress?.filename || info?.filename || 'Download',
            path: targetPath,
            resolved_path: targetPath,
            open_path: filePath || directory,
            folder_path: directory || targetPath,
            download_directory: directory || '',
            download_path: filePath || '',
            category: info?.category || progress?.category || ''
        };
    },

    rememberDownloadLocation(info, progress = {}) {
        if (!info || !progress) return;
        if (progress.path) info.downloadPath = progress.path;
        if (progress.directory) info.downloadDirectory = progress.directory;
        if (progress.filename) info.filename = progress.filename;
    },

    rememberDownloadSubfolderAfterCompletion(info = {}, progress = {}) {
        const category = info?.category || progress?.category || '';
        const subfolder = info?.subfolder || progress?.subfolder || '';
        if (!category || !subfolder) return;

        this.rememberDownloadedSubfolder?.(
            category,
            subfolder,
            info?.baseDirectory || progress?.base_directory || progress?.baseDirectory || ''
        );
    },

    renderDownloadStatusMessage(message, type, progress = {}, info = {}) {
        const contextMenuModel = this.getDownloadFolderContext(progress, info);
        return this.renderStatusMessage(message, type, {
            contextMenuModel,
            contextMenuTooltip: 'Right-click to open download folder'
        });
    },

    getDownloadProgressElementId(missing = {}) {
        return `download-progress-${missing.node_id}-${missing.widget_index}`;
    },

    getDownloadButtonElementId(missing = {}) {
        return `download-${missing.node_id}-${missing.widget_index}`;
    },

    getDownloadProgressStore() {
        if (!(this.downloadProgressByMissingKey instanceof Map)) {
            this.downloadProgressByMissingKey = new Map();
        }
        return this.downloadProgressByMissingKey;
    },

    getDownloadStateKey(missing) {
        return this.getMissingSearchKey?.(missing) || this.getMissingModelKey(missing);
    },

    rememberDownloadSnapshotForMissing(missing, snapshot = {}) {
        if (!missing) return null;

        const key = this.getDownloadStateKey(missing);
        const store = this.getDownloadProgressStore();
        const previous = store.get(key) || {};
        const progress = {
            ...(previous.progress || {}),
            ...(snapshot.progress || {})
        };
        const next = {
            ...previous,
            ...snapshot,
            missing,
            progress,
            updatedAt: Date.now()
        };

        store.set(key, next);
        return next;
    },

    cloneLocalMatches(matches = []) {
        if (!Array.isArray(matches)) return [];
        try {
            return JSON.parse(JSON.stringify(matches));
        } catch (error) {
            console.warn('Model Resolver: failed to clone local matches', error);
            return matches.map(match => ({ ...match }));
        }
    },

    getLocalMatchIdentity(match = {}) {
        const model = match.model || {};
        return [
            model.path || match.path || '',
            model.relative_path || '',
            model.filename || match.filename || '',
            model.category || match.category || ''
        ].map(value => String(value || '').trim().toLowerCase()).join('::');
    },

    mergeLocalMatches(existingMatches = [], restoredMatches = []) {
        const merged = [];
        const byIdentity = new Map();

        const addMatch = (match) => {
            if (!match || typeof match !== 'object') return;
            const identity = this.getLocalMatchIdentity(match);
            if (!identity.replace(/:/g, '')) return;

            const previous = byIdentity.get(identity);
            if (!previous || Number(match.confidence || 0) > Number(previous.confidence || 0)) {
                byIdentity.set(identity, match);
            }
        };

        existingMatches.forEach(addMatch);
        restoredMatches.forEach(addMatch);

        for (const match of byIdentity.values()) {
            merged.push(match);
        }

        return merged.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
    },

    applyLocalHashMatchesFromSearchResponse(missing, data = {}, { workflowKey = this.getWorkflowScopedQueueKey?.() } = {}) {
        const hashMatches = Array.isArray(data?.local_hash_matches)
            ? data.local_hash_matches
            : [];
        if (!missing || !hashMatches.length) return [];

        const missingKey = this.getMissingModelKey(missing);
        const currentMissing = (this.missingModels || [])
            .find(item => this.getMissingModelKey(item) === missingKey)
            || missing;
        const currentMatches = Array.isArray(currentMissing.matches)
            ? currentMissing.matches
            : (Array.isArray(missing.matches) ? missing.matches : []);
        const mergedMatches = this.mergeLocalMatches(currentMatches, hashMatches);

        currentMissing.matches = mergedMatches;
        missing.matches = mergedMatches;
        this.persistLocalMatchesInAnalysisCache(currentMissing, hashMatches);

        const state = workflowKey
            ? this.getSearchStateForWorkflow?.(workflowKey, currentMissing)
            : this.searchResultCache?.get(this.getMissingSearchKey(currentMissing));
        if (state) {
            state.results = {
                ...(state.results || {}),
                local_hash_matches: this.mergeLocalMatches(
                    state.results?.local_hash_matches || [],
                    hashMatches
                )
            };
            state.lastAttemptSources = Array.from(new Set([...(state.lastAttemptSources || []), 'local']));
            state.lastAttemptFound = true;
            state.sourceProgress = {
                ...(state.sourceProgress || {}),
                local: {
                    status: 'found',
                    percent: 100,
                    message: 'Hash metadata match',
                    updatedAt: Date.now()
                }
            };
            if (workflowKey) {
                this.persistSearchStateForWorkflow?.(workflowKey, currentMissing, state);
            }
        }

        this.refreshLocalMatchesUiForMissing?.(currentMissing);
        return hashMatches;
    },

    restoreSearchLocalHashMatchesForMissing(missing) {
        if (!missing) return missing;

        const state = this.searchResultCache?.get(this.getMissingSearchKey(missing));
        const hashMatches = Array.isArray(state?.results?.local_hash_matches)
            ? state.results.local_hash_matches
            : [];
        if (!hashMatches.length) return missing;

        missing.matches = this.mergeLocalMatches(
            Array.isArray(missing.matches) ? missing.matches : [],
            this.cloneLocalMatches(hashMatches)
        );
        return missing;
    },

    rememberDownloadedLocalMatchesForMissing(missing, matches = [], metadata = {}) {
        if (!missing || !Array.isArray(matches)) return null;

        const snapshot = this.rememberDownloadSnapshotForMissing(missing, {
            localMatches: this.cloneLocalMatches(matches),
            localMatchesMetadata: {
                ...metadata,
                updatedAt: Date.now()
            }
        });

        this.persistLocalMatchesInAnalysisCache(missing, matches);
        this.persistDownloadedLocalMatchSearchState(missing, matches, metadata);
        return snapshot;
    },

    restoreDownloadedLocalMatchesForMissing(missing) {
        if (!missing) return missing;

        const snapshot = this.getDownloadProgressStore().get(this.getDownloadStateKey(missing));
        const storedMatches = Array.isArray(snapshot?.localMatches) ? snapshot.localMatches : [];
        if (!storedMatches.length) return missing;

        const currentMatches = Array.isArray(missing.matches) ? missing.matches : [];
        missing.matches = this.mergeLocalMatches(currentMatches, this.cloneLocalMatches(storedMatches));
        return missing;
    },

    persistLocalMatchesInAnalysisCache(missing, matches = []) {
        if (!missing || !Array.isArray(matches)) return;

        const missingKey = this.getMissingModelKey(missing);
        const patchAnalysisData = (data) => {
            const patchList = (list) => {
                if (!Array.isArray(list)) return;

                for (const item of list) {
                    if (this.getMissingModelKey(item) !== missingKey) continue;
                    item.matches = this.mergeLocalMatches(item.matches || [], matches);
                }
            };

            patchList(data?.missing_models);
            patchList(data?.resolved_models);
        };

        patchAnalysisData(this.cachedAnalysisData);
        const workflowKey = this.getWorkflowScopedQueueKey?.();
        const cached = workflowKey ? this.workflowAnalysisCaches?.get(workflowKey) : null;
        if (cached?.data) {
            patchAnalysisData(cached.data);
        }
    },

    persistDownloadedLocalMatchSearchState(missing, matches = [], metadata = {}) {
        if (!missing || !Array.isArray(matches)) return;

        const workflowKey = this.getWorkflowScopedQueueKey?.();
        if (!workflowKey) return;

        const state = this.getSearchStateForWorkflow?.(workflowKey, missing);
        if (!state) return;

        const hasRenderableMatch = matches.some(match => Number(match.confidence || 0) >= 70);
        const hasExactMatch = matches.some(match => Number(match.confidence || 0) >= 100);
        state.lastAttemptSources = Array.from(new Set([...(state.lastAttemptSources || []), 'local']));
        state.lastAttemptFound = hasRenderableMatch || state.lastAttemptFound || false;
        state.lastAttemptError = state.lastAttemptError || null;
        state.sourceProgress = {
            ...(state.sourceProgress || {}),
            local: {
                status: hasRenderableMatch ? 'found' : 'none',
                percent: 100,
                message: hasExactMatch ? 'Exact local match' : (hasRenderableMatch ? 'Local match' : 'No local match'),
                updatedAt: Date.now(),
                filename: metadata.targetFilename || metadata.filename || ''
            }
        };

        this.persistSearchStateForWorkflow?.(workflowKey, missing, state);
    },

    rememberDownloadUiState(downloadId, info, progress = {}, options = {}) {
        if (!info?.missing) return null;

        this.rememberDownloadLocation(info, progress);
        const status = options.status || progress.status || info.lastStatus || 'starting';
        const snapshot = this.rememberDownloadSnapshotForMissing(info.missing, {
            downloadId,
            category: info.category || '',
            subfolder: info.subfolder || '',
            filename: progress.filename || info.filename || '',
            downloadPath: progress.path || info.downloadPath || '',
            downloadDirectory: progress.directory || info.downloadDirectory || '',
            baseDirectory: info.baseDirectory || '',
            sourceUrl: info.sourceUrl || '',
            workflowKey: info.workflowKey || '',
            workflowId: info.workflowId || '',
            workflowRouteKey: info.workflowRouteKey || '',
            workflowLabel: info.workflowLabel || this.getWorkflowLabelFromRouteKey?.(info.workflowRouteKey || '') || '',
            workflowSignature: info.workflowSignature || '',
            workflowTabId: info.workflowTabId || '',
            workflowTabName: info.workflowTabName || '',
            workflowTabAriaControls: info.workflowTabAriaControls || '',
            workflowTabText: info.workflowTabText || '',
            progress: {
                ...progress,
                status,
                filename: progress.filename || info.filename || '',
                path: progress.path || info.downloadPath || '',
                directory: progress.directory || info.downloadDirectory || ''
            },
            status,
            message: options.message || '',
            type: options.type || '',
            isActive: options.isActive ?? Boolean(this.activeDownloads?.[downloadId])
        });

        info.lastProgress = snapshot.progress;
        info.lastStatus = status;
        info.statusSnapshot = snapshot;
        return snapshot;
    },

    getActiveDownloadEntryForMissing(missing) {
        if (!missing) return null;
        const missingKey = this.getDownloadStateKey(missing);

        for (const [downloadId, info] of Object.entries(this.activeDownloads || {})) {
            if (info?.missing && this.getDownloadStateKey(info.missing) === missingKey) {
                return { downloadId, info };
            }
        }
        return null;
    },

    getDownloadSnapshotForMissing(missing) {
        const active = this.getActiveDownloadEntryForMissing(missing);
        if (active) {
            return this.rememberDownloadUiState(
                active.downloadId,
                active.info,
                active.info.lastProgress || { status: active.info.lastStatus || 'starting', progress: 0 },
                { isActive: true }
            );
        }
        return this.getDownloadProgressStore().get(this.getDownloadStateKey(missing)) || null;
    },

    resolveDownloadUiElements(target = {}) {
        const missing = target?.missing;
        if (!missing) return { progressDiv: null, downloadBtn: null };

        const progressId = this.getDownloadProgressElementId(missing);
        const buttonId = this.getDownloadButtonElementId(missing);
        const connectedProgressDiv = target.progressDiv?.isConnected ? target.progressDiv : null;
        const connectedDownloadBtn = target.downloadBtn?.isConnected ? target.downloadBtn : null;
        const progressDiv = this.contentElement?.querySelector(`#${progressId}`) || connectedProgressDiv;
        let downloadBtn = this.contentElement?.querySelector(`#${buttonId}`) || connectedDownloadBtn;

        if (!downloadBtn && target.sourceUrl && this.contentElement) {
            downloadBtn = Array.from(this.contentElement.querySelectorAll('.search-download-btn')).find(btn => (
                btn.dataset.url === target.sourceUrl
                && (!target.filename || btn.dataset.filename === target.filename)
            )) || null;
        }

        if ('progressDiv' in target) target.progressDiv = progressDiv;
        if ('downloadBtn' in target) target.downloadBtn = downloadBtn;
        return { progressDiv, downloadBtn };
    },

    attachDownloadCancelHandler(progressDiv, downloadId) {
        if (!progressDiv || !downloadId) return;
        progressDiv.querySelectorAll('.cancel-download-btn, .cancel-download-btn-pending').forEach(cancelBtn => {
            if (cancelBtn._hasListener) return;
            cancelBtn._hasListener = true;
            cancelBtn.addEventListener('click', () => this.cancelDownload(downloadId));
        });
    },

    renderDownloadSnapshot(downloadId, snapshot, elements = {}) {
        if (!snapshot) return;

        const { progressDiv, downloadBtn } = elements.progressDiv || elements.downloadBtn
            ? elements
            : this.resolveDownloadUiElements(snapshot);
        const progress = snapshot.progress || {};
        const status = snapshot.status || progress.status || '';
        const isActive = snapshot.isActive || Boolean(downloadId && this.activeDownloads?.[downloadId]);
        const terminalStatuses = new Set(['cancelling', 'cancelled', 'error', 'refresh_error', 'completed_checking', 'completed']);
        const shouldRenderProgress = status === 'starting'
            || status === 'downloading'
            || (isActive && !terminalStatuses.has(status));

        if (progressDiv) {
            progressDiv.classList.remove('mr-is-hidden');
            progressDiv.classList.add('mr-is-visible');

            if (shouldRenderProgress) {
                const canCancel = Boolean(downloadId);
                const percent = Math.max(0, Math.min(100, Number(progress.progress) || 0));
                const downloaded = this.formatBytes(progress.downloaded || 0);
                const total = this.formatBytes(progress.total_size || 0);
                const progressMeta = this.formatDownloadProgressMeta(progress);
                const leftText = progress.total_size
                    ? `${downloaded} / ${total} (${percent}%)`
                    : '<span class="mr-info-accent-text">Connecting...</span>';
                progressDiv.innerHTML = this.renderProgressWithAction({
                    percent,
                    leftText,
                    rightText: progressMeta,
                    actionClass: canCancel ? 'cancel-download-btn mr-btn mr-btn-danger mr-btn-sm' : '',
                    actionText: canCancel ? 'Cancel' : '',
                    actionDataAttr: canCancel ? `data-download-id="${downloadId}"` : '',
                    contextMenuModel: this.getDownloadFolderContext(progress, snapshot)
                });
                this.attachDownloadCancelHandler(progressDiv, downloadId);
            } else if (status === 'cancelled') {
                progressDiv.innerHTML = this.renderStatusMessage('Download cancelled - incomplete file removed', 'warning');
            } else if (status === 'cancelling') {
                progressDiv.innerHTML = this.renderDownloadStatusMessage(
                    snapshot.message || 'Cancelling download...',
                    snapshot.type || 'info',
                    progress,
                    snapshot
                );
            } else if (status === 'error' || status === 'refresh_error') {
                progressDiv.innerHTML = this.renderDownloadStatusMessage(
                    snapshot.message || progress.error || 'Download failed',
                    snapshot.type || (status === 'refresh_error' ? 'warning' : 'error'),
                    progress,
                    snapshot
                );
            } else if (status === 'completed_checking') {
                progressDiv.innerHTML = this.renderDownloadStatusMessage(
                    snapshot.message || 'Download complete. Checking local matches...',
                    snapshot.type || 'success',
                    progress,
                    snapshot
                );
            } else if (status === 'completed') {
                progressDiv.innerHTML = this.renderDownloadStatusMessage(
                    snapshot.message || 'Download complete. Local matches updated.',
                    snapshot.type || 'success',
                    progress,
                    snapshot
                );
            }
        }

        if (!downloadBtn) return;

        if (shouldRenderProgress) {
            const percent = Number(progress.progress);
            downloadBtn.disabled = true;
            downloadBtn.classList.remove('mr-is-success-action', 'mr-btn-primary');
            const label = Number.isFinite(percent) && percent > 0 ? `Downloading ${Math.round(percent)}%` : 'Starting download...';
            if (downloadBtn.classList.contains('search-download-btn')) {
                downloadBtn.innerHTML = getSvgIcon('download');
                downloadBtn.setAttribute('data-tooltip', label);
                downloadBtn.setAttribute('aria-label', label);
            } else {
                downloadBtn.textContent = Number.isFinite(percent) && percent > 0 ? `${Math.round(percent)}%` : 'Starting...';
            }
        } else if (status === 'cancelling') {
            downloadBtn.disabled = true;
            downloadBtn.classList.remove('mr-is-success-action', 'mr-btn-primary');
            if (downloadBtn.classList.contains('search-download-btn')) {
                downloadBtn.innerHTML = getSvgIcon('download');
                downloadBtn.setAttribute('data-tooltip', 'Cancelling download...');
                downloadBtn.setAttribute('aria-label', 'Cancelling download');
            } else {
                downloadBtn.textContent = 'Cancelling...';
            }
        } else if (status === 'error' || status === 'refresh_error') {
            downloadBtn.disabled = false;
            downloadBtn.classList.remove('mr-is-success-action', 'mr-btn-primary');
            if (downloadBtn.classList.contains('search-download-btn')) {
                downloadBtn.innerHTML = getSvgIcon('download');
                downloadBtn.setAttribute('data-tooltip', 'Retry download');
                downloadBtn.setAttribute('aria-label', 'Retry download');
            } else {
                downloadBtn.textContent = 'Retry';
            }
        } else {
            this.restoreDownloadButtonReadyState(downloadBtn);
        }
    },

    restoreDownloadProgressForMissing(missing) {
        const snapshot = this.getDownloadSnapshotForMissing(missing);
        if (!snapshot) return;
        this.renderDownloadSnapshot(snapshot.downloadId, snapshot);
    },

    async refreshLocalMatchesForDownloadedMissing(missing, downloadedFilename, { progressDiv = null, category = '', downloadPath = '', downloadDirectory = '' } = {}) {
        if (!missing) return [];

        const targetFilename = this.getDownloadedLocalMatchTarget(missing, downloadedFilename);
        if (!targetFilename) return [];

        if (progressDiv) {
            progressDiv.innerHTML = this.renderDownloadStatusMessage(
                `Checking local matches for ${targetFilename}...`,
                'info',
                { filename: targetFilename, path: downloadPath, directory: downloadDirectory },
                { category, downloadPath, downloadDirectory, filename: targetFilename }
            );
        }
        const body = this.contentElement?.querySelector(`#local-matches-body-${this.getMissingModelDomKey(missing)}`);
        if (body) {
            body.innerHTML = `<div class="mr-no-matches">Checking local matches for ${this.escapeHtml(targetFilename)}...</div>`;
        }

        const data = await this.fetchLocalMatches(targetFilename, category || missing.category || '', true);
        const matches = Array.isArray(data.matches) ? data.matches : [];
        const missingKey = this.getMissingModelKey(missing);
        const currentMissing = (this.missingModels || []).find(item => this.getMissingModelKey(item) === missingKey) || missing;
        currentMissing.matches = matches;
        missing.matches = matches;
        this.rememberDownloadedLocalMatchesForMissing(currentMissing, matches, {
            targetFilename,
            category: category || missing.category || '',
            downloadPath,
            downloadDirectory
        });
        this.allModels = null;
        this.invalidateLoadedModelsCacheForActiveWorkflow?.();
        this.refreshLocalMatchesUiForMissing(currentMissing);
        return matches;
    },

    refreshLocalMatchesUiForMissing(missing) {
        if (!missing || !this.contentElement) return;

        const body = this.contentElement.querySelector(`#local-matches-body-${this.getMissingModelDomKey(missing)}`);
        const displayIndex = Number.isFinite(missing.__displayIndex) ? missing.__displayIndex : 0;
        if (body) {
            body.innerHTML = this.renderLocalMatchesContent(missing, displayIndex);
            this.wireLocalMatchButtons(body, missing, displayIndex);
        }

        this.refreshMissingListRow(missing);
        this.updateBatchFooterButtons?.();
    },

    getLocalMatchRefreshTarget(missing = {}) {
        return missing.civitai_info?.expected_filename
            || missing.expected_filename
            || missing.download_source?.filename
            || missing.original_path
            || missing.name
            || '';
    },

    async refreshLocalMatchesForMissing(missing, { button = null } = {}) {
        if (!missing || button?.disabled) return [];

        const targetFilename = String(this.getLocalMatchRefreshTarget(missing) || '');
        if (!targetFilename) {
            this.showNotification('No model filename available for local refresh.', 'warning');
            return [];
        }

        const minRefreshFeedback = new Promise(resolve => setTimeout(resolve, 420));
        const refreshAnimation = this.startRefreshButtonAnimation?.(button);
        const body = this.contentElement?.querySelector(`#local-matches-body-${this.getMissingModelDomKey(missing)}`);
        const displayName = targetFilename.split('/').pop()?.split('\\').pop() || targetFilename;
        const missingKey = this.getMissingModelKey(missing);
        const currentMissing = (this.missingModels || []).find(item => this.getMissingModelKey(item) === missingKey) || missing;
        const previousMatches = this.cloneLocalMatches?.(currentMissing.matches || missing.matches || []) || [];

        try {
            if (button) {
                button.disabled = true;
                button.classList.add('mr-btn-is-disabled', 'mr-is-refreshing');
            }
            if (body) {
                body.innerHTML = `<div class="mr-no-matches">Refreshing local matches for ${this.escapeHtml(displayName)}...</div>`;
            }

            const data = await this.fetchLocalMatches(targetFilename, missing.category || '', true);
            const matches = Array.isArray(data.matches) ? data.matches : [];
            currentMissing.matches = matches;
            missing.matches = matches;
            if (currentMissing.is_urn) {
                currentMissing.__urnLocalMatchesFilename = targetFilename;
                missing.__urnLocalMatchesFilename = targetFilename;
            }

            this.rememberDownloadedLocalMatchesForMissing(currentMissing, matches, {
                targetFilename,
                category: missing.category || '',
                manualRefresh: true
            });
            this.allModels = null;
            this.invalidateLoadedModelsCacheForActiveWorkflow?.();
            await minRefreshFeedback;
            this.refreshLocalMatchesUiForMissing(currentMissing);

            return matches;
        } catch (error) {
            await minRefreshFeedback;
            console.error('Model Resolver: local match refresh failed:', error);
            currentMissing.matches = previousMatches;
            missing.matches = previousMatches;
            this.refreshLocalMatchesUiForMissing(currentMissing);
            this.showNotification(`Local match refresh failed: ${error.message}`, 'error');
            return [];
        } finally {
            refreshAnimation?.cancel?.();
            if (button) {
                button.disabled = false;
                button.classList.remove('mr-btn-is-disabled', 'mr-is-refreshing');
            }
        }
    },

    async refreshAfterDownload(missing, downloadedFilename, { progressDiv = null, downloadBtn = null, category = '', downloadPath = '', downloadDirectory = '', alreadyExists = false } = {}) {
        try {
            const matches = await this.refreshLocalMatchesForDownloadedMissing(missing, downloadedFilename, {
                progressDiv,
                category,
                downloadPath,
                downloadDirectory
            });
            const downloadedLower = String(downloadedFilename || '').toLowerCase();
            const perfectMatch = matches.find(match => {
                const matchFilename = match.filename || match.model?.filename || '';
                return match.confidence === 100
                    || (downloadedLower && matchFilename.toLowerCase() === downloadedLower);
            });
            const message = perfectMatch?.model
                ? (alreadyExists ? 'This model is already downloaded. Exact local match is ready.' : 'Download complete. Exact local match is ready.')
                : (alreadyExists ? 'This model is already downloaded. Local matches updated.' : 'Download complete. Local matches updated.');
            const snapshot = this.rememberDownloadSnapshotForMissing(missing, {
                downloadId: null,
                category,
                filename: downloadedFilename,
                downloadPath,
                downloadDirectory,
                progress: {
                    status: 'completed',
                    filename: downloadedFilename,
                    path: downloadPath,
                    directory: downloadDirectory,
                    already_exists: alreadyExists
                },
                status: 'completed',
                message,
                type: 'success',
                isActive: false
            });

            this.renderDownloadSnapshot(
                null,
                snapshot,
                progressDiv || downloadBtn ? { progressDiv, downloadBtn } : {}
            );

        } catch (error) {
            console.error('Model Resolver: Error refreshing after download:', error);
            const snapshot = this.rememberDownloadSnapshotForMissing(missing, {
                downloadId: null,
                category,
                filename: downloadedFilename,
                downloadPath,
                downloadDirectory,
                progress: {
                    status: 'refresh_error',
                    filename: downloadedFilename,
                    path: downloadPath,
                    directory: downloadDirectory
                },
                status: 'refresh_error',
                message: alreadyExists
                    ? `Already downloaded, but local re-check failed: ${error.message}`
                    : `Downloaded, but local re-check failed: ${error.message}`,
                type: 'warning',
                isActive: false
            });
            this.renderDownloadSnapshot(
                null,
                snapshot,
                progressDiv || downloadBtn ? { progressDiv, downloadBtn } : {}
            );
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Link manually';
            }
            this.showNotification(
                `${alreadyExists ? 'Already downloaded' : 'Downloaded'}, but local re-check failed: ${error.message}`,
                'warning',
                {
                    contextMenuModel: this.getDownloadFolderContext(
                        { filename: downloadedFilename, path: downloadPath, directory: downloadDirectory },
                        { category, downloadPath, downloadDirectory, filename: downloadedFilename }
                    )
                }
            );
        }
    },

    async executeDownloadRequest(missing, {
        url,
        filename,
        category,
        subfolder = '',
        baseDirectory = '',
        pathMetadata = null,
        downloadMetadata = null,
        btn = null
    }) {
        const progressId = this.getDownloadProgressElementId(missing);
        const progressDiv = this.contentElement?.querySelector(`#${progressId}`);
        const tokens = this.getStoredTokens();
        const workflowContext = this.getActiveWorkflowTabContext?.() || {};
        const workflowKey = this.getWorkflowScopedQueueKey?.() || '';
        const workflowRouteKey = workflowContext.workflowRouteKey || this.getActiveWorkflowRouteKey?.() || this.activeWorkflowRouteKey || '';
        const workflowLabel = workflowContext.workflowLabel || this.getActiveWorkflowDownloadLabel?.() || 'Current workflow';
        const workflowId = workflowContext.workflowId || this.getActiveWorkflowId?.() || '';
        const workflowSignature = workflowContext.workflowSignature || this.activeWorkflowSignature || '';
        const workflowTabId = workflowContext.workflowTabId || '';
        const workflowTabName = workflowContext.workflowTabName || '';
        const workflowTabAriaControls = workflowContext.workflowTabAriaControls || '';
        const workflowTabText = workflowContext.workflowTabText || '';

        try {
            this.rememberDownloadSnapshotForMissing(missing, {
                downloadId: null,
                category,
                subfolder,
                filename,
                downloadPath: '',
                downloadDirectory: '',
                baseDirectory,
                sourceUrl: url,
                workflowKey,
                workflowRouteKey,
                workflowLabel,
                workflowSignature,
                workflowId,
                workflowTabId,
                workflowTabName,
                workflowTabAriaControls,
                workflowTabText,
                progress: { status: 'starting', progress: 0, filename },
                status: 'starting',
                isActive: true
            });

            if (btn) {
                btn.disabled = true;
                btn.classList.remove('mr-is-success-action', 'mr-btn-primary');
                if (btn.classList.contains('search-download-btn')) {
                    btn.innerHTML = getSvgIcon('download');
                    btn.setAttribute('data-tooltip', 'Starting download...');
                    btn.setAttribute('aria-label', 'Starting download');
                } else {
                    btn.textContent = 'Starting...';
                }
            }

            if (progressDiv) {
                progressDiv.classList.remove('mr-is-hidden');
                progressDiv.classList.add('mr-is-visible');
                progressDiv.innerHTML = this.renderProgressWithAction({
                    percent: 0,
                    leftText: '<span class="mr-info-accent-text">Connecting...</span>',
                    rightText: '',
                    actionClass: 'cancel-download-btn-pending mr-btn mr-btn-danger mr-btn-sm',
                    actionText: 'Cancel'
                });
            }

            // Start download
            const data = await this.fetchJson('/model_resolver/download', {
                method: 'POST',
                body: JSON.stringify({
                    url,
                    filename,
                    category,
                    subfolder,
                    base_directory: baseDirectory,
                    path_metadata: pathMetadata,
                    download_metadata: downloadMetadata,
                    hf_token: tokens.hf_token,
                    civitai_key: tokens.civitai_key
                })
            }, 'Start download');

            if (!data.success) {
                throw new Error(data.error || 'Download failed');
            }

            const downloadId = data.download_id;
            this.activeDownloads[downloadId] = {
                missing,
                progressDiv,
                downloadBtn: btn,
                category,
                subfolder,
                filename,
                downloadPath: data.path || '',
                downloadDirectory: data.directory || '',
                baseDirectory,
                sourceUrl: url,
                workflowKey,
                workflowRouteKey,
                workflowLabel,
                workflowSignature,
                workflowId,
                workflowTabId,
                workflowTabName,
                workflowTabAriaControls,
                workflowTabText
            };

            const snapshot = this.rememberDownloadUiState(
                downloadId,
                this.activeDownloads[downloadId],
                {
                    status: 'starting',
                    progress: 0,
                    filename,
                    path: data.path || '',
                    directory: data.directory || ''
                },
                { isActive: true }
            );

            this.updateDownloadAllButtonState();
            this.updateQueuePanel?.();
            this.renderDownloadSnapshot(downloadId, snapshot);

            this.pollDownloadProgress(downloadId);

        } catch (error) {
            console.error('Model Resolver: Download error:', error);
            const snapshot = this.rememberDownloadSnapshotForMissing(missing, {
                downloadId: null,
                category,
                filename,
                downloadPath: '',
                downloadDirectory: '',
                baseDirectory,
                sourceUrl: url,
                workflowKey,
                workflowRouteKey,
                workflowLabel,
                workflowSignature,
                workflowId,
                workflowTabId,
                workflowTabName,
                workflowTabAriaControls,
                workflowTabText,
                progress: { status: 'error', filename, error: error.message },
                status: 'error',
                message: error.message,
                type: 'error',
                isActive: false
            });

            if (progressDiv) {
                this.renderDownloadSnapshot(null, snapshot, { progressDiv, downloadBtn: btn });
            }

            if (btn) {
                btn.disabled = false;
                btn.classList.remove('mr-is-success-action', 'mr-btn-primary');
                if (btn.classList.contains('search-download-btn')) {
                    btn.innerHTML = getSvgIcon('download');
                    btn.setAttribute('data-tooltip', 'Retry download');
                    btn.setAttribute('aria-label', 'Retry download');
                } else {
                    btn.innerHTML = '<span class="mr-btn-icon">☁</span> Retry';
                }
            }

            this.updateQueuePanel?.();
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    },

    /**
     * Download a model from a known source
     */
    async downloadModel(missing) {
        const source = missing.download_source;
        if (!source || !source.url) {
            this.showNotification('No download URL available', 'error');
            return;
        }

        const originalFilename = missing.original_path?.split('/').pop()?.split('\\').pop() || 'model.safetensors';
        const filename = source.filename || originalFilename;
        const targetSelection = this.getDownloadTargetSelection(missing, source.directory || missing.category || 'checkpoints');
        const downloadBtn = this.contentElement?.querySelector(`#${this.getDownloadButtonElementId(missing)}`);

        const pathMetadata = this.getDownloadPathMetadata(missing, source);
        const downloadMetadata = this.getDownloadMetadata(missing, source, {
            filename,
            category: targetSelection.category,
            url: source.url,
            pathMetadata
        });

        await this.executeDownloadRequest(missing, {
            url: source.url,
            filename,
            category: targetSelection.category,
            subfolder: targetSelection.subfolder,
            baseDirectory: targetSelection.baseDirectory || '',
            pathMetadata,
            downloadMetadata,
            btn: downloadBtn
        });
    },

    /**
     * Poll download progress
     */
    async pollDownloadProgress(downloadId) {
        const info = this.activeDownloads[downloadId];
        if (!info) return;

        try {
            const progress = await this.fetchJson(`/model_resolver/progress/${downloadId}`, { silent: true }, 'Get download progress');
            const snapshot = this.rememberDownloadUiState(downloadId, info, progress, { isActive: true });
            const { progressDiv, downloadBtn } = this.resolveDownloadUiElements(info);
            const { missing, category } = info;
            const downloadFolderContext = this.getDownloadFolderContext(progress, info);

            if (progress.status === 'downloading' || progress.status === 'starting') {
                this.renderDownloadSnapshot(downloadId, snapshot, { progressDiv, downloadBtn });
                this.updateQueuePanel?.();

                // Continue polling
                setTimeout(() => this.pollDownloadProgress(downloadId), 1000);

            } else if (progress.status === 'completed') {
                const alreadyExists = Boolean(progress.already_exists);
                const completedSnapshot = this.rememberDownloadUiState(downloadId, info, progress, {
                    status: 'completed_checking',
                    message: alreadyExists
                        ? (progress.message || 'This model is already downloaded. Checking local matches...')
                        : 'Download complete. Checking local matches...',
                    type: 'success',
                    isActive: false
                });
                this.renderDownloadSnapshot(downloadId, completedSnapshot, { progressDiv, downloadBtn });
                this.rememberDownloadSubfolderAfterCompletion(info, progress);
                this.rememberCompletedDownloadHistory?.(downloadId, info, progress);
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();
                this.updateQueuePanel?.();
                this.showNotification(alreadyExists
                    ? `Already downloaded: ${progress.filename}`
                    : `Downloaded: ${progress.filename}`, 'success', {
                    contextMenuModel: downloadFolderContext
                });

                // Refresh local matches only for this downloaded missing model.
                // Small delay to ensure file system is updated.
                setTimeout(async () => {
                    const currentElements = this.resolveDownloadUiElements(info);
                    await this.refreshAfterDownload(missing, progress.filename, {
                        progressDiv: currentElements.progressDiv,
                        downloadBtn: currentElements.downloadBtn,
                        category,
                        downloadPath: progress.path || info.downloadPath || '',
                        downloadDirectory: progress.directory || info.downloadDirectory || '',
                        alreadyExists
                    });
                }, 500);

            } else if (progress.status === 'error') {
                const errorSnapshot = this.rememberDownloadUiState(downloadId, info, progress, {
                    status: 'error',
                    message: progress.error || 'Download failed',
                    type: 'error',
                    isActive: false
                });
                this.renderDownloadSnapshot(downloadId, errorSnapshot, { progressDiv, downloadBtn });
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();
                this.updateQueuePanel?.();

            } else if (progress.status === 'cancelled') {
                const cancelledSnapshot = this.rememberDownloadUiState(downloadId, info, progress, {
                    status: 'cancelled',
                    type: 'warning',
                    isActive: false
                });
                this.renderDownloadSnapshot(downloadId, cancelledSnapshot, { progressDiv, downloadBtn });
                delete this.activeDownloads[downloadId];
                this.updateDownloadAllButtonState();
                this.updateQueuePanel?.();
                this.showNotification('Download cancelled', 'info');

            } else {
                // Unknown status, keep polling
                setTimeout(() => this.pollDownloadProgress(downloadId), 500);
            }

        } catch (error) {
            console.error('Model Resolver: Progress poll error:', error);
            const info = this.activeDownloads[downloadId];
            // Update UI to show error state instead of just disappearing
            if (info) {
                const snapshot = this.rememberDownloadUiState(
                    downloadId,
                    info,
                    { ...(info.lastProgress || {}), status: 'error' },
                    {
                        status: 'error',
                        message: 'Connection lost - download may have failed',
                        type: 'error',
                        isActive: false
                    }
                );
                this.renderDownloadSnapshot(downloadId, snapshot);
            }
            delete this.activeDownloads[downloadId];
            this.updateDownloadAllButtonState();
            this.updateQueuePanel?.();
        }
    },

    restoreDownloadButtonReadyState(downloadBtn) {
        if (!downloadBtn) return;
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('mr-is-success-action', 'mr-btn-primary');
        if (downloadBtn.classList.contains('search-download-btn')) {
            downloadBtn.innerHTML = getSvgIcon('download');
            downloadBtn.setAttribute('data-tooltip', 'Download');
            downloadBtn.setAttribute('aria-label', 'Download');
            return;
        }
        downloadBtn.innerHTML = '<span class="mr-btn-icon">☁</span> Download';
    },

    /**
     * Cancel an active download
     */
    async cancelDownload(downloadId) {
        try {
            await this.fetchJson(`/model_resolver/cancel/${downloadId}`, {
                method: 'POST'
            }, 'Cancel download');

            const info = this.activeDownloads[downloadId];
            if (info) {
                const snapshot = this.rememberDownloadUiState(
                    downloadId,
                    info,
                    info.lastProgress || { status: 'cancelling', progress: 0 },
                    {
                        status: 'cancelling',
                        message: 'Cancelling download...',
                        type: 'info',
                        isActive: true
                    }
                );
                this.renderDownloadSnapshot(downloadId, snapshot);
                this.updateQueuePanel?.();
            }

        } catch (error) {
            console.error('Model Resolver: Cancel error:', error);
            this.showNotification('Failed to cancel download', 'error');
        }
    },

    /**
     * Search online for a model
     */
    async searchOnline(missing, { workflowKey = this.getWorkflowScopedQueueKey(), forceSearch = false } = {}) {
        let filename = missing.original_path?.split('/').pop()?.split('\\').pop() || '';
        let category = missing.category || this.getNodeTypeDownloadCategory?.(missing.node_type) || '';
        const state = this.getSearchStateForWorkflow(workflowKey, missing);
        const missingSearchKey = this.getMissingSearchKey(missing);
        const backgroundJobKey = this.getBackgroundSearchJobKey(workflowKey, missingSearchKey);
        const activeJob = this.backgroundSearchJobs?.get(backgroundJobKey);
        if (activeJob?.promise) {
            this.refreshSearchUiForMissing(missing, state, { workflowKey });
            return activeJob.promise;
        }
        let selectedSource = state.selectedSource || 'all';
        if (selectedSource !== 'all' && !this.isSearchSourceUsable(selectedSource)) {
            selectedSource = 'all';
            state.selectedSource = 'all';
            this.persistSearchStateForWorkflow(workflowKey, missing, state);
        }
        const selectedSourceLabel = this.getSearchSourceLabel(selectedSource);
        const sourceIds = this.getSearchSourcesForSelection(selectedSource, missing);
        const baseModelContext = this.getSearchBaseModelContext(missing);
        const selectedBaseModelAtStart = state.selectedBaseModel || this.getDefaultSearchBaseModel?.() || 'auto';

        // For URNs, use the resolved file/model name for searching instead of the URN itself
        // and pass the URN type as category (CivitAI expects specific type names)
        if (missing.is_urn) {
            const urnSearchName = missing.civitai_info?.expected_filename
                || missing.download_source?.filename
                || missing.civitai_info?.model_name;
            if (urnSearchName) {
                filename = urnSearchName;
            }
            // Pass URN type directly - CivitAPI expects types like 'Upscaler', 'Checkpoint'
            const urnType = missing.urn_type || '';
            if (urnType) {
                // Map URN types to CivitAI type names
                const typeMap = {
                    'checkpoint': 'Checkpoint',
                    'lora': 'LORA',
                    'vae': 'VAE',
                    'upscaler': 'Upscaler',
                    'upscale_model': 'Upscaler',
                    'embedding': 'TextualInversion',
                    'controlnet': 'Controlnet'
                };
                const civitaiType = typeMap[urnType.toLowerCase()];
                if (civitaiType) {
                    category = civitaiType;
                }
            }
        }

        const isUrn = missing.is_urn || false;
        const resultsId = `search-results-${missing.node_id}-${missing.widget_index}`;
        const canUpdateCurrentWorkflow = workflowKey === this.getWorkflowScopedQueueKey();
        const resultsDiv = canUpdateCurrentWorkflow
            ? this.contentElement?.querySelector(`#${resultsId}`)
            : null;
        const searchBtn = canUpdateCurrentWorkflow
            ? this.contentElement?.querySelector(`#search-${missing.node_id}-${missing.widget_index}`)
            : null;
        let searchRunId = null;
        let completedSearchRun = false;

        try {
            if (!sourceIds.length) {
                throw new Error(`${selectedSourceLabel} is not available in this install`);
            }

            this.clearSearchProgressTimers(state.activeSearchRunId);
            searchRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const backgroundJob = {
                workflowKey,
                missingSearchKey,
                runId: searchRunId,
                missing,
                startedAt: Date.now(),
                sourceControllers: new Map(),
                sourceProgressIds: new Map(),
                cancelledSources: new Set(),
                promise: null
            };
            this.backgroundSearchJobs.set(backgroundJobKey, backgroundJob);
            state.activeSearchRunId = searchRunId;
            state.lastAttemptSources = sourceIds;
            state.lastAttemptFound = null;
            state.lastAttemptError = null;
            state.lastAttemptBaseModelContext = baseModelContext;
            if (forceSearch) {
                state.results = this.clearSearchResultsForSources?.(state.results || {}, sourceIds)
                    || this.createEmptySearchState().results;
            }
            state.sourceProgress = {};
            for (const source of sourceIds) {
                this.setSourceProgress(state, source, {
                    status: 'running',
                    percent: 6,
                    startedAt: Date.now(),
                    estimateMs: this.getSearchSourceEstimateMs(source, isUrn)
                }, missing, { workflowKey });
            }
            this.persistSearchStateForWorkflow(workflowKey, missing, state);

            if (searchBtn) {
                searchBtn.disabled = true;
                searchBtn.innerHTML = this.renderSearchButtonContent(`Searching ${selectedSourceLabel}...`);
            }
            if (resultsDiv) {
                resultsDiv.classList.remove('mr-is-hidden');
                resultsDiv.classList.add('mr-is-visible');
                this.displaySearchResults(missing, state, resultsDiv);
            }
            for (const source of sourceIds) {
                this.startEstimatedSearchProgress(
                    state,
                    missing,
                    resultsDiv,
                    source,
                    searchRunId,
                    { workflowKey }
                );
            }

            // For URNs, include model_id and version_id for direct download
            const tokens = this.getStoredTokens();
            const baseSearchData = {
                filename,
                category,
                is_urn: isUrn,
                base_model_context: baseModelContext,
                civitai_session_token: tokens.civitai_session_token,
                civitai_candidate_limit: tokens.civitai_candidate_limit,
                civitai_use_trpc_search: tokens.civitai_use_trpc_search,
                civitai_use_html_fallback: tokens.civitai_use_html_fallback,
                hf_token: tokens.hf_token,
                brave_search_api_key: tokens.brave_search_api_key,
                hf_use_api_search: tokens.hf_use_api_search,
                hf_use_comfy_org_fallback: tokens.hf_use_comfy_org_fallback,
                hf_use_brave_fallback: tokens.hf_use_brave_fallback,
                force_search: Boolean(forceSearch)
            };
            if (isUrn && missing.urn) {
                baseSearchData.model_id = missing.urn.model_id;
                baseSearchData.version_id = missing.urn.version_id;
            }

            const attemptedSources = new Set();
            let anyFound = false;
            let hadError = false;

            const searchPromises = sourceIds.map(async (source) => {
                const sourceIsUrn = isUrn && source !== 'lora_manager_archive';
                const progressId = `${searchRunId}-${source}-${Math.random().toString(36).slice(2, 8)}`;
                const searchData = {
                    ...baseSearchData,
                    is_urn: sourceIsUrn,
                    sources: [source],
                    progress_id: progressId,
                    progress_source: source
                };
                const sourceController = typeof AbortController !== 'undefined'
                    ? new AbortController()
                    : null;
                const currentJob = this.backgroundSearchJobs.get(backgroundJobKey);
                if (sourceController && currentJob?.runId === searchRunId) {
                    currentJob.sourceControllers?.set(source, sourceController);
                }
                if (currentJob?.runId === searchRunId) {
                    currentJob.sourceProgressIds?.set(source, progressId);
                }
                this.startBackendSearchProgressPolling?.(state, missing, source, searchRunId, progressId, { workflowKey });

                try {
                    if (this.isSearchSourceCancelled?.(workflowKey, missingSearchKey, searchRunId, source)) {
                        return { source, cancelled: true };
                    }

                    log.debug('Model Resolver: Search request:', JSON.stringify(searchData));

                    const data = await this.fetchJson('/model_resolver/search', {
                        method: 'POST',
                        body: JSON.stringify(searchData),
                        signal: sourceController?.signal,
                        silent: true
                    }, 'Search source');
                    log.debug('Model Resolver: Search response:', JSON.stringify(data));

                    if (!this.isBackgroundSearchRunActive(workflowKey, missingSearchKey, searchRunId)) {
                        return { source, stale: true };
                    }
                    if (this.isSearchSourceCancelled?.(workflowKey, missingSearchKey, searchRunId, source)) {
                        return { source, cancelled: true };
                    }
                    const currentSelectedBaseModel = state.selectedBaseModel || this.getDefaultSearchBaseModel?.() || 'auto';
                    if (currentSelectedBaseModel !== selectedBaseModelAtStart) {
                        return { source, stale: true };
                    }

                    const responseSources = Array.isArray(data.searched_sources) && data.searched_sources.length
                        ? data.searched_sources
                        : [source];
                    responseSources.forEach(responseSource => attemptedSources.add(responseSource));
                    const sourceErrors = data.source_errors && typeof data.source_errors === 'object'
                        ? data.source_errors
                        : {};
                    const sourceError = sourceErrors[source]
                        || responseSources.map(responseSource => sourceErrors[responseSource]).find(Boolean)
                        || null;

                    const found = this.hasSearchResults(data);
                    const foundViaAnyModel = this.isAnyModelSearchResult?.(data[source]);
                    const foundMessage = foundViaAnyModel ? 'Found (Any Model)' : 'Found';
                    anyFound = anyFound || found;
                    hadError = hadError || Boolean(sourceError);
                    state.results = this.mergeSearchResults(state.results, data, {
                        searchedAt: new Date().toISOString(),
                        forceRefresh: Boolean(forceSearch)
                    });
                    this.applyLocalHashMatchesFromSearchResponse(missing, data, { workflowKey });
                    state.lastAttemptSources = Array.from(attemptedSources);
                    state.lastAttemptFound = anyFound;
                    this.clearSearchProgressTimer(searchRunId, source);
                    this.clearBackendSearchProgressTimer?.(searchRunId, source);
                    this.setSourceProgress(state, source, {
                        status: sourceError ? 'error' : (found ? 'found' : 'none'),
                        percent: 100,
                        message: sourceError ? 'Error' : (found ? foundMessage : 'No match'),
                        error: sourceError || null
                    }, missing, { workflowKey });

                    if (data.civitai) {
                        missing.civitai_search_result = {
                            base_model: data.civitai.base_model,
                            tags: data.civitai.tags || [],
                            trained_words: data.civitai.trained_words || [],
                            filename: data.civitai.filename,
                            name: data.civitai.name,
                            type: data.civitai.type
                        };
                    }
                    if (data.civarchive) {
                        missing.civitai_search_result = {
                            base_model: data.civarchive.base_model,
                            tags: data.civarchive.tags || [],
                            trained_words: data.civarchive.trained_words || [],
                            filename: data.civarchive.filename,
                            name: data.civarchive.name,
                            type: data.civarchive.type
                        };
                    }

                    this.persistSearchStateForWorkflow(workflowKey, missing, state);
                    this.refreshSearchUiForMissing(missing, state, { workflowKey });
                    this.applySearchResultSuggestion(missing);
                    return { source, data };
                } catch (error) {
                    const wasCancelled = error?.name === 'AbortError'
                        || this.isSearchSourceCancelled?.(workflowKey, missingSearchKey, searchRunId, source);
                    if (wasCancelled) {
                        this.clearSearchProgressTimer(searchRunId, source);
                        this.clearBackendSearchProgressTimer?.(searchRunId, source);
                        return { source, cancelled: true };
                    }

                    console.error(`Model Resolver: Search error for ${source}:`, error);
                    if (!this.isBackgroundSearchRunActive(workflowKey, missingSearchKey, searchRunId)) {
                        return { source, stale: true, error };
                    }

                    hadError = true;
                    attemptedSources.add(source);
                    state.lastAttemptSources = Array.from(attemptedSources);
                    state.lastAttemptFound = anyFound;
                    this.clearSearchProgressTimer(searchRunId, source);
                    this.clearBackendSearchProgressTimer?.(searchRunId, source);
                    this.setSourceProgress(state, source, {
                        status: 'error',
                        percent: 100,
                        message: error.message || 'Error'
                    }, missing, { workflowKey });
                    this.persistSearchStateForWorkflow(workflowKey, missing, state);
                    this.refreshSearchUiForMissing(missing, state, { workflowKey });
                    return { source, error };
                } finally {
                    const cleanupJob = this.backgroundSearchJobs.get(backgroundJobKey);
                    if (cleanupJob?.runId === searchRunId) {
                        cleanupJob.sourceControllers?.delete(source);
                        cleanupJob.sourceProgressIds?.delete(source);
                    }
                }
            });

            const currentJob = this.backgroundSearchJobs.get(backgroundJobKey);
            if (currentJob?.runId === searchRunId) {
                currentJob.promise = Promise.all(searchPromises);
            }
            await Promise.all(searchPromises);
            this.clearSearchProgressTimers(searchRunId);
            this.clearBackendSearchProgressTimers?.(searchRunId);

            if (this.isBackgroundSearchRunActive(workflowKey, missingSearchKey, searchRunId)) {
                for (const source of sourceIds) {
                    const progress = state.sourceProgress?.[source];
                    if (!progress || (progress.status !== 'pending' && progress.status !== 'running')) continue;
                    attemptedSources.add(source);
                    this.setSourceProgress(state, source, {
                        status: 'none',
                        percent: 100,
                        message: 'No match',
                        error: null
                    }, missing, { workflowKey });
                }
                state.activeSearchRunId = null;
                state.lastAttemptSources = attemptedSources.size ? Array.from(attemptedSources) : sourceIds;
                state.lastAttemptFound = anyFound;
                state.lastAttemptError = hadError && !anyFound
                    ? 'Search finished with errors. Check source statuses above.'
                    : null;
                this.persistSearchStateForWorkflow(workflowKey, missing, state);
                this.refreshSearchUiForMissing(missing, state, { workflowKey });
                completedSearchRun = true;
            }

        } catch (error) {
            console.error('Model Resolver: Search error:', error);
            this.clearSearchProgressTimers(searchRunId);
            this.clearBackendSearchProgressTimers?.(searchRunId);
            state.lastAttemptError = error.message;
            this.persistSearchStateForWorkflow(workflowKey, missing, state);
            if (resultsDiv) {
                resultsDiv.innerHTML = this.renderStatusMessage(`Search failed: ${error.message}`, 'error');
            }
        } finally {
            if (!searchRunId || this.isBackgroundSearchRunActive(workflowKey, missingSearchKey, searchRunId)) {
                this.clearSearchProgressTimers(searchRunId);
                this.clearBackendSearchProgressTimers?.(searchRunId);
                state.activeSearchRunId = null;
            }
            const currentJob = this.backgroundSearchJobs?.get(backgroundJobKey);
            if (currentJob?.runId === searchRunId) {
                this.backgroundSearchJobs.delete(backgroundJobKey);
            }
            if (!completedSearchRun) {
                this.settleInactiveSearchProgress?.(missing, state, {
                    workflowKey,
                    message: state.lastAttemptError || 'Search interrupted',
                    persist: false,
                    refresh: false
                });
            }
            if (searchBtn) {
                searchBtn.disabled = false;
                searchBtn.innerHTML = this.renderSearchButtonContent('Search Again');
            }
            this.persistSearchStateForWorkflow(workflowKey, missing, state);
            this.refreshSearchUiForMissing(missing, state, { workflowKey });
        }
    },

    /**
     * Resolve URN asynchronously - fetch CivitAI info and update UI
     */
    async resolveUrnAsync(modelId, versionId, loadingElementId, modelUrl) {
        log.debug('resolveUrnAsync called:', modelId, versionId);
        if (!modelId || !versionId) {
            log.debug('resolveUrnAsync: missing modelId or versionId');
            return;
        }

        try {
            const downloadContainerId = loadingElementId.replace('urn-loading-', 'urn-download-');
            const missing = this.missingModels.find(m =>
                `urn-download-${m.node_id}-${m.widget_index}` === downloadContainerId
            );

            let data = null;
            if (missing) {
                data = await this.resolveUrnDataForMissing(missing);
            } else {
                const tokens = this.getStoredTokens();
                const payload = {
                    filename: `${modelId}_${versionId}`,
                    category: '',
                    is_urn: true,
                    sources: ['civitai'],
                    model_id: modelId,
                    version_id: versionId,
                    civitai_candidate_limit: tokens.civitai_candidate_limit
                };
                log.debug('resolveUrnAsync payload:', JSON.stringify(payload));

                data = await this.fetchJson('/model_resolver/search', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    silent: true
                }, 'Resolve URN');
                log.debug('resolveUrnAsync search completed');
            }

            if (data) {
                const loadingEl = document.getElementById(loadingElementId);
                if (loadingEl && data.civitai) {
                    loadingEl.classList.remove('mr-is-muted', 'mr-is-error');
                    const civitai = data.civitai;
                    const labelHtml = this.renderVersionedModelNameHtml(civitai.name, civitai.version_name)
                        || this.escapeHtml(civitai.filename || 'Model');
                    const url = modelUrl || `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`;
                    loadingEl.innerHTML = `<a href="${url}" target="_blank" class="mr-inline-civitai-link">${labelHtml}</a>`;
                } else if (loadingEl) {
                    loadingEl.textContent = 'Not found';
                    loadingEl.classList.remove('mr-is-error');
                    loadingEl.classList.add('mr-is-muted');
                }

                const downloadEl = document.getElementById(downloadContainerId);
                if (downloadEl && data.civitai?.download_url) {
                    if (missing) {
                        this.applyCivitaiUrnResult(missing, data.civitai);
                        this.refreshSearchBaseModelLabels?.();
                        const downloadParent = downloadEl.parentElement;
                        downloadEl.outerHTML = this.renderKnownDownloadPanel(missing, missing.download_source);
                        this.wireDownloadSearchPanel(downloadParent || this.contentElement, missing);
                        this.refreshUrnLocalMatches(missing);
                    }
                } else if (downloadEl) {
                    downloadEl.innerHTML = `<div class="mr-download-info">Unable to resolve direct download for this URN.</div>`;
                }
            } else {
                const loadingEl = document.getElementById(loadingElementId);
                if (loadingEl) {
                    loadingEl.textContent = 'Error';
                    loadingEl.classList.remove('mr-is-muted');
                    loadingEl.classList.add('mr-is-error');
                }
                const downloadContainerId = loadingElementId.replace('urn-loading-', 'urn-download-');
                const downloadEl = document.getElementById(downloadContainerId);
                if (downloadEl) {
                    downloadEl.innerHTML = `<div class="mr-download-info">Failed to resolve URN download.</div>`;
                }
            }
        } catch (error) {
            console.error('Model Resolver: URN resolve error:', error);
            const loadingEl = document.getElementById(loadingElementId);
            if (loadingEl) {
                loadingEl.textContent = 'Error';
                loadingEl.classList.remove('mr-is-muted');
                loadingEl.classList.add('mr-is-error');
            }
            const downloadContainerId = loadingElementId.replace('urn-loading-', 'urn-download-');
            const downloadEl = document.getElementById(downloadContainerId);
            if (downloadEl) {
                downloadEl.innerHTML = `<div class="mr-download-info">Failed to resolve URN download.</div>`;
            }
        }
    },

    wireSearchDownloadButtons(container, missing) {
        if (!container) return;

        const downloadBtns = container.querySelectorAll('.search-download-btn');
        downloadBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                const filename = btn.dataset.filename;
                const category = btn.dataset.category;
                let pathMetadata = null;
                try {
                    pathMetadata = btn.dataset.pathMetadata
                        ? JSON.parse(decodeURIComponent(btn.dataset.pathMetadata))
                        : null;
                } catch (_error) {
                    pathMetadata = null;
                }
                let downloadMetadata = null;
                try {
                    downloadMetadata = btn.dataset.downloadMetadata
                        ? JSON.parse(decodeURIComponent(btn.dataset.downloadMetadata))
                        : null;
                } catch (_error) {
                    downloadMetadata = null;
                }
                this.downloadFromSearch(missing, url, filename, category, btn, pathMetadata, downloadMetadata);
            });
        });

        const openPageBtns = container.querySelectorAll('.search-open-page-btn');
        openPageBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                if (!url) return;

                const opened = window.open(url, '_blank', 'noopener,noreferrer');
                if (opened) {
                    opened.opener = null;
                }
            });
        });

        const detailsBtns = container.querySelectorAll('.search-show-details-btn');
        detailsBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                try {
                    const model = JSON.parse(decodeURIComponent(btn.dataset.model || ''));
                    this.showSourceModelDetails(model);
                } catch (error) {
                    console.error('Model Resolver: failed to open model details:', error);
                    this.showNotification?.('Failed to open model details.', 'error');
                }
            });
        });
    },

    wireDownloadSearchPanel(container, missing) {
        if (!container) return;

        const searchResultsId = `search-results-${missing.node_id}-${missing.widget_index}`;
        const searchResultsDiv = container.querySelector(`#${searchResultsId}`);
        if (searchResultsDiv) {
            this.wireSearchDownloadButtons(searchResultsDiv, missing);
        }

        const searchBtn = container.querySelector(`#search-${missing.node_id}-${missing.widget_index}`);
        if (searchBtn && searchBtn.dataset.mlSearchBound !== 'true') {
            searchBtn.dataset.mlSearchBound = 'true';
            searchBtn.addEventListener('click', () => {
                this.searchOnline(missing, {
                    forceSearch: this.hasSearchAttemptForMissing?.(missing) || this.hasSearchResultsForMissing(missing)
                });
            });
        }

        const sourceSelect = container.querySelector(`#search-source-select-${missing.node_id}-${missing.widget_index}`);
        const sourceList = container.querySelector(`#search-source-list-${missing.node_id}-${missing.widget_index}`);
        if (sourceSelect && sourceList && sourceSelect.dataset.mlSearchSourceBound !== 'true') {
            sourceSelect.dataset.mlSearchSourceBound = 'true';

            const renderSourceOptions = () => {
                const options = this.getSearchSourceOptions();
                sourceList.innerHTML = options
                    .map(option => `<div class="mr-download-target-option" data-value="${encodeURIComponent(option.value)}" data-label="${encodeURIComponent(option.label)}">${this.escapeHtml(option.label)}</div>`)
                    .join('');
                this.showDropdownList?.(sourceList, sourceSelect);
                sourceList.querySelectorAll('.mr-download-target-option').forEach(optionEl => {
                    optionEl.addEventListener('mousedown', (event) => {
                        event.preventDefault();
                        const value = decodeURIComponent(optionEl.dataset.value || '');
                        const label = decodeURIComponent(optionEl.dataset.label || optionEl.dataset.value || '');
                        this.setDropdownValue(sourceSelect, value, label);
                        this.setSearchSource(missing, value, container);
                        this.hideDropdownList(sourceList);
                    });
                });
            };

            this.enableWheelScrollChaining(sourceList);
            this.bindDropdownOutsideDismiss?.(sourceList, [sourceSelect]);
            sourceSelect.addEventListener('focus', () => renderSourceOptions());
            sourceSelect.addEventListener('click', () => renderSourceOptions());
            sourceSelect.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    renderSourceOptions();
                }
            });
            this.syncSearchSourceUi(missing, container);
        }

        const baseSelect = container.querySelector(`#search-base-select-${missing.node_id}-${missing.widget_index}`);
        const baseList = container.querySelector(`#search-base-list-${missing.node_id}-${missing.widget_index}`);
        if (baseSelect && baseList && baseSelect.dataset.mlSearchBaseBound !== 'true') {
            baseSelect.dataset.mlSearchBaseBound = 'true';

            const renderBaseOptions = (filterText = '') => {
                const filter = String(filterText || '').trim().toLowerCase();
                const normalizedFilter = this.normalizeBaseModelToken?.(filter) || filter.replace(/[^a-z0-9]+/g, '');
                const options = this.getKnownBaseModelOptions()
                    .map(option => {
                        const label = option.value === 'auto'
                            ? this.getSearchBaseModelLabel('auto', missing)
                            : option.label;
                        return { ...option, label };
                    })
                    .filter(option => {
                        if (!filter) return true;
                        const searchText = `${option.value} ${option.label}`.toLowerCase();
                        const normalizedSearchText = this.normalizeBaseModelToken?.(searchText)
                            || searchText.replace(/[^a-z0-9]+/g, '');
                        return searchText.includes(filter)
                            || (normalizedFilter && normalizedSearchText.includes(normalizedFilter));
                    });
                baseList.innerHTML = options
                    .map(option => {
                        const label = option.label;
                        return `<div class="mr-download-target-option" data-value="${encodeURIComponent(option.value)}" data-label="${encodeURIComponent(label)}">${this.escapeHtml(label)}</div>`;
                    })
                    .join('');
                if (options.length) {
                    this.showDropdownList?.(baseList, baseSelect);
                } else {
                    this.hideDropdownList(baseList);
                }
                baseList.querySelectorAll('.mr-download-target-option').forEach(optionEl => {
                    optionEl.addEventListener('mousedown', (event) => {
                        event.preventDefault();
                        const value = decodeURIComponent(optionEl.dataset.value || '');
                        const label = decodeURIComponent(optionEl.dataset.label || optionEl.dataset.value || '');
                        this.setDropdownValue(baseSelect, value, label);
                        this.setSearchBaseModel(missing, value, container);
                        this.hideDropdownList(baseList);
                    });
                });
            };

            this.enableWheelScrollChaining(baseList);
            this.bindDropdownOutsideDismiss?.(baseList, [baseSelect], () => {
                const value = this.getDropdownValue(baseSelect);
                this.setDropdownValue(baseSelect, value, this.getSearchBaseModelLabel(value, missing));
                this.hideDropdownList(baseList);
            });
            baseSelect.addEventListener('focus', () => renderBaseOptions(''));
            baseSelect.addEventListener('click', () => renderBaseOptions(''));
            baseSelect.addEventListener('input', () => {
                const value = this.getSearchBaseModelInputValue(baseSelect.value, missing);
                baseSelect.dataset.value = value;
                this.setSearchBaseModel(missing, value, container, { sync: false });
                renderBaseOptions(baseSelect.value);
            });
            baseSelect.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    renderBaseOptions(baseSelect.value);
                }
            });
            baseSelect.addEventListener('blur', () => {
                const value = this.getDropdownValue(baseSelect);
                this.setDropdownValue(baseSelect, value, this.getSearchBaseModelLabel(value, missing));
            });
            this.syncSearchSourceUi(missing, container);
        }

        this.wireDownloadTargetAutocomplete(container, missing);
    },

    /**
     * Display search results
     */
    displaySearchResults(missing, state, container) {
        if (!container) return;

        const results = state?.results || {};
        const popular = results.popular;
        const modelListResult = results.model_list;
        const hfResult = results.huggingface ? (Array.isArray(results.huggingface) ? results.huggingface[0] : results.huggingface) : null;
        const civitaiResult = results.civitai ? (Array.isArray(results.civitai) ? results.civitai[0] : results.civitai) : null;
        const civarchiveResult = results.civarchive ? (Array.isArray(results.civarchive) ? results.civarchive[0] : results.civarchive) : null;
        const loraManagerArchiveResult = results.lora_manager_archive ? (Array.isArray(results.lora_manager_archive) ? results.lora_manager_archive[0] : results.lora_manager_archive) : null;
        const knownDownloadRow = this.getDownloadSourceTableRow(missing, missing.download_source);
        const hasResults = knownDownloadRow || popular || modelListResult || hfResult || civitaiResult || civarchiveResult || loraManagerArchiveResult;
        const progressHtml = this.renderSearchProgress(state);
        const hasActiveProgress = this.hasActiveSearchProgress(state);

        if (!hasResults) {
            if (hasActiveProgress) {
                container.innerHTML = progressHtml;
                this.wireSearchProgressCancelButtons?.(container, missing, state);
                return;
            }

            if (state?.lastAttemptError) {
                container.innerHTML = `${progressHtml}${this.renderStatusMessage(state.lastAttemptError, 'error')}`;
                this.wireSearchProgressCancelButtons?.(container, missing, state);
                return;
            }

            container.innerHTML = progressHtml || this.renderStatusMessage(
                'No matches found online for this model.',
                'warning'
            );
            this.wireSearchProgressCancelButtons?.(container, missing, state);
            return;
        }

        const rows = [];
        const rowKeys = new Set();
        const addRow = (row) => {
            if (!row) return;
            if (!row.pathMetadata) {
                row.pathMetadata = this.getDownloadPathMetadata(missing, row.detailsContext || row);
            }
            if (!row.downloadMetadata) {
                row.downloadMetadata = this.getDownloadMetadata(missing, row.detailsContext || row, {
                    filename: row.downloadFilename || row.filename || '',
                    category: row.category || missing.category || '',
                    url: row.downloadUrl || '',
                    openUrl: row.openUrl || '',
                    pathMetadata: row.pathMetadata
                });
            }
            const rowKey = `${row.sourceKey}:${row.downloadUrl || row.openUrl || `${row.model}:${row.filename}`}`;
            if (rowKeys.has(rowKey)) return;
            rowKeys.add(rowKey);
            rows.push(row);
        };

        let statusHtml = '';
        if (!hasActiveProgress && state?.lastAttemptError) {
            statusHtml += this.renderStatusMessage(state.lastAttemptError, 'error');
        }

        addRow(knownDownloadRow);

        if (popular) {
            const popularFilename = popular.filename || missing.original_path?.split('/').pop()?.split('\\').pop() || '';
            const missingCategory = this.getMissingDownloadCategory?.(missing, 'checkpoints') || missing.category || 'checkpoints';
            const popularSize = popular.size
                || (
                    modelListResult
                    && modelListResult.filename
                    && modelListResult.filename.toLowerCase() === popularFilename.toLowerCase()
                        ? modelListResult.size
                        : ''
                );
            addRow({
                sourceKey: 'popular',
                sourceLabel: 'Popular',
                model: popular.name || popularFilename,
                filename: popularFilename,
                secondary: popular.name && popular.name !== popularFilename ? popularFilename : '',
                match: this.getSearchResultMatchDisplay(popular, 'Known', 'strong'),
                size: this.formatSearchResultSize({ ...popular, size: popularSize }),
                downloadUrl: popular.url,
                downloadFilename: popularFilename,
                category: popular.directory || missingCategory,
                openUrl: this.getModelCardUrl(popular.url),
                searchedAt: this.getSearchResultTimestamp(popular)
            });
        }

        if (modelListResult && modelListResult.url) {
            const missingCategory = this.getMissingDownloadCategory?.(missing, 'checkpoints') || missing.category || 'checkpoints';
            addRow({
                sourceKey: 'model-list',
                sourceLabel: 'Local Database',
                model: modelListResult.name || modelListResult.filename,
                filename: modelListResult.filename,
                secondary: modelListResult.name && modelListResult.name !== modelListResult.filename ? modelListResult.filename : '',
                match: this.getSearchResultMatchDisplay(modelListResult),
                size: this.formatSearchResultSize(modelListResult),
                downloadUrl: modelListResult.url,
                downloadFilename: modelListResult.filename,
                category: modelListResult.directory || missingCategory,
                openUrl: this.getModelCardUrl(modelListResult.url),
                searchedAt: this.getSearchResultTimestamp(modelListResult)
            });
        }

        if (hfResult && hfResult.url) {
            const hfRepo = hfResult.repo_id || hfResult.repo || '';
            const hfModelUrl = hfRepo ? `https://huggingface.co/${hfRepo}` : this.getModelCardUrl(hfResult.url);
            const missingCategory = this.getMissingDownloadCategory?.(missing, 'checkpoints') || missing.category || 'checkpoints';
            addRow({
                sourceKey: 'huggingface',
                sourceLabel: 'HuggingFace',
                model: hfRepo || hfResult.filename,
                filename: hfResult.filename,
                secondary: hfResult.path && hfResult.path !== hfResult.filename ? hfResult.path : '',
                match: this.getSearchResultMatchDisplay(hfResult),
                size: this.formatSearchResultSize(hfResult),
                downloadUrl: hfResult.url,
                downloadFilename: hfResult.filename,
                category: missingCategory,
                openUrl: hfModelUrl,
                searchedAt: this.getSearchResultTimestamp(hfResult)
            });
        }

        if (civarchiveResult && civarchiveResult.download_url) {
            const archiveFilename = civarchiveResult.filename || missing.original_path?.split('/').pop()?.split('\\').pop() || '';
            const archiveName = civarchiveResult.name || archiveFilename || 'Model';
            const archiveCategory = this.getSourceResultDownloadCategory?.(
                civarchiveResult,
                this.getMissingDownloadCategory?.(missing, 'checkpoints') || 'checkpoints',
                missing
            ) || this.getMissingDownloadCategory?.(missing, 'checkpoints') || 'checkpoints';
            const archiveSecondary = [
                archiveName && archiveName !== archiveFilename ? archiveFilename : '',
                civarchiveResult.platform || '',
                civarchiveResult.base_model || ''
            ].filter(Boolean).join(' / ');
            addRow({
                sourceKey: 'civarchive',
                sourceLabel: 'CivArchive',
                model: archiveName,
                version: civarchiveResult.version_name || '',
                filename: archiveFilename,
                secondary: archiveSecondary,
                match: this.getSearchResultMatchDisplay(civarchiveResult),
                size: this.formatSearchResultSize(civarchiveResult),
                downloadUrl: civarchiveResult.download_url,
                downloadFilename: archiveFilename,
                category: archiveCategory,
                openUrl: civarchiveResult.url,
                searchedAt: this.getSearchResultTimestamp(civarchiveResult),
                detailsContext: {
                    ...civarchiveResult,
                    details_source: 'civarchive',
                    missing_key: this.getMissingModelKey(missing),
                    category: archiveCategory
                }
            });
        }

        if (loraManagerArchiveResult && loraManagerArchiveResult.download_url) {
            const archiveFilename = loraManagerArchiveResult.filename || missing.original_path?.split('/').pop()?.split('\\').pop() || '';
            const archiveName = loraManagerArchiveResult.name || archiveFilename;
            const archiveCategory = this.getSourceResultDownloadCategory?.(
                loraManagerArchiveResult,
                this.getMissingDownloadCategory?.(missing, 'loras') || 'loras',
                missing
            ) || this.getMissingDownloadCategory?.(missing, 'loras') || 'loras';
            addRow({
                sourceKey: 'lora-archive',
                sourceLabel: 'LoRA Archive',
                model: archiveName,
                version: loraManagerArchiveResult.version_name || '',
                filename: archiveFilename,
                secondary: archiveName && archiveName !== archiveFilename ? archiveFilename : '',
                match: this.getSearchResultMatchDisplay(loraManagerArchiveResult),
                size: this.formatSearchResultSize(loraManagerArchiveResult),
                downloadUrl: loraManagerArchiveResult.download_url || '',
                downloadFilename: archiveFilename,
                category: archiveCategory,
                openUrl: loraManagerArchiveResult.url || this.getModelCardUrl(loraManagerArchiveResult.download_url),
                searchedAt: this.getSearchResultTimestamp(loraManagerArchiveResult),
                detailsContext: {
                    ...loraManagerArchiveResult,
                    source: 'lora_manager_archive',
                    details_source: 'lora_manager_archive',
                    missing_key: this.getMissingModelKey(missing),
                    category: archiveCategory
                }
            });
        }

        if (civitaiResult && civitaiResult.download_url) {
            const modelUrl = civitaiResult.url || (civitaiResult.model_id ? `https://civitai.com/models/${civitaiResult.model_id}${civitaiResult.version_id ? `?modelVersionId=${civitaiResult.version_id}` : ''}` : '');
            const downloadFilename = civitaiResult.filename || missing.civitai_info?.expected_filename || civitaiResult.name;
            const modelName = civitaiResult.name || missing.civitai_info?.model_name || downloadFilename || 'Model';
            const civitaiCategory = this.getSourceResultDownloadCategory?.(
                civitaiResult,
                this.getMissingDownloadCategory?.(missing, 'checkpoints') || 'checkpoints',
                missing
            ) || this.getMissingDownloadCategory?.(missing, 'checkpoints') || 'checkpoints';
            const civitaiSecondary = [
                civitaiResult.type || '',
                civitaiResult.base_model || missing.civitai_info?.base_model || ''
            ].filter(Boolean).join(' / ');
            addRow({
                sourceKey: 'civitai',
                sourceLabel: 'CivitAI',
                model: modelName,
                version: civitaiResult.version_name || missing.civitai_info?.version_name || '',
                filename: downloadFilename,
                secondary: civitaiSecondary,
                match: this.getSearchResultMatchDisplay(civitaiResult),
                size: this.formatSearchResultSize(civitaiResult),
                downloadUrl: civitaiResult.download_url,
                downloadFilename,
                category: civitaiCategory,
                openUrl: modelUrl,
                searchedAt: this.getSearchResultTimestamp(civitaiResult),
                detailsContext: {
                    ...civitaiResult,
                    name: modelName,
                    filename: downloadFilename,
                    details_source: 'civitai',
                    missing_key: this.getMissingModelKey(missing),
                    category: civitaiCategory
                }
            });
        }

        const html = `${progressHtml}${statusHtml}${this.renderSearchResultsTable(rows)}`;
        container.innerHTML = html;

        this.wireSearchProgressCancelButtons?.(container, missing, state);
        this.wireSearchDownloadButtons(container, missing);
    },

    /**
     * Download from search results
     */
    async downloadFromSearch(missing, url, filename, category, btn, pathMetadata = null, downloadMetadata = null) {
        const targetSelection = this.getDownloadTargetSelection(missing, category || missing.category || 'checkpoints');
        
        const resolvedPathMetadata = pathMetadata || this.getDownloadPathMetadata(missing, {
            filename,
            category: targetSelection.category
        });
        const resolvedDownloadMetadata = downloadMetadata && typeof downloadMetadata === 'object'
            ? { ...downloadMetadata }
            : this.getDownloadMetadata(missing, {
                filename,
                category: targetSelection.category,
                url,
                download_url: url
            }, {
                filename,
                category: targetSelection.category,
                url,
                pathMetadata: resolvedPathMetadata
            });
        resolvedDownloadMetadata.filename = filename;
        resolvedDownloadMetadata.category = targetSelection.category;
        resolvedDownloadMetadata.download_url = url;
        resolvedDownloadMetadata.source_url = url;
        resolvedDownloadMetadata.path_metadata = resolvedPathMetadata;

        await this.executeDownloadRequest(missing, {
            url,
            filename,
            category: targetSelection.category,
            subfolder: targetSelection.subfolder,
            baseDirectory: targetSelection.baseDirectory || '',
            pathMetadata: resolvedPathMetadata,
            downloadMetadata: resolvedDownloadMetadata,
            btn
        });
    },

    async fetchLocalMatches(filename, category = '', forceRescan = false) {
        return await this.fetchJson('/model_resolver/local-matches', {
            method: 'POST',
            body: JSON.stringify({
                filename,
                category: category || '',
                force_rescan: Boolean(forceRescan)
            })
        }, 'Fetch local matches');
    }
};
