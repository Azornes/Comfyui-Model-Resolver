import { normalizeSha256 } from '../utils/hash_utils.js';

export const searchHashMethods = {
    normalizeSearchResultSha256(value = '') {
        return normalizeSha256(value);
    },

    getSearchResultSha256(result = {}) {
        if (!result || typeof result !== 'object') return '';

        const hashes = result.hashes && typeof result.hashes === 'object' ? result.hashes : {};
        const fileInfo = result.file_info && typeof result.file_info === 'object' ? result.file_info : {};
        const fileHashes = fileInfo.hashes && typeof fileInfo.hashes === 'object' ? fileInfo.hashes : {};
        const candidates = [
            result.hash_verified_sha256,
            result.sha256,
            result.hash,
            hashes.SHA256,
            hashes.sha256,
            fileInfo.sha256,
            fileInfo.hash,
            fileHashes.SHA256,
            fileHashes.sha256
        ];

        for (const candidate of candidates) {
            const hash = this.normalizeSearchResultSha256(candidate);
            if (hash) return hash;
        }
        return '';
    },

    collectHashLabelMapHashes(missing = {}, results = null) {
        const hashes = [];
        const seen = new Set();
        const addHash = (value) => {
            const hash = this.normalizeSearchResultSha256?.(value)
                || String(value || '').trim().toLowerCase();
            if (!hash || !/^[a-f0-9]{64}$/.test(hash) || seen.has(hash)) return;
            seen.add(hash);
            hashes.push(hash);
        };
        const addMatch = (match) => {
            if (!match || typeof match !== 'object') return;
            if (!(match.hash_match || match.match_type === 'hash' || match.hash_lookup_source)) return;
            addHash(this.getLocalMatchHash?.(match) || match.sha256 || match.hash);
        };
        const addResult = (result) => {
            if (Array.isArray(result)) {
                result.forEach(addResult);
                return;
            }
            if (!result || typeof result !== 'object') return;
            const matchType = String(result.match_type || '').toLowerCase();
            if (!(result.hash_verified || result.hash_verified_sha256 || matchType === 'hash')) return;
            addHash(this.getSearchResultSha256?.(result) || result.sha256 || result.hash);
        };

        (Array.isArray(missing.matches) ? missing.matches : []).forEach(addMatch);

        const stateResults = results
            || this.getSearchState?.(missing)?.results
            || this.searchResultCache?.get?.(this.getMissingSearchKey?.(missing))?.results
            || {};
        (Array.isArray(stateResults.local_hash_matches) ? stateResults.local_hash_matches : []).forEach(addMatch);

        [
            missing.download_source,
            stateResults.popular,
            stateResults.model_list,
            stateResults.huggingface,
            stateResults.civitai,
            stateResults.civarchive,
            stateResults.lora_manager_archive,
            ...(Array.isArray(stateResults.custom) ? stateResults.custom : [])
        ].forEach(addResult);

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

    normalizeHashLookupSourceKey(source = '') {
        return String(source || '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_');
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

        const normalizedSource = this.normalizeHashLookupSourceKey(sourceKey);
        const sourceHash = this.getSearchResultSha256(sourceResult);
        if (!Array.isArray(hashMatches) || !hashMatches.length || !normalizedSource) {
            return identities;
        }

        hashMatches.forEach(match => {
            if (!match || typeof match !== 'object') return;

            const matchSource = this.normalizeHashLookupSourceKey(match.hash_lookup_source || '');
            const matchHash = this.normalizeSearchResultSha256(this.getLocalMatchHash(match));
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
        const hashes = model.hashes && typeof model.hashes === 'object' ? model.hashes : {};
        return String(
            match.sha256
            || match.hash
            || model.sha256
            || model.hash
            || hashes.SHA256
            || hashes.sha256
            || ''
        ).trim();
    },
};
