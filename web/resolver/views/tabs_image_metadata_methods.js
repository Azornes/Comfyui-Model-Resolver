const MAX_IMAGE_FILE_SIZE = 64 * 1024 * 1024;
const MAX_WORKFLOW_FILE_SIZE = 16 * 1024 * 1024;

const TRANSFER_CATEGORY_ALIASES = Object.freeze({
    checkpoint: 'checkpoints',
    checkpoints: 'checkpoints',
    ckpt: 'checkpoints',
    lora: 'loras',
    loras: 'loras',
    clip: 'text_encoders',
    text_encoder: 'text_encoders',
    text_encoders: 'text_encoders',
    vae: 'vae',
    control_net: 'controlnet',
    controlnet: 'controlnet',
    upscale: 'upscale_models',
    upscaler: 'upscale_models',
    upscale_model: 'upscale_models',
    upscale_models: 'upscale_models',
    unet: 'diffusion_models',
    diffusion_model: 'diffusion_models',
    diffusion_models: 'diffusion_models',
    embedding: 'embeddings',
    embeddings: 'embeddings',
});

const MERGE_LORA_NODE_TYPES = new Set([
    'LoraLoaderV2',
    'Lora Loader (LoraManager)',
    'Lora Stacker (LoraManager)',
]);
const MERGE_POWER_LORA_NODE_TYPE = 'Power Lora Loader (rgthree)';

function normalizeTransferCategory(value) {
    const token = String(value || '').trim().toLowerCase().replaceAll('-', '_');
    return TRANSFER_CATEGORY_ALIASES[token] || token;
}

function getTransferNodeKey(model = {}) {
    const isTopLevel = model.is_top_level !== false;
    const scope = isTopLevel
        ? 'top'
        : `sub:${String(model.subgraph_id || '')}`;
    return `${scope}:${String(model.node_id ?? '')}`;
}

function normalizeTransferModelIdentity(value) {
    return String(value || '').trim().replaceAll('\\', '/').toLowerCase();
}

function getImageInspectorState(dialog) {
    if (!dialog.imageInspectorState) {
        dialog.imageInspectorState = {
            metadata: null,
            loadedModels: null,
            error: '',
            loading: '',
            requestToken: null,
            transfer: null,
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

function buildCivitaiModelData(resources = []) {
    const models = resources.map((resource, index) => {
        const modelVersionId = resource?.model_version_id
            ?? resource?.modelVersionId
            ?? '';
        const rawStrength = resource?.strength;
        const numericStrength = Number(rawStrength);
        const strength = Number.isFinite(numericStrength) ? numericStrength : null;
        const name = String(
            resource?.name
            || resource?.model_name
            || resource?.modelName
            || (modelVersionId ? `Civitai model ${modelVersionId}` : '')
        ).trim();
        if (!name) return null;

        return {
            name,
            category: String(resource?.category || 'unknown'),
            node_id: `civitai-resource-${modelVersionId || index}`,
            widget_index: null,
            node_type: 'Civitai metadata',
            node_title: String(resource?.version_name || resource?.versionName || '').trim(),
            exists: false,
            active: resource?.active !== false && (strength === null || strength !== 0),
            connected: true,
            strength,
            original_path: '',
            model_id: resource?.model_id ?? resource?.modelId ?? null,
            model_version_id: modelVersionId || null,
            source: 'civitai_metadata',
        };
    }).filter(Boolean);

    return {
        loaded_models: models,
        total: models.length,
    };
}

export const imageMetadataMethods = {
    loadImageMetadata() {
        if (!this.contentElement) return null;
        this.contentElement.style.overflowY = 'auto';
        this.renderImageMetadataShell();
        void this.openMetadataTransfer();
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
                            <p class="mr-loaded-models-subtitle">Paste workflow JSON or drop an image or JSON file anywhere in this panel.</p>
                        </div>
                        <div class="mr-image-inspector-header-actions">
                            <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="clear">Clear</button>
                        </div>
                    </div>
                    <div class="mr-image-inspector-tools">
                        <input type="file" accept="image/png,image/jpeg,image/webp,application/json,.json" hidden data-image-inspector-input="file">
                        <div class="mr-image-inspector-paste">
                            <label for="mr-image-inspector-json-text">Paste workflow JSON</label>
                            <textarea id="mr-image-inspector-json-text" class="mr-image-inspector-textarea" rows="5" placeholder="Paste a ComfyUI UI workflow or API prompt graph..."></textarea>
                            <div class="mr-image-inspector-actions">
                                <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="analyze-paste">Analyze pasted JSON</button>
                                <button type="button" class="mr-btn mr-btn-primary mr-btn-sm" data-image-inspector-action="choose-file">Load file</button>
                            </div>
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

        const fileInput = root.querySelector('[data-image-inspector-input="file"]');
        const setDragOver = (active) => {
            root.classList.toggle('is-dragover', active);
        };
        const isFileDrag = (event) => {
            const types = Array.from(event.dataTransfer?.types || []);
            return types.includes('Files') || Boolean(event.dataTransfer?.files?.length);
        };
        let dragDepth = 0;

        root.addEventListener('click', (event) => {
            const nodeChip = event.target.closest?.('[data-image-transfer-node]');
            if (nodeChip) {
                this.toggleMetadataTransferNode(nodeChip.dataset.imageTransferNode);
                return;
            }

            const action = event.target.closest?.('[data-image-inspector-action]')?.dataset?.imageInspectorAction;
            if (!action) return;
            if (action === 'choose-file') fileInput?.click();
            if (action === 'clear') this.clearImageMetadata();
            if (action === 'clear-transfer-targets') this.clearMetadataTransferTargets();
            if (action === 'retry-transfer-targets') void this.openMetadataTransfer();
            if (action === 'apply-transfer') void this.applyMetadataTransfer();
            if (action === 'analyze-paste') {
                const textarea = root.querySelector('.mr-image-inspector-textarea');
                void this.inspectPastedWorkflow(textarea?.value || '');
            }
        });

        root.addEventListener('change', (event) => {
            const input = event.target;
            if (input.matches?.('[data-image-transfer-mode]')) {
                const state = getImageInspectorState(this);
                if (state.transfer) state.transfer.mode = input.value === 'merge' ? 'merge' : 'replace';
                this.renderImageMetadataResult();
                return;
            }
        });

        fileInput?.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void this.inspectImageMetadataFile(file);
        });

        root.addEventListener('dragenter', (event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            dragDepth += 1;
            setDragOver(true);
        });
        root.addEventListener('dragover', (event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            setDragOver(true);
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        });
        root.addEventListener('dragleave', (event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0 || (event.relatedTarget && !root.contains(event.relatedTarget))) {
                setDragOver(false);
            }
        });
        root.addEventListener('drop', (event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            dragDepth = 0;
            setDragOver(false);
            const file = event.dataTransfer?.files?.[0];
            if (file) void this.inspectImageMetadataFile(file);
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
        if (state.transfer) {
            state.transfer.requestToken = null;
            state.transfer.loading = false;
            state.transfer.applying = false;
            state.transfer.error = '';
        }
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
                void this.openMetadataTransfer();
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
            void this.openMetadataTransfer();
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
        void this.openMetadataTransfer();
    },

    renderImageMetadataResult() {
        const result = this.contentElement?.querySelector('[data-image-inspector-result]');
        if (!result) return;
        const state = getImageInspectorState(this);

        if (state.loading) {
            const message = state.loading === 'models'
                ? 'Scanning workflow models...'
                : 'Reading embedded metadata...';
            result.innerHTML = `
                <div class="mr-image-inspector-loading"><span class="mr-spinner"></span>${this.escapeHtml(message)}</div>
                ${this.renderMetadataTransferPanel(state)}
            `;
            return;
        }
        if (state.error) {
            result.innerHTML = `
                <p class="mr-error-text">${this.escapeHtml(state.error)}</p>
                ${this.renderMetadataTransferPanel(state)}
            `;
            return;
        }
        if (!state.metadata) {
            result.innerHTML = `
                <p class="mr-image-inspector-empty">Drop an image or workflow JSON to inspect it.</p>
                ${this.renderMetadataTransferPanel(state)}
            `;
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
        const civitaiWorkflow = String(metadata.civitai_workflow || '').trim();
        const civitaiResources = Array.isArray(metadata.civitai_resources)
            ? metadata.civitai_resources
            : [];
        const civitaiModelData = buildCivitaiModelData(civitaiResources);
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
            civitaiWorkflow ? ['Civitai workflow', civitaiWorkflow] : null,
            civitaiResources.length
                ? ['Civitai resources', countLabel(civitaiResources.length, 'resource')]
                : null,
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
            ${this.renderMetadataTransferPanel(state)}
            <section class="mr-image-inspector-models">
                <div id="${this.escapeHtml(modelContainerId)}"></div>
            </section>
        `;

        const modelContainer = result.querySelector(`#${modelContainerId}`);
        if (!metadata.workflow && civitaiModelData.total) {
            this.displayLoadedModels(modelContainer, civitaiModelData, {
                title: 'Referenced Models',
                subtitle: 'Models reported by embedded Civitai metadata.',
                includeContextMenu: false,
            });
        } else if (!metadata.workflow) {
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

    getMetadataTransferSourceModels(loadedModels = null) {
        const models = Array.isArray(loadedModels?.loaded_models)
            ? loadedModels.loaded_models
            : [];
        return models
            .map((model, sourceIndex) => ({ model, sourceIndex }))
            .filter(({ model }) => (
                model
                && !model.is_urn
                && String(model.original_path || '').trim()
                && normalizeTransferCategory(model.category)
            ));
    },

    getMetadataTransferTargetGroups(loadedModels = null) {
        const models = Array.isArray(loadedModels?.loaded_models)
            ? loadedModels.loaded_models
            : [];
        const categoryGroups = new Map();
        for (const model of models) {
            const rawWidgetIndex = model?.widget_index;
            const widgetIndex = Number(rawWidgetIndex);
            const hasWidgetIndex = (
                Number.isInteger(rawWidgetIndex)
                || (
                    typeof rawWidgetIndex === 'string'
                    && rawWidgetIndex.trim() !== ''
                    && Number.isInteger(widgetIndex)
                )
            );
            if (!model || model.is_urn || !hasWidgetIndex || widgetIndex < 0) continue;
            const category = normalizeTransferCategory(model.category);
            if (!category) continue;

            let categoryGroup = categoryGroups.get(category);
            if (!categoryGroup) {
                categoryGroup = {
                    category,
                    nodes: new Map(),
                };
                categoryGroups.set(category, categoryGroup);
            }

            const nodeKey = getTransferNodeKey(model);
            let node = categoryGroup.nodes.get(nodeKey);
            if (!node) {
                node = {
                    nodeKey,
                    nodeId: model.node_id,
                    nodeType: String(model.node_type || '').trim(),
                    nodeTitle: String(model.node_title || '').trim(),
                    subgraphId: String(model.subgraph_id || ''),
                    subgraphName: String(model.subgraph_name || '').trim(),
                    isTopLevel: model.is_top_level !== false,
                    active: false,
                    refs: [],
                };
                categoryGroup.nodes.set(nodeKey, node);
            }
            node.active = node.active || (model.active !== false && model.connected !== false);
            node.refs.push({
                ...model,
                widget_index: widgetIndex,
                transferSlot: node.refs.length + 1,
                transferKey: `${category}:${nodeKey}:${node.refs.length}`,
            });
        }
        return Array.from(categoryGroups.values()).map(group => ({
            category: group.category,
            nodes: Array.from(group.nodes.values()),
        }));
    },

    getMetadataTransferModelValue(model = {}) {
        return String(
            model?.original_path
            || model?.name
            || model?.filename
            || model?.resolved_path
            || model?.path
            || ''
        ).trim();
    },

    getMetadataTransferModelLabel(model = {}, fallback = 'Unknown model') {
        const value = this.getMetadataTransferModelValue(model);
        const filename = this.getFilenameFromPath?.(value) || value;
        const label = this.stripModelExtension?.(filename) || filename;
        return String(label || fallback).trim() || fallback;
    },

    getMetadataTransferPreviewRows(state) {
        const sourceEntries = this.getMetadataTransferSourceModels(state?.loadedModels);
        const transfer = state?.transfer;
        if (!transfer) return [];

        const targetGroups = Array.isArray(transfer.targetGroups) ? transfer.targetGroups : [];
        const selectedNodeKeys = transfer.selectedNodeKeys instanceof Set
            ? transfer.selectedNodeKeys
            : new Set();
        const selectedTargets = [];
        const sourcesByCategory = new Map();

        for (const { model } of sourceEntries) {
            const category = normalizeTransferCategory(model.category);
            if (!category) continue;
            if (!sourcesByCategory.has(category)) sourcesByCategory.set(category, []);
            sourcesByCategory.get(category).push(model);
        }

        for (const group of targetGroups) {
            const category = normalizeTransferCategory(group.category);
            for (const node of group.nodes || []) {
                if (!selectedNodeKeys.has(node.nodeKey)) continue;
                for (const ref of node.refs || []) {
                    selectedTargets.push({ category, node, ref });
                }
            }
        }

        const makeRow = (
            target,
            nextModel = null,
            { operation = 'replace', currentLabelOverride = '', forceChange = false } = {},
        ) => {
            const currentValue = this.getMetadataTransferModelValue(target.ref);
            const currentLabel = currentLabelOverride
                || this.getMetadataTransferModelLabel(target.ref);
            const nextValue = nextModel
                ? this.getMetadataTransferModelValue(nextModel)
                : '';
            const nextLabel = nextModel
                ? this.getMetadataTransferModelLabel(nextModel)
                : 'Unchanged';
            const currentIdentity = normalizeTransferModelIdentity(currentValue);
            const nextIdentity = normalizeTransferModelIdentity(nextValue);
            const unchanged = !forceChange && (
                !nextModel
                || (
                    currentIdentity && nextIdentity
                        ? currentIdentity === nextIdentity
                        : currentLabel === nextLabel
                )
            );
            const nodeName = target.node.nodeTitle
                || target.node.nodeType
                || `Node ${target.node.nodeId}`;
            return {
                category: target.category,
                nodeName,
                nodeId: target.node.nodeId,
                slot: target.ref?.transferSlot || 1,
                currentLabel,
                currentValue,
                nextLabel: unchanged ? 'Unchanged' : nextLabel,
                nextValue,
                operation: unchanged ? 'unchanged' : operation,
                unchanged,
            };
        };

        if (transfer.mode === 'merge') {
            const selectedNodes = new Map();
            for (const target of selectedTargets) {
                let entry = selectedNodes.get(target.node.nodeKey);
                if (!entry) {
                    entry = { node: target.node, targets: [] };
                    selectedNodes.set(target.node.nodeKey, entry);
                }
                entry.targets.push(target);
            }

            const previewRows = [];
            for (const { node, targets } of selectedNodes.values()) {
                const nodeType = String(node.nodeType || '');
                const canAppendLoras = (
                    MERGE_LORA_NODE_TYPES.has(nodeType)
                    || nodeType === MERGE_POWER_LORA_NODE_TYPE
                );
                const loraSources = sourcesByCategory.get('loras') || [];
                if (canAppendLoras && loraSources.length) {
                    for (const source of loraSources) {
                        previewRows.push(makeRow(
                            targets[0],
                            source,
                            {
                                operation: 'add',
                                currentLabelOverride: 'Existing LoRAs',
                                forceChange: true,
                            },
                        ));
                    }
                    continue;
                }
                for (const target of targets) {
                    previewRows.push(makeRow(target, null, { operation: 'merge' }));
                }
            }
            return previewRows;
        }

        const sourceIndexes = new Map();
        return selectedTargets.map(target => {
            const sources = sourcesByCategory.get(target.category) || [];
            const sourceIndex = sourceIndexes.get(target.category) || 0;
            sourceIndexes.set(target.category, sourceIndex + 1);
            const source = sources.length === 1
                ? sources[0]
                : sources[sourceIndex];
            return makeRow(target, source || null);
        });
    },

    renderMetadataTransferPreview(rows = []) {
        const previewRows = Array.isArray(rows) ? rows : [];
        const content = previewRows.length
            ? previewRows.map(row => {
                const categoryLabel = this.getCategoryDisplayName(row.category).toUpperCase();
                const slotLabel = row.slot > 1 ? ` · Slot ${row.slot}` : '';
                const targetLabel = `${categoryLabel} · ${row.nodeName} · Node ${row.nodeId}${slotLabel}`;
                const operationLabel = row.unchanged
                    ? 'Unchanged'
                    : row.operation === 'add'
                        ? 'Added'
                        : 'Replace';
                const currentTitle = row.currentValue || row.currentLabel;
                const nextTitle = row.nextValue || row.nextLabel;
                return `
                    <div class="mr-image-transfer-preview-row${row.unchanged ? ' is-unchanged' : ''}">
                        <div class="mr-image-transfer-preview-side">
                            <span class="mr-image-transfer-preview-label">${this.escapeHtml(targetLabel)} · Current</span>
                            <strong class="mr-image-transfer-preview-value" title="${this.escapeHtml(currentTitle)}">${this.escapeHtml(row.currentLabel)}</strong>
                        </div>
                        <span class="mr-image-transfer-preview-arrow" aria-hidden="true">→</span>
                        <div class="mr-image-transfer-preview-side mr-image-transfer-preview-side-next">
                            <span class="mr-image-transfer-preview-label">${this.escapeHtml(operationLabel)}</span>
                            <strong class="mr-image-transfer-preview-value" title="${this.escapeHtml(nextTitle)}">${this.escapeHtml(row.nextLabel)}</strong>
                        </div>
                    </div>
                `;
            }).join('')
            : '<p class="mr-image-transfer-preview-empty">Select a target node above to preview model changes.</p>';
        return `
            <section class="mr-image-transfer-preview">
                <div class="mr-image-transfer-preview-header">
                    <h4>Transfer preview <span>${previewRows.length} ${previewRows.length === 1 ? 'slot' : 'slots'}</span></h4>
                </div>
                <div class="mr-image-transfer-preview-list">${content}</div>
            </section>
        `;
    },

    renderMetadataTransferPanel(state) {
        const sourceEntries = this.getMetadataTransferSourceModels(state.loadedModels);
        const transfer = state?.transfer || {
            loading: false,
            applying: false,
            error: '',
            mode: 'replace',
            targetGroups: [],
            selectedNodeKeys: new Set(),
        };
        const targetGroups = Array.isArray(transfer.targetGroups) ? transfer.targetGroups : [];
        const selectedNodeKeys = transfer.selectedNodeKeys instanceof Set
            ? transfer.selectedNodeKeys
            : new Set();
        const sourceCategories = new Set(
            sourceEntries
                .map(({ model }) => normalizeTransferCategory(model.category))
        );
        const countText = (count, singular, plural = `${singular}s`) => (
            `${count} ${count === 1 ? singular : plural}`
        );
        const sourceSummary = sourceEntries.length
            ? `${countText(sourceEntries.length, 'metadata model')} ready from the imported workflow.`
            : state?.loading === 'models'
                ? 'Scanning the imported workflow for transferable models...'
                : state?.loading
                    ? 'Reading source workflow metadata...'
                    : state?.metadata?.workflow
                        ? 'No transferable model paths were found in the imported workflow.'
                        : state?.metadata
                            ? 'The imported source has no embedded ComfyUI workflow.'
                            : 'Import a workflow with model metadata to enable Apply transfer.';

        if (transfer.loading) {
            return `
                <section class="mr-image-transfer mr-image-transfer-loading">
                    <div class="mr-image-inspector-loading">Scanning the current workflow for target nodes...</div>
                    <p class="mr-image-transfer-note">${this.escapeHtml(sourceSummary)}</p>
                </section>
            `;
        }
        if (transfer.error) {
            return `
                <section class="mr-image-transfer">
                    <div class="mr-image-transfer-header">
                        <div>
                            <h3 class="mr-loaded-models-title">Transfer models to current workflow</h3>
                            <p class="mr-error-text">${this.escapeHtml(transfer.error)}</p>
                        </div>
                        <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="retry-transfer-targets">Retry</button>
                    </div>
                    <p class="mr-image-transfer-note">${this.escapeHtml(sourceSummary)}</p>
                </section>
            `;
        }

        const renderNode = (node, isAvailable) => {
            const selected = selectedNodeKeys.has(node.nodeKey);
            const scopeLabel = node.isTopLevel
                ? ''
                : ` · ${node.subgraphName || node.subgraphId || 'subgraph'}`;
            const nodeName = node.nodeTitle || node.nodeType || `Node ${node.nodeId}`;
            const nodeType = node.nodeType && node.nodeType !== nodeName
                ? node.nodeType
                : 'Workflow node';
            const unavailable = sourceEntries.length > 0 && !isAvailable;
            const contextMenuAttrs = this.getContextMenuAttrs?.({
                context_scope: 'loaded_model',
                node_id: node.nodeId,
                node_type: node.nodeType,
                node_title: node.nodeTitle,
                subgraph_id: node.subgraphId,
                subgraph_name: node.subgraphName,
                is_top_level: node.isTopLevel,
            }, 'Right-click to open node options') || '';
            return `
                <button type="button" class="mr-model-chip mr-image-transfer-node-chip ${selected ? 'is-selected' : ''}${unavailable ? ' is-unavailable' : ''}"
                    data-image-transfer-node="${this.escapeHtml(node.nodeKey)}"
                    aria-pressed="${selected ? 'true' : 'false'}"
                    aria-disabled="${unavailable ? 'true' : 'false'}"
                    ${contextMenuAttrs}
                    ${unavailable ? 'title="No matching model category in the metadata workflow"' : ''}>
                    <span class="mr-image-transfer-node-name">${this.escapeHtml(nodeName)} · Node ${this.escapeHtml(node.nodeId)}${this.escapeHtml(scopeLabel)}</span>
                    <span class="mr-image-transfer-node-meta">${this.escapeHtml(nodeType)} · ${countText(node.refs.length, 'model slot')}</span>
                </button>
            `;
        };
        const renderNodeGroup = (nodes, label, groupClass, isAvailable) => {
            if (!nodes.length) return '';
            const chips = nodes
                .map(node => renderNode(node, isAvailable))
                .join('');
            return `
                <div class="mr-model-group mr-model-group-${groupClass}">
                    <div class="mr-model-group-head">
                        <span class="mr-model-group-label mr-model-group-label-${groupClass}"><span class="mr-model-group-dot"></span>${label} <span class="mr-model-group-count">${nodes.length}</span></span>
                    </div>
                    <div class="mr-model-chip-list${groupClass === 'inactive' ? ' mr-model-chip-list-inactive' : ''}">${chips}</div>
                </div>
            `;
        };

        const targetRows = targetGroups.length
            ? targetGroups.map(group => {
                const nodes = Array.isArray(group.nodes) ? group.nodes : [];
                const activeNodes = nodes.filter(node => node.active);
                const inactiveNodes = nodes.filter(node => !node.active);
                const isAvailable = sourceEntries.length === 0 || sourceCategories.has(group.category);
                const isUnavailable = sourceEntries.length > 0 && !isAvailable;
                const selectedCount = nodes.filter(node => selectedNodeKeys.has(node.nodeKey)).length;
                return `
                    <div class="mr-model-section" data-image-transfer-category="${this.escapeHtml(group.category)}">
                        <div class="mr-model-section-header">
                            <div class="mr-model-section-heading">
                                <span class="mr-model-section-title">${this.escapeHtml(this.getCategoryDisplayName(group.category).toUpperCase())}</span>
                                <span class="mr-model-section-total">${countText(nodes.length, 'node')}</span>
                            </div>
                            <div class="mr-model-section-counts">
                                ${activeNodes.length ? `<span class="mr-model-count-pill is-active">${countText(activeNodes.length, 'active')}</span>` : ''}
                                ${inactiveNodes.length ? `<span class="mr-model-count-pill is-inactive">${countText(inactiveNodes.length, 'inactive')}</span>` : ''}
                                ${selectedCount ? `<span class="mr-model-count-pill mr-image-transfer-selected-pill">${countText(selectedCount, 'selected')}</span>` : ''}
                                ${isUnavailable ? '<span class="mr-model-count-pill mr-image-transfer-unavailable-pill">No source model</span>' : ''}
                            </div>
                        </div>
                        ${renderNodeGroup(activeNodes, 'Active', 'active', isAvailable)}
                        ${renderNodeGroup(inactiveNodes, 'Inactive', 'inactive', isAvailable)}
                    </div>
                `;
            }).join('')
            : '<p class="mr-image-transfer-empty">No model nodes were found in the current workflow.</p>';

        const mode = transfer.mode === 'merge' ? 'merge' : 'replace';
        const allTargetNodes = targetGroups.flatMap(group => group.nodes || []);
        const allTargetNodeKeys = new Set(allTargetNodes.map(node => node.nodeKey));
        const selectedTargetCount = Array.from(selectedNodeKeys)
            .filter(nodeKey => allTargetNodeKeys.has(nodeKey))
            .length;
        const applyDisabled = transfer.applying || !sourceEntries.length || !selectedTargetCount;
        const selectionSourceText = sourceEntries.length
            ? countText(sourceEntries.length, 'metadata model')
            : 'No source workflow imported';
        const previewRows = this.getMetadataTransferPreviewRows(state);
        return `
            <section class="mr-image-transfer">
                <div class="mr-image-transfer-header">
                    <div>
                        <h3 class="mr-loaded-models-title">Transfer models to current workflow <span class="mr-loaded-total">${selectedTargetCount}/${allTargetNodeKeys.size}</span></h3>
                        <p class="mr-loaded-models-subtitle">Select the target nodes. ${this.escapeHtml(sourceSummary)}</p>
                    </div>
                    <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="clear-transfer-targets">Clear selection</button>
                </div>
                <div class="mr-image-transfer-mode" role="group" aria-label="Transfer mode">
                    <label class="mr-image-transfer-mode-option">
                        <input type="radio" name="mr-image-transfer-mode" value="replace" data-image-transfer-mode ${mode === 'replace' ? 'checked' : ''}>
                        <span><strong>Replace</strong><small>Overwrite slots in selected nodes.</small></span>
                    </label>
                    <label class="mr-image-transfer-mode-option">
                        <input type="radio" name="mr-image-transfer-mode" value="merge" data-image-transfer-mode ${mode === 'merge' ? 'checked' : ''}>
                        <span><strong>Merge / Add</strong><small>Keep current values and append to multi-LoRA nodes.</small></span>
                    </label>
                </div>
                <p class="mr-image-transfer-note">Click a node name to select it. A green border marks nodes that will be updated. ${this.escapeHtml(sourceEntries.length ? 'Categories without a matching metadata model are shown as unavailable.' : 'Target nodes come from the current ComfyUI workflow. Import a source workflow with model metadata to enable Apply transfer.')}</p>
                <div class="mr-models-list mr-models-list-pad mr-image-transfer-node-list">${targetRows}</div>
                ${this.renderMetadataTransferPreview(previewRows)}
                <div class="mr-image-transfer-actions">
                    <span class="mr-image-transfer-selection-count">${this.escapeHtml(selectionSourceText)} · ${selectedTargetCount} selected node${selectedTargetCount === 1 ? '' : 's'}</span>
                    <button type="button" class="mr-btn mr-btn-primary mr-btn-sm" data-image-inspector-action="apply-transfer" ${applyDisabled ? 'disabled' : ''}>
                        ${transfer.applying ? 'Applying...' : 'Apply transfer'}
                    </button>
                </div>
            </section>
        `;
    },

    async openMetadataTransfer() {
        const state = getImageInspectorState(this);
        const imageRequestToken = state.requestToken;
        const workflow = this.getCurrentWorkflow?.();
        const workflowSignature = workflow
            ? (this.getWorkflowSignature?.(workflow) || '')
            : '';
        const previousTransfer = state.transfer;
        const preserveSelection = Boolean(
            workflowSignature
            && previousTransfer?.workflowSignature
            && previousTransfer.workflowSignature === workflowSignature
        );
        const token = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        state.transfer = {
            open: true,
            loading: Boolean(workflow),
            applying: false,
            error: '',
            mode: previousTransfer?.mode === 'merge' ? 'merge' : 'replace',
            requestToken: token,
            workflowSignature,
            targetGroups: [],
            selectedNodeKeys: preserveSelection
                ? new Set(previousTransfer.selectedNodeKeys || [])
                : new Set(),
        };
        this.renderImageMetadataResult();

        if (!workflow) {
            state.transfer.loading = false;
            state.transfer.error = 'No current workflow is available.';
            this.renderImageMetadataResult();
            return null;
        }

        try {
            const targetModels = await this.fetchJson(
                '/model_resolver/loaded',
                {
                    method: 'POST',
                    body: JSON.stringify({ workflow }),
                },
                'Scan current workflow for transfer'
            );
            if (
                state.requestToken !== imageRequestToken
                || state.transfer?.requestToken !== token
            ) return null;
            state.transfer.loading = false;
            state.transfer.targetModels = targetModels;
            state.transfer.targetGroups = this.getMetadataTransferTargetGroups(targetModels);
            const sourceEntries = this.getMetadataTransferSourceModels(state.loadedModels);
            const sourceCategories = new Set(
                sourceEntries
                    .map(({ model }) => normalizeTransferCategory(model.category))
            );
            const selectableNodeKeys = new Set(
                state.transfer.targetGroups.flatMap(group => (
                    sourceEntries.length === 0 || sourceCategories.has(group.category)
                        ? (group.nodes || []).map(node => node.nodeKey)
                        : []
                ))
            );
            state.transfer.selectedNodeKeys = new Set(
                Array.from(state.transfer.selectedNodeKeys || [])
                    .filter(nodeKey => selectableNodeKeys.has(nodeKey))
            );
            this.renderImageMetadataResult();
            return targetModels;
        } catch (error) {
            if (
                state.requestToken !== imageRequestToken
                || state.transfer?.requestToken !== token
            ) return null;
            state.transfer.loading = false;
            state.transfer.error = error?.message || 'Could not scan the current workflow.';
            this.renderImageMetadataResult();
            return null;
        }
    },

    clearMetadataTransferTargets() {
        const state = getImageInspectorState(this);
        if (!state.transfer) return;
        state.transfer.selectedNodeKeys = new Set();
        this.renderImageMetadataResult();
    },

    toggleMetadataTransferNode(nodeKey) {
        const state = getImageInspectorState(this);
        if (!state.transfer || !nodeKey) return;
        const nodeGroups = (state.transfer.targetGroups || [])
            .flatMap(group => group.nodes || [])
            .filter(node => node.nodeKey === String(nodeKey));
        if (!nodeGroups.length) return;

        const sourceCategories = new Set(
            this.getMetadataTransferSourceModels(state.loadedModels)
                .map(({ model }) => normalizeTransferCategory(model.category))
        );
        const selected = new Set(state.transfer.selectedNodeKeys || []);
        if (sourceCategories.size && !nodeGroups.some(node => {
            const categoryGroup = (state.transfer.targetGroups || [])
                .find(group => group.nodes.includes(node));
            return categoryGroup && sourceCategories.has(categoryGroup.category);
        }) && !selected.has(String(nodeKey))) return;

        if (selected.has(String(nodeKey))) {
            selected.delete(String(nodeKey));
        } else {
            selected.add(String(nodeKey));
        }
        state.transfer.selectedNodeKeys = selected;
        this.renderImageMetadataResult();
    },

    async applyMetadataTransfer() {
        const state = getImageInspectorState(this);
        const transfer = state.transfer;
        if (!transfer || transfer.loading || transfer.applying) return null;

        const sourceModels = this.getMetadataTransferSourceModels(state.loadedModels)
            .map(({ model }) => model);
        const selectedNodeKeys = transfer.selectedNodeKeys instanceof Set
            ? transfer.selectedNodeKeys
            : new Set();
        const targetRefs = [];
        const targetRefKeys = new Set();
        for (const group of transfer.targetGroups || []) {
            for (const node of group.nodes || []) {
                if (!selectedNodeKeys.has(node.nodeKey)) continue;
                for (const ref of node.refs || []) {
                    if (targetRefKeys.has(ref.transferKey)) continue;
                    targetRefKeys.add(ref.transferKey);
                    targetRefs.push(ref);
                }
            }
        }
        const workflow = this.getCurrentWorkflow?.();
        if (!sourceModels.length) {
            this.showNotification('Import a workflow with transferable model metadata first.', 'warning');
            return null;
        }
        if (!targetRefs.length) {
            this.showNotification('Select at least one target node.', 'warning');
            return null;
        }
        if (!workflow) {
            this.showNotification('No current workflow is available.', 'warning');
            return null;
        }

        transfer.applying = true;
        this.renderImageMetadataResult();
        try {
            const data = await this.fetchJson(
                '/model_resolver/transfer-models',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        workflow,
                        mode: transfer.mode === 'merge' ? 'merge' : 'replace',
                        source_models: sourceModels,
                        target_refs: targetRefs,
                    }),
                },
                'Transfer metadata models'
            );
            if (!data?.success || !data.workflow) {
                throw new Error(data?.error || 'The metadata model transfer failed.');
            }
            const applied = await this.updateWorkflowInComfyUI(
                data.workflow,
                data.requires_full_reload ? [] : (data.resolutions || [])
            );
            if (!applied) {
                throw new Error('ComfyUI could not apply the updated workflow.');
            }

            this.cachedLoadedModelsSignature = null;
            this.cachedLoadedModelsData = null;
            this.activeWorkflowSignature = this.getWorkflowSignature?.(data.workflow) || null;
            state.transfer = null;
            this.renderImageMetadataResult();
            void this.openMetadataTransfer();
            const updatedCount = Number(data.updated) || 0;
            const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
            const suffix = skippedCount
                ? ` ${skippedCount} selection${skippedCount === 1 ? '' : 's'} kept unchanged.`
                : '';
            this.showNotification(
                `Transferred ${updatedCount} model${updatedCount === 1 ? '' : 's'} to the current workflow.${suffix}`,
                skippedCount ? 'info' : 'success'
            );
            window.dispatchEvent?.(new Event('model-resolver-active-workflowchange'));
            return data;
        } catch (error) {
            if (state.transfer) {
                state.transfer.applying = false;
                state.transfer.error = error?.message || 'The metadata model transfer failed.';
                this.renderImageMetadataResult();
            }
            return null;
        }
    },
};
