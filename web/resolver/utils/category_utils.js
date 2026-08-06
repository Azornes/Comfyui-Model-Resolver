import { CATEGORY_ALIASES, normalizeCategoryToken } from './category_aliases.generated.js';

export function normalizeDownloadCategoryValue(
    category = '',
    aliases = CATEGORY_ALIASES,
) {
    const token = normalizeCategoryToken(category);
    const categoryAliases = aliases && typeof aliases === 'object'
        ? aliases
        : CATEGORY_ALIASES;
    return categoryAliases[token] || token || 'checkpoints';
}

export function collectNormalizedCategoryValues(
    values = [],
    normalizeCategory,
    { allowedCategories = null, excludedCategories = [] } = {},
) {
    const categories = [];
    const allowed = allowedCategories instanceof Set ? allowedCategories : null;
    const excluded = new Set(excludedCategories);
    const addCategory = (value) => {
        if (value === undefined || value === null || String(value).trim() === '') return;
        if (Array.isArray(value)) {
            value.forEach(addCategory);
            return;
        }
        String(value).split(/[,|;]/).forEach(part => {
            if (String(part || '').trim() === '') return;
            const normalized = normalizeCategory(part);
            if (
                !normalized
                || excluded.has(normalized)
                || (allowed && !allowed.has(normalized))
                || categories.includes(normalized)
            ) {
                return;
            }
            categories.push(normalized);
        });
    };

    values.forEach(addCategory);
    return categories;
}
