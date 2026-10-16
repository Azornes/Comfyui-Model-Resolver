/**
 * Multi-selection and copying helpers for model chips in Loaded Models and Metadata tabs.
 */

/**
 * Checks whether a model chip is currently visible (not hidden by tab filters).
 * @param {Element} chip
 * @returns {boolean}
 */
export function isChipVisible(chip) {
    if (!chip) return false;
    if (chip.style?.display === 'none') return false;
    const group = chip.closest?.('.mr-model-group');
    if (group && group.style?.display === 'none') return false;
    const section = chip.closest?.('.mr-model-section');
    if (section && section.style?.display === 'none') return false;
    return true;
}

/**
 * Returns all currently visible model chips in the container.
 * @param {Element} container
 * @returns {Element[]}
 */
export function getVisibleModelChips(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    return Array.from(container.querySelectorAll('.mr-model-chip')).filter(isChipVisible);
}

/**
 * Returns all selected model chips in the container.
 * @param {Element} container
 * @returns {Element[]}
 */
export function getSelectedModelChips(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    return Array.from(container.querySelectorAll('.mr-model-chip.is-selected'));
}

/**
 * Returns an array of token strings for all selected model chips.
 * @param {Element} container
 * @returns {string[]}
 */
export function getSelectedModelTokens(container) {
    const selected = getSelectedModelChips(container);
    return selected.map(chip => chip.dataset?.mlToken || chip.textContent.trim()).filter(Boolean);
}

/**
 * Clears selection across all model chips in the container.
 * @param {Element} container
 */
export function clearLoadedModelSelection(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    const chips = container.querySelectorAll('.mr-model-chip.is-selected');
    chips.forEach(chip => chip.classList.remove('is-selected'));
    if (container._mlSelectionState) {
        container._mlSelectionState.anchorChip = null;
    }
    updateLoadedModelSelectionState(container);
}

/**
 * Synchronizes the selection dataset, copy toolbar, and code preview with current chip selection.
 * @param {Element} container
 */
export function updateLoadedModelSelectionState(container) {
    if (!container || typeof container.querySelector !== 'function') return;

    const selectedChips = getSelectedModelChips(container);
    const selectedTokens = selectedChips.map(chip => chip.dataset?.mlToken || chip.textContent.trim()).filter(Boolean);
    const selectedString = selectedTokens.join(' ');
    const selectedCount = selectedTokens.length;

    container.dataset.mlSelectedString = selectedString;

    const copySection = container.querySelector('.mr-copy-section');
    if (!copySection) return;

    copySection.dataset.mlSelected = selectedString;
    copySection.dataset.mlSelectedCount = String(selectedCount);

    const selectedBtn = copySection.querySelector('.mr-copy-mode-selected');
    const selectedCountSpan = copySection.querySelector('.mr-copy-selected-count');
    if (selectedCountSpan) {
        selectedCountSpan.textContent = String(selectedCount);
    }
    if (selectedBtn) {
        selectedBtn.style.display = selectedCount > 0 ? '' : 'none';
    }

    const activeModeBtn = copySection.querySelector('.mr-copy-mode.active');
    const currentMode = activeModeBtn?.dataset?.mlCopyMode;

    if (selectedCount > 0) {
        if (currentMode !== 'selected') {
            if (typeof window !== 'undefined' && typeof window.MLSetCopyMode === 'function') {
                window.MLSetCopyMode(copySection.id, 'selected');
            }
        } else {
            const codeEl = copySection.querySelector('.mr-copy-code');
            const labelEl = copySection.querySelector('.mr-copy-label');
            const metaEl = copySection.querySelector('.mr-copy-meta');
            if (codeEl) codeEl.textContent = selectedString;
            if (labelEl) labelEl.textContent = 'Copy selected';
            if (metaEl) metaEl.textContent = `${selectedCount} token${selectedCount === 1 ? '' : 's'}`;
        }
    } else {
        if (currentMode === 'selected') {
            const fallbackMode = copySection.dataset.mlPreviousMode || 'all';
            if (typeof window !== 'undefined' && typeof window.MLSetCopyMode === 'function') {
                window.MLSetCopyMode(copySection.id, fallbackMode);
            }
        }
    }
}

/**
 * Initializes click, shift-click, ctrl-click, and keyboard shortcuts for model chips.
 * @param {Element} container
 * @param {object} [dialog]
 * @returns {Function} cleanup function
 */
export function initLoadedModelSelection(container, dialog = null) {
    if (!container || typeof container.addEventListener !== 'function') {
        return () => {};
    }

    if (container._mlSelectionState?.cleanup) {
        container._mlSelectionState.cleanup();
    }

    const state = {
        anchorChip: null,
        cleanup: null
    };
    container._mlSelectionState = state;

    const handleChipClick = (chip, event) => {
        const isCtrl = Boolean(event.ctrlKey || event.metaKey);
        const isShift = Boolean(event.shiftKey);
        const visibleChips = getVisibleModelChips(container);

        if (isShift) {
            const currentIndex = visibleChips.indexOf(chip);
            const anchorIndex = state.anchorChip && visibleChips.includes(state.anchorChip)
                ? visibleChips.indexOf(state.anchorChip)
                : currentIndex;

            const start = Math.min(anchorIndex, currentIndex);
            const end = Math.max(anchorIndex, currentIndex);

            if (!isCtrl) {
                visibleChips.forEach((c, idx) => {
                    const inRange = idx >= start && idx <= end;
                    c.classList.toggle('is-selected', inRange);
                });
            } else {
                visibleChips.forEach((c, idx) => {
                    if (idx >= start && idx <= end) {
                        c.classList.add('is-selected');
                    }
                });
            }
        } else if (isCtrl) {
            chip.classList.toggle('is-selected');
            state.anchorChip = chip;
        } else {
            const allChips = container.querySelectorAll('.mr-model-chip');
            allChips.forEach(c => {
                if (c !== chip) c.classList.remove('is-selected');
            });
            chip.classList.add('is-selected');
            state.anchorChip = chip;
        }

        updateLoadedModelSelectionState(container);
    };

    const handleContainerClick = (event) => {
        if (event.button !== 0) return;

        if (dialog?.activeTab) {
            if (dialog.activeTab !== 'loaded' && dialog.activeTab !== 'metadata') {
                return;
            }
            if (container === dialog.contentElement && dialog.activeTab !== 'loaded') {
                return;
            }
        }

        const chip = event.target?.closest?.('.mr-model-chip');
        if (chip && container.contains(chip)) {
            event.stopPropagation();
            handleChipClick(chip, event);
            return;
        }

        if (event.target?.closest?.('button, a, input, textarea, select, .mr-copy-code, .mr-copy-toolbar')) {
            return;
        }

        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
            clearLoadedModelSelection(container);
        }
    };

    const handleKeyDown = (event) => {
        const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
        if (activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.isContentEditable
        )) {
            return;
        }

        if (!container.isConnected) return;
        if (container.style?.display === 'none') return;

        const modal = container.closest?.('#model-resolver-modal');
        if (modal && (modal.style?.display === 'none' || modal.classList.contains('mr-hidden'))) {
            return;
        }

        if (dialog?.activeTab) {
            if (dialog.activeTab !== 'loaded' && dialog.activeTab !== 'metadata') {
                return;
            }
            if (container === dialog.contentElement && dialog.activeTab !== 'loaded') {
                return;
            }
        }

        // Ctrl+C / Cmd+C (Copy selected)
        if ((event.key === 'c' || event.key === 'C') && (event.ctrlKey || event.metaKey) && !event.altKey) {
            const browserSelection = typeof window !== 'undefined' ? window.getSelection?.()?.toString() : '';
            if (browserSelection && browserSelection.trim().length > 0) {
                return;
            }

            const selectedChips = getSelectedModelChips(container);
            if (selectedChips.length > 0) {
                event.preventDefault();
                const copySection = container.querySelector('.mr-copy-section');
                const selectedText = copySection?.dataset?.mlSelected
                    || selectedChips.map(c => c.dataset?.mlToken || c.textContent.trim()).filter(Boolean).join(' ');

                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(selectedText).then(() => {
                        const copyBtn = copySection?.querySelector('.mr-copy-main-btn');
                        if (copyBtn && typeof window !== 'undefined' && typeof window.MLSetCopyButtonFeedback === 'function') {
                            window.MLSetCopyButtonFeedback(copyBtn, 'Copied');
                        }
                        if (typeof dialog?.showNotification === 'function') {
                            dialog.showNotification(
                                `Copied ${selectedChips.length} model token${selectedChips.length === 1 ? '' : 's'} to clipboard`,
                                'info'
                            );
                        }
                    }).catch(err => {
                        console.error('Model Resolver: clipboard write failed', err);
                    });
                }
                return;
            }
        }

        // Ctrl+A / Cmd+A (Select All visible chips)
        if ((event.key === 'a' || event.key === 'A') && (event.ctrlKey || event.metaKey) && !event.altKey) {
            const visibleChips = getVisibleModelChips(container);
            if (visibleChips.length > 0) {
                event.preventDefault();
                visibleChips.forEach(c => c.classList.add('is-selected'));
                if (!state.anchorChip && visibleChips.length) {
                    state.anchorChip = visibleChips[0];
                }
                updateLoadedModelSelectionState(container);
                return;
            }
        }

        // Escape (Deselect all)
        if (event.key === 'Escape') {
            const selectedChips = getSelectedModelChips(container);
            if (selectedChips.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                clearLoadedModelSelection(container);
            }
        }
    };

    container.addEventListener('click', handleContainerClick);
    if (typeof document !== 'undefined') {
        document.addEventListener('keydown', handleKeyDown);
    }

    const cleanup = () => {
        container.removeEventListener('click', handleContainerClick);
        if (typeof document !== 'undefined') {
            document.removeEventListener('keydown', handleKeyDown);
        }
        if (container._mlSelectionState === state) {
            container._mlSelectionState = null;
        }
    };

    state.cleanup = cleanup;
    return cleanup;
}
