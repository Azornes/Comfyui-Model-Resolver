export const searchStateMethods = {
    /**
     * Build stable cache key for a missing model entry
     */
    getMissingSearchKey(missing) {
        if (missing?.missing_search_key) {
            return String(missing.missing_search_key);
        }
        if (missing?.search_key) {
            return String(missing.search_key);
        }
        return this.getMissingModelKey(missing);
    },

    /**
     * Get or initialize search state for a missing model entry
     */
    getSearchState(missing) {
        const key = this.getMissingSearchKey(missing);
        if (!this.searchResultCache.has(key)) {
            this.searchResultCache.set(key, this.createEmptySearchState());
        }
        return this.searchResultCache.get(key);
    },

    createEmptySearchState() {
        return {
            selectedSource: 'all',
            selectedBaseModel: this.getDefaultSearchBaseModel(),
            results: {
                popular: null,
                model_list: null,
                huggingface: null,
                civitai: null,
                civarchive: null,
                lora_manager_archive: null,
                custom: [],
                local_hash_matches: []
            },
            explicitSearchSources: [],
            lastAttemptSources: [],
            lastAttemptBaseModelContext: '',
            lastAttemptFound: null,
            lastAttemptError: null,
            sourceProgress: {},
            activeSearchRunId: null
        };
    },

    getBackgroundSearchJobKey(workflowKey, missingSearchKey) {
        return `${workflowKey || 'workflow'}\n${missingSearchKey || 'missing'}`;
    },

    getBackgroundSearchJob(workflowKey, missingSearchKey) {
        return this.backgroundSearchJobs?.get(
            this.getBackgroundSearchJobKey(workflowKey, missingSearchKey)
        ) || null;
    },

    hasBackgroundSearchJob(workflowKey, missingSearchKey, runId = null) {
        const job = this.getBackgroundSearchJob(workflowKey, missingSearchKey);
        if (!job) return false;
        return !runId || job.runId === runId;
    },

    isBackgroundSearchRunActive(workflowKey, missingSearchKey, runId) {
        return this.hasBackgroundSearchJob(workflowKey, missingSearchKey, runId);
    },

    isSearchSourceCancelled(workflowKey, missingSearchKey, runId, source) {
        const job = this.getBackgroundSearchJob(workflowKey, missingSearchKey);
        return Boolean(job?.runId === runId && job.cancelledSources?.has(source));
    },

    getWorkflowSearchCache(workflowKey, { create = false } = {}) {
        if (!workflowKey) return null;
        let cache = this.workflowSearchResultCaches.get(workflowKey);
        if (!cache && create) {
            cache = new Map();
            this.workflowSearchResultCaches.set(workflowKey, cache);
        }
        return cache || null;
    },

    getSearchStateForWorkflow(workflowKey, missing) {
        if (!workflowKey || workflowKey === this.getWorkflowScopedQueueKey()) {
            return this.getSearchState(missing);
        }

        const missingSearchKey = this.getMissingSearchKey(missing);
        const cache = this.getWorkflowSearchCache(workflowKey, { create: true });
        if (!cache.has(missingSearchKey)) {
            cache.set(missingSearchKey, this.createEmptySearchState());
        }
        return cache.get(missingSearchKey);
    },

    persistSearchStateForWorkflow(workflowKey, missing, state) {
        const missingSearchKey = this.getMissingSearchKey(missing);
        if (!workflowKey || !missingSearchKey || !state) return;

        const cache = this.getWorkflowSearchCache(workflowKey, { create: true });
        cache.set(
            missingSearchKey,
            this.cloneSearchState(state, {
                preserveActive: this.hasBackgroundSearchJob(
                    workflowKey,
                    missingSearchKey,
                    state.activeSearchRunId
                )
            })
        );

        if (workflowKey === this.getWorkflowScopedQueueKey()) {
            this.searchResultCache.set(missingSearchKey, state);
            return;
        }

        const activeWorkflowKey = this.getWorkflowScopedQueueKey();
        const activeState = this.searchResultCache?.get(missingSearchKey);
        const runId = state.activeSearchRunId || activeState?.activeSearchRunId;
        const mirrorsActiveSearch = Boolean(
            activeState === state
            || (
                runId
                && activeState?.activeSearchRunId === runId
                && this.hasBackgroundSearchJob(activeWorkflowKey, missingSearchKey, runId)
            )
        );
        if (mirrorsActiveSearch) {
            this.searchResultCache.set(missingSearchKey, state);
            this.saveSearchCacheForActiveWorkflow?.();
        }
    },

    /**
     * Merge new search results into cached per-source results.
     * Empty normal responses do not delete previous results; forced refreshes do.
     */
    mergeSearchResults(existingResults = {}, newResults = {}, { searchedAt = null, forceRefresh = false } = {}) {
        const searchedSources = new Set(Array.isArray(newResults.searched_sources) ? newResults.searched_sources : []);
        const pickResult = (source) => {
            if (newResults[source]) {
                const existingTimestamp = this.getSearchResultTimestamp(existingResults[source]);
                const resultTimestamp = !forceRefresh && this.areSearchResultsSame(existingResults[source], newResults[source])
                    ? existingTimestamp
                    : null;
                return this.withSearchResultTimestamp(
                    newResults[source],
                    resultTimestamp || searchedAt
                );
            }
            const sourceWasSearched = searchedSources.has(source)
                || (searchedSources.has('local') && (source === 'popular' || source === 'model_list'));
            if (forceRefresh && sourceWasSearched) {
                return null;
            }
            return existingResults[source] || null;
        };
        const hashSourcesToClear = forceRefresh
            ? this.getHashLookupSourcesForSearchSources(Array.from(searchedSources))
            : new Set();
        const existingHashMatches = Array.isArray(existingResults.local_hash_matches)
            ? existingResults.local_hash_matches.filter(match => {
                if (!hashSourcesToClear.size) return true;
                const source = String(match?.hash_lookup_source || '').trim();
                return source && !hashSourcesToClear.has(source);
            })
            : [];
        const localHashMatches = this.mergeLocalMatches
            ? this.mergeLocalMatches(
                existingHashMatches,
                Array.isArray(newResults.local_hash_matches) ? newResults.local_hash_matches : []
            )
            : [
                ...existingHashMatches,
                ...(Array.isArray(newResults.local_hash_matches) ? newResults.local_hash_matches : [])
            ];

        return {
            popular: pickResult('popular'),
            model_list: pickResult('model_list'),
            huggingface: pickResult('huggingface'),
            civitai: pickResult('civitai'),
            civarchive: pickResult('civarchive'),
            lora_manager_archive: pickResult('lora_manager_archive'),
            custom: Array.isArray(newResults.custom)
                ? newResults.custom
                : (Array.isArray(existingResults.custom) ? existingResults.custom : []),
            local_hash_matches: localHashMatches
        };
    },

    getSearchResultSignature(result) {
        if (Array.isArray(result)) {
            return result.map(item => this.getSearchResultSignature(item)).join('|');
        }
        if (!result || typeof result !== 'object') return '';

        return [
            result.download_url || result.url || result.model_url || '',
            result.filename || result.path || '',
            result.repo_id || result.repo || '',
            result.model_id || '',
            result.version_id || '',
            result.name || ''
        ].map(value => String(value || '').trim()).join('::');
    },

    areSearchResultsSame(previousResult, nextResult) {
        const previousSignature = this.getSearchResultSignature(previousResult);
        const nextSignature = this.getSearchResultSignature(nextResult);
        return Boolean(previousSignature && nextSignature && previousSignature === nextSignature);
    },

    withSearchResultTimestamp(result, searchedAt = null) {
        if (!result || !searchedAt) return result;
        if (Array.isArray(result)) {
            return result.map(item => this.withSearchResultTimestamp(item, searchedAt));
        }
        if (typeof result !== 'object') return result;
        return {
            ...result,
            searchedAt: result.searchedAt || result.searched_at || searchedAt
        };
    },
};
