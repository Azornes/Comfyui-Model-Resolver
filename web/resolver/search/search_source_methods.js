import { safeStorage } from "../utils/html_utils.js";

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
        const labels = {
            all: 'Everything',
            local: 'Local Database',
            huggingface: 'HuggingFace',
            civitai: 'CivitAI',
            civarchive: 'CivArchive',
            lora_manager_archive: 'LoRA Manager Archive',
            custom: 'Custom URL'
        };
        return labels[source] || source;
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
