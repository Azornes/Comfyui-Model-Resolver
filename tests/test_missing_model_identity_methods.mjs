import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(import.meta.dirname, '..');
const lifecycleGraphMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/shell/lifecycle_graph_methods.js'),
  'utf8'
);

function extractMethod(source, methodName) {
  const signature = new RegExp(`\\n\\s+${methodName}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `Could not find ${methodName}`);
  const parenStart = source.indexOf('(', match.index);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    if (source[i] === ')') parenDepth -= 1;
    if (parenDepth === 0) {
      parenEnd = i;
      break;
    }
  }
  const params = source.slice(parenStart + 1, parenEnd);
  const braceStart = source.indexOf('{', parenEnd);
  let braceDepth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') braceDepth += 1;
    if (source[i] === '}') braceDepth -= 1;
    if (braceDepth === 0) {
      return `function ${methodName}(${params}) ${source.slice(braceStart, i + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

globalThis.getCustomNodeOriginalIdentity = missing => missing.original_identity || '';

const methodNames = [
  'encodeMissingModelKeyPart',
  'getMissingModelIdentityPart',
  'getMissingModelKey',
  'getMissingModelWorkflowSlotKeys',
  'findMissingModelReplacement',
  'resolvePreservedMissingModelKey',
  'remapMissingModelKeys',
  'getMissingModelDomKey',
];
const methods = Object.fromEntries(methodNames.map(methodName => [
  methodName,
  eval(`(${extractMethod(lifecycleGraphMethodsSource, methodName)})`),
]));

test('missing model identities and keys encode workflow scope deterministically', () => {
  const dialog = { ...methods, getMissingModelIdentityPart: methods.getMissingModelIdentityPart };
  const missing = {
    node_id: 4,
    widget_index: 2,
    subgraph_id: 'sub/1',
    category: 'checkpoints',
    original_path: 'models/check point.safetensors',
  };

  assert.equal(dialog.encodeMissingModelKeyPart('check point'), 'check%20point');
  assert.equal(dialog.getMissingModelIdentityPart({ original_identity: 'custom-id' }), 'custom-id');
  assert.equal(dialog.getMissingModelIdentityPart(missing), missing.original_path);
  assert.equal(
    dialog.getMissingModelKey(missing),
    '4:2:sub%2F1:T::checkpoints:models%2Fcheck%20point.safetensors'
  );
  assert.notEqual(dialog.getMissingModelDomKey(missing), dialog.getMissingModelKey(missing));
});

test('workflow slot keys include nested references without duplicates', () => {
  const dialog = methods;
  const keys = dialog.getMissingModelWorkflowSlotKeys({
    node_id: 4,
    widget_index: 2,
    all_node_refs: [
      { node_id: 4, widget_index: 2 },
      { node_id: 9, widget_index: 1, is_top_level: false, subgraph_id: 'sub' },
    ],
  });

  assert.deepEqual(keys, ['T::4:2:', 'F:sub:9:1:']);
});

test('preserved missing model keys follow matching workflow slots after refresh', () => {
  const dialog = methods;
  const previous = [
    { node_id: 1, widget_index: 0, original_path: 'old-a.safetensors' },
    { node_id: 2, widget_index: 0, original_path: 'old-b.safetensors' },
  ];
  const current = [
    { node_id: 2, widget_index: 0, original_path: 'new-b.safetensors' },
    { node_id: 1, widget_index: 0, original_path: 'new-a.safetensors' },
  ];
  const previousKey = dialog.getMissingModelKey(previous[1]);

  assert.equal(dialog.findMissingModelReplacement(previous[1], current, 1), current[0]);
  assert.equal(
    dialog.resolvePreservedMissingModelKey(current, previous, previousKey),
    dialog.getMissingModelKey(current[0])
  );
  assert.deepEqual(
    [...dialog.remapMissingModelKeys(current, previous, new Set([previousKey]))],
    [dialog.getMissingModelKey(current[0])]
  );
});
