/**
 * HTML Utilities for Model Resolver
 */

/**
 * Escapes special characters for HTML to prevent XSS.
 * @param {any} value 
 * @returns {string} Escaped string
 */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escapes a value to be safely embedded inside inline JavaScript.
 * @param {any} value 
 * @returns {string} Escaped string
 */
export function escapeJsString(value) {
    return escapeHtml(JSON.stringify(String(value ?? '')));
}

/**
 * Sanitizes HTML content for display, permitting only safe tags and attributes.
 * @param {string} html 
 * @returns {string} Sanitized HTML
 */
export function sanitizeDescriptionHtml(html) {
    const raw = String(html ?? '').trim();
    if (!raw) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${raw}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return escapeHtml(raw);

    const allowedTags = new Set([
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
        'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'span'
    ]);
    const allowedStyles = new Set(['color']);

    const sanitizeNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.remove();
            return;
        }

        const tag = node.tagName.toLowerCase();
        if (!allowedTags.has(tag)) {
            const parent = node.parentNode;
            if (!parent) {
                node.remove();
                return;
            }

            while (node.firstChild) {
                parent.insertBefore(node.firstChild, node);
            }
            parent.removeChild(node);
            return;
        }

        const attrs = Array.from(node.attributes);
        for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'id' || name === 'class' || name.startsWith('data-')) {
                node.removeAttribute(attr.name);
                continue;
            }

            if (name === 'href' && tag === 'a') {
                const href = node.getAttribute('href') || '';
                if (!/^https?:\/\//i.test(href)) {
                    node.removeAttribute('href');
                } else {
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer');
                }
                continue;
            }

            if (name === 'style') {
                const safeStyles = [];
                const styleValue = node.getAttribute('style') || '';
                for (const part of styleValue.split(';')) {
                    const [prop, value] = part.split(':').map(v => v?.trim());
                    if (!prop || !value) continue;
                    if (allowedStyles.has(prop.toLowerCase())) {
                        safeStyles.push(`${prop}: ${value}`);
                    }
                }
                if (safeStyles.length) {
                    node.setAttribute('style', safeStyles.join('; '));
                } else {
                    node.removeAttribute('style');
                }
                continue;
            }

            if (!(tag === 'a' && (name === 'target' || name === 'rel')) ) {
                node.removeAttribute(attr.name);
            }
        }

        Array.from(node.childNodes).forEach(child => sanitizeNode(child));
    };

    Array.from(root.childNodes).forEach(child => sanitizeNode(child));
    return root.innerHTML;
}

/**
 * Generic background task progress poller with token cancellation checks.
 */
export async function pollBackgroundTask({
    endpoint,
    tokenCheck,
    onProgress,
    isTerminal,
    onTerminal,
    onError,
    intervalMs = 250,
    fetchJson,
    filterIgnoredStatus
}) {
    while (tokenCheck()) {
        try {
            const data = await fetchJson(endpoint, { silent: true }, 'Poll background task');
            
            if (filterIgnoredStatus && filterIgnoredStatus(data)) {
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                continue;
            }
            
            if (tokenCheck()) {
                onProgress(data);
                if (isTerminal(data)) {
                    onTerminal(data);
                    return;
                }
            }
        } catch (error) {
            if (tokenCheck()) {
                onError(error);
                return;
            }
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}
