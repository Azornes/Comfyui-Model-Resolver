export const missingModelStateMethods = {
    getBestLocalMatch(missing = {}, minConfidence = 0) {
        const matches = Array.isArray(missing.matches) ? missing.matches : [];
        return matches
            .filter(match => Number(match.confidence) >= minConfidence)
            .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0] || null;
    },

    getMissingModelSummaryStats(missingModels = []) {
        return missingModels.reduce((stats, missing) => {
            const best = this.getBestLocalMatch(missing, 70);
            if (best?.confidence === 100) {
                stats.exact += 1;
            } else if (best) {
                stats.partial += 1;
            } else {
                stats.none += 1;
            }
            return stats;
        }, { exact: 0, partial: 0, none: 0 });
    },

    getMissingSourceStatus(missing = {}, source = '') {
        const state = this.searchResultCache.get(this.getMissingSearchKey(missing));
        const progress = state?.sourceProgress?.[source];
        const resultStatus = this.getMissingSourceResultStatus(missing, source, state);
        if (progress?.status === 'found') return resultStatus || 'found';
        if (progress?.status) return progress.status;

        if (resultStatus) return resultStatus;

        return 'idle';
    },

    hasMissingSourceSearchAttempt(missing = {}, source = '', state = null) {
        const searchState = state || this.searchResultCache?.get(this.getMissingSearchKey(missing));
        const explicitSources = new Set(
            Array.isArray(searchState?.explicitSearchSources) ? searchState.explicitSearchSources : []
        );
        return explicitSources.has(source) || explicitSources.has('all');
    },

    isLocalDatabaseDownloadSource(downloadSource = {}) {
        const source = String(downloadSource?.source || '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_');
        return source === 'local' || source === 'model_list' || source === 'popular';
    },

    shouldDisplayKnownDownloadSource(missing = {}, downloadSource = {}, state = null) {
        if (!downloadSource?.url) return false;
        if (!this.isLocalDatabaseDownloadSource(downloadSource)) return true;
        return this.hasMissingSourceSearchAttempt(missing, 'local', state);
    },

    getMissingSourceResultStatus(missing = {}, source = '', state = null) {
        const results = state?.results || {};
        const candidates = [];

        if (source === 'local') {
            if (!this.hasMissingSourceSearchAttempt(missing, source, state)) return '';

            candidates.push(results.model_list, results.popular);
        } else if (source === 'huggingface') {
            candidates.push(results.huggingface);
        } else if (source === 'civitai') {
            candidates.push(results.civitai);
        } else if (source === 'civarchive') {
            candidates.push(results.civarchive);
        } else if (source === 'lora_manager_archive') {
            candidates.push(results.lora_manager_archive);
        }

        if (['huggingface', 'civitai', 'civarchive'].includes(source)) {
            const customResults = Array.isArray(results.custom) ? results.custom : [];
            customResults
                .filter(result => String(result?.source || '').toLowerCase().replace(/-/g, '_') === source)
                .forEach(result => candidates.push(result));
        }

        const downloadSource = missing.download_source || {};
        const mappedDownloadSource = {
            model_list: 'local',
            popular: 'local',
            workflow: 'civitai'
        }[downloadSource.source] || downloadSource.source;
        if (mappedDownloadSource === source && downloadSource.url) {
            candidates.push(downloadSource);
        }

        return this.getSearchResultStatusLevel(candidates);
    },

    getSearchResultStatusLevel(resultOrResults) {
        const results = Array.isArray(resultOrResults)
            ? resultOrResults.flatMap(result => Array.isArray(result) ? result : [result])
            : [resultOrResults];
        let hasPartial = false;
        let hasUnknownFound = false;

        for (const result of results) {
            if (!result) continue;

            const confidence = Number(result.confidence);
            const hasConfidence = Number.isFinite(confidence);
            const matchType = String(result.match_type || '').toLowerCase();

            if (hasConfidence) {
                if (confidence >= 100) return 'exact';
                if (confidence > 0) {
                    hasPartial = true;
                    continue;
                }
            }

            if (matchType === 'exact' || result.source === 'popular') {
                return 'exact';
            }
            if (matchType === 'partial' || matchType === 'fuzzy' || matchType === 'similar') {
                hasPartial = true;
                continue;
            }
            if (result.url || result.download_url) {
                hasUnknownFound = true;
            }
        }

        if (hasPartial) return 'partial';
        if (hasUnknownFound) return 'found';
        return '';
    },

    hasRenderableSearchState(state = {}) {
        return Boolean(
            (state.lastAttemptSources || []).length
            || Object.keys(state.sourceProgress || {}).length
            || this.hasSearchResults(state.results || {})
            || state.lastAttemptError
        );
    },

    isMissingModelResolved(missing = {}) {
        if (!missing) return false;
        return Boolean(missing.__isExistingResolved);
    },

    isAutoDownloadModel(missing = {}) {
        return Boolean(missing?.auto_download_capable || missing?.auto_download_candidate);
    },

    getResolvedMissingCount(missingModels = []) {
        return missingModels.reduce((count, missing) => (
            count + (this.isMissingModelResolved(missing) ? 1 : 0)
        ), 0);
    },
};
