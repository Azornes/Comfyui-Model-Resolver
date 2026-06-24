import { $el, ComfyDialog } from "../../../../scripts/ui.js";
import { dialogShellMethods } from "./shell/dialog_shell_methods.js";
import { lifecycleGraphMethods } from "./shell/lifecycle_graph_methods.js";
import { workflowStateMethods } from "./shell/workflow_state_methods.js";
import { workflowUpdateMethods } from "./shell/workflow_update_methods.js";
import { modelInfoMethods } from "./views/model_info_methods.js";
import { missingBrowserMethods } from "./views/missing_browser_methods.js";
import { optionsMethods } from "./views/options_methods.js";
import { tabsLoadedMethods } from "./views/tabs_loaded_methods.js";
import { downloadTargetMethods } from "./search/download_target_methods.js";
import { searchPanelMethods } from "./search/search_panel.js";
import { queueMethods } from "./actions/queue_methods.js";
import { resolveDownloadMethods } from "./actions/resolve_download_methods.js";
import { selectionMethods } from "./actions/selection_methods.js";
import { renderFormatMethods } from "./utils/render_format_methods.js";
import { getSvgIcon } from "../utils/icon_utils.js";
export class ResolverManagerDialog extends ComfyDialog {
    constructor() {
        super();
        this.currentWorkflow = null;
        this.missingModels = [];
        this.allModels = null; // list of all available models for dropdown
        this.downloadDirectories = null;
        this.downloadRootDirectories = null;
        this.capabilities = null;
        this.baseModels = null;
        this.downloadSubfolders = new Map();
        this.downloadTargetSelections = new Map(); // missing model key -> user/suggested download target
        this.pendingResolutions = [];
        this.pendingIndex = new Map(); // key -> index in pendingResolutions
        this.workflowPendingSelections = new Map(); // workflow key -> queued selections
        this.workflowAnalysisCaches = new Map(); // workflow key -> analyzed missing models
        this.workflowLoadedModelCaches = new Map(); // workflow key -> loaded model inspector data
        this.workflowSearchResultCaches = new Map(); // workflow key -> search results by missing model
        this.workflowDownloadTargetSelectionCaches = new Map(); // workflow key -> suggested/user download folders
        this.activeDownloads = {};  // Track active downloads
        this.downloadHistoryStorageKey = 'model_resolver_download_history';
        this.downloadHistoryLimit = 200;
        this.downloadHistory = [];
        this.downloadProgressByMissingKey = new Map(); // missing model key -> last known download UI state
        this.queuePanelActiveTab = 'queued';
        this.queueDownloadsActiveTab = 'active';
        this.searchResultCache = new Map();
        this.backgroundSearchJobs = new Map();
        this.searchProgressTimers = new Map();
        this.backendSearchProgressTimers = new Map();
        this.urnResolvePromises = new Map();
        this.urnLocalMatchPromises = new Map();
        this.cachedAnalysisData = null;
        this.cachedWorkflowSignature = null;
        this.cachedLoadedModelsData = null;
        this.cachedLoadedModelsSignature = null;
        this.selectedMissingModelKey = null;
        this.batchSelectedMissingKeys = new Set();
        this.lastBatchSelectedMissingKey = null;
        this.activeFooterMenu = null;
        this.batchSearchRunning = false;
        this.batchSearchCancelRequested = false;
        this.forceBatchSearch = false;
        this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
        this.activeTabStorageKey = 'model_resolver_active_tab';
        this.activeTab = this.restoreActiveTab();  // Default tab
        this.fullscreen = false;
        this.returnToDockedAfterFullscreen = false;
        this.docked = false;
        this.dockContainer = null;
        this.lastDockContainer = null;
        this.pendingDockToSidebar = false;
        this.sidebarTabId = "comfyui-model-resolver";
        this.sidebarOpenModeStorageKey = "model_resolver_sidebar_open_mode";
        this.missingBrowserSplitStorageKey = "model_resolver_missing_browser_detail_w";
        this.showResolvedModelsStorageKey = "model_resolver_show_resolved_models";
        this.localMatchAlternativesCollapsedStorageKey = "model_resolver_local_match_alternatives_collapsed";
        try {
            this.showResolvedModels = localStorage.getItem(this.showResolvedModelsStorageKey) === '1';
        } catch (e) {
            this.showResolvedModels = false;
        }
        try {
            this.localMatchAlternativesCollapsed = localStorage.getItem(this.localMatchAlternativesCollapsedStorageKey) === '1';
        } catch (e) {
            this.localMatchAlternativesCollapsed = false;
        }
        this.dockButton = null;
        this.undockButton = null;
        this._floatingRectBeforeDock = null;
        this._dragging = false;
        this._dragStart = null;
        this._analysisProgressToken = null;
        this._workflowDataLoadToken = null;
        this._loadedModelsLoadToken = null;
        this._locateAnimationFrame = null;
        this._viewportClampFrame = null;
        this.activeWorkflowRouteKey = this.getActiveWorkflowRouteKey();
        this.activeWorkflowSignature = null;
        this._workflowRefreshTimer = null;
        this._workflowRefreshRetryTimer = null;
        this._workflowRefreshGeneration = 0;
        this._workflowRefreshExpectedRoute = null;
        this._workflowRefreshPreviousSignature = null;
        this._comfyModelCatalogRefreshPromise = null;
        this._boundHandleViewportResize = () => this.scheduleModalViewportClamp(true);

        // Create backdrop overlay for click-outside-to-close
        this.backdrop = $el("div.model-resolver-backdrop", {
            parent: document.body
        });

        // Create context menu for model chips
        this.contextMenu = $el("div.mr-context-menu", {
            parent: document.body
        }, [
            $el("div.mr-context-menu-item.mr-context-menu-action-show-info", {
                "data-menu-action": "showInfo",
                onclick: () => this.handleContextMenuAction('showInfo')
            }, [
                $el("span.mr-context-menu-item-icon", {
                    innerHTML: getSvgIcon('eye', 'currentColor', 'mr-context-menu-item-svg')
                }),
                $el("span", { textContent: "Show Info" })
            ]),
            $el("div.mr-context-menu-item.mr-context-menu-action-show-more", {
                "data-menu-action": "showMore",
                onclick: () => this.handleContextMenuAction('showMore')
            }, [
                $el("span.mr-context-menu-item-icon", {
                    innerHTML: getSvgIcon('database', 'currentColor', 'mr-context-menu-item-svg')
                }),
                $el("span", { textContent: "Show More" })
            ]),
            $el("div.mr-context-menu-divider.mr-context-menu-divider-source", {
                "data-menu-divider": "source"
            }),
            $el("div.mr-context-menu-item.mr-context-menu-action-civitai", {
                "data-menu-action": "civitai",
                onclick: () => this.handleContextMenuAction('civitai')
            }, [
                $el("span.mr-context-menu-item-icon", {
                    innerHTML: getSvgIcon('civitai', 'currentColor', 'mr-context-menu-item-svg')
                }),
                $el("span", { textContent: "Open in CivitAI" })
            ]),
            $el("div.mr-context-menu-divider.mr-context-menu-divider-workflow", {
                "data-menu-divider": "workflow"
            }),
            $el("div.mr-context-menu-item.mr-context-menu-action-switch-workflow", {
                "data-menu-action": "switchWorkflow",
                onclick: () => this.handleContextMenuAction('switchWorkflow')
            }, [
                $el("span.mr-context-menu-item-icon", {
                    innerHTML: getSvgIcon('internalLink', 'currentColor', 'mr-context-menu-item-svg')
                }),
                $el("span", { textContent: "Switch to Workflow" })
            ]),
            $el("div.mr-context-menu-divider.mr-context-menu-divider-folder", {
                "data-menu-divider": "folder"
            }),
            $el("div.mr-context-menu-item.mr-context-menu-action-open-folder", {
                "data-menu-action": "openFolder",
                onclick: () => this.handleContextMenuAction('openFolder')
            }, [
                $el("span.mr-context-menu-item-icon", {
                    innerHTML: getSvgIcon('folderOpen', 'currentColor', 'mr-context-menu-item-svg')
                }),
                $el("span", { textContent: "Open Containing Folder" })
            ])
        ]);

        this.tooltipElement = $el("div.mr-global-tooltip", { parent: document.body });

        // Selected model for context menu
        this._contextMenuModel = null;

        // Create dialog element using $el
        this.element = $el("div.comfy-modal.model-resolver-modal", {
            id: "model-resolver-modal",
            parent: document.body
        }, [
            this.createHeader(),
            this.createContent(),
            this.createFooter()
        ]);

        this.tooltipObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        this.bindTooltips(node);
                    }
                }
            }
        });
        this.tooltipObserver.observe(this.element, {
            childList: true,
            subtree: true
        });
        this.bindTooltips(this.element);

        // Add click listener to hide context menu when clicking outside
        this.boundHandleContextMenuClick = (e) => this.handleContextMenuOutsideClick(e);
        document.addEventListener('click', this.boundHandleContextMenuClick);
        this.boundHandleFooterMenuClick = (e) => this.handleFooterMenuOutsideClick(e);
        document.addEventListener('click', this.boundHandleFooterMenuClick);
        window.addEventListener('resize', this._boundHandleViewportResize);
        this._boundSyncSearchProgressAfterResume = () => {
            if (document.visibilityState === 'hidden') return;
            window.setTimeout(() => this.syncSearchProgressAfterResume?.(), 0);
        };
        window.addEventListener('focus', this._boundSyncSearchProgressAfterResume);
        document.addEventListener('visibilitychange', this._boundSyncSearchProgressAfterResume);
    }
}

function applyDialogMethods(...sources) {
    for (const source of sources) {
        for (const key of Reflect.ownKeys(source)) {
            const descriptor = Object.getOwnPropertyDescriptor(source, key);
            descriptor.enumerable = false;
            Object.defineProperty(ResolverManagerDialog.prototype, key, descriptor);
        }
    }
}

applyDialogMethods(
    searchPanelMethods,
    modelInfoMethods,
    renderFormatMethods,
    workflowStateMethods,
    selectionMethods,
    dialogShellMethods,
    downloadTargetMethods,
    optionsMethods,
    tabsLoadedMethods,
    queueMethods,
    lifecycleGraphMethods,
    missingBrowserMethods,
    resolveDownloadMethods,
    workflowUpdateMethods
);
