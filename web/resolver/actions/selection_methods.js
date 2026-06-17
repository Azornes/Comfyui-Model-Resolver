import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const selectionMethods = {
    /**
     * Handle clicks outside the dialog
     */
    handleOutsideClick(e) {
        // Close if click is on the backdrop (not on the dialog itself)
        if (e.target === this.backdrop) {
            this.close();
        }
    },

    handleFooterMenuOutsideClick(e) {
        if (!this.activeFooterMenu) return;
        if (e.target?.closest?.('.mr-footer-menu-wrap')) return;
        this.closeFooterMenus();
    },

    closeFooterMenus() {
        this.clearFooterMenuPreview?.();
        this.activeFooterMenu = null;
        this.footerMenus?.forEach?.((menu, name) => {
            menu.classList.remove('is-open');
            const button = this.footerMenuButtons?.get?.(name);
            button?.setAttribute('aria-expanded', 'false');
        });
    },

    setMissingFooterControlsVisible(visible) {
        const display = visible ? 'inline-flex' : 'none';
        [
            this.selectMenuWrap,
            this.searchMenuWrap,
            this.linkMenuWrap,
            this.downloadMenuWrap
        ].forEach(element => {
            if (element) element.style.display = display;
        });
        this.updateFooterStarLayout?.();
        if (!visible) {
            this.closeFooterMenus();
        }
    },

    toggleFooterMenu(name) {
        const menu = this.footerMenus?.get?.(name);
        const button = this.footerMenuButtons?.get?.(name);
        if (!menu || !button) return;

        const shouldOpen = this.activeFooterMenu !== name;
        this.closeFooterMenus();
        if (shouldOpen) {
            this.activeFooterMenu = name;
            menu.classList.add('is-open');
            button.setAttribute('aria-expanded', 'true');
        }
    },

    syncBatchSelectionForMissingModels(missingModels = this.missingModels || []) {
        if (!(this.batchSelectedMissingKeys instanceof Set)) {
            this.batchSelectedMissingKeys = new Set();
        }

        const validKeys = new Set(missingModels.map(missing => this.getMissingModelKey(missing)));
        for (const key of Array.from(this.batchSelectedMissingKeys)) {
            if (!validKeys.has(key)) {
                this.batchSelectedMissingKeys.delete(key);
            }
        }
        if (this.lastBatchSelectedMissingKey && !validKeys.has(this.lastBatchSelectedMissingKey)) {
            this.lastBatchSelectedMissingKey = null;
        }
    },

    getSelectedMissingModels() {
        const selectedKeys = this.batchSelectedMissingKeys || new Set();
        return (this.missingModels || []).filter(missing => selectedKeys.has(this.getMissingModelKey(missing)));
    },

    getMissingWithExactLocalMatches(missingModels = this.missingModels || []) {
        return missingModels.filter(missing => this.getBestLocalMatch(missing, 100));
    },

    getMissingWithoutExactLocalMatches(missingModels = this.missingModels || []) {
        return missingModels.filter(missing => !this.getBestLocalMatch(missing, 100));
    },

    getMissingWithPartialLocalMatches(missingModels = this.missingModels || []) {
        return missingModels.filter(missing => {
            const bestMatch = this.getBestLocalMatch(missing, 70);
            return bestMatch && Number(bestMatch.confidence || 0) < 100;
        });
    },

    getMissingWithoutLocalMatches(missingModels = this.missingModels || []) {
        return missingModels.filter(missing => !this.getBestLocalMatch(missing, 70));
    },

    getMissingWithDownloadSources(missingModels = this.missingModels || []) {
        return missingModels.filter(missing => this.getBestDownloadSourceForMissing(missing));
    },

    getMissingWithoutDownloadSources(missingModels = this.missingModels || []) {
        return missingModels.filter(missing => !this.getBestDownloadSourceForMissing(missing));
    },

    getSearchedMissingModels(missingModels = this.missingModels || []) {
        return missingModels.filter(missing => this.hasRenderableSearchState(this.getSearchState(missing)));
    },

    getUnsearchedMissingModels(missingModels = this.missingModels || []) {
        return missingModels.filter(missing => !this.hasRenderableSearchState(this.getSearchState(missing)));
    },

    selectBatchMissingModels(mode) {
        const missingModels = this.missingModels || [];
        if (!missingModels.length) {
            this.showNotification('No missing models to select.', 'info');
            return;
        }

        if (!(this.batchSelectedMissingKeys instanceof Set)) {
            this.batchSelectedMissingKeys = new Set();
        }

        if (mode === 'none') {
            this.batchSelectedMissingKeys.clear();
        } else if (mode === 'invert') {
            const nextSelection = new Set();
            for (const missing of missingModels) {
                const key = this.getMissingModelKey(missing);
                if (!this.batchSelectedMissingKeys.has(key)) {
                    nextSelection.add(key);
                }
            }
            this.batchSelectedMissingKeys = nextSelection;
        } else {
            let models = missingModels;
            if (mode === 'exact') {
                models = this.getMissingWithExactLocalMatches(missingModels);
            } else if (mode === 'no_exact') {
                models = this.getMissingWithoutExactLocalMatches(missingModels);
            } else if (mode === 'partial') {
                models = this.getMissingWithPartialLocalMatches(missingModels);
            } else if (mode === 'no_local') {
                models = this.getMissingWithoutLocalMatches(missingModels);
            } else if (mode === 'downloadable') {
                models = this.getMissingWithDownloadSources(missingModels);
            } else if (mode === 'no_download') {
                models = this.getMissingWithoutDownloadSources(missingModels);
            } else if (mode === 'searched') {
                models = this.getSearchedMissingModels(missingModels);
            } else if (mode === 'unsearched') {
                models = this.getUnsearchedMissingModels(missingModels);
            }
            this.batchSelectedMissingKeys = new Set(models.map(missing => this.getMissingModelKey(missing)));
        }

        this.refreshBatchSelectionUi();
        this.updateBatchFooterButtons();
        this.closeFooterMenus();
    },

    refreshBatchSelectionUi() {
        const selectedKeys = this.batchSelectedMissingKeys || new Set();
        this.contentElement?.querySelectorAll?.('.mr-missing-list-row')?.forEach(row => {
            const key = row.getAttribute('data-missing-key');
            const selected = selectedKeys.has(key);
            row.classList.toggle('is-batch-selected', selected);
            const checkbox = row.querySelector('.mr-missing-row-check');
            if (checkbox) {
                checkbox.checked = selected;
            }
        });
        this.updateBatchSelectAllCheckbox();
    },

    updateBatchSelectAllCheckbox() {
        const checkbox = this.contentElement?.querySelector?.('.mr-missing-select-all-check');
        if (!checkbox) return;

        const totalCount = (this.missingModels || []).length;
        const selectedCount = this.getSelectedMissingModels().length;
        checkbox.checked = totalCount > 0 && selectedCount === totalCount;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < totalCount;
        checkbox.disabled = totalCount === 0;
    },

    setBatchSelectionForKey(key, selected) {
        if (!key) return;
        if (!(this.batchSelectedMissingKeys instanceof Set)) {
            this.batchSelectedMissingKeys = new Set();
        }
        if (selected) {
            this.batchSelectedMissingKeys.add(key);
        } else {
            this.batchSelectedMissingKeys.delete(key);
        }
    },

    applyBatchSelectionRange(sortedMissingModels, fromKey, toKey, selected) {
        const models = sortedMissingModels || this.missingModels || [];
        const fromIndex = models.findIndex(missing => this.getMissingModelKey(missing) === fromKey);
        const toIndex = models.findIndex(missing => this.getMissingModelKey(missing) === toKey);

        if (fromIndex < 0 || toIndex < 0) {
            this.setBatchSelectionForKey(toKey, selected);
            return;
        }

        const start = Math.min(fromIndex, toIndex);
        const end = Math.max(fromIndex, toIndex);
        for (let index = start; index <= end; index += 1) {
            this.setBatchSelectionForKey(this.getMissingModelKey(models[index]), selected);
        }
    }
};
