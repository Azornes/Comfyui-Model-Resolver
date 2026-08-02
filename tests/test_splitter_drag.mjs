import assert from 'node:assert/strict';
import test from 'node:test';

import { startSplitterDrag } from '../web/resolver/utils/splitter_drag.js';

function installDragEnvironment() {
  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const listeners = new Map();
  const frames = [];
  globalThis.document = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  globalThis.requestAnimationFrame = callback => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  return {
    listeners,
    frames,
    restore() {
      globalThis.document = previous.document;
      globalThis.requestAnimationFrame = previous.requestAnimationFrame;
      globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
    },
  };
}

function pointerEvent(type, clientX, button = undefined) {
  return {
    type,
    clientX,
    ...(button === undefined ? {} : { button }),
    preventDefault() {},
    stopPropagation() {},
  };
}

test('splitter drag rejects non-primary buttons and completes a mouse drag with bounds', () => {
  const env = installDragEnvironment();
  try {
    assert.equal(startSplitterDrag(pointerEvent('mousedown', 100, 2), { startWidth: 300 }), null);

    const layouts = [];
    const ended = [];
    startSplitterDrag(pointerEvent('mousedown', 100, 0), {
      anchor: 'right',
      startWidth: 300,
      bounds: { min: 200, max: 500 },
      onDrag: width => layouts.push(width),
      onEnd: (width, state) => ended.push({ width, ...state }),
    });
    env.listeners.get('mousemove')(pointerEvent('mousemove', -500));
    env.frames.shift()();
    env.listeners.get('mouseup')(pointerEvent('mouseup', -500));

    assert.deepEqual(layouts, [500]);
    assert.equal(ended[0].width, 500);
    assert.equal(ended[0].didDrag, true);
  } finally {
    env.restore();
  }
});

test('splitter drag applies custom width normalization and preserves threshold clicks', () => {
  const env = installDragEnvironment();
  try {
    const layouts = [];
    const ended = [];
    startSplitterDrag(pointerEvent('mousedown', 100, 0), {
      anchor: 'left',
      startWidth: 300,
      dragThreshold: 5,
      layoutFrameStride: 1,
      onBeforeDrag: width => width + 0.4,
      onDrag: width => layouts.push(width),
      onEnd: (width, state) => ended.push({ width, ...state }),
    });
    env.listeners.get('mousemove')(pointerEvent('mousemove', 103));
    assert.equal(env.frames.length, 0);
    env.listeners.get('mousemove')(pointerEvent('mousemove', 110));
    env.frames.shift()();
    env.listeners.get('mouseup')(pointerEvent('mouseup', 110));

    assert.deepEqual(layouts, [310]);
    assert.equal(ended[0].didDrag, true);

    const noDragEnd = [];
    startSplitterDrag(pointerEvent('mousedown', 50, 0), {
      startWidth: 250,
      onEnd: (width, state) => noDragEnd.push({ width, ...state }),
    });
    env.listeners.get('mouseup')(pointerEvent('mouseup', 50));
    assert.deepEqual(noDragEnd, [{ width: 250, didDrag: false, appliedWidth: 250 }]);
  } finally {
    env.restore();
  }
});

test('splitter drag cancel removes listeners and reports the applied preview width', () => {
  const env = installDragEnvironment();
  try {
    const previews = [];
    const drag = startSplitterDrag(pointerEvent('pointerdown', 100, 0), {
      anchor: 'left',
      startWidth: 300,
      onPreview: (pending, applied, state) => previews.push({ pending, applied, ...state }),
    });
    env.listeners.get('pointermove')(pointerEvent('pointermove', 130));
    const scheduledFrame = env.frames.shift();
    scheduledFrame();
    drag.cancel();

    assert.equal(env.listeners.has('pointermove'), false);
    assert.equal(env.listeners.has('pointerup'), false);
    assert.equal(env.listeners.has('pointercancel'), false);
    assert.deepEqual(previews.at(-1), {
      pending: 330,
      applied: 330,
      cancelled: true,
      final: true,
    });
  } finally {
    env.restore();
  }
});
