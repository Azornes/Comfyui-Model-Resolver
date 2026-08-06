import { normalizeSearchToken } from '../utils/search_utils.js';

export const baseModelAliasMethods = {
    getBaseModelAliases() {
        const baseModelsList = this.baseModels?.base_models;
        if (Array.isArray(baseModelsList) && baseModelsList.length > 0) {
            return baseModelsList.map(m => ({ value: m.name, aliases: m.aliases || [] }));
        }
        // Fallback to hardcoded list
        return [
            { value: 'Z-Image', aliases: ['zimage', 'z image', 'z-image', 'z_image', 'zImageTurbo', 'z image turbo'] },
            { value: 'Pony', aliases: ['pony', 'ponyxl', 'pony diffusion', 'pony realism'] },
            { value: 'Illustrious', aliases: ['illustrious', 'illustriousxl', 'illustrious xl'] },
            { value: 'SDXL 1.0', aliases: ['sdxl', 'sdxl10', 'sdxl 1.0', 'stable diffusion xl'] },
            { value: 'SD 1.5', aliases: ['sd15', 'sd 1.5', 'sd1.5', 'stable diffusion 1.5'] },
            { value: 'Flux.1 D', aliases: ['flux', 'flux1', 'flux.1', 'flux dev', 'flux.1 d', 'flux1d'] },
            { value: 'Flux.1 S', aliases: ['flux schnell', 'flux.1 s', 'flux1s'] },
            { value: 'Qwen Image', aliases: ['qwen image', 'qwenimage', 'qwen-image'] },
            { value: 'Hunyuan 1', aliases: ['hunyuan', 'hunyuan1'] },
            { value: 'WAN Video', aliases: ['wan', 'wan video', 'wanvideo'] },
            { value: 'NoobAI', aliases: ['noobai', 'noob ai'] },
            { value: 'HiDream', aliases: ['hidream', 'hi dream'] }
        ];
    },

    normalizeBaseModelToken(value = '') {
        return normalizeSearchToken(value);
    },

    getBaseModelTokenVariants(value = '') {
        const text = String(value || '').trim();
        if (!text) return new Set();
        const variants = [
            text,
            text.replace(/(\d+)(?:[\s._-]+0)+(?!\d)/g, '$1')
        ];
        const normalized = this.normalizeBaseModelToken(text);
        if (normalized.startsWith('flux1') && normalized.length > 'flux1'.length) {
            variants.push(`flux${normalized.slice('flux1'.length)}`);
        }
        return new Set(
            variants
                .map(item => this.normalizeBaseModelToken(item))
                .filter(Boolean)
        );
    },

    resolveBaseModelAliasExact(value = '') {
        const tokens = this.getBaseModelTokenVariants(value);
        if (!tokens.size) return '';
        for (const entry of this.getBaseModelAliases()) {
            const aliases = [entry.value, ...(entry.aliases || [])];
            if (aliases.some(alias => {
                const aliasTokens = this.getBaseModelTokenVariants(alias);
                return [...aliasTokens].some(aliasToken => tokens.has(aliasToken));
            })) {
                return entry.value;
            }
        }
        return '';
    },

    resolveBaseModelAlias(value = '') {
        const tokens = this.getBaseModelTokenVariants(value);
        if (!tokens.size) return '';
        const exact = this.resolveBaseModelAliasExact(value);
        if (exact) return exact;

        for (const entry of this.getBaseModelAliases()) {
            const aliases = [entry.value, ...(entry.aliases || [])];
            if (aliases.some(alias => {
                const aliasTokens = this.getBaseModelTokenVariants(alias);
                return [...aliasTokens].some(aliasToken => (
                    aliasToken && [...tokens].some(token => (
                        aliasToken.includes(token) || token.includes(aliasToken)
                    ))
                ));
            })) {
                return entry.value;
            }
        }
        return '';
    },

    resolveBaseModelAliasFromPath(path = '') {
        const text = String(path || '').trim();
        if (!text) return '';

        const parts = text
            .split(/[\\/]+/)
            .map(part => part.trim())
            .filter(Boolean);
        const directoryParts = parts.filter(part => !this.hasModelExtension(part));

        for (const part of directoryParts) {
            const exact = this.resolveBaseModelAliasExact(part);
            if (exact) return exact;
        }

        return '';
    },
};
