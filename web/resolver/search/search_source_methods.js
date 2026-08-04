import { safeStorage } from "../utils/html_utils.js";
import { getSourceDisplayLabel } from "../utils/source_labels.js";

const localStorage = safeStorage;

export const searchSourceMethods = {
    getSearchResultKeysForSources(sources = []) {
        const normalized = new Set((Array.isArray(sources) ? sources : [sources])
            .map(source => String(source || '').trim())
            .filter(Boolean));
        if (normalized.has('all')) {
            return ['popular', 'model_list', 'huggingface', 'civitai', 'civarchive', 'lora_manager_archive'];
        }

        const keys = new Set();
        for (const source of normalized) {
            if (source === 'local') {
                keys.add('popular');
                keys.add('model_list');
            } else if (source) {
                keys.add(source);
            }
        }
        return Array.from(keys);
    },

    getHashLookupSourcesForSearchSources(sources = []) {
        const normalized = new Set((Array.isArray(sources) ? sources : [sources])
            .map(source => String(source || '').trim())
            .filter(Boolean));
        const hashSources = ['huggingface', 'civitai', 'civarchive'];
        if (normalized.has('all')) return new Set(hashSources);
        return new Set(hashSources.filter(source => normalized.has(source)));
    },

    clearSearchResultsForSources(results = {}, sources = []) {
        const nextResults = {
            popular: results.popular || null,
            model_list: results.model_list || null,
            huggingface: results.huggingface || null,
            civitai: results.civitai || null,
            civarchive: results.civarchive || null,
            lora_manager_archive: results.lora_manager_archive || null,
            custom: Array.isArray(results.custom) ? results.custom : [],
            local_hash_matches: Array.isArray(results.local_hash_matches) ? results.local_hash_matches : []
        };
        for (const key of this.getSearchResultKeysForSources(sources)) {
            if (key in nextResults) nextResults[key] = null;
        }

        const hashSourcesToClear = this.getHashLookupSourcesForSearchSources(sources);
        if (hashSourcesToClear.size) {
            nextResults.local_hash_matches = nextResults.local_hash_matches.filter(match => {
                const source = String(match?.hash_lookup_source || '').trim();
                return source && !hashSourcesToClear.has(source);
            });
        }
        return nextResults;
    },

    /**
     * Convert source ids to readable labels
     */
    getSearchSourceLabel(source) {
        return getSourceDisplayLabel(source, {
            context: 'search',
            normalize: false,
            fallback: source,
        });
    },

    getSearchSourceErrorMessage(source, error, status = null) {
        if (status && typeof status.message === 'string' && status.message.trim()) {
            return status.message.trim();
        }

        const message = String(error || '').trim();
        const normalizedSource = String(source || '').trim().toLowerCase().replace(/-/g, '_');
        const statusCode = String(status?.code || '').trim().toLowerCase();
        if (normalizedSource === 'civarchive') {
            const messagesByCode = {
                timeout: 'CivArchive did not respond in time. It may be temporarily overloaded. Please try again.',
                network_error: 'CivArchive could not be reached. It may be temporarily unavailable. Please try again.',
                provider_unavailable: 'CivArchive may be overloaded or temporarily unavailable. Please try again.',
                rate_limited: 'CivArchive rate limit was reached. Please try again later.',
                not_found: 'CivArchive did not find a matching page.',
                provider_rejected: 'CivArchive rejected the search request.'
            };
            if (messagesByCode[statusCode]) return messagesByCode[statusCode];
        }

        if (!message) {
            return `${this.getSearchSourceLabel(source)} search failed.`;
        }

        const indicatesTemporaryUnavailable = (
            /network error|timeout|timed out|connection (?:error|reset|refused)|temporarily unavailable/i.test(message)
            || /\bHTTP\s+(?:429|5\d{2})\b/i.test(message)
        );

        if (normalizedSource === 'civarchive' && indicatesTemporaryUnavailable) {
            return 'CivArchive may be overloaded or temporarily unavailable. Please try again.';
        }

        return message;
    },

    getSearchSourceErrorTooltip(source, error, status = null) {
        const technicalMessage = String(error || '').trim();
        const displayMessage = this.getSearchSourceErrorMessage(source, technicalMessage, status);
        const statusDetails = status?.http_status ? `HTTP ${status.http_status}` : '';
        const details = statusDetails || technicalMessage;
        if (!details || details === displayMessage) return displayMessage;
        return `${displayMessage} Details: ${details}`;
    },

    isSearchSourceRetryable(source, error = '', status = null) {
        if (typeof status?.retryable === 'boolean') return status.retryable;
        const normalizedSource = String(source || '').trim().toLowerCase().replace(/-/g, '_');
        if (normalizedSource !== 'civarchive') return false;
        return /network error|timeout|timed out|connection (?:error|reset|refused)|temporarily unavailable|\bHTTP\s+(?:408|429|5\d{2})\b/i.test(String(error || ''));
    },

    getSearchSourceDefinitions() {
        return [
            {
                source: 'local',
                storageKey: 'ModelResolver.searchSource.localEnabled',
                tooltip: 'Searches bundled known-model data before online providers.'
            },
            {
                source: 'huggingface',
                storageKey: 'ModelResolver.searchSource.huggingFaceEnabled',
                tooltip: 'Searches Hugging Face when Everything is selected.'
            },
            {
                source: 'civitai',
                storageKey: 'ModelResolver.searchSource.civitaiEnabled',
                tooltip: 'Searches CivitAI when Everything is selected.'
            },
            {
                source: 'civarchive',
                storageKey: 'ModelResolver.searchSource.civArchiveEnabled',
                tooltip: 'Searches CivArchive when Everything is selected.'
            },
            {
                source: 'lora_manager_archive',
                storageKey: 'ModelResolver.searchSource.loraManagerArchiveEnabled',
                tooltip: 'Searches the local LoRA Manager archive when Everything is selected.'
            }
        ];
    },

    getSearchSourceDefinition(source) {
        return this.getSearchSourceDefinitions().find(def => def.source === source) || null;
    },

    isSearchSourceEnabled(source) {
        if (!source || source === 'all') return true;
        const definition = this.getSearchSourceDefinition(source);
        if (!definition) return true;
        return localStorage.getItem(definition.storageKey) !== 'false';
    },

    isSearchSourceUsable(source) {
        return this.isSourceAvailable(source) && this.isSearchSourceEnabled(source);
    },

    getEnabledSearchSources() {
        const sources = this.getSearchSourceDefinitions()
            .filter(def => this.isSearchSourceUsable(def.source))
            .map(def => def.source);
        return sources.length ? sources : ['local'];
    },

    getSearchSourceEnabledMap() {
        return this.getSearchSourceDefinitions().reduce((enabled, def) => {
            enabled[def.source] = this.isSearchSourceEnabled(def.source);
            return enabled;
        }, {});
    },

    getSearchSourcesForSelection(selectedSource, _missing = {}) {
        if (selectedSource !== 'all') {
            return this.isSearchSourceUsable(selectedSource) ? [selectedSource] : [];
        }

        return this.getEnabledSearchSources();
    },
};
