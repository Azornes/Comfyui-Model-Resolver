import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { $el } from "../../../../scripts/ui.js";
import { createModuleLogger } from "../log_system/log_funcs.js";
import { logger as frontendLogger } from "../log_system/logger.js";
import { loadStylesWhenNeeded } from "../utils/css_loader.js";
import { isSidebarButtonActive } from "./utils/dom_patch_utils.js";
import { fetchJson as fetchJsonRequest } from "./utils/api_client.js";
import { ResolverManagerDialog } from "./resolver_dialog.js";
import { showNotification } from "../utils/notification_utils.js";
import { safeStorage } from "./utils/html_utils.js";
import {
    serializeKeybindingCombo,
    keybindingsEqual,
    getComboLabel,
} from "./utils/keybinding_utils.js";
import {
    buildModelResolverNodeMenu,
    getImmediateModelsForNode,
    getResolvedModelsForNode,
    isExistingResolvedModel,
    matchesWorkflowModelReference,
    toResolverContextModel,
} from "./node_context_menu.js";
import {
    getCustomNodeModelAdapter,
    getCustomNodeModelListSignature as createCustomNodeModelListSignature,
    getCustomNodeModelStrengthSignature as createCustomNodeModelStrengthSignature,
    isCustomNodeModelWidget as matchesCustomNodeModelWidget,
} from "./custom_nodes/registry.js";

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
const LEGACY_WORKFLOW_HASH_MARKER_NODE_TYPE = "ModelResolverWorkflowHashes";
const WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE = "ModelResolverDependency";
const WORKFLOW_DEPENDENCY_MARKER_DISPLAY_NAME = "Model Resolver Opener";
const WORKFLOW_DEPENDENCY_MARKER_AUX_ID = "Azornes/Comfyui-Model-Resolver";
const WORKFLOW_DEPENDENCY_MARKER_REPOSITORY = "https://github.com/Azornes/Comfyui-Model-Resolver";
const WORKFLOW_DEPENDENCY_MARKER_CNR_ID = "comfyui-model-resolver";
const WORKFLOW_DEPENDENCY_MARKER_BUTTON_NAME = "Open Model Resolver";
const WORKFLOW_DEPENDENCY_MARKER_AUTO_ID = -918273646;
const WORKFLOW_DEPENDENCY_MARKER_DEFAULT_SIZE = Object.freeze([160, 40]);
const WORKFLOW_DEPENDENCY_MARKER_MIN_SIZE = Object.freeze([160, 40]);
const ERROR_OVERLAY_SELECTOR = '[data-testid="error-overlay"]';
const ERROR_OVERLAY_MESSAGES_SELECTOR = '[data-testid="error-overlay-messages"]';
const ERROR_OVERLAY_DETAILS_BUTTON_SELECTOR = '[data-testid="error-overlay-see-errors"]';
const ERROR_OVERLAY_RESOLVER_BUTTON_SELECTOR = '[data-model-resolver-error-action="open"]';
const NATIVE_MISSING_MODEL_GROUP_SELECTOR = '[data-testid="error-group-missing-model"]';
const NATIVE_MISSING_MODEL_ITEM_SELECTOR = '[data-testid^="missing-model-"]';
const NATIVE_MISSING_MODEL_TEXT_PATTERN = /\bmissing\s+models?\b/i;
const NATIVE_ERROR_CHUNK_PATTERN = /(?:^|\/)\b(?:dialogService|settingStore)-[^/]+\.js(?:[?#]|$)/;

function getKeybindingSetting(id) {
    try {
        const value = app.ui?.settings?.getSettingValue?.(id);
        return Array.isArray(value) ? value : [];
    } catch (_error) {
        return [];
    }
}

function applyStoredFrontendLoggingPreference() {
    const stored = safeStorage.getItem('ModelResolver.frontendLogsEnabled');
    if (stored !== null) {
        frontendLogger.setEnabled(stored !== 'false');
    }
    const storedLevel = safeStorage.getItem('ModelResolver.frontendLogLevel');
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
        this.workflowHashMetadataCache = null;
        this.workflowHashMetadataSignature = null;
        this.workflowHashMetadataRefreshTimer = null;
        this.workflowHashMetadataRefreshing = false;
        this.workflowHashMetadataRefreshPending = false;
        this.workflowHashMetadataPendingWorkflow = null;
        this.workflowHashMetadataPendingSignature = null;
        this.workflowHashMetadataActiveSignature = null;
        this.workflowHashMetadataPreparing = false;
        this.nodeContextAnalysisData = null;
        this.nodeContextAnalysisSignature = null;
        this.nodeContextAnalysisPromise = null;
        this.nodeContextAnalysisTimer = null;
        this.customNodeModelAdapterStates = new WeakMap();
        this.missingModelsPopupObserver = null;
        this.nativeMissingModelsPending = false;
        this.nativeMissingModelsAutoOpened = false;
        this.nativeMissingModelStorePromise = null;
        this.nativeMissingModelStore = null;
        this.nativeMissingModelStoreUnsubscribe = null;
        this.nativeMissingModelStoreRetryAttempts = new WeakMap();
        this.autoOpenWorkflowAnalysisTimer = null;
        this.autoOpenWorkflowAnalysisPromise = null;
        this.autoOpenWorkflowAnalysisKey = null;
    }

    setup = async () => {
        window.ModelResolver = this;
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
        this.setupWorkflowHashMetadataInjection();
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

    getSidebarButton() {
        const button = document.querySelector(`.${this.sidebarTabId}-tab-button`);
        return button instanceof HTMLElement ? button : null;
    }

    getVisibleResolverButton() {
        const button = document.getElementById(this.buttonId);
        return button instanceof HTMLElement ? button : null;
    }

    handleResolverButtonClick = () => {
        this.openResolverManager();
    }

    activateResolverButton = () => {
        const button = this.getSidebarButton() || this.getVisibleResolverButton();
        if (button) {
            button.click();
            return;
        }

        this.handleResolverButtonClick();
    }

    getNodeContextWorkflowState() {
        const workflow = app?.graph?.serialize?.();
        if (!workflow) return { workflow: null, signature: null };

        const signature = this.dialog?.getMissingWorkflowSignature?.(workflow)
            || this.dialog?.getWorkflowSignature?.(workflow)
            || JSON.stringify(workflow);
        return { workflow, signature };
    }

    getSubgraphDefinitionIdForNode(node, workflow = null) {
        const runtimeSubgraphId = node?.subgraph?.id
            || node?._subgraph?.id
            || node?.subgraph_id
            || '';
        const nodeType = String(node?.type || '').trim();
        const definitions = workflow?.definitions?.subgraphs;
        if (Array.isArray(definitions)) {
            const definition = definitions.find(item => (
                String(item?.id || '') === nodeType
            ));
            if (definition?.id) return String(definition.id);
        }
        return runtimeSubgraphId ? String(runtimeSubgraphId) : '';
    }

    getNodeContextScope(node, workflow = null) {
        const graph = node?.graph;
        const isTopLevel = !graph || graph === app?.graph;
        const subgraphInstanceId = this.getSubgraphDefinitionIdForNode(node, workflow);
        if (isTopLevel) {
            return {
                is_top_level: true,
                subgraph_id: subgraphInstanceId || undefined,
                subgraph_instance_id: subgraphInstanceId || undefined,
                is_subgraph_instance: Boolean(subgraphInstanceId),
            };
        }

        const subgraphId = graph?._subgraph?.id
            || graph?.subgraph?.id
            || graph?._id
            || graph?.id
            || '';
        return {
            is_top_level: false,
            subgraph_id: subgraphId ? String(subgraphId) : undefined,
            subgraph_instance_id: subgraphInstanceId || undefined,
            is_subgraph_instance: Boolean(subgraphInstanceId),
        };
    }

    getCurrentNodeContextAnalysis(signature) {
        if (
            signature
            && this.dialog?.cachedWorkflowSignature === signature
            && this.dialog?.cachedAnalysisData
        ) {
            return this.dialog.cachedAnalysisData;
        }
        if (
            signature
            && this.nodeContextAnalysisSignature === signature
            && this.nodeContextAnalysisData
        ) {
            return this.nodeContextAnalysisData;
        }
        return null;
    }

    scheduleNodeContextMenuAnalysis(delay = 350) {
        if (this.nodeContextAnalysisTimer) {
            clearTimeout(this.nodeContextAnalysisTimer);
        }
        this.nodeContextAnalysisTimer = setTimeout(() => {
            this.nodeContextAnalysisTimer = null;
            this.refreshNodeContextMenuAnalysis();
        }, delay);
    }

    async refreshNodeContextMenuAnalysis({ force = false } = {}) {
        if (!this.dialog) return null;

        const workflowRefreshPending = (
            this.dialog.isVisible?.()
            && (this.dialog._workflowRefreshTimer || this.dialog._workflowRefreshRetryTimer)
        );
        if (!force && workflowRefreshPending) {
            this.scheduleNodeContextMenuAnalysis(180);
            return null;
        }

        const { workflow, signature } = this.getNodeContextWorkflowState();
        if (!workflow || !signature) return null;

        const cachedData = this.getCurrentNodeContextAnalysis(signature);
        if (!force && cachedData) return cachedData;
        if (this.nodeContextAnalysisPromise) return this.nodeContextAnalysisPromise;

        const analysisRequest = this.dialog.getWorkflowAnalysisRequest?.(workflow, {
            silent: true,
        });
        if (!analysisRequest?.promise) return null;

        const analysisPromise = analysisRequest.promise
            .then((data) => {
                const currentState = this.getNodeContextWorkflowState();
                if (currentState.signature === signature) {
                    this.nodeContextAnalysisSignature = signature;
                    this.nodeContextAnalysisData = data;
                }
                return data;
            })
            .catch((error) => {
                log.debug('Model Resolver: node context analysis failed.', error);
                return null;
            })
            .finally(() => {
                if (this.nodeContextAnalysisPromise === analysisPromise) {
                    this.nodeContextAnalysisPromise = null;
                }
                const currentState = this.getNodeContextWorkflowState();
                if (currentState.signature && currentState.signature !== signature) {
                    this.scheduleNodeContextMenuAnalysis(0);
                }
            });

        this.nodeContextAnalysisPromise = analysisPromise;
        return analysisPromise;
    }

    getResolvedModelsForNodeContextMenu(node) {
        const { workflow, signature } = this.getNodeContextWorkflowState();
        const scope = this.getNodeContextScope(node, workflow);
        const data = this.getCurrentNodeContextAnalysis(signature);
        if (!data) {
            this.scheduleNodeContextMenuAnalysis(0);
            const previousData = this.nodeContextAnalysisData
                || this.dialog?.cachedAnalysisData;
            return getImmediateModelsForNode(
                previousData || {},
                node,
                scope
            );
        }

        return getResolvedModelsForNode(
            data,
            node?.id,
            scope
        );
    }

    async ensureCurrentNodeContextAnalysis() {
        if (this.nodeContextAnalysisTimer) {
            clearTimeout(this.nodeContextAnalysisTimer);
            this.nodeContextAnalysisTimer = null;
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const { signature } = this.getNodeContextWorkflowState();
            const cachedData = this.getCurrentNodeContextAnalysis(signature);
            if (cachedData) return cachedData;

            await this.refreshNodeContextMenuAnalysis({ force: true });
        }

        const { signature } = this.getNodeContextWorkflowState();
        return this.getCurrentNodeContextAnalysis(signature);
    }

    async resolveNodeContextMenuModel(model) {
        if (!model?.resolution_pending) return model;

        const data = await this.ensureCurrentNodeContextAnalysis();
        const resolvedModel = (data?.resolved_models || [])
            .filter(candidate => isExistingResolvedModel(candidate))
            .find(candidate => matchesWorkflowModelReference(candidate, model));

        if (!resolvedModel) {
            showNotification('The selected model could not be resolved after the workflow update.', 'warning');
            return null;
        }
        return resolvedModel;
    }

    configureNodeContextMenu(nodeType) {
        const isNodeInstance = Boolean(
            nodeType
            && !nodeType.prototype
            && nodeType.constructor?.prototype
        );
        const target = isNodeInstance ? nodeType : nodeType?.prototype;
        if (!target) {
            return;
        }

        if (isNodeInstance) {
            const hasOwnMenuHook = Object.prototype.hasOwnProperty.call(target, 'getExtraMenuOptions')
                || Object.prototype.hasOwnProperty.call(target, 'getMenuOptions');
            if (!hasOwnMenuHook || target.__modelResolverContextMenuInstancePatched) {
                return;
            }
        } else if (target.__modelResolverContextMenuPatched) {
            return;
        }

        const owner = this;
        const hasOwnExtraMenuOptions = Object.prototype.hasOwnProperty.call(
            target,
            'getExtraMenuOptions'
        );
        const hasOwnMenuOptions = Object.prototype.hasOwnProperty.call(
            target,
            'getMenuOptions'
        );
        const originalGetExtraMenuOptions = target.getExtraMenuOptions;
        const originalGetMenuOptions = target.getMenuOptions;
        const addModelResolverMenu = (node, targetOptions) => {
            if (!Array.isArray(targetOptions)) return;
            if (targetOptions.some(option => (
                String(option?.className || '').includes('mr-model-resolver-node-menu')
            ))) {
                return;
            }

            const models = owner.getResolvedModelsForNodeContextMenu(node);
            const menu = buildModelResolverNodeMenu(models, {
                showInResolver: async model => {
                    const resolvedModel = await owner.resolveNodeContextMenuModel(model);
                    if (resolvedModel) {
                        owner.showResolvedNodeModelInResolver(resolvedModel);
                    }
                },
                showInfo: async model => {
                    const resolvedModel = await owner.resolveNodeContextMenuModel(model);
                    if (resolvedModel) {
                        owner.dialog?.showModelInfo(toResolverContextModel(resolvedModel));
                    }
                },
                openContainingFolder: async model => {
                    const resolvedModel = await owner.resolveNodeContextMenuModel(model);
                    if (resolvedModel) {
                        owner.dialog?.openContainingFolder(toResolverContextModel(resolvedModel));
                    }
                },
            }, {
                formatCategory: category => owner.dialog?.getCategoryDisplayName?.(category),
            });

            if (menu) targetOptions.unshift(menu);
        };
        const originalOnWidgetChanged = target.onWidgetChanged;
        if (!isNodeInstance || hasOwnExtraMenuOptions) {
            target.getExtraMenuOptions = function(_, options) {
                const result = originalGetExtraMenuOptions?.apply(this, arguments);
                const targetOptions = Array.isArray(options)
                    ? options
                    : (Array.isArray(result) ? result : null);
                addModelResolverMenu(this, targetOptions);
                return result;
            };
        }
        // ComfyUI treats the presence of getMenuOptions as an alternate menu
        // provider. Only wrap node types that already implement it; adding an
        // undefined method makes the native context menu return no options.
        if (typeof originalGetMenuOptions === 'function' && (!isNodeInstance || hasOwnMenuOptions)) {
            target.getMenuOptions = function() {
                const result = originalGetMenuOptions.apply(this, arguments);
                const targetOptions = Array.isArray(result)
                    ? result
                    : (Array.isArray(arguments[1]) ? arguments[1] : null);
                addModelResolverMenu(this, targetOptions);
                return result;
            };
        }
        if (!isNodeInstance) {
            target.onWidgetChanged = function() {
                const result = originalOnWidgetChanged?.apply(this, arguments);
                const widgetName = arguments[0];
                const handledByCustomNodeAdapter = owner.isCustomNodeModelWidget?.(
                    this,
                    widgetName
                );
                if (handledByCustomNodeAdapter) {
                    owner.customNodeModelAdapterStates?.get(this)?.notify?.();
                } else if (!owner.dialog?.isWorkflowRefreshSuppressed?.()) {
                    if (!owner.dialog?.isWorkflowStrengthWidgetName?.(widgetName)) {
                        owner.scheduleNodeContextMenuAnalysis();
                    }
                    owner.dialog?.scheduleActiveWorkflowRefresh?.('node-widget-change');
                }
                return result;
            };
            target.__modelResolverContextMenuPatched = true;
        } else {
            target.__modelResolverContextMenuInstancePatched = true;
        }
    }

    isCustomNodeModelWidget(node, widgetName = '') {
        return matchesCustomNodeModelWidget(node, widgetName);
    }

    getCustomNodeModelListSignature(node) {
        return createCustomNodeModelListSignature(node);
    }

    getCustomNodeModelStrengthSignature(node) {
        return createCustomNodeModelStrengthSignature(node);
    }

    configureCustomNodeModelAdapter(node) {
        const adapter = getCustomNodeModelAdapter(node);
        if (!adapter || !Array.isArray(node?.widgets)) return;

        const owner = this;
        if (!(this.customNodeModelAdapterStates instanceof WeakMap)) {
            this.customNodeModelAdapterStates = new WeakMap();
        }
        let state = this.customNodeModelAdapterStates.get(node);
        if (!state) {
            state = {
                signature: this.getCustomNodeModelListSignature(node),
                strengthSignature: this.getCustomNodeModelStrengthSignature(node),
            };
            this.customNodeModelAdapterStates.set(node, state);
        } else {
            state.signature = this.getCustomNodeModelListSignature(node);
            state.strengthSignature = this.getCustomNodeModelStrengthSignature(node);
        }

        const notifyIfModelsChanged = () => {
            const nextSignature = owner.getCustomNodeModelListSignature(node);
            const nextStrengthSignature = owner.getCustomNodeModelStrengthSignature(node);
            const modelListChanged = nextSignature !== state.signature;
            const strengthChanged = nextStrengthSignature !== state.strengthSignature;
            state.signature = nextSignature;
            state.strengthSignature = nextStrengthSignature;
            if (owner.dialog?.isWorkflowRefreshSuppressed?.()) return;

            if (
                modelListChanged
            ) {
                owner.scheduleNodeContextMenuAnalysis();
                owner.dialog?.scheduleActiveWorkflowRefresh?.('node-widget-change');
            } else if (strengthChanged) {
                owner.dialog?.updateLoadedModelStrengthsFromNode?.(node);
            }
        };
        state.notify = notifyIfModelsChanged;
        adapter.observe(node, notifyIfModelsChanged);
    }

    waitForResolverDialogReady(timeoutMs = 2500) {
        const startedAt = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                if (this.dialog?.isVisible?.() && this.dialog?.contentElement) {
                    resolve(true);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(false);
                    return;
                }
                setTimeout(check, 40);
            };
            check();
        });
    }

    waitForWorkflowModelSelection(request, timeoutMs = 120000) {
        const startedAt = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                if (!request || request.status !== 'pending') {
                    resolve(request || null);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    request.status = 'timeout';
                    if (this.dialog?.pendingWorkflowModelSelection === request) {
                        this.dialog.pendingWorkflowModelSelection = null;
                    }
                    resolve(request);
                    return;
                }
                setTimeout(check, 50);
            };
            check();
        });
    }

    async showResolvedNodeModelInResolver(reference) {
        if (!this.dialog) return;

        const wasVisible = Boolean(this.dialog.isVisible?.());
        const wasOnMissingTab = this.dialog.activeTab === 'missing';
        const { signature } = this.getNodeContextWorkflowState();
        const analysisData = this.getCurrentNodeContextAnalysis(signature);
        if (signature && analysisData) {
            this.dialog.cachedWorkflowSignature = signature;
            this.dialog.cachedAnalysisData = analysisData;
        }

        this.dialog.persistActiveTab?.('missing');

        if (wasVisible && wasOnMissingTab) {
            const selected = this.dialog.selectWorkflowModelReference?.(
                reference,
                analysisData || this.dialog.cachedAnalysisData,
                { preferExistingBrowser: true }
            );
            if (selected) return;
        }

        this.dialog.showResolvedModels = true;
        this.dialog.missingModelsTypeFilter = 'all';
        this.dialog.missingModelsTypeFilterMenuOpen = false;
        safeStorage.setItem(this.dialog.showResolvedModelsStorageKey, '1');

        const selectionRequest = this.dialog.queueWorkflowModelReferenceSelection?.(reference);
        if (!wasVisible) {
            this.dialog.activeTab = 'missing';
            this.activateResolverButton();
        }
        if (!await this.waitForResolverDialogReady()) {
            if (selectionRequest?.status === 'pending') {
                selectionRequest.status = 'open-failed';
            }
            if (this.dialog.pendingWorkflowModelSelection === selectionRequest) {
                this.dialog.pendingWorkflowModelSelection = null;
            }
            showNotification('Could not open Model Resolver.', 'error');
            return;
        }

        if (wasVisible && !wasOnMissingTab) {
            await this.dialog.switchTab?.('missing', { force: true });
        } else if (wasVisible) {
            await this.dialog.loadWorkflowData?.();
        }

        const completedRequest = await this.waitForWorkflowModelSelection(selectionRequest);
        if (completedRequest?.status === 'timeout') {
            showNotification('Could not select the model after workflow analysis completed.', 'warning');
        }
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
                if (isSidebarButtonActive(button)) {
                    button.click();
                }
            });
        }
    }

    renderSidebarPanel(element) {
        element.style.height = "100%";
        element.classList.add("mr-sidebar-dock-panel");

        if (!this.dialog) {
            this.dialog = new ResolverManagerDialog();
            window.ModelResolverDialog = this.dialog;
        }
        this.dialog.rememberDockDropPreviewWidth?.(element);

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
                action: this.handleResolverButtonClick,
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
        } catch (_e) {
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

        window.__ModelResolverWorkflowChangeOwner = this;

        if (!window.__ModelResolverLoadGraphDataPatched && typeof app.loadGraphData === 'function') {
            const originalLoadGraphData = app.loadGraphData;
            app.loadGraphData = function(...args) {
                if (args[0] && typeof args[0] === 'object') {
                    window.__ModelResolverWorkflowHashMetadataOwner?.removeLegacyWorkflowHashMarkerNode(args[0]);
                }
                window.__ModelResolverWorkflowChangeOwner?.recordNativeWorkflowWarningsFromArguments(args);
                const result = originalLoadGraphData.apply(this, args);
                Promise.resolve(result).then(() => {
                    window.__ModelResolverWorkflowChangeOwner?.recordNativeWorkflowWarningsFromArguments(args);
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

        const routeHandler = () => {
            window.__ModelResolverWorkflowChangeOwner?.handleActiveWorkflowRouteChange('route-change');
        };
        const activeWorkflowHandler = () => {
            window.__ModelResolverWorkflowChangeOwner?.handleActiveWorkflowRouteChange('active-workflow-change');
        };
        const documentClickHandler = (event) => {
            const owner = window.__ModelResolverWorkflowChangeOwner;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('#model-resolver-modal, .model-resolver-backdrop')) return;
            if (!owner?.dialog?.isVisible()) return;
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
        this.scheduleWorkflowHashMetadataRefresh();
        if (!this.dialog?.isVisible()) return;
        this.dialog.scheduleActiveWorkflowRefresh(reason);
    }

    isWorkflowHashMetadataEnabled() {
        return safeStorage.getItem('ModelResolver.workflowHashMetadataEnabled') !== 'false';
    }

    isWorkflowDependencyMarkerEnabled() {
        return safeStorage.getItem('ModelResolver.workflowDependencyMarkerEnabled') === 'true';
    }

    setupWorkflowHashMetadataInjection() {
        window.__ModelResolverWorkflowHashMetadataOwner = this;
        if (window.__ModelResolverWorkflowHashMetadataPatched) {
            this.scheduleWorkflowHashMetadataRefresh();
            this.configureWorkflowDependencyMarkerNodes();
            return;
        }

        if (!app?.graph || typeof app.graph.serialize !== 'function') return;

        const originalSerialize = app.graph.serialize;
        app.graph.serialize = function(...args) {
            const workflow = originalSerialize.apply(this, args);
            window.__ModelResolverWorkflowHashMetadataOwner?.removeLegacyWorkflowHashMarkerNode(workflow);
            window.__ModelResolverWorkflowHashMetadataOwner?.configureSerializedWorkflowDependencyMarkerNodes(workflow);
            window.__ModelResolverWorkflowHashMetadataOwner?.injectWorkflowHashMetadata(workflow);
            window.__ModelResolverWorkflowHashMetadataOwner?.injectWorkflowDependencyMarker(workflow);
            window.__ModelResolverWorkflowHashMetadataOwner?.scheduleWorkflowHashMetadataRefresh(workflow);
            return workflow;
        };
        window.__ModelResolverWorkflowHashMetadataPatched = true;
        this.configureWorkflowDependencyMarkerNodes();
        this.scheduleWorkflowHashMetadataRefresh();
    }

    removeLegacyWorkflowHashMarkerNode(workflow) {
        if (!workflow || !Array.isArray(workflow.nodes)) return workflow;
        workflow.nodes = workflow.nodes.filter((node) => node?.type !== LEGACY_WORKFLOW_HASH_MARKER_NODE_TYPE);
        return workflow;
    }

    isWorkflowDependencyMarkerNode(node) {
        if (!node) return false;
        const candidates = [
            node.type,
            node.comfyClass,
            node.comfy_class,
            node.constructor?.ComfyClass,
            node.constructor?.comfyClass,
            node.constructor?.nodeData?.name,
        ];
        return candidates.some((candidate) => candidate === WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE);
    }

    isWorkflowDependencyMarkerNodeType(nodeType, nodeData) {
        const candidates = [
            nodeData?.name,
            nodeData?.node_id,
            nodeData?.class_type,
            nodeType?.ComfyClass,
            nodeType?.comfyClass,
            nodeType?.type,
            nodeType?.prototype?.comfyClass,
        ];
        return candidates.some((candidate) => candidate === WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE);
    }

    configureWorkflowDependencyMarkerNodeType(nodeType, nodeData) {
        if (!this.isWorkflowDependencyMarkerNodeType(nodeType, nodeData)) return;
        const proto = nodeType?.prototype;
        if (!proto || proto.__modelResolverDependencyMarkerTypePatched) return;

        const resolver = this;
        const originalOnNodeCreated = proto.onNodeCreated;
        proto.onNodeCreated = function(...args) {
            const result = originalOnNodeCreated?.apply(this, args);
            resolver.configureWorkflowDependencyMarkerNode(this);
            return result;
        };

        const originalComputeSize = proto.computeSize;
        proto.computeSize = function(...args) {
            originalComputeSize?.apply(this, args);
            return [...WORKFLOW_DEPENDENCY_MARKER_MIN_SIZE];
        };

        proto.__modelResolverDependencyMarkerTypePatched = true;
    }

    applyWorkflowDependencyMarkerSize(node) {
        if (!Array.isArray(node?.size)) return;

        const width = Number(node.size[0]);
        const height = Number(node.size[1]);
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            node.size = [...WORKFLOW_DEPENDENCY_MARKER_DEFAULT_SIZE];
            return;
        }

        if (node.__modelResolverDependencySizeInitialized) return;

        const [defaultWidth, defaultHeight] = WORKFLOW_DEPENDENCY_MARKER_DEFAULT_SIZE;
        const shouldCompact =
            width > defaultWidth + 25
            || height > defaultHeight + 16;

        if (shouldCompact) {
            const compactSize = [
                Math.min(width, defaultWidth),
                Math.min(height, defaultHeight),
            ];
            if (typeof node.setSize === 'function') {
                node.setSize(compactSize);
            } else {
                node.size = compactSize;
            }
        }

        node.__modelResolverDependencySizeInitialized = true;
    }

    configureWorkflowDependencyMarkerNode(node) {
        if (!this.isWorkflowDependencyMarkerNode(node)) return node;

        node.properties = node.properties && typeof node.properties === 'object' ? node.properties : {};
        delete node.properties.cnr_id;
        node.properties.aux_id = WORKFLOW_DEPENDENCY_MARKER_AUX_ID;
        node.properties.repository = WORKFLOW_DEPENDENCY_MARKER_REPOSITORY;
        node.properties.registry_id = WORKFLOW_DEPENDENCY_MARKER_CNR_ID;
        node.properties.purpose = "Declares Model Resolver as an intentional workflow dependency.";
        node.properties["Node name for S&R"] = WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE;

        node.widgets = Array.isArray(node.widgets)
            ? node.widgets.filter((widget) => widget?.name !== 'note')
            : [];
        const existingOpenButton = node.widgets.find(
            (widget) => widget?.__modelResolverOpenButton || widget?.name === WORKFLOW_DEPENDENCY_MARKER_BUTTON_NAME
        );
        if (existingOpenButton) {
            existingOpenButton.callback = () => this.activateResolverButton();
            existingOpenButton.value = WORKFLOW_DEPENDENCY_MARKER_BUTTON_NAME;
            existingOpenButton.__modelResolverOpenButton = true;
            existingOpenButton.options = existingOpenButton.options && typeof existingOpenButton.options === 'object'
                ? existingOpenButton.options
                : {};
            existingOpenButton.options.serialize = false;
        } else if (typeof node.addWidget === 'function') {
            const button = node.addWidget(
                "button",
                WORKFLOW_DEPENDENCY_MARKER_BUTTON_NAME,
                WORKFLOW_DEPENDENCY_MARKER_BUTTON_NAME,
                () => this.activateResolverButton(),
                { serialize: false }
            );
            if (button) {
                button.__modelResolverOpenButton = true;
                button.options = button.options && typeof button.options === 'object' ? button.options : {};
                button.options.serialize = false;
            }
        }

        this.applyWorkflowDependencyMarkerSize(node);

        if (!node.__modelResolverDependencySerializePatched) {
            const originalOnSerialize = node.onSerialize;
            node.onSerialize = function(serialized) {
                const result = typeof originalOnSerialize === 'function'
                    ? originalOnSerialize.call(this, serialized)
                    : undefined;
                window.__ModelResolverWorkflowHashMetadataOwner?.configureSerializedDependencyMarkerNode(serialized);
                return result;
            };
            node.__modelResolverDependencySerializePatched = true;
        }

        node.graph?.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        return node;
    }

    configureWorkflowDependencyMarkerNodes(graph = app?.graph) {
        const nodes = graph?._nodes || graph?.nodes || [];
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
            this.configureWorkflowDependencyMarkerNode(node);
        }
    }

    configureSerializedDependencyMarkerNode(node) {
        if (!node || node.type !== WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE) return node;

        node.properties = node.properties && typeof node.properties === 'object' ? node.properties : {};
        delete node.properties.cnr_id;
        node.properties.aux_id = WORKFLOW_DEPENDENCY_MARKER_AUX_ID;
        node.properties.repository = WORKFLOW_DEPENDENCY_MARKER_REPOSITORY;
        node.properties.registry_id = WORKFLOW_DEPENDENCY_MARKER_CNR_ID;
        node.properties.purpose = "Declares Model Resolver as an intentional workflow dependency.";
        node.properties["Node name for S&R"] = WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE;

        node.widgets_values = [];

        return node;
    }

    configureSerializedWorkflowDependencyMarkerNodes(workflow) {
        if (!workflow || !Array.isArray(workflow.nodes)) return workflow;
        for (const node of workflow.nodes) {
            this.configureSerializedDependencyMarkerNode(node);
        }
        return workflow;
    }

    findWorkflowDependencyMarkerNode(graph = app?.graph) {
        const nodes = graph?._nodes || graph?.nodes || [];
        return Array.isArray(nodes)
            ? nodes.find((node) => this.isWorkflowDependencyMarkerNode(node)) || null
            : null;
    }

    getDependencyMarkerGraphPosition() {
        const visibleArea = app?.canvas?.ds?.visible_area;
        if (Array.isArray(visibleArea) && visibleArea.length >= 4) {
            const [x, y, w] = visibleArea;
            const dpi = Math.max(window.devicePixelRatio || 1, 1);
            return [x + Math.max(24, (w - 360) / dpi / 2), y + 48];
        }
        return [0, 0];
    }

    addWorkflowDependencyMarkerNode() {
        const graph = app?.graph;
        const liteGraph = window.LiteGraph;
        if (!graph || typeof liteGraph?.createNode !== 'function') {
            showNotification("Could not access the current workflow graph.", "error");
            return null;
        }

        const existing = this.findWorkflowDependencyMarkerNode(graph);
        if (existing) {
            this.configureWorkflowDependencyMarkerNode(existing);
            app.canvas?.centerOnNode?.(existing);
            showNotification("Model Resolver opener node is already in this workflow.", "info");
            return existing;
        }

        const node = liteGraph.createNode(
            WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE,
            WORKFLOW_DEPENDENCY_MARKER_DISPLAY_NAME,
            { pos: this.getDependencyMarkerGraphPosition() }
        );
        if (!node) {
            showNotification("Model Resolver opener node is not available. Restart ComfyUI after updating the extension.", "error");
            return null;
        }

        node.size = [...WORKFLOW_DEPENDENCY_MARKER_DEFAULT_SIZE];
        this.configureWorkflowDependencyMarkerNode(node);
        graph.add(node);
        app.canvas?.centerOnNode?.(node);
        graph.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        showNotification("Model Resolver opener node added.", "success");
        return node;
    }

    getWorkflowDependencyMarkerPosition(workflow) {
        const nodes = Array.isArray(workflow?.nodes)
            ? workflow.nodes.filter((node) => node?.type !== WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE && Array.isArray(node?.pos))
            : [];
        if (!nodes.length) return [0, 0];

        const xs = nodes.map((node) => Number(node.pos[0])).filter(Number.isFinite);
        const ys = nodes.map((node) => Number(node.pos[1])).filter(Number.isFinite);
        if (!xs.length || !ys.length) return [0, 0];

        return [Math.min(...xs), Math.min(...ys) - 170];
    }

    getWorkflowDependencyMarkerId(workflow) {
        const usedIds = new Set(
            (Array.isArray(workflow?.nodes) ? workflow.nodes : [])
                .map((node) => Number(node?.id))
                .filter(Number.isFinite)
        );
        let id = WORKFLOW_DEPENDENCY_MARKER_AUTO_ID;
        while (usedIds.has(id)) id -= 1;
        return id;
    }

    createSerializedWorkflowDependencyMarkerNode(workflow) {
        return this.configureSerializedDependencyMarkerNode({
            id: this.getWorkflowDependencyMarkerId(workflow),
            type: WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE,
            pos: this.getWorkflowDependencyMarkerPosition(workflow),
            size: [...WORKFLOW_DEPENDENCY_MARKER_DEFAULT_SIZE],
            flags: {},
            order: -1,
            mode: 0,
            inputs: [],
            outputs: [],
            properties: {},
            widgets_values: [],
        });
    }

    injectWorkflowDependencyMarker(workflow) {
        if (!workflow || typeof workflow !== 'object') return workflow;
        if (!this.isWorkflowDependencyMarkerEnabled()) return workflow;

        workflow.nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
        const existing = workflow.nodes.find((node) => node?.type === WORKFLOW_DEPENDENCY_MARKER_NODE_TYPE);
        if (existing) {
            this.configureSerializedDependencyMarkerNode(existing);
            return workflow;
        }

        workflow.nodes.push(this.createSerializedWorkflowDependencyMarkerNode(workflow));
        return workflow;
    }

    injectWorkflowHashMetadata(workflow) {
        if (!workflow || typeof workflow !== 'object') return workflow;
        if (!this.isWorkflowHashMetadataEnabled()) return workflow;

        const cache = this.workflowHashMetadataCache;
        if (!cache || !Array.isArray(cache.models) || !cache.models.length) return workflow;

        workflow.extra = workflow.extra && typeof workflow.extra === 'object' ? workflow.extra : {};
        workflow.extra.model_resolver_hashes = {
            version: 1,
            source: 'comfyui-model-resolver',
            models: cache.models,
            updated_at: cache.updated_at || Date.now()
        };
        return workflow;
    }

    getWorkflowHashMetadataSignature(workflow) {
        if (!workflow || typeof workflow !== 'object') return '';

        const dependencySignature = this.dialog?.getMissingWorkflowSignature?.(workflow)
            || this.dialog?.getWorkflowSignature?.(workflow);
        if (dependencySignature) return dependencySignature;

        const normalizeNode = (node = {}) => ({
            id: node.id,
            type: node.type,
            mode: node.mode,
            widgets_values: node.widgets_values,
            inputs: Array.isArray(node.inputs)
                ? node.inputs.map(input => ({
                    name: input?.name,
                    type: input?.type,
                    link: input?.link,
                    widget: input?.widget
                }))
                : [],
            outputs: Array.isArray(node.outputs)
                ? node.outputs.map(output => ({
                    name: output?.name,
                    type: output?.type,
                    links: output?.links
                }))
                : [],
            properties: node.properties
        });
        const normalizeDefinition = (definition = {}) => ({
            id: definition.id,
            name: definition.name,
            nodes: Array.isArray(definition.nodes)
                ? definition.nodes.map(normalizeNode)
                : [],
            links: Array.isArray(definition.links) ? definition.links : []
        });
        const definitions = workflow.definitions && typeof workflow.definitions === 'object'
            ? Object.fromEntries(Object.entries(workflow.definitions).map(([key, value]) => [
                key,
                Array.isArray(value)
                    ? value.map(normalizeDefinition)
                    : normalizeDefinition(value)
            ]))
            : {};

        try {
            return JSON.stringify({
                nodes: Array.isArray(workflow.nodes)
                    ? workflow.nodes.map(normalizeNode)
                    : [],
                links: Array.isArray(workflow.links) ? workflow.links : [],
                definitions
            });
        } catch (error) {
            log.debug('Model Resolver: workflow hash signature generation failed', error);
            return '';
        }
    }

    armWorkflowHashMetadataRefresh(delay = 800) {
        if (this.workflowHashMetadataRefreshTimer) {
            clearTimeout(this.workflowHashMetadataRefreshTimer);
        }
        this.workflowHashMetadataRefreshTimer = setTimeout(() => {
            this.workflowHashMetadataRefreshTimer = null;
            this.flushWorkflowHashMetadataRefresh();
        }, delay);
    }

    scheduleWorkflowHashMetadataRefresh(workflow = null) {
        if (!this.isWorkflowHashMetadataEnabled() || this.workflowHashMetadataPreparing) return;

        const signature = workflow
            ? this.getWorkflowHashMetadataSignature(workflow)
            : null;
        if (
            signature
            && (
                signature === this.workflowHashMetadataSignature
                || signature === this.workflowHashMetadataActiveSignature
                || (
                    this.workflowHashMetadataRefreshPending
                    && signature === this.workflowHashMetadataPendingSignature
                )
            )
        ) {
            return;
        }

        this.workflowHashMetadataRefreshPending = true;
        this.workflowHashMetadataPendingWorkflow = workflow;
        this.workflowHashMetadataPendingSignature = signature;
        this.armWorkflowHashMetadataRefresh();
    }

    async flushWorkflowHashMetadataRefresh() {
        if (!this.workflowHashMetadataRefreshPending) return;
        if (this.workflowHashMetadataRefreshing) {
            this.armWorkflowHashMetadataRefresh(200);
            return;
        }

        const workflow = this.workflowHashMetadataPendingWorkflow;
        const signature = this.workflowHashMetadataPendingSignature;
        this.workflowHashMetadataRefreshPending = false;
        this.workflowHashMetadataPendingWorkflow = null;
        this.workflowHashMetadataPendingSignature = null;
        await this.refreshWorkflowHashMetadata(workflow, signature);
    }

    async refreshWorkflowHashMetadata(workflow = null, scheduledSignature = null) {
        if (this.workflowHashMetadataRefreshing || !this.isWorkflowHashMetadataEnabled()) return;

        let currentWorkflow = workflow;
        if (!currentWorkflow) {
            this.workflowHashMetadataPreparing = true;
            try {
                currentWorkflow = app?.graph?.serialize?.();
            } finally {
                this.workflowHashMetadataPreparing = false;
            }
        }
        if (!currentWorkflow) return;

        const signature = scheduledSignature
            || this.getWorkflowHashMetadataSignature(currentWorkflow);
        if (signature && signature === this.workflowHashMetadataSignature && this.workflowHashMetadataCache) {
            return;
        }

        this.workflowHashMetadataRefreshing = true;
        this.workflowHashMetadataActiveSignature = signature;
        try {
            const data = await fetchJsonRequest('/model_resolver/workflow-model-hashes', {
                method: 'POST',
                body: JSON.stringify({ workflow: currentWorkflow }),
                silent: true,
            }, 'Refresh workflow hash metadata', {
                apiClient: api,
                notify: null,
                logError: null,
                throwOnHttpError: false,
            });
            if (!data) return;
            if (!data?.enabled) {
                this.workflowHashMetadataCache = null;
                this.workflowHashMetadataSignature = signature;
                return;
            }
            this.workflowHashMetadataCache = {
                models: Array.isArray(data.models) ? data.models : [],
                by_path: data.by_path || {},
                by_node: data.by_node || {},
                updated_at: Date.now()
            };
            this.workflowHashMetadataSignature = signature;
        } catch (error) {
            log.debug('Model Resolver: workflow hash metadata refresh failed', error);
        } finally {
            this.workflowHashMetadataRefreshing = false;
            this.workflowHashMetadataActiveSignature = null;
            if (
                this.workflowHashMetadataRefreshPending
                && !this.workflowHashMetadataRefreshTimer
            ) {
                this.armWorkflowHashMetadataRefresh(200);
            }
        }
    }

    /**
     * Setup one lightweight observer for ComfyUI error surfaces.
     */
    setupMissingModelsPopupObserver() {
        this.missingModelsPopupObserver?.disconnect();

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    this.checkAndInjectErrorOverlayButton(node);
                    this.checkAndInjectButton(node);
                }
            }
        });

        this.missingModelsPopupObserver = observer;
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        this.checkAndInjectErrorOverlayButton(document.body);
    }

    /**
     * Reset native missing-model state after ComfyUI finishes configuring a graph.
     * The result itself is read from ComfyUI's native missing-model store.
     */
    handleNativeGraphConfigured() {
        this.nativeMissingModelsAutoOpened = false;

        // ComfyUI can finish its asynchronous model pipeline before it calls
        // this hook. Preserve that native result instead of clearing it when
        // the graph configuration hook runs afterwards.
        if (this.nativeMissingModelStore) {
            this.handleNativeMissingModelStoreChange(this.nativeMissingModelStore);
        } else {
            this.nativeMissingModelsPending = false;
        }
    }

    handleGraphConfigured() {
        this.handleNativeGraphConfigured();
        this.scheduleAutoOpenWorkflowAnalysis();
    }

    scheduleAutoOpenWorkflowAnalysis(delay = 500) {
        if (this.autoOpenWorkflowAnalysisTimer) {
            clearTimeout(this.autoOpenWorkflowAnalysisTimer);
            this.autoOpenWorkflowAnalysisTimer = null;
        }
        if (!this.isAutoOpenEnabled()) return;

        this.autoOpenWorkflowAnalysisTimer = setTimeout(() => {
            this.autoOpenWorkflowAnalysisTimer = null;
            void this.runAutoOpenWorkflowAnalysis();
        }, delay);
    }

    async runAutoOpenWorkflowAnalysis() {
        if (!this.isAutoOpenEnabled()) return null;
        if (this.autoOpenWorkflowAnalysisPromise) {
            return this.autoOpenWorkflowAnalysisPromise;
        }

        const { workflow, signature } = this.getNodeContextWorkflowState();
        if (!workflow || !signature) return null;

        const route = this.dialog?.getActiveWorkflowRouteKey?.() || '';
        const analysisKey = `${route}\n${signature}`;
        if (this.autoOpenWorkflowAnalysisKey === analysisKey) return null;

        const cachedData = this.getCurrentNodeContextAnalysis(signature);
        if (cachedData) {
            this.autoOpenWorkflowAnalysisKey = analysisKey;
            this.handleAutoOpenWorkflowAnalysisResult(cachedData, signature, analysisKey);
            return cachedData;
        }

        const analysisRequest = this.dialog?.getWorkflowAnalysisRequest?.(workflow, {
            silent: true,
        });
        if (!analysisRequest?.promise) return null;

        this.autoOpenWorkflowAnalysisKey = analysisKey;
        const analysisPromise = analysisRequest.promise
            .then((data) => {
                this.handleAutoOpenWorkflowAnalysisResult(data, signature, analysisKey);
                return data;
            })
            .catch((error) => {
                log.debug('Model Resolver: automatic missing-model analysis failed.', error);
                return null;
            })
            .finally(() => {
                if (this.autoOpenWorkflowAnalysisPromise === analysisPromise) {
                    this.autoOpenWorkflowAnalysisPromise = null;
                }

                const currentState = this.getNodeContextWorkflowState();
                const currentRoute = this.dialog?.getActiveWorkflowRouteKey?.() || '';
                const currentKey = currentState.signature
                    ? `${currentRoute}\n${currentState.signature}`
                    : '';
                if (
                    this.isAutoOpenEnabled()
                    && currentKey
                    && currentKey !== analysisKey
                ) {
                    this.scheduleAutoOpenWorkflowAnalysis(0);
                }
            });

        this.autoOpenWorkflowAnalysisPromise = analysisPromise;
        return analysisPromise;
    }

    handleAutoOpenWorkflowAnalysisResult(data, signature, analysisKey) {
        if (!data) return;

        const currentState = this.getNodeContextWorkflowState();
        const currentRoute = this.dialog?.getActiveWorkflowRouteKey?.() || '';
        const currentKey = currentState.signature
            ? `${currentRoute}\n${currentState.signature}`
            : '';
        if (currentKey !== analysisKey) return;

        const normalizedData = this.dialog?.applyResolvedSelectionAliasesToAnalysisData?.(data) || data;
        this.nodeContextAnalysisSignature = signature;
        this.nodeContextAnalysisData = normalizedData;

        if (this.dialog) {
            this.dialog.cachedWorkflowSignature = signature;
            this.dialog.cachedAnalysisData = this.dialog.cloneAnalysisData?.(normalizedData) || normalizedData;
        }

        if (!this.isAutoOpenEnabled() || Number(normalizedData.total_missing || 0) <= 0) return;

        log.debug(
            `Model Resolver: Found ${normalizedData.total_missing} missing model(s), opening dialog...`
        );
        this.openResolverForDetectedMissingModels();
    }

    /**
     * Store the missing-model result that ComfyUI attached to the workflow
     * after running its own native asset pipeline.
     */
    recordNativeWorkflowWarnings(workflow) {
        const pendingWarnings = workflow?.pendingWarnings;
        if (!pendingWarnings || typeof pendingWarnings !== 'object') {
            return;
        }
        if (!Object.prototype.hasOwnProperty.call(pendingWarnings, 'missingModelCandidates')) {
            return;
        }

        const missingModels = pendingWarnings.missingModelCandidates;
        this.nativeMissingModelsPending = Array.isArray(missingModels)
            && missingModels.length > 0;
        this.nativeMissingModelsAutoOpened = false;
        this.maybeAutoOpenForNativeMissingModels();
    }

    recordNativeWorkflowWarningsFromArguments(args = []) {
        if (!Array.isArray(args)) return;

        for (const arg of args) {
            if (arg && typeof arg === 'object' && arg.pendingWarnings) {
                this.recordNativeWorkflowWarnings(arg);
            }
        }
    }

    findNativeErrorChunkUrls() {
        const candidates = new Map();
        if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
            for (const entry of performance.getEntriesByType('resource')) {
                const url = entry.name;
                if (typeof url !== 'string') continue;
                if (!NATIVE_ERROR_CHUNK_PATTERN.test(url)) continue;

                const size = Number(entry.decodedBodySize || entry.transferSize || 0);
                candidates.set(url, Math.max(candidates.get(url) || 0, size));
            }
        }
        if (typeof document !== 'undefined') {
            for (const element of document.querySelectorAll('script[src], link[href]')) {
                const url = element.src || element.href;
                if (typeof url !== 'string') continue;
                if (!NATIVE_ERROR_CHUNK_PATTERN.test(url)) continue;
                if (!candidates.has(url)) candidates.set(url, 0);
            }
        }

        return Array.from(candidates.entries())
            .sort(([, sizeA], [, sizeB]) => sizeB - sizeA)
            .map(([url]) => url);
    }

    getNativeMissingModelStore() {
        if (this.nativeMissingModelStorePromise) {
            return this.nativeMissingModelStorePromise;
        }

        if (!this.findNativeErrorChunkUrls().length) {
            return Promise.resolve(null);
        }

        const lookupPromise = (async () => {
            const attemptedChunks = new Set();
            while (true) {
                const chunkUrl = this.findNativeErrorChunkUrls()
                    .find(url => !attemptedChunks.has(url));
                if (!chunkUrl) return null;
                attemptedChunks.add(chunkUrl);

                try {
                    const module = await import(chunkUrl);
                    const useMissingModelStore = Object.values(module).find(candidate => (
                        typeof candidate === 'function'
                        && candidate.$id === 'missingModel'
                    ));
                    if (typeof useMissingModelStore === 'function') {
                        return useMissingModelStore();
                    }
                } catch (_error) {
                    // Try the next ComfyUI dialog chunk if this one is only a loader.
                }
            }
        })();

        this.nativeMissingModelStorePromise = lookupPromise.then(store => {
            if (!store) this.nativeMissingModelStorePromise = null;
            return store;
        });

        return this.nativeMissingModelStorePromise;
    }

    getNativeMissingModelCandidates(store) {
        const candidates = store?.missingModelCandidates?.value
            ?? store?.missingModelCandidates;
        return Array.isArray(candidates) ? candidates : [];
    }

    handleNativeMissingModelStoreChange(store) {
        const hasMissingModels = this.getNativeMissingModelCandidates(store).length > 0;
        const wasPending = this.nativeMissingModelsPending;
        this.nativeMissingModelsPending = hasMissingModels;

        if (!hasMissingModels) {
            this.nativeMissingModelsAutoOpened = false;
            return;
        }

        if (!wasPending) {
            this.nativeMissingModelsAutoOpened = false;
        }
        this.maybeAutoOpenForNativeMissingModels();

        const root = document.body || document.documentElement;
        if (root) {
            this.checkAndInjectErrorOverlayButton(root);
        }
    }

    async subscribeToNativeMissingModelStore() {
        const store = await this.getNativeMissingModelStore();
        if (!store) return null;

        if (this.nativeMissingModelStore !== store) {
            this.nativeMissingModelStoreUnsubscribe?.();
            this.nativeMissingModelStore = store;
            this.nativeMissingModelStoreUnsubscribe = typeof store.$subscribe === 'function'
                ? store.$subscribe(() => {
                    this.handleNativeMissingModelStoreChange(store);
                }, { detached: true })
                : null;
        }

        this.handleNativeMissingModelStoreChange(store);
        return store;
    }

    async checkNativeStoreForMissingModels(overlay) {
        const store = await this.subscribeToNativeMissingModelStore();
        if (!store) {
            this.retryNativeStoreLookup(overlay);
            return;
        }
        if (!overlay.isConnected) return;

        // Re-enter the same synchronous path after the native store has been
        // read. The store subscription handles candidates that arrive later.
        this.checkAndInjectErrorOverlayButton(overlay);
    }

    retryNativeStoreLookup(overlay) {
        if (!overlay?.isConnected) return;

        const previousAttempt = this.nativeMissingModelStoreRetryAttempts.get(overlay) ?? 0;
        if (previousAttempt >= 6) return;

        const attempt = previousAttempt + 1;
        this.nativeMissingModelStoreRetryAttempts.set(overlay, attempt);
        const delay = Math.min(500, 25 * (2 ** (attempt - 1)));
        setTimeout(() => {
            if (overlay.isConnected) {
                void this.checkNativeStoreForMissingModels(overlay);
            }
        }, delay);
    }

    hasNativeMissingModelEvidence(overlay, detailsButton) {
        const detailsLabel = detailsButton?.textContent?.trim() || '';
        if (NATIVE_MISSING_MODEL_TEXT_PATTERN.test(detailsLabel)) {
            return true;
        }

        if (overlay.querySelector(NATIVE_MISSING_MODEL_ITEM_SELECTOR)) {
            return true;
        }

        if (document.querySelector(NATIVE_MISSING_MODEL_GROUP_SELECTOR)) {
            return true;
        }

        const overlayMessage = overlay.querySelector(ERROR_OVERLAY_MESSAGES_SELECTOR)?.textContent || '';
        if (/\b(?:required\s+)?models?\s+(?:is|are)\s+missing\b/i.test(overlayMessage)) {
            return true;
        }

        return this.nativeMissingModelsPending;
    }

    maybeAutoOpenForNativeMissingModels() {
        if (!this.nativeMissingModelsPending || !this.isAutoOpenEnabled()) {
            return;
        }
        if (this.nativeMissingModelsAutoOpened) {
            return;
        }

        this.nativeMissingModelsAutoOpened = true;
        this.openResolverForDetectedMissingModels();
    }

    /**
     * Add a Model Resolver action next to ComfyUI's native error details button.
     * The observer only reaches this method for newly added DOM nodes, so no
     * polling or workflow analysis is performed while the UI is idle.
     */
    checkAndInjectErrorOverlayButton(node) {
        const overlays = new Set();
        const addOverlay = (candidate) => {
            if (candidate) overlays.add(candidate);
        };

        addOverlay(node.matches?.(ERROR_OVERLAY_SELECTOR) ? node : null);
        addOverlay(node.closest?.(ERROR_OVERLAY_SELECTOR));
        node.querySelectorAll?.(ERROR_OVERLAY_SELECTOR).forEach(addOverlay);

        for (const overlay of overlays) {
            const detailsButton = overlay.querySelector(ERROR_OVERLAY_DETAILS_BUTTON_SELECTOR);
            if (!detailsButton?.parentElement) continue;
            if (overlay.querySelector(ERROR_OVERLAY_RESOLVER_BUTTON_SELECTOR)) continue;
            if (!this.hasNativeMissingModelEvidence(overlay, detailsButton)) {
                if (!this.nativeMissingModelStore) {
                    void this.checkNativeStoreForMissingModels(overlay);
                }
                continue;
            }

            this.maybeAutoOpenForNativeMissingModels();

            const resolverButton = document.createElement('button');
            resolverButton.type = 'button';
            resolverButton.setAttribute('data-model-resolver-error-action', 'open');
            resolverButton.className = detailsButton.className || '';
            resolverButton.textContent = 'Open Model Resolver';
            resolverButton.title = 'Open Model Resolver to resolve missing models.';
            resolverButton.style.marginLeft = '0.5rem';
            resolverButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.activateResolverButton();
            });

            detailsButton.parentElement.insertBefore(resolverButton, detailsButton.nextSibling);
        }
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
                        el.parentElement?.insertBefore(autoResolveBtn, el.nextSibling);
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
        
        return updatedWorkflow;
    }

    /**
     * Check if auto-open preference is enabled
     */
    isAutoOpenEnabled() {
        return safeStorage.getItem('ModelResolver.autoOpenOnMissing') === 'true';
    }

    openResolverForDetectedMissingModels() {
        if (this.dialog?.isVisible?.()) {
            this.dialog.scheduleActiveWorkflowRefresh?.('auto-open-missing-models');
            return;
        }

        this.activateResolverButton();
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
            onclick: this.handleResolverButtonClick,
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
