import { safeStorage } from '../utils/html_utils.js';

export const queueStorageMethods = {
    getActiveDownloadRecoveryStorageKey() {
        return this.activeDownloadsStorageKey || 'model_resolver_active_downloads';
    },

    loadActiveDownloadRecovery() {
        if (this._activeDownloadRecoveryLoaded) {
            return this._activeDownloadRecovery || {};
        }

        this._activeDownloadRecoveryLoaded = true;
        try {
            const raw = safeStorage.getItem(this.getActiveDownloadRecoveryStorageKey());
            const parsed = raw ? JSON.parse(raw) : {};
            this._activeDownloadRecovery = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : {};
        } catch (error) {
            console.warn('Model Resolver: failed to load active download recovery', error);
            this._activeDownloadRecovery = {};
        }
        return this._activeDownloadRecovery;
    },

    saveActiveDownloadRecovery() {
        const recovery = this.loadActiveDownloadRecovery();
        safeStorage.setItem(
            this.getActiveDownloadRecoveryStorageKey(),
            JSON.stringify(recovery)
        );
    },

    persistActiveDownloadRecovery(downloadId, info = {}) {
        if (!downloadId || !info) return;

        const recovery = this.loadActiveDownloadRecovery();
        const cloneForStorage = (value) => {
            try {
                return JSON.parse(JSON.stringify(value, (key, item) => (
                    key === 'matches' || key === 'local_matches' ? undefined : item
                )));
            } catch (_error) {
                return null;
            }
        };
        const entry = {
            missing: cloneForStorage(info.missing),
            category: info.category || '',
            subfolder: info.subfolder || '',
            filename: info.filename || '',
            downloadPath: info.downloadPath || '',
            downloadDirectory: info.downloadDirectory || '',
            baseDirectory: info.baseDirectory || '',
            sourceUrl: info.sourceUrl || '',
            workflowKey: info.workflowKey || '',
            workflowRouteKey: info.workflowRouteKey || '',
            workflowLabel: info.workflowLabel || '',
            workflowSignature: info.workflowSignature || '',
            workflowId: info.workflowId || '',
            workflowTabId: info.workflowTabId || '',
            workflowTabName: info.workflowTabName || '',
            workflowTabAriaControls: info.workflowTabAriaControls || '',
            workflowTabText: info.workflowTabText || '',
            downloadBackend: info.downloadBackend || ''
        };
        recovery[String(downloadId)] = entry;
        this.saveActiveDownloadRecovery();
    },

    removeActiveDownloadRecovery(downloadId) {
        if (!downloadId) return;

        const recovery = this.loadActiveDownloadRecovery();
        const key = String(downloadId);
        if (!(key in recovery)) return;
        delete recovery[key];
        this.saveActiveDownloadRecovery();
    },

    persistQueueCollapsedState(collapsed, delayMs = 250) {
        if (this._queueCollapsedPersistTimer) {
            clearTimeout(this._queueCollapsedPersistTimer);
            this._queueCollapsedPersistTimer = null;
        }
        const writeState = () => {
            this._queueCollapsedPersistTimer = null;
            safeStorage.setItem('model_resolver_queue_collapsed', collapsed ? '1' : '0');
        };
        const delay = Math.max(0, Number(delayMs) || 0);
        if (delay > 0) {
            this._queueCollapsedPersistTimer = setTimeout(writeState, delay);
        } else {
            writeState();
        }
    },

    persistQueueSplitWidth(width, delayMs = 250) {
        const nextWidth = Math.round(Number(width));
        if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
        if (this._queueSplitPersistTimer) {
            clearTimeout(this._queueSplitPersistTimer);
            this._queueSplitPersistTimer = null;
        }
        const writeWidth = () => {
            this._queueSplitPersistTimer = null;
            safeStorage.setItem('model_resolver_split_w', String(nextWidth));
        };
        const delay = Math.max(0, Number(delayMs) || 0);
        if (delay > 0) {
            this._queueSplitPersistTimer = setTimeout(writeWidth, delay);
        } else {
            writeWidth();
        }
    },

    loadDownloadHistory() {
        if (this._downloadHistoryLoaded) return this.downloadHistory || [];
        this._downloadHistoryLoaded = true;
        try {
            const raw = safeStorage.getItem(this.downloadHistoryStorageKey || 'model_resolver_download_history');
            const parsed = raw ? JSON.parse(raw) : [];
            this.downloadHistory = Array.isArray(parsed)
                ? parsed.filter(item => item && typeof item === 'object')
                : [];
        } catch (error) {
            console.warn('Model Resolver: failed to load download history', error);
            this.downloadHistory = [];
        }
        return this.downloadHistory;
    },

    getDownloadHistory() {
        if (!this._downloadHistoryLoaded) {
            this.loadDownloadHistory();
        }
        return Array.isArray(this.downloadHistory) ? this.downloadHistory : [];
    },

    saveDownloadHistory() {
        const history = this.getDownloadHistory().slice(0, this.downloadHistoryLimit || 200);
        this.downloadHistory = history;
        safeStorage.setItem(
            this.downloadHistoryStorageKey || 'model_resolver_download_history',
            JSON.stringify(history)
        );
    },

    getDownloadHistoryIdentity(entry = {}) {
        return [
            entry.path || '',
            entry.filename || '',
            entry.category || '',
            entry.sourceUrl || ''
        ].map(value => String(value || '').trim().toLowerCase()).join('::');
    },

    addDownloadHistoryEntry(entry = {}) {
        if (!entry || !entry.filename) return null;

        const history = this.getDownloadHistory();
        const identity = this.getDownloadHistoryIdentity(entry);
        const filtered = identity
            ? history.filter(item => this.getDownloadHistoryIdentity(item) !== identity)
            : history;
        const nextEntry = {
            ...entry,
            id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            completedAt: entry.completedAt || new Date().toISOString()
        };
        this.downloadHistory = [nextEntry, ...filtered].slice(0, this.downloadHistoryLimit || 200);
        this.saveDownloadHistory();
        this.updateQueuePanel?.();
        return nextEntry;
    },

    rememberCompletedDownloadHistory(downloadId, info = {}, progress = {}) {
        const missing = info?.missing || {};
        const filename = progress.filename
            || info.filename
            || missing.download_source?.filename
            || this.getFilenameFromPath(missing.original_path)
            || '';
        if (!filename) return null;

        const directory = progress.directory || info.downloadDirectory || '';
        const path = progress.path || info.downloadPath || '';
        const category = info.category || missing.category || progress.category || '';
        const workflowLabel = this.getDownloadWorkflowLabel?.(info) || info.workflowLabel || '';
        const nodeLabel = missing.subgraph_name || missing.node_type || (missing.subgraph_id ? 'Subgraph' : 'Node');
        const status = progress.already_exists ? 'already_exists' : 'completed';
        return this.addDownloadHistoryEntry({
            downloadId,
            filename,
            category,
            categoryLabel: this.getCategoryDisplayName?.(category) || category,
            nodeLabel,
            nodeId: missing.node_id ?? '',
            widgetIndex: missing.widget_index ?? '',
            workflowLabel,
            workflowId: info.workflowId || info.workflow_id || this.getWorkflowContextId?.(info) || '',
            workflowKey: info.workflowKey || '',
            workflowRouteKey: info.workflowRouteKey || '',
            workflowSignature: info.workflowSignature || '',
            workflowTabId: info.workflowTabId || '',
            workflowTabName: info.workflowTabName || '',
            workflowTabAriaControls: info.workflowTabAriaControls || '',
            workflowTabText: info.workflowTabText || '',
            path,
            directory,
            sourceUrl: info.sourceUrl || missing.download_source?.url || '',
            totalSize: progress.total_size || progress.size || 0,
            status,
            statusLabel: status === 'already_exists' ? 'Already downloaded' : 'Downloaded',
            message: progress.message || '',
            completedAt: new Date().toISOString()
        });
    },

    formatDownloadHistoryTime(value = '') {
        if (!value) return '';
        try {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return '';
            return date.toLocaleString(undefined, {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (_error) {
            return '';
        }
    },

    getDownloadHistoryFolderContext(entry = {}) {
        const filePath = entry.path || '';
        const directory = entry.directory || '';
        const targetPath = filePath || directory;
        const context = {
            context_scope: 'download_history',
            open_folder_label: targetPath ? 'Open Download Folder' : '',
            name: entry.filename || 'Download',
            path: targetPath,
            resolved_path: targetPath,
            open_path: filePath || directory,
            folder_path: directory || targetPath,
            download_directory: directory,
            download_path: filePath,
            category: entry.category || '',
            workflow_id: entry.workflowId || entry.workflow_id || (this.isLikelyWorkflowId?.(entry.workflowLabel) ? entry.workflowLabel : ''),
            workflow_label: entry.workflowLabel || '',
            workflow_key: entry.workflowKey || '',
            workflow_route_key: entry.workflowRouteKey || '',
            workflow_signature: entry.workflowSignature || '',
            workflow_tab_id: entry.workflowTabId || '',
            workflow_tab_name: entry.workflowTabName || '',
            workflow_tab_aria_controls: entry.workflowTabAriaControls || '',
            workflow_tab_text: entry.workflowTabText || '',
            node_id: entry.nodeId ?? '',
            widget_index: entry.widgetIndex ?? ''
        };

        return (targetPath || this.canSwitchToDownloadWorkflow?.(context)) ? context : null;
    },

    clearDownloadHistory() {
        this.downloadHistory = [];
        this.saveDownloadHistory();
        this.updateQueuePanel();
    },

    removeDownloadHistoryEntry(historyId = '', fallbackIndex = -1) {
        const history = this.getDownloadHistory();
        if (!history.length) return;

        const normalizedId = String(historyId || '');
        let nextHistory = history;
        if (normalizedId) {
            nextHistory = history.filter(entry => String(entry?.id || '') !== normalizedId);
        }

        if (nextHistory.length === history.length && Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < history.length) {
            nextHistory = history.filter((_, index) => index !== fallbackIndex);
        }

        if (nextHistory.length === history.length) return;
        this.downloadHistory = nextHistory;
        this.saveDownloadHistory();
        this.updateQueuePanel();
    },
};
