import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { $el } from "../../../../scripts/ui.js";
import { createModuleLogger } from "../log_system/log_funcs.js";
import { logger as frontendLogger } from "../log_system/logger.js";
import { loadStylesWhenNeeded } from "../utils/css_loader.js";
import { ResolverManagerDialog } from "./resolver_dialog.js";
import { showNotification } from "../utils/notification_utils.js";

const log = createModuleLogger('model_resolver');
export const MODEL_RESOLVER_OPEN_COMMAND_ID = "ModelResolver.OpenModelResolver";
export const MODEL_RESOLVER_OPEN_DEFAULT_KEYBINDING = Object.freeze({
    commandId: MODEL_RESOLVER_OPEN_COMMAND_ID,
    combo: Object.freeze({ key: "|", ctrl: true, shift: true }),
    targetElementId: "graph-canvas",
});

const OPEN_TOOLTIP_BASE = "Open Model Resolver to find or download missing workflow models.";
const KEYBINDING_NEW_SETTING_ID = "Comfy.Keybinding.NewBindings";
const KEYBINDING_UNSET_SETTING_ID = "Comfy.Keybinding.UnsetBindings";

function getKeybindingSetting(id) {
    try {
        const value = app.ui?.settings?.getSettingValue?.(id);
        return Array.isArray(value) ? value : [];
    } catch (error) {
        return [];
    }
}

function serializeKeybindingCombo(combo = {}) {
    return [
        String(combo.key || "").toUpperCase(),
        String(Boolean(combo.ctrl)),
        String(Boolean(combo.alt)),
        String(Boolean(combo.shift)),
    ].join(":");
}

function keybindingsEqual(left, right) {
    return Boolean(
        left
        && right
        && left.commandId === right.commandId
        && (left.targetElementId || "") === (right.targetElementId || "")
        && serializeKeybindingCombo(left.combo) === serializeKeybindingCombo(right.combo)
    );
}

function getComboLabel(combo = {}) {
    const parts = [];
    if (combo.ctrl) parts.push("Ctrl");
    if (combo.alt) parts.push("Alt");
    if (combo.shift) parts.push("Shift");

    const keyLabels = {
        " ": "Space",
        ArrowUp: "Up",
        ArrowDown: "Down",
        ArrowLeft: "Left",
        ArrowRight: "Right",
        Backspace: "Backspace",
        Delete: "Delete",
        Enter: "Enter",
        Escape: "Esc",
        Tab: "Tab",
    };
    const key = String(combo.key || "").trim();
    if (key) {
        parts.push(keyLabels[key] || (key.length === 1 ? key.toUpperCase() : key));
    }

    return parts.join("+");
}

function applyStoredFrontendLoggingPreference() {
    const stored = localStorage.getItem('ModelResolver.frontendLogsEnabled');
    if (stored !== null) {
        frontendLogger.setEnabled(stored !== 'false');
    }
    const storedLevel = localStorage.getItem('ModelResolver.frontendLogLevel');
    if (storedLevel) {
        frontendLogger.setGlobalAndModuleLevel(frontendLogger.normalizeLevel(storedLevel));
    }
}

// Main extension class
export class ModelResolver {
    constructor() {
        this.resolverButton = null;
        this.buttonGroup = null;
        this.buttonId = "model-resolver-button";
        this.sidebarTabId = "comfyui-model-resolver";
        this.sidebarRegistered = false;
        this.openTooltipTargets = new Set();
        this.openTooltip = this.buildOpenTooltip();
        this.openTooltipRefreshFrame = null;
        this.dialog = null;
        this.isCheckingMissing = false;  // Prevent multiple simultaneous checks
        this.lastCheckedWorkflow = null;  // Track to avoid duplicate checks
    }

    setup = async () => {
        applyStoredFrontendLoggingPreference();
        loadStylesWhenNeeded();

        // Remove any existing button
        this.removeExistingButton();

        // Create dialog instance
        if (!this.dialog) {
            this.dialog = new ResolverManagerDialog();
            window.ModelResolverDialog = this.dialog;
        }

        this.setupOpenShortcutTooltipTracking();

        // Listen for workflow load events to auto-check for missing models
        this.setupAutoOpenOnMissingModels();
        this.setupActiveWorkflowChangeListeners();

        const sidebarRegistered = this.registerSidebarButton();
        if (!sidebarRegistered) {
            await this.registerTopbarButton();
        } else {
            this.attachSidebarButtonToggleHandler();
        }
    }

    registerSidebarButton() {
        const registerSidebarTab = app.extensionManager?.registerSidebarTab;
        if (typeof registerSidebarTab !== "function") {
            return false;
        }

        if (this.sidebarRegistered || window.__ModelResolverSidebarRegistered) {
            this.sidebarRegistered = true;
            return true;
        }

        try {
            registerSidebarTab.call(app.extensionManager, {
                id: this.sidebarTabId,
                icon: "mdi mdi-link-variant",
                title: "Resolver",
                tooltip: this.openTooltip,
                type: "custom",
                render: (element) => this.renderSidebarPanel(element),
            });
            this.sidebarRegistered = true;
            window.__ModelResolverSidebarRegistered = true;
            return true;
        } catch (error) {
            console.warn("Model Resolver: Sidebar tab registration failed, falling back to top menu button.", error);
            return false;
        }
    }

    attachSidebarButtonToggleHandler() {
        window.__ModelResolverSidebarToggleOwner = this;
        if (window.__ModelResolverSidebarToggleHandlerAttached) return;

        window.__ModelResolverSidebarToggleHandlerAttached = true;
        window.__ModelResolverSidebarToggleHandler = (event) => {
            window.__ModelResolverSidebarToggleOwner?.handleSidebarButtonClick(event);
        };
        document.addEventListener('click', window.__ModelResolverSidebarToggleHandler, true);
    }

    setupOpenShortcutTooltipTracking() {
        window.__ModelResolverShortcutTooltipOwner = this;
        this.refreshOpenTooltip();

        if (window.__ModelResolverShortcutTooltipHandlersAttached) return;
        window.__ModelResolverShortcutTooltipHandlersAttached = true;

        const refreshHandler = () => {
            window.__ModelResolverShortcutTooltipOwner?.scheduleOpenTooltipRefresh();
        };
        app.ui?.settings?.addEventListener?.(`${KEYBINDING_NEW_SETTING_ID}.change`, refreshHandler);
        app.ui?.settings?.addEventListener?.(`${KEYBINDING_UNSET_SETTING_ID}.change`, refreshHandler);
        window.addEventListener('storage', (event) => {
            if (
                event.key === KEYBINDING_NEW_SETTING_ID
                || event.key === KEYBINDING_UNSET_SETTING_ID
            ) {
                refreshHandler();
            }
        });
    }

    scheduleOpenTooltipRefresh() {
        if (this.openTooltipRefreshFrame) {
            cancelAnimationFrame(this.openTooltipRefreshFrame);
        }
        this.openTooltipRefreshFrame = requestAnimationFrame(() => {
            this.openTooltipRefreshFrame = null;
            this.refreshOpenTooltip();
        });
    }

    getOpenKeybindings() {
        const byCombo = {
            [serializeKeybindingCombo(MODEL_RESOLVER_OPEN_DEFAULT_KEYBINDING.combo)]: MODEL_RESOLVER_OPEN_DEFAULT_KEYBINDING,
        };

        for (const keybinding of getKeybindingSetting(KEYBINDING_UNSET_SETTING_ID)) {
            const serializedCombo = serializeKeybindingCombo(keybinding?.combo);
            if (keybindingsEqual(byCombo[serializedCombo], keybinding)) {
                delete byCombo[serializedCombo];
            }
        }

        for (const keybinding of getKeybindingSetting(KEYBINDING_NEW_SETTING_ID)) {
            if (!keybinding?.combo) continue;
            byCombo[serializeKeybindingCombo(keybinding.combo)] = keybinding;
        }

        return Object.values(byCombo)
            .filter((keybinding) => keybinding?.commandId === MODEL_RESOLVER_OPEN_COMMAND_ID);
    }

    buildOpenTooltip() {
        const shortcutLabels = this.getOpenKeybindings()
            .map((keybinding) => getComboLabel(keybinding.combo))
            .filter(Boolean);

        if (shortcutLabels.length === 0) {
            return `${OPEN_TOOLTIP_BASE} Shortcut: not assigned.`;
        }

        const label = shortcutLabels.length === 1 ? "Shortcut" : "Shortcuts";
        return `${OPEN_TOOLTIP_BASE} ${label}: ${shortcutLabels.join(", ")}.`;
    }

    refreshOpenTooltip() {
        this.openTooltip = this.buildOpenTooltip();
        this.applyOpenTooltipToTargets();
    }

    trackOpenTooltipTarget(target) {
        if (!(target instanceof HTMLElement)) return;
        this.openTooltipTargets.add(target);
        this.applyTooltipToElement(target);
    }

    applyTooltipToElement(target) {
        if (!(target instanceof HTMLElement)) return;
        if (this.dialog?.setTooltip) {
            this.dialog.setTooltip(target, this.openTooltip);
        } else {
            target.setAttribute("data-tooltip", this.openTooltip);
            target.removeAttribute("title");
        }
    }

    applyOpenTooltipToTargets() {
        const liveTargets = new Set();
        for (const target of this.openTooltipTargets) {
            if (!(target instanceof HTMLElement) || !target.isConnected) continue;
            liveTargets.add(target);
            this.applyTooltipToElement(target);
        }
        this.openTooltipTargets = liveTargets;

        document.querySelectorAll(`.${this.sidebarTabId}-tab-button`).forEach((button) => {
            if (button instanceof HTMLElement) {
                this.applyTooltipToElement(button);
            }
        });
    }

    handleSidebarButtonClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest(`.${this.sidebarTabId}-tab-button`);
        if (!(button instanceof HTMLElement)) return;
        if (!this.dialog?.isVisible()) return;

        const wasDocked = this.dialog.docked;
        this.dialog.close({ collapseSidebar: false });

        if (!wasDocked) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();

            requestAnimationFrame(() => {
                if (this.isSidebarButtonActive(button)) {
                    button.click();
                }
            });
        }
    }

    isSidebarButtonActive(button) {
        return button.matches([
            '[aria-pressed="true"]',
            '[aria-selected="true"]',
            '[data-active="true"]',
            '[data-selected="true"]',
            '.active',
            '.is-active',
            '.selected',
            '.p-highlight'
        ].join(','));
    }

    renderSidebarPanel(element) {
        element.style.height = "100%";
        element.classList.add("mr-sidebar-dock-panel");

        if (!this.dialog) {
            this.dialog = new ResolverManagerDialog();
            window.ModelResolverDialog = this.dialog;
        }

        if (this.dialog.shouldOpenFromSidebarFloating()) {
            if (this.dialog.isVisible() && !this.dialog.docked) {
                this.dialog.close();
                this.dialog.closeComfySidebar(element);
                return;
            }

            this.openResolverManager({
                forceFloating: true,
                closeSidebarContainer: element,
            });
            return;
        }

        element.replaceChildren();
        this.openResolverManager({ dockContainer: element });
    }

    async registerTopbarButton() {
        // Try to use new ComfyUI button system (like ComfyUI Manager does)
        try {
            // Dynamic imports for ComfyUI's button components
            const { ComfyButtonGroup } = await import("../../../../scripts/ui/components/buttonGroup.js");
            const { ComfyButton } = await import("../../../../scripts/ui/components/button.js");

            // Create button group with Model Resolver button
            const ModelResolverButton = new ComfyButton({
                icon: "link-variant",
                action: () => this.openResolverManager(),
                content: "Model Resolver",
                classList: "comfyui-button comfyui-menu-mobile-collapse"
            }).element;
            ModelResolverButton.id = this.buttonId;
            this.trackOpenTooltipTarget(ModelResolverButton);
            this.buttonGroup = new ComfyButtonGroup(
                ModelResolverButton
            );

            // Insert before settings group in the menu
            app.menu?.settingsGroup.element.before(this.buttonGroup.element);
        } catch (e) {
            // Fallback for older ComfyUI versions without the new button system
            log.debug('Model Resolver: New button system not available, using floating button fallback.');
            this.createFloatingButton();
        }
    }

    /**
     * Setup auto-open functionality when workflow is loaded with missing models
     */
    setupAutoOpenOnMissingModels() {
        // Watch for ComfyUI's Missing Models popup and inject our button
        this.setupMissingModelsPopupObserver();

        log.debug('Model Resolver: Missing models popup button injection enabled');
    }

    setupActiveWorkflowChangeListeners() {
        if (window.__ModelResolverWorkflowChangeHandlers) {
            for (const { target, event, handler, options } of window.__ModelResolverWorkflowChangeHandlers) {
                target?.removeEventListener?.(event, handler, options);
            }
        }

        if (!window.__ModelResolverHistoryPatched) {
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            history.pushState = function(...args) {
                const result = originalPushState.apply(this, args);
                window.dispatchEvent(new Event('model-resolver-locationchange'));
                return result;
            };
            history.replaceState = function(...args) {
                const result = originalReplaceState.apply(this, args);
                window.dispatchEvent(new Event('model-resolver-locationchange'));
                return result;
            };
            window.__ModelResolverHistoryPatched = true;
        }

        if (!window.__ModelResolverLoadGraphDataPatched && typeof app.loadGraphData === 'function') {
            const originalLoadGraphData = app.loadGraphData;
            app.loadGraphData = function(...args) {
                const result = originalLoadGraphData.apply(this, args);
                Promise.resolve(result).then(() => {
                    setTimeout(() => {
                        window.dispatchEvent(new Event('model-resolver-active-workflowchange'));
                    }, 0);
                }, () => {
                    setTimeout(() => {
                        window.dispatchEvent(new Event('model-resolver-active-workflowchange'));
                    }, 0);
                });
                return result;
            };
            window.__ModelResolverLoadGraphDataPatched = true;
        }

        window.__ModelResolverWorkflowChangeOwner = this;

        const routeHandler = () => {
            window.__ModelResolverWorkflowChangeOwner?.handleActiveWorkflowRouteChange('route-change');
        };
        const activeWorkflowHandler = () => {
            window.__ModelResolverWorkflowChangeOwner?.handleActiveWorkflowRouteChange('active-workflow-change');
        };
        const documentClickHandler = (event) => {
            const owner = window.__ModelResolverWorkflowChangeOwner;
            if (!owner?.dialog?.isVisible()) return;

            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('#model-resolver-modal, .model-resolver-backdrop')) return;
            if (!owner.isLikelyWorkflowTabClickTarget(target)) return;

            setTimeout(() => {
                if (window.__ModelResolverWorkflowChangeOwner === owner) {
                    owner.handleActiveWorkflowRouteChange('workflow-tab-click');
                }
            }, 0);
        };
        const focusHandler = () => {
            window.__ModelResolverWorkflowChangeOwner?.handleActiveWorkflowRouteChange('window-focus');
        };
        const visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                window.__ModelResolverWorkflowChangeOwner?.handleActiveWorkflowRouteChange('visibility-change');
            }
        };

        window.addEventListener('hashchange', routeHandler);
        window.addEventListener('popstate', routeHandler);
        window.addEventListener('model-resolver-locationchange', routeHandler);
        window.addEventListener('model-resolver-active-workflowchange', activeWorkflowHandler);
        document.addEventListener('click', documentClickHandler, true);
        window.addEventListener('focus', focusHandler);
        document.addEventListener('visibilitychange', visibilityHandler);

        window.__ModelResolverWorkflowChangeHandlers = [
            { target: window, event: 'hashchange', handler: routeHandler },
            { target: window, event: 'popstate', handler: routeHandler },
            { target: window, event: 'model-resolver-locationchange', handler: routeHandler },
            { target: window, event: 'model-resolver-active-workflowchange', handler: activeWorkflowHandler },
            { target: document, event: 'click', handler: documentClickHandler, options: true },
            { target: window, event: 'focus', handler: focusHandler },
            { target: document, event: 'visibilitychange', handler: visibilityHandler }
        ];
    }

    isLikelyWorkflowTabClickTarget(target) {
        if (!(target instanceof Element)) return false;

        const tab = target.closest([
            '[data-workflow-id]',
            '[data-workflow-name]',
            '[data-tab-id*="workflow" i]',
            '[aria-controls*="workflow" i]',
            '[class*="workflow"][class*="tab" i]',
            '[class*="tab"][class*="workflow" i]',
            '[class*="workflow"][class*="item" i]'
        ].join(','));
        if (tab) return true;

        const roleTab = target.closest('[role="tab"]');
        if (!roleTab) return false;

        const text = roleTab.textContent?.trim() || '';
        const aria = roleTab.getAttribute('aria-label') || roleTab.getAttribute('title') || '';
        return /workflow|unsaved|untitled/i.test(`${text} ${aria}`);
    }

    handleActiveWorkflowRouteChange(reason = 'workflow-change') {
        if (!this.dialog?.isVisible()) return;
        this.dialog.scheduleActiveWorkflowRefresh(reason);
    }

    /**
     * Setup MutationObserver to detect ComfyUI's Missing Models popup and inject our button
     */
    setupMissingModelsPopupObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.checkAndInjectButton(node);
                    }
                }
            }
        });

        // Observe the entire document for added nodes
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Check if a node is the Missing Models popup and inject our buttons
     */
    checkAndInjectButton(node) {
        // Look for the Missing Models popup by finding elements with "Missing Models" text
        const findMissingModelsDialog = (element) => {
            // Check if this element or its children contain "Missing Models" heading
            const headings = element.querySelectorAll ? element.querySelectorAll('h2, h3, [class*="title"], [class*="header"]') : [];
            for (const heading of headings) {
                if (heading.textContent?.includes('Missing Models')) {
                    return element;
                }
            }
            // Also check text content directly
            if (element.textContent?.includes('Missing Models') && 
                element.textContent?.includes('following models were not found')) {
                return element;
            }
            return null;
        };

        const dialog = findMissingModelsDialog(node);
        if (!dialog) return;

        // Check if we already injected buttons
        if (dialog.querySelector('#model-resolver-btn-container')) return;

        // Find a suitable place to inject the button
        const injectButtons = () => {
            // Auto-resolve button (green)
            const autoResolveBtn = document.createElement('button');
            autoResolveBtn.id = 'model-resolver-btn-container'; // Use this ID to prevent duplicate injection
            autoResolveBtn.className = 'mr-popup-auto-resolve-btn';
            autoResolveBtn.textContent = '🔗 Auto-resolve 100%';
            this.dialog?.setTooltip(autoResolveBtn, 'Link every missing model that already has an exact local match, then open Model Resolver for the rest.');
            autoResolveBtn.addEventListener('click', async () => {
                await this.handleAutoResolveInPopup(dialog, autoResolveBtn);
            });

            // Find the "Don't show this again" checkbox row and add button next to it
            const checkbox = dialog.querySelector('input[type="checkbox"]');
            if (checkbox) {
                const checkboxRow = checkbox.closest('label') || checkbox.parentElement;
                if (checkboxRow && checkboxRow.parentElement) {
                    // Make the parent a flex container to align checkbox and button
                    checkboxRow.parentElement.classList.add('mr-popup-inline-actions');
                    // Insert button at the beginning (left side)
                    checkboxRow.parentElement.insertBefore(autoResolveBtn, checkboxRow);
                    return;
                }
            }

            // Fallback: Find the list of models and insert before it
            const modelList = dialog.querySelector('[style*="overflow"]') || 
                             dialog.querySelector('[class*="list"]') ||
                             dialog.querySelector('[class*="content"]');
            
            if (modelList) {
                // Create a wrapper and insert before the model list
                const wrapper = document.createElement('div');
                wrapper.className = 'mr-popup-actions-wrap';
                wrapper.appendChild(autoResolveBtn);
                modelList.parentElement?.insertBefore(wrapper, modelList);
            } else {
                // Find after the description text
                const allElements = dialog.querySelectorAll('*');
                for (const el of allElements) {
                    if (el.textContent?.includes('following models were not found') && 
                        el.children.length === 0) {
                        el.parentElement?.insertBefore(btnContainer, el.nextSibling);
                        break;
                    }
                }
            }
            
            log.debug('Model Resolver: Injected buttons into Missing Models popup');
        };

        // Small delay to ensure popup is fully rendered
        setTimeout(injectButtons, 100);
    }

    /**
     * Handle auto-resolve in the popup - resolve 100% matches and open Model Resolver for remaining
     */
    async handleAutoResolveInPopup(dialog, button) {
        button.textContent = '⏳ Resolving...';
        button.disabled = true;

        // Close the popup first
        const closeBtn = dialog.querySelector('button[class*="close"]') || 
                        dialog.querySelector('svg')?.closest('button') ||
                        Array.from(dialog.querySelectorAll('button')).find(b => 
                            b.textContent === '×' || b.innerHTML.includes('×') || b.innerHTML.includes('close'));
        
        if (closeBtn) {
            closeBtn.click();
        }

        // Small delay to let popup close
        await new Promise(r => setTimeout(r, 200));

// Create dialog if needed
        if (!this.dialog) {
            this.dialog = new ResolverManagerDialog();
            window.ModelResolverDialog = this.dialog;
        }
        
        // Run auto-resolve for 100% matches - returns the updated workflow
        const updatedWorkflow = await this.dialog.autoResolve100Percent();
        
        // Always open Model Resolver to show remaining unresolved models
        // Pass the updated workflow if available to avoid race condition
        this.dialog.show(updatedWorkflow || null);
    }

    /**
     * Mark resolved model items in the popup as linked (green) and hide download buttons
     */
    removeResolvedFromPopup(dialog, resolvedFilenames) {
        log.debug('Model Resolver: Looking for resolved filenames:', resolvedFilenames);
        
        // Strategy: For each filename, find text nodes containing it, 
        // then find the nearest Download button and mark that row
        for (const filename of resolvedFilenames) {
            // Get all text in the dialog and find elements containing our filename
            const walker = document.createTreeWalker(
                dialog,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent?.toLowerCase().includes(filename)) {
                    // Found text containing filename - now find parent with Download button
                    let parent = node.parentElement;
                    let attempts = 0;
                    
                    while (parent && parent !== dialog && attempts < 10) {
                        // Look for Download button at this level
                        const downloadBtn = Array.from(parent.querySelectorAll('button'))
                            .find(btn => btn.textContent?.includes('Download') && 
                                        !btn.id?.includes('model-resolver'));
                        
                        if (downloadBtn) {
                            log.debug('Model Resolver: Found entry for', filename);
                            this.markEntryAsResolved(parent, downloadBtn);
                            break;
                        }
                        
                        parent = parent.parentElement;
                        attempts++;
                    }
                    
                    // Only process first match for this filename
                    break;
                }
            }
        }
    }

    /**
     * Mark a model entry as resolved with visual feedback
     */
    markEntryAsResolved(container, downloadBtn) {
        // Already marked?
        if (container.dataset.resolved === 'true') return;
        container.dataset.resolved = 'true';
        
        log.debug('Model Resolver: Marking entry as resolved', container);
        
        // Add green background/styling to the container
        container.classList.add('mr-resolved-entry');
        
        // Hide the Download button and replace with badge
        if (downloadBtn) {
            // Create badge
            const badge = document.createElement('span');
            badge.className = 'mr-resolved-badge';
            badge.textContent = '✓ Linked';
            
            // Replace download button with badge
            downloadBtn.style.display = 'none';
            downloadBtn.parentElement?.insertBefore(badge, downloadBtn);
        }
        
        // Find and hide Copy URL button
        const allBtns = container.querySelectorAll('button');
        for (const btn of allBtns) {
            if (btn.textContent?.includes('Copy URL')) {
                btn.style.display = 'none';
            }
        }
    }

    /**
     * Count remaining model items in the popup
     */
    countRemainingItems(dialog) {
        // Count elements that look like model entries (have Download buttons)
        const downloadButtons = dialog.querySelectorAll('button');
        let count = 0;
        for (const btn of downloadButtons) {
            if (btn.textContent?.includes('Download') && !btn.id?.includes('model-resolver')) {
                count++;
            }
        }
        return count;
    }

    /**
     * Update nodes directly in the graph without triggering a full workflow reload
     * This prevents the Missing Models popup from closing
     */
    updateNodesDirectly(resolutions) {
        if (!app?.graph) {
            console.warn('Model Resolver: Cannot update nodes - graph not available');
            return;
        }

        for (const resolution of resolutions) {
            const nodeId = resolution.node_id;
            const widgetIndex = resolution.widget_index;
            const resolvedPath = resolution.resolved_path;

            // Find the node in the graph
            const node = app.graph.getNodeById(nodeId);
            if (!node) {
                console.warn(`Model Resolver: Node ${nodeId} not found in graph`);
                continue;
            }

            // Update the widget value
            if (node.widgets && node.widgets[widgetIndex]) {
                const widget = node.widgets[widgetIndex];
                widget.value = resolvedPath;
                
                // Trigger widget callback if it exists
                if (widget.callback) {
                    widget.callback(resolvedPath, app.graph, node, null, null);
                }
                
                log.debug(`Model Resolver: Updated node ${nodeId} widget ${widgetIndex} to ${resolvedPath}`);
            } else if (node.widgets_values) {
                // Fallback: update widgets_values array directly
                node.widgets_values[widgetIndex] = resolvedPath;
                log.debug(`Model Resolver: Updated node ${nodeId} widgets_values[${widgetIndex}] to ${resolvedPath}`);
            }

            // Mark node as dirty to trigger redraw
            if (node.setDirtyCanvas) {
                node.setDirtyCanvas(true, true);
            }
        }

        // Trigger canvas redraw
        if (app.graph.setDirtyCanvas) {
            app.graph.setDirtyCanvas(true, true);
        }
    }

    /**
     * Check if auto-open is enabled in user settings
     */
    isAutoOpenEnabled() {
        return localStorage.getItem('ModelResolver.autoOpenOnMissing') !== 'false';
    }

    /**
     * Set auto-open preference
     */
    setAutoOpenEnabled(enabled) {
        localStorage.setItem('ModelResolver.autoOpenOnMissing', enabled ? 'true' : 'false');
    }

    /**
     * Check for missing models and auto-open dialog if any are found
     */
    async checkAndOpenForMissingModels() {
        // Check if auto-open is enabled
        if (!this.isAutoOpenEnabled()) {
            return;
        }

        // Prevent multiple simultaneous checks
        if (this.isCheckingMissing) {
            return;
        }

        this.isCheckingMissing = true;

        try {
            // Small delay to let workflow fully load
            await new Promise(r => setTimeout(r, 500));

            // Get current workflow
            const workflow = app?.graph?.serialize();
            if (!workflow) {
                return;
            }

            // Create a simple hash to detect if workflow changed
            const workflowHash = JSON.stringify(workflow.nodes?.map(n => n.type + ':' + JSON.stringify(n.widgets_values || [])));
            
            // Skip if we already checked this exact workflow
            if (this.lastCheckedWorkflow === workflowHash) {
                return;
            }
            this.lastCheckedWorkflow = workflowHash;

            // Call analyze endpoint to check for missing models
            let data;
            try {
                data = await this.dialog.fetchJson('/model_resolver/analyze', {
                    method: 'POST',
                    body: JSON.stringify({ workflow }),
                    silent: true
                }, 'Analyze workflow');
            } catch (error) {
                console.warn('Model Resolver: Failed to analyze workflow for missing models');
                return;
            }
            
            // Auto-open dialog if there are missing models
            if (data.total_missing > 0) {
                log.debug(`Model Resolver: Found ${data.total_missing} missing model(s), opening dialog...`);
                this.openResolverManager();
            }

        } catch (error) {
            console.error('Model Resolver: Error checking for missing models:', error);
        } finally {
            this.isCheckingMissing = false;
        }
    }

    removeExistingButton() {
        // Remove any existing button by ID
        const existingButton = document.getElementById(this.buttonId);
        if (existingButton) {
            existingButton.remove();
        }

        document.querySelectorAll('.comfyui-button-group button.comfyui-button').forEach((button) => {
            const label = button.querySelector('span')?.textContent?.trim() || button.textContent?.trim();
            if (label === 'Model Resolver') {
                button.closest('.comfyui-button-group')?.remove();
            }
        });

        // Remove button group if it exists
        if (this.buttonGroup?.element?.parentNode) {
            this.buttonGroup.element.remove();
            this.buttonGroup = null;
        }

        // Also remove the stored reference if it exists
        if (this.resolverButton && this.resolverButton.parentNode) {
            this.resolverButton.remove();
            this.resolverButton = null;
        }
    }

    createFloatingButton() {
        // Create a floating button as fallback for legacy ComfyUI versions
        this.resolverButton = $el("button", {
            id: this.buttonId,
            textContent: "🔗 Model Resolver",
            onclick: () => {
                this.openResolverManager();
            },
            className: "model-resolver-floating-button"
        });

        document.body.appendChild(this.resolverButton);
        this.trackOpenTooltipTarget(this.resolverButton);
    }

    async openResolverManager(options = {}) {
        try {
            if (!this.dialog) {
                this.dialog = new ResolverManagerDialog();
                window.ModelResolverDialog = this.dialog;
            }
            if (options.dockContainer && !options.forceFloating) {
                await this.dialog.showDocked(options.dockContainer, options.workflow || null);
                return;
            }

            const wasDocked = this.dialog.docked;
            const showPromise = this.dialog.show(options.workflow || null);

            if (options.closeSidebarContainer && !wasDocked) {
                this.dialog.closeComfySidebar(options.closeSidebarContainer);
            }

            await showPromise;
        } catch (error) {
            console.error("🔗 Model Resolver: Error creating/showing dialog:", error);
            showNotification("Error opening Model Resolver: " + error.message, "error");
        }
    }
}
