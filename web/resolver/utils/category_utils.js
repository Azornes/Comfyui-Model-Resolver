import { CATEGORY_ALIASES } from './category_aliases.generated.js';

function normalizeCategoryToken(category) {
    return String(category || '')
        .trim()
        .toLowerCase()
        .replace(/[/\\\s-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

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
