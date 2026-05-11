// IconUtils.js - Utility for loading SVG icons
import { app } from "../../../scripts/app.js";

const SVG_ICONS = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l5 5"></path></svg>`,
    locate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h3"></path><path d="M19 12h3"></path><path d="M12 2v3"></path><path d="M12 19v3"></path><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2.5"></circle></svg>`,
    eye: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19C5 19 1 12 1 12a21.77 21.77 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A10.93 10.93 0 0 1 12 4c7 0 11 8 11 8a21.72 21.72 0 0 1-4.31 5.18"></path><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path><path d="M1 1l22 22"></path></svg>`,
    civitai: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 178 178" aria-hidden="true"><defs><linearGradient id="ml-civitai-gradient" gradientUnits="userSpaceOnUse" x1="89.3" y1="-665.5" x2="89.3" y2="-841.1" gradientTransform="matrix(1 0 0 -1 0 -664)"><stop offset="0" stop-color="#1284F7"></stop><stop offset="1" stop-color="#0A20C9"></stop></linearGradient></defs><path fill="#000" d="M13.3,45.4v87.7l76,43.9l76-43.9V45.4l-76-43.9L13.3,45.4z"></path><path fill="url(#ml-civitai-gradient)" d="M89.3,29.2l52,30v60l-52,30l-52-30v-60L89.3,29.2 M89.3,1.5l-76,43.9v87.8l76,43.9l76-43.9V45.4L89.3,1.5z"></path><path fill="#FFF" d="M104.1,97.2l-14.9,8.5l-14.9-8.5v-17l14.9-8.5l14.9,8.5h18.2V69.7l-33-19l-33,19v38.1l33,19l33-19V97.2H104.1z"></path></svg>`
};

/**
 * Generates HTML string for an icon with standardized styling
 * @param {Image} icon - The icon Image object (or null)
 * @param {string} fallback - Fallback text/emoji if icon is not available (default: '')
 * @param {number} size - Size of the icon in pixels (default: 14)
 * @param {string} extraStyles - Additional CSS styles (default: 'vertical-align: middle;')
 * @returns {string} HTML string for the icon or fallback
 */
export function getIconHtml(icon, fallback = '', size = 14, extraStyles = 'vertical-align: middle;') {
    if (!icon) return fallback;
    return `<img src="${icon.src}" style="width: ${size}px; height: ${size}px; ${extraStyles}">`;
}

/**
 * Returns inline SVG markup by icon name.
 * @param {string} name - Icon identifier
 * @param {string} color - Stroke color placeholder value
 * @param {string} className - Optional class name for the svg element
 * @returns {string} SVG markup or empty string
 */
export function getSvgIcon(name, color = 'currentColor', className = '') {
    const template = SVG_ICONS[name];
    if (!template) return '';

    let svg = template.replaceAll('{color}', color);
    if (className) {
        svg = svg.replace('<svg ', `<svg class="${className}" `);
    }
    return svg;
}

/**
 * Loads SVG icons and converts them to Image objects
 * @param {Object} icons - Object to store loaded icons
 * @param {string} iconColor - Color for the SVG icons (default: "#dddddd")
 */
export function loadIcons(icons = {}, iconColor = "#dddddd", userColors = {}) {
    for (const name in SVG_ICONS) {
        const color = userColors[name] || iconColor;
        const svg = SVG_ICONS[name].replaceAll("{color}", color);

        const img = new Image();
        img.onload = () => app.graph.setDirtyCanvas(true);
        img.src = `data:image/svg+xml;base64,${btoa(svg)}`;

        icons[name] = img;
    }
    
    return icons;
}
