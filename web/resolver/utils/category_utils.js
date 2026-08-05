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
