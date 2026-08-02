import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(import.meta.dirname, '..');
const modelResolverSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/model_resolver.js'),
  'utf8'
);

function extractFunction(source, functionName) {
  const signature = new RegExp(`\\nfunction ${functionName}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `Could not find ${functionName}`);
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
  const braceStart = source.indexOf('{', parenEnd);
  let braceDepth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') braceDepth += 1;
    if (source[i] === '}') braceDepth -= 1;
    if (braceDepth === 0) {
      return `function ${functionName}${source.slice(parenStart, parenEnd + 1)} ${source.slice(braceStart, i + 1)}`;
    }
  }
  throw new Error(`Could not parse ${functionName}`);
}

const serializeKeybindingCombo = eval(`(${extractFunction(modelResolverSource, 'serializeKeybindingCombo')})`);
const keybindingsEqual = eval(`(${extractFunction(modelResolverSource, 'keybindingsEqual')})`);
const getComboLabel = eval(`(${extractFunction(modelResolverSource, 'getComboLabel')})`);

test('keybinding serialization is stable for equivalent combos', () => {
  assert.equal(serializeKeybindingCombo({ key: 'k', ctrl: true, shift: false }), 'K:true:false:false');
  assert.equal(
    serializeKeybindingCombo({ key: 'K', ctrl: true, shift: false }),
    serializeKeybindingCombo({ key: 'k', ctrl: true, shift: false })
  );
  assert.notEqual(
    serializeKeybindingCombo({ key: 'k', ctrl: true }),
    serializeKeybindingCombo({ key: 'k', ctrl: false })
  );
});

test('keybindingsEqual compares command, target, and normalized combo', () => {
  const base = {
    commandId: 'ModelResolver.OpenModelResolver',
    targetElementId: 'graph-canvas',
    combo: { key: '|', ctrl: true, shift: true },
  };

  assert.equal(keybindingsEqual(base, { ...base, combo: { ...base.combo, key: '|' } }), true);
  assert.equal(keybindingsEqual(base, { ...base, commandId: 'Other.Command' }), false);
  assert.equal(keybindingsEqual(base, { ...base, targetElementId: 'other-target' }), false);
  assert.equal(keybindingsEqual(base, { ...base, combo: { key: '|', ctrl: true } }), false);
  assert.equal(keybindingsEqual(base, null), false);
});

test('keybinding labels use readable modifier and special-key names', () => {
  assert.equal(getComboLabel({ key: '|', ctrl: true, shift: true }), 'Ctrl+Shift+|');
  assert.equal(getComboLabel({ key: 'ArrowUp', alt: true }), 'Alt+Up');
  assert.equal(getComboLabel({ key: 'Enter' }), 'Enter');
  assert.equal(getComboLabel({ key: 'Escape' }), 'Esc');
  assert.equal(getComboLabel({}), '');
});
