export function normalizeSha256(value = '') {
    let text = String(value || '').trim();
    text = text.replace(/^sha256[:=]/i, '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(text) ? text : '';
}
