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
const renderSearchProgress = eval(`(${extractMethod(searchPanelSource, 'renderSearchProgress')})`);
const wireSearchProgressRetryButtons = eval(`(${extractMethod(searchPanelSource, 'wireSearchProgressRetryButtons', '[\\s\\S]*?')})`);

function createDialog() {
  return {
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
