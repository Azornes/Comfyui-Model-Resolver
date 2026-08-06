export function normalizeSearchToken(value = '') {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

export function matchesSearchText(value = '', query = '') {
    const filter = String(query || '').trim().toLowerCase();
    if (!filter) return true;

    const searchText = String(value || '').toLowerCase();
    const normalizedFilter = normalizeSearchToken(filter);
    return searchText.includes(filter)
        || Boolean(
            normalizedFilter
            && normalizeSearchToken(searchText).includes(normalizedFilter)
        );
}
