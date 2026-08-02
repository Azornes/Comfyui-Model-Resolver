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
};
