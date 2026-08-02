import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copyTextWithFeedback,
  escapeHtml,
  escapeJsString,
  getFilenameFromPath,
  html,
  normalizePathIdentity,
  pollBackgroundTask,
  safeStorage,
  sanitizeDescriptionHtml,
} from '../web/resolver/utils/html_utils.js';

function installGlobal(name, value) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return () => {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, name, previousDescriptor);
    } else {
      delete globalThis[name];
    }
  };
}

test('html utilities escape strings, arrays, and inline JavaScript safely', () => {
  assert.equal(escapeHtml(`<tag a="1">it's & fine`), '&lt;tag a=&quot;1&quot;&gt;it&#39;s &amp; fine');
  assert.equal(escapeHtml(null), '');
  assert.equal(html`<p>${'<unsafe>'}${['&', 'plain']}</p>`, '<p>&lt;unsafe&gt;&amp;plain</p>');
  assert.equal(html`before${null}after${undefined}`, 'beforeafter');
  assert.equal(escapeJsString('line"break'), '&quot;line\\&quot;break&quot;');
});

test('html utilities normalize paths and extract filenames across platforms', () => {
  assert.equal(normalizePathIdentity('  Models\\Checkpoints///Model.safetensors/  '), 'models/checkpoints/model.safetensors');
  assert.equal(normalizePathIdentity(''), '');
  assert.equal(getFilenameFromPath('models\\checkpoints\\model.safetensors'), 'model.safetensors');
  assert.equal(getFilenameFromPath('models/checkpoints/model.safetensors'), 'model.safetensors');
  assert.equal(getFilenameFromPath(''), '');
  assert.equal(getFilenameFromPath('filename.safetensors'), 'filename.safetensors');
});

test('safe storage reads, writes, and removes values through localStorage', () => {
  const values = new Map();
  const restoreStorage = installGlobal('localStorage', {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  });

  try {
    safeStorage.setItem('html-utils-key', 42);
    assert.equal(safeStorage.getItem('html-utils-key'), '42');
    assert.equal(safeStorage.getItem('missing-key', 'fallback'), 'fallback');
    safeStorage.removeItem('html-utils-key');
    assert.equal(safeStorage.getItem('html-utils-key'), null);
  } finally {
    restoreStorage();
  }
});

test('safe storage falls back to memory when browser storage fails', () => {
  const restoreStorage = installGlobal('localStorage', {
    getItem() {
      throw new Error('read failed');
    },
    setItem(key) {
      if (key === '__test_storage__') return;
      throw new Error('write failed');
    },
    removeItem(key) {
      if (key === '__test_storage__') return;
      throw new Error('remove failed');
    },
  });

  try {
    safeStorage.setItem('fallback-key', 'value');
    assert.equal(safeStorage.getItem('fallback-key'), 'value');
    safeStorage.removeItem('fallback-key');
    assert.equal(safeStorage.getItem('fallback-key'), null);
  } finally {
    restoreStorage();
  }
});

test('background task polling reports progress, ignores filtered statuses, and stops at terminal state', async () => {
  const responses = [
    { status: 'queued' },
    { status: 'ignored' },
    { status: 'completed', result: 42 },
  ];
  const progress = [];
  const terminal = [];
  let fetchCount = 0;

  await pollBackgroundTask({
    endpoint: '/task/1',
    tokenCheck: () => true,
    onProgress: data => progress.push(data.status),
    isTerminal: data => data.status === 'completed',
    onTerminal: data => terminal.push(data.result),
    onError: error => {
      throw error;
    },
    intervalMs: 0,
    fetchJson: async () => responses[fetchCount++],
    filterIgnoredStatus: data => data.status === 'ignored',
  });

  assert.deepEqual(progress, ['queued', 'completed']);
  assert.deepEqual(terminal, [42]);
  assert.equal(fetchCount, 3);
});

test('background task polling stops before fetching when its token is cancelled', async () => {
  let fetchCount = 0;
  await pollBackgroundTask({
    endpoint: '/task/cancelled',
    tokenCheck: () => false,
    onProgress: () => {
      throw new Error('progress should not run');
    },
    isTerminal: () => false,
    onTerminal: () => {
      throw new Error('terminal should not run');
    },
    onError: () => {
      throw new Error('error should not run');
    },
    fetchJson: async () => {
      fetchCount += 1;
      return {};
    },
  });
  assert.equal(fetchCount, 0);
});

test('background task polling reports active errors and ignores stale errors', async () => {
  const errors = [];
  await pollBackgroundTask({
    endpoint: '/task/error',
    tokenCheck: () => true,
    onProgress: () => {},
    isTerminal: () => false,
    onTerminal: () => {},
    onError: error => errors.push(error.message),
    intervalMs: 0,
    fetchJson: async () => {
      throw new Error('request failed');
    },
  });
  assert.deepEqual(errors, ['request failed']);

  let active = true;
  const staleErrors = [];
  await pollBackgroundTask({
    endpoint: '/task/stale-error',
    tokenCheck: () => active,
    onProgress: () => {},
    isTerminal: () => false,
    onTerminal: () => {},
    onError: error => staleErrors.push(error.message),
    fetchJson: async () => {
      active = false;
      throw new Error('stale request failed');
    },
  });
  assert.deepEqual(staleErrors, []);
});

function createButton() {
  const classes = new Set();
  return {
    innerHTML: '<span>Copy</span>',
    textContent: '',
    isConnected: true,
    classList: {
      add(value) {
        classes.add(value);
      },
      remove(value) {
        classes.delete(value);
      },
      has(value) {
        return classes.has(value);
      },
    },
  };
}

test('copy feedback updates and restores a button after a successful copy', async () => {
  const copied = [];
  const restoreNavigator = installGlobal('navigator', {
    clipboard: {
      async writeText(value) {
        copied.push(value);
      },
    },
  });
  const button = createButton();

  try {
    await copyTextWithFeedback('copied text', button, {
      duration: 1,
      successHtml: '<b>Done</b>',
      successClass: 'copied',
    });
    assert.deepEqual(copied, ['copied text']);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(button.innerHTML, '<span>Copy</span>');
    assert.equal(button.classList.has('copied'), false);
  } finally {
    restoreNavigator();
  }
});

test('copy feedback displays an error and handles missing buttons', async () => {
  const restoreNavigator = installGlobal('navigator', {
    clipboard: {
      async writeText() {
        throw new Error('clipboard unavailable');
      },
    },
  });
  const button = createButton();

  try {
    await copyTextWithFeedback('text', button, { duration: 1, errorText: 'Copy failed' });
    assert.equal(button.textContent, 'Copy failed');
    await copyTextWithFeedback('text', null);
  } finally {
    restoreNavigator();
  }
});

test('description sanitizer returns an empty string for empty input', () => {
  assert.equal(sanitizeDescriptionHtml('   '), '');
  assert.equal(sanitizeDescriptionHtml(null), '');
});
