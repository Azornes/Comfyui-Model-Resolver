import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const searchPanelSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../web/resolver/search/search_panel.js'),
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
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      return `${isAsync ? 'async ' : ''}function ${methodName}(${params}) ${source.slice(braceStart, index + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

globalThis.getSvgIcon = () => '';
const renderSearchProgressItem = eval(`(${extractMethod(searchPanelSource, 'renderSearchProgressItem', '[\\s\\S]*?')})`);
const renderSearchProgress = eval(`(${extractMethod(searchPanelSource, 'renderSearchProgress')})`);
const wireSearchProgressRetryButtons = eval(`(${extractMethod(searchPanelSource, 'wireSearchProgressRetryButtons', '[\\s\\S]*?')})`);

function createDialog() {
  return {
    renderSearchProgressItem,
    renderSearchProgress,
    wireSearchProgressRetryButtons,
    getSearchSourceLabel(source) {
      return {
        civarchive: 'CivArchive',
        civitai: 'CivitAI',
      }[source] || source;
    },
    hasActiveSearchProgress(state) {
      return Object.values(state.sourceProgress || {}).some(progress => (
        progress?.status === 'pending' || progress?.status === 'running'
      ));
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
}

test('retryable provider failures render a source-specific retry action', () => {
  const dialog = createDialog();
  const html = dialog.renderSearchProgress({
    sourceProgress: {
      civarchive: {
        status: 'error',
        message: 'CivArchive may be overloaded or temporarily unavailable. Please try again.',
        error: '... Details: HTTP 522',
        providerState: 'unavailable',
        retryable: true,
      },
      civitai: {
        status: 'error',
        message: 'CivitAI search failed.',
        retryable: false,
      },
    },
  });

  assert.match(html, /mr-search-progress-retry/);
  assert.match(html, /data-source="civarchive"/);
  assert.match(html, /Retry CivArchive search/);
  assert.doesNotMatch(html, /data-source="civitai"[^>]*>.*Retry/);
});

test('active search progress renders the full progress rows', () => {
  const dialog = createDialog();
  const html = dialog.renderSearchProgress({
    activeSearchRunId: 'run-42',
    sourceProgress: {
      civitai: {
        status: 'running',
        percent: 42,
        message: 'Querying models',
      },
      civarchive: {
        status: 'error',
        message: 'Search failed',
        error: 'HTTP 522',
        retryable: true,
      },
    },
  });

  assert.match(html, /class="mr-search-progress-list"/);
  assert.doesNotMatch(html, /mr-search-progress-list-compact/);
  assert.match(html, /aria-valuenow="42"/);
  assert.match(html, /width: 42%/);
  assert.match(html, /mr-search-progress-cancel/);
  assert.match(html, /data-run-id="run-42"/);
  assert.match(html, /mr-search-progress-retry/);
});

test('inactive search progress renders compact rows without progress controls', () => {
  const dialog = createDialog();
  const html = dialog.renderSearchProgress({
    sourceProgress: {
      civitai: {
        status: 'found',
        message: 'Found',
      },
      civarchive: {
        status: 'error',
        message: 'Search failed',
        retryable: true,
      },
    },
  });

  assert.match(html, /mr-search-progress-list-compact/);
  assert.doesNotMatch(html, /mr-search-progress-bar/);
  assert.doesNotMatch(html, /mr-search-progress-cancel/);
  assert.match(html, /mr-search-progress-retry/);
});

test('source retry action searches only the failed provider with force search', () => {
  const dialog = createDialog();
  const listeners = {};
  const button = {
    dataset: { source: 'civarchive' },
    addEventListener(eventName, callback) {
      listeners[eventName] = callback;
    },
  };
  const container = {
    querySelectorAll(selector) {
      assert.equal(selector, '.mr-search-progress-retry');
      return [button];
    },
  };
  const missing = { key: 'missing-key' };
  const state = {
    sourceProgress: {
      civarchive: { status: 'error', retryable: true },
    },
  };
  const calls = [];
  dialog.searchOnline = (...args) => calls.push(args);

  dialog.wireSearchProgressRetryButtons(container, missing, state, {
    workflowKey: 'workflow-key',
  });
  listeners.click({ preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(calls, [[missing, {
    workflowKey: 'workflow-key',
    source: 'civarchive',
    forceSearch: true,
  }]]);
});
