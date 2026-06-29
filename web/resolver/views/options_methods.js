import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
import { LOG_LEVEL as DEFAULT_FRONTEND_LOG_LEVEL } from "../../log_system/config.js";
import { logger as frontendLogger } from "../../log_system/logger.js";
export const optionsMethods = {
    displayOptions() {
        if (!this.contentElement) return;
        this.contentElement.style.overflowY = 'hidden';

        const tokens = this.getStoredTokens();
        const pathTemplateCategories = this.getDownloadPathTemplateCategoryDefinitions();
        const defaultRootCategories = this.getDefaultRootCategoryDefinitions();
        const pathTemplatePresets = this.getDownloadPathTemplatePresetDefinitions();
        const pathTemplatePresetValues = new Set(pathTemplatePresets.map(preset => preset.value));
        const renderPathModeOptions = (selectedValue) => {
            const selected = this.normalizeDownloadPathMode(selectedValue);
            const options = [
                {
                    value: 'suggested',
                    label: 'Suggest existing folders',
                    tooltip: 'Uses current Model Resolver behavior: it fills an existing matching folder when possible.'
                },
                {
                    value: 'template',
                    label: 'Use path templates',
                    tooltip: 'Creates subfolders from template placeholders such as base model, author, tags, and model name.'
                },
                {
                    value: 'manual',
                    label: 'Manual only',
                    tooltip: 'Leaves the subfolder field empty until you type or pick a folder.'
                }
            ];
            return options
                .map(option => `<option value="${option.value}" ${option.value === selected ? 'selected' : ''} title="${this.escapeHtml(option.tooltip)}">${this.escapeHtml(option.label)}</option>`)
                .join('');
        };
        const renderDownloadBackendOptions = (selectedValue) => {
            const selected = this.normalizeDownloadBackend(selectedValue);
            const options = [
                {
                    value: 'python',
                    label: 'Python (built-in)',
                    tooltip: 'Uses Model Resolver built-in downloader. This remains the default and requires no external tools.'
                },
                {
                    value: 'aria2',
                    label: 'aria2 (experimental)',
                    tooltip: 'Uses an external aria2c process for large downloads, pause/resume, and segmented transfers.'
                }
            ];
            return options
                .map(option => `<option value="${option.value}" ${option.value === selected ? 'selected' : ''} title="${this.escapeHtml(option.tooltip)}">${this.escapeHtml(option.label)}</option>`)
                .join('');
        };
        const renderTemplatePlaceholderBadges = () => ['{base_model}', '{author}', '{first_tag}', '{model_name}', '{version_name}']
            .map(placeholder => `<span class="mr-options-placeholder-badge">${this.escapeHtml(placeholder)}</span>`)
            .join('');
        const renderPathTemplateRows = () => pathTemplateCategories
            .map(category => {
                const template = tokens.download_path_templates?.[category.key] ?? this.getDefaultDownloadPathTemplates()[category.key] ?? '';
                const normalizedTemplate = this.normalizeDownloadPathTemplate(template);
                const isPreset = pathTemplatePresetValues.has(normalizedTemplate);
                const selectedValue = isPreset ? normalizedTemplate : 'custom';
                const options = [
                    ...pathTemplatePresets.map(preset => (
                        `<option value="${this.escapeHtml(preset.value)}" ${preset.value === selectedValue ? 'selected' : ''}>${this.escapeHtml(preset.label)}</option>`
                    )),
                    `<option value="custom" ${selectedValue === 'custom' ? 'selected' : ''}>Custom template</option>`
                ].join('');
                const preview = this.calculateDownloadPathTemplateSubfolder(category.key, {
                    base_model: 'Flux.1 D',
                    tags: ['style', 'character'],
                    author: 'example_author',
                    model_name: 'Example Model',
                    version_name: 'v1'
                }) || '(flat folder)';

                return `
                    <div class="mr-options-template-row" data-template-category="${this.escapeHtml(category.key)}">
                        <div class="mr-options-template-main">
                            <label class="mr-options-label" for="mr-options-template-${this.escapeHtml(category.key)}">${this.escapeHtml(category.label)}</label>
                            <select id="mr-options-template-${this.escapeHtml(category.key)}" class="mr-options-input mr-options-template-preset" data-template-category="${this.escapeHtml(category.key)}">
                                ${options}
                            </select>
                        </div>
                        <input class="mr-options-input mr-options-template-custom ${selectedValue === 'custom' ? '' : 'is-hidden'}" data-template-category="${this.escapeHtml(category.key)}" type="text" value="${this.escapeHtml(normalizedTemplate)}" placeholder="{base_model}/{author}/{first_tag}">
                        <div class="mr-options-template-preview" data-template-preview="${this.escapeHtml(category.key)}"><span>Preview:</span> <code>${this.escapeHtml(preview)}</code></div>
                    </div>
                `;
            })
            .join('');
        const renderDefaultRootRows = () => defaultRootCategories
            .map(category => {
                const value = tokens[category.settingKey] || '';
                return `
                    <div class="mr-options-template-row" data-root-category="${this.escapeHtml(category.key)}">
                        <div class="mr-options-template-main">
                            <label class="mr-options-label" for="mr-options-root-${this.escapeHtml(category.key)}">${this.escapeHtml(category.label)}</label>
                            <select id="mr-options-root-${this.escapeHtml(category.key)}" class="mr-options-input mr-options-default-root" data-root-category="${this.escapeHtml(category.key)}" data-setting-key="${this.escapeHtml(category.settingKey)}" data-storage-key="${this.escapeHtml(category.storageKey)}" data-current-value="${this.escapeHtml(value)}">
                                <option value="">Auto</option>
                                ${value ? `<option value="${this.escapeHtml(value)}" selected>${this.escapeHtml(value)}</option>` : ''}
                            </select>
                        </div>
                    </div>
                `;
            })
            .join('');
        const sourceDefaultsRows = this.getSearchSourceDefinitions()
            .filter(def => this.isSourceAvailable(def.source))
            .map(def => {
                const iconName = this.getSearchSourceIconName(def.source);
                const checked = tokens.search_source_enabled?.[def.source] !== false;
                const inputId = `mr-options-source-${def.source.replace(/_/g, '-')}`;
                return `
                    <label class="mr-options-toggle-row">
                        <div class="mr-options-toggle-copy">
                            <span class="mr-options-toggle-title">
                                <span class="mr-options-source-icon" aria-hidden="true">${getSvgIcon(iconName)}</span>
                                <span>${this.escapeHtml(this.getSearchSourceLabel(def.source))}</span>
                                <span class="mr-tooltip-badge" data-tooltip="${this.escapeHtml(def.tooltip)}">?</span>
                            </span>
                        </div>
                        <span class="mr-options-toggle-control">
                            <input id="${inputId}" class="mr-options-switch-input mr-options-source-enabled" type="checkbox" data-source="${this.escapeHtml(def.source)}" data-storage-key="${this.escapeHtml(def.storageKey)}" ${checked ? 'checked' : ''}>
                            <span class="mr-options-switch"></span>
                        </span>
                    </label>
                `;
            })
            .join('');
        const logLevelValues = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'NONE'];
        const normalizeLogLevel = (value) => {
            const normalized = String(value || '').trim().toUpperCase();
            return logLevelValues.includes(normalized) ? normalized : 'DEBUG';
        };
        const renderLogLevelOptions = (selectedValue) => {
            const selected = normalizeLogLevel(selectedValue);
            return logLevelValues
                .map(level => `<option value="${level}" ${level === selected ? 'selected' : ''}>${level}</option>`)
                .join('');
        };
        this.contentElement.innerHTML = `
            <div class="mr-options-wrap">
                <div class="mr-options-shell">
                    <aside class="mr-options-sidebar">
                        <div class="mr-options-sidebar-group">
                            <h3 class="mr-options-sidebar-title">Application Settings</h3>
                        </div>
                        <div class="mr-options-sidebar-group">
                            <div class="mr-options-sidebar-label">Download</div>
                            <div class="mr-options-nav">
                                <button type="button" class="mr-options-nav-btn is-active" data-target="mr-options-section-sources">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon" aria-hidden="true">${getSvgIcon('download')}</span>
                                        <span>Sources</span>
                                    </span>
                                    <span class="mr-options-nav-meta">01</span>
                                </button>
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-paths">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon" aria-hidden="true">${getSvgIcon('folderOpen')}</span>
                                        <span>Paths</span>
                                    </span>
                                    <span class="mr-options-nav-meta">02</span>
                                </button>
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-local-db">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon" aria-hidden="true">${getSvgIcon('database')}</span>
                                        <span>Local Database</span>
                                    </span>
                                    <span class="mr-options-nav-meta">03</span>
                                </button>
                            </div>
                        </div>
                        <div class="mr-options-sidebar-group">
                            <div class="mr-options-sidebar-label">Search</div>
                            <div class="mr-options-nav">
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-search">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon" aria-hidden="true">${getSvgIcon('search')}</span>
                                        <span>Defaults</span>
                                    </span>
                                    <span class="mr-options-nav-meta">04</span>
                                </button>
                            </div>
                        </div>
                        <div class="mr-options-sidebar-group">
                            <div class="mr-options-sidebar-label">Providers</div>
                            <div class="mr-options-nav">
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-civitai">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon mr-options-provider-icon mr-options-provider-icon-civitai" aria-hidden="true">${getSvgIcon('civitai')}</span>
                                        <span>CivitAI</span>
                                    </span>
                                    <span class="mr-options-nav-meta">05</span>
                                </button>
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-hf">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon mr-options-provider-icon mr-options-provider-icon-huggingface" aria-hidden="true">${getSvgIcon('huggingface')}</span>
                                        <span>HuggingFace</span>
                                    </span>
                                    <span class="mr-options-nav-meta">06</span>
                                </button>
                            </div>
                        </div>
                        <div class="mr-options-sidebar-group">
                            <div class="mr-options-sidebar-label">System</div>
                            <div class="mr-options-nav">
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-maintenance">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon" aria-hidden="true">${getSvgIcon('wrench')}</span>
                                        <span>Maintenance</span>
                                    </span>
                                    <span class="mr-options-nav-meta">07</span>
                                </button>
                            </div>
                        </div>
                        <div class="mr-options-actions">
                            <div id="mr-options-status" class="mr-options-status">Saved only on this machine.</div>
                            <button id="mr-options-save" class="mr-btn mr-btn-primary mr-footer-btn">Save</button>
                        </div>
                    </aside>
                    <div class="mr-options-main">
                        <section id="mr-options-section-sources" class="mr-options-card mr-options-section">
                            <div class="mr-options-section-head">
                                <h4 class="mr-options-section-title">Download Sources</h4>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack">
                                        <div class="mr-options-subsection-head">
                                            <h5 class="mr-options-subsection-title">Download Engine</h5>
                                            <span class="mr-tooltip-badge" data-tooltip="Choose how model files are downloaded. aria2 requires the external aria2c executable and is intended for large downloads.">?</span>
                                        </div>
                                        <div class="mr-options-number-row mr-options-wide-row">
                                            <div class="mr-options-number-copy">
                                                <span class="mr-options-label">Download backend</span>
                                            </div>
                                            <select id="mr-options-download-backend" class="mr-options-input">
                                                ${renderDownloadBackendOptions(tokens.download_backend)}
                                            </select>
                                        </div>
                                        <div class="mr-options-dependent-block mr-options-aria2-setting">
                                            <div class="mr-options-number-row mr-options-wide-row">
                                                <div class="mr-options-number-copy">
                                                    <span class="mr-options-label">aria2c path <span class="mr-tooltip-badge" data-tooltip="Optional full path to aria2c/aria2c.exe. Leave empty to use aria2c from your system PATH.">?</span></span>
                                                </div>
                                                <input id="mr-options-aria2c-path" class="mr-options-input" type="text" value="${this.escapeHtml(tokens.aria2c_path || '')}" placeholder="Leave empty to use aria2c from PATH">
                                            </div>
                                            <div class="mr-options-db-actions">
                                                <button id="mr-options-aria2-install" type="button" class="mr-btn mr-btn-primary">${getSvgIcon('download')} Install aria2</button>
                                                <button id="mr-options-aria2-check" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('refreshCw')} Check aria2</button>
                                                <a class="mr-options-inline-link" href="https://github.com/Azornes/Comfyui-Model-Resolver/wiki/Aria2-Download-Backend" target="_blank" rel="noopener noreferrer">Setup guide</a>
                                            </div>
                                            <div id="mr-options-aria2-status" class="mr-options-db-message">aria2 requires aria2c installed or a configured executable path.</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack">
                                        <div class="mr-options-subsection-head">
                                            <h5 class="mr-options-subsection-title">Search Sources</h5>
                                            <span class="mr-tooltip-badge" data-tooltip="Choose which sources Model Resolver can use when searching for downloadable model matches.">?</span>
                                        </div>
                                        <div class="mr-options-toggle-list">
                                            ${sourceDefaultsRows}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section id="mr-options-section-paths" class="mr-options-card mr-options-section is-hidden">
                            <div class="mr-options-section-head">
                                <h4 class="mr-options-section-title">Download Paths</h4>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack">
                                        <div class="mr-options-number-row mr-options-path-mode-row">
                                            <div class="mr-options-number-copy">
                                                <span class="mr-options-label">Subfolder fill mode <span class="mr-tooltip-badge" data-tooltip="Controls how Model Resolver fills the Subfolder field before a download. Manual edits in the download panel still win.">?</span></span>
                                            </div>
                                            <select id="mr-options-download-path-mode" class="mr-options-input">
                                                ${renderPathModeOptions(tokens.download_path_mode)}
                                            </select>
                                        </div>
                                        <div class="mr-options-subsection-head">
                                            <h5 class="mr-options-subsection-title">Default Roots</h5>
                                            <span class="mr-tooltip-badge" data-tooltip="Choose the root directory used by downloads for each model type. Auto keeps Model Resolver's existing folder choice.">?</span>
                                        </div>
                                        <div class="mr-options-template-list">
                                            ${renderDefaultRootRows()}
                                        </div>
                                        <div class="mr-options-subsection-head mr-options-subsection-head-actions">
                                            <div class="mr-options-subsection-title-wrap">
                                                <h5 class="mr-options-subsection-title">Download Path Templates</h5>
                                                <span class="mr-tooltip-badge" data-tooltip="Templates create subfolders under the selected root. Empty template means a flat folder.">?</span>
                                            </div>
                                            <button id="mr-options-detect-templates" type="button" class="mr-btn mr-btn-secondary mr-btn-sm">Detect from existing folders</button>
                                        </div>
                                        <div id="mr-options-template-detect-status" class="mr-options-template-detect-status">Scan your existing model folders and apply the most likely template presets.</div>
                                        <div class="mr-options-placeholder-row">
                                            <span>Available placeholders:</span>
                                            ${renderTemplatePlaceholderBadges()}
                                        </div>
                                        <div class="mr-options-template-list">
                                            ${renderPathTemplateRows()}
                                        </div>
                                    </div>
                                </div>
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack">
                                        <div class="mr-options-mapping-section">
                                            <div class="mr-options-mapping-head">
                                                <label class="mr-options-label">Base Model Path Mappings <span class="mr-tooltip-badge" data-tooltip="Optional. Map a detected base model to a folder path, for example: Pony -> SDXL/Pony. These are applied to {base_model} and may include subfolders.">?</span></label>
                                                <button id="mr-options-add-base-model-mapping" type="button" class="mr-btn mr-btn-primary mr-btn-sm">+ Add Mapping</button>
                                            </div>
                                            <div id="mr-options-base-model-mappings" class="mr-options-mapping-list"></div>
                                        </div>
                                        <div class="mr-options-db-message">
                                            These settings only affect new downloads. The per-download Folder and Subfolder controls remain available for one-off overrides.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section id="mr-options-section-search" class="mr-options-card mr-options-section is-hidden">
                            <div class="mr-options-section-head">
                                <h4 class="mr-options-section-title">Search Defaults</h4>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-toggle-list">
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Auto-fill model filter <span class="mr-tooltip-badge" data-tooltip="When enabled, new searches use Auto with the detected workflow base model. When disabled, new searches start with Any model, and Auto remains available in the model dropdown.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-auto-fill-base-model" class="mr-options-switch-input" type="checkbox" ${tokens.auto_fill_base_model ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Auto-fill subfolder <span class="mr-tooltip-badge" data-tooltip="When enabled, Model Resolver fills a suggested subfolder from model metadata, filename patterns, and your existing folders. When disabled, the field stays empty unless you click Suggest.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-auto-fill-subfolder" class="mr-options-switch-input" type="checkbox" ${tokens.auto_fill_subfolder ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Refresh ComfyUI models after Apply <span class="mr-tooltip-badge" data-tooltip="When enabled, Model Resolver refreshes ComfyUI's model lists only if an applied model is not visible to ComfyUI yet. Disable this if the refresh is too slow and you prefer to refresh models manually.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-auto-refresh-comfy-models" class="mr-options-switch-input" type="checkbox" ${tokens.auto_refresh_comfy_models_after_apply ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section id="mr-options-section-local-db" class="mr-options-card mr-options-section is-hidden">
                            <div class="mr-options-section-head">
                                <h4 class="mr-options-section-title">Local Database</h4>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack">
                                        <div class="mr-options-db-summary">
                                            <div class="mr-options-db-row">
                                                <span>Models</span>
                                                <strong id="mr-options-model-list-count">Loading...</strong>
                                            </div>
                                            <div class="mr-options-db-row">
                                                <span>Last update</span>
                                                <strong id="mr-options-model-list-updated">Loading...</strong>
                                            </div>
                                            <div class="mr-options-db-row">
                                                <span>Status</span>
                                                <strong id="mr-options-model-list-state">Checking local file...</strong>
                                            </div>
                                        </div>
                                        <div id="mr-options-model-list-message" class="mr-options-db-message">Local Database uses ComfyUI-Manager model-list.json.</div>
                                        <div class="mr-options-db-actions">
                                            <button id="mr-options-model-list-check" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('refreshCw')} Check latest</button>
                                            <button id="mr-options-model-list-update" type="button" class="mr-btn mr-btn-primary">${getSvgIcon('download')} Update Local Database</button>
                                            <a class="mr-options-inline-link" href="https://github.com/Comfy-Org/ComfyUI-Manager/blob/main/model-list.json" target="_blank" rel="noopener noreferrer">Source</a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="mr-options-section-head" style="margin-top: 24px;">
                                <h4 class="mr-options-section-title">Base Models Support</h4>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack">
                                        <div class="mr-options-db-summary">
                                            <div class="mr-options-db-row">
                                                <span>Base Models</span>
                                                <strong id="mr-options-base-models-count">Loading...</strong>
                                            </div>
                                            <div class="mr-options-db-row">
                                                <span>Last update</span>
                                                <strong id="mr-options-base-models-updated">Loading...</strong>
                                            </div>
                                            <div class="mr-options-db-row">
                                                <span>Status</span>
                                                <strong id="mr-options-base-models-state">Checking local file...</strong>
                                            </div>
                                        </div>
                                        <div id="mr-options-base-models-message" class="mr-options-db-message">Base Models list maps new CivitAI models to local categories.</div>
                                        <div class="mr-options-db-actions">
                                            <button id="mr-options-base-models-check" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('refreshCw')} Check latest</button>
                                            <button id="mr-options-base-models-update" type="button" class="mr-btn mr-btn-primary">${getSvgIcon('download')} Update Base Models</button>
                                            <a class="mr-options-inline-link" href="https://civitai.com/api/v1/enums" target="_blank" rel="noopener noreferrer">Source</a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section id="mr-options-section-civitai" class="mr-options-card mr-options-section">
                            <div class="mr-options-section-head">
                                <h4 class="mr-options-section-title">CivitAI</h4>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-toggle-list">
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Use CivitAI tRPC search <span class="mr-tooltip-badge" data-tooltip="Main CivitAI search method. Keep this enabled unless CivitAI search stops working.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-civitai-use-trpc-search" class="mr-options-switch-input" type="checkbox" ${tokens.civitai_use_trpc_search ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <div class="mr-options-dependent-block">
                                            <div class="mr-options-field">
                                                <div class="mr-options-input-row">
                                                    <label for="mr-options-civitai" class="mr-options-label">CivitAI API Key <a href="https://civitai.com/user/account" target="_blank" rel="noopener noreferrer" class="mr-options-inline-link">Get key</a> <span class="mr-tooltip-badge" data-tooltip="Optional. Used when downloading from CivitAI requires your account. Add this if CivitAI downloads fail or need access to models available to your account.">?</span></label>
                                                    <input id="mr-options-civitai" class="mr-options-input" type="password" placeholder="Paste CivitAI API key" value="${tokens.civitai_key}">
                                                    <button id="mr-options-civitai-toggle" type="button" class="mr-options-visibility-btn" aria-label="Toggle visibility for saved CivitAI API key" data-tooltip="Show saved value">
                                                        ${getSvgIcon('eye')}
                                                    </button>
                                                </div>
                                                <div class="mr-options-token-check">
                                                    <button id="mr-options-civitai-key-check" type="button" class="mr-btn mr-btn-secondary mr-btn-sm">${getSvgIcon('refreshCw')} Check API key</button>
                                                    <span id="mr-options-civitai-key-check-status" class="mr-options-token-check-status">Not checked</span>
                                                </div>
                                            </div>
                                            <div class="mr-options-field">
                                                <div class="mr-options-input-row">
                                                    <label for="mr-options-civitai-session" class="mr-options-label">CivitAI Session Token <span class="mr-tooltip-badge" data-tooltip="Optional. Makes CivitAI search use your logged-in session, so results can match what you see in the browser. Useful for NSFW or account-visible results.">?</span></label>
                                                    <input id="mr-options-civitai-session" class="mr-options-input" type="password" placeholder="Paste __Secure-civitai-token" value="${tokens.civitai_session_token}">
                                                    <button id="mr-options-civitai-session-toggle" type="button" class="mr-options-visibility-btn" aria-label="Toggle visibility for saved CivitAI session token" data-tooltip="Show saved value">
                                                        ${getSvgIcon('eye')}
                                                    </button>
                                                </div>
                                                <details class="mr-options-help">
                                                    <summary>How to find the session token</summary>
                                                    <ol>
                                                        <li>Sign in on civitai.com in your browser.</li>
                                                        <li>Open DevTools, then Application or Storage.</li>
                                                        <li>Open Cookies for civitai.com and copy <code>__Secure-civitai-token</code>.</li>
                                                    </ol>
                                                    <p>Treat it like a password. It is only needed when session-aware CivitAI search is required.</p>
                                                </details>
                                                <div class="mr-options-token-check">
                                                    <button id="mr-options-civitai-session-check" type="button" class="mr-btn mr-btn-secondary mr-btn-sm">${getSvgIcon('refreshCw')} Check session</button>
                                                    <span id="mr-options-civitai-session-check-status" class="mr-options-token-check-status">Not checked</span>
                                                </div>
                                            </div>
                                        </div>
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Use CivitAI HTML fallback <span class="mr-tooltip-badge" data-tooltip="Backup CivitAI search. Leave this enabled to try the regular CivitAI page when the main search does not find enough results.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-civitai-use-html-fallback" class="mr-options-switch-input" type="checkbox" ${tokens.civitai_use_html_fallback ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <div class="mr-options-dependent-block">
                                            <div class="mr-options-number-row">
                                                <div class="mr-options-number-copy">
                                                    <span class="mr-options-label">CivitAI Models To Inspect <span class="mr-tooltip-badge" data-tooltip="How many CivitAI results to check for the exact file. Higher values may find more matches, but searches can take longer. Range: 1-20.">?</span></span>
                                                </div>
                                                <input id="mr-options-civitai-limit" class="mr-options-input" type="number" min="1" max="20" step="1" value="${tokens.civitai_candidate_limit}">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section id="mr-options-section-hf" class="mr-options-card mr-options-section">
                            <div class="mr-options-section-head">
                                <h4 class="mr-options-section-title">HuggingFace</h4>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-toggle-list">
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Use HuggingFace API repo search <span class="mr-tooltip-badge" data-tooltip="Main Hugging Face search method. It searches by filename, then checks matching repos for the actual file.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-hf-use-api-search" class="mr-options-switch-input" type="checkbox" ${tokens.hf_use_api_search ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <div class="mr-options-dependent-block">
                                            <div class="mr-options-field">
                                                <div class="mr-options-input-row">
                                                    <label for="mr-options-hf" class="mr-options-label">HuggingFace Token <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" class="mr-options-inline-link">Get key</a> <span class="mr-tooltip-badge" data-tooltip="Optional. Used to search and download files from Hugging Face repos your account can access, including gated repos. A read-only token is enough.">?</span></label>
                                                    <input id="mr-options-hf" class="mr-options-input" type="password" placeholder="Paste HuggingFace token" value="${tokens.hf_token}">
                                                    <button id="mr-options-hf-toggle" type="button" class="mr-options-visibility-btn" aria-label="Toggle visibility for saved HuggingFace token" data-tooltip="Show saved value">
                                                        ${getSvgIcon('eye')}
                                                    </button>
                                                </div>
                                                <div class="mr-options-token-check">
                                                    <button id="mr-options-hf-token-check" type="button" class="mr-btn mr-btn-secondary mr-btn-sm">${getSvgIcon('refreshCw')} Check token</button>
                                                    <span id="mr-options-hf-token-check-status" class="mr-options-token-check-status">Not checked</span>
                                                </div>
                                            </div>
                                        </div>
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Use Comfy-Org fallback <span class="mr-tooltip-badge" data-tooltip="Checks Comfy-Org repositories directly. Useful for ComfyUI model packs that normal Hugging Face search may miss.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-hf-use-comfy-org-fallback" class="mr-options-switch-input" type="checkbox" ${tokens.hf_use_comfy_org_fallback ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <div class="mr-options-dependent-block">
                                            <div class="mr-options-db-summary">
                                                <div class="mr-options-db-row">
                                                    <span>Comfy-Org files</span>
                                                    <strong id="mr-options-hf-index-count">Loading...</strong>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span>Last refresh</span>
                                                    <strong id="mr-options-hf-index-updated">Loading...</strong>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span>Status</span>
                                                    <strong id="mr-options-hf-index-state">Checking local index...</strong>
                                                </div>
                                            </div>
                                            <div id="mr-options-hf-index-message" class="mr-options-db-message">Comfy-Org fallback uses a cached HuggingFace file index.</div>
                                            <div class="mr-options-db-actions">
                                                <button id="mr-options-hf-index-refresh" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('refreshCw')} Refresh Comfy-Org Index</button>
                                            </div>
                                        </div>
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Use Brave fallback <span class="mr-tooltip-badge" data-tooltip="Last-resort web search for the exact filename on huggingface.co. Results are still checked before Model Resolver offers them.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-hf-use-brave-fallback" class="mr-options-switch-input" type="checkbox" ${tokens.hf_use_brave_fallback ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <div class="mr-options-dependent-block">
                                            <div class="mr-options-field">
                                                <div class="mr-options-input-row">
                                                    <label for="mr-options-brave" class="mr-options-label">Brave Search API Key <a href="https://api-dashboard.search.brave.com/app/keys" target="_blank" rel="noopener noreferrer" class="mr-options-inline-link">Get key</a> <span class="mr-tooltip-badge" data-tooltip="Optional. Used only by the Brave fallback. It helps find Hugging Face files when Hugging Face search does not show the right repo.">?</span></label>
                                                    <input id="mr-options-brave" class="mr-options-input" type="password" placeholder="Paste Brave Search API key" value="${tokens.brave_search_api_key}">
                                                    <button id="mr-options-brave-toggle" type="button" class="mr-options-visibility-btn" aria-label="Toggle visibility for saved Brave Search API key" data-tooltip="Show saved value">
                                                        ${getSvgIcon('eye')}
                                                    </button>
                                                </div>
                                                <div class="mr-options-token-check">
                                                    <button id="mr-options-brave-key-check" type="button" class="mr-btn mr-btn-secondary mr-btn-sm">${getSvgIcon('refreshCw')} Check API key</button>
                                                    <span id="mr-options-brave-key-check-status" class="mr-options-token-check-status">Not checked</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section id="mr-options-section-maintenance" class="mr-options-card mr-options-section is-hidden">
                            <div class="mr-options-section-head">
                                <h4 class="mr-options-section-title">Maintenance</h4>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-toggle-list">
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Frontend logs <span class="mr-tooltip-badge" data-tooltip="When enabled, Model Resolver writes frontend diagnostic logs to the browser console.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-frontend-logs-enabled" class="mr-options-switch-input" type="checkbox" ${tokens.frontend_logs_enabled ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <div class="mr-options-dependent-block">
                                            <div class="mr-options-number-row">
                                                <div class="mr-options-number-copy">
                                                    <span class="mr-options-label">Frontend log level <span class="mr-tooltip-badge" data-tooltip="Minimum frontend log level shown in the browser console. NONE hides all frontend logger output.">?</span></span>
                                                </div>
                                                <select id="mr-options-frontend-log-level" class="mr-options-input">
                                                    ${renderLogLevelOptions(tokens.frontend_log_level)}
                                                </select>
                                            </div>
                                        </div>
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Backend logs <span class="mr-tooltip-badge" data-tooltip="When enabled, Model Resolver writes backend logs to the ComfyUI console and plugin log file.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-backend-logs-enabled" class="mr-options-switch-input" type="checkbox" ${tokens.backend_logs_enabled ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <div class="mr-options-dependent-block">
                                            <div class="mr-options-number-row">
                                                <div class="mr-options-number-copy">
                                                    <span class="mr-options-label">Backend log level <span class="mr-tooltip-badge" data-tooltip="Minimum backend log level written by Model Resolver. NONE hides all backend logger output.">?</span></span>
                                                </div>
                                                <select id="mr-options-backend-log-level" class="mr-options-input">
                                                    ${renderLogLevelOptions(tokens.backend_log_level)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack">
                                        <div class="mr-options-db-message">
                                            Clears only Model Resolver's temporary memory: remembered workflow analysis, search results, provider lookups, source status, folder lists, and subfolder suggestions. It does not delete downloaded models, metadata files, saved options, or API keys.
                                        </div>
                                        <div class="mr-options-db-actions">
                                            <button id="mr-options-clear-all-cache" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('refreshCw')} Clear Frontend and Backend Cache</button>
                                        </div>
                                        <div id="mr-options-clear-cache-status" class="mr-options-db-message">Use this when search results look stale or the resolver gets into an inconsistent state. Your model files stay untouched.</div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        `;

        const civitaiInput = this.contentElement.querySelector('#mr-options-civitai');
        const civitaiSessionInput = this.contentElement.querySelector('#mr-options-civitai-session');
        const hfInput = this.contentElement.querySelector('#mr-options-hf');
        const braveInput = this.contentElement.querySelector('#mr-options-brave');
        const civitaiToggle = this.contentElement.querySelector('#mr-options-civitai-toggle');
        const civitaiSessionToggle = this.contentElement.querySelector('#mr-options-civitai-session-toggle');
        const hfToggle = this.contentElement.querySelector('#mr-options-hf-toggle');
        const braveToggle = this.contentElement.querySelector('#mr-options-brave-toggle');
        const civitaiLimitInput = this.contentElement.querySelector('#mr-options-civitai-limit');
        const civitaiUseTrpcSearchInput = this.contentElement.querySelector('#mr-options-civitai-use-trpc-search');
        const civitaiUseHtmlFallbackInput = this.contentElement.querySelector('#mr-options-civitai-use-html-fallback');
        const civitaiKeyCheckBtn = this.contentElement.querySelector('#mr-options-civitai-key-check');
        const civitaiKeyCheckStatus = this.contentElement.querySelector('#mr-options-civitai-key-check-status');
        const civitaiSessionCheckBtn = this.contentElement.querySelector('#mr-options-civitai-session-check');
        const civitaiSessionCheckStatus = this.contentElement.querySelector('#mr-options-civitai-session-check-status');
        const hfUseApiSearchInput = this.contentElement.querySelector('#mr-options-hf-use-api-search');
        const hfUseComfyOrgFallbackInput = this.contentElement.querySelector('#mr-options-hf-use-comfy-org-fallback');
        const hfUseBraveFallbackInput = this.contentElement.querySelector('#mr-options-hf-use-brave-fallback');
        const autoFillBaseModelInput = this.contentElement.querySelector('#mr-options-auto-fill-base-model');
        const autoFillSubfolderInput = this.contentElement.querySelector('#mr-options-auto-fill-subfolder');
        const autoRefreshComfyModelsInput = this.contentElement.querySelector('#mr-options-auto-refresh-comfy-models');
        const downloadBackendInput = this.contentElement.querySelector('#mr-options-download-backend');
        const aria2cPathInput = this.contentElement.querySelector('#mr-options-aria2c-path');
        const aria2InstallBtn = this.contentElement.querySelector('#mr-options-aria2-install');
        const aria2CheckBtn = this.contentElement.querySelector('#mr-options-aria2-check');
        const aria2StatusEl = this.contentElement.querySelector('#mr-options-aria2-status');
        const aria2SettingEls = Array.from(this.contentElement.querySelectorAll('.mr-options-aria2-setting'));
        const downloadPathModeInput = this.contentElement.querySelector('#mr-options-download-path-mode');
        const defaultRootSelectInputs = Array.from(this.contentElement.querySelectorAll('.mr-options-default-root'));
        const templatePresetInputs = Array.from(this.contentElement.querySelectorAll('.mr-options-template-preset'));
        const templateCustomInputs = Array.from(this.contentElement.querySelectorAll('.mr-options-template-custom'));
        const detectTemplatesBtn = this.contentElement.querySelector('#mr-options-detect-templates');
        const templateDetectStatus = this.contentElement.querySelector('#mr-options-template-detect-status');
        const baseModelMappingsContainer = this.contentElement.querySelector('#mr-options-base-model-mappings');
        const addBaseModelMappingBtn = this.contentElement.querySelector('#mr-options-add-base-model-mapping');
        const frontendLogsEnabledInput = this.contentElement.querySelector('#mr-options-frontend-logs-enabled');
        const backendLogsEnabledInput = this.contentElement.querySelector('#mr-options-backend-logs-enabled');
        const frontendLogLevelInput = this.contentElement.querySelector('#mr-options-frontend-log-level');
        const backendLogLevelInput = this.contentElement.querySelector('#mr-options-backend-log-level');
        const hfTokenCheckBtn = this.contentElement.querySelector('#mr-options-hf-token-check');
        const hfTokenCheckStatus = this.contentElement.querySelector('#mr-options-hf-token-check-status');
        const braveKeyCheckBtn = this.contentElement.querySelector('#mr-options-brave-key-check');
        const braveKeyCheckStatus = this.contentElement.querySelector('#mr-options-brave-key-check-status');
        const sourceEnabledInputs = Array.from(this.contentElement.querySelectorAll('.mr-options-source-enabled'));
        const status = this.contentElement.querySelector('#mr-options-status');
        const saveBtn = this.contentElement.querySelector('#mr-options-save');
        const modelListCountEl = this.contentElement.querySelector('#mr-options-model-list-count');
        const modelListUpdatedEl = this.contentElement.querySelector('#mr-options-model-list-updated');
        const modelListStateEl = this.contentElement.querySelector('#mr-options-model-list-state');
        const modelListMessageEl = this.contentElement.querySelector('#mr-options-model-list-message');
        const modelListCheckBtn = this.contentElement.querySelector('#mr-options-model-list-check');
        const modelListUpdateBtn = this.contentElement.querySelector('#mr-options-model-list-update');
        const baseModelsCountEl = this.contentElement.querySelector('#mr-options-base-models-count');
        const baseModelsUpdatedEl = this.contentElement.querySelector('#mr-options-base-models-updated');
        const baseModelsStateEl = this.contentElement.querySelector('#mr-options-base-models-state');
        const baseModelsMessageEl = this.contentElement.querySelector('#mr-options-base-models-message');
        const baseModelsCheckBtn = this.contentElement.querySelector('#mr-options-base-models-check');
        const baseModelsUpdateBtn = this.contentElement.querySelector('#mr-options-base-models-update');
        const hfIndexCountEl = this.contentElement.querySelector('#mr-options-hf-index-count');
        const hfIndexUpdatedEl = this.contentElement.querySelector('#mr-options-hf-index-updated');
        const hfIndexStateEl = this.contentElement.querySelector('#mr-options-hf-index-state');
        const hfIndexMessageEl = this.contentElement.querySelector('#mr-options-hf-index-message');
        const hfIndexRefreshBtn = this.contentElement.querySelector('#mr-options-hf-index-refresh');
        const clearAllCacheBtn = this.contentElement.querySelector('#mr-options-clear-all-cache');
        const clearAllCacheStatus = this.contentElement.querySelector('#mr-options-clear-cache-status');
        const navButtons = Array.from(this.contentElement.querySelectorAll('.mr-options-nav-btn'));
        const optionSections = Array.from(this.contentElement.querySelectorAll('.mr-options-section'));
        const trackedInputs = [
            civitaiInput,
            civitaiSessionInput,
            hfInput,
            braveInput,
            civitaiLimitInput,
            civitaiUseTrpcSearchInput,
            civitaiUseHtmlFallbackInput,
            hfUseApiSearchInput,
            hfUseComfyOrgFallbackInput,
            hfUseBraveFallbackInput,
            autoFillBaseModelInput,
            autoFillSubfolderInput,
            autoRefreshComfyModelsInput,
            downloadBackendInput,
            aria2cPathInput,
            downloadPathModeInput,
            ...defaultRootSelectInputs,
            ...templatePresetInputs,
            ...templateCustomInputs,
            frontendLogsEnabledInput,
            backendLogsEnabledInput,
            frontendLogLevelInput,
            backendLogLevelInput,
            ...sourceEnabledInputs,
        ].filter(Boolean);

        const setStatus = (text, mode = '') => {
            if (!status) return;
            status.textContent = text;
            status.classList.remove('is-dirty', 'is-saved');
            if (mode) status.classList.add(mode);
        };

        const formatOptionDate = (value) => {
            if (!value) return 'Bundled';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return value;
            return date.toLocaleString();
        };

        const shortSha = (value) => value ? String(value).slice(0, 8) : '';

        const setModelListBusy = (busy) => {
            if (modelListCheckBtn) modelListCheckBtn.disabled = busy;
            if (modelListUpdateBtn) modelListUpdateBtn.disabled = busy;
        };

        const setBaseModelsBusy = (busy) => {
            if (baseModelsCheckBtn) baseModelsCheckBtn.disabled = busy;
            if (baseModelsUpdateBtn) baseModelsUpdateBtn.disabled = busy;
        };

        const setHfIndexBusy = (busy) => {
            if (hfIndexRefreshBtn) hfIndexRefreshBtn.disabled = busy;
        };

        const setTokenCheckStatus = (statusEl, text, mode = '') => {
            if (!statusEl) return;
            statusEl.textContent = text;
            statusEl.classList.remove('is-valid', 'is-invalid', 'is-pending');
            if (mode) statusEl.classList.add(mode);
        };

        const setAria2Status = (text, mode = '') => {
            if (!aria2StatusEl) return;
            aria2StatusEl.textContent = text;
            aria2StatusEl.classList.remove('is-valid', 'is-invalid', 'is-pending');
            if (mode) aria2StatusEl.classList.add(mode);
        };

        const syncAria2OptionsVisibility = () => {
            const backend = this.normalizeDownloadBackend(downloadBackendInput?.value || tokens.download_backend);
            const showAria2 = backend === 'aria2';
            aria2SettingEls.forEach((element) => {
                element.hidden = !showAria2;
            });
        };

        const checkAria2Status = async ({ useUnsavedPath = true } = {}) => {
            if (aria2CheckBtn) aria2CheckBtn.disabled = true;
            setAria2Status('Checking aria2...', 'is-pending');
            try {
                const data = await this.fetchJson('/model_resolver/aria2/status', {
                    method: 'POST',
                    body: JSON.stringify({
                        aria2c_path: useUnsavedPath
                            ? (aria2cPathInput?.value || '')
                            : (tokens.aria2c_path || '')
                    }),
                    silent: true
                }, 'Check aria2');
                if (data?.available) {
                    const path = data.resolved_path || 'aria2c from PATH';
                    const runningText = data.running ? ' Daemon is running.' : ' Daemon will start on first aria2 download.';
                    setAria2Status(`aria2 is available: ${path}.${runningText}`, 'is-valid');
                } else {
                    setAria2Status(data?.error || 'aria2c was not found. Install aria2 or configure the aria2c path.', 'is-invalid');
                }
            } catch (error) {
                setAria2Status(error.message || 'aria2 check failed.', 'is-invalid');
            } finally {
                if (aria2CheckBtn) aria2CheckBtn.disabled = false;
            }
        };

        const installAria2 = async () => {
            if (aria2InstallBtn) aria2InstallBtn.disabled = true;
            if (aria2CheckBtn) aria2CheckBtn.disabled = true;
            setAria2Status('Downloading and installing aria2 from official GitHub releases...', 'is-pending');
            try {
                const data = await this.fetchJson('/model_resolver/aria2/install', {
                    method: 'POST',
                    body: JSON.stringify({}),
                    silent: true
                }, 'Install aria2');

                if (!data?.success || !data?.aria2c_path) {
                    throw new Error(data?.error || 'aria2 install did not return an executable path.');
                }

                if (aria2cPathInput) {
                    aria2cPathInput.value = data.aria2c_path;
                    aria2cPathInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                if (downloadBackendInput) {
                    downloadBackendInput.value = 'aria2';
                    downloadBackendInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                tokens.aria2c_path = data.aria2c_path;
                tokens.download_backend = 'aria2';
                localStorage.setItem('ModelResolver.aria2cPath', data.aria2c_path);
                localStorage.setItem('ModelResolver.downloadBackend', 'aria2');

                const versionText = data.version ? ` ${data.version}` : '';
                const installedText = data.already_installed ? 'already installed' : 'installed';
                setAria2Status(`aria2${versionText} ${installedText}: ${data.aria2c_path}`, 'is-valid');
                await checkAria2Status({ useUnsavedPath: true });
            } catch (error) {
                setAria2Status(error.message || 'aria2 install failed.', 'is-invalid');
            } finally {
                if (aria2InstallBtn) aria2InstallBtn.disabled = false;
                if (aria2CheckBtn) aria2CheckBtn.disabled = false;
            }
        };

        const checkCredential = async ({ input, button, statusEl, endpoint, payloadKey, missingText }) => {
            const value = (input?.value || '').trim();
            if (!value) {
                setTokenCheckStatus(statusEl, missingText, 'is-invalid');
                return;
            }

            try {
                if (button) button.disabled = true;
                setTokenCheckStatus(statusEl, 'Checking...', 'is-pending');
                const data = await this.fetchJson(endpoint, {
                    method: 'POST',
                    body: JSON.stringify({ [payloadKey]: value })
                }, 'Check credential');
                setTokenCheckStatus(
                    statusEl,
                    data.message || (data.valid ? 'Valid' : 'Invalid'),
                    data.valid ? 'is-valid' : 'is-invalid'
                );
            } catch (error) {
                console.error('Model Resolver: Credential check error:', error);
                setTokenCheckStatus(statusEl, error.message || 'Check failed', 'is-invalid');
            } finally {
                if (button) button.disabled = false;
            }
        };

        const renderModelListStatus = (data = {}, checkedRemote = false) => {
            if (modelListCountEl) {
                modelListCountEl.textContent = Number.isFinite(Number(data.local_count))
                    ? Number(data.local_count).toLocaleString()
                    : '-';
            }
            if (modelListUpdatedEl) {
                modelListUpdatedEl.textContent = formatOptionDate(data.local_updated_at);
            }
            if (modelListStateEl) {
                if (checkedRemote && data.can_compare && data.update_available) {
                    modelListStateEl.textContent = 'Update available';
                } else if (checkedRemote && data.can_compare) {
                    modelListStateEl.textContent = 'Up to date';
                } else if (checkedRemote && !data.can_compare) {
                    modelListStateEl.textContent = 'Remote checked';
                } else {
                    modelListStateEl.textContent = data.local_sha ? 'Tracked' : 'Bundled';
                }
            }
            if (modelListMessageEl) {
                const localSha = shortSha(data.local_sha);
                const remoteSha = shortSha(data.remote_sha);
                if (checkedRemote && data.update_available) {
                    modelListMessageEl.textContent = `A newer ComfyUI-Manager model-list.json is available (${localSha || 'local'} -> ${remoteSha}).`;
                } else if (checkedRemote && data.can_compare) {
                    modelListMessageEl.textContent = `Local Database is current (${localSha}).`;
                } else if (checkedRemote) {
                    modelListMessageEl.textContent = `Remote file was checked. Local SHA is not recorded yet; run update once to track future changes.`;
                } else {
                    modelListMessageEl.textContent = `Local Database uses ComfyUI-Manager model-list.json.`;
                }
            }
        };

        const loadModelListStatus = async (checkRemote = false) => {
            try {
                setModelListBusy(true);
                if (modelListStateEl) {
                    modelListStateEl.textContent = checkRemote ? 'Checking GitHub...' : 'Loading...';
                }
                const data = await this.fetchJson(`/model_resolver/model-list/status${checkRemote ? '?check_remote=1' : ''}`, {}, 'Load model list status');
                renderModelListStatus(data, checkRemote);
                return data;
            } catch (error) {
                console.error('Model Resolver: model-list status error:', error);
                if (modelListStateEl) modelListStateEl.textContent = 'Error';
                if (modelListMessageEl) modelListMessageEl.textContent = error.message || 'Failed to read Local Database status.';
                return null;
            } finally {
                setModelListBusy(false);
            }
        };

        const updateModelList = async () => {
            try {
                setModelListBusy(true);
                if (modelListStateEl) modelListStateEl.textContent = 'Updating...';
                if (modelListMessageEl) modelListMessageEl.textContent = 'Downloading latest ComfyUI-Manager model-list.json...';
                const data = await this.fetchJson('/model_resolver/model-list/update', {
                    method: 'POST'
                }, 'Update model list');
                await this.clearSearchCaches();
                renderModelListStatus(data, false);
                if (modelListStateEl) modelListStateEl.textContent = 'Updated';
                if (modelListMessageEl) modelListMessageEl.textContent = `Local Database updated. ${Number(data.local_count || 0).toLocaleString()} models loaded.`;
                this.showNotification('Local Database updated', 'success');
            } catch (error) {
                console.error('Model Resolver: model-list update error:', error);
                if (modelListStateEl) modelListStateEl.textContent = 'Error';
                if (modelListMessageEl) modelListMessageEl.textContent = error.message || 'Failed to update Local Database.';
                this.showNotification('Local Database update failed', 'error');
            } finally {
                setModelListBusy(false);
            }
        };

        const renderBaseModelsStatus = (data = {}, checkedRemote = false) => {
            if (baseModelsCountEl) {
                baseModelsCountEl.textContent = Number.isFinite(Number(data.local_count))
                    ? Number(data.local_count).toLocaleString()
                    : '-';
            }
            if (baseModelsUpdatedEl) {
                baseModelsUpdatedEl.textContent = formatOptionDate(data.local_updated_at);
            }
            if (baseModelsStateEl) {
                if (checkedRemote && data.update_available) {
                    baseModelsStateEl.textContent = 'Update available';
                } else if (checkedRemote) {
                    baseModelsStateEl.textContent = 'Up to date';
                } else {
                    baseModelsStateEl.textContent = data.local_updated_at ? 'Tracked' : 'Bundled';
                }
            }
            if (baseModelsMessageEl) {
                if (checkedRemote && data.update_available) {
                    baseModelsMessageEl.textContent = `New base models are available from CivitAI.`;
                } else if (checkedRemote) {
                    baseModelsMessageEl.textContent = `Base Models list is current.`;
                } else {
                    baseModelsMessageEl.textContent = `Base Models list maps new CivitAI models to local categories.`;
                }
            }
        };

        const loadBaseModelsStatus = async (checkRemote = false) => {
            try {
                setBaseModelsBusy(true);
                if (baseModelsStateEl) {
                    baseModelsStateEl.textContent = checkRemote ? 'Checking CivitAI...' : 'Loading...';
                }
                const data = await this.fetchJson(`/model_resolver/base-models/status${checkRemote ? '?check_remote=1' : ''}`, {}, 'Load base models status');
                renderBaseModelsStatus(data, checkRemote);
                return data;
            } catch (error) {
                console.error('Model Resolver: base-models status error:', error);
                if (baseModelsStateEl) baseModelsStateEl.textContent = 'Error';
                if (baseModelsMessageEl) baseModelsMessageEl.textContent = error.message || 'Failed to read Base Models status.';
                return null;
            } finally {
                setBaseModelsBusy(false);
            }
        };

        const formatNewBaseModelsSummary = (models = [], maxVisible = 6) => {
            const names = Array.isArray(models)
                ? models.map(name => String(name || '').trim()).filter(Boolean)
                : [];
            if (!names.length) return '';
            const visible = names.slice(0, maxVisible);
            const suffix = names.length > visible.length
                ? ` and ${names.length - visible.length} more`
                : '';
            return `${visible.join(', ')}${suffix}`;
        };

        const updateBaseModels = async () => {
            try {
                setBaseModelsBusy(true);
                if (baseModelsStateEl) baseModelsStateEl.textContent = 'Updating...';
                if (baseModelsMessageEl) baseModelsMessageEl.textContent = 'Downloading latest base models from CivitAI...';
                const data = await this.fetchJson('/model_resolver/base-models/update', {
                    method: 'POST'
                }, 'Update base models');
                await this.clearSearchCaches();
                // Invalidate the in-memory cache so the base model dropdown
                // reloads fresh data from the server next time it is opened.
                this.baseModels = null;
                await this.ensureBaseModelsLoaded();
                renderBaseModelsStatus(data, false);
                if (baseModelsStateEl) baseModelsStateEl.textContent = 'Updated';
                const newModelsSummary = formatNewBaseModelsSummary(data.new_models_added_list);
                const addedCount = Number(data.new_models_added || 0);
                const addedText = addedCount > 0
                    ? ` Added ${addedCount.toLocaleString()} new model${addedCount === 1 ? '' : 's'}${newModelsSummary ? `: ${newModelsSummary}` : ''}.`
                    : ' No new base models were added.';
                if (baseModelsMessageEl) baseModelsMessageEl.textContent = `Base Models updated. ${Number(data.local_count || 0).toLocaleString()} base models loaded.${addedText}`;
                this.showNotification(
                    addedCount > 0
                        ? `Base Models updated${newModelsSummary ? `: ${newModelsSummary}` : ''}`
                        : 'Base Models updated. No new models added.',
                    'success'
                );
            } catch (error) {
                console.error('Model Resolver: base-models update error:', error);
                if (baseModelsStateEl) baseModelsStateEl.textContent = 'Error';
                if (baseModelsMessageEl) baseModelsMessageEl.textContent = error.message || 'Failed to update Base Models.';
                this.showNotification('Base Models update failed', 'error');
            } finally {
                setBaseModelsBusy(false);
            }
        };

        const renderHfIndexStatus = (data = {}) => {
            if (hfIndexCountEl) {
                hfIndexCountEl.textContent = Number.isFinite(Number(data.file_count))
                    ? Number(data.file_count).toLocaleString()
                    : '-';
            }
            if (hfIndexUpdatedEl) {
                hfIndexUpdatedEl.textContent = data.updated_at
                    ? formatOptionDate(Number(data.updated_at) * 1000)
                    : 'Never';
            }
            if (hfIndexStateEl) {
                if (!data.exists) {
                    hfIndexStateEl.textContent = 'Not cached';
                } else if (data.stale) {
                    hfIndexStateEl.textContent = 'Refresh due';
                } else {
                    hfIndexStateEl.textContent = 'Cached';
                }
            }
            if (hfIndexMessageEl) {
                if (!data.exists) {
                    hfIndexMessageEl.textContent = 'The first Comfy-Org fallback search will build the local HuggingFace file index.';
                } else if (data.stale) {
                    hfIndexMessageEl.textContent = `Index has ${Number(data.repo_count || 0).toLocaleString()} repos and should be refreshed.`;
                } else {
                    hfIndexMessageEl.textContent = `Index has ${Number(data.repo_count || 0).toLocaleString()} repos and is used before per-repo fallback checks.`;
                }
            }
        };

        const loadHfIndexStatus = async () => {
            try {
                setHfIndexBusy(true);
                if (hfIndexStateEl) hfIndexStateEl.textContent = 'Loading...';
                const data = await this.fetchJson('/model_resolver/huggingface/author-index/status', {}, 'Load HuggingFace index status');
                renderHfIndexStatus(data);
                return data;
            } catch (error) {
                console.error('Model Resolver: HuggingFace index status error:', error);
                if (hfIndexStateEl) hfIndexStateEl.textContent = 'Error';
                if (hfIndexMessageEl) hfIndexMessageEl.textContent = error.message || 'Failed to read HuggingFace index status.';
                return null;
            } finally {
                setHfIndexBusy(false);
            }
        };

        const refreshHfIndex = async () => {
            try {
                setHfIndexBusy(true);
                if (hfIndexStateEl) hfIndexStateEl.textContent = 'Refreshing...';
                if (hfIndexMessageEl) hfIndexMessageEl.textContent = 'Downloading Comfy-Org file index from HuggingFace...';
                const data = await this.fetchJson('/model_resolver/huggingface/author-index/refresh', {
                    method: 'POST',
                    body: JSON.stringify({ hf_token: hfInput?.value || '' })
                }, 'Refresh HuggingFace index');
                if (data?.success === false) {
                    throw new Error(data.error || 'Refresh failed');
                }
                await this.clearSearchCaches();
                renderHfIndexStatus(data);
                if (hfIndexStateEl) hfIndexStateEl.textContent = 'Refreshed';
                this.showNotification('HuggingFace Comfy-Org index refreshed', 'success');
            } catch (error) {
                console.error('Model Resolver: HuggingFace index refresh error:', error);
                if (hfIndexStateEl) hfIndexStateEl.textContent = 'Error';
                if (hfIndexMessageEl) hfIndexMessageEl.textContent = error.message || 'Failed to refresh HuggingFace index.';
                this.showNotification('HuggingFace index refresh failed', 'error');
            } finally {
                setHfIndexBusy(false);
            }
        };

        const clearAllCachesFromOptions = async () => {
            try {
                if (clearAllCacheBtn) clearAllCacheBtn.disabled = true;
                if (clearAllCacheStatus) clearAllCacheStatus.textContent = 'Clearing frontend and backend cache...';
                await this.clearAllResolverCaches();
                if (clearAllCacheStatus) clearAllCacheStatus.textContent = 'Frontend and backend cache cleared.';
                this.showNotification('Resolver cache cleared', 'success');
                if (this.activeTab === 'options') {
                    this.displayOptions();
                }
            } catch (error) {
                console.error('Model Resolver: clear all cache error:', error);
                if (clearAllCacheStatus) clearAllCacheStatus.textContent = error.message || 'Failed to clear cache.';
                this.showNotification('Cache clear failed', 'error');
            } finally {
                if (clearAllCacheBtn) clearAllCacheBtn.disabled = false;
            }
        };

        const setActiveNav = (targetId) => {
            navButtons.forEach((btn) => {
                btn.classList.toggle('is-active', btn.dataset.target === targetId);
            });
        };

        const setVisibleSection = (targetId) => {
            optionSections.forEach((section) => {
                section.classList.toggle('is-hidden', section.id !== targetId);
            });
            setActiveNav(targetId);
        };

        const getVisibilityIcon = (visible) => visible
            ? getSvgIcon('eye')
            : getSvgIcon('eyeOff');

        const syncVisibilityToggle = (input, button) => {
            if (!input || !button) return;
            const visible = input.type === 'text';
            button.innerHTML = getVisibilityIcon(visible);
            button.classList.toggle('mr-is-active-text', visible);
            button.classList.toggle('mr-is-muted', !visible);
            button.setAttribute('aria-pressed', visible ? 'true' : 'false');
            this.setTooltip(button, visible ? 'Hide saved value' : 'Show saved value');
        };

        const bindVisibilityToggle = (input, button) => {
            if (!input || !button) return;
            syncVisibilityToggle(input, button);
            button.addEventListener('click', () => {
                input.type = input.type === 'password' ? 'text' : 'password';
                syncVisibilityToggle(input, button);
            });
        };

        bindVisibilityToggle(civitaiInput, civitaiToggle);
        bindVisibilityToggle(civitaiSessionInput, civitaiSessionToggle);
        bindVisibilityToggle(hfInput, hfToggle);
        bindVisibilityToggle(braveInput, braveToggle);

        const pathPreviewMetadata = {
            base_model: 'Flux.1 D',
            tags: ['style', 'character'],
            author: 'example_author',
            model_name: 'Example Model',
            version_name: 'v1'
        };

        const getTemplateInputValue = (categoryKey) => {
            const select = templatePresetInputs.find(input => input.dataset.templateCategory === categoryKey);
            const custom = templateCustomInputs.find(input => input.dataset.templateCategory === categoryKey);
            if (!select) return '';
            return select.value === 'custom' ? (custom?.value || '') : select.value;
        };

        const getBaseModelMappingChoices = () => {
            const names = [];
            const seen = new Set();
            const addName = (value) => {
                const name = String(value || '').trim();
                if (!name || seen.has(name)) return;
                seen.add(name);
                names.push(name);
            };

            const baseModelsList = this.baseModels?.base_models;
            if (Array.isArray(baseModelsList)) {
                baseModelsList.forEach(model => addName(model?.name));
            }
            Object.keys(tokens.base_model_path_mappings || {}).forEach(addName);
            return names.sort((a, b) => a.localeCompare(b));
        };

        const getBaseModelMappingRows = () => (
            baseModelMappingsContainer
                ? Array.from(baseModelMappingsContainer.querySelectorAll('.mr-options-mapping-row'))
                : []
        );

        const collectBaseModelPathMappings = () => {
            if (!baseModelMappingsContainer) {
                return { ...(tokens.base_model_path_mappings || {}) };
            }
            return getBaseModelMappingRows().reduce((acc, row) => {
                const baseModel = row.querySelector('.mr-options-mapping-base')?.value?.trim() || '';
                const pathValue = row.querySelector('.mr-options-mapping-path')?.value?.trim() || '';
                if (baseModel && pathValue) {
                    acc[baseModel] = pathValue;
                }
                return acc;
            }, {});
        };

        const renderBaseModelMappingOptions = (currentValue = '', currentRow = null) => {
            const usedValues = new Set(
                getBaseModelMappingRows()
                    .filter(row => row !== currentRow)
                    .map(row => row.querySelector('.mr-options-mapping-base')?.value?.trim() || '')
                    .filter(Boolean)
            );
            const options = [
                `<option value="">Select Base Model</option>`
            ];
            const choices = getBaseModelMappingChoices();
            if (currentValue && !choices.includes(currentValue)) {
                options.push(`<option value="${this.escapeHtml(currentValue)}" selected>${this.escapeHtml(currentValue)}</option>`);
            }
            choices.forEach((name) => {
                if (usedValues.has(name) && name !== currentValue) return;
                options.push(`<option value="${this.escapeHtml(name)}" ${name === currentValue ? 'selected' : ''}>${this.escapeHtml(name)}</option>`);
            });
            return options.join('');
        };

        const refreshBaseModelMappingOptions = () => {
            getBaseModelMappingRows().forEach((row) => {
                const select = row.querySelector('.mr-options-mapping-base');
                if (!select) return;
                const currentValue = select.value;
                select.innerHTML = renderBaseModelMappingOptions(currentValue, row);
                select.value = currentValue;
            });
        };

        const addBaseModelMappingRow = (baseModel = '', pathValue = '') => {
            if (!baseModelMappingsContainer) return;

            const row = document.createElement('div');
            row.className = 'mr-options-mapping-row';
            row.innerHTML = `
                <select class="mr-options-input mr-options-mapping-base">
                    ${renderBaseModelMappingOptions(baseModel, row)}
                </select>
                <input class="mr-options-input mr-options-mapping-path" type="text" placeholder="Custom path (e.g., SDXL/Pony)" value="${this.escapeHtml(pathValue)}">
                <button type="button" class="mr-options-mapping-remove" aria-label="Remove mapping" data-tooltip="Remove mapping">&times;</button>
            `;

            const baseSelect = row.querySelector('.mr-options-mapping-base');
            const pathInput = row.querySelector('.mr-options-mapping-path');
            const removeBtn = row.querySelector('.mr-options-mapping-remove');
            const markChanged = () => {
                setStatus('You have unsaved changes.', 'is-dirty');
                refreshBaseModelMappingOptions();
                syncAllTemplateControls();
            };

            baseSelect?.addEventListener('change', markChanged);
            pathInput?.addEventListener('input', markChanged);
            pathInput?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    pathInput.blur();
                }
            });
            removeBtn?.addEventListener('click', () => {
                row.remove();
                if (!getBaseModelMappingRows().length) {
                    addBaseModelMappingRow('', '');
                }
                markChanged();
            });

            baseModelMappingsContainer.appendChild(row);
            refreshBaseModelMappingOptions();
            this.bindTooltips(row);
        };

        const renderBaseModelMappingRows = (mappings = {}) => {
            if (!baseModelMappingsContainer) return;
            baseModelMappingsContainer.innerHTML = '';
            const entries = Object.entries(mappings || {});
            if (!entries.length) {
                addBaseModelMappingRow('', '');
                return;
            }
            entries.forEach(([baseModel, pathValue]) => {
                addBaseModelMappingRow(baseModel, pathValue);
            });
        };

        const renderTemplatePreview = (template) => {
            const mappings = collectBaseModelPathMappings();
            const mappedBase = this.resolveBaseModelPathMapping(
                pathPreviewMetadata.base_model,
                mappings
            );
            const replacements = {
                '{base_model}': this.sanitizeDownloadPathValue(mappedBase, 'Unknown Base Model'),
                '{author}': this.sanitizeDownloadPathSegment(pathPreviewMetadata.author, 'Anonymous'),
                '{first_tag}': this.sanitizeDownloadPathSegment(this.getPriorityDownloadTag(pathPreviewMetadata.tags), 'no tags'),
                '{model_name}': this.sanitizeDownloadPathSegment(pathPreviewMetadata.model_name, 'Model'),
                '{version_name}': this.sanitizeDownloadPathSegment(pathPreviewMetadata.version_name, '')
            };
            let formatted = this.normalizeDownloadPathTemplate(template);
            Object.entries(replacements).forEach(([token, value]) => {
                formatted = formatted.split(token).join(value);
            });
            formatted = formatted.replace(/\{[^{}]+\}/g, '');
            return this.normalizeTemplateSubfolder(formatted) || '(flat folder)';
        };

        const syncTemplateControl = (categoryKey) => {
            const select = templatePresetInputs.find(input => input.dataset.templateCategory === categoryKey);
            const custom = templateCustomInputs.find(input => input.dataset.templateCategory === categoryKey);
            const preview = this.contentElement.querySelector(`[data-template-preview="${categoryKey}"]`);
            const useCustom = select?.value === 'custom';
            if (custom) {
                custom.classList.toggle('is-hidden', !useCustom);
            }
            if (preview) {
                preview.innerHTML = `<span>Preview:</span> <code>${this.escapeHtml(renderTemplatePreview(getTemplateInputValue(categoryKey)))}</code>`;
            }
        };

        const syncAllTemplateControls = () => {
            pathTemplateCategories.forEach(category => syncTemplateControl(category.key));
        };

        const getDefaultRootContextPath = (select) => {
            if (!select) return '';
            const category = this.normalizeDownloadCategory(select.dataset.rootCategory || '');
            const selectedValue = String(select.value || '').trim();
            if (selectedValue) return selectedValue;
            const directDownloadRoot = this.downloadDirectories?.[category] || '';
            if (directDownloadRoot) return directDownloadRoot;
            const rootOptions = this.downloadRootDirectories?.[category];
            return Array.isArray(rootOptions) && rootOptions.length ? rootOptions[0] : '';
        };

        const getDefaultRootContextModel = (select) => {
            const path = getDefaultRootContextPath(select);
            if (!path) return null;
            const category = this.normalizeDownloadCategory(select.dataset.rootCategory || '');
            const label = select.closest('.mr-options-template-row')?.querySelector('.mr-options-label')?.textContent?.trim()
                || this.getCategoryDisplayName(category);
            return {
                context_scope: 'download_root',
                name: label,
                path,
                resolved_path: path,
                folder_path: path,
                download_directory: path,
                category,
                open_folder_label: 'Open Root Folder'
            };
        };

        const syncDefaultRootContextTarget = (select) => {
            if (!select) return;
            const contextModel = getDefaultRootContextModel(select);
            const tooltip = contextModel
                ? `Right-click to open ${contextModel.name}`
                : 'No root folder available';
            this.setDownloadFolderContextTarget(select, contextModel, tooltip);
            this.setDownloadFolderContextTarget(select.closest('.mr-options-template-row'), contextModel, tooltip);
        };

        const setTemplateControlValue = (categoryKey, template) => {
            const select = templatePresetInputs.find(input => input.dataset.templateCategory === categoryKey);
            const custom = templateCustomInputs.find(input => input.dataset.templateCategory === categoryKey);
            if (!select) return false;
            const normalizedTemplate = this.normalizeDownloadPathTemplate(template);
            select.value = pathTemplatePresetValues.has(normalizedTemplate)
                ? normalizedTemplate
                : 'custom';
            if (custom) {
                custom.value = normalizedTemplate;
            }
            syncTemplateControl(categoryKey);
            return true;
        };

        const setTemplateDetectStatus = (text, mode = '') => {
            if (!templateDetectStatus) return;
            templateDetectStatus.textContent = text;
            templateDetectStatus.classList.remove('is-valid', 'is-invalid', 'is-pending');
            if (mode) templateDetectStatus.classList.add(mode);
        };

        const applyDetectedPathTemplates = async () => {
            if (!detectTemplatesBtn) return;
            detectTemplatesBtn.disabled = true;
            setTemplateDetectStatus('Scanning existing model folders...', 'is-pending');

            try {
                const data = await this.fetchJson('/model_resolver/path-template-suggestions?force=1', {}, 'Detect path templates');
                const categories = data?.categories && typeof data.categories === 'object'
                    ? data.categories
                    : {};
                let appliedCount = 0;
                let inspectedCount = 0;

                pathTemplateCategories.forEach((category) => {
                    const suggestion = categories[category.key];
                    if (!suggestion) return;
                    if (Number(suggestion.model_count || 0) > 0) {
                        inspectedCount += 1;
                    }
                    if (suggestion.apply && setTemplateControlValue(category.key, suggestion.template || '')) {
                        appliedCount += 1;
                    }
                });

                let mappingCount = 0;
                const detectedMappings = data?.base_model_path_mappings || {};
                if (
                    baseModelMappingsContainer &&
                    detectedMappings &&
                    typeof detectedMappings === 'object' &&
                    !Array.isArray(detectedMappings)
                ) {
                    const currentMappings = collectBaseModelPathMappings();
                    Object.entries(detectedMappings).forEach(([source, target]) => {
                        const sourceKey = String(source || '').trim();
                        const targetValue = String(target || '').trim();
                        if (sourceKey && targetValue && !currentMappings[sourceKey]) {
                            currentMappings[sourceKey] = targetValue;
                            mappingCount += 1;
                        }
                    });
                    if (mappingCount > 0) {
                        renderBaseModelMappingRows(currentMappings);
                    }
                }

                if (appliedCount > 0 || mappingCount > 0) {
                    if (appliedCount > 0 && downloadPathModeInput) {
                        downloadPathModeInput.value = 'template';
                    }
                    syncAllTemplateControls();
                    setStatus('You have unsaved changes.', 'is-dirty');
                    const mappingText = mappingCount
                        ? ` Added ${mappingCount} base-model mapping${mappingCount === 1 ? '' : 's'}.`
                        : '';
                    setTemplateDetectStatus(
                        appliedCount > 0
                            ? `Detected ${appliedCount} template preset${appliedCount === 1 ? '' : 's'} from ${inspectedCount} model type${inspectedCount === 1 ? '' : 's'}.${mappingText}`
                            : `Detected ${mappingCount} base-model mapping${mappingCount === 1 ? '' : 's'} from existing folders.`,
                        'is-valid'
                    );
                    this.showNotification('Path templates detected. Review and save options.', 'success');
                } else {
                    setTemplateDetectStatus(
                        'No confident folder pattern found. Existing template settings were not changed.',
                        'is-invalid'
                    );
                    this.showNotification('No confident path template pattern found.', 'info');
                }
            } catch (error) {
                console.error('Model Resolver: path template detection error:', error);
                setTemplateDetectStatus(error.message || 'Template detection failed.', 'is-invalid');
                this.showNotification('Path template detection failed', 'error');
            } finally {
                detectTemplatesBtn.disabled = false;
            }
        };

        templatePresetInputs.forEach(input => {
            input.addEventListener('change', () => syncTemplateControl(input.dataset.templateCategory));
        });
        templateCustomInputs.forEach(input => {
            input.addEventListener('input', () => syncTemplateControl(input.dataset.templateCategory));
        });
        renderBaseModelMappingRows(tokens.base_model_path_mappings || {});
        if (typeof this.ensureBaseModelsLoaded === 'function') {
            this.ensureBaseModelsLoaded()
                .then(() => {
                    refreshBaseModelMappingOptions();
                })
                .catch((error) => {
                    console.warn('Model Resolver: could not load base models for mapping options', error);
                });
        }
        if (addBaseModelMappingBtn) {
            addBaseModelMappingBtn.addEventListener('click', () => {
                addBaseModelMappingRow('', '');
                setStatus('You have unsaved changes.', 'is-dirty');
            });
        }
        syncAllTemplateControls();

        const populateDefaultRootSelects = async () => {
            const roots = await this.ensureDownloadRootDirectoriesLoaded();
            await this.ensureDownloadDirectoriesLoaded();
            defaultRootSelectInputs.forEach((select) => {
                const category = this.normalizeDownloadCategory(select.dataset.rootCategory || '');
                const currentValue = select.value || select.dataset.currentValue || '';
                const categoryRoots = Array.isArray(roots?.[category]) ? roots[category] : [];
                const options = [
                    { value: '', label: 'Auto' },
                    ...categoryRoots.map(path => ({ value: path, label: path }))
                ];
                if (currentValue && !options.some(option => option.value === currentValue)) {
                    options.push({ value: currentValue, label: `${currentValue} (not currently detected)` });
                }
                select.innerHTML = options
                    .map(option => `<option value="${this.escapeHtml(option.value)}" ${option.value === currentValue ? 'selected' : ''}>${this.escapeHtml(option.label)}</option>`)
                    .join('');
                syncDefaultRootContextTarget(select);
            });
        };

        populateDefaultRootSelects();

        setStatus('Saved only on this machine.');
        setVisibleSection('mr-options-section-sources');

        trackedInputs.forEach((input) => {
            const eventName = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
            input.addEventListener(eventName, () => {
                setStatus('You have unsaved changes.', 'is-dirty');
            });
        });

        defaultRootSelectInputs.forEach((select) => {
            select.addEventListener('change', () => {
                syncDefaultRootContextTarget(select);
            });
        });

        this.bindTooltips(this.contentElement);

        navButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.target;
                if (!targetId) return;
                setVisibleSection(targetId);
                if (targetId === 'mr-options-section-local-db') {
                    loadModelListStatus(false);
                    loadBaseModelsStatus(false);
                } else if (targetId === 'mr-options-section-hf') {
                    loadHfIndexStatus();
                }
            });
        });

        if (modelListCheckBtn) {
            modelListCheckBtn.addEventListener('click', () => {
                loadModelListStatus(true);
            });
        }

        if (modelListUpdateBtn) {
            modelListUpdateBtn.addEventListener('click', () => {
                updateModelList();
            });
        }

        if (baseModelsCheckBtn) {
            baseModelsCheckBtn.addEventListener('click', () => {
                loadBaseModelsStatus(true);
            });
        }

        if (baseModelsUpdateBtn) {
            baseModelsUpdateBtn.addEventListener('click', () => {
                updateBaseModels();
            });
        }

        if (hfIndexRefreshBtn) {
            hfIndexRefreshBtn.addEventListener('click', () => {
                refreshHfIndex();
            });
        }

        if (clearAllCacheBtn) {
            clearAllCacheBtn.addEventListener('click', () => {
                clearAllCachesFromOptions();
            });
        }

        if (detectTemplatesBtn) {
            detectTemplatesBtn.addEventListener('click', () => {
                applyDetectedPathTemplates();
            });
        }

        if (aria2CheckBtn) {
            aria2CheckBtn.addEventListener('click', () => {
                checkAria2Status({ useUnsavedPath: true });
            });
        }

        if (aria2InstallBtn) {
            aria2InstallBtn.addEventListener('click', () => {
                installAria2();
            });
        }

        if (downloadBackendInput) {
            downloadBackendInput.addEventListener('change', () => {
                const backend = this.normalizeDownloadBackend(downloadBackendInput.value);
                syncAria2OptionsVisibility();
                if (backend === 'aria2') {
                    checkAria2Status({ useUnsavedPath: true });
                }
            });
        }

        syncAria2OptionsVisibility();

        if (this.normalizeDownloadBackend(tokens.download_backend) === 'aria2') {
            checkAria2Status({ useUnsavedPath: false });
        }

        if (civitaiSessionCheckBtn) {
            civitaiSessionCheckBtn.addEventListener('click', () => {
                checkCredential({
                    input: civitaiSessionInput,
                    button: civitaiSessionCheckBtn,
                    statusEl: civitaiSessionCheckStatus,
                    endpoint: '/model_resolver/civitai/session-token/check',
                    payloadKey: 'civitai_session_token',
                    missingText: 'Paste token first'
                });
            });
        }

        if (civitaiKeyCheckBtn) {
            civitaiKeyCheckBtn.addEventListener('click', () => {
                checkCredential({
                    input: civitaiInput,
                    button: civitaiKeyCheckBtn,
                    statusEl: civitaiKeyCheckStatus,
                    endpoint: '/model_resolver/civitai/api-key/check',
                    payloadKey: 'civitai_key',
                    missingText: 'Paste API key first'
                });
            });
        }

        if (hfTokenCheckBtn) {
            hfTokenCheckBtn.addEventListener('click', () => {
                checkCredential({
                    input: hfInput,
                    button: hfTokenCheckBtn,
                    statusEl: hfTokenCheckStatus,
                    endpoint: '/model_resolver/huggingface/token/check',
                    payloadKey: 'hf_token',
                    missingText: 'Paste token first'
                });
            });
        }

        if (braveKeyCheckBtn) {
            braveKeyCheckBtn.addEventListener('click', () => {
                checkCredential({
                    input: braveInput,
                    button: braveKeyCheckBtn,
                    statusEl: braveKeyCheckStatus,
                    endpoint: '/model_resolver/brave/api-key/check',
                    payloadKey: 'brave_search_api_key',
                    missingText: 'Paste API key first'
                });
            });
        }

        loadModelListStatus(false);
        loadBaseModelsStatus(false);
        loadHfIndexStatus();

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const civitaiCandidateLimitRaw = parseInt(civitaiLimitInput?.value || `${tokens.civitai_candidate_limit}`, 10);
                const civitaiCandidateLimit = Number.isFinite(civitaiCandidateLimitRaw)
                    ? Math.min(20, Math.max(1, civitaiCandidateLimitRaw))
                    : 5;

                // Collect source-enabled flags
                const sourceEnabled = {};
                if (sourceEnabledInputs.length && !sourceEnabledInputs.some(input => input.checked)) {
                    const localInput = sourceEnabledInputs.find(input => input.dataset.source === 'local');
                    if (localInput) localInput.checked = true;
                }
                sourceEnabledInputs.forEach((input) => {
                    const key = input.dataset.storageKey;
                    if (key) {
                        sourceEnabled[key] = input.checked;
                    }
                });
                const downloadPathTemplates = {};
                pathTemplateCategories.forEach(category => {
                    downloadPathTemplates[category.key] = this.normalizeDownloadPathTemplate(
                        getTemplateInputValue(category.key)
                    );
                });
                const baseModelPathMappings = collectBaseModelPathMappings();
                const downloadBackend = this.normalizeDownloadBackend(downloadBackendInput?.value || tokens.download_backend);
                const downloadPathMode = this.normalizeDownloadPathMode(downloadPathModeInput?.value || tokens.download_path_mode);
                const defaultRootSettings = {};
                defaultRootSelectInputs.forEach((select) => {
                    const settingKey = select.dataset.settingKey;
                    if (settingKey) {
                        defaultRootSettings[settingKey] = select.value || '';
                    }
                });

                const newSettings = {
                    civitai_key:                 civitaiInput?.value || '',
                    civitai_session_token:        civitaiSessionInput?.value || '',
                    civitai_use_trpc_search:      Boolean(civitaiUseTrpcSearchInput?.checked),
                    civitai_use_html_fallback:    Boolean(civitaiUseHtmlFallbackInput?.checked),
                    civitai_candidate_limit:      civitaiCandidateLimit,
                    hf_token:                     hfInput?.value || '',
                    hf_use_api_search:            Boolean(hfUseApiSearchInput?.checked),
                    hf_use_comfy_org_fallback:    Boolean(hfUseComfyOrgFallbackInput?.checked),
                    hf_use_brave_fallback:        Boolean(hfUseBraveFallbackInput?.checked),
                    auto_fill_base_model:          Boolean(autoFillBaseModelInput?.checked),
                    auto_fill_subfolder:           Boolean(autoFillSubfolderInput?.checked),
                    auto_refresh_comfy_models_after_apply: Boolean(autoRefreshComfyModelsInput?.checked),
                    download_backend:              downloadBackend,
                    aria2c_path:                    aria2cPathInput?.value?.trim() || '',
                    download_path_mode:            downloadPathMode,
                    download_path_templates:       downloadPathTemplates,
                    base_model_path_mappings:      baseModelPathMappings,
                    ...defaultRootSettings,
                    frontend_logs_enabled:         Boolean(frontendLogsEnabledInput?.checked),
                    backend_logs_enabled:          Boolean(backendLogsEnabledInput?.checked),
                    frontend_log_level:            normalizeLogLevel(frontendLogLevelInput?.value || tokens.frontend_log_level),
                    backend_log_level:             normalizeLogLevel(backendLogLevelInput?.value || tokens.backend_log_level),
                    brave_search_api_key:         braveInput?.value || '',
                    search_source_enabled:        sourceEnabled,
                };

                // 1. Write to localStorage (fast local cache)
                localStorage.setItem('ModelResolver.civitaiApiKey',          newSettings.civitai_key);
                localStorage.setItem('ModelResolver.civitaiSessionToken',    newSettings.civitai_session_token);
                localStorage.setItem('ModelResolver.civitaiUseTrpcSearch',   newSettings.civitai_use_trpc_search ? 'true' : 'false');
                localStorage.setItem('ModelResolver.civitaiUseHtmlFallback', newSettings.civitai_use_html_fallback ? 'true' : 'false');
                localStorage.setItem('ModelResolver.huggingFaceToken',       newSettings.hf_token);
                localStorage.setItem('ModelResolver.braveSearchApiKey',      newSettings.brave_search_api_key);
                localStorage.setItem('ModelResolver.hfUseApiSearch',         newSettings.hf_use_api_search ? 'true' : 'false');
                localStorage.setItem('ModelResolver.hfUseComfyOrgFallback',  newSettings.hf_use_comfy_org_fallback ? 'true' : 'false');
                localStorage.setItem('ModelResolver.hfUseBraveFallback',     newSettings.hf_use_brave_fallback ? 'true' : 'false');
                localStorage.setItem('ModelResolver.autoFillBaseModel',      newSettings.auto_fill_base_model ? 'true' : 'false');
                localStorage.setItem('ModelResolver.autoFillSubfolder',      newSettings.auto_fill_subfolder ? 'true' : 'false');
                localStorage.setItem('ModelResolver.autoRefreshComfyModelsAfterApply', newSettings.auto_refresh_comfy_models_after_apply ? 'true' : 'false');
                localStorage.setItem('ModelResolver.downloadBackend',        newSettings.download_backend);
                localStorage.setItem('ModelResolver.aria2cPath',             newSettings.aria2c_path);
                localStorage.setItem('ModelResolver.downloadPathMode',       newSettings.download_path_mode);
                localStorage.setItem('ModelResolver.downloadPathTemplates',  JSON.stringify(newSettings.download_path_templates));
                localStorage.setItem('ModelResolver.baseModelPathMappings',  JSON.stringify(newSettings.base_model_path_mappings));
                defaultRootSelectInputs.forEach((select) => {
                    const storageKey = select.dataset.storageKey;
                    if (storageKey) {
                        localStorage.setItem(storageKey, select.value || '');
                    }
                });
                localStorage.setItem('ModelResolver.frontendLogsEnabled',    newSettings.frontend_logs_enabled ? 'true' : 'false');
                localStorage.setItem('ModelResolver.backendLogsEnabled',     newSettings.backend_logs_enabled ? 'true' : 'false');
                localStorage.setItem('ModelResolver.frontendLogLevel',       newSettings.frontend_log_level);
                localStorage.setItem('ModelResolver.backendLogLevel',        newSettings.backend_log_level);
                localStorage.setItem('ModelResolver.civitaiCandidateLimit',  `${civitaiCandidateLimit}`);
                Object.entries(sourceEnabled).forEach(([key, val]) => {
                    localStorage.setItem(key, val ? 'true' : 'false');
                });
                if (civitaiLimitInput) civitaiLimitInput.value = `${civitaiCandidateLimit}`;
                this.applyFrontendLoggingPreference(newSettings.frontend_logs_enabled, newSettings.frontend_log_level);

                // 2. Persist to server (survives new browsers / profiles)
                try {
                    setStatus('Saving…', '');
                    await this.fetchJson('/model_resolver/settings', {
                        method: 'POST',
                        body: JSON.stringify(newSettings)
                    }, 'Save settings');
                    setStatus('Saved on this machine (all browsers).', 'is-saved');
                    this.showNotification('Options saved', 'success');
                } catch (err) {
                    console.warn('Model Resolver: could not save settings to server, kept locally only.', err);
                    setStatus('Saved locally only (server write failed).', 'is-saved');
                    this.showNotification('Options saved locally only', 'warning');
                }

                this.downloadRootDirectories = null;
                this.downloadSubfolders?.clear();
                await this.clearSearchCaches();
            });
        }

    },

    normalizeDownloadBackend(value = '') {
        const backend = String(value || '').trim().toLowerCase();
        return backend === 'aria2' ? 'aria2' : 'python';
    },

    getStoredTokens() {
        const civitaiCandidateLimitRaw = parseInt(localStorage.getItem('ModelResolver.civitaiCandidateLimit') || '5', 10);
        const civitai_candidate_limit = Number.isFinite(civitaiCandidateLimitRaw)
            ? Math.min(20, Math.max(1, civitaiCandidateLimitRaw))
            : 5;
        const search_source_enabled = this.getSearchSourceEnabledMap();
        const storedFrontendLogsEnabled = localStorage.getItem('ModelResolver.frontendLogsEnabled');
        const storedBackendLogsEnabled = localStorage.getItem('ModelResolver.backendLogsEnabled');
        const storedFrontendLogLevel = localStorage.getItem('ModelResolver.frontendLogLevel');
        const storedBackendLogLevel = localStorage.getItem('ModelResolver.backendLogLevel');

        return {
            civitai_key: localStorage.getItem('ModelResolver.civitaiApiKey') || '',
            civitai_session_token: localStorage.getItem('ModelResolver.civitaiSessionToken') || '',
            hf_token: localStorage.getItem('ModelResolver.huggingFaceToken') || '',
            brave_search_api_key: localStorage.getItem('ModelResolver.braveSearchApiKey') || '',
            civitai_use_trpc_search: localStorage.getItem('ModelResolver.civitaiUseTrpcSearch') !== 'false',
            civitai_use_html_fallback: localStorage.getItem('ModelResolver.civitaiUseHtmlFallback') !== 'false',
            hf_use_api_search: localStorage.getItem('ModelResolver.hfUseApiSearch') !== 'false',
            hf_use_comfy_org_fallback: localStorage.getItem('ModelResolver.hfUseComfyOrgFallback') !== 'false',
            hf_use_brave_fallback: localStorage.getItem('ModelResolver.hfUseBraveFallback') !== 'false',
            auto_fill_base_model: localStorage.getItem('ModelResolver.autoFillBaseModel') !== 'false',
            auto_fill_subfolder: localStorage.getItem('ModelResolver.autoFillSubfolder') !== 'false',
            auto_refresh_comfy_models_after_apply: localStorage.getItem('ModelResolver.autoRefreshComfyModelsAfterApply') !== 'false',
            frontend_logs_enabled: storedFrontendLogsEnabled === null
                ? frontendLogger.enabled !== false
                : storedFrontendLogsEnabled !== 'false',
            backend_logs_enabled: storedBackendLogsEnabled === null
                ? true
                : storedBackendLogsEnabled !== 'false',
            frontend_log_level: storedFrontendLogLevel || DEFAULT_FRONTEND_LOG_LEVEL,
            backend_log_level: storedBackendLogLevel || 'DEBUG',
            civitai_candidate_limit,
            search_source_enabled,
            download_backend: this.normalizeDownloadBackend(localStorage.getItem('ModelResolver.downloadBackend') || 'python'),
            aria2c_path: localStorage.getItem('ModelResolver.aria2cPath') || '',
            download_path_mode: this.getDownloadPathMode(),
            download_path_templates: this.getDownloadPathTemplates(),
            base_model_path_mappings: this.getBaseModelPathMappings(),
            ...this.getDefaultRootSettings()
        };
    },

    applyFrontendLoggingPreference(enabled = true, levelName = 'DEBUG') {
        frontendLogger.setEnabled(Boolean(enabled));
        frontendLogger.setGlobalAndModuleLevel(frontendLogger.normalizeLevel(levelName));
    },

    /**
     * Fetch settings saved on the server and sync them into localStorage.
     * Call this once when the dialog initialises so every browser gets the
     * same tokens without the user having to re-enter them.
     */
    async loadSettingsFromServer() {
        try {
            const data = await this.fetchJson('/model_resolver/settings', { silent: true }, 'Load settings from server');
            if (!data || typeof data !== 'object') {
                const tokens = this.getStoredTokens();
                this.applyFrontendLoggingPreference(tokens.frontend_logs_enabled, tokens.frontend_log_level);
                return;
            }

            // Helper: write to localStorage only when the value from server is
            // non-empty, so we don't overwrite a key the user already has locally.
            const sync = (localKey, serverValue) => {
                if (serverValue !== undefined && serverValue !== null && serverValue !== '') {
                    localStorage.setItem(localKey, serverValue);
                }
            };

            sync('ModelResolver.civitaiApiKey',          data.civitai_key);
            sync('ModelResolver.civitaiSessionToken',    data.civitai_session_token);
            sync('ModelResolver.huggingFaceToken',       data.hf_token);
            sync('ModelResolver.braveSearchApiKey',      data.brave_search_api_key);

            if (data.civitai_use_trpc_search !== undefined)
                localStorage.setItem('ModelResolver.civitaiUseTrpcSearch',   data.civitai_use_trpc_search ? 'true' : 'false');
            if (data.civitai_use_html_fallback !== undefined)
                localStorage.setItem('ModelResolver.civitaiUseHtmlFallback', data.civitai_use_html_fallback ? 'true' : 'false');
            if (data.hf_use_api_search !== undefined)
                localStorage.setItem('ModelResolver.hfUseApiSearch',         data.hf_use_api_search ? 'true' : 'false');
            if (data.hf_use_comfy_org_fallback !== undefined)
                localStorage.setItem('ModelResolver.hfUseComfyOrgFallback',  data.hf_use_comfy_org_fallback ? 'true' : 'false');
            if (data.hf_use_brave_fallback !== undefined)
                localStorage.setItem('ModelResolver.hfUseBraveFallback',     data.hf_use_brave_fallback ? 'true' : 'false');
            if (data.auto_fill_base_model !== undefined)
                localStorage.setItem('ModelResolver.autoFillBaseModel',      data.auto_fill_base_model ? 'true' : 'false');
            if (data.auto_fill_subfolder !== undefined)
                localStorage.setItem('ModelResolver.autoFillSubfolder',      data.auto_fill_subfolder ? 'true' : 'false');
            if (data.auto_refresh_comfy_models_after_apply !== undefined)
                localStorage.setItem('ModelResolver.autoRefreshComfyModelsAfterApply', data.auto_refresh_comfy_models_after_apply ? 'true' : 'false');
            if (data.download_backend !== undefined)
                localStorage.setItem('ModelResolver.downloadBackend',        this.normalizeDownloadBackend(data.download_backend));
            if (data.aria2c_path !== undefined)
                localStorage.setItem('ModelResolver.aria2cPath',             String(data.aria2c_path || ''));
            if (data.download_path_mode !== undefined)
                localStorage.setItem('ModelResolver.downloadPathMode',       this.normalizeDownloadPathMode(data.download_path_mode));
            if (data.download_path_templates !== undefined)
                localStorage.setItem('ModelResolver.downloadPathTemplates',  JSON.stringify(data.download_path_templates || {}));
            if (data.base_model_path_mappings !== undefined)
                localStorage.setItem('ModelResolver.baseModelPathMappings',  JSON.stringify(data.base_model_path_mappings || {}));
            this.getDefaultRootCategoryDefinitions().forEach((item) => {
                if (data[item.settingKey] !== undefined) {
                    localStorage.setItem(item.storageKey, String(data[item.settingKey] || ''));
                }
            });
            if (data.civitai_candidate_limit !== undefined)
                localStorage.setItem('ModelResolver.civitaiCandidateLimit',  `${data.civitai_candidate_limit}`);
            if (data.frontend_logs_enabled !== undefined)
                localStorage.setItem('ModelResolver.frontendLogsEnabled',    data.frontend_logs_enabled ? 'true' : 'false');
            if (data.backend_logs_enabled !== undefined)
                localStorage.setItem('ModelResolver.backendLogsEnabled',     data.backend_logs_enabled ? 'true' : 'false');
            if (data.frontend_log_level !== undefined)
                localStorage.setItem('ModelResolver.frontendLogLevel',       String(data.frontend_log_level || 'DEBUG').toUpperCase());
            if (data.backend_log_level !== undefined)
                localStorage.setItem('ModelResolver.backendLogLevel',        String(data.backend_log_level || 'DEBUG').toUpperCase());

            // Source-enabled flags stored as a nested object
            if (data.search_source_enabled && typeof data.search_source_enabled === 'object') {
                Object.entries(data.search_source_enabled).forEach(([key, val]) => {
                    if (key) localStorage.setItem(key, val ? 'true' : 'false');
                });
            }
            const tokens = this.getStoredTokens();
            this.applyFrontendLoggingPreference(tokens.frontend_logs_enabled, tokens.frontend_log_level);
        } catch (err) {
            console.warn('Model Resolver: could not load settings from server, using localStorage only.', err);
            const tokens = this.getStoredTokens();
            this.applyFrontendLoggingPreference(tokens.frontend_logs_enabled, tokens.frontend_log_level);
        }
    }
};
