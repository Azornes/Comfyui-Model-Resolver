import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchJson } from '../web/resolver/utils/api_client.js';

function response({ body = null, ok = true, status = 200, statusText = 'OK' } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return body;
    },
  };
}

test('fetchJson adds JSON headers and returns decoded response data', async () => {
  const calls = [];
  const apiClient = {
    async fetchApi(endpoint, options) {
      calls.push([endpoint, options]);
      return response({ body: { value: 42 } });
    },
  };

  const result = await fetchJson('/model_resolver/example', {
    method: 'POST',
    body: JSON.stringify({ input: 'value' }),
  }, 'Load example', { apiClient });

  assert.deepEqual(result, { value: 42 });
  assert.deepEqual(calls, [[
    '/model_resolver/example',
    {
      method: 'POST',
      body: JSON.stringify({ input: 'value' }),
      headers: { 'Content-Type': 'application/json' },
    },
  ]]);
});

test('fetchJson preserves raw responses and handles no-content responses', async () => {
  const rawResponse = response({ body: { raw: true } });
  const apiClient = {
    async fetchApi(endpoint) {
      return endpoint === '/raw'
        ? rawResponse
        : response({ status: 204, statusText: 'No Content' });
    },
  };

  assert.equal(
    await fetchJson('/raw', { raw: true }, 'Load raw response', { apiClient }),
    rawResponse
  );
  assert.equal(
    await fetchJson('/empty', {}, 'Load empty response', { apiClient }),
    null
  );
});

test('fetchJson reports server errors and respects silent requests', async () => {
  const notifications = [];
  const logs = [];
  const apiClient = {
    async fetchApi(endpoint) {
      return response({
        ok: false,
        status: endpoint === '/silent-error' ? 503 : 400,
        statusText: 'Request failed',
        body: { error: 'Backend rejected request' },
      });
    },
  };

  await assert.rejects(
    fetchJson('/error', {}, 'Load failed', {
      apiClient,
      notify: (message, type) => notifications.push([message, type]),
      logError: (...args) => logs.push(args),
    }),
    error => error.message === 'Backend rejected request' && error.status === 400
  );
  assert.deepEqual(notifications, [['Backend rejected request', 'error']]);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /Load failed failed/);

  await assert.rejects(
    fetchJson('/silent-error', { silent: true }, 'Silent failure', {
      apiClient,
      notify: (message, type) => notifications.push([message, type]),
      logError: (...args) => logs.push(args),
    }),
    error => error.status === 503
  );
  assert.deepEqual(notifications, [['Backend rejected request', 'error']]);
});
