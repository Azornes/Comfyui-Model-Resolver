import { app } from "../../../../../scripts/app.js";
import { api } from "../../../../../scripts/api.js";
import { $el } from "../../../../../scripts/ui.js";
import { getSvgIcon } from "../../utils/icon_utils.js";
export const optionsMethods = {
    displayOptions() {
        if (!this.contentElement) return;
        this.contentElement.style.overflowY = 'hidden';

        const tokens = this.getStoredTokens();
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
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-local-db">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon" aria-hidden="true">${getSvgIcon('database')}</span>
                                        <span>Local Database</span>
                                    </span>
                                    <span class="mr-options-nav-meta">02</span>
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
                                    <span class="mr-options-nav-meta">03</span>
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
                                    <span class="mr-options-nav-meta">04</span>
                                </button>
                                <button type="button" class="mr-options-nav-btn" data-target="mr-options-section-hf">
                                    <span class="mr-options-nav-main">
                                        <span class="mr-options-nav-icon mr-options-provider-icon mr-options-provider-icon-huggingface" aria-hidden="true">${getSvgIcon('huggingface')}</span>
                                        <span>HuggingFace</span>
                                    </span>
                                    <span class="mr-options-nav-meta">05</span>
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
                                    <span class="mr-options-nav-meta">06</span>
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
                                    <div class="mr-options-toggle-list">
                                        ${sourceDefaultsRows}
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
                                                <span class="mr-options-toggle-title">Auto-fill subfolder <span class="mr-tooltip-badge" data-tooltip="When enabled, Model Resolver fills a suggested LoRA subfolder when it can infer one from CivitAI metadata and your existing folders. When disabled, the field stays empty unless you click Suggest.">?</span></span>
                                            </div>
                                            <span class="mr-options-toggle-control">
                                                <input id="mr-options-auto-fill-subfolder" class="mr-options-switch-input" type="checkbox" ${tokens.auto_fill_subfolder ? 'checked' : ''}>
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

        const checkCredential = async ({ input, button, statusEl, endpoint, payloadKey, missingText }) => {
            const value = (input?.value || '').trim();
            if (!value) {
                setTokenCheckStatus(statusEl, missingText, 'is-invalid');
                return;
            }

            try {
                if (button) button.disabled = true;
                setTokenCheckStatus(statusEl, 'Checking...', 'is-pending');
                const response = await api.fetchApi(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [payloadKey]: value })
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || `Check failed: ${response.status}`);
                }
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
                const response = await api.fetchApi(`/model_resolver/model-list/status${checkRemote ? '?check_remote=1' : ''}`);
                if (!response.ok) {
                    throw new Error(`Status failed: ${response.status}`);
                }
                const data = await response.json();
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
                const response = await api.fetchApi('/model_resolver/model-list/update', {
                    method: 'POST'
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || `Update failed: ${response.status}`);
                }
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
                const response = await api.fetchApi(`/model_resolver/base-models/status${checkRemote ? '?check_remote=1' : ''}`);
                if (!response.ok) {
                    throw new Error(`Status failed: ${response.status}`);
                }
                const data = await response.json();
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

        const updateBaseModels = async () => {
            try {
                setBaseModelsBusy(true);
                if (baseModelsStateEl) baseModelsStateEl.textContent = 'Updating...';
                if (baseModelsMessageEl) baseModelsMessageEl.textContent = 'Downloading latest base models from CivitAI...';
                const response = await api.fetchApi('/model_resolver/base-models/update', {
                    method: 'POST'
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || `Update failed: ${response.status}`);
                }
                await this.clearSearchCaches();
                // Invalidate the in-memory cache so the base model dropdown
                // reloads fresh data from the server next time it is opened.
                this.baseModels = null;
                await this.ensureBaseModelsLoaded();
                renderBaseModelsStatus(data, false);
                if (baseModelsStateEl) baseModelsStateEl.textContent = 'Updated';
                if (baseModelsMessageEl) baseModelsMessageEl.textContent = `Base Models updated. ${Number(data.local_count || 0).toLocaleString()} base models loaded.`;
                this.showNotification('Base Models updated', 'success');
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
                const response = await api.fetchApi('/model_resolver/huggingface/author-index/status');
                if (!response.ok) {
                    throw new Error(`Status failed: ${response.status}`);
                }
                const data = await response.json();
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
                const response = await api.fetchApi('/model_resolver/huggingface/author-index/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hf_token: hfInput?.value || '' })
                });
                const data = await response.json();
                if (!response.ok || data.success === false) {
                    throw new Error(data.error || `Refresh failed: ${response.status}`);
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
        setStatus('Saved only on this machine.');
        setVisibleSection('mr-options-section-sources');

        trackedInputs.forEach((input) => {
            const eventName = input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(eventName, () => {
                setStatus('You have unsaved changes.', 'is-dirty');
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
                localStorage.setItem('ModelResolver.civitaiCandidateLimit',  `${civitaiCandidateLimit}`);
                Object.entries(sourceEnabled).forEach(([key, val]) => {
                    localStorage.setItem(key, val ? 'true' : 'false');
                });
                if (civitaiLimitInput) civitaiLimitInput.value = `${civitaiCandidateLimit}`;

                // 2. Persist to server (survives new browsers / profiles)
                try {
                    setStatus('Saving…', '');
                    const resp = await api.fetchApi('/model_resolver/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newSettings),
                    });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    setStatus('Saved on this machine (all browsers).', 'is-saved');
                    this.showNotification('Options saved', 'success');
                } catch (err) {
                    console.warn('Model Resolver: could not save settings to server, kept locally only.', err);
                    setStatus('Saved locally only (server write failed).', 'is-saved');
                    this.showNotification('Options saved locally only', 'warning');
                }

                await this.clearSearchCaches();
            });
        }

    }
};
