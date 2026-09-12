const MAX_IMAGE_FILE_SIZE = 64 * 1024 * 1024;
const MAX_WORKFLOW_FILE_SIZE = 16 * 1024 * 1024;

function getImageInspectorState(dialog) {
    if (!dialog.imageInspectorState) {
        dialog.imageInspectorState = {
            metadata: null,
            loadedModels: null,
            error: '',
            loading: '',
            requestToken: null,
        };
    }
    return dialog.imageInspectorState;
}

function isImageFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return String(file?.type || '').startsWith('image/')
        || /\.(png|jpe?g|webp)$/i.test(name);
}

function isWorkflowFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return file?.type === 'application/json'
        || file?.type === 'text/json'
        || name.endsWith('.json');
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read the image file.'));
        reader.readAsDataURL(file);
    });
}

function countLabel(count, singular, plural = `${singular}s`) {
    const value = Number(count) || 0;
    return `${value} ${value === 1 ? singular : plural}`;
}

export const imageMetadataMethods = {
    loadImageMetadata() {
        if (!this.contentElement) return null;
        this.contentElement.style.overflowY = 'auto';
        this.renderImageMetadataShell();
        return null;
    },

    renderImageMetadataShell() {
        if (!this.contentElement) return;

        const existingRoot = this.contentElement.querySelector('.mr-image-inspector');
        if (!existingRoot) {
            this.contentElement.innerHTML = `
                <div class="mr-image-inspector">
                    <div class="mr-loaded-models-header mr-image-inspector-header">
                        <div class="mr-loaded-title-block">
                            <h3 class="mr-loaded-models-title">Image Metadata</h3>
                            <p class="mr-loaded-models-subtitle">Inspect workflow data embedded in an image or loaded from JSON.</p>
                        </div>
                        <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="clear">Clear</button>
                    </div>
                    <div class="mr-image-inspector-tools">
                        <div class="mr-image-inspector-dropzone" data-image-inspector-dropzone tabindex="0" role="button" aria-label="Drop an image or workflow JSON file">
                            <div class="mr-image-inspector-dropzone-title">Drop an image or workflow JSON here</div>
                            <div class="mr-image-inspector-dropzone-subtitle">PNG, JPEG, WebP, or ComfyUI UI/API JSON</div>
                            <div class="mr-image-inspector-actions">
                                <button type="button" class="mr-btn mr-btn-primary mr-btn-sm" data-image-inspector-action="choose-image">Load image</button>
                                <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="choose-json">Load JSON</button>
                            </div>
                        </div>
                        <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-image-inspector-input="image">
                        <input type="file" accept="application/json,.json" hidden data-image-inspector-input="json">
                        <div class="mr-image-inspector-paste">
                            <label for="mr-image-inspector-json-text">Or paste workflow JSON</label>
                            <textarea id="mr-image-inspector-json-text" class="mr-image-inspector-textarea" rows="5" placeholder="Paste a ComfyUI UI workflow or API prompt graph..."></textarea>
                            <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="analyze-paste">Analyze pasted JSON</button>
                        </div>
                    </div>
                    <div class="mr-image-inspector-result" data-image-inspector-result></div>
                </div>
            `;
            this.bindImageMetadataEvents();
        }

        this.renderImageMetadataResult();
    },

    bindImageMetadataEvents() {
        const root = this.contentElement?.querySelector('.mr-image-inspector');
        if (!root || root.dataset.imageInspectorBound === '1') return;
        root.dataset.imageInspectorBound = '1';

        const imageInput = root.querySelector('[data-image-inspector-input="image"]');
        const jsonInput = root.querySelector('[data-image-inspector-input="json"]');
        const dropzone = root.querySelector('[data-image-inspector-dropzone]');

        dropzone?.addEventListener('click', (event) => {
            if (event.target.closest?.('button')) return;
            imageInput?.click();
        });

        root.addEventListener('click', (event) => {
            const action = event.target.closest?.('[data-image-inspector-action]')?.dataset?.imageInspectorAction;
            if (!action) return;
            if (action === 'choose-image') imageInput?.click();
            if (action === 'choose-json') jsonInput?.click();
            if (action === 'clear') this.clearImageMetadata();
            if (action === 'analyze-paste') {
                const textarea = root.querySelector('.mr-image-inspector-textarea');
                void this.inspectPastedWorkflow(textarea?.value || '');
            }
        });

        imageInput?.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void this.inspectImageFile(file);
        });
        jsonInput?.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void this.inspectWorkflowFile(file);
        });

        dropzone?.addEventListener('dragover', (event) => {
            event.preventDefault();
            dropzone.classList.add('is-dragover');
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        });
        dropzone?.addEventListener('dragleave', () => {
            dropzone.classList.remove('is-dragover');
        });
        dropzone?.addEventListener('drop', (event) => {
            event.preventDefault();
            dropzone.classList.remove('is-dragover');
            const file = event.dataTransfer?.files?.[0];
            if (file) void this.inspectImageMetadataFile(file);
        });
        dropzone?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            imageInput?.click();
        });
    },

    async inspectImageMetadataFile(file) {
        if (isImageFile(file)) {
            return this.inspectImageFile(file);
        }
        if (isWorkflowFile(file)) {
            return this.inspectWorkflowFile(file);
        }
        this.showNotification('Select an image or a workflow JSON file.', 'warning');
        return null;
    },

    async inspectImageFile(file) {
        if (file.size > MAX_IMAGE_FILE_SIZE) {
            this.showNotification('The image is too large to inspect (maximum 64 MB).', 'error');
            return null;
        }
        try {
            const dataUrl = await readFileAsDataUrl(file);
            return this.runImageMetadataInspection({
                source_type: 'image',
                filename: file.name,
                data_url: dataUrl,
            });
        } catch (error) {
            this.showNotification(error.message || 'Could not read the image file.', 'error');
            return null;
        }
    },

    async inspectWorkflowFile(file) {
        if (file.size > MAX_WORKFLOW_FILE_SIZE) {
            this.showNotification('The workflow JSON is too large to inspect (maximum 16 MB).', 'error');
            return null;
        }
        try {
            const text = await file.text();
            const workflow = JSON.parse(text);
            return this.runImageMetadataInspection({
                source_type: 'workflow',
                filename: file.name,
                workflow,
            });
        } catch (error) {
            this.showNotification(error.message || 'The workflow file is not valid JSON.', 'error');
            return null;
        }
    },

    async inspectPastedWorkflow(text) {
        const value = String(text || '').trim();
        if (!value) {
            this.showNotification('Paste a workflow JSON object first.', 'warning');
            return null;
        }
        if (new TextEncoder().encode(value).length > MAX_WORKFLOW_FILE_SIZE) {
            this.showNotification('The workflow JSON is too large to inspect (maximum 16 MB).', 'error');
            return null;
        }
        try {
            return this.runImageMetadataInspection({
                source_type: 'workflow',
                filename: 'Pasted workflow',
                json_text: value,
            });
        } catch (error) {
            this.showNotification(error.message || 'The pasted workflow is not valid JSON.', 'error');
            return null;
        }
    },

    async runImageMetadataInspection(payload) {
        const state = getImageInspectorState(this);
        const requestToken = `image-inspector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        state.requestToken = requestToken;
        state.metadata = null;
        state.loadedModels = null;
        state.error = '';
        state.loading = 'metadata';
        this.renderImageMetadataResult();

        try {
            const metadata = await this.fetchJson(
                '/model_resolver/inspect-metadata',
                { method: 'POST', body: JSON.stringify(payload) },
                'Read workflow metadata'
            );
            if (state.requestToken !== requestToken) return null;

            state.metadata = metadata;
            if (!metadata?.workflow) {
                state.loading = '';
                this.renderImageMetadataResult();
                return metadata;
            }

            state.loading = 'models';
            this.renderImageMetadataResult();
            const loadedProgressId = `inspector-loaded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const loadedModels = await this.fetchJson(
                '/model_resolver/loaded',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        workflow: metadata.workflow,
                        loaded_id: loadedProgressId,
                    }),
                },
                'Scan workflow models'
            );
            if (state.requestToken !== requestToken) return null;
            state.loadedModels = loadedModels;
            state.loading = '';
            this.renderImageMetadataResult();
            return metadata;
        } catch (error) {
            if (state.requestToken !== requestToken) return null;
            state.loading = '';
            state.error = error?.message || 'Could not inspect workflow metadata.';
            this.renderImageMetadataResult();
            return null;
        }
    },

    clearImageMetadata() {
        const state = getImageInspectorState(this);
        state.requestToken = `cleared-${Date.now()}`;
        state.metadata = null;
        state.loadedModels = null;
        state.error = '';
        state.loading = '';
        this.renderImageMetadataShell();
    },

    renderImageMetadataResult() {
        const result = this.contentElement?.querySelector('[data-image-inspector-result]');
        if (!result) return;
        const state = getImageInspectorState(this);

        if (state.loading) {
            const message = state.loading === 'models'
                ? 'Scanning workflow models...'
                : 'Reading embedded metadata...';
            result.innerHTML = `<div class="mr-image-inspector-loading"><span class="mr-spinner"></span>${this.escapeHtml(message)}</div>`;
            return;
        }
        if (state.error) {
            result.innerHTML = `<p class="mr-error-text">${this.escapeHtml(state.error)}</p>`;
            return;
        }
        if (!state.metadata) {
            result.innerHTML = '<p class="mr-image-inspector-empty">Drop an image or workflow JSON to inspect it.</p>';
            return;
        }

        const metadata = state.metadata;
        const image = metadata.image || {};
        const imageFormat = image.format || '—';
        const dimensions = image.width && image.height
            ? `${image.width} × ${image.height}`
            : '—';
        const workflowFormat = metadata.workflow_format
            ? String(metadata.workflow_format).toUpperCase()
            : 'Not found';
        const metadataKeys = Array.isArray(metadata.metadata?.keys)
            ? metadata.metadata.keys.join(', ')
            : '—';
        const parameters = String(metadata.metadata?.parameters || '').trim();
        const rows = [
            ['Source file', metadata.filename || '—'],
            image.format ? ['Image format', imageFormat] : null,
            image.width && image.height ? ['Dimensions', dimensions] : null,
            ['Workflow format', workflowFormat],
            ['Workflow source', metadata.workflow_source || '—'],
            ['Workflow nodes', metadata.workflow
                ? countLabel(metadata.workflow_node_count, 'node')
                : 'No embedded workflow'],
            image.mode ? ['Color mode', image.mode] : null,
            ['Metadata keys', metadataKeys],
        ].filter(Boolean);
        const rowsHtml = rows.map(([label, value]) => `
            <tr${label === 'Metadata keys' ? ' class="mr-info-row-wide"' : ''}>
                <td>${this.escapeHtml(label)}</td>
                <td>${this.escapeHtml(value)}</td>
            </tr>
        `).join('');
        const parametersHtml = parameters ? `
            <tr class="mr-info-row-wide mr-image-inspector-parameters-row">
                <td>${this.escapeHtml('Generation parameters')}</td>
                <td><pre class="mr-image-inspector-parameters">${this.escapeHtml(parameters)}</pre></td>
            </tr>
        ` : '';
        const modelContainerId = `mr-image-inspector-models-${Date.now()}`;

        result.innerHTML = `
            <section class="mr-image-inspector-summary">
                <div class="mr-loaded-models-header">
                    <div class="mr-loaded-title-block">
                        <h3 class="mr-loaded-models-title">Extracted Metadata</h3>
                        <p class="mr-loaded-models-subtitle">Read-only information from the selected source.</p>
                    </div>
                </div>
                <table class="mr-info-table mr-image-inspector-info-table"><tbody>${rowsHtml}${parametersHtml}</tbody></table>
            </section>
            <section class="mr-image-inspector-models">
                <div id="${this.escapeHtml(modelContainerId)}"></div>
            </section>
        `;

        const modelContainer = result.querySelector(`#${modelContainerId}`);
        if (!metadata.workflow) {
            modelContainer.innerHTML = this.renderStatusMessage(
                'No supported ComfyUI workflow was found in this image.',
                'info'
            );
        } else if (state.loadedModels) {
            this.displayLoadedModels(modelContainer, state.loadedModels);
        } else {
            modelContainer.innerHTML = this.renderStatusMessage(
                'No loaded model scan is available yet.',
                'info'
            );
        }
        this.bindTooltips?.(result);
    },
};
