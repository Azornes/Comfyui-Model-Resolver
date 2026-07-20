import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePathIdentity } from '../web/resolver/utils/html_utils.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const queueMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/queue_methods.js'),
  'utf8'
);
const modelResolverSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/model_resolver.js'),
  'utf8'
);
const optionsMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/views/options_methods.js'),
  'utf8'
);
const resolveDownloadMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/resolve_download_methods.js'),
  'utf8'
);
const downloadTargetMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/download_target_methods.js'),
  'utf8'
);
const searchPanelMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/search_panel.js'),
  'utf8'
);
const modelInfoMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/views/model_info_methods.js'),
  'utf8'
);
const renderFormatMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/utils/render_format_methods.js'),
  'utf8'
);

function extractMethod(source, methodName, paramsPattern = '[^)]*') {
  const signatureRegex = new RegExp(`\\n\\s+(async\\s+)?${methodName}\\s*\\(${paramsPattern}\\)\\s*\\{`);
  const match = signatureRegex.exec(source);
  assert.ok(match, `Could not find ${methodName}`);
  const isAsync = Boolean(match[1]);

  const parenStart = source.indexOf('(', match.index);
  const parenEnd = source.indexOf(')', parenStart);
  const params = source.slice(parenStart + 1, parenEnd);
  const braceStart = source.indexOf('{', parenEnd);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return `${isAsync ? 'async ' : ''}function ${methodName}(${params}) ${source.slice(braceStart, i + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

test('download percent keeps native Xet progress below one percent visible', () => {
  const formatDownloadPercent = eval(`(${extractMethod(renderFormatMethodsSource, 'formatDownloadPercent')})`);

  assert.equal(formatDownloadPercent(0), '0');
  assert.equal(formatDownloadPercent(0.04), '<0.1');
  assert.equal(formatDownloadPercent(0.75), '0.8');
  assert.equal(formatDownloadPercent(7), '7');
  assert.equal(formatDownloadPercent(10.4), '10');
});

test('native Xet ETA uses network bytes against the known final file size', () => {
  const formatDuration = eval(`(${extractMethod(renderFormatMethodsSource, 'formatDuration')})`);
  const getDownloadEtaText = eval(`(${extractMethod(renderFormatMethodsSource, 'getDownloadEtaText')})`);
  const dialog = { formatDuration };

  assert.equal(getDownloadEtaText.call(dialog, {
    download_backend: 'huggingface_xet',
    total_size: 10_000,
    downloaded: 2_000,
    transfer_total_size: 400,
    transfer_downloaded: 100,
    speed: 10
  }), 'ETA 16m 30s');

  assert.equal(getDownloadEtaText.call(dialog, {
    download_backend: 'python',
    total_size: 400,
    downloaded: 100,
    speed: 10
  }), 'ETA 30s');
});

test('native Xet progress bar uses live network bytes against the known final file size', () => {
  const getDownloadDisplayProgress = eval(`(${extractMethod(renderFormatMethodsSource, 'getDownloadDisplayProgress')})`);

  assert.deepEqual(getDownloadDisplayProgress({
    download_backend: 'huggingface_xet',
    total_size: 10_000,
    downloaded: 2_000,
    progress: 20,
    transfer_total_size: 400,
    transfer_downloaded: 100,
    transfer_progress: 25
  }), {
    percent: 1,
    downloaded: 100,
    totalSize: 10_000,
    isTransfer: true,
    isFinalizing: false
  });

  assert.equal(getDownloadDisplayProgress({
    download_backend: 'huggingface_xet',
    total_size: 10_000,
    downloaded: 9_000,
    progress: 90,
    transfer_total_size: 400,
    transfer_downloaded: 400,
    transfer_progress: 100
  }).isFinalizing, true);

  assert.equal(getDownloadDisplayProgress({
    download_backend: 'python',
    total_size: 10_000,
    downloaded: 2_000,
    progress: 20
  }).percent, 20);
});

test('base model alias resolves FLUX KREA as Flux.1 Krea', () => {
  const normalizeBaseModelToken = eval(`(${extractMethod(searchPanelMethodsSource, 'normalizeBaseModelToken')})`);
  const getBaseModelTokenVariants = eval(`(${extractMethod(searchPanelMethodsSource, 'getBaseModelTokenVariants')})`);
  const resolveBaseModelAliasExact = eval(`(${extractMethod(searchPanelMethodsSource, 'resolveBaseModelAliasExact')})`);
  const resolveBaseModelAlias = eval(`(${extractMethod(searchPanelMethodsSource, 'resolveBaseModelAlias')})`);
  const dialog = {
    baseModels: {
      base_models: [
        { name: 'Flux.1 Krea', aliases: ['Flux.1 Krea', 'flux 1 krea'] },
        { name: 'Krea 2', aliases: ['krea', 'krea 2'] }
      ]
    },
    normalizeBaseModelToken,
    getBaseModelTokenVariants,
    resolveBaseModelAliasExact,
    resolveBaseModelAlias,
    getBaseModelAliases() {
      return this.baseModels.base_models.map(model => ({
        value: model.name,
        aliases: model.aliases || []
      }));
    }
  };

  assert.equal(resolveBaseModelAlias.call(dialog, 'FLUX KREA'), 'Flux.1 Krea');
  assert.equal(resolveBaseModelAlias.call(dialog, 'KREA'), 'Krea 2');
});

test('auto base model uses Any model for standalone SAM and Ultralytics models', () => {
  const getBaseModelIndependentSearchType = eval(`(${extractMethod(searchPanelMethodsSource, 'getBaseModelIndependentSearchType')})`);
  const getMissingAutoBaseModelInfo = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAutoBaseModelInfo')})`);
  const getMissingAutoBaseModel = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAutoBaseModel')})`);
  const getSearchBaseModelLabel = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchBaseModelLabel')})`);
  const getSearchBaseModelContext = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchBaseModelContext')})`);
  const state = { selectedBaseModel: 'auto' };
  const dialog = {
    getBaseModelIndependentSearchType,
    getMissingAutoBaseModelInfo,
    getMissingAutoBaseModel,
    getSearchBaseModelLabel,
    getSearchBaseModelContext,
    getSearchState() {
      return state;
    },
    getDefaultSearchBaseModel() {
      return 'auto';
    },
    getDominantWorkflowBaseModel() {
      return 'SDXL 1.0';
    }
  };

  for (const missing of [
    { category: 'sams', node_type: 'SAMLoader' },
    { category: 'ultralytics', node_type: 'UltralyticsDetectorProvider' }
  ]) {
    assert.equal(getMissingAutoBaseModel.call(dialog, missing), '');
    assert.equal(getSearchBaseModelLabel.call(dialog, 'auto', missing), 'Auto (Any model)');
    assert.equal(getSearchBaseModelContext.call(dialog, missing), '');
    assert.match(getMissingAutoBaseModelInfo.call(dialog, missing).message, /Selected automatically: Any model/);
    assert.match(getMissingAutoBaseModelInfo.call(dialog, missing).message, /no model filter is needed/);
  }

  state.selectedBaseModel = 'SDXL 1.0';
  assert.equal(
    getSearchBaseModelContext.call(dialog, { category: 'sams' }),
    'SDXL 1.0',
    'Manual base model selection should remain available'
  );
});

test('auto base model keeps workflow path context when a delayed search result disagrees', () => {
  const getMissingAutoBaseModelInfo = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAutoBaseModelInfo')})`);
  const missing = {
    original_path: 'KREA2\\KNPV3_1.safetensors',
    civitai_search_result: { base_model: 'Flux.1 D' }
  };
  const dialog = {
    getBaseModelIndependentSearchType() {
      return '';
    },
    getCachedSearchSuggestionData() {
      return { base_model: 'Flux.1 D' };
    },
    getSavedDownloadTargetSelection() {
      return {
        subfolder: 'FLUX',
        subfolderTouched: false,
        subfolderSuggestionAppliedBy: 'auto'
      };
    },
    getMissingLocalBaseModel() {
      return '';
    },
    resolveBaseModelAlias(value = '') {
      if (value === 'Flux.1 D') return 'Flux.1 D';
      if (value === 'Krea 2') return 'Krea 2';
      return '';
    },
    resolveBaseModelAliasExact(value = '') {
      return this.resolveBaseModelAlias(value);
    },
    resolveBaseModelAliasFromPath(value = '') {
      return /(^|[\\/])KREA2([\\/]|$)/i.test(String(value)) ? 'Krea 2' : '';
    },
    getDominantWorkflowBaseModel() {
      return 'Flux.1 D';
    }
  };

  const info = getMissingAutoBaseModelInfo.call(dialog, missing);

  assert.equal(info.value, 'Krea 2');
  assert.equal(info.source, 'missing model path');
  assert.match(info.message, /Selected automatically: Krea 2/);
  assert.match(info.message, /Why: The model path saved in this workflow/);
  assert.match(info.message, /To change: Choose a different option in the Model field/);
});

test('base model path mapping ignores conflicting full-path base model', () => {
  const normalizeBaseModelToken = eval(`(${extractMethod(searchPanelMethodsSource, 'normalizeBaseModelToken')})`);
  const getBaseModelTokenVariants = eval(`(${extractMethod(searchPanelMethodsSource, 'getBaseModelTokenVariants')})`);
  const resolveBaseModelAliasExact = eval(`(${extractMethod(searchPanelMethodsSource, 'resolveBaseModelAliasExact')})`);
  const resolveBaseModelAlias = eval(`(${extractMethod(searchPanelMethodsSource, 'resolveBaseModelAlias')})`);
  const isBaseModelPathMappingCompatible = eval(`(${extractMethod(downloadTargetMethodsSource, 'isBaseModelPathMappingCompatible')})`);
  const resolveBaseModelPathMapping = eval(`(${extractMethod(downloadTargetMethodsSource, 'resolveBaseModelPathMapping')})`);
  const dialog = {
    baseModels: {
      base_models: [
        { name: 'Flux.1 Krea', aliases: ['Flux.1 Krea', 'flux 1 krea'] },
        { name: 'Krea 2', aliases: ['krea', 'krea 2'] },
        { name: 'Pony', aliases: ['pony', 'ponyxl'] },
        { name: 'SDXL 1.0', aliases: ['sdxl', 'sdxl10'] }
      ]
    },
    normalizeBaseModelToken,
    getBaseModelTokenVariants,
    resolveBaseModelAliasExact,
    resolveBaseModelAlias,
    isBaseModelPathMappingCompatible,
    resolveBaseModelPathMapping,
    getBaseModelAliases() {
      return this.baseModels.base_models.map(model => ({
        value: model.name,
        aliases: model.aliases || []
      }));
    }
  };

  assert.equal(
    resolveBaseModelPathMapping.call(dialog, 'Krea 2', { 'Krea 2': 'FLUX/KREA' }),
    'Krea 2'
  );
  assert.equal(
    resolveBaseModelPathMapping.call(dialog, 'Pony', { Pony: 'SDXL/Pony' }),
    'SDXL/Pony'
  );
});

test('download subfolder tooltip explains automatic suggestion source', () => {
  const getDownloadSubfolderTooltip = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderTooltip')})`);
  const getDownloadSubfolderSuggestionReason = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderSuggestionReason')})`);
  const getSavedDownloadSubfolderSuggestion = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSavedDownloadSubfolderSuggestion')})`);
  const getCurrentDownloadSubfolderSuggestion = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCurrentDownloadSubfolderSuggestion')})`);
  const normalizeDownloadSubfolderPath = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadSubfolderPath')})`);

  const dialog = {
    getDownloadSubfolderTooltip,
    getDownloadSubfolderSuggestionReason,
    getSavedDownloadSubfolderSuggestion,
    getCurrentDownloadSubfolderSuggestion,
    normalizeDownloadSubfolderPath,
    normalizePathToBackward(value) {
      return String(value || '').replace(/[\/]+/g, '\\');
    },
    normalizeDownloadCategory(value) {
      return String(value || 'checkpoints');
    },
    getCategoryDisplayName(value) {
      return value === 'loras' ? 'lora' : value;
    },
    getSavedDownloadTargetSelection() {
      return null;
    },
    getDownloadPathMode() {
      return 'suggested';
    },
    isAutoFillSubfolderEnabled() {
      return true;
    },
    getAvailableSubfolders() {
      return [];
    },
    getSuggestedDownloadSubfolder() {
      return {
        value: 'SDXL\\Style',
        baseDirectory: '',
        suggestionSource: 'lora_metadata',
        matchedBaseModel: 'SDXL',
        matchedTag: 'style'
      };
    }
  };

  const tooltip = getDownloadSubfolderTooltip.call(dialog, { node_id: 1 }, 'loras', 'SDXL/Style');

  assert.match(tooltip, /Suggested subfolder: SDXL\\Style/);
  assert.match(tooltip, /identified as SDXL and tagged/);
});

test('download subfolder tooltip identifies a folder taken from the workflow model path', () => {
  const getDownloadSubfolderSuggestionReason = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderSuggestionReason')})`);
  const dialog = {
    normalizeFolderToken(value = '') {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    }
  };

  const reason = getDownloadSubfolderSuggestionReason.call(dialog, {
    suggestionSource: 'model_name',
    matchedCandidate: 'KREA2'
  }, {
    original_path: 'KREA2\\KNPV3_1.safetensors'
  });

  assert.match(reason, /model path saved in this workflow.*folder.*KREA2/);
});

test('download subfolder tooltip explains Suggest button choice', () => {
  const getDownloadSubfolderTooltip = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderTooltip')})`);
  const getDownloadSubfolderSuggestionReason = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadSubfolderSuggestionReason')})`);
  const getSavedDownloadSubfolderSuggestion = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSavedDownloadSubfolderSuggestion')})`);
  const getCurrentDownloadSubfolderSuggestion = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCurrentDownloadSubfolderSuggestion')})`);
  const normalizeDownloadSubfolderPath = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadSubfolderPath')})`);
  const saved = {
    subfolder: 'Pony\\Styles',
    subfolderBaseDirectory: '',
    subfolderTouched: true,
    subfolderSuggestionSource: 'template',
    subfolderSuggestionAppliedBy: 'button',
    subfolderSuggestionTemplate: '{base_model}/{first_tag}'
  };

  const dialog = {
    getDownloadSubfolderTooltip,
    getDownloadSubfolderSuggestionReason,
    getSavedDownloadSubfolderSuggestion,
    getCurrentDownloadSubfolderSuggestion,
    normalizeDownloadSubfolderPath,
    normalizePathToBackward(value) {
      return String(value || '').replace(/[\/]+/g, '\\');
    },
    normalizeDownloadCategory(value) {
      return String(value || 'checkpoints');
    },
    getCategoryDisplayName(value) {
      return value;
    },
    getSavedDownloadTargetSelection() {
      return saved;
    },
    getDownloadPathMode() {
      return 'suggested';
    },
    isAutoFillSubfolderEnabled() {
      return true;
    }
  };

  const tooltip = getDownloadSubfolderTooltip.call(dialog, { node_id: 1 }, 'loras', 'Pony\\Styles', { saved });

  assert.match(tooltip, /Selected with Suggest: Pony\\Styles/);
  assert.match(tooltip, /saved folder rule.*\{base_model\}\/\{first_tag\}/);
});

test('post-search subfolder suggestion can prefer path template metadata', () => {
  const getSuggestedDownloadSubfolder = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSuggestedDownloadSubfolder')})`);
  const calls = [];
  const dialog = {
    getSuggestedDownloadSubfolder,
    getDownloadPathMode() {
      return 'suggested';
    },
    getFolderSuggestionEntries() {
      return [{ value: 'SDXL', normalizedSegments: ['sdxl'], segments: ['SDXL'] }];
    },
    getTemplateSubfolderSuggestionFromMetadata() {
      calls.push('template');
      return { value: 'SDXL\\style', suggestionSource: 'template' };
    },
    getSuggestedLoraSubfolder() {
      calls.push('lora');
      return { value: 'SDXL', suggestionSource: 'lora_metadata' };
    },
    getSuggestedExistingSubfolderByModelName() {
      calls.push('name');
      return null;
    }
  };

  const normalSuggestion = getSuggestedDownloadSubfolder.call(dialog, {}, 'loras', []);
  const searchSuggestion = getSuggestedDownloadSubfolder.call(dialog, {}, 'loras', [], { preferTemplate: true });

  assert.equal(normalSuggestion.value, 'SDXL');
  assert.equal(searchSuggestion.value, 'SDXL\\style');
});

test('post-search auto-fill can refresh earlier suggested subfolder', async () => {
  const applySuggestedDownloadSubfolder = eval(`(${extractMethod(downloadTargetMethodsSource, 'applySuggestedDownloadSubfolder')})`);
  const getSubfolderSuggestionTrackingPatch = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSubfolderSuggestionTrackingPatch')})`);
  const saved = {
    category: 'loras',
    subfolder: 'SDXL',
    subfolderBaseDirectory: '',
    subfolderTouched: true,
    subfolderSuggestionAppliedBy: 'button'
  };
  const saves = [];
  const categoryEl = { dataset: { value: 'loras' } };
  const subfolderEl = { value: 'SDXL', dataset: { baseDirectory: '' } };
  const dialog = {
    applySuggestedDownloadSubfolder,
    getSubfolderSuggestionTrackingPatch,
    isAutoFillSubfolderEnabled() {
      return true;
    },
    normalizeDownloadCategory(value) {
      return String(value || '');
    },
    getDropdownValue(element) {
      return element.dataset.value;
    },
    getSuggestedDownloadCategory() {
      return 'loras';
    },
    shouldPreserveSavedDownloadCategory() {
      return false;
    },
    getSavedDownloadTargetSelection() {
      return saved;
    },
    async ensureDownloadSubfoldersLoaded() {},
    getAvailableSubfolders() {
      return [];
    },
    getSuggestedDownloadSubfolder(_missing, _category, _folders, options) {
      assert.equal(options.preferTemplate, true);
      return {
        value: 'SDXL\\style',
        baseDirectory: '',
        suggestionSource: 'template',
        template: '{base_model}/{first_tag}'
      };
    },
    saveDownloadTargetSelection(_missing, patch) {
      saves.push(patch);
      Object.assign(saved, patch);
    },
    syncDownloadTargetFolderContext() {}
  };

  await applySuggestedDownloadSubfolder.call(dialog, {}, categoryEl, subfolderEl, {
    allowSuggestedRefresh: true,
    preferTemplate: true
  });

  assert.equal(subfolderEl.value, 'SDXL\\style');
  assert.equal(saves.at(-1).subfolderSuggestionSource, 'template');
});

test('search suggestion metadata prefers exact matching base model over weaker archive result', () => {
  const getCachedSearchSuggestionData = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCachedSearchSuggestionData')})`);
  const getFirstSearchResult = eval(`(${extractMethod(downloadTargetMethodsSource, 'getFirstSearchResult')})`);
  const getSearchSuggestionPreferredBaseModel = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSearchSuggestionPreferredBaseModel')})`);
  const baseModelMatchesSearchSuggestionPreference = eval(`(${extractMethod(downloadTargetMethodsSource, 'baseModelMatchesSearchSuggestionPreference')})`);
  const getSearchSuggestionResultScore = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSearchSuggestionResultScore')})`);
  const state = {
    selectedBaseModel: 'auto',
    results: {
      civitai: {
        base_model: 'Krea 2',
        tags: ['style'],
        filename: 'snofs_krea_v1.safetensors',
        name: 'Sex, Nudes, Other Fun Stuff (SNOFS)',
        match_type: 'exact',
        confidence: 100
      },
      lora_manager_archive: {
        base_model: 'SD 1.5',
        tags: ['concept'],
        filename: 'hyperpreg_v1.safetensors',
        name: 'hyperpreg',
        match_type: 'similar',
        confidence: 85
      }
    }
  };
  const dialog = {
    searchResultCache: new Map([['missing-key', state]]),
    getCachedSearchSuggestionData,
    getFirstSearchResult,
    getSearchSuggestionPreferredBaseModel,
    baseModelMatchesSearchSuggestionPreference,
    getSearchSuggestionResultScore,
    getMissingSearchKey() {
      return 'missing-key';
    },
    getMissingLocalBaseModel() {
      return 'Krea 2';
    },
    normalizeBaseModelToken(value = '') {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    },
    resolveBaseModelAlias(value = '') {
      const token = this.normalizeBaseModelToken(value);
      if (token === 'krea2') return 'Krea 2';
      if (token === 'sd15' || token === 'sd15' || token === 'sd1 5'.replace(/[^a-z0-9]+/g, '')) return 'SD 1.5';
      if (token === 'sd15' || token === 'sd15' || token === 'sd1.5'.replace(/[^a-z0-9]+/g, '')) return 'SD 1.5';
      return '';
    },
    resolveBaseModelAliasExact(value = '') {
      return this.resolveBaseModelAlias(value);
    },
    getSourceResultDownloadCategory() {
      return 'loras';
    }
  };

  const merged = getCachedSearchSuggestionData.call(dialog, {
    category: 'loras',
    civitai_search_result: { base_model: 'Krea 2' }
  });

  assert.equal(merged.base_model, 'Krea 2');
  assert.deepEqual(merged.tags, ['style']);
  assert.equal(merged.filename, 'snofs_krea_v1.safetensors');
});

test('manual URL download metadata never inherits provider identity or hash from search results', () => {
  const getDownloadMetadata = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadMetadata')})`);
  const staleHash = 'a'.repeat(64);
  const exactHash = 'b'.repeat(64);
  const missing = {
    original_path: 'QWEN\\qwen3-vl-4b-heretic_int8.safetensors',
    category: 'text_encoders',
    civitai_info: {
      source: 'civarchive',
      model_id: 100,
      version_id: 200,
      sha256: staleHash,
      hashes: { SHA256: staleHash },
      civitai: { modelId: 100, id: 200 }
    },
    download_source: {
      source: 'civarchive',
      model_id: 100,
      version_id: 200,
      sha256: staleHash
    }
  };
  const source = {
    source: 'huggingface',
    details_source: 'huggingface',
    model_id: 'DreamFast/Qwen3-VL-4b-Heretic-ComfyUI',
    filename: 'qwen3-vl-4b-heretic_int8.safetensors',
    download_url: 'https://huggingface.co/DreamFast/repo/resolve/main/model.safetensors',
    version_url: 'https://huggingface.co/DreamFast/repo/blob/main/model.safetensors',
    provided_url: 'https://huggingface.co/DreamFast/repo/blob/main/model.safetensors',
    custom_url: true,
    url_source: 'custom',
    match_type: 'custom_url',
    sha256: exactHash,
    hashes: { SHA256: exactHash }
  };
  const dialog = {
    getCachedSearchSuggestionData() {
      throw new Error('manual URL must not read cached search metadata');
    },
    getCompatibleCivitaiSearchResult() {
      throw new Error('manual URL must not read cached CivitAI metadata');
    },
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    }
  };

  const metadata = getDownloadMetadata.call(dialog, missing, source, {
    filename: source.filename,
    category: 'text_encoders',
    url: source.download_url,
    openUrl: source.version_url,
    pathMetadata: {
      filename: source.filename,
      category: 'text_encoders'
    }
  });

  assert.equal(metadata.source, 'huggingface');
  assert.equal(metadata.model_id, 'DreamFast/Qwen3-VL-4b-Heretic-ComfyUI');
  assert.equal(metadata.version_id, '');
  assert.equal(metadata.sha256, exactHash);
  assert.deepEqual(metadata.hashes, { SHA256: exactHash });
  assert.equal(metadata.custom_url, true);
  assert.equal(metadata.url_source, 'custom');
  assert.equal(metadata.provided_url, source.provided_url);
  assert.equal('civitai' in metadata, false);
});

test('manual URL table row preserves the explicit provenance boundary', () => {
  const getCustomUrlResultTableRow = eval(`(${extractMethod(searchPanelMethodsSource, 'getCustomUrlResultTableRow')})`);
  const result = {
    source: 'huggingface',
    model_id: 'DreamFast/Qwen3-VL-4b-Heretic-ComfyUI',
    filename: 'qwen3-vl-4b-heretic_int8.safetensors',
    download_url: 'https://huggingface.co/DreamFast/repo/resolve/main/model.safetensors',
    page_url: 'https://huggingface.co/DreamFast/repo/blob/main/model.safetensors',
    provided_url: 'https://huggingface.co/DreamFast/repo/blob/main/model.safetensors',
    custom_url: true
  };
  const dialog = {
    getFilenameFromPath(value = '') {
      return String(value).split(/[\\/]/).at(-1) || '';
    },
    getMissingDownloadCategory() {
      return 'text_encoders';
    },
    getSourceResultDownloadCategory() {
      return 'text_encoders';
    },
    getMissingModelKey() {
      return 'missing-key';
    },
    getLocalHashMatchIdentitiesForResult() {
      return [];
    },
    getHashMatchLabelForSearchResult() {
      return '';
    },
    getSearchResultMatchDisplay() {
      return { label: 'Provided', className: 'strong' };
    },
    formatSearchResultSize() {
      return '';
    },
    getSearchResultTimestamp() {
      return '';
    }
  };

  const row = getCustomUrlResultTableRow.call(dialog, {
    original_path: result.filename,
    category: 'text_encoders'
  }, result);

  assert.equal(row.detailsContext.custom_url, true);
  assert.equal(row.detailsContext.url_source, 'custom');
  assert.equal(row.detailsContext.provided_url, result.provided_url);
  assert.equal(row.detailsContext.source, 'huggingface');
});

test('search suggestion does not let a delayed incompatible result replace workflow path context', () => {
  const getCachedSearchSuggestionData = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCachedSearchSuggestionData')})`);
  const getFirstSearchResult = eval(`(${extractMethod(downloadTargetMethodsSource, 'getFirstSearchResult')})`);
  const getSearchSuggestionPreferredBaseModel = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSearchSuggestionPreferredBaseModel')})`);
  const baseModelMatchesSearchSuggestionPreference = eval(`(${extractMethod(downloadTargetMethodsSource, 'baseModelMatchesSearchSuggestionPreference')})`);
  const getCompatibleCivitaiSearchResult = eval(`(${extractMethod(downloadTargetMethodsSource, 'getCompatibleCivitaiSearchResult')})`);
  const getSearchSuggestionResultScore = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSearchSuggestionResultScore')})`);
  const state = {
    selectedBaseModel: 'auto',
    results: {
      civitai: {
        base_model: 'Flux.1 D',
        filename: 'KNPV3_1.safetensors',
        match_type: 'similar',
        confidence: 80
      }
    }
  };
  const dialog = {
    searchResultCache: new Map([['missing-key', state]]),
    getCachedSearchSuggestionData,
    getFirstSearchResult,
    getSearchSuggestionPreferredBaseModel,
    baseModelMatchesSearchSuggestionPreference,
    getCompatibleCivitaiSearchResult,
    getSearchSuggestionResultScore,
    getMissingSearchKey() {
      return 'missing-key';
    },
    getSavedDownloadTargetSelection() {
      return null;
    },
    getMissingLocalBaseModel() {
      return '';
    },
    resolveBaseModelAliasFromPath(value = '') {
      return /(^|[\\/])KREA2([\\/]|$)/i.test(String(value)) ? 'Krea 2' : '';
    },
    normalizeBaseModelToken(value = '') {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    },
    resolveBaseModelAlias(value = '') {
      const token = this.normalizeBaseModelToken(value);
      if (token === 'krea2') return 'Krea 2';
      if (token === 'flux1d') return 'Flux.1 D';
      return '';
    },
    resolveBaseModelAliasExact(value = '') {
      return this.resolveBaseModelAlias(value);
    },
    getSourceResultDownloadCategory() {
      return 'loras';
    }
  };
  const missing = {
    category: 'loras',
    original_path: 'KREA2\\KNPV3_1.safetensors',
    civitai_search_result: { base_model: 'Flux.1 D' }
  };

  assert.equal(getSearchSuggestionPreferredBaseModel.call(dialog, missing), 'Krea 2');
  assert.deepEqual(getCompatibleCivitaiSearchResult.call(dialog, missing), {});
  assert.deepEqual(getCachedSearchSuggestionData.call(dialog, missing), {});
});

test('subfolder suggestion ignores hidden local matches below the visible confidence threshold', () => {
  const getSuggestedModelSubfolderCandidates = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSuggestedModelSubfolderCandidates')})`);
  const getSuggestedExistingSubfolderByModelName = eval(`(${extractMethod(downloadTargetMethodsSource, 'getSuggestedExistingSubfolderByModelName')})`);
  const dialog = {
    getSuggestedModelSubfolderCandidates,
    getSuggestedExistingSubfolderByModelName,
    getBestLocalMatch(missing, minConfidence) {
      return (missing.matches || [])
        .filter(match => Number(match.confidence) >= minConfidence)
        .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0] || null;
    },
    getCompatibleCivitaiSearchResult() {
      return {};
    },
    getCachedSearchSuggestionData() {
      return {};
    },
    normalizeFolderToken(value = '') {
      return String(value || '')
        .toLowerCase()
        .replace(/[\\/]+/g, ' ')
        .replace(/[^a-z0-9]+/g, '');
    }
  };
  const missing = {
    original_path: 'KNPV3_1.safetensors',
    name: 'KNPV3_1.safetensors',
    matches: [{
      confidence: 55,
      model: {
        filename: 'KNPV4.1_pre.safetensors',
        relative_path: 'FLUX\\KREA\\concept\\KNPV4.1_pre.safetensors'
      }
    }]
  };
  const folders = [{
    value: 'FLUX',
    segments: ['FLUX'],
    normalizedSegments: ['flux']
  }];

  const candidates = getSuggestedModelSubfolderCandidates.call(dialog, missing);
  const suggestion = getSuggestedExistingSubfolderByModelName.call(dialog, missing, folders);

  assert.equal(candidates.some(candidate => candidate.normalized === 'flux'), false);
  assert.equal(suggestion, null);
});

test('auto-link 100 percent applies visible exact matches without re-analyzing', async () => {
  const autoResolve100Percent = eval(`(${extractMethod(resolveDownloadMethodsSource, 'autoResolve100Percent')})`);
  const getExactLocalMatchSelections = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getExactLocalMatchSelections')})`);
  const buildResolutionSelection = eval(`(${extractMethod(queueMethodsSource, 'buildResolutionSelection')})`);
  const getResolutionNodeRefs = eval(`(${extractMethod(queueMethodsSource, 'getResolutionNodeRefs')})`);
  const getResolutionQueueKey = eval(`(${extractMethod(queueMethodsSource, 'getResolutionQueueKey')})`);

  const exactModel = {
    path: 'E:/AI/models/checkpoints/exact.safetensors',
    filename: 'exact.safetensors',
    relative_path: 'exact.safetensors'
  };
  const missing = {
    node_id: 7,
    widget_index: 0,
    original_path: 'missing.safetensors',
    filename: 'missing.safetensors',
    category: 'checkpoints',
    matches: [{ confidence: 100, model: exactModel }]
  };
  const calls = [];
  const currentWorkflow = { nodes: [{ id: 7 }] };
  const updatedWorkflow = { nodes: [{ id: 7 }] };
  const dialog = {
    missingModels: [missing],
    cachedAnalysisData: null,
    cachedWorkflowSignature: 'current-signature',
    activeWorkflowSignature: 'current-signature',
    getExactLocalMatchSelections,
    buildResolutionSelection,
    getResolutionNodeRefs,
    getResolutionQueueKey,
    isVisible() {
      return true;
    },
    getCurrentWorkflow() {
      return currentWorkflow;
    },
    getWorkflowSignature(workflow) {
      assert.equal(workflow, currentWorkflow);
      return 'current-signature';
    },
    getBestLocalMatch(model, minConfidence) {
      return (model.matches || []).find(match => Number(match.confidence || 0) >= minConfidence) || null;
    },
    getMissingModelKey(model) {
      return `${model.node_id}:${model.widget_index}:${model.original_path}`;
    },
    getMissingSearchKey(model) {
      return `search:${model.original_path}`;
    },
    closeFooterMenus() {
      calls.push({ type: 'closeFooterMenus' });
    },
    async applyPendingResolutionList(list, options) {
      calls.push({ type: 'applyPendingResolutionList', list, options });
      return updatedWorkflow;
    },
    async fetchJson(url) {
      calls.push({ type: 'fetchJson', url });
      throw new Error('Auto-link should not analyze when current missing models are available');
    },
    showNotification(message, type) {
      calls.push({ type: 'notification', message, notificationType: type });
    }
  };

  const result = await autoResolve100Percent.call(dialog);
  const applyCall = calls.find(call => call.type === 'applyPendingResolutionList');

  assert.equal(result, updatedWorkflow);
  assert.ok(applyCall, 'Expected auto-link to delegate to applyPendingResolutionList');
  assert.equal(applyCall.list.length, 1);
  assert.equal(applyCall.list[0].resolved_path, exactModel.path);
  assert.deepEqual(applyCall.options, { clearAll: false });
  assert.equal(calls.some(call => call.type === 'fetchJson' && call.url === '/model_resolver/analyze'), false);
});

test('downloads tab shows active downloads from all workflow tabs', () => {
  const getActiveQueuePanelDownloads = eval(`(${extractMethod(queueMethodsSource, 'getActiveQueuePanelDownloads')})`);

  const dialog = {
    activeDownloads: {
      currentWorkflowDownload: {
        missing: { node_id: 7, widget_index: 0, original_path: 'current.safetensors', category: 'checkpoints' },
        workflowKey: '#workflow-a\nold-signature',
        workflowRouteKey: '#workflow-a',
      },
      otherWorkflowDownload: {
        missing: { node_id: 8, widget_index: 0, original_path: 'other.safetensors', category: 'loras' },
        workflowKey: '#workflow-b\nsignature',
        workflowRouteKey: '#workflow-b',
      },
      invalidEntryWithoutMissing: {
        workflowRouteKey: '#workflow-c',
      },
    },
    missingModels: [],
    activeWorkflowRouteKey: '#workflow-a',
    getActiveWorkflowRouteKey() {
      return '#workflow-a';
    },
    getWorkflowScopedQueueKey() {
      return '#workflow-a\nnew-signature-after-link';
    },
  };

  const downloads = getActiveQueuePanelDownloads.call(dialog);

  assert.deepEqual(downloads.map(download => download.downloadId), [
    'currentWorkflowDownload',
    'otherWorkflowDownload',
  ]);
});

test('downloads tab renders workflow label for active downloads', () => {
  const renderQueueDownloadsHtml = eval(`(${extractMethod(queueMethodsSource, 'renderQueueDownloadsHtml')})`);
  const dialog = {
    escapeHtml(value) {
      return String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    },
    formatBytes(value) {
      return `${value} B`;
    },
    getCategoryDisplayName(value) {
      return value;
    },
    getDownloadWorkflowLabel(info) {
      return info.workflowLabel || 'Workflow B';
    },
    getDownloadFolderContext() {
      return null;
    },
    getDownloadDisplayProgress(progress) {
      return {
        percent: progress.progress || 0,
        downloaded: progress.downloaded || 0,
        totalSize: progress.total_size || 0,
        isFinalizing: false,
      };
    },
    formatDownloadProgressMeta() {
      return '';
    },
    getDownloadQueueContext() {
      return null;
    },
  };

  const html = renderQueueDownloadsHtml.call(dialog, [{
    downloadId: 'download-1',
    info: {
      workflowLabel: 'Workflow B',
      missing: { node_id: 8, widget_index: 0, node_type: 'KSampler', category: 'loras' },
      lastProgress: { status: 'downloading', progress: 42, downloaded: 1024, total_size: 2048, filename: 'other.safetensors' },
    },
  }]);

  assert.match(html, /<span>Workflow<\/span>/);
  assert.match(html, /Workflow B/);
});

test('active download refresh preserves existing cards for hover and tooltip state', () => {
  const renderQueueDownloadsHtml = extractMethod(queueMethodsSource, 'renderQueueDownloadsHtml');

  assert.match(queueMethodsSource, /patchDownloadsPanelElement\(currentPanel, nextPanel\)/);
  assert.match(renderQueueDownloadsHtml, /data-download-id=/);
  assert.match(queueMethodsSource, /patchDownloadsPanelElement\(currentElement, nextElement\)/);
});

test('automatic opening for missing models is disabled by default', () => {
  const isAutoOpenEnabled = eval(`(${extractMethod(modelResolverSource, 'isAutoOpenEnabled')})`);
  const previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const setStoredValue = value => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => value },
    });
  };

  try {
    setStoredValue(null);
    assert.equal(isAutoOpenEnabled(), false);

    setStoredValue('false');
    assert.equal(isAutoOpenEnabled(), false);

    setStoredValue('true');
    assert.equal(isAutoOpenEnabled(), true);
  } finally {
    if (previousLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousLocalStorageDescriptor);
    } else delete globalThis.localStorage;
  }
});

test('automatic opening remains conditional on unresolved models', () => {
  assert.match(
    modelResolverSource,
    /if \(data\.total_missing > 0\) \{[\s\S]*?this\.openResolverForDetectedMissingModels\(\);/
  );
  assert.match(optionsMethodsSource, /id="mr-options-auto-open-on-missing"/);
  assert.match(optionsMethodsSource, /auto_open_on_missing: Boolean\(autoOpenOnMissingInput\?\.checked\)/);
});

test('automatic opening preserves the current resolver display mode', () => {
  const openResolverForDetectedMissingModels = eval(`(${extractMethod(modelResolverSource, 'openResolverForDetectedMissingModels')})`);
  const refreshReasons = [];
  let activationCount = 0;
  const visibleResolver = {
    dialog: {
      isVisible: () => true,
      scheduleActiveWorkflowRefresh: reason => refreshReasons.push(reason),
    },
    activateResolverButton() {
      activationCount += 1;
    },
  };

  openResolverForDetectedMissingModels.call(visibleResolver);
  assert.equal(activationCount, 0);
  assert.deepEqual(refreshReasons, ['auto-open-missing-models']);

  const hiddenResolver = {
    dialog: { isVisible: () => false },
    activateResolverButton() {
      activationCount += 1;
    },
  };
  openResolverForDetectedMissingModels.call(hiddenResolver);
  assert.equal(activationCount, 1);
});

test('active workflow label prefers selected ComfyUI workflow tab name over route hash', () => {
  const cleanWorkflowLabel = eval(`(${extractMethod(queueMethodsSource, 'cleanWorkflowLabel')})`);
  const getWorkflowLabelFromActiveTabElement = eval(`(${extractMethod(queueMethodsSource, 'getWorkflowLabelFromActiveTabElement')})`);
  const getWorkflowLabelFromRouteKey = eval(`(${extractMethod(queueMethodsSource, 'getWorkflowLabelFromRouteKey')})`);
  const getActiveWorkflowDownloadLabel = eval(`(${extractMethod(queueMethodsSource, 'getActiveWorkflowDownloadLabel')})`);

  const previousDocument = globalThis.document;
  const activeTab = {
    dataset: { workflowName: 'Real workflow name' },
    className: 'workflow-tab active',
    textContent: 'Wrong fallback text',
    closest(selector) {
      return selector.includes('#model-resolver-modal') ? null : null;
    },
    getAttribute(name) {
      return {
        'data-workflow-name': 'Real workflow name',
        title: 'Wrong title',
        'aria-label': 'Wrong aria',
        'data-workflow-id': 'wf-1',
        'data-tab-id': 'workflow-wf-1',
      }[name] || null;
    },
  };

  globalThis.document = {
    querySelectorAll(selector) {
      return selector === '[data-workflow-name][aria-selected="true"]' ? [activeTab] : [];
    },
  };

  try {
    const dialog = {
      activeWorkflowRouteKey: '#/workflow?workflow=technical-route-id',
      cleanWorkflowLabel,
      getWorkflowLabelFromComfyState() {
        return '';
      },
      findActiveWorkflowTabElement() {
        return { workflowLabel: 'Real workflow name' };
      },
      getWorkflowLabelFromActiveTabElement,
      getWorkflowLabelFromRouteKey,
      getActiveWorkflowRouteKey() {
        return '#/workflow?workflow=technical-route-id';
      },
    };

    assert.equal(getActiveWorkflowDownloadLabel.call(dialog), 'Real workflow name');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('download workflow label parses workflow name from stored workflow URL instead of placeholder', () => {
  const cleanWorkflowLabel = eval(`(${extractMethod(queueMethodsSource, 'cleanWorkflowLabel')})`);
  const getWorkflowLabelFromRouteKey = eval(`(${extractMethod(queueMethodsSource, 'getWorkflowLabelFromRouteKey')})`);
  const getDownloadWorkflowLabel = eval(`(${extractMethod(queueMethodsSource, 'getDownloadWorkflowLabel')})`);

  const dialog = {
    cleanWorkflowLabel,
    getWorkflowLabelFromRouteKey,
    getActiveWorkflowDownloadLabel() {
      return 'Active fallback should not be used';
    },
  };

  assert.equal(
    getDownloadWorkflowLabel.call(dialog, {
      workflowKey: '#/workflow/2026-01-30-16-00-06-531854442295357_00001_\nmutable-signature',
    }),
    '2026-01-30-16-00-06-531854442295357_00001_'
  );
  assert.notEqual(
    getDownloadWorkflowLabel.call(dialog, { workflowKey: '#/workflow/2026-01-30-16-00-06-531854442295357_00001_\nmutable-signature' }),
    'Workflow from download start'
  );
});

test('new download entries store workflow metadata for display', () => {
  assert.match(
    resolveDownloadMethodsSource,
    /const workflowRouteKey = (workflowContext\.workflowRouteKey \|\| )?this\.getActiveWorkflowRouteKey\?\.\(\) \|\| this\.activeWorkflowRouteKey \|\| '';/
  );
  assert.match(
    resolveDownloadMethodsSource,
    /const workflowLabel = (workflowContext\.workflowLabel \|\| )?this\.getActiveWorkflowDownloadLabel\?\.\(\) \|\| 'Current workflow';/
  );
  assert.match(resolveDownloadMethodsSource, /workflowKey,\s*\r?\n\s*workflowRouteKey,\s*\r?\n\s*workflowLabel/);
  assert.match(resolveDownloadMethodsSource, /workflowLabel: info\.workflowLabel/);
});

test('local hash matches replace lower-confidence duplicate local matches', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const getLocalMatchAbsolutePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchAbsolutePathIdentity')})`);
  const getLocalMatchRelativePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchRelativePathIdentity')})`);
  const getLocalMatchIdentityKeys = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentityKeys')})`);
  const getLocalMatchIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentity')})`);
  const canMergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'canMergeLocalMatches')})`);
  const isHashLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isHashLocalMatch')})`);
  const shouldReplaceLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'shouldReplaceLocalMatch')})`);
  const mergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'mergeLocalMatches')})`);

  const dialog = {
    normalizeLocalMatchPathIdentity,
    getLocalMatchAbsolutePathIdentity,
    getLocalMatchRelativePathIdentity,
    getLocalMatchIdentityKeys,
    getLocalMatchIdentity,
    canMergeLocalMatches,
    isHashLocalMatch,
    shouldReplaceLocalMatch,
  };
  const fuzzyMatch = {
    confidence: 87,
    match_type: 'fuzzy',
    model: {
      filename: 'same-model.safetensors',
      category: 'loras',
    },
  };
  const hashMatch = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    sha256: 'a'.repeat(64),
    model: {
      path: 'E:/Models/Loras/same-model.safetensors',
      relative_path: 'same-model.safetensors',
      filename: 'same-model.safetensors',
      category: 'loras',
    },
  };

  const merged = mergeLocalMatches.call(dialog, [fuzzyMatch], [hashMatch]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0], hashMatch);
});

test('active download local match survives a temporarily empty refresh', () => {
  const preserveActiveDownloadLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'preserveActiveDownloadLocalMatches')})`);
  const downloadingMatch = {
    confidence: 100,
    filename: 'model.safetensors',
    model: {
      filename: 'model.safetensors',
      relative_path: 'ANIMA/model.safetensors',
      path: 'C:/models/loras/ANIMA/model.safetensors',
      category: 'loras'
    }
  };
  const activeMissing = { search_key: 'missing-1', matches: [downloadingMatch] };
  const staleMissing = { search_key: 'old-missing', matches: [] };
  const dialog = {
    preserveActiveDownloadLocalMatches,
    activeDownloads: {
      'download-1': { missing: staleMissing }
    },
    getActiveDownloadEntriesForMissing() {
      // A full workflow refresh may replace the missing-model object and change
      // its state key even though the local path still matches the download.
      return [];
    },
    getActiveDownloadInfoForLocalMatch(match) {
      return match === downloadingMatch
        ? { download_id: 'download-1', download_status: 'downloading' }
        : null;
    },
    cloneLocalMatches(matches) {
      return matches.map(match => ({ ...match, model: { ...(match.model || {}) } }));
    },
    mergeLocalMatches(existing, restored) {
      const byPath = new Map();
      [...existing, ...restored].forEach(match => {
        byPath.set(match.model?.relative_path || match.filename, match);
      });
      return [...byPath.values()];
    }
  };

  const matches = preserveActiveDownloadLocalMatches.call(dialog, activeMissing, []);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].model.relative_path, 'ANIMA/model.safetensors');
  assert.equal(dialog.activeDownloads['download-1'].missing, activeMissing);
});

test('inactive local match is not preserved after an empty refresh', () => {
  const preserveActiveDownloadLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'preserveActiveDownloadLocalMatches')})`);
  const dialog = {
    preserveActiveDownloadLocalMatches,
    getActiveDownloadEntriesForMissing() {
      return [];
    }
  };

  const matches = preserveActiveDownloadLocalMatches.call(
    dialog,
    { matches: [{ confidence: 100, filename: 'old.safetensors' }] },
    []
  );

  assert.deepEqual(matches, []);
});

test('active download controls are scoped to the workflow that started them', () => {
  const getDownloadWorkflowScopeIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadWorkflowScopeIdentity')})`);
  const getCurrentDownloadWorkflowScopeIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getCurrentDownloadWorkflowScopeIdentity')})`);
  const isDownloadInCurrentWorkflowScope = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isDownloadInCurrentWorkflowScope')})`);
  const getDownloadMissingIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadMissingIdentity')})`);
  const getActiveDownloadEntryForMissing = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getActiveDownloadEntryForMissing')})`);
  const missing = { search_key: 'shared-model' };
  const dialog = {
    getDownloadWorkflowScopeIdentity,
    getCurrentDownloadWorkflowScopeIdentity,
    isDownloadInCurrentWorkflowScope,
    getDownloadMissingIdentity,
    getActiveDownloadEntryForMissing,
    activeWorkflowRouteKey: '#workflow-a',
    activeDownloads: {
      'download-a': { missing, workflowRouteKey: '#workflow-a' },
      'download-b': { missing, workflowRouteKey: '#workflow-b' }
    },
    getActiveWorkflowTabContext() {
      return { workflowRouteKey: this.activeWorkflowRouteKey };
    },
    getActiveWorkflowRouteKey() {
      return this.activeWorkflowRouteKey;
    },
    getWorkflowScopedQueueKey() {
      return `${this.activeWorkflowRouteKey}\nsignature`;
    },
    getMissingSearchKey(value) {
      return value.search_key;
    },
    getMissingModelKey(value) {
      return value.search_key;
    }
  };

  assert.equal(getActiveDownloadEntryForMissing.call(dialog, missing).downloadId, 'download-a');
  dialog.activeWorkflowRouteKey = '#workflow-b';
  assert.equal(getActiveDownloadEntryForMissing.call(dialog, missing).downloadId, 'download-b');
});

test('download snapshots with identical model keys remain separated by workflow', () => {
  const getDownloadWorkflowScopeIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadWorkflowScopeIdentity')})`);
  const getCurrentDownloadWorkflowScopeIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getCurrentDownloadWorkflowScopeIdentity')})`);
  const getDownloadMissingIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadMissingIdentity')})`);
  const getDownloadStateKey = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadStateKey')})`);
  const dialog = {
    getDownloadWorkflowScopeIdentity,
    getCurrentDownloadWorkflowScopeIdentity,
    getDownloadMissingIdentity,
    getDownloadStateKey,
    getMissingSearchKey(value) {
      return value.search_key;
    },
    getMissingModelKey(value) {
      return value.search_key;
    },
    getActiveWorkflowTabContext() {
      return { workflowRouteKey: '#workflow-current' };
    },
    getWorkflowScopedQueueKey() {
      return '#workflow-current\nsignature';
    }
  };
  const missing = { search_key: 'shared-model' };

  assert.notEqual(
    getDownloadStateKey.call(dialog, missing, { workflowRouteKey: '#workflow-a' }),
    getDownloadStateKey.call(dialog, missing, { workflowRouteKey: '#workflow-b' })
  );
});

test('pending cancelling state cannot be overwritten by stale downloading progress', () => {
  const applyPendingDownloadStatus = eval(`(${extractMethod(resolveDownloadMethodsSource, 'applyPendingDownloadStatus')})`);
  const info = {
    pendingDownloadStatus: 'cancelling',
    pendingDownloadStatusStartedAt: Date.now(),
    pendingDownloadStatusUntil: Date.now() + 30000
  };
  const dialog = {
    applyPendingDownloadStatus,
    clearPendingDownloadStatus(target) {
      delete target.pendingDownloadStatus;
    }
  };

  const progress = applyPendingDownloadStatus.call(dialog, info, {
    status: 'downloading',
    progress: 15,
    speed: 1024
  });

  assert.equal(progress.status, 'cancelling');
  assert.equal(progress.backend_status, 'downloading');
  assert.equal(progress.speed, 0);
});

test('progress polling explicitly handles cancelling as a non-interactive state', () => {
  assert.match(
    resolveDownloadMethodsSource,
    /else if \(progress\.status === 'cancelling'\)[\s\S]*?setTimeout\(\(\) => this\.pollDownloadProgress\(downloadId\), 500\)/
  );
  assert.match(
    resolveDownloadMethodsSource,
    /currentStatus === 'cancelling' \|\| currentStatus === 'cancelled'/
  );
});

test('native Xet progress polling refreshes every 200 milliseconds', () => {
  const getDownloadProgressPollDelay = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadProgressPollDelay')})`);

  assert.equal(getDownloadProgressPollDelay({ status: 'downloading', download_backend: 'huggingface_xet' }), 200);
  assert.equal(getDownloadProgressPollDelay({ status: 'downloading', download_backend: 'aria2' }), 1000);
  assert.equal(getDownloadProgressPollDelay({ status: 'paused', download_backend: 'huggingface_xet' }), 1500);
});

test('active download folder context opens the existing directory before the target file exists', () => {
  const getDownloadFolderContext = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getDownloadFolderContext')})`);
  const directory = 'E:\\ComfyUI\\models\\text_encoders\\QWEN\\test';
  const filePath = `${directory}\\model.safetensors`;
  const context = getDownloadFolderContext.call({}, {
    directory,
    path: filePath,
    filename: 'model.safetensors'
  }, {});

  assert.equal(context.open_path, directory);
  assert.equal(context.folder_path, directory);
  assert.equal(context.download_path, filePath);
});

test('cancelled download removes only its path-specific local match', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const isLocalMatchForDownloadTarget = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isLocalMatchForDownloadTarget')})`);
  const removeCancelledDownloadLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'removeCancelledDownloadLocalMatches')})`);
  const makeMatch = relativePath => ({
    confidence: 100,
    model: {
      path: `C:/models/diffusion_models/${relativePath}`,
      relative_path: relativePath,
      filename: 'anima_baseV10.safetensors',
      category: 'diffusion_models'
    }
  });
  const existingMatch = makeMatch('ANIMA/anime/anima_baseV10.safetensors');
  const cancelledMatch = makeMatch('ANIMA/test/anima_baseV10.safetensors');
  const missing = { matches: [existingMatch, cancelledMatch] };
  const cachedMissing = { matches: [existingMatch, cancelledMatch] };
  const info = {
    missing,
    filename: 'anima_baseV10.safetensors',
    subfolder: 'ANIMA/test',
    downloadPath: 'C:/models/diffusion_models/ANIMA/test/anima_baseV10.safetensors'
  };
  const dialog = {
    normalizeLocalMatchPathIdentity,
    isLocalMatchForDownloadTarget,
    removeCancelledDownloadLocalMatches,
    missingModels: [missing],
    cachedAnalysisData: { missing_models: [cachedMissing], resolved_models: [] },
    workflowAnalysisCaches: new Map(),
    getDownloadProgressStore() {
      return new Map();
    }
  };

  removeCancelledDownloadLocalMatches.call(dialog, info, {
    status: 'cancelled',
    filename: info.filename,
    path: info.downloadPath
  });

  assert.deepEqual(missing.matches, [existingMatch]);
  assert.deepEqual(cachedMissing.matches, [existingMatch]);
});

test('successful cancel removes active download and keeps terminal info in every workflow snapshot', () => {
  const finalizeCancelledDownloadFrontend = eval(`(${extractMethod(resolveDownloadMethodsSource, 'finalizeCancelledDownloadFrontend')})`);
  const progressDiv = {
    innerHTML: '<progress></progress>',
    isConnected: true,
    classList: {
      added: [],
      removed: [],
      add(value) { this.added.push(value); },
      remove(value) { this.removed.push(value); }
    }
  };
  const info = { missing: { matches: [] }, progressDiv };
  const progressStore = new Map([
    ['workflow-a::model', { downloadId: 'download-1', status: 'downloading' }],
    ['workflow-b::model', { downloadId: 'download-1', status: 'downloading' }],
    ['workflow-b::other', { downloadId: 'download-2', status: 'downloading' }]
  ]);
  const dialog = {
    finalizeCancelledDownloadFrontend,
    activeDownloads: { 'download-1': info, 'download-2': {} },
    clearPendingDownloadStatus() {},
    removeCancelledDownloadLocalMatches() {},
    getDownloadProgressStore() { return progressStore; },
    resolveDownloadUiElements() { return { progressDiv, downloadBtn: null }; },
    renderDownloadSnapshot(_downloadId, snapshot) {
      this.renderedSnapshot = snapshot;
      progressDiv.innerHTML = snapshot.message;
    },
    refreshLocalMatchesUiForMissing() {},
    updateDownloadAllButtonState() {},
    updateQueuePanel() {}
  };

  finalizeCancelledDownloadFrontend.call(dialog, 'download-1', info, { status: 'cancelled' });

  assert.equal(dialog.activeDownloads['download-1'], undefined);
  assert.ok(dialog.activeDownloads['download-2']);
  assert.equal(progressStore.get('workflow-a::model').status, 'cancelled');
  assert.equal(progressStore.get('workflow-b::model').status, 'cancelled');
  assert.equal(progressStore.get('workflow-a::model').isActive, false);
  assert.equal(progressStore.get('workflow-b::model').progress.status, 'cancelled');
  assert.equal(progressStore.has('workflow-b::other'), true);
  assert.equal(dialog.renderedSnapshot.status, 'cancelled');
  assert.match(progressDiv.innerHTML, /Download cancelled/);
});

test('stale polling response cannot recreate a finalized cancelled download', () => {
  assert.match(
    resolveDownloadMethodsSource,
    /if \(this\.activeDownloads\?\.\[downloadId\] !== info\) return;/
  );
});

test('local hash matches win over exact matches for the same model identity', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const getLocalMatchAbsolutePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchAbsolutePathIdentity')})`);
  const getLocalMatchRelativePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchRelativePathIdentity')})`);
  const getLocalMatchIdentityKeys = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentityKeys')})`);
  const getLocalMatchIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentity')})`);
  const canMergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'canMergeLocalMatches')})`);
  const isHashLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isHashLocalMatch')})`);
  const shouldReplaceLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'shouldReplaceLocalMatch')})`);
  const mergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'mergeLocalMatches')})`);

  const dialog = {
    normalizeLocalMatchPathIdentity,
    getLocalMatchAbsolutePathIdentity,
    getLocalMatchRelativePathIdentity,
    getLocalMatchIdentityKeys,
    getLocalMatchIdentity,
    canMergeLocalMatches,
    isHashLocalMatch,
    shouldReplaceLocalMatch,
  };
  const exactMatch = {
    confidence: 100,
    match_type: 'exact',
    model: {
      path: 'E:\\Models\\Checkpoints\\same-model.safetensors',
      filename: 'same-model.safetensors',
      category: 'checkpoints',
    },
  };
  const hashMatch = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    model: {
      path: 'E:/Models/Checkpoints/same-model.safetensors',
      filename: 'same-model.safetensors',
      category: 'checkpoints',
    },
  };

  const merged = mergeLocalMatches.call(dialog, [exactMatch], [hashMatch]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0], hashMatch);
});

test('filename-only hash result does not replace a path-specific active download match', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const getLocalMatchAbsolutePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchAbsolutePathIdentity')})`);
  const getLocalMatchRelativePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchRelativePathIdentity')})`);
  const getLocalMatchIdentityKeys = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentityKeys')})`);
  const canMergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'canMergeLocalMatches')})`);
  const isHashLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isHashLocalMatch')})`);
  const shouldReplaceLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'shouldReplaceLocalMatch')})`);
  const mergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'mergeLocalMatches')})`);
  const dialog = {
    normalizeLocalMatchPathIdentity,
    getLocalMatchAbsolutePathIdentity,
    getLocalMatchRelativePathIdentity,
    getLocalMatchIdentityKeys,
    canMergeLocalMatches,
    isHashLocalMatch,
    shouldReplaceLocalMatch,
    getActiveDownloadInfoForLocalMatch(match) {
      return match.downloading
        ? { download_id: 'download-1', download_status: 'downloading' }
        : null;
    }
  };
  const knownHashMatch = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    model: {
      path: 'C:/models/diffusion_models/ANIMA/anime/anima_baseV10.safetensors',
      relative_path: 'ANIMA/anime/anima_baseV10.safetensors',
      filename: 'anima_baseV10.safetensors',
      category: 'diffusion_models'
    }
  };
  const downloadingExactMatch = {
    confidence: 100,
    match_type: 'exact',
    downloading: true,
    model: {
      path: 'C:/models/diffusion_models/ANIMA/test/anima_baseV10.safetensors',
      relative_path: 'ANIMA/test/anima_baseV10.safetensors',
      filename: 'anima_baseV10.safetensors',
      category: 'diffusion_models'
    }
  };
  const lateFilenameOnlyHash = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    sha256: 'b'.repeat(64),
    model: {
      filename: 'anima_baseV10.safetensors',
      category: 'diffusion_models'
    }
  };

  const merged = mergeLocalMatches.call(
    dialog,
    [knownHashMatch, downloadingExactMatch],
    [lateFilenameOnlyHash]
  );

  assert.equal(merged.length, 2);
  assert.ok(merged.includes(knownHashMatch));
  assert.ok(merged.includes(downloadingExactMatch));
});

test('local match merge keeps same filename in different folders separate', () => {
  const normalizeLocalMatchPathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'normalizeLocalMatchPathIdentity')})`);
  const getLocalMatchAbsolutePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchAbsolutePathIdentity')})`);
  const getLocalMatchRelativePathIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchRelativePathIdentity')})`);
  const getLocalMatchIdentityKeys = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentityKeys')})`);
  const getLocalMatchIdentity = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getLocalMatchIdentity')})`);
  const canMergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'canMergeLocalMatches')})`);
  const isHashLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'isHashLocalMatch')})`);
  const shouldReplaceLocalMatch = eval(`(${extractMethod(resolveDownloadMethodsSource, 'shouldReplaceLocalMatch')})`);
  const mergeLocalMatches = eval(`(${extractMethod(resolveDownloadMethodsSource, 'mergeLocalMatches')})`);

  const dialog = {
    normalizeLocalMatchPathIdentity,
    getLocalMatchAbsolutePathIdentity,
    getLocalMatchRelativePathIdentity,
    getLocalMatchIdentityKeys,
    getLocalMatchIdentity,
    canMergeLocalMatches,
    isHashLocalMatch,
    shouldReplaceLocalMatch,
  };
  const firstMatch = {
    confidence: 100,
    match_type: 'exact',
    model: {
      path: 'E:/Models/A/shared-name.safetensors',
      filename: 'shared-name.safetensors',
      category: 'loras',
    },
  };
  const secondMatch = {
    confidence: 100,
    match_type: 'hash',
    hash_match: true,
    model: {
      path: 'E:/Models/B/shared-name.safetensors',
      filename: 'shared-name.safetensors',
      category: 'loras',
    },
  };

  const merged = mergeLocalMatches.call(dialog, [firstMatch], [secondMatch]);

  assert.equal(merged.length, 2);
});

test('local match status labels hash matches distinctly from exact matches', () => {
  const renderLocalMatchStatus = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchStatus')})`);
  const sha256 = 'c'.repeat(64);
  const hashLabelMap = new Map([[sha256, 'Hash 2']]);

  assert.match(
    renderLocalMatchStatus({ confidence: 100, match_type: 'hash', hash_match: true }),
    /mr-match-status-hash[^>]*>Hash</
  );
  assert.match(
    renderLocalMatchStatus({ confidence: 100, match_type: 'hash', hash_match: true, sha256 }, hashLabelMap),
    /mr-match-status-hash[^>]*>Hash 2</
  );
  assert.match(
    renderLocalMatchStatus({ confidence: 100, match_type: 'hash', hash_match: true }),
    /tabindex="0"/
  );
  assert.match(
    renderLocalMatchStatus({ confidence: 100, match_type: 'exact' }),
    /mr-match-status-exact[^>]*>Exact</
  );
});

test('local match status group warns when match folder is unsupported by node', () => {
  const renderLocalMatchStatus = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchStatus')})`);
  const getLocalMatchCategory = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchCategory')})`);
  const getLocalMatchBadFolderWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadFolderWarning')})`);
  const renderLocalMatchBadFolderBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadFolderBadge')})`);
  const renderLocalMatchStatusGroup = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchStatusGroup')})`);
  const dialog = {
    renderLocalMatchStatus,
    getLocalMatchCategory,
    getLocalMatchBadFolderWarning,
    renderLocalMatchBadFolderBadge,
    renderLocalMatchDownloadingBadge() {
      return '';
    },
    normalizeDownloadCategory(value = '') {
      return {
        checkpoint: 'checkpoints',
        checkpoints: 'checkpoints',
        diffusion_model: 'diffusion_models',
        diffusion_models: 'diffusion_models',
      }[String(value || '').trim()] || String(value || '').trim();
    },
    getMissingSupportedDownloadCategories() {
      return ['diffusion_models'];
    },
    getCategoryDisplayName(value) {
      return {
        checkpoints: 'Checkpoints',
        diffusion_models: 'Diffusion Models',
      }[value] || value;
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    },
  };

  const html = renderLocalMatchStatusGroup.call(
    dialog,
    { category: 'diffusion_models' },
    {
      confidence: 100,
      match_type: 'hash',
      hash_match: true,
      model: { category: 'checkpoints' },
    }
  );

  assert.match(html, /mr-match-status-group/);
  assert.match(html, /mr-match-status-hash[^>]*>Hash</);
  assert.match(html, /mr-match-status-bad-folder[^>]*>Bad folder</);
  assert.match(html, /This local file is in Checkpoints/);
  assert.match(html, /this node likely accepts Diffusion Models/);
});

test('local match bad folder badge is omitted for supported folder', () => {
  const getLocalMatchCategory = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchCategory')})`);
  const getLocalMatchBadFolderWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadFolderWarning')})`);
  const renderLocalMatchBadFolderBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadFolderBadge')})`);
  const dialog = {
    getLocalMatchCategory,
    getLocalMatchBadFolderWarning,
    normalizeDownloadCategory(value = '') {
      return String(value || '').trim();
    },
    getMissingSupportedDownloadCategories() {
      return ['diffusion_models'];
    },
    escapeHtml(value) {
      return String(value);
    },
  };

  const html = renderLocalMatchBadFolderBadge.call(
    dialog,
    { category: 'diffusion_models' },
    { confidence: 100, model: { category: 'diffusion_models' } }
  );

  assert.equal(html, '');
});

test('local match bad folder badge treats unet gguf as diffusion models', () => {
  const getLocalMatchCategory = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchCategory')})`);
  const getLocalMatchBadFolderWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadFolderWarning')})`);
  const renderLocalMatchBadFolderBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadFolderBadge')})`);
  const dialog = {
    getLocalMatchCategory,
    getLocalMatchBadFolderWarning,
    normalizeDownloadCategory(value = '') {
      return {
        unet_gguf: 'diffusion_models',
        diffusion_models: 'diffusion_models',
      }[String(value || '').trim()] || String(value || '').trim();
    },
    getMissingSupportedDownloadCategories() {
      return ['diffusion_models'];
    },
    escapeHtml(value) {
      return String(value);
    },
  };

  const html = renderLocalMatchBadFolderBadge.call(
    dialog,
    { category: 'diffusion_models' },
    { confidence: 100, model: { category: 'unet_gguf' } }
  );

  assert.equal(html, '');
});

test('local match bad type badge warns when node catalog does not accept gguf', () => {
  const getModelFileTypeInfo = eval(`(${extractMethod(searchPanelMethodsSource, 'getModelFileTypeInfo')})`);
  const getMissingAcceptedModelFileTypes = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAcceptedModelFileTypes')})`);
  const getLocalMatchBadTypeWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadTypeWarning')})`);
  const renderLocalMatchBadTypeBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadTypeBadge')})`);
  const dialog = {
    getModelFileTypeInfo,
    getMissingAcceptedModelFileTypes,
    getLocalMatchBadTypeWarning,
    getCurrentComfyCatalogValues(nodeType, widgetName) {
      assert.equal(nodeType, 'CLIPLoader');
      assert.equal(widgetName, 'clip_name');
      return [
        'QWEN/qwen3vl_4b_fp8_scaled.safetensors',
        'FLUX/t5xxl_fp16.safetensors',
      ];
    },
    escapeHtml(value) {
      return String(value).replace(/"/g, '&quot;');
    },
  };

  const html = renderLocalMatchBadTypeBadge.call(
    dialog,
    {
      node_type: 'CLIPLoader',
      node_title: 'Load CLIP',
      widget_name: 'clip_name',
      widget_index: 0,
    },
    {
      confidence: 76.7,
      model: { relative_path: 'QWEN/Qwen3-4B-abliterated-iq4_nl.gguf' },
    }
  );

  assert.match(html, /mr-match-status-bad-type[^>]*>Bad type</);
  assert.match(html, /This file is GGUF \(.gguf\)/);
  assert.match(html, /Load CLIP only lists Safetensors \(.safetensors\) files/);
  assert.match(html, /use a loader made for GGUF models/);
});

test('local match bad type badge is omitted for a file type accepted by node catalog', () => {
  const getModelFileTypeInfo = eval(`(${extractMethod(searchPanelMethodsSource, 'getModelFileTypeInfo')})`);
  const getMissingAcceptedModelFileTypes = eval(`(${extractMethod(searchPanelMethodsSource, 'getMissingAcceptedModelFileTypes')})`);
  const getLocalMatchBadTypeWarning = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchBadTypeWarning')})`);
  const renderLocalMatchBadTypeBadge = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchBadTypeBadge')})`);
  const dialog = {
    getModelFileTypeInfo,
    getMissingAcceptedModelFileTypes,
    getLocalMatchBadTypeWarning,
    getCurrentComfyCatalogValues() {
      return ['QWEN/qwen3vl_4b_fp8_scaled.safetensors'];
    },
    escapeHtml(value) {
      return String(value);
    },
  };

  const html = renderLocalMatchBadTypeBadge.call(
    dialog,
    { node_type: 'CLIPLoader', widget_name: 'clip_name', widget_index: 0 },
    { model: { relative_path: 'QWEN/another_text_encoder.safetensors' } }
  );

  assert.equal(html, '');
});

test('download category normalization maps unet gguf to diffusion models', () => {
  const normalizeDownloadCategory = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadCategory')})`);

  assert.equal(normalizeDownloadCategory('unet_gguf'), 'diffusion_models');
  assert.equal(normalizeDownloadCategory('UNET GGUF'), 'diffusion_models');
});

test('download category normalization maps select safetensors alias to diffusion models', () => {
  const normalizeDownloadCategory = eval(`(${extractMethod(downloadTargetMethodsSource, 'normalizeDownloadCategory')})`);

  assert.equal(normalizeDownloadCategory('select_safetensors'), 'diffusion_models');
  assert.equal(normalizeDownloadCategory('SELECT SAFETENSORS'), 'diffusion_models');
});

test('hash match label map numbers distinct matched hashes', () => {
  const normalizeSearchResultSha256 = eval(`(${extractMethod(searchPanelMethodsSource, 'normalizeSearchResultSha256')})`);
  const getLocalMatchHash = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchHash')})`);
  const collectHashLabelMapHashes = eval(`(${extractMethod(searchPanelMethodsSource, 'collectHashLabelMapHashes')})`);
  const getHashMatchLabelMap = eval(`(${extractMethod(searchPanelMethodsSource, 'getHashMatchLabelMap')})`);
  const firstHash = 'a'.repeat(64);
  const secondHash = 'b'.repeat(64);
  const dialog = {
    normalizeSearchResultSha256,
    getLocalMatchHash,
    collectHashLabelMapHashes,
  };

  const singleMap = getHashMatchLabelMap.call(dialog, {
    matches: [{ match_type: 'hash', hash_match: true, sha256: firstHash }],
  });
  assert.equal(singleMap.get(firstHash), 'Hash');

  const numberedMap = getHashMatchLabelMap.call(dialog, {
    matches: [
      { match_type: 'hash', hash_match: true, sha256: firstHash },
      { match_type: 'hash', hash_match: true, sha256: secondHash },
    ],
  });

  assert.equal(numberedMap.get(firstHash), 'Hash 1');
  assert.equal(numberedMap.get(secondHash), 'Hash 2');
});

test('search result hash labels use linked local hash identity', () => {
  const normalizeSearchResultSha256 = eval(`(${extractMethod(searchPanelMethodsSource, 'normalizeSearchResultSha256')})`);
  const getSearchResultSha256 = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchResultSha256')})`);
  const getHashMatchLabelForSearchResult = eval(`(${extractMethod(searchPanelMethodsSource, 'getHashMatchLabelForSearchResult')})`);
  const getSearchResultMatchDisplay = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchResultMatchDisplay')})`);
  const sha256 = 'd'.repeat(64);
  const hashLabelMap = new Map([[sha256, 'Hash 2']]);
  const dialog = {
    normalizeSearchResultSha256,
    getSearchResultSha256,
  };
  const result = {
    match_type: 'exact',
    hashes: { SHA256: sha256 },
  };

  assert.equal(
    getHashMatchLabelForSearchResult.call(dialog, result, hashLabelMap, []),
    ''
  );
  assert.equal(
    getHashMatchLabelForSearchResult.call(dialog, result, hashLabelMap, ['local-match-id']),
    'Hash 2'
  );
  assert.deepEqual(
    getSearchResultMatchDisplay(result, 'Exact', 'strong', 'Hash 2'),
    { label: 'Hash 2', className: 'hash' }
  );
});

test('local hash identities link search results across sources by sha', () => {
  const normalizeSearchResultSha256 = eval(`(${extractMethod(searchPanelMethodsSource, 'normalizeSearchResultSha256')})`);
  const getLocalMatchHash = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalMatchHash')})`);
  const getSearchResultSha256 = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchResultSha256')})`);
  const normalizeHashLookupSourceKey = eval(`(${extractMethod(searchPanelMethodsSource, 'normalizeHashLookupSourceKey')})`);
  const getLocalHashMatchIdentitiesForResult = eval(`(${extractMethod(searchPanelMethodsSource, 'getLocalHashMatchIdentitiesForResult')})`);
  const sha256 = 'e'.repeat(64);
  const dialog = {
    normalizeSearchResultSha256,
    getLocalMatchHash,
    getSearchResultSha256,
    normalizeHashLookupSourceKey,
    getLocalMatchIdentity() {
      return 'local-match-id';
    },
  };

  const identities = getLocalHashMatchIdentitiesForResult.call(dialog, [{
    hash_lookup_source: 'huggingface',
    match_type: 'hash',
    sha256,
  }], 'civitai', {
    match_type: 'exact',
    hashes: { SHA256: sha256 },
  });

  assert.deepEqual(identities, ['local-match-id']);
});

test('remote hash sync fetches local matches by selected result sha', async () => {
  const normalizeSearchResultSha256 = eval(`(${extractMethod(searchPanelMethodsSource, 'normalizeSearchResultSha256')})`);
  const getSearchResultSha256 = eval(`(${extractMethod(searchPanelMethodsSource, 'getSearchResultSha256')})`);
  const getExistingLocalHashMatchesForSha = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getExistingLocalHashMatchesForSha')})`);
  const syncRemoteHashMatchesForResult = eval(`(${extractMethod(resolveDownloadMethodsSource, 'syncRemoteHashMatchesForResult')})`);
  const sha256 = 'f'.repeat(64);
  const calls = [];
  const applied = [{ sha256, hash_match: true }];
  const missing = {
    category: 'diffusion_models',
    original_path: 'model.safetensors',
    matches: [],
  };
  const state = { results: { local_hash_matches: [] } };
  const dialog = {
    normalizeSearchResultSha256,
    getSearchResultSha256,
    getExistingLocalHashMatchesForSha,
    getWorkflowScopedQueueKey() {
      return 'workflow-key';
    },
    getSearchStateForWorkflow(workflowKey, value) {
      assert.equal(workflowKey, 'workflow-key');
      assert.equal(value, missing);
      return state;
    },
    getMissingSearchKey() {
      return 'missing-key';
    },
    async fetchJson(endpoint, options) {
      calls.push([endpoint, JSON.parse(options.body)]);
      return { local_hash_matches: applied };
    },
    applyLocalHashMatchesFromSearchResponse(value, data, options) {
      assert.equal(value, missing);
      assert.deepEqual(data.local_hash_matches, applied);
      assert.equal(options.workflowKey, 'workflow-key');
      return applied;
    },
  };

  const matches = await syncRemoteHashMatchesForResult.call(dialog, missing, {
    source: 'civitai',
    filename: 'model.safetensors',
    hashes: { SHA256: sha256 },
  });

  assert.equal(matches, applied);
  assert.deepEqual(calls, [[
    '/model_resolver/local-matches-by-hash',
    {
      sha256,
      category: 'diffusion_models',
      source: 'civitai',
      filename: 'model.safetensors',
      max_matches: 20,
    },
  ]]);
});

test('local hash badge hover highlights linked search result row', () => {
  const wireLocalHashMatchResultHighlights = eval(`(${extractMethod(searchPanelMethodsSource, 'wireLocalHashMatchResultHighlights')})`);
  const listeners = {};
  const badge = {
    dataset: {},
    addEventListener(eventName, callback) {
      listeners[eventName] = callback;
    },
    closest(selector) {
      return selector === '.mr-match-row'
        ? { dataset: { localMatchIdentity: 'match-id' } }
        : null;
    },
  };
  const container = {
    querySelectorAll(selector) {
      assert.equal(selector, '.mr-match-row[data-local-match-identity] .mr-match-status-hash');
      return [badge];
    },
  };
  const calls = [];
  const dialog = {
    setSearchHashResultHighlight(containerArg, identity, highlighted) {
      assert.equal(containerArg, container);
      calls.push([identity, highlighted]);
    },
  };

  wireLocalHashMatchResultHighlights.call(dialog, container);
  listeners.mouseenter();
  listeners.mouseleave();

  assert.deepEqual(calls, [
    ['match-id', true],
    ['match-id', false],
  ]);
});

test('search result highlight toggles linked hash result row and badge', () => {
  const decodeLocalMatchIdentityList = eval(`(${extractMethod(searchPanelMethodsSource, 'decodeLocalMatchIdentityList')})`);
  const setSearchHashResultHighlight = eval(`(${extractMethod(searchPanelMethodsSource, 'setSearchHashResultHighlight')})`);
  const rowToggles = [];
  const badgeToggles = [];
  const row = {
    classList: {
      toggle(className, enabled) {
        rowToggles.push([className, enabled]);
      },
    },
  };
  const badge = {
    dataset: {
      localMatchIdentities: encodeURIComponent(JSON.stringify(['match-id'])),
    },
    classList: {
      toggle(className, enabled) {
        badgeToggles.push([className, enabled]);
      },
    },
    closest(selector) {
      return selector === 'tr' ? row : null;
    },
  };
  const scope = {
    querySelectorAll(selector) {
      assert.equal(selector, '.mr-search-match[data-local-match-identities]');
      return [badge];
    },
  };
  const container = {
    closest(selector) {
      return selector === '.mr-columns' ? scope : null;
    },
  };
  const dialog = { decodeLocalMatchIdentityList };

  setSearchHashResultHighlight.call(dialog, container, 'match-id', true);

  assert.deepEqual(badgeToggles, [['mr-search-match-linked-highlight', true]]);
  assert.deepEqual(rowToggles, [['mr-search-result-hash-highlight', true]]);
});

test('search result table exposes linked local hash targets for exact matches', () => {
  const renderSearchResultsTable = eval(`(${extractMethod(searchPanelMethodsSource, 'renderSearchResultsTable')})`);
  const dialog = {
    getSearchResultsTableLayout() {
      return {
        sourcePx: 100,
        matchPx: 64,
        sizePx: 64,
        actionsPx: 72,
        tableMinPx: 360,
      };
    },
    renderSearchSourcePill() {
      return '<span>Source</span>';
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    },
    getVersionedModelName(name, version) {
      return version ? `${name} ${version}` : name;
    },
    renderVersionedModelNameHtml(name) {
      return this.escapeHtml(name);
    },
    getContextMenuAttrs() {
      return '';
    },
  };

  const html = renderSearchResultsTable.call(dialog, [{
    sourceKey: 'civitai',
    sourceLabel: 'CivitAI',
    model: 'Sick Ollie',
    match: { label: 'Exact', className: 'strong' },
    size: '5.7 GB',
    localHashMatchIdentities: ['match-id'],
  }]);

  assert.match(html, /class="mr-search-match mr-search-match-strong mr-search-match-has-local-target"/);
  assert.match(html, /data-local-match-identities="%5B%22match-id%22%5D"/);
  assert.match(html, />Exact<\/span>/);
});

test('source model details file selection includes selected file hash metadata', () => {
  const renderSourceModelDetailsFiles = eval(`(${extractMethod(modelInfoMethodsSource, 'renderSourceModelDetailsFiles')})`);
  const sha256 = 'a'.repeat(64);
  const dialog = {
    isSourceModelDetailsTargetFile() {
      return false;
    },
    getSourceModelFileMeta() {
      return { summary: `SHA256 ${sha256}`, badges: [] };
    },
    getSourceModelMirrors() {
      return [];
    },
    getSourceModelPreferredMirror() {
      return null;
    },
    getSourceModelFileHash(file = {}) {
      const hashes = file.hashes && typeof file.hashes === 'object' ? file.hashes : {};
      return String(file.sha256 || file.hash || hashes.SHA256 || hashes.sha256 || '').trim().toLowerCase();
    },
    renderSourceModelMirrors() {
      return '';
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char]));
    },
  };

  const html = renderSourceModelDetailsFiles.call(dialog, {
    id: 22,
    name: 'fp8',
    base_model: 'Z-Image',
    files: [{
      name: 'sickOllie_v1_fp8.safetensors',
      download_url: 'https://example.test/model.safetensors',
      size: 5700000000,
      hashes: { SHA256: sha256 },
    }],
  }, {
    source: 'civitai',
    model_id: 11,
    name: 'Sick Ollie',
  }, {});

  const selectionMatch = html.match(/data-selection="([^"]+)"/);
  assert.ok(selectionMatch, 'selection payload missing');
  const payload = JSON.parse(decodeURIComponent(selectionMatch[1]));

  assert.equal(payload.sha256, sha256);
  assert.equal(payload.hashes.SHA256, sha256);
  assert.equal(payload.file_info.hashes.SHA256, sha256);
  assert.equal(payload.selected_file.hashes.SHA256, sha256);
  assert.equal(payload.selected_version.files[0].hashes.SHA256, sha256);
});

test('applying source model details selection updates current download source hashes', () => {
  const applySourceModelDetailsSelection = eval(`(${extractMethod(modelInfoMethodsSource, 'applySourceModelDetailsSelection')})`);
  const sha256 = 'b'.repeat(64);
  const missing = {
    original_path: 'sickOllie_v1.safetensors',
    category: 'diffusion_models',
    civitai_info: {},
  };
  const state = { results: {} };
  const refreshCalls = [];
  const dialog = {
    getMissingByKey(key) {
      return key === 'missing-key' ? missing : null;
    },
    getSearchState(value) {
      assert.equal(value, missing);
      return state;
    },
    getSourceModelFileHash(value = {}) {
      const hashes = value.hashes && typeof value.hashes === 'object' ? value.hashes : {};
      return String(value.sha256 || value.hash || hashes.SHA256 || hashes.sha256 || '').trim().toLowerCase();
    },
    resolveBaseModelAlias(value) {
      return value;
    },
    refreshSearchUiForMissing(value, nextState) {
      refreshCalls.push([value, nextState]);
    },
    refreshSearchBaseModelLabels() {},
    updateBatchFooterButtons() {},
    persistSearchStateForActiveWorkflow() {},
    showNotification() {},
  };
  const selectedFile = {
    name: 'sickOllie_v1_fp8.safetensors',
    download_url: 'https://example.test/model.safetensors',
    hashes: { SHA256: sha256 },
  };

  applySourceModelDetailsSelection.call(dialog, {
    source: 'civitai',
    model_id: 11,
    version_id: 22,
    name: 'Sick Ollie',
    version_name: 'fp8',
    filename: selectedFile.name,
    download_url: selectedFile.download_url,
    url: 'https://civitai.com/models/11?modelVersionId=22',
    size: 5700000000,
    base_model: 'Z-Image',
    hashes: { SHA256: sha256 },
    file_info: selectedFile,
    selected_file: selectedFile,
    selected_version: { id: 22, name: 'fp8', files: [selectedFile] },
  }, {
    missing_key: 'missing-key',
    details_source: 'civitai',
  });

  assert.equal(missing.download_source.sha256, sha256);
  assert.equal(missing.download_source.hashes.SHA256, sha256);
  assert.equal(missing.download_source.file_info.hashes.SHA256, sha256);
  assert.equal(missing.download_source.selected_file.hashes.SHA256, sha256);
  assert.equal(missing.download_source.selected_version.files[0].hashes.SHA256, sha256);
  assert.equal(state.results.civitai.sha256, sha256);
  assert.equal(state.results.civitai.file_info.hashes.SHA256, sha256);
  assert.equal(refreshCalls.length, 1);
});
