import {
    firstValidSha256,
    getSha256Candidates,
    getSha256Field,
    normalizeSha256,
} from '../utils/hash_utils.js';
import { normalizeSourceKey } from '../utils/source_labels.js';

export const searchHashMethods = {
    getSearchResultSha256(result = {}) {
        if (!result || typeof result !== 'object') return '';

        const fileInfo = result.file_info && typeof result.file_info === 'object' ? result.file_info : {};
        return firstValidSha256(
            result.hash_verified_sha256,
            ...getSha256Candidates(result),
            ...getSha256Candidates(fileInfo),
        );
    },

    collectHashLabelMapHashes(missing = {}, results = null) {
        const hashes = [];
        const seen = new Set();
        const addHash = (value) => {
            const hash = normalizeSha256(value);
            if (!hash || !/^[a-f0-9]{64}$/.test(hash) || seen.has(hash)) return;
            seen.add(hash);
            hashes.push(hash);
        };
        const addMatch = (match) => {
            if (!match || typeof match !== 'object') return;
            if (!(match.hash_match || match.match_type === 'hash' || match.hash_lookup_source)) return;
            addHash(this.getLocalMatchHash?.(match) || match.sha256 || match.hash);
        };
        const addResult = (result, sourceKey = '') => {
            if (Array.isArray(result)) {
                result.forEach(r => addResult(r, sourceKey));
                return;
            }
            if (!result || typeof result !== 'object') return;
            if (sourceKey && removedRowKeys.size > 0) {
                const rowKey = `${sourceKey}:${result.download_url || result.downloadUrl || result.url || result.openUrl || `${result.name || result.model}:${result.filename}`}`;
                if (removedRowKeys.has(rowKey)) return;
            }
            const matchType = String(result.match_type || '').toLowerCase();
            if (!(result.hash_verified || result.hash_verified_sha256 || matchType === 'hash')) return;
            addHash(this.getSearchResultSha256?.(result) || result.sha256 || result.hash);
        };

        const workflowKey = this.getWorkflowScopedQueueKey?.();
        const searchState = results
            ? null
            : (
                (workflowKey ? this.getSearchStateForWorkflow?.(workflowKey, missing) : null)
                || this.getSearchState?.(missing)
                || this.searchResultCache?.get?.(this.getMissingSearchKey?.(missing))
            );
        const removedRowKeys = new Set(searchState?.removedSearchResultKeys || []);
        const stateResults = results || searchState?.results || {};

        (Array.isArray(missing.matches) ? missing.matches : []).forEach(addMatch);
        (Array.isArray(stateResults.local_hash_matches) ? stateResults.local_hash_matches : []).forEach(addMatch);

        addResult(missing.download_source, missing.download_source?.source || 'workflow');
        addResult(stateResults.popular, 'popular');
        addResult(stateResults.model_list, 'model-list');
        addResult(stateResults.huggingface, 'huggingface');
        addResult(stateResults.civitai, 'civitai');
        addResult(stateResults.civarchive, 'civarchive');
        addResult(stateResults.lora_manager_archive, 'lora-archive');
        (Array.isArray(stateResults.custom) ? stateResults.custom : []).forEach(r => addResult(r, r?.source || 'custom'));

        return hashes;
    },

    getHashMatchLabelMap(missing = {}, results = null) {
        const hashes = this.collectHashLabelMapHashes?.(missing, results) || [];
        const labelMap = new Map();
        if (!hashes.length) return labelMap;

        const useNumbers = hashes.length > 1;
        hashes.forEach((hash, index) => {
            labelMap.set(hash, useNumbers ? `Hash ${index + 1}` : 'Hash');
        });
        return labelMap;
    },

    getHashMatchLabelForSearchResult(result = {}, hashLabelMap = null, identities = []) {
        const hash = this.getSearchResultSha256?.(result) || '';
        const label = hash && hashLabelMap?.get?.(hash) ? hashLabelMap.get(hash) : '';
        if (!label) return '';

        const matchType = String(result.match_type || '').toLowerCase();
        const hasLinkedLocalMatch = Array.isArray(identities) && identities.length > 0;
        return (hasLinkedLocalMatch || result.hash_verified || result.hash_verified_sha256 || matchType === 'hash')
            ? label
            : '';
    },

    getLocalHashMatchIdentitiesForResult(hashMatches = [], sourceKey = '', sourceResult = {}) {
        const identities = [];
        const seen = new Set();
        const addIdentity = (identity) => {
            const normalized = String(identity || '').trim();
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            identities.push(normalized);
        };

        if (Array.isArray(sourceResult?.hash_verified_local_match_identities)) {
            sourceResult.hash_verified_local_match_identities.forEach(addIdentity);
        }

        const normalizedSource = normalizeSourceKey(sourceKey);
        const sourceHash = this.getSearchResultSha256(sourceResult);
        if (!Array.isArray(hashMatches) || !hashMatches.length || !normalizedSource) {
            return identities;
        }

        hashMatches.forEach(match => {
            if (!match || typeof match !== 'object') return;

            const matchSource = normalizeSourceKey(match.hash_lookup_source || '');
            const matchHash = normalizeSha256(this.getLocalMatchHash(match));
            if (sourceHash) {
                if (matchHash !== sourceHash) return;
            } else if (!matchSource || matchSource !== normalizedSource) {
                return;
            }

            addIdentity(this.getLocalMatchIdentity?.(match) || '');
        });

        return identities;
    },

    getLocalMatchHash(match = {}) {
        const model = match.model || {};
        const modelHash = getSha256Field(model);
        return String(
            match.sha256
            || match.hash
            || match.hash_lookup_sha256
            || modelHash
            || ''
        ).trim();
    },
};
