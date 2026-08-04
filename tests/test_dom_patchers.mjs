import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const projectRoot = path.resolve(import.meta.dirname, '..');
const resolveDownloadMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/resolve_download_methods.js'),
  'utf8'
);
const queueMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/queue_methods.js'),
  'utf8'
);
const searchPanelMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/search_panel.js'),
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
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return `${isAsync ? 'async ' : ''}function ${methodName}(${params}) ${source.slice(braceStart, index + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

const patchSearchResultsContainer = eval(`(${extractMethod(resolveDownloadMethodsSource, 'patchSearchResultsContainer')})`);
const patchSearchProgressElement = eval(`(${extractMethod(resolveDownloadMethodsSource, 'patchSearchProgressElement')})`);
const patchSearchProgressItem = eval(`(${extractMethod(resolveDownloadMethodsSource, 'patchSearchProgressItem')})`);
const patchSearchProgressActions = eval(`(${extractMethod(resolveDownloadMethodsSource, 'patchSearchProgressActions')})`);
const patchSearchResultsTable = eval(`(${extractMethod(resolveDownloadMethodsSource, 'patchSearchResultsTable')})`);
const syncSearchElementAttributes = eval(`(${extractMethod(resolveDownloadMethodsSource, 'syncSearchElementAttributes')})`);
const getSearchResultsPatchKind = eval(`(${extractMethod(resolveDownloadMethodsSource, 'getSearchResultsPatchKind')})`);
const wireSearchDownloadButtons = eval(`(${extractMethod(resolveDownloadMethodsSource, 'wireSearchDownloadButtons')})`);
const patchLocalMatchesContainer = eval(`(${extractMethod(resolveDownloadMethodsSource, 'patchLocalMatchesContainer')})`);
const resolveUrnAsync = eval(`(${extractMethod(resolveDownloadMethodsSource, 'resolveUrnAsync')})`);
const fetchUrnLocalMatches = eval(`(${extractMethod(searchPanelMethodsSource, 'fetchUrnLocalMatches')})`);
const patchQueuedSelections = eval(`(${extractMethod(queueMethodsSource, 'patchQueuedSelections')})`);
const patchDownloadsPanelElement = eval(`(${extractMethod(queueMethodsSource, 'patchDownloadsPanelElement')})`);
const patchLoadedModelsProgress = eval(`(${extractMethod(renderFormatMethodsSource, 'patchLoadedModelsProgress')})`);

function createDialog(window) {
  return {
    syncSearchElementAttributes,
    patchSearchProgressActions,
    patchSearchProgressItem,
    patchSearchProgressElement,
    patchSearchResultsTable,
    getSearchResultsPatchKind,
    patchSearchResultsContainer,
    patchLocalMatchesContainer,
    patchQueuedSelections,
    patchDownloadsPanelElement,
    patchLoadedModelsProgress,
    wireSearchDownloadButtons,
    window,
    wireSearchHashMatchHighlights() {},
  };
}

test('search patcher preserves keyed progress items and result rows', () => {
  const window = new Window();
  const dialog = createDialog(window);
  const container = window.document.createElement('div');
  const firstHtml = `
    <div class="mr-search-progress-list">
      <div class="mr-search-progress-item mr-search-progress-running" data-search-progress-source="civitai">
        <span class="mr-search-progress-source">CivitAI</span>
        <span class="mr-search-progress-status">Searching... 10%</span>
        <div class="mr-search-progress-bar" role="progressbar" aria-valuenow="10"><div class="mr-search-progress-fill" style="width: 10%;"></div></div>
      </div>
    </div>
    <div class="mr-search-results-table-wrap">
      <table class="mr-search-results-table"><tbody>
        <tr data-search-result-key="civitai%3Amodel"><td>Old result</td></tr>
      </tbody></table>
    </div>
  `;
  const secondHtml = `
    <div class="mr-search-progress-list">
      <div class="mr-search-progress-item mr-search-progress-running" data-search-progress-source="civitai">
        <span class="mr-search-progress-source">CivitAI</span>
        <span class="mr-search-progress-status">Searching... 55%</span>
        <div class="mr-search-progress-bar" role="progressbar" aria-valuenow="55"><div class="mr-search-progress-fill" style="width: 55%;"></div></div>
      </div>
      <div class="mr-search-progress-item mr-search-progress-pending" data-search-progress-source="huggingface">
        <span class="mr-search-progress-source">HuggingFace</span>
        <span class="mr-search-progress-status">Queued</span>
        <div class="mr-search-progress-bar" role="progressbar" aria-valuenow="0"><div class="mr-search-progress-fill" style="width: 0%;"></div></div>
      </div>
    </div>
    <div class="mr-search-results-table-wrap">
      <table class="mr-search-results-table"><tbody>
        <tr data-search-result-key="civitai%3Amodel"><td>Updated result</td></tr>
      </tbody></table>
    </div>
  `;

  dialog.patchSearchResultsContainer(container, firstHtml);
  const progressItem = container.querySelector('[data-search-progress-source="civitai"]');
  const resultRow = container.querySelector('[data-search-result-key="civitai%3Amodel"]');
  dialog.patchSearchResultsContainer(container, secondHtml);

  assert.strictEqual(
    container.querySelector('[data-search-progress-source="civitai"]'),
    progressItem
  );
  assert.strictEqual(
    container.querySelector('[data-search-result-key="civitai%3Amodel"]'),
    resultRow
  );
  assert.equal(progressItem.querySelector('.mr-search-progress-status').textContent, 'Searching... 55%');
  assert.equal(progressItem.querySelector('.mr-search-progress-fill').style.width, '55%');
  assert.equal(resultRow.textContent.trim(), 'Updated result');
  assert.ok(container.querySelector('[data-search-progress-source="huggingface"]'));
});

test('local match patcher preserves rows and collapsed alternatives', () => {
  const window = new Window();
  const dialog = createDialog(window);
  const container = window.document.createElement('div');
  const firstHtml = `
    <div class="mr-match-row" data-local-match-key="path%3A%2Fmodels%2Fone"><span>One</span></div>
    <button class="mr-local-alternatives-toggle" aria-expanded="false">Alternatives</button>
    <div id="more-matches" class="mr-stack-sm mr-hidden">
      <div class="mr-match-row" data-local-match-key="path%3A%2Fmodels%2Ftwo"><span>Two</span></div>
    </div>
  `;
  const secondHtml = `
    <div class="mr-match-row" data-local-match-key="path%3A%2Fmodels%2Fone"><span>One updated</span></div>
    <button class="mr-local-alternatives-toggle" aria-expanded="true">Alternatives</button>
    <div id="more-matches" class="mr-stack-sm">
      <div class="mr-match-row" data-local-match-key="path%3A%2Fmodels%2Ftwo"><span>Two updated</span></div>
    </div>
  `;

  dialog.patchLocalMatchesContainer(container, firstHtml);
  const mainRow = container.querySelector('[data-local-match-key="path%3A%2Fmodels%2Fone"]');
  const alternativeRow = container.querySelector('[data-local-match-key="path%3A%2Fmodels%2Ftwo"]');
  const group = container.querySelector('#more-matches');
  dialog.patchLocalMatchesContainer(container, secondHtml);

  assert.strictEqual(container.querySelector('[data-local-match-key="path%3A%2Fmodels%2Fone"]'), mainRow);
  assert.strictEqual(container.querySelector('[data-local-match-key="path%3A%2Fmodels%2Ftwo"]'), alternativeRow);
  assert.strictEqual(container.querySelector('#more-matches'), group);
  assert.equal(mainRow.textContent, 'One updated');
  assert.equal(alternativeRow.textContent, 'Two updated');
  assert.ok(group.classList.contains('mr-hidden'), 'user-collapsed alternatives should stay collapsed');
});

test('loaded progress patcher preserves the progress root and fill element', () => {
  const window = new Window();
  const dialog = createDialog(window);
  const container = window.document.createElement('div');
  const makeProgress = (message, percent) => `
    <div class="mr-download-section">
      <div class="mr-status-inline"><span class="mr-download-info">${message}</span></div>
      <div class="mr-progress-container"><div class="mr-progress-bar"><div class="mr-progress-fill" style="width: ${percent}%;"></div></div><div class="mr-progress-text"><span>1 / 2</span><span>${percent}%</span></div></div>
    </div>
  `;

  dialog.patchLoadedModelsProgress(container, makeProgress('Loading one', 10));
  const root = container.firstElementChild;
  const fill = container.querySelector('.mr-progress-fill');
  dialog.patchLoadedModelsProgress(container, makeProgress('Loading two', 60));

  assert.strictEqual(container.firstElementChild, root);
  assert.strictEqual(container.querySelector('.mr-progress-fill'), fill);
  assert.equal(container.querySelector('.mr-download-info').textContent, 'Loading two');
  assert.equal(fill.style.width, '60%');
});

test('download queue patcher preserves keyed cards', () => {
  const window = new Window();
  const dialog = createDialog(window);
  const queueList = window.document.createElement('div');
  dialog.queueList = queueList;
  queueList.innerHTML = '<div class="mr-queue-items"><div class="mr-queue-item" data-queue-key="one"><span>One</span></div></div>';
  dialog.patchQueuedSelections('<div class="mr-queue-items"><div class="mr-queue-item" data-queue-key="one"><span>Updated</span></div><div class="mr-queue-item" data-queue-key="two"><span>Two</span></div></div>');

  const item = queueList.querySelector('[data-queue-key="one"]');
  assert.equal(item.textContent, 'Updated');
  assert.strictEqual(queueList.querySelectorAll('[data-queue-key="one"]').length, 1);
  assert.ok(queueList.querySelector('[data-queue-key="two"]'));
});

test('downloads panel patcher preserves a keyed card node', () => {
  const window = new Window();
  const dialog = createDialog(window);
  const current = window.document.createElement('div');
  const next = window.document.createElement('div');
  current.innerHTML = '<div class="mr-download-queue-item" data-download-id="download-1"><span>10%</span></div>';
  next.innerHTML = '<div class="mr-download-queue-item" data-download-id="download-1"><span>20%</span></div>';
  const card = current.firstElementChild;

  dialog.patchDownloadsPanelElement(current, next);

  assert.strictEqual(current.firstElementChild, card);
  assert.equal(card.textContent, '20%');
});

test('search download button wiring remains idempotent on the same node', () => {
  const window = new Window();
  const dialog = createDialog(window);
  const container = window.document.createElement('div');
  container.innerHTML = '<button class="search-download-btn" data-url="https://example.test/model" data-filename="model.safetensors" data-category="checkpoints"></button>';
  let calls = 0;
  dialog.downloadFromSearch = () => { calls += 1; };

  dialog.wireSearchDownloadButtons(container, {});
  dialog.wireSearchDownloadButtons(container, {});
  container.querySelector('.search-download-btn').click();

  assert.equal(calls, 1);
});

test('stale URN responses cannot overwrite the latest UI request', async () => {
  const window = new Window();
  const previousDocument = globalThis.document;
  const previousLog = globalThis.log;
  const previousConsoleError = console.error;
  const urnErrors = [];
  globalThis.document = window.document;
  globalThis.log = { debug() {} };
  console.error = (...args) => urnErrors.push(args);

  try {
    const loading = window.document.createElement('div');
    loading.id = 'urn-loading-1';
    const download = window.document.createElement('div');
    download.id = 'urn-download-1';
    window.document.body.append(loading, download);

    const resolvers = [];
    const dialog = {
      missingModels: [],
      urnResolveUiTokens: new Map(),
      getStoredTokens() {
        return {};
      },
      fetchJson() {
        return new Promise(resolve => resolvers.push(resolve));
      },
      renderVersionedModelNameHtml(name, version) {
        return `${name} ${version}`;
      },
      escapeHtml(value) {
        return String(value);
      },
    };

    const first = resolveUrnAsync.call(dialog, '1', '1', loading.id, 'https://example.test/one');
    await Promise.resolve();
    const second = resolveUrnAsync.call(dialog, '1', '2', loading.id, 'https://example.test/two');
    await Promise.resolve();

    resolvers[1]({ civitai: { name: 'Latest', version_name: 'v2', download_url: 'latest' } });
    await second;
    assert.equal(urnErrors.length, 0, urnErrors.map(args => args.map(String).join(' ')).join('\n'));
    assert.match(loading.textContent, /Latest v2/);

    resolvers[0]({ civitai: { name: 'Stale', version_name: 'v1', download_url: 'stale' } });
    await first;
    assert.match(loading.textContent, /Latest v2/);
    assert.doesNotMatch(loading.textContent, /Stale v1/);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLog === undefined) delete globalThis.log;
    else globalThis.log = previousLog;
    console.error = previousConsoleError;
  }
});

test('URN local matches use the filename as part of the in-flight request identity', async () => {
  const missing = {
    key: 'missing-1',
    category: 'checkpoints',
    civitai_info: { expected_filename: 'old.safetensors' },
    matches: [],
  };
  const resolvers = new Map();
  const calls = [];
  const dialog = {
    missingModels: [missing],
    urnLocalMatchPromises: new Map(),
    getMissingModelKey(item) {
      return item.key;
    },
    getUrnResolveKey() {
      return '1:2:missing-1';
    },
    fetchLocalMatches(filename) {
      calls.push(filename);
      return new Promise(resolve => resolvers.set(filename, resolve));
    },
    preserveActiveDownloadLocalMatches(_missing, matches) {
      return matches;
    },
  };

  const first = fetchUrnLocalMatches.call(dialog, missing);
  await Promise.resolve();
  missing.civitai_info.expected_filename = 'new.safetensors';
  const second = fetchUrnLocalMatches.call(dialog, missing);
  await Promise.resolve();

  assert.deepEqual(calls, ['old.safetensors', 'new.safetensors']);
  resolvers.get('new.safetensors')({ matches: [{ filename: 'new.safetensors' }] });
  await second;
  resolvers.get('old.safetensors')({ matches: [{ filename: 'old.safetensors' }] });
  await first;

  assert.deepEqual(missing.matches, [{ filename: 'new.safetensors' }]);
  assert.equal(missing.__urnLocalMatchesFilename, 'new.safetensors');
});
