import assert from 'node:assert/strict';
import test from 'node:test';

import { queueStorageMethods } from '../web/resolver/actions/queue_storage_methods.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function installStorage(storage) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    value: storage,
    writable: true,
  });
  return () => {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  };
}

test('queue storage persists collapsed state and splitter width immediately', () => {
  const storage = createStorage();
  const restoreStorage = installStorage(storage);

  try {
    const context = { ...queueStorageMethods };
    context.persistQueueCollapsedState(true, 0);
    context.persistQueueSplitWidth(421, 0);

    assert.equal(storage.getItem('model_resolver_queue_collapsed'), '1');
    assert.equal(storage.getItem('model_resolver_split_w'), '421');
  } finally {
    restoreStorage();
  }
});

test('download history replaces duplicate identities and keeps newest entries first', () => {
  const storage = createStorage();
  const restoreStorage = installStorage(storage);

  try {
    const context = {
      ...queueStorageMethods,
      downloadHistoryLimit: 10,
      downloadHistoryStorageKey: 'test-download-history',
      updateQueuePanel() {},
    };

    const first = context.addDownloadHistoryEntry({
      filename: 'model.safetensors',
      path: 'models/model.safetensors',
      category: 'checkpoints',
      sourceUrl: 'https://example.test/model',
      completedAt: '2026-01-01T00:00:00.000Z',
    });
    const second = context.addDownloadHistoryEntry({
      filename: 'model.safetensors',
      path: 'models/model.safetensors',
      category: 'checkpoints',
      sourceUrl: 'https://example.test/model',
      completedAt: '2026-01-02T00:00:00.000Z',
    });

    assert.notEqual(first.id, second.id);
    assert.deepEqual(context.getDownloadHistory().map(entry => entry.completedAt), [
      '2026-01-02T00:00:00.000Z',
    ]);

    const persisted = JSON.parse(storage.getItem('test-download-history'));
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].id, second.id);
  } finally {
    restoreStorage();
  }
});
