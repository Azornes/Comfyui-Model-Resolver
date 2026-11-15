import test from 'node:test';
import assert from 'node:assert/strict';
import { missingBrowserMethods } from '../web/resolver/views/missing_browser_methods.js';

test('getMissingLocateTargets extracts unique targets from all_node_refs', () => {
  const dialog = { ...missingBrowserMethods };

  const singleRefMissing = {
    node_id: 10,
    node_type: 'CheckpointLoaderSimple',
    is_top_level: true,
  };
  const singleTargets = dialog.getMissingLocateTargets(singleRefMissing);
  assert.equal(singleTargets.length, 1);
  assert.equal(singleTargets[0].nodeId, 10);
  assert.equal(singleTargets[0].isTopLevel, true);

  const multiRefMissing = {
    node_id: 10,
    node_type: 'LoraLoader',
    is_top_level: true,
    all_node_refs: [
      { node_id: 10, node_type: 'LoraLoader', is_top_level: true },
      { node_id: 20, node_type: 'LoraLoader', is_top_level: true },
      { node_id: 30, node_type: 'LoraLoader', is_top_level: false, subgraph_id: 'sub-1' },
      // Duplicate of node 10 should be deduplicated:
      { node_id: 10, node_type: 'LoraLoader', is_top_level: true, widget_index: 2 },
    ],
  };

  const multiTargets = dialog.getMissingLocateTargets(multiRefMissing);
  assert.equal(multiTargets.length, 3);
  assert.deepEqual(multiTargets.map(t => ({ id: t.nodeId, top: t.isTopLevel, sub: t.subgraphId })), [
    { id: 10, top: true, sub: '' },
    { id: 20, top: true, sub: '' },
    { id: 30, top: false, sub: 'sub-1' },
  ]);
});

test('cycleLocateMissingModel cycles sequentially through distinct targets with cycle labels', () => {
  const locatedCalls = [];
  const notifications = [];

  const dialog = {
    ...missingBrowserMethods,
    _missingJumpIndices: new Map(),
    getMissingModelKey(m) {
      return m.original_path || m.name || String(m.node_id);
    },
    locateNodeInGraph(nodeId, options) {
      locatedCalls.push({ nodeId, options });
    },
    showNotification(msg, type) {
      notifications.push({ msg, type });
    },
  };

  const multiRefMissing = {
    original_path: 'loras/detail_enhancer.safetensors',
    node_id: 5,
    all_node_refs: [
      { node_id: 5, node_type: 'LoraLoader', is_top_level: true },
      { node_id: 15, node_type: 'LoraLoader', is_top_level: true },
      { node_id: 25, node_type: 'LoraLoader', is_top_level: false, subgraph_id: 'sg-a' },
    ],
  };

  // Click 1: jumps to first node (#5) with label 1/3
  dialog.cycleLocateMissingModel(multiRefMissing);
  assert.equal(locatedCalls.length, 1);
  assert.equal(locatedCalls[0].nodeId, 5);
  assert.equal(locatedCalls[0].options.cycleLabel, '1/3');
  assert.equal(multiRefMissing._jumpIndex, 0);

  // Click 2: jumps to second node (#15) with label 2/3
  dialog.cycleLocateMissingModel(multiRefMissing);
  assert.equal(locatedCalls.length, 2);
  assert.equal(locatedCalls[1].nodeId, 15);
  assert.equal(locatedCalls[1].options.cycleLabel, '2/3');
  assert.equal(multiRefMissing._jumpIndex, 1);

  // Click 3: jumps to third node (#25) with label 3/3 in subgraph
  dialog.cycleLocateMissingModel(multiRefMissing);
  assert.equal(locatedCalls.length, 3);
  assert.equal(locatedCalls[2].nodeId, 25);
  assert.equal(locatedCalls[2].options.cycleLabel, '3/3');
  assert.equal(locatedCalls[2].options.subgraphId, 'sg-a');
  assert.equal(multiRefMissing._jumpIndex, 2);

  // Click 4: wraps around to first node (#5) with label 1/3
  dialog.cycleLocateMissingModel(multiRefMissing);
  assert.equal(locatedCalls.length, 4);
  assert.equal(locatedCalls[3].nodeId, 5);
  assert.equal(locatedCalls[3].options.cycleLabel, '1/3');
  assert.equal(multiRefMissing._jumpIndex, 0);
});

test('cycleLocateMissingModel with single target does not include cycleLabel', () => {
  const locatedCalls = [];

  const dialog = {
    ...missingBrowserMethods,
    _missingJumpIndices: new Map(),
    getMissingModelKey(m) {
      return String(m.node_id);
    },
    locateNodeInGraph(nodeId, options) {
      locatedCalls.push({ nodeId, options });
    },
  };

  const singleMissing = {
    node_id: 42,
    node_type: 'CheckpointLoaderSimple',
    is_top_level: true,
  };

  dialog.cycleLocateMissingModel(singleMissing);
  assert.equal(locatedCalls.length, 1);
  assert.equal(locatedCalls[0].nodeId, 42);
  assert.equal(locatedCalls[0].options.cycleLabel, undefined);
});

test('getMissingNodeDisplay includes cycling instructions in tooltip and aria-label when multi-referenced', () => {
  const dialog = { ...missingBrowserMethods };

  const singleMissing = {
    node_id: 1,
    node_type: 'CheckpointLoaderSimple',
    is_top_level: true,
  };
  const singleDisplay = dialog.getMissingNodeDisplay(singleMissing);
  assert.equal(singleDisplay.referenceCount, 1);
  assert.equal(singleDisplay.locateTooltip.includes('cycle'), false);

  const multiMissing = {
    node_id: 1,
    node_type: 'LoraLoader',
    is_top_level: true,
    all_node_refs: [
      { node_id: 1, node_type: 'LoraLoader' },
      { node_id: 2, node_type: 'LoraLoader' },
    ],
  };
  const multiDisplay = dialog.getMissingNodeDisplay(multiMissing);
  assert.equal(multiDisplay.referenceCount, 2);
  assert.ok(multiDisplay.locateTooltip.includes('Click repeatedly to cycle through them.'));
  assert.ok(multiDisplay.locateAriaLabel.includes('click repeatedly to cycle'));
});
