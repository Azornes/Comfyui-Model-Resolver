import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCategoryColorKey,
  getModelDisplayDetails,
  getModelPreviewUrl,
  renderNodeModelPopoverHtml,
  NodeModelPopover,
} from '../web/resolver/node_popover.js';

test('getCategoryColorKey maps model categories to standard design tokens', () => {
  assert.equal(getCategoryColorKey('loras'), 'lora');
  assert.equal(getCategoryColorKey('lora'), 'lora');
  assert.equal(getCategoryColorKey('checkpoints'), 'model');
  assert.equal(getCategoryColorKey('checkpoint'), 'model');
  assert.equal(getCategoryColorKey('diffusion_models'), 'model');
  assert.equal(getCategoryColorKey('vae'), 'vae');
  assert.equal(getCategoryColorKey('controlnet'), 'controlnet');
  assert.equal(getCategoryColorKey('clip'), 'clip');
  assert.equal(getCategoryColorKey('unknown_custom_type'), 'generic');
});

test('getModelDisplayDetails extracts clean filename, slot, subfolder, tooltip, and previewUrl', () => {
  const modelWithSubfolder = {
    name: 'Realism_Engine_Ideogram_V4.safetensors',
    filename: 'Realism_Engine_Ideogram_V4.safetensors',
    original_path: 'Ideogram 4.0\\base model\\Realism_Engine_Ideogram_V4.safetensors',
    category: 'loras',
    widget_name: 'lora_name_2',
    widget_index: 3,
    exists: true,
    full_path: 'E:\\ComfyUI\\models\\loras\\Ideogram 4.0\\base model\\Realism_Engine_Ideogram_V4.safetensors',
  };

  const details = getModelDisplayDetails(modelWithSubfolder);
  assert.equal(details.filename, 'Realism_Engine_Ideogram_V4.safetensors');
  assert.equal(details.slot, 'LORAS · lora_name_2');
  assert.equal(details.subfolder, 'Ideogram 4.0\\base model');
  assert.equal(details.subtitle, 'LORAS · lora_name_2 (Ideogram 4.0\\base model)');
  assert.match(details.tooltip, /Realism_Engine_Ideogram_V4\.safetensors/);
  assert.match(details.tooltip, /E:\\ComfyUI\\models\\loras/);
  assert.match(details.previewUrl, /\/model_resolver\/model-preview\?path=/);

  const flatModel = {
    original_path: '96YOTTEA-WAI.safetensors',
    category: 'loras',
    widget_name: 'lora_name_3',
  };
  const flatDetails = getModelDisplayDetails(flatModel);
  assert.equal(flatDetails.filename, '96YOTTEA-WAI.safetensors');
  assert.equal(flatDetails.slot, 'LORAS · lora_name_3');
  assert.equal(flatDetails.subfolder, '');
  assert.equal(flatDetails.subtitle, 'LORAS · lora_name_3');
  assert.match(flatDetails.previewUrl, /96YOTTEA-WAI\.safetensors/);

  assert.equal(getModelPreviewUrl({}), '');
});

test('renderNodeModelPopoverHtml renders empty state when models list is empty', () => {
  const html = renderNodeModelPopoverHtml({
    node: { title: 'Empty Node', type: 'SomeNode' },
    models: [],
  });

  assert.match(html, /Empty Node/);
  assert.match(html, /0 models/);
  assert.match(html, /No models detected on this node/);
  assert.match(html, /Open Model Resolver/);
});

test('renderNodeModelPopoverHtml renders multiple model rows with category chips and action buttons', () => {
  const node = { title: 'LoRA Stacker', type: 'LoraStacker' };
  const models = [
    {
      original_path: 'Ideogram 4.0\\base model\\Realism_Engine_Ideogram_V4.safetensors',
      category: 'loras',
      widget_name: 'lora_name_2',
    },
    {
      original_path: 'Illustrious\\anime\\96YOTTEA-WAI.safetensors',
      category: 'loras',
      widget_name: 'lora_name_3',
    },
    {
      original_path: 'sd_xl_base_1.0.safetensors',
      category: 'checkpoints',
      widget_name: 'ckpt_name',
    },
    {
      original_path: 'sdxl_vae.safetensors',
      category: 'vae',
      widget_name: 'vae_name',
    },
  ];

  const html = renderNodeModelPopoverHtml({ node, models });

  assert.match(html, /LoRA Stacker/);
  assert.match(html, /4 models/);
  assert.match(html, /Realism_Engine_Ideogram_V4\.safetensors/);
  assert.match(html, /96YOTTEA-WAI\.safetensors/);
  assert.match(html, /sd_xl_base_1\.0\.safetensors/);
  assert.match(html, /sdxl_vae\.safetensors/);

  // Check colored tags
  assert.match(html, /mr-node-popover-tag--lora/);
  assert.match(html, /mr-node-popover-tag--model/);
  assert.match(html, /mr-node-popover-tag--vae/);
  assert.match(html, /data-tooltip-image="[^"]*model-preview\?path=/);

  // Check action buttons
  assert.match(html, /data-action="search"/);
  assert.match(html, /data-action="info"/);
  assert.match(html, /data-action="folder"/);
  assert.match(html, /Show in Model Resolver/);
  assert.match(html, /Show info/);
  assert.match(html, /Open containing folder/);

  // Check footer
  assert.match(html, /data-action="open-resolver"/);
  assert.match(html, /Open Model Resolver/);
});

test('NodeModelPopover toggle static management safely handles headless state', () => {
  assert.equal(NodeModelPopover.activeInstance, null);
  NodeModelPopover.closeActive();
  assert.equal(NodeModelPopover.activeInstance, null);

  const instance = new NodeModelPopover({
    node: { id: 1 },
    models: [],
  });
  assert.equal(instance.models.length, 0);
  instance.close();
});

test('NodeModelPopover bindEvents stops propagation on pointerdown, mousedown, and contextmenu for text selection and copying', () => {
  const listeners = {};
  const mockElement = {
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    contains() {
      return false;
    },
  };

  const popover = new NodeModelPopover();
  popover.element = mockElement;
  popover.bindEvents();

  ['pointerdown', 'mousedown', 'contextmenu'].forEach((type) => {
    assert.equal(typeof listeners[type], 'function', `${type} listener must be registered`);
    let stopped = false;
    listeners[type]({
      stopPropagation() {
        stopped = true;
      },
    });
    assert.equal(stopped, true, `${type} must stop propagation for text selection and copying`);
  });
});
