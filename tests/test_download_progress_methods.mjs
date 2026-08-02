import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadProgressMethods } from '../web/resolver/actions/download_progress_methods.js';

test('download progress labels cover active, paused, checking, and terminal states', () => {
  const context = {
    ...downloadProgressMethods,
    formatDownloadPercent: percent => percent.toFixed(1),
  };

  assert.equal(context.getDownloadProgressStatusLabel('downloading', 42.5), '42.5%');
  assert.equal(context.getDownloadProgressStatusLabel('downloading', 42.5, true), 'Finalizing');
  assert.equal(context.getDownloadProgressStatusLabel('starting'), 'Starting');
  assert.equal(context.getDownloadProgressStatusLabel('paused'), 'Paused');
  assert.equal(context.getDownloadProgressStatusLabel('completed_checking'), 'Checking');
  assert.equal(context.getDownloadProgressStatusLabel('cancelled'), 'cancelled');
  assert.equal(context.getDownloadProgressStatusLabel(''), 'Download');
});

test('download progress status distinguishes active and terminal states', () => {
  const isActive = downloadProgressMethods.isDownloadProgressStatus;

  assert.equal(isActive('starting'), true);
  assert.equal(isActive('downloading'), true);
  assert.equal(isActive('paused'), true);
  assert.equal(isActive('cancelling'), false);
  assert.equal(isActive('completed'), false);
  assert.equal(isActive('custom', true), true);
  assert.equal(isActive('custom', false), false);
});
