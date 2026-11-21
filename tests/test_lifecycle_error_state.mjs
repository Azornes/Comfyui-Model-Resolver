import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const lifecycleSource = await readFile(
  new URL('../web/resolver/shell/lifecycle_graph_methods.js', import.meta.url),
  'utf8'
);

test('loadWorkflowData error state escapes error message and provides a wired Retry button', () => {
  assert.match(
    lifecycleSource,
    /class="mr-error-state"/,
    'Expected error state container in loadWorkflowData catch block'
  );
  assert.match(
    lifecycleSource,
    /id="mr-refresh-missing-analysis"/,
    'Expected inline Retry button (#mr-refresh-missing-analysis) in loadWorkflowData error state'
  );
  assert.match(
    lifecycleSource,
    /escapeHtml\(error\?\.message/,
    'Expected loadWorkflowData error message to be escaped before innerHTML assignment'
  );
  assert.doesNotMatch(
    lifecycleSource,
    /innerHTML\s*=\s*`<p class="mr-error-text">Error:\s*\$\{error\.message\}<\/p>`/,
    'Unescaped error.message innerHTML injection must not exist'
  );
});
