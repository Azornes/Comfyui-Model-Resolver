import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const queueMethods = {
    createContent() {
        // Wrap the body in a two-column layout: left = items, right = queued panel
        const body = $el("div", {
            id: "model-resolver-body"
        });

        this.contentElement = $el("div.mr-scrollable", {
            id: "model-resolver-content"
        });

        this.queueElement = $el("div", {
            id: "model-resolver-queue"
        }, [
            this.createQueuePanel()
        ]);

        // Splitter between content and queue
        this.splitterElement = $el("div", {
            id: "model-resolver-splitter",
            ondragstart: (e) => e.preventDefault()
        });

        body.appendChild(this.contentElement);
        body.appendChild(this.splitterElement);
        body.appendChild(this.queueElement);

        // Restore saved queue width and wire splitter
        try {
            const savedSplit = localStorage.getItem('model_resolver_split_w');
            if (savedSplit) {
                const w = parseInt(savedSplit, 10);
                if (!isNaN(w) && w > 0) {
                    this.queueElement.style.width = `${w}px`;
                }
            }
        } catch (e) { }

        try {
            const onSplitMouseDown = (e) => this.startSplitDrag(e);
            this.splitterElement.addEventListener('mousedown', onSplitMouseDown);
            this._splitterMouseDown = onSplitMouseDown;
        } catch (e) { }

        // Toggle icon always visible
        try {
            this.queueToggleIcon = $el("button", {
                id: "queue-toggle-icon",
                type: "button",
                "aria-label": "Toggle queued selections",
                onclick: (event) => this.onQueueEdgeClick(event),
                onmousedown: (event) => this.startQueueEdgeDrag(event)
            });
            body.appendChild(this.queueToggleIcon);
            this.updateQueueToggleIcon();
        } catch (e) { }

        // Restore queue collapsed state
        try {
            const col = localStorage.getItem('model_resolver_queue_collapsed');
            if (col === '1') this.setQueueCollapsed(true);
        } catch (e) { }

        return body;
    },

    createQueuePanel() {
        this.queuePanelActiveTab = this.queuePanelActiveTab || 'queued';
        this.queueClearButton = $el("button", {
            id: "queue-clear",
            className: "mr-btn mr-btn-secondary mr-btn-sm",
            textContent: "Clear All",
            onclick: () => this.clearAllQueued()
        });

        this.queueQueuedTabButton = $el("button.mr-tab.mr-queue-tab.mr-tab-active", {
            type: "button",
            "data-tab": "queued",
            role: "tab",
            onclick: () => this.setQueuePanelTab('queued')
        }, [$el("span.mr-tab-label", { textContent: "Queued (0)" })]);
        this.queueDownloadsTabButton = $el("button.mr-tab.mr-queue-tab", {
            type: "button",
            "data-tab": "downloads",
            role: "tab",
            onclick: () => this.setQueuePanelTab('downloads')
        }, [$el("span.mr-tab-label", { textContent: "Downloads (0)" })]);
        this.queueTabs = $el("div.mr-tabs.mr-queue-tabs", {
            role: "tablist",
            "aria-label": "Queue panel views"
        }, [
            this.queueQueuedTabButton,
            this.queueDownloadsTabButton
        ]);

        this.queueHeader = $el("div.mr-queue-header", {}, [
            this.queueClearButton
        ]);

        // Scrollable list
        this.queueList = $el("div#queue-list.mr-queue-list");

        const panel = $el("div.mr-queue-panel", {}, [
            $el("div.mr-queue-stack", {}, [this.queueTabs, this.queueHeader, this.queueList])
        ]);
        return panel;
    },

    setQueuePanelTab(tab) {
        const nextTab = tab === 'downloads' ? 'downloads' : 'queued';
        if (this.queuePanelActiveTab === nextTab) return;
        this.queuePanelActiveTab = nextTab;
        this.updateQueuePanel();
    },

    updateQueuePanel() {
        if (!this.queueList || !this.queueHeader) return;
        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        const downloads = this.getActiveQueuePanelDownloads();
        const activeTab = this.queuePanelActiveTab === 'downloads' ? 'downloads' : 'queued';
        const clearBtn = this.queueClearButton || this.queueHeader.querySelector('#queue-clear');
        const showActions = activeTab === 'queued';
        this.queueHeader.style.display = showActions ? '' : 'none';
        if (clearBtn) clearBtn.style.display = showActions ? '' : 'none';
        this.updateQueuePanelTabs(list.length, downloads.length, activeTab);

        if (activeTab === 'downloads') {
            this.renderQueueDownloads(downloads);
            return;
        }

        this.renderQueuedSelections(list);
    },

    updateQueuePanelTabs(queueCount, downloadCount, activeTab) {
        const queuedTab = this.queueQueuedTabButton || this.queueTabs?.querySelector?.('.mr-queue-tab[data-tab="queued"]');
        const downloadsTab = this.queueDownloadsTabButton || this.queueTabs?.querySelector?.('.mr-queue-tab[data-tab="downloads"]');
        const setTabLabel = (tab, label) => {
            const labelEl = tab?.querySelector?.('.mr-tab-label');
            if (labelEl) {
                labelEl.textContent = label;
            } else if (tab) {
                tab.textContent = label;
            }
        };
        if (queuedTab) {
            setTabLabel(queuedTab, `Queued (${queueCount})`);
            queuedTab.classList.toggle('mr-tab-active', activeTab === 'queued');
            queuedTab.setAttribute('aria-selected', activeTab === 'queued' ? 'true' : 'false');
        }
        if (downloadsTab) {
            setTabLabel(downloadsTab, `Downloads (${downloadCount})`);
            downloadsTab.classList.toggle('mr-tab-active', activeTab === 'downloads');
            downloadsTab.setAttribute('aria-selected', activeTab === 'downloads' ? 'true' : 'false');
        }
    },

    renderQueuedSelections(list) {
        if (!list.length) {
            this.queueList.innerHTML = '<div class="mr-queue-empty">No selections queued.</div>';
            return;
        }

        let html = '<div class="mr-queue-items">';
        for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const label = (r.resolved_model?.relative_path || r.resolved_model?.filename || r.resolved_path || '').toString();
            const nodeLabel = r.node_label || r.node_type || (r.subgraph_id ? 'Subgraph' : 'Node');
            const orig = (r.original_path || '').toString();
            const rmId = `queue-remove-${i}`;
            html += `<div class="mr-queue-item">`;
            html += `<div class="mr-queue-item-title">${this.escapeHtml(nodeLabel)} #${this.escapeHtml(String(r.node_id))}</div>`;
            html += `<div class="mr-queue-item-meta"><span>Original</span><code>${this.escapeHtml(orig)}</code></div>`;
            html += `<div class="mr-queue-item-selection"><span>Selected</span><code>${this.escapeHtml(label)}</code></div>`;
            html += `<div class="mr-queue-item-actions"><button id="${rmId}" class="mr-btn mr-btn-danger mr-btn-sm">Remove</button></div>`;
            html += `</div>`;
        }
        html += '</div>';
        this.queueList.innerHTML = html;

        // Wire remove buttons
        for (let i = 0; i < list.length; i++) {
            const rmId = `queue-remove-${i}`;
            const btn = this.queueList.querySelector(`#${rmId}`);
            if (btn) {
                btn.addEventListener('click', () => this.removeQueuedByIndex(i));
            }
        }
    },

    getActiveQueuePanelDownloads() {
        const entries = Object.entries(this.activeDownloads || {});
        if (!entries.length) return [];

        return entries
            .filter(([, info]) => Boolean(info?.missing))
            .map(([downloadId, info]) => ({ downloadId, info }));
    },

    getWorkflowLabelFromRouteKey(routeKey = '') {
        const rawRoute = String(routeKey || '').split('\n')[0].trim();
        if (!rawRoute) return '';

        const decodeLabel = (value = '') => {
            try {
                return decodeURIComponent(String(value || '').replace(/\+/g, ' '));
            } catch (error) {
                return String(value || '');
            }
        };
        const cleanRoutePart = (value = '') => this.cleanWorkflowLabel?.(decodeLabel(value)) || decodeLabel(value).trim();
        const commonRouteParts = new Set(['', '#', '/', 'workflow', 'workflows', 'view', 'tab', 'tabs', 'graph', 'graphs']);

        try {
            const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost';
            const url = new URL(rawRoute, base);
            const candidates = [
                url.searchParams.get('workflow'),
                url.searchParams.get('workflowName'),
                url.searchParams.get('workflow_name'),
                url.searchParams.get('name'),
                url.searchParams.get('filename'),
                url.searchParams.get('file'),
                url.hash ? new URLSearchParams(url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '').get('workflow') : '',
                url.hash ? new URLSearchParams(url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '').get('workflowName') : '',
                url.hash ? new URLSearchParams(url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '').get('name') : ''
            ];
            const found = candidates.map(cleanRoutePart).find(Boolean);
            if (found) return found;
        } catch (error) { /* fall through to manual route parsing */ }

        try {
            const hash = rawRoute.startsWith('#') ? rawRoute.slice(1) : rawRoute;
            const paramsText = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash.replace(/^\?/, '');
            const params = new URLSearchParams(paramsText);
            const candidates = [
                params.get('workflow'),
                params.get('workflowName'),
                params.get('workflow_name'),
                params.get('name'),
                params.get('filename'),
                params.get('file'),
                params.get('workflowId'),
                params.get('workflow_id'),
                params.get('tab'),
                params.get('id')
            ];
            const found = candidates.map(cleanRoutePart).find(Boolean);
            if (found) return found;
        } catch (error) { /* fall through to readable route */ }

        const withoutQuery = rawRoute.split('?')[0].split('&')[0];
        const parts = withoutQuery
            .replace(/^#/, '')
            .split(/[\\/]/)
            .map(part => cleanRoutePart(part))
            .filter(part => !commonRouteParts.has(part.toLowerCase()));
        if (parts.length) return parts[parts.length - 1];

        return cleanRoutePart(rawRoute
            .replace(/^#\/?/, '')
            .replace(/^\?/, '')
            .replace(/[?&](workflow|workflowName|workflow_name|name|filename|file|workflowId|workflow_id|tab|id)=/i, ' ')
            .replace(/[=&]+/g, ' '));
    },

    cleanWorkflowLabel(label = '') {
        return String(label || '')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^[*•\s]+|[×✕✖*•\s]+$/g, '')
            .trim();
    },

    getWorkflowTabActiveSelectors() {
        return [
            '[data-workflow-name][aria-selected="true"]',
            '[data-workflow-name].active',
            '[data-workflow-name].selected',
            '[data-workflow-id][aria-selected="true"]',
            '[data-workflow-id][data-active="true"]',
            '[data-workflow-id].active',
            '[data-workflow-id].selected',
            '[data-tab-id*="workflow" i][aria-selected="true"]',
            '[data-tab-id*="workflow" i][data-active="true"]',
            '[class*="workflow" i][class*="tab" i].active',
            '[class*="workflow" i][class*="tab" i].selected',
            '[class*="workflow" i][class*="tab" i].p-highlight',
            '[class*="workflow" i][class*="tab" i].p-tab-active',
            '[class*="tab" i][class*="workflow" i].active',
            '[class*="tab" i][class*="workflow" i].selected',
            '[class*="tab" i][class*="workflow" i].p-highlight',
            '[class*="tab" i][class*="workflow" i].p-tab-active',
            '[role="tab"][aria-selected="true"]',
            '[role="tab"][data-active="true"]',
            '[role="tab"].active',
            '[role="tab"].selected',
            '[role="tab"].p-highlight',
            '[role="tab"].p-tab-active'
        ];
    },

    getWorkflowTabSearchSelectors() {
        return [
            '[data-workflow-name]',
            '[data-workflow-id]',
            '[data-tab-id*="workflow" i]',
            '[aria-controls*="workflow" i]',
            '[class*="workflow" i][class*="tab" i]',
            '[class*="tab" i][class*="workflow" i]',
            '[role="tab"]'
        ];
    },

    getWorkflowTabElementClassText(element) {
        return String(element?.getAttribute?.('class') || '');
    },

    getWorkflowTabElementIdentity(element) {
        if (!element) return null;

        const workflowTabId = String(
            element.getAttribute?.('data-workflow-id')
            || element.dataset?.workflowId
            || element.getAttribute?.('data-tab-id')
            || element.dataset?.tabId
            || ''
        ).trim();
        const workflowTabName = String(
            element.getAttribute?.('data-workflow-name')
            || element.dataset?.workflowName
            || element.getAttribute?.('data-tab-title')
            || element.dataset?.tabTitle
            || ''
        ).trim();
        const workflowTabAriaControls = String(element.getAttribute?.('aria-controls') || '').trim();
        const title = String(element.getAttribute?.('title') || '').trim();
        const ariaLabel = String(element.getAttribute?.('aria-label') || '').trim();
        const workflowTabText = this.cleanWorkflowLabel(element.textContent || '');
        const workflowLabel = this.cleanWorkflowLabel(workflowTabName || title || ariaLabel || workflowTabText);

        return {
            element,
            workflowLabel,
            workflowTabId,
            workflowTabName,
            workflowTabAriaControls,
            workflowTabText,
            workflowTabTitle: title,
            workflowTabAriaLabel: ariaLabel
        };
    },

    isLikelyWorkflowTabElement(element, label = '') {
        if (!element) return false;
        if (element.closest?.('#model-resolver-modal, .model-resolver-backdrop')) return false;

        const attrText = [
            element.getAttribute?.('data-workflow-id') || '',
            element.getAttribute?.('data-workflow-name') || '',
            element.getAttribute?.('data-tab-id') || '',
            element.getAttribute?.('aria-controls') || '',
            element.getAttribute?.('title') || '',
            element.getAttribute?.('aria-label') || '',
            this.getWorkflowTabElementClassText(element)
        ].join(' ');

        if (/workflow|untitled|unsaved|\.json/i.test(`${label} ${attrText}`)) return true;
        if (element.hasAttribute?.('data-workflow-id') || element.hasAttribute?.('data-workflow-name')) return true;
        if (element.matches?.('[role="tab"]')) {
            const normalized = this.cleanWorkflowLabel(label).toLowerCase();
            if (!normalized) return false;
            if (/^(queued|downloads|missing|loaded|options|settings|queue|history|logs|console|manager)$/i.test(normalized)) {
                return false;
            }
            return true;
        }

        return false;
    },

    isWorkflowTabElementActive(element) {
        if (!element) return false;
        const classList = element.classList;
        return element.getAttribute?.('aria-selected') === 'true'
            || element.getAttribute?.('data-active') === 'true'
            || classList?.contains('active')
            || classList?.contains('selected')
            || classList?.contains('p-highlight')
            || classList?.contains('p-tab-active');
    },

    findActiveWorkflowTabElement() {
        if (typeof document === 'undefined') return null;

        for (const selector of this.getWorkflowTabActiveSelectors()) {
            let elements = [];
            try {
                elements = Array.from(document.querySelectorAll(selector));
            } catch (error) {
                continue;
            }

            for (const element of elements) {
                const identity = this.getWorkflowTabElementIdentity(element);
                if (!identity?.workflowLabel && !identity?.workflowTabId && !identity?.workflowTabName) continue;
                if (!this.isLikelyWorkflowTabElement(element, identity.workflowLabel)) continue;
                return identity;
            }
        }

        return null;
    },

    getActiveWorkflowTabContext() {
        const activeTab = this.findActiveWorkflowTabElement?.();
        const routeKey = this.getActiveWorkflowRouteKey?.() || this.activeWorkflowRouteKey || '';
        const workflow = this.getCurrentWorkflow?.();
        const workflowSignature = this.activeWorkflowSignature || (workflow ? this.getWorkflowSignature?.(workflow) : '') || '';
        const fallbackLabel = this.getWorkflowLabelFromComfyState?.()
            || activeTab?.workflowLabel
            || this.getWorkflowLabelFromRouteKey?.(routeKey)
            || 'Current workflow';

        return {
            workflowRouteKey: routeKey,
            workflowSignature,
            workflowLabel: activeTab?.workflowLabel || fallbackLabel,
            workflowTabId: activeTab?.workflowTabId || '',
            workflowTabName: activeTab?.workflowTabName || '',
            workflowTabAriaControls: activeTab?.workflowTabAriaControls || '',
            workflowTabText: activeTab?.workflowTabText || ''
        };
    },

    getWorkflowLabelFromComfyState() {
        const candidates = [];
        try {
            const activeWorkflow = app?.workflowManager?.activeWorkflow
                || app?.workflowManager?.workflow
                || app?.ui?.workflow?.activeWorkflow
                || app?.canvas?.workflow;
            candidates.push(
                activeWorkflow?.name,
                activeWorkflow?.title,
                activeWorkflow?.filename,
                activeWorkflow?.path?.split?.(/[\\/]/)?.pop?.(),
                activeWorkflow?.workflow?.name,
                activeWorkflow?.workflow?.title
            );
        } catch (error) { /* ignore unavailable Comfy internals */ }

        for (const candidate of candidates) {
            const label = this.cleanWorkflowLabel(candidate);
            if (label) return label;
        }
        return '';
    },

    getWorkflowLabelFromActiveTabElement() {
        return this.findActiveWorkflowTabElement?.()?.workflowLabel || '';
    },

    getActiveWorkflowDownloadLabel() {
        const stateLabel = this.getWorkflowLabelFromComfyState?.();
        if (stateLabel) return stateLabel;

        const tabLabel = this.getWorkflowLabelFromActiveTabElement?.();
        if (tabLabel) return tabLabel;

        const routeKey = this.getActiveWorkflowRouteKey?.() || this.activeWorkflowRouteKey || '';
        const routeLabel = this.getWorkflowLabelFromRouteKey(routeKey);
        return routeLabel || 'Current workflow';
    },

    getDownloadWorkflowLabel(info = {}) {
        return info.workflowLabel
            || this.getWorkflowLabelFromRouteKey(info.workflowRouteKey || '')
            || this.getWorkflowLabelFromRouteKey(info.workflowKey || '')
            || this.getActiveWorkflowDownloadLabel?.()
            || 'Unknown workflow';
    },

    getWorkflowContextRouteKey(context = {}) {
        const direct = context.workflow_route_key || context.workflowRouteKey || '';
        if (direct) return String(direct).split('\n')[0].trim();

        const key = context.workflow_key || context.workflowKey || '';
        return String(key || '').split('\n')[0].trim();
    },

    isUsableWorkflowRouteKey(routeKey = '') {
        const normalized = String(routeKey || '').trim();
        return Boolean(normalized && normalized !== '#');
    },

    getWorkflowContextSignature(context = {}) {
        const direct = context.workflow_signature || context.workflowSignature || '';
        if (direct) return String(direct).trim();

        const key = context.workflow_key || context.workflowKey || '';
        const parts = String(key || '').split('\n').map(part => part.trim()).filter(Boolean);
        return parts.length > 1 ? parts.slice(1).join('\n') : '';
    },

    getWorkflowContextLabel(context = {}) {
        return this.cleanWorkflowLabel(
            context.workflow_label
            || context.workflowLabel
            || context.workflow_tab_name
            || context.workflowTabName
            || context.workflow_tab_text
            || context.workflowTabText
            || this.getWorkflowLabelFromRouteKey?.(this.getWorkflowContextRouteKey(context))
            || ''
        );
    },

    getDownloadWorkflowRuntimeContext(context = {}) {
        const downloadId = context.download_id || context.downloadId || '';
        const info = downloadId ? this.activeDownloads?.[downloadId] : null;
        if (!info) return context;

        return {
            ...context,
            workflowRouteKey: context.workflowRouteKey || context.workflow_route_key || info.workflowRouteKey || '',
            workflow_route_key: context.workflow_route_key || context.workflowRouteKey || info.workflowRouteKey || '',
            workflowKey: context.workflowKey || info.workflowKey || '',
            workflowLabel: context.workflowLabel || context.workflow_label || info.workflowLabel || '',
            workflow_label: context.workflow_label || context.workflowLabel || info.workflowLabel || '',
            workflowSignature: context.workflowSignature || info.workflowSignature || '',
            workflowTabId: context.workflowTabId || context.workflow_tab_id || info.workflowTabId || '',
            workflow_tab_id: context.workflow_tab_id || context.workflowTabId || info.workflowTabId || '',
            workflowTabName: context.workflowTabName || context.workflow_tab_name || info.workflowTabName || '',
            workflow_tab_name: context.workflow_tab_name || context.workflowTabName || info.workflowTabName || '',
            workflowTabAriaControls: context.workflowTabAriaControls || context.workflow_tab_aria_controls || info.workflowTabAriaControls || '',
            workflow_tab_aria_controls: context.workflow_tab_aria_controls || context.workflowTabAriaControls || info.workflowTabAriaControls || '',
            workflowTabText: context.workflowTabText || context.workflow_tab_text || info.workflowTabText || '',
            workflow_tab_text: context.workflow_tab_text || context.workflowTabText || info.workflowTabText || ''
        };
    },

    canSwitchToDownloadWorkflow(context = {}) {
        context = this.getDownloadWorkflowRuntimeContext(context);
        const label = this.getWorkflowContextLabel(context);
        const hasSpecificLabel = Boolean(label && !/^(current workflow|unknown workflow|workflow)$/i.test(label));
        return Boolean(
            this.isUsableWorkflowRouteKey(this.getWorkflowContextRouteKey(context))
            || this.getWorkflowContextSignature(context)
            || hasSpecificLabel
            || context.workflow_tab_id
            || context.workflowTabId
            || context.workflow_tab_aria_controls
            || context.workflowTabAriaControls
        );
    },

    isDownloadWorkflowActive(context = {}) {
        context = this.getDownloadWorkflowRuntimeContext(context);
        const routeKey = this.getWorkflowContextRouteKey(context);
        const currentRoute = this.getActiveWorkflowRouteKey?.() || this.activeWorkflowRouteKey || '';
        if (this.isUsableWorkflowRouteKey(routeKey) && currentRoute && routeKey === currentRoute) return true;

        const signature = this.getWorkflowContextSignature(context);
        const currentSignature = this.activeWorkflowSignature || this.getWorkflowSignature?.(this.getCurrentWorkflow?.()) || '';
        if (signature && currentSignature && signature === currentSignature) return true;

        const activeTab = this.findActiveWorkflowTabElement?.();
        if (activeTab) {
            const targetTabId = String(context.workflow_tab_id || context.workflowTabId || '').trim();
            const targetTabName = String(context.workflow_tab_name || context.workflowTabName || '').trim();
            const targetAriaControls = String(context.workflow_tab_aria_controls || context.workflowTabAriaControls || '').trim();
            if (targetTabId && targetTabId === activeTab.workflowTabId) return true;
            if (targetTabName && targetTabName === activeTab.workflowTabName) return true;
            if (targetAriaControls && targetAriaControls === activeTab.workflowTabAriaControls) return true;
        }

        const label = this.cleanWorkflowLabel(this.getWorkflowContextLabel(context)).toLowerCase();
        const activeLabel = this.cleanWorkflowLabel(this.getActiveWorkflowDownloadLabel?.()).toLowerCase();
        return Boolean(label && activeLabel && label === activeLabel);
    },

    getDownloadQueueContext(progress = {}, info = {}, workflowLabel = '', downloadId = '') {
        const folderContext = this.getDownloadFolderContext?.(progress, info) || null;
        const missing = info?.missing || {};
        const label = workflowLabel || this.getDownloadWorkflowLabel?.(info) || '';
        const context = {
            ...(folderContext || {}),
            context_scope: 'download_queue',
            download_id: downloadId,
            open_folder_label: folderContext ? 'Open Download Folder' : '',
            name: folderContext?.name || progress?.filename || info?.filename || missing?.original_path?.split(/[\/\\]/).pop() || 'Download',
            workflow_label: label,
            workflow_route_key: info.workflowRouteKey || this.getWorkflowContextRouteKey(info) || '',
            workflow_tab_id: info.workflowTabId || '',
            workflow_tab_name: info.workflowTabName || '',
            workflow_tab_aria_controls: info.workflowTabAriaControls || '',
            workflow_tab_text: info.workflowTabText || '',
            node_id: missing.locate_node_id ?? missing.node_id ?? '',
            widget_index: missing.widget_index ?? '',
            subgraph_id: missing.locate_subgraph_id || missing.subgraph_id || '',
            is_top_level: missing.locate_is_top_level ?? missing.is_top_level ?? true
        };

        return (folderContext || this.canSwitchToDownloadWorkflow(context)) ? context : null;
    },

    getWorkflowTabComparisonValues(identity = {}, element = null) {
        if (!identity) return [];
        return [
            identity.workflowLabel,
            identity.workflowTabId,
            identity.workflowTabName,
            identity.workflowTabAriaControls,
            identity.workflowTabText,
            identity.workflowTabTitle,
            identity.workflowTabAriaLabel,
            element?.getAttribute?.('href') || '',
            element?.getAttribute?.('data-route') || '',
            element?.getAttribute?.('data-path') || ''
        ].map(value => String(value || '').trim()).filter(Boolean);
    },

    findWorkflowTabForDownload(context = {}) {
        if (typeof document === 'undefined') return null;

        context = this.getDownloadWorkflowRuntimeContext(context);
        const routeKey = this.getWorkflowContextRouteKey(context);
        const routeLabel = this.getWorkflowLabelFromRouteKey?.(routeKey) || '';
        const labelTargets = new Set([
            this.getWorkflowContextLabel(context),
            routeLabel,
            context.workflow_tab_text,
            context.workflowTabText,
            context.workflow_tab_name,
            context.workflowTabName
        ].map(value => this.cleanWorkflowLabel(value).toLowerCase()).filter(Boolean));
        const idTargets = new Set([
            context.workflow_tab_id,
            context.workflowTabId,
            context.workflow_tab_aria_controls,
            context.workflowTabAriaControls
        ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
        const routeTarget = String(routeKey || '').trim().toLowerCase();
        const seen = new Set();
        let bestMatch = null;

        for (const selector of this.getWorkflowTabSearchSelectors()) {
            let elements = [];
            try {
                elements = Array.from(document.querySelectorAll(selector));
            } catch (error) {
                continue;
            }

            for (const element of elements) {
                if (!element || seen.has(element)) continue;
                seen.add(element);

                const identity = this.getWorkflowTabElementIdentity(element);
                if (!identity || !this.isLikelyWorkflowTabElement(element, identity.workflowLabel)) continue;

                const values = this.getWorkflowTabComparisonValues(identity, element);
                const normalizedValues = values.map(value => this.cleanWorkflowLabel(value).toLowerCase()).filter(Boolean);
                const rawValues = values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
                let score = 0;

                for (const value of rawValues) {
                    if (idTargets.has(value)) score += 100;
                    if (routeTarget && value.includes(routeTarget)) score += 70;
                }

                for (const value of normalizedValues) {
                    if (labelTargets.has(value)) score += 80;
                    for (const target of labelTargets) {
                        if (target && value !== target && (value.includes(target) || target.includes(value))) score += 25;
                    }
                }

                if (this.isWorkflowTabElementActive(element)) score += 5;

                if (score > (bestMatch?.score || 0)) {
                    bestMatch = { element, score };
                }
            }
        }

        return bestMatch?.score > 0 ? bestMatch.element : null;
    },

    switchToDownloadWorkflow(context = {}) {
        context = this.getDownloadWorkflowRuntimeContext(context);
        if (!this.canSwitchToDownloadWorkflow(context)) {
            this.showNotification('No workflow information available for this download', 'error');
            return false;
        }

        const label = this.getWorkflowContextLabel(context) || 'workflow';
        if (this.isDownloadWorkflowActive(context)) {
            this.showNotification(`Already on workflow: ${label}`, 'info');
            return true;
        }

        const tab = this.findWorkflowTabForDownload(context);
        if (tab) {
            try {
                tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
                tab.click();
                setTimeout(() => {
                    window.dispatchEvent?.(new Event('model-resolver-active-workflowchange'));
                }, 30);
                this.showNotification(`Switched to workflow: ${label}`, 'success');
                return true;
            } catch (error) {
                console.warn('Model Resolver: failed to switch workflow tab', error);
            }
        }

        const routeKey = this.getWorkflowContextRouteKey(context);
        const currentRoute = this.getActiveWorkflowRouteKey?.() || '';
        if (this.isUsableWorkflowRouteKey(routeKey) && routeKey !== currentRoute && typeof window !== 'undefined') {
            try {
                window.location.hash = routeKey.startsWith('#') ? routeKey : `#${routeKey.replace(/^#/, '')}`;
                setTimeout(() => {
                    window.dispatchEvent?.(new Event('model-resolver-active-workflowchange'));
                }, 30);
                this.showNotification(`Switched to workflow: ${label}`, 'success');
                return true;
            } catch (error) {
                console.warn('Model Resolver: failed to switch workflow route', error);
            }
        }

        this.showNotification(`Could not find workflow tab: ${label}. It may be closed.`, 'error');
        return false;
    },

    getActiveQueuePanelDownloadIds() {
        return this.getActiveQueuePanelDownloads().map(({ downloadId }) => downloadId);
    },

    renderQueueDownloads(downloads) {
        if (!downloads.length) {
            this.queueList.innerHTML = '<div class="mr-queue-empty">No active downloads.</div>';
            return;
        }

        let html = '<div class="mr-queue-items mr-download-queue-items">';
        for (const { downloadId, info } of downloads) {
            const progress = info.lastProgress || {};
            const percent = Math.max(0, Math.min(100, Number(progress.progress) || 0));
            const filename = progress.filename
                || info.filename
                || info.missing?.download_source?.filename
                || info.missing?.original_path?.split(/[\/\\]/).pop()
                || 'model';
            const category = this.getCategoryDisplayName?.(info.category || info.missing?.category || '') || info.category || '';
            const nodeLabel = info.missing?.subgraph_name || info.missing?.node_type || (info.missing?.subgraph_id ? 'Subgraph' : 'Node');
            const downloaded = this.formatBytes(progress.downloaded || 0);
            const total = progress.total_size ? this.formatBytes(progress.total_size) : '';
            const progressMeta = this.formatDownloadProgressMeta?.(progress) || '';
            const status = progress.status || info.lastStatus || 'starting';
            const statusLabel = status === 'downloading'
                ? `${Math.round(percent)}%`
                : (status === 'starting' ? 'Starting' : status.replace(/_/g, ' '));
            const sizeText = total ? `${downloaded} / ${total}` : downloaded;
            const targetPath = progress.directory || info.downloadDirectory || info.downloadPath || '';
            const targetLabel = targetPath ? targetPath.split(/[\/\\]/).filter(Boolean).pop() || targetPath : '';
            const workflowLabel = this.getDownloadWorkflowLabel?.(info) || 'Unknown workflow';
            const contextModel = this.getDownloadQueueContext?.(progress, info, workflowLabel, downloadId);
            const hasFolderAction = Boolean(contextModel?.folder_path || contextModel?.download_directory || contextModel?.directory || contextModel?.path || contextModel?.resolved_path);
            const contextTooltip = hasFolderAction
                ? 'Right-click for workflow and download folder actions'
                : 'Right-click to switch to workflow';
            const contextData = contextModel
                ? ` data-model="${this.escapeHtml(encodeURIComponent(JSON.stringify(contextModel)))}" oncontextmenu="window.MLOpenContextMenu(event, this)" data-tooltip="${this.escapeHtml(contextTooltip)}"`
                : '';

            html += `<div class="mr-queue-item mr-download-queue-item"${contextData}>`;
            html += `<div class="mr-queue-item-title mr-download-queue-title">`;
            html += `<span data-tooltip="${this.escapeHtml(filename)}">${this.escapeHtml(filename)}</span>`;
            html += `<span class="mr-download-queue-status">${this.escapeHtml(statusLabel)}</span>`;
            html += `</div>`;
            html += `<div class="mr-queue-item-meta"><span>Model</span><code>${this.escapeHtml(nodeLabel)} #${this.escapeHtml(String(info.missing?.node_id ?? ''))}</code></div>`;
            html += `<div class="mr-queue-item-meta"><span>Workflow</span><code data-tooltip="${this.escapeHtml(workflowLabel)}">${this.escapeHtml(workflowLabel)}</code></div>`;
            if (category) {
                html += `<div class="mr-queue-item-meta"><span>Type</span><code>${this.escapeHtml(category)}</code></div>`;
            }
            if (targetLabel) {
                html += `<div class="mr-queue-item-meta"><span>Folder</span><code data-tooltip="${this.escapeHtml(targetPath)}">${this.escapeHtml(targetLabel)}</code></div>`;
            }
            html += `<div class="mr-download-queue-progress">`;
            html += `<div class="mr-progress-bar"><div class="mr-progress-fill" style="width: ${percent}%;"></div></div>`;
            html += `<div class="mr-progress-text"><span>${this.escapeHtml(sizeText)}</span><span>${this.escapeHtml(progressMeta)}</span></div>`;
            html += `</div>`;
            html += `<div class="mr-queue-item-actions"><button type="button" class="mr-btn mr-btn-danger mr-btn-sm mr-download-queue-cancel" data-download-id="${this.escapeHtml(downloadId)}">Cancel</button></div>`;
            html += `</div>`;
        }
        html += '</div>';
        this.queueList.innerHTML = html;

        this.queueList.querySelectorAll('.mr-download-queue-cancel').forEach(button => {
            button.addEventListener('click', () => {
                const downloadId = button.dataset.downloadId;
                if (downloadId) this.cancelDownload(downloadId);
            });
        });
    },

    // Remove queued by index
    removeQueuedByIndex(i) {
        const list = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        if (i < 0 || i >= list.length) return;
        const r = list[i];
        // Remove
        this.pendingResolutions.splice(i, 1);
        this.rebuildPendingIndex();
        this.savePendingQueueForActiveWorkflow();
        // Update per-item selected bar
        const m = { node_id: r.node_id, widget_index: r.widget_index, subgraph_id: r.subgraph_id, is_top_level: r.is_top_level };
        this.updateSelectedBarForMissing?.(m);
        this.updateApplyPendingButton?.();
        this.updateQueuePanel();
    },

    // Clear all queued selections
    clearAllQueued() {
        this.pendingResolutions = [];
        this.pendingIndex = new Map();
        this.savePendingQueueForActiveWorkflow();
        this.updateApplyPendingButton?.();
        this.updateQueuePanel();
        try {
            document.querySelectorAll('.model-resolver-selected').forEach(el => { el.style.display = 'none'; el.innerHTML = ''; });
        } catch (e) { /* ignore */ }
    },

    // Update selected bar for a specific missing model slot
    updateSelectedBarForMissing(missing) {
        if (!missing) return;
        const nodeId = missing.node_id;
        const widgetIndex = missing.widget_index;
        const subgraphId = missing.subgraph_id || '';
        const isTopLevel = missing.is_top_level !== false;
        const key = `${nodeId}:${widgetIndex}:${subgraphId}:${isTopLevel ? 'T' : 'F'}`;

        const selectedBar = document.getElementById(`selected-bar-${nodeId}-${widgetIndex}`);
        if (!selectedBar) return;

        // Find selection for this slot
        let selection = null;
        let selectionIdx = -1;
        if (this.pendingIndex.has(key)) {
            const idx = this.pendingIndex.get(key);
            if (idx >= 0 && idx < this.pendingResolutions.length) {
                selection = this.pendingResolutions[idx];
                selectionIdx = idx;
            }
        }

        if (!selection) {
            selectedBar.style.display = 'none';
            selectedBar.innerHTML = '';
            selectedBar.removeAttribute('data-model');
            selectedBar.removeAttribute('data-tooltip');
            selectedBar.oncontextmenu = null;
            return;
        }

        // Build selected bar content
        const label = selection.resolved_model?.relative_path || selection.resolved_model?.filename || selection.resolved_path || '';
        const selectedPath = selection.resolved_model?.path || selection.resolved_path || '';
        const selectedContext = selectedPath
            ? {
                context_scope: 'download_folder',
                open_folder_label: 'Open Containing Folder',
                name: selection.resolved_model?.filename || label,
                path: selectedPath,
                resolved_path: selectedPath,
                category: selection.category,
                original_path: selection.original_path
            }
            : null;
        const selectedContextAttrs = selectedContext
            ? ` data-model="${this.escapeHtml(encodeURIComponent(JSON.stringify(selectedContext)))}" oncontextmenu="window.MLOpenContextMenu(event, this)" data-tooltip="Right-click to open containing folder"`
            : '';
        if (selectedContext) {
            selectedBar.dataset.model = encodeURIComponent(JSON.stringify(selectedContext));
            selectedBar.dataset.tooltip = 'Right-click to open containing folder';
            selectedBar.oncontextmenu = (event) => {
                window.MLOpenContextMenu?.(event, selectedBar);
            };
        } else {
            selectedBar.removeAttribute('data-model');
            selectedBar.removeAttribute('data-tooltip');
            selectedBar.oncontextmenu = null;
        }
        const applyBtnId = `selected-apply-${nodeId}-${widgetIndex}`;
        const removeBtnId = `selected-remove-${nodeId}-${widgetIndex}`;

        selectedBar.innerHTML = `<div class="mr-selected-bar-inner"${selectedContextAttrs}>`;
        selectedBar.innerHTML += `<span class="mr-selected-label">✓ Selected:</span>`;
        selectedBar.innerHTML += `<code class="mr-selected-code">${this.escapeHtml(label)}</code>`;
        selectedBar.innerHTML += `<span class="mr-selected-actions">`;
        selectedBar.innerHTML += `<button id="${applyBtnId}" class="mr-btn mr-btn-primary mr-btn-sm" data-tooltip="Apply this selected local match to the workflow.">Apply</button>`;
        selectedBar.innerHTML += `<button id="${removeBtnId}" class="mr-btn mr-btn-danger mr-btn-sm">Remove</button>`;
        selectedBar.innerHTML += `</span>`;
        selectedBar.innerHTML += `</div>`;
        selectedBar.style.display = 'block';

        const applyBtn = selectedBar.querySelector(`#${applyBtnId}`);
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this.applyQueuedByKey(key, applyBtn);
            });
        }

        // Wire remove button - use key-based removal
        const removeBtn = selectedBar.querySelector(`#${removeBtnId}`);
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                this.removeQueuedByKey(key);
            });
        }
    },

    // Remove queued by key (more reliable than index)
    removeQueuedByKey(key) {
        if (!key || !this.pendingIndex.has(key)) return;

        // Find and remove the item with this key
        const idx = this.pendingIndex.get(key);
        if (idx >= 0 && idx < this.pendingResolutions.length) {
            const r = this.pendingResolutions[idx];
            // Update the selected bar before removing
            const m = { node_id: r.node_id, widget_index: r.widget_index, subgraph_id: r.subgraph_id, is_top_level: r.is_top_level };

            // Remove from array
            this.pendingResolutions.splice(idx, 1);
            this.rebuildPendingIndex();
            this.savePendingQueueForActiveWorkflow();
            this.updateSelectedBarForMissing(m);
            this.updateApplyPendingButton?.();
            this.updateQueuePanel();
        }
    },

    // Rebuild pending index after modification
    rebuildPendingIndex() {
        this.pendingIndex = new Map();
        for (let i = 0; i < this.pendingResolutions.length; i++) {
            const r = this.pendingResolutions[i];
            const key = this.getResolutionQueueKey(r);
            this.pendingIndex.set(key, i);
        }
    },

    // Collapse/expand queue panel
    toggleQueueCollapsed() {
        this.setQueueCollapsed(!this.queueCollapsed);
    },

    setQueueCollapsed(collapsed) {
        this.queueCollapsed = !!collapsed;
        if (this.queueCollapsed) {
            try { localStorage.setItem('model_resolver_queue_collapsed', '1'); } catch (e) { }
        } else {
            try { localStorage.setItem('model_resolver_queue_collapsed', '0'); } catch (e) { }
        }
        this.updateQueueVisibility();
        this.updateQueuePanel();
    },

    getResolutionQueueKey(resolution = {}) {
        const nodeId = resolution.node_id ?? '';
        const widgetIndex = resolution.widget_index ?? '';
        const subgraphId = resolution.subgraph_id || '';
        const scope = resolution.is_top_level !== false ? 'T' : 'F';
        return `${nodeId}:${widgetIndex}:${subgraphId}:${scope}`;
    },

    getResolutionNodeRefs(missing = {}) {
        const refs = Array.isArray(missing.all_node_refs) && missing.all_node_refs.length
            ? missing.all_node_refs
            : [missing];

        return refs.map(ref => ({
            node_id: ref.node_id,
            node_type: ref.node_type,
            node_title: ref.node_title,
            widget_index: ref.widget_index,
            original_path: ref.original_path,
            name: ref.name,
            category: ref.category,
            subgraph_id: ref.subgraph_id,
            subgraph_name: ref.subgraph_name,
            is_top_level: ref.is_top_level,
            is_lora_v2: ref.is_lora_v2,
            nested_key: ref.nested_key
        }));
    },

    expandPendingResolutionsForApply(list = this.pendingResolutions || []) {
        const expanded = [];
        const seen = new Set();

        for (const resolution of Array.isArray(list) ? list : []) {
            const { node_refs, all_node_refs, ...baseResolution } = resolution || {};
            const refs = Array.isArray(node_refs) && node_refs.length
                ? node_refs
                : (Array.isArray(all_node_refs) && all_node_refs.length ? all_node_refs : [resolution]);

            for (const ref of refs.filter(Boolean)) {
                const item = {
                    ...baseResolution,
                    node_id: ref.node_id ?? baseResolution.node_id,
                    widget_index: ref.widget_index ?? baseResolution.widget_index,
                    category: ref.category || baseResolution.category,
                    subgraph_id: ref.subgraph_id ?? baseResolution.subgraph_id,
                    is_top_level: ref.is_top_level ?? baseResolution.is_top_level,
                    is_lora_v2: ref.is_lora_v2 ?? baseResolution.is_lora_v2,
                    original_lora_name: ref.name || ref.original_path || baseResolution.original_lora_name || baseResolution.name || baseResolution.original_path,
                    nested_key: ref.nested_key ?? baseResolution.nested_key,
                    original_path: ref.original_path || baseResolution.original_path,
                    node_type: ref.node_type || baseResolution.node_type,
                    node_label: ref.subgraph_name || ref.node_type || baseResolution.node_label
                };
                const itemKey = [
                    item.node_id ?? '',
                    item.widget_index ?? '',
                    item.subgraph_id || '',
                    item.is_top_level !== false ? 'T' : 'F',
                    item.nested_key || '',
                    item.original_lora_name || item.original_path || ''
                ].join(':');
                if (seen.has(itemKey)) continue;
                seen.add(itemKey);
                expanded.push(item);
            }
        }

        return expanded;
    },

    updateQueueVisibility() {
        const isMissingTab = this.activeTab === 'missing';
        const showQueuePanel = isMissingTab && !this.queueCollapsed;

        if (this.queueElement) {
            this.queueElement.style.display = showQueuePanel ? '' : 'none';
        }
        if (this.splitterElement) {
            this.splitterElement.style.display = showQueuePanel ? '' : 'none';
        }
        if (this.queueToggleIcon) {
            this.queueToggleIcon.style.display = isMissingTab ? '' : 'none';
        }

        this.updateQueueToggleIcon();
    },

    updateQueueToggleIcon() {
        if (!this.queueToggleIcon) return;
        this.queueToggleIcon.style.display = this.activeTab === 'missing' ? '' : 'none';
        this.queueToggleIcon.textContent = '';
        this.queueToggleIcon.removeAttribute('data-tooltip');
        this.queueToggleIcon.removeAttribute('title');
        if (this.queueCollapsed) {
            this.queueToggleIcon.classList.add('is-collapsed');
            this.queueToggleIcon.setAttribute('aria-label', 'Show queue and downloads panel');
        } else {
            this.queueToggleIcon.classList.remove('is-collapsed');
            this.queueToggleIcon.setAttribute('aria-label', 'Hide queue and downloads panel');
        }
    },

    onQueueEdgeClick(event) {
        if (this._suppressQueueEdgeClick) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            this._suppressQueueEdgeClick = false;
            return;
        }
        this.toggleQueueCollapsed();
    },

    startQueueEdgeDrag(event) {
        if (event.button !== 0 || !this.queueCollapsed || !this.queueElement) return;

        const startX = event.clientX;
        const previousCursor = document.body.style.cursor;
        event.preventDefault();
        document.body.style.cursor = 'col-resize';
        this._suppressQueueEdgeClick = true;
        this.splitterElement.style.display = '';
        document.getElementById('model-resolver-body')?.classList.add('mr-queue-preview-collapsed');
        this.queueElement.style.display = 'none';
        this.queueElement.style.width = '0px';
        this.startSplitDrag(
            { clientX: startX, preventDefault: () => {} },
            { startWidth: 0, edgeOpen: true, previousCursor, startCollapsedPreview: true }
        );
    },

    // Begin split drag for resizable panels
    startSplitDrag(e, { startWidth = null, edgeOpen = false, previousCursor = null, startCollapsedPreview = false } = {}) {
        try {
            e?.preventDefault?.();
            if (!this.queueElement) return;
            const rect = this.queueElement.getBoundingClientRect();
            const body = document.getElementById('model-resolver-body');
            const bodyRect = body ? body.getBoundingClientRect() : { width: window.innerWidth };
            this._splitDragging = true;
            body?.classList.add('mr-is-resizing-queue');
            this._splitStart = {
                x: e.clientX,
                startWidth: Number.isFinite(startWidth) ? startWidth : rect.width,
                containerWidth: bodyRect.width
            };
            this._lastSplitDragApply = 0;
            this._splitPreviewCollapsed = !!startCollapsedPreview;
            this._splitEdgeOpen = !!edgeOpen;
            this._splitEdgeOpenedPastThreshold = false;
            this._splitPreviousCursor = previousCursor;
            this._prevUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            this._onSplitMove = (ev) => this.onSplitDrag(ev);
            this._onSplitUp = () => this.endSplitDrag();
            document.addEventListener('mousemove', this._onSplitMove);
            document.addEventListener('mouseup', this._onSplitUp, { once: true });
        } catch (err) { /* ignore */ }
    },

    onSplitDrag(e) {
        if (!this._splitDragging || !this._splitStart || !this.queueElement) return;
        const dx = e.clientX - this._splitStart.x;
        let newW = this._splitStart.startWidth - dx;
        const minW = this._splitEdgeOpen ? 0 : 56;
        const maxW = Math.max(minW, Math.floor(this._splitStart.containerWidth - 360));
        if (newW < minW) newW = minW;
        if (newW > maxW) newW = maxW;
        this._pendingSplitWidth = Math.round(newW);
        if (this._splitEdgeOpen && this._pendingSplitWidth > 140) {
            this._splitEdgeOpenedPastThreshold = true;
            if (this.queueCollapsed) {
                this.queueCollapsed = false;
                try { localStorage.setItem('model_resolver_queue_collapsed', '0'); } catch (error) { }
                this.updateQueueToggleIcon();
                this.updateQueuePanel();
            }
        }
        const previewCollapsed = this._splitEdgeOpen
            ? (!this._splitEdgeOpenedPastThreshold || this._pendingSplitWidth <= 140)
            : this._pendingSplitWidth <= 140;
        if (previewCollapsed !== this._splitPreviewCollapsed) {
            this._splitPreviewCollapsed = previewCollapsed;
            const body = document.getElementById('model-resolver-body');
            body?.classList.toggle('mr-queue-preview-collapsed', previewCollapsed);
            this.queueElement.style.display = previewCollapsed ? 'none' : '';
        }
        const now = performance.now();
        if (this._lastSplitDragApply && now - this._lastSplitDragApply < 33) return;
        this._lastSplitDragApply = now;
        if (this._splitDragFrame) return;
        this._splitDragFrame = requestAnimationFrame(() => {
            this._splitDragFrame = null;
            if (!this._splitDragging || !this.queueElement || !this._pendingSplitWidth || this._splitPreviewCollapsed) return;
            this.queueElement.style.width = `${this._pendingSplitWidth}px`;
        });
    },

    endSplitDrag() {
        if (!this._splitDragging) return;
        this._splitDragging = false;
        if (this._splitDragFrame) {
            cancelAnimationFrame(this._splitDragFrame);
            this._splitDragFrame = null;
        }
        if (this.queueElement && this._pendingSplitWidth && !this._splitPreviewCollapsed) {
            this.queueElement.style.width = `${this._pendingSplitWidth}px`;
        }
        const body = document.getElementById('model-resolver-body');
        body?.classList.remove('mr-is-resizing-queue');
        body?.classList.remove('mr-queue-preview-collapsed');
        document.removeEventListener('mousemove', this._onSplitMove);
        if (this._splitEdgeOpen && !this._pendingSplitWidth) {
            try {
                const restoreWidth = Math.max(240, Math.round(this._splitStart?.startWidth || 320));
                this.queueElement.style.width = `${restoreWidth}px`;
                this.queueElement.style.display = '';
                if (this.splitterElement) this.splitterElement.style.display = '';
                localStorage.setItem('model_resolver_split_w', String(restoreWidth));
            } catch (e) { }
            this.queueCollapsed = false;
            try { localStorage.setItem('model_resolver_queue_collapsed', '0'); } catch (e) { }
            this.updateQueueVisibility();
            this.updateQueuePanel();
            this._splitEdgeOpen = false;
            this._pendingSplitWidth = null;
            this._lastSplitDragApply = 0;
            this._splitPreviewCollapsed = false;
            try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
            try { document.body.style.cursor = this._splitPreviousCursor || ''; } catch (e) { }
            this._splitPreviousCursor = null;
            this._splitEdgeOpenedPastThreshold = false;
            setTimeout(() => { this._suppressQueueEdgeClick = false; }, 0);
            return;
        }
        const shouldCollapse = !!this._splitPreviewCollapsed;
        if (shouldCollapse) {
            try {
                const restoreWidth = Math.max(240, Math.round(this._splitStart?.startWidth || 320));
                this.queueElement.style.width = `${restoreWidth}px`;
                this.queueElement.style.display = '';
                localStorage.setItem('model_resolver_split_w', String(restoreWidth));
            } catch (e) { }
            this._pendingSplitWidth = null;
            this._lastSplitDragApply = 0;
            this._splitPreviewCollapsed = false;
            this._splitEdgeOpen = false;
            this._splitEdgeOpenedPastThreshold = false;
            try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
            try { document.body.style.cursor = this._splitPreviousCursor || ''; } catch (e) { }
            this._splitPreviousCursor = null;
            this.setQueueCollapsed(true);
            setTimeout(() => { this._suppressQueueEdgeClick = false; }, 0);
            return;
        }
        if (this.queueElement) this.queueElement.style.display = '';
        try {
            const rect = this.queueElement.getBoundingClientRect();
            localStorage.setItem('model_resolver_split_w', String(Math.round(rect.width)));
        } catch (e) { }
        this._pendingSplitWidth = null;
        this._lastSplitDragApply = 0;
        this._splitPreviewCollapsed = false;
        this._splitEdgeOpen = false;
        this._splitEdgeOpenedPastThreshold = false;
        try { document.body.style.userSelect = this._prevUserSelect || ''; } catch (e) { }
        if (this._splitPreviousCursor !== null) {
            try { document.body.style.cursor = this._splitPreviousCursor || ''; } catch (e) { }
            this._splitPreviousCursor = null;
        }
        setTimeout(() => { this._suppressQueueEdgeClick = false; }, 0);
    },

    /**
     * Queue a resolution for later batch apply
     */
    queueResolution(missing, resolvedModel) {
        if (!resolvedModel) {
            this.showNotification('No model selected', 'error');
            return;
        }

        const resolution = {
            node_id: missing.node_id,
            widget_index: missing.widget_index,
            resolved_path: resolvedModel.path,
            category: missing.category,
            resolved_model: resolvedModel,
            original_path: missing.original_path,
            subgraph_id: missing.subgraph_id,
            is_top_level: missing.is_top_level,
            is_lora_v2: missing.is_lora_v2,
            original_lora_name: missing.name || missing.original_path,
            nested_key: missing.nested_key,
            node_refs: this.getResolutionNodeRefs(missing),
            node_type: missing.node_type,
            node_label: missing.subgraph_name || missing.node_type
        };

        const key = this.getResolutionQueueKey(resolution);
        if (this.pendingIndex.has(key)) {
            // replace existing selection for this slot
            const idx = this.pendingIndex.get(key);
            this.pendingResolutions[idx] = resolution;
        } else {
            this.pendingIndex.set(key, this.pendingResolutions.length);
            this.pendingResolutions.push(resolution);
        }
        this.savePendingQueueForActiveWorkflow();

        // Update selected bar UI
        this.updateSelectedBarForMissing?.(missing);
        this.updateQueuePanel();
        this.updateApplyPendingButton();
    },

    /**
     * Apply one queued resolution from the selected bar.
     */
    async applyQueuedByKey(key, button = null) {
        if (!key || !this.pendingIndex.has(key)) {
            this.showNotification('Selected match is no longer queued.', 'error');
            return;
        }

        const idx = this.pendingIndex.get(key);
        const selection = this.pendingResolutions?.[idx];
        if (!selection) {
            this.showNotification('Selected match is no longer queued.', 'error');
            return;
        }

        if (button) {
            button.disabled = true;
            button.classList.add('mr-btn-is-disabled');
            button.textContent = 'Applying...';
        }

        try {
            await this.applyPendingResolutionList([selection], { clearAll: false });
        } finally {
            if (button?.isConnected) {
                button.disabled = false;
                button.classList.remove('mr-btn-is-disabled');
                button.textContent = 'Apply';
            }
        }
    },

    async applyPendingResolutionList(list, { clearAll = false } = {}) {
        if (!list.length) {
            this.showNotification('No selections queued', 'error');
            return;
        }

        try {
            const appliedSelections = this.clonePendingResolutions?.(list) || JSON.parse(JSON.stringify(list));
            const applyResolutions = this.expandPendingResolutionsForApply(appliedSelections);
            if (!applyResolutions.length) {
                this.showNotification('No valid selections to apply', 'error');
                return;
            }
            const workflow = this.getCurrentWorkflow();
            if (!workflow) {
                this.showNotification('No workflow loaded', 'error');
                return;
            }

            const response = await api.fetchApi('/model_resolver/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow, resolutions: applyResolutions })
            });

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            const data = await response.json();
            if (data.success) {
                const optimisticData = this.getOptimisticAnalysisDataAfterApply(appliedSelections);
                await this.updateWorkflowInComfyUI(data.workflow);

                const appliedKeys = new Set(appliedSelections.map(selection => this.getResolutionQueueKey(selection)));
                const remainingSelections = clearAll
                    ? []
                    : (this.pendingResolutions || []).filter(selection => !appliedKeys.has(this.getResolutionQueueKey(selection)));

                this.pendingResolutions = remainingSelections;
                this.rebuildPendingIndex();
                this.savePendingQueueForActiveWorkflow();
                this.syncWorkflowScopedQueue?.(data.workflow);

                this.pendingResolutions = remainingSelections;
                this.rebuildPendingIndex();
                this.savePendingQueueForActiveWorkflow();
                this.updateApplyPendingButton();
                this.updateQueuePanel();

                this.applyOptimisticAnalysisData(optimisticData, data.workflow);

                const selectionCount = appliedSelections.length;
                const refText = applyResolutions.length > selectionCount
                    ? ` (${applyResolutions.length} references)`
                    : '';
                this.showNotification(`✓ Linked ${selectionCount} selection${selectionCount > 1 ? 's' : ''}${refText}`, 'success');
                this.refreshAnalysisInBackground(data.workflow, this.getWorkflowSignature(data.workflow));
            } else {
                this.showNotification('Failed to apply selections: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (e) {
            console.error('Model Resolver: applyPendingResolutions error', e);
            this.showNotification('Error applying selections: ' + e.message, 'error');
        }
    },

    /**
     * Apply all pending resolutions in batch
     */
    async applyPendingResolutions() {
        const list = this.pendingResolutions || [];
        await this.applyPendingResolutionList(list, { clearAll: true });
    },

    updateApplyPendingButton() {
        if (!this.applyPendingBtn) return;
        const count = this.pendingResolutions?.length || 0;
        const isEmpty = count === 0;
        const tooltip = count > 0
            ? `Apply ${count} queued model link${count > 1 ? 's' : ''} to the current workflow.`
            : 'Apply the model links you selected from local matches or search results.';
        this.applyPendingBtn.textContent = `Apply Selected (${count})`;
        this.setTooltip(this.applyPendingBtn, tooltip);
        this.applyPendingBtn.disabled = isEmpty;
        this.applyPendingBtn.setAttribute('aria-disabled', String(isEmpty));
        this.applyPendingBtn.classList.toggle('mr-btn-is-disabled', isEmpty);
        this.updateBatchFooterButtons();
    },

    updateBatchFooterButtons() {
        const missingModels = this.missingModels || [];
        const selectedCount = this.getSelectedMissingModels().length;
        const totalCount = missingModels.length;
        const pendingCount = this.pendingResolutions?.length || 0;
        const activeCount = this.getActiveQueuePanelDownloads().length;
        const downloadableSelected = this.getMissingWithDownloadSources(this.getSelectedMissingModels()).length;
        const downloadableAll = this.getMissingWithDownloadSources(missingModels).length;

        if (this.selectMenuButton) {
            this.selectMenuButton.textContent = `Select (${selectedCount}/${totalCount})`;
            this.selectMenuButton.classList.toggle('mr-btn-is-disabled', totalCount === 0);
        }
        if (this.searchMenuButton) {
            this.searchMenuButton.textContent = this.batchSearchRunning
                ? (this.batchSearchCancelRequested ? 'Stopping...' : 'Searching...')
                : 'Search';
            this.searchMenuButton.classList.toggle('mr-btn-is-disabled', totalCount === 0 && !this.batchSearchRunning);
        }
        if (this.downloadMenuButton) {
            const label = activeCount > 0 ? `Cancel Downloads (${activeCount})` : 'Download';
            this.downloadMenuButton.textContent = label;
            this.downloadMenuButton.classList.toggle('mr-btn-danger', activeCount > 0);
            this.downloadMenuButton.classList.toggle('mr-btn-download', activeCount === 0);
            this.downloadMenuButton.classList.toggle('mr-btn-is-disabled', activeCount === 0 && downloadableAll === 0);
            this.setTooltip(
                this.downloadMenuButton,
                activeCount > 0
                    ? `Cancel ${activeCount} active download${activeCount > 1 ? 's' : ''}.`
                    : `${downloadableSelected || downloadableAll} missing model${(downloadableSelected || downloadableAll) === 1 ? '' : 's'} currently have download sources.`
            );
        }
        if (this.applyPendingBtn) {
            this.applyPendingBtn.textContent = `Apply Selected (${pendingCount})`;
        }
        if (this.linkMenuButton) {
            this.linkMenuButton.classList.toggle('mr-btn-is-disabled', totalCount === 0 && pendingCount === 0);
        }
        this.updateFooterMenuItemVisibility?.();
    },

    getMissingModelsForPendingResolutions() {
        const pending = Array.isArray(this.pendingResolutions) ? this.pendingResolutions : [];
        if (!pending.length) return [];

        const pendingKeys = new Set(pending.map(resolution => this.getResolutionQueueKey(resolution)));
        return (this.missingModels || []).filter(missing => pendingKeys.has(this.getMissingModelKey(missing)));
    },

    getQueueExactLocalMatchPreviewModels() {
        const selected = this.getSelectedMissingModels();
        const targets = selected.length ? selected : (this.missingModels || []);
        return targets.filter(missing => this.getBestLocalMatch(missing, 100)?.model);
    },

    getDownloadableBatchPreviewModels(mode = 'all') {
        const targets = mode === 'selected'
            ? this.getSelectedMissingModels()
            : (this.missingModels || []);

        return targets.filter(missing => {
            if (this.getBestLocalMatch(missing, 100)) return false;
            return Boolean(this.getBestDownloadSourceForMissing(missing)?.url);
        });
    },

    getActiveDownloadMissingModels() {
        const activeKeys = new Set(
            this.getActiveQueuePanelDownloads()
                .map(({ info }) => info?.missing)
                .filter(Boolean)
                .map(missing => this.getMissingModelKey(missing))
        );
        if (!activeKeys.size) return [];

        return (this.missingModels || []).filter(missing => activeKeys.has(this.getMissingModelKey(missing)));
    },

    getOptimisticAnalysisDataAfterApply(appliedSelections = []) {
        const missingModels = Array.isArray(this.missingModels) ? this.missingModels : [];
        const appliedKeys = new Set(
            (Array.isArray(appliedSelections) ? appliedSelections : [])
                .map(selection => this.getResolutionQueueKey(selection))
        );
        if (!appliedKeys.size) return null;

        const sourceData = this.cachedAnalysisData || {
            missing_models: missingModels,
            total_missing: missingModels.length
        };
        const sourceMissing = Array.isArray(sourceData.missing_models)
            ? sourceData.missing_models
            : missingModels;
        const nextMissing = sourceMissing.filter(missing => !appliedKeys.has(this.getMissingModelKey(missing)));

        return {
            ...sourceData,
            missing_models: nextMissing,
            total_missing: nextMissing.length
        };
    },

    applyOptimisticAnalysisData(data, workflow = null) {
        if (!data) return false;

        const workflowSignature = this.getWorkflowSignature(workflow || this.getCurrentWorkflow());
        if (workflowSignature) {
            this.cachedWorkflowSignature = workflowSignature;
        }
        this.cachedAnalysisData = this.cloneAnalysisData?.(data) || data;
        this.saveAnalysisCacheForActiveWorkflow?.();

        if (this.activeTab === 'missing' && this.contentElement) {
            this.displayMissingModels(this.contentElement, data);
            this.reconnectActiveDownloads?.();
        } else {
            this.missingModels = Array.isArray(data.missing_models) ? data.missing_models : [];
            this.updateBatchFooterButtons?.();
        }

        return true;
    },

    refreshAnalysisInBackground(workflow, expectedSignature = null) {
        if (!workflow) return;

        const signature = expectedSignature || this.getWorkflowSignature(workflow);
        api.fetchApi('/model_resolver/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflow })
        })
            .then(response => {
                if (!response.ok) throw new Error(`API error: ${response.status}`);
                return response.json();
            })
            .then(data => {
                if (signature && this.activeWorkflowSignature !== signature) return;
                this.cachedWorkflowSignature = signature || this.cachedWorkflowSignature;
                this.cachedAnalysisData = data;
                this.saveAnalysisCacheForActiveWorkflow?.();

                if (this.activeTab === 'missing' && this.contentElement && !this._analysisProgressToken) {
                    this.displayMissingModels(this.contentElement, data);
                    this.reconnectActiveDownloads?.();
                }
            })
            .catch(error => {
                console.warn('Model Resolver: background analysis refresh failed:', error);
            });
    },

    previewFooterMenuModels(models = []) {
        const keys = new Set(
            (Array.isArray(models) ? models : [])
                .filter(Boolean)
                .map(missing => this.getMissingModelKey(missing))
        );

        this.contentElement?.querySelectorAll?.('.mr-missing-list-row')?.forEach(row => {
            const key = row.getAttribute('data-missing-key');
            row.classList.toggle('is-menu-preview', Boolean(key && keys.has(key)));
        });
    },

    clearFooterMenuPreview() {
        this.contentElement?.querySelectorAll?.('.mr-missing-list-row.is-menu-preview')?.forEach(row => {
            row.classList.remove('is-menu-preview');
        });
    },

    createFooterMenu(name, label, items = [], buttonClass = 'mr-btn-secondary') {
        const button = $el(`button.mr-btn.${buttonClass}.mr-footer-btn.mr-footer-menu-button`, {
            type: 'button',
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            onclick: (event) => {
                event.stopPropagation();
                this.hideTooltip?.();
                if (button.classList.contains('mr-btn-is-disabled')) {
                    if (name === 'download') {
                        this.showNotification('No missing models have downloadable sources yet.', 'info');
                    } else {
                        this.showNotification('No missing models available.', 'info');
                    }
                    return;
                }
                this.toggleFooterMenu(name);
            }
        }, [$el("span", { textContent: label })]);

        const menuChildren = items.map(item => {
            const isDivider = item === 'divider' || item?.type === 'divider';
            let element;
            if (isDivider) {
                element = $el("div.mr-footer-menu-divider", {});
            } else if (item?.type === 'checkbox') {
                const input = $el("input.mr-footer-menu-checkbox-input", {
                    type: 'checkbox',
                    checked: Boolean(item.checked?.())
                });
                element = $el("label.mr-footer-menu-item.mr-footer-menu-checkbox", {
                    role: 'menuitemcheckbox',
                    'aria-checked': input.checked ? 'true' : 'false',
                    onclick: (event) => {
                        event.stopPropagation();
                    }
                }, [
                    input,
                    $el("span", { textContent: item.label })
                ]);
                input.addEventListener('change', () => {
                    item.action?.(input.checked);
                    element.setAttribute('aria-checked', input.checked ? 'true' : 'false');
                });
            } else {
                const attributes = {
                    type: 'button',
                    role: 'menuitem',
                    onclick: (event) => {
                        event.stopPropagation();
                        if (element.disabled || element.classList.contains('mr-btn-is-disabled')) return;
                        item.action();
                    }
                };
                if (item.id) attributes.id = item.id;
                if (item.ariaLabel) attributes['aria-label'] = item.ariaLabel;
                element = $el("button.mr-footer-menu-item", attributes, [$el("span", { textContent: item.label })]);
            }

            if (item?.className) {
                element.classList.add(...String(item.className).split(/\s+/).filter(Boolean));
            }
            if (item?.refName) {
                this[item.refName] = element;
            }
            if (!isDivider && typeof item?.previewModels === 'function') {
                const showPreview = () => {
                    if (element.disabled || element.classList.contains('mr-btn-is-disabled')) {
                        this.clearFooterMenuPreview();
                        return;
                    }
                    try {
                        this.previewFooterMenuModels(item.previewModels());
                    } catch (error) {
                        console.warn('Model Resolver: footer menu preview failed:', error);
                        this.clearFooterMenuPreview();
                    }
                };
                element.addEventListener('mouseenter', showPreview);
                element.addEventListener('focus', showPreview);
                element.addEventListener('mouseleave', () => this.clearFooterMenuPreview());
                element.addEventListener('blur', () => this.clearFooterMenuPreview());
            }
            if (typeof item?.visibleWhen === 'function' || typeof item?.disabledWhen === 'function') {
                if (!this.footerMenuItems) this.footerMenuItems = new Map();
                if (!this.footerMenuItems.has(name)) this.footerMenuItems.set(name, []);
                this.footerMenuItems.get(name).push({
                    element,
                    visibleWhen: item.visibleWhen,
                    disabledWhen: item.disabledWhen
                });
                if (typeof item.visibleWhen === 'function') {
                    element.style.display = item.visibleWhen() ? '' : 'none';
                }
                if (typeof item.disabledWhen === 'function') {
                    const disabled = item.disabledWhen();
                    element.disabled = disabled;
                    element.setAttribute('aria-disabled', String(disabled));
                    element.classList.toggle('mr-btn-is-disabled', disabled);
                }
            }
            return element;
        });

        const menu = $el("div.mr-footer-menu", { role: 'menu' }, menuChildren);

        this.footerMenuButtons.set(name, button);
        this.footerMenus.set(name, menu);

        return $el("div.mr-footer-menu-wrap", {}, [button, menu]);
    },

    updateFooterMenuItemVisibility() {
        if (!this.footerMenuItems) return;
        for (const entries of this.footerMenuItems.values()) {
            for (const entry of entries) {
                if (typeof entry.visibleWhen === 'function') {
                    entry.element.style.display = entry.visibleWhen() ? '' : 'none';
                }
                if (typeof entry.disabledWhen === 'function') {
                    const disabled = entry.disabledWhen();
                    entry.element.disabled = disabled;
                    entry.element.setAttribute('aria-disabled', String(disabled));
                    entry.element.classList.toggle('mr-btn-is-disabled', disabled);
                }
            }
        }
    },

    updateFooterStarLayout() {
        if (!this.footerElement || !this.footerStarLink || !this.footerActions) return;

        this.footerElement.classList.toggle('mr-footer-is-missing', this.activeTab === 'missing');
        this.footerStarLink.classList.remove('mr-footer-star-hidden');

        if (this.activeTab !== 'missing') return;

        const footerStyle = getComputedStyle(this.footerElement);
        const footerWidth = (this.footerElement.clientWidth || 0)
            - (parseFloat(footerStyle.paddingLeft) || 0)
            - (parseFloat(footerStyle.paddingRight) || 0);
        if (footerWidth <= 0) return;

        const actionItems = Array.from(this.footerActions.children || []).filter((element) => {
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
        if (!actionItems.length) return;

        const gap = parseFloat(footerStyle.columnGap || footerStyle.gap || '0') || 0;
        const actionsStyle = getComputedStyle(this.footerActions);
        const actionGap = parseFloat(actionsStyle.columnGap || actionsStyle.gap || '0') || 0;
        const actionsWidth = actionItems.reduce((total, element) => {
            return total + element.getBoundingClientRect().width;
        }, 0) + (Math.max(0, actionItems.length - 1) * actionGap);
        const requiredWidth = this.footerStarLink.scrollWidth + actionsWidth + gap;
        this.footerStarLink.classList.toggle('mr-footer-star-hidden', requiredWidth > footerWidth);
    },

    bindFooterStarLayoutObserver() {
        if (this._footerStarResizeObserver || !this.footerElement || typeof ResizeObserver === 'undefined') return;
        this._footerStarResizeObserver = new ResizeObserver(() => this.updateFooterStarLayout());
        this._footerStarResizeObserver.observe(this.footerElement);
        this._footerStarResizeObserver.observe(this.footerActions);
    },

    createFooter() {
        this.footerMenus = new Map();
        this.footerMenuButtons = new Map();
        this.footerMenuItems = new Map();
        this.linkMenuButton = null;
        this.linkMenuWrap = null;
        this.queueExactButton = null;
        this.applyPendingBtn = null;
        this.clearSelectedButton = null;
        this.autoResolveButton = null;
        this.downloadMenuButton = null;
        this.downloadAllButton = null;

        const selectMenu = this.createFooterMenu('select', 'Select (0/0)', [
            { label: 'Select All', previewModels: () => this.missingModels || [], action: () => this.selectBatchMissingModels('all') },
            { label: 'Select None', previewModels: () => this.getSelectedMissingModels(), action: () => this.selectBatchMissingModels('none') },
            {
                label: 'Invert Selection',
                previewModels: () => {
                    const selectedKeys = this.batchSelectedMissingKeys || new Set();
                    return (this.missingModels || []).filter(missing => !selectedKeys.has(this.getMissingModelKey(missing)));
                },
                action: () => this.selectBatchMissingModels('invert')
            },
            'divider',
            { label: 'Select Exact Local', previewModels: () => this.getMissingWithExactLocalMatches(), action: () => this.selectBatchMissingModels('exact') },
            { label: 'Select No Exact Local', previewModels: () => this.getMissingWithoutExactLocalMatches(), action: () => this.selectBatchMissingModels('no_exact') },
            { label: 'Select Partial Local', previewModels: () => this.getMissingWithPartialLocalMatches(), action: () => this.selectBatchMissingModels('partial') },
            { label: 'Select No Local Match', previewModels: () => this.getMissingWithoutLocalMatches(), action: () => this.selectBatchMissingModels('no_local') },
            'divider',
            { label: 'Select With Download Source', previewModels: () => this.getMissingWithDownloadSources(), action: () => this.selectBatchMissingModels('downloadable') },
            { label: 'Select Without Download Source', previewModels: () => this.getMissingWithoutDownloadSources(), action: () => this.selectBatchMissingModels('no_download') },
            'divider',
            { label: 'Select Searched', previewModels: () => this.getSearchedMissingModels(), action: () => this.selectBatchMissingModels('searched') },
            { label: 'Select Unsearched', previewModels: () => this.getUnsearchedMissingModels(), action: () => this.selectBatchMissingModels('unsearched') }
        ]);
        this.selectMenuButton = this.footerMenuButtons.get('select');
        this.selectMenuWrap = selectMenu;

        const hasSelectedMissingModels = () => this.getSelectedMissingModels().length > 0;
        const searchBatchOptions = () => ({ forceSearch: Boolean(this.forceBatchSearch) });
        const searchMenu = this.createFooterMenu('search', 'Search', [
            { label: 'Stop Searching', className: 'mr-footer-menu-danger', visibleWhen: () => this.batchSearchRunning, action: () => this.stopBatchSearch() },
            { type: 'divider', visibleWhen: () => this.batchSearchRunning },
            {
                type: 'checkbox',
                label: 'Force search (ignore cache)',
                visibleWhen: () => !this.batchSearchRunning,
                checked: () => Boolean(this.forceBatchSearch),
                action: (checked) => {
                    this.forceBatchSearch = Boolean(checked);
                }
            },
            { type: 'divider', visibleWhen: () => !this.batchSearchRunning },
            { label: 'Search Selected', visibleWhen: () => !this.batchSearchRunning, disabledWhen: () => !hasSelectedMissingModels(), previewModels: () => this.getSelectedMissingModels(), action: () => this.searchMissingBatch('selected', 'all', searchBatchOptions()) },
            { label: 'Search All Missing', visibleWhen: () => !this.batchSearchRunning, previewModels: () => this.missingModels || [], action: () => this.searchMissingBatch('all', 'all', searchBatchOptions()) },
            { label: 'Search Unsearched', visibleWhen: () => !this.batchSearchRunning, previewModels: () => this.getUnsearchedMissingModels(), action: () => this.searchMissingBatch('unsearched', 'all', searchBatchOptions()) },
            { type: 'divider', visibleWhen: () => !this.batchSearchRunning },
            { label: 'Selected: Local Database', visibleWhen: () => !this.batchSearchRunning, disabledWhen: () => !hasSelectedMissingModels(), previewModels: () => this.getSelectedMissingModels(), action: () => this.searchMissingBatch('selected', 'local', searchBatchOptions()) },
            { label: 'Selected: CivitAI', visibleWhen: () => !this.batchSearchRunning, disabledWhen: () => !hasSelectedMissingModels(), previewModels: () => this.getSelectedMissingModels(), action: () => this.searchMissingBatch('selected', 'civitai', searchBatchOptions()) },
            { label: 'Selected: HuggingFace', visibleWhen: () => !this.batchSearchRunning, disabledWhen: () => !hasSelectedMissingModels(), previewModels: () => this.getSelectedMissingModels(), action: () => this.searchMissingBatch('selected', 'huggingface', searchBatchOptions()) },
            { label: 'Selected: CivArchive', visibleWhen: () => !this.batchSearchRunning, disabledWhen: () => !hasSelectedMissingModels(), previewModels: () => this.getSelectedMissingModels(), action: () => this.searchMissingBatch('selected', 'civarchive', searchBatchOptions()) },
            { label: 'Selected: LoRA Manager Archive', visibleWhen: () => !this.batchSearchRunning, disabledWhen: () => !hasSelectedMissingModels(), previewModels: () => this.getSelectedMissingModels(), action: () => this.searchMissingBatch('selected', 'lora_manager_archive', searchBatchOptions()) }
        ]);
        this.searchMenuButton = this.footerMenuButtons.get('search');
        this.searchMenuWrap = searchMenu;

        const hasExactLocalMatches = () => this.getMissingWithExactLocalMatches(this.missingModels || []).length > 0;
        const linkMenu = this.createFooterMenu('link', 'Link', [
            {
                label: 'Queue Exact',
                refName: 'queueExactButton',
                ariaLabel: 'Queue exact local matches',
                previewModels: () => this.getQueueExactLocalMatchPreviewModels(),
                action: () => this.queueExactLocalMatchesBatch('selected')
            },
            {
                label: 'Apply Selected (0)',
                id: 'apply-pending-resolutions',
                refName: 'applyPendingBtn',
                ariaLabel: 'Apply selected model links',
                disabledWhen: () => (this.pendingResolutions?.length || 0) === 0,
                previewModels: () => this.getMissingModelsForPendingResolutions(),
                action: () => {
                    if ((this.pendingResolutions?.length || 0) === 0) return;
                    this.applyPendingResolutions();
                }
            },
            {
                label: 'Clear All Selected',
                refName: 'clearSelectedButton',
                ariaLabel: 'Clear all queued selected model links',
                disabledWhen: () => (this.pendingResolutions?.length || 0) === 0,
                previewModels: () => this.getMissingModelsForPendingResolutions(),
                action: () => {
                    this.clearAllQueued();
                    this.closeFooterMenus();
                }
            },
            { type: 'divider', visibleWhen: hasExactLocalMatches },
            {
                label: 'Auto-Link 100%',
                refName: 'autoResolveButton',
                ariaLabel: 'Auto-link all 100 percent local matches',
                visibleWhen: hasExactLocalMatches,
                previewModels: () => this.getMissingWithExactLocalMatches(),
                action: () => this.autoResolve100Percent()
            }
        ]);
        this.linkMenuButton = this.footerMenuButtons.get('link');
        this.linkMenuWrap = linkMenu;
        this.linkMenuButton.setAttribute('aria-label', 'Local link actions');
        this.setTooltip(this.linkMenuButton, 'Queue exact local matches, apply queued links, or auto-link 100% matches.');
        this.setTooltip(this.queueExactButton, 'Queue exact local matches for the selected rows, or all exact matches if nothing is selected.');
        this.setTooltip(this.applyPendingBtn, 'Apply the model links you selected from local matches or search results.');
        this.setTooltip(this.clearSelectedButton, 'Clear all queued model links without changing the workflow.');
        this.setTooltip(this.autoResolveButton, 'Automatically link all missing models with a 100% local match.');
        this.updateApplyPendingButton();

        const downloadMenu = this.createFooterMenu('download', 'Download', [
            { label: 'Download Selected', disabledWhen: () => !hasSelectedMissingModels(), previewModels: () => this.getDownloadableBatchPreviewModels('selected'), action: () => this.downloadMissingBatch('selected') },
            { label: 'Download All With Sources', previewModels: () => this.getDownloadableBatchPreviewModels('all'), action: () => this.downloadMissingBatch('all') },
            'divider',
            { label: 'Cancel Downloads', previewModels: () => this.getActiveDownloadMissingModels(), action: () => { this.closeFooterMenus(); this.cancelAllDownloads(); } }
        ], 'mr-btn-download');
        this.downloadMenuButton = this.footerMenuButtons.get('download');
        this.downloadMenuWrap = downloadMenu;
        this.downloadAllButton = this.downloadMenuButton;
        this.downloadAllButton.setAttribute('aria-label', 'Download missing models');
        this.setTooltip(this.downloadAllButton, 'Download selected models or all missing models with known download sources.');

        const starLink = $el("a.mr-footer-star-link", {
            href: "https://github.com/Azornes/Comfyui-Model-Resolver",
            target: "_blank",
            rel: "noopener noreferrer",
            ariaLabel: "Star the Model Resolver repository on GitHub"
        }, [
            $el("span.mr-footer-star-icon", {
                innerHTML: getSvgIcon('star', 'currentColor', 'mr-footer-star-svg')
            }),
            $el("span.mr-footer-star-text", {
                innerHTML: 'If this tool helps you, please consider <span>starring</span> the repository.'
            })
        ]);

        this.footerStarLink = starLink;
        this.footerActions = $el("div.mr-footer-actions", {}, [
            selectMenu,
            searchMenu,
            linkMenu,
            downloadMenu
        ]);
        this.footerElement = $el("div.mr-footer", {}, [
            starLink,
            this.footerActions
        ]);
        this.bindFooterStarLayoutObserver();
        queueMicrotask(() => this.updateFooterStarLayout());
        return this.footerElement;
    },

    animateTabContentTransition() {
        if (!this.contentElement?.animate) return;

        try {
            this.contentElement.animate(
                [
                    { opacity: 0.72, transform: 'translateY(7px)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ],
                {
                    duration: 180,
                    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
                }
            );
        } catch (error) {
            console.warn('Model Resolver: tab content animation failed', error);
        }
    },

    /**
     * Handle click on Download All / Cancel All button
     */
    handleDownloadAllClick() {
        if (this.getActiveQueuePanelDownloadIds().length > 0) {
            // Cancel all active downloads
            this.cancelAllDownloads();
        } else {
            // Start downloading all missing
            this.downloadAllMissing();
        }
    },

    /**
     * Cancel all active downloads
     */
    async cancelAllDownloads() {
        const downloadIds = this.getActiveQueuePanelDownloadIds();
        if (downloadIds.length === 0) return;

        this.showNotification(`Cancelling ${downloadIds.length} download${downloadIds.length > 1 ? 's' : ''}...`, 'info');

        for (const downloadId of downloadIds) {
            try {
                await api.fetchApi(`/model_resolver/cancel/${downloadId}`, {
                    method: 'POST'
                });
            } catch (error) {
                console.error('Model Resolver: Error cancelling download:', error);
            }
        }
    },

    /**
     * Update the Download All button state based on active downloads
     */
    updateDownloadAllButtonState() {
        if (!this.downloadAllButton) return;
        if (this.downloadMenuButton && this.downloadAllButton === this.downloadMenuButton) {
            this.updateBatchFooterButtons();
            return;
        }

        const activeCount = this.getActiveQueuePanelDownloadIds().length;
        if (activeCount > 0) {
            this.downloadAllButton.innerHTML = `<span class="mr-btn-icon">✕</span> Cancel All (${activeCount})`;
            this.downloadAllButton.setAttribute(
                'data-tooltip',
                `Cancel ${activeCount} active download${activeCount > 1 ? 's' : ''}.`
            );
            this.downloadAllButton.setAttribute('aria-label', 'Cancel all active downloads');
            this.downloadAllButton.classList.remove('mr-btn-download');
            this.downloadAllButton.classList.add('mr-btn-danger');
        } else {
            this.downloadAllButton.innerHTML = `<span class="mr-btn-icon">☁</span> Download All Missing`;
            this.downloadAllButton.setAttribute(
                'data-tooltip',
                'Download every missing model that has a known download source.'
            );
            this.downloadAllButton.setAttribute('aria-label', 'Download all missing models');
            this.downloadAllButton.classList.remove('mr-btn-danger');
            this.downloadAllButton.classList.add('mr-btn-download');
        }
    }
};
