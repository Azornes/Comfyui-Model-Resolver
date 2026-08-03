import { normalizeSha256 } from '../utils/hash_utils.js';

export const modelHashCompareMethods = {
    normalizeSha256ForCompare(value = '') {
        return normalizeSha256(value);
    },

    formatSha256Short(value = '') {
        const hash = this.normalizeSha256ForCompare(value) || String(value || '').trim();
        if (hash.length <= 18) return hash;
        return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
    },

    collectHashCandidatesForCompare(value, source = 'metadata', seen = new Set(), depth = 0) {
        const candidates = [];
        if (value === undefined || value === null || depth > 5) return candidates;

        const addHash = (rawValue, hashSource = source) => {
            const hash = this.normalizeSha256ForCompare(rawValue);
            if (!hash || seen.has(hash)) return;
            seen.add(hash);
            candidates.push({ hash, source: hashSource || source || 'metadata' });
        };

        if (typeof value === 'string' || typeof value === 'number') {
            addHash(value);
            return candidates;
        }

        if (Array.isArray(value)) {
            value.forEach(item => {
                candidates.push(...this.collectHashCandidatesForCompare(item, source, seen, depth + 1));
            });
            return candidates;
        }

        if (typeof value !== 'object') return candidates;

        [
            ['local_match_sha256', 'local match'],
            ['sha256', source],
            ['hash', source],
            ['SHA256', source],
            ['file_hash', source],
            ['fileHash', source]
        ].forEach(([key, label]) => addHash(value[key], label));

        const hashes = value.hashes;
        if (Array.isArray(hashes)) {
            candidates.push(...this.collectHashCandidatesForCompare(hashes, source, seen, depth + 1));
        } else if (hashes && typeof hashes === 'object') {
            ['SHA256', 'sha256', 'hash'].forEach(key => addHash(hashes[key], source));
        }

        [
            ['file_info', value.file_info],
            ['file', value.file],
            ['selected_file', value.selected_file],
            ['path_metadata', value.path_metadata],
            ['download_metadata', value.download_metadata],
            ['metadata', value.metadata],
            ['selected_version', value.selected_version || value.selectedVersion],
            ['version', value.version],
            ['civitai', value.civitai]
        ].forEach(([key, nestedValue]) => {
            if (nestedValue !== undefined && nestedValue !== null) {
                candidates.push(...this.collectHashCandidatesForCompare(nestedValue, `${source} ${key}`, seen, depth + 1));
            }
        });

        ['files', 'mirrors', 'download_files', 'downloadFiles', 'modelVersions', 'versions'].forEach(key => {
            if (Array.isArray(value[key])) {
                candidates.push(...this.collectHashCandidatesForCompare(value[key], `${source} ${key}`, seen, depth + 1));
            }
        });

        return candidates;
    },

    getLocalHashCandidatesForCompare(model = {}) {
        const seen = new Set();
        return this.collectHashCandidatesForCompare(model, 'local model metadata', seen);
    },

    getLocalHashComparePath(model = {}) {
        return model?.open_path
            || model?.resolved_path
            || model?.path
            || model?.file_path
            || '';
    },

    getHashCompareFilename(model = {}) {
        return model.filename
            || model.name
            || this.getFilenameFromPath(this.getLocalHashComparePath(model))
            || 'Selected local model';
    },

    updateHashCompareModelMetadata(model = {}, result = {}) {
        const sha256 = this.normalizeSha256ForCompare(result?.sha256 || result?.hash || '');
        if (!sha256 || !model || typeof model !== 'object') return;

        model.sha256 = sha256;
        model.hash = sha256;
        if (!model.hashes || typeof model.hashes !== 'object' || Array.isArray(model.hashes)) {
            model.hashes = {};
        }
        model.hashes.SHA256 = sha256;
        if (result.metadata_path) {
            model.metadata_path = result.metadata_path;
        }
    },

    getHashCompareSourceLabel(sourceKey = '', result = {}) {
        const explicitLabel = result?.sourceLabel || result?.source_label || '';
        if (explicitLabel) return String(explicitLabel);

        const rawSource = String(result?.source || result?.details_source || sourceKey || '').toLowerCase().replace(/-/g, '_');
        const sourceLabels = {
            download_source: 'Selected source',
            popular: 'Popular',
            model_list: 'Local Database',
            huggingface: 'HuggingFace',
            civitai: 'CivitAI',
            civarchive: 'CivArchive',
            lora_manager_archive: 'LoRA Archive',
            lora_archive: 'LoRA Archive',
            workflow: 'Workflow',
            online: 'Online'
        };

        return sourceLabels[rawSource]
            || sourceLabels[String(sourceKey || '').toLowerCase().replace(/-/g, '_')]
            || String(sourceKey || 'Source').replace(/[_-]+/g, ' ');
    },

    getHashCompareResultName(result = {}) {
        const primary = result?.name
            || result?.model_name
            || result?.modelName
            || result?.repo_id
            || result?.repo
            || result?.filename
            || result?.path
            || result?.model_url
            || result?.url
            || 'Model';
        const version = result?.version_name || result?.versionName || result?.version || '';
        const display = this.getVersionedModelName?.(String(primary), String(version || ''))
            || String(primary);
        return this.truncateText?.(display, 96) || display;
    },

    getHashCompareResultUrl(result = {}) {
        return String(
            result?.version_url
            || result?.model_url
            || result?.platform_url
            || result?.source_url
            || result?.openUrl
            || result?.url
            || result?.download_url
            || ''
        ).trim();
    },

    dedupeHashCompareMatches(matches = []) {
        const seen = new Set();
        const unique = [];
        matches.forEach(match => {
            if (!match) return;
            const key = [
                match.sourceLabel || match.sourceKey || '',
                match.name || '',
                match.url || '',
                match.sha256 || ''
            ].map(value => String(value || '').toLowerCase()).join('::');
            if (seen.has(key)) return;
            seen.add(key);
            unique.push(match);
        });
        return unique;
    },

    getHashCompareLocalMatchIdentity(model = {}) {
        const explicitIdentity = String(model?.local_match_identity || '').trim();
        if (explicitIdentity) return explicitIdentity;

        return this.getLocalMatchIdentity?.({ model }) || '';
    },
};
