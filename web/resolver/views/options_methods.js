import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
import { LOG_LEVEL as DEFAULT_FRONTEND_LOG_LEVEL } from "../../log_system/config.js";
import { logger as frontendLogger } from "../../log_system/logger.js";
const SETTINGS_MAP = [
    { serverKey: 'civitai_key', localKey: 'ModelResolver.civitaiApiKey', type: 'string', default: '' },
    { serverKey: 'civitai_session_token', localKey: 'ModelResolver.civitaiSessionToken', type: 'string', default: '' },
    { serverKey: 'civitai_use_trpc_search', localKey: 'ModelResolver.civitaiUseTrpcSearch', type: 'boolean', default: true },
    { serverKey: 'civitai_use_api_search', localKey: 'ModelResolver.civitaiUseApiSearch', type: 'boolean', default: true },
    { serverKey: 'civitai_use_html_fallback', localKey: 'ModelResolver.civitaiUseHtmlFallback', type: 'boolean', default: true },
    { serverKey: 'hf_token', localKey: 'ModelResolver.huggingFaceToken', type: 'string', default: '' },
    { serverKey: 'brave_search_api_key', localKey: 'ModelResolver.braveSearchApiKey', type: 'string', default: '' },
    { serverKey: 'hf_use_api_search', localKey: 'ModelResolver.hfUseApiSearch', type: 'boolean', default: true },
    { serverKey: 'hf_use_comfy_org_fallback', localKey: 'ModelResolver.hfUseComfyOrgFallback', type: 'boolean', default: true },
    { serverKey: 'hf_use_brave_fallback', localKey: 'ModelResolver.hfUseBraveFallback', type: 'boolean', default: true },
    { serverKey: 'auto_fill_base_model', localKey: 'ModelResolver.autoFillBaseModel', type: 'boolean', default: true },
    { serverKey: 'auto_fill_subfolder', localKey: 'ModelResolver.autoFillSubfolder', type: 'boolean', default: true },
    { serverKey: 'auto_refresh_comfy_models_after_apply', localKey: 'ModelResolver.autoRefreshComfyModelsAfterApply', type: 'boolean', default: true },
    { serverKey: 'download_backend', localKey: 'ModelResolver.downloadBackend', type: 'backend', default: 'python' },
    { serverKey: 'aria2c_path', localKey: 'ModelResolver.aria2cPath', type: 'string', default: '' },
    { serverKey: 'aria2_auto_stop_daemon', localKey: 'ModelResolver.aria2AutoStopDaemon', type: 'boolean', default: true },
    { serverKey: 'download_path_mode', localKey: 'ModelResolver.downloadPathMode', type: 'pathMode', default: 'suggested' },
    { serverKey: 'download_path_templates', localKey: 'ModelResolver.downloadPathTemplates', type: 'json', default: {} },
    { serverKey: 'base_model_path_mappings', localKey: 'ModelResolver.baseModelPathMappings', type: 'json', default: {} },
    { serverKey: 'frontend_logs_enabled', localKey: 'ModelResolver.frontendLogsEnabled', type: 'frontendLogsEnabled', default: true },
    { serverKey: 'backend_logs_enabled', localKey: 'ModelResolver.backendLogsEnabled', type: 'backendLogsEnabled', default: true },
    { serverKey: 'frontend_log_level', localKey: 'ModelResolver.frontendLogLevel', type: 'string', default: 'DEBUG' },
    { serverKey: 'backend_log_level', localKey: 'ModelResolver.backendLogLevel', type: 'string', default: 'DEBUG' },
    { serverKey: 'civitai_candidate_limit', localKey: 'ModelResolver.civitaiCandidateLimit', type: 'candidateLimit', default: 5 },
];

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
        const logLevelValues = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'NONE'];
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
                            <div class="mr-options-sidebar-label">Tools</div>
                            <div class="mr-options-nav">
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-metadata-audit">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon" aria-hidden="true">${getSvgIcon('hardDrive')}</span>
                                        <span>Metadata Sizes</span>
                                    </span>
                                    <span class="mr-options-nav-meta">07</span>
                                </button>
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-metadata-build">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon" aria-hidden="true">${getSvgIcon('fileText')}</span>
                                        <span>Create Metadata</span>
                                    </span>
                                    <span class="mr-options-nav-meta">08</span>
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
                                    <span class="mr-options-nav-meta">09</span>
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
                                            <div class="mr-options-db-summary mr-options-aria2-summary">
                                                <div class="mr-options-db-row">
                                                    <span>Backend</span>
                                                    <strong id="mr-options-aria2-backend-state">aria2</strong>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span>Status</span>
                                                    <strong id="mr-options-aria2-availability">Not checked</strong>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span>Daemon</span>
                                                    <span class="mr-options-aria2-daemon-cell">
                                                        <button id="mr-options-aria2-stop" type="button" class="mr-btn mr-btn-secondary mr-btn-sm" hidden>Stop</button>
                                                        <strong id="mr-options-aria2-daemon">Not checked</strong>
                                                    </span>
                                                </div>
                                            </div>
                                            <label class="mr-options-toggle-row mr-options-compact-toggle-row">
                                                <div class="mr-options-toggle-copy">
                                                    <span class="mr-options-toggle-title">Auto-stop daemon after 5 minutes idle <span class="mr-tooltip-badge" data-tooltip="When enabled, Model Resolver stops only the aria2 daemon it started itself after 5 minutes without active downloads. It will not stop external aria2 processes.">?</span></span>
                                                </div>
                                                <span class="mr-options-toggle-control">
                                                    <input id="mr-options-aria2-auto-stop" class="mr-options-switch-input" type="checkbox" ${tokens.aria2_auto_stop_daemon ? 'checked' : ''}>
                                                    <span class="mr-options-switch"></span>
                                                </span>
                                            </label>
                                            <div class="mr-options-db-actions">
                                                <button id="mr-options-aria2-install" type="button" class="mr-btn mr-btn-primary">${getSvgIcon('download')} Install aria2</button>
                                                <button id="mr-options-aria2-check" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('refreshCw')} Check aria2</button>
                                                <a class="mr-options-inline-link" href="https://github.com/Azornes/Comfyui-Model-Resolver/wiki/Aria2-Download-Backend" target="_blank" rel="noopener noreferrer">Setup guide</a>
                                            </div>
                                            <div id="mr-options-aria2-status" class="mr-options-db-message" hidden></div>
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
                                    <div class="mr-options-panel-title">Search Methods</div>
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
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Use CivitAI HTML fallback <span class="mr-tooltip-badge" data-tooltip="Backup CivitAI search. It mirrors the CivitAI web page more closely than the public API.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-civitai-use-html-fallback" class="mr-options-switch-input" type="checkbox" ${tokens.civitai_use_html_fallback ? 'checked' : ''}>
                                                <span class="mr-options-switch"></span>
                                            </span>
                                        </label>
                                        <label class="mr-options-toggle-row">
                                            <div class="mr-options-toggle-copy">
                                                <span class="mr-options-toggle-title">Use CivitAI API search <span class="mr-tooltip-badge" data-tooltip="Last fallback that searches CivitAI's public models API by name. It can help when tRPC and HTML search return no candidates.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-civitai-use-api-search" class="mr-options-switch-input" type="checkbox" ${tokens.civitai_use_api_search ? 'checked' : ''}>
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
                                <div class="mr-options-panel">
                                    <div class="mr-options-panel-title">Account Access</div>
                                    <div class="mr-options-toggle-list">
                                        <div class="mr-options-dependent-block">
                                            <div class="mr-options-field">
                                                <div class="mr-options-input-row">
                                                    <label for="mr-options-civitai" class="mr-options-label">CivitAI API Key <a href="https://civitai.com/user/account" target="_blank" rel="noopener noreferrer" class="mr-options-inline-link">Get key</a> <span class="mr-tooltip-badge" data-tooltip="Optional. Used by CivitAI API search, model details, and downloads that require your account.">?</span></label>
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
                                            <div class="mr-options-db-actions mr-options-export-actions">
                                                <button id="mr-options-export-frontend-logs" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('download')} Export Frontend Logs</button>
                                                <span id="mr-options-export-frontend-logs-status" class="mr-options-db-message mr-options-export-status">Ready to export frontend logs.</span>
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
                                            <div class="mr-options-db-actions mr-options-export-actions">
                                                <button id="mr-options-export-backend-logs" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('download')} Export Backend Logs</button>
                                                <span id="mr-options-export-backend-logs-status" class="mr-options-db-message mr-options-export-status">Ready to export backend logs.</span>
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
                        <section id="mr-options-section-metadata-audit" class="mr-options-card mr-options-section mr-options-section-fill is-hidden">
                            <div class="mr-options-section-head">
                                <button id="mr-options-metadata-size-collapse-toggle" type="button" class="mr-options-section-title mr-options-collapse-title" aria-expanded="true" aria-controls="mr-options-metadata-size-controls">
                                    <span>Metadata Size Audit</span>
                                    <span class="mr-options-collapse-chevron" aria-hidden="true">${getSvgIcon('chevronDown')}</span>
                                </button>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack mr-options-metadata-size-stack">
                                        <div id="mr-options-metadata-size-controls" class="mr-options-metadata-size-controls">
                                            <div class="mr-options-db-summary mr-options-metadata-size-summary">
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('search')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Models scanned</span><strong id="mr-options-metadata-size-scanned">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('fileCheck')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Metadata checked</span><strong id="mr-options-metadata-size-checked">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('scale')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Mismatches</span><strong id="mr-options-metadata-size-mismatches">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('fileQuestion')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Missing size</span><strong id="mr-options-metadata-size-missing">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('triangleAlert')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Errors</span><strong id="mr-options-metadata-size-errors">0</strong></span>
                                                </div>
                                            </div>
                                            <div class="mr-options-db-actions">
                                                <button id="mr-options-metadata-size-scan" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('refreshCw')} Check Metadata Sizes</button>
                                            </div>
                                            <div id="mr-options-metadata-size-status" class="mr-options-db-message">Not checked yet.</div>
                                        </div>
                                        <div id="mr-options-metadata-size-results" class="mr-options-audit-results" hidden></div>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section id="mr-options-section-metadata-build" class="mr-options-card mr-options-section mr-options-section-fill is-hidden">
                            <div class="mr-options-section-head">
                                <button id="mr-options-metadata-build-collapse-toggle" type="button" class="mr-options-section-title mr-options-collapse-title" aria-expanded="true" aria-controls="mr-options-metadata-build-controls">
                                    <span>Local Metadata Builder</span>
                                    <span class="mr-options-collapse-chevron" aria-hidden="true">${getSvgIcon('chevronDown')}</span>
                                </button>
                            </div>
                            <div class="mr-options-grid">
                                <div class="mr-options-panel">
                                    <div class="mr-options-stack mr-options-build-stack">
                                        <div id="mr-options-metadata-build-controls" class="mr-options-metadata-build-controls">
                                            <div class="mr-options-db-summary mr-options-metadata-build-summary">
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('cpu')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>CPU cores</span><strong id="mr-options-metadata-build-cpu">Detecting</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('users')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Workers</span><strong id="mr-options-metadata-build-workers">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('search')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Models scanned</span><strong id="mr-options-metadata-build-scanned">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('circlePlus')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Created</span><strong id="mr-options-metadata-build-created">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('pencil')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Updated</span><strong id="mr-options-metadata-build-updated">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('circleCheckBig')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Already complete</span><strong id="mr-options-metadata-build-skipped">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('hash')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Hashes calculated</span><strong id="mr-options-metadata-build-hashes">0</strong></span>
                                                </div>
                                                <div class="mr-options-db-row">
                                                    <span class="mr-options-overview-stat-icon" aria-hidden="true">${getSvgIcon('triangleAlert')}</span>
                                                    <span class="mr-options-overview-stat-copy"><span>Errors</span><strong id="mr-options-metadata-build-errors">0</strong></span>
                                                </div>
                                            </div>
                                            <div class="mr-options-number-row mr-options-wide-row">
                                                <div class="mr-options-number-copy">
                                                    <span class="mr-options-label">Concurrent hash workers</span>
                                                    <span id="mr-options-metadata-build-worker-hint" class="mr-options-db-message mr-options-inline-hint">Loading CPU details...</span>
                                                </div>
                                                <input id="mr-options-metadata-build-worker-count" class="mr-options-input" type="number" min="1" max="64" step="1" value="1">
                                            </div>
                                            <div class="mr-options-db-actions">
                                                <button id="mr-options-metadata-build-start" type="button" class="mr-btn mr-btn-secondary">${getSvgIcon('fileText')} Build Local Metadata</button>
                                                <button id="mr-options-metadata-build-cancel" type="button" class="mr-btn mr-btn-secondary" hidden>${getSvgIcon('x')} Cancel</button>
                                            </div>
                                            <div id="mr-options-metadata-build-status" class="mr-options-db-message">Not started yet.</div>
                                        </div>
                                        <div class="mr-tabs mr-options-build-tabs" role="tablist" aria-label="Metadata builder views">
                                            <button type="button" class="mr-tab mr-options-build-tab mr-tab-active is-active" data-build-tab="progress" role="tab" aria-selected="true">
                                                <span class="mr-tab-label">Progress</span>
                                            </button>
                                            <button type="button" class="mr-tab mr-options-build-tab" data-build-tab="history" role="tab" aria-selected="false">
                                                <span class="mr-tab-label">History</span>
                                                <span id="mr-options-metadata-build-history-count" class="mr-options-build-tab-count">0</span>
                                            </button>
                                        </div>
                                        <div id="mr-options-metadata-build-progress-panel" class="mr-options-build-tab-panel">
                                            <div id="mr-options-metadata-build-progress" class="mr-options-build-progress" hidden>
                                                <div class="mr-options-build-progress-head">
                                                    <span id="mr-options-metadata-build-stage">Idle</span>
                                                    <strong id="mr-options-metadata-build-percent">0%</strong>
                                                </div>
                                                <div class="mr-options-build-progress-bar" aria-hidden="true">
                                                    <span id="mr-options-metadata-build-bar"></span>
                                                </div>
                                                <div class="mr-options-build-current">
                                                    <span id="mr-options-metadata-build-current-model">No model selected.</span>
                                                    <code id="mr-options-metadata-build-current-path"></code>
                                                    <span id="mr-options-metadata-build-bytes"></span>
                                                </div>
                                                <div id="mr-options-metadata-build-worker-list" class="mr-options-build-worker-list"></div>
                                            </div>
                                        </div>
                                        <div id="mr-options-metadata-build-history-panel" class="mr-options-build-tab-panel is-hidden">
                                            <div id="mr-options-metadata-build-results" class="mr-options-audit-results" hidden></div>
                                        </div>
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
        const civitaiUseApiSearchInput = this.contentElement.querySelector('#mr-options-civitai-use-api-search');
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
        const aria2StopBtn = this.contentElement.querySelector('#mr-options-aria2-stop');
        const aria2StatusEl = this.contentElement.querySelector('#mr-options-aria2-status');
        const aria2BackendStateEl = this.contentElement.querySelector('#mr-options-aria2-backend-state');
        const aria2AvailabilityEl = this.contentElement.querySelector('#mr-options-aria2-availability');
        const aria2DaemonEl = this.contentElement.querySelector('#mr-options-aria2-daemon');
        const aria2AutoStopInput = this.contentElement.querySelector('#mr-options-aria2-auto-stop');
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
        const exportFrontendLogsBtn = this.contentElement.querySelector('#mr-options-export-frontend-logs');
        const exportBackendLogsBtn = this.contentElement.querySelector('#mr-options-export-backend-logs');
        const exportFrontendLogsStatus = this.contentElement.querySelector('#mr-options-export-frontend-logs-status');
        const exportBackendLogsStatus = this.contentElement.querySelector('#mr-options-export-backend-logs-status');
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
        const metadataSizeAuditBtn = this.contentElement.querySelector('#mr-options-metadata-size-scan');
        const metadataSizeAuditStatus = this.contentElement.querySelector('#mr-options-metadata-size-status');
        const metadataSizeAuditResults = this.contentElement.querySelector('#mr-options-metadata-size-results');
        const metadataSizeScannedEl = this.contentElement.querySelector('#mr-options-metadata-size-scanned');
        const metadataSizeCheckedEl = this.contentElement.querySelector('#mr-options-metadata-size-checked');
        const metadataSizeMismatchesEl = this.contentElement.querySelector('#mr-options-metadata-size-mismatches');
        const metadataSizeMissingEl = this.contentElement.querySelector('#mr-options-metadata-size-missing');
        const metadataSizeErrorsEl = this.contentElement.querySelector('#mr-options-metadata-size-errors');
        const metadataSizeCollapseToggle = this.contentElement.querySelector('#mr-options-metadata-size-collapse-toggle');
        const metadataSizeControls = this.contentElement.querySelector('#mr-options-metadata-size-controls');
        const metadataSizeStack = this.contentElement.querySelector('.mr-options-metadata-size-stack');
        const metadataBuildStartBtn = this.contentElement.querySelector('#mr-options-metadata-build-start');
        const metadataBuildCancelBtn = this.contentElement.querySelector('#mr-options-metadata-build-cancel');
        const metadataBuildStatus = this.contentElement.querySelector('#mr-options-metadata-build-status');
        const metadataBuildProgress = this.contentElement.querySelector('#mr-options-metadata-build-progress');
        const metadataBuildStageEl = this.contentElement.querySelector('#mr-options-metadata-build-stage');
        const metadataBuildPercentEl = this.contentElement.querySelector('#mr-options-metadata-build-percent');
        const metadataBuildBarEl = this.contentElement.querySelector('#mr-options-metadata-build-bar');
        const metadataBuildCurrentModelEl = this.contentElement.querySelector('#mr-options-metadata-build-current-model');
        const metadataBuildCurrentPathEl = this.contentElement.querySelector('#mr-options-metadata-build-current-path');
        const metadataBuildBytesEl = this.contentElement.querySelector('#mr-options-metadata-build-bytes');
        const metadataBuildWorkerListEl = this.contentElement.querySelector('#mr-options-metadata-build-worker-list');
        const metadataBuildResults = this.contentElement.querySelector('#mr-options-metadata-build-results');
        const metadataBuildTabButtons = Array.from(this.contentElement.querySelectorAll('.mr-options-build-tab'));
        const metadataBuildProgressPanel = this.contentElement.querySelector('#mr-options-metadata-build-progress-panel');
        const metadataBuildHistoryPanel = this.contentElement.querySelector('#mr-options-metadata-build-history-panel');
        const metadataBuildHistoryCountEl = this.contentElement.querySelector('#mr-options-metadata-build-history-count');
        const metadataBuildCpuEl = this.contentElement.querySelector('#mr-options-metadata-build-cpu');
        const metadataBuildWorkersEl = this.contentElement.querySelector('#mr-options-metadata-build-workers');
        const metadataBuildWorkerInput = this.contentElement.querySelector('#mr-options-metadata-build-worker-count');
        const metadataBuildWorkerHint = this.contentElement.querySelector('#mr-options-metadata-build-worker-hint');
        const metadataBuildScannedEl = this.contentElement.querySelector('#mr-options-metadata-build-scanned');
        const metadataBuildCreatedEl = this.contentElement.querySelector('#mr-options-metadata-build-created');
        const metadataBuildUpdatedEl = this.contentElement.querySelector('#mr-options-metadata-build-updated');
        const metadataBuildSkippedEl = this.contentElement.querySelector('#mr-options-metadata-build-skipped');
        const metadataBuildHashesEl = this.contentElement.querySelector('#mr-options-metadata-build-hashes');
        const metadataBuildErrorsEl = this.contentElement.querySelector('#mr-options-metadata-build-errors');
        const metadataBuildCollapseToggle = this.contentElement.querySelector('#mr-options-metadata-build-collapse-toggle');
        const metadataBuildControls = this.contentElement.querySelector('#mr-options-metadata-build-controls');
        const metadataBuildStack = this.contentElement.querySelector('.mr-options-build-stack');
        const optionsMain = this.contentElement.querySelector('.mr-options-main');
        const navButtons = Array.from(this.contentElement.querySelectorAll('.mr-options-nav-btn'));
        const optionSections = Array.from(this.contentElement.querySelectorAll('.mr-options-section'));
        const metadataBuildHistoryFilterValues = ['all', 'done', 'created', 'updated', 'skipped', 'checked', 'error', 'cancelled'];
        if (!metadataBuildHistoryFilterValues.includes(this.metadataBuildHistoryFilter)) {
            this.metadataBuildHistoryFilter = 'all';
        }
        this.metadataBuildHistoryFilterMenuOpen = false;
        const metadataBuildHistoryPageSize = 250;
        if (!Number.isFinite(Number(this.metadataBuildHistoryVisibleLimit)) || Number(this.metadataBuildHistoryVisibleLimit) < metadataBuildHistoryPageSize) {
            this.metadataBuildHistoryVisibleLimit = metadataBuildHistoryPageSize;
        }
        if (this.metadataBuildPollTimer) {
            window.clearTimeout(this.metadataBuildPollTimer);
            this.metadataBuildPollTimer = null;
        }
        const trackedInputs = [
            civitaiInput,
            civitaiSessionInput,
            hfInput,
            braveInput,
            civitaiLimitInput,
            civitaiUseTrpcSearchInput,
            civitaiUseApiSearchInput,
            civitaiUseHtmlFallbackInput,
            hfUseApiSearchInput,
            hfUseComfyOrgFallbackInput,
            hfUseBraveFallbackInput,
            autoFillBaseModelInput,
            autoFillSubfolderInput,
            autoRefreshComfyModelsInput,
            downloadBackendInput,
            aria2cPathInput,
            aria2AutoStopInput,
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

        const setExportLogsStatus = (statusEl, text) => {
            if (statusEl) statusEl.textContent = text;
        };

        const parseDownloadFilename = (header, fallback) => {
            const value = String(header || '');
            const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
            if (utf8Match?.[1]) {
                try {
                    return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
                } catch (error) {
                    return utf8Match[1].trim().replace(/^"|"$/g, '') || fallback;
                }
            }
            const match = value.match(/filename="?([^";]+)"?/i);
            return match?.[1]?.trim() || fallback;
        };

        const downloadBlob = (blob, filename) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        };

        const exportFrontendLogs = () => {
            try {
                if (exportFrontendLogsBtn) exportFrontendLogsBtn.disabled = true;
                const exported = frontendLogger.exportLogs('txt');
                if (!exported) {
                    setExportLogsStatus(exportFrontendLogsStatus, 'No frontend logs captured yet.');
                    this.showNotification('No frontend logs to export', 'warning');
                    return;
                }
                setExportLogsStatus(exportFrontendLogsStatus, 'Frontend logs exported.');
                this.showNotification('Frontend logs exported', 'success');
            } catch (error) {
                console.error('Model Resolver: frontend log export failed:', error);
                setExportLogsStatus(exportFrontendLogsStatus, error.message || 'Frontend log export failed.');
                this.showNotification('Frontend log export failed', 'error');
            } finally {
                if (exportFrontendLogsBtn) exportFrontendLogsBtn.disabled = false;
            }
        };

        const exportBackendLogs = async () => {
            try {
                if (exportBackendLogsBtn) exportBackendLogsBtn.disabled = true;
                setExportLogsStatus(exportBackendLogsStatus, 'Preparing backend logs...');
                const response = await this.fetchJson(
                    '/model_resolver/logs/backend/export',
                    { raw: true },
                    'Export backend logs'
                );
                const blob = await response.blob();
                const filename = parseDownloadFilename(
                    response.headers.get('Content-Disposition'),
                    `model_resolver_backend_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
                );
                downloadBlob(blob, filename);
                setExportLogsStatus(exportBackendLogsStatus, 'Backend logs exported.');
                this.showNotification('Backend logs exported', 'success');
            } catch (error) {
                setExportLogsStatus(exportBackendLogsStatus, error.message || 'Backend log export failed.');
            } finally {
                if (exportBackendLogsBtn) exportBackendLogsBtn.disabled = false;
            }
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

        const setMetadataSizeAuditBusy = (busy) => {
            if (metadataSizeAuditBtn) metadataSizeAuditBtn.disabled = busy;
        };

        const setStatusMode = (element, mode = '') => {
            if (!element) return;
            element.classList.remove('is-valid', 'is-invalid', 'is-pending');
            if (mode) element.classList.add(mode);
        };

        const formatAuditNumber = (value) => {
            const number = Number(value || 0);
            return Number.isFinite(number) ? number.toLocaleString() : '0';
        };

        const setMetadataSizeAuditStatus = (text, mode = '') => {
            if (!metadataSizeAuditStatus) return;
            metadataSizeAuditStatus.textContent = text;
            setStatusMode(metadataSizeAuditStatus, mode);
        };

        const setMetadataSizeSummaryValue = (element, value, mode = '') => {
            if (!element) return;
            element.textContent = formatAuditNumber(value);
            setStatusMode(element, mode);
        };

        const setMetadataSizeControlsCollapsed = (collapsed, persist = true) => {
            const isCollapsed = Boolean(collapsed);
            this.metadataSizeControlsCollapsed = isCollapsed;
            if (metadataSizeControls) {
                metadataSizeControls.hidden = isCollapsed;
            }
            if (metadataSizeStack) {
                metadataSizeStack.classList.toggle('is-controls-collapsed', isCollapsed);
            }
            if (metadataSizeCollapseToggle) {
                metadataSizeCollapseToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
                this.setTooltip?.(
                    metadataSizeCollapseToggle,
                    isCollapsed ? 'Show metadata size audit controls' : 'Hide metadata size audit controls'
                );
            }
            if (persist) {
                try {
                    localStorage.setItem(
                        this.metadataSizeControlsCollapsedStorageKey || 'model_resolver_metadata_size_controls_collapsed',
                        isCollapsed ? '1' : '0'
                    );
                } catch (error) {
                    console.warn('Model Resolver: could not save metadata size audit collapse state:', error);
                }
            }
        };

        if (!this.metadataSizeControlsCollapsedStorageKey) {
            this.metadataSizeControlsCollapsedStorageKey = 'model_resolver_metadata_size_controls_collapsed';
        }
        if (typeof this.metadataSizeControlsCollapsed !== 'boolean') {
            try {
                this.metadataSizeControlsCollapsed = localStorage.getItem(this.metadataSizeControlsCollapsedStorageKey) === '1';
            } catch (error) {
                this.metadataSizeControlsCollapsed = false;
            }
        }
        setMetadataSizeControlsCollapsed(this.metadataSizeControlsCollapsed, false);

        const updateMetadataSizeAuditSummary = (data = {}) => {
            const mismatchCount = Number(data.mismatch_count || 0);
            const missingSizeCount = Number(data.missing_size || 0);
            const errorCount = Number(data.error_count || 0);
            setMetadataSizeSummaryValue(metadataSizeScannedEl, data.scanned_models || 0);
            setMetadataSizeSummaryValue(metadataSizeCheckedEl, data.metadata_files ?? data.checked_metadata ?? 0);
            setMetadataSizeSummaryValue(metadataSizeMismatchesEl, mismatchCount, mismatchCount > 0 ? 'is-invalid' : '');
            setMetadataSizeSummaryValue(metadataSizeMissingEl, missingSizeCount, missingSizeCount > 0 ? 'is-pending' : '');
            setMetadataSizeSummaryValue(metadataSizeErrorsEl, errorCount, errorCount > 0 ? 'is-invalid' : '');
        };

        const renderMetadataSizeAuditResults = (data = null) => {
            if (!metadataSizeAuditResults) return;
            if (!data) {
                metadataSizeAuditResults.hidden = true;
                metadataSizeAuditResults.innerHTML = '';
                return;
            }

            const mismatches = Array.isArray(data.mismatches) ? data.mismatches : [];
            const errors = Array.isArray(data.errors) ? data.errors : [];
            const visibleMismatches = mismatches.slice(0, 500);
            let html = '';

            if (mismatches.length) {
                const rows = visibleMismatches.map((item) => {
                    const modelLabel = item.relative_path || item.filename || item.model_path || 'Model';
                    const modelPath = item.model_path || '';
                    const metadataPath = item.metadata_path || '';
                    const metadataSize = item.metadata_size_label || this.formatBytes(item.metadata_size);
                    const actualSize = item.actual_size_label || this.formatBytes(item.actual_size);
                    const difference = Number(item.difference || 0);
                    const differenceClass = difference > 0 ? 'is-positive' : (difference < 0 ? 'is-negative' : '');
                    const differenceLabel = item.difference_label || `${difference >= 0 ? '+' : '-'}${this.formatBytes(Math.abs(difference))}`;
                    const sizeField = item.size_field || 'size';
                    const auditContext = modelPath ? {
                        context_scope: 'local_model',
                        open_folder_label: 'Show File in Folder',
                        name: item.filename || modelLabel,
                        filename: item.filename || modelLabel,
                        relative_path: item.relative_path || modelLabel,
                        path: modelPath,
                        resolved_path: modelPath,
                        open_path: modelPath,
                        folder_path: item.base_directory || '',
                        category: item.category || '',
                        metadata_path: metadataPath,
                        size: item.actual_size || 0,
                        file_size: item.actual_size || 0,
                        metadata_size: item.metadata_size || 0,
                        context_source: 'metadata_size_audit'
                    } : null;
                    const contextAttrs = auditContext
                        ? this.getContextMenuAttrs(auditContext, 'Right-click for model options')
                        : '';
                    return `
                        <tr class="mr-options-audit-row ${contextAttrs ? 'is-context-menu' : ''}"${contextAttrs}>
                            <td>
                                <div class="mr-options-audit-model">${this.escapeHtml(modelLabel)}</div>
                                <div class="mr-options-audit-path" title="${this.escapeHtml(modelPath)}">${this.escapeHtml(modelPath)}</div>
                            </td>
                            <td>${this.escapeHtml(item.category || '')}</td>
                            <td>
                                <div>${this.escapeHtml(metadataSize)}</div>
                                <div class="mr-options-audit-path">${this.escapeHtml(sizeField)}</div>
                            </td>
                            <td>${this.escapeHtml(actualSize)}</td>
                            <td class="mr-options-audit-delta ${differenceClass}">${this.escapeHtml(differenceLabel)}</td>
                            <td>
                                <div class="mr-options-audit-path" title="${this.escapeHtml(metadataPath)}">${this.escapeHtml(metadataPath)}</div>
                            </td>
                        </tr>
                    `;
                }).join('');
                html += `
                    <div class="mr-options-audit-table-wrap">
                        <table class="mr-options-audit-table">
                            <thead>
                                <tr>
                                    <th>Model</th>
                                    <th>Folder</th>
                                    <th>Metadata</th>
                                    <th>Actual</th>
                                    <th>Delta</th>
                                    <th>Metadata file</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
                if (mismatches.length > visibleMismatches.length) {
                    html += `<div class="mr-options-db-message">Showing first ${visibleMismatches.length.toLocaleString()} of ${mismatches.length.toLocaleString()} mismatches.</div>`;
                }
            } else {
                html += '<div class="mr-options-audit-empty">No metadata size mismatches found.</div>';
            }

            if (errors.length) {
                const errorRows = errors.slice(0, 10).map((item) => {
                    const targetPath = item.metadata_path || item.model_path || '';
                    return `<li><span>${this.escapeHtml(item.message || 'Error')}</span><code>${this.escapeHtml(targetPath)}</code></li>`;
                }).join('');
                html += `
                    <div class="mr-options-audit-errors">
                        <div class="mr-options-audit-errors-title">Read errors</div>
                        <ul>${errorRows}</ul>
                    </div>
                `;
            }

            metadataSizeAuditResults.innerHTML = html;
            metadataSizeAuditResults.hidden = false;
        };

        const runMetadataSizeAudit = async () => {
            setMetadataSizeAuditBusy(true);
            updateMetadataSizeAuditSummary({});
            renderMetadataSizeAuditResults(null);
            setMetadataSizeAuditStatus('Checking metadata sizes...', 'is-pending');
            try {
                const data = await this.fetchJson('/model_resolver/metadata-size-audit', {
                    method: 'POST',
                    body: JSON.stringify({ force_rescan: true })
                }, 'Check metadata sizes');
                updateMetadataSizeAuditSummary(data);
                renderMetadataSizeAuditResults(data);

                const mismatchCount = Number(data?.mismatch_count || 0);
                const checkedCount = Number(data?.metadata_files ?? data?.checked_metadata ?? 0);
                const errorCount = Number(data?.error_count || 0);
                const workerCount = Number(data?.worker_count || 0);
                const batchCount = Number(data?.batch_count || 0);
                const workerText = workerCount > 1
                    ? ` using ${workerCount.toLocaleString()} workers across ${batchCount.toLocaleString()} batch${batchCount === 1 ? '' : 'es'}`
                    : '';
                if (mismatchCount > 0) {
                    setMetadataSizeAuditStatus(`${mismatchCount.toLocaleString()} metadata size mismatch${mismatchCount === 1 ? '' : 'es'} found${workerText}.`, 'is-invalid');
                    this.showNotification('Metadata size mismatches found', 'warning');
                } else if (errorCount > 0) {
                    setMetadataSizeAuditStatus(`Checked ${checkedCount.toLocaleString()} metadata file${checkedCount === 1 ? '' : 's'}${workerText} with ${errorCount.toLocaleString()} read error${errorCount === 1 ? '' : 's'}.`, 'is-invalid');
                    this.showNotification('Metadata size audit finished with errors', 'warning');
                } else {
                    setMetadataSizeAuditStatus(`Checked ${checkedCount.toLocaleString()} metadata file${checkedCount === 1 ? '' : 's'}${workerText}. No mismatches found.`, 'is-valid');
                    this.showNotification('Metadata sizes checked', 'success');
                }
            } catch (error) {
                setMetadataSizeAuditStatus(error.message || 'Metadata size audit failed.', 'is-invalid');
                renderMetadataSizeAuditResults(null);
            } finally {
                setMetadataSizeAuditBusy(false);
            }
        };

        const setMetadataBuildBusy = (busy) => {
            if (metadataBuildStartBtn) metadataBuildStartBtn.disabled = busy;
            if (metadataBuildCancelBtn) {
                metadataBuildCancelBtn.hidden = !busy;
                metadataBuildCancelBtn.disabled = false;
            }
        };

        const setMetadataBuildStatus = (text, mode = '') => {
            if (!metadataBuildStatus) return;
            metadataBuildStatus.textContent = text;
            setStatusMode(metadataBuildStatus, mode);
        };

        const setMetadataBuildSummaryValue = (element, value, mode = '') => {
            if (!element) return;
            element.textContent = formatAuditNumber(value);
            setStatusMode(element, mode);
        };

        const setMetadataBuildControlsCollapsed = (collapsed, persist = true) => {
            const isCollapsed = Boolean(collapsed);
            this.metadataBuildControlsCollapsed = isCollapsed;
            if (metadataBuildControls) {
                metadataBuildControls.hidden = isCollapsed;
            }
            if (metadataBuildStack) {
                metadataBuildStack.classList.toggle('is-controls-collapsed', isCollapsed);
            }
            if (metadataBuildCollapseToggle) {
                metadataBuildCollapseToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
                metadataBuildCollapseToggle.classList.toggle('is-collapsed', isCollapsed);
                this.setTooltip?.(
                    metadataBuildCollapseToggle,
                    isCollapsed ? 'Show metadata builder controls' : 'Hide metadata builder controls'
                );
            }
            if (persist) {
                try {
                    localStorage.setItem(
                        this.metadataBuildControlsCollapsedStorageKey || 'model_resolver_metadata_build_controls_collapsed',
                        isCollapsed ? '1' : '0'
                    );
                } catch (error) {
                    console.warn('Model Resolver: could not save metadata builder collapse state:', error);
                }
            }
        };

        if (!this.metadataBuildControlsCollapsedStorageKey) {
            this.metadataBuildControlsCollapsedStorageKey = 'model_resolver_metadata_build_controls_collapsed';
        }
        if (typeof this.metadataBuildControlsCollapsed !== 'boolean') {
            try {
                this.metadataBuildControlsCollapsed = localStorage.getItem(this.metadataBuildControlsCollapsedStorageKey) === '1';
            } catch (error) {
                this.metadataBuildControlsCollapsed = false;
            }
        }
        setMetadataBuildControlsCollapsed(this.metadataBuildControlsCollapsed, false);

        let scheduleMetadataBuildHistoryRender = () => {};
        const setMetadataBuildPanelHidden = (panel, hidden) => {
            if (!panel) return;
            panel.classList.toggle('is-hidden', hidden);
            panel.setAttribute('aria-hidden', hidden ? 'true' : 'false');
            try {
                panel.inert = hidden;
            } catch (error) {
                panel.toggleAttribute('inert', hidden);
            }
        };

        const setMetadataBuildTab = (tabName = 'progress') => {
            const activeTab = tabName === 'history' ? 'history' : 'progress';
            metadataBuildTabButtons.forEach((button) => {
                const isActive = button.dataset.buildTab === activeTab;
                button.classList.toggle('is-active', isActive);
                button.classList.toggle('mr-tab-active', isActive);
                button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            setMetadataBuildPanelHidden(metadataBuildProgressPanel, activeTab !== 'progress');
            setMetadataBuildPanelHidden(metadataBuildHistoryPanel, activeTab !== 'history');
            this.metadataBuildActiveTab = activeTab;
            if (activeTab === 'history') {
                scheduleMetadataBuildHistoryRender();
            }
        };

        const getMetadataBuildHistoryKey = (item = {}) => {
            const path = item.model_path || item.path || item.metadata_path || item.filename || '';
            const action = item.action || '';
            const sha = item.sha256 || '';
            return `${action}::${path}::${sha}`;
        };

        const appendMetadataBuildHistory = (data = {}) => {
            if (!this.metadataBuildHistory) this.metadataBuildHistory = [];
            if (!this.metadataBuildHistoryKeys) this.metadataBuildHistoryKeys = new Set();
            const source = data?.result && typeof data.result === 'object' ? data.result : data;
            const items = [];
            if (Array.isArray(data.history_items)) items.push(...data.history_items);
            if (Array.isArray(source.history)) items.push(...source.history);
            if (!items.length && Array.isArray(source.updated)) items.push(...source.updated);
            items.forEach((rawItem) => {
                if (!rawItem || typeof rawItem !== 'object') return;
                const item = { ...rawItem };
                const key = getMetadataBuildHistoryKey(item);
                if (!key || this.metadataBuildHistoryKeys.has(key)) return;
                this.metadataBuildHistoryKeys.add(key);
                this.metadataBuildHistory.unshift(item);
            });
            if (metadataBuildHistoryCountEl) {
                metadataBuildHistoryCountEl.textContent = this.metadataBuildHistory.length.toLocaleString();
            }
        };

        const getMetadataBuildWorkerBounds = () => {
            const capabilities = this.metadataBuildCapabilities || {};
            const min = Math.max(1, Number(capabilities.min_worker_count || 1));
            const max = Math.max(min, Number(capabilities.max_worker_count || 64));
            return { min, max };
        };

        const normalizeMetadataBuildWorkerCount = () => {
            const { min, max } = getMetadataBuildWorkerBounds();
            const fallback = Number(this.metadataBuildCapabilities?.default_worker_count || metadataBuildWorkerInput?.value || 1);
            const raw = Number(metadataBuildWorkerInput?.value || fallback || 1);
            const workerCount = Math.max(min, Math.min(max, Number.isFinite(raw) ? Math.round(raw) : fallback));
            if (metadataBuildWorkerInput) {
                metadataBuildWorkerInput.min = String(min);
                metadataBuildWorkerInput.max = String(max);
                metadataBuildWorkerInput.value = String(workerCount);
            }
            return workerCount;
        };

        const renderMetadataBuildCapabilities = (data = {}) => {
            this.metadataBuildCapabilities = data && typeof data === 'object' ? data : {};
            const cpuCount = Number(this.metadataBuildCapabilities.cpu_count || navigator.hardwareConcurrency || 1);
            const defaultWorkers = Number(this.metadataBuildCapabilities.default_worker_count || Math.min(cpuCount, 4) || 1);
            const maxWorkers = Number(this.metadataBuildCapabilities.max_worker_count || 64);
            if (metadataBuildCpuEl) metadataBuildCpuEl.textContent = cpuCount.toLocaleString();
            if (metadataBuildWorkerInput && !metadataBuildWorkerInput.dataset.userEdited) {
                metadataBuildWorkerInput.value = String(defaultWorkers);
            }
            normalizeMetadataBuildWorkerCount();
            if (metadataBuildWorkerHint) {
                metadataBuildWorkerHint.textContent = `CPU cores: ${cpuCount.toLocaleString()}. Max workers: ${maxWorkers.toLocaleString()}.`;
            }
            if (metadataBuildWorkersEl) metadataBuildWorkersEl.textContent = normalizeMetadataBuildWorkerCount().toLocaleString();
        };

        const loadMetadataBuildCapabilities = async () => {
            try {
                const data = await this.fetchJson(
                    '/model_resolver/metadata-build/capabilities',
                    { silent: true },
                    'Load metadata build capabilities'
                );
                renderMetadataBuildCapabilities(data);
            } catch (error) {
                renderMetadataBuildCapabilities({
                    cpu_count: navigator.hardwareConcurrency || 1,
                    default_worker_count: Math.min(navigator.hardwareConcurrency || 1, 4),
                    min_worker_count: 1,
                    max_worker_count: 64
                });
            }
        };

        const updateMetadataBuildSummary = (data = {}) => {
            const source = data?.result && typeof data.result === 'object' ? data.result : data;
            const created = Number(source.created_metadata || 0);
            const updated = Number(source.updated_metadata || 0);
            const calculatedHashes = Number(source.calculated_hashes || 0);
            const errorCount = Number(source.error_count || 0);
            if (metadataBuildCpuEl && source.cpu_count) {
                metadataBuildCpuEl.textContent = Number(source.cpu_count || 0).toLocaleString();
            }
            if (metadataBuildWorkersEl) {
                const activeWorkers = Number(source.active_worker_count ?? source.worker_count ?? normalizeMetadataBuildWorkerCount());
                metadataBuildWorkersEl.textContent = Number.isFinite(activeWorkers) ? activeWorkers.toLocaleString() : '0';
            }
            setMetadataBuildSummaryValue(metadataBuildScannedEl, source.scanned_models || source.current || 0);
            setMetadataBuildSummaryValue(metadataBuildCreatedEl, created, created > 0 ? 'is-valid' : '');
            setMetadataBuildSummaryValue(metadataBuildUpdatedEl, updated, updated > 0 ? 'is-valid' : '');
            setMetadataBuildSummaryValue(metadataBuildSkippedEl, source.skipped_complete || 0);
            setMetadataBuildSummaryValue(metadataBuildHashesEl, calculatedHashes, calculatedHashes > 0 ? 'is-pending' : '');
            setMetadataBuildSummaryValue(metadataBuildErrorsEl, errorCount, errorCount > 0 ? 'is-invalid' : '');
        };

        const metadataBuildStageLabels = {
            queued: 'Queued',
            scanning: 'Scanning',
            header: 'Reading header',
            hashing: 'Calculating SHA256',
            writing: 'Writing metadata',
            model_done: 'Processed',
            done: 'Done',
            cancelled: 'Cancelled',
            error: 'Error'
        };

        const getMetadataBuildWorkerPercent = (item = {}) => {
            const direct = Number(item.percent);
            if (Number.isFinite(direct)) {
                return Math.max(0, Math.min(100, direct));
            }
            const bytesRead = Number(item.bytes_read || 0);
            const totalBytes = Number(item.total_bytes || 0);
            if (totalBytes > 0) {
                return Math.max(0, Math.min(100, (bytesRead / totalBytes) * 100));
            }
            return 0;
        };

        const renderMetadataBuildWorkers = (data = {}, activeModels = []) => {
            if (!metadataBuildWorkerListEl) return;
            const statusValue = String(data.status || data.stage || '').toLowerCase();
            if (['done', 'cancelled', 'error'].includes(statusValue)) {
                metadataBuildWorkerListEl.innerHTML = '';
                metadataBuildWorkerListEl.hidden = true;
                return;
            }
            const workerItems = activeModels.length
                ? activeModels
                : (data.current_model ? [{
                    filename: data.current_model,
                    path: data.current_path || data.metadata_path || '',
                    stage: data.stage || '',
                    percent: data.percent || 0,
                    bytes_read: data.bytes_read || 0,
                    total_bytes: data.total_bytes || 0
                }] : []);

            if (!workerItems.length) {
                metadataBuildWorkerListEl.innerHTML = '';
                metadataBuildWorkerListEl.hidden = true;
                return;
            }

            metadataBuildWorkerListEl.hidden = false;
            metadataBuildWorkerListEl.innerHTML = workerItems.map((item, index) => {
                const workerPercent = getMetadataBuildWorkerPercent(item);
                const stageLabel = metadataBuildStageLabels[item.stage] || item.stage || 'Running';
                const bytesRead = Number(item.bytes_read || 0);
                const totalBytes = Number(item.total_bytes || 0);
                const bytesLabel = totalBytes > 0
                    ? `${this.formatBytes(bytesRead)} / ${this.formatBytes(totalBytes)}`
                    : '';
                const filename = item.filename || 'Model';
                const path = item.path || '';
                return `
                    <div class="mr-options-build-worker">
                        <div class="mr-options-build-worker-head">
                            <span>Worker ${index + 1}</span>
                            <strong>${Math.round(workerPercent)}%</strong>
                        </div>
                        <div class="mr-options-build-worker-name" title="${this.escapeHtml(filename)}">${this.escapeHtml(filename)}</div>
                        <div class="mr-options-build-worker-meta">
                            <span>${this.escapeHtml(stageLabel)}</span>
                            ${bytesLabel ? `<span>${this.escapeHtml(bytesLabel)}</span>` : ''}
                        </div>
                        ${path ? `<code title="${this.escapeHtml(path)}">${this.escapeHtml(path)}</code>` : ''}
                        <div class="mr-options-build-worker-bar" aria-hidden="true">
                            <span style="width: ${workerPercent}%"></span>
                        </div>
                    </div>
                `;
            }).join('');
        };

        const updateMetadataBuildProgressView = (data = {}) => {
            if (metadataBuildProgress) metadataBuildProgress.hidden = false;
            const stage = String(data.stage || data.status || '').trim();
            const percent = Math.max(0, Math.min(100, Number(data.percent || 0)));
            if (metadataBuildStageEl) metadataBuildStageEl.textContent = metadataBuildStageLabels[stage] || stage || 'Running';
            if (metadataBuildPercentEl) metadataBuildPercentEl.textContent = `${Math.round(percent)}%`;
            if (metadataBuildBarEl) metadataBuildBarEl.style.width = `${percent}%`;

            const current = Number(data.current || 0);
            const total = Number(data.total || data.total_models || 0);
            const terminalStatus = ['done', 'cancelled', 'error'].includes(String(data.status || stage || '').toLowerCase());
            const activeModels = !terminalStatus && Array.isArray(data.active_models) ? data.active_models : [];
            const currentModel = data.current_model || data.filename || '';
            const suffix = total > 0 ? ` (${current.toLocaleString()} / ${total.toLocaleString()})` : '';
            if (metadataBuildCurrentModelEl) {
                if (activeModels.length) {
                    metadataBuildCurrentModelEl.textContent = `${activeModels.length.toLocaleString()} active worker${activeModels.length === 1 ? '' : 's'}${suffix}`;
                } else {
                    metadataBuildCurrentModelEl.textContent = currentModel
                        ? `${currentModel}${suffix}`
                        : (data.message || `Preparing${suffix}`);
                }
            }
            if (metadataBuildCurrentPathEl) {
                const pathText = activeModels.length
                    ? ''
                    : (data.current_path || data.metadata_path || '');
                metadataBuildCurrentPathEl.textContent = pathText;
                metadataBuildCurrentPathEl.hidden = !pathText;
            }

            const bytesRead = Number(data.bytes_read || 0);
            const totalBytes = Number(data.total_bytes || 0);
            if (metadataBuildBytesEl) {
                metadataBuildBytesEl.textContent = activeModels.length
                    ? ''
                    : totalBytes > 0
                    ? `${this.formatBytes(bytesRead)} / ${this.formatBytes(totalBytes)}`
                    : '';
            }
            renderMetadataBuildWorkers(data, activeModels);
        };

        const metadataBuildHistoryFilterLabels = {
            all: 'All',
            done: 'Done',
            created: 'Created',
            updated: 'Updated',
            skipped: 'Skipped',
            checked: 'Checked',
            error: 'Errors',
            cancelled: 'Cancelled'
        };
        const metadataBuildDoneActions = new Set(['created', 'updated', 'skipped', 'checked']);
        const getMetadataBuildHistoryAction = (item = {}) => String(item.action || 'checked').toLowerCase();
        const getMetadataBuildHistoryFilter = () => {
            const value = this.metadataBuildHistoryFilter || 'all';
            return metadataBuildHistoryFilterValues.includes(value) ? value : 'all';
        };
        const metadataBuildHistoryMatchesFilter = (item, filter) => {
            const action = getMetadataBuildHistoryAction(item);
            return metadataBuildHistoryActionMatchesFilter(action, filter);
        };
        const metadataBuildHistoryActionMatchesFilter = (action, filter) => {
            if (filter === 'all') return true;
            if (filter === 'done') return metadataBuildDoneActions.has(action);
            return action === filter;
        };
        const getMetadataBuildHistoryFilterCounts = (items = []) => {
            const counts = Object.fromEntries(metadataBuildHistoryFilterValues.map(value => [value, 0]));
            items.forEach((item) => {
                const action = getMetadataBuildHistoryAction(item);
                counts.all += 1;
                if (metadataBuildDoneActions.has(action)) counts.done += 1;
                if (Object.prototype.hasOwnProperty.call(counts, action)) counts[action] += 1;
            });
            return counts;
        };
        const updateMetadataBuildHistoryFilterUi = (allItems = [], filteredItems = [], filter = 'all') => {
            const counts = getMetadataBuildHistoryFilterCounts(allItems);
            this.metadataBuildHistoryFilterCounts = counts;
            this.metadataBuildHistoryFilteredCount = filteredItems.length;
            this.metadataBuildHistoryTotalCount = allItems.length;
            this.metadataBuildHistoryFilter = filter;
            return counts;
        };
        const renderMetadataBuildActionFilterHeader = (counts = {}, filter = 'all', filteredCount = 0, totalCount = 0) => {
            const activeLabel = metadataBuildHistoryFilterLabels[filter] || metadataBuildHistoryFilterLabels.all;
            const menuOpen = Boolean(this.metadataBuildHistoryFilterMenuOpen);
            const options = metadataBuildHistoryFilterValues.map((value) => {
                const label = metadataBuildHistoryFilterLabels[value] || value;
                const count = Number(counts[value] || 0);
                const isActive = value === filter;
                return `
                    <button type="button" class="mr-options-history-filter-option ${isActive ? 'is-active' : ''}" data-metadata-history-filter-option="${this.escapeHtml(value)}" role="menuitemradio" aria-checked="${isActive ? 'true' : 'false'}">
                        <span>${this.escapeHtml(label)}</span>
                        <strong>${count.toLocaleString()}</strong>
                    </button>
                `;
            }).join('');
            return `
                <th class="mr-options-history-action-filter-cell">
                    <div class="mr-options-history-action-filter-wrap">
                        <button type="button" class="mr-options-history-action-filter-button ${filter !== 'all' ? 'is-filtered' : ''}" data-metadata-history-filter-toggle aria-haspopup="menu" aria-expanded="${menuOpen ? 'true' : 'false'}" title="Filter by action">
                            <span>Action</span>
                            <span class="mr-options-history-filter-chip" data-metadata-history-filter-chip ${filter !== 'all' ? '' : 'hidden'}>${this.escapeHtml(activeLabel)}</span>
                        </button>
                        <div class="mr-options-history-filter-menu" role="menu" ${menuOpen ? '' : 'hidden'}>
                            ${options}
                        </div>
                    </div>
                </th>
            `;
        };
        const setMetadataBuildHistoryFilterMenuOpen = (open) => {
            this.metadataBuildHistoryFilterMenuOpen = Boolean(open);
            const menu = metadataBuildResults?.querySelector?.('.mr-options-history-filter-menu');
            const toggle = metadataBuildResults?.querySelector?.('[data-metadata-history-filter-toggle]');
            if (menu) menu.hidden = !this.metadataBuildHistoryFilterMenuOpen;
            if (toggle) toggle.setAttribute('aria-expanded', this.metadataBuildHistoryFilterMenuOpen ? 'true' : 'false');
        };
        const updateMetadataBuildActionFilterControl = (filter = 'all') => {
            if (!metadataBuildResults) return;
            const normalizedFilter = metadataBuildHistoryFilterValues.includes(filter) ? filter : 'all';
            const counts = this.metadataBuildHistoryFilterCounts || {};
            const toggle = metadataBuildResults.querySelector('[data-metadata-history-filter-toggle]');
            const chip = metadataBuildResults.querySelector('[data-metadata-history-filter-chip]');
            if (toggle) toggle.classList.toggle('is-filtered', normalizedFilter !== 'all');
            if (chip) {
                chip.textContent = metadataBuildHistoryFilterLabels[normalizedFilter] || normalizedFilter;
                chip.hidden = normalizedFilter === 'all';
            }
            metadataBuildResults.querySelectorAll('[data-metadata-history-filter-option]').forEach((option) => {
                const value = option.dataset.metadataHistoryFilterOption || 'all';
                const isActive = value === normalizedFilter;
                option.classList.toggle('is-active', isActive);
                option.setAttribute('aria-checked', isActive ? 'true' : 'false');
                const countEl = option.querySelector('strong');
                if (countEl) countEl.textContent = Number(counts[value] || 0).toLocaleString();
            });
        };
        const applyMetadataBuildHistoryFilter = (filter = 'all') => {
            if (!metadataBuildResults) return;
            const normalizedFilter = metadataBuildHistoryFilterValues.includes(filter) ? filter : 'all';
            this.metadataBuildHistoryFilter = normalizedFilter;
            this.metadataBuildHistoryVisibleLimit = metadataBuildHistoryPageSize;
            renderMetadataBuildResults(undefined);
        };

        const renderMetadataBuildResults = (data = undefined) => {
            if (!metadataBuildResults) return;
            if (data !== undefined) {
                this.metadataBuildLastResultsData = data;
            }
            const renderData = data === undefined ? this.metadataBuildLastResultsData : data;
            const source = renderData?.result && typeof renderData.result === 'object' ? renderData.result : renderData;
            const historyItems = Array.isArray(this.metadataBuildHistory)
                ? this.metadataBuildHistory
                : [];
            if (!source && !historyItems.length) {
                updateMetadataBuildHistoryFilterUi([], [], getMetadataBuildHistoryFilter());
                metadataBuildResults.hidden = true;
                metadataBuildResults.innerHTML = '';
                return;
            }

            if (this.metadataBuildActiveTab !== 'history') {
                this.metadataBuildHistoryRenderPending = true;
                return;
            }
            this.metadataBuildHistoryRenderPending = false;

            const fallbackItems = source && Array.isArray(source.history)
                ? source.history
                : (source && Array.isArray(source.updated) ? source.updated : []);
            const displayItems = historyItems.length ? historyItems : fallbackItems;
            const errors = Array.isArray(source?.errors) ? source.errors : [];
            const activeHistoryFilter = getMetadataBuildHistoryFilter();
            this.metadataBuildHistoryFilter = activeHistoryFilter;
            const filteredItems = displayItems.filter(item => metadataBuildHistoryMatchesFilter(item, activeHistoryFilter));
            const filterCounts = updateMetadataBuildHistoryFilterUi(displayItems, filteredItems, activeHistoryFilter);
            const visibleLimit = Math.max(
                metadataBuildHistoryPageSize,
                Number(this.metadataBuildHistoryVisibleLimit || metadataBuildHistoryPageSize)
            );
            const visibleItems = filteredItems.slice(0, visibleLimit);
            const hiddenByLimit = Math.max(0, filteredItems.length - visibleItems.length);
            let html = '';

            if (displayItems.length) {
                const rows = visibleItems.map((item) => {
                    const modelLabel = item.relative_path || item.filename || item.model_path || 'Model';
                    const modelPath = item.model_path || '';
                    const metadataPath = item.metadata_path || '';
                    const shaSource = item.sha256_source || '';
                    const shaLabel = item.sha256 ? `${String(item.sha256).slice(0, 12)}...` : 'Pending';
                    const changedFieldList = Array.isArray(item.changed_fields)
                        ? item.changed_fields.filter(Boolean)
                        : [];
                    const changedFields = changedFieldList.join(', ');
                    const changedFieldsSummary = changedFieldList.length
                        ? `${changedFieldList.length} field${changedFieldList.length === 1 ? '' : 's'} changed`
                        : '';
                    const changedFieldsTitle = changedFields ? ` title="${this.escapeHtml(changedFields)}"` : '';
                    const action = item.action || 'checked';
                    const actionValue = String(action).toLowerCase();
                    const actionClass = actionValue.replace(/[^a-z0-9_-]+/g, '-');
                    const message = item.message || changedFieldsSummary;
                    const rowMatchesFilter = metadataBuildHistoryActionMatchesFilter(actionValue, activeHistoryFilter);
                    const buildContext = modelPath ? {
                        context_scope: 'local_model',
                        open_folder_label: 'Show File in Folder',
                        name: item.filename || modelLabel,
                        filename: item.filename || modelLabel,
                        relative_path: item.relative_path || modelLabel,
                        path: modelPath,
                        resolved_path: modelPath,
                        open_path: modelPath,
                        folder_path: item.base_directory || '',
                        category: item.category || '',
                        metadata_path: metadataPath,
                        size: item.size || 0,
                        file_size: item.size || 0,
                        sha256: item.sha256 || '',
                        context_source: 'metadata_builder'
                    } : null;
                    const contextAttrs = buildContext
                        ? this.getContextMenuAttrs(buildContext, 'Right-click for model options')
                        : '';
                    return `
                        <tr class="mr-options-audit-row ${contextAttrs ? 'is-context-menu' : ''}" data-metadata-history-row data-history-action="${this.escapeHtml(actionValue)}" ${rowMatchesFilter ? '' : 'hidden'}${contextAttrs}>
                            <td>
                                <div class="mr-options-audit-model">${this.escapeHtml(modelLabel)}</div>
                                <div class="mr-options-audit-path" title="${this.escapeHtml(modelPath)}">${this.escapeHtml(modelPath)}</div>
                            </td>
                            <td>
                                <span class="mr-options-history-action is-${this.escapeHtml(actionClass)}">${this.escapeHtml(action)}</span>
                                ${message ? `<div class="mr-options-audit-path"${changedFieldsTitle}>${this.escapeHtml(message)}</div>` : ''}
                            </td>
                            <td>${this.escapeHtml(item.category || '')}</td>
                            <td>
                                <div>${this.escapeHtml(shaLabel)}</div>
                                <div class="mr-options-audit-path">${this.escapeHtml(shaSource)}</div>
                            </td>
                            <td>${this.escapeHtml(item.size_label || this.formatBytes(item.size || 0))}</td>
                            <td>
                                <div class="mr-options-audit-path" title="${this.escapeHtml(metadataPath)}">${this.escapeHtml(metadataPath)}</div>
                            </td>
                        </tr>
                    `;
                }).join('');
                const moreRow = hiddenByLimit > 0
                    ? `
                        <tr>
                            <td colspan="6">
                                <button type="button" class="mr-options-history-show-more" data-metadata-history-show-more>
                                    Show ${Math.min(metadataBuildHistoryPageSize, hiddenByLimit).toLocaleString()} more of ${filteredItems.length.toLocaleString()}
                                </button>
                            </td>
                        </tr>
                    `
                    : '';
                const emptyRow = `
                    <tr data-metadata-history-empty-row ${filteredItems.length ? 'hidden' : ''}>
                        <td colspan="6">
                            <div class="mr-options-audit-empty">No history items match the ${this.escapeHtml(metadataBuildHistoryFilterLabels[activeHistoryFilter] || activeHistoryFilter)} filter.</div>
                        </td>
                    </tr>
                `;
                html += `
                    <div class="mr-options-audit-table-wrap">
                        <table class="mr-options-audit-table mr-options-history-table">
                            <thead>
                                <tr>
                                    <th>Model</th>
                                    ${renderMetadataBuildActionFilterHeader(filterCounts, activeHistoryFilter, filteredItems.length, displayItems.length)}
                                    <th>Folder</th>
                                    <th>SHA256</th>
                                    <th>Size</th>
                                    <th>Metadata file</th>
                                </tr>
                            </thead>
                            <tbody>${rows}${moreRow}${emptyRow}</tbody>
                        </table>
                    </div>
                `;
            } else if (source?.cancelled) {
                html += '<div class="mr-options-audit-empty">Metadata build was cancelled before any history item was captured.</div>';
            } else {
                html += '<div class="mr-options-audit-empty">No metadata history captured yet.</div>';
            }

            if (errors.length) {
                const errorRows = errors.slice(0, 10).map((item) => {
                    const targetPath = item.metadata_path || item.model_path || '';
                    return `<li><span>${this.escapeHtml(item.message || 'Error')}</span><code>${this.escapeHtml(targetPath)}</code></li>`;
                }).join('');
                html += `
                    <div class="mr-options-audit-errors">
                        <div class="mr-options-audit-errors-title">Write errors</div>
                        <ul>${errorRows}</ul>
                    </div>
                `;
            }

            metadataBuildResults.innerHTML = html;
            metadataBuildResults.hidden = false;
        };

        const stopMetadataBuildHistoryRender = () => {
            if (this.metadataBuildHistoryRenderFrame) {
                window.cancelAnimationFrame(this.metadataBuildHistoryRenderFrame);
                this.metadataBuildHistoryRenderFrame = 0;
            }
            if (this.metadataBuildHistoryRenderTimer) {
                window.clearTimeout(this.metadataBuildHistoryRenderTimer);
                this.metadataBuildHistoryRenderTimer = 0;
            }
        };

        scheduleMetadataBuildHistoryRender = () => {
            if (!metadataBuildResults || this.metadataBuildActiveTab !== 'history') return;
            if (!this.metadataBuildHistoryRenderPending && metadataBuildResults.innerHTML) return;
            stopMetadataBuildHistoryRender();
            metadataBuildResults.hidden = false;
            if (!metadataBuildResults.innerHTML) {
                metadataBuildResults.innerHTML = '<div class="mr-options-audit-loading">Preparing history...</div>';
            }
            this.metadataBuildHistoryRenderFrame = window.requestAnimationFrame(() => {
                this.metadataBuildHistoryRenderFrame = 0;
                this.metadataBuildHistoryRenderTimer = window.setTimeout(() => {
                    this.metadataBuildHistoryRenderTimer = 0;
                    renderMetadataBuildResults(undefined);
                }, 0);
            });
        };

        const stopMetadataBuildPolling = () => {
            if (this.metadataBuildPollTimer) {
                window.clearTimeout(this.metadataBuildPollTimer);
                this.metadataBuildPollTimer = null;
            }
        };

        const isMetadataBuildTerminal = (data = {}) => {
            const statusValue = String(data.status || '').toLowerCase();
            return ['done', 'error', 'cancelled'].includes(statusValue);
        };

        const getMetadataBuildProgressKey = (data = {}) => (
            String(data.progress_id || data?.result?.progress_id || this.metadataBuildProgressId || '').trim()
        );

        const finishMetadataBuild = (data = {}) => {
            const progressKey = getMetadataBuildProgressKey(data);
            if (progressKey && this.metadataBuildFinishedProgressId === progressKey) {
                return;
            }
            if (progressKey) {
                this.metadataBuildFinishedProgressId = progressKey;
            }

            appendMetadataBuildHistory(data);
            const source = data?.result && typeof data.result === 'object' ? data.result : data;
            setMetadataBuildBusy(false);
            renderMetadataBuildResults(source);

            if (data.status === 'cancelled' || source.cancelled) {
                setMetadataBuildStatus(`Metadata build cancelled after ${Number(source.scanned_models || data.current || 0).toLocaleString()} model${Number(source.scanned_models || data.current || 0) === 1 ? '' : 's'}.`, 'is-pending');
                this.showNotification('Metadata build cancelled', 'warning');
                return;
            }

            if (data.status === 'error') {
                setMetadataBuildStatus(data.message || 'Metadata build failed.', 'is-invalid');
                this.showNotification('Metadata build failed', 'error');
                return;
            }

            const created = Number(source.created_metadata || 0);
            const updated = Number(source.updated_metadata || 0);
            const errorCount = Number(source.error_count || 0);
            const calculatedHashes = Number(source.calculated_hashes || 0);
            const headerHashes = Number(source.header_hashes || 0);
            const changed = created + updated;
            const hashText = ` ${calculatedHashes.toLocaleString()} full SHA256 hash${calculatedHashes === 1 ? '' : 'es'} calculated, ${headerHashes.toLocaleString()} read from headers.`;
            if (errorCount > 0) {
                setMetadataBuildStatus(`Metadata build finished with ${errorCount.toLocaleString()} error${errorCount === 1 ? '' : 's'}.${hashText}`, 'is-invalid');
                this.showNotification('Metadata build finished with errors', 'warning');
            } else if (changed > 0) {
                setMetadataBuildStatus(`Created ${created.toLocaleString()} and updated ${updated.toLocaleString()} metadata file${changed === 1 ? '' : 's'}.${hashText}`, 'is-valid');
                this.showNotification('Local metadata updated', 'success');
            } else {
                setMetadataBuildStatus(`Checked ${Number(source.scanned_models || 0).toLocaleString()} model${Number(source.scanned_models || 0) === 1 ? '' : 's'}. All existing metadata already had SHA256.`, 'is-valid');
                this.showNotification('Local metadata already complete', 'success');
            }
        };

        const pollMetadataBuildProgress = async () => {
            const progressId = this.metadataBuildProgressId;
            if (!progressId) return;
            try {
                const data = await this.fetchJson(
                    `/model_resolver/metadata-build/progress/${encodeURIComponent(progressId)}`,
                    { silent: true },
                    'Metadata build progress'
                );
                appendMetadataBuildHistory(data);
                updateMetadataBuildSummary(data);
                updateMetadataBuildProgressView(data);
                renderMetadataBuildResults(data);
                if (isMetadataBuildTerminal(data)) {
                    stopMetadataBuildPolling();
                    finishMetadataBuild(data);
                    if (this.metadataBuildProgressId === progressId) {
                        this.metadataBuildProgressId = '';
                    }
                    return;
                }
                stopMetadataBuildPolling();
                this.metadataBuildPollTimer = window.setTimeout(() => {
                    pollMetadataBuildProgress();
                }, 700);
            } catch (error) {
                stopMetadataBuildPolling();
                this.metadataBuildProgressId = '';
                setMetadataBuildBusy(false);
                setMetadataBuildStatus(error.message || 'Metadata build progress failed.', 'is-invalid');
            }
        };

        const runMetadataBuild = async () => {
            stopMetadataBuildPolling();
            stopMetadataBuildHistoryRender();
            this.metadataBuildProgressId = '';
            this.metadataBuildFinishedProgressId = '';
            this.metadataBuildHistory = [];
            this.metadataBuildHistoryKeys = new Set();
            this.metadataBuildHistoryVisibleLimit = metadataBuildHistoryPageSize;
            if (metadataBuildHistoryCountEl) metadataBuildHistoryCountEl.textContent = '0';
            setMetadataBuildBusy(true);
            updateMetadataBuildSummary({});
            renderMetadataBuildResults(null);
            setMetadataBuildTab('progress');
            updateMetadataBuildProgressView({
                stage: 'queued',
                message: 'Preparing local metadata build...',
                percent: 0,
                current: 0,
                total: 0
            });
            setMetadataBuildStatus('Preparing local metadata build...', 'is-pending');
            try {
                const workerCount = normalizeMetadataBuildWorkerCount();
                const start = await this.fetchJson('/model_resolver/metadata-build/start', {
                    method: 'POST',
                    body: JSON.stringify({
                        force_rescan: true,
                        worker_count: workerCount
                    })
                }, 'Start metadata build');
                if (!start?.progress_id) {
                    throw new Error('Metadata build did not return a progress id.');
                }
                this.metadataBuildProgressId = start.progress_id;
                setMetadataBuildStatus('Building local metadata...', 'is-pending');
                pollMetadataBuildProgress();
            } catch (error) {
                this.metadataBuildProgressId = '';
                setMetadataBuildBusy(false);
                setMetadataBuildStatus(error.message || 'Metadata build failed to start.', 'is-invalid');
            }
        };

        const cancelMetadataBuild = async () => {
            const progressId = this.metadataBuildProgressId;
            if (!progressId) return;
            if (metadataBuildCancelBtn) metadataBuildCancelBtn.disabled = true;
            setMetadataBuildStatus('Stopping metadata build...', 'is-pending');
            try {
                await this.fetchJson(
                    `/model_resolver/metadata-build/cancel/${encodeURIComponent(progressId)}`,
                    { method: 'POST', silent: true },
                    'Cancel metadata build'
                );
                stopMetadataBuildPolling();
                pollMetadataBuildProgress();
            } catch (error) {
                setMetadataBuildStatus(error.message || 'Could not cancel metadata build.', 'is-invalid');
                if (metadataBuildCancelBtn) metadataBuildCancelBtn.disabled = false;
            }
        };

        const setTokenCheckStatus = (statusEl, text, mode = '') => {
            if (!statusEl) return;
            statusEl.textContent = text;
            statusEl.classList.remove('is-valid', 'is-invalid', 'is-pending');
            if (mode) statusEl.classList.add(mode);
        };

        const setAria2Status = (text, mode = '') => {
            if (!aria2StatusEl) return;
            aria2StatusEl.hidden = !text;
            aria2StatusEl.textContent = text;
            aria2StatusEl.classList.remove('is-valid', 'is-invalid', 'is-pending');
            if (mode) aria2StatusEl.classList.add(mode);
        };

        const setAria2SummaryValue = (element, text, mode = '') => {
            if (!element) return;
            element.textContent = text;
            element.classList.remove('is-valid', 'is-invalid', 'is-pending');
            if (mode) element.classList.add(mode);
        };

        const syncAria2DaemonButton = (data = {}) => {
            if (!aria2StopBtn) return;
            const available = data.available === true;
            const running = Boolean(data.running);
            aria2StopBtn.hidden = !available;
            aria2StopBtn.dataset.action = running ? 'stop' : 'start';
            aria2StopBtn.textContent = running ? 'Stop' : 'Start';
            aria2StopBtn.disabled = running && data.can_stop === false;
            aria2StopBtn.title = aria2StopBtn.disabled
                ? 'Cannot stop while aria2 has active downloads'
                : (running
                    ? 'Stop aria2 daemon started by Model Resolver'
                    : 'Start aria2 daemon now');
        };

        const renderAria2Summary = (data = {}, state = 'idle') => {
            const backend = this.normalizeDownloadBackend(data.backend || downloadBackendInput?.value || tokens.download_backend);
            const version = String(data.version || '').trim();
            const backendLabel = backend === 'aria2'
                ? `aria2${version ? ` ${version}` : ''}`
                : 'Python';

            setAria2SummaryValue(aria2BackendStateEl, backendLabel);

            if (state === 'checking') {
                syncAria2DaemonButton({ available: false, running: false });
                setAria2SummaryValue(aria2AvailabilityEl, 'Checking...', 'is-pending');
                setAria2SummaryValue(aria2DaemonEl, 'Checking...', 'is-pending');
                return;
            }

            if (state === 'installing') {
                syncAria2DaemonButton({ available: false, running: false });
                setAria2SummaryValue(aria2AvailabilityEl, 'Installing...', 'is-pending');
                setAria2SummaryValue(aria2DaemonEl, 'Not started');
                return;
            }

            if (data && typeof data.available === 'boolean') {
                syncAria2DaemonButton(data);
                setAria2SummaryValue(
                    aria2AvailabilityEl,
                    data.available ? 'Available' : 'Not found',
                    data.available ? 'is-valid' : 'is-invalid'
                );
                setAria2SummaryValue(
                    aria2DaemonEl,
                    data.running ? 'Running' : 'Starts on first download',
                    data.running ? 'is-valid' : ''
                );
                return;
            }

            syncAria2DaemonButton({ available: false, running: false });
            setAria2SummaryValue(aria2AvailabilityEl, 'Not checked');
            setAria2SummaryValue(aria2DaemonEl, 'Not checked');
        };

        const syncAria2OptionsVisibility = () => {
            const backend = this.normalizeDownloadBackend(downloadBackendInput?.value || tokens.download_backend);
            const showAria2 = backend === 'aria2';
            aria2SettingEls.forEach((element) => {
                element.hidden = !showAria2;
            });
            renderAria2Summary({ backend });
        };

        const checkAria2Status = async ({ useUnsavedPath = true } = {}) => {
            if (aria2CheckBtn) aria2CheckBtn.disabled = true;
            setAria2Status('');
            renderAria2Summary({ backend: 'aria2' }, 'checking');
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
                renderAria2Summary({
                    ...data,
                    backend: downloadBackendInput?.value || data.backend
                });
                if (data?.available) {
                    setAria2Status('');
                } else {
                    setAria2Status(data?.error || 'aria2c was not found. Install aria2 or configure the aria2c path.', 'is-invalid');
                }
            } catch (error) {
                setAria2Status(error.message || 'aria2 check failed.', 'is-invalid');
                renderAria2Summary({
                    backend: 'aria2',
                    configured_path: aria2cPathInput?.value || '',
                    resolved_path: '',
                    available: false,
                    running: false
                });
            } finally {
                if (aria2CheckBtn) aria2CheckBtn.disabled = false;
            }
        };

        const installAria2 = async () => {
            if (aria2InstallBtn) aria2InstallBtn.disabled = true;
            if (aria2CheckBtn) aria2CheckBtn.disabled = true;
            setAria2Status('');
            renderAria2Summary({ backend: 'aria2' }, 'installing');
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

                setAria2Status('');
                renderAria2Summary({
                    backend: 'aria2',
                    configured_path: data.aria2c_path,
                    resolved_path: data.aria2c_path,
                    available: true,
                    version: data.version,
                    running: false
                });
                await checkAria2Status({ useUnsavedPath: true });
            } catch (error) {
                setAria2Status(error.message || 'aria2 install failed.', 'is-invalid');
                renderAria2Summary({
                    backend: 'aria2',
                    configured_path: aria2cPathInput?.value || '',
                    resolved_path: '',
                    available: false,
                    running: false
                });
            } finally {
                if (aria2InstallBtn) aria2InstallBtn.disabled = false;
                if (aria2CheckBtn) aria2CheckBtn.disabled = false;
            }
        };

        const requestAria2Control = async (endpoint, { method = 'POST', body = {} } = {}) => {
            return this.fetchJson(endpoint, {
                method,
                ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
                silent: true
            }, 'Aria2 Control');
        };

        const startAria2 = async () => {
            if (aria2StopBtn) aria2StopBtn.disabled = true;
            setAria2Status('');
            setAria2SummaryValue(aria2DaemonEl, 'Starting...', 'is-pending');
            let refreshed = false;
            try {
                const result = await requestAria2Control('/model_resolver/aria2/start', {
                    body: {
                        aria2c_path: aria2cPathInput?.value || ''
                    }
                });
                if (!result?.success) {
                    throw new Error(result?.error || 'Could not start aria2 daemon.');
                }
                await checkAria2Status({ useUnsavedPath: true });
                refreshed = true;
            } catch (error) {
                const message = error.message || 'aria2 start failed.';
                await checkAria2Status({ useUnsavedPath: true });
                refreshed = true;
                setAria2Status(message, 'is-invalid');
            } finally {
                if (!refreshed && aria2StopBtn) aria2StopBtn.disabled = false;
            }
        };

        const stopAria2 = async () => {
            if (aria2StopBtn) aria2StopBtn.disabled = true;
            setAria2Status('');
            setAria2SummaryValue(aria2DaemonEl, 'Stopping...', 'is-pending');
            let refreshed = false;
            try {
                let result;
                try {
                    result = await requestAria2Control('/model_resolver/aria2/stop');
                } catch (error) {
                    if (error?.status !== 405) throw error;
                    result = await requestAria2Control('/model_resolver/aria2/stop', { method: 'GET' });
                }
                if (!result?.success) {
                    throw new Error(result?.error || 'Could not stop aria2 daemon.');
                }
                await checkAria2Status({ useUnsavedPath: true });
                refreshed = true;
            } catch (error) {
                const message = error.message || 'aria2 stop failed.';
                await checkAria2Status({ useUnsavedPath: true });
                refreshed = true;
                setAria2Status(message, 'is-invalid');
            } finally {
                if (!refreshed && aria2StopBtn) aria2StopBtn.disabled = false;
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

        const executeOptionsTask = async ({
            setBusy,
            stateEl,
            messageEl,
            loadingText,
            startingMessageText,
            endpoint,
            fetchOptions = {},
            errorContext,
            successCallback,
            successAction,
            errorFallbackText,
            notificationErrorText
        }) => {
            try {
                setBusy(true);
                if (stateEl) stateEl.textContent = loadingText;
                if (messageEl && startingMessageText) messageEl.textContent = startingMessageText;
                const data = await this.fetchJson(endpoint, fetchOptions, errorContext);
                if (successAction) {
                    await successAction(data);
                }
                successCallback(data);
                return data;
            } catch (error) {
                console.error(`Model Resolver: ${errorContext} error:`, error);
                if (stateEl) stateEl.textContent = 'Error';
                if (messageEl) messageEl.textContent = error.message || errorFallbackText;
                if (notificationErrorText) {
                    this.showNotification(notificationErrorText, 'error');
                }
                return null;
            } finally {
                setBusy(false);
            }
        };

        const loadModelListStatus = (checkRemote = false) => executeOptionsTask({
            setBusy: setModelListBusy,
            stateEl: modelListStateEl,
            loadingText: checkRemote ? 'Checking GitHub...' : 'Loading...',
            endpoint: `/model_resolver/model-list/status${checkRemote ? '?check_remote=1' : ''}`,
            errorContext: 'Model-list status',
            successCallback: (data) => renderModelListStatus(data, checkRemote),
            errorFallbackText: 'Failed to read Local Database status.'
        });

        const updateModelList = () => executeOptionsTask({
            setBusy: setModelListBusy,
            stateEl: modelListStateEl,
            messageEl: modelListMessageEl,
            loadingText: 'Updating...',
            startingMessageText: 'Downloading latest ComfyUI-Manager model-list.json...',
            endpoint: '/model_resolver/model-list/update',
            fetchOptions: { method: 'POST' },
            errorContext: 'Update model list',
            successAction: async () => {
                await this.clearSearchCaches();
            },
            successCallback: (data) => {
                renderModelListStatus(data, false);
                if (modelListStateEl) modelListStateEl.textContent = 'Updated';
                if (modelListMessageEl) modelListMessageEl.textContent = `Local Database updated. ${Number(data.local_count || 0).toLocaleString()} models loaded.`;
                this.showNotification('Local Database updated', 'success');
            },
            errorFallbackText: 'Failed to update Local Database.',
            notificationErrorText: 'Local Database update failed'
        });

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

        const loadBaseModelsStatus = (checkRemote = false) => executeOptionsTask({
            setBusy: setBaseModelsBusy,
            stateEl: baseModelsStateEl,
            loadingText: checkRemote ? 'Checking CivitAI...' : 'Loading...',
            endpoint: `/model_resolver/base-models/status${checkRemote ? '?check_remote=1' : ''}`,
            errorContext: 'Load base models status',
            successCallback: (data) => renderBaseModelsStatus(data, checkRemote),
            errorFallbackText: 'Failed to read Base Models status.'
        });

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

        const updateBaseModels = () => executeOptionsTask({
            setBusy: setBaseModelsBusy,
            stateEl: baseModelsStateEl,
            messageEl: baseModelsMessageEl,
            loadingText: 'Updating...',
            startingMessageText: 'Downloading latest base models from CivitAI...',
            endpoint: '/model_resolver/base-models/update',
            fetchOptions: { method: 'POST' },
            errorContext: 'Update base models',
            successAction: async () => {
                await this.clearSearchCaches();
                this.baseModels = null;
                await this.ensureBaseModelsLoaded();
            },
            successCallback: (data) => {
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
            },
            errorFallbackText: 'Failed to update Base Models.',
            notificationErrorText: 'Base Models update failed'
        });

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

        const loadHfIndexStatus = () => executeOptionsTask({
            setBusy: setHfIndexBusy,
            stateEl: hfIndexStateEl,
            loadingText: 'Loading...',
            endpoint: '/model_resolver/huggingface/author-index/status',
            errorContext: 'Load HuggingFace index status',
            successCallback: renderHfIndexStatus,
            errorFallbackText: 'Failed to read HuggingFace index status.'
        });

        const refreshHfIndex = () => executeOptionsTask({
            setBusy: setHfIndexBusy,
            stateEl: hfIndexStateEl,
            messageEl: hfIndexMessageEl,
            loadingText: 'Refreshing...',
            startingMessageText: 'Downloading Comfy-Org file index from HuggingFace...',
            endpoint: '/model_resolver/huggingface/author-index/refresh',
            fetchOptions: {
                method: 'POST',
                body: JSON.stringify({ hf_token: hfInput?.value || '' })
            },
            errorContext: 'Refresh HuggingFace index',
            successAction: async (data) => {
                if (data?.success === false) {
                    throw new Error(data.error || 'Refresh failed');
                }
                await this.clearSearchCaches();
            },
            successCallback: (data) => {
                renderHfIndexStatus(data);
                if (hfIndexStateEl) hfIndexStateEl.textContent = 'Refreshed';
                this.showNotification('HuggingFace Comfy-Org index refreshed', 'success');
            },
            errorFallbackText: 'Failed to refresh HuggingFace index.',
            notificationErrorText: 'HuggingFace index refresh failed'
        });

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
            optionsMain?.classList.toggle(
                'mr-options-main-fill-section',
                targetId === 'mr-options-section-metadata-audit'
                    || targetId === 'mr-options-section-metadata-build'
            );
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

        const addBaseModelMappingRow = (baseModel = '', pathValue = '', options = {}) => {
            const shouldRefresh = options.refresh !== false;
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
            if (shouldRefresh) {
                refreshBaseModelMappingOptions();
            }
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
                addBaseModelMappingRow(baseModel, pathValue, { refresh: false });
            });
            refreshBaseModelMappingOptions();
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
        loadMetadataBuildCapabilities();

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

        if (exportFrontendLogsBtn) {
            exportFrontendLogsBtn.addEventListener('click', () => {
                exportFrontendLogs();
            });
        }

        if (exportBackendLogsBtn) {
            exportBackendLogsBtn.addEventListener('click', () => {
                exportBackendLogs();
            });
        }

        if (clearAllCacheBtn) {
            clearAllCacheBtn.addEventListener('click', () => {
                clearAllCachesFromOptions();
            });
        }

        if (metadataSizeAuditBtn) {
            metadataSizeAuditBtn.addEventListener('click', () => {
                runMetadataSizeAudit();
            });
        }

        if (metadataSizeCollapseToggle) {
            metadataSizeCollapseToggle.addEventListener('click', () => {
                setMetadataSizeControlsCollapsed(!this.metadataSizeControlsCollapsed);
            });
        }

        if (metadataBuildCollapseToggle) {
            metadataBuildCollapseToggle.addEventListener('click', () => {
                setMetadataBuildControlsCollapsed(!this.metadataBuildControlsCollapsed);
            });
        }

        if (metadataBuildStartBtn) {
            metadataBuildStartBtn.addEventListener('click', () => {
                runMetadataBuild();
            });
        }

        if (metadataBuildCancelBtn) {
            metadataBuildCancelBtn.addEventListener('click', () => {
                cancelMetadataBuild();
            });
        }

        metadataBuildTabButtons.forEach((button) => {
            button.addEventListener('click', () => {
                setMetadataBuildTab(button.dataset.buildTab || 'progress');
            });
        });

        if (metadataBuildResults) {
            metadataBuildResults.addEventListener('click', (event) => {
                const filterToggle = event.target?.closest?.('[data-metadata-history-filter-toggle]');
                if (filterToggle) {
                    event.preventDefault();
                    event.stopPropagation();
                    setMetadataBuildHistoryFilterMenuOpen(!this.metadataBuildHistoryFilterMenuOpen);
                    return;
                }

                const filterOption = event.target?.closest?.('[data-metadata-history-filter-option]');
                if (filterOption) {
                    event.preventDefault();
                    event.stopPropagation();
                    const nextFilter = filterOption.dataset.metadataHistoryFilterOption || 'all';
                    applyMetadataBuildHistoryFilter(nextFilter);
                    setMetadataBuildHistoryFilterMenuOpen(false);
                    return;
                }

                const showMoreButton = event.target?.closest?.('[data-metadata-history-show-more]');
                if (showMoreButton) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.metadataBuildHistoryVisibleLimit = Math.max(
                        metadataBuildHistoryPageSize,
                        Number(this.metadataBuildHistoryVisibleLimit || metadataBuildHistoryPageSize)
                    ) + metadataBuildHistoryPageSize;
                    renderMetadataBuildResults(undefined);
                }
            });
        }

        this.contentElement.addEventListener('click', (event) => {
            if (!this.metadataBuildHistoryFilterMenuOpen) return;
            if (event.target?.closest?.('.mr-options-history-action-filter-wrap')) return;
            setMetadataBuildHistoryFilterMenuOpen(false);
        });

        if (metadataBuildResults) {
            metadataBuildResults.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape' || !this.metadataBuildHistoryFilterMenuOpen) return;
                event.preventDefault();
                setMetadataBuildHistoryFilterMenuOpen(false);
            });
        }

        if (metadataBuildWorkerInput) {
            metadataBuildWorkerInput.addEventListener('change', () => {
                metadataBuildWorkerInput.dataset.userEdited = 'true';
                const workerCount = normalizeMetadataBuildWorkerCount();
                if (metadataBuildWorkersEl && !this.metadataBuildProgressId) {
                    metadataBuildWorkersEl.textContent = workerCount.toLocaleString();
                }
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

        if (aria2StopBtn) {
            aria2StopBtn.addEventListener('click', () => {
                if (aria2StopBtn.dataset.action === 'start') {
                    startAria2();
                } else {
                    stopAria2();
                }
            });
        }

        if (aria2cPathInput) {
            aria2cPathInput.addEventListener('input', () => {
                renderAria2Summary({
                    backend: downloadBackendInput?.value || tokens.download_backend,
                    configured_path: aria2cPathInput.value
                });
                setAria2Status('');
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
                    civitai_key: civitaiInput?.value || '',
                    civitai_session_token: civitaiSessionInput?.value || '',
                    civitai_use_trpc_search: Boolean(civitaiUseTrpcSearchInput?.checked),
                    civitai_use_api_search: Boolean(civitaiUseApiSearchInput?.checked),
                    civitai_use_html_fallback: Boolean(civitaiUseHtmlFallbackInput?.checked),
                    civitai_candidate_limit: civitaiCandidateLimit,
                    hf_token: hfInput?.value || '',
                    hf_use_api_search: Boolean(hfUseApiSearchInput?.checked),
                    hf_use_comfy_org_fallback: Boolean(hfUseComfyOrgFallbackInput?.checked),
                    hf_use_brave_fallback: Boolean(hfUseBraveFallbackInput?.checked),
                    auto_fill_base_model: Boolean(autoFillBaseModelInput?.checked),
                    auto_fill_subfolder: Boolean(autoFillSubfolderInput?.checked),
                    auto_refresh_comfy_models_after_apply: Boolean(autoRefreshComfyModelsInput?.checked),
                    download_backend: downloadBackend,
                    aria2c_path: aria2cPathInput?.value?.trim() || '',
                    aria2_auto_stop_daemon: Boolean(aria2AutoStopInput?.checked),
                    download_path_mode: downloadPathMode,
                    download_path_templates: downloadPathTemplates,
                    base_model_path_mappings: baseModelPathMappings,
                    ...defaultRootSettings,
                    frontend_logs_enabled: Boolean(frontendLogsEnabledInput?.checked),
                    backend_logs_enabled: Boolean(backendLogsEnabledInput?.checked),
                    frontend_log_level: normalizeLogLevel(frontendLogLevelInput?.value || tokens.frontend_log_level),
                    backend_log_level: normalizeLogLevel(backendLogLevelInput?.value || tokens.backend_log_level),
                    brave_search_api_key: braveInput?.value || '',
                    search_source_enabled: sourceEnabled,
                };

                // 1. Write to localStorage (fast local cache)
                for (const opt of SETTINGS_MAP) {
                    const val = newSettings[opt.serverKey];
                    if (opt.type === 'boolean' || opt.type === 'frontendLogsEnabled' || opt.type === 'backendLogsEnabled') {
                        localStorage.setItem(opt.localKey, val ? 'true' : 'false');
                    } else if (opt.type === 'json') {
                        localStorage.setItem(opt.localKey, JSON.stringify(val));
                    } else {
                        localStorage.setItem(opt.localKey, String(val ?? ''));
                    }
                }
                defaultRootSelectInputs.forEach((select) => {
                    const storageKey = select.dataset.storageKey;
                    if (storageKey) {
                        localStorage.setItem(storageKey, select.value || '');
                    }
                });
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
        const tokens = {};
        for (const opt of SETTINGS_MAP) {
            const raw = localStorage.getItem(opt.localKey);
            if (opt.type === 'boolean') {
                tokens[opt.serverKey] = raw === null ? opt.default : raw !== 'false';
            } else if (opt.type === 'json') {
                try {
                    tokens[opt.serverKey] = raw ? JSON.parse(raw) : opt.default;
                } catch (e) {
                    tokens[opt.serverKey] = opt.default;
                }
            } else if (opt.type === 'backend') {
                tokens[opt.serverKey] = this.normalizeDownloadBackend(raw || opt.default);
            } else if (opt.type === 'pathMode') {
                tokens[opt.serverKey] = this.normalizeDownloadPathMode(raw || opt.default);
            } else if (opt.type === 'frontendLogsEnabled') {
                tokens[opt.serverKey] = raw === null ? (frontendLogger.enabled !== false) : raw !== 'false';
            } else if (opt.type === 'backendLogsEnabled') {
                tokens[opt.serverKey] = raw === null ? true : raw !== 'false';
            } else if (opt.type === 'candidateLimit') {
                const limit = parseInt(raw || String(opt.default), 10);
                tokens[opt.serverKey] = Number.isFinite(limit) ? Math.min(20, Math.max(1, limit)) : opt.default;
            } else {
                tokens[opt.serverKey] = raw || opt.default;
            }
        }
        tokens.search_source_enabled = this.getSearchSourceEnabledMap();
        return {
            ...tokens,
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

            for (const opt of SETTINGS_MAP) {
                const serverValue = data[opt.serverKey];
                if (serverValue === undefined) continue;

                if (opt.type === 'boolean' || opt.type === 'frontendLogsEnabled' || opt.type === 'backendLogsEnabled') {
                    localStorage.setItem(opt.localKey, serverValue ? 'true' : 'false');
                } else if (opt.type === 'json') {
                    localStorage.setItem(opt.localKey, JSON.stringify(serverValue || {}));
                } else if (opt.type === 'backend') {
                    localStorage.setItem(opt.localKey, this.normalizeDownloadBackend(serverValue));
                } else if (opt.type === 'pathMode') {
                    localStorage.setItem(opt.localKey, this.normalizeDownloadPathMode(serverValue));
                } else {
                    if (serverValue !== null && serverValue !== '') {
                        localStorage.setItem(opt.localKey, String(serverValue));
                    }
                }
            }
            this.getDefaultRootCategoryDefinitions().forEach((item) => {
                if (data[item.settingKey] !== undefined) {
                    localStorage.setItem(item.storageKey, String(data[item.settingKey] || ''));
                }
            });

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
