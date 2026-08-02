import assert from 'node:assert/strict';
import test from 'node:test';

import { baseModelAliasMethods } from '../web/resolver/search/base_model_alias_methods.js';

function createDialog(baseModels) {
  return {
    ...baseModelAliasMethods,
    baseModels,
    hasModelExtension(value) {
      return /\.(?:safetensors|ckpt|pt|pth|bin|gguf)$/i.test(String(value));
    },
  };
}

test('base model aliases use configured models and preserve aliases', () => {
  const dialog = createDialog({
    base_models: [
      { name: 'Custom Model', aliases: ['custom', 'custom-model'] },
      { name: 'No Alias Model' },
    ],
  });

  assert.deepEqual(dialog.getBaseModelAliases(), [
    { value: 'Custom Model', aliases: ['custom', 'custom-model'] },
    { value: 'No Alias Model', aliases: [] },
  ]);
});

test('base model aliases fall back to the built-in catalog', () => {
  const dialog = createDialog({ base_models: [] });
  const aliases = dialog.getBaseModelAliases();

  assert.ok(aliases.some(entry => entry.value === 'Flux.1 D'));
  assert.ok(aliases.some(entry => entry.value === 'SDXL 1.0'));
  assert.ok(aliases.every(entry => Array.isArray(entry.aliases)));
});

test('base model tokens normalize punctuation and generate compatible variants', () => {
  const dialog = createDialog({ base_models: [] });

  assert.equal(dialog.normalizeBaseModelToken(' Flux.1 D '), 'flux1d');
  assert.deepEqual([...dialog.getBaseModelTokenVariants('SDXL 1.0')].sort(), ['sdxl1', 'sdxl10']);
  assert.deepEqual([...dialog.getBaseModelTokenVariants('Flux.1 D')].sort(), ['flux1d', 'fluxd']);
  assert.deepEqual([...dialog.getBaseModelTokenVariants('')], []);
});

test('base model aliases resolve exact and fuzzy matches without false positives', () => {
  const dialog = createDialog({
    base_models: [
      { name: 'Flux.1 Krea', aliases: ['flux 1 krea'] },
      { name: 'Flux.1 D', aliases: ['flux1d'] },
      { name: 'Pony', aliases: ['ponyxl'] },
    ],
  });

  assert.equal(dialog.resolveBaseModelAliasExact('FLUX KREA'), 'Flux.1 Krea');
  assert.equal(dialog.resolveBaseModelAlias('FLUX KREA'), 'Flux.1 Krea');
  assert.equal(dialog.resolveBaseModelAliasExact('flux 1 krea'), 'Flux.1 Krea');
  assert.equal(dialog.resolveBaseModelAlias('flux1d-dev'), 'Flux.1 D');
  assert.equal(dialog.resolveBaseModelAlias('pony-xl'), 'Pony');
  assert.equal(dialog.resolveBaseModelAlias('unknown architecture'), '');
  assert.equal(dialog.resolveBaseModelAlias(''), '');
});

test('base model aliases resolve directory context while ignoring the model filename', () => {
  const dialog = createDialog({
    base_models: [
      { name: 'Flux.1 Krea', aliases: ['flux 1 krea'] },
      { name: 'SDXL 1.0', aliases: ['sdxl'] },
    ],
  });

  assert.equal(
    dialog.resolveBaseModelAliasFromPath('models/Flux.1 Krea/checkpoint.safetensors'),
    'Flux.1 Krea'
  );
  assert.equal(
    dialog.resolveBaseModelAliasFromPath('models/SDXL/checkpoint.ckpt'),
    'SDXL 1.0'
  );
  assert.equal(dialog.resolveBaseModelAliasFromPath('checkpoint.safetensors'), '');
  assert.equal(dialog.resolveBaseModelAliasFromPath(''), '');
});
