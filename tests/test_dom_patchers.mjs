import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import {
  bindEventOnce,
  setTextIfChanged,
  syncElementAttributes,
} from '../web/resolver/utils/dom_patch_utils.js';
import * as domPatchUtils from '../web/resolver/utils/dom_patch_utils.js';

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
const scheduleSearchUiRefresh = eval(`(${extractMethod(searchPanelMethodsSource, 'scheduleSearchUiRefresh')})`);
const wireLocalMatchButtons = eval(`(${extractMethod(searchPanelMethodsSource, 'wireLocalMatchButtons')})`);
const patchQueuedSelections = eval(`(${extractMethod(queueMethodsSource, 'patchQueuedSelections')})`);
const patchDownloadsPanelElement = eval(`(${extractMethod(queueMethodsSource, 'patchDownloadsPanelElement')})`);
const patchLoadedModelsProgress = eval(`(${extractMethod(renderFormatMethodsSource, 'patchLoadedModelsProgress')})`);
const patchAnalysisProgress = eval(`(${extractMethod(renderFormatMethodsSource, 'patchAnalysisProgress')})`);

test('shared DOM helpers synchronize attributes, text, and one-time listeners', () => {
  const window = new Window();
  const current = window.document.createElement('button');
  const next = window.document.createElement('button');
  current.setAttribute('class', 'old');
  current.setAttribute('data-stale', '1');
  next.setAttribute('class', 'new');
  next.setAttribute('data-value', '2');

  syncElementAttributes(current, next);
  assert.equal(current.getAttribute('class'), 'new');
  assert.equal(current.hasAttribute('data-stale'), false);
  assert.equal(current.getAttribute('data-value'), '2');

  assert.equal(setTextIfChanged(current, 'Ready'), true);
  assert.equal(setTextIfChanged(current, 'Ready'), false);

  let clicks = 0;
  const handler = () => { clicks += 1; };
  assert.equal(bindEventOnce(current, 'click', handler, 'ready'), true);
  assert.equal(bindEventOnce(current, 'click', handler, 'ready'), false);
  current.click();
  assert.equal(clicks, 1);
});

test('sidebar active helper recognizes supported state attributes and classes', () => {
  assert.equal(typeof domPatchUtils.isSidebarButtonActive, 'function');

  const window = new Window();
  const selectors = [
    '[aria-pressed="true"]',
    '[aria-selected="true"]',
    '[data-active="true"]',
    '[data-selected="true"]',
    '.active',
    '.is-active',
    '.selected',
    '.p-highlight',
  ];

  for (const selector of selectors) {
    const button = window.document.createElement('button');
    if (selector.startsWith('[')) {
      const [attribute, value] = selector.slice(1, -1).split('=');
      button.setAttribute(attribute, value.replaceAll('"', ''));
    } else {
      button.className = selector.slice(1);
    }
    assert.equal(domPatchUtils.isSidebarButtonActive(button), true, selector);
  }

  const inactiveButton = window.document.createElement('button');
  assert.equal(domPatchUtils.isSidebarButtonActive(inactiveButton), false);
  assert.equal(domPatchUtils.isSidebarButtonActive(null), false);
});

test('instant actions handle pointer and click as one idempotent action', () => {
  assert.equal(typeof domPatchUtils.bindInstantAction, 'function');

  const window = new Window();
  const button = window.document.createElement('button');
  let calls = 0;
  const events = [];

  assert.equal(domPatchUtils.bindInstantAction(button, event => {
    calls += 1;
    events.push(event.type);
  }), true);
  assert.equal(domPatchUtils.bindInstantAction(button, () => {
    calls += 100;
  }), false);

  button.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
  button.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

  assert.equal(calls, 1);
  assert.deepEqual(events, ['pointerdown']);
});

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
    patchAnalysisProgress,
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

test('analysis progress patcher preserves the progress root and fill element', () => {
  const window = new Window();
  const dialog = createDialog(window);
  const container = window.document.createElement('div');
  const firstHtml = `
    <div class="mr-download-section">
      <div class="mr-progress-bar"><div class="mr-progress-fill" style="width: 15%"></div></div>
      <div class="mr-progress-text"><span>1 / 10</span><span>15%</span></div>
    </div>`;
  const secondHtml = `
    <div class="mr-download-section">
      <div class="mr-progress-bar"><div class="mr-progress-fill" style="width: 65%"></div></div>
      <div class="mr-progress-text"><span>6 / 10</span><span>65%</span></div>
    </div>`;
  dialog.patchAnalysisProgress(container, firstHtml);
  const root = container.firstElementChild;
  dialog.patchAnalysisProgress(container, secondHtml);

  assert.strictEqual(container.firstElementChild, root);
  assert.equal(container.querySelector('.mr-progress-fill').style.width, '65%');
  const progressText = container.querySelectorAll('.mr-progress-text span');
  assert.equal(progressText[0].textContent, '6 / 10');
  assert.equal(progressText[1].textContent, '65%');
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
  container.innerHTML = `
    <button class="search-download-btn" data-url="https://example.test/model" data-filename="model.safetensors" data-category="checkpoints"></button>
    <button class="search-show-details-btn" data-model="%7B%22name%22%3A%22Example%22%7D"></button>
  `;
  let calls = 0;
  let details = null;
  dialog.downloadFromSearch = () => { calls += 1; };
  dialog.showSourceModelDetails = model => { details = model; };

  dialog.wireSearchDownloadButtons(container, {});
  dialog.wireSearchDownloadButtons(container, {});
  container.querySelector('.search-download-btn').click();
  container.querySelector('.search-show-details-btn').click();

  assert.equal(calls, 1);
  assert.deepEqual(details, { name: 'Example' });
});

test('local match action delegation remains idempotent across keyed rows', () => {
  const window = new Window();
  const container = window.document.createElement('div');
  container.innerHTML = `
    <div class="mr-match-row" data-local-match-index="0">
      <button class="mr-local-link-btn" type="button">Best</button>
    </div>
    <div class="mr-match-row" data-local-match-index="0" data-local-match-alternative="true">
      <button class="mr-local-link-btn" type="button">Alternative</button>
    </div>
  `;
  const missing = {
    matches: [
      { confidence: 100, model: { id: 'best' } },
      { confidence: 80, model: { id: 'alternative' } },
    ],
  };
  const queued = [];
  const dialog = {
    queueResolution(_missing, model) {
      queued.push(model.id);
    },
  };

  wireLocalMatchButtons.call(dialog, container, missing);
  wireLocalMatchButtons.call(dialog, container, missing);
  container.querySelector('.mr-match-row button').click();
  container.querySelector('[data-local-match-alternative="true"] button').click();

  assert.deepEqual(queued, ['best', 'alternative']);
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

test('search UI refreshes coalesce within one animation frame', () => {
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrameId = 0;
  globalThis.requestAnimationFrame = callback => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = id => frames.delete(id);

  try {
    const refreshCalls = [];
    const dialog = {
      searchUiRefreshFrames: new Map(),
      getWorkflowScopedQueueKey() {
        return 'workflow-1';
      },
      getMissingSearchKey() {
        return 'missing-1';
      },
      refreshSearchUiForMissingNow(missing, state, options) {
        refreshCalls.push({ missing, state, options });
      },
    };
    const missing = { name: 'model.safetensors' };
    const firstState = { sourceProgress: { civitai: { percent: 10 } } };
    const latestState = { sourceProgress: { civitai: { percent: 70 } } };

    scheduleSearchUiRefresh.call(dialog, missing, firstState);
    scheduleSearchUiRefresh.call(dialog, missing, latestState);

    assert.equal(frames.size, 1);
    assert.equal(refreshCalls.length, 0);
    const [frameId] = frames.keys();
    frames.get(frameId)();

    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0].state, latestState);
    assert.equal(refreshCalls[0].options.workflowKey, 'workflow-1');
  } finally {
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    if (previousCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }
});

test('DOM patchers stay within the local benchmark budget', () => {
  const window = new Window();
  const dialog = createDialog(window);
  const itemCount = 80;
  const iterations = 30;
  const elementFromHtml = html => {
    const wrapper = window.document.createElement('div');
    wrapper.innerHTML = html;
    return wrapper.firstElementChild;
  };
  const benchmark = (label, operation) => {
    const start = performance.now();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      operation(iteration);
    }
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 5000, `${label} exceeded 5000ms: ${elapsedMs.toFixed(1)}ms`);
    return elapsedMs;
  };

  const searchHtml = iteration => `
    <div class="mr-search-progress-list">
      ${Array.from({ length: itemCount }, (_, index) => `
        <div class="mr-search-progress-item" data-search-progress-source="source-${index}">
          <div class="mr-search-progress-head">
            <span class="mr-search-progress-source">Source ${index}</span>
            <span class="mr-search-progress-status">${iteration}%</span>
          </div>
          <div class="mr-search-progress-bar"><div class="mr-search-progress-fill" style="width:${iteration}%"></div></div>
        </div>
      `).join('')}
    </div>`;
  const searchCurrent = elementFromHtml(searchHtml(0));
  const searchNext = elementFromHtml(searchHtml(0));
  const searchFirstItem = searchCurrent.firstElementChild;
  const searchMs = benchmark('search progress patcher', iteration => {
    searchNext.querySelectorAll('.mr-search-progress-status').forEach(status => {
      status.textContent = `${iteration}%`;
    });
    dialog.patchSearchProgressElement(searchCurrent, searchNext);
  });
  assert.strictEqual(searchCurrent.firstElementChild, searchFirstItem);

  const localContainer = window.document.createElement('div');
  const localHtml = iteration => `
    ${Array.from({ length: itemCount }, (_, index) => `
      <div class="mr-match-row" data-local-match-key="match-${index}"><span>${iteration}-${index}</span></div>
    `).join('')}`;
  dialog.patchLocalMatchesContainer(localContainer, localHtml(0));
  const localFirstRow = localContainer.firstElementChild;
  const localMs = benchmark('local match patcher', iteration => {
    dialog.patchLocalMatchesContainer(localContainer, localHtml(iteration));
  });
  assert.strictEqual(localContainer.firstElementChild, localFirstRow);

  const progressContainer = window.document.createElement('div');
  const progressHtml = iteration => `
    <div class="mr-download-section">
      <div class="mr-status-inline"><span class="mr-download-info">Loading ${iteration}</span></div>
      <div class="mr-progress-bar"><div class="mr-progress-fill" style="width:${iteration}%"></div></div>
      <div class="mr-progress-text"><span>${iteration} / 100</span><span>${iteration}%</span></div>
    </div>`;
  dialog.patchLoadedModelsProgress(progressContainer, progressHtml(0));
  const progressRoot = progressContainer.firstElementChild;
  const progressMs = benchmark('loaded progress patcher', iteration => {
    dialog.patchLoadedModelsProgress(progressContainer, progressHtml(iteration));
  });
  assert.strictEqual(progressContainer.firstElementChild, progressRoot);

  const downloadsCurrent = elementFromHtml(`
    <div class="mr-downloads-panel" data-downloads-view="active">
      ${Array.from({ length: itemCount }, (_, index) => `
        <div class="mr-download-queue-item" data-download-id="download-${index}"><span>0%</span></div>
      `).join('')}
    </div>`);
  const downloadsFirstCard = downloadsCurrent.firstElementChild;
  const downloadsMs = benchmark('downloads panel patcher', iteration => {
    const downloadsNext = elementFromHtml(`
      <div class="mr-downloads-panel" data-downloads-view="active">
        ${Array.from({ length: itemCount }, (_, index) => `
          <div class="mr-download-queue-item" data-download-id="download-${index}"><span>${iteration}%</span></div>
        `).join('')}
      </div>`);
    dialog.patchDownloadsPanelElement(downloadsCurrent, downloadsNext);
  });
  assert.strictEqual(downloadsCurrent.firstElementChild, downloadsFirstCard);

  console.info(
    `[dom-benchmark] search=${searchMs.toFixed(1)}ms `
      + `local=${localMs.toFixed(1)}ms `
      + `progress=${progressMs.toFixed(1)}ms `
      + `downloads=${downloadsMs.toFixed(1)}ms `
      + `(${itemCount} items x ${iterations} updates)`
  );
});
