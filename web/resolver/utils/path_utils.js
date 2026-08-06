export function joinPathPreservingStyle(
    basePath = '',
    relativePath = '',
    { normalizeRelativeWhenBaseEmpty = false } = {},
) {
    const rawBase = String(basePath || '');
    const relative = String(relativePath || '').replace(/^[/\\]+/, '');
    const usesBackslash = /^[A-Za-z]:\\/.test(rawBase)
        || /^\\\\/.test(rawBase)
        || (!rawBase.includes('/') && rawBase.includes('\\'));
    const separator = usesBackslash ? '\\' : '/';
    const base = rawBase.replace(usesBackslash ? /[/\\]+$/ : /\/+$/, '')
        || (usesBackslash ? (/^\\+$/.test(rawBase) ? '\\' : '') : (/^\/+$/.test(rawBase) ? '/' : ''));
    if (!base) {
        return normalizeRelativeWhenBaseEmpty
            ? relative.trim().replace(/\\/g, '/')
            : relative;
    }
    if (!relative) return base;
    const normalizedRelative = relative.replace(/[/\\]+/g, separator);
    const joiner = base.endsWith(separator) ? '' : separator;
    return `${base}${joiner}${normalizedRelative}`;
}
