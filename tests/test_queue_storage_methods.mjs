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

test('queue storage persists active download recovery without transient DOM state', () => {
  const storage = createStorage();
  const restoreStorage = installStorage(storage);

  try {
    const context = {
      ...queueStorageMethods,
      activeDownloadsStorageKey: 'active-download-recovery',
    };
    const progressDiv = { nodeType: 1 };
    const downloadBtn = { nodeType: 1 };
    context.persistActiveDownloadRecovery('download-1', {
      missing: {
        missing_key: 'model-1',
        original_path: 'vae/model.safetensors',
        matches: [{ path: 'old-match' }],
      },
      progressDiv,
      downloadBtn,
      category: 'vae',
      filename: 'model.safetensors',
      sourceUrl: 'https://huggingface.co/example/model/resolve/main/model.safetensors',
      workflowKey: 'workflow-1',
    });

    const persisted = JSON.parse(storage.getItem('active-download-recovery'));
    assert.equal(persisted['download-1'].filename, 'model.safetensors');
    assert.equal(persisted['download-1'].missing.missing_key, 'model-1');
    assert.equal('matches' in persisted['download-1'].missing, false);
    assert.equal('progressDiv' in persisted['download-1'], false);
    assert.equal('downloadBtn' in persisted['download-1'], false);

    context.removeActiveDownloadRecovery('download-1');
    assert.deepEqual(JSON.parse(storage.getItem('active-download-recovery')), {});
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

test('queue storage debounces delayed persistence and rejects invalid splitter widths', async () => {
  const storage = createStorage();
  const restoreStorage = installStorage(storage);

  try {
    const context = { ...queueStorageMethods };
    context.persistQueueCollapsedState(true, 5);
    context.persistQueueCollapsedState(false, 0);
    context.persistQueueSplitWidth(0, 0);
    context.persistQueueSplitWidth('not-a-number', 0);
    context.persistQueueSplitWidth(422.4, 5);

    await new Promise(resolve => setTimeout(resolve, 15));

    assert.equal(storage.getItem('model_resolver_queue_collapsed'), '0');
    assert.equal(storage.getItem('model_resolver_split_w'), '422');
  } finally {
    restoreStorage();
  }
});

test('queue storage loads only object history entries and recovers from invalid JSON', () => {
  const storage = createStorage();
  const restoreStorage = installStorage(storage);

  try {
    storage.setItem('test-history', JSON.stringify([null, 'invalid', 4, { filename: 'kept.safetensors' }]));
    const context = {
      ...queueStorageMethods,
      downloadHistoryStorageKey: 'test-history',
    };

    assert.deepEqual(context.loadDownloadHistory(), [{ filename: 'kept.safetensors' }]);
    assert.equal(context.getDownloadHistory(), context.downloadHistory);

    storage.setItem('test-history', '{invalid');
    const brokenContext = {
      ...queueStorageMethods,
      downloadHistoryStorageKey: 'test-history',
    };
    assert.deepEqual(brokenContext.loadDownloadHistory(), []);
  } finally {
    restoreStorage();
  }
});

test('queue storage saves with a limit and ignores empty history entries', () => {
  const storage = createStorage();
  const restoreStorage = installStorage(storage);

  try {
    const context = {
      ...queueStorageMethods,
      downloadHistoryLimit: 1,
      downloadHistoryStorageKey: 'limited-history',
      downloadHistory: [
        { filename: 'new.safetensors' },
        { filename: 'old.safetensors' },
      ],
      _downloadHistoryLoaded: true,
    };

    context.saveDownloadHistory();
    assert.deepEqual(context.downloadHistory, [{ filename: 'new.safetensors' }]);
    assert.equal(context.addDownloadHistoryEntry({}), null);
  } finally {
    restoreStorage();
  }
});

test('queue storage falls back when local storage operations fail', () => {
  const failingStorage = {
    getItem() {
      throw new Error('read failed');
    },
    setItem() {
      throw new Error('write failed');
    },
    removeItem() {
      throw new Error('remove failed');
    },
  };
  const restoreStorage = installStorage(failingStorage);

  try {
    const context = {
      ...queueStorageMethods,
      downloadHistoryStorageKey: 'failing-history',
      updateQueuePanel() {},
    };

    assert.deepEqual(context.loadDownloadHistory(), []);
    context.saveDownloadHistory();
    context.clearDownloadHistory();
    assert.deepEqual(context.downloadHistory, []);
  } finally {
    restoreStorage();
  }
});

test('queue storage remembers completed downloads using progress and missing-model fallbacks', () => {
  const storage = createStorage();
  const restoreStorage = installStorage(storage);

  try {
    const context = {
      ...queueStorageMethods,
      downloadHistoryStorageKey: 'completed-history',
      updateQueuePanel() {},
      getDownloadWorkflowLabel: () => 'Workflow A',
      getCategoryDisplayName: category => category.toUpperCase(),
    };

    const entry = context.rememberCompletedDownloadHistory(
      'download-1',
      {
        missing: {
          original_path: 'loras/fallback.safetensors',
          category: 'loras',
          node_id: 7,
          widget_index: 2,
          node_type: 'LoraLoader',
        },
        workflowId: 'workflow-1',
        sourceUrl: 'https://example.test/source',
      },
      { path: 'loras/fallback.safetensors', directory: 'loras', total_size: 12 }
    );

    assert.equal(entry.filename, 'fallback.safetensors');
    assert.equal(entry.categoryLabel, 'LORAS');
    assert.equal(entry.workflowLabel, 'Workflow A');
    assert.equal(entry.status, 'completed');
    assert.equal(context.rememberCompletedDownloadHistory('download-2', {}, {}), null);
  } finally {
    restoreStorage();
  }
});

test('queue storage formats dates and returns folder context only when actionable', () => {
  const context = {
    ...queueStorageMethods,
    isLikelyWorkflowId: value => value === 'workflow-id',
    canSwitchToDownloadWorkflow: value => value.workflow_id === 'workflow-id',
    updateQueuePanel() {},
  };

  assert.notEqual(context.formatDownloadHistoryTime('2026-01-01T00:00:00.000Z'), '');
  assert.equal(context.formatDownloadHistoryTime('invalid-date'), '');
  assert.equal(context.formatDownloadHistoryTime(''), '');
  assert.equal(context.getDownloadHistoryFolderContext({}), null);

  const contextData = context.getDownloadHistoryFolderContext({
    filename: 'model.safetensors',
    workflowLabel: 'workflow-id',
  });
  assert.equal(contextData.workflow_id, 'workflow-id');
  assert.equal(contextData.open_folder_label, '');
});

test('queue storage removes entries by id or fallback index', () => {
  const storage = createStorage();
  const restoreStorage = installStorage(storage);

  try {
    const context = {
      ...queueStorageMethods,
      downloadHistoryStorageKey: 'remove-history',
      downloadHistory: [
        { id: 'first', filename: 'first.safetensors' },
        { id: 'second', filename: 'second.safetensors' },
      ],
      _downloadHistoryLoaded: true,
      updateQueuePanel() {},
    };

    context.removeDownloadHistoryEntry('second');
    context.removeDownloadHistoryEntry('', 0);
    context.removeDownloadHistoryEntry('missing', 99);
    assert.deepEqual(context.downloadHistory, []);
  } finally {
    restoreStorage();
  }
});
