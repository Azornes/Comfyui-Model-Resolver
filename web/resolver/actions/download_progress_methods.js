export const downloadProgressMethods = {
    /**
     * Poll download progress
     */
    getDownloadProgressPollDelay(progress = {}, info = {}) {
        if (progress.status === 'paused') return 1500;
        if (progress.status === 'verifying') return 300;
        const backend = String(
            progress.download_backend || info.downloadBackend || info.download_backend || ''
        ).toLowerCase();
        return backend === 'huggingface_xet' ? 200 : 1000;
    },

    getDownloadProgressStatusLabel(status = '', percent = 0, isFinalizing = false, errorMessage = '') {
        if (status === 'downloading') {
            if (isFinalizing) return 'Finalizing';
            const percentLabel = this.formatDownloadPercent?.(percent) ?? String(Math.round(percent));
            return `${percentLabel}%`;
        }
        if (status === 'starting') return 'Starting';
        if (status === 'paused') return 'Paused';
        if (status === 'verifying') return 'Verifying SHA-256';
        if (status === 'error' || status === 'refresh_error') {
            if (String(errorMessage || '').toLowerCase().includes('sha256')) {
                return 'SHA-256 mismatch';
            }
            return 'Interrupted';
        }
        if (status === 'completed_checking') return 'Checking';
        return String(status || '').replace(/_/g, ' ') || 'Download';
    },

    isDownloadProgressStatus(status = '', isActive = false) {
        const terminalStatuses = new Set(['cancelling', 'cancelled', 'completed_checking', 'completed']);
        return status === 'starting'
            || status === 'downloading'
            || status === 'paused'
            || status === 'verifying'
            || (isActive && !terminalStatuses.has(status));
    },
};
