import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getModelCardUrl,
  parseHuggingFaceFileUrl,
} from '../web/resolver/utils/url_utils.js';

const searchPanelSource = await readFile(
  new URL('../web/resolver/search/search_panel.js', import.meta.url),
  'utf8'
);
const modelInfoSource = await readFile(
  new URL('../web/resolver/views/model_info_methods.js', import.meta.url),
  'utf8'
);
const resolveDownloadSource = await readFile(
  new URL('../web/resolver/actions/resolve_download_methods.js', import.meta.url),
  'utf8'
);
const resolverCssSource = await readFile(
  new URL('../web/css/resolver-main.css', import.meta.url),
  'utf8'
);

test('HuggingFace download rows expose the Show More action', () => {
  assert.match(
    searchPanelSource,
    /\['civitai', 'civarchive', 'huggingface'\]\.includes\(normalizedSource\)/
  );
  assert.match(
    modelInfoSource,
    /\['civitai', 'civarchive', 'huggingface', 'lora_manager_archive'\]\.includes\(source\)/
  );
  assert.match(
    resolveDownloadSource,
    /if \(hfResult && hfResult\.url\)[\s\S]*?detailsContext:\s*\{[\s\S]*?\.\.\.hfResult,[\s\S]*?details_source:\s*'huggingface'/
  );
});

test('HuggingFace details requests keep folder, branch, and token context', () => {
  assert.match(modelInfoSource, /file_path: model\.path/);
  assert.match(modelInfoSource, /branch: model\.branch \|\| ''/);
  assert.match(modelInfoSource, /hf_token: tokens\.hf_token \|\| ''/);
});

test('a selected HuggingFace variant keeps its repository path', () => {
  assert.match(
    modelInfoSource,
    /path: selection\.path \|\| selectionFile\?\.path \|\| ''/
  );
  assert.match(
    modelInfoSource,
    /branch: selection\.branch \|\| contextModel\.branch \|\| ''/
  );
});

test('HuggingFace blob URLs expose repository, branch, and containing path', () => {
  const url = (
    'https://huggingface.co/Comfy-Org/HunyuanVideo_repackaged/blob/main/'
    + 'split_files/text_encoders/llava_llama3_fp8_scaled.safetensors'
  );

  assert.deepEqual(parseHuggingFaceFileUrl(url), {
    repo: 'Comfy-Org/HunyuanVideo_repackaged',
    revision: 'main',
    path: 'split_files/text_encoders/llava_llama3_fp8_scaled.safetensors',
    filename: 'llava_llama3_fp8_scaled.safetensors',
  });
  assert.equal(getModelCardUrl(url), url);
});

test('Local Database adds HuggingFace details only for direct HF file URLs', () => {
  assert.match(
    resolveDownloadSource,
    /const huggingFaceFile = parseHuggingFaceFileUrl\(modelListResult\.url\)/
  );
  assert.match(
    resolveDownloadSource,
    /const modelListDetailsContext = huggingFaceFile[\s\S]*?details_source:\s*'huggingface'[\s\S]*?model_id:\s*huggingFaceFile\.repo[\s\S]*?branch:\s*huggingFaceFile\.revision[\s\S]*?path:\s*huggingFaceFile\.path/
  );
  assert.match(
    resolveDownloadSource,
    /detailsContext:\s*modelListDetailsContext/
  );
});

test('Workflow URL derives HuggingFace details from a direct file URL', () => {
  assert.match(
    searchPanelSource,
    /const huggingFaceFile = normalizedSource === 'huggingface'[\s\S]*?parseHuggingFaceFileUrl\([\s\S]*?downloadSource\.download_url \|\| downloadSource\.url \|\| rawModelUrl[\s\S]*?\)/
  );
  assert.match(
    searchPanelSource,
    /model_id: downloadSource\.model_id \|\| huggingFaceFile\?\.repo/
  );
  assert.match(
    searchPanelSource,
    /branch: downloadSource\.branch \|\| huggingFaceFile\?\.revision \|\| ''/
  );
  assert.match(
    searchPanelSource,
    /path: downloadSource\.path \|\| huggingFaceFile\?\.path \|\| ''/
  );
});

test('HuggingFace details use a full-width compact variant table', () => {
  assert.match(
    modelInfoSource,
    /mr-model-details-main \$\{isHuggingFace \? 'is-huggingface' : ''\}/
  );
  assert.match(modelInfoSource, /mr-model-details-file-table-header/);
  assert.match(modelInfoSource, /mr-model-details-file-table-row/);
  assert.match(modelInfoSource, /mr-model-details-file-table-use/);
  assert.match(
    resolverCssSource,
    /\.mr-model-details-main\.is-huggingface\s*\{[^}]*display:\s*block/s
  );
  assert.match(
    resolverCssSource,
    /\.mr-model-details-main\.is-huggingface \.mr-model-details-content\s*\{[^}]*display:\s*none/s
  );
  assert.match(
    resolverCssSource,
    /\.mr-model-details-file-table-row\s*\{[^}]*min-height:\s*52px/s
  );
});
