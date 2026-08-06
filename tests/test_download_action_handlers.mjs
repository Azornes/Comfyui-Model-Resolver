import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { bindDownloadActionHandlers } from '../web/resolver/utils/download_action_handlers.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const queueMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/queue_methods.js'),
  'utf8'
);
const resolveDownloadMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/actions/resolve_download_methods.js'),
  'utf8'
);

function extractMethod(source, methodName, paramsPattern = '[^)]*') {
  const signatureRegex = new RegExp(`\\n\\s+${methodName}\\s*\\(${paramsPattern}\\)\\s*\\{`);
  const match = signatureRegex.exec(source);
  assert.ok(match, `Could not find ${methodName}`);
  const parenStart = source.indexOf('(', match.index);
  const parenEnd = source.indexOf(')', parenStart);
  const braceStart = source.indexOf('{', parenEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      const params = source.slice(parenStart + 1, parenEnd);
      return `function ${methodName}(${params}) ${source.slice(braceStart, index + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

const wireDownloadsPanelControls = eval(`(${extractMethod(queueMethodsSource, 'wireDownloadsPanelControls')})`);
const attachDownloadActionHandlers = eval(`(${extractMethod(resolveDownloadMethodsSource, 'attachDownloadActionHandlers')})`);

function createActionMarkup(window, classes) {
  const root = window.document.createElement('div');
  for (const className of classes) {
    const button = window.document.createElement('button');
    button.className = className;
    button.dataset.downloadId = 'download-1';
    root.appendChild(button);
  }
  return root;
}

function createDownloadDialog(queueList, calls) {
  return {
    queueList,
    activeDownloads: {
      'download-1': {
        lastProgress: { status: 'downloading' },
      },
    },
    getDownloadWorkflowLabel: () => 'Test workflow',
    getDownloadQueueContext: () => ({ widget_name: 'test-model' }),
    cancelDownload: id => calls.push(['cancel', id]),
    pauseDownload: id => calls.push(['pause', id]),
    resumeDownload: id => calls.push(['resume', id]),
    openContainingFolder: context => calls.push(['folder', context.widget_name]),
    switchToDownloadWorkflow: context => calls.push(['workflow', context.widget_name]),
    setQueueDownloadsTab: () => {},
    clearDownloadHistory: () => {},
    removeDownloadHistoryEntry: () => {},
  };
}

function dispatchPointerAndClick(window, button) {
  button.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
  button.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
}

test('queue download controls trigger each action once and keep more as click-only', () => {
  const window = new Window();
  globalThis.window = window;
  const calls = [];
  const queueList = createActionMarkup(window, [
    'mr-download-queue-cancel',
    'mr-download-queue-pause',
    'mr-download-queue-resume',
    'mr-download-queue-open-folder',
    'mr-download-queue-switch-workflow',
    'mr-download-queue-more',
  ]);
  const contextMenuCalls = [];
  window.MLOpenContextMenu = (event, item) => contextMenuCalls.push([event.type, item]);
  const item = window.document.createElement('div');
  item.className = 'mr-download-queue-item';
  item.appendChild(queueList);

  const dialog = createDownloadDialog(item, calls);
  dialog.queueList = item;
  wireDownloadsPanelControls.call(dialog);

  const buttons = item.querySelectorAll('button');
  dispatchPointerAndClick(window, buttons[0]);
  dispatchPointerAndClick(window, buttons[1]);
  dispatchPointerAndClick(window, buttons[2]);
  dispatchPointerAndClick(window, buttons[3]);
  dispatchPointerAndClick(window, buttons[4]);
  buttons[5].dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

  assert.deepEqual(calls, [
    ['cancel', 'download-1'],
    ['pause', 'download-1'],
    ['resume', 'download-1'],
    ['folder', 'test-model'],
    ['workflow', 'test-model'],
  ]);
  assert.equal(contextMenuCalls.length, 1);
  assert.equal(contextMenuCalls[0][0], 'click');
  assert.equal(contextMenuCalls[0][1], item);
});

test('progress download controls support pending buttons and fallback download ids', () => {
  const window = new Window();
  const calls = [];
  const progressDiv = createActionMarkup(window, [
    'cancel-download-btn-pending',
    'pause-download-btn',
    'resume-download-btn',
    'mr-download-queue-open-folder',
    'mr-download-queue-switch-workflow',
    'mr-download-queue-more',
  ]);
  const item = window.document.createElement('div');
  item.className = 'mr-download-queue-item';
  item.appendChild(progressDiv);

  const dialog = createDownloadDialog(progressDiv, calls);
  dialog.activeDownloads['fallback-download'] = dialog.activeDownloads['download-1'];
  dialog.getDownloadFolderContext = () => ({ widget_name: 'folder-fallback' });
  globalThis.window = window;
  attachDownloadActionHandlers.call(dialog, item, 'fallback-download');

  const buttons = item.querySelectorAll('button');
  buttons[0].dataset.downloadId = '';
  buttons[1].dataset.downloadId = '';
  buttons[2].dataset.downloadId = '';
  buttons[3].dataset.downloadId = '';
  buttons[4].dataset.downloadId = '';
  buttons[5].dataset.downloadId = '';
  dispatchPointerAndClick(window, buttons[0]);
  dispatchPointerAndClick(window, buttons[1]);
  dispatchPointerAndClick(window, buttons[2]);
  dispatchPointerAndClick(window, buttons[3]);
  dispatchPointerAndClick(window, buttons[4]);

  assert.deepEqual(calls, [
    ['cancel', 'fallback-download'],
    ['pause', 'fallback-download'],
    ['resume', 'fallback-download'],
    ['folder', 'test-model'],
    ['workflow', 'test-model'],
  ]);
});
