export const downloadProgressMethods = {
    /**
     * Poll download progress
     */
    getDownloadProgressPollDelay(progress = {}, info = {}) {
        if (progress.status === 'paused') return 1500;
        const backend = String(
            progress.download_backend || info.downloadBackend || info.download_backend || ''
        ).toLowerCase();
        return backend === 'huggingface_xet' ? 200 : 1000;
    },

    getDownloadProgressStatusLabel(status = '', percent = 0, isFinalizing = false) {
        if (status === 'downloading') {
            if (isFinalizing) return 'Finalizing';
            const percentLabel = this.formatDownloadPercent?.(percent) ?? String(Math.round(percent));
            return `${percentLabel}%`;
        }
        if (status === 'starting') return 'Starting';
        if (status === 'paused') return 'Paused';
        if (status === 'completed_checking') return 'Checking';
        return String(status || '').replace(/_/g, ' ') || 'Download';
    },

    isDownloadProgressStatus(status = '', isActive = false) {
        const terminalStatuses = new Set(['cancelling', 'cancelled', 'error', 'refresh_error', 'completed_checking', 'completed']);
        return status === 'starting'
            || status === 'downloading'
            || status === 'paused'
            || (isActive && !terminalStatuses.has(status));
    },
};
