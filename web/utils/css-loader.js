/**
 * CSS Loader
 * Loads all CSS files for the resolution master components
 */

import { addStylesheet, getUrl } from "./ResourceManager.js";
import { createModuleLogger } from "../log_system/LoggerUtils.js";

const log = createModuleLogger('CSSLoader');

/**
 * Loads all CSS files for the application
 */
export function loadAllStyles() {
    try {
        log.info('Loading CSS files...');
        
        // Load all CSS files using getUrl for proper path resolution
        const cssFiles = [
            './css/css-variables.css',
            './css/linker-shell.css',
            './css/linker-main.css',
        ];
        
        cssFiles.forEach(file => {
            addStylesheet(getUrl(file));
            log.debug(`Loaded: ${file}`);
        });
        
        log.info('All CSS files loaded successfully');
    } catch (error) {
        log.error('Error loading CSS files:', error);
    }
}

/**
 * Call this function when the ResolutionMaster node is actually created/used
 * to load styles only when needed, preventing global UI interference
 */
export function loadStylesWhenNeeded() {
    loadAllStyles();
}
