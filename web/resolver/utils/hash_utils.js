export function getSha256Candidates(value = {}) {
    const hashes = value.hashes && typeof value.hashes === 'object'
        ? value.hashes
        : {};
    return [value.sha256, value.hash, hashes.SHA256, hashes.sha256];
}

export function getSha256Field(value = {}, { lowercase = false } = {}) {
    const [sha256, hash, upperCaseSha256, lowerCaseSha256] = getSha256Candidates(value);
    const result = String(
        sha256 || hash || upperCaseSha256 || lowerCaseSha256 || ''
    ).trim();
    return lowercase ? result.toLowerCase() : result;
}

export function normalizeSha256(value = '') {
    let text = String(value || '').trim();
    text = text.replace(/^sha256[:=]/i, '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(text) ? text : '';
}

export function firstValidSha256(...values) {
    for (const value of values) {
        const hash = normalizeSha256(value);
        if (hash) return hash;
    }
    return '';
}
