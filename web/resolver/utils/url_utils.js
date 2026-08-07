/**
 * URL Utilities for Model Resolver
 */

import { getSourceKeyFromText } from './source_labels.js';

/**
 * Resolve a supported provider key from a URL host.
 * @param {string} value
 * @param {{fallbackToText?: boolean}} options
 * @returns {string}
 */
export function getSourceKeyFromUrl(value, { fallbackToText = false } = {}) {
    const url = String(value || '').trim();
    if (!url) return '';

    try {
        const baseUrl = globalThis.location?.origin || 'http://localhost';
        const parsed = new URL(url, baseUrl);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'huggingface.co' || host.endsWith('.huggingface.co')) return 'huggingface';
        if (host === 'civarchive.com' || host.endsWith('.civarchive.com')) return 'civarchive';
        if (host === 'civitai.com' || host.endsWith('.civitai.com') || host === 'civitai.red' || host.endsWith('.civitai.red')) return 'civitai';
    } catch {
        // Preserve the caller's optional text fallback for malformed URLs.
    }

    return fallbackToText ? getSourceKeyFromText(url) : '';
}

/**
 * Parse a Hugging Face blob/resolve file URL into repository coordinates.
 * @param {string} value
 * @returns {{repo: string, revision: string, path: string, filename: string}|null}
 */
export function parseHuggingFaceFileUrl(value) {
    if (!value) return null;

    try {
        const url = new URL(String(value));
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        if (host !== 'huggingface.co') return null;

        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length < 5 || !['resolve', 'blob'].includes(parts[2])) {
            return null;
        }

        const decodePart = part => decodeURIComponent(part);
        const repo = `${decodePart(parts[0])}/${decodePart(parts[1])}`;
        const revision = decodePart(parts[3]);
        const path = parts.slice(4).map(decodePart).join('/');
        if (!repo || !revision || !path) return null;

        return {
            repo,
            revision,
            path,
            filename: path.split('/').pop() || ''
        };
    } catch {
        return null;
    }
}

/**
 * Parses the download URL and returns the model card URL.
 * Supports HuggingFace and CivitAI platforms.
 * @param {string} downloadUrl 
 * @returns {string|null} Model card URL or null on failure
 */
export function getModelCardUrl(downloadUrl) {
    if (!downloadUrl) return null;

    try {
        // HuggingFace URLs
        if (downloadUrl.includes('huggingface.co')) {
            const file = parseHuggingFaceFileUrl(downloadUrl);
            if (file) {
                const encodedRevision = encodeURIComponent(file.revision);
                const encodedPath = file.path
                    .split('/')
                    .map(part => encodeURIComponent(part))
                    .join('/');
                return `https://huggingface.co/${file.repo}/blob/${encodedRevision}/${encodedPath}`;
            }

            const match = downloadUrl.match(/huggingface\.co\/([^/]+\/[^/]+)/);
            if (match) {
                return `https://huggingface.co/${match[1]}`;
            }
        }

        // CivitAI URLs
        if (downloadUrl.includes('civitai.com')) {
            // Format: /api/download/models/123456 or /models/123456/...
            const modelIdMatch = downloadUrl.match(/models\/(\d+)/);
            if (modelIdMatch) {
                return `https://civitai.com/models/${modelIdMatch[1]}`;
            }
        }
    } catch (e) {
        console.error('Error parsing model card URL:', e);
    }

    return null;
}
