import { escapeHtml, safeStorage } from "../utils/html_utils.js";
import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";

export const tabsExportMethods = {
    findLiveNodes(res) {
        if (!app?.graph) return [];
        const results = [];
        const resolveNode = (graph, id) => {
            if (!graph || id == null) return null;
            return graph.getNodeById?.(id)
                || (Number.isFinite(Number(id)) ? graph.getNodeById?.(Number(id)) : null);
        };

        if (res.is_top_level === false && res.subgraph_id) {
            const stack = [app.graph];
            const seen = new Set();
            while (stack.length) {
                const graph = stack.pop();
                if (!graph || seen.has(graph)) continue;
                seen.add(graph);

                if (graph.id === res.subgraph_id) {
                    const node = resolveNode(graph, res.node_id);
                    if (node) results.push(node);
                }

                for (const n of (graph.nodes || graph._nodes || [])) {
                    if (n?.subgraph) stack.push(n.subgraph);
                }
            }
        } else {
            const node = resolveNode(app.graph, res.node_id);
            if (node) results.push(node);
        }

        return results;
    },

    formatExportFilename(pathValue, maxLength = 60) {
        const full = String(pathValue || '').replace(/\\/g, '/');
        if (full.length <= maxLength) return { display: full, full };
        const parts = full.split('/');
        const filename = parts.pop() || '';
        if (filename.length >= maxLength) {
            return {
                display: filename.slice(0, maxLength - 3) + '...',
                full
            };
        }
        return {
            display: '.../' + filename,
            full
        };
    },

    async loadExportTab(workflow = null) {
        if (!this.contentElement) return;

        if (this.autoResolveButton) this.autoResolveButton.style.display = 'none';
        if (this.downloadAllButton) this.downloadAllButton.style.display = 'none';

        workflow = workflow || this.getCurrentWorkflow();
        if (!workflow) {
            this.contentElement.innerHTML = '<div class="mr-empty-state"><p>No workflow loaded. Please load a workflow first.</p></div>';
            return;
        }

        // Collect all models: missing models and loaded models
        const missing = Array.isArray(this.missingModels) ? this.missingModels : [];

        const workflowSignature = this.getWorkflowSignature?.(workflow);
        let loadedModelsData = this.getCachedLoadedModelsForSignature?.(workflowSignature);
        if (!loadedModelsData && this.workflowLoadedModelCaches) {
            const queueKey = this.getWorkflowKey ? this.getWorkflowKey(workflow) : this.getWorkflowScopedQueueKey?.();
            const cached = queueKey ? this.workflowLoadedModelCaches.get(queueKey) : null;
            if (cached?.data?.loaded_models) {
                loadedModelsData = cached.data;
            } else if (Array.isArray(cached?.models)) {
                loadedModelsData = { loaded_models: cached.models };
            }
        }
        if (!loadedModelsData && Array.isArray(this.cachedLoadedModelsData?.loaded_models)) {
            loadedModelsData = this.cachedLoadedModelsData;
        }

        if (!loadedModelsData) {
            if (this.contentElement) {
                this.contentElement.innerHTML = '<div class="mr-export-header"><p class="mr-export-hint">Scanning workflow models...</p></div>';
            }
            try {
                loadedModelsData = this.fetchJson
                    ? await this.fetchJson(
                        '/model_resolver/loaded',
                        {
                            method: 'POST',
                            body: JSON.stringify({ workflow })
                        },
                        'Scan workflow models for export'
                    )
                    : await (await api.fetchApi('/model_resolver/loaded', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ workflow })
                    })).json();

                if (loadedModelsData && workflowSignature) {
                    this.cachedLoadedModelsSignature = workflowSignature;
                    this.cachedLoadedModelsData = loadedModelsData;
                    this.saveLoadedModelsCacheForActiveWorkflow?.();
                }
            } catch (error) {
                console.warn('Model Resolver: failed to fetch loaded models for export', error);
            }
        }

        if (this.activeTab !== 'export' || !this.contentElement) return;

        const loadedInventory = Array.isArray(loadedModelsData?.loaded_models)
            ? loadedModelsData.loaded_models
            : (Array.isArray(loadedModelsData?.models) ? loadedModelsData.models : []);

        const seenKeys = new Set();
        const entries = [];

        for (const item of [...missing, ...loadedInventory]) {
            const originalPath = item.original_path || item.name || item.filename || '';
            const category = item.category || 'unknown';
            const key = `${category}|${originalPath}`;
            if (!originalPath) continue;

            const fullPath = item.full_path || item.path || item.resolved_path || '';
            if (seenKeys.has(key)) {
                const existing = entries.find((e) => `${e.category}|${e.original_path}` === key);
                if (existing) {
                    const existingRefs = existing.all_node_refs || [existing];
                    const newRefs = item.all_node_refs || [item];
                    existing.all_node_refs = [...existingRefs, ...newRefs];
                    if (!existing.full_path && fullPath) {
                        existing.full_path = fullPath;
                    }
                }
                continue;
            }
            seenKeys.add(key);

            entries.push({
                ...item,
                original_path: originalPath,
                category: category,
                full_path: fullPath,
                all_node_refs: item.all_node_refs || [item]
            });
        }

        entries.sort((a, b) => (a.category || '').localeCompare(b.category || '')
            || (a.original_path || '').localeCompare(b.original_path || ''));

        if (entries.length === 0) {
            this.contentElement.innerHTML = '<div class="mr-empty-state"><p>No model references found in the current workflow.</p></div>';
            return;
        }

        this.exportLinks = this.exportLinks || {};
        const keyOf = (entry) => `${entry.category}|${entry.original_path}`;

        const sourceLabels = {
            workflow: 'from workflow',
            hf_index: 'HuggingFace',
            huggingface: 'HuggingFace',
            civitai: 'CivitAI',
            model_list: 'ComfyUI-Manager list',
            popular: 'curated list',
            civarchive: 'CivArchive',
            civitai_hash: 'CivitAI · hash',
            hf_hash: 'HuggingFace · hash',
            manual: 'entered by you'
        };

        const describe = (link) => {
            if (!link || !link.url) return '';
            const label = sourceLabels[link.url_source] || sourceLabels[link.source] || link.source || '';
            return `${label}${link.match_type === 'hash' && !label.includes('hash') ? ' · hash match' : ''}`;
        };

        const loadOption = (name) => {
            try {
                const stored = safeStorage
                    ? safeStorage.getItem(`ModelResolver.export.${name}`)
                    : localStorage.getItem(`ModelResolver.export.${name}`);
                return stored !== 'false';
            } catch {
                return true;
            }
        };

        let html = `
            <div class="mr-export-header">
                <p class="mr-export-hint">
                    Links are looked up automatically. Paste one for any model that is missing a link (or leave it empty — it will be listed as &ldquo;no public link&rdquo;). Applying writes into the open workflow; save it afterwards.
                </p>
            </div>
            <div class="mr-export-list">
        `;

        entries.forEach((entry, index) => {
            const formatted = this.formatExportFilename(entry.original_path);
            const link = this.exportLinks[keyOf(entry)];
            const hasFullPath = Boolean(entry.full_path);

            html += `
                <div class="mr-export-row">
                    <div class="mr-export-col-name">
                        <div class="mr-export-name" title="${escapeHtml(formatted.full)}">${escapeHtml(formatted.display)}</div>
                        <span class="mr-export-category-tag">${escapeHtml(entry.category || 'unknown')}</span>
                    </div>
                    <div class="mr-export-col-url">
                        <input class="mr-input mr-export-input" data-export-url="${index}" type="url" placeholder="Looking up..." value="${escapeHtml(link?.url || '')}">
                        <span class="mr-export-source" data-export-source="${index}">${escapeHtml(describe(link))}</span>
                    </div>
                    <div class="mr-export-col-actions">
                        ${hasFullPath ? `<button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-export-hash="${index}" title="Hash the local file and look it up on HuggingFace, CivitAI and CivArchive">Find by hash</button>` : ''}
                        <button type="button" class="mr-btn mr-btn-secondary mr-btn-sm" data-export-open="${index}" title="Open link in a new tab">↗</button>
                    </div>
                </div>
            `;
        });

        html += `
            </div>
            <div class="mr-export-options">
                <label class="mr-checkbox-label">
                    <input type="checkbox" data-export-option="note" ${loadOption('note') ? 'checked' : ''}> Add &ldquo;Model links&rdquo; note
                </label>
                <label class="mr-checkbox-label">
                    <input type="checkbox" data-export-option="properties" ${loadOption('properties') ? 'checked' : ''}> Write links into loader nodes
                </label>
                <label class="mr-checkbox-label">
                    <input type="checkbox" data-export-option="node" ${loadOption('node') ? 'checked' : ''}> Add Model Resolver node
                </label>
            </div>
            <div class="mr-export-footer">
                <button type="button" class="mr-btn mr-btn-primary" data-export-apply>Apply to workflow</button>
            </div>
        `;

        this.contentElement.innerHTML = html;

        const inputOf = (index) => this.contentElement.querySelector(`[data-export-url="${index}"]`);
        const sourceOf = (index) => this.contentElement.querySelector(`[data-export-source="${index}"]`);
        const setLink = (index, link) => {
            this.exportLinks[keyOf(entries[index])] = link;
            const input = inputOf(index);
            if (input && link?.url) input.value = link.url;
            if (sourceOf(index)) sourceOf(index).textContent = describe(link);
        };

        entries.forEach((entry, index) => {
            inputOf(index)?.addEventListener('input', (e) => {
                const url = e.target.value.trim();
                this.exportLinks[keyOf(entry)] = url ? { url, source: 'manual', url_source: 'manual' } : null;
                if (sourceOf(index)) {
                    sourceOf(index).textContent = url ? describe(this.exportLinks[keyOf(entry)]) : '';
                }
            });
        });

        this.contentElement.querySelectorAll('[data-export-open]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const url = inputOf(btn.dataset.exportOpen)?.value.trim();
                if (/^https?:\/\//i.test(url || '')) {
                    window.open(url, '_blank', 'noopener');
                }
            });
        });

        this.contentElement.querySelectorAll('[data-export-hash]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.exportHash);
                this.exportFindByHash(entries[idx], btn, (link) => setLink(idx, link));
            });
        });

        this.contentElement.querySelectorAll('[data-export-option]').forEach((box) => {
            box.addEventListener('change', () => {
                const val = box.checked ? 'true' : 'false';
                try {
                    if (safeStorage) {
                        safeStorage.setItem(`ModelResolver.export.${box.dataset.exportOption}`, val);
                    } else {
                        localStorage.setItem(`ModelResolver.export.${box.dataset.exportOption}`, val);
                    }
                } catch {
                    // Ignore localStorage issues
                }
            });
        });

        this.contentElement.querySelector('[data-export-apply]')?.addEventListener('click', async (e) => {
            const options = {};
            this.contentElement.querySelectorAll('[data-export-option]').forEach((box) => {
                options[box.dataset.exportOption] = box.checked;
            });
            const models = entries.map((entry, index) => ({
                entry,
                name: entry.original_path,
                directory: entry.category,
                url: (inputOf(index)?.value || '').trim()
            }));

            e.target.disabled = true;
            try {
                await this.applyExport(models, options);
            } finally {
                e.target.disabled = false;
            }
        });

        // Look up links for models that do not have one yet
        const pending = entries
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => !(keyOf(entry) in this.exportLinks));

        if (pending.length === 0) {
            entries.forEach((_, index) => {
                if (inputOf(index)) inputOf(index).placeholder = 'Paste a download URL';
            });
            return;
        }

        try {
            const result = this.fetchJson
                ? await this.fetchJson('/model_resolver/export/lookup', {
                    method: 'POST',
                    body: JSON.stringify({
                        models: pending.map(({ entry }) => ({
                            filename: entry.original_path,
                            category: entry.category,
                            existing_url: entry.workflow_url || '',
                            sha256: entry.workflow_sha256 || entry.sha256 || ''
                        }))
                    })
                }, 'Export link lookup')
                : await (await api.fetchApi('/model_resolver/export/lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        models: pending.map(({ entry }) => ({
                            filename: entry.original_path,
                            category: entry.category,
                            existing_url: entry.workflow_url || '',
                            sha256: entry.workflow_sha256 || entry.sha256 || ''
                        }))
                    })
                })).json();

            if (this.activeTab !== 'export' || !this.contentElement?.isConnected) return;
            (result?.links || []).forEach((link, i) => {
                const target = pending[i];
                if (!target) return;
                const { entry, index } = target;
                const input = inputOf(index);
                if (input && input.value.trim()) return; // User already typed a URL
                if (link) {
                    setLink(index, link);
                } else {
                    this.exportLinks[keyOf(entry)] = null;
                    if (sourceOf(index)) {
                        sourceOf(index).textContent = 'no public link';
                    }
                }
            });
        } catch (error) {
            console.error('Model Resolver: link lookup failed:', error);
        } finally {
            entries.forEach((_, index) => {
                if (inputOf(index)) inputOf(index).placeholder = 'Paste a download URL';
            });
        }
    },

    async exportFindByHash(entry, button, onFound) {
        const label = button.textContent;
        button.disabled = true;
        try {
            const data = this.fetchJson
                ? await this.fetchJson('/model_resolver/export/hash', {
                    method: 'POST',
                    body: JSON.stringify({ full_path: entry.full_path })
                }, 'Start export hash')
                : await (await api.fetchApi('/model_resolver/export/hash', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ full_path: entry.full_path })
                })).json();

            if (!data?.job_id) {
                throw new Error(data?.error || 'Could not start hash job');
            }

            while (true) {
                if (!button.isConnected) return;
                await new Promise((resolve) => setTimeout(resolve, 800));
                if (!button.isConnected) return;
                const job = this.fetchJson
                    ? await this.fetchJson(`/model_resolver/export/hash/${data.job_id}`, { silent: true }, 'Poll export hash')
                    : await (await api.fetchApi(`/model_resolver/export/hash/${data.job_id}`)).json();
                if (job.status === 'hashing') {
                    button.textContent = `Hashing ${Math.round((job.progress || 0) * 100)}%`;
                } else if (job.status === 'looking_up') {
                    button.textContent = 'Looking up...';
                } else if (job.status === 'done') {
                    if (job.result) {
                        onFound(job.result);
                        button.textContent = '✓ Found';
                    } else {
                        button.textContent = 'No match';
                        button.title = `SHA-256 ${job.sha256} is not on HuggingFace, CivitAI or CivArchive`;
                    }
                    return;
                } else {
                    throw new Error(job.error || 'Hashing failed');
                }
            }
        } catch (error) {
            console.error('Model Resolver: find by hash failed:', error);
            this.showNotification('Find by hash failed: ' + error.message, 'error');
            button.textContent = label;
            button.disabled = false;
        }
    },

    async applyExport(models, options) {
        if (!app?.graph) return;
        const LG = window.LiteGraph;

        let markdown = '';
        if (options.note) {
            try {
                const data = this.fetchJson
                    ? await this.fetchJson('/model_resolver/export/markdown', {
                        method: 'POST',
                        body: JSON.stringify({
                            models: models.map(({ name, url, directory }) => ({ name, url, directory }))
                        })
                    }, 'Build export markdown')
                    : await (await api.fetchApi('/model_resolver/export/markdown', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            models: models.map(({ name, url, directory }) => ({ name, url, directory }))
                        })
                    })).json();
                markdown = data.markdown;
            } catch (error) {
                this.showNotification('Could not build the model links note: ' + error.message, 'error');
                return;
            }
        }

        const graph = app.graph;
        const nodes = graph._nodes || graph.nodes || [];
        const minX = nodes.length ? Math.min(...nodes.map((n) => n.pos?.[0] || 0)) : 0;
        const minY = nodes.length ? Math.min(...nodes.map((n) => n.pos?.[1] || 0)) : 0;
        const done = [];

        let note = nodes.find((n) => n.properties?.model_resolver_note);
        graph.beforeChange?.();
        try {
            if (options.note && markdown) {
                if (!note) {
                    note = LG?.createNode('MarkdownNote') || LG?.createNode('Note');
                    if (note) {
                        note.properties = { ...(note.properties || {}), model_resolver_note: true };
                        note.title = 'Model links';
                        note.pos = [minX - 480, minY];
                        note.size = [440, 560];
                        graph.add(note);
                    }
                }
                if (note) {
                    note.color = '#222';
                    note.bgcolor = '#000';
                    if (note.widgets?.[0]) {
                        note.widgets[0].value = markdown;
                    }
                    note.widgets_values = [markdown];
                    done.push('note');
                }
            }

            if (options.properties) {
                let written = 0;
                for (const { entry, name, directory, url } of models) {
                    if (!url) continue;
                    for (const ref of (entry.all_node_refs || [entry])) {
                        for (const node of this.findLiveNodes(ref)) {
                            node.properties = node.properties || {};
                            const list = Array.isArray(node.properties.models) ? [...node.properties.models] : [];
                            const item = { name, url, directory };
                            const existing = list.findIndex((m) => m?.name === name);
                            if (existing >= 0) {
                                list[existing] = { ...list[existing], ...item };
                            } else {
                                list.push(item);
                            }
                            node.properties.models = list;
                            written++;
                        }
                    }
                }
                if (written) done.push('links');
            }

            if (options.node && !nodes.some((n) => n.type === 'ModelResolverDependency')) {
                const helperNode = LG?.createNode('ModelResolverDependency');
                if (helperNode) {
                    helperNode.properties = {
                        ...(helperNode.properties || {}),
                        cnr_id: 'comfyui-model-resolver',
                        aux_id: 'Azornes/Comfyui-Model-Resolver',
                        'Node name for S&R': 'ModelResolverDependency'
                    };
                    const titleHeight = LG?.NODE_TITLE_HEIGHT || 30;
                    const height = helperNode.size?.[1] || 80;
                    helperNode.pos = note
                        ? [note.pos[0], note.pos[1] - titleHeight - height - titleHeight - 20]
                        : [minX, minY - 140];
                    graph.add(helperNode);
                    done.push('node');
                }
            }
        } finally {
            graph.afterChange?.();
        }
        graph.setDirtyCanvas?.(true, true);

        if (done.length) {
            const missingLinks = models.filter((m) => !m.url).length;
            this.showNotification(
                `✓ Ready to share — save the workflow.${missingLinks ? ` ${missingLinks} model${missingLinks > 1 ? 's have' : ' has'} no public link.` : ''}`,
                'success'
            );
        } else {
            this.showNotification('Nothing to apply', 'info');
        }
    }
};
