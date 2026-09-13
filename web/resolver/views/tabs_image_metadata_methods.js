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
const TRANSFER_ACTIVITY_SCOPES = new Set(['all', 'active', 'inactive']);

function normalizeTransferMode(value) {
    const token = String(value || 'replace').trim().toLowerCase().replaceAll('_', '-');
    if (token === 'merge' || token === 'add' || token === 'merge-add') return 'merge';
    if (token === 'replace-add' || token === 'replaceadd' || token === 'replace-plus-add') {
        return 'replace-add';
    }
    return 'replace';
}

function normalizeTransferActivityScope(value) {
    const token = String(value || 'all').trim().toLowerCase().replaceAll('_', '-');
    if (token === 'both' || token === 'active-inactive' || token === 'active-and-inactive') {
        return 'all';
    }
    return TRANSFER_ACTIVITY_SCOPES.has(token) ? token : 'all';
}

function isTransferActivityAllowed(value, scope) {
    const normalizedScope = normalizeTransferActivityScope(scope);
    if (normalizedScope === 'all') return true;
    if (normalizedScope === 'inactive') return value === false;
    return value !== false;
}

function isAppendableLoraNodeType(nodeType) {
    const normalizedType = String(nodeType || '');
    return MERGE_LORA_NODE_TYPES.has(normalizedType)
        || normalizedType === MERGE_POWER_LORA_NODE_TYPE;
}

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
                            <p class="mr-loaded-models-subtitle">Paste JSON or drop a supported file anywhere in this panel.</p>
                        </div>
                        <div class="mr-image-inspector-header-actions">
                            <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="clear">Clear</button>
                        </div>
                    </div>
                    <div class="mr-image-inspector-tools">
                        <input type="file" accept="image/png,image/jpeg,image/webp,application/json,.json" hidden data-image-inspector-input="file">
                        <div class="mr-image-inspector-paste">
                            <textarea id="mr-image-inspector-json-text" class="mr-image-inspector-textarea" rows="3" aria-label="Paste workflow JSON" placeholder="Paste a ComfyUI UI workflow or API prompt graph..."></textarea>
                            <div class="mr-image-inspector-actions">
                                <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-image-inspector-action="analyze-paste" disabled>Analyze JSON</button>
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
        const pasteInput = root.querySelector('.mr-image-inspector-textarea');
        const analyzePasteButton = root.querySelector('[data-image-inspector-action="analyze-paste"]');
        const updateAnalyzePasteButton = () => {
            if (analyzePasteButton) {
                analyzePasteButton.disabled = !(pasteInput?.value || '').trim();
            }
        };
        const setDragOver = (active) => {
            root.classList.toggle('is-dragover', active);
        };
        const isFileDrag = (event) => {
            const types = Array.from(event.dataTransfer?.types || []);
            return types.includes('Files') || Boolean(event.dataTransfer?.files?.length);
        };
        let dragDepth = 0;

        root.addEventListener('click', (event) => {
            const categoryToggle = event.target.closest?.('[data-image-transfer-category-toggle]');
            if (categoryToggle) {
                this.toggleMetadataTransferCategory(categoryToggle.dataset.imageTransferCategoryToggle);
                return;
            }

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
            if (input.matches?.('[data-image-transfer-source]')) {
                const state = getImageInspectorState(this);
                if (state.transfer) {
                    const existingSourceSelections = state.transfer.sourceSelections;
                    const sourceSelections = existingSourceSelections instanceof Map
                        ? Object.fromEntries(existingSourceSelections)
                        : existingSourceSelections && typeof existingSourceSelections === 'object'
                            ? { ...existingSourceSelections }
                            : {};
                    const selectionKey = input.dataset.imageTransferSource;
                    if (selectionKey) {
                        if (input.value) sourceSelections[selectionKey] = input.value;
                        else delete sourceSelections[selectionKey];
                    }
                    state.transfer.sourceSelections = sourceSelections;
                    this.renderImageMetadataResult();
                }
                return;
            }
            if (input.matches?.('[data-image-transfer-mode]')) {
                const state = getImageInspectorState(this);
                if (state.transfer) state.transfer.mode = normalizeTransferMode(input.value);
                this.renderImageMetadataResult();
                return;
            }
            if (input.matches?.('[data-image-transfer-activity-scope]')) {
                const state = getImageInspectorState(this);
                if (state.transfer) {
                    state.transfer.activityScope = normalizeTransferActivityScope(input.value);
                }
                this.renderImageMetadataResult();
                return;
            }
        });

        pasteInput?.addEventListener('input', updateAnalyzePasteButton);
        updateAnalyzePasteButton();

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
            state.transfer.sourceSelections = {};
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
            result.innerHTML = this.renderMetadataTransferPanel(state);
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

    getMetadataTransferSourceSelectionKey(ref = {}) {
        return String(
            ref.transferKey
            || `${normalizeTransferCategory(ref.category)}:${String(ref.node_id ?? '')}:${String(ref.widget_index ?? '')}`
        );
    },

    getMetadataTransferSourceSelection(transfer, ref = {}) {
        const key = this.getMetadataTransferSourceSelectionKey(ref);
        const selections = transfer?.sourceSelections;
        if (selections instanceof Map) return selections.get(key);
        if (selections && typeof selections === 'object') return selections[key];
        return null;
    },

    getMetadataTransferAcceptedFileTypes(target = {}) {
        const ref = target?.ref || target || {};
        const node = target?.node || {};
        const widgetIndex = Number(ref.widget_index ?? ref.widgetIndex);
        const resolution = {
            node_id: ref.node_id ?? node.nodeId,
            is_top_level: ref.is_top_level ?? node.isTopLevel,
            subgraph_id: ref.subgraph_id || node.subgraphId || '',
        };
        const workflow = this.getCurrentWorkflow?.() || {};
        const workflowNode = this.findWorkflowNodeForResolution?.(workflow, resolution);
        const widgetName = String(
            ref.widget_name
            || ref.widgetName
            || this.getWorkflowNodeWidgetName?.(workflowNode || {}, widgetIndex)
            || this.getGraphNodeWidgetName?.(workflowNode || {}, widgetIndex, resolution)
            || ''
        ).trim();
        const explicitExtensions = (
            ref.accepted_extensions
            || ref.allowed_extensions
            || ref.accepted_model_extensions
        );
        return this.getMissingAcceptedModelFileTypes?.({
            node_type: ref.node_type || ref.nodeType || node.nodeType || '',
            widget_index: Number.isInteger(widgetIndex) ? widgetIndex : -1,
            widget_name: widgetName,
            accepted_extensions: explicitExtensions,
        }) || [];
    },

    getMetadataTransferCompatibleSourcesForTarget(target, sourcesByCategory) {
        const category = normalizeTransferCategory(target?.category || target?.ref?.category);
        const allSources = sourcesByCategory.get(category) || [];
        if (!allSources.length) return [];

        const activityScope = normalizeTransferActivityScope(target?.activityScope);
        const activitySources = category === 'loras'
            ? allSources.filter(({ model }) => isTransferActivityAllowed(model?.active, activityScope))
            : allSources;
        if (!activitySources.length) return [];

        const acceptedTypes = Array.isArray(target?.acceptedFileTypes)
            ? target.acceptedFileTypes
            : this.getMetadataTransferAcceptedFileTypes(target);
        const acceptedExtensions = new Set(
            acceptedTypes
                .map(type => String(type?.extension || '').trim().toLowerCase())
                .filter(Boolean)
        );
        if (!acceptedExtensions.size) return activitySources;

        return activitySources.filter(({ model }) => {
            const modelValue = this.getMetadataTransferModelValue(model);
            const fileType = this.getModelFileTypeInfo?.(modelValue);
            return !fileType || acceptedExtensions.has(fileType.extension);
        });
    },

    getMetadataTransferSourceForTarget(target, sourcesByCategory, transfer, fallbackIndex = 0) {
        const category = normalizeTransferCategory(target?.category || target?.ref?.category);
        const sources = Array.isArray(target?.compatibleSources)
            ? target.compatibleSources
            : sourcesByCategory.get(category) || [];
        if (!sources.length) return null;

        const selectedSourceIndex = this.getMetadataTransferSourceSelection(transfer, target.ref);
        if (selectedSourceIndex !== null && selectedSourceIndex !== undefined && selectedSourceIndex !== '') {
            const selectedSource = sources.find(({ sourceIndex }) => (
                String(sourceIndex) === String(selectedSourceIndex)
            ));
            if (selectedSource) return selectedSource;
        }

        return sources.length === 1 ? sources[0] : sources[fallbackIndex] || null;
    },

    getMetadataTransferPreviewRows(state) {
        const sourceEntries = this.getMetadataTransferSourceModels(state?.loadedModels);
        const transfer = state?.transfer;
        if (!transfer) return [];
        const activityScope = normalizeTransferActivityScope(transfer.activityScope);

        const targetGroups = Array.isArray(transfer.targetGroups) ? transfer.targetGroups : [];
        const selectedNodeKeys = transfer.selectedNodeKeys instanceof Set
            ? transfer.selectedNodeKeys
            : new Set();
        const selectedTargets = [];
        const sourcesByCategory = new Map();

        for (const sourceEntry of sourceEntries) {
            const { model } = sourceEntry;
            const category = normalizeTransferCategory(model.category);
            if (!category) continue;
            if (!sourcesByCategory.has(category)) sourcesByCategory.set(category, []);
            sourcesByCategory.get(category).push(sourceEntry);
        }

        for (const group of targetGroups) {
            const category = normalizeTransferCategory(group.category);
            for (const node of group.nodes || []) {
                if (!selectedNodeKeys.has(node.nodeKey)) continue;
                for (const ref of node.refs || []) {
                    const target = { category, node, ref, activityScope };
                    target.acceptedFileTypes = this.getMetadataTransferAcceptedFileTypes(target);
                    target.compatibleSources = this.getMetadataTransferCompatibleSourcesForTarget(
                        target,
                        sourcesByCategory,
                    );
                    selectedTargets.push(target);
                }
            }
        }

        const makeRow = (
            target,
            nextSource = null,
            {
                operation = 'replace',
                currentLabelOverride = '',
                forceChange = false,
                sourceSelectable = null,
                unchangedWhenNoSource = false,
            } = {},
        ) => {
            const allSourceEntries = sourcesByCategory.get(target.category) || [];
            const compatibleSources = Array.isArray(target.compatibleSources)
                ? target.compatibleSources
                : this.getMetadataTransferCompatibleSourcesForTarget(target, sourcesByCategory);
            const activityScope = normalizeTransferActivityScope(target.activityScope);
            const acceptedFileTypes = Array.isArray(target.acceptedFileTypes)
                ? target.acceptedFileTypes
                : this.getMetadataTransferAcceptedFileTypes(target);
            const hasActivityMismatch = Boolean(
                target.category === 'loras'
                && activityScope !== 'all'
                && allSourceEntries.length
                && !allSourceEntries.some(({ model }) => (
                    isTransferActivityAllowed(model?.active, activityScope)
                ))
            );
            const hasIncompatibleSources = Boolean(
                allSourceEntries.length
                && acceptedFileTypes.length
                && !compatibleSources.length
            ) || hasActivityMismatch;
            const sourceOptions = compatibleSources.map(({ model, sourceIndex }) => ({
                sourceIndex,
                label: this.getMetadataTransferModelLabel(model),
                value: this.getMetadataTransferModelValue(model),
            }));
            const canSelectSource = sourceSelectable === null
                ? sourceOptions.length > 1
                : Boolean(sourceSelectable) && sourceOptions.length > 1;
            const nextModel = nextSource?.model || null;
            const currentValue = this.getMetadataTransferModelValue(target.ref);
            const currentLabel = currentLabelOverride
                || this.getMetadataTransferModelLabel(target.ref);
            const nextValue = nextModel
                ? this.getMetadataTransferModelValue(nextModel)
                : '';
            const nextLabel = nextModel
                ? this.getMetadataTransferModelLabel(nextModel)
                : hasActivityMismatch
                    ? 'No matching activity'
                    : hasIncompatibleSources
                        ? 'No compatible model'
                        : 'Unchanged';
            const currentIdentity = normalizeTransferModelIdentity(currentValue);
            const nextIdentity = normalizeTransferModelIdentity(nextValue);
            const needsSourceSelection = canSelectSource && !nextModel;
            const unchanged = !forceChange && !needsSourceSelection && (
                !nextModel
                    ? (
                        unchangedWhenNoSource
                            ? !hasIncompatibleSources
                            : !hasIncompatibleSources && sourceOptions.length === 0
                    )
                    : (
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
                nodeKey: target.node.nodeKey,
                refKey: this.getMetadataTransferSourceSelectionKey(target.ref),
                nodeName,
                nodeId: target.node.nodeId,
                slot: target.ref?.transferSlot || 1,
                ref: target.ref,
                currentLabel,
                currentValue,
                nextLabel: unchanged
                    ? 'Unchanged'
                    : needsSourceSelection
                        ? 'Select model'
                        : nextLabel,
                nextValue,
                nextModel,
                operation: unchanged ? 'unchanged' : operation,
                unchanged,
                sourceIndex: nextSource?.sourceIndex ?? null,
                sourceOptions,
                sourceSelectable: canSelectSource,
                sourceSelectionKey: this.getMetadataTransferSourceSelectionKey(target.ref),
                sourceUnavailable: hasIncompatibleSources,
                sourceUnavailableReason: hasActivityMismatch
                    ? 'No imported LoRA matches the selected activity scope.'
                    : '',
                acceptedFileTypes,
                activityScope,
            };
        };

        const selectedNodes = new Map();
        for (const target of selectedTargets) {
            let entry = selectedNodes.get(target.node.nodeKey);
            if (!entry) {
                entry = { node: target.node, targets: [] };
                selectedNodes.set(target.node.nodeKey, entry);
            }
            entry.targets.push(target);
        }

        const mode = normalizeTransferMode(transfer.mode);
        if (mode === 'merge') {

            const previewRows = [];
            for (const { node, targets } of selectedNodes.values()) {
                const nodeType = String(node.nodeType || '');
                const canAppendLoras = isAppendableLoraNodeType(nodeType);
                const loraSources = this.getMetadataTransferCompatibleSourcesForTarget(
                    targets[0],
                    sourcesByCategory,
                );
                if (canAppendLoras && loraSources.length) {
                    for (const source of loraSources) {
                        previewRows.push(makeRow(
                            targets[0],
                            source,
                            {
                                operation: 'add',
                                currentLabelOverride: 'Existing LoRAs',
                                forceChange: true,
                                sourceSelectable: false,
                            },
                        ));
                    }
                    continue;
                }
                for (const target of targets) {
                    previewRows.push(makeRow(target, null, {
                        operation: 'merge',
                        sourceSelectable: false,
                    }));
                }
            }
            return previewRows;
        }

        if (mode === 'replace-add') {
            const previewRows = [];
            const sourceIndexes = new Map();
            for (const { node, targets } of selectedNodes.values()) {
                const nodeType = String(node.nodeType || '');
                const loraTargets = targets.filter(target => target.category === 'loras');
                if (isAppendableLoraNodeType(nodeType) && loraTargets.length) {
                    const loraSources = this.getMetadataTransferCompatibleSourcesForTarget(
                        loraTargets[0],
                        sourcesByCategory,
                    );
                    const usedSourceIndexes = new Set();
                    for (const [sourcePosition, target] of loraTargets.entries()) {
                        const source = this.getMetadataTransferSourceForTarget(
                            target,
                            sourcesByCategory,
                            transfer,
                            sourcePosition,
                        );
                        if (source) usedSourceIndexes.add(String(source.sourceIndex));
                        previewRows.push(makeRow(target, source, {
                            sourceSelectable: source ? null : false,
                            unchangedWhenNoSource: true,
                        }));
                    }
                    for (const source of loraSources) {
                        if (usedSourceIndexes.has(String(source.sourceIndex))) continue;
                        previewRows.push(makeRow(
                            loraTargets[0],
                            source,
                            {
                                operation: 'add',
                                currentLabelOverride: 'Remaining LoRAs',
                                forceChange: true,
                                sourceSelectable: false,
                            },
                        ));
                    }
                    for (const target of targets) {
                        if (target.category === 'loras') continue;
                        const sourceIndex = sourceIndexes.get(target.category) || 0;
                        sourceIndexes.set(target.category, sourceIndex + 1);
                        const source = this.getMetadataTransferSourceForTarget(
                            target,
                            sourcesByCategory,
                            transfer,
                            sourceIndex,
                        );
                        previewRows.push(makeRow(target, source));
                    }
                    continue;
                }
                for (const target of targets) {
                    const sourceIndex = sourceIndexes.get(target.category) || 0;
                    sourceIndexes.set(target.category, sourceIndex + 1);
                    const source = this.getMetadataTransferSourceForTarget(
                        target,
                        sourcesByCategory,
                        transfer,
                        sourceIndex,
                    );
                    previewRows.push(makeRow(target, source));
                }
            }
            return previewRows;
        }

        const sourceIndexes = new Map();
        return selectedTargets.map(target => {
            const sourceIndex = sourceIndexes.get(target.category) || 0;
            sourceIndexes.set(target.category, sourceIndex + 1);
            const source = this.getMetadataTransferSourceForTarget(
                target,
                sourcesByCategory,
                transfer,
                sourceIndex,
            );
            return makeRow(target, source);
        });
    },

    renderMetadataTransferPreview(rows = []) {
        const previewRows = Array.isArray(rows) ? rows : [];
        return previewRows.map(row => {
            const slotLabel = row.slot > 1 ? ` · Slot ${row.slot}` : '';
            const targetLabel = `${row.nodeName} · Node ${row.nodeId}${slotLabel}`;
            const currentTitle = row.currentValue || row.currentLabel;
            const acceptedFormats = Array.isArray(row.acceptedFileTypes)
                ? row.acceptedFileTypes
                    .map(type => String(type?.display || '').trim())
                    .filter(Boolean)
                    .join(', ')
                : '';
            const nextTitle = row.sourceUnavailable
                ? row.sourceUnavailableReason
                    || `No imported model matches this node's accepted file format${acceptedFormats ? `: ${acceptedFormats}` : ''}.`
                : row.nextValue || row.nextLabel;
            const currentLabel = row.currentValue ? row.currentLabel : '(empty)';
            const importedClass = row.sourceUnavailable
                ? 'is-placeholder'
                : row.unchanged
                    ? 'is-unchanged'
                    : row.operation === 'add'
                        ? 'is-added'
                        : 'is-imported';
            const getModelInteractionAttrs = (model, contextScope, label) => {
                const modelPath = String(
                    model?.resolved_path
                    || model?.path
                    || model?.full_path
                    || ''
                ).trim();
                if (model?.exists !== true || !modelPath) return '';

                const contextModel = {
                    ...model,
                    context_scope: contextScope,
                };
                const contextMenuAttrs = typeof this.getContextMenuAttrs === 'function'
                    ? this.getContextMenuAttrs(contextModel)
                    : '';
                const previewTooltipAttrs = typeof this.getModelPreviewTooltipAttrs === 'function'
                    ? this.getModelPreviewTooltipAttrs(model, label)
                    : '';
                return `${contextMenuAttrs}${previewTooltipAttrs}`;
            };
            const currentModelAttrs = getModelInteractionAttrs(row.ref, 'loaded_model', currentTitle);
            const importedModelAttrs = getModelInteractionAttrs(row.nextModel, 'local_model', nextTitle);
            const sourceOptions = row.sourceSelectable
                ? [
                    `<option value=""${row.sourceIndex === null ? ' selected' : ''}>Select imported model</option>`,
                    ...row.sourceOptions.map(option => `
                        <option value="${this.escapeHtml(option.sourceIndex)}"${String(option.sourceIndex) === String(row.sourceIndex) ? ' selected' : ''} title="${this.escapeHtml(option.value)}">${this.escapeHtml(option.label)}</option>
                    `),
                ].join('')
                : '';
            const importedValueHtml = row.sourceSelectable
                ? `<select class="mr-image-transfer-source-select" data-image-transfer-source="${this.escapeHtml(row.refKey || row.sourceSelectionKey)}" aria-label="Select imported model for ${this.escapeHtml(targetLabel)}" title="${this.escapeHtml(nextTitle)}"${importedModelAttrs}>${sourceOptions}</select>`
                : `<span class="mr-image-transfer-model-value ${importedClass}" title="${this.escapeHtml(nextTitle)}"${importedModelAttrs}>${this.escapeHtml(row.nextLabel)}</span>`;
            return `
                <div class="mr-image-transfer-change${row.unchanged ? ' is-unchanged' : ''}">
                    <div class="mr-image-transfer-change-side">
                        <span class="mr-image-transfer-change-label">Current</span>
                        <span class="mr-image-transfer-model-value is-current" title="${this.escapeHtml(currentTitle)}"${currentModelAttrs}>${this.escapeHtml(currentLabel)}</span>
                    </div>
                    <span class="mr-image-transfer-change-arrow" aria-hidden="true">→</span>
                    <div class="mr-image-transfer-change-side mr-image-transfer-change-side-imported">
                        <span class="mr-image-transfer-change-label">Imported</span>
                        ${importedValueHtml}
                    </div>
                </div>
            `;
        }).join('');
    },

    renderMetadataTransferPanel(state) {
        const sourceEntries = this.getMetadataTransferSourceModels(state.loadedModels);
        const transfer = state?.transfer || {
            loading: false,
            applying: false,
            error: '',
            mode: 'replace',
            activityScope: 'all',
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

        const previewRows = this.getMetadataTransferPreviewRows(state);
        const previewRowsByNodeKey = new Map();
        for (const row of previewRows) {
            if (!previewRowsByNodeKey.has(row.nodeKey)) previewRowsByNodeKey.set(row.nodeKey, []);
            previewRowsByNodeKey.get(row.nodeKey).push(row);
        }
        const collapsedCategories = transfer.collapsedCategories instanceof Set
            ? transfer.collapsedCategories
            : new Set(transfer.collapsedCategories || []);
        const categoryLabels = {
            checkpoints: 'Checkpoints',
            diffusion_models: 'Diffusion Models',
            text_encoders: 'Text Encoders',
            loras: 'LoRAs',
            vae: 'VAE',
            controlnet: 'ControlNet',
            upscale_models: 'Upscale Models',
            embeddings: 'Embeddings',
        };
        const getCategoryLabel = category => {
            const normalized = normalizeTransferCategory(category);
            if (categoryLabels[normalized]) return categoryLabels[normalized];
            return String(this.getCategoryDisplayName(normalized) || normalized || 'Unknown')
                .split('_')
                .filter(Boolean)
                .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
                .join(' ');
        };
        const renderUnselectedPreview = node => {
            const refs = Array.isArray(node.refs) && node.refs.length ? node.refs : [{}];
            return refs.map((ref, index) => {
                const currentValue = this.getMetadataTransferModelValue(ref);
                const currentLabel = currentValue
                    ? this.getMetadataTransferModelLabel(ref)
                    : '(empty)';
                const slotLabel = refs.length > 1 ? ` · Slot ${index + 1}` : '';
                return `
                    <div class="mr-image-transfer-change is-unselected">
                        <div class="mr-image-transfer-change-side">
                            <span class="mr-image-transfer-change-label">Current${this.escapeHtml(slotLabel)}</span>
                            <span class="mr-image-transfer-model-value is-current" title="${this.escapeHtml(currentValue || currentLabel)}">${this.escapeHtml(currentLabel)}</span>
                        </div>
                        <span class="mr-image-transfer-change-arrow" aria-hidden="true">→</span>
                        <div class="mr-image-transfer-change-side mr-image-transfer-change-side-imported">
                            <span class="mr-image-transfer-change-label">Imported</span>
                            <span class="mr-image-transfer-model-value is-placeholder">Select node</span>
                        </div>
                    </div>
                `;
            }).join('');
        };
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
                context_scope: 'workflow_node',
                node_id: node.nodeId,
                node_type: node.nodeType,
                node_title: node.nodeTitle,
                subgraph_id: node.subgraphId,
                subgraph_name: node.subgraphName,
                is_top_level: node.isTopLevel,
            }, 'Right-click to locate this node in the workflow') || '';
            const nodePreviewRows = previewRowsByNodeKey.get(node.nodeKey) || [];
            const previewHtml = selected
                ? nodePreviewRows.length
                    ? this.renderMetadataTransferPreview(nodePreviewRows)
                    : '<p class="mr-image-transfer-empty">No imported LoRAs match the selected activity scope.</p>'
                : renderUnselectedPreview(node);
            return `
                <div class="mr-image-transfer-node-row${selected ? ' is-selected' : ''}${unavailable ? ' is-unavailable' : ''}" ${contextMenuAttrs}>
                    <button type="button" class="mr-image-transfer-node-select"
                        data-image-transfer-node="${this.escapeHtml(node.nodeKey)}"
                        aria-pressed="${selected ? 'true' : 'false'}"
                        aria-disabled="${unavailable ? 'true' : 'false'}"
                        ${unavailable ? 'disabled title="No matching model category in the metadata workflow"' : ''}>
                        <span class="mr-image-transfer-node-check" aria-hidden="true">${selected ? '✓' : ''}</span>
                        <span class="mr-image-transfer-node-details">
                            <span class="mr-image-transfer-node-name">${this.escapeHtml(nodeName)} · Node ${this.escapeHtml(node.nodeId)}${this.escapeHtml(scopeLabel)}</span>
                            <span class="mr-image-transfer-node-meta">${this.escapeHtml(nodeType)} · ${countText(node.refs.length, 'model slot')}${node.active ? ' · Active' : ' · Inactive'}</span>
                        </span>
                    </button>
                    <div class="mr-image-transfer-node-preview">${previewHtml}</div>
                </div>
            `;
        };

        const targetRows = targetGroups.length
            ? targetGroups.map(group => {
                const nodes = Array.isArray(group.nodes) ? group.nodes : [];
                const isAvailable = sourceEntries.length === 0 || sourceCategories.has(group.category);
                const isUnavailable = sourceEntries.length > 0 && !isAvailable;
                const selectedCount = nodes.filter(node => selectedNodeKeys.has(node.nodeKey)).length;
                const categoryLabel = getCategoryLabel(group.category);
                const collapsed = collapsedCategories.has(group.category);
                return `
                    <section class="mr-image-transfer-category${collapsed ? ' is-collapsed' : ''}${isUnavailable ? ' is-unavailable' : ''}" data-image-transfer-category="${this.escapeHtml(group.category)}">
                        <div class="mr-image-transfer-category-header">
                            <button type="button" class="mr-image-transfer-category-toggle" data-image-transfer-category-toggle="${this.escapeHtml(group.category)}" aria-expanded="${collapsed ? 'false' : 'true'}">
                                <span class="mr-image-transfer-category-chevron" aria-hidden="true"></span>
                                <span class="mr-image-transfer-category-title">${this.escapeHtml(categoryLabel)}</span>
                                <span class="mr-image-transfer-category-selected">${selectedCount} selected</span>
                            </button>
                            <span class="mr-image-transfer-category-meta">
                                <span class="mr-image-transfer-category-node-count">${countText(nodes.length, 'node')}</span>
                                ${isUnavailable ? '<span class="mr-image-transfer-unavailable-pill">No source model</span>' : ''}
                            </span>
                        </div>
                        ${collapsed ? '' : `<div class="mr-image-transfer-category-nodes">${nodes.map(node => renderNode(node, isAvailable)).join('')}</div>`}
                    </section>
                `;
            }).join('')
            : '<p class="mr-image-transfer-empty">No model nodes were found in the current workflow.</p>';

        const mode = normalizeTransferMode(transfer.mode);
        const activityScope = normalizeTransferActivityScope(transfer.activityScope);
        const allTargetNodes = targetGroups.flatMap(group => group.nodes || []);
        const allTargetNodeKeys = new Set(allTargetNodes.map(node => node.nodeKey));
        const selectedTargetCount = Array.from(selectedNodeKeys)
            .filter(nodeKey => allTargetNodeKeys.has(nodeKey))
            .length;
        const selectionSourceText = sourceEntries.length
            ? countText(sourceEntries.length, 'metadata model')
            : 'No source workflow imported';
        const hasUnresolvedSource = previewRows.some(row => (
            row.sourceUnavailable
            || (row.sourceSelectable && (row.sourceIndex === null || row.sourceIndex === undefined))
        ));
        const hasTransferableTarget = previewRows.length > 0;
        const applyDisabled = (
            transfer.applying
            || !sourceEntries.length
            || !selectedTargetCount
            || !hasTransferableTarget
            || hasUnresolvedSource
        );
        const activityLabels = {
            all: 'Active + inactive',
            active: 'Active only',
            inactive: 'Inactive only',
        };
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
                        <input type="radio" name="mr-image-transfer-mode" value="replace-add" data-image-transfer-mode ${mode === 'replace-add' ? 'checked' : ''}>
                        <span><strong>Replace / Add</strong><small>Replace LoRA slots and append remaining models.</small></span>
                    </label>
                    <label class="mr-image-transfer-mode-option">
                        <input type="radio" name="mr-image-transfer-mode" value="merge" data-image-transfer-mode ${mode === 'merge' ? 'checked' : ''}>
                        <span><strong>Merge / Add</strong><small>Keep current values and append to multi-LoRA nodes.</small></span>
                    </label>
                </div>
                <div class="mr-image-transfer-activity" role="group" aria-label="LoRA activity scope">
                    <span class="mr-image-transfer-activity-label">Imported LoRAs</span>
                    ${Object.entries(activityLabels).map(([value, label]) => `
                        <label class="mr-image-transfer-activity-option">
                            <input type="radio" name="mr-image-transfer-activity-scope" value="${value}" data-image-transfer-activity-scope ${activityScope === value ? 'checked' : ''}>
                            <span>${label}</span>
                        </label>
                    `).join('')}
                </div>
                <p class="mr-image-transfer-note">Select a node row to include it in the transfer. ${this.escapeHtml(sourceEntries.length ? 'The current and imported models are shown in the same row. Choose a different imported model when a category contains multiple models.' : 'Target nodes come from the current ComfyUI workflow. Import a source workflow with model metadata to enable Apply transfer.')}${activityScope !== 'all' ? ` ${this.escapeHtml(`Imported LoRAs: ${activityLabels[activityScope]}; current target slots remain eligible.`)}` : ''}</p>
                <div class="mr-image-transfer-category-list">${targetRows}</div>
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
        const previousSourceSelections = previousTransfer?.sourceSelections;
        const sourceSelections = preserveSelection
            ? previousSourceSelections instanceof Map
                ? Object.fromEntries(previousSourceSelections)
                : previousSourceSelections && typeof previousSourceSelections === 'object'
                    ? { ...previousSourceSelections }
                    : {}
            : {};
        const token = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        state.transfer = {
            open: true,
            loading: Boolean(workflow),
            applying: false,
            error: '',
            mode: normalizeTransferMode(previousTransfer?.mode),
            activityScope: normalizeTransferActivityScope(previousTransfer?.activityScope),
            requestToken: token,
            workflowSignature,
            targetGroups: [],
            selectedNodeKeys: preserveSelection
                ? new Set(previousTransfer.selectedNodeKeys || [])
                : new Set(),
            collapsedCategories: preserveSelection
                ? new Set(previousTransfer.collapsedCategories || [])
                : new Set(),
            sourceSelections,
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

    toggleMetadataTransferCategory(category) {
        const state = getImageInspectorState(this);
        if (!state.transfer || !category) return;
        const normalizedCategory = normalizeTransferCategory(category);
        const collapsed = state.transfer.collapsedCategories instanceof Set
            ? new Set(state.transfer.collapsedCategories)
            : new Set(state.transfer.collapsedCategories || []);
        if (collapsed.has(normalizedCategory)) collapsed.delete(normalizedCategory);
        else collapsed.add(normalizedCategory);
        state.transfer.collapsedCategories = collapsed;
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
        const mode = normalizeTransferMode(transfer.mode);
        const activityScope = normalizeTransferActivityScope(transfer.activityScope);

        const sourceEntries = this.getMetadataTransferSourceModels(state.loadedModels);
        const sourceModels = sourceEntries.map(({ model, sourceIndex }) => ({
            ...model,
            source_index: sourceIndex,
        }));
        const sourcesByCategory = new Map();
        for (const sourceEntry of sourceEntries) {
            const category = normalizeTransferCategory(sourceEntry.model.category);
            if (!category) continue;
            if (!sourcesByCategory.has(category)) sourcesByCategory.set(category, []);
            sourcesByCategory.get(category).push(sourceEntry);
        }
        const selectedNodeKeys = transfer.selectedNodeKeys instanceof Set
            ? transfer.selectedNodeKeys
            : new Set();
        const targetRefs = [];
        const targetRefKeys = new Set();
        const sourceIndexes = new Map();
        const nodeSourceIndexes = new Map();
        const appendLoraSourceIndexes = new Set();
        let hasAppendableLoraTarget = false;
        for (const group of transfer.targetGroups || []) {
            const category = normalizeTransferCategory(group.category);
            for (const node of group.nodes || []) {
                if (!selectedNodeKeys.has(node.nodeKey)) continue;
                for (const ref of node.refs || []) {
                    const refKey = ref.transferKey || this.getMetadataTransferSourceSelectionKey(ref);
                    if (targetRefKeys.has(refKey)) continue;
                    targetRefKeys.add(refKey);
                    const nodeType = String(node.nodeType || '');
                    const isAppendableLoraTarget = (
                        category === 'loras'
                        && isAppendableLoraNodeType(nodeType)
                        && (mode === 'merge' || mode === 'replace-add')
                    );
                    const sourceIndexKey = `${node.nodeKey}:${category}`;
                    const sourceIndex = mode === 'replace-add' && isAppendableLoraTarget
                        ? nodeSourceIndexes.get(sourceIndexKey) || 0
                        : sourceIndexes.get(category) || 0;
                    if (mode === 'replace-add' && isAppendableLoraTarget) {
                        nodeSourceIndexes.set(sourceIndexKey, sourceIndex + 1);
                    } else {
                        sourceIndexes.set(category, sourceIndex + 1);
                    }
                    const target = { category, node, ref, activityScope };
                    target.acceptedFileTypes = this.getMetadataTransferAcceptedFileTypes(target);
                    target.compatibleSources = this.getMetadataTransferCompatibleSourcesForTarget(
                        target,
                        sourcesByCategory,
                    );
                    if (isAppendableLoraTarget) {
                        hasAppendableLoraTarget = true;
                        for (const source of target.compatibleSources) {
                            appendLoraSourceIndexes.add(String(source.sourceIndex));
                        }
                    }
                    const source = this.getMetadataTransferSourceForTarget(
                        target,
                        sourcesByCategory,
                        transfer,
                        sourceIndex,
                    );
                    targetRefs.push(source
                        ? { ...ref, source_index: source.sourceIndex }
                        : ref);
                }
            }
        }
        const requestSourceModels = sourceModels.filter(model => {
            const category = normalizeTransferCategory(model.category);
            if (
                category === 'loras'
                && !isTransferActivityAllowed(model.active, activityScope)
            ) return false;
            return !hasAppendableLoraTarget
                || category !== 'loras'
                || appendLoraSourceIndexes.has(String(model.source_index));
        });
        const workflow = this.getCurrentWorkflow?.();
        if (!sourceModels.length) {
            this.showNotification('Import a workflow with transferable model metadata first.', 'warning');
            return null;
        }
        if (!requestSourceModels.length) {
            this.showNotification('No imported model matches the selected nodes\' accepted file formats.', 'warning');
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
                        mode,
                        activity_scope: activityScope,
                        source_models: requestSourceModels,
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
