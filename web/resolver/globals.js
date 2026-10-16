import { copyTextWithFeedback } from "./utils/html_utils.js";

export function registerGlobalHelpers() {
    // Global helper functions for inline onclick handlers
    window.MLToggleHidden = function(id, trigger, collapsedText, expandedText) {
        const element = document.getElementById(id);
        if (!element) return;

        const isHidden = element.classList.toggle('mr-hidden');
        if (trigger) {
            trigger.setAttribute('aria-expanded', String(!isHidden));
            if (trigger.dataset?.mlPreference === 'local-match-alternatives') {
                window.ModelResolverDialog?.setLocalMatchAlternativesCollapsed?.(isHidden);
            }
            const label = trigger.querySelector?.('.mr-local-alternatives-label');
            const state = trigger.querySelector?.('.mr-local-alternatives-state');
            if (label || state) {
                if (label) label.textContent = isHidden ? collapsedText : expandedText;
                if (state) state.textContent = isHidden ? 'Show' : 'Hide';
            } else {
                trigger.textContent = isHidden ? collapsedText : expandedText;
            }
        }
    };

    window.MLSetCopyMode = function(sectionId, mode) {
        const section = document.getElementById(sectionId);
        if (!section) return;

        const normalizedMode = ['all', 'active', 'inactive', 'selected'].includes(mode) ? mode : 'all';
        if (normalizedMode !== 'selected') {
            section.dataset.mlPreviousMode = normalizedMode;
        }
        const codeEl = section.querySelector('.mr-copy-code');
        const labelEl = section.querySelector('.mr-copy-label');
        const metaEl = section.querySelector('.mr-copy-meta');
        const dataKey = normalizedMode === 'all'
            ? 'mlAll'
            : normalizedMode === 'active'
                ? 'mlActive'
                : normalizedMode === 'inactive'
                    ? 'mlInactive'
                    : 'mlSelected';
        const countKey = normalizedMode === 'all'
            ? 'mlAllCount'
            : normalizedMode === 'active'
                ? 'mlActiveCount'
                : normalizedMode === 'inactive'
                    ? 'mlInactiveCount'
                    : 'mlSelectedCount';
        const labelMap = {
            all: 'Copy all',
            active: 'Copy active',
            inactive: 'Copy inactive',
            selected: 'Copy selected'
        };

        if (codeEl) codeEl.textContent = section.dataset[dataKey] || '';
        if (labelEl) labelEl.textContent = labelMap[normalizedMode];
        if (metaEl) {
            const count = Number(section.dataset[countKey] || 0);
            metaEl.textContent = `${count} token${count === 1 ? '' : 's'}`;
        }

        section.querySelectorAll('.mr-copy-mode').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mlCopyMode === normalizedMode);
        });
    };

    window.MLSetCopyButtonFeedback = function(btn, text) {
        if (!btn) return;
        const originalHtml = btn.dataset.mlOriginalHtml || btn.innerHTML;
        btn.dataset.mlOriginalHtml = originalHtml;
        btn.textContent = text;
        setTimeout(() => {
            if (btn.isConnected) btn.innerHTML = originalHtml;
        }, 1500);
    };

    window.MLFilterSwitch = function(filter, clickedBtn = null) {
        const root = clickedBtn?.closest?.('.mr-loaded-models-header')?.parentNode
            || document;
        const filterBtn = clickedBtn || document.getElementById('filter-' + filter);
        if (!filterBtn) return;
        
        // Update button states
        root.querySelectorAll('.mr-btn-filter').forEach(b => {
            if (b.id && b.id.startsWith('filter-')) {
                b.classList.remove('active');
            }
        });
        filterBtn.classList.add('active');
        
        // Filter model sections
        root.querySelectorAll('.mr-model-section').forEach(s => {
            const hasActive = s.getAttribute('data-ml-active') === 'true';
            const hasInactive = s.getAttribute('data-ml-inactive') === 'true';
            
            const activeSection = s.querySelector('.mr-model-group-active');
            const inactiveSection = s.querySelector('.mr-model-group-inactive');
            
            if (filter === 'all') {
                s.style.display = 'block';
                if (activeSection) activeSection.style.display = 'block';
                if (inactiveSection) inactiveSection.style.display = 'block';
            } else if (filter === 'active') {
                s.style.display = hasActive ? 'block' : 'none';
                if (activeSection) activeSection.style.display = hasActive ? 'block' : 'none';
                if (inactiveSection) inactiveSection.style.display = 'none';
            } else if (filter === 'inactive') {
                s.style.display = hasInactive ? 'block' : 'none';
                if (activeSection) activeSection.style.display = 'none';
                if (inactiveSection) inactiveSection.style.display = hasInactive ? 'block' : 'none';
            }
        });
        
        const copySection = root.querySelector?.('[id^="mr-copy-"]')
            || document.querySelector('[id^="mr-copy-"]');
        if (copySection) {
            window.MLSetCopyMode(copySection.id, filter);
        }
    };

    window.MLCopy = function(text, btn) {
        copyTextWithFeedback(text, btn, { successText: 'Copied', successClass: '' });
    };

    window.MLCopyCode = function(sectionId, btn) {
        const section = document.getElementById(sectionId);
        const codeEl = section ? section.querySelector('code') : null;
        if (codeEl) {
            copyTextWithFeedback(codeEl.textContent, btn, { successText: 'Copied', successClass: '' });
        }
    };

    window.MLOpenContextMenu = function(event, element) {
        event.preventDefault();
        event.stopPropagation();
        
        try {
            const modelData = element.getAttribute('data-model');
            if (!modelData) return;
            
            const model = JSON.parse(decodeURIComponent(modelData));
            
            // Get dialog instance
            const dialog = window.ModelResolverDialog;
            if (dialog && dialog.showContextMenu) {
                dialog.showContextMenu(event.clientX, event.clientY, model);
            }
        } catch (e) {
            console.error('Model Resolver: Error opening context menu:', e);
        }
    };
}

export function getCivitaiModelUrl(modelId, versionId) {
    if (!modelId) return '';
    return `https://civitai.com/models/${encodeURIComponent(modelId)}${versionId ? `?modelVersionId=${encodeURIComponent(versionId)}` : ''}`;
}
