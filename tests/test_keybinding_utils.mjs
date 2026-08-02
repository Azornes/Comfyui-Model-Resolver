import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeKeybindingCombo,
  keybindingsEqual,
  getComboLabel,
} from '../web/resolver/utils/keybinding_utils.js';

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
